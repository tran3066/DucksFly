# DucksFly v2 — Release Plan (whiteboard)

## Reality check vs. the Gemini plan
- **Core flight is ALREADY shared.** `FlightRig` (sim/collision/gestures) + `FlightScene` (render) are mode-agnostic; SP and MP both drive them. Gemini's "Task 1: build GameCore from scratch" is wrong — the engine exists.
- Real duplication lives in the **wrapper components** (`SinglePlayerGame.tsx` / `MultiplayerGame.tsx`): ~15 identical refs (state/actions/cfg/impulse/duck/clip/rings/boost...), reset logic, music effects, ring-sync. → extract a `useFlightSession()` hook, not a new engine.
- LocalStorage-as-JSON: agreed, correct call. No IndexedDB/sqlite.

## Hard part = Infinite Run (not the data layer)
Current map is **finite + absolute-Z**:
- `buildMap(seed)` builds the whole `length:2000` corridor up front.
- `FlightRig` loops over **all rings + all scenery every frame** (tree loop is Z-culled, rings are not).
- Finish = `position.z >= map.length` → freeze.
- Crash = **respawn at last checkpoint** (NOT game over).

Infinite needs:
- **Windowed/streaming map**: generate chunks ahead of duck, drop chunks behind. Recycle ids.
- **Broad-phase by Z-window** for rings too (perf once length is unbounded).
- **Crash = game-over branch** in FlightRig (new prop, e.g. `crashEndsRun` / `onGameOver` vs current respawn).
- Disable `enableFinish`; distance is the score.

### Procedural approach decision (Gemini's open question)
**DECIDED: parametric `buildChunk(chunkIndex, seed, difficulty)`** — reuse buildMap's salted-stream RNG; difficulty ramps tree density / ring spacing with distance. No noise, no hand-authored templates.

---

## Proposed task order (dependency-first)
1. **DataStore (LocalStorage JSON)** — schema + safe (de)serialize + versioning. Independent, unblocks everything.
2. **`useFlightSession()` extraction** — dedupe SP/MP wrapper; the seam new modes plug into.
3. **Streaming map module** — `buildChunk` + window/recycle; keep finite `buildMap` for races/MP.
4. **FlightRig crash-ends-run branch** — `onGameOver`, distance score.
5. **New SP modes UI** — Distance Race (target input → time on reach) + Infinite Run (chunks + game-over).
6. **Streak engine** — last-played calendar-day logic + 7-day unlock tracker UI (reads DataStore).
7. **Stat wiring** — feed time/distance/rings (kb vs cam) + MP played/won into DataStore.

## DataStore — two-tier model

### Why two tiers
- localStorage cap ~5MB. Compact session record ~60-80 bytes minified.
- Uncapped log: ~40-50k sessions before the cap (~6 yrs at 20/day) — unbounded, and explodes if we ever add per-ring telemetry.
- So: **immortal aggregates** (bounded, source of truth) + **rolling capped session log** (queryable history). Capping the log never corrupts lifetime totals because aggregates are updated incrementally and never evicted.
- Maps cleanly to a future server: aggregates -> stats row, sessions -> table rows.

### Dimensions on EVERY session
`mode` (infinite | race | multiplayer) x `control` (kb | cam). All stats key off these two.

### Schema
```typescript
type Mode = 'infinite' | 'race' | 'multiplayer'
type Control = 'kb' | 'cam'

// control resolved per-run: 'kb' if any keyboard input used, else 'cam'
// abandoned?: true on a mid-flight exit -> aggregates only (no game/PB/win)
type Session =
  | { id; mode:'infinite';    control; flyS; distance; rings; crashes; abandoned? }
  | { id; mode:'race';        control; flyS; distance; rings; targetDist; timeMs; finished; abandoned? }
  | { id; mode:'multiplayer'; control; flyS; distance; rings; won; finished; abandoned? }

type Agg   = { games; flyS; distance; rings }
type MpAgg = Agg & { won }              // multiplayer bucket adds a win count
type Aggregates = {
  infinite:    Record<Control, Agg>
  race:        Record<Control, Agg>
  multiplayer: Record<Control, MpAgg>   // 6 buckets total, immortal
}

type PBs = {
  infinite: Record<Control, { bestDistance; bestRings; bestFlyS }>
  // per-distance: each target distance has independent kb/cam bests
  race:     Record<number /*targetDist*/, Record<Control, { bestTimeMs; bestRings } | null>>
}

type Store = {
  version: 1
  playerName: string
  aggregates: Aggregates
  pbs: PBs
  sessions: Session[]                 // rolling, cap ~1000 (~120KB)
  streak: { current; lastPlayedDay }  // 'YYYY-MM-DD' local
}
```

