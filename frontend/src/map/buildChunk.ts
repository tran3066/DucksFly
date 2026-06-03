// Parametric, deterministic per-chunk generator for the INFINITE run mode.
//
// `buildMap.ts` builds a finite course in one shot from a single seed; that stays
// the source of truth for races + multiplayer and is intentionally left untouched.
// For the unbounded Infinite Run we instead generate the world one fixed-length
// Z-band ("chunk") at a time, so a window manager (`infiniteMap.ts`) can stream
// chunks in/out as the duck flies without ever holding the whole world in memory.
//
// Design rules that keep streaming correct:
//   - Each chunk draws from its OWN salted RNG streams derived from
//     `deriveSeed(seed, chunkIndex * CHUNK_SALT_STRIDE + featureSalt)`, so a chunk's
//     contents depend only on (seed, chunkIndex, cfg, difficulty) — never on its
//     neighbors. Same inputs ⇒ byte-identical chunk, on every client.
//   - Ids are globally unique + monotonic via `chunkIndex * ID_STRIDE + local`, so
//     the rig's `passedRingsRef` set never collides across chunks and scenery keys
//     stay stable.
//   - Every feature lives strictly inside its half-open band `[start, end)`, so two
//     adjacent chunks can never emit the same row/ring/checkpoint (no seam dupes).
//   - `difficulty` (0..1, supplied by the window manager as a function of
//     chunkIndex) ramps tree density up and tightens ring Z-spacing.
//
// Coordinate conventions match the rest of map/ (see types.ts).

import { treeTrunk, RING_TUBE } from './collide';
import { deriveSeed, makeRng, randRange } from './rng';
import type { MapConfig, RingDef, Checkpoint, SceneryItem, SceneryKind } from './types';

/** Z length of one chunk (m). Multiple of common gaps so seams read cleanly. */
export const CHUNK_LENGTH = 500;

/**
 * Per-chunk id namespace size. `chunkIndex * ID_STRIDE + local` must never let one
 * chunk's local index reach the next chunk's base, so this has to comfortably
 * exceed the most items a single chunk can ever produce (a few thousand at most).
 */
export const ID_STRIDE = 1_000_000;

/**
 * Per-chunk salt namespace. A chunk's feature streams are
 * `deriveSeed(seed, chunkIndex * CHUNK_SALT_STRIDE + featureSalt)`; this stride must
 * exceed every `featureSalt` below so no two (chunk, feature) pairs ever collide.
 */
const CHUNK_SALT_STRIDE = 0x100;

const RING_SALT = 0x1;
const TREE_SALT = 0x2;

/** Max fraction the ring Z-gap is tightened by at full difficulty (0.5 ⇒ half gap). */
const RING_GAP_TIGHTEN = 0.5;
/** Floor on the ring Z-gap (m) so tightening can never collapse rings on top of each other. */
const MIN_RING_GAP = 40;
/** Extra trees-per-row-side multiplier at full difficulty (1 ⇒ up to 2× density). */
const TREE_DENSITY_RAMP = 1;

/** What `buildChunk` yields: the collidable + cosmetic contents of one Z-band. */
export interface ChunkData {
  rings: RingDef[];
  scenery: SceneryItem[];
  checkpoints: Checkpoint[];
}

/**
 * Per-kind ground-detail scatter spec (purely cosmetic; the rig only ever collides
 * with `kind: 'tree'`). Mirrors `buildMap.ts`'s table so the Infinite world reads
 * visually identical; redefined here so `buildMap.ts` stays untouched. Each kind
 * draws from its own salt so adding/removing one never shifts the others or the
 * trees (0x2) / rings (0x1).
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
 * Build the contents of one chunk (the Z-band `[chunkIndex*CHUNK_LENGTH,
 * (chunkIndex+1)*CHUNK_LENGTH)`). Pure + deterministic: identical
 * `(chunkIndex, seed, cfg, difficulty)` always yields a deeply-equal `ChunkData`.
 *
 * Generation order matches `buildMap` (trees → rings → scenery) because rings are
 * placed clear of trees and boost lanes are carved out of trees; it does NOT affect
 * determinism since each generator owns a separate salted stream.
 *
 * @param difficulty 0..1 ramp (caller-supplied, derived from chunkIndex): higher =
 *   denser trees + tighter ring spacing. Clamped defensively.
 */
