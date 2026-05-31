# Collisions + Ring Placement Plan (post-refactor)

Whiteboard. Status: brainstorming. Supersedes the Wave-2 (Agent C/D) sections of
`game-improvements-plan.md` now that the game moved `debug/` → `game/`.

## What changed since the original plan
- Canonical game is now `frontend/src/game/` (not `debug/PersonAPlayground.tsx`).
- The sim loop (old `PlaygroundRig`) is now **shared** in `game/FlightRig.tsx`,
  driven by BOTH `SinglePlayerGame` and `MultiplayerGame`. Anything we add to the
  loop runs in both modes automatically.
- Wave-1 is DONE:
  - Agent A: boost + ring-pass detection + recolor/pulse live in `FlightRig`
    (`boostRef`, `ringCrossing`, `passedRingsRef`, `ringPulseAtRef`).
  - Agent B: `map/collide.ts` exports `treeHit`, `ringRimHit`, `treeTrunk`,
    `RING_TUBE`, `ringCrossing`. Pure + tested.
- Still missing (this doc): C (collision→respawn+feedback), D (ring placement vs
  trees), and MP collisions (rings/trees/other birds + backend).

## Coordinate reminder (frontend canonical)
- Straight corridor: fly +Z, x∈[−halfWidth,+halfWidth], y=altitude, ground y=0.
- `buildMap(seed)` is the single source of truth for rings/trees/checkpoints.

## STATUS
- Part 2 (Agent D) — DONE. `buildMap` now generates trees first, places rings
  clear of them (push UP off any trunk; ceiling-capped; x-nudge fallback), and
  carves a downstream boost lane (drops trees in a `boostLaneLength`×`boostLaneHalfWidth`
  box ahead of each ring). Ring band widened to y 30–170 (`ringMaxY`). New config:
  `ringTreeClearance`, `boostLaneLength`, `boostLaneHalfWidth`. Invariants covered
  by `map/buildMap.test.ts`. All deterministic (pure geometry, salted RNG streams).
- Part 1 (Agent C) — DONE. Client-local tree/ring-rim collision in `FlightRig`,
  flash+snap respawn to last checkpoint, 1.2s invuln, `onCrash` → `CrashFlash` in
  both SP + MP. New: `game/respawn.ts` (`lastCheckpointZ`), `game/CrashFlash.tsx`.
- Spawn altitude raised to **80** in `createFlightState()` (was 40) so the start
  AND every checkpoint respawn land ABOVE the 72m tree canopy → never spawn inside
  a tree (would otherwise crash-loop, since initial spawn has no invuln window).
  → Part 2 (Agent D) can therefore ignore clearing trees from checkpoint planes;
    spawn safety is handled by altitude. D still must keep RINGS clear of trees.

---

## DECIDED: collision authority split
- **tree trunk + ring rim → client-local.** Fully deterministic from the seed
  (same `buildMap` on every client), so local detection + local respawn is
  consistent for everyone with zero server involvement. Reuses Part 1 in both modes.
- **bird ↔ bird → server-authoritative.** Each client only simulates its OWN duck
  live; other ducks are interpolated ~100ms behind, so client-side `distance(me,you)`
  disagrees between the two players. The only way to make both agree client-side is
  to run detection against the shared (delayed) server snapshot for BOTH ducks —
  i.e. collide against a stale copy of yourself, which feels laggy. Not worth it: the
  server already owns everyone's live positions and the check already exists.

## Backend reality check (it's half-built, not empty)
`RaceRoom.runCollisions()` ALREADY does bird-vs-bird: `detectCollisions(bodies,
COLLISION_RADIUS)` → `spinOut` broadcast. What's missing:
- `spunOut` is set `true` and **never cleared** → permanent spin-out, no recovery.
- No respawn after a bird collision.
So bird-vs-bird needs *finishing*, not building from scratch.

