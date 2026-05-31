// Calibration: turn a short burst of live pose frames into a stable rest pose,
// then reduce that rest pose to the few baseline numbers every later gesture
// stage normalizes against. (Person A, plan Step 03.1 + 03.2)
//
// Why this exists: flap height and lean angle are only meaningful relative to
// the player's resting posture. A player standing close and a player standing
// far must produce identical DuckActions for the same gesture, so we capture a
// neutral pose once, average out the per-frame jitter, and divide later
// measurements by this body's own scale. If a single blurry frame poisoned the
// baseline the duck would behave wrong for the whole session, which is why the
// capture step averages many frames and rejects junk frames up front.
//
// Two halves live here:
//   - pure functions (isFrameUsable, averageFrames, computeBaseline) that the
//     unit tests drive with synthetic frames, no webcam involved
//   - a thin browser collector (captureRestPose) that samples the live pose loop
//     over a couple seconds and hands the frames to averageFrames; not unit
//     tested because it depends on real timers and a real pose stream

import { create } from 'zustand'

// A landmark is the minimum calibration cares about. MediaPipe actually returns
// a richer landmark that also has z, and that richer shape is assignable to this
// one (it has every field we read plus extra), so the UI can pass the store's
// landmarks straight in without converting.
export interface Landmark {
  x: number
  y: number
  visibility: number
}

// A frame is the per-landmark array MediaPipe Pose produces, indexed by pose
// index (0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips).
export type Frame = Landmark[]

// The averaged neutral pose produced by a successful capture.
export interface RestPose {
  pose: Frame
}

// averageFrames either succeeds with a pose (and how many frames it kept) or
// fails because every frame was rejected. Modeling failure as a separate variant
// means callers must handle the all-junk case instead of silently using NaN.
export type AverageResult =
  | { ok: true; pose: Frame; acceptedCount: number }
  | { ok: false; acceptedCount: 0 }

// Three normalizers the gesture stages divide or subtract against.
export interface Baseline {
  shoulderWidth: number // dist(11, 12), the scale unit (always > 0)
  restShoulderAngle: number // atan2 of the shoulder line, radians
  restWristY: number // mean of wrist 15 and 16 y
}

// The landmarks gameplay depends on: shoulders, elbows, wrists, hips. The
// visibility gate looks only at these, so an irrelevant joint going dark (the
// nose, say) does not throw away an otherwise good frame.
const TRACKED = [11, 12, 13, 14, 15, 16, 23, 24]

// Below this visibility a landmark is treated as "not really seen".
const VIS_MIN = 0.5

// A shoulder width of literally zero (a degenerate pose) would make later
// divisions blow up to Infinity, so we clamp to this tiny floor instead. Real
// calibration never hits this because averageFrames rejects unusable frames, but
// computeBaseline stays defensive.
const SHOULDER_WIDTH_EPSILON = 1e-6

/**
 * Distance between the two shoulder landmarks (11 left, 12 right), the scale
 * unit every spatial measurement divides by so body size and camera distance
 * cancel out. Clamped to SHOULDER_WIDTH_EPSILON so a degenerate frame (shoulders
 * on top of each other) can never make a later division blow up to Infinity.
 *
 * This is the single source of truth for shoulder width: computeBaseline below
 * uses it for the stored baseline, and the flap tracker (Step 04) calls it
 * per-frame to self-normalize each live frame without reading the baseline.
 * Accepts the richer LandmarkFrame too (it only reads x and y), so callers can
 * pass either a calibration Frame or a live pose frame.
 */
export function shoulderWidth(frame: Frame): number {
  const l11 = frame[11]
  const r12 = frame[12]
  const raw = Math.hypot(l11.x - r12.x, l11.y - r12.y)
  return raw < SHOULDER_WIDTH_EPSILON ? SHOULDER_WIDTH_EPSILON : raw
}

/**
 * True only when every tracked landmark in the frame is visible enough. A frame
 * with a hidden nose still passes (the nose is not tracked), while a frame with
 * a hidden shoulder or wrist fails. visMin defaults to VIS_MIN but can be raised
 * for a stricter capture.
 */
export function isFrameUsable(frame: Frame, visMin: number = VIS_MIN): boolean {
  for (const i of TRACKED) {
    const lm = frame[i]
    // A missing landmark counts as not usable: we cannot trust geometry we
    // never received.
    if (!lm || lm.visibility < visMin) return false
  }
  return true
}

// How close to a frame edge a tracked joint may sit before we treat the player as
// standing too close. MediaPipe pose estimates get jumpy at/near the edges, so a
// margin both keeps outstretched arms in shot and nudges the player back to the
// steadier distance.
const FRAMING_MARGIN = 0.08

