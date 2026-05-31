import { describe, it, expect } from 'vitest'
import { RING_TUBE, treeTrunk, treeHit, ringCrossing, ringRimHit } from './collide'
import type { RingDef, SceneryItem } from './types'

// Pure collision primitives. Each test pins one geometric invariant the sim
// (respawn) and the generator (placement) both depend on.

const tree = (over: Partial<SceneryItem> = {}): SceneryItem => ({
  id: 0,
  kind: 'tree',
  variant: 1,
  pos: [0, 0, 100],
  rotationY: 0,
  height: 40,
  ...over,
})

const ring = (over: Partial<RingDef> = {}): RingDef => ({
  id: 0,
  pos: [0, 50, 100],
  radius: 6,
  ...over,
})

describe('treeTrunk', () => {
  it('scales radius with height but never below the floor', () => {
    expect(treeTrunk(tree({ height: 40 })).radius).toBeCloseTo(2.4) // 40 * 0.06
    expect(treeTrunk(tree({ height: 1 })).radius).toBe(0.6) // clamped up
  })

  it('reports the full tree height as collidable', () => {
    expect(treeTrunk(tree({ height: 72 })).height).toBe(72)
  })

  it('is deterministic for the same item', () => {
    const t = tree({ height: 33 })
    expect(treeTrunk(t)).toEqual(treeTrunk(t))
  })
})

describe('treeHit', () => {
  it('hits dead-center within the trunk vertical span', () => {
    expect(treeHit(0, 20, 100, tree(), 1)).toBe(true)
  })

  it('misses when horizontally clear of the trunk + duck radius', () => {
    // height 40 -> radius 2.4; duckRadius 1 -> reach 3.4. 5m away is clear.
    expect(treeHit(5, 20, 100, tree(), 1)).toBe(false)
  })

  it('grazes the trunk edge thanks to the duck radius', () => {
    // reach = 2.4 + 1 = 3.4; sit just inside at 3.3m.
    expect(treeHit(3.3, 20, 100, tree(), 1)).toBe(true)
    expect(treeHit(3.5, 20, 100, tree(), 1)).toBe(false)
  })

  it('misses when flying above the treetop', () => {
    // height 40; duckRadius 1 -> collidable up to y = 41.
    expect(treeHit(0, 42, 100, tree({ height: 40 }), 1)).toBe(false)
    expect(treeHit(0, 40.5, 100, tree({ height: 40 }), 1)).toBe(true)
  })

  it('still hits low over the trunk near the ground', () => {
    expect(treeHit(0, 0, 100, tree(), 1)).toBe(true)
  })
})

describe('ringCrossing', () => {
  it('returns null when the ring plane is not crossed', () => {
    expect(ringCrossing(90, 95, 0, 50, ring(), 1)).toBeNull()
  })

  it("passes when through the hole (dist <= radius - duckRadius)", () => {
    // radius 6, duckRadius 1 -> hole edge at 5. Center is dist 0.
    expect(ringCrossing(99, 101, 0, 50, ring(), 1)).toBe('pass')
  })

  it('misses when crossing the plane outside the hole', () => {
    // dist 6 (= radius) > 5 -> not a clean pass.
    expect(ringCrossing(99, 101, 6, 50, ring(), 1)).toBe('miss')
  })
})

describe('ringRimHit', () => {
  it('is false without a plane crossing', () => {
    expect(ringRimHit(90, 95, 6, 50, ring(), 1)).toBe(false)
  })

  it('is false on a clean pass through the hole (boost, not crash)', () => {
    // dist 0 < radius - duckRadius (5) -> clean pass.
    expect(ringRimHit(99, 101, 0, 50, ring(), 1)).toBe(false)
    // complementary: ringCrossing agrees it is a pass.
    expect(ringCrossing(99, 101, 0, 50, ring(), 1)).toBe('pass')
  })

  it('is true clipping the rim band [radius - duckRadius, radius + tube]', () => {
    const r = ring()
    // inner band edge = radius - duckRadius = 5.
    expect(ringRimHit(99, 101, 5, 50, r, 1)).toBe(true)
    // squarely on the tube center circle (= radius).
    expect(ringRimHit(99, 101, 6, 50, r, 1)).toBe(true)
    // outer band edge = radius + RING_TUBE.
    expect(ringRimHit(99, 101, 6 + RING_TUBE, 50, r, 1)).toBe(true)
  })

  it('is false when sailing past outside the rim', () => {
    // just beyond radius + RING_TUBE.
    expect(ringRimHit(99, 101, 6 + RING_TUBE + 0.01, 50, ring(), 1)).toBe(false)
  })

  it('measures radial distance in the ring plane (x and y both count)', () => {
    // dy chosen so hypot(0, dy) lands in the rim band around the off-center ring.
    const r = ring({ pos: [10, 50, 100] })
    expect(ringRimHit(99, 101, 10, 56, r, 1)).toBe(true) // dist 6 -> rim
    expect(ringRimHit(99, 101, 10, 50, r, 1)).toBe(false) // dist 0 -> clean pass
  })
})

describe('RING_TUBE', () => {
  it('matches the renderer torus tube (1.5)', () => {
    expect(RING_TUBE).toBe(1.5)
  })
})
