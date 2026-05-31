/**
 * RaceRoomState and friends — what the server keeps track of and shares with everyone.
 * ("Room" is the networking term for one race that a group of players share.)
 *
 * Source of truth: docs/ARCHITECTURE.md §4 ("The Two Shared Agreements"). These are plain
 * TypeScript shapes so the frontend and the server use one definition. The server's live
 * Colyseus state (built with @colyseus/schema) implements these same shapes.
 */

/** A 3D vector: position or velocity, as [x, y, z]. */
export type Vec3 = [number, number, number];

/** A rotation as a quaternion, as [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** The race phases, in order. See docs/ARCHITECTURE.md §7. */
export type RacePhase = "lobby" | "countdown" | "racing" | "finished";

/** The duck appearances that ship for the picker (docs/DESIGN.md §2). */
export type DuckVariant = "male" | "female";

/**
 * One ring on the course. Ring positions are sent alongside the map seed so every client
 * agrees on them exactly (docs/ARCHITECTURE.md §6). Ring collisions are client-local; the
 * client reports a pass with a `ringPassed` message.
 */
export interface RingDef {
  /** Stable id, also the intended pass order (0, 1, 2, ...). */
  id: number;
  /** Center of the ring in world space. */
  pos: Vec3;
  /** Orientation the ring faces. */
  quat: Quat;
  /** Inner radius the duck must pass through, in world units. */
  radius: number;
}

/** One player's live state, synced to everyone many times per second. */
export interface PlayerState {
  id: string;
  name: string;
  duckVariant: DuckVariant;
  /** Position, updated 15 to 20 times per second. */
  pos: Vec3;
  /** Velocity (speed and direction). */
  vel: Vec3;
  /** Which way the duck is facing. */
  quat: Quat;
  /** How many rings this player has passed so far. */
  ringsPassed: number;
  /** Current lap number. */
  lap: number;
  /** Current race position (1 = first). */
  rank: number;
  /** True while the player is spun out from a collision (server-authoritative). */
  spunOut: boolean;
}

/**
 * The full shared room state. `players` is keyed by Colyseus sessionId. On the server this
 * is a Colyseus Schema (with a MapSchema for `players`); this plain shape is the contract
 * both sides read against.
 */
export interface RaceRoomState {
  phase: RacePhase;
  /** One number that lets every client build the same world (docs/ARCHITECTURE.md §6). */
  mapSeed: number;
  /** Where the rings are, sent once when you join. */
  ringLayout: RingDef[];
  /** Epoch ms when the countdown ends and racing begins (0 outside countdown). */
  countdownEndsAt: number;
  players: Record<string, PlayerState>;
}
