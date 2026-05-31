// Pure, framework-free collision primitives. No three.js / react / game state —
// just deterministic geometry helpers shared by the sim loop (respawn) and the
// map generator (ring-vs-tree placement). Mirrors the conventions in buildMap.ts.
//
// Coordinate conventions (see types.ts):
//   +Y = up (altitude), yaw=0 -> +Z forward "down the track",
//   +X = left, -X = right. groundY=0.

import type { RingDef, SceneryItem } from './types';

/**
 * Thick torus tube radius — the solid rim around the fly-through hole, in
 * meters. Single source of truth shared by the renderer (MapView's
 * `torusGeometry(radius, RING_TUBE, …)`) and `ringRimHit` so what you see is
 * exactly what crashes you.
 */
export const RING_TUBE = 1.5;

/** A tree's collidable volume: a vertical cylinder rooted on the ground. */
export interface TreeTrunk {
  /** Cylinder radius (m), centered on the tree's [x, z]. */
  radius: number;
  /** Collidable height above the ground (m); spans y in [0, height]. */
  height: number;
}

/** Trunk radius as a fraction of the tree's rendered height. */
const TRUNK_RADIUS_FRACTION = 0.06;
/** Floor on the trunk radius so even short trees are a real obstacle (m). */
const TRUNK_MIN_RADIUS = 0.6;

/**
 * Derive a tree's collision cylinder from its height. Deterministic (no RNG):
 * the same `SceneryItem` always yields the same volume, so the generator
 * (placement) and the sim (respawn) agree without storing extra per-item data.
 *
 * Radius scales with height (taller trees read as thicker), clamped to a sane
 * minimum. The full tree height is collidable so a tree is a real obstacle at
 * any altitude the duck might clip it.
 */
export function treeTrunk(tree: SceneryItem): TreeTrunk {
  const radius = Math.max(TRUNK_MIN_RADIUS, tree.height * TRUNK_RADIUS_FRACTION);
  return { radius, height: tree.height };
}

/**
 * Does a duck sphere of `duckRadius` at world (x, y, z) overlap this tree's
 * trunk cylinder? Modeled as sphere-vs-finite-cylinder (a slightly forgiving
 * over-approximation): horizontal reach plus vertical overlap with [0, height].
 *
 * Caller is responsible for only passing tree items (and ideally pre-filtering
 * to nearby trees); the test itself is purely geometric.
 */
export function treeHit(
  x: number,
  y: number,
  z: number,
  tree: SceneryItem,
  duckRadius: number,
): boolean {
  const { radius, height } = treeTrunk(tree);
  const dx = x - tree.pos[0];
  const dz = z - tree.pos[2];
  const horiz = Math.hypot(dx, dz);
  if (horiz > radius + duckRadius) return false;
  // Vertical overlap of the duck sphere with the trunk cylinder [base, top].
  const base = tree.pos[1];
  return y - duckRadius <= height && y + duckRadius >= base;
}

/**
 * Did the duck just fly through this ring's hole this tick?
 * Detects crossing the ring plane (prevZ -> currZ) while inside the hole.
 * Returns: 'pass' (through the hole), 'miss' (crossed plane but outside), or null.
 */
export function ringCrossing(
  prevZ: number,
  currZ: number,
  x: number,
  y: number,
  ring: RingDef,
  duckRadius: number,
): 'pass' | 'miss' | null {
  const rz = ring.pos[2];
  const crossed = prevZ < rz && currZ >= rz;
  if (!crossed) return null;
  const dx = x - ring.pos[0];
  const dy = y - ring.pos[1];
  const dist = Math.hypot(dx, dy);
  return dist <= ring.radius - duckRadius ? 'pass' : 'miss';
}

/**
 * Did the duck clip this ring's solid rim while crossing its plane this tick?
 *
 * Same plane-crossing test as `ringCrossing`, but true only in the rim band:
 * radial distance in [radius − duckRadius, radius + RING_TUBE].
 *   - dist <  radius − duckRadius  -> clean pass through the hole (boost; see
 *     `ringCrossing` === 'pass') — NOT a rim hit.
 *   - dist in the band             -> clip the rim -> crash.
 *   - dist >  radius + RING_TUBE   -> sailed past outside the ring -> no impact.
 */
export function ringRimHit(
  prevZ: number,
  currZ: number,
  x: number,
  y: number,
  ring: RingDef,
  duckRadius: number,
): boolean {
  const rz = ring.pos[2];
  const crossed = prevZ < rz && currZ >= rz;
  if (!crossed) return false;
  const dx = x - ring.pos[0];
  const dy = y - ring.pos[1];
  const dist = Math.hypot(dx, dy);
  return dist >= ring.radius - duckRadius && dist <= ring.radius + RING_TUBE;
}
