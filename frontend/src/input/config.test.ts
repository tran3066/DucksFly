import { describe, it, expect } from 'vitest'
import { config } from './config'

// Step 00.3: config is mostly data, so these tests guard its shape, that the
// A/B-toggle defaults are the documented unions, and that every threshold sits in
// a sane band (a bad default is caught here, not in a confusing gameplay bug).
describe('00.3 config', () => {
  it('defaults exist and are typed', () => {
    expect(config.flapMode).toBe('binary')
    expect(config.turnMode).toBe('lean')
    expect(typeof config.flapWristAboveShoulder).toBe('number')
  })

  it('thresholds are in sane ranges', () => {
    expect(config.minConfidence).toBeGreaterThanOrEqual(0)
    expect(config.minConfidence).toBeLessThanOrEqual(1)
    expect(config.minLandmarkVisibility).toBeGreaterThanOrEqual(0)
    expect(config.minLandmarkVisibility).toBeLessThanOrEqual(1)
    expect(config.flapWristAboveShoulder).toBeGreaterThanOrEqual(0)
    expect(config.flapWristAboveShoulder).toBeLessThanOrEqual(1)
    expect(config.flapRefractoryMs).toBeGreaterThan(0)
    expect(config.leanDeadzone).toBeGreaterThanOrEqual(0)
    expect(config.leanMaxAngle).toBeGreaterThan(config.leanDeadzone)
    expect(config.smoothingAlpha).toBeGreaterThanOrEqual(0)
    expect(config.smoothingAlpha).toBeLessThanOrEqual(1)
  })

  // ADVERSARIAL: only the allowed mode strings are used (catches a typo like
  // "Binary" that would still be a string but break the strategy switch).
  it('mode unions are exhaustive', () => {
    expect(['binary', 'rate']).toContain(config.flapMode)
    expect(['lean', 'wing']).toContain(config.turnMode)
  })
})
