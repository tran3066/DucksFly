// Synthetic MediaPipe Pose landmarks for tests (plan Step 00.3). This is the
// backbone of every gesture test: pure-logic tests feed fake landmark frames
// through the detectors instead of running a live webcam.
//
// MediaPipe Pose returns 33 landmarks, each { x, y, z, visibility }. x and y are
// normalized 0..1 in image space, y grows DOWNWARD, and the webcam image is
// mirrored (the player's real left appears on the image right).

export interface Landmark {
  x: number
  y: number
  z: number
  visibility: number
}

export type LandmarkFrame = Landmark[] // length 33

// Per-index partial overrides: { 15: { y: 0.1 } } moves only the left wrist's y.
export type Overrides = Partial<Record<number, Partial<Landmark>>>

// A plausible front-facing standing pose. Only the indices Person A uses are
// pinned to realistic spots; the rest fall back to a neutral visible default so
// no math ever hits NaN. Coordinates are mirrored image space (player left =
// image right), shoulders apart so shoulder-width normalization is safe.
const DEFAULT_POSE: Partial<Record<number, Landmark>> = {
  0: { x: 0.5, y: 0.2, z: 0, visibility: 0.99 }, // nose
  11: { x: 0.58, y: 0.35, z: 0, visibility: 0.98 }, // left shoulder (image right)
  12: { x: 0.42, y: 0.35, z: 0, visibility: 0.98 }, // right shoulder
  13: { x: 0.62, y: 0.5, z: 0, visibility: 0.95 }, // left elbow
  14: { x: 0.38, y: 0.5, z: 0, visibility: 0.95 }, // right elbow
  15: { x: 0.64, y: 0.62, z: 0, visibility: 0.92 }, // left wrist
  16: { x: 0.36, y: 0.62, z: 0, visibility: 0.92 }, // right wrist
  23: { x: 0.55, y: 0.62, z: 0, visibility: 0.97 }, // left hip
  24: { x: 0.45, y: 0.62, z: 0, visibility: 0.97 }, // right hip
}

const FILLER: Landmark = { x: 0.5, y: 0.5, z: 0, visibility: 0.5 }

/**
 * Build a 33-landmark frame. Pass overrides to move specific landmarks for a
 * test, e.g. makeLandmarkFrame({ 15: { y: 0.1 } }) to raise the left wrist.
 * Each landmark is a fresh object so a test mutating one cannot poison another.
 */
export function makeLandmarkFrame(overrides: Overrides = {}): LandmarkFrame {
  const frame: LandmarkFrame = []
  for (let i = 0; i < 33; i++) {
    const base = DEFAULT_POSE[i] ?? FILLER
    frame.push({ ...base, ...(overrides[i] ?? {}) })
  }
  return frame
}

/**
 * Convenience for flap tests: raise both wrists (15, 16) by `amount` in
 * normalized units (smaller y = higher, since y grows downward).
 */
export function liftWrists(frame: LandmarkFrame, amount: number): LandmarkFrame {
  const next = frame.map((lm) => ({ ...lm }))
  next[15].y -= amount
  next[16].y -= amount
  return next
}

// ---------------------------------------------------------------------------
// Calibration fixtures (plan Step 03.1 and 03.2). These build clean rest poses
// for the rest-pose-capture and baseline tests. They return full 33-landmark
// frames so they are structurally assignable to calibration's Frame type (which
// only reads { x, y, visibility }; the extra z is harmless).
// ---------------------------------------------------------------------------

// The landmarks calibration's visibility gate cares about: shoulders (11,12),
// elbows (13,14), wrists (15,16), hips (23,24). Kept local so the fixtures and
// the production TRACKED list can drift independently if a test needs it.
const CALIB_TRACKED = [11, 12, 13, 14, 15, 16, 23, 24]

/**
 * A clean rest / T-pose: every one of the 33 landmarks is present and fully
 * visible (visibility 1.0). Shoulders sit level at y=0.40 (left x=0.40, right
 * x=0.60), the wrists reach out to the sides near shoulder height for a T-pose,
 * and the hips sit below. Tests shift individual coords as needed; the absolute
 * numbers only need to be plausible and shiftable.
 */
