# MP Finish — Redesign (backend goes ring-free)  [IMPLEMENTED]

Scope: ONLY the "crossing the finish does nothing / never finish / fly into void" bug.
Decision: the **frontend owns the course and finish**; the **backend owns coordination**.

Status: built. Backend is ring/collision-free; finish + rings + crashes ride the pose stream;
overlays split into `frontend/src/game/screens/` behind one `RaceScreens` switch. Both
typechecks pass. Legacy `?view=race|multiplayer` harnesses kept compiling via frontend shims
(ringPassed/onSpinOut/lap/spunOut/ringCount retained client-side only).

## The bug (why finish never fires)
- Two incompatible course generators existed:
  - backend `generateRingLayout(seed, 8)` → 8 rings on a CIRCULAR track.
  - frontend `buildMap(seed)` → ~19 rings in a STRAIGHT corridor.
- Client renders/flies the corridor and never reads the server's `ringLayout`.
- `race.ringCount = 8` (circular) so `reportRing` drops corridor ring ids ≥ 8.
- Server only set `finished` after passing rings 0..7 in STRICT order; a single missed/
  clipped ring stalls the sequence forever → never finished → grace never starts → race
  never ends.
- The visual finish line (corridor end) was never wired to the server (`enableFinish:false`)
  → crossing it did nothing → fly into the void.

## Principle
Backend needs zero knowledge of rings, ring count, or map geometry. The course is fully
determined by one number (`mapSeed`). The client builds it, scores it, and decides when it
crossed the line. The backend coordinates the room and relays.

Accepted trade-off: finish/progress are client-reported (cheatable). Fine for a friends game.

## Collisions: all FE, no server collisions at all
- Bird-vs-bird collisions are GONE — removed entirely.
- Bird-vs-tree and bird-vs-ring-rim are already FE-only: `FlightRig` detects `treeHit` /
  `ringRimHit` and does a client-local respawn + `onCrash` flash. Stays as-is.
- The leaderboard "crashes" number = the client's own crash count (tree/ring respawns),
  reported as a single number. Display-only; never affects rank.

## Division of responsibility
Backend OWNS:
- lobby/roster, host, ready, the phase machine (lobby→countdown→racing→finished→lobby),
- the countdown clock, `raceStartAt`, the finish-grace window + hard deadline,
- relaying player pose,
- ranking by server-stamped `finishTime` (finishers first by time; non-finishers DNF),
- storing two display-only numbers per player: `ringsPassed` + `collisions` (both reported),
- `mapSeed` (one host-chosen number) so every client builds the identical course.

Backend does NOT own (REMOVE):
- `generateRingLayout`, `mapSeed.ts` ring code, `DEFAULT_RING_COUNT`, `TRACK_RADIUS`,
- `RingSchema`, `RaceState.ringLayout`, `RaceRoom.buildRings()`,
- strict ring scoring: `ringsPerLap`, `totalLaps`, `applyRingPass` ordering, `RingProgress`,
- ALL collision logic: `detectCollisions`, `collisions.ts`, `COLLISION_RADIUS`,
  `runCollisions`, `recoverSpinOuts`, `spinOutUntil`, `SPINOUT_RECOVERY_MS`,
  `player.spunOut`, and the `SpinOut` broadcast,
- `ringCount` in the snapshot (client derives it locally from `buildMap`).

## Finish, the new way
- Client detects `z >= finishZ` (corridor end / finish checkpoint) ONCE → sends a finish
  signal. Matches the visible line and single-player. A missed ring can't block it.
- Server stamps `finishTime` (server clock) the first time it sees the player finished,
  sets `player.finished = true`, and — on the FIRST finisher — starts the existing grace
  window (`finishWindowEndsAt`). Elapsed = `finishTime - raceStartAt` (one clock, no skew).
- `allFinished` (every connected player finished) OR grace expiry OR hard deadline →
  phase `finished`. (All already implemented; just driven by the new finish signal.)

## Screens (one file each, not if-blocks)
The 3D `FlightScene` stays mounted the whole time; exactly ONE overlay screen shows on top,
chosen by a single switch on `(status, phase, self.finished)`. No stacked `if` blocks.

Screen → when it shows:
| Screen                 | Condition                                   | Purpose                                  |
|------------------------|---------------------------------------------|------------------------------------------|
| `ConnectScreen`        | `status !== 'connected'`                    | name/duck, host or join by code          |
| `LobbyScreen`          | connected & `phase==='lobby'`               | WAIT screen: roster, code, ready/start   |
| `CountdownOverlay`     | `phase==='countdown'`                       | 3·2·1·GO over the live scene             |
| `RaceHud`              | `phase==='racing'` & `!self.finished`       | GAME IN ACTION: telemetry + live board   |
| `FinishedWaitingScreen`| `phase==='racing'` & `self.finished`        | you crossed: leaderboard + grace timer   |
| `ResultsScreen`        | `phase==='finished'`                        | END leaderboard: winner, stats, rematch  |

