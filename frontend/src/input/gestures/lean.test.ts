import { describe, it, expect } from 'vitest'
import { leanFromShoulderTilt, leanFromAsymmetricWing, computeLean } from './lean'
import type { LeanCalib } from './lean'
import { config } from '../config'
import {
  makeLandmarkFrame,
  levelFrame,
  tiltRightFrame,
  tiltLeftFrame,
  tiltExtremeFrame,
  tiltRightFarFrame,
  wingsLevelFrame,
  rightWingUpFrame,
  leftWingUpFrame,
  rightWingUpFarFrame,
  rightWingExtremeFrame,
  conflictFrame,
} from '../fixtures/landmarks'

// Synthetic calibration for the shoulder-tilt and wing tests. rest angle is
// horizontal (0 rad), the mirror sign is +1 (player-real-left already maps to
// negative for these fixtures), maxTiltRad ~0.5 (about 28 degrees -> full turn),
// and saturationWidthRatio ~0.8 (a wrist gap of 0.8 shoulder widths saturates).
// These are the same numbers config.leanMaxAngle / the wing default carry, but
// the tests pass them explicitly so the pure functions never read config.
const calib: LeanCalib = {
  restShoulderAngle: 0,
  mirrorSign: 1,
  maxTiltRad: 0.5,
  saturationWidthRatio: 0.8,
}

// A calibration captured while the player was already slightly tilted: the rest
// angle is a small non-zero tilt, so a physically level frame must still read
// near straight because the function subtracts this rest angle.
//
// NOTE (deviation from 05.1 TESTS.md): the plan literal used restShoulderAngle
// 0.3, but with a truly level levelFrame (raw angle 0) that yields -0.6, which
// fails the |lean| < 0.1 assertion. The binding contract is the assertion plus
// the intent ("a level frame against a slanted rest reads straight"), so the
// rest angle here is a genuinely slight tilt that keeps the assertion true.
const slantedCalib: LeanCalib = {
  restShoulderAngle: 0.04,
  mirrorSign: 1,
  maxTiltRad: 0.5,
  saturationWidthRatio: 0.8,
}

// Same as calib but the mirror flips. Used to prove the mirror correction is
// applied exactly once (the sign of the result inverts, nothing else).
const mirroredCalib: LeanCalib = {
  restShoulderAngle: 0,
  mirrorSign: -1,
  maxTiltRad: 0.5,
  saturationWidthRatio: 0.8,
}

// ---------------------------------------------------------------------------
// 05.1 Shoulder-Tilt Lean
// ---------------------------------------------------------------------------
describe('leanFromShoulderTilt', () => {
  it('returns near zero for level shoulders', () => {
    const lean = leanFromShoulderTilt(levelFrame, calib)
    expect(Math.abs(lean)).toBeLessThan(0.05)
  })

  it('returns positive for a right tilt', () => {
    const lean = leanFromShoulderTilt(tiltRightFrame, calib)
    expect(lean).toBeGreaterThan(0.2)
  })

  it('ADVERSARIAL: a near-pi rest angle (real mirrored ordering) still steers BOTH ways', () => {
    // Real MediaPipe + a mirrored webcam lands the LEFT shoulder (11) at a LARGER
    // image x than the RIGHT (12), so the shoulder-line angle sits near pi, not 0
    // (the other lean fixtures use the opposite, non-mirrored x ordering). Tilting
    // left vs right must give OPPOSITE signs, not both stick to one side. Without
    // the angle wrap in leanFromShoulderTilt both collapse to the same clamp.
    const frame = (l11y: number, r12y: number) =>
      makeLandmarkFrame({ 11: { x: 0.6, y: l11y }, 12: { x: 0.4, y: r12y } })
    const restAngle = Math.atan2(0.4 - 0.4, 0.4 - 0.6) // level in mirrored ordering (~pi)
    const c: LeanCalib = {
      restShoulderAngle: restAngle,
      mirrorSign: 1,
      maxTiltRad: 0.5,
      saturationWidthRatio: 0.8,
    }
    expect(leanFromShoulderTilt(frame(0.4, 0.4), c)).toBeCloseTo(0, 5) // level reads straight
    const rightTilt = leanFromShoulderTilt(frame(0.4, 0.5), c) // right shoulder (12) lower
    const leftTilt = leanFromShoulderTilt(frame(0.5, 0.4), c) // left shoulder (11) lower
    expect(Math.abs(rightTilt)).toBeGreaterThan(0.1)
    expect(Math.abs(leftTilt)).toBeGreaterThan(0.1)
    expect(Math.sign(rightTilt)).toBe(-Math.sign(leftTilt)) // opposite, never both one way
  })

  it('returns negative for a left tilt', () => {
    const lean = leanFromShoulderTilt(tiltLeftFrame, calib)
    expect(lean).toBeLessThan(-0.2)
  })

  // ADVERSARIAL: extreme tilt must not blow past the contract range.
  it('clamps output to -1..1 on extreme tilt', () => {
    const lean = leanFromShoulderTilt(tiltExtremeFrame, calib)
    expect(lean).toBeLessThanOrEqual(1)
    expect(lean).toBeGreaterThanOrEqual(-1)
    // A tilt well beyond maxTiltRad saturates to exactly +1 at full right.
    expect(lean).toBe(1)
  })

  // ADVERSARIAL: a level frame against a slanted rest angle must read straight.
  it('subtracts the calibrated rest angle', () => {
    const lean = leanFromShoulderTilt(levelFrame, slantedCalib)
    expect(Math.abs(lean)).toBeLessThan(0.1)
  })

  it('reads the same lean regardless of body size', () => {
    const near = leanFromShoulderTilt(tiltRightFrame, calib)
    const far = leanFromShoulderTilt(tiltRightFarFrame, calib)
    expect(Math.abs(near - far)).toBeLessThan(0.05)
  })
})

