import { Room, type Client } from "@colyseus/core";
import type { RacePhase } from "@shared/network";
import {
  MAX_PLAYERS,
  COUNTDOWN_MS,
  SERVER_TICK_HZ,
  FINISH_GRACE_MS,
  LOBBY_CODE_LENGTH,
} from "@shared/constants";
import {
  ClientMessage,
  type JoinOptions,
  type UpdateStatePayload,
  type SetReadyPayload,
} from "@shared/messages";
import { nextPhase, canTransition, type PhaseInputs } from "../logic/stateMachine";
import { computeLeaderboard, type LeaderboardInput } from "../logic/scoring";
import { RaceState, PlayerSchema } from "./schema";

/** Default hard race time limit, ms. Overridable per-room (tests use a short one). */
const DEFAULT_RACE_DURATION_MS = 5 * 60 * 1000;
/** Distance between adjacent spawn slots, world units. */
const SPAWN_SPACING = 5;

/** Unambiguous alphabet for invite codes (no 0/O/1/I/L to avoid mis-typing). */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Generate a short, human-friendly lobby code (e.g. "K7QF"). */
function generateLobbyCode(length: number = LOBBY_CODE_LENGTH): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Room creation options. The `*Ms` fields exist so tests can run fast. */
interface RaceRoomOptions {
  countdownMs?: number;
  raceDurationMs?: number;
  seed?: number;
  /** Invite code (the matchmaking filterBy key); host-generated, falls back if absent. */
  code?: string;
}

