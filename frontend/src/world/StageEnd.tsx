import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { loadDuck, type LoadedDuck } from './loadDuck'
import { Bush, Flowers, Grass, Mushroom, Rock, Tree } from './NatureProp'
import {
  BUSH_VARIANTS,
  FLOWER_VARIANTS,
  GRASS_VARIANTS,
  MUSHROOM_VARIANTS,
  ROCK_VARIANTS,
  TREE_VARIANTS,
} from './naturePack'
import { deriveSeed, makeRng, randRange, type MapDef } from '../map'

const POND_RADIUS = 110
const POND_BACK = 130 // pond center sits this far PAST the finish line (a clearing)
const WATER_Y = 1.6 // water surface, raised clear of the grass + wave troughs
const SHORE_PLANTS = 18
const SWIMMER_COUNT = 6
const SWIMMER_SCALE = 0.0001
const RIPPLE_COUNT = 6
const RIPPLE_MAX_R = 14
const RIPPLE_PERIOD = 3.2 // seconds per expand/fade cycle
const LILY_COUNT = 7

interface Pond {
  x: number
  z: number
  r: number
}

/**
 * Irregular pond outline: the base radius wobbled by a few sine harmonics so the
 * edge reads as a natural blob rather than a perfect circle. Deterministic (fixed
 * phases). Stays within ~[0.75, 1.25] x the base radius.
 */
function pondRadiusAt(theta: number, baseR: number): number {
  return (
    baseR *
    (1 + 0.13 * Math.sin(3 * theta + 0.6) + 0.07 * Math.sin(5 * theta + 2.1) + 0.05 * Math.sin(8 * theta + 4.2))
  )
}

/**
 * The "home pond" finish: an irregular water pool with animated ripples, lily
 * pads, and ducks swimming around in it, ringed with reeds/flowers. Render inside
 * a <Suspense> (the nature presets suspend; the swimming ducks load async).
 */
export function StageEnd({ map }: { map: MapDef }) {
  const pond = useMemo<Pond>(
    () => ({ x: 0, z: map.length + POND_BACK, r: POND_RADIUS }),
    [map.length],
  )
  const waterY = map.floorY + WATER_Y

  return (
    <group>
      <WaterSurface pond={pond} y={waterY} />

      <LilyPads pond={pond} y={waterY + 0.03} />
      <Ripples pond={pond} y={waterY + 0.02} />
      <ShorePlants pond={pond} floorY={map.floorY} />
      <ClearingFoliage pond={pond} map={map} />
      <Swimmers pond={pond} y={waterY} />
    </group>
  )
}

const WATER_TEXTURE =
  '/models/vector-seamless-rippled-swimming-pool-abstract-illustration-horizontally-vertically-repeatable_8130-2107.avif'
const WATER_TILE = 70 // world units per texture repeat

/**
 * Water surface: the pond's irregular outline as a flat plane, mapped with the
 * seamless rippled-water texture (tiled + slowly scrolling for motion).
 * ShapeGeometry UVs are raw shape coords, so repeat = 1/tileSize sets density.
 */
