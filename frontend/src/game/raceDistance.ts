/** Configurable solo race distance bounds (meters). */

export const RACE_DIST_MIN = 1000
export const RACE_DIST_MAX = 50000
export const RACE_DIST_DEFAULT = 2000
export const RACE_DIST_PRESETS = [1000, 2000, 5000, 10000] as const

export function clampRaceDistance(d: number): number {
  if (!Number.isFinite(d)) return RACE_DIST_DEFAULT
  return Math.max(RACE_DIST_MIN, Math.min(RACE_DIST_MAX, Math.round(d)))
}

export function formatRaceDistance(m: number): string {
  if (m >= 1000 && m % 1000 === 0) return `${m / 1000} km`
  return `${m.toLocaleString()} m`
}
