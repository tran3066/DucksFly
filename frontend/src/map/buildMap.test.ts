import { describe, it, expect } from 'vitest'
import { buildMap } from './buildMap'
import { DEFAULT_MAP_CONFIG } from './config'
import { treeTrunk, RING_TUBE } from './collide'
import type { MapDef } from './types'

const cfg = DEFAULT_MAP_CONFIG
const SEEDS = [1, 1337, 42, 99999, 7]

const trees = (map: MapDef) => map.scenery.filter((s) => s.kind === 'tree')

describe('buildMap determinism', () => {
  it('produces the identical world for the same seed', () => {
    for (const seed of SEEDS) {
      expect(buildMap(seed)).toEqual(buildMap(seed))
    }
  })
})

describe('buildMap scenery ids', () => {
  it('are unique across trees + detail', () => {
    for (const seed of SEEDS) {
      const ids = buildMap(seed).scenery.map((s) => s.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('ring placement vs trees', () => {
  it('no surviving trunk pokes through a ring opening', () => {
    for (const seed of SEEDS) {
      const map = buildMap(seed)
      for (const ring of map.rings) {
        for (const tree of trees(map)) {
          const { radius: trunkR, height } = treeTrunk(tree)
          // Same (x,z) footprint test the generator uses.
          const nearZ = Math.abs(tree.pos[2] - ring.pos[2]) <= trunkR + RING_TUBE + cfg.ringTreeClearance
          const nearX = Math.abs(tree.pos[0] - ring.pos[0]) < ring.radius + trunkR + cfg.ringTreeClearance
          if (nearZ && nearX) {
            // The ring must have been pushed above this trunk's top.
            expect(ring.pos[1]).toBeGreaterThanOrEqual(height + ring.radius + cfg.ringTreeClearance - 1e-6)
          }
        }
      }
    }
  })

  it('keeps every ring rim under the ceiling', () => {
    for (const seed of SEEDS) {
      for (const ring of buildMap(seed).rings) {
        expect(ring.pos[1] + ring.radius + RING_TUBE).toBeLessThanOrEqual(cfg.ceiling + 1e-6)
      }
    }
  })
})

describe('boost lanes', () => {
  it('no tree sits in a ring downstream boost lane', () => {
    for (const seed of SEEDS) {
      const map = buildMap(seed)
      for (const ring of map.rings) {
        for (const tree of trees(map)) {
          const dz = tree.pos[2] - ring.pos[2]
          const inZ = dz >= 0 && dz <= cfg.boostLaneLength
          const inX = Math.abs(tree.pos[0] - ring.pos[0]) < cfg.boostLaneHalfWidth
          expect(inZ && inX).toBe(false)
        }
      }
    }
  })
})
