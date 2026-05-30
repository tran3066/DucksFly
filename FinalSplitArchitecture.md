# DucksFly — Final Split & Architecture

## Shared Foundation (define together, hour 0)
- **Stack:** React + Vite · three.js + react-three-fiber (+ @react-three/drei) · Zustand · MediaPipe `@mediapipe/tasks-vision` · Node + TypeScript + Colyseus OR Playroom.
- **Architecture:** client-authoritative physics + server relay. Each FE runs MediaPipe → ACTIONS → simulates its own duck locally, sends pos/vel @15–20Hz; server broadcasts + interpolates remotes.
- **Server authoritative for:** scores, ring/lap validation, race phase, lobby, **player-vs-player collisions** (`spinOut` events). Ring collisions = client-local.
- **Map:** server sends a SEED + ring layout; clients generate identical worlds.
- **Players:** up to 8 per room.
- **Shared contracts (build first):** `DuckActions` type (A↔B) + network state schema (B↔C↔D), in a shared `types/` package.

---

## 4-Person Split

### Person A — Input, Duck & Camera (the player's avatar)
- MediaPipe: webcam capture, load models, run inference loop.
- MediaPipe → Action interpretation (flap, lean/turn, dive, mouth quack, 6-7 hand egg).
- Output a clean, **hands-off ready-to-go `DuckActions`** object (smoothed/debounced) per frame.
- Duck model animation driven by the MediaPipe movements (flap, lean, etc.).
- Camera view (follow cam on the player's duck).
- ⚖️ Build BOTH flap models (binary flap=climb vs flap-rate=speed) behind a toggle; A/B test.

### Person B — Environment, Rings & Assets
- Render the environment (sky/clouds/land/river/sea/forest) in R3F.
- Render the rings (visuals + placement from the shared map seed).
- Weather options (stretch).
- Find / source environment assets.

### Person C — Gameplay & Physics
- Gameplay state + position calculations from Person A's `DuckActions`.
- Speed up / slow down (dive=faster, climb=slower), ring boost.
- Checkpoints + crash → spin-out → reset to last checkpoint.
- Consumes A's actions; produces the duck's pos/vel that gets rendered + sent to the server.

### Person D — Backend, Multiplayer & Lobby
- **Networking — pick ONE (Person D's call):**
  - **Colyseus** — dedicated authoritative Node server. True server-authority (collisions, scoring),
    more control, but you host/deploy a server.
  - **Playroom Kit** — serverless/managed multiplayer SDK. Fastest to set up, handles rooms/lobby/state +
    host logic; authority lives on a "host" client instead of a real server. Least infra for a hackathon.
- Room lifecycle + state machine: lobby→countdown→race→finished.
- Multiplayer: position broadcast + interpolation contract, map seed distribution, up to 8 players.
- Player-vs-player collision detection (authoritative side) → emit `spinOut`.
- Scoring, lap/ring validation, leaderboard.
- Lobby (ducks together) + client networking hook (`useRoom`) feeding the others.
- Deployment.

> ⚠️ Colyseus = "server-authoritative" cleanly. Playroom = "host-authoritative" (one client is the
> authority). The §Shared "server authoritative for…" items map onto whichever host you pick.

---

## Open
- ❓ Off-screen duck indicators: minimap, arrows, or both?
