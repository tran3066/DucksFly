import { Room, type Client } from "@colyseus/core";
import type { RacePhase } from "@shared/network";
import {
  MAX_PLAYERS,
  COUNTDOWN_MS,
  SERVER_TICK_HZ,
  COLLISION_RADIUS,
  FINISH_GRACE_MS,
  SPINOUT_RECOVERY_MS,
  LOBBY_CODE_LENGTH,
} from "@shared/constants";
import {
  ClientMessage,
  ServerMessage,
  type JoinOptions,
  type UpdateStatePayload,
  type RingPassedPayload,
  type SetReadyPayload,
  type SpinOutPayload,
} from "@shared/messages";
import { generateRingLayout, DEFAULT_RING_COUNT } from "../logic/mapSeed";
import { nextPhase, canTransition, type PhaseInputs } from "../logic/stateMachine";
import { detectCollisions, type CollisionBody } from "../logic/collisions";
import {
  initialProgress,
  applyRingPass,
  computeLeaderboard,
  type RingProgress,
  type LeaderboardInput,
} from "../logic/scoring";
import { RaceState, PlayerSchema, RingSchema } from "./schema";

/** Default hard race time limit, ms. Overridable per-room (tests use a short one). */
const DEFAULT_RACE_DURATION_MS = 5 * 60 * 1000;
/** Default laps required to finish. */
const DEFAULT_TOTAL_LAPS = 1;
/** Distance between adjacent spawn slots, world units (> COLLISION_RADIUS). */
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

/** Room creation options. The `*Ms`/count/laps fields exist so tests can run fast. */
interface RaceRoomOptions {
  countdownMs?: number;
  ringCount?: number;
  totalLaps?: number;
  raceDurationMs?: number;
  seed?: number;
  /** Invite code (the matchmaking filterBy key); host-generated, falls back if absent. */
  code?: string;
}

/**
 * The authoritative race room (docs/ARCHITECTURE.md §3, §5, §7). It owns the phase machine,
 * relays player positions, runs server-authoritative collision + ring scoring, and keeps the
 * leaderboard. All non-trivial decisions live in the pure modules under src/logic so they
 * stay unit-tested; this class is the thin Colyseus wiring around them.
 */
export class RaceRoom extends Room<{ state: RaceState }> {
  maxClients = MAX_PLAYERS;

  private readonly progress = new Map<string, RingProgress>();
  /** Per-player epoch ms until which a collided player stays spun out. */
  private readonly spinOutUntil = new Map<string, number>();
  private hostId: string | undefined;
  private startRequested = false;
  private countdownMs = COUNTDOWN_MS;
  private totalLaps = DEFAULT_TOTAL_LAPS;
  private ringsPerLap = DEFAULT_RING_COUNT;
  private raceDurationMs = DEFAULT_RACE_DURATION_MS;
  private raceDeadline = 0;
  /** Epoch ms the first player finished this race (0 if nobody has yet). */
  private firstFinishAt = 0;

  onCreate(options: RaceRoomOptions = {}): void {
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
    this.totalLaps = options.totalLaps ?? DEFAULT_TOTAL_LAPS;
    this.raceDurationMs = options.raceDurationMs ?? DEFAULT_RACE_DURATION_MS;
    this.ringsPerLap = options.ringCount ?? DEFAULT_RING_COUNT;

    const state = new RaceState();
    state.phase = "lobby";
    // The host passes the invite code (also the matchmaking filterBy key). Fall back to a
    // server-generated one so a room always has a code even if created without options.
    state.code = options.code ?? generateLobbyCode();
    state.mapSeed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    this.setState(state);
    this.buildRings(state.mapSeed);

    this.registerMessageHandlers();
    this.setSimulationInterval(() => this.tick(), 1000 / SERVER_TICK_HZ);
  }

