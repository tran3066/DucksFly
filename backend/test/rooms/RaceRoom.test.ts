import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { MAX_PLAYERS } from "@shared/constants";
import { ClientMessage, type JoinOptions } from "@shared/messages";
import { createGameServer } from "@/app";

/**
 * RaceRoom integration tests (docs/ARCHITECTURE.md §5). These boot a real Colyseus server in
 * memory, connect SDK clients, and assert the authoritative behaviour: joining/lobby, the
 * shared map seed, the 8-player cap, position relay, phase progression, and the client-fed
 * finish/progress model (rings, crashes, finish line ride along the pose stream; the server
 * stamps finish time, runs the grace window, and ranks).
 *
 * The room accepts test-only creation options so we don't have to wait real seconds:
 *   countdownMs    - countdown duration (default COUNTDOWN_MS)
 *   raceDurationMs - hard race time limit (default 5 min)
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
  it("adds a joining player to the lobby and shares a map seed", async () => {
    const room = await colyseus.createRoom("race");
    const client = await colyseus.connectTo(room, alice);
    await room.waitForNextPatch();

    expect(room.state.phase).toBe("lobby");
    expect(room.state.players.size).toBe(1);
    expect(room.state.mapSeed).toBeGreaterThan(0);

    // The client receives the same seed it rebuilds the whole world (rings included) from.
    await waitUntil(() => client.state.mapSeed === room.state.mapSeed);
    expect(client.state.mapSeed).toBe(room.state.mapSeed);
  });

  it("gives every client the identical seed", async () => {
    const room = await colyseus.createRoom("race");
    const c1 = await colyseus.connectTo(room, alice);
    const c2 = await colyseus.connectTo(room, bob);

    await waitUntil(
      () =>
        c1.state.mapSeed === room.state.mapSeed && c2.state.mapSeed === room.state.mapSeed,
    );
    expect(c1.state.mapSeed).toBe(c2.state.mapSeed);
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

describe("RaceRoom — invite code", () => {
  it("generates a short, unambiguous invite code in room state", async () => {
    const room = await colyseus.createRoom("race");
    await room.waitForNextPatch();
    expect(room.state.code).toMatch(/^[A-Z2-9]{4}$/);
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
    expect(room.state.raceStartAt).toBeGreaterThan(0);
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

/** Drive a room to the racing phase with two ready players. Returns the two clients. */
async function startRace(countdownMs = 40, raceDurationMs?: number) {
  const room = await colyseus.createRoom("race", { countdownMs, raceDurationMs });
  const c1 = await colyseus.connectTo(room, alice);
  const c2 = await colyseus.connectTo(room, bob);
  c1.send(ClientMessage.SetReady, { ready: true });
  c2.send(ClientMessage.SetReady, { ready: true });
  c1.send(ClientMessage.StartRace, {});
  await waitUntil(() => room.state.phase === "racing");
  return { room, c1, c2 };
}

describe("RaceRoom — client-fed progress + finish", () => {
  it("reflects reported rings and crashes for display", async () => {
    const { room, c1 } = await startRace();

    c1.send(ClientMessage.UpdateState, {
      pos: [0, 10, 50],
      vel: [0, 0, 0],
      quat: [0, 0, 0, 1],
      ringsPassed: 3,
      collisions: 2,
    });

    await waitUntil(() => room.state.players.get(c1.sessionId).ringsPassed === 3);
    expect(room.state.players.get(c1.sessionId).ringsPassed).toBe(3);
    expect(room.state.players.get(c1.sessionId).collisions).toBe(2);
  });

  it("latches finish on the first reported crossing and ranks the finisher first", async () => {
    const { room, c1, c2 } = await startRace();

    c1.send(ClientMessage.UpdateState, {
      pos: [0, 10, 2000],
      vel: [0, 0, 0],
      quat: [0, 0, 0, 1],
      ringsPassed: 6,
      finished: true,
    });

    await waitUntil(() => room.state.players.get(c1.sessionId).finished === true);
    const p1 = room.state.players.get(c1.sessionId);
    expect(p1.finishTime).toBeGreaterThan(0);
    expect(room.state.finishWindowEndsAt).toBeGreaterThan(0);

    await waitUntil(
      () =>
        room.state.players.get(c1.sessionId).rank === 1 &&
        room.state.players.get(c2.sessionId).rank === 2,
    );

    // A later non-finish update cannot un-finish the player.
    const stampedAt = p1.finishTime;
    c1.send(ClientMessage.UpdateState, {
      pos: [0, 10, 2001],
      vel: [0, 0, 0],
      quat: [0, 0, 0, 1],
      finished: false,
    });
    await sleep(80);
    expect(room.state.players.get(c1.sessionId).finished).toBe(true);
    expect(room.state.players.get(c1.sessionId).finishTime).toBe(stampedAt);
  });

  it("ends the race once every player has finished", async () => {
    const { room, c1, c2 } = await startRace();

    for (const c of [c1, c2]) {
      c.send(ClientMessage.UpdateState, {
        pos: [0, 10, 2000],
        vel: [0, 0, 0],
        quat: [0, 0, 0, 1],
        finished: true,
      });
    }

    await waitUntil(() => room.state.phase === "finished");
    expect(room.state.phase).toBe("finished");
  });

  it("ignores progress reported outside the racing phase", async () => {
    const room = await colyseus.createRoom("race", { countdownMs: 60 });
    const c1 = await colyseus.connectTo(room, alice);
    await colyseus.connectTo(room, bob);

    // Still in the lobby: a finish report must be ignored.
    c1.send(ClientMessage.UpdateState, {
      pos: [0, 0, 0],
      vel: [0, 0, 0],
      quat: [0, 0, 0, 1],
      ringsPassed: 4,
      finished: true,
    });
    await sleep(120);
    expect(room.state.players.get(c1.sessionId).finished).toBe(false);
    expect(room.state.players.get(c1.sessionId).ringsPassed).toBe(0);
  });
});

describe("RaceRoom — rematch (play again)", () => {
  it("resets the same room back to the lobby and clears per-player progress", async () => {
    const { room, c1, c2 } = await startRace(40, 80);

    c1.send(ClientMessage.UpdateState, {
      pos: [0, 10, 50],
      vel: [0, 0, 0],
      quat: [0, 0, 0, 1],
      ringsPassed: 2,
    });
    await waitUntil(() => room.state.players.get(c1.sessionId).ringsPassed === 2);

    // Race ends on the short duration backstop (nobody crossed the line).
    await waitUntil(() => room.state.phase === "finished");
    const codeBefore = room.state.code;
    const seedBefore = room.state.mapSeed;

    c2.send(ClientMessage.PlayAgain, {});
    await waitUntil(() => room.state.phase === "lobby");

    expect(room.state.players.size).toBe(2);
    expect(room.state.code).toBe(codeBefore); // same room/code preserved
    expect(room.state.raceStartAt).toBe(0);
    expect(room.state.countdownEndsAt).toBe(0);
    expect(room.state.finishWindowEndsAt).toBe(0);
    expect(room.state.mapSeed).not.toBe(seedBefore); // a fresh course is rolled

    const p1 = room.state.players.get(c1.sessionId);
    expect(p1.ringsPassed).toBe(0);
    expect(p1.finished).toBe(false);
    expect(p1.finishTime).toBe(0);
    expect(p1.collisions).toBe(0);
    expect(p1.ready).toBe(false);
    expect(p1.rank).toBe(0);
  });
});
