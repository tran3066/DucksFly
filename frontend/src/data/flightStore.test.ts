import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import {
  recordSession,
  setTodayProvider,
  getAggregates,
  getStreak,
  getRecentSessions,
  getTotalFlyS,
  getTotalDistance,
  getTotalRings,
  getModeFlyS,
  getInfinitePB,
  getRacePB,
  getMpRecord,
  getPlayerName,
  setPlayerName,
  type Session,
} from './flightStore'

const KEY = 'ducksfly.flightStore.v1'

beforeEach(() => {
  localStorage.clear()
  setTodayProvider(() => '2026-01-01')
})

afterEach(() => {
  setTodayProvider(null)
})

describe('empty / corrupt store tolerance', () => {
  it('returns sane zeros with no stored data', () => {
    expect(getTotalFlyS()).toBe(0)
    expect(getTotalDistance()).toBe(0)
    expect(getTotalRings()).toBe(0)
    expect(getStreak()).toEqual({ current: 0, lastPlayedDay: '' })
    expect(getRecentSessions()).toEqual([])
    expect(getInfinitePB('kb')).toEqual({
      bestDistance: 0,
      bestRings: 0,
      bestFlyS: 0,
    })
    expect(getRacePB(2000, 'kb')).toBeNull()
    expect(getMpRecord()).toEqual({ played: 0, won: 0, winRate: 0 })
  })

  it('does not throw on garbage JSON and yields a default store', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(() => getAggregates()).not.toThrow()
    expect(getTotalFlyS()).toBe(0)
    // A new write recovers cleanly.
    recordSession({ mode: 'infinite', control: 'kb', flyS: 5, distance: 100, rings: 1, crashes: 1 })
    expect(getTotalFlyS()).toBe(5)
  })

  it('coerces a partially-corrupt store into valid shape', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, aggregates: { infinite: { kb: { flyS: 'nope' } } } }),
    )
    const agg = getAggregates()
    expect(agg.infinite.kb).toEqual({ games: 0, flyS: 0, distance: 0, rings: 0 })
    expect(agg.multiplayer.cam.won).toBe(0)
  })
})

describe('aggregates summation', () => {
  it('sums fly time / distance / rings overall and per-control', () => {
    recordSession({ mode: 'infinite', control: 'kb', flyS: 10, distance: 500, rings: 3, crashes: 1 })
    recordSession({ mode: 'race', control: 'cam', flyS: 20, distance: 2000, rings: 5, targetDist: 2000, timeMs: 30000, finished: true })
    recordSession({ mode: 'multiplayer', control: 'kb', flyS: 15, distance: 1800, rings: 4, won: true, finished: true })

    expect(getTotalFlyS()).toBe(45)
    expect(getTotalDistance()).toBe(4300)
    expect(getTotalRings()).toBe(12)

    expect(getTotalFlyS('kb')).toBe(25)
    expect(getTotalFlyS('cam')).toBe(20)
    expect(getTotalDistance('kb')).toBe(2300)
    expect(getTotalRings('cam')).toBe(5)

    expect(getModeFlyS('infinite')).toBe(10)
    expect(getModeFlyS('race', 'cam')).toBe(20)
    expect(getModeFlyS('race', 'kb')).toBe(0)
    expect(getModeFlyS('multiplayer', 'kb')).toBe(15)
  })

  it('counts games only for non-abandoned runs but always bumps aggregates', () => {
    recordSession({ mode: 'infinite', control: 'kb', flyS: 8, distance: 400, rings: 2, crashes: 1 })
    recordSession({ mode: 'infinite', control: 'kb', flyS: 4, distance: 200, rings: 1, crashes: 0, abandoned: true })

    const agg = getAggregates()
    expect(agg.infinite.kb.games).toBe(1) // abandoned did NOT count as a game
    expect(agg.infinite.kb.flyS).toBe(12) // but its fly time still aggregated
    expect(agg.infinite.kb.distance).toBe(600)
    expect(agg.infinite.kb.rings).toBe(3)
  })
})

describe('infinite PBs', () => {
  it('tracks max distance / rings / flyS, ignoring abandoned runs', () => {
    recordSession({ mode: 'infinite', control: 'kb', flyS: 10, distance: 500, rings: 3, crashes: 1 })
    recordSession({ mode: 'infinite', control: 'kb', flyS: 5, distance: 1200, rings: 2, crashes: 1 })
    recordSession({ mode: 'infinite', control: 'kb', flyS: 99, distance: 9999, rings: 99, crashes: 0, abandoned: true })

    expect(getInfinitePB('kb')).toEqual({ bestDistance: 1200, bestRings: 3, bestFlyS: 10 })
    expect(getInfinitePB('cam')).toEqual({ bestDistance: 0, bestRings: 0, bestFlyS: 0 })
  })
})

describe('race PBs per distance + control', () => {
  it('keeps independent bests per targetDist and control', () => {
    recordSession({ mode: 'race', control: 'kb', flyS: 30, distance: 2000, rings: 5, targetDist: 2000, timeMs: 40000, finished: true })
    recordSession({ mode: 'race', control: 'kb', flyS: 28, distance: 2000, rings: 7, targetDist: 2000, timeMs: 35000, finished: true })
    recordSession({ mode: 'race', control: 'cam', flyS: 50, distance: 5000, rings: 9, targetDist: 5000, timeMs: 90000, finished: true })

    // 2000m kb: fastest time wins, most rings wins (from different runs).
    expect(getRacePB(2000, 'kb')).toEqual({ bestTimeMs: 35000, bestRings: 7 })
    // 2000m cam never run.
    expect(getRacePB(2000, 'cam')).toBeNull()
    // 5000m is independent.
    expect(getRacePB(5000, 'cam')).toEqual({ bestTimeMs: 90000, bestRings: 9 })
    expect(getRacePB(5000, 'kb')).toBeNull()
  })

  it('does not record a race PB for an unfinished or abandoned run', () => {
    recordSession({ mode: 'race', control: 'kb', flyS: 10, distance: 800, rings: 2, targetDist: 2000, timeMs: 0, finished: false })
    recordSession({ mode: 'race', control: 'kb', flyS: 10, distance: 800, rings: 2, targetDist: 2000, timeMs: 12000, finished: false, abandoned: true })
    expect(getRacePB(2000, 'kb')).toBeNull()
  })
})

