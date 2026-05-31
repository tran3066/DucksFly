// The DuckActions contract: the per-frame command Person A's input pipeline
// sends to Person C's physics. This is the single source of truth for the A<->C
// boundary (plan Step 00.2).
//
// Design note (issue I-0002): Person C already defined the DuckActions interface
// in frontend/src/physics/types.ts, and the playground + physics import it from
// there. To avoid a second, drifting copy, this shared module RE-EXPORTS that one
// type rather than redefining it. It adds makeIdleActions(), which Person C's
// module does not provide.
//
// Location note: the plan called for repo-root shared/types/, but the frontend
// tsconfig only includes "src" and the backend is not scaffolded yet, so forcing
// a cross-boundary path now is pure friction. This lives under src/shared/ so the
// toolchain (tsc, vitest, imports) just works. Hoist to a real shared package
// when the server needs it.

export type { DuckActions } from '../../physics/types'
import type { DuckActions } from '../../physics/types'

/**
 * The safe neutral frame: emitted before calibration, on low tracking
 * confidence, or when no body is detected, so the duck idles instead of
 * spasming. confidence is 0 (do not trust this frame).
 *
 * Distinct from physics/config.ts neutralActions(), which uses confidence:1 as a
 * "trusted neutral" default for the physics sandbox. Person A's idle frame must
 * be confidence:0 so downstream smoothing/gating treats it as "no input".
 *
 * Returns a NEW object each call so callers may mutate their copy without
 * poisoning the next frame.
 */
export function makeIdleActions(): DuckActions {
  return {
    flap: 0,
    flapImpulse: false,
    lean: 0,
    dive: 0,
    quack: false,
    egg67: false,
    confidence: 0,
  }
}