export function makeRestFrame(): LandmarkFrame {
  // Pin the gameplay-relevant joints to a level, symmetric T-pose. Everything
  // else falls back to a visible filler so no math ever hits a missing index.
  const pinned: Partial<Record<number, Landmark>> = {
    0: { x: 0.5, y: 0.2, z: 0, visibility: 1.0 }, // nose
    11: { x: 0.4, y: 0.4, z: 0, visibility: 1.0 }, // left shoulder
    12: { x: 0.6, y: 0.4, z: 0, visibility: 1.0 }, // right shoulder
    13: { x: 0.25, y: 0.4, z: 0, visibility: 1.0 }, // left elbow (arm out to side)
    14: { x: 0.75, y: 0.4, z: 0, visibility: 1.0 }, // right elbow
    15: { x: 0.1, y: 0.4, z: 0, visibility: 1.0 }, // left wrist (T-pose, shoulder height)
    16: { x: 0.9, y: 0.4, z: 0, visibility: 1.0 }, // right wrist
    23: { x: 0.45, y: 0.7, z: 0, visibility: 1.0 }, // left hip (below shoulders)
    24: { x: 0.55, y: 0.7, z: 0, visibility: 1.0 }, // right hip
  }
  const frame: LandmarkFrame = []
  for (let i = 0; i < 33; i++) {
    frame.push(pinned[i] ?? { x: 0.5, y: 0.5, z: 0, visibility: 1.0 })
  }
  // Fresh objects so a test mutating one landmark cannot poison another frame.
  return frame.map((lm) => ({ ...lm }))
}

/**
 * Same geometry as makeRestFrame, but the tracked landmarks (shoulders, elbows,
 * wrists, hips) are dropped to visibility ~0.1, well below the 0.5 gate. This is
 * the junk frame the averager must reject.
 */
export function makeLowVisFrame(): LandmarkFrame {
  const frame = makeRestFrame()
  for (const i of CALIB_TRACKED) {
    frame[i] = { ...frame[i], visibility: 0.1 }
  }
  return frame
}

// ---------------------------------------------------------------------------
// Flap fixtures (plan Step 04.1 - 04.4). makeFlapSequence builds a run of frames
// where the wrists rise then fall, so the flap detectors see a realistic stroke
// without hand-building every landmark. The whole flap pipeline measures
// NORMALIZED wrist height h = (shoulderY - wristY) / shoulderWidth, so this
// fixture is written to control h directly: it picks a target h per frame, then
// derives the wrist Y that produces that h for the chosen shoulder width. That
// makes the tests' numbers (peak velocity, thresholds) easy to reason about and
// keeps a sequence scale-invariant by construction.
// ---------------------------------------------------------------------------

// The flap pipeline reads these defaults from the standing DEFAULT_POSE above.
// shoulders sit level at y=0.35; the shoulder MIDLINE Y is therefore 0.35. We
// reuse that as the reference height the wrist offset is measured from.
const FLAP_SHOULDER_Y = 0.35
// Default horizontal shoulder separation in DEFAULT_POSE (0.58 - 0.42 = 0.16).
const FLAP_DEFAULT_SHOULDER_WIDTH = 0.16

export interface FlapSequenceOptions {
  // Peak normalized wrist height in body units (h units): how high above the
  // shoulder line the wrists reach at the top of the stroke. 1.0 means "one
  // shoulder width above the shoulders". The 04.2 high threshold is 0.6, so an
  // amplitude above 0.6 crosses it and below 0.6 never arms the detector.
  amplitude?: number
  // Total frames in the stroke. Fewer frames = a sharper, faster stroke = a
  // larger per-frame velocity, which is how 04.3 reads "faster flapping". The
  // stroke is triangular and symmetric, so the peak adjacent step velocity is
  // 2 * amplitude / framesPerStroke.
  framesPerStroke?: number
  // Shoulder width in normalized image units. The fixture moves the shoulder
  // landmarks apart to hit this width AND derives the wrist Y from it, so two
  // sequences at different widths describe the SAME physical flap in body units
  // (this is what makes the 04.1 scale-invariance test pass).
  shoulderWidth?: number
  // Adversarial 04.2 input: after crossing the high threshold on the way up,
  // briefly dip back down and re-rise above high WITHIN the refractory window,
  // to prove one physical flap still yields exactly one impulse.
  wobble?: boolean
  // 04.1 / 04.2 input: rise to the peak and STAY there (no down swing). Used for
  // a monotone-rise buffer feed and for the half-motion "never completes" case.
  partial?: boolean
}