function WaterSurface({ pond, y }: { pond: Pond; y: number }) {
  const texture = useTexture(WATER_TEXTURE)

  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    const segments = 96
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      const r = pondRadiusAt(a, pond.r)
      const x = Math.cos(a) * r
      const yy = Math.sin(a) * r
      if (i === 0) shape.moveTo(x, yy)
      else shape.lineTo(x, yy)
    }
    return new THREE.ShapeGeometry(shape)
  }, [pond.r])

  useMemo(() => {
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.colorSpace = THREE.SRGBColorSpace
    texture.repeat.set(1 / WATER_TILE, 1 / WATER_TILE)
  }, [texture])

  useFrame((_, dt) => {
    texture.offset.x += dt * 0.01
    texture.offset.y += dt * 0.006
  })

  return (
    <mesh geometry={geometry} position={[pond.x, y, pond.z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshStandardMaterial map={texture} transparent opacity={0.92} roughness={0.3} metalness={0.15} />
    </mesh>
  )
}

/** Flat green lily pads scattered on the water. */
function LilyPads({ pond, y }: { pond: Pond; y: number }) {
  const pads = useMemo(
    () =>
      Array.from({ length: LILY_COUNT }, (_, i) => {
        const a = i * 2.39996 // golden angle → even-ish scatter
        const rr = pond.r * 0.15 + (i / LILY_COUNT) * pond.r * 0.45
        return {
          pos: [pond.x + Math.cos(a) * rr, y, pond.z + Math.sin(a) * rr] as [number, number, number],
          s: 3 + (i % 3),
        }
      }),
    [pond, y],
  )

  return (
    <group>
      {pads.map((p, i) => (
        <mesh key={i} position={p.pos} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[p.s, 14]} />
          <meshStandardMaterial color="#3f8f4e" roughness={0.85} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  )
}

/** Expanding/fading rings on the water surface. */
function Ripples({ pond, y }: { pond: Pond; y: number }) {
  const refs = useRef<THREE.Mesh[]>([])

  const ripples = useMemo(
    () =>
      Array.from({ length: RIPPLE_COUNT }, (_, i) => {
        const a = (i / RIPPLE_COUNT) * Math.PI * 2
        const rr = pond.r * (0.15 + 0.45 * ((i * 0.37) % 1)) // scattered, kept well inside
        return {
          x: pond.x + Math.cos(a) * rr,
          z: pond.z + Math.sin(a) * rr,
          offset: (i / RIPPLE_COUNT) * RIPPLE_PERIOD, // stagger the cycles
        }
      }),
    [pond],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    ripples.forEach((rp, i) => {
      const mesh = refs.current[i]
      if (!mesh) return
      const phase = ((t + rp.offset) % RIPPLE_PERIOD) / RIPPLE_PERIOD
      const s = 0.001 + phase * RIPPLE_MAX_R
      mesh.scale.set(s, s, 1)
      ;(mesh.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.5
    })
  })

  return (
    <group>
      {ripples.map((rp, i) => (
        <mesh
          key={i}
          ref={(m) => {
            if (m) refs.current[i] = m
          }}
          position={[rp.x, y, rp.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.82, 1, 28]} />
          <meshBasicMaterial color="#eaf6ff" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

type FoliageKind = 'tree' | 'rock' | 'bush' | 'flowers' | 'grass' | 'mushroom'

interface FoliageItemData {
  id: number
  kind: FoliageKind
  vi: number // variant index (mod into the kind's variant list)
  pos: [number, number, number]
  rot: number
  scale?: number // override the preset's default scale (used to enlarge trees)
}

interface FoliageSpec {
  kind: FoliageKind
  count: number
  /** Keep-out distance from the water's edge (bigger for wide things like trees). */
  margin: number
  /** Optional scale range to override the preset default (trees read too small otherwise). */
  scaleMin?: number
  scaleMax?: number
}

const CLEARING_FOLIAGE: FoliageSpec[] = [
  { kind: 'tree', count: 20, margin: 40, scaleMin: 0.06, scaleMax: 0.11 },
  { kind: 'rock', count: 7, margin: 12 },
  { kind: 'bush', count: 7, margin: 10 },
  { kind: 'flowers', count: 9, margin: 6 },
  { kind: 'grass', count: 11, margin: 6 },
  { kind: 'mushroom', count: 5, margin: 6 },
]

/**
 * Varied foliage scattered through the clearing around the pond (trees, rocks,
 * bushes, flowers, grass, mushrooms). Rejection-sampled to avoid the water and
 * stay inside the corridor width + before the back wall. Deterministic (salt 0xE).
 */
function ClearingFoliage({ pond, map }: { pond: Pond; map: MapDef }) {
  const items = useMemo(() => {
    const rng = makeRng(deriveSeed(map.seed, 0xe))
    const halfX = map.halfWidth - 8
    const zMin = map.length + 6
    const zMax = map.length + 275 // before the wrap-around back wall
    const out: FoliageItemData[] = []
    let id = 0
    for (const spec of CLEARING_FOLIAGE) {
      let placed = 0
      for (let guard = 0; placed < spec.count && guard < spec.count * 30; guard++) {
        const x = randRange(rng, -halfX, halfX)
        const z = randRange(rng, zMin, zMax)
        const dx = x - pond.x
        const dz = z - pond.z
        // Reject anything within the water plus this kind's keep-out margin.
        if (Math.hypot(dx, dz) < pondRadiusAt(Math.atan2(dz, dx), pond.r) + spec.margin) continue
        const scale =
          spec.scaleMin != null ? randRange(rng, spec.scaleMin, spec.scaleMax ?? spec.scaleMin) : undefined
        out.push({
          id: id++,
          kind: spec.kind,
          vi: Math.floor(rng() * 97),
          pos: [x, map.floorY, z],
          rot: rng() * Math.PI * 2,
          scale,
        })
        placed++
      }
    }
    return out
  }, [pond, map.seed, map.length, map.halfWidth, map.floorY])

  return (
    <group>
      {items.map((it) => (
        <FoliageItem key={it.id} item={it} />
      ))}
    </group>
  )
}

/** Render one foliage item, picking a typed variant from its kind's list. */
function FoliageItem({ item }: { item: FoliageItemData }) {
  const { kind, vi, pos, rot, scale } = item
  // Only pass scale when set, so unset kinds keep their preset default.
  const common = {
    position: pos,
    rotation: [0, rot, 0] as [number, number, number],
    ...(scale != null ? { scale } : {}),
  }
  switch (kind) {
    case 'tree':
      return <Tree variant={TREE_VARIANTS[vi % TREE_VARIANTS.length]} {...common} />
    case 'rock':
      return <Rock variant={ROCK_VARIANTS[vi % ROCK_VARIANTS.length]} {...common} />
    case 'bush':
      return <Bush variant={BUSH_VARIANTS[vi % BUSH_VARIANTS.length]} {...common} />
    case 'flowers':
      return <Flowers variant={FLOWER_VARIANTS[vi % FLOWER_VARIANTS.length]} {...common} />
    case 'grass':
      return <Grass variant={GRASS_VARIANTS[vi % GRASS_VARIANTS.length]} {...common} />
    case 'mushroom':
      return <Mushroom variant={MUSHROOM_VARIANTS[vi % MUSHROOM_VARIANTS.length]} {...common} />
    default:
      return null
  }
}

/** A ring of grass + flowers following the pond's irregular edge. */
function ShorePlants({ pond, floorY }: { pond: Pond; floorY: number }) {
  const spots = useMemo(
    () =>
      Array.from({ length: SHORE_PLANTS }, (_, i) => {
        const a = (i / SHORE_PLANTS) * Math.PI * 2
        const r = pondRadiusAt(a, pond.r) + (i % 2 === 0 ? 2 : 8) // hug the wobbly edge
        return {
          i,
          pos: [pond.x + Math.cos(a) * r, floorY, pond.z + Math.sin(a) * r] as [number, number, number],
          rot: a,
        }
      }),
    [pond, floorY],
  )

  return (
    <group>
      {spots.map((s) =>
        s.i % 3 === 0 ? (
          <Flowers key={s.i} position={s.pos} rotation={[0, s.rot, 0]} />
        ) : (
          <Grass key={s.i} position={s.pos} rotation={[0, s.rot, 0]} />
        ),
      )}
    </group>
  )
}

interface Swimmer {
  scene: THREE.Group
  mixer: THREE.AnimationMixer
  radius: number
  speed: number // signed angular speed (rad/s)
  angle: number
}

/** Ducks paddling in slow circles on the pond surface (kept inside the edge). */
function Swimmers({ pond, y }: { pond: Pond; y: number }) {
  const swimmers = useRef<Swimmer[]>([])
  const [, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([loadDuck('male'), loadDuck('female')]).then(([male, female]) => {
      if (cancelled) return
      const sources: LoadedDuck[] = [male, female]
      const list: Swimmer[] = []
      for (let i = 0; i < SWIMMER_COUNT; i++) {
        const src = sources[i % sources.length]
        const scene = cloneSkinned(src.scene) as THREE.Group
        scene.scale.setScalar(SWIMMER_SCALE)
        const mixer = new THREE.AnimationMixer(scene)
        mixer.clipAction(src.clips['swim_straight']).play()
        list.push({
          scene,
          mixer,
          // Stay within ~0.6 R so circles never cross the narrowest part of the edge.
          radius: 22 + (i / SWIMMER_COUNT) * (pond.r * 0.6 - 22),
          speed: (i % 2 === 0 ? 1 : -1) * (0.05 + 0.02 * (i % 3)),
          angle: (i / SWIMMER_COUNT) * Math.PI * 2,
        })
      }
      swimmers.current = list
      setReady(true)
    })
    return () => {
      cancelled = true
      swimmers.current = []
    }
  }, [pond])

  useFrame((_, dt) => {
    for (const s of swimmers.current) {
      s.angle += s.speed * dt
      s.scene.position.set(pond.x + Math.cos(s.angle) * s.radius, y, pond.z + Math.sin(s.angle) * s.radius)
      const dir = s.speed >= 0 ? 1 : -1
      s.scene.rotation.y = Math.atan2(-Math.sin(s.angle) * dir, Math.cos(s.angle) * dir)
      s.mixer.update(dt)
    }
  })

  return (
    <group>
      {swimmers.current.map((s, i) => (
        <primitive key={i} object={s.scene} />
      ))}
    </group>
  )
}