export type FramingReason = 'ok' | 'no-pose' | 'low-visibility' | 'out-of-frame'

export interface FramingResult {
  ok: boolean
  reason: FramingReason
}

/**
 * Judge whether the player is framed well enough for reliable tracking: every
 * tracked joint must be visible AND sit inside a safe inner box (a margin in from
 * every edge). 'low-visibility' is reported before 'out-of-frame' because an
 * unseen joint's position cannot be trusted. This drives the calibration gate's
 * "step back / move into view" guidance: standing too close in a T-pose pushes
 * the wrists to the frame edges, which is exactly where the landmarks start to
 * jump around.
 */
export function assessFraming(
  frame: Frame | null,
  margin: number = FRAMING_MARGIN,
  visMin: number = VIS_MIN,
): FramingResult {
  if (!frame) return { ok: false, reason: 'no-pose' }
  for (const i of TRACKED) {
    const lm = frame[i]
    if (!lm || lm.visibility < visMin) return { ok: false, reason: 'low-visibility' }
  }
  for (const i of TRACKED) {
    const lm = frame[i]
    if (lm.x < margin || lm.x > 1 - margin || lm.y < margin || lm.y > 1 - margin) {
      return { ok: false, reason: 'out-of-frame' }
    }
  }
  return { ok: true, reason: 'ok' }
}

/**
 * Average the accepted frames into one rest pose. Frames where any tracked
 * landmark is below visMin are dropped. If nothing survives, return failure
 * rather than dividing by zero. Otherwise every landmark index present is
 * averaged (not just the tracked ones) so downstream code that wants, e.g., the
 * nose still gets a sensible value.
 */
export function averageFrames(frames: Frame[], visMin: number = VIS_MIN): AverageResult {
  const accepted = frames.filter((f) => isFrameUsable(f, visMin))

  // All junk: bail out cleanly so the caller can re-prompt the player instead of
  // building a pose full of NaN from a zero divisor.
  if (accepted.length === 0) {
    return { ok: false, acceptedCount: 0 }
  }

  // Average across the widest frame so a frame that happens to carry extra
  // landmarks does not get truncated.
  const maxLen = accepted.reduce((m, f) => Math.max(m, f.length), 0)
  const pose: Frame = []

  for (let i = 0; i < maxLen; i++) {
    let sumX = 0
    let sumY = 0
    let sumVis = 0
    let count = 0
    for (const f of accepted) {
      const lm = f[i]
      if (!lm) continue // skip frames that lack this index entirely
      sumX += lm.x
      sumY += lm.y
      sumVis += lm.visibility
      count += 1
    }
    // count is always >= 1 here because accepted is non-empty and frames share
    // the same length in practice, but guard anyway so a ragged frame never
    // divides by zero.
    if (count === 0) {
      pose.push({ x: 0, y: 0, visibility: 0 })
    } else {
      pose.push({ x: sumX / count, y: sumY / count, visibility: sumVis / count })
    }
  }

  return { ok: true, pose, acceptedCount: accepted.length }
}

/**
 * Browser-side collector (not unit tested). Samples the live pose loop for a
 * fixed duration, keeping non-null frames, then averages them. getLatestFrame
 * is whatever Step 02 exposes to read the most recent pose; it returns null when
 * no pose is currently tracked. Uses requestAnimationFrame when available so
 * sampling rides the render loop, and falls back to a short interval otherwise.
 */
