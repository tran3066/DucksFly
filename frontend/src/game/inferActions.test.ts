import { describe, it, expect } from 'vitest'
import { Euler, Quaternion } from 'three'
import { inferActions, rollFromQuat } from './inferActions'
import { DEFAULT_FLIGHT } from './flight'

const LEVEL: { x: number; y: number; z: number; w: number } = { x: 0, y: 0, z: 0, w: 1 }

/** Build a quaternion [x,y,z,w] from a YXZ euler (matches the duck's pose order). */
function quatFrom(pitch: number, yaw: number, roll: number) {
  const q = new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'))
  return { x: q.x, y: q.y, z: q.z, w: q.w }
}

describe('inferActions', () => {
  it('climbing reads as flap, not dive', () => {
    const a = inferActions({ x: 0, y: 12, z: 10 }, LEVEL)
    expect(a.flap).toBeCloseTo(1, 5)
    expect(a.dive).toBe(0)
  })

  it('strong sink reads as dive, not flap', () => {
    const a = inferActions({ x: 0, y: -14, z: 10 }, LEVEL)
    expect(a.dive).toBeGreaterThan(0.9)
    expect(a.flap).toBe(0)
  })

  it('gentle passive sink does NOT read as an aggressive dive', () => {
    const a = inferActions({ x: 0, y: -1.5, z: 10 }, LEVEL)
    expect(a.dive).toBe(0)
    expect(a.flap).toBe(0)
  })

  it('level flight is neutral', () => {
    const a = inferActions({ x: 0, y: 0, z: 12 }, LEVEL)
    expect(a.flap).toBe(0)
    expect(a.dive).toBe(0)
    expect(a.lean).toBeCloseTo(0, 5)
  })

  it('banking maps roll back to a lean of the same sign', () => {
    const maxRollRad = (DEFAULT_FLIGHT.maxRollDeg * Math.PI) / 180
    const right = inferActions({ x: 0, y: 0, z: 12 }, quatFrom(0, 0, maxRollRad))
    const left = inferActions({ x: 0, y: 0, z: 12 }, quatFrom(0, 0, -maxRollRad))
    expect(right.lean).toBeCloseTo(1, 4)
    expect(left.lean).toBeCloseTo(-1, 4)
  })

  it('lean is clamped to [-1, 1] beyond max roll', () => {
    const a = inferActions({ x: 0, y: 0, z: 12 }, quatFrom(0, 0, Math.PI / 2))
    expect(a.lean).toBeLessThanOrEqual(1)
    expect(a.lean).toBeGreaterThanOrEqual(-1)
  })

  it('confidence is 1 so the clip mapper trusts the pose', () => {
    expect(inferActions({ x: 0, y: 0, z: 0 }, LEVEL).confidence).toBe(1)
  })

  it('rollFromQuat ignores yaw (heading) and reads pure bank', () => {
    expect(rollFromQuat(quatFrom(0, 1.2, 0.5))).toBeCloseTo(0.5, 4)
  })
})
