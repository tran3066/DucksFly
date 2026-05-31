import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { Instance, Instances } from '@react-three/drei'
import { useFlattenedGeometry } from './useFlattenedGeometry'
import { deriveSeed, makeRng, randRange, type MapDef } from '../map'

const DIR = '/models/LowPolyMountain'
const VARIANT_COUNT = 20

// Rock->snow vertical gradient, baked into per-vertex colors (the pack's green
// ColorGrid atlas is unused). Flat shading still gives the faceted variation.
const MOUNTAIN_COLOR = '#7f8ca6' // gray-blue rock at the base
const SNOW_COLOR = '#f2f6fc' // cool white at the peaks
const SNOW_START = 0.6 // snow fades in above this fraction of each mountain's height

function fileFor(variant: number): string {
  return `${DIR}/Mountain_L_${String(variant).padStart(2, '0')}_LOD.fbx`
}

// How far each mountain's CENTER sits outside the wall, as a fraction of its own
// bounding radius. <1 lets the inner part overlap the wall (clipped flush), which
// pulls the visible mass right up to the playable-area edge. (1 = fully outside.)
const OUTWARD_FRACTION = 0.55
const HEIGHT_MIN = 50
const HEIGHT_MAX = 150
const SPACING_MIN = 60 // z gap between successive mountains on a side
const SPACING_MAX = 130

interface Placement {
  id: number
  side: number
  z: number
  rot: number
  height: number
}

/**
 * A low-poly mountain range lining both sides of the corridor — a natural
 * barrier outside the playable area (replaces the old translucent walls). Each
 * mountain is a random variant (1–20) from the LowPolyMountain pack, scattered
 * down each flank and instanced per variant.
 *
 * Every instance is pushed outward by its own bounding radius so its inner edge
 * sits at halfWidth + INNER_MARGIN — guaranteeing nothing pokes into the flight
 * path (the duck is clamped to ±halfWidth by physics). Deterministic from the
 * seed (salt 0xB). Render inside a <Suspense>.
 */
export function Mountains({ map }: { map: MapDef }) {
  const gl = useThree((s) => s.gl)

  // Per-material clipping planes (used below) require local clipping on.
  useEffect(() => {
    gl.localClippingEnabled = true
  }, [gl])

  // One material per side, each clipped at its corridor wall, so no mountain
  // geometry is ever drawn inside the playable area (|x| < halfWidth) — however
  // a rotated mountain's footprint overflows, the overflow is cut flush.
  const [matLeft, matRight] = useMemo(() => {
    const base = {
      vertexColors: true, // rock->snow gradient is baked per-vertex (see MountainGroup)
      roughness: 1,
      metalness: 0,
      flatShading: true, // keep the faceted low-poly look
      side: THREE.DoubleSide, // so the clipped openings aren't see-through
      clipShadows: true,
    }
    // Plane(normal, constant): a fragment is kept where normal·p + constant >= 0.
    const left = new THREE.MeshStandardMaterial({
      ...base,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(-1, 0, 0), -map.halfWidth)], // keep x <= -halfWidth
    })
    const right = new THREE.MeshStandardMaterial({
      ...base,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(1, 0, 0), -map.halfWidth)], // keep x >= halfWidth
    })
    return [left, right]
  }, [map.halfWidth])

  // Scatter placements down both sides, grouped by variant for instancing.
  // Grouped by variant AND side: each group instances one mesh and uses the
  // clipped material for its side.
  const groups = useMemo(() => {
    const rng = makeRng(deriveSeed(map.seed, 0xb))
    const byKey = new Map<string, Placement[]>()
    let id = 0
    for (const side of [-1, 1]) {
      let z = 0
      while (z <= map.length) {
        const variant = 1 + Math.floor(rng() * VARIANT_COUNT)
        const p: Placement = {
          id: id++,
          side,
          z,
          rot: rng() * Math.PI * 2,
          height: randRange(rng, HEIGHT_MIN, HEIGHT_MAX),
        }
        const key = `${variant}:${side}`
        const list = byKey.get(key)
        if (list) list.push(p)
        else byKey.set(key, [p])
        z += randRange(rng, SPACING_MIN, SPACING_MAX)
      }
    }
    return [...byKey.entries()].map(([key, placements]) => {
      const [variant, side] = key.split(':').map(Number)
      return { key, variant, side, placements }
    })
  }, [map.seed, map.length])

  return (
    <group>
      {groups.map((g) => (
        <MountainGroup
          key={g.key}
          variant={g.variant}
          placements={g.placements}
          material={g.side < 0 ? matLeft : matRight}
          halfWidth={map.halfWidth}
        />
      ))}
    </group>
  )
}

function MountainGroup({
  variant,
  placements,
  material,
  halfWidth,
}: {
  variant: number
  placements: Placement[]
  material: THREE.Material
  halfWidth: number
}) {
  const { geometry, baseHeight } = useFlattenedGeometry(fileFor(variant))

  // Bounding radius (in model units): half the larger horizontal dimension, so
  // the offset works for any yaw rotation.
  const radius = useMemo(() => {
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    return 0.5 * Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z)
  }, [geometry])

  // Clone the geometry and bake a height-based rock->snow gradient into vertex
  // colors (smooth snow line above SNOW_START of the model's height). Normalized
  // to the model's own height, so the snow caps stay proportional at any scale.
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
        const x = p.side * (halfWidth + radius * scale * OUTWARD_FRACTION)
        return (
          <Instance key={p.id} position={[x, 0, p.z]} rotation={[0, p.rot, 0]} scale={scale} />
        )
      })}
    </Instances>
  )
}
