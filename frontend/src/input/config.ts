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

  // Flap (Step 04). Distances are normalized by shoulder width.
  flapWristAboveShoulder: number // 0..1, how far above the shoulder a wrist must rise to count as "up"
  flapRefractoryMs: number // ms, min gap between flapImpulse beats so jitter cannot machine-gun

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

  flapWristAboveShoulder: 0.15,
  flapRefractoryMs: 250,

  leanDeadzone: 0.08, // ~4.5 degrees
  leanMaxAngle: 0.5, // ~28 degrees -> full turn
  smoothingAlpha: 0.35,
}
