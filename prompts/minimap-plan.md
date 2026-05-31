# Minimap Plan

## Goal
In-game minimap so you can see your position vs other ducks (sometimes you can't see where they are). MP-only (SP has no other ducks). Simple, always-readable while flying.

## Decision: full course strip
Show every duck's progress along the whole track, not a local radar.

## Data (already available, no backend changes)
- `race.players[]`: `{ id, name, pos:{x,y,z}, finished }` — synced ~20Hz
- self position: `stateRef.current.position` (more current than the streamed self entry)
- Course bounds from `DEFAULT_MAP_CONFIG`: length `2000` (Z, forward), `halfWidth 150` (X, lateral)

## Layout (LOCKED)
- Vertical strip pinned to right edge of screen.
- Y axis = progress: bottom = start (Z=0), top = finish (Z=2000).
- X within strip = lateral position (X, ±halfWidth), clamped.
- Dots: you = brighter + bigger; others = colored dots WITH short name labels (left of dot).
- Finished ducks: dimmed.

## Rendering (LOCKED)
- Plain React/DOM overlay (HTML/CSS), NOT in the three.js scene — cheap, crisp, no perf cost.
- New component `Minimap.tsx` in `frontend/src/game/`.
- Mounted in `MultiplayerGame.tsx` (MP-only), as a sibling overlay next to `<RaceScreens>`.

## Implementation outline
1. `Minimap.tsx`
   - Props: `stateRef` (self, for live pos), `players: PlayerView[]`, `sessionId`, course `length` + `halfWidth` (from `DEFAULT_MAP_CONFIG` / map).
   - Internal `useState` snapshot refreshed on a ~100ms `setInterval` (mirror `Hud` pattern) — avoids re-rendering on every 20Hz net patch.
   - Build a list of markers: for self use `stateRef.current.position`; for others use `player.pos`. Skip self's entry in `players` (dedupe by id).
   - Map to %:
     - `topPct = 100 * (1 - clamp(z / length, 0, 1))`  (finish on top)
     - `leftPct = 100 * clamp((x + halfWidth) / (2*halfWidth), 0, 1)`
   - Render absolutely-positioned dots inside a bordered strip; name `<span>` for non-self.
2. Wire into `MultiplayerGame.tsx`: pass `stateRef`, `race.players`, `race.sessionId`, and map dims. Show only while `racing` (and maybe countdown).

## Styling notes
- Strip ~ 70px wide x ~55vh tall, top-right, translucent dark bg, rounded, blur — matches existing HUD/overlay style (`rgba(20,30,40,0.78)`, `backdropFilter: blur`).
- Small finish/start tick labels at top/bottom.
- `pointerEvents: 'none'`.
