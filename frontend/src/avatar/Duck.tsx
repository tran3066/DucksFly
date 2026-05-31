// The real rigged mallard, animated from DuckActions. (Person A, Step 08.1)
//
// Loads the duck once, then every frame:
//  - reads the latest DuckActions from a ref (no React re-renders in the loop),
//  - picks the clip via the pure animationMap,
//  - crossfades only when the clip actually changes,
//  - advances the animation mixer.
//
// Position/rotation are driven from the outside (the playground sets them from
// Person C's physics), so this component is purely "show the duck + animate it".

import { forwardRef, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Box3, Group, Vector3 } from 'three'
import { loadDuck, type LoadedDuck, type DuckVariant } from './loadDuck'
import { pickClip, DEFAULT_ANIM_MAP, type AnimMapConfig } from './animationMap'
import type { DuckActions } from '../physics'

// Auto-fit target: the duck's longest dimension is normalized to this many world
// units on load, so the raw FBX scale (which is huge) no longer matters. The
// `scale` prop is then a clean multiplier on top (1 = the fitted size).
const TARGET_SIZE = 2.5

export interface DuckProps {
  /** Latest player intent. Read every frame from this ref. */
  actionsRef: React.RefObject<DuckActions>
  variant?: DuckVariant
  /** Multiplier on the auto-fitted size. 1 = duck is ~TARGET_SIZE units. Reactive. */
  scale?: number
  /** Static yaw offset (radians) so the model's nose aligns with +Z. Reactive. */
  modelYaw?: number
  /** Animation-mapping thresholds. */
  animCfg?: AnimMapConfig
  /** Crossfade time between clips, seconds. */
  crossfade?: number
  /** Optional: the currently playing clip name is written here each frame (for HUDs). */
  clipRef?: React.RefObject<string>
}

/**
 * The outer ref is the Group you position/rotate from the parent. The duck mesh
 * is added as a child once it finishes loading.
 */
export const Duck = forwardRef<Group, DuckProps>(function Duck(
  {
    actionsRef,
    variant = 'male',
    scale = 1,
    modelYaw = 0,
    animCfg = DEFAULT_ANIM_MAP,
    crossfade = 0.25,
    clipRef,
  },
  ref,
) {
  const innerRef = useRef<Group | null>(null)
  const duckRef = useRef<LoadedDuck | null>(null)
  const currentClip = useRef<string>('')
  // Base scale that normalizes the FBX to TARGET_SIZE, plus the raw (unscaled)
  // center/floor so we can recenter correctly at any scale multiplier.
  const fit = useRef({ scale: 1, cx: 0, cz: 0, minY: 0 })

  // Load the duck once per variant (and clean it up on unmount). Scale and yaw
  // are applied every frame instead, so their sliders are reactive without
  // reloading the FBX.
  useEffect(() => {
    let cancelled = false
    loadDuck(variant)
      .then((duck) => {
        if (cancelled) return
        // Auto-fit: measure the raw model and derive a base scale so its largest
        // dimension is TARGET_SIZE, then recenter it on its own origin so the
        // physics position drives a sensible pivot (not a far corner).
        const box = new Box3().setFromObject(duck.scene)
        const size = box.getSize(new Vector3())
        const center = box.getCenter(new Vector3())
        const maxDim = Math.max(size.x, size.y, size.z) || 1
        fit.current = {
          scale: TARGET_SIZE / maxDim,
          cx: center.x,
          cz: center.z,
          minY: box.min.y,
        }
        duckRef.current = duck
        innerRef.current?.add(duck.scene)
        duck.play('idle_1', 0)
        currentClip.current = 'idle_1'
      })
      .catch((err) => console.error('[Duck] failed to load:', err))
    return () => {
      cancelled = true
      const d = duckRef.current
      if (d && innerRef.current) innerRef.current.remove(d.scene)
      duckRef.current = null
    }
  }, [variant])

  useFrame((_, dt) => {
    const duck = duckRef.current
    if (!duck) return
    // Reactive transform tuning: slider multiplies the auto-fitted base scale.
    // Recenter every frame at the current scale so the pivot stays on the duck's
    // center (x,z) with its base at y=0, regardless of the multiplier.
    const s = fit.current.scale * scale
    duck.scene.scale.setScalar(s)
    duck.scene.position.set(-fit.current.cx * s, -fit.current.minY * s, -fit.current.cz * s)
    duck.scene.rotation.y = modelYaw
    // Animation: crossfade only when the chosen clip changes.
    const want = pickClip(actionsRef.current, animCfg)
    if (want !== currentClip.current) {
      duck.play(want, crossfade)
      currentClip.current = want
      if (clipRef) clipRef.current = want
    }
    duck.update(dt)
  })

  // Bridge the forwarded ref to our inner group.
  return (
    <group
      ref={(g) => {
        innerRef.current = g
        if (typeof ref === 'function') ref(g)
        else if (ref) ref.current = g
      }}
    />
  )
})
