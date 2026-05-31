// Infer a remote duck's animation intent from the only data the server syncs:
// velocity + orientation (docs: backend sends pos/vel/quat, never flap/lean/dive).
//
// Remote ducks reuse the SAME `avatar/Duck` component as the local player; that
// component animates from a `DuckActions` ref. The local player feeds it REAL
// input — a remote has none, so we reconstruct a plausible `DuckActions` here:
//   - climbing (vel.y > 0)      -> flap   (wings beating to gain height)
//   - sinking  (vel.y < 0)      -> dive   (wings tucked, nose down)
//   - banking  (roll from quat) -> lean   (turn clip + body roll)
//
// Pure + framework-agnostic (only the math helpers from three) so it is unit
// testable. Orientation itself is applied to the duck's group quaternion
// directly; this only drives the WING/BODY animation clip + eased pose.

import { Euler, Quaternion } from 'three'
import { DEFAULT_FLIGHT } from './flight'
import type { DuckActions } from '../physics'

export interface InferInput {
  x: number
  y: number
  z: number
}
export interface InferQuat {
  x: number
  y: number
  z: number
  w: number
}

// Vertical speed (u/s) mapped to a full flap or full dive. Roughly the model's
// max climb/descent rate, so a duck near terminal climb reads as flap≈1.
const VERTICAL_FULL = 12
// Gentle passive sink that should NOT read as an aggressive dive (the model
// drifts down a little even while gliding level).
const SINK_DEADZONE = 2

const _euler = new Euler()
const _quat = new Quaternion()
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** Roll (radians) extracted from a synced quaternion, using the duck's YXZ order. */
export function rollFromQuat(q: InferQuat): number {
  _quat.set(q.x, q.y, q.z, q.w)
  _euler.setFromQuaternion(_quat, 'YXZ')
  return _euler.z
}

/**
 * Reconstruct a remote duck's `DuckActions` from its synced velocity + quaternion.
 * Returns a fresh object each call (safe to store in a per-duck ref).
 */
export function inferActions(vel: InferInput, quat: InferQuat): DuckActions {
  const flap = clamp(vel.y / VERTICAL_FULL, 0, 1)
  const dive = clamp((-vel.y - SINK_DEADZONE) / VERTICAL_FULL, 0, 1)

  const maxRollRad = (DEFAULT_FLIGHT.maxRollDeg * Math.PI) / 180
  const lean = maxRollRad > 0 ? clamp(rollFromQuat(quat) / maxRollRad, -1, 1) : 0

  return {
    flap,
    flapImpulse: false,
    lean,
    dive,
    quack: false,
    egg67: false,
    confidence: 1,
  }
}
