import { describe, it, expect } from "vitest";
import { generateRingLayout } from "@/logic/mapSeed";

/**
 * Deterministic world generation from one number (docs/ARCHITECTURE.md §6). The server
 * sends a seed and the ring layout; every client must rebuild the identical course. The
 * generator must therefore be pure and fully determined by (seed, count).
 */

describe("generateRingLayout", () => {
  it("produces an identical layout for the same seed", () => {
    expect(generateRingLayout(12345, 8)).toEqual(generateRingLayout(12345, 8));
  });

  it("produces different layouts for different seeds", () => {
    const a = generateRingLayout(1, 8);
    const b = generateRingLayout(2, 8);
    expect(a).not.toEqual(b);
  });

  it("returns exactly `count` rings with sequential ids", () => {
    const rings = generateRingLayout(777, 10);
    expect(rings).toHaveLength(10);
    expect(rings.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("returns a stable, well-formed shape for every ring", () => {
    for (const ring of generateRingLayout(42, 8)) {
      expect(ring.pos).toHaveLength(3);
      expect(ring.quat).toHaveLength(4);
      expect(ring.radius).toBeGreaterThan(0);
      for (const n of [...ring.pos, ...ring.quat, ring.radius]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it("normalizes ring orientation quaternions to unit length", () => {
    for (const ring of generateRingLayout(99, 6)) {
      const [x, y, z, w] = ring.quat;
      const len = Math.hypot(x, y, z, w);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it("generates a non-empty default layout when count is omitted", () => {
    const rings = generateRingLayout(2024);
    expect(rings.length).toBeGreaterThan(0);
  });
});

describe("generateRingLayout — edge cases", () => {
  it("returns an empty array when count is 0", () => {
    expect(generateRingLayout(123, 0)).toEqual([]);
  });

  it("returns a single ring with id 0 when count is 1", () => {
    const rings = generateRingLayout(123, 1);
    expect(rings).toHaveLength(1);
    expect(rings[0].id).toBe(0);
  });

  it("scales to a large course", () => {
    const rings = generateRingLayout(555, 50);
    expect(rings).toHaveLength(50);
    expect(rings.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it("is deterministic and well-formed for seed 0 and negative seeds", () => {
    for (const seed of [0, -1, -987654]) {
      const a = generateRingLayout(seed, 8);
      const b = generateRingLayout(seed, 8);
      expect(a).toEqual(b);
      expect(a).toHaveLength(8);
      for (const ring of a) {
        expect(ring.radius).toBeGreaterThan(0);
        expect(a.every(() => ring.pos.every(Number.isFinite))).toBe(true);
      }
    }
  });

  it("stays deterministic even when generations for other seeds are interleaved", () => {
    const first = generateRingLayout(7, 8);
    generateRingLayout(8, 8); // a different seed in between must not affect state
    generateRingLayout(9, 4);
    const again = generateRingLayout(7, 8);
    expect(again).toEqual(first);
  });

  it("spreads rings out rather than stacking them at one point", () => {
    const rings = generateRingLayout(31337, 8);
    const unique = new Set(rings.map((r) => r.pos.join(",")));
    expect(unique.size).toBeGreaterThan(1);
  });
});