## Ring layout: NO server change needed (rings are correct on frontend)
Earlier worry about `generateRingLayout` (circular track) is moot for collisions —
rings/trees are client-local now. The server's `ringLayout` is only used for the
`ringPassed` scoreboard count. Leave the existing flow as-is unless MP ring SCORING
is visibly wrong; if so, that's a separate scoreboard fix, not part of collisions.
(Flagged here only so we don't reintroduce a server-map dependency.)

---

## Part 1 — Agent C: collision → respawn + bounce (SHARED in FlightRig)

Goal: clipping a tree trunk or a ring rim sends you back to the last checkpoint
with a quick bounce/feedback beat. Lands in the shared loop so SP + MP both get it.

### Files
- `frontend/src/game/FlightRig.tsx` (sim loop: detect + apply respawn/feedback)
- `frontend/src/game/respawn.ts` (NEW, pure: last-checkpoint lookup + reset state)
- `frontend/src/map/collide.ts` (already has `treeHit`/`ringRimHit` — reuse)

### Mechanics
- Add to `FlightRigProps`: a `respawnAtRef`/`invulnUntilRef` (or just internal refs)
  + an optional `onCrash?(kind: 'tree'|'ring')` callback (MP uses it to report;
    SP ignores).
- In the fixed-step loop, AFTER integrating + boost, on authoritative `s2`:
  - `ringRimHit(prevZ, s2.z, x, y, ring, duckRadius)` over NOT-passed rings.
  - `treeHit(x, y, z, tree, duckRadius)` over nearby trees (pre-filter by |z−treeZ|
    < gap and |x−treeX| < some cull, to stay O(local) not O(all scenery)).
  - Skip while within an invulnerability window (`now < invulnUntil`).
- On hit:
  - find last checkpoint with `z <= currentZ` (pure helper; finish handled by
    existing `enableFinish`).
  - reset to `[0, startY, checkpointZ]` via `createFlightState()` then set z; this
    zeroes `_lean`/`_flap`/`_dive`/velocities (matches plan's respawn note).
  - `boostRef.current = 0` (consume boost).
  - set `invulnUntil = now + ~1s`.
- Feedback = **flash + snap** (DECIDED): red DOM flash overlay (~0.3s) + immediate
  snap to the last checkpoint. No knockback in the sim. `invulnUntil = now + 1.2s`.

### Respawn helper (pure)
```
lastCheckpointZ(z, checkpoints): number   // max cp.z <= z, else 0
```

### Mode notes
- SP: crash → local respawn, no network. Clean.
- MP: see Part 3 (who's authoritative). Most likely client-local environment
  respawn + report to server for scoreboard; bird-vs-bird stays server-ruled.

---

## Part 2 — Agent D: ring placement clear of trees

Goal: rings spread across the full height band, never directly in front of a tree,
with a clear boost lane downstream.

### Files
- `frontend/src/map/buildMap.ts`
- `frontend/src/map/config.ts` (new knobs)
- `frontend/src/map/types.ts` (new MapConfig fields)

### Ordering problem (NEW vs original plan)
Original plan assumed rings built BEFORE trees. In current `buildMap`, rings build
first (good) but **trees are biased to the centerline and span the full corridor**
(`centeredX`, height 12–72) — so trees and rings genuinely overlap now. Two-way fix:
1. After placing a ring, if its (x,y) overlaps any tree volume (`treeHit`-style 2D
   test against `treeTrunk(tree)`), push the ring UP until clear (cap at `ceiling`;
   nudge x, then skip as last resort).
2. After ALL rings placed, when scattering trees, REJECT/relocate any tree whose
   (x,z) falls in a ring's downstream safety box: ring-width wide, ~boostDistance
   long in +Z, from the ring plane forward — so the boost can't fling you into a tree.

### Config knobs
- `ringYBand` (reuse `ringMinY/Max`, widen to full height), `ringMaxUpPush`,
  `laneLength` (≈ boost travel), `laneHalfWidth` (≈ ringRadius+margin),
  `ringTreeClearance`.

### Determinism
Keep the per-stream RNG salts (rings 0x1, trees 0x2). The ring↔tree filtering must
be deterministic from seed (no extra entropy) so server + clients agree.

---

## Part 3 — Multiplayer collisions (rings, trees, other birds)

Three collision classes, authority DECIDED (see above):

| collision | deterministic from map? | authority |
|---|---|---|
| ring rim | yes (shared `buildMap`) | client-local detect + respawn (Part 1) |
| tree trunk | yes (shared `buildMap`) | client-local detect + respawn (Part 1) |
| bird ↔ bird | NO (needs all live positions) | server (`detectCollisions` + `spinOut`) |

### Backend work (finish bird-vs-bird only)
- `runCollisions()` already flags collisions + broadcasts `spinOut`. Add recovery:
  - clear `spunOut` after a spin window so the player can keep flying.
  - Two ways to respawn:
    - **client-driven (leaning):** on `spinOut` the client runs the SAME Part-1
      bounce+respawn locally, then its next `updateState` pose IS the respawned
      position; server just clears `spunOut` after the window (no server map needed).
    - server-driven: server resets pos to last checkpoint — but that needs the
      server to know checkpoints (reintroduces a server-map dep). Avoid.
- No ring/tree logic on the server. No `generateRingLayout` change for collisions.

### Frontend MP work
- `MultiplayerGame` already has `onSpinOut` → `spinning` flag (1.2s label). Wire it
  to the SAME bounce/respawn path as Part 1 so a bird-collision also snaps you back.
- Environment crash in `FlightRig` (Part 1) just works for MP too; add `onCrash`
  to optionally inform the server (scoreboard/penalty) — TBD if we even penalize.

### Remote ducks
- No change needed for collision: remotes are interpolated from server pose. When
  the server respawns/clears a remote, its pose snaps via the normal sync.

---

## Decisions
- DECIDED: env (tree/ring) = client-local; bird-vs-bird = server.
- DECIDED: bird-collision recovery = client-driven respawn + server clears `spunOut`
  after a window (no server map dependency).
- DECIDED: no server map/collision changes; rings correct on frontend.

## Decided (cont.)
- DECIDED: **flash + snap** (no knockback). On crash: red screen flash overlay
  (~0.3s) + immediate snap to last checkpoint + ~1s invulnerability. Deterministic,
  doesn't fight the eased speed model. Knockback can come later if it feels flat.
- DECIDED: spin/invuln window = **1.2s** (matches the existing client spin label).
- OPEN (defer): MP env-crash penalty (lost rings / time) — start with just the
  respawn setback, revisit after playtest.

## Suggested sequencing
1. Part 2 (Agent D) — pure map change, no deps, unblocks clean placement.
2. Part 1 (Agent C) — shared FlightRig respawn+feedback (SP testable immediately;
   MP env collisions come along for free).
3. Part 3 — finish bird-vs-bird: client wires `onSpinOut` to the Part-1 bounce path,
   server clears `spunOut` after the spin window.
```
