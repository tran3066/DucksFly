// Runtime-selectable backend server URL. Resolution order (highest wins):
//   1. ?server=<url> query param  (shareable per-backend links)
//   2. localStorage (remembers the player's last pick)
//   3. VITE_SERVER_URL (build-time default)
//   4. hardcoded fallback
//
// `SERVER_PRESETS` is the list the UI dropdown shows. Add your deployed backends here.

export interface ServerPreset {
  label: string
  url: string
}

const FALLBACK_URL = 'wss://ducksfly.fly.dev'

export const SERVER_PRESETS: ServerPreset[] = [
  { label: 'Fly (sjc)', url: 'wss://ducksfly.fly.dev' },
  { label: 'Local', url: 'ws://localhost:2567' },
]

const STORAGE_KEY = 'ducksfly.serverUrl'
const QUERY_KEY = 'server'

/** Coerce a user-typed value into a ws:// or wss:// URL (http→ws, https→wss). */
export function normalizeServerUrl(raw: string): string {
  const v = raw.trim()
  if (!v) return ''
  if (v.startsWith('ws://') || v.startsWith('wss://')) return v
  if (v.startsWith('https://')) return 'wss://' + v.slice('https://'.length)
  if (v.startsWith('http://')) return 'ws://' + v.slice('http://'.length)
  // bare host → assume secure
  return 'wss://' + v
}

function fromQuery(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const raw = new URLSearchParams(window.location.search).get(QUERY_KEY)
  return raw ? normalizeServerUrl(raw) : undefined
}

function fromStorage(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined
  } catch {
    return undefined
  }
}

function resolveInitial(): string {
  return (
    fromQuery() ??
    fromStorage() ??
    (import.meta.env.VITE_SERVER_URL as string | undefined) ??
    FALLBACK_URL
  )
}

let current = resolveInitial()
// Persist a query-param choice so it survives once the param is gone.
if (fromQuery()) setServerUrl(current)

export function getServerUrl(): string {
  return current
}

export function setServerUrl(url: string): void {
  const next = normalizeServerUrl(url)
  if (!next) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // ignore (private mode / disabled storage)
  }
}
