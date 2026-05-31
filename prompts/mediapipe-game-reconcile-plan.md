# MediaPipe ⇄ Game reconciliation — implementation plan

Fold the MediaPipe camera-control pipeline (built in `debug/`) into the production
game (`game/`): player picks camera or keyboard, calibration survives lobby joins
but recalibrates on hard refresh, plus a manual Recalibrate button.

---

## Confirmed ground truth (verified in code, not assumed)

- **Default route already lands on Game.** `App.tsx`: `?view=game` AND the default
  fall-through both render `<Game/>`. So the shipped path is where the camera/keyboard
  chooser (Step 1) goes.
- **Physics already unified — debug tuning IS canonical, no migration.** Verified the
  re-exports directly: `game/flight.ts` re-exports `{flightStep, createFlightState,
  DEFAULT_FLIGHT, FlightConfig}` from `../debug/flightModel`; `game/gameConfig.ts`
  re-exports `{MAX_FRAME_DT, BOOST, BOOST_SLIDERS}` from `../debug/playgroundConfig`.
  Single source of truth, no second copy. So the MediaPipe person's tuned
  `DEFAULT_FLIGHT` (baseForwardSpeed 15.6, liftMultiplier 34, diveSink 26, …) + `BOOST`
  are EXACTLY what the game runs today. The ONLY debug tuning not auto-inherited is the
  gesture defaults + `flapAnimSpeed 2.5` (Leva-only) → baked in via Step 6.
- **Only the input layer diverged.** `game/FlightRig.useFrame` merges `base + keyboard`
  only. The current `debug/PlaygroundRig.useFrame` has the full gesture pipeline
  (flap rate/binary, lean, dive, quack, flap-pulse, stale-pose handling) + an
  `activeRef` calibration freeze. Both SP and MP share `FlightRig`, so wiring
  gestures into `FlightRig` covers both modes at once.
- **Stores are module singletons → correct lifetime for free:**
  - `useInputStore` (landmarks, faceLandmarks, jawOpen) — written by the pose/face loops.
  - `useCalibrationStore` (baseline) — explicitly NOT persisted: survives React
    remounts (menu→lobby→game), wiped on hard refresh. EXACTLY the requested behavior.
- **`useFrame` requires the R3F Canvas** → gesture computation must live inside the
  Canvas (i.e. in `FlightRig`), reading the global stores. The camera UI
  (`WebcamPanel`) lives in normal DOM at the `Game` root. They communicate ONLY
  through the global stores — no prop threading between them.
- **`WebcamPanel.calibrated` is LOCAL state** initialized to `false`. If it remounts
  it re-opens the gate even when a baseline exists. Must initialize it from
  `getBaseline() !== null` so a remount with an existing baseline skips the gate.
- **`Duck.tsx` already supports** `flapAnimSpeed` (default 1.8) and `flapHoldSeconds`
  (0.35). Debug passes 2.5 / 0.35 via leva; game omits them (uses 1.8). Minor anim
  delta — adopt 2.5 in game for parity (see step 6).
- `physics/` (Person C) confirmed unused by the game path.
- MP pose stream is derived from `DuckState` (pos/vel/quat) — **input-source agnostic**.
  Camera vs keyboard changes nothing sent to the server. Backend untouched. ✓

---

## Decisions (locked with user)

1. **No default mode.** First load + every hard refresh shows a camera/keyboard chooser.
2. **Chosen mode persists for the session** (survives lobby joins / screen changes),
   reset only on hard refresh. (Module-level state at `Game` root — no localStorage.)
3. **Keyboard mode stops the camera** (privacy/perf) but **keeps the baseline**.
   Re-enabling camera reuses it → **never recalibrates mid-session automatically.**
4. **Calibration runs only** when camera is chosen AND `baseline === null`
   (first camera use per page load).
5. **Manual Recalibrate button** exists (camera mode). Availability:
   - SP / menu / MP-lobby / MP-finished: allowed (freezes the local sim during capture).
   - MP **mid-race**: NOT offered (would freeze your duck while others race). ← see OPEN Q1.
6. **Keyboard stays live even in camera mode** (matches debug; harmless additive merge).

---

## Architecture

