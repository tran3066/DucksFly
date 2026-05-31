import { DEFAULT_MAP_CONFIG } from './config';
import { treeTrunk, RING_TUBE } from './collide';
import { deriveSeed, makeRng, randRange } from './rng';
import type { MapConfig, MapDef, RingDef, Checkpoint, SceneryItem, SceneryKind } from './types';

/**
 * Build the entire world from one seed. Pure & deterministic: the same
 * (seed, cfg) always yields the identical MapDef, so every client agrees with
 * zero extra network payload (the server only broadcasts `mapSeed`).
 *
 * Generation order matters for placement (but NOT for determinism — each
 * generator draws from its own salted RNG stream, so reordering never changes
 * the numbers any one of them produces):
 *   1. trees           — candidate forest.
 *   2. rings           — placed clear of those trees (pushed UP off any trunk).
 *   3. scenery         — trees with the boost lanes carved out, then ground detail.
 *
 * Export point of truth: C/D import this same function to know ring positions.
 */
export function buildMap(seed: number, cfg: MapConfig = DEFAULT_MAP_CONFIG): MapDef {
  const trees = buildTrees(seed, cfg);
  const rings = buildRings(seed, cfg, trees);
  const scenery = [...clearBoostLanes(trees, rings, cfg), ...buildDetail(seed, cfg, trees.length)];
  return {
    seed,
    length: cfg.length,
    halfWidth: cfg.halfWidth,
    ceiling: cfg.ceiling,
    floorY: cfg.floorY,
    rings,
    checkpoints: buildCheckpoints(cfg),
    scenery,
  };
}

function buildRings(seed: number, cfg: MapConfig, trees: SceneryItem[]): RingDef[] {
  // Independent stream so ring placement is stable even if other generators change.
  const rng = makeRng(deriveSeed(seed, 0x1));
  const rings: RingDef[] = [];
  // Highest a ring CENTER can sit while keeping its rim under the ceiling.
  const ceilingCap = cfg.ceiling - cfg.ringRadius - RING_TUBE;
  let id = 0;
  for (let z = cfg.startSafeZ; z <= cfg.length - cfg.ringGap; z += cfg.ringGap) {
    const x = randRange(rng, -cfg.ringMaxOffsetX, cfg.ringMaxOffsetX);
    const y = randRange(rng, cfg.ringMinY, cfg.ringMaxY);
    const ring: RingDef = { id: id++, pos: [x, y, z], radius: cfg.ringRadius };
    clearRingOfTrees(ring, trees, cfg, ceilingCap);
    rings.push(ring);
  }
  return rings;
}

/**
 * Push a ring's center UP until no tree trunk pokes through its opening; if the
 * ceiling cap blocks that, slide it sideways toward open space and retry. Pure
 * geometry (no RNG) so every client agrees. Mutates `ring.pos` in place.
 */
function clearRingOfTrees(
  ring: RingDef,
  trees: SceneryItem[],
  cfg: MapConfig,
  ceilingCap: number,
): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    const requiredY = requiredClearY(ring, trees, cfg);
    if (requiredY <= ring.pos[1]) return; // current altitude already clears every trunk
    if (requiredY <= ceilingCap) {
      ring.pos[1] = requiredY; // raise just enough to clear
      return;
    }
    // Too tall to clear under the ceiling here: slide x toward open space and retry
    // (altitude left untouched so requiredClearY recomputes honestly at the new x).
    ring.pos[0] = nudgeX(ring, cfg, attempt);
  }
  ring.pos[1] = ceilingCap; // pathological config fallback: clamp under the ceiling
}

/**
 * Lowest ring-center Y that clears every trunk overlapping this ring's vertical
 * column (the (x,z) footprint of the opening). Never returns below the ring's
 * current Y, so it only ever pushes a ring up.
 */
function requiredClearY(ring: RingDef, trees: SceneryItem[], cfg: MapConfig): number {
  let required = ring.pos[1];
  for (const tree of trees) {
    if (!treeOverlapsRingColumn(ring, tree, cfg)) continue;
    const clearTop = treeTrunk(tree).height + ring.radius + cfg.ringTreeClearance;
    if (clearTop > required) required = clearTop;
  }
  return required;
}

/** Does this trunk fall within the ring opening's (x,z) footprint? (Y-independent.) */
function treeOverlapsRingColumn(ring: RingDef, tree: SceneryItem, cfg: MapConfig): boolean {
  if (tree.kind !== 'tree') return false;
  const trunkRadius = treeTrunk(tree).radius;
  if (Math.abs(tree.pos[2] - ring.pos[2]) > trunkRadius + RING_TUBE + cfg.ringTreeClearance) {
    return false;
  }
  const dx = Math.abs(tree.pos[0] - ring.pos[0]);
  return dx < ring.radius + trunkRadius + cfg.ringTreeClearance;
}

