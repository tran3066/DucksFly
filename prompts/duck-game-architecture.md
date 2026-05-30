# DucksFly — 24h Hackathon Architecture Whiteboard

> Input doc for Opus 4.8. High-level architecture + library decisions + 4-person work split.
> Status: DRAFT. Open questions flagged with ❓.

---

## 1. Game Concept (locked)

In-browser, React, MediaPipe-controlled 3D flying race game. You are a duck. Fly through
an environment, pass through rings for speedups, race other ducks. Crash = respawn at checkpoint.

**Controls (physical, via webcam):**
- Flap arms → go up + accelerate
- No flap → descend (gravity)
- Lean left/right → turn left/right
- Open mouth → quack
- 67 easter egg: the "6-7" hand motion triggers it → plays a sound + pops a nice-looking "6-7"
  number animation on screen. (Needs Hand/gesture detection — MediaPipe HandLandmarker.)

**Stretch:** dive motion, special-item activation motions, weather.

### Motion mechanics to A/B test (STRETCH — owner: Input + Engine person)
Both "cool but unproven" mechanics. Build each behind a toggle and playtest which feels good.

**Turning (left/right):**
- Option A — physical torso lean left/right to bank/turn.
- Option B — asymmetric wings: raise/extend one arm higher than the other to bank (keeps eyes on screen).

**Diving (fast descent):**
- Option A — physical dive motion (tilt/look head-down) to nose-dive. Risk: player loses sight of screen.
- Option B — no dive gesture; just stop flapping → gravity descent (optionally arms-tucked/pinned-in = steeper, faster dive while still facing screen).

DECISION: implement both options for each, gate behind a config toggle, pick winners during playtest.

---

## 2. THE Big Decision: Where does physics live?

**Recommendation: Client-authoritative physics + server relay.**

- Each FE runs MediaPipe → interprets to ACTIONS → simulates its OWN duck's position locally.
- FE sends its position/velocity to server at ~15–20 Hz.
- Server broadcasts everyone's positions; FE interpolates remote ducks.
- Server is authoritative ONLY for: scores, ring-pass validation, race start/finish, lobby state.

**Why (least glitchy for a hackathon):**
- Your own duck reacts to your body with ZERO network round-trip = feels responsive.
- MediaPipe inference jitter stays local; you smooth it before it ever hits the wire.
- Avoids the hard part of authoritative netcode (prediction + reconciliation) we can't finish in 24h.
- Downside: cheating possible + collision disputes. For a friendly hackathon race, acceptable.

**Rejected alt:** server-authoritative (FE sends actions, BE computes position). More "correct"
but needs client-side prediction to not feel laggy = too much for 24h.

**Player-vs-player collisions: SERVER-authoritative.** Server detects overlap from the broadcasted
positions and emits a `spinOut` event to the affected duck(s). Keeps it fair + avoids two clients
disagreeing on who crashed. (Ring passes/hits stay client-local since rings are static + seed-shared.)

---

## 3. Library Decisions (proposed)

| Concern | Pick | Notes |
|---|---|---|
| Rendering | **three.js + react-three-fiber (R3F)** | 3D sky/clouds/rings; R3F = React-friendly |
| 3D helpers | **@react-three/drei** | cameras, sky, loaders, helpers |
| Body tracking | **@mediapipe/tasks-vision** | Pose (required) + Face (opt: mouth) + Hand (opt: 6-7 egg) |
| Networking + rooms | **Colyseus** (node) | rooms, lobby, state sync, presence out-of-the-box |
| Backend runtime | **Node.js + TypeScript** | shared types with FE |
| Build/dev | **Vite** | fast HMR, easy R3F setup |
| State (FE) | **Zustand** | lightweight game/UI state |

✅ Colyseus (decided). Auto state-sync (mutate server state → auto-diffed to clients) + rooms +
lobby out of the box = least boilerplate for 24h. Socket.IO would mean hand-rolling all of that.

✅ Pose model is the primary/required input. Face (mouth quack) AND Hand (6-7 egg) are OPTIONAL/stretch —
add only if perf allows. ⚠️ Three models on one webcam stream is a real perf risk; profile early,
consider running optional models at a lower frame rate / time-sliced. NO keypress fallback
(player is standing at the camera, not the keyboard).

---

## 4. High-Level Architecture