```
Game (root, owns: controlMode 'choose'|'keyboard'|'camera')
├─ ModeChooser           (shown when controlMode==='choose')
├─ WebcamPanel           (DOM; mounted ONLY when controlMode==='camera')
│     → writes useInputStore (landmarks/jawOpen) + useCalibrationStore (baseline)
│     → owns calibration gate + Recalibrate button + docked feed
├─ StartMenu | SinglePlayerGame | MultiplayerGame
      └─ FlightScene → FlightRig (in Canvas)
            → if cameraControl: read stores, run gesture pipeline, merge into actions
            → freeze sim while calibration gate is open (calibrationActive flag)
```

Cross-cutting signal needed by `FlightRig` (inside Canvas) from `WebcamPanel` (DOM):
**"is the calibration gate currently open?"** (freeze sim). Carry it in a tiny module
singleton — add `gateOpen` to `useCalibrationStore` (or a sibling zustand store) so
`FlightRig` reads it without prop threading. (`WebcamPanel.onActiveChange` already
emits this; just route it into the store instead of a parent useState.)

---

## Step-by-step

### Step 1 — Control-mode state + chooser  (`game/Game.tsx`, new `game/ModeChooser.tsx`)
- `Game` holds `controlMode: 'choose' | 'keyboard' | 'camera'`, default `'choose'`.
- `ModeChooser` overlay: two big buttons. "Use camera" → `'camera'`. "Use keyboard"
  → `'keyboard'`. (Picking camera is the user gesture that later allows `getUserMedia`.)
- The existing mode/state machine (`single`/`multi`/menu) is unchanged and renders
  underneath; the chooser sits above until a control mode is picked. (`?room=` deep
  link still works — chooser still appears first so we know camera vs keyboard.)
- Mode persists in `Game` state for the session (survives menu→SP→MP). Hard refresh
  resets to `'choose'`.
- Pass `cameraControl = controlMode === 'camera'` down to SP and MP → `FlightRig`.

### Step 2 — Persistent WebcamPanel mount  (`game/Game.tsx`)
- Render `<WebcamPanel .../>` at `Game` root, gated `controlMode === 'camera'`, OUTSIDE
  the menu/SP/MP switch so it stays mounted across screen changes.
- Switching to keyboard unmounts it → existing teardown stops camera tracks + closes
  models (privacy ✓). Baseline stays in the store.

### Step 3 — Make calibration skippable on remount  (`debug/WebcamPanel.tsx`)
- Initialize `calibrated` from `getBaseline() !== null` (lazy `useState` initializer).
  → re-enabling camera with an existing baseline lands straight on the docked feed,
  no gate. First-ever camera use (baseline null) shows the gate. ✓ requirement.
- Route gate-open state to a store flag so `FlightRig` can freeze:
  add `gateOpen`/`setGateOpen` to `useCalibrationStore`; `WebcamPanel` sets it from the
  same place it currently calls `onActiveChange` (gate open → `gateOpen=true`).
- Keep `onCalibrated`/`onActiveChange` props optional/back-compat for the legacy
  `?view=playground` route (do NOT break PersonAPlayground).

### Step 4 — Extract the gesture pipeline into FlightRig  (`game/FlightRig.tsx`)
Port the gesture logic VERBATIM from `debug/PlaygroundRig.useFrame` (lines ~150–290):
- New refs in `FlightRig`: `flapStrategyRef`, `lastPoseFrameRef`, `gestureFlapRef`,
  `flapPulseRef`, `gestureLeanRef`, `gestureDiveRef`, `stalePoseTicksRef`,
  `turnCfgRef`, `diveCfgRef` (seed from baked production defaults — step 6).
- New prop `cameraControl: boolean`.
- Each frame:
  - If `useCalibrationStore.gateOpen` → set `mergedRef = makeIdleActions()`,
    `acc=0`, `impulseRef=false`, skip sim (mirror debug `!activeRef` branch).
    For SP this is the freeze; MP already frozen unless racing.
  - Else if `cameraControl`: run flap/lean/dive/quack/pulse/stale exactly as debug,
    accumulate into `gestureFlap/Lean/Dive`, fire `impulseRef` on binary flap.
  - Merge: `flap = clamp(base+key+gestureFlap+pulse)`, `lean += gestureLean`,
    `dive += gestureDive`, `quack = base.quack || (cameraControl && jawOpen>0.4)`.
  - When `!cameraControl`: gesture terms are 0 (current keyboard-only behavior intact).
- Lean baseline: `getBaseline()?.restShoulderAngle ?? 0` (already how debug does it).
- Keep `confidence` from `base` (=1) — unchanged.

