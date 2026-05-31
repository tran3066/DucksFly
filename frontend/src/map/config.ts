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
  ringMaxY: 120,
  checkpointGap: 450, // ~4 checkpoints + finish
  duckRadius: 1,
  treeBandWidth: 140,
  treeRowGap: 24, // dense enough to read as forward motion
  treesPerRowSide: 4,
  treeMinHeight: 12,
  treeMaxHeight: 72,
};
