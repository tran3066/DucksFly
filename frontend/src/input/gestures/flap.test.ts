// Tests for flap detection (Person A, Step 04). Pure logic only: we feed
// synthetic landmark frames from fixtures/landmarks.ts through the detectors
// instead of running a live webcam. Each test pins one behavior, and every
// substep includes an adversarial / edge case.
//
// Test-first: these were written before flap.ts existed and must FAIL red first.

import { describe, it, expect } from 'vitest'
import {
  WristVelocityTracker,
  BinaryFlapDetector,
  FlapRateDetector,
  FlapStrategy,
  diveFromArmsDown,
  type FlapMode,
} from './flap'
import { makeFlapSequence, makeLandmarkFrame } from '../fixtures/landmarks'
import { config } from '../config'

// ---------------------------------------------------------------------------
// 04.1 Wrist Velocity
// ---------------------------------------------------------------------------
describe('WristVelocityTracker', () => {
  it('buffer keeps only the last N samples', () => {
    // Push windowSize+3 monotonically rising frames. The ring buffer must never
    // grow past the window, and the oldest values must be shifted out so the
    // first stored sample is the 4th value pushed (indices 0..2 dropped).
    const windowSize = 8
    const tracker = new WristVelocityTracker(windowSize)
    // amplitude here drives the peak normalized height; framesPerStroke set high
    // and partial so the whole sequence is a monotone rise (no fall) for a clean
    // "increasing wrist Y" feed of exactly windowSize + 3 frames.
    const frames = makeFlapSequence({
      amplitude: 1.0,
      framesPerStroke: windowSize + 3,
      partial: true,
    })
    expect(frames.length).toBe(windowSize + 3)

    const heights: number[] = []
    for (const f of frames) {
      tracker.push(f)
      heights.push(tracker.height())
    }

    // Never exceeds the window.
    expect(tracker.samples().length).toBe(windowSize)
    // Oldest three were dropped: the first stored sample equals the 4th pushed
    // height (0-indexed heights[3]).
    expect(tracker.samples()[0]).toBeCloseTo(heights[3], 10)
  })

  it('a full flap gives a positive up-swing velocity and a negative down-swing, with a strong peak', () => {
    // The tracker works in SIGNED NORMALIZED HEIGHT h = (shoulderY - wristY)/width,
    // where hands-up is POSITIVE (y grows downward, so a rising hand lowers wrist
    // Y and raises h). So the velocity (the per-frame change in h) is POSITIVE on
    // the up swing and NEGATIVE on the way back down. (The earlier "negative peak"
    // wording referred to raw wrist Y, which the tracker never uses.) We assert
    // the sign the detector's high-threshold crossing actually depends on.
    const tracker = new WristVelocityTracker(8)
    // framesPerStroke 3 makes a sharp stroke: peak adjacent velocity is
    // 2 * amplitude / framesPerStroke = 2 * 1.0 / 3 ~= 0.67 > 0.5.
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 3 })

    const velocities: number[] = []
    for (const f of frames) {
      tracker.push(f)
      velocities.push(tracker.velocity())
    }

    // Peak magnitude well above the noise floor.
    expect(tracker.peakVelocity()).toBeGreaterThan(0.5)
    // Up swing is clearly positive, down swing clearly negative.
    expect(Math.max(...velocities)).toBeGreaterThan(0.5)
    expect(Math.min(...velocities)).toBeLessThan(-0.5)
  })

  it('velocity is scale invariant', () => {
    // The same physical flap at two shoulder widths must yield equal normalized
    // velocity because the tracker divides by the current frame's shoulder width.
    const narrow = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 3, shoulderWidth: 0.1 })
    const wide = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 3, shoulderWidth: 0.2 })

    const tNarrow = new WristVelocityTracker(8)
    const tWide = new WristVelocityTracker(8)
    for (const f of narrow) tNarrow.push(f)
    for (const f of wide) tWide.push(f)

    expect(tNarrow.peakVelocity()).toBeCloseTo(tWide.peakVelocity(), 6)
  })

  it('ADVERSARIAL: pure jitter stays near zero', () => {
    // Tiny noise around a fixed wrist Y, below the noise floor. Every velocity
    // sample magnitude must stay below flapNoiseEpsilon so it never reads as a
    // flap-grade peak.
    const tracker = new WristVelocityTracker(8)
    // Jitter of +/-0.01 body units around a constant height. We build frames by
    // hand so the wobble amplitude is exactly tiny.
    const eps = config.flapNoiseEpsilon
    const shoulderWidth = 0.16 // default pose shoulder width (0.58 - 0.42)
    const baseHeightBodyUnits = 0.0 // wrists at shoulder line
    // shoulderY for default pose is 0.35; pick wristY so h ~ baseHeightBodyUnits
    const shoulderY = 0.35
    let maxVel = 0
    for (let i = 0; i < 12; i++) {
      const jitter = (i % 2 === 0 ? 0.01 : -0.01) // +/-0.01 body units in h
      const targetH = baseHeightBodyUnits + jitter
      const wristY = shoulderY - targetH * shoulderWidth
      const frame = makeLandmarkFrame({ 15: { y: wristY }, 16: { y: wristY } })
      tracker.push(frame)
      maxVel = Math.max(maxVel, Math.abs(tracker.velocity()))
    }
    // The largest swing between adjacent jitter samples is 0.02 body units,
    // which must stay below the 0.03 noise epsilon.
    expect(maxVel).toBeLessThan(eps)
  })

  it('single sample yields zero velocity', () => {
    // With one sample in the buffer there is no prior frame to diff against.
    const tracker = new WristVelocityTracker(8)
    tracker.push(makeLandmarkFrame())
    expect(tracker.velocity()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 04.2 Binary Flap (climb)
// ---------------------------------------------------------------------------
describe('BinaryFlapDetector', () => {
  it('one full flap fires exactly one impulse', () => {
    // A complete stroke: wrists rise above the high threshold, then fall back
    // below the low threshold. Exactly one frame returns true, all others false.
    const detector = new BinaryFlapDetector()
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 10 })

    let count = 0
    for (const f of frames) {
      if (detector.push(f)) count += 1
    }
    expect(count).toBe(1)
  })

  it('impulse lands on the rising edge', () => {
    // The impulse frame is where height first crosses the high threshold going
    // up, so its index must fall in the first half of the stroke (before peak).
    const detector = new BinaryFlapDetector()
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 10 })

    let trueIndex = -1
    frames.forEach((f, i) => {
      if (detector.push(f) && trueIndex === -1) trueIndex = i
    })
    expect(trueIndex).toBeGreaterThanOrEqual(0)
    // The fixture peaks at the midpoint of the stroke, so a rising-edge impulse
    // lands strictly before the peak frame.
    expect(trueIndex).toBeLessThan(Math.floor(frames.length / 2))
  })

  it('ADVERSARIAL: one flap never double-fires', () => {
    // A wobbly stroke that briefly dips and re-crosses the high threshold within
    // the refractory window still yields exactly one impulse.
    const detector = new BinaryFlapDetector()
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 8, wobble: true })

    let count = 0
    for (const f of frames) {
      if (detector.push(f)) count += 1
    }
    expect(count).toBe(1)
  })

  it('half-motion does not fire', () => {
    // A partial swing that peaks BELOW the high threshold never arms the detector,
    // so it emits zero impulses. (The impulse fires on the rising edge, so the
    // only way to fire nothing is to never cross the high threshold at all.)
    const detector = new BinaryFlapDetector()
    // amplitude below the high threshold so the rise never arms the machine.
    const frames = makeFlapSequence({
      amplitude: 0.4, // peak normalized height stays under the 0.6 high threshold
      framesPerStroke: 8,
      partial: true,
    })

    let count = 0
    for (const f of frames) {
      if (detector.push(f)) count += 1
    }
    expect(count).toBe(0)
  })

  it('back-to-back flaps fire twice', () => {
    // After the refractory window elapses and the wrists return below low, a
    // second complete flap fires a second impulse.
    const detector = new BinaryFlapDetector()
    const stroke = () => makeFlapSequence({ amplitude: 1.0, framesPerStroke: 10 })
    const frames = [...stroke(), ...stroke()]

    let count = 0
    for (const f of frames) {
      if (detector.push(f)) count += 1
    }
    expect(count).toBe(2)
  })

  it('refractory blocks a re-cross before it elapses', () => {
    // Fire, drop below the low threshold, then re-cross the high threshold again
    // all WITHIN the refractory window. Only the first cross fires: the refractory
    // countdown (not just the low-latch) is what blocks the second. With
    // refractoryFrames 0 this would double-fire, so it isolates the countdown.
    const detector = new BinaryFlapDetector() // refractoryFrames default 6
    // Build frames at exact normalized heights. Default pose: shoulders at y=0.35,
    // shoulder width 0.16 (x 0.58 vs 0.42), so h = (0.35 - wristY) / 0.16.
    const shoulderY = 0.35
    const width = 0.16
    const frameAtHeight = (h: number) => {
      const wristY = shoulderY - h * width
      return makeLandmarkFrame({ 15: { y: wristY }, 16: { y: wristY } })
    }
    // Above high (0.6), below low (0.2), above high again, all within < 6 frames.
    const heights = [0.0, 0.7, 0.0, 0.7, 0.0, 0.0]
    let count = 0
    for (const h of heights) {
      if (detector.push(frameAtHeight(h))) count += 1
    }
    expect(count).toBe(1)
  })

  it('rejects inverted thresholds (hysteresis requires high > low)', () => {
    // A high threshold at or below the low threshold collapses the hysteresis and
    // would machine-gun impulses, so construction throws rather than ship a
    // detector that re-arms the instant it fires.
    expect(() => new BinaryFlapDetector({ highThreshold: 0.2, lowThreshold: 0.6 })).toThrow()
    expect(() => new BinaryFlapDetector({ highThreshold: 0.5, lowThreshold: 0.5 })).toThrow()
  })
})

