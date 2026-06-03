# DucksFly v2 — Agent Task List

Dependency-ordered. Each task is self-contained: hand one to an agent at a time, in order (some can run in parallel — noted). Design rationale lives in `prompts/v2-release-plan.md`; read it first if you need the "why".

---

## SHARED CONTEXT (read before any task)

Architecture facts every agent must know (verified against the code):

- **The flight engine is ALREADY shared.** `frontend/src/game/FlightRig.tsx` (sim loop, collision, ring detection, MediaPipe gestures) and `frontend/src/game/FlightScene.tsx` (Canvas + sky + lights + `MapView` + rig + camera) are mode-agnostic. Both `SinglePlayerGame.tsx` and `MultiplayerGame.tsx` build the same ref bundle and feed those two components. **Do NOT rewrite the engine.**
- **Map is deterministic + seed-based.** `frontend/src/map/buildMap.ts` builds the whole finite corridor from one seed using salted RNG streams (`rng.ts`: `makeRng`, `deriveSeed`, `randRange`). `buildMap(seed, cfg?)` already accepts a `MapConfig` override. Types in `map/types.ts`. Finite finish = `position.z >= map.length`.
- **Crash today = respawn** at last checkpoint (`FlightRig` collision block + `respawn.ts`). It is NOT game-over.
- **Control mode** is `'choose' | 'keyboard' | 'camera'` (`ModeChooser.tsx`). Map to stats control: `camera -> 'cam'`, else `'kb'`.
- **Player name already persists** in `frontend/src/net/profile.ts` (`getProfile().name`, `saveProfile`). The new data module must delegate to it, not duplicate.
- **MP results**: `ResultsScreen.tsx` computes `winner = rankPlayers(players).find(p => p.finished)` and `youWon = winner.id === self.id`. `PlayerView` has `ringsPassed`, `collisions`, `finished`, `finishTime` but **no `distance`** — distance/fly-time for MP must come from the local sim.
- Tests use **vitest** (`*.test.ts` exist throughout). Typecheck + build via the frontend's `package.json` scripts. After each task: run the test + typecheck/build scripts and fix what you broke.

**HARD RULE (applies to all tasks):** All flight-stats persistence goes through ONE module (`frontend/src/data/flightStore.ts`, Task 1). No other file may read/write that JSON, import its localStorage key, or re-implement aggregate math. (Identity name/variant stays in `net/profile.ts`; the store delegates to it.)

---

## Task 1 — `flightStore` data module (foundational)

**Depends on:** nothing. Do this first.

**Context / need-to-know**
- This is the single owner of all flight-stats persistence (the HARD RULE above). Two-tier model: immortal `aggregates` + `pbs`, plus a rolling capped `sessions` log. Full schema + rationale in `prompts/v2-release-plan.md` ("DataStore — two-tier model").
- localStorage cap ~5 MB; cap the session log at ~1000 entries.
- Player name is NOT owned here — delegate `getPlayerName()/setPlayerName()` to `net/profile.ts`.

