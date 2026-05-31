# Usability & Polish Plan

Whiteboard. Status: brainstorming.

## ROOT CAUSE (the real one) — finish never fires
Two incompatible course generators:
- backend `generateRingLayout(seed,8)` = 8 rings on a CIRCULAR track (cos/sin, r=40).
- frontend `buildMap(seed)` = ~19 rings in a STRAIGHT corridor (z=100..1900, gap 100).
Client renders/flies the corridor and ignores the server's broadcast `ringLayout`.

Breakage chain:
1. `race.ringCount=8` but corridor has ~19 rings → `reportRing` drops ids ≥ 8.
2. Server marks finished only after passing rings 0..7 in STRICT order (`applyRingPass`
   rejects out-of-order). Miss/clip one of the first 8 → server stalls on that id forever →
   never finished → grace never starts (firstFinishAt stays 0) → race never ends.
3. Visual finish line (z=2000) is NOT wired to the server in MP (`enableFinish:false`) →
   crossing it does nothing → fly into the void.
SP finish = z>=length (distance); MP finish = ring sequence. Inconsistent definitions.

## BETTER DESIGN (proposed; not yet built)
1. ONE shared course generator. Promote buildMap ring layout to a shared module both
   sides import; delete circular `generateRingLayout`. ids/positions/count agree.
   Client should use the SAME layout it renders for reporting (or use state.ringLayout).
2. Finish = crossing the finish line. Client detects z>=finishZ → `Finish` msg → server
   stamps finishTime + finished + starts existing grace. Matches visual line + SP. Robust.
3. Rings = scoring/boost gates only, order-tolerant; never block finishing.

## STATE CLEANUP (messy bits)
- Refs mutated during render (runningRef/playersRef/mapRef/sessionIdRef) → move to effects.
- Ring state stored twice (passedRingsRef+passedRingIds, ringPulseAtRef+ringPulseAt) via
  syncRings mirror → collapse to one source.
- finishedRef threaded but unused in MP (enableFinish:false).

## EARLIER PATCH (correct but never triggers until root cause fixed)
Root cause: MP had no per-player finish treatment. `enableFinish:false` + `finishedRef` never set → a
finisher kept flying into the void; you only ever saw the leaderboard once the WHOLE race ended.
Reproduced on both deployed and local, so it was a real frontend gap (not a stale deploy).

Done:
1. **Freeze on finish (MultiplayerGame.tsx).** `runningRef = phase==='racing' && !self.finished`. The
   instant the server marks you finished, your duck stops dead — no void.
2. **`FinishedWaiting` overlay.** Shows the moment you cross: your time/rank/crashes, live leaderboard,
   and a countdown of how long the rest of the field has left. RaceHud + ControlsLegend hide for you.
