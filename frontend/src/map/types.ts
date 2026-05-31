// Map / environment types. Framework-free (no three.js / react) so the exact
// same generation runs on any client and the server.
//
// Coordinate conventions match physics/ (Person C):
//   +Y = up (altitude), yaw=0 -> +Z forward "down the track",
//   +X = left, -X = right. groundY=0, ceilingY=200.

/** A boost gate the duck flies through. Plane faces along -Z (you fly into +Z). */
export interface RingDef {
  id: number;
  /** Center world position [x, y=altitude, z]. */
  pos: [number, number, number];
  /** Inner radius of the hole (m). */
  radius: number;
}

/** A full-corridor respawn plane at a fixed Z. */
export interface Checkpoint {
  id: number;
  z: number;
  /** The final checkpoint is the finish line. */
  isFinish: boolean;
}

/** The kinds of nature-pack scenery scattered along the track. */
export type SceneryKind =
  | 'tree'
  | 'bush'
  | 'rock'
  | 'grass'
  | 'flowers'
  | 'mushroom'
  | 'stump'
  | 'branch';

/**
 * One placed scenery instance. Always OUTSIDE the corridor — purely cosmetic,
 * never blocks flight. The renderer normalizes each model to `height` meters.
 */
export interface SceneryItem {
  id: number;
  kind: SceneryKind;
  /** 1-based model variant within the kind (e.g. tree 1..5). */
  variant: number;
  /** Base position on the ground [x, 0, z]. */
  pos: [number, number, number];
  /** Yaw rotation (radians) for per-instance variety. */
  rotationY: number;
  /** Target height in meters; the renderer scales each model to match. */
  height: number;
}

/** The fully-built world descriptor produced from a single seed. */
export interface MapDef {
  seed: number;
  /** Track length along +Z (m). Start at z=0, finish at z=length. */
  length: number;
  /** Lateral half-width: corridor spans x in [-halfWidth, +halfWidth] (m). */
  halfWidth: number;
  /** Soft ceiling altitude (m). */
  ceiling: number;
  /** Hard floor altitude (m). */
  floorY: number;
  rings: RingDef[];
  checkpoints: Checkpoint[];
  scenery: SceneryItem[];
}

/** Tunable knobs for the generator. All distances in meters. */
export interface MapConfig {
  length: number;
  halfWidth: number;
  ceiling: number;
  floorY: number;
  /** Keep the first stretch obstacle/ring-free so players settle after countdown. */
  startSafeZ: number;
  /** Z spacing between rings. */
  ringGap: number;
  /** Ring inner radius (forgiving=6, standard=4, tight=2.5). */
  ringRadius: number;
  /** Max |x| offset of a ring center from the centerline. */
  ringMaxOffsetX: number;
  /** Ring altitude band [min, max]. */
  ringMinY: number;
  ringMaxY: number;
  /** Z spacing between checkpoints. */
  checkpointGap: number;
  /** Canonical duck collision radius, shared by ring-pass + obstacle tests. */
  duckRadius: number;
  /** How far beyond each wall the tree band extends (m). */
  treeBandWidth: number;
  /** Z spacing between rows of trees. */
  treeRowGap: number;
  /** Trees generated per side, per row. */
  treesPerRowSide: number;
  /** Tree height band [min, max] (m). */
  treeMinHeight: number;
  treeMaxHeight: number;
}
