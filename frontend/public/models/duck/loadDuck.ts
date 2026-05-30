import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

// Sits next to the model so the asset is self-contained. Move into src/ if you
// prefer; just fix the fetch path to animations.json below.
import clipData from './animations.json'

const BASE = '/models/duck'
const FBX_URL = `${BASE}/mallard-duck.fbx`
const TEX = {
  male: `${BASE}/mallard-male.png`,
  female: `${BASE}/mallard-female.png`,
} as const

export type DuckVariant = keyof typeof TEX
export type ClipName = (typeof clipData)['clips'][number]['name']

export interface LoadedDuck {
  /** The rigged mesh. Add this to your scene / R3F <primitive object={...} />. */
  scene: THREE.Group
  mixer: THREE.AnimationMixer
  /** Named sub-clips, sliced out of the single FBX take. */
  clips: Record<ClipName, THREE.AnimationClip>
  /** Crossfade to a clip. Loops cyclic clips, plays one-shots once (clamped). */
  play: (name: ClipName, fade?: number) => THREE.AnimationAction
  /** Call every frame with the frame delta (seconds). */
  update: (dt: number) => void
}

let cachedTextures: Partial<Record<DuckVariant, THREE.Texture>> = {}

function loadTexture(variant: DuckVariant): THREE.Texture {
  if (cachedTextures[variant]) return cachedTextures[variant]!
  const tex = new THREE.TextureLoader().load(TEX[variant])
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false // FBX UVs expect unflipped textures
  tex.magFilter = THREE.NearestFilter // 32x32 atlas — keep the low-poly crisp look
  tex.minFilter = THREE.NearestFilter
  cachedTextures[variant] = tex
  return tex
}

/**
 * Loads the mallard FBX, applies the chosen variant texture (the FBX does NOT
 * embed it), and re-slices the single 1812-frame take into the 22 named clips.
 *
 * @example
 *   const duck = await loadDuck('male')
 *   scene.add(duck.scene)
 *   duck.play('idle_1')
 *   // in your render loop: duck.update(delta)
 *   // on flap detected:    duck.play('flight_straight')
 */
export async function loadDuck(variant: DuckVariant = 'male'): Promise<LoadedDuck> {
  const fbx = await new FBXLoader().loadAsync(FBX_URL)
  const texture = loadTexture(variant)

  fbx.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      mesh.castShadow = true
      mesh.receiveShadow = true
      const apply = (m: THREE.Material) => {
        const std = m as THREE.MeshStandardMaterial
        std.map = texture
        std.metalness = 0
        std.roughness = 0.8
        std.needsUpdate = true
      }
      Array.isArray(mesh.material) ? mesh.material.forEach(apply) : apply(mesh.material)
    }
  })

  // FBXLoader returns the whole take as animations[0]. Derive the true fps from
  // its duration so subclip frame ranges line up regardless of source fps.
  const master = fbx.animations[0]
  if (!master) throw new Error('Mallard FBX has no animation take')
  const fps = Math.round(clipData.totalFrames / master.duration)

  const clips = {} as Record<ClipName, THREE.AnimationClip>
  const loopByName = {} as Record<ClipName, boolean>
  for (const c of clipData.clips) {
    const sub = THREE.AnimationUtils.subclip(master, c.name, c.start, c.end, fps)
    sub.name = c.name
    clips[c.name as ClipName] = sub
    loopByName[c.name as ClipName] = c.loop
  }

  const mixer = new THREE.AnimationMixer(fbx)
  let current: THREE.AnimationAction | null = null

  const play = (name: ClipName, fade = 0.25): THREE.AnimationAction => {
    const next = mixer.clipAction(clips[name])
    next.reset()
    if (loopByName[name]) {
      next.setLoop(THREE.LoopRepeat, Infinity)
    } else {
      next.setLoop(THREE.LoopOnce, 1)
      next.clampWhenFinished = true
    }
    if (current && current !== next) current.crossFadeTo(next, fade, false)
    next.play()
    current = next
    return next
  }

  return { scene: fbx, mixer, clips, play, update: (dt) => mixer.update(dt) }
}