3. **Surfaced the grace deadline.** Added `finishWindowEndsAt` to schema → snapshot → types so the
   "others have Xs left" countdown is real (server's existing FINISH_GRACE_MS = 20s).
4. `finished` phase still shows the full `Results` table (winner + rematch) as before.

Flow now: cross line → `FinishedWaiting` (frozen, leaderboard, 20s grace) → all finish OR grace expires
→ `Results`.

## Goals (from request)
1. Enter name once (persist), reuse on every lobby join.
2. Support multiple concurrent lobbies / let friends group up.
3. Clean race END: winner + leaderboard + scores clearly shown.
4. Easy rematch.
5. Better UI/UX (kill mismatched monospace/emoji harness styling).
6. End screen shows rings passed + collision count per player.
7. Keep deployment cheap.

## Current-state facts
- `joinOrCreate("race")` ALREADY makes new rooms past 8 players. Not "one lobby". Gap = no way to pick/share a room.
- `finished` phase + `Results` table exist. But MP only finishes a player on completing all rings; void-flyers stall until 5-min `raceDeadline`. No clean end.
- `finished→lobby` transition is legal but unwired. "Back to lobby" just leaves.
- Collisions = `spunOut` boolean only. No counter. Rings tracked via `ringsPassed`.
- Lobby/HUD/Results use `test.css` (monospace, emojis); `StartMenu` is the polished style to match.
- VM: 1× shared-cpu-1x / 256mb, min_machines_running=1, auto_stop=false.

## Decisions
### Race end (MP)
- Finishing = passing the final ring (already wired: last ring → lap+1 → finished). Void-flyers simply never finish.
- When the FIRST player finishes, start a ~20s finish-grace timer. Race → `finished` when allFinished OR grace expires. Keep 5-min raceDeadline as a hard backstop.
- Backend: add `firstFinishAt` + grace to `PhaseInputs`/RaceRoom.

### Stats (both modes)
- Track race START time (when `racing` begins) → elapsed = finishTime − start.
- SP: clock starts on run start/reset, stops at finish.
- MP: server stamps `finishTime`; surface elapsed per player in snapshot/Results.
- Add `collisions` counter to `PlayerSchema` (increment in `runCollisions`, not just the `spunOut` bool). Show on Results + end screens.
- End screens show: rank, name, rings passed, collisions, time taken.

### Asset-load grace (simple)
- No readiness handshake. Just give extra time: bump countdown (e.g. 3s → ~6s) so models/scene finish loading before racing. Cheap, no new protocol.

### Name once
- Persist name (+ duck variant) to localStorage; prefill and skip re-entry on rejoin. Editable.

### Rematch
- Add a "Play again" client msg → server resets room (`finished → lobby`, new seed, reset progress/collisions/ready). Currently "Back to lobby" only leaves.

### UI/UX
- Reskin Lobby / RaceHud / Countdown / Results / SP FinishOverlay to match `StartMenu`'s polished style (kill monospace harness `test.css`, tame emojis).

### Lobbies (invite codes)
- MP entry becomes **Host** or **Join** (after name is known).
- Mechanism (IMPLEMENTED): built-in Colyseus matchmaking with `.filterBy(["code"])` — no Express, no custom HTTP.
  - Client generates the short code (`net/lobbyCode.ts`, 4 chars, unambiguous set) and passes it in options.
  - Host: `client.create("race", { name, duckVariant, code })`. Server echoes it to `RaceState.code` (with a server-side fallback if absent).
  - Join: `client.join("race", { name, duckVariant, code })` — matchmaking routes to the room with that code, or throws → friendly "No lobby found for that code".
  - No mid-race joins: room `lock()`s on countdown, `unlock()`s on rematch (locked/full rooms are excluded from matchmaking).
- Share link: `?room=CODE` (alongside existing `?server=`). On load, prefill/parse the code; user can also type it. Auto-prompt join once name is set.
- Rematch: same room stays alive; "Play again" returns the room to `lobby` keeping players + code (see Rematch).

### Rank
- Rank = **finish order only** (finishTime ascending). Non-finishers = DNF, listed after finishers. Collisions + time are display-only, never affect rank.
- `computeLeaderboard` already ranks finishers by finishTime; simplify unfinished to DNF.

### Minor
- Keep `MIN_PLAYERS_TO_START = 2` for MP (host waits for ≥1 more).

## Approach / migration waves
1. **Backend**: room codes (`.filterBy(['code'])`, `code` in schema, create vs join). Add `collisions` counter + `finishTime`/elapsed. Finish-grace timer (first-finish → 20s → finished). `PlayAgain` msg → reset room to lobby (new seed, clear progress/collisions/ready/finished/spunOut, keep players+code). Bump countdown for load grace.
2. **Net layer**: `connection.ts` host/join methods, `playAgain()`, surface `code` + `collisions` + elapsed in `RaceSnapshot`/`PlayerView`. `serverConfig`-style `?room=` parse.
3. **Frontend MP**: Host/Join screen, code display + copy/share link, reskinned Lobby. Reskin RaceHud/Countdown. New Results screen (rank, name, rings, collisions, time) + "Play again" / "Leave". Persist name+variant to localStorage.
4. **Frontend SP**: race clock; FinishOverlay shows rings + time (+ distance), reskinned to match.
5. **Polish pass**: replace `test.css` harness look across overlays; consistent typography/emoji with `StartMenu`.
