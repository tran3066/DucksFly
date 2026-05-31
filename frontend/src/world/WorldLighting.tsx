import { useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { LIGHTING_PRESETS, type LightingPreset, type PresetName } from './lightingPresets'

/** Anything with a world-space position the sun shadows should stay centered on. */
export interface ShadowCenter {
  position: [number, number, number]
}

export interface WorldLightingProps {
  /** Named time-of-day preset, or a full custom preset object. Default 'day'. */
  preset?: PresetName | LightingPreset
  /** Whether the sun casts shadows (the only shadow caster). Default true. */
  castShadow?: boolean
  /** Distance to place the directional light along its direction (sets shadow-cam origin). */
  sunDistance?: number
  /** Half-extent (world units) of the orthographic shadow frustum around the follow point. */
  shadowExtent?: number
  /** When set, the sun + shadow camera track this point (e.g. the local duck). */
  followRef?: RefObject<ShadowCenter | null>
}

/**
 * Reusable scene lighting. Drop one inside any <Canvas> (the duck preview, the
 * map sandbox, the real game scene) so every view shares one consistent look.
 *
 *   <WorldLighting preset="morning" />
 *
 * NOTE: the SimpleSky dome is an unlit baked texture, so it does NOT react to
 * this — keep each preset's `sunDir` pointed at the dome's bright spot so the
 * shadows agree with where the painted sun appears to be.
 */
export function WorldLighting({
  preset = 'day',
  castShadow = true,
  sunDistance = 120,
  shadowExtent = 120,
  followRef,
}: WorldLightingProps) {
  const p = typeof preset === 'string' ? LIGHTING_PRESETS[preset] : preset
  const gl = useThree((s) => s.gl)
  const sunLightRef = useRef<THREE.DirectionalLight>(null)
  const sunOffset = useMemo(
    () => new THREE.Vector3(...p.sunDir).normalize().multiplyScalar(sunDistance),
    [p.sunDir, sunDistance],
  )
  const center = useMemo(() => new THREE.Vector3(), [])

  // Global brightness: drive the renderer's tone-mapping exposure. Restore the
  // previous value on unmount so swapping scenes doesn't leak exposure.
  useEffect(() => {
    const prev = gl.toneMappingExposure
    gl.toneMappingExposure = p.exposure
    return () => {
      gl.toneMappingExposure = prev
    }
  }, [gl, p.exposure])

  // Keep the sun and its shadow frustum over the follow target (local duck).
  useFrame(() => {
    const light = sunLightRef.current
    if (!light) return
    const follow = followRef?.current
    if (follow) center.set(follow.position[0], follow.position[1], follow.position[2])
    else center.set(0, 0, 0)
    light.position.copy(center).add(sunOffset)
    light.target.position.copy(center)
    light.target.updateMatrixWorld()
  })

  return (
    <>
      <ambientLight color={p.ambientColor} intensity={p.ambientIntensity} />
      <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemiIntensity]} />
      <directionalLight
        ref={sunLightRef}
        color={p.sunColor}
        intensity={p.sunIntensity}
        castShadow={castShadow}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0002}
        shadow-camera-near={1}
        shadow-camera-far={sunDistance * 3}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
      />
    </>
  )
}