**Suggested implementation**
- New file `frontend/src/data/flightStore.ts`. Module-private constant `KEY = 'ducksfly.flightStore.v1'` (NOT exported). Private `load()` (parse + validate + migrate; on any failure return a fresh default store) and `save()`.
- Types (export the types, not the key): `Mode = 'infinite'|'race'|'multiplayer'`, `Control = 'kb'|'cam'`, the `Session` discriminated union (infinite: `{flyS,distance,rings,crashes,abandoned?}`; race: `{flyS,distance,rings,targetDist,timeMs,finished,abandoned?}`; multiplayer: `{flyS,distance,rings,won,finished,abandoned?}` — NO `placement`), `Aggregates` (multiplayer bucket adds `won`), `PBs` (`race` keyed by `targetDist`, value `{kb,cam}|null per control`), `Store { version:1, aggregates, pbs, sessions, streak }`.
- Public write API: `recordSession(s: Session)`, `setPlayerName(name)`.
- Public read API: `getPlayerName()`, `getRecentSessions(mode?, limit?)`, `getAggregates()`, `getPBs()`, `getStreak()`.
- Public derived selectors (all aggregate math lives here): `getTotalFlyS(control?)`, `getTotalDistance(control?)`, `getTotalRings(control?)`, `getModeFlyS(mode, control?)`, `getInfinitePB(control)`, `getRacePB(targetDist, control)`, `getMpRecord(control?) -> {played, won, winRate}`.
- `recordSession` steps: push to `sessions` (drop oldest past cap) → bump `aggregates[mode][control]` flyS/distance/rings (ALWAYS, even abandoned) → if NOT `abandoned`: games++ (+`won` when `s.mode==='multiplayer' && s.won`) and beat-check `pbs` (infinite: max distance/rings/flyS; race: per-`targetDist` min `timeMs` + max `rings`, create key/`{kb,cam}` lazily) → `maybeTouchStreak(s)` → `save()`. (Abandoned = aggregates only: no games++, no PB, no win.)
- `maybeTouchStreak(s)`: only qualifies if `s.distance >= 2000 || s.finished` (all modes). When it qualifies, `touchStreak()`: compare `streak.lastPlayedDay` (local `YYYY-MM-DD`) to today — same day = no-op, consecutive = `current++`, gap = `current=1`; update `lastPlayedDay`.
- All public reads must tolerate a missing/corrupt store (return sane zeros) so callers never crash.
- Add `frontend/src/data/flightStore.test.ts`: record sessions across modes/controls, assert aggregates sum, PB beat logic per distance, session cap eviction does NOT change aggregates, streak increments/resets across simulated days (inject a "today" provider so days are testable).
- **Lifetime stats UI** (reads selectors ONLY — no store internals): new `frontend/src/game/StatsScreen.tsx`, a dismissible overlay that renders all aggregate data — overall + per-control (kb vs cam) totals (fly time, distance, rings), per-mode breakdown (infinite / race / multiplayer), MP played/won/win-rate, infinite PBs, and the per-distance race PB table. Build it purely from the public selectors (`getAggregates`, `getPBs`, `getTotalFlyS('kb'|'cam')`, `getModeFlyS`, `getMpRecord`, `getRacePB`, ...). Style with `game/ui.tsx` primitives (`Overlay`, `Panel`, `COLORS`, fonts).
- **Menu button**: add a small "📊 Stats" / "Lifetime stats" button to `StartMenu.tsx` that opens `StatsScreen`.

**Files likely touched**
- NEW `frontend/src/data/flightStore.ts`
- NEW `frontend/src/data/flightStore.test.ts`
- NEW `frontend/src/game/StatsScreen.tsx`
- `frontend/src/game/StartMenu.tsx` (add the stats button + open/close state)

**Files NOT to touch**
- `game/` gameplay files (FlightRig/FlightScene/SinglePlayerGame/MultiplayerGame), `map/`, `net/` (except importing `getProfile`/`saveProfile` from `net/profile.ts`). No gameplay/recording wiring in this task — `StatsScreen` is read-only display.

**Acceptance criteria**
- Module compiles; tests pass; project typecheck/build passes.
- `KEY` and `JSON.parse/stringify` of the store appear ONLY in `flightStore.ts` (grep to confirm).
- Recording N sessions then reading selectors returns correct overall / per-control / per-mode numbers; per-distance race PBs are independent; MP `won` tracked in the bucket.
- Corrupt/empty localStorage yields a usable default store (no throw).
- Name delegates to `net/profile.ts` (setting it there is reflected by `getPlayerName()`).
- The Stats button on the start menu opens an overlay showing all aggregate data; with an empty store it shows zeros gracefully; `StatsScreen` uses only the public selectors (no direct store/localStorage access).

---

## Task 2 — Extract `useFlightSession()` (dedupe SP/MP wrappers)

**Depends on:** nothing (can run parallel to Task 1). REFACTOR FIRST — stabilize the shared seam before any new behavior is added. Must land before Tasks 3 & 5.

