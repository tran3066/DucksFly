import { describe, it, expect } from "vitest";
import type { Vec3 } from "@shared/network";
import { COLLISION_RADIUS } from "@shared/constants";
import { detectCollisions, type CollisionBody } from "@/logic/collisions";

/**
 * Player-vs-player collision detection (server-authoritative, docs/ARCHITECTURE.md §3).
 * `detectCollisions` is pure: given everyone's positions and a radius, it returns the ids
 * of players involved in any collision this tick (both members of a colliding pair), so
 * the room can broadcast a `spinOut` to each. Distance strictly less than the radius
 * counts as a collision.
 */

function body(id: string, pos: Vec3, spunOut = false): CollisionBody {
  return { id, pos, spunOut };
}

const RADIUS = 2;

describe("detectCollisions", () => {
  it("returns no one when all players are far apart", () => {
    const players = [
      body("a", [0, 0, 0]),
      body("b", [10, 0, 0]),
      body("c", [0, 10, 0]),
    ];
    expect(detectCollisions(players, RADIUS)).toEqual([]);
  });

  it("flags both members of a colliding pair", () => {
    const players = [body("a", [0, 0, 0]), body("b", [1, 0, 0])];
    expect(detectCollisions(players, RADIUS).sort()).toEqual(["a", "b"]);
  });

  it("treats distance exactly equal to the radius as NOT colliding", () => {
    const players = [body("a", [0, 0, 0]), body("b", [RADIUS, 0, 0])];
    expect(detectCollisions(players, RADIUS)).toEqual([]);
  });

  it("treats distance just inside the radius as colliding", () => {
    const players = [body("a", [0, 0, 0]), body("b", [RADIUS - 0.01, 0, 0])];
    expect(detectCollisions(players, RADIUS).sort()).toEqual(["a", "b"]);
  });

  it("ignores players that are already spun out", () => {
    const players = [
      body("a", [0, 0, 0]),
      body("b", [1, 0, 0], /* spunOut */ true),
    ];
    expect(detectCollisions(players, RADIUS)).toEqual([]);
  });

  it("dedupes ids when a player collides with more than one other", () => {
    const players = [
      body("a", [0, 0, 0]),
      body("b", [1, 0, 0]),
      body("c", [0, 1, 0]),
    ];
    const result = detectCollisions(players, RADIUS).sort();
    expect(result).toEqual(["a", "b", "c"]);
    expect(new Set(result).size).toBe(result.length);
  });

  it("handles a full lobby of 8 players with two separate collision clusters", () => {
    const players = [
      // cluster 1 near origin
      body("p0", [0, 0, 0]),
      body("p1", [0.5, 0, 0]),
      // cluster 2 near (100,0,0)
      body("p2", [100, 0, 0]),
      body("p3", [100.5, 0, 0]),
      // loners
      body("p4", [50, 0, 0]),
      body("p5", [50, 50, 0]),
      body("p6", [-50, 0, 0]),
      body("p7", [0, -50, 0]),
    ];
    expect(detectCollisions(players, RADIUS).sort()).toEqual(["p0", "p1", "p2", "p3"]);
  });

  it("returns nothing for zero or one player", () => {
    expect(detectCollisions([], RADIUS)).toEqual([]);
    expect(detectCollisions([body("a", [0, 0, 0])], RADIUS)).toEqual([]);
  });
});

describe("detectCollisions — edge cases", () => {
  it("counts perfectly overlapping ducks (distance 0) as colliding", () => {
    const players = [body("a", [5, 5, 5]), body("b", [5, 5, 5])];
    expect(detectCollisions(players, RADIUS).sort()).toEqual(["a", "b"]);
  });

  it("measures true 3D distance across all axes, not just one", () => {
    // distance = sqrt(3) ~= 1.732, inside radius 2
    expect(detectCollisions([body("a", [0, 0, 0]), body("b", [1, 1, 1])], RADIUS).sort()).toEqual(
      ["a", "b"],
    );
    // distance = sqrt(3 * 1.2^2) ~= 2.078, outside radius 2
    expect(detectCollisions([body("a", [0, 0, 0]), body("b", [1.2, 1.2, 1.2])], RADIUS)).toEqual(
      [],
    );
  });

  it("works with negative coordinates", () => {
    expect(
      detectCollisions([body("a", [-10, -10, -10]), body("b", [-10.5, -10, -10])], RADIUS).sort(),
    ).toEqual(["a", "b"]);
  });

  it("returns all 8 ids when the whole lobby is piled up together", () => {
    const players = Array.from({ length: 8 }, (_, i) =>
      body(`p${i}`, [i * 0.1, 0, 0]),
    );
    expect(detectCollisions(players, RADIUS)).toHaveLength(8);
  });

  it("excludes a spun-out player even when an active pair is nearby", () => {
    const players = [
      body("a", [0, 0, 0]),
      body("b", [0.5, 0, 0], /* spunOut */ true),
      body("c", [0.5, 0.5, 0]),
    ];
    // b is spun out, so it neither collides nor is reported; a and c still collide.
    expect(detectCollisions(players, RADIUS).sort()).toEqual(["a", "c"]);
  });

  it("falls back to the shared COLLISION_RADIUS when no radius is given", () => {
    // COLLISION_RADIUS is 1.5: 1 unit apart collides, 2 units apart does not.
    expect(detectCollisions([body("a", [0, 0, 0]), body("b", [1, 0, 0])]).sort()).toEqual([
      "a",
      "b",
    ]);
    expect(detectCollisions([body("a", [0, 0, 0]), body("b", [2, 0, 0])])).toEqual([]);
    expect(COLLISION_RADIUS).toBe(1.5);
  });
});