export function buildChunk(
  chunkIndex: number,
  seed: number,
  cfg: MapConfig,
  difficulty: number,
): ChunkData {
  const d = clamp01(difficulty);
  const start = chunkIndex * CHUNK_LENGTH;
  const end = start + CHUNK_LENGTH;
  const idBase = chunkIndex * ID_STRIDE;
  // Obstacle-free prefix at the very start of the world (only ever clips chunk 0):
  // gives the player room to settle after the countdown before anything can crash them.
  const safeZ = cfg.startSafeZ;

  const trees = buildChunkTrees(chunkIndex, seed, cfg, d, start, end, idBase, safeZ);
  const rings = buildChunkRings(chunkIndex, seed, cfg, d, start, end, idBase, safeZ, trees);
  const scenery = [
    ...clearBoostLanes(trees, rings, cfg),
    ...buildChunkDetail(chunkIndex, seed, cfg, start, end, idBase, trees.length),
  ];
  const checkpoints = buildChunkCheckpoints(cfg, start, end, idBase);
  return { rings, scenery, checkpoints };
}

/**
 * Trees in structured rows across the corridor (salt 0x2), biased toward the
 * centerline. These are the only collidable scenery. Density ramps with difficulty.
 * Trees are clamped inside `[start, end)` so a chunk never leaks an obstacle into a
 * neighbor's band, and any tree before `safeZ` is dropped.
 */
function buildChunkTrees(
  chunkIndex: number,
  seed: number,
  cfg: MapConfig,
  difficulty: number,
  start: number,
  end: number,
  idBase: number,
  safeZ: number,
): SceneryItem[] {
  const tr = makeRng(deriveSeed(seed, chunkIndex * CHUNK_SALT_STRIDE + TREE_SALT));
  const perRowSide = Math.max(0, Math.round(cfg.treesPerRowSide * (1 + difficulty * TREE_DENSITY_RAMP)));
  const treesPerRow = perRowSide * 2;
  const items: SceneryItem[] = [];
  let local = 0;
  for (let z = start; z < end; z += cfg.treeRowGap) {
    for (let i = 0; i < treesPerRow; i++) {
      // Draw every value unconditionally so the stream stays aligned regardless of
      // which trees survive the safe-zone / band clamp (keeps generation deterministic).
      const x = centeredX(tr, cfg.halfWidth);
      const jitter = randRange(tr, -cfg.treeRowGap * 0.5, cfg.treeRowGap * 0.5);
      const height = randRange(tr, cfg.treeMinHeight, cfg.treeMaxHeight);
      const variant = 1 + Math.floor(tr() * 5);
      const rotationY = tr() * Math.PI * 2;
      const zJit = clamp(z + jitter, start, nextDown(end));
      if (zJit < safeZ) continue; // obstacle-free start of the world
      items.push({ id: idBase + local++, kind: 'tree', variant, pos: [x, 0, zJit], rotationY, height });
    }
  }
  return items;
}

/**
 * Rings on a chunk-local Z-grid (salt 0x1), spacing tightened by difficulty. Each
 * ring is raised/slid clear of this chunk's trees (pure geometry, like buildMap).
 * Rings before `safeZ` are skipped BEFORE drawing RNG so the stream aligns with the
 * rings actually placed.
 */
function buildChunkRings(
  chunkIndex: number,
  seed: number,
  cfg: MapConfig,
  difficulty: number,
  start: number,
  end: number,
  idBase: number,
  safeZ: number,
  trees: SceneryItem[],
): RingDef[] {
  const rng = makeRng(deriveSeed(seed, chunkIndex * CHUNK_SALT_STRIDE + RING_SALT));
  const ringGap = Math.max(MIN_RING_GAP, cfg.ringGap * (1 - difficulty * RING_GAP_TIGHTEN));
  const ceilingCap = cfg.ceiling - cfg.ringRadius - RING_TUBE;
  const rings: RingDef[] = [];
  let local = 0;
  for (let z = start; z < end; z += ringGap) {
    if (z < safeZ) continue;
    const x = randRange(rng, -cfg.ringMaxOffsetX, cfg.ringMaxOffsetX);
    const y = randRange(rng, cfg.ringMinY, cfg.ringMaxY);
    const ring: RingDef = { id: idBase + local++, pos: [x, y, z], radius: cfg.ringRadius };
    clearRingOfTrees(ring, trees, cfg, ceilingCap);
    rings.push(ring);
  }
  return rings;
}

/**
 * Cosmetic ground detail scattered across the chunk band, biased toward the center.
 * `startId` continues past this chunk's tree ids so the combined scenery list keeps
 * unique ids within the chunk (and the chunk's `idBase` keeps it unique globally).
 */