**Context / need-to-know**
- `SinglePlayerGame.tsx` and `MultiplayerGame.tsx` duplicate ~15 refs and the reset/ring-sync logic: `stateRef, actionsRef, mergedActionsRef, cfgRef, impulseRef, duckGroupRef, clipRef, finishedRef, passedRingsRef, ringPulseAtRef, boostRef, boostSpeedRef, boostDurationRef`, the `passedRingIds/ringPulseAt` state + `syncRings`, and `fireImpulse`/`keyRef`.
- Goal: one hook returns that bundle so new modes plug into a single seam. This is a PURE REFACTOR — zero behavior change. We are NOT adding fly-time or crash-ends-run here (that's Task 3); just consolidating the existing duplicated wiring of the working code.

**Suggested implementation**
- New file `frontend/src/game/useFlightSession.ts` exporting `useFlightSession(opts)` that creates/owns the shared refs + ring-sync state and returns them plus a `reset()` that re-inits them (caller supplies the initial `DuckState` factory, since MP spawns at a slot and SP at origin).
- Refactor `SinglePlayerGame.tsx` and `MultiplayerGame.tsx` to consume the hook for the shared pieces. Keep all mode-specific code in place (SP: Leva controls, finish overlay, RaceStats/Hud; MP: networking, spawnState, pose streaming, RemoteDucks, RaceScreens).
- Do this conservatively: move only the clearly-identical pieces; if something differs subtly between modes, leave it in the wrapper.

**Files likely touched**
- NEW `frontend/src/game/useFlightSession.ts`
- `frontend/src/game/SinglePlayerGame.tsx`
- `frontend/src/game/MultiplayerGame.tsx`

**Files NOT to touch**
- `FlightRig.tsx`, `FlightScene.tsx`, networking internals (`net/*`), screens.

**Acceptance criteria**
- SP and MP behave identically to before (manual smoke both modes incl. a full MP race with 2 clients if possible).
- Net line count drops; the shared refs exist in one place.
- Typecheck/build + all tests pass.

---

## Task 3 — Instrument `FlightRig` + hook: fly-time + infinite-only crash-ends-run (additive)

**Depends on:** Task 2 (the hook now owns/resets the new `flySRef`). Required by Tasks 5 & 7.

**Context / need-to-know**
- `FlightRig.tsx` is shared by SP + MP. All new props must be OPTIONAL and default to today's exact behavior, so SP/MP are byte-identical when the props are omitted.
- Today: fly-time isn't measured anywhere central; crash always respawns at the last checkpoint; freeze is `frozen = enableFinish && finishedRef.current`.
- We need (a) a central fly-time accumulator that counts ONLY while the sim advances, and (b) an opt-in "crash ends the run" path that is used by **Infinite Run ONLY**. **Single-player race and multiplayer MUST keep respawning at the checkpoint** — crash-ends-run is never enabled for them.

**Suggested implementation**
- Add optional props to `FlightRigProps`:
  - `flySRef?: React.RefObject<number>` — while `running`, add the same clamped `dt` used for `accRef` (`Math.min(delta, MAX_FRAME_DT)`) to `flySRef.current`. (Counts only actual flying — excludes finish-freeze, calibration gate, MP lobby/countdown.)
  - `usedKeyboardRef?: React.RefObject<boolean>` — set `true` on any frame the live keyboard contributes input (`k.flap || k.lean || k.dive` nonzero). Drives the kb-vs-cam label: a run is `'kb'` if keyboard was touched at all, else `'cam'`. (Note: keyboard is always live even in camera mode, so this captures "used kb during the run", not the mode toggle.)
  - `crashEndsRun?: boolean` (default `false`) and `onGameOver?: () => void`.
- In the collision branch, when `crashed`: if `crashEndsRun` is true, set `finishedRef.current = true`, call `onGameOver?.()`, `break` (do NOT respawn, do NOT call `onCrash`); otherwise keep the EXISTING respawn-at-checkpoint path exactly as-is. Default-off means SP race + MP are untouched.
- Change freeze to `const frozen = finishedRef.current` (finish OR game-over both freeze). Confirm behavior-neutral today: `finishedRef` only becomes true via the `enableFinish` finish path, so existing SP/MP freezing is unchanged.
- Leave `enableFinish` semantics as-is (Infinite passes `enableFinish:false` so it never finishes by distance; it ends only via `crashEndsRun`).
- Update `useFlightSession.ts` (from Task 2) to own + reset `flySRef` (zeroed in `reset()`) and `usedKeyboardRef` (false in `reset()`), and pass both through where the wrappers build the rig props.

**Files likely touched**
- `frontend/src/game/FlightRig.tsx`
- `frontend/src/game/useFlightSession.ts`

**Files NOT to touch**
- `FlightScene.tsx`, `flight.ts`/`flightModel.ts`, networking. No new REQUIRED props on existing call sites (all optional, default-off).

**Acceptance criteria**
- With the new props omitted/`crashEndsRun:false`, SP race and MP play exactly as before — including crash → respawn at checkpoint (NOT game-over). Manual smoke: fly, pass rings, crash→respawn, reach finish→freeze; MP race unaffected.
- When `flySRef` is supplied, it increases only while flying and holds steady during freeze/calibration/lobby.
- When `crashEndsRun:true`, a tree/ring-rim hit freezes the duck and fires `onGameOver` once (no respawn).
- Typecheck/build + existing rig-related tests pass.

---

## Task 4 — Infinite map streamer (`buildChunk` + window manager)

**Depends on:** nothing (parallel with Tasks 1–3). Pure logic + tests only; no rendering here.

**Context / need-to-know**
- Reuse the existing deterministic approach (`rng.ts` salted streams) and the existing collision/finish data shapes in `map/types.ts` (`MapDef`, `RingDef`, `SceneryItem`, `Checkpoint`). DECIDED: parametric generation, NOT noise, NOT hand-authored templates.
- `FlightRig` reads `mapRef.current` every frame and iterates `rings` + `scenery`; trees are Z-culled to ±8 m but **rings are not**. For an unbounded run the active arrays must stay small (windowed), and ring ids must be globally unique + monotonic so the `passedRingsRef` set never collides across chunks.
- Keep finite `buildMap` untouched — it stays the source for races + MP.

**Suggested implementation**
- New file `frontend/src/map/buildChunk.ts`: `buildChunk(chunkIndex, seed, cfg, difficulty)` → `{ rings, scenery, checkpoints }` for the Z-band `[chunkIndex*chunkLength, (chunkIndex+1)*chunkLength)`. Derive each chunk's RNG via `deriveSeed(seed, chunkIndex*SALT + featureSalt)`. Assign ids as `chunkIndex * ID_STRIDE + local` (stride large enough no chunk overlaps). `difficulty` (a function of `chunkIndex`, clamped) ramps tree density / tightens ring gaps.
- New file `frontend/src/map/infiniteMap.ts`: `createInfiniteMap(seed, cfg?)` returning an object that, given the duck's current Z, lazily builds chunks AHEAD (e.g. keep ~N chunks ahead) and drops chunks fully BEHIND a margin, exposing the current windowed `MapDef` (with `length` set to the far edge of the window, `ceiling/floorY/halfWidth` from cfg) and a cheap "did the window change" signal/version. Keep already-built chunks cached so the world is stable if the duck briefly backs up.
- Tests `frontend/src/map/infiniteMap.test.ts`: determinism (same seed ⇒ same chunk contents), id uniqueness across many chunks, window advance builds ahead + drops behind, ring z ordering, difficulty monotonic within clamp.

**Files likely touched**
- NEW `frontend/src/map/buildChunk.ts`, `frontend/src/map/infiniteMap.ts`, `frontend/src/map/infiniteMap.test.ts`
- Optionally export the new symbols from `frontend/src/map/index.ts`.

**Files NOT to touch**
- `buildMap.ts` (leave finite generation intact), `FlightRig.tsx`, any rendering.

**Acceptance criteria**
- Pure + deterministic; tests pass.
- Windowed `MapDef` stays bounded in size as Z grows; ring ids never repeat; chunk seams have no overlapping/duplicated obstacles.
- Difficulty rises with distance and clamps.

---

## Task 5 — Solo modes: configurable-distance Race + Infinite Run + menu

**Depends on:** Tasks 2, 3, 4.

**Context / need-to-know**
- `StartMenu.tsx` currently offers only `single | multi` (`GameMode`). `Game.tsx` routes them. Single-player is `SinglePlayerGame.tsx`, which already does the full finite-course loop incl. finish overlay.
- **There is NO separate "Classic".** Solo = ONE configurable-distance Race: same finite system, the player picks the target length. Default 2000m (today's course), **min 1000m, max 50000m (50km)**. Build with `buildMap(seed, { ...DEFAULT_MAP_CONFIG, length: target })`. PBs are tracked per chosen distance. **Crash respawns at checkpoint (DO NOT set `crashEndsRun`).**
- Infinite Run = `infiniteMap` (Task 4) + `crashEndsRun:true`/`onGameOver` (Task 3), `enableFinish:false`, distance is the score. **`crashEndsRun` is enabled ONLY here** — never for Race / MP.

**Suggested implementation**
- Menu: Single Player leads to two choices — **Race** (with a distance picker) and **Infinite Run**. Widen `GameMode` (e.g. `'race' | 'infinite' | 'multi'`) or add a single-player sub-screen; update `Game.tsx` routing. (Keep the `?room=` deep-link → multiplayer behavior.)
- **Race**: pre-game distance picker — presets (e.g. 1k / 2k / 5k / 10k) + a custom numeric input, **clamped to [1000, 50000], default 2000**. Reuse `SinglePlayerGame`'s loop but build the map with `length: target`; before start show `getRacePB(target, control)` for the chosen distance; on finish show time + rings and flag a new PB. Cleanest: parameterize `SinglePlayerGame` with an optional `mapConfigOverride` + `targetDist`, or a thin wrapper around the shared `useFlightSession`.
- **Infinite Run**: a sibling component (or `SinglePlayerGame` variant) that holds the windowed map in React state, updates it from `infiniteMap` as the duck advances (drive updates off chunk-boundary crossings — poll `stateRef` at low frequency or via a tiny boundary callback; do NOT rebuild every frame), passes the window to `FlightScene`/`MapView`, sets `enableFinish:false`, `crashEndsRun:true`, and on `onGameOver` shows a "Crashed — distance X" screen with Restart (fresh seed) + Menu. HUD shows live distance + rings.
- Watch the re-render seam: `MapView` must accept the changing windowed map without visibly remounting the whole world each chunk (verify no flashing/hitch when a new chunk appears; if needed, make `MapView` handle incremental/windowed scenery gracefully).

**Files likely touched**
- `frontend/src/game/StartMenu.tsx`, `frontend/src/game/Game.tsx`
- `frontend/src/game/SinglePlayerGame.tsx` (parameterize for distance) and/or NEW `frontend/src/game/InfiniteRunGame.tsx`, NEW `frontend/src/game/RaceSetup.tsx` (distance picker)
- possibly `frontend/src/test/MapView.tsx` (windowed rendering robustness)

**Files NOT to touch**
- `MultiplayerGame.tsx` and `net/*` (these modes are single-player only).
- `buildMap.ts`, `infiniteMap.ts` internals (consume, don't modify).

**Acceptance criteria**
- Menu lets you reach Race (with distance picker) and Infinite Run; multiplayer (incl. `?room=` deep link) still works.
- Race: distance picker clamps to [1000, 50000], default 2000; chosen distance produces a finite course of that length with working rings + finish; pre-race shows the per-distance PB; finish screen shows time + rings and flags new PBs.
- Infinite Run: terrain streams seamlessly with no hitch/flash at chunk seams; crash (tree/ring-rim only) ends the run immediately (no respawn, no ground-death) and shows the game-over screen; Restart starts a fresh run.
- Typecheck/build + tests pass.

---

## Task 6 — Daily streak UI (7-day mystery unlock tracker)

**Depends on:** Task 1 (streak logic + `getStreak()` already live there).

**Context / need-to-know**
- Streak math is owned by `flightStore` (`touchStreak()` runs inside `recordSession`, gated on the qualifier: `distance>=2000 || finished`). This task is UI ONLY — read `getStreak()` and render progress toward the 7-day unlock. Do NOT recompute streak logic in the component.
- **The unlock has NO payload yet.** Present it as a MYSTERIOUS, intriguing reward — a glowing/locked "???" mystery box, "something unlocks at 7 days", with a teasing tone. No actual reward is granted; this is a hype placeholder.

**Suggested implementation**
- New component `frontend/src/game/StreakTracker.tsx`: reads `getStreak()`, shows `current` and a 7-pip progress bar; the 7th pip is a locked/glowing mystery icon. Copy like "🔒 ??? — fly N more day(s) to reveal". At `current>=7` show a celebratory "unlocked!" mystery state (still no concrete reward — just intrigue). Style with `game/ui.tsx` primitives (`Panel`, `COLORS`, fonts).
- Surface it where players see it between runs — the single-player menu and/or the finish/game-over screens. Keep placement non-intrusive.

**Files likely touched**
- NEW `frontend/src/game/StreakTracker.tsx`
- A menu/finish screen to mount it (e.g. the single-player submenu from Task 5).

**Files NOT to touch**
- `flightStore.ts` internals (only call `getStreak()`).

**Acceptance criteria**
- Tracker shows the current streak and remaining days to 7, updates after a qualifying run.
- No streak math in the component (only reads the selector).
- Typecheck/build passes.

---

## Task 7 — Wire stat recording into all modes

**Depends on:** Tasks 1, 3, 5 (Task 3 provides `flySRef`; Task 2 the hook).

**Context / need-to-know**
- This connects gameplay to `flightStore.recordSession`, through the module only.
- **Control label**: NOT the mode toggle. Resolve from the per-run `usedKeyboardRef` (Task 3): `control = usedKeyboardRef.current ? 'kb' : 'cam'`. (Any keyboard input during the run ⇒ `'kb'`.)
- Fly-time: read `flySRef.current` (Task 3). Distance: `stateRef.current.distance`. Rings: `passedRingsRef.current.size`.
- MP: there is no `distance` in `PlayerView`; record from the LOCAL sim. `finished` = you crossed the line; `won` = `finished && rankPlayers(players).find(p=>p.finished)?.id === self.id` (reuse `ResultsScreen` logic). Fire exactly once when `race.phase` transitions to `'finished'` (guard against the ~20 Hz snapshot re-renders).

**Suggested implementation**
- **Race (solo, all distances incl. default 2000)**: in the finish handler (`onFinish`), call `recordSession({ mode:'race', control, flyS, distance, rings, targetDist, timeMs, finished:true })`. There is no "Classic" special case — the default 2000m solo IS a race with `targetDist=2000`, so it shares the per-distance PB system.
- **Infinite Run**: in `onGameOver`, call `recordSession({ mode:'infinite', control, flyS, distance, rings, crashes:1 })`.
- **Multiplayer**: in `MultiplayerGame.tsx`, add an effect keyed on `race.phase === 'finished'` that records once: `{ mode:'multiplayer', control, flyS, distance: stateRef.current.distance, rings: passedRingsRef.current.size, finished, won }`. (DNF still records — games++ and aggregates; just `won:false`, `finished:false`.) Use a `recordedRef` so it fires a single time per race. NO `placement` field.
- **Abandoned runs (NICE-TO-HAVE, not critical)**: on exit-to-menu mid-flight (the `onExit` paths), if a run was in progress, flush `recordSession({ ...mode, control, flyS, distance, rings, abandoned:true })`. The store adds only aggregates for abandoned sessions (no games++/PB/win). Skip if it complicates the exit flow.
- Reset `flySRef` to `0` and `usedKeyboardRef` to `false` on each run (re)start (in `reset()` / the racing-entry reset effect).

**Files likely touched**
- `frontend/src/game/SinglePlayerGame.tsx` (+ Distance/Infinite components from Task 5)
- `frontend/src/game/MultiplayerGame.tsx`
- possibly `frontend/src/game/useFlightSession.ts` (own `flySRef` reset)

**Files NOT to touch**
- `flightStore.ts` internals (call the public API only), `net/*` networking internals, `FlightRig.tsx` (already done in Task 3).

**Acceptance criteria**
- Completing each mode writes exactly one correctly-tagged session (verify via `getRecentSessions()` / aggregates in devtools).
- Control label is `'kb'` if keyboard was used at any point in the run, else `'cam'` (test: camera-mode run with a stray space tap records as `kb`).
- MP `won` is true only when you finished as winner; a DNF still increments MP games + aggregates with `won:false`; MP records once per race (no duplicates from snapshot churn).
- Streak only advances when a run hit ≥2000m or finished a race.
- (If implemented) an abandoned mid-run exit adds aggregate fly-time/distance/rings but no game/PB/win.
- Aggregates/PBs/streak update after runs; no double counting; typecheck/build + tests pass.

---

## Suggested execution order
1 (data + stats UI) and 2 (refactor) and 4 (streamer) can start in parallel → 3 (rig instrumentation: fly-time + infinite-only crash-ends-run) → 5 (modes) → 6 (streak UI) + 7 (wiring) last.
