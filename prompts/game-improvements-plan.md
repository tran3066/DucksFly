# Game Improvements Plan (Person A Playground = source of truth)

Working design doc. Status: ready to implement.

## Source of truth (IMPORTANT)
- The REAL game is `frontend/src/debug/PersonAPlayground.tsx` (route `?mode=a`).
- Its physics is `frontend/src/debug/flightModel.ts` (`flightStep` / `DEFAULT_FLIGHT` / `FlightConfig`) — a Unity-port, NOT `src/physics/step.ts`.
- Flight model facts that shape this work:
  - Heading is LOCKED to +Z forever (`yaw=0`). Lean does NOT turn — it STRAFES laterally (`vLateral = -lateralSpeedAtMaxBank * sin(roll)`).
  - Climb = `liftMultiplier`(34) * flap vs `gravity`(14), plus one-shot `impulseGain`(4) per Space tap; held flap strength = `HOLD_FLAP_STRENGTH`(0.9) in `input/keyboard.ts`.
  - Forward speed eases toward `baseForwardSpeed + flap*flapForwardGain + dive*diveAccel` at rate `forwardResponse`(2). NOTE: speed is a smoothed target, so a one-shot "+N to speed" boost gets pulled back toward the target quickly — a boost must change the target or add a decaying overspeed term.
  - `_lean` state slot is REUSED to carry lateral velocity between steps; `_flap`/`_dive` carry eased inputs. Any respawn must reset these too (use `createFlightState()`).
  - Existing run lifecycle to reuse: `finishedRef`, `resetState()`, `FinishOverlay`, finish-at-`map.length`. Respawn can mirror this exactly.
- `src/test/PhysicsSandbox.tsx` + `src/physics/*` are now LEGACY/secondary. Do NOT base work on them. (Optional later: backport, out of scope here.)
- `MapView` (`src/test/MapView.tsx`) is shared and renders rings/trees/checkpoints. Map gen (`src/map/*`) is framework-free and unchanged in spirit.

## Requests
1. Rings spread across full height, never directly in front of a tree; push ring UP if it overlaps a tree.
2. Rings give a speed boost.
3. Climbing easier — slightly less flapping needed.
4. Ring changes color after you fly through it (+ a flash/pulse).
5. Collision (tree bodies + ring rims) → respawn at last checkpoint + bounce/feedback animation.

## Decisions
- Rings: only hitting the solid rim crashes you. Through the hole = boost. Sailing past outside the ring = no impact (no miss penalty).
- Trees ARE inside the corridor (real obstacles). Heights 12–72m, biased to centerline.
- Ring-vs-tree at gen time: push ring up until clear (cap at ceiling; nudge x / skip only as last resort).
- Carve a tree-free boost lane DOWNSTREAM (+Z) of each ring so the boost can't fling you into a tree.
- Boost must be implemented as a target change / decaying overspeed (not a raw one-shot add) because forward speed is an eased target.

## Current gaps vs requests (in the playground specifically)
- Rings are passed `EMPTY_RING_IDS` → never recolor; `ringCrossing` is never called → no boost, no pass tracking.
- No collision of any kind (trees or ring rims).
- Checkpoints exist in `buildMap` but are unused for respawn.

---

# Agent plan

Two waves. Agents within a wave touch disjoint files and run in parallel.
Wave 1: A + B. Wave 2 (after both merge): C + D.

## WAVE 1

### Agent A — Boost + climb + ring color/flash (playground wiring & tuning)
Goal: make rings actually boost + recolor, and make climbing easier. All in the playground + flight model + keyboard (NOT the legacy sandbox).
Files (owns):
- `frontend/src/debug/PersonAPlayground.tsx`
- `frontend/src/debug/flightModel.ts`
- `frontend/src/input/keyboard.ts`
- `frontend/src/test/MapView.tsx` (ring visual only — coordinate w/ note below)
Tasks:
- #2 Boost: wire ring pass detection in `PlaygroundRig`'s fixed-step loop using `ringCrossing(prevZ, currZ, x, y, ring, duckRadius)` against authoritative `stateRef`. Track passed ids in a ref + React state (so MapView recolors). On pass, apply a boost that survives the eased-speed model: e.g. add a temporary `boostUntil`/decaying overspeed added on top of `forwardTarget`, or bump a `boostSpeed` term that decays over ~1.5s. Expose magnitude/duration as leva sliders.
- #3 Easier climb: tune `flightModel.ts` so ascending needs less spam (raise `liftMultiplier` and/or `impulseGain`, or lower `gravity`; optionally raise `HOLD_FLAP_STRENGTH`). Keep it a config change; leave sliders working.
- #4 Ring color + flash: pass real passed-set to `MapView`; recolor green on pass (fix is trivial here since playground currently hardcodes `EMPTY_RING_IDS`). Add a short scale/emissive pulse on the frame a ring is passed.
Notes/handoff:
- MapView ring rendering may also be touched by Agent A only (B does not touch MapView). Keep the `Ring` component's "passed" prop contract stable.
- Do NOT add collision here — that's Agent C. Just boost + cosmetics + climb feel.

