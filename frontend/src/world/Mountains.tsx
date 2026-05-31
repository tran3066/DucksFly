import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Instance, Instances } from '@react-three/drei'
import { useFlattenedGeometry } from './useFlattenedGeometry'
import { deriveSeed, makeRng, randRange, type MapDef } from '../map'

const DIR = '/models/LowPolyMountain'
const VARIANT_COUNT = 20

function fileFor(variant: number): string {
  return `${DIR}/Mountain_L_${String(variant).padStart(2, '0')}_LOD.fbx`
}

// Rock->snow vertical gradient, baked into per-vertex colors.
const MOUNTAIN_COLOR = '#7f8ca6' // gray-blue rock at the base
const SNOW_COLOR = '#f2f6fc' // cool white at the peaks
const SNOW_START = 0.6 // snow fades in above this fraction of each mountain's height

// How far each mountain's CENTER sits outside its wall, as a fraction of its own
// bounding radius (<1 overlaps the wall so the inner part is clipped flush).
const OUTWARD_FRACTION = 0.55
const HEIGHT_MIN = 50
const HEIGHT_MAX = 150
const SPACING_MIN = 60 // gap between successive mountains along a wall
const SPACING_MAX = 130

type Wall = 'left' | 'right' | 'back'

interface Placement {
  id: number
  wall: Wall
  baseX: number // point on the wall plane (the inner edge)
  baseZ: number
  nx: number // outward unit normal
  nz: number
  rot: number
  height: number
}

/**
 * A low-poly mountain range enclosing the course: down both sides (x = ±halfWidth)
 * and, when `backZ` is given, across the back to wrap around the end clearing.
 * Each wall is clipped at its own plane so no geometry shows inside the playable
 * area / clearing, however a rotated mountain overflows.
 *
 * - `endZ`: how far down the track the side walls extend (default = map.length).
 * - `backZ`: if set, adds a back wall at this z spanning the corridor width.
 *
 * Deterministic from the seed (salt 0xB). Render inside a <Suspense>.
 */
export function Mountains({
  map,
  endZ,
  backZ,
}: {
  map: MapDef
  endZ?: number
  backZ?: number
}) {
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    gl.localClippingEnabled = true
  }, [gl])

  // One clipped material per wall (keeps mountains out of the playable area).
  const materials = useMemo(() => {
    const base = {
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      side: THREE.DoubleSide,
      clipShadows: true,
    }
    const mk = (plane: THREE.Plane) =>
      new THREE.MeshStandardMaterial({ ...base, clippingPlanes: [plane] })
    return {
      left: mk(new THREE.Plane(new THREE.Vector3(-1, 0, 0), -map.halfWidth)), // keep x <= -halfWidth
      right: mk(new THREE.Plane(new THREE.Vector3(1, 0, 0), -map.halfWidth)), // keep x >= halfWidth
      back: mk(new THREE.Plane(new THREE.Vector3(0, 0, 1), -(backZ ?? 0))), // keep z >= backZ
    } as Record<Wall, THREE.MeshStandardMaterial>
  }, [map.halfWidth, backZ])

  // Scatter placements along each wall, grouped by variant + wall for instancing.
  const groups = useMemo(() => {
    const rng = makeRng(deriveSeed(map.seed, 0xb))
    const byKey = new Map<string, Placement[]>()
    let id = 0
    const add = (variant: number, p: Placement) => {
      const key = `${variant}:${p.wall}`
      const list = byKey.get(key)
      if (list) list.push(p)
      else byKey.set(key, [p])
    }

    const sideEnd = endZ ?? map.length
    for (const wall of ['left', 'right'] as const) {
      const sign = wall === 'left' ? -1 : 1
      let z = 0
      while (z <= sideEnd) {
        add(1 + Math.floor(rng() * VARIANT_COUNT), {
          id: id++,
          wall,
          baseX: sign * map.halfWidth,
          baseZ: z,
          nx: sign,
          nz: 0,
          rot: rng() * Math.PI * 2,
          height: randRange(rng, HEIGHT_MIN, HEIGHT_MAX),
        })
        z += randRange(rng, SPACING_MIN, SPACING_MAX)
      }
    }

    if (backZ != null) {
      let x = -map.halfWidth
      while (x <= map.halfWidth) {
        add(1 + Math.floor(rng() * VARIANT_COUNT), {
          id: id++,
          wall: 'back',
          baseX: x,
          baseZ: backZ,
          nx: 0,
          nz: 1,
          rot: rng() * Math.PI * 2,
          height: randRange(rng, HEIGHT_MIN, HEIGHT_MAX),
        })
        x += randRange(rng, SPACING_MIN, SPACING_MAX)
      }
    }

    return [...byKey.entries()].map(([key, placements]) => {
      const [variant, wall] = key.split(':')
      return { key, variant: Number(variant), wall: wall as Wall, placements }
    })
  }, [map.seed, map.length, map.halfWidth, endZ, backZ])

  return (
    <group>
      {groups.map((g) => (
        <MountainGroup
          key={g.key}
          variant={g.variant}
          placements={g.placements}
          material={materials[g.wall]}
        />
      ))}
    </group>
  )
}

function MountainGroup({
  variant,
  placements,
  material,
}: {
  variant: number
  placements: Placement[]
  material: THREE.Material
}) {
  const { geometry, baseHeight } = useFlattenedGeometry(fileFor(variant))

  // Bounding radius (model units): half the larger horizontal dimension, so the
  // outward offset works for any yaw.
  const radius = useMemo(() => {
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    return 0.5 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
  }, [geometry])

  // Clone + bake a height-based rock->snow gradient into vertex colors.
  const colored = useMemo(() => {
    const g = geometry.clone()
    const pos = g.getAttribute('position')
    const colors = new Float32Array(pos.count * 3)
    const rock = new THREE.Color(MOUNTAIN_COLOR)
    const snow = new THREE.Color(SNOW_COLOR)
    const c = new THREE.Color()
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.smoothstep(pos.getY(i) / baseHeight, SNOW_START, 1)
      c.copy(rock).lerp(snow, t)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [geometry, baseHeight])

  return (
    <Instances geometry={colored} material={material} limit={placements.length}>
      {placements.map((p) => {
        const scale = p.height / baseHeight
        const off = radius * scale * OUTWARD_FRACTION
        return (
          <Instance
            key={p.id}
            position={[p.baseX + p.nx * off, 0, p.baseZ + p.nz * off]}
            rotation={[0, p.rot, 0]}
            scale={scale}
          />
        )
      })}
    </Instances>
  )
}
