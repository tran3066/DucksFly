import { describe, it, expect } from 'vitest'
import { buildChunk, CHUNK_LENGTH, ID_STRIDE } from './buildChunk'
import { createInfiniteMap, difficultyFor } from './infiniteMap'
import { DEFAULT_MAP_CONFIG } from './config'
import { treeTrunk, RING_TUBE } from './collide'
import type { MapConfig } from './types'

const cfg: MapConfig = DEFAULT_MAP_CONFIG
const SEEDS = [1, 1337, 42, 99999, 7]

// The window manager always pairs a chunk with this difficulty, so tests that want
// to match streamed output must build chunks the same way.
const chunkOf = (i: number, seed: number) => buildChunk(i, seed, cfg, difficultyFor(i))

describe('buildChunk determinism', () => {
  it('produces a deeply-equal chunk for identical (index, seed, cfg, difficulty)', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 1, 5, 23, 100]) {
        const d = difficultyFor(i)
        expect(buildChunk(i, seed, cfg, d)).toEqual(buildChunk(i, seed, cfg, d))
      }
    }
  })

  it('different seeds generally yield different rings', () => {
    const a = chunkOf(3, 1)
    const b = chunkOf(3, 2)
    expect(a.rings).not.toEqual(b.rings)
  })
})

describe('buildChunk banding', () => {
  it('keeps every ring strictly inside its half-open Z band', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 1, 4, 37]) {
        const start = i * CHUNK_LENGTH
        const end = start + CHUNK_LENGTH
        for (const ring of chunkOf(i, seed).rings) {
          expect(ring.pos[2]).toBeGreaterThanOrEqual(start)
          expect(ring.pos[2]).toBeLessThan(end)
        }
      }
    }
  })

  it('keeps every tree inside its band and only collidable trees count', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 2, 9]) {
        const start = i * CHUNK_LENGTH
        const end = start + CHUNK_LENGTH
        for (const item of chunkOf(i, seed).scenery) {
          expect(item.pos[2]).toBeGreaterThanOrEqual(start)
          expect(item.pos[2]).toBeLessThan(end)
        }
      }
    }
  })

  it('emits no obstacles before startSafeZ in chunk 0', () => {
    for (const seed of SEEDS) {
      const chunk = chunkOf(0, seed)
      for (const ring of chunk.rings) expect(ring.pos[2]).toBeGreaterThanOrEqual(cfg.startSafeZ)
      for (const tree of chunk.scenery.filter((s) => s.kind === 'tree')) {
        expect(tree.pos[2]).toBeGreaterThanOrEqual(cfg.startSafeZ)
      }
    }
  })

  it('orders rings ascending by Z within a chunk', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 3, 11]) {
        const zs = chunkOf(i, seed).rings.map((r) => r.pos[2])
        expect([...zs].sort((a, b) => a - b)).toEqual(zs)
      }
    }
  })
})

