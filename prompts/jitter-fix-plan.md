# Jitter Fix Plan — #1 Render Interpolation + #2 Vertical Integration

## STATUS: IMPLEMENTED
- #2 physics: `physics/types.ts` `climbGain`→`climbThrust` + new `vertDrag`;
  `config.ts` retuned (gravity 12, climbThrust 30, vertDrag 1.5); `step.ts` now
  INTEGRATES `verticalVel` (with `*dt` on dive-sink) + vertical drag.
- #1 render: new `physics/interpolate.ts` (`lerp`, `lerpAngle`, `interpolatePose`);
  `DuckRig` keeps prev+curr states and draws the interpolated pose.
- #1 finding (double-drive): keyboard spam drives ONLY continuous `flap`;
  `flapImpulse` not fired by sandbox (kept in physics for Person A).
- #4: input integrated inside the fixed step (deterministic, no dual-rAF phase);
  camera `near` raised to 1; both camera position + look-target eased.
- Gameplay (ring-pass, bounds) read authoritative sim state, not the render pose.

---


Root cause: y bobs as a velocity sawtooth (instantaneous `verticalVel`), and we
render at uneven sim-time points. Fix both layers.

---

## #1 — Fixed-timestep + render interpolation (sandbox / render layer)
Owner: Person B/C sandbox now; becomes the shared render pattern (also how remote
ducks interpolate later).

### Idea
Decouple *draw* from *sim*. Keep the previous and current sim states; render the
blend at `alpha = accumulator / fixedDt`. Smooths every axis regardless of physics.

### Changes (frontend/src/test/PhysicsSandbox.tsx — DuckRig)
- Replace single `stateRef` with `prevRef` + `currRef`.
- Loop:
  ```
  acc += min(delta, MAX_FRAME_DT)
  while (acc >= dt) { prevRef = currRef; currRef = step(currRef, actions, cfg, dt); acc -= dt }
  const alpha = acc / dt
  render = interpolate(prevRef, currRef, alpha)
  ```
- Drive duck mesh + camera from `render` (interpolated), NOT `currRef`.
- `flapImpulse` still consumed once per real flap inside the while loop (unchanged).

### Interpolation helper (new, small)
- `lerp(a,b,t)` for position[x,y,z], speed, verticalVel, distance.
- `lerpAngle(a,b,t)` for yaw/pitch/roll — shortest-arc:
  `a + atan2(sin(b-a),cos(b-a)) * t` (handles yaw wrap at ±π).
- Put in `physics/interpolate.ts` (pure) so the network layer reuses it for remotes.

### Gameplay reads stay on the SIM state
- Ring-pass / bounds clamp use `currRef` (authoritative), not the interpolated
  render value. Keep ring crossing span = prevFrame.z → currFrame.z (sim).

### Camera (same file)
- Ease BOTH position and a look-target vector (critically-damped), fed the
  interpolated duck pos — kills the snap-on-lookAt amplification.

### Acceptance
- Hold nothing → smooth glide+sink. Spam flap → smooth bob arcs, no stutter,
  frame-rate independent (test at 30/60/144Hz).

---

## #2 — Integrate vertical velocity (Person C — physics/, COORDINATE)
Owner: Person C (changes the locked energy model). This removes the sawtooth at
the source: velocity gains inertia instead of teleporting.

### Current (the bug)
`verticalVel = _flap*climbGain − gravity*(1−_flap)` — recomputed from scratch each
tick, so it snaps between sink and climb the instant flap changes.

### New model (integrated + drag)
Reinterpret constants as ACCELERATIONS (m/s²), integrate velocity, add vertical drag:
```
const climbAccel = _flap * climbThrust        // upward accel from flap
verticalVel += (climbAccel - gravity) * dt    // continuous tug-of-war
if (flapImpulse) verticalVel += flapKick      // one-shot impulse (now smoothed by integration)
verticalVel -= vertDrag * verticalVel * dt    // air resistance -> terminal sink/climb
y += verticalVel * dt
// floor/ceiling clamp: zero verticalVel on contact (unchanged)
```

