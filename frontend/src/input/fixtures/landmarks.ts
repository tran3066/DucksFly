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
