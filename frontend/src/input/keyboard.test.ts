import { describe, it, expect } from 'vitest'
import { keysToActions, HOLD_FLAP_STRENGTH } from './keyboard'

// Step 07.2 (pulled forward): dev keyboard fallback so the playground is testable
// without a webcam. Space = flap (climb), A/D = lean left/right, W = dive. The
// pure mapping from held keys to a partial DuckActions is what we test here; the
// event wiring is verified in the browser.
describe('keysToActions', () => {
  it('no keys = neutral', () => {
    const a = keysToActions(new Set())
    expect(a.flap).toBe(0)
    expect(a.lean).toBe(0)
    expect(a.dive).toBe(0)
  })

  it('space flaps (held = Unity hold strength, gentle climb)', () => {
    expect(keysToActions(new Set(['Space'])).flap).toBe(HOLD_FLAP_STRENGTH)
  })

  it('A leans left (negative), D leans right (positive)', () => {
    expect(keysToActions(new Set(['KeyA'])).lean).toBe(-1)
    expect(keysToActions(new Set(['KeyD'])).lean).toBe(1)
  })

  it('W dives', () => {
    expect(keysToActions(new Set(['KeyW'])).dive).toBe(1)
  })

  // ADVERSARIAL: pressing both A and D at once must cancel to 0, not stick to one
  // side or sum past the -1..1 range.
  it('A and D together cancel to zero', () => {
    expect(keysToActions(new Set(['KeyA', 'KeyD'])).lean).toBe(0)
  })

  it('combined keys map independently', () => {
    const a = keysToActions(new Set(['Space', 'KeyD', 'KeyW']))
    expect(a.flap).toBe(HOLD_FLAP_STRENGTH)
    expect(a.lean).toBe(1)
    expect(a.dive).toBe(1)
  })
})
