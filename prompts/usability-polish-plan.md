# Usability & Polish Plan

Whiteboard. Status: brainstorming.

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
