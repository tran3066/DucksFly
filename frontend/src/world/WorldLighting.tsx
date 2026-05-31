import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { LIGHTING_PRESETS, type LightingPreset, type PresetName } from './lightingPresets'

export interface WorldLightingProps {
  /** Named time-of-day preset, or a full custom preset object. Default 'day'. */
  preset?: PresetName | LightingPreset
  /** Whether the sun casts shadows (the only shadow caster). Default true. */
  castShadow?: boolean
  /** Distance to place the directional light along its direction (sets shadow-cam origin). */
  sunDistance?: number
  /** Half-extent (world units) of the orthographic shadow frustum around the origin. */
  shadowExtent?: number
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
}: WorldLightingProps) {
  const p = typeof preset === 'string' ? LIGHTING_PRESETS[preset] : preset
  const gl = useThree((s) => s.gl)

  // Global brightness: drive the renderer's tone-mapping exposure. Restore the
  // previous value on unmount so swapping scenes doesn't leak exposure.
  useEffect(() => {
    const prev = gl.toneMappingExposure
    gl.toneMappingExposure = p.exposure
    return () => {
      gl.toneMappingExposure = prev
    }
  }, [gl, p.exposure])

  // Place the sun along its (normalized) direction at the given distance.
  const sunPos = useMemo<[number, number, number]>(() => {
    const d = new THREE.Vector3(...p.sunDir).normalize().multiplyScalar(sunDistance)
    return [d.x, d.y, d.z]
  }, [p.sunDir, sunDistance])

  return (
    <>
      <ambientLight color={p.ambientColor} intensity={p.ambientIntensity} />
      <hemisphereLight args={[p.hemiSky, p.hemiGround, p.hemiIntensity]} />
      <directionalLight
        color={p.sunColor}
        intensity={p.sunIntensity}
        position={sunPos}
        castShadow={castShadow}
        shadow-mapSize={[2048, 2048]}
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
