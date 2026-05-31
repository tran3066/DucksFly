// Flap detection (Person A, plan Step 04). Pure logic, no React and no webcam:
// each class consumes calibrated landmark frames and emits the flap fields of
// DuckActions. The whole step measures wrist motion in BODY UNITS, meaning the
// raw wrist offset divided by the player's own shoulder width, so a player
// standing close and a player standing far produce the same flap for the same
// physical gesture. We normalize per-frame (against the CURRENT frame's shoulder
// width, not the stored calibration baseline), which keeps each detector
// self-contained and scale-invariant by construction.
//
// Four pieces, smallest to largest:
//   - WristVelocityTracker  : ring buffer of normalized wrist heights + velocity
//   - BinaryFlapDetector    : hysteresis state machine -> one impulse per flap
//   - FlapRateDetector      : peak velocity -> smoothed 0..1 intensity
//   - FlapStrategy          : config.flapMode picks one of the two, returns the
//                             { flap, flapImpulse } slice Step 07 assembles.

import type { LandmarkFrame } from '../fixtures/landmarks'
import { shoulderWidth } from '../calibration'
import { config } from '../config'

// Re-export the mode union so callers (and tests) import it from here alongside
// the detectors instead of reaching back into config.
export type { FlapMode } from '../config'
import type { FlapMode } from '../config'

// MediaPipe Pose landmark indices Person A uses for flap height.
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12

// The flap slice of DuckActions. Step 07 spreads this straight into the final
// actions object, so the shape must stay exactly { flap, flapImpulse }.
export interface FlapResult {
  flap: number // continuous climb intensity, 0..1 (rate mode)
  flapImpulse: boolean // one-shot kick on each completed flap (binary mode)
}

// True only when both wrists AND both shoulders are visible enough to trust the
// geometry. A one-frame dropout of any of these would otherwise jump the wrist
// to a garbage Y and read as a giant fake velocity spike, so the tracker holds
// the previous height instead (see WristVelocityTracker.push).
function landmarksVisible(frame: LandmarkFrame): boolean {
  const minVis = config.minLandmarkVisibility
  for (const i of [LEFT_WRIST, RIGHT_WRIST, LEFT_SHOULDER, RIGHT_SHOULDER]) {
    const lm = frame[i]
    if (!lm || lm.visibility < minVis) return false
  }
  return true
}

// Signed normalized wrist height for one frame, in body units. y grows DOWNWARD
// in image space, so hands ABOVE the shoulder line have a smaller wrist Y and we
// flip the sign (shoulderY - wristY) so "hands up" reads POSITIVE. Dividing by
// the frame's own shoulder width makes it scale-invariant. Exported so the debug
// HUD can show the live value the detectors threshold against.
export function wristHeight(frame: LandmarkFrame): number {
  const wristY = (frame[LEFT_WRIST].y + frame[RIGHT_WRIST].y) / 2
  const shoulderY = (frame[LEFT_SHOULDER].y + frame[RIGHT_SHOULDER].y) / 2
  return (shoulderY - wristY) / shoulderWidth(frame)
}

/**
 * 04.1: keep a short rolling window of normalized wrist heights and report the
 * per-frame velocity (the rate of change of height in body units per frame).
 * This buffer is the shared backbone for both 04.2 and 04.3; each detector owns
 * its own tracker instance so there is no cross-test shared state.
 */
export class WristVelocityTracker {
  private readonly windowSize: number
  private buf: number[] = []

  constructor(windowSize: number = config.flapWindowSize) {
    // Need at least 2 samples to take a velocity, so floor the window at 2.
    this.windowSize = Math.max(2, Math.floor(windowSize))
  }

  /**
   * Push one calibrated frame and return the latest velocity (body units/frame).
   * On a visibility dropout we re-push the PREVIOUS height (a hold) so a missing
   * landmark does not look like a sudden flap. On the very first frame there is
   * no previous height to hold, so we use the computed one regardless.
   */
  push(frame: LandmarkFrame): number {
    let h: number
    if (!landmarksVisible(frame) && this.buf.length > 0) {
      // Hold: repeat the last good height so the velocity for this frame is 0
      // rather than a spike from a garbage landmark.
      h = this.buf[this.buf.length - 1]
    } else {
      h = wristHeight(frame)
    }

    // Plain ring buffer: drop the oldest once full, then append. Simple and
    // good enough for an 8-frame window.
    if (this.buf.length >= this.windowSize) this.buf.shift()
    this.buf.push(h)

    return this.velocity()
  }

  /** Current normalized signed wrist height in body units (0 if no samples). */
  height(): number {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1] : 0
  }

  /**
   * Latest velocity: the difference between the two most recent samples. With
   * fewer than 2 samples there is no prior frame to diff against, so it is 0.
   */
  velocity(): number {
    const n = this.buf.length
    if (n < 2) return 0
    return this.buf[n - 1] - this.buf[n - 2]
  }

  /**
   * Max absolute adjacent difference across the whole window. Peak velocity
   * grows with both stroke amplitude and stroke speed, which is why 04.3 uses it
   * as the driver for continuous intensity.
   */
  peakVelocity(): number {
    let peak = 0
    for (let i = 1; i < this.buf.length; i++) {
      const d = Math.abs(this.buf[i] - this.buf[i - 1])
      if (d > peak) peak = d
    }
    return peak
  }

  /**
   * Snapshot copy of the buffered heights (for tests). A COPY, not the live
   * array, so a caller cannot splice/push the detector's internal ring buffer
   * and corrupt later velocity/peak computations.
   */
  samples(): readonly number[] {
    return [...this.buf]
  }

  /** Drop all buffered samples (fresh start). */
  reset(): void {
    this.buf = []
  }
}

