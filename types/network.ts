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
  /** How many rings this player has flown through so far (client-reported, display only). */
  ringsPassed: number;
  /** Current race position (1 = first). */
  rank: number;
  /** True once the player has crossed the finish line (client-reported, server-latched). */
  finished: boolean;
  /** Lobby ready flag. */
  ready: boolean;
  /** How many player-vs-player collisions this player has had this race (info only). */
  collisions: number;
  /** Epoch ms the player finished, or 0 if not finished. Elapsed = finishTime - raceStartAt. */
  finishTime: number;
}

/**
 * The full shared room state. `players` is keyed by Colyseus sessionId. On the server this
 * is a Colyseus Schema (with a MapSchema for `players`); this plain shape is the contract
 * both sides read against.
 */
export interface RaceRoomState {
  phase: RacePhase;
  /** Short, server-generated invite code for this lobby (e.g. "K7QF"). */
  code: string;
  /**
   * One number that lets every client build the identical world (docs/ARCHITECTURE.md §6).
   * The course (rings included) is generated client-side from this seed; the server keeps no
   * ring/map geometry of its own.
   */
  mapSeed: number;
  /** Epoch ms when the countdown ends and racing begins (0 outside countdown). */
  countdownEndsAt: number;
  /** Epoch ms when racing began (0 outside racing/finished); the base for elapsed times. */
  raceStartAt: number;
  /** Epoch ms the race auto-ends after the first finisher (first finish + grace); 0 until then. */
  finishWindowEndsAt: number;
  /** sessionId of the host (the only player allowed to start); "" if the room is empty. */
  hostId: string;
  players: Record<string, PlayerState>;
}
