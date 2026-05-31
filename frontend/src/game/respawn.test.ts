import { describe, it, expect } from 'vitest'
import { lastCheckpointZ } from './respawn'
import type { Checkpoint } from '../map'

// Mirrors buildCheckpoints: planes at 0/450/900/1350/1800 + finish at 2000.
const cps: Checkpoint[] = [
  { id: 0, z: 0, isFinish: false },
  { id: 1, z: 450, isFinish: false },
  { id: 2, z: 900, isFinish: false },
  { id: 3, z: 1350, isFinish: false },
  { id: 4, z: 1800, isFinish: false },
  { id: 5, z: 2000, isFinish: true },
]

describe('lastCheckpointZ', () => {
  it('returns 0 before the first checkpoint', () => {
    expect(lastCheckpointZ(0, cps)).toBe(0)
    expect(lastCheckpointZ(120, cps)).toBe(0)
  })

  it('returns the checkpoint at or before the duck', () => {
    expect(lastCheckpointZ(450, cps)).toBe(450)
    expect(lastCheckpointZ(700, cps)).toBe(450)
    expect(lastCheckpointZ(1801, cps)).toBe(1800)
  })

  it('never snaps to the finish line', () => {
    expect(lastCheckpointZ(2000, cps)).toBe(1800)
    expect(lastCheckpointZ(5000, cps)).toBe(1800)
  })

  it('is order-independent', () => {
    const shuffled = [...cps].reverse()
    expect(lastCheckpointZ(950, shuffled)).toBe(900)
  })
})
