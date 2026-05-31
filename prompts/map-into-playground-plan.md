# Map/terrain gen → PersonAPlayground (keep its physics)

## Goal
Pull seed-driven map + terrain (rings, scenery, ground, walls) from `PhysicsSandbox`
into `PersonAPlayground`. KEEP PersonAPlayground's `flightModel` physics/movement.
Only borrow visuals/generation from `map/` + `MapView` + `Scenery`.

## What's reusable (no movement attached)
- `map/buildMap.ts` — pure `buildMap(seed)` → `MapDef` (rings, checkpoints, scenery)
- `test/MapView.tsx` — renders ground, walls, checkpoints, rings, `<Scenery>`
- `world/Scenery.tsx` — instanced nature props

## Decisions (locked)
1. **FINITE track.** Duck flies the 2000m map; run ends at finish (z=length).
2. **Replace DebugArena with MapView** entirely (ground/walls/checkpoints/rings/scenery).
   Drop DebugArena recycling number marks.
3. **Width:** flight `lateralRange = map.halfWidth` (150). Duck uses full corridor.
4. **Rings: cosmetic only.** Render rings; no fly-through detection, no boost. Pass an
   empty `passedRingIds` set to MapView (all render in the not-passed color).
5. **Finish:** when `position.z >= map.length`, FREEZE the duck (stop stepping) and show
   a results/finish overlay.

## Implementation outline (PersonAPlayground.tsx)
- **Seed + world:** add `useControls('World', { seed })`; `map = useMemo(buildMap(seed))`,
  store in `mapRef`. Rebuild + `reset` run when seed changes.
- **Lighting/bg:** swap flat BG for `<Sky>` (+ keep ambient/hemi/dir) so green ground +
  trees read correctly; enable Canvas `shadows` to match the map look.
- **Render world:** replace `<DebugArena .../>` with
  `<MapView map={map} passedRingIds={EMPTY_SET} />`.
- **Width wiring:** after merging leva → `cfgRef`, force `cfgRef.current.lateralRange =
  map.halfWidth`. Bump/retune the `lateralRange` Flight slider (max≥200, default=halfWidth)
  or drop it and derive from the map.
- **Finish freeze:** in `PlaygroundRig.useFrame`, if `stateRef.position[2] >= mapRef.length`
  and not finished → set a `finishedRef`/React state (skip further `flightStep`s) and clamp
  z to length. Surface finish state to a new `<FinishOverlay distance time>` (results card).
- **Keep untouched:** `flightModel` step, keyboard, `FollowCamera`, `Duck`, HUD, debug toggle.

## Open / minor (decide while building)
- Start altitude y=40 (rings y 30..120) is fine; START checkpoint at z=0 aligns.
- Camera `far=8000` already covers the 2000m track.
- Whether to also color rings green when passed (no boost) — left out for now (cosmetic).
