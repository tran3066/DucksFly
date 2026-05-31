import { describe, it, expect } from 'vitest'
import { makeLandmarkFrame } from './landmarks'

// Step 00.3: the fixture generator is the backbone of every later gesture test
// (Steps 04+), which feed it fake landmark frames instead of a live webcam. These
// tests prove it yields a usable 33-landmark frame and that overrides are surgical.
describe('00.3 landmark fixtures', () => {
  it('returns 33 landmarks', () => {
    const f = makeLandmarkFrame()
    expect(f).toHaveLength(33)
    for (const lm of f) {
      expect(typeof lm.x).toBe('number')
      expect(typeof lm.y).toBe('number')
      expect(typeof lm.z).toBe('number')
      expect(typeof lm.visibility).toBe('number')
    }
  })

  it('defaults are visible and centered', () => {
    const f = makeLandmarkFrame()
    for (const i of [11, 12, 15, 16]) {
      expect(f[i].visibility).toBeGreaterThanOrEqual(0.5)
      expect(f[i].x).toBeGreaterThanOrEqual(0)
      expect(f[i].x).toBeLessThanOrEqual(1)
      expect(f[i].y).toBeGreaterThanOrEqual(0)
      expect(f[i].y).toBeLessThanOrEqual(1)
    }
  })

  // ADVERSARIAL: an override changes only the targeted field, keeps that
  // landmark's other defaults, and leaves every other landmark untouched.
  it('overrides replace only targeted fields', () => {
    const base = makeLandmarkFrame()
    const f = makeLandmarkFrame({ 15: { y: 0.1 } })
    expect(f[15].y).toBe(0.1)
    expect(f[15].x).toBe(base[15].x) // default x preserved
    expect(f[15].visibility).toBe(base[15].visibility) // default visibility preserved
    expect(f[16]).toEqual(base[16]) // a different landmark is untouched
  })
})
