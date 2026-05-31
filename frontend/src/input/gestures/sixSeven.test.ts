// Tests for the "six-seven" two-handed alternation gesture (Step 11, redefined).
// Pure logic: we feed sequences of synthetic pose frames through detectSixSeven
// and count the pulses. y grows DOWNWARD, so a SMALLER y is a HIGHER hand.
//
// The gesture only counts when the player is in the specific pose: both hands IN
// FRONT (near the torso centre) at chest height with elbows BENT (~90 degrees).
// So the fixtures build a realistic two-arms-in-front pose, not just stray wrists.

import { describe, it, expect } from 'vitest'
import { detectSixSeven, makeSixSevenState, DEFAULT_SIX_SEVEN } from './sixSeven'
import { makeLandmarkFrame } from '../fixtures/landmarks'

const cfg = DEFAULT_SIX_SEVEN

// A valid "6-7" pose: shoulders at chest level, elbows below and just outside the
// shoulders, both wrists IN FRONT (near centre x) at the given heights -> elbows
// read as clearly bent and the hands as in front of the torso.
function sixSevenFrame(leftWristY: number, rightWristY: number) {
  return makeLandmarkFrame({
    11: { x: 0.56, y: 0.35 }, // left shoulder (mirrored: left is the larger x)
    12: { x: 0.44, y: 0.35 }, // right shoulder
    13: { x: 0.58, y: 0.52 }, // left elbow (below + outside the shoulder)
    14: { x: 0.42, y: 0.52 }, // right elbow
    15: { x: 0.52, y: leftWristY }, // left wrist, in front (near centre)
    16: { x: 0.48, y: rightWristY }, // right wrist, in front
    23: { x: 0.52, y: 0.7 }, // left hip
    24: { x: 0.48, y: 0.7 }, // right hip
  })
}

const HIGH = 0.4 // clearly higher (smaller y)
const LOW = 0.55 // clearly lower
const leftUp = () => sixSevenFrame(HIGH, LOW)
const rightUp = () => sixSevenFrame(LOW, HIGH)

// Drive a sequence of frames at a fixed time step and count how many pulses fire.
function run(frames: ReturnType<typeof sixSevenFrame>[], stepMs: number): number {
  const state = makeSixSevenState()
  let pulses = 0
  let t = 0
  for (const fr of frames) {
    if (detectSixSeven(state, fr, t, cfg)) pulses += 1
    t += stepMs
  }
  return pulses
}

describe('detectSixSeven (two-handed alternation)', () => {
  it('fires once when the hands swap high/low twice quickly', () => {
    expect(run([leftUp(), rightUp(), leftUp()], 200)).toBe(1)
  })

  it('does not fire when one hand just stays higher (no alternation)', () => {
    expect(run(Array.from({ length: 10 }, () => leftUp()), 100)).toBe(0)
  })

  it('does not fire when both wrists stay level / move together (no opposite phase)', () => {
    const levels = [0.5, 0.45, 0.4, 0.45, 0.5, 0.45, 0.4]
    expect(run(levels.map((y) => sixSevenFrame(y, y)), 150)).toBe(0)
  })

  it('does not fire when the alternation is too slow for the window', () => {
    expect(run([leftUp(), rightUp(), leftUp(), rightUp()], 1600)).toBe(0)
  })

  it('ADVERSARIAL: a held rapid alternation fires once, not once per frame', () => {
    const frames = Array.from({ length: 7 }, (_, i) => (i % 2 === 0 ? leftUp() : rightUp()))
    expect(run(frames, 150)).toBe(1)
  })

  it('ignores one-handed motion (the other wrist not visible)', () => {
    const state = makeSixSevenState()
    let pulses = 0
    let t = 0
    for (let i = 0; i < 8; i++) {
      const fr = sixSevenFrame(i % 2 === 0 ? HIGH : LOW, LOW)
      fr[16] = { ...fr[16], visibility: 0.1 } // right wrist barely seen
      if (detectSixSeven(state, fr, t, cfg)) pulses += 1
      t += 150
    }
    expect(pulses).toBe(0)
  })

  it('re-fires on a fresh bout after the hands settle and alternate again', () => {
    const state = makeSixSevenState()
    let pulses = 0
    let t = 0
    const push = (fr: ReturnType<typeof sixSevenFrame>) => {
      if (detectSixSeven(state, fr, t, cfg)) pulses += 1
      t += 150
    }
    push(leftUp())
    push(rightUp())
    push(leftUp()) // fire 1
    for (let i = 0; i < 10; i++) push(sixSevenFrame(0.5, 0.5)) // settle past cooldown
    push(rightUp())
    push(leftUp())
    push(rightUp()) // fire 2
    expect(pulses).toBe(2)
  })

  it('ignores arms held OUT to the sides (not in front of the torso)', () => {
    // Same alternation, but the wrists are spread wide (x near the frame edges),
    // so the "hands in front" gate rejects it -> no egg.
    const spread = (lY: number, rY: number) => {
      const fr = sixSevenFrame(lY, rY)
      fr[15] = { ...fr[15], x: 0.1 } // left wrist far left
      fr[16] = { ...fr[16], x: 0.9 } // right wrist far right
      return fr
    }
    expect(run([spread(HIGH, LOW), spread(LOW, HIGH), spread(HIGH, LOW)], 200)).toBe(0)
  })

  it('ADVERSARIAL: ignores STRAIGHT-arm swinging (elbows not bent)', () => {
    // Elbow placed at the midpoint of shoulder->wrist makes the arm collinear
    // (~180 deg, straight). Even alternating, the bent-elbow gate rejects it.
    const straight = (lY: number, rY: number) =>
      makeLandmarkFrame({
        11: { x: 0.56, y: 0.35 },
        12: { x: 0.44, y: 0.35 },
        13: { x: (0.56 + 0.52) / 2, y: (0.35 + lY) / 2 }, // elbow == midpoint -> straight
        14: { x: (0.44 + 0.48) / 2, y: (0.35 + rY) / 2 },
        15: { x: 0.52, y: lY },
        16: { x: 0.48, y: rY },
        23: { x: 0.52, y: 0.7 },
        24: { x: 0.48, y: 0.7 },
      })
    expect(run([straight(HIGH, LOW), straight(LOW, HIGH), straight(HIGH, LOW)], 200)).toBe(0)
  })
})
