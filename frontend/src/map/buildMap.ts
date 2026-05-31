import { DEFAULT_MAP_CONFIG } from './config';
import { deriveSeed, makeRng, randRange } from './rng';
import type { MapConfig, MapDef, RingDef, Checkpoint, SceneryItem, SceneryKind } from './types';

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
    scenery: buildScenery(seed, cfg),
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

/**
 * Per-kind ground-detail scatter spec. `per100m` = items placed per 100 m of
 * track (across both sides combined). Heights in meters. Each kind draws from
 * its own seed stream (`salt`) so adding/removing a kind never shifts the others
 * — nor the rings (salt 0x1) or trees (salt 0x2).
 */
interface DetailSpec {
  kind: SceneryKind;
  variants: number;
  per100m: number;
  minH: number;
  maxH: number;
  salt: number;
}

const DETAIL_SCATTER: DetailSpec[] = [
  { kind: 'bush', variants: 3, per100m: 3, minH: 2, maxH: 4, salt: 0x3 },
  { kind: 'rock', variants: 5, per100m: 2, minH: 1, maxH: 3, salt: 0x4 },
  { kind: 'grass', variants: 2, per100m: 6, minH: 0.6, maxH: 1.2, salt: 0x5 },
  { kind: 'flowers', variants: 2, per100m: 4, minH: 0.6, maxH: 1.0, salt: 0x6 },
  { kind: 'mushroom', variants: 2, per100m: 1, minH: 0.4, maxH: 0.8, salt: 0x7 },
  { kind: 'stump', variants: 1, per100m: 0.5, minH: 1.2, maxH: 2.0, salt: 0x8 },
  { kind: 'branch', variants: 1, per100m: 0.6, minH: 0.5, maxH: 0.9, salt: 0x9 },
];

/**
 * All cosmetic scenery, scattered in the bands OUTSIDE the corridor walls so it
 * never blocks flight. Trees are placed in structured rows (reads as forward
 * motion); everything else is scattered randomly through the same bands.
 */
function buildScenery(seed: number, cfg: MapConfig): SceneryItem[] {
  const items: SceneryItem[] = [];
  let id = 0;

  // Trees in rows down both flanks (salt 0x2). Random variant + yaw per tree.
  const tr = makeRng(deriveSeed(seed, 0x2));
  for (let z = 0; z <= cfg.length; z += cfg.treeRowGap) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < cfg.treesPerRowSide; i++) {
        const x = side * randRange(tr, cfg.halfWidth + 4, cfg.halfWidth + cfg.treeBandWidth);
        const zJit = z + randRange(tr, -cfg.treeRowGap * 0.5, cfg.treeRowGap * 0.5);
        const height = randRange(tr, cfg.treeMinHeight, cfg.treeMaxHeight);
        items.push({
          id: id++,
          kind: 'tree',
          variant: 1 + Math.floor(tr() * 5),
          pos: [x, 0, zJit],
          rotationY: tr() * Math.PI * 2,
          height,
        });
      }
    }
  }

  // Ground detail (bushes/rocks/grass/flowers/mushrooms/stumps/branches),
  // randomly scattered through the same outside-the-wall bands.
  for (const spec of DETAIL_SCATTER) {
    const rng = makeRng(deriveSeed(seed, spec.salt));
    const count = Math.round(spec.per100m * (cfg.length / 100));
    for (let i = 0; i < count; i++) {
      const side = rng() < 0.5 ? -1 : 1;
      const x = side * randRange(rng, cfg.halfWidth + 2, cfg.halfWidth + cfg.treeBandWidth);
      const z = randRange(rng, 0, cfg.length);
      items.push({
        id: id++,
        kind: spec.kind,
        variant: 1 + Math.floor(rng() * spec.variants),
        pos: [x, 0, z],
        rotationY: rng() * Math.PI * 2,
        height: randRange(rng, spec.minH, spec.maxH),
      });
    }
  }

  return items;
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
