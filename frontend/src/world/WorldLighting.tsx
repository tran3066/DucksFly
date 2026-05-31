import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

/**
 * A time-of-day lighting preset. The standard low-poly rig: ONE directional
 * "sun" (the only shadow caster) + a hemisphere fill (sky above / ground below,
 * does most of the soft shading) + a small ambient floor. `exposure` is the
 * global brightness knob (renderer tone-mapping exposure). See docs/DESIGN.md §3.
 */
export interface LightingPreset {
  /** Direction TO the sun (normalized internally). Drives both the light angle and shadows. */
  sunDir: [number, number, number]
  sunColor: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  ambientColor: string
  ambientIntensity: number
  exposure: number
}

export const LIGHTING_PRESETS = {
  morning: {
    sunDir: [140, 55, 70],
    sunColor: '#ffe6bf',
    sunIntensity: 1.7,
    hemiSky: '#cfe7ff',
    hemiGround: '#e7dcc0',
    hemiIntensity: 0.9,
    ambientColor: '#e6f0ff',
    ambientIntensity: 0.7,
    exposure: 1.2,
  },
  day: {
    sunDir: [-40, 90, 30],
    sunColor: '#fff4d6',
    sunIntensity: 1.6,
    hemiSky: '#bcdcff',
    hemiGround: '#cdebc0',
    hemiIntensity: 0.8,
    ambientColor: '#cfe3ff',
    ambientIntensity: 0.5,
    exposure: 1.1,
  },
  sunset: {
    sunDir: [120, 16, 40],
    sunColor: '#ff9e5e',
    sunIntensity: 1.6,
    hemiSky: '#ffb98a',
    hemiGround: '#6a5a7a',
    hemiIntensity: 0.7,
    ambientColor: '#ffd9c0',
    ambientIntensity: 0.5,
    exposure: 1.15,
  },
} satisfies Record<string, LightingPreset>

export type PresetName = keyof typeof LIGHTING_PRESETS

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
