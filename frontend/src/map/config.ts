import type { MapConfig } from './types';

// First-pass world dimensions, in meters, matching the physics units.
// See prompts/person-b-environment-plan.md for the rationale behind each value.
export const DEFAULT_MAP_CONFIG: MapConfig = {
  length: 2000,
  halfWidth: 150,
  ceiling: 200, // matches physics DEFAULT_CONFIG.ceilingY
  floorY: 0, //    matches physics DEFAULT_CONFIG.groundY
  startSafeZ: 100,
  ringGap: 100, // ~20 rings over the track; ~5 s apart at dive speed
  ringRadius: 6, // "forgiving" tier — tighten to 4 / 2.5 by playtest
  ringMaxOffsetX: 60,
  ringMinY: 30,
  ringMaxY: 170, // spread rings across (nearly) the full height band, not just the low third
  checkpointGap: 450, // ~4 checkpoints + finish
  duckRadius: 1,
  treeBandWidth: 140,
  treeRowGap: 24, // dense enough to read as forward motion
  treesPerRowSide: 4,
  treeMinHeight: 12,
  treeMaxHeight: 72,
  ringTreeClearance: 3, // margin so a ring opening never sits flush against a trunk
  boostLaneLength: 100, // ~one ringGap of tree-free runway so a boost can't fling you into a tree
  boostLaneHalfWidth: 14, // a bit wider than the ring (radius 6 + tube) so the exit path is clear
};
