// Time-of-day lighting presets, kept out of WorldLighting.tsx so that file only
// exports a component (react-refresh/only-export-components).

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
