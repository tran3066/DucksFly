import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Instance, Instances, useFBX } from '@react-three/drei'
import { useFlattenedGeometry } from './useFlattenedGeometry'
import { deriveSeed, makeRng, randRange, type MapDef } from '../map'
import { SKY_HORIZON, SKY_TOP, SUN_COLOR, SUN_DIR } from '../theme/palette'

const SKY_DIR = '/models/SimpleSky'
const DOME_FILE = `${SKY_DIR}/SkyDome.fbx`

const sunDirection = new THREE.Vector3(...SUN_DIR).normalize()

/** Clear blue sky gradient (replaces the dark baked SimpleSky.png). */
function createSkyGradientTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
  grad.addColorStop(0, SKY_TOP)
  grad.addColorStop(0.55, '#7EC8FF')
  grad.addColorStop(1, SKY_HORIZON)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  return tex
}

const DOME_RADIUS = 2500 // world units; must stay inside the camera's far plane
const CLOUD_VARIANTS = [1, 2, 3, 4, 5, 6] as const

/**
 * The SimpleSky skybox: a textured dome that follows the camera (so the horizon
 * stays at infinity) plus seed-scattered low-poly clouds. Render inside a
 * <Suspense> — the FBX + texture loaders suspend while loading.
 */
export function SimpleSky({ map }: { map: MapDef }) {
  return (
    <>
      <SkyDome />
      <SunDisc />
      <Clouds map={map} />
    </>
  )
}

/** Painted sun disc, locked to the same direction as the directional light. */
function SunDisc() {
  const ref = useRef<THREE.Group>(null)

  useFrame(({ camera }) => {
    if (!ref.current) return
    ref.current.position
      .copy(camera.position)
      .add(sunDirection.clone().multiplyScalar(DOME_RADIUS * 0.93))
    ref.current.lookAt(camera.position)
  })

  return (
    <group ref={ref}>
      <mesh renderOrder={-1}>
        <circleGeometry args={[220, 32]} />
        <meshBasicMaterial
          color="#fff9eb"
          transparent
          opacity={0.45}
          toneMapped={false}
          fog={false}
          depthWrite={false}
        />
      </mesh>
      <mesh renderOrder={-1}>
        <circleGeometry args={[95, 32]} />
        <meshBasicMaterial color={SUN_COLOR} toneMapped={false} fog={false} depthWrite={false} />
      </mesh>
    </group>
  )
}

function SkyDome() {
  const fbx = useFBX(DOME_FILE)
  const ref = useRef<THREE.Group>(null)

  const dome = useMemo(() => {
    const tex = createSkyGradientTexture()
    tex.flipY = false // FBX UVs; flip to true if the gradient renders upside-down

    const root = fbx.clone(true)
    // Center on origin so, parented to the camera, it surrounds the viewer.
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    root.position.sub(center)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = (DOME_RADIUS * 2) / maxDim

    const material = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.BackSide, // we view it from the inside
      fog: false,
      depthWrite: false, // always behind everything; never occludes the scene
      toneMapped: false,
    })
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.material = material
        mesh.renderOrder = -1
      }
    })
    return { root, scale }
  }, [fbx])

  // Follow the camera so the sky never gets closer / never falls behind.
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position)
  })

  return (
    <group ref={ref}>
      <primitive object={dome.root} scale={dome.scale} />
    </group>
  )
}

interface CloudItem {
  id: number
  variant: number
  pos: [number, number, number]
  rotationY: number
  height: number
}

function Clouds({ map }: { map: MapDef }) {
  // Soft white clouds, lit gently by the scene. fog off so they don't fade oddly.
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0, fog: false }),
    [],
  )

  // Deterministic from the map seed (salt 0xC): same seed -> same sky.
  const groups = useMemo(() => {
    const rng = makeRng(deriveSeed(map.seed, 0xc))
    const count = Math.round(map.length / 40) // ~50 over a 2 km track
    const byVariant = new Map<number, CloudItem[]>()
    for (let i = 0; i < count; i++) {
      const item: CloudItem = {
        id: i,
        variant: 1 + Math.floor(rng() * CLOUD_VARIANTS.length),
        pos: [
          randRange(rng, -map.halfWidth * 1.3, map.halfWidth * 1.3),
          randRange(rng, map.ceiling * 0.8, map.ceiling * 1.2),
          randRange(rng, 0, map.length),
        ],
        rotationY: rng() * Math.PI * 2,
        height: randRange(rng, 22, 55),
      }
      const list = byVariant.get(item.variant)
      if (list) list.push(item)
      else byVariant.set(item.variant, [item])
    }
    return [...byVariant.entries()]
  }, [map.seed, map.length, map.halfWidth, map.ceiling])

  return (
    <group>
      {groups.map(([variant, items]) => (
        <CloudGroup key={variant} variant={variant} items={items} material={material} />
      ))}
    </group>
  )
}

function CloudGroup({
  variant,
  items,
  material,
}: {
  variant: number
  items: CloudItem[]
  material: THREE.Material
}) {
  const { geometry, baseHeight } = useFlattenedGeometry(`${SKY_DIR}/Cloud_0${variant}.fbx`)
  return (
    <Instances geometry={geometry} material={material} limit={items.length} castShadow receiveShadow>
      {items.map((it) => (
        <Instance
          key={it.id}
          position={it.pos}
          rotation={[0, it.rotationY, 0]}
          scale={it.height / baseHeight}
        />
      ))}
    </Instances>
  )
}
