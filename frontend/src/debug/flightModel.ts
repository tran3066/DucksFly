// Playground flight model: a faithful TypeScript port of the Unity prototype's
// FlightPhysicsController (shq26/DucksFly Unity Prototype v1). It is an INFINITE
// RUNNER with heading LOCKED at +Z: leaning does not turn, it strafes laterally
// (vLateral = lateralSpeedAtMaxBank * sin(roll)), held flap lifts, no flap = a
// gentle gravity descent, a flapImpulse adds a wingbeat kick, W dives.
//
// This lives in src/debug and is used ONLY by the Person A playground so the test
// bed matches the prototype the user tuned. Person C's src/physics/step.ts (yaw-
// turning model) is untouched and still drives his own sandbox.
//
// Reuses the DuckState / DuckActions shapes so the Duck, HUD, and camera need no
// changes. yaw stays 0 forever (heading locked); roll is the visual bank.

import type { DuckActions, DuckState } from '../physics'

export interface FlightConfig {
  // Forward (always +Z)
  baseForwardSpeed: number
  forwardResponse: number
  flapForwardGain: number // forward boost at flap=1 (swing -> gain velocity)
  diveAccel: number // forward boost at dive=1 (W -> gain velocity)
  // Vertical
  gravity: number
  liftMultiplier: number
  impulseGain: number
  verticalDrag: number
  maxClimbSpeed: number
  maxDescentSpeed: number
  diveSink: number // extra downward velocity at dive=1
  // Banking -> lateral strafe + visual roll
  maxRollDeg: number
  rollResponse: number
  lateralSpeedAtMaxBank: number
  lateralResponse: number
  lateralRange: number // soft world-X clamp (0 = unlimited)
  // Pitch (visual body lean). Positive pitch = nose DOWN, negative = nose UP.
  pitchFromVy: number // climb -> nose up only; passive sink stays level (neutral glides flat, never nose-dives)
  flapPitchDeg: number // extra nose-UP while flapping (lean up on swing)
  divePitchDeg: number // extra nose-DOWN while diving (lean toward the ground)
  maxPitchDeg: number
  pitchResponse: number
  // Altitude bounds
  minAltitude: number
  maxAltitude: number // invisible ceiling (no roof drawn) so the duck can't fly too high
  fixedDt: number
}

// Defaults match the Unity prototype's serialized values (FlightPhysicsController
// + KeyboardFallbackInput), so the web playground feels like the Unity game out of
// the box. Two deliberate deviations, both requested:
//   - lateralRange 75 (Unity 25 x3) for a 3x-wider track
//   - lateralSpeedAtMaxBank 18 (Unity 10) so the wider track is still crossable
//   - diveAccel / diveSink are web additions (Unity had no dive: W = descend +
//     gain forward speed)
// Every value is a live leva slider under the debug toggle, so this is just the
// playable starting point to tune from.
export const DEFAULT_FLIGHT: FlightConfig = {
  baseForwardSpeed: 12, // base cruise velocity (always moving forward)
  forwardResponse: 2,
  flapForwardGain: 10, // swing -> gain velocity (arcade feel, deviates from Unity's energy-trade)
  diveAccel: 22, // W -> gain velocity diving toward the ground
  gravity: 14, // Unity
  liftMultiplier: 34, // strong lift so a swing climbs FAST (held flap 0.9 -> ~30 lift vs 14 gravity)
  impulseGain: 4, // per-tap wingbeat kick
  verticalDrag: 0.9, // Unity
  maxClimbSpeed: 16, // raised so the fast climb is not capped early
  maxDescentSpeed: 14, // Unity
  diveSink: 12, // web: extra descent at dive=1 (W)
  maxRollDeg: 45, // Unity
  rollResponse: 6, // Unity
  lateralSpeedAtMaxBank: 18, // Unity 10, bumped for the 3x-wide track
  lateralResponse: 6, // Unity
  lateralRange: 75, // Unity 25 x3 (wider track)
  pitchFromVy: 0.06, // base climb/sink coupling
  flapPitchDeg: 28, // strong nose-up lean while swinging (looks like flying up)
  divePitchDeg: 35, // strong nose-down lean toward the ground while diving
  maxPitchDeg: 55, // allow the steeper climb + dive leans
  pitchResponse: 6, // a touch snappier so the lean reads immediately on a swing
  minAltitude: 2, // Unity floor
  maxAltitude: 2000, // effectively "into the sky" (recycling wall marks feel infinite)
  fixedDt: 1 / 60,
}

