import { Client, type Room } from "@colyseus/sdk";
import {
  ClientMessage,
  ServerMessage,
  type JoinOptions,
  type UpdateStatePayload,
  type SpinOutPayload,
} from "@shared/messages";
import type { PlayerView, RaceSnapshot } from "./types";
import { getServerUrl } from "./serverConfig";
import { generateLobbyCode } from "./lobbyCode";

/**
 * Networking layer for Person C / the game to build on. `RaceConnection` owns the single
 * Colyseus room connection and publishes a plain, immutable `RaceSnapshot` that React reads
 * via `useRace()` (useSyncExternalStore). Gameplay sends (position, ring passes) and the
 * spin-out event are exposed as direct methods/callbacks so the render loop never has to
 * touch the SDK directly.
 *
 * The server URL is chosen at runtime (query param / picker / localStorage), falling back to
 * VITE_SERVER_URL — see net/serverConfig.ts. Use `getServerUrl()` to read the current value.
 */

const INITIAL_SNAPSHOT: RaceSnapshot = {
  status: "idle",
  phase: "lobby",
  code: "",
  mapSeed: 0,
  ringCount: 0,
  countdownEndsAt: 0,
  raceStartAt: 0,
  finishWindowEndsAt: 0,
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
    ringsPassed: p.ringsPassed ?? 0,
    // `lap`/`spunOut` are gone from the server schema (single-pass course, no bird-vs-bird
    // collisions). Defaulted here only so the legacy `?view=race|multiplayer` harnesses,
    // which still read them, keep type-checking.
    lap: p.lap ?? 0,
    rank: p.rank ?? 0,
    spunOut: p.spunOut ?? false,
    finished: p.finished ?? false,
    ready: p.ready ?? false,
    collisions: p.collisions ?? 0,
    finishTime: p.finishTime ?? 0,
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

  /**
   * Legacy entry (kept for the old `?view=multiplayer` test routes): joins any open room or
   * creates one. The real game uses `host()` / `joinByCode()` for private invite lobbies.
   */
  async join(options: JoinOptions, url: string = getServerUrl()): Promise<void> {
    await this.connect(url, (client) => client.joinOrCreate("race", options));
  }

  /** Host a new private lobby: create a room with a fresh invite code. */
  async host(options: JoinOptions, url: string = getServerUrl()): Promise<void> {
    const code = generateLobbyCode();
    await this.connect(url, (client) => client.create("race", { ...options, code }));
  }

  /**
   * Join an existing lobby by its invite code. Throws (surfaced as a friendly error) when no
   * open room with that code exists, e.g. wrong code or the race already started.
   */
  async joinByCode(code: string, options: JoinOptions, url: string = getServerUrl()): Promise<void> {
    await this.connect(
      url,
      (client) => client.join("race", { ...options, code }),
      "No lobby found for that code — check it and try again.",
    );
  }

  /** Shared connect path: open the client, run the matchmaking call, wire the room. */
  private async connect(
    url: string,
    matchmake: (client: Client) => Promise<Room>,
    notFoundMessage?: string,
  ): Promise<void> {
    if (this.snapshot.status === "connecting") return;
    this.update({ status: "connecting", error: undefined });

    try {
      this.client = new Client(url);
      const room = await matchmake(this.client);
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
      const message = notFoundMessage ?? (err as Error).message;
      this.update({ status: "error", error: message });
    }
  }

  private syncFromState(state: any): void {
    const players: PlayerView[] = [];
    state.players.forEach((p: any) => players.push(toPlayerView(p)));
    this.update({
      phase: state.phase,
      code: state.code ?? "",
      mapSeed: state.mapSeed,
      // The server no longer holds ring geometry; clients derive the ring count from the
      // seed-built course locally (see MultiplayerGame). Kept on the snapshot at 0 only for
      // the legacy harnesses that still read it.
      ringCount: 0,
      countdownEndsAt: state.countdownEndsAt,
      raceStartAt: state.raceStartAt ?? 0,
      finishWindowEndsAt: state.finishWindowEndsAt ?? 0,
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

  /** From the results screen: ask the server to reset this room for a rematch. */
  playAgain(): void {
    this.room?.send(ClientMessage.PlayAgain, {});
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