/** Slide a ring further from the centerline (where trees cluster), clamped to the corridor. */
function nudgeX(ring: RingDef, cfg: MapConfig, attempt: number): number {
  const dir = ring.pos[0] >= 0 ? 1 : -1;
  const step = (attempt + 1) * (ring.radius + RING_TUBE + cfg.ringTreeClearance) * 2;
  const limit = cfg.halfWidth - ring.radius - RING_TUBE;
  return Math.max(-limit, Math.min(limit, ring.pos[0] + dir * step));
}

/**
 * Drop any tree sitting in a ring's DOWNSTREAM (+Z) boost lane so a fly-through
 * boost can't immediately fling the duck into a trunk. Pure + deterministic.
 */
function clearBoostLanes(trees: SceneryItem[], rings: RingDef[], cfg: MapConfig): SceneryItem[] {
  return trees.filter((tree) => !rings.some((ring) => inBoostLane(tree, ring, cfg)));
}

function inBoostLane(tree: SceneryItem, ring: RingDef, cfg: MapConfig): boolean {
  const dz = tree.pos[2] - ring.pos[2];
  if (dz < 0 || dz > cfg.boostLaneLength) return false; // only the runway ahead of the ring
  return Math.abs(tree.pos[0] - ring.pos[0]) < cfg.boostLaneHalfWidth;
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
  { kind: 'bush', variants: 3, per100m: 12, minH: 2, maxH: 4, salt: 0x3 },
  { kind: 'rock', variants: 5, per100m: 2, minH: 1, maxH: 3, salt: 0x4 },
  { kind: 'grass', variants: 2, per100m: 40, minH: 0.6, maxH: 1.2, salt: 0x5 },
  { kind: 'flowers', variants: 2, per100m: 30, minH: 0.6, maxH: 1.0, salt: 0x6 },
  { kind: 'mushroom', variants: 2, per100m: 10, minH: 0.4, maxH: 0.8, salt: 0x7 },
  { kind: 'stump', variants: 1, per100m: 0.5, minH: 1.2, maxH: 2.0, salt: 0x8 },
  { kind: 'branch', variants: 1, per100m: 0.6, minH: 0.5, maxH: 0.9, salt: 0x9 },
];

/**
 * Trees in structured rows across the corridor (salt 0x2), biased toward the
 * centerline (reads as forward motion). These ARE real in-corridor obstacles.
 * Random variant + yaw per tree. Ids start at 0 so ground detail can continue
 * the sequence without collision (see buildDetail).
 */
function buildTrees(seed: number, cfg: MapConfig): SceneryItem[] {
  const items: SceneryItem[] = [];
  const tr = makeRng(deriveSeed(seed, 0x2));
  const treesPerRow = cfg.treesPerRowSide * 2;
  let id = 0;
  for (let z = 0; z <= cfg.length; z += cfg.treeRowGap) {
    for (let i = 0; i < treesPerRow; i++) {
      const x = centeredX(tr, cfg.halfWidth);
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
  return items;
}

/**
 * Ground detail (bushes/rocks/grass/flowers/mushrooms/stumps/branches), randomly
 * scattered across the corridor, also biased toward the center. `startId` keeps
 * its ids past the tree ids so the combined scenery list stays collision-free.
 */
function buildDetail(seed: number, cfg: MapConfig, startId: number): SceneryItem[] {
  const items: SceneryItem[] = [];
  let id = startId;
  for (const spec of DETAIL_SCATTER) {
    const rng = makeRng(deriveSeed(seed, spec.salt));
    const count = Math.round(spec.per100m * (cfg.length / 100));
    for (let i = 0; i < count; i++) {
      const x = centeredX(rng, cfg.halfWidth);
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

/**
 * Lateral position biased toward the centerline: a triangular distribution over
 * [-half, +half] that peaks at x=0, so scenery clusters in the middle of the
 * corridor rather than at the edges.
 */
function centeredX(rng: () => number, half: number): number {
  return (rng() + rng() - 1) * half;
}

function buildCheckpoints(cfg: MapConfig): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  let id = 0;
  for (let z = 0; z < cfg.length; z += cfg.checkpointGap) {
    checkpoints.push({ id: id++, z, isFinish: false });
  }
  checkpoints.push({ id: id, z: cfg.length, isFinish: true });
  return checkpoints;
}
