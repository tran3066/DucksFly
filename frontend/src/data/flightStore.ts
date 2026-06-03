// SINGLE OWNER of all flight-stats persistence (the v2 HARD RULE).
//
// No other file may read/write this JSON, import its localStorage key, or
// re-implement any aggregate math. Components call the public functions below;
// they never touch localStorage or the Store shape directly.
//
// Two-tier model (see prompts/v2-release-plan.md "DataStore — two-tier model"):
//   - immortal `aggregates` + `pbs` (bounded, source of truth)
//   - a rolling, capped `sessions` log (queryable recent history)
// Capping the session log never corrupts lifetime totals: aggregates are bumped
// incrementally and never evicted.
//
// Player identity (name/variant) is NOT owned here — it lives in net/profile.ts;
// getPlayerName/setPlayerName delegate to it.

import { getProfile, saveProfile } from '../net/profile'

// ---------------------------------------------------------------------------
// Types (exported; the localStorage KEY is intentionally NOT exported)
// ---------------------------------------------------------------------------

export type Mode = 'infinite' | 'race' | 'multiplayer'
export type Control = 'kb' | 'cam'

/** Fields common to every recorded run. `control` is resolved per-run: 'kb' if
 *  any keyboard input was used, else 'cam'. `abandoned` flags a mid-flight exit
 *  (aggregates only — no game/PB/win). */
interface SessionBase {
  control: Control
  /** Seconds actually flown (excludes finish-freeze / calibration / lobby). */
  flyS: number
  distance: number
  rings: number
  abandoned?: boolean
}

/** A run as recorded by gameplay. `recordSession` accepts this shape (no id). */
export type Session =
  | (SessionBase & { mode: 'infinite'; crashes: number })
  | (SessionBase & {
      mode: 'race'
      targetDist: number
      timeMs: number
      finished: boolean
    })
  | (SessionBase & { mode: 'multiplayer'; won: boolean; finished: boolean })

/** A session as stored in the rolling log (the store assigns the id). */
export type StoredSession = Session & { id: string }

export interface Agg {
  games: number
  flyS: number
  distance: number
  rings: number
}

/** Multiplayer bucket additionally tracks wins. */
export interface MpAgg extends Agg {
  won: number
}

export interface Aggregates {
  infinite: Record<Control, Agg>
  race: Record<Control, Agg>
  multiplayer: Record<Control, MpAgg>
}

export interface InfinitePB {
  bestDistance: number
  bestRings: number
  bestFlyS: number
}

export interface RacePB {
  bestTimeMs: number
  bestRings: number
}

export interface PBs {
  infinite: Record<Control, InfinitePB>
  /** Per target distance, independent kb/cam bests (null until first finish). */
  race: Record<number, Record<Control, RacePB | null>>
}

export interface Streak {
  current: number
  /** Local 'YYYY-MM-DD' of the last qualifying play day ('' if never). */
  lastPlayedDay: string
}

export interface Store {
  version: 1
  aggregates: Aggregates
  pbs: PBs
  sessions: StoredSession[]
  streak: Streak
}

// ---------------------------------------------------------------------------
// Module-private state
// ---------------------------------------------------------------------------

const KEY = 'ducksfly.flightStore.v1'
/** localStorage cap is ~5 MB; a session is ~60-80 bytes, so 1000 is ~120 KB. */
const SESSION_CAP = 1000
/** Streak qualifier: a run counts toward the streak if it flew this far... */
const STREAK_DISTANCE = 2000

const CONTROLS: Control[] = ['kb', 'cam']
const MODES: Mode[] = ['infinite', 'race', 'multiplayer']

// ---------------------------------------------------------------------------
// Defaults + normalization (tolerate a missing / corrupt store)
// ---------------------------------------------------------------------------

function emptyAgg(): Agg {
  return { games: 0, flyS: 0, distance: 0, rings: 0 }
}

function emptyMpAgg(): MpAgg {
  return { games: 0, flyS: 0, distance: 0, rings: 0, won: 0 }
}

function emptyInfinitePB(): InfinitePB {
  return { bestDistance: 0, bestRings: 0, bestFlyS: 0 }
}

