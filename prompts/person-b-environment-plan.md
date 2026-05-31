# Person B — Environment, Map & Boundaries (whiteboard)

## IMPLEMENTED (frontend/src/map/ + test/MapView.tsx)
- `map/` pure engine: `buildMap(seed)` → MapDef (rings, checkpoints, trees) + seeded RNG + `ringCrossing()`.
- Rings: vertical gates (thick crashable tube), seed-placed, ring-pass → speed boost.
- Trees: seed-derived conifers flanking the corridor (outside walls, never block flight), instanced.
- Wired into PhysicsSandbox: World folder (seed, ringBoost), lateral bounce clamp, HUD rings/progress.
- TODO next: rim-crash penalty, in-corridor obstacles, real assets (Person B), velocity-reflect walls (Person C).

---


## Locked-in from physics/ (Person C) — units are effectively METERS
- Coords: Y-up, right-handed. **yaw=0 → +Z = forward / "down the track".**
- **+X = left, −X = right** (looking down-track from behind duck).
- `groundY = 0`, `ceilingY = 200` → altitude band is **0–200 m**.
- Start: `position [0, 20, 0]`, `speed 12` m/s, gravity ~9.
- Map distributed as: server SEED + explicit `ringLayout: RingDef[]` (clients build identical world).

## Topology (LOCKED)
- Straightaway down +Z: **start line at z=0, finish line at z=L**. Single pass, no laps.
- `lap` field unused for now (ignore).
- Stretch: "infinite mode" → procedurally extend +Z forever (design seed-gen so it can stream chunks later).

## Coordinate / boundary rules
- **Length (Z): L = 2000 m** (start z=0 → finish z=2000).
- **Floor: hard at y=0** (clamp, physics already does this).
- **Ceiling: y=200 m**, enforced *softly* via environment (clouds/haze/space fade) — not a brick wall, just "too high to be useful."
- **Lateral (X): wide, soft bounce walls.** Draft half-width **W = ±150 m** (300 m wide). Hitting wall = velocity reflect/damp, no crash.
- Rule of thumb: corridor much wider than tall → ducks weave L/R for rings, height is the scarcer resource (must dive to go fast, flap to climb back).

## Rings (optional boost gates)
- Fly **through** the hole → speed boost (Person C applies). Optional, not required to finish.
- **Crash** into the ring rim/edge → slowdown (or spin-out). So rings are risk/reward.
- Ring collision = **client-local** (per ARCHITECTURE §3). Each client decides pass vs hit.
- Geometry per ring (`RingDef`): pos [x,y,z], orientation (facing −Z so you fly through), inner radius, rim thickness.

### Sizing rationale (tie to speed — all tunable via config, NOT hardcoded)
- Speeds: glide ~12 m/s, dive peak ~25–30 m/s. Turn rate ≤1.6 rad/s. So at top speed you cover ~0.5 m/frame — a ring must be hittable with limited reaction + lateral authority.
- **Pass test:** duck center within (`innerRadius − duckRadius`) of ring center, in the ring's plane. duckRadius draft = 1 m.
- Proposed `RING_RADIUS` tiers (start at Forgiving, tighten by playtest):
  - **Forgiving (default): 6 m** — ~12 m gate, basically "fly toward it." Good for first builds + jittery MediaPipe input.
  - **Standard: 4 m** — requires real aiming, still fair at dive speed.
  - **Tight: 2.5 m** — skill gate, expect frequent misses at high speed.
- **Spacing `RING_GAP` (along Z):** scale to speed so cadence feels steady.
  - At ~20 m/s, **100 m gap → ~5 s** between rings → ~20 rings over 2 km. Default.
  - Tighter combos: 60 m (~3 s). Sparse/relaxed: 150 m.
- **Lateral/vertical offset per ring:** jitter ring center within corridor (e.g. X within ±60 m, Y within 30–120 m) so the line isn't straight — that's what makes weaving matter. Offset magnitude is a difficulty knob.
- Rim thickness ~0.5 m; rim crash slab = thin torus shell just outside innerRadius.

