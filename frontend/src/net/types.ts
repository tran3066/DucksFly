import type { RacePhase, DuckVariant, Vec3, Quat } from "@shared/network";

/**
 * Client-side typed views of the synced room state. The Colyseus SDK decodes the server's
 * @colyseus/schema into runtime objects; these interfaces describe their shape for the UI.
 * Vectors arrive as { x, y, z } / { x, y, z, w } objects (the server's Schema form).
 */

export interface Vec3View {
  x: number;
  y: number;
  z: number;
}

export interface QuatView {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A plain snapshot of one player, copied out of the synced state for rendering. */
export interface PlayerView {
  id: string;
  name: string;
  duckVariant: DuckVariant;
  pos: Vec3View;
  vel: Vec3View;
  quat: QuatView;
  ringsPassed: number;
  lap: number;
  rank: number;
  spunOut: boolean;
  finished: boolean;
  ready: boolean;
  /** Player-vs-player collisions this race (display only — never affects rank). */
  collisions: number;
  /** Epoch ms the player finished, or 0 if not finished. */
  finishTime: number;
}

/** Connection lifecycle for the UI to branch on. */
export type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

/** The full reactive snapshot the React layer subscribes to. */
export interface RaceSnapshot {
  status: ConnectionStatus;
  error?: string;
  /** Our own session id once connected. */
  sessionId?: string;
  phase: RacePhase;
  /** Invite code for the current lobby (shareable), "" before connecting. */
  code: string;
  mapSeed: number;
  /** Number of rings on the course (one lap = this many rings, in order). */
  ringCount: number;
  countdownEndsAt: number;
  /** Epoch ms racing began (0 outside racing/finished); base for elapsed times. */
  raceStartAt: number;
  hostId: string;
  players: PlayerView[];
}

/** Convenience tuple converters for code that prefers the @shared array contracts. */
export const vecToTuple = (v: Vec3View): Vec3 => [v.x, v.y, v.z];
export const quatToTuple = (q: QuatView): Quat => [q.x, q.y, q.z, q.w];
