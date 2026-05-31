# Multiplayer Merge Plan (single game, SP + MP)

Whiteboard. Status: brainstorming.

## Truth
- Canonical game = `frontend/src/debug/PersonAPlayground.tsx` + `frontend/src/debug/flightModel.ts`.
- THROW OUT all multiplayer sim/yaw: `physics/step.ts`, `physics/interpolate.ts`, the `LocalDuckRig` sim in `MultiplayerRace.tsx`, `DuckMesh`, the turning model. Multiplayer adopts `flightModel.ts`.
- KEEP only the backend syncing layer: `net/connection.ts`, `net/useRace.ts`, `net/types.ts` (sim-agnostic: takes pos/vel/quat + ring passes).
- One game. Multiplayer is the real target; single-player is a thin variant (no net, always "racing", local seed/finish).

## Net contract (already sim-agnostic, no changes needed)
- Out: `sendState({pos, vel, quat})` ~20Hz + `ringPassed(ringId, lap)`.
- In: `useRace()` snapshot = players[] (pos/vel/quat/rings/rank/...), phase, mapSeed, ringCount, countdown, host.
- flightModel gives pos + speed + yaw(=0)/pitch/roll → trivial to derive vel & quat.

## Proposed structure
Extract the playground's gameplay into a shared core; both modes import it.

```
src/game/
  flight.ts          (was debug/flightModel.ts: flightStep, FlightConfig, DEFAULT_FLIGHT, createFlightState)
  gameConfig.ts      (was debug/playgroundConfig.ts: BOOST, etc.)
  FlightScene.tsx    (the shared <Canvas> contents: rig + map + local duck + camera + rings/boost)
  useFlightRig.ts    (the PlaygroundRig sim loop, made mode-agnostic)
  hud/               (Hud, ControlsHint, FinishOverlay, DebugToggle)
  Game.tsx           (mode switch: <SinglePlayerGame> | <MultiplayerGame>)
  SinglePlayerGame.tsx
  MultiplayerGame.tsx
src/net/             (unchanged — sync only)
```

avatar/* , map/* , world/* stay as-is (already clean, shared).

## What FlightScene owns (shared, identical in both modes)
- The flight sim rig (flightStep loop), local duck (`avatar/Duck`), `FollowCamera`, `SimpleSky`, `MapView`, ring-pass detection + decaying boost, finish-at-length.

## What differs (thin adapters, so SP and MP never touch each other)
| concern | SP | MP |
|---|---|---|
| seed | leva slider | `race.mapSeed` |
| sim gate | always running | only while `phase==='racing'` |
| spawn | origin | server player index offset |
| ring pass | local boost only | local boost + `ringPassed()` to server |
| pose | — | stream `sendState()` ~20Hz |
| other ducks | none | `<RemoteDuck>` interpolated from snapshot |
| overlays | FinishOverlay | Lobby / Countdown / RaceHud / Results |

Mechanism: `FlightScene` takes props/callbacks — `seed`, `running` (bool/ref), `spawnIndex`, `onRingPassed?`, `onPoseSample?`, plus `children` (extra scene content e.g. remote ducks). MP wraps it; SP passes defaults. Net code lives ONLY in `MultiplayerGame`.

## Remote ducks (DECIDED)
- Backend per-duck sync = `pos`, `vel`, `quat` + scoreboard (`name`, `duckVariant`, `ringsPassed`, `lap`, `rank`, `spunOut`, `finished`, `ready`). NO flap/lean/dive.
- Reuse the SAME `avatar/Duck` for remotes (retire `test/DuckMesh`). It already takes `actionsRef<DuckActions>` + an externally-driven group, so:
  - group: position = lerp(`pos`), quaternion = slerp(`quat`) (orientation handled, banks/dives correctly).
  - actionsRef: an INFERRED `DuckActions` from a new pure helper `inferActions(vel, quat)` — flap≈`clamp(vel.y>0)`, dive≈`clamp(-vel.y)`, lean from roll extracted off the quat, confidence=1.
  - variant: `player.duckVariant`.
- Result: one `<Duck>`, one anim path, shared by local (real merged actions) + remote (inferred). `inferActions` is pure + unit-testable.
- Name label = `<Text>` wrapping the remote `<Duck>` group (as today).

## Open design points
- Boost unify: MP currently does `speed += boost`; switch MP to the SP decaying-overspeed so feel matches.
- Decouple boost/ring refs so MP's "report to server" is a callback, not branching inside the rig.
- Routing (DECIDED): KEEP all legacy routes (`?view=map|race|multiplayer|playground`) untouched. ADD a new `?view=game` → `<Game>`, the real shipped entry. Nothing else removed.

## Entry flow (DECIDED)
- `<Game>` opens on a cool-looking start menu / picker: **Single Player** or **Multiplayer**.
- Single Player → straight into flight (no lobby). `FlightScene` running=always, local leva/random seed, FinishOverlay. No net.
- Multiplayer → full lobby logic (join → ready → host starts → countdown → racing → results), exactly the existing `net` flow, rendering through the shared `FlightScene`.
- Picker is its own component (`StartMenu`); selecting a mode mounts `SinglePlayerGame` or `MultiplayerGame`. Back-to-menu returns to the picker.

## Naming (official)
- `PersonAPlayground` → `SinglePlayerGame` (or fold into `Game`).
- `MultiplayerRace` → `MultiplayerGame`.
- `debug/flightModel` → `game/flight`. `debug/` retired (or kept as a thin debug-overlay toggle).

## Migration waves (draft)
1. Create `src/game/` core by lifting flightModel + the PlaygroundRig + HUD/overlays out of `debug/`, parametrized by the adapter props. SP renders identically to today.
2. Rebuild `MultiplayerGame` on `FlightScene`: server seed, phase gate, spawn index, pose stream, ring report, remote ducks (animated). Delete old sim/yaw/`DuckMesh`.
3. Delete `physics/step.ts` + `interpolate.ts` (+ tests), `PhysicsSandbox`, `MultiplayerTest`(?). Update `App.tsx` routes.
