import { describe, it, expect } from 'vitest'
import { makeIdleActions } from './duckActions'

// Step 00.2: guards the DuckActions contract shape and the idle defaults. The
// contract has no math, so these tests pin the shape, the safe defaults, the
// field types, and that each call returns a fresh (non-shared) object.
describe('00.2 DuckActions contract', () => {
  it('idle is fully neutral', () => {
    expect(makeIdleActions()).toEqual({
      flap: 0,
      flapImpulse: false,
      lean: 0,
      dive: 0,
      quack: false,
      egg67: false,
      confidence: 0,
    })
  })

  it('all seven keys present', () => {
    expect(Object.keys(makeIdleActions()).sort()).toEqual([
      'confidence',
      'dive',
      'egg67',
      'flap',
      'flapImpulse',
      'lean',
      'quack',
    ])
  })

  it('field types match the contract', () => {
    const a = makeIdleActions()
    expect(typeof a.flap).toBe('number')
    expect(typeof a.lean).toBe('number')
    expect(typeof a.dive).toBe('number')
    expect(typeof a.confidence).toBe('number')
    expect(typeof a.flapImpulse).toBe('boolean')
    expect(typeof a.quack).toBe('boolean')
    expect(typeof a.egg67).toBe('boolean')
  })

  // ADVERSARIAL / edge case: no shared mutable singleton. Mutating one result
  // must not poison the next frame's idle object.
  it('fresh object each call', () => {
    const a = makeIdleActions()
    const b = makeIdleActions()
    expect(a).not.toBe(b)
    a.flap = 1
    expect(b.flap).toBe(0)
  })
})
