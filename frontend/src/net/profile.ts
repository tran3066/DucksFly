// Persisted player identity so the name (and duck choice) only has to be entered once.
// Saved to localStorage and reused on every lobby join.

import type { DuckVariant } from '../avatar/loadDuck'

export interface PlayerProfile {
  name: string
  variant: DuckVariant
}

const NAME_KEY = 'ducksfly.playerName'
const VARIANT_KEY = 'ducksfly.duckVariant'

/** A friendly random fallback name when the player hasn't chosen one yet. */
export function randomName(): string {
  return `Duck-${Math.floor(1000 + Math.random() * 9000)}`
}

/** Read the saved profile, falling back to a random name + male duck. */
export function getProfile(): PlayerProfile {
  let name = ''
  let variant: DuckVariant = 'male'
  try {
    name = localStorage.getItem(NAME_KEY) ?? ''
    variant = localStorage.getItem(VARIANT_KEY) === 'female' ? 'female' : 'male'
  } catch {
    // ignore (private mode / disabled storage)
  }
  return { name: name || randomName(), variant }
}

/** True once the player has explicitly saved a name (so we can skip the name prompt). */
export function hasSavedName(): boolean {
  try {
    return !!localStorage.getItem(NAME_KEY)?.trim()
  } catch {
    return false
  }
}

/** Persist the player's chosen name + duck for next time. */
export function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(NAME_KEY, profile.name)
    localStorage.setItem(VARIANT_KEY, profile.variant)
  } catch {
    // ignore
  }
}