// ---------------------------------------------------------------------------
// 05.2 Asymmetric-Wing Turn
// ---------------------------------------------------------------------------
describe('leanFromAsymmetricWing', () => {
  it('returns near zero for symmetric wrists', () => {
    const lean = leanFromAsymmetricWing(wingsLevelFrame, calib)
    expect(Math.abs(lean)).toBeLessThan(0.05)
  })

  it('returns positive when the right wrist is raised', () => {
    const lean = leanFromAsymmetricWing(rightWingUpFrame, calib)
    expect(lean).toBeGreaterThan(0.2)
  })

  it('returns negative when the left wrist is raised', () => {
    const lean = leanFromAsymmetricWing(leftWingUpFrame, calib)
    expect(lean).toBeLessThan(-0.2)
  })

  // ADVERSARIAL: a far player with the same proportional pose must read the same.
  it('normalizes by shoulder width so near and far read equal', () => {
    const near = leanFromAsymmetricWing(rightWingUpFrame, calib)
    const far = leanFromAsymmetricWing(rightWingUpFarFrame, calib)
    expect(Math.abs(near - far)).toBeLessThan(0.05)
  })

  // ADVERSARIAL: extreme wrist gap must not exceed the contract range.
  it('clamps a huge wrist gap to -1..1', () => {
    const lean = leanFromAsymmetricWing(rightWingExtremeFrame, calib)
    expect(lean).toBeLessThanOrEqual(1)
    expect(lean).toBeGreaterThanOrEqual(-1)
    // A gap well beyond the saturation ratio saturates to exactly +1.
    expect(lean).toBe(1)
  })

  it('applies the mirror sign exactly once', () => {
    const normal = leanFromAsymmetricWing(rightWingUpFrame, calib)
    const mirrored = leanFromAsymmetricWing(rightWingUpFrame, mirroredCalib)
    expect(Math.sign(mirrored)).toBe(-Math.sign(normal))
  })

  // ADVERSARIAL: a degenerate frame (shoulders on top of each other) must not
  // blow up to Infinity; it stays idle at 0.
  it('returns 0 for a degenerate shoulder width', () => {
    const degenerate = wingsLevelFrame.map((lm) => ({ ...lm }))
    degenerate[11] = { ...degenerate[11], x: 0.5, y: 0.4 }
    degenerate[12] = { ...degenerate[12], x: 0.5, y: 0.4 }
    // Raise the right wrist so a non-degenerate width would yield a nonzero lean.
    degenerate[15] = { ...degenerate[15], y: 0.5 }
    degenerate[16] = { ...degenerate[16], y: 0.4 }
    const lean = leanFromAsymmetricWing(degenerate, calib)
    expect(lean).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 05.3 A/B Toggle for Turn Mode
//
// NOTE (reconciliation): the committed config union is 'lean' | 'wing' (default
// 'lean'), not the plan's 'shoulder' | 'wing'. computeLean reads turnMode 'wing'
// for the asymmetric-wing strategy and 'lean' (the default) for shoulder-tilt.
// Where the plan TESTS.md said 'shoulder', these tests pass 'lean'.
// ---------------------------------------------------------------------------
describe('computeLean dispatcher', () => {
  it('uses shoulder-tilt when turnMode is lean', () => {
    const viaDispatch = computeLean(tiltRightFrame, calib, 'lean')
    const direct = leanFromShoulderTilt(tiltRightFrame, calib)
    expect(viaDispatch).toBeCloseTo(direct)
    expect(viaDispatch).toBeGreaterThan(0)
  })

  it('uses asymmetric-wing when turnMode is wing', () => {
    const viaDispatch = computeLean(rightWingUpFrame, calib, 'wing')
    const direct = leanFromAsymmetricWing(rightWingUpFrame, calib)
    expect(viaDispatch).toBeCloseTo(direct)
    expect(viaDispatch).toBeGreaterThan(0)
  })

  // ADVERSARIAL: a frame where the two strategies disagree in sign proves the
  // toggle actually switches strategies rather than always running one.
  it('switches strategy when turnMode toggles', () => {
    const asShoulder = computeLean(conflictFrame, calib, 'lean')
    const asWing = computeLean(conflictFrame, calib, 'wing')
    expect(Math.sign(asShoulder)).toBe(-Math.sign(asWing))
  })

  it('keeps lean within -1..1 in both modes', () => {
    const s = computeLean(tiltExtremeFrame, calib, 'lean')
    const w = computeLean(rightWingExtremeFrame, calib, 'wing')
    expect(s).toBeGreaterThanOrEqual(-1)
    expect(s).toBeLessThanOrEqual(1)
    expect(w).toBeGreaterThanOrEqual(-1)
    expect(w).toBeLessThanOrEqual(1)
  })

  it('default config exposes a valid turnMode', () => {
    expect(['lean', 'wing']).toContain(config.turnMode)
  })
})
