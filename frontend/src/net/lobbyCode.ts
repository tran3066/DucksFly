// Lobby invite codes (client side). The host generates a short code and creates a room
// with it; joiners pass the same code so Colyseus matchmaking (filterBy "code") routes
// them to that exact room. Codes are also shareable as a `?room=CODE&server=...` link.

import { getServerUrl } from './serverConfig'

/** Unambiguous alphabet — no 0/O/1/I/L — matches the server's fallback generator. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Length of a generated code. */
export const CODE_LENGTH = 4

/** Generate a fresh, human-friendly lobby code (e.g. "K7QF"). */
export function generateLobbyCode(length: number = CODE_LENGTH): string {
  let code = ''
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

/**
 * Coerce arbitrary user input into a clean code. Accepts a bare code ("k7qf"), or a pasted
 * share link / URL containing `?room=CODE`. Uppercases and strips characters outside the
 * code alphabet. Returns "" if nothing usable remains.
 */
export function normalizeCode(raw: string): string {
  if (!raw) return ''
  let value = raw.trim()

  // Pull the code out of a pasted URL / query string if present.
  const match = value.match(/[?&]room=([^&\s]+)/i)
  if (match) value = match[1]

  const allowed = new RegExp(`[^${CODE_ALPHABET}]`, 'g')
  return value.toUpperCase().replace(allowed, '').slice(0, CODE_LENGTH)
}

/** Read an initial code from the page URL's `?room=` param (for shared links). */
export function getInitialRoomCode(): string {
  if (typeof window === 'undefined') return ''
  const raw = new URLSearchParams(window.location.search).get('room')
  return raw ? normalizeCode(raw) : ''
}

/** Build a shareable link that routes joiners to this lobby on the same backend. */
export function buildShareLink(code: string): string {
  if (typeof window === 'undefined') return code
  const url = new URL(window.location.href)
  url.searchParams.set('room', code)
  // Always embed the backend URL — lobbies live in-memory on one server process, so a
  // link with only `?room=` fails when the joiner's default server differs from the host's.
  url.searchParams.set('server', getServerUrl())
  return url.toString()
}
