import { DEFAULT_MAP_CONFIG } from './config';
import { deriveSeed, makeRng, randRange } from './rng';
import type { MapConfig, MapDef, RingDef, Checkpoint, TreeDef } from './types';

/**
 * Build the entire world from one seed. Pure & deterministic: the same
 * (seed, cfg) always yields the identical MapDef, so every client agrees with
 * zero extra network payload (the server only broadcasts `mapSeed`).
 *
 * Export point of truth: C/D import this same function to know ring positions.
 */
export function buildMap(seed: number, cfg: MapConfig = DEFAULT_MAP_CONFIG): MapDef {
  return {
    seed,
    length: cfg.length,
    halfWidth: cfg.halfWidth,
    ceiling: cfg.ceiling,
    floorY: cfg.floorY,
    rings: buildRings(seed, cfg),
    checkpoints: buildCheckpoints(cfg),
    trees: buildTrees(seed, cfg),
  };
}

function buildRings(seed: number, cfg: MapConfig): RingDef[] {
  // Independent stream so ring placement is stable even if other generators change.
  const rng = makeRng(deriveSeed(seed, 0x1));
  const rings: RingDef[] = [];
  let id = 0;
  for (let z = cfg.startSafeZ; z <= cfg.length - cfg.ringGap; z += cfg.ringGap) {
    const x = randRange(rng, -cfg.ringMaxOffsetX, cfg.ringMaxOffsetX);
    const y = randRange(rng, cfg.ringMinY, cfg.ringMaxY);
    rings.push({ id: id++, pos: [x, y, z], radius: cfg.ringRadius });
  }
  return rings;
}

function buildTrees(seed: number, cfg: MapConfig): TreeDef[] {
  // Independent stream (salt 0x2) so trees don't shift ring placement.
  const rng = makeRng(deriveSeed(seed, 0x2));
  const trees: TreeDef[] = [];
  let id = 0;
  for (let z = 0; z <= cfg.length; z += cfg.treeRowGap) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < cfg.treesPerRowSide; i++) {
        // x sits just beyond the wall, out to the band edge; z jittered off the row.
        const x = side * randRange(rng, cfg.halfWidth + 4, cfg.halfWidth + cfg.treeBandWidth);
        const zJit = z + randRange(rng, -cfg.treeRowGap * 0.5, cfg.treeRowGap * 0.5);
        const height = randRange(rng, cfg.treeMinHeight, cfg.treeMaxHeight);
        trees.push({ id: id++, pos: [x, 0, zJit], height, radius: height * 0.32 });
      }
    }
  }
  return trees;
}

function buildCheckpoints(cfg: MapConfig): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  let id = 0;
  for (let z = 0; z < cfg.length; z += cfg.checkpointGap) {
    checkpoints.push({ id: id++, z, isFinish: false });
  }
  checkpoints.push({ id: id++, z: cfg.length, isFinish: true });
  return checkpoints;
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
