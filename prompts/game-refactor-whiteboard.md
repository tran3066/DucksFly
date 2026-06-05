# Game refactor — plan (DECIDED)

Engine is already shared (`useFlightSession` + `FlightGame` + `buildFlightRig`). This is
rename + dedup + debug-hide, NOT a rewrite. Scope = "deep".

## 1. Renames
- `FlightGame.tsx` -> `MainGameRunner.tsx`; component `FlightGame` -> `MainGameRunner`.
- `SinglePlayerGame.tsx` -> `SingleplayerRaceRunGame.tsx` (component too).
- `MultiplayerGame.tsx` -> `MultiplayerRunGame.tsx` (component too).
- `InfiniteRunGame.tsx` — unchanged.
- Update imports/routing in `Game.tsx`.

## 2. MainGameRunner absorbs rig-building
- `useFlightSession` STAYS a hook each mode calls (idiomatic; not hidden).
- Delete the standalone `buildFlightRig` export; runner builds the rig internally from
  `session` + a `rig` options object passed as a prop:
  `{ mapRef, cameraControl, runningRef, enableFinish, crashEndsRun?, variant?, duckVisual?,
     animCfg?, onFinish?, onCrash?, onGameOver?, onRingPassed? }`.
- Each mode mounts exactly one `<MainGameRunner session={...} rig={...} overlay={...} chrome={...}/>`.

## 3. Dedup the twin HUDs -> `LiveStatHud`
- `RaceStats` (SP) and `InfiniteHud` (Infinite) are the same 100ms poller + freeze logic.
- New `LiveStatHud` in `flightUi.tsx`: takes a `frozen` flag + a list of stat specs
  (label, accent, read fn) and renders `BigStat`s. SP feeds TIME+RINGS, Infinite feeds
  DISTANCE+RINGS. Freeze captures values once when `frozen` flips true.

## 4. Dedup finish/gameover -> `ResultOverlay`
- `FinishOverlay` (SP) and `GameOverOverlay` (Infinite) share pill-stats + button row.
- New `ResultOverlay` (in `ui.tsx` or `flightUi.tsx`): `{ title, subtitle?, badge?, stats:[{label,value,color}],
  primary:{label,onClick}, secondary?:{label,onClick} }`. SP passes the PB badge + Fly-again/Menu;
  Infinite passes Restart/Menu. MP results screen stays its own (different shape).

## 5. One GameChrome + debug behind `~`
- New `GameChrome` component: renders ExitButton + ControlModeToggle consistently, and (when
  debug on) the DebugToggle + FlightDebugHud + Leva slot.
- Debug state lifts to a tiny `useDebugToggle()` hook: listens for `~` (Backquote) keydown,
  toggles a boolean, default FALSE in ALL modes. No always-visible debug chip.
- SP Leva (`useFlightLevaTuning`) only mounts when debug on (already true) — now gated by the
  shared hotkey instead of a per-mode `debug` useState.
- MP: chrome shows control toggle only when not racing (keep), debug hotkey still available.

## 6. Defaults consistency (minor)
- SP currently relies on Leva for baseline; MP/Infinite call `useApplyLocalFlightDefaults`.
  Make SP also call `useApplyLocalFlightDefaults` (Leva overlays on top when open) so all three
  start from the same canonical defaults. Removes a subtle SP-only divergence.

## Files
- RENAME: FlightGame.tsx, SinglePlayerGame.tsx, MultiplayerGame.tsx
- EDIT: Game.tsx (imports/routing), flightUi.tsx (LiveStatHud, GameChrome, useDebugToggle),
  ui.tsx or flightUi.tsx (ResultOverlay), the 3 mode files (consume new primitives),
  useFlightLevaTuning.ts (gate by hotkey), localFlightSetup usage in SP.
- DELETE: buildFlightRig export; inline RaceStats/InfiniteHud/FinishOverlay/GameOverOverlay.

## Guardrails
- Pure refactor: zero gameplay/behavior change (crash-ends-run stays infinite-only; MP/SP respawn).
- After: run frontend typecheck + tests; smoke all 3 modes.

## Resolved
- `ResultOverlay` + `LiveStatHud` live in `flightUi.tsx`.
- Keep `useApplyLocalFlightDefaults` wrapper as-is.