describe('multiplayer record', () => {
  it('tracks played / won / winRate; DNF still counts as a game', () => {
    recordSession({ mode: 'multiplayer', control: 'kb', flyS: 20, distance: 2000, rings: 5, won: true, finished: true })
    recordSession({ mode: 'multiplayer', control: 'kb', flyS: 18, distance: 1900, rings: 4, won: false, finished: true })
    recordSession({ mode: 'multiplayer', control: 'cam', flyS: 12, distance: 1000, rings: 1, won: false, finished: false })

    expect(getMpRecord()).toEqual({ played: 3, won: 1, winRate: 1 / 3 })
    expect(getMpRecord('kb')).toEqual({ played: 2, won: 1, winRate: 0.5 })
    expect(getMpRecord('cam')).toEqual({ played: 1, won: 0, winRate: 0 })
  })
})

describe('session log cap eviction', () => {
  it('caps the log but never changes aggregates', () => {
    const N = 1050
    for (let i = 0; i < N; i++) {
      recordSession({ mode: 'infinite', control: 'kb', flyS: 1, distance: 10, rings: 1, crashes: 1 })
    }
    const sessions = getRecentSessions()
    expect(sessions.length).toBe(1000) // capped

    const agg = getAggregates()
    expect(agg.infinite.kb.games).toBe(N) // every run counted
    expect(agg.infinite.kb.flyS).toBe(N)
    expect(agg.infinite.kb.distance).toBe(N * 10)
    expect(agg.infinite.kb.rings).toBe(N)
  })

  it('returns sessions newest-first and respects mode filter + limit', () => {
    recordSession({ mode: 'infinite', control: 'kb', flyS: 1, distance: 10, rings: 0, crashes: 1 })
    recordSession({ mode: 'race', control: 'kb', flyS: 2, distance: 20, rings: 0, targetDist: 2000, timeMs: 1, finished: true })
    recordSession({ mode: 'infinite', control: 'kb', flyS: 3, distance: 30, rings: 0, crashes: 1 })

    const all = getRecentSessions()
    expect(all.map((s) => s.flyS)).toEqual([3, 2, 1]) // newest first

    const infinites = getRecentSessions('infinite')
    expect(infinites.every((s) => s.mode === 'infinite')).toBe(true)
    expect(infinites.length).toBe(2)

    expect(getRecentSessions(undefined, 1).map((s) => s.flyS)).toEqual([3])
  })
})

describe('streak across simulated days', () => {
  const run = (day: string, s?: Partial<Session>) => {
    setTodayProvider(() => day)
    recordSession({
      mode: 'infinite',
      control: 'kb',
      flyS: 5,
      distance: 2500, // qualifies (>= 2000)
      rings: 1,
      crashes: 1,
      ...(s as object),
    } as Session)
  }

  it('increments on consecutive days, no-ops same day, resets on a gap', () => {
    run('2026-01-01')
    expect(getStreak()).toEqual({ current: 1, lastPlayedDay: '2026-01-01' })

    run('2026-01-01') // same day -> no change
    expect(getStreak()).toEqual({ current: 1, lastPlayedDay: '2026-01-01' })

    run('2026-01-02') // consecutive -> ++
    expect(getStreak()).toEqual({ current: 2, lastPlayedDay: '2026-01-02' })

    run('2026-01-03')
    expect(getStreak()).toEqual({ current: 3, lastPlayedDay: '2026-01-03' })

    run('2026-01-05') // gap -> reset to 1
    expect(getStreak()).toEqual({ current: 1, lastPlayedDay: '2026-01-05' })
  })

  it('handles month boundaries as consecutive', () => {
    run('2026-01-31')
    run('2026-02-01')
    expect(getStreak()).toEqual({ current: 2, lastPlayedDay: '2026-02-01' })
  })

  it('does NOT advance for a run that neither flew 2000m nor finished', () => {
    setTodayProvider(() => '2026-03-01')
    recordSession({ mode: 'infinite', control: 'kb', flyS: 2, distance: 100, rings: 0, crashes: 1 })
    expect(getStreak()).toEqual({ current: 0, lastPlayedDay: '' })
  })

  it('advances when a short race is finished even under 2000m', () => {
    setTodayProvider(() => '2026-04-01')
    recordSession({ mode: 'race', control: 'kb', flyS: 9, distance: 1000, rings: 2, targetDist: 1000, timeMs: 15000, finished: true })
    expect(getStreak().current).toBe(1)
  })
})

describe('player name delegation', () => {
  it('reads + writes through net/profile localStorage keys', () => {
    setPlayerName('Quackers')
    expect(getPlayerName()).toBe('Quackers')
    // Reflected via the profile module's own key.
    expect(localStorage.getItem('ducksfly.playerName')).toBe('Quackers')
  })

  it('does not store the name inside the flightStore JSON', () => {
    setPlayerName('Mallard')
    recordSession({ mode: 'infinite', control: 'kb', flyS: 1, distance: 10, rings: 0, crashes: 1 })
    const raw = localStorage.getItem(KEY) ?? ''
    expect(raw).not.toContain('Mallard')
  })
})
