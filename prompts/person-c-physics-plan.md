# Person C — Physics Core + Test UI (whiteboard)

## Inputs: DuckActions (locked — matches docs/ARCHITECTURE.md §4)
- `flap`: 0–1, how hard you're flapping → climb rate
- `flapImpulse`: boolean, true on the frame a new flap begins (optional: small climb burst)
- `lean`: −1..+1. **−1 = full LEFT, 0 = straight, +1 = full RIGHT**
- `dive`: 0–1, how much you're diving → trade altitude for forward speed
- `quack`: boolean (no physics effect)
- `egg67`: boolean (no physics effect)
- `confidence`: 0–1 tracking confidence (optional: fade/hold inputs when low)

> ⚠️ Changed from earlier brainstorm: flap is 0–1 (not flaps/sec), dive is 0–1 (not 0–100),
> and lean SIGN FLIPPED — positive lean is now RIGHT, not left.

## Goal (now)
1. Pure physics core: `step(state, actions, dt) -> state`. No rendering deps.
2. Tiny test UI: sliders for the 3 actions, watch the duck react.

## Open decisions
- [x] Test viz: 3D R3F + drei, placeholder duck, basic env (ground grid/markers streaming past for forward-motion feel)
## Energy model (locked)
- forward speed = momentum + drag (always decaying toward 0/glide floor)
- flap (0–1) → CLIMB RATE only (gain altitude). higher = faster up. flap=0 → gravity sink. does NOT add forward speed.
- dive (0–1) → nose-down, converts altitude → forward speed. ONLY way to accelerate.
- => fly the track by trading height for speed; flap to bank height back up.

## Turning (locked)
- angleWingspan → yaw turn-RATE ∝ lean (more lean = tighter turn), capped at ±π/2
- visual roll on duck matches lean (banked-turn look)
- small speed bleed ∝ |turn sharpness| (gentle; natural energy scrub)

## Smoothness (locked, key requirement)
- treat every action as a TARGET; ease state toward it (critically-damped lerp / slew limit)
- never snap — absorbs MediaPipe jitter, gives continuous natural control
- fixed-timestep integrator (e.g. 60Hz) so feel is frame-rate independent

## Env
- long track, ground plane + meter markers streaming past for speed readout

---

# IMPLEMENTATION PLAN

## Deps to add (frontend/)
- `three @react-three/fiber @react-three/drei`
- `zustand` (shared game state, matches arch)
- `leva` (instant tweakable sliders/HUD for the test UI — zero custom UI work)

## File layout (frontend/src/)
```
physics/
  types.ts        # DuckActions, DuckState, PhysicsConfig
  config.ts       # DEFAULT_CONFIG (all tunable constants)
  step.ts         # pure step(state, actions, cfg, dt) -> state  (NO three/react imports)
  index.ts
test/
  PhysicsSandbox.tsx   # R3F canvas + leva controls, mounted from App.tsx
  DuckMesh.tsx         # placeholder duck (cone/cube) reads DuckState
  Track.tsx            # ground plane + meter markers
  useSandboxLoop.ts    # fixed-timestep loop driving step()
```
Keep `physics/` pure & framework-free so B/D can import it and run identical sim.

## Types (physics/types.ts)
```ts
export interface DuckActions {
  flap: number;         // 0..1  -> climb rate
  flapImpulse: boolean; // new-flap edge (optional climb burst)
  lean: number;         // -1..+1 (-1 left, +1 right)
  dive: number;         // 0..1  nose-down -> forward speed
  quack: boolean;       // no physics
  egg67: boolean;       // no physics
  confidence: number;   // 0..1  (optional input gating)
}

export interface DuckState {
  position: [number, number, number]; // world pos (x, y=alt, z)
  yaw: number;         // heading, radians (see conventions below)
  speed: number;       // forward scalar (m/s) along yaw
  pitch: number;       // visual nose angle (rad), eased from dive
  roll: number;        // visual bank angle (rad), eased from lean
  verticalVel: number; // m/s (climb + / sink -)
  // smoothed/eased action targets (all normalized):
  _flap: number; _lean: number; _dive: number;
}
```
> Maps to networked PlayerState later: pos=position, vel=speed*forwardDir + verticalVel,
> quat from (yaw,pitch,roll). That conversion lives at the C→D seam, not in step().

