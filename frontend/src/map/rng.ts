// Deterministic seeded PRNG. Pure, framework-free — the same seed produces the
// exact same sequence on every client (and the server), so everyone builds the
// identical world from one number. See prompts/person-b-environment-plan.md.

/** mulberry32: tiny, fast, good-enough 32-bit seeded generator. Returns [0,1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [lo, hi). */
export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/**
 * Derive an independent stream from a base seed + a salt, so adding one feature
 * (e.g. obstacles) does not shift another (e.g. rings).
 */
export function deriveSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
}
