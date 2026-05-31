// Person A input config: the A/B-test toggles and the tunable thresholds every
// gesture step reads (plan Step 00.3). Locking this shape now means later steps
// just add fields and tune numbers instead of churning structure.
//
// Distinct from frontend/src/physics/config.ts (Person C's flight constants).
// This file is about turning the body into DuckActions; that one is about turning
// DuckActions into motion.

export type FlapMode = 'binary' | 'rate' // binary: wrist crosses a line; rate: flap = stroke speed
export type TurnMode = 'lean' | 'wing' // lean: torso tilt; wing: arm height difference

export interface Config {
  // A/B toggles (decided by playtest; build both paths).
  flapMode: FlapMode
  turnMode: TurnMode

  // Tracking gate.
  minConfidence: number // 0..1, below this emit makeIdleActions()
  minLandmarkVisibility: number // 0..1, a landmark below this is "not seen"

  // Flap (Step 04). All heights/velocities below are in BODY UNITS (the live
  // wrist offset divided by the current frame's shoulder width), so they mean
  // the same thing for a near player and a far player. The binary path is a
  // hysteresis state machine (high arms, low disarms) debounced by a frame
  // refractory; the rate path maps peak velocity to a 0..1 intensity. These
  // replace the older flapWristAboveShoulder / flapRefractoryMs pair: the
  // high/low hysteresis subsumes a single "above shoulder" line, and a frame
  // count (deterministic in tests, fps-independent for our 30fps loop) subsumes
  // the millisecond refractory.
  flapWindowSize: number // 04.1, ring-buffer length in frames (~0.25s at 30fps)
  flapNoiseEpsilon: number // 04.1/04.3, body units/frame jitter floor; below this is not a flap
  flapHighThreshold: number // 04.2, body units; wrists this far above shoulders ARM a flap
  flapLowThreshold: number // 04.2, body units; wrists must fall back below this to re-arm
  flapRefractoryFrames: number // 04.2, frames a fired flap stays locked so one stroke = one impulse
  flapRateGain: number // 04.3, maps body-units/frame peak velocity to 0..1 intensity
  flapRateDecay: number // 04.3, per-frame smoothing toward target intensity, 0..1

  // Lean / turn (Step 05). Angles in radians from the shoulder-line tilt.
  leanDeadzone: number // radians, ignore tiny tilts so a level torso reads lean = 0
  leanMaxAngle: number // radians, tilt that maps to lean = +/-1 (clamp beyond)

  // Smoothing (Step 06).
  smoothingAlpha: number // 0..1 EMA factor, higher = snappier, lower = smoother
}

export const config: Config = {
  flapMode: 'binary',
  turnMode: 'lean',

  minConfidence: 0.4,
  minLandmarkVisibility: 0.5,

  flapWindowSize: 8,
  flapNoiseEpsilon: 0.03,
  flapHighThreshold: 0.6,
  flapLowThreshold: 0.2,
  flapRefractoryFrames: 6,
  flapRateGain: 1.5,
  flapRateDecay: 0.3,

  leanDeadzone: 0.08, // ~4.5 degrees
  leanMaxAngle: 0.5, // ~28 degrees -> full turn
  smoothingAlpha: 0.35,
}
