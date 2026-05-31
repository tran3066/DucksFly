import type { RingDef, Vec3, Quat } from "@shared/network";

/**
 * Deterministic world generation from one number (docs/ARCHITECTURE.md §6). The server
 * sends a seed and the ring layout; every client rebuilds the identical course. The
 * generator is pure and fully determined by (seed, count): a fresh PRNG is created per
 * call, so interleaving generations for different seeds never affects each other.
 */

/** Number of rings generated when no count is given. */
export const DEFAULT_RING_COUNT = 8;

/** Radius of the circular track the rings are laid out along, in world units. */
const TRACK_RADIUS = 40;

/** mulberry32: a small, fast, fully deterministic PRNG seeded per call. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the ring layout for a seed. Rings are spread around a circular track (so they are
 * never stacked at one point), with seed-driven jitter on position, height, and radius so
 * different seeds yield visibly different courses. Each ring faces along the track and its
 * orientation quaternion is unit length by construction.
 */
export function generateRingLayout(seed: number, count: number = DEFAULT_RING_COUNT): RingDef[] {
  const rng = mulberry32(seed);
  const rings: RingDef[] = [];

  for (let id = 0; id < count; id++) {
    const angle = count > 0 ? (id / count) * Math.PI * 2 : 0;

    const pos: Vec3 = [
      Math.cos(angle) * TRACK_RADIUS + (rng() - 0.5) * 4,
      10 + (rng() - 0.5) * 10,
      Math.sin(angle) * TRACK_RADIUS + (rng() - 0.5) * 4,
    ];

    // Face along the track tangent: a yaw rotation about the Y axis. sin^2 + cos^2 = 1,
    // so this quaternion is always unit length.
    const yaw = angle + Math.PI / 2;
    const quat: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

    const radius = 4 + rng() * 2;

    rings.push({ id, pos, quat, radius });
  }

  return rings;
}
