// Dev keyboard fallback (plan Step 07.2, pulled forward so the playground is
// playable without a webcam). Maps the keys currently held down to a partial
// DuckActions. The webcam pipeline (Steps 01-07) will later feed the same
// actionsRef; this is the manual stand-in.
//
// Controls: Space = flap (climb), A = lean left, D = lean right, W = dive.
// Not flapping just lets gravity pull the duck down (handled by physics).

import { useEffect, useRef } from 'react'

export interface KeyActions {
  flap: number // 0..1
  lean: number // -1 left .. +1 right
  dive: number // 0..1
}

const TRACKED = new Set(['Space', 'KeyA', 'KeyD', 'KeyW'])

// Held-space sustained flap strength. With the flight defaults (lift 34, gravity
// 12) a held value of 0.9 gives ~31 lift vs 12 gravity = a strong, fast climb
// while held; releasing drops back to a descent -- "flap to fly up, glide to
// sink". A tap also fires a one-shot impulse kick via onImpulse.
export const HOLD_FLAP_STRENGTH = 0.9

/**
 * Pure: held key codes -> control values. A and D cancel when both held.
 */
export function keysToActions(keys: Set<string>): KeyActions {
  const flap = keys.has('Space') ? HOLD_FLAP_STRENGTH : 0
  const dive = keys.has('KeyW') ? 1 : 0
  const lean = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
  return { flap, lean, dive }
}

/**
 * Listen for key presses while `enabled` and expose the current control values
 * through a ref the sim loop can read each frame (no React re-renders). Space is
 * also a one-shot flap impulse via `onImpulse` (rising edge), so a tap gives a
 * climb beat.
 *
 * The hook OWNS the output ref and returns it (rather than taking one as an
 * argument), so writing to it inside the effect is the hook mutating its own
 * state, which the react-hooks rules allow.
 */
export function useKeyboardControls(
  enabled: boolean,
  onImpulse?: () => void,
): React.RefObject<KeyActions> {
  const out = useRef<KeyActions>({ flap: 0, lean: 0, dive: 0 })

  useEffect(() => {
    // Held-keys set is local to this effect (created on mount, discarded on
    // cleanup). The sim loop never reads it directly; it reads `out`.
    const held = new Set<string>()

    if (!enabled) {
      out.current = { flap: 0, lean: 0, dive: 0 }
      return
    }

    const apply = () => {
      out.current = keysToActions(held)
    }

    const down = (e: KeyboardEvent) => {
      if (!TRACKED.has(e.code)) return
      e.preventDefault()
      const wasHeld = held.has(e.code)
      held.add(e.code)
      if (e.code === 'Space' && !wasHeld) onImpulse?.() // rising edge = one flap beat
      apply()
    }
    const up = (e: KeyboardEvent) => {
      if (!TRACKED.has(e.code)) return
      held.delete(e.code)
      apply()
    }
    const blur = () => {
      held.clear()
      apply()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [enabled, onImpulse])

  return out
}
