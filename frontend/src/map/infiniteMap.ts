// Windowed streamer for the INFINITE run mode.
//
// `buildChunk` generates one Z-band at a time; this wraps it in a sliding window so
// the rig only ever sees a small, bounded `MapDef` no matter how far the duck flies.
// As the duck advances we lazily build chunks AHEAD of it and drop chunks fully
// BEHIND a margin, while caching built chunks so briefly backing up never rebuilds
// (and stays visually stable).
//
// The exposed `MapDef` is shaped exactly like `buildMap`'s output (same fields), so
// `FlightScene`/`MapView`/`FlightRig` consume it without any special-casing. Its
// `length` is the far edge of the current window; `halfWidth`/`ceiling`/`floorY`
// come from the config.
//
// Crucially `update(z)` is CHEAP when the window is unchanged: it only rebuilds the
// exposed map when the duck crosses into a new chunk window, so callers can poll it
// every frame (or off a boundary callback) without churn.

import { DEFAULT_MAP_CONFIG } from './config';
import { buildChunk, CHUNK_LENGTH, type ChunkData } from './buildChunk';
import type { MapConfig, MapDef } from './types';

/** How many chunks to keep generated ahead of the duck's current chunk. */
const WINDOW_AHEAD = 3;
/** How many chunks to keep behind before dropping them from the active window. */
const WINDOW_BEHIND = 1;
/**
 * Extra chunks (beyond the active window) to retain in the build cache on each side,
 * so small back-and-forth around a seam never triggers a rebuild. Bounds memory.
 */
const CACHE_MARGIN = 2;
/**
 * Chunks over which difficulty ramps from 0 → 1, then clamps. ~CHUNK_LENGTH each, so
 * this is roughly `RAMP_CHUNKS * CHUNK_LENGTH` meters to reach peak difficulty.
 */
const DIFFICULTY_RAMP_CHUNKS = 24;

/**
 * Difficulty for a chunk: 0 at the start, rising linearly and clamped to 1. Pure +
 * monotonic non-decreasing, so the world only ever gets harder with distance (never
 * easier) and plateaus once clamped. Exported so it (and tests) share one definition.
 */
export function difficultyFor(chunkIndex: number): number {
  if (chunkIndex <= 0) return 0;
  return Math.min(1, chunkIndex / DIFFICULTY_RAMP_CHUNKS);
}

/** A live, sliding view over an unbounded deterministic world. */
export interface InfiniteMap {
  /**
   * Advance the window to cover the duck's current Z. Returns `true` iff the active
   * window changed (a chunk boundary was crossed and the exposed map was rebuilt) —
   * cheap no-op returning `false` otherwise. Safe to call every frame.
   */
  update(z: number): boolean;
  /** The current windowed map. Stable reference between window changes. */
  getMap(): MapDef;
  /** Bumps every time the window changes; handy as a React dependency. */
  getVersion(): number;
  /** Z length of one chunk (m) — lets callers drive updates off boundary crossings. */
  readonly chunkLength: number;
}

/**
 * Create an infinite, deterministic, windowed map for `seed`. The same `(seed, cfg)`
 * always streams the identical world. `cfg.length`/`cfg.checkpointGap`'s finish are
 * irrelevant here (the world never ends); all other knobs (corridor size, ring/tree
 * params) are honored.
 */
export function createInfiniteMap(seed: number, cfg: MapConfig = DEFAULT_MAP_CONFIG): InfiniteMap {
  const cache = new Map<number, ChunkData>();
  let windowStart = -1; // inclusive chunk index; -1 = not yet initialized
  let windowEnd = -1; // inclusive chunk index
  let version = 0;
  let current: MapDef = emptyMap(seed, cfg);

  function getChunk(index: number): ChunkData {
    let chunk = cache.get(index);
    if (!chunk) {
      chunk = buildChunk(index, seed, cfg, difficultyFor(index));
      cache.set(index, chunk);
    }
    return chunk;
  }

  function rebuild(): void {
    const rings: MapDef['rings'] = [];
    const scenery: MapDef['scenery'] = [];
    const checkpoints: MapDef['checkpoints'] = [];
    // Ascending chunk order ⇒ every concatenated array stays sorted by Z.
    for (let i = windowStart; i <= windowEnd; i++) {
      const chunk = getChunk(i);
      rings.push(...chunk.rings);
      scenery.push(...chunk.scenery);
      checkpoints.push(...chunk.checkpoints);
    }
    current = {
      seed,
      length: (windowEnd + 1) * CHUNK_LENGTH, // far edge of the last in-window chunk
      halfWidth: cfg.halfWidth,
      ceiling: cfg.ceiling,
      floorY: cfg.floorY,
      rings,
      checkpoints,
      scenery,
    };
  }

  function evictCache(): void {
    const keepLo = windowStart - CACHE_MARGIN;
    const keepHi = windowEnd + CACHE_MARGIN;
    for (const index of cache.keys()) {
      if (index < keepLo || index > keepHi) cache.delete(index);
    }
  }

  function update(z: number): boolean {
    const currentChunk = Math.max(0, Math.floor(z / CHUNK_LENGTH));
    const start = Math.max(0, currentChunk - WINDOW_BEHIND);
    const end = currentChunk + WINDOW_AHEAD;
    if (start === windowStart && end === windowEnd) return false;
    windowStart = start;
    windowEnd = end;
    rebuild();
    evictCache();
    version++;
    return true;
  }

  update(0); // prime the window at the spawn so getMap() is valid immediately

  return {
    update,
    getMap: () => current,
    getVersion: () => version,
    chunkLength: CHUNK_LENGTH,
  };
}

/** A valid-but-empty map, used only as the pre-initialization placeholder. */
function emptyMap(seed: number, cfg: MapConfig): MapDef {
  return {
    seed,
    length: 0,
    halfWidth: cfg.halfWidth,
    ceiling: cfg.ceiling,
    floorY: cfg.floorY,
    rings: [],
    checkpoints: [],
    scenery: [],
  };
}