// Hysteresis state. LOW means hands are down and the detector is armed to fire;
// HIGH means it has already fired and is waiting for a clean return to LOW.
type FlapState = 'LOW' | 'HIGH'

/**
 * 04.2: a hysteresis state machine over the normalized wrist height. Two
 * thresholds (high arms, low disarms) plus a frame refractory guarantee exactly
 * one impulse per completed flap: it fires on the rising edge when height first
 * crosses the high threshold, then refuses to fire again until the wrists have
 * clearly come back down below the low threshold AND the refractory has elapsed.
 */
export class BinaryFlapDetector {
  private readonly highThreshold: number
  private readonly lowThreshold: number
  private readonly refractoryFrames: number
  private readonly tracker: WristVelocityTracker

  private state: FlapState = 'LOW'
  private refractory = 0

  constructor(opts?: {
    highThreshold?: number
    lowThreshold?: number
    refractoryFrames?: number
    tracker?: WristVelocityTracker
  }) {
    this.highThreshold = opts?.highThreshold ?? config.flapHighThreshold
    this.lowThreshold = opts?.lowThreshold ?? config.flapLowThreshold
    // Hysteresis REQUIRES a gap: the high threshold arms above the low one. With
    // high <= low the machine would re-arm the instant it fires and machine-gun
    // impulses, so reject it at construction. The debug harness tunes these live,
    // so we defend the precondition rather than trust the caller.
    if (this.highThreshold <= this.lowThreshold) {
      throw new RangeError(
        `BinaryFlapDetector: highThreshold (${this.highThreshold}) must be greater than lowThreshold (${this.lowThreshold})`,
      )
    }
    this.refractoryFrames = opts?.refractoryFrames ?? config.flapRefractoryFrames
    this.tracker = opts?.tracker ?? new WristVelocityTracker()
  }

  /**
   * Push one calibrated frame; returns true exactly once per completed flap, on
   * the rising edge. All other frames return false.
   */
  push(frame: LandmarkFrame): boolean {
    this.tracker.push(frame)
    const h = this.tracker.height()

    if (this.state === 'LOW') {
      // Rising edge: arm and fire once. Start the refractory countdown so a
      // mid-stroke wobble cannot immediately re-arm us.
      if (h >= this.highThreshold) {
        this.state = 'HIGH'
        this.refractory = this.refractoryFrames
        return true
      }
      return false
    }

    // state === 'HIGH': count down the refractory, and only return to LOW (ready
    // to fire again) once the hands have clearly dropped below the low threshold
    // AND the refractory has expired. This is what makes one physical flap equal
    // exactly one impulse even if the height wobbles on the way down.
    if (this.refractory > 0) this.refractory -= 1
    if (h <= this.lowThreshold && this.refractory <= 0) {
      this.state = 'LOW'
    }
    return false
  }

  /** Reset the state machine and its tracker to a fresh LOW, armed state. */
  reset(): void {
    this.state = 'LOW'
    this.refractory = 0
    this.tracker.reset()
  }
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

// How fast the rate detector's peak-hold relaxes each frame when motion drops
// (a value < 1, closer to 1 holds longer). Why a peak-hold at all: a plain
// windowed max keeps the last stroke's peak pinned for the WHOLE window
// (~windowSize frames) after the player stops, so intensity would sit at full
// lift for a beat before falling. A decaying peak-hold instead starts relaxing
// the moment flapping stops, while still holding through the brief
// zero-velocity instant at each stroke turnaround.
const DEFAULT_RATE_PEAK_DECAY = 0.8

/**
 * 04.3: continuous climb intensity. Each frame it reads the instantaneous wrist
 * speed, feeds a decaying PEAK-HOLD (rise instantly to the current stroke speed,
 * relax gently otherwise), subtracts the noise floor so jitter does not register
 * as lift, scales by a gain, clamps to 0..1, and exponentially smooths toward
 * that target. Faster and bigger flaps push a higher peak-hold, so intensity
 * climbs; when the player stops, the peak-hold decays and intensity follows it
 * down promptly instead of sticking at full lift.
 */
export class FlapRateDetector {
  private readonly gain: number
  private readonly decay: number
  private readonly noiseEpsilon: number
  private readonly peakDecay: number
  private readonly tracker: WristVelocityTracker

  private current = 0 // smoothed intensity, 0..1
  private peakHold = 0 // decaying peak of recent wrist speed (body units/frame)