  /** Regenerate the ring layout for a seed, replacing any existing rings. */
  private buildRings(seed: number): void {
    this.state.ringLayout.clear();
    for (const ring of generateRingLayout(seed, this.ringsPerLap)) {
      const r = new RingSchema();
      r.id = ring.id;
      r.pos.set(ring.pos[0], ring.pos[1], ring.pos[2]);
      r.quat.set(ring.quat[0], ring.quat[1], ring.quat[2], ring.quat[3]);
      r.radius = ring.radius;
      this.state.ringLayout.push(r);
    }
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
    // Spread spawns apart so players don't count as colliding before anyone moves.
    player.pos.set(this.state.players.size * SPAWN_SPACING, 10, 0);
    this.state.players.set(client.sessionId, player);
    this.progress.set(client.sessionId, initialProgress());
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.progress.delete(client.sessionId);
    this.spinOutUntil.delete(client.sessionId);

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

    this.onMessage(ClientMessage.RingPassed, (client, msg: RingPassedPayload) => {
      if (this.state.phase !== "racing") return;
      const player = this.state.players.get(client.sessionId);
      const prog = this.progress.get(client.sessionId);
      if (!player || !prog) return;

      const result = applyRingPass(prog, msg.ringId, Date.now(), {
        ringsPerLap: this.ringsPerLap,
        totalLaps: this.totalLaps,
      });
      if (!result.accepted) return;

      this.progress.set(client.sessionId, result.progress);
      player.ringsPassed = result.progress.ringsPassed;
      player.lap = result.progress.lap;
      player.finished = result.progress.finished;
      player.finishTime = result.progress.finishTime;
      // Start the finish-grace clock the moment the first player crosses the line.
      if (player.finished && this.firstFinishAt === 0) {
        this.firstFinishAt = result.progress.finishTime;
      }
      this.updateRanks();
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

    if (this.state.phase === "racing") {
      this.recoverSpinOuts(now);
      this.runCollisions(now);
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
      this.spinOutUntil.clear();
    }
    this.state.phase = phase;
  }

  /** Clear the spun-out flag once a collided player's recovery window has elapsed. */
  private recoverSpinOuts(now: number): void {
    for (const [id, until] of this.spinOutUntil) {
      if (now >= until) {
        const player = this.state.players.get(id);
        if (player) player.spunOut = false;
        this.spinOutUntil.delete(id);
      }
    }
  }

  private runCollisions(now: number): void {
    const bodies: CollisionBody[] = [...this.state.players.values()].map((p) => ({
      id: p.id,
      pos: [p.pos.x, p.pos.y, p.pos.z],
      spunOut: p.spunOut,
    }));

    for (const id of detectCollisions(bodies, COLLISION_RADIUS)) {
      const player = this.state.players.get(id);
      if (player && !player.spunOut) {
        player.spunOut = true;
        player.collisions += 1;
        this.spinOutUntil.set(id, now + SPINOUT_RECOVERY_MS);
        this.broadcast(ServerMessage.SpinOut, { playerId: id } satisfies SpinOutPayload);
      }
    }
  }

  /** Rematch: reset this room (keeping players, host, and code) back to the lobby. */
  private resetToLobby(): void {
    this.state.mapSeed = Math.floor(Math.random() * 0xffffffff);
    this.buildRings(this.state.mapSeed);

    this.state.countdownEndsAt = 0;
    this.state.raceStartAt = 0;
    this.startRequested = false;
    this.firstFinishAt = 0;
    this.raceDeadline = 0;
    this.spinOutUntil.clear();

    let slot = 0;
    this.state.players.forEach((player, id) => {
      player.pos.set(slot * SPAWN_SPACING, 10, 0);
      player.vel.set(0, 0, 0);
      player.quat.set(0, 0, 0, 1);
      player.ringsPassed = 0;
      player.lap = 0;
      player.rank = 0;
      player.spunOut = false;
      player.finished = false;
      player.finishTime = 0;
      player.collisions = 0;
      player.ready = false;
      this.progress.set(id, initialProgress());
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
      finishTime: this.progress.get(p.id)?.finishTime ?? 0,
    }));

    for (const ranked of computeLeaderboard(entries)) {
      const player = this.state.players.get(ranked.id);
      if (player) player.rank = ranked.rank;
    }
  }
}