export async function captureRestPose(
  getLatestFrame: () => Frame | null,
  durationMs: number = 2500,
): Promise<AverageResult> {
  const collected: Frame[] = []
  const start = Date.now()

  const sampleOnce = () => {
    const frame = getLatestFrame()
    if (frame) collected.push(frame)
  }

  // Prefer requestAnimationFrame so we sample in step with rendering; fall back
  // to setInterval in environments (or tests) that lack rAF.
  const hasRaf = typeof requestAnimationFrame === 'function'

  await new Promise<void>((resolve) => {
    if (hasRaf) {
      const tick = () => {
        sampleOnce()
        if (Date.now() - start >= durationMs) {
          resolve()
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    } else {
      const id = setInterval(() => {
        sampleOnce()
        if (Date.now() - start >= durationMs) {
          clearInterval(id)
          resolve()
        }
      }, 16)
    }
  })

  return averageFrames(collected)
}

/**
 * Reduce an averaged rest pose to the three baseline normalizers. All math is
 * plain geometry on normalized coords; remember y grows DOWNWARD, so a raised
 * wrist has a SMALLER y (that is why flap later measures restWristY - wristY).
 *
 * - shoulderWidth: distance between shoulders (11, 12). The scale unit every
 *   spatial measurement is divided by, so it cancels body size and camera
 *   distance. Clamped to a tiny epsilon if degenerate.
 * - restShoulderAngle: atan2 of the shoulder line. ~0 for level shoulders; a
 *   tilted stance gives a signed angle that lean detection subtracts so the
 *   player's natural posture reads as neutral. The mirror flip is NOT applied
 *   here; that sign is fixed once in the lean/flap calibration.
 * - restWristY: mean y of the two wrists (15, 16), the neutral height flap
 *   measures lift from.
 */
export function computeBaseline(pose: Frame): Baseline {
  const l11 = pose[11]
  const r12 = pose[12]
  const l15 = pose[15]
  const r16 = pose[16]

  // Reuse the shared shoulderWidth() so there is exactly one width formula and
  // one divide-by-zero guard. This is the SAME value the old inline math
  // produced (hypot of the shoulder delta, clamped to the epsilon floor), so
  // the calibration tests are unaffected.
  const width = shoulderWidth(pose)

  const restShoulderAngle = Math.atan2(r12.y - l11.y, r12.x - l11.x)

  const restWristY = (l15.y + r16.y) / 2

  return { shoulderWidth: width, restShoulderAngle, restWristY }
}

// ---------------------------------------------------------------------------
// 03.3 Recalibrate: drift detection + central in-memory baseline store
// ---------------------------------------------------------------------------

// How far the player's live on-screen size may drift from the calibrated size
// before we ask them to re-T-pose, expressed as a symmetric RATIO so the check
// is itself scale-aware: 1.3 means "fire once they look ~30% bigger OR ~30%
// smaller than at calibration". Comparing a ratio (not an absolute pixel delta)
// is what keeps a tall player and a short player on the same threshold. Tuned in
// the browser per VERIFY.md; bump it up if the flag feels twitchy.
export const DRIFT_RATIO = 1.3

/**
 * True when the stored baseline no longer matches the player's current apparent
 * size, so every gesture stage's scale normalization would be wrong and the
 * player should recalibrate.
 *
 * Returns true when there is no baseline at all (nothing to normalize against,
 * so the game must calibrate before play) or when the live shoulder width is
 * non-positive (a degenerate / untracked frame). Otherwise it fires only when
 * the live/stored ratio leaves the symmetric [1/DRIFT_RATIO, DRIFT_RATIO] band,
 * so ordinary breathing and sway stay quiet.
 *
 * Pure on purpose: any flicker smoothing (debounce / hysteresis) belongs in the
 * UI that polls this, not in the predicate the tests pin.
 */
export function needsRecalibration(stored: Baseline | null, liveShoulderWidth: number): boolean {
  if (!stored) return true
  if (liveShoulderWidth <= 0) return true
  const r = liveShoulderWidth / stored.shoulderWidth
  return r > DRIFT_RATIO || r < 1 / DRIFT_RATIO
}

// The session's single source of truth for the calibrated baseline. Every later
// gesture stage reads this one store instead of threading a baseline prop
// through the component tree.
//
// Intentionally NOT persisted (no zustand `persist` middleware, no localStorage):
// a fresh page load must start with `baseline === null` so the calibration gate
// re-prompts every session. Camera position, lighting, and where the player sits
// all change between sessions, so a per-session capture is more trustworthy than
// a stale saved one. See KNOWN_ISSUES / the recalibrate-each-reload decision.
export interface CalibrationState {
  baseline: Baseline | null
  /** Replace the stored baseline (last write wins; never merges). */
  setBaseline: (b: Baseline) => void
  /** Drop the baseline back to null (used by tests and a future "log out"). */
  clearBaseline: () => void
}

export const useCalibrationStore = create<CalibrationState>((set) => ({
  baseline: null,
  setBaseline: (b) => set({ baseline: b }),
  clearBaseline: () => set({ baseline: null }),
}))

// Thin non-React accessors so the pose loop, the recalibrate flow, and the unit
// tests can read/write the baseline without mounting React.
export function setBaseline(b: Baseline): void {
  useCalibrationStore.getState().setBaseline(b)
}
export function getBaseline(): Baseline | null {
  return useCalibrationStore.getState().baseline
}

/**
 * Browser-side recalibrate (not unit tested): capture a fresh rest pose and, on
 * success, replace the stored baseline (last write wins). On failure it returns
 * false WITHOUT touching the store, so a botched recapture (player stepped out of
 * frame) never clobbers a good baseline. Callers that want a countdown UI run
 * their own and then write the store; this is the headless tie-together of 03.1
 * capture + 03.2 baseline for code paths that do not need the countdown.
 */
export async function recalibrate(getLatestFrame: () => Frame | null): Promise<boolean> {
  const res = await captureRestPose(getLatestFrame)
  if (!res.ok) return false
  setBaseline(computeBaseline(res.pose))
  return true
}