  constructor(opts?: {
    gain?: number
    decay?: number
    peakDecay?: number
    noiseEpsilon?: number
    tracker?: WristVelocityTracker
  }) {
    this.gain = opts?.gain ?? config.flapRateGain
    this.decay = opts?.decay ?? config.flapRateDecay
    this.peakDecay = opts?.peakDecay ?? DEFAULT_RATE_PEAK_DECAY
    // The noise floor below which wrist motion does not register as lift. Lower =
    // more sensitive (gentler flaps count); raise it if a still pose creeps up.
    this.noiseEpsilon = opts?.noiseEpsilon ?? config.flapNoiseEpsilon
    this.tracker = opts?.tracker ?? new WristVelocityTracker()
  }

  /** Push one calibrated frame; returns the current flap intensity in 0..1. */
  push(frame: LandmarkFrame): number {
    this.tracker.push(frame)
    const speed = Math.abs(this.tracker.velocity())

    // Peak-hold with decay: jump up to the current stroke speed instantly, but
    // only relax by peakDecay per frame otherwise. This holds through the brief
    // zero-velocity instant at a stroke turnaround, yet starts falling right
    // away once the player actually stops (no full-window plateau).
    this.peakHold = Math.max(speed, this.peakHold * this.peakDecay)

    // Subtract the noise floor first so a still pose's jitter reads as 0, then
    // scale and clamp so the 0..1 contract holds even for extreme input.
    const target = clamp01(this.gain * Math.max(0, this.peakHold - this.noiseEpsilon))

    // Exponential smoothing (a low-pass filter with decay < 1): move a fraction
    // of the way toward the target each frame so the signal does not flicker.
    this.current = this.current + this.decay * (target - this.current)
    return this.current
  }

  /** Current intensity without advancing state. */
  intensity(): number {
    return this.current
  }

  /** Reset the smoothed intensity, the peak-hold, and the underlying tracker. */
  reset(): void {
    this.current = 0
    this.peakHold = 0
    this.tracker.reset()
  }
}

/**
 * 04.4: one strategy object that owns whichever detector matches
 * config.flapMode and returns the { flap, flapImpulse } slice of DuckActions.
 * Binary mode drives flapImpulse and leaves flap at 0; rate mode drives flap and
 * leaves flapImpulse false. An unknown mode falls back to idle output so a bad
 * config can never crash the input loop.
 */
export class FlapStrategy {
  private readonly mode: FlapMode
  private readonly binary: BinaryFlapDetector | null
  private readonly rate: FlapRateDetector | null

  constructor(opts?: {
    flapMode?: FlapMode
    // Optional tuning overrides forwarded to the matching detector; each
    // undefined value falls back to the config default inside the detector.
    highThreshold?: number
    lowThreshold?: number
    refractoryFrames?: number
    gain?: number
    decay?: number
    noiseEpsilon?: number
  }) {
    // The argument overrides config.flapMode; fall back to config otherwise.
    this.mode = opts?.flapMode ?? config.flapMode
    // Only instantiate the detector the resolved mode needs. An unknown mode
    // instantiates neither and produces idle output, so it never throws.
    this.binary =
      this.mode === 'binary'
        ? new BinaryFlapDetector({
            highThreshold: opts?.highThreshold,
            lowThreshold: opts?.lowThreshold,
            refractoryFrames: opts?.refractoryFrames,
          })
        : null
    this.rate =
      this.mode === 'rate'
        ? new FlapRateDetector({
            gain: opts?.gain,
            decay: opts?.decay,
            noiseEpsilon: opts?.noiseEpsilon,
          })
        : null
  }

  /** Push one calibrated frame; returns the flap slice of DuckActions. */
  push(frame: LandmarkFrame): FlapResult {
    if (this.mode === 'binary' && this.binary) {
      return { flap: 0, flapImpulse: this.binary.push(frame) }
    }
    if (this.mode === 'rate' && this.rate) {
      return { flap: this.rate.push(frame), flapImpulse: false }
    }
    // Idle fallback for an unknown mode: a valid, contract-shaped, do-nothing
    // result instead of an exception.
    return { flap: 0, flapImpulse: false }
  }

  /** Reset whichever detector this strategy owns. */
  reset(): void {
    this.binary?.reset()
    this.rate?.reset()
  }
}

/**
 * Dive from lowering the arms (the mirror image of flap): when the wrists drop
 * BELOW the shoulder line, the duck noses down. Reuses the same signed wrist
 * height as flap (positive = hands up), so a NEGATIVE height means hands below
 * the shoulders. We map how far below the shoulders the wrists sit, in body
 * units, into a 0..1 dive: nothing until startBelow (a dead zone so arms resting
 * a little low does not dive), ramping to a full dive at fullBelow. Hands at or
 * above shoulder height return 0, so flapping (arms up) never reads as a dive.
 */
export function diveFromArmsDown(
  frame: LandmarkFrame,
  startBelow: number = 0.4,
  fullBelow: number = 1.5,
): number {
  // Shoulder-widths the wrists sit BELOW the shoulders (negate the signed height).
  const below = -wristHeight(frame)
  if (fullBelow <= startBelow) return 0
  return clamp01((below - startBelow) / (fullBelow - startBelow))
}