### SINGLE OWNER MODULE (hard rule)
**One module owns ALL access to the local JSON. No other component ever touches localStorage or the Store shape directly — not for reads, not for writes.** (e.g. `frontend/src/data/flightStore.ts`.)
- All persistence logic (load, save, migrate/version, serialize, the ~1000 session cap) lives here and ONLY here.
- All derived/aggregate math lives here as named selectors. If a screen needs "total time flown in races", it calls `getTotalRaceFlyS()` — it does NOT sum buckets itself. Derived logic is written once, in this file.
- Components import functions from this module; they never import the raw key or `JSON.parse`/`JSON.stringify` the store.
- Enforcement: a single private `load()/save()` pair inside the module; the localStorage key is a module-private constant, not exported.

**Public API surface (the only way in/out):**
```typescript
// writes
recordSession(s: Session): void          // the one mutation entry point
setPlayerName(name: string): void
// reads — raw
getPlayerName(): string
getRecentSessions(mode?: Mode, limit?: number): Session[]
getAggregates(): Aggregates              // read-only snapshot
getPBs(): PBs
getStreak(): { current; lastPlayedDay }
// reads — derived selectors (computed here, never in components)
getTotalFlyS(control?: Control): number          // overall, or kb/cam
getTotalDistance(control?: Control): number
getTotalRings(control?: Control): number
getModeFlyS(mode: Mode, control?: Control): number   // e.g. total time flown in races
getInfinitePB(control: Control): { bestDistance; bestRings; bestFlyS }
getRacePB(targetDist: number, control: Control): { bestTimeMs; bestRings } | null
getMpRecord(control?: Control): { played; won; winRate }
```

### Single write path (inside the module)
`recordSession(s)`: (1) push to sessions + drop oldest past cap, (2) bump `aggregates[mode][control]` (multiplayer also bumps `won` when `s.won`), (3) beat-check `pbs` (infinite + race-per-distance), (4) touch streak, (5) `save()`.

### Derived for free (no log scan)
- "total fly time overall/kb/cam", distance, rings = sums across the 6 aggregate buckets.
- infinite km/rings kb-vs-cam = `aggregates.infinite[kb|cam]`.
- MP played = `aggregates.multiplayer[c].games`; MP won = `aggregates.multiplayer[c].won`; win rate = won/games.
- Race PBs per distance/control = `pbs.race[dist][control]` (null until first finish at that distance).

## Distance Race (DECIDED)
- Reuse finite `buildMap` with `cfg.length = target`. Same rings/finish/freeze logic — only the chosen distance changes. Chunk streamer is **infinite-only**.
- **Personal bests per distance**, split camera vs keyboard:
  - best time (lowest ms)
  - best rings (most collected)
- Show PB on the pre-race screen for the chosen distance, and flag new PBs on the finish screen.

### Race PB storage shape (replaces flat races array)
```
races: {
  [targetDist]: {
    kb:  { bestTimeMs, bestRings },
    cam: { bestTimeMs, bestRings }
  }
}
```
(keep a recent-runs log too if we want history later)

## Fly time (DECIDED)
- Count **only while the duck is actually flying** = accumulate `delta` inside the `running` branch of `FlightRig` (already excludes finish-freeze, calibration gate, MP lobby/countdown).
- Split kb vs cam by `cameraControl`. Flush accumulated seconds to DataStore on run end / unmount.

## Decisions (round 2 — RESOLVED)
1. **Control label**: if ANY keyboard input was used during the run -> `'kb'`; only fully-camera runs -> `'cam'`. (kb wins.) Track a per-run `usedKeyboard` flag, not the mode toggle.
2. **Abandoned runs** (exit mid-flight): NICE-TO-HAVE, not critical. If done: flush a partial record that adds flyS/distance/rings to AGGREGATES only — NOT a game (no games++), no PB, no win. Flag `abandoned:true`.
3. **No separate "Classic".** Solo = ONE configurable-distance race; default 2000m, player can change the target to chase PBs at different distances. So solo IS `mode:'race'` with `targetDist`. Two solo entries total: Race (distance picker) + Infinite.
4. **Streak qualifier**: a run counts toward the streak if `distance >= 2000` OR it finished a race. ALL modes count. So `recordSession` only touches the streak when `distance >= 2000 || finished`.
5. **MP**: at phase `finished`, always record (games++ + aggregates). `won` = true ONLY if you finished and are the winner. DNF/placement ignored — drop `placement` from the schema.
6. **Distance bounds**: min 1000m, default 2000m, max 50000m (50km).
7. **7-day unlock**: no payload yet — render a mysterious/intriguing locked reward ("??? unlocks in N days", glowing mystery box). Placeholder only.
8. **Infinite crash set**: rings + trees ONLY (same as today). Ground/ceiling stay clamped — no ground-hit death.