NOTE: keyboard's Space-edge `impulseRef` and gesture binary-flap `impulseRef` both
feed the same one-shot — fine (already true in debug).

### Step 5 — Wire `cameraControl` through SP + MP  (`SinglePlayerGame.tsx`, `MultiplayerGame.tsx`)
- Thread `cameraControl` prop → into the `FlightRigProps`.
- No other change to SP/MP sim, networking, finish, respawn, collisions, rings.
- MP: confirm the gate-open freeze can't desync — gate only opens pre-race or via the
  (lobby-only) recalibrate, never mid-race (step 5/OPEN Q1).

### Step 6 — Bake production gesture defaults  (`game/` constants, no leva)
Use the debug leva DEFAULTS as fixed production values (the playground's tuned set):
- Flap: mode `'rate'`, `rateGain 11.5`, `noiseEpsilon(sensitivity) 0.02`,
  `rateDecay 0.3`, binary `high 0.25 / low 0.08 / refractory 6`.
- Turn: mode `'lean'`, `mirrorSign -1` (mirrored webcam), `maxTilt 28°`,
  `wingSaturation 0.8`, `turnSmoothing 0.4`.
- Dive: `startBelow 0.4`, `fullBelow 1.5`, `smoothing 0.4`.
- Misc: `QUACK_THRESHOLD 0.4`, `STALE_POSE_TICKS 15`, `FLAP_PULSE_DECAY_RATE 6`.
- Duck anim parity: pass `flapAnimSpeed: 2.5` (+ `flapHoldSeconds 0.35`) to the `Duck`
  in `FlightRig` so wingbeats match the playground (game currently defaults to 1.8).
  Put these in `duckVisual` already threaded through `FlightRig`.
- SP keeps its Leva panels; OPTIONALLY add a "Gestures" Leva folder in SP later for
  tuning (not required for parity).

### Step 7 — Recalibrate button placement
- Camera mode, the docked feed's existing "Recalibrate" button is visible in SP and
  in MP lobby/finished. In MP during `phase==='racing'`, hide/disable it (read
  `race.phase`). Simplest: gate the docked Recalibrate button on a prop the host sets
  (`allowRecalibrate`). Game root knows SP vs MP+phase.

### Step 8 — Controls hint + small UX
- `ControlsHint` shows keyboard keys only in keyboard mode; in camera mode show the
  gesture legend (flap arms / lean shoulders / drop arms = dive / open mouth = quack).
- "Switch control" affordance: since mode is switchable, add a small toggle (e.g. near
  Exit) to flip camera↔keyboard. Switching to camera with a baseline skips the gate.

---

## Files touched (summary)
- `game/Game.tsx` — control mode state, ModeChooser, persistent WebcamPanel mount, prop down.
- `game/ModeChooser.tsx` — NEW small overlay.
- `game/FlightRig.tsx` — port gesture pipeline + `cameraControl` + gate-open freeze + duck anim params.
- `game/SinglePlayerGame.tsx` / `MultiplayerGame.tsx` — pass `cameraControl` + `allowRecalibrate`.
- `debug/WebcamPanel.tsx` — `calibrated` init from store, route `gateOpen` to store,
  `allowRecalibrate` prop. Keep legacy props working.
- `input/calibration.ts` (or new tiny store) — add `gateOpen` flag.
- (parity) constants for gesture defaults — colocate in `game/` or reuse `input/config.ts`.

## DO-NOT-BREAK / regression guards
- `?view=playground` (PersonAPlayground) must keep working unchanged.
- Keyboard-only path must be byte-for-byte the current behavior when `cameraControl=false`.
- MP networking payload + backend unchanged.
- No second flight-model copy introduced; keep the single re-export.
- Don't remount the `<video>` element (breaks tracking) — preserve WebcamPanel's
  stable feed-box element.

---

## RESOLVED
1. MP mid-race recalibrate: HIDDEN during `phase==='racing'`. Allowed in
   SP / menu / MP-lobby / MP-finished (freezes local sim during capture).
2. In-game control toggle (camera↔keyboard) near Exit; switching to camera with an
   existing baseline skips calibration.
3. Ship FIXED production gesture defaults. SP keeps an OPTIONAL Leva "Gestures" folder
   for live tuning (off by default with the debug toggle); MP uses the fixed defaults.
4. Camera-mode quack from mouth-open: yes (cosmetic).