// ---------------------------------------------------------------------------
// 04.3 Flap-Rate (speed)
// ---------------------------------------------------------------------------
describe('FlapRateDetector', () => {
  it('faster flapping yields higher intensity', () => {
    // Slow and fast sequences of the same amplitude; fast must read higher
    // steady-state intensity because a tighter stroke gives a larger peak
    // velocity per frame.
    const slow = runRate(makeFlapSequence({ amplitude: 1.0, framesPerStroke: 12 }))
    const fast = runRate(makeFlapSequence({ amplitude: 1.0, framesPerStroke: 4 }))
    expect(fast).toBeGreaterThan(slow)
  })

  it('intensity is monotonic across three speeds', () => {
    // slow < medium < fast.
    const slow = runRate(makeFlapSequence({ amplitude: 1.0, framesPerStroke: 12 }))
    const medium = runRate(makeFlapSequence({ amplitude: 1.0, framesPerStroke: 8 }))
    const fast = runRate(makeFlapSequence({ amplitude: 1.0, framesPerStroke: 4 }))
    expect(slow).toBeLessThan(medium)
    expect(medium).toBeLessThan(fast)
  })

  it('ADVERSARIAL: very fast flapping clamps at 1, never exceeds', () => {
    // An extreme, unrealistically fast and tall sequence still returns at most 1
    // and never NaN, and reads near the ceiling.
    const detector = new FlapRateDetector()
    const frames = makeFlapSequence({ amplitude: 3.0, framesPerStroke: 2 })
    let v = 0
    // Repeat the burst several times so the smoothed value reaches steady state.
    for (let rep = 0; rep < 6; rep++) {
      for (const f of frames) v = detector.push(f)
    }
    expect(Number.isNaN(v)).toBe(false)
    expect(v).toBeLessThanOrEqual(1)
    expect(v).toBeGreaterThan(0.9)
  })

  it('no motion yields zero intensity', () => {
    // A still pose (constant wrist Y) feeds in. Intensity converges to 0.
    const detector = new FlapRateDetector()
    let v = 0
    for (let i = 0; i < 20; i++) v = detector.push(makeLandmarkFrame())
    expect(v).toBeCloseTo(0, 6)
  })

  it('intensity decays when flapping stops', () => {
    // After a burst of fast flapping, switch to still frames: a later intensity
    // must be strictly less than the peak intensity, trending toward 0.
    const detector = new FlapRateDetector()
    const burst = makeFlapSequence({ amplitude: 1.5, framesPerStroke: 3 })
    let peak = 0
    for (let rep = 0; rep < 4; rep++) {
      for (const f of burst) {
        const v = detector.push(f)
        if (v > peak) peak = v
      }
    }
    // Now feed still frames and read a later intensity.
    let later = peak
    for (let i = 0; i < 15; i++) later = detector.push(makeLandmarkFrame())
    expect(later).toBeLessThan(peak)
  })
})