function buildChunkDetail(
  chunkIndex: number,
  seed: number,
  cfg: MapConfig,
  start: number,
  end: number,
  idBase: number,
  startId: number,
): SceneryItem[] {
  const items: SceneryItem[] = [];
  let local = startId;
  for (const spec of DETAIL_SCATTER) {
    const rng = makeRng(deriveSeed(seed, chunkIndex * CHUNK_SALT_STRIDE + spec.salt));
    const count = Math.round(spec.per100m * (CHUNK_LENGTH / 100));
    for (let i = 0; i < count; i++) {
      const x = centeredX(rng, cfg.halfWidth);
      const z = randRange(rng, start, end);
      items.push({
        id: idBase + local++,
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
 * Checkpoints on the global Z-grid (every `checkpointGap`), so spacing is uniform
 * across seams and each multiple lands in exactly one chunk (no dupes). Infinite
 * mode never finishes, so none is a finish line. (Infinite uses crash-ends-run, so
 * these are mostly a data-shape formality, but kept for MapDef parity.)
 */
function buildChunkCheckpoints(
  cfg: MapConfig,
  start: number,
  end: number,
  idBase: number,
): Checkpoint[] {
  const checkpoints: Checkpoint[] = [];
  const first = Math.ceil(start / cfg.checkpointGap) * cfg.checkpointGap;
  let local = 0;
  for (let z = first; z < end; z += cfg.checkpointGap) {
    checkpoints.push({ id: idBase + local++, z, isFinish: false });
  }
  return checkpoints;
}

// ── Pure geometry helpers (ported from buildMap.ts so it stays untouched) ──────

/** Push a ring up/sideways until no chunk-local trunk pokes through it. Mutates pos. */
function clearRingOfTrees(
  ring: RingDef,
  trees: SceneryItem[],
  cfg: MapConfig,
  ceilingCap: number,
): void {
  for (let attempt = 0; attempt < 4; attempt++) {
    const requiredY = requiredClearY(ring, trees, cfg);
    if (requiredY <= ring.pos[1]) return;
    if (requiredY <= ceilingCap) {
      ring.pos[1] = requiredY;
      return;
    }
    ring.pos[0] = nudgeX(ring, cfg, attempt);
  }
  ring.pos[1] = ceilingCap;
}

function requiredClearY(ring: RingDef, trees: SceneryItem[], cfg: MapConfig): number {
  let required = ring.pos[1];
  for (const tree of trees) {
    if (!treeOverlapsRingColumn(ring, tree, cfg)) continue;
    const clearTop = treeTrunk(tree).height + ring.radius + cfg.ringTreeClearance;
    if (clearTop > required) required = clearTop;
  }
  return required;
}

function treeOverlapsRingColumn(ring: RingDef, tree: SceneryItem, cfg: MapConfig): boolean {
  if (tree.kind !== 'tree') return false;
  const trunkRadius = treeTrunk(tree).radius;
  if (Math.abs(tree.pos[2] - ring.pos[2]) > trunkRadius + RING_TUBE + cfg.ringTreeClearance) {
    return false;
  }
  const dx = Math.abs(tree.pos[0] - ring.pos[0]);
  return dx < ring.radius + trunkRadius + cfg.ringTreeClearance;
}

function nudgeX(ring: RingDef, cfg: MapConfig, attempt: number): number {
  const dir = ring.pos[0] >= 0 ? 1 : -1;
  const step = (attempt + 1) * (ring.radius + RING_TUBE + cfg.ringTreeClearance) * 2;
  const limit = cfg.halfWidth - ring.radius - RING_TUBE;
  return Math.max(-limit, Math.min(limit, ring.pos[0] + dir * step));
}

/** Drop any tree sitting in a ring's downstream (+Z) boost lane. */
function clearBoostLanes(trees: SceneryItem[], rings: RingDef[], cfg: MapConfig): SceneryItem[] {
  return trees.filter((tree) => !rings.some((ring) => inBoostLane(tree, ring, cfg)));
}

function inBoostLane(tree: SceneryItem, ring: RingDef, cfg: MapConfig): boolean {
  const dz = tree.pos[2] - ring.pos[2];
  if (dz < 0 || dz > cfg.boostLaneLength) return false;
  return Math.abs(tree.pos[0] - ring.pos[0]) < cfg.boostLaneHalfWidth;
}

/** Triangular distribution over [-half, +half] peaking at 0 (clusters mid-corridor). */
function centeredX(rng: () => number, half: number): number {
  return (rng() + rng() - 1) * half;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Largest representable value strictly below `n` — keeps clamped trees inside `[start, end)`. */
function nextDown(n: number): number {
  return n - Math.max(1e-6, Math.abs(n) * Number.EPSILON);
}