These six are mutually exclusive and cover every state → no "fly into the void" gap.

File layout (split out of `MultiplayerGame.tsx`):
```
frontend/src/game/
  MultiplayerGame.tsx        # scene + sim wiring + <RaceScreens/> (the switch only)
  screens/
    RaceScreens.tsx          # the single (status,phase,finished) -> screen switch
    ConnectScreen.tsx
    LobbyScreen.tsx
    CountdownOverlay.tsx
    RaceHud.tsx
    FinishedWaitingScreen.tsx
    ResultsScreen.tsx
  ui.ts                      # shared Overlay/Panel/Button/Table/COLORS/formatTime (exists)
```
Shared sub-bits (Field, Segmented, RosterTable, LeaderboardTable, medal) live in `ui.ts` or a
`screens/parts.tsx` so screens don't duplicate them. `MultiplayerGame` no longer holds any JSX
for the overlays — it renders `<FlightScene>…</FlightScene>` then `<RaceScreens race={race} self={self} onExit={onExit} />`.

## Wire format changes
Fold progress + crashes + finish into the pose stream the client already sends ~20Hz, so we
don't add chatty messages:
- `UpdateState` payload gains `ringsPassed: number`, `collisions: number`, `finished: bool`.
- Server copies `ringsPassed` + `collisions` to the player each tick (display only); the
  first tick it sees `finished=true` it stamps `finishTime` + flips the flag (idempotent —
  later updates can't un-finish).
- DELETE the `RingPassed` client message + handler + `applyRingPass` call.
- DELETE the `SpinOut` broadcast (no bird-vs-bird).

Snapshot/types:
- Remove `ringCount` from `RaceSnapshot`; client computes `buildMap(seed).rings.length`.
- Remove `spunOut` from `PlayerView`/schema.
- Keep `finishWindowEndsAt` (already added) for the "others have Xs left" countdown.

## Frontend changes
- `MultiplayerGame`: set `enableFinish: true` and a finish callback that flags local
  `finished` + includes it in the pose stream. The freeze + `FinishedWaiting` overlay added
  earlier then triggers correctly (no void), and `finished` phase shows `Results`.
- Report `ringsPassed = passedRingsRef.size` in the stream (order-tolerant; rings are just
  score/boost now, never a gate).
- Count crashes locally (increment in the existing `onCrash`) and report as `collisions`.
- Drop the spin-out path: `onSpinOut` subscription, `spinning` state, the "SPUN OUT" HUD.
- Derive `ringCount` locally for the HUD.

## State cleanup (do alongside)
- Stop mutating refs during render (`runningRef`, `playersRef`, `mapRef`, `sessionIdRef`);
  set them in effects or read inline.
- Collapse the duplicated ring state (`passedRingsRef`+`passedRingIds`,
  `ringPulseAtRef`+`ringPulseAt`, `syncRings`) to a single source.

## Migration checklist
1. Backend schema: drop `ringLayout`/`RingSchema` + `spunOut`; keep `mapSeed`,
   `finishWindowEndsAt`, `ringsPassed`, `collisions`, `finishTime`.
2. Backend RaceRoom: delete `buildRings`, ring imports, scoring import, AND all collision
   code (`runCollisions`, `recoverSpinOuts`, `spinOutUntil`, `detectCollisions`,
   `COLLISION_RADIUS`, `SPINOUT_RECOVERY_MS`, `SpinOut` broadcast). Copy `ringsPassed` +
   `collisions` from the pose stream; stamp `finishTime` on first `finished=true`; start
   grace then.
3. Backend: delete `mapSeed.ts` (ring generator), `collisions.ts`, and `scoring.ts` ring/lap
   logic (keep `computeLeaderboard`, which only needs finished/finishTime + ringsPassed for
   display tiebreak).
4. Messages: extend `UpdateStatePayload` (`ringsPassed`, `collisions`, `finished`); remove
   `RingPassed` and `SpinOut`.
5. Net layer: drop `ringCount` + `spunOut`; keep `finishWindowEndsAt`.
6. Frontend: `enableFinish:true` + finish→stream; report ringsPassed + crash count in
   stream; remove spin-out handling; derive `ringCount` locally.
7. Frontend: split overlays into `screens/` (one file each) + `RaceScreens` switch; gut the
   JSX out of `MultiplayerGame`.
8. Update tests: remove ring-sequence + collision tests; add finish-on-signal + grace tests.