// ---------------------------------------------------------------------------
// 04.4 A/B Toggle
// ---------------------------------------------------------------------------
describe('FlapStrategy (flapMode toggle)', () => {
  it('binary mode emits impulses and zero analog flap', () => {
    // With flapMode 'binary', a full flap yields a rising-edge impulse while the
    // analog flap stays exactly 0.
    const strat = new FlapStrategy({ flapMode: 'binary' })
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 6 })

    let sawImpulse = false
    for (const f of frames) {
      const out = strat.push(f)
      if (out.flapImpulse) sawImpulse = true
      expect(out.flap).toBe(0)
    }
    expect(sawImpulse).toBe(true)
  })

  it('rate mode emits analog flap and no impulse', () => {
    // With flapMode 'rate', fast flapping raises flap above 0 while flapImpulse
    // stays always false.
    const strat = new FlapStrategy({ flapMode: 'rate' })
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 4 })

    let sawFlap = false
    for (const f of frames) {
      const out = strat.push(f)
      if (out.flap > 0) sawFlap = true
      expect(out.flapImpulse).toBe(false)
    }
    expect(sawFlap).toBe(true)
  })

  it('output shape is valid in both modes', () => {
    // Every returned object has a numeric flap in 0..1 and a boolean flapImpulse,
    // in both modes.
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 5 })
    for (const mode of ['binary', 'rate'] as FlapMode[]) {
      const strat = new FlapStrategy({ flapMode: mode })
      for (const f of frames) {
        const out = strat.push(f)
        expect(typeof out.flap).toBe('number')
        expect(Number.isNaN(out.flap)).toBe(false)
        expect(out.flap).toBeGreaterThanOrEqual(0)
        expect(out.flap).toBeLessThanOrEqual(1)
        expect(typeof out.flapImpulse).toBe('boolean')
      }
    }
  })

  it('ADVERSARIAL: unknown flapMode falls back to a safe default', () => {
    // An invalid mode string does not throw and produces idle flap output.
    const strat = new FlapStrategy({ flapMode: 'bogus' as FlapMode })
    let out = { flap: -1, flapImpulse: true } as { flap: number; flapImpulse: boolean }
    expect(() => {
      out = strat.push(makeLandmarkFrame())
    }).not.toThrow()
    expect(out.flap).toBe(0)
    expect(out.flapImpulse).toBe(false)
  })

  it('switching mode swaps the strategy', () => {
    // The same input under two strategies behaves differently: binary produces
    // an impulse with flap === 0; rate produces flap > 0 with no impulse.
    const frames = makeFlapSequence({ amplitude: 1.0, framesPerStroke: 4 })

    const binary = new FlapStrategy({ flapMode: 'binary' })
    let binaryImpulses = 0
    let binaryFlapAlwaysZero = true
    for (const f of frames) {
      const out = binary.push(f)
      if (out.flapImpulse) binaryImpulses += 1
      if (out.flap !== 0) binaryFlapAlwaysZero = false
    }

    const rate = new FlapStrategy({ flapMode: 'rate' })
    let rateMaxFlap = 0
    let rateNoImpulse = true
    for (const f of frames) {
      const out = rate.push(f)
      rateMaxFlap = Math.max(rateMaxFlap, out.flap)
      if (out.flapImpulse) rateNoImpulse = false
    }

    expect(binaryImpulses).toBeGreaterThan(0)
    expect(binaryFlapAlwaysZero).toBe(true)
    expect(rateMaxFlap).toBeGreaterThan(0)
    expect(rateNoImpulse).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Dive from lowering the arms (the inverse of flap height)
// ---------------------------------------------------------------------------
describe('diveFromArmsDown', () => {
  // Default pose shoulders sit at y=0.35; move both wrists (15, 16) to a height.
  const armsAt = (wristY: number) => makeLandmarkFrame({ 15: { y: wristY }, 16: { y: wristY } })

  it('no dive when the arms are at shoulder height', () => {
    expect(diveFromArmsDown(armsAt(0.35))).toBe(0)
  })

  it('full dive when the arms drop well below the shoulders', () => {
    expect(diveFromArmsDown(armsAt(0.6))).toBeGreaterThan(0.9)
  })

  it('a slight drop within the dead zone does not dive', () => {
    expect(diveFromArmsDown(armsAt(0.4))).toBe(0)
  })

  it('ADVERSARIAL: arms RAISED (a flap) never reads as a dive', () => {
    expect(diveFromArmsDown(armsAt(0.2))).toBe(0)
  })

  it('clamps to at most 1 for arms dropped to the floor', () => {
    const dive = diveFromArmsDown(armsAt(1.0))
    expect(dive).toBeLessThanOrEqual(1)
    expect(dive).toBeGreaterThan(0.9)
  })
})

// Drive a rate sequence to a steady-state intensity for comparison tests.
// Repeats the sequence a few times so the exponential smoothing settles before
// we read the final value, then returns the highest intensity reached (the
// steady-state peak per stroke).
function runRate(frames: ReturnType<typeof makeFlapSequence>): number {
  const detector = new FlapRateDetector()
  let peak = 0
  for (let rep = 0; rep < 4; rep++) {
    for (const f of frames) {
      const v = detector.push(f)
      if (v > peak) peak = v
    }
  }
  return peak
}
