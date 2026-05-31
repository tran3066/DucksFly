import { describe, it, expect } from 'vitest'
import { config } from './config'

// Step 00.3: config is mostly data, so these tests guard its shape, that the
// A/B-toggle defaults are the documented unions, and that every threshold sits in
// a sane band (a bad default is caught here, not in a confusing gameplay bug).
describe('00.3 config', () => {
  it('defaults exist and are typed', () => {
    expect(config.flapMode).toBe('binary')
    expect(config.turnMode).toBe('lean')
    // The flap tunables (Step 04) exist and are numeric.
    expect(typeof config.flapWindowSize).toBe('number')
    expect(typeof config.flapHighThreshold).toBe('number')
  })

  it('thresholds are in sane ranges', () => {
    expect(config.minConfidence).toBeGreaterThanOrEqual(0)
    expect(config.minConfidence).toBeLessThanOrEqual(1)
    expect(config.minLandmarkVisibility).toBeGreaterThanOrEqual(0)
    expect(config.minLandmarkVisibility).toBeLessThanOrEqual(1)
    expect(config.leanDeadzone).toBeGreaterThanOrEqual(0)
    expect(config.leanMaxAngle).toBeGreaterThan(config.leanDeadzone)
    expect(config.smoothingAlpha).toBeGreaterThanOrEqual(0)
    expect(config.smoothingAlpha).toBeLessThanOrEqual(1)
  })

  // Step 04 flap tunables: the hysteresis must actually be hysteresis (high above
  // low), the window/refractory must be sensible frame counts, and the body-unit
  // thresholds must be finite and roughly within 0..2 (a flap of more than two
  // shoulder widths above the shoulders is not physical).
  it('flap thresholds are sane', () => {
    // Hysteresis: arm-high strictly above disarm-low, or jitter near one line
    // would toggle the flap rapidly.
    expect(config.flapHighThreshold).toBeGreaterThan(config.flapLowThreshold)
    // Body-unit thresholds finite and in a physical band.
    for (const v of [config.flapHighThreshold, config.flapLowThreshold]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(2)
    }
    // Window is an integer of at least 2 (need 2 samples to take a velocity).
    expect(Number.isInteger(config.flapWindowSize)).toBe(true)
    expect(config.flapWindowSize).toBeGreaterThanOrEqual(2)
    // Refractory is a positive integer count of frames.
    expect(Number.isInteger(config.flapRefractoryFrames)).toBe(true)
    expect(config.flapRefractoryFrames).toBeGreaterThan(0)
    // Noise floor is non-negative (a velocity below it is treated as jitter).
    expect(config.flapNoiseEpsilon).toBeGreaterThanOrEqual(0)
    // Rate gain is positive (it scales velocity into intensity).
    expect(config.flapRateGain).toBeGreaterThan(0)
    // Rate decay is a smoothing factor in 0..1.
    expect(config.flapRateDecay).toBeGreaterThanOrEqual(0)
    expect(config.flapRateDecay).toBeLessThanOrEqual(1)
  })

  // ADVERSARIAL: only the allowed mode strings are used (catches a typo like
  // "Binary" that would still be a string but break the strategy switch).
  it('mode unions are exhaustive', () => {
    expect(['binary', 'rate']).toContain(config.flapMode)
    expect(['lean', 'wing']).toContain(config.turnMode)
  })
})
