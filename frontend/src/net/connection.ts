import { Client, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  ServerMessage,
  type JoinOptions,
  type UpdateStatePayload,
  type SpinOutPayload,
} from "@shared/messages";
import type { PlayerView, RaceSnapshot } from "./types";

/**
 * Networking layer for Person C / the game to build on. `RaceConnection` owns the single
 * Colyseus room connection and publishes a plain, immutable `RaceSnapshot` that React reads
 * via `useRace()` (useSyncExternalStore). Gameplay sends (position, ring passes) and the
 * spin-out event are exposed as direct methods/callbacks so the render loop never has to
 * touch the SDK directly.
 *
 * The server URL comes from VITE_SERVER_URL so you can point at localhost, a LAN IP, or a
 * deployed host without code changes (see backend/HowToRun.md).
 */

const DEFAULT_SERVER_URL = "ws://localhost:2567";

export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? DEFAULT_SERVER_URL;

const INITIAL_SNAPSHOT: RaceSnapshot = {
  status: "idle",
  phase: "lobby",
  mapSeed: 0,
  ringCount: 0,
  countdownEndsAt: 0,
  hostId: "",
  players: [],
};

type Listener = () => void;
type SpinOutHandler = (playerId: string) => void;

function toPlayerView(p: any): PlayerView {
  return {
    id: p.id,
    name: p.name,
    duckVariant: p.duckVariant,
    pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
    quat: { x: p.quat.x, y: p.quat.y, z: p.quat.z, w: p.quat.w },
    ringsPassed: p.ringsPassed,
    lap: p.lap,
    rank: p.rank,
    spunOut: p.spunOut,
    finished: p.finished,
    ready: p.ready,
  };
}

class RaceConnection {
  private client?: Client;
  private room?: Room;
  private snapshot: RaceSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private readonly spinOutHandlers = new Set<SpinOutHandler>();

  /** useSyncExternalStore wiring. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RaceSnapshot => this.snapshot;

  /** Subscribe to spin-out events (for triggering the local spin animation). */
  onSpinOut(handler: SpinOutHandler): () => void {
    this.spinOutHandlers.add(handler);
    return () => {
      this.spinOutHandlers.delete(handler);
    };
  }

  private update(patch: Partial<RaceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  async join(options: JoinOptions, url: string = SERVER_URL): Promise<void> {
    if (this.snapshot.status === "connecting") return;
    this.update({ status: "connecting", error: undefined });

    try {
      this.client = new Client(url);
      const room = await this.client.joinOrCreate("race", options);
      this.room = room;
      this.update({ status: "connected", sessionId: room.sessionId });

      room.onStateChange((state: any) => this.syncFromState(state));
      room.onMessage(ServerMessage.SpinOut, (payload: SpinOutPayload) => {
        for (const handler of this.spinOutHandlers) handler(payload.playerId);
      });
      room.onError((code, message) => {
        this.update({ status: "error", error: message ?? `connection error ${code}` });
      });
      room.onLeave(() => {
        this.update({ ...INITIAL_SNAPSHOT });
      });
    } catch (err) {
      this.update({ status: "error", error: (err as Error).message });
    }
  }

  private syncFromState(state: any): void {
    const players: PlayerView[] = [];
    state.players.forEach((p: any) => players.push(toPlayerView(p)));
    this.update({
      phase: state.phase,
      mapSeed: state.mapSeed,
      ringCount: state.ringLayout.length,
      countdownEndsAt: state.countdownEndsAt,
      hostId: state.hostId,
      players,
    });
  }

  setReady(ready: boolean): void {
    this.room?.send(ClientMessage.SetReady, { ready });
  }

  startRace(): void {
    this.room?.send(ClientMessage.StartRace, {});
  }

  /** Sent by the game loop ~15-20x/sec while racing. */
  sendState(payload: UpdateStatePayload): void {
    this.room?.send(ClientMessage.UpdateState, payload);
  }

  /** Reported by the client when it detects flying through a ring. */
  ringPassed(ringId: number, lap: number): void {
    this.room?.send(ClientMessage.RingPassed, { ringId, lap });
  }

  leave(): void {
    void this.room?.leave();
    this.room = undefined;
  }
}

/** App-wide singleton: one player, one room connection. */
export const raceConnection = new RaceConnection();
