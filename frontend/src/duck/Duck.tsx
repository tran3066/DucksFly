import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { ThreeElements } from '@react-three/fiber'
import { loadDuck } from './loadDuck'
import type { ClipName, DuckVariant, LoadedDuck } from './loadDuck'

export type DuckProps = ThreeElements['group'] & {
  /** Texture variant. 'male' = green head, 'female' = brown. Default 'male'. */
  variant?: DuckVariant
  /** Animation clip to play. Changing this crossfades to the new clip. Default 'idle_1'. */
  clip?: ClipName
  /** Crossfade duration (seconds) when `clip` changes. Default 0.25. */
  fade?: number
  /**
   * Fires once the FBX is loaded, textured, and its clips are sliced. Use this
   * to grab the imperative handle (e.g. call `duck.play(...)` directly from a
   * fast input loop instead of re-rendering via the `clip` prop).
   */
  onReady?: (duck: LoadedDuck) => void
}

/**
 * React-three-fiber wrapper around the imperative `loadDuck` loader.
 *
 * Drop it inside a <Canvas>. Transform props (position / rotation / scale) pass
 * straight through to the wrapping <group>:
 *
 *   <Duck variant="male" clip="flight_straight" position={[0, 2, 0]} scale={0.5} />
 *
 * Drive it declaratively with the `clip` prop, or imperatively via `onReady`:
 *
 *   <Duck onReady={(d) => (duckRef.current = d)} />
 *   // later, from your MediaPipe/action loop:  duckRef.current?.play('flight_straight')
 */
export function Duck({
  variant = 'male',
  clip = 'idle_1',
  fade = 0.25,
  onReady,
  ...groupProps
}: DuckProps) {
  const [duck, setDuck] = useState<LoadedDuck | null>(null)
  const activeClip = useRef<ClipName | null>(null)

  // Load the model. Re-runs only when the variant changes (different texture).
  useEffect(() => {
    let cancelled = false
    let loaded: LoadedDuck | null = null

    loadDuck(variant).then((d) => {
      if (cancelled) {
        d.mixer.stopAllAction()
        return
      }
      loaded = d
      d.play(clip, 0) // snap to the starting clip, no crossfade
      activeClip.current = clip
      setDuck(d)
      onReady?.(d)
    })

    return () => {
      cancelled = true
      loaded?.mixer.stopAllAction()
      activeClip.current = null
      setDuck(null)
    }
    // `clip`/`onReady` are intentionally excluded: the initial clip is applied
    // once here, and live clip changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant])

  // Declarative clip switching after the model is ready.
  useEffect(() => {
    if (duck && clip !== activeClip.current) {
      duck.play(clip, fade)
      activeClip.current = clip
    }
  }, [duck, clip, fade])

  // Advance the animation mixer every frame.
  useFrame((_, delta) => {
    duck?.update(delta)
  })

  if (!duck) return null
  return (
    <group {...groupProps}>
      <primitive object={duck.scene} />
    </group>
  )
}
