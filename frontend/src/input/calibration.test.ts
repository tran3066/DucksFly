// Tests for calibration (Person A, Step 03.1 rest-pose capture + 03.2 baselines).
//
// Pure logic only: we feed synthetic landmark frames from fixtures/landmarks.ts
// through the calibration functions instead of running a live webcam. Each test
// pins one behavior, and both substeps include an adversarial / edge case.

import { describe, it, expect } from 'vitest'
import { averageFrames, computeBaseline } from './calibration'
import { makeRestFrame, makeLowVisFrame, scalePose } from './fixtures/landmarks'

describe('03.1 rest pose capture', () => {
  it('averages two clean frames to the midpoint', () => {
    // Two fully-visible frames: landmark 11 at x=0.40 in one, x=0.60 in the
    // other. The averaged rest pose should land exactly in the middle (0.50).
    const a = makeRestFrame()
    const b = makeRestFrame()
    a[11].x = 0.4
    b[11].x = 0.6
    const res = averageFrames([a, b])
    expect(res.ok).toBe(true)
    if (!res.ok) return // narrow the union so .pose is typed below
    expect(res.pose[11].x).toBeCloseTo(0.5, 5)
  })

  it('rejects a low-visibility frame', () => {
    // The middle frame has its tracked landmarks at visibility 0.1 (below the
    // 0.5 gate), so the average must equal the mean of only the two clean
    // frames, not all three. With clean 11.x at 0.40 and 0.60 the answer is 0.50.
    const a = makeRestFrame()
    const b = makeRestFrame()
    a[11].x = 0.4
    b[11].x = 0.6
    const res = averageFrames([a, makeLowVisFrame(), b])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.acceptedCount).toBe(2)
    expect(res.pose[11].x).toBeCloseTo(0.5, 5)
  })

  it('reports number of accepted frames', () => {
    // 4 clean + 1 junk frame: the result exposes acceptedCount === 4.
    const frames = [
      makeRestFrame(),
      makeRestFrame(),
      makeRestFrame(),
      makeRestFrame(),
      makeLowVisFrame(),
    ]
    const res = averageFrames(frames)
    expect(res.acceptedCount).toBe(4)
  })

  it('per-frame visibility check uses only tracked landmarks', () => {
    // The nose (index 0) is fully hidden, but every tracked landmark is visible,
    // so the frame is still accepted. This proves the gate looks only at the
    // joints gameplay uses, not the whole skeleton.
    const f = makeRestFrame()
    f[0].visibility = 0
    const res = averageFrames([f])
    expect(res.acceptedCount).toBe(1)
  })

  it('ADVERSARIAL: all frames rejected returns failure, never NaN', () => {
    // Every frame is junk, so the averager cannot produce a pose. It must report
    // failure rather than dividing by zero into a pose full of NaN.
    const res = averageFrames([makeLowVisFrame(), makeLowVisFrame(), makeLowVisFrame()])
    expect(res.ok).toBe(false)
    expect(res.acceptedCount).toBe(0)
    // If a pose somehow leaked through, no coordinate may be NaN.
    if (res.ok) {
      for (const lm of res.pose) {
        expect(Number.isNaN(lm.x)).toBe(false)
        expect(Number.isNaN(lm.y)).toBe(false)
        expect(Number.isNaN(lm.visibility)).toBe(false)
      }
    }
  })
})

describe('03.2 per-player baselines', () => {
  it('shoulder width is the distance between landmarks 11 and 12', () => {
    // Shoulders 0.20 apart horizontally and level vertically -> width 0.20.
    const p = makeRestFrame()
    p[11] = { x: 0.4, y: 0.4, z: 0, visibility: 1.0 }
    p[12] = { x: 0.6, y: 0.4, z: 0, visibility: 1.0 }
    expect(computeBaseline(p).shoulderWidth).toBeCloseTo(0.2, 5)
  })

  it('rest shoulder angle is ~0 for level shoulders', () => {
    // Both shoulders at the same y -> the shoulder line is horizontal -> ~0 rad.
    expect(computeBaseline(makeRestFrame()).restShoulderAngle).toBeCloseTo(0, 4)
  })

  it('rest shoulder angle is signed for a tilted stance', () => {
    // Raise the left shoulder (smaller y) and drop the right: the shoulder line
    // tilts and the angle is nonzero. atan2(R12.y - L11.y, R12.x - L11.x) with
    // L11.y=0.36, R12.y=0.44, R12.x>L11.x gives a positive y-delta over a
    // positive x-delta, so the angle is positive. Assert sign, not magnitude.
    const p = makeRestFrame()
    p[11].y = 0.36
    p[12].y = 0.44
    const a = computeBaseline(p).restShoulderAngle
    expect(a).not.toBeCloseTo(0, 3)
    expect(a).toBeGreaterThan(0)
  })

  it('rest wrist height is the mean of the two wrists', () => {
    // Wrists at y=0.40 and y=0.44 -> mean 0.42.
    const p = makeRestFrame()
    p[15].y = 0.4
    p[16].y = 0.44
    expect(computeBaseline(p).restWristY).toBeCloseTo(0.42, 5)
  })

  it('ADVERSARIAL: same gesture at two body scales reads equal', () => {
    // A "far" player is the same pose scaled to half size around its centroid.
    // We apply the SAME proportional wrist lift to each (half the lift to the
    // half-size body, matching how a real far player's pixels move less), then
    // normalize by each pose's own shoulder width. The normalized lift must be
    // equal near and far, proving baselines cancel body size and camera distance.
    const near = makeRestFrame()
    const far = scalePose(near, 0.5)

    const nearBase = computeBaseline(near)
    const farBase = computeBaseline(far)

    // Raise the left wrist (index 15) by a lift proportional to each body's
    // shoulder width, so it is the "same gesture" in body-relative terms.
    const liftFraction = 0.5 // raise wrist by half a shoulder width
    const nearWristY = near[15].y - liftFraction * nearBase.shoulderWidth
    const farWristY = far[15].y - liftFraction * farBase.shoulderWidth

    const nearLift = (nearBase.restWristY - nearWristY) / nearBase.shoulderWidth
    const farLift = (farBase.restWristY - farWristY) / farBase.shoulderWidth

    expect(nearLift).toBeCloseTo(farLift, 4)
  })
})