function defaultStore(): Store {
  return {
    version: 1,
    aggregates: {
      infinite: { kb: emptyAgg(), cam: emptyAgg() },
      race: { kb: emptyAgg(), cam: emptyAgg() },
      multiplayer: { kb: emptyMpAgg(), cam: emptyMpAgg() },
    },
    pbs: {
      infinite: { kb: emptyInfinitePB(), cam: emptyInfinitePB() },
      race: {},
    },
    sessions: [],
    streak: { current: 0, lastPlayedDay: '' },
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

function normAgg(v: unknown): Agg {
  const o = rec(v)
  return {
    games: num(o.games),
    flyS: num(o.flyS),
    distance: num(o.distance),
    rings: num(o.rings),
  }
}

function normMpAgg(v: unknown): MpAgg {
  return { ...normAgg(v), won: num(rec(v).won) }
}

function normInfinitePB(v: unknown): InfinitePB {
  const o = rec(v)
  return {
    bestDistance: num(o.bestDistance),
    bestRings: num(o.bestRings),
    bestFlyS: num(o.bestFlyS),
  }
}

function normRacePB(v: unknown): RacePB | null {
  if (!v || typeof v !== 'object') return null
  const o = rec(v)
  return { bestTimeMs: num(o.bestTimeMs), bestRings: num(o.bestRings) }
}

/** Keep only sessions whose discriminant + required fields are intact. */
function normSession(v: unknown): StoredSession | null {
  const o = rec(v)
  const mode = o.mode
  const control: Control | null =
    o.control === 'cam' ? 'cam' : o.control === 'kb' ? 'kb' : null
  if (!control) return null
  const id = typeof o.id === 'string' ? o.id : makeId()
  const base = {
    id,
    control,
    flyS: num(o.flyS),
    distance: num(o.distance),
    rings: num(o.rings),
    ...(o.abandoned === true ? { abandoned: true as const } : {}),
  }
  if (mode === 'infinite') {
    return { ...base, mode, crashes: num(o.crashes) }
  }
  if (mode === 'race') {
    return {
      ...base,
      mode,
      targetDist: num(o.targetDist),
      timeMs: num(o.timeMs),
      finished: o.finished === true,
    }
  }
  if (mode === 'multiplayer') {
    return { ...base, mode, won: o.won === true, finished: o.finished === true }
  }
  return null
}

/** Build a guaranteed-valid Store from arbitrary parsed JSON, filling gaps. */
function normalize(raw: unknown): Store {
  const store = defaultStore()
  const o = rec(raw)

  const aggs = rec(o.aggregates)
  const infAgg = rec(aggs.infinite)
  const raceAgg = rec(aggs.race)
  const mpAgg = rec(aggs.multiplayer)
  store.aggregates.infinite = { kb: normAgg(infAgg.kb), cam: normAgg(infAgg.cam) }
  store.aggregates.race = { kb: normAgg(raceAgg.kb), cam: normAgg(raceAgg.cam) }
  store.aggregates.multiplayer = { kb: normMpAgg(mpAgg.kb), cam: normMpAgg(mpAgg.cam) }

  const pbs = rec(o.pbs)
  const infPb = rec(pbs.infinite)
  store.pbs.infinite = {
    kb: normInfinitePB(infPb.kb),
    cam: normInfinitePB(infPb.cam),
  }
  const racePb = rec(pbs.race)
  for (const key of Object.keys(racePb)) {
    const dist = Number(key)
    if (!Number.isFinite(dist)) continue
    const byControl = rec(racePb[key])
    store.pbs.race[dist] = {
      kb: normRacePB(byControl.kb),
      cam: normRacePB(byControl.cam),
    }
  }

  if (Array.isArray(o.sessions)) {
    const valid: StoredSession[] = []
    for (const s of o.sessions) {
      const n = normSession(s)
      if (n) valid.push(n)
    }
    // Honor the cap on load too (in case an older build wrote more).
    store.sessions = valid.slice(-SESSION_CAP)
  }

  const streak = rec(o.streak)
  store.streak = {
    current: num(streak.current),
    lastPlayedDay:
      typeof streak.lastPlayedDay === 'string' ? streak.lastPlayedDay : '',
  }

  return store
}

// ---------------------------------------------------------------------------
// Private load / save (the ONLY localStorage + JSON access in the codebase)
// ---------------------------------------------------------------------------

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultStore()
    return normalize(JSON.parse(raw))
  } catch {
    // Corrupt JSON / disabled storage / private mode — start fresh, never throw.
    return defaultStore()
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Quota exceeded / disabled storage — silently drop (reads still work).
  }
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// ---------------------------------------------------------------------------
// "Today" provider — injectable so streak day-math is testable
// ---------------------------------------------------------------------------

function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

let todayProvider: () => string = localToday

/** Test hook: override the "today" source (pass null to restore the default). */
export function setTodayProvider(fn: (() => string) | null): void {
  todayProvider = fn ?? localToday
}

/** Days since epoch for a 'YYYY-MM-DD' string (compared in UTC for stability). */
function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.floor(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000)
}

// ---------------------------------------------------------------------------
// Streak (mutates the in-memory store; caller saves)
// ---------------------------------------------------------------------------

function touchStreak(store: Store): void {
  const today = todayProvider()
  const last = store.streak.lastPlayedDay
  if (last === today) return // already counted today
  if (last && dayNumber(today) - dayNumber(last) === 1) {
    store.streak.current += 1 // consecutive day
  } else {
    store.streak.current = 1 // first play, or a gap (reset)
  }
  store.streak.lastPlayedDay = today
}

function maybeTouchStreak(store: Store, s: Session): void {
  const finished =
    s.mode === 'race' || s.mode === 'multiplayer' ? s.finished : false
  if (s.distance >= STREAK_DISTANCE || finished) touchStreak(store)
}