### Config / types (physics/config.ts, types.ts)
- ADD `vertDrag` (per-second). 
- Re-scale (now accelerations, not velocities):
  - `gravity` ~ 18 (m/s²-ish, tuned not real)
  - `climbThrust` ~ 45 (rename/replace `climbGain`)
  - `flapKick` ~ 3 (impulse to velocity)
  - `vertDrag` ~ 1.5  → terminal sink ≈ gravity/vertDrag when flap=0
- Bump leva slider max ranges for these (gravity 0–40, climbThrust 0–100).
- Keep `_flap` easing — still absorbs MediaPipe jitter; integration adds the inertia.

### Why it works long-term
- Smooth arcs from impulses; `flapImpulse` no longer bypasses smoothing.
- Still pure + fixed-dt → deterministic → identical on every client (shared `step`).
- Maps cleanly to networked `PlayerState.vel.y = verticalVel`.

### Acceptance
- Single flap → smooth rise-then-settle, no instant velocity jump.
- Sustained spam → steady gentle climb; stop → smooth decay to terminal sink.

### Build order
1. #1 first (sandbox-only, no coordination) — verify how much bob remains.
2. Propose #2 to Person C; retune the 4 constants live via leva.
3. (Later #4) move flap-decay/dive-ramp INTO the fixed step for deterministic input.

---

## Pre-start review findings (current code)
Blockers / must-handle during impl:
- **Flap is double-driven.** A Space tap bumps BOTH `kb.flap` (→ continuous climb)
  AND sets `impulseRef` (→ raw `flapKick`). Compounds the spike. In #2 pick ONE for
  the spam model — recommend impulse-only (`verticalVel += flapKick`); keep `flap`
  level for animation/feel, not a second lift source.
- **`step.ts` dive-sink line lacks `dt`:** `verticalVel -= _dive * cfg.diveSink;`
  (line 49). Works today only because `verticalVel` is recomputed each tick. Once #2
  makes `verticalVel` integrated STATE, this MUST become `* dt` (accel) or it explodes.
  Same for the climb term: `gravity`/`climbThrust` become per-second accelerations.
- **Constant semantics flip (velocity → accel).** Retune `DEFAULT_CONFIG` AND bump the
  leva slider ranges in PhysicsSandbox (gravity, climbThrust) AND add a `vertDrag`
  slider — all in the same change, or the feel breaks on first run.
- **Camera near-plane precision.** `<Canvas camera={{ ... far: 5000 }}>` uses the
  default near = 0.1 → near:far ratio 1:50000 → poor depth precision, a likely source
  of residual distant z-fighting. Raise near to ~1 (or `logarithmicDepthBuffer`) while
  doing #1 — cheap, independent win.
- **Two rAF loops** (ActionPanel writes actionsRef; DuckRig reads it) sample out of
  phase. Fold input integration into the fixed step (#4) during #1 for determinism.

Known/acceptable for now (not blockers):
- Ring-pass tests end-of-frame x,y against the whole-frame z span (minor at 60fps).
- Lateral wall = position clamp, ignores duckRadius, no velocity reflect (placeholder).
- No finish handling past z=2000 (duck flies into void) — cosmetic.

## Architecture check vs docs/ARCHITECTURE.md
Mostly matches (Y-up, meters, client-authoritative sim, seed→world). DIVERGENCES:

- **§4 / §6 `ringLayout: RingDef[]`** — we dropped it. Decision (hackathon): server
  sends ONLY `mapSeed`; `buildMap(seed)` is the single source of truth that C/D
  import for ring positions. Docs still say rings are sent alongside the seed.
  → Update docs OR keep `ringLayout` as a thin cache. RECOMMEND: update docs to
  "seed-only; ring positions derived by shared buildMap()".
- **`PlayerState.lap`** — unused; map is a single-pass straightaway (no laps).
  Docs/diagrams imply laps. → Note "lap reserved for future / infinite mode".
- **§2 "~60Hz" render loop** — #1 makes render explicitly fixed-sim + interpolated;
  consistent with docs intent, just more precise. No conflict.
- Coordinates/units (meters, +Z forward, ceiling 200) — consistent with physics &
  this doc. No conflict.