/**
 * Build a list of landmark frames describing one wrist flap: the wrists rise
 * from the shoulder line up to `amplitude` body units and (unless `partial`)
 * fall back to the shoulder line. Each frame is a full 33-landmark frame built
 * on makeLandmarkFrame, with the shoulders spread to `shoulderWidth` and the
 * wrists placed at the Y that yields the intended normalized height.
 *
 * Height trajectory (in body units h):
 *   - rise linearly from 0 to amplitude over the first half of the stroke,
 *   - fall linearly back to 0 over the second half (skipped when `partial`).
 * Triangular on purpose: the steepest adjacent step is a constant
 * 2 * amplitude / framesPerStroke, so peak velocity is predictable and a faster
 * (smaller framesPerStroke) stroke reads strictly higher.
 */
export function makeFlapSequence(opts: FlapSequenceOptions = {}): LandmarkFrame[] {
  const amplitude = opts.amplitude ?? 1.0
  const framesPerStroke = Math.max(2, opts.framesPerStroke ?? 8)
  const shoulderWidth = opts.shoulderWidth ?? FLAP_DEFAULT_SHOULDER_WIDTH
  const wobble = opts.wobble ?? false
  const partial = opts.partial ?? false

  // Half the stroke is the up swing; the rest is the down swing. With an even
  // count the peak lands just before the midpoint, which keeps the rising-edge
  // impulse test (04.2) firing in the first half.
  const upFrames = Math.max(1, Math.floor(framesPerStroke / 2))

  // Heights in body units, one per frame.
  const heights: number[] = []
  for (let i = 0; i < framesPerStroke; i++) {
    let h: number
    if (i <= upFrames) {
      // Up swing: 0 -> amplitude linearly.
      h = amplitude * (i / upFrames)
    } else if (partial) {
      // Partial stroke: hold at the peak instead of coming back down.
      h = amplitude
    } else {
      // Down swing: amplitude -> 0 linearly over the remaining frames.
      const downFrames = framesPerStroke - 1 - upFrames
      const step = i - upFrames
      h = downFrames > 0 ? amplitude * (1 - step / downFrames) : 0
    }
    heights.push(h)
  }

  // Adversarial wobble: take a frame that is already above the high threshold on
  // the up swing, dip it briefly below high, then put it back above high, all
  // within a few frames so it stays inside the refractory window. We splice this
  // in right after the peak so the detector is still armed in HIGH state.
  if (wobble && !partial) {
    const peakIdx = upFrames
    // Insert a small dip-and-rise after the peak: dip to just under the peak but
    // still above the low threshold, then back above high. These never return
    // below the low threshold, so a correct detector must NOT re-fire.
    const dipHigh = Math.max(0, amplitude * 0.55) // briefly lower, still > low (0.2) for amp=1
    const reHigh = amplitude // back up above high
    heights.splice(peakIdx + 1, 0, dipHigh, reHigh)
  }

  // Turn each target height into a full frame.
  return heights.map((h) => {
    // h = (shoulderY - wristY) / shoulderWidth  ->  wristY = shoulderY - h * width.
    const wristY = FLAP_SHOULDER_Y - h * shoulderWidth
    // Spread the shoulders symmetrically about x=0.5 to hit the requested width
    // so the tracker's per-frame shoulderWidth(frame) equals shoulderWidth.
    const half = shoulderWidth / 2
    return makeLandmarkFrame({
      11: { x: 0.5 + half, y: FLAP_SHOULDER_Y }, // left shoulder (image right)
      12: { x: 0.5 - half, y: FLAP_SHOULDER_Y }, // right shoulder
      15: { y: wristY }, // left wrist
      16: { y: wristY }, // right wrist
    })
  })
}

/**
 * Scale every landmark toward the centroid of the tracked landmarks by factor
 * k. k<1 shrinks the pose (simulating the player standing farther from the
 * camera); k=1 is a no-op. Visibility is preserved. Used by the scale-invariance
 * adversarial test in 03.2 to prove baselines normalize body size away.
 */
export function scalePose(pose: LandmarkFrame, k: number): LandmarkFrame {
  // Centroid of the tracked landmarks only, so scaling pivots around the torso.
  let cx = 0
  let cy = 0
  for (const i of CALIB_TRACKED) {
    cx += pose[i].x
    cy += pose[i].y
  }
  cx /= CALIB_TRACKED.length
  cy /= CALIB_TRACKED.length
  return pose.map((lm) => ({
    ...lm,
    x: cx + (lm.x - cx) * k,
    y: cy + (lm.y - cy) * k,
  }))
}