### Agent B — Collision primitives (pure, framework-free)
Goal: data + pure helpers for collisions. No React/three, no game wiring.
Files (owns):
- `frontend/src/map/types.ts`
- `frontend/src/map/buildMap.ts`
- `frontend/src/map/collide.ts` (new)
- `frontend/src/map/index.ts` (exports)
Tasks:
- Tree collision volume: define a trunk cylinder (radius + height) per tree. Either store a `collisionRadius`/`trunkRadius` on tree `SceneryItem`s or derive in a helper from `height`. Provide `treeHit(x, y, z, tree, duckRadius): boolean`.
- Ring-rim collision: `ringRimHit(prevZ, currZ, x, y, ring, duckRadius): boolean` — true when crossing the ring plane while radial distance ∈ [radius − duckRadius, radius + tube]. Reuse the crossing logic style from `ringCrossing`. Export `RING_TUBE` (currently hardcoded 1.5 in MapView) from a shared spot so render + collision agree.
- Keep everything pure + deterministic + unit-test friendly (mirror existing `ringCrossing` tests if present).
Handoff: C consumes `treeHit`/`ringRimHit`; D consumes the tree volume for placement.

## WAVE 2 (after A + B merge)

### Agent C — Collision → respawn + bounce feedback (depends on B; rebase on A)
Goal: crashing into a tree or ring rim sends you back to the last checkpoint with a bounce/feedback beat.
Files (owns):
- `frontend/src/debug/PersonAPlayground.tsx` (sim loop + overlay)
- maybe `frontend/src/debug/respawn.ts` (new helper) — last-checkpoint lookup is pure.
Tasks:
- Track last passed checkpoint from `stateRef.position[2]` vs `map.checkpoints` (z-sorted; finish handled separately).
- In the fixed-step loop, after integrating, run `treeHit` (against nearby trees) and `ringRimHit` (against not-passed rings) on authoritative state.
- On collision: respawn at last checkpoint plane — reset position to `[0, startY, checkpointZ]`, zero velocity & eased slots (reuse `createFlightState()` then set z), brief invulnerability window (ignore collisions ~1s), and consume any boost.
- Bounce animation: short knockback (small −Z + upward pop or a quick camera shake / red flash overlay) to telegraph the crash before the snap-back. Keep it readable but quick.
- Reuse the existing `finishedRef`/`resetState` plumbing patterns; don't fight the finish-line freeze.
Notes: Wave-1 Agent A also edits this file. C should rebase onto A's merged change and integrate with A's boost ref (consume boost on crash).

### Agent D — Ring placement vs trees (depends on B's tree volume)
Goal: rings spread across full height, never in front of a tree; boost lane stays clear.
Files (owns):
- `frontend/src/map/buildMap.ts`
- `frontend/src/map/config.ts`
Tasks:
- #1 Spread ring y across the full band; if a ring's (x,y) overlaps any tree volume (use B's helper), push the ring UP until clear (cap at `ceiling`; nudge x or skip as last resort).
- Boost lane: after rings are placed, reject/relocate any tree falling inside a ring's DOWNSTREAM safety box (ring-width wide, ~boost-distance long in +Z). `buildMap` already builds rings before scenery, so ordering is fine — just filter/move trees against the ring set.
- Add config knobs: lane length, lane width, ring y band, max upward push.
Notes: D and B both touch `buildMap.ts`; D MUST rebase on B. D and C are otherwise independent (different files) and can run in parallel.

## File-conflict summary
- A ↔ C: both edit `PersonAPlayground.tsx` → A first (Wave 1), C rebases (Wave 2).
- B ↔ D: both edit `buildMap.ts` → B first (Wave 1), D rebases (Wave 2).
- A ↔ B: disjoint → fully parallel.
- C ↔ D: disjoint → fully parallel.

## Suggested order
1. Wave 1: Agent A (playground boost/climb/color) ∥ Agent B (collision primitives).
2. Wave 2: Agent C (respawn/feedback) ∥ Agent D (ring placement) — both after A+B merge.