/**
 * The authoritative race room (docs/ARCHITECTURE.md §3, §5, §7). It owns the lobby, the phase
 * machine, and the race clock, and it relays each player's pose. It deliberately holds NO map
 * or ring geometry: the course is generated entirely on the client from `mapSeed`, and finish
 * detection + ring/crash counting happen client-side and arrive folded into the pose stream
 * (`UpdateStatePayload`). The server's only authority over a run is the shared clock — it
 * stamps `raceStartAt` and each player's `finishTime`, runs the finish-grace window, and ranks
 * by finish time. The pure phase logic lives in src/logic/stateMachine.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_PLAYERS;

  private hostId: string | undefined;
  private startRequested = false;
  private countdownMs = COUNTDOWN_MS;
  private raceDurationMs = DEFAULT_RACE_DURATION_MS;
  private raceDeadline = 0;
  /** Epoch ms the first player finished this race (0 if nobody has yet). */
  private firstFinishAt = 0;

  onCreate(options: RaceRoomOptions = {}): void {
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    this.raceDurationMs = options.raceDurationMs ?? DEFAULT_RACE_DURATION_MS;

    const state = new RaceState();
    state.phase = "lobby";
    // The host passes the invite code (also the matchmaking filterBy key). Fall back to a
    // server-generated one so a room always has a code even if created without options.
    state.code = options.code ?? generateLobbyCode();
    state.mapSeed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.setState(state);

    this.registerMessageHandlers();
    this.setSimulationInterval(() => this.tick(), 1000 / SERVER_TICK_HZ);
  }

  onJoin(client: Client, options: JoinOptions = {} as JoinOptions): void {
    if (this.hostId === undefined) {
      this.hostId = client.sessionId;
      this.state.hostId = client.sessionId;
    }

    const player = new PlayerSchema();
    player.id = client.sessionId;
    player.name = options.name ?? "Duck";
    player.duckVariant = options.duckVariant === "female" ? "female" : "male";
    // Spread spawns apart so the client's local duck starts at the matching slot.
    player.pos.set(this.state.players.size * SPAWN_SPACING, 10, 0);
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);

    if (client.sessionId === this.hostId) {
      const next = this.state.players.keys().next();
      this.hostId = next.done ? undefined : next.value;
      this.state.hostId = this.hostId ?? "";
    }
  }

  private registerMessageHandlers(): void {
    this.onMessage(ClientMessage.UpdateState, (client, msg: UpdateStatePayload) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.pos.set(msg.pos[0], msg.pos[1], msg.pos[2]);
      player.vel.set(msg.vel[0], msg.vel[1], msg.vel[2]);
      player.quat.set(msg.quat[0], msg.quat[1], msg.quat[2], msg.quat[3]);

      // Progress numbers ride along with the pose, but only count while racing.
      if (this.state.phase !== "racing") return;
      if (typeof msg.ringsPassed === "number") player.ringsPassed = msg.ringsPassed;
      if (typeof msg.collisions === "number") player.collisions = msg.collisions;

      // Finish is latched once: the first true stamps a server-clock finish time and (on the
      // very first finisher of the race) opens the finish-grace window. Later updates can't
      // un-finish a player.
      if (msg.finished && !player.finished) {
        player.finished = true;
        player.finishTime = Date.now();
        if (this.firstFinishAt === 0) {
          this.firstFinishAt = player.finishTime;
          this.state.finishWindowEndsAt = this.firstFinishAt + FINISH_GRACE_MS;
        }
      }
    });

    this.onMessage(ClientMessage.SetReady, (client, msg: SetReadyPayload) => {
      const player = this.state.players.get(client.sessionId);
      if (player) player.ready = !!msg.ready;
    });

    this.onMessage(ClientMessage.StartRace, (client) => {
      // Only the host can start, and only from the lobby.
      if (client.sessionId === this.hostId && this.state.phase === "lobby") {
        this.startRequested = true;
      }
    });

    this.onMessage(ClientMessage.PlayAgain, () => {
      // Rematch: any player may send it, but it only does anything once, from the
      // results screen. Resets THIS room (same players + code) back to the lobby.
      if (this.state.phase === "finished") {
        this.resetToLobby();
      }
    });
  }

  private tick(): void {
    const now = Date.now();
    const current = this.state.phase as RacePhase;

    const players = [...this.state.players.values()];
    const allFinished = players.length > 0 && players.every((p) => p.finished);

    const inputs: PhaseInputs = {
      now,
      playerCount: this.state.players.size,
      startRequested: this.startRequested,
      countdownEndsAt: this.state.countdownEndsAt,
      allFinished,
      raceDeadline: this.raceDeadline,
      finishWindowDeadline: this.firstFinishAt > 0 ? this.firstFinishAt + FINISH_GRACE_MS : 0,
    };

    const desired = nextPhase(current, inputs);
    if (desired !== current && canTransition(current, desired)) {
      this.enterPhase(desired, now);
    }

    if (this.state.phase === "racing" || this.state.phase === "finished") {
      this.updateRanks();
    }
  }

  private enterPhase(phase: RacePhase, now: number): void {
    if (phase === "countdown") {
      this.state.countdownEndsAt = now + this.countdownMs;
      this.startRequested = false;
      // No late joins once a race is underway.
      void this.lock();
    } else if (phase === "racing") {
      this.state.countdownEndsAt = 0;
      this.state.raceStartAt = now;
      this.raceDeadline = now + this.raceDurationMs;
      this.firstFinishAt = 0;
      this.state.finishWindowEndsAt = 0;
    }
    this.state.phase = phase;
  }

  /** Rematch: reset this room (keeping players, host, and code) back to the lobby. */
  private resetToLobby(): void {
    this.state.mapSeed = Math.floor(Math.random() * 0xffffffff);

    this.state.countdownEndsAt = 0;
    this.state.raceStartAt = 0;
    this.state.finishWindowEndsAt = 0;
    this.startRequested = false;
    this.firstFinishAt = 0;
    this.raceDeadline = 0;

    let slot = 0;
    this.state.players.forEach((player) => {
      player.pos.set(slot * SPAWN_SPACING, 10, 0);
      player.vel.set(0, 0, 0);
      player.quat.set(0, 0, 0, 1);
      player.ringsPassed = 0;
      player.rank = 0;
      player.finished = false;
      player.finishTime = 0;
      player.collisions = 0;
      player.ready = false;
      slot++;
    });

    this.state.phase = "lobby";
    // Re-open the lobby so latecomers with the code can still join.
    void this.unlock();
  }

  private updateRanks(): void {
    const entries: LeaderboardInput[] = [...this.state.players.values()].map((p) => ({
      id: p.id,
      ringsPassed: p.ringsPassed,
      finished: p.finished,
      finishTime: p.finishTime,
    }));

    for (const ranked of computeLeaderboard(entries)) {
      const player = this.state.players.get(ranked.id);
      if (player) player.rank = ranked.rank;
    }
  }
}
