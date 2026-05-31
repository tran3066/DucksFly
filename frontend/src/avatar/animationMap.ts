// Pure mapper: DuckActions -> animation clip name. (Person A, Step 08.2)
//
// This is intentionally a pure function with no three.js or React imports so it
// can be unit-tested with synthetic DuckActions (see the plan's 08.2 TESTS.md).
// It decides WHICH clip should play for a given frame of player intent; the
// crossfading and playback live in Duck.tsx.

import type { DuckActions } from '../physics'

// The clip names that exist in frontend/public/models/duck/animations.json.
// Keep this union in sync with that file; the guard test in 08.1 checks it.
export type ClipName =
  | 'flight_straight'
  | 'flight_turn_left'
  | 'flight_turn_right'
  | 'glide_straight'
  | 'glide_turn_left'
  | 'glide_turn_right'
  | 'hover_flight'
  | 'idle_1'

// Tunables for the mapping. Exposed so the playground can tweak by feel.
export interface AnimMapConfig {
  /** flap above this counts as "actively flapping" (flight vs glide). */
  flapActiveThreshold: number
  /** |lean| above this counts as "turning" (turn clip vs straight). */
  turnThreshold: number
  /** dive above this counts as "diving" (wings to body -> glide pose). */
  diveThreshold: number
  /** confidence below this falls back to a calm idle/hover. */
  minConfidence: number
}

export const DEFAULT_ANIM_MAP: AnimMapConfig = {
  flapActiveThreshold: 0.15,
  turnThreshold: 0.3,
  diveThreshold: 0.3,
  minConfidence: 0.4,
}

/**
 * Pick the clip for one frame of intent.
 *
 * Rules (airborne race feel):
 *  - very low tracking confidence -> hover_flight (calm, no thrash)
 *  - diving                       -> glide_* (wings NOT flapping; closest the
 *                                    asset has to "wings tucked to the body" --
 *                                    there is no dedicated dive/tuck clip)
 *  - actively flapping            -> flight_* (turn left/right or straight)
 *  - not flapping (gliding)       -> glide_* (turn left/right or straight)
 *
 * lean < 0 means the player leaned LEFT.
 */
export function pickClip(
  a: DuckActions,
  cfg: AnimMapConfig = DEFAULT_ANIM_MAP,
): ClipName {
  if (a.confidence < cfg.minConfidence) return 'hover_flight'

  const turning = Math.abs(a.lean) > cfg.turnThreshold
  const left = a.lean < 0
  const diving = a.dive > cfg.diveThreshold
  const flapping = a.flap > cfg.flapActiveThreshold

  // Diving wins over flapping: wings come in (glide pose), no flapping.
  if (diving) {
    if (turning) return left ? 'glide_turn_left' : 'glide_turn_right'
    return 'glide_straight'
  }
  if (flapping) {
    if (turning) return left ? 'flight_turn_left' : 'flight_turn_right'
    return 'flight_straight'
  }
  if (turning) return left ? 'glide_turn_left' : 'glide_turn_right'
  return 'glide_straight'
}