export function createFlightState(): DuckState {
  return {
    position: [0, 40, 0],
    yaw: 0, // heading locked forever
    speed: DEFAULT_FLIGHT.baseForwardSpeed,
    pitch: 0,
    roll: 0,
    verticalVel: 0,
    distance: 0,
    _flap: 0,
    _lean: 0,
    _dive: 0,
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const DEG = Math.PI / 180

// Frame-rate-independent exponential approach (Unity's ExpLerp).
function expLerp(a: number, b: number, rate: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-rate * dt))
}

/**
 * Advance one fixed step of the Unity-style flight. Pure: returns a new state.
 * `flapImpulse` true delivers a one-shot wingbeat kick this step.
 */
export function flightStep(
  state: DuckState,
  actions: DuckActions,
  cfg: FlightConfig,
  dt: number = cfg.fixedDt,
): DuckState {
  const conf = clamp(actions.confidence, 0, 1)
  const flap = clamp(actions.flap, 0, 1) * conf
  const lean = clamp(actions.lean, -1, 1) * conf
  const dive = clamp(actions.dive, 0, 1) * conf

  // Bank: lean -> visual roll. Positive lean (right) -> positive roll -> +X drift.
  const rollTarget = lean * cfg.maxRollDeg * DEG
  const roll = expLerp(state.roll, rollTarget, cfg.rollResponse, dt)

  // Lateral world-X velocity from bank (strafe; heading stays +Z).
  // NEGATED for screen direction: the camera looks down +Z, so in three.js's
  // right-handed space world +X appears on the LEFT of screen. Negating makes a
  // RIGHT lean (+1) move the duck to world -X = screen RIGHT, as expected.
  const vLatTarget = -cfg.lateralSpeedAtMaxBank * Math.sin(roll)
  // store lateral in _lean slot's sibling; we track it on the fly via position
  const vLateral = expLerp(state._lean, vLatTarget, cfg.lateralResponse, dt)

  // Vertical: sustained lift vs gravity vs drag, plus dive sink.
  const liftSustained = cfg.liftMultiplier * flap
  let vY = state.verticalVel
  vY += (liftSustained - cfg.gravity - cfg.verticalDrag * vY) * dt
  if (actions.flapImpulse) vY += cfg.impulseGain
  vY -= dive * cfg.diveSink * dt
  vY = clamp(vY, -cfg.maxDescentSpeed, cfg.maxClimbSpeed)

  // Forward: cruise at base, and BOTH swinging and diving add velocity (arcade
  // feel the user wants -- swing -> gain speed, dive -> gain speed).
  const forwardTarget = cfg.baseForwardSpeed + flap * cfg.flapForwardGain + dive * cfg.diveAccel
  const speed = expLerp(state.speed, forwardTarget, cfg.forwardResponse, dt)

  // Integrate position. Heading locked: forward is always +Z.
  let x = state.position[0] + vLateral * dt
  let y = state.position[1] + vY * dt
  const z = state.position[2] + speed * dt

  // Soft lateral clamp.
  let vLatOut = vLateral
  if (cfg.lateralRange > 0 && Math.abs(x) > cfg.lateralRange) {
    x = Math.sign(x) * cfg.lateralRange
    if (Math.sign(vLatOut) === Math.sign(x)) vLatOut = 0
  }
  // Floor + ceiling clamp.
  if (y < cfg.minAltitude) {
    y = cfg.minAltitude
    if (vY < 0) vY = 0
  } else if (y > cfg.maxAltitude) {
    y = cfg.maxAltitude
    if (vY > 0) vY = 0
  }

  // Visual body lean (positive = nose down, negative = nose up):
  //   - vY coupling is nose-UP ONLY (Math.max(vY,0)): climbing tips the nose up,
  //     but passive sinking does NOT tip it down, so doing nothing glides level.
  //   - flap adds a nose-UP lean (the duck leans up as it powers a swing)
  //   - dive (W) is the ONLY source of nose-DOWN, leaning toward the ground.
  const pitchTarget = clamp(
    -cfg.pitchFromVy * Math.max(vY, 0) - flap * cfg.flapPitchDeg * DEG + dive * cfg.divePitchDeg * DEG,
    -cfg.maxPitchDeg * DEG,
    cfg.maxPitchDeg * DEG,
  )
  const pitch = expLerp(state.pitch, pitchTarget, cfg.pitchResponse, dt)

  return {
    position: [x, y, z],
    yaw: 0,
    speed,
    pitch,
    roll,
    verticalVel: vY,
    distance: state.distance + speed * dt,
    _flap: flap,
    _lean: vLatOut, // reuse slot to carry lateral velocity between steps
    _dive: dive,
  }
}
