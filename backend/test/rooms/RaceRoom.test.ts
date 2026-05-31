import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { MAX_PLAYERS } from "@shared/constants";
import { ClientMessage, ServerMessage, type JoinOptions } from "@shared/messages";
import { createGameServer } from "@/app";

/**
 * RaceRoom integration tests (docs/ARCHITECTURE.md §5). These boot a real Colyseus server
 * in memory, connect SDK clients, and assert the authoritative behaviour: joining/lobby,
 * deterministic map seed, the 8-player cap, position relay, phase progression, spin-out on
 * collision, and ring scoring + leaderboard.
 *
 * The room accepts test-only creation options so we don't have to wait real seconds:
 *   countdownMs  - countdown duration (default COUNTDOWN_MS)
 *   ringCount    - number of rings on the course (default DEFAULT_RING_COUNT)
 *   totalLaps    - laps required to finish (default gameplay value)
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll a condition until it is true or we time out. Robust to patch timing and to the brief
 * window after connect where client-side collections aren't decoded yet (a throwing check is
 * treated as "not yet"). Preferred over waitForNextPatch, which hangs when state is static.
 */
async function waitUntil(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    let ok = false;
    try {
      ok = check();
    } catch {
      ok = false;
    }
    if (ok) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await sleep(15);
  }
}

const alice: JoinOptions = { name: "Alice", duckVariant: "male" };
const bob: JoinOptions = { name: "Bob", duckVariant: "female" };

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createGameServer());
});

afterAll(async () => {
  await colyseus.shutdown();
});

beforeEach(async () => {
  await colyseus.cleanup();
});

describe("RaceRoom — joining and the lobby", () => {
  it("adds a joining player to the lobby and generates a map", async () => {
    const room = await colyseus.createRoom("race");
    const client = await colyseus.connectTo(room, alice);
    await room.waitForNextPatch();

    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.size).toBe(1);
    expect(room.state.ringLayout.length).toBeGreaterThan(0);

    // The client receives the same seed + ring layout it can rebuild the world from.
    await waitUntil(
      () =>
        client.state.mapSeed === room.state.mapSeed &&
        client.state.ringLayout.length === room.state.ringLayout.length,
    );
    expect(client.state.mapSeed).toBe(room.state.mapSeed);
    expect(client.state.ringLayout.length).toBe(room.state.ringLayout.length);
  });

  it("gives every client the identical seed and ring layout", async () => {
    const room = await colyseus.createRoom("race");
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);

    await waitUntil(
      () =>
        c1.state.mapSeed === room.state.mapSeed && c2.state.mapSeed === room.state.mapSeed,
    );
    expect(c1.state.mapSeed).toBe(c2.state.mapSeed);
    expect(c1.state.ringLayout.length).toBe(c2.state.ringLayout.length);
  });

  it("accepts up to MAX_PLAYERS and rejects the next one", async () => {
    const room = await colyseus.createRoom("race");
    for (let i = 0; i < MAX_PLAYERS; i++) {
      await colyseus.connectTo(room, { name: `P${i}`, duckVariant: "male" });
    }
    await room.waitForNextPatch();
    expect(room.state.players.size).toBe(MAX_PLAYERS);

    await expect(
      colyseus.connectTo(room, { name: "late", duckVariant: "male" }),
    ).rejects.toBeDefined();
  });
});

describe("RaceRoom — position relay", () => {
  it("reflects one client's position update into the shared state others see", async () => {
    const room = await colyseus.createRoom("race");
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);

    c1.send(ClientMessage.UpdateState, {
      pos: [1, 2, 3],
      vel: [4, 5, 6],
      quat: [0, 0, 0, 1],
    });

    await waitUntil(() => {
      const p = c2.state.players.get(c1.sessionId);
      return !!p && p.pos.x === 1 && p.pos.y === 2 && p.pos.z === 3;
    });

    const p = c2.state.players.get(c1.sessionId);
    expect([p.pos.x, p.pos.y, p.pos.z]).toEqual([1, 2, 3]);
    expect([p.vel.x, p.vel.y, p.vel.z]).toEqual([4, 5, 6]);
  });
});

