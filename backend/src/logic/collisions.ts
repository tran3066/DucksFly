import type { Vec3 } from "@shared/network";
import { COLLISION_RADIUS } from "@shared/constants";

/**
 * Player-vs-player collision detection (server-authoritative, docs/ARCHITECTURE.md §3).
 * Pure: takes everyone's positions and returns the ids of players involved in any
 * collision this tick, so the RaceRoom can broadcast a `spinOut` to each.
 */
export interface CollisionBody {
  id: string;
  pos: Vec3;
  /** Players already spinning out neither collide nor are reported. */
  spunOut: boolean;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Returns the sorted, de-duplicated ids of all players in a colliding pair. A pair collides
 * when the distance between them is strictly less than `radius`. Spun-out bodies are
 * skipped entirely.
 */
export function detectCollisions(
  bodies: CollisionBody[],
  radius: number = COLLISION_RADIUS,
): string[] {
  const active = bodies.filter((b) => !b.spunOut);
  const radiusSquared = radius * radius;
  const hit = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (distanceSquared(active[i].pos, active[j].pos) < radiusSquared) {
        hit.add(active[i].id);
        hit.add(active[j].id);
      }
    }
  }

  return [...hit].sort();
}