describe('chunk id uniqueness', () => {
  it('ring ids are unique across many chunks (no passedRings collisions)', () => {
    for (const seed of [1, 42]) {
      const ids: number[] = []
      for (let i = 0; i < 80; i++) ids.push(...chunkOf(i, seed).rings.map((r) => r.id))
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('scenery ids are unique across many chunks', () => {
    for (const seed of [1, 42]) {
      const ids: number[] = []
      for (let i = 0; i < 60; i++) ids.push(...chunkOf(i, seed).scenery.map((s) => s.id))
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('checkpoint ids are unique across many chunks', () => {
    const ids: number[] = []
    for (let i = 0; i < 60; i++) ids.push(...chunkOf(i, 7).checkpoints.map((c) => c.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('local index never reaches the next chunk id base (ID_STRIDE big enough)', () => {
    for (let i = 0; i < 40; i++) {
      const chunk = chunkOf(i, 1337)
      const base = i * ID_STRIDE
      for (const arr of [chunk.rings, chunk.scenery, chunk.checkpoints]) {
        for (const item of arr) {
          expect(item.id - base).toBeGreaterThanOrEqual(0)
          expect(item.id - base).toBeLessThan(ID_STRIDE)
        }
      }
    }
  })
})

describe('chunk seams', () => {
  it('adjacent chunks never share a ring/checkpoint Z (no duplicates at the seam)', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 5, 20]) {
        const a = chunkOf(i, seed)
        const b = chunkOf(i + 1, seed)
        const aRingZ = new Set(a.rings.map((r) => r.pos[2]))
        for (const r of b.rings) expect(aRingZ.has(r.pos[2])).toBe(false)
        const aCpZ = new Set(a.checkpoints.map((c) => c.z))
        for (const c of b.checkpoints) expect(aCpZ.has(c.z)).toBe(false)
      }
    }
  })

  it('checkpoints sit on the global grid so spacing is uniform across seams', () => {
    const zs: number[] = []
    for (let i = 0; i < 6; i++) zs.push(...chunkOf(i, 1).checkpoints.map((c) => c.z))
    for (const z of zs) expect(z % cfg.checkpointGap).toBe(0)
  })
})

describe('ring vs tree placement within a chunk', () => {
  it('no surviving trunk pokes through a ring opening', () => {
    for (const seed of SEEDS) {
      for (const i of [1, 8, 30]) {
        const chunk = chunkOf(i, seed)
        const trees = chunk.scenery.filter((s) => s.kind === 'tree')
        for (const ring of chunk.rings) {
          for (const tree of trees) {
            const { radius: trunkR, height } = treeTrunk(tree)
            const nearZ = Math.abs(tree.pos[2] - ring.pos[2]) <= trunkR + RING_TUBE + cfg.ringTreeClearance
            const nearX = Math.abs(tree.pos[0] - ring.pos[0]) < ring.radius + trunkR + cfg.ringTreeClearance
            if (nearZ && nearX) {
              expect(ring.pos[1]).toBeGreaterThanOrEqual(
                height + ring.radius + cfg.ringTreeClearance - 1e-6,
              )
            }
          }
        }
      }
    }
  })

  it('keeps every ring rim under the ceiling', () => {
    for (const seed of SEEDS) {
      for (const i of [0, 12, 50]) {
        for (const ring of chunkOf(i, seed).rings) {
          expect(ring.pos[1] + ring.radius + RING_TUBE).toBeLessThanOrEqual(cfg.ceiling + 1e-6)
        }
      }
    }
  })
})

describe('difficulty ramp', () => {
  it('is monotonic non-decreasing and clamped to [0, 1]', () => {
    let prev = -1
    for (let i = 0; i < 200; i++) {
      const d = difficultyFor(i)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
      expect(d).toBeGreaterThanOrEqual(prev)
      prev = d
    }
  })

  it('reaches and holds the clamp at high chunk indices', () => {
    expect(difficultyFor(0)).toBe(0)
    expect(difficultyFor(10_000)).toBe(1)
    expect(difficultyFor(1_000_000)).toBe(1)
  })

  it('tightens ring spacing as difficulty rises (more rings per band, monotone)', () => {
    // Average over seeds to smooth per-seed RNG noise; the trend must be non-decreasing.
    const avgRings = (i: number) =>
      SEEDS.reduce((sum, s) => sum + chunkOf(i, s).rings.length, 0) / SEEDS.length
    const easy = avgRings(0)
    const mid = avgRings(12)
    const hard = avgRings(48) // past the clamp
    expect(mid).toBeGreaterThanOrEqual(easy)
    expect(hard).toBeGreaterThanOrEqual(mid)
    expect(hard).toBeGreaterThan(easy)
  })

  it('ramps tree density with difficulty', () => {
    const avgTrees = (i: number) =>
      SEEDS.reduce((sum, s) => sum + chunkOf(i, s).scenery.filter((x) => x.kind === 'tree').length, 0) /
      SEEDS.length
    expect(avgTrees(48)).toBeGreaterThan(avgTrees(0))
  })
})

describe('infiniteMap window manager', () => {
  it('exposes a valid bounded window immediately at spawn', () => {
    const map = createInfiniteMap(1)
    const def = map.getMap()
    expect(def.rings.length).toBeGreaterThan(0)
    expect(def.scenery.length).toBeGreaterThan(0)
    expect(def.length).toBe(4 * CHUNK_LENGTH) // chunks 0..3 (ahead=3, behind clamps to 0)
    expect(def.halfWidth).toBe(cfg.halfWidth)
    expect(def.ceiling).toBe(cfg.ceiling)
  })

  it('streams the deterministic world: window equals concatenated chunks', () => {
    const seed = 1337
    const map = createInfiniteMap(seed)
    map.update(20 * CHUNK_LENGTH + 10) // deep into the run
    const def = map.getMap()
    const c = 20
    const start = Math.max(0, c - 1)
    const end = c + 3
    const expectedRingIds: number[] = []
    for (let i = start; i <= end; i++) expectedRingIds.push(...chunkOf(i, seed).rings.map((r) => r.id))
    expect(def.rings.map((r) => r.id)).toEqual(expectedRingIds)
  })

  it('update() is a cheap no-op within the same window and rebuilds on boundary crossing', () => {
    const map = createInfiniteMap(1)
    const v0 = map.getVersion()
    expect(map.update(10)).toBe(false) // still chunk 0 window
    expect(map.update(CHUNK_LENGTH - 1)).toBe(false)
    expect(map.getVersion()).toBe(v0)
    expect(map.update(CHUNK_LENGTH)).toBe(true) // crossed into chunk 1
    expect(map.getVersion()).toBe(v0 + 1)
    expect(map.update(CHUNK_LENGTH + 5)).toBe(false) // same new window
    expect(map.getVersion()).toBe(v0 + 1)
  })

  it('builds ahead and drops behind: window stays bounded as Z grows', () => {
    const map = createInfiniteMap(1)
    let maxRings = 0
    let maxScenery = 0
    for (let chunk = 0; chunk < 200; chunk++) {
      map.update(chunk * CHUNK_LENGTH + 1)
      const def = map.getMap()
      maxRings = Math.max(maxRings, def.rings.length)
      maxScenery = Math.max(maxScenery, def.scenery.length)
      // Active window covers at most behind+ahead+1 chunks worth of band.
      const span = def.length - lowestRingZ(def)
      expect(span).toBeLessThanOrEqual((1 + 3 + 1) * CHUNK_LENGTH)
    }
    // Bounded regardless of how far we flew (no unbounded growth).
    expect(maxRings).toBeLessThan(500)
    expect(maxScenery).toBeLessThan(20_000)
  })

  it('drops chunks behind: far-behind rings disappear from the window', () => {
    const seed = 7
    const map = createInfiniteMap(seed)
    const earlyIds = new Set(chunkOf(0, seed).rings.map((r) => r.id))
    map.update(50 * CHUNK_LENGTH)
    const present = map.getMap().rings.map((r) => r.id)
    expect(present.some((id) => earlyIds.has(id))).toBe(false)
  })

  it('keeps already-built chunks stable when briefly backing up (no re-randomization)', () => {
    const seed = 99999
    const map = createInfiniteMap(seed)
    map.update(5 * CHUNK_LENGTH)
    const before = map.getMap().rings.map((r) => `${r.id}:${r.pos.join(',')}`)
    map.update(6 * CHUNK_LENGTH) // advance
    map.update(5 * CHUNK_LENGTH) // back up to the same window
    const after = map.getMap().rings.map((r) => `${r.id}:${r.pos.join(',')}`)
    expect(after).toEqual(before)
  })

  it('two managers with the same seed expose identical windows', () => {
    const a = createInfiniteMap(2024)
    const b = createInfiniteMap(2024)
    a.update(13 * CHUNK_LENGTH)
    b.update(13 * CHUNK_LENGTH)
    expect(a.getMap()).toEqual(b.getMap())
  })

  it('window rings stay globally Z-ordered across chunk seams', () => {
    const map = createInfiniteMap(42)
    map.update(15 * CHUNK_LENGTH)
    const zs = map.getMap().rings.map((r) => r.pos[2])
    expect([...zs].sort((a, b) => a - b)).toEqual(zs)
  })
})

function lowestRingZ(def: { rings: { pos: [number, number, number] }[]; length: number }): number {
  if (def.rings.length === 0) return def.length
  return Math.min(...def.rings.map((r) => r.pos[2]))
}