```
┌────────────────────────── BROWSER (per player) ──────────────────────────┐
│  Webcam → MediaPipe (Pose + Face)                                          │
│     → Gesture Interpreter (flap/lean/dive/quack → ACTIONS)                 │
│     → Local Physics (ACTIONS → my duck pos/vel, gravity, ring boost)       │
│     → R3F Renderer (my duck + interpolated remote ducks + environment)     │
│     → HUD (speed, rank, lap, quack)                                        │
│           ▲                          │                                     │
│           │ remote duck states       │ my state @15–20Hz + events          │
└───────────┼──────────────────────────┼─────────────────────────────────────┘
            │                          ▼
┌───────────┴──────────── NODE + COLYSEUS SERVER ──────────────────────────┐
│  Room: holds map seed, player list, positions, scores, race phase         │
│  - broadcasts position snapshots                                          │
│  - validates ring passes / lap counts → score                             │
│  - lobby ↔ countdown ↔ racing ↔ finished state machine                    │
│  - sends initial map/environment seed on join                             │
└────────────────────────────────────────────────────────────────────────┘
```

**Map:** server sends a SEED (+ ring layout); all clients generate identical environment from it.
Keeps payload tiny and worlds consistent.

---

## 5. Screens / Flow (locked)

Home → (pick duck color/style) → Lobby (ducks walking around) → Countdown → Race → End/Leaderboard.

- Respawn: crash into ring or duck → spin-out → reset to last checkpoint.
- Seeing others: nameplates + on-screen arrows/minimap for off-screen ducks. ❓ minimap vs arrows vs both?

---

## 6. Proposed 4-Person Split

Each person owns one vertical-ish slice. Shared contract = the **ACTIONS** type + the
**network state schema** (define these FIRST, together, hour 0).

### Person A — MediaPipe Input & Controls
- Webcam capture, load Pose + Face models, run inference loop.
- Gesture interpreter: flap detection (arm velocity), lean/turn, dive, mouth-open quack, 6-7 hand egg.
- Run optional models (Face, Hand) time-sliced / lower-FPS to protect Pose responsiveness.
- Output a clean `DuckActions` object (smoothed, debounced) per frame.
- Calibration + fallback keyboard controls for testing without standing up.
- ⚖️ Build BOTH flap models (binary flap=climb vs flap-rate=speed) behind a toggle; A/B test which feels better + less glitchy.

### Person B — Game Engine & Rendering
- R3F scene: duck model, camera follow, environment (sky/clouds/land/river/sea/forest).
- Local physics: ACTIONS → velocity/position, gravity, dive=speed, climb=slow, ring boost.
- Rings (pass = boost, hit = spin-out), checkpoints, respawn.
- Consumes `DuckActions` from A; renders remote ducks from D.

### Person C — Backend, Networking & Multiplayer
- Colyseus server: room lifecycle, lobby→countdown→race→finished state machine.
- Position broadcast + interpolation contract, map seed distribution.
- Player-vs-player collision detection (server-side) → emit `spinOut` events.
- Scoring, lap/ring validation, leaderboard data.
- Client networking hook (`useRoom`) feeding B/D.

### Person D — 3D Assets, Art & UI  ⭐ (asset creation is a LARGE workstream)
- **PRIMARY: source/create + polish all 3D assets** — duck model (rigged for flap if possible),
  rings, clouds, environment props (land/river/sea/forest), color/style variants. This is big;
  it's the visual identity of the game. Find good GLTF/GLB assets or model low-poly + texture them.
- Duck color/style variants (drives the customization picker).
- Screens (React + Zustand): Home, Lobby, Countdown, Race HUD, End/Leaderboard — lighter-weight,
  can borrow help from others if asset work overflows.
- Nameplates, minimap/off-screen arrows, visual polish, quack sound.

> ⚠️ Assets are the biggest single-person risk. Start hour 0. Define a placeholder duck (a cube/
> primitive) immediately so B can build physics/rendering in parallel without waiting on final art.

**Integration points:** A↔B via `DuckActions`. B↔C/D via network state schema + remote duck list.
Define both contracts in a shared `types/` package hour 0.

---

## 7. Open Questions (resolve early)

1. ✅ Player-vs-player collisions = server-authoritative. Ring collisions = client-local. (§2)
2. ✅ Colyseus (decided). (§3)
3. ✅ Pose required; Face/mouth quack optional/stretch; no keypress fallback. (§3)
4. ⚖️ Faster flap = more speed vs binary flap = climb. DECISION: Person A builds both behind a toggle and tests in-game.
5. ⚖️ Dive + turn mechanics: two options each, build both behind toggle, playtest. (§1)
6. ❓ Off-screen duck indicators: minimap, arrows, or both? (§5)
7. ✅ Dedicated person (D) owns 3D assets as a large workstream; placeholder primitive from hour 0. (§6)
8. ✅ Up to 8 players per race (room cap = 8). Budget netcode + rendering + indicators for 8 ducks.
9. ✅ 67 egg: "6-7" hand motion → sound + animated "6-7" on screen. Needs HandLandmarker model.
```