## Coordinate / direction conventions (Y-up, right-handed)
- **+Y** = up (altitude). ground plane at `groundY`.
- **yaw = 0** → duck faces **+Z**; this is "down the track" / forward at start.
- **yaw increases = turn LEFT.** forward dir = `(sin(yaw), 0, cos(yaw))`:
  - yaw 0 → +Z, yaw +π/2 → +X (left), yaw −π/2 → −X (right).
- **+X = left, −X = right** (when looking down the track from behind the duck).
- `lean < 0` = left → yaw increases → turn left; `lean > 0` = right → turn right.
  (so `turnRate = -lean * maxTurnRate`).
- `pitch > 0` = nose down (diving). `roll` banks toward lean (right lean = roll right).

## Energy model -> math (step.ts, all * dt, fixed dt)
Order per tick (all actions already normalized 0–1 / −1..1):
1. Ease actions: `_flap,_lean,_dive` ← lerp toward raw actions (smoothingTau). Optionally scale by `confidence`.
2. Climb: `verticalVel = _flap * climbGain - gravity*(1 - _flap)` (flap lifts, low flap sinks). Clamp. (optional: `flapImpulse` adds one-shot `flapKick`.)
3. Dive→speed: `speed += _dive * diveAccel * dt` (trade altitude); also force extra sink `verticalVel -= _dive*diveSink`.
4. Drag: `speed -= drag * speed * dt` (momentum decay; only way to gain back = dive).
5. Turn: `turnRate = -_lean * maxTurnRate; yaw += turnRate*dt;`
   speed bleed: `speed -= |turnRate| * turnDragK * speed * dt` (gentle).
6. Integrate pos: `x += sin(yaw)*speed*dt; z += cos(yaw)*speed*dt; y += verticalVel*dt;` clamp y>=ground.
7. Visual angles: `pitch` eased toward `_dive*maxPitch`; `roll` eased toward `_lean*maxRoll`.

## Config (config.ts) — all surfaced as leva sliders
gravity, climbGain, flapKick, diveAccel, diveSink, drag, maxTurnRate, turnDragK,
maxPitch, maxRoll, smoothingTau, groundY, fixedDt(1/60), minSpeed(glide floor).

## Test UI (test/PhysicsSandbox.tsx)
- `<Canvas>`: Track + DuckMesh + drei `<Sky/>`, follow-ish camera (or fixed chase).
- `leva` panel A: live DuckActions — flap (0–1), lean (−1..1), dive (0–1), + confidence (0–1) + quack/egg67 toggles + a "flapImpulse" button — what A will eventually feed.
- `leva` panel B: PhysicsConfig constants (tune feel live).
- HUD readout: speed, altitude, yaw, distance traveled.
- useSandboxLoop: accumulator fixed-timestep -> step() -> setState; render reads state.
- Reset button.

## App wiring
Replace template `App.tsx` body with `<PhysicsSandbox/>` (gate behind a flag/route so it's easy to remove later).

## Integration contract (for B/D later)
- export `step`, `DEFAULT_CONFIG`, `DuckActions`, `DuckState`. DuckActions matches docs/ARCHITECTURE.md §4 exactly (A produces it). B renders DuckState; same `step` runs on every client. C→D adapter converts DuckState → PlayerState (pos/vel/quat).

## Build order
1. add deps  2. physics/ pure module + unit-feel via leva  3. Track+DuckMesh  4. loop+HUD  5. tune constants  6. expose exports.