## Checkpoints (respawn points)
- Placed along Z (e.g. every ~400–500 m → ~4–5 checkpoints over 2 km).
- Crash (player-vs-player spinOut, or ring rim?) → respawn at last passed checkpoint after **1–2 s delay**.
- Person C owns respawn logic; B owns placement + visuals (a gate/banner across the corridor).
- Open: is the start line checkpoint 0? does finish auto-count last checkpoint?

## Obstacles
- Static hazards in the corridor (crash → slowdown / spin-out → checkpoint respawn).
- Placement spacing rules: TBD.

## Duck hitbox
- Need a canonical duck collision size (sphere/capsule radius) shared by ring-pass test + obstacle hit.
- Draft: duck ≈ 1 m radius sphere. TBD.

---

# GENERATION SYSTEM (seed → identical world)

## Principle (LOCKED — hackathon: simplest path)
Server sends ONE `mapSeed: number`. **Everything** — rings, checkpoints, obstacles, AND scenery — is derived deterministically from that seed on every client. Determinism guarantees all clients agree; not worried about cheating.
- `ringLayout` in the §4 contract becomes redundant → either drop it, or B exports `buildMap(seed)` and D/scoring imports the SAME fn to know ring positions (shared pure fn = single source of truth, zero sync work).
- Net effect: D's job shrinks to broadcasting `mapSeed`; B owns the whole world recipe.

## Deterministic RNG
- Seeded PRNG (e.g. mulberry32 / splitmix32) — pure JS, framework-free, lives next to `physics/` so server can run the same code.
- Derive independent streams per concern so adding one feature doesn't shift another:
  `rngTerrain = makeRng(seed ^ 0x1)`, `rngClouds = seed^0x2`, `rngObstacles = seed^0x3`, etc.

## Map descriptor (the contract this produces)
```ts
interface MapDef {
  seed: number;
  length: number;        // 2000
  halfWidth: number;     // 150
  ceiling: number;       // 200
  floorY: number;        // 0
  rings: RingDef[];      // from server
  checkpoints: Checkpoint[];
  obstacles: ObstacleDef[]; // seed-derived
}
interface RingDef { id:number; pos:[number,number,number]; radius:number; }
interface Checkpoint { id:number; z:number; }     // full-corridor plane at this z
interface ObstacleDef { id:number; kind:string; pos:[number,number,number]; size:[number,number,number]; }
```

## Generation pipeline (pure fn: `buildMap(seed) -> MapDef`)
1. Lay corridor bounds (constants above).
2. Place checkpoints: start z=0 (cp0), then every `CP_GAP` (~450 m) → finish.
3. Rings: walk Z by `RING_GAP`, roll `rngRings` for X/Y offset within corridor (sizing rules above).
4. Obstacles: walk Z in steps, roll `rngObstacles` for kind + lateral/vertical pos, **with a clearance rule** (see below).
5. Scenery (terrain heightfield, clouds, trees, water): sample seeded noise — purely visual, never blocks the duck.

## Placement / fairness rules
- **No-overlap clearance:** every obstacle must leave a flyable gap ≥ `duckRadius + margin` (e.g. 4 m) from corridor walls AND not sit within ring approach cones (don't block a gate's entry). Reject-and-reroll on violation.
- **Solvability:** there must always exist a floor-to-ceiling clear lane through any Z-slice (never fully wall off the corridor). Validate per slice.
- **Start safety:** first ~100 m obstacle-free so players settle after countdown.
- Determinism: identical `(seed, ringLayout)` → identical `MapDef` on every client + server.

## Stretch: infinite mode hook
- Generation is chunked by Z-range: `buildChunk(seed, zStart, zEnd)`. Finite race = one chunk [0,2000]. Infinite = stream chunks as duck advances. Design `buildMap` around `buildChunk` now so infinite is additive later.

## Person B build order
1. seeded RNG util + `buildMap(seed)` pure fn (+ MapDef/RingDef types in shared `types/`). Export it so C/D import the same recipe.
2. Render corridor bounds (floor plane, soft ceiling fade, bounce-wall visuals).
3. Render rings from MapDef (placeholder torus first).
4. Render checkpoints (banner/gate).
5. Seed-derived scenery (sky/clouds/terrain/trees) + obstacles.
6. Wire to server `mapSeed`/`ringLayout` once D's contract is live (mock locally until then).
