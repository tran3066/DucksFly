// Src-side duck loader. (Person A)
//
// Adapted from the original public/models/duck/loadDuck.ts. The animation split
// (animations.json) is IMPORTED from src/world/, the team's single source for it
// after the teammate moved it out of public/ during the duck refactor. The FBX
// and PNGs are still served from public/ at the site root, so their absolute URLs
// below resolve correctly in dev and in a build.
//
// Why a custom loader at all: the FBX ships ONE long take and its textures are
// NOT embedded. This applies the variant PNG and re-slices the single take into
// named clips using animations.json. See the model README in public/.

import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import animData from '../world/animations.json'

const BASE = '/models/duck'
const FBX_URL = `${BASE}/mallard-duck.fbx`
const TEX = {
  male: `${BASE}/mallard-male.png`,
  female: `${BASE}/mallard-female.png`,
} as const

export type DuckVariant = keyof typeof TEX

interface ClipDef {
  name: string
  start: number
  end: number
  loop: boolean
  group: string
}
interface AnimData {
  totalFrames: number
  take: string
  clips: ClipDef[]
}

export interface LoadedDuck {
  /** The rigged mesh. Add to the scene, or wrap in <primitive object={...}/>. */
  scene: THREE.Group
  mixer: THREE.AnimationMixer
  /** Named sub-clips sliced out of the single FBX take. */
  clips: Record<string, THREE.AnimationClip>
  /** Whether each clip should loop (true) or play once (false). */
  loops: Record<string, boolean>
  /** Crossfade to a clip. Loops or one-shots based on the clip's loop flag. */
  play: (name: string, fade?: number) => THREE.AnimationAction | undefined
  /** Call every frame with the frame delta (seconds). */
  update: (dt: number) => void
}

const textureCache: Partial<Record<DuckVariant, THREE.Texture>> = {}

function loadTexture(variant: DuckVariant): THREE.Texture {
  const cached = textureCache[variant]
  if (cached) return cached
  const tex = new THREE.TextureLoader().load(TEX[variant])
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false // FBX UVs expect unflipped textures
  tex.magFilter = THREE.NearestFilter // keep the 32x32 low-poly atlas crisp
  tex.minFilter = THREE.NearestFilter
  textureCache[variant] = tex
  return tex
}

/**
 * Load the mallard, apply the variant texture, and slice the single take into
 * named clips from animations.json.
 *
 * @example
 *   const duck = await loadDuck('male')
 *   scene.add(duck.scene)
 *   duck.play('idle_1')
 *   // each frame: duck.update(delta)
 */
export async function loadDuck(variant: DuckVariant = 'male'): Promise<LoadedDuck> {
  const fbx = await new FBXLoader().loadAsync(FBX_URL)
  const anim = animData as AnimData

  const texture = loadTexture(variant)
  fbx.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    const apply = (m: THREE.Material) => {
      const std = m as THREE.MeshStandardMaterial
      std.map = texture
      std.metalness = 0
      std.roughness = 0.8
      std.needsUpdate = true
    }
    if (Array.isArray(mesh.material)) mesh.material.forEach(apply)
    else apply(mesh.material)
  })

  const master = fbx.animations[0]
  if (!master) throw new Error('Mallard FBX has no animation take')
  const fps = Math.round(anim.totalFrames / master.duration)

  const clips: Record<string, THREE.AnimationClip> = {}
  const loops: Record<string, boolean> = {}
  for (const c of anim.clips) {
    const sub = THREE.AnimationUtils.subclip(master, c.name, c.start, c.end, fps)
    sub.name = c.name
    clips[c.name] = sub
    loops[c.name] = c.loop
  }

  const mixer = new THREE.AnimationMixer(fbx)
  let current: THREE.AnimationAction | null = null

  const play = (name: string, fade = 0.25) => {
    const clip = clips[name]
    if (!clip) return undefined
    const next = mixer.clipAction(clip)
    next.reset()
    if (loops[name]) {
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

  return { scene: fbx, mixer, clips, loops, play, update: (dt) => mixer.update(dt) }
}
