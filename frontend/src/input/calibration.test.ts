// Tests for calibration (Person A, Step 03.1 rest-pose capture + 03.2 baselines).
//
// Pure logic only: we feed synthetic landmark frames from fixtures/landmarks.ts
// through the calibration functions instead of running a live webcam. Each test
// pins one behavior, and both substeps include an adversarial / edge case.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  averageFrames,
  computeBaseline,
  needsRecalibration,
  setBaseline,
  getBaseline,
  useCalibrationStore,
  assessFraming,
} from './calibration'
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

describe('03.3 recalibrate and persist', () => {
  // A minimal Baseline with a chosen shoulder width; the other two fields are
  // irrelevant to the drift check so they stay fixed.
  const mk = (w: number) => ({ shoulderWidth: w, restShoulderAngle: 0, restWristY: 0.42 })

  beforeEach(() => {
    // Each test starts from "no baseline yet" so order never leaks between cases.
    useCalibrationStore.getState().clearBaseline()
  })

  it('recalibrating replaces the stored baseline', () => {
    // Last write wins: a second calibration must REPLACE, not merge or append, so
    // the gesture stages always read one current scale.
    setBaseline(mk(0.2))
    setBaseline(mk(0.3))
    expect(getBaseline()?.shoulderWidth).toBe(0.3)
  })

  it('drift flag fires when scale grows past threshold', () => {
    // 0.30 / 0.20 = 1.5x, beyond the 1.3x band: the player moved much closer.
    expect(needsRecalibration(mk(0.2), 0.3)).toBe(true)
  })

  it('drift flag fires when scale shrinks past threshold', () => {
    // 0.12 / 0.20 = 0.6x, below 1/1.3 ~= 0.77: the player moved much farther.
    // Proves the band is symmetric for closer vs farther.
    expect(needsRecalibration(mk(0.2), 0.12)).toBe(true)
  })

  it('ADVERSARIAL: small wobble within tolerance does NOT fire', () => {
    // 0.22 / 0.20 = 1.1x, inside the 1.3x band: normal breathing/sway must never
    // spam "please recalibrate".
    expect(needsRecalibration(mk(0.2), 0.22)).toBe(false)
  })

  it('no stored baseline means recalibration is needed', () => {
    // Before the first calibration there is nothing to normalize against, so the
    // game must calibrate before play (this is also what makes a fresh page load
    // re-prompt: the in-memory store starts null).
    expect(needsRecalibration(null, 0.2)).toBe(true)
  })
})

describe('assessFraming (distance / framing guidance)', () => {
  it('a well-framed T-pose passes', () => {
    // makeRestFrame is a centered T-pose with every tracked joint visible and
    // inside the frame, so it should read as good framing.
    const res = assessFraming(makeRestFrame())
    expect(res.ok).toBe(true)
    expect(res.reason).toBe('ok')
  })

  it('a wrist pushed to the edge fails as out-of-frame (too close)', () => {
    // Standing too close in a T-pose pushes a wrist to the frame edge. x=0.03 is
    // inside the default 0.08 margin, so the player is told they are too close.
    const f = makeRestFrame()
    f[15].x = 0.03
    const res = assessFraming(f)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('out-of-frame')
  })

  it('the margin edge is inclusive (a joint exactly at the margin still fits)', () => {
    // A wrist exactly on the margin line counts as inside; just past it does not.
    const onEdge = makeRestFrame()
    onEdge[15].x = 0.08
    expect(assessFraming(onEdge).ok).toBe(true)
    const past = makeRestFrame()
    past[15].x = 0.079
    expect(assessFraming(past).reason).toBe('out-of-frame')
  })

  it('a null frame is reported as no-pose', () => {
    expect(assessFraming(null).reason).toBe('no-pose')
  })

  it('ADVERSARIAL: low visibility wins over out-of-frame', () => {
    // A joint that is both off-frame AND barely visible reports low-visibility,
    // because an unseen joint's position cannot be trusted to judge framing.
    const f = makeLowVisFrame() // all tracked joints at visibility ~0.1
    f[15].x = 0.01 // also off-frame
    const res = assessFraming(f)
    expect(res.ok).toBe(false)
    expect(res.reason).toBe('low-visibility')
  })
})