describe("RaceRoom — phase progression", () => {
  it("advances lobby -> countdown -> racing when the host starts with enough players", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 60 });
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);

    c1.send(ClientMessage.SetReady, { ready: true });
    c2.send(ClientMessage.SetReady, { ready: true });
    c1.send(ClientMessage.StartRace, {});

    await waitUntil(() => room.state.phase === "countdown");
    expect(room.state.phase).toBe("countdown");
    expect(room.state.countdownEndsAt).toBeGreaterThan(0);

    await waitUntil(() => room.state.phase === "racing");
    expect(room.state.phase).toBe("racing");
  });

  it("does not start with only one player even if start is requested", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 60 });
    const c1 = await colyseus.connectTo(room, alice);

    c1.send(ClientMessage.SetReady, { ready: true });
    c1.send(ClientMessage.StartRace, {});

    await sleep(150);
    expect(room.state.phase).toBe("lobby");
  });
});

describe("RaceRoom — collisions", () => {
  it("spins out players that overlap while racing", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 40 });
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);

    c1.send(ClientMessage.SetReady, { ready: true });
    c2.send(ClientMessage.SetReady, { ready: true });
    c1.send(ClientMessage.StartRace, {});
    await waitUntil(() => room.state.phase === "racing");

    const spinOut = c1.waitForMessage(ServerMessage.SpinOut, 2000);

    c1.send(ClientMessage.UpdateState, { pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1] });
    c2.send(ClientMessage.UpdateState, { pos: [0, 0, 0], vel: [0, 0, 0], quat: [0, 0, 0, 1] });

    const payload = await spinOut;
    expect([c1.sessionId, c2.sessionId]).toContain(payload.playerId);

    await waitUntil(
      () =>
        room.state.players.get(c1.sessionId).spunOut === true &&
        room.state.players.get(c2.sessionId).spunOut === true,
    );
  });
});

describe("RaceRoom — scoring and leaderboard", () => {
  it("validates ring passes in order and rejects out-of-order ones", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 40, ringCount: 3, totalLaps: 1 });
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);
    c1.send(ClientMessage.SetReady, { ready: true });
    c2.send(ClientMessage.SetReady, { ready: true });
    c1.send(ClientMessage.StartRace, {});
    await waitUntil(() => room.state.phase === "racing");

    // Out-of-order pass is ignored.
    c1.send(ClientMessage.RingPassed, { ringId: 2, lap: 0 });
    await sleep(100);
    expect(room.state.players.get(c1.sessionId).ringsPassed).toBe(0);

    // In-order pass is counted.
    c1.send(ClientMessage.RingPassed, { ringId: 0, lap: 0 });
    await waitUntil(() => room.state.players.get(c1.sessionId).ringsPassed === 1);
    expect(room.state.players.get(c1.sessionId).ringsPassed).toBe(1);
  });

  it("finishes a player who passes every ring and ranks them ahead of the rest", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 40, ringCount: 3, totalLaps: 1 });
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);
    c1.send(ClientMessage.SetReady, { ready: true });
    c2.send(ClientMessage.SetReady, { ready: true });
    c1.send(ClientMessage.StartRace, {});
    await waitUntil(() => room.state.phase === "racing");

    for (const ringId of [0, 1, 2]) {
      c1.send(ClientMessage.RingPassed, { ringId, lap: 0 });
      await waitUntil(() => room.state.players.get(c1.sessionId).ringsPassed === ringId + 1);
    }

    await waitUntil(() => room.state.players.get(c1.sessionId).finished === true);
    expect(room.state.players.get(c1.sessionId).rank).toBe(1);
    expect(room.state.players.get(c2.sessionId).rank).toBe(2);
  });
});
