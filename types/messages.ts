/**
 * The message contract between client and server, derived from the sequence diagram in
 * docs/ARCHITECTURE.md §5. Most state reaches clients via automatic Colyseus state sync
 * (phase, mapSeed, every player's pos/vel/quat + progress). These named messages cover the
 * explicit events on top of that sync. The course is built client-side from `mapSeed`, so no
 * ring geometry is ever sent.
 */
import type { Vec3, Quat, DuckVariant } from "./network";

/** Options a client sends when joining a room ("I want to join (my name, my duck)"). */
export interface JoinOptions {
  name: string;
  duckVariant: DuckVariant;
  /**
   * Invite code for the lobby. The host generates one when creating a room; joiners pass
   * the same code so matchmaking (filterBy "code") routes them to that exact room.
   */
  code?: string;
}

/** Messages sent from a client to the server. */
export const ClientMessage = {
  /** "Here is where my duck is now" — sent ~15-20 times/sec while racing. */
  UpdateState: "updateState",
  /** "I flew through ring N" — client-local ring detection, server validates + scores. */
  RingPassed: "ringPassed",
  /** Toggle this player's ready flag in the lobby. */
  SetReady: "setReady",
  /** Host asks to start the race (lobby -> countdown). */
  StartRace: "startRace",
  /** From the results screen: reset this same room back to the lobby for a rematch. */
  PlayAgain: "playAgain",
  /** Player quacked (stretch). */
  Quack: "quack",
} as const;
export type ClientMessage = (typeof ClientMessage)[keyof typeof ClientMessage];

/** Messages broadcast from the server to clients (in addition to state sync). */
export const ServerMessage = {
  /** "You collided with another player" — tells the affected client to spin out. */
  SpinOut: "spinOut",
  /** Relay a player's quack to everyone (stretch). */
  Quack: "quack",
} as const;
export type ServerMessage = (typeof ServerMessage)[keyof typeof ServerMessage];

/**
 * Payload of a ClientMessage.UpdateState message — the client's authoritative pose, plus
 * the small progress numbers folded into the same ~20Hz stream so we don't need separate
 * chatty messages. `ringsPassed`/`collisions` are display-only; `finished` is latched by the
 * server (the first true stamps finishTime; later updates can't un-finish). All three are
 * optional so legacy callers that only send pose still type-check.
 */
export interface UpdateStatePayload {
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  /** Rings the client has flown through so far (display only). */
  ringsPassed?: number;
  /** Tree/ring crashes the client has had so far (display only). */
  collisions?: number;
  /** True once the client has crossed the finish line (client-authoritative). */
  finished?: boolean;
}

/** Payload of a ClientMessage.RingPassed message. */
export interface RingPassedPayload {
  ringId: number;
  lap: number;
}

/** Payload of a ClientMessage.SetReady message. */
export interface SetReadyPayload {
  ready: boolean;
}

/** Payload of a ServerMessage.SpinOut message. */
export interface SpinOutPayload {
  playerId: string;
}

/** Payload of a quack message (either direction). */
export interface QuackPayload {
  playerId: string;
}