// ---------------------------------------------------------------------------
// Public write API
// ---------------------------------------------------------------------------

/** The single mutation entry point for flight stats. */
export function recordSession(s: Session): void {
  const store = load()

  // (1) Append to the rolling log; evict oldest beyond the cap.
  store.sessions.push({ ...s, id: makeId() })
  if (store.sessions.length > SESSION_CAP) {
    store.sessions.splice(0, store.sessions.length - SESSION_CAP)
  }

  // (2) Bump aggregates ALWAYS (even for abandoned runs).
  const bucket = store.aggregates[s.mode][s.control]
  bucket.flyS += s.flyS
  bucket.distance += s.distance
  bucket.rings += s.rings

  // (3) Completed runs only: count the game, the win, and beat-check PBs.
  if (!s.abandoned) {
    bucket.games += 1

    if (s.mode === 'multiplayer' && s.won) {
      store.aggregates.multiplayer[s.control].won += 1
    }

    if (s.mode === 'infinite') {
      const pb = store.pbs.infinite[s.control]
      pb.bestDistance = Math.max(pb.bestDistance, s.distance)
      pb.bestRings = Math.max(pb.bestRings, s.rings)
      pb.bestFlyS = Math.max(pb.bestFlyS, s.flyS)
    } else if (s.mode === 'race' && s.finished) {
      // Lazily create the per-distance { kb, cam } entry.
      let byControl = store.pbs.race[s.targetDist]
      if (!byControl) {
        byControl = { kb: null, cam: null }
        store.pbs.race[s.targetDist] = byControl
      }
      const cur = byControl[s.control]
      byControl[s.control] = cur
        ? {
            bestTimeMs: Math.min(cur.bestTimeMs, s.timeMs),
            bestRings: Math.max(cur.bestRings, s.rings),
          }
        : { bestTimeMs: s.timeMs, bestRings: s.rings }
    }
  }

  // (4) Streak (runs regardless of `abandoned`; gated only by the qualifier).
  maybeTouchStreak(store, s)

  // (5) Persist.
  save(store)
}

/** Set the player name (delegates to net/profile.ts — not stored here). */
export function setPlayerName(name: string): void {
  const profile = getProfile()
  saveProfile({ ...profile, name })
}

// ---------------------------------------------------------------------------
// Public read API (raw)
// ---------------------------------------------------------------------------

/** Player name (delegates to net/profile.ts). */
export function getPlayerName(): string {
  return getProfile().name
}

/** Recent sessions, newest first; optionally filtered by mode and limited. */
export function getRecentSessions(mode?: Mode, limit?: number): StoredSession[] {
  const sessions = load().sessions
  const filtered = mode ? sessions.filter((s) => s.mode === mode) : sessions
  const newestFirst = filtered.slice().reverse()
  return typeof limit === 'number' ? newestFirst.slice(0, limit) : newestFirst
}

/** Read-only snapshot of the aggregate buckets. */
export function getAggregates(): Aggregates {
  return load().aggregates
}

export function getPBs(): PBs {
  return load().pbs
}

export function getStreak(): Streak {
  return load().streak
}

// ---------------------------------------------------------------------------
// Public derived selectors (ALL aggregate math lives here)
// ---------------------------------------------------------------------------

function controlsOf(control?: Control): Control[] {
  return control ? [control] : CONTROLS
}

function sumAcross(
  store: Store,
  control: Control | undefined,
  field: 'flyS' | 'distance' | 'rings',
): number {
  let total = 0
  for (const m of MODES) {
    for (const c of controlsOf(control)) {
      total += store.aggregates[m][c][field]
    }
  }
  return total
}

/** Total seconds flown overall, or for one control. */
export function getTotalFlyS(control?: Control): number {
  return sumAcross(load(), control, 'flyS')
}

export function getTotalDistance(control?: Control): number {
  return sumAcross(load(), control, 'distance')
}

export function getTotalRings(control?: Control): number {
  return sumAcross(load(), control, 'rings')
}

/** Total seconds flown in a single mode, overall or for one control. */
export function getModeFlyS(mode: Mode, control?: Control): number {
  const store = load()
  return controlsOf(control).reduce(
    (acc, c) => acc + store.aggregates[mode][c].flyS,
    0,
  )
}

export function getInfinitePB(control: Control): InfinitePB {
  return load().pbs.infinite[control]
}

export function getRacePB(targetDist: number, control: Control): RacePB | null {
  return load().pbs.race[targetDist]?.[control] ?? null
}

/** Multiplayer record: games played, games won, and the resulting win rate. */
export function getMpRecord(control?: Control): {
  played: number
  won: number
  winRate: number
} {
  const store = load()
  let played = 0
  let won = 0
  for (const c of controlsOf(control)) {
    played += store.aggregates.multiplayer[c].games
    won += store.aggregates.multiplayer[c].won
  }
  return { played, won, winRate: played > 0 ? won / played : 0 }
}
