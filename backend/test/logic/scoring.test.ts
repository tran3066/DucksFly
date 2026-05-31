import { describe, it, expect } from "vitest";
import {
  initialProgress,
  applyRingPass,
  computeLeaderboard,
  type RingProgress,
  type ScoringConfig,
  type LeaderboardInput,
} from "@/logic/scoring";

/**
 * Ring/lap validation + leaderboard (server-authoritative scoring, docs/ARCHITECTURE.md §3).
 * Rings must be passed in order (0, 1, ..., ringsPerLap-1) each lap; an out-of-order pass is
 * rejected. Completing the last ring of a lap increments the lap; completing `totalLaps`
 * finishes the player and stamps a finish time.
 */

const config: ScoringConfig = { ringsPerLap: 3, totalLaps: 2 };

describe("applyRingPass", () => {
  it("accepts the next expected ring and increments ringsPassed", () => {
    const start = initialProgress();
    const { progress, accepted } = applyRingPass(start, 0, 1_000, config);
    expect(accepted).toBe(true);
    expect(progress.ringsPassed).toBe(1);
    expect(progress.lap).toBe(0);
    expect(progress.finished).toBe(false);
  });

  it("rejects an out-of-order ring and leaves progress unchanged", () => {
    const start = initialProgress();
    const { progress, accepted } = applyRingPass(start, 2, 1_000, config);
    expect(accepted).toBe(false);
    expect(progress).toEqual(start);
  });

  it("increments the lap after the last ring of a lap is passed", () => {
    let p: RingProgress = initialProgress();
    p = applyRingPass(p, 0, 1_000, config).progress;
    p = applyRingPass(p, 1, 1_100, config).progress;
    p = applyRingPass(p, 2, 1_200, config).progress;
    expect(p.ringsPassed).toBe(3);
    expect(p.lap).toBe(1);
    expect(p.finished).toBe(false);
  });

  it("expects ring 0 again at the start of the next lap", () => {
    let p: RingProgress = initialProgress();
    for (const ring of [0, 1, 2]) p = applyRingPass(p, ring, 1_000, config).progress;
    // wrong ring for the new lap is rejected
    expect(applyRingPass(p, 2, 1_300, config).accepted).toBe(false);
    // ring 0 is accepted
    const next = applyRingPass(p, 0, 1_300, config);
    expect(next.accepted).toBe(true);
    expect(next.progress.ringsPassed).toBe(4);
  });

  it("finishes the player after completing all laps and stamps the finish time", () => {
    let p: RingProgress = initialProgress();
    const passes: Array<[number, number]> = [
      [0, 1_000], [1, 1_100], [2, 1_200], // lap 1
      [0, 1_300], [1, 1_400], [2, 1_500], // lap 2 -> finish
    ];
    for (const [ring, now] of passes) p = applyRingPass(p, ring, now, config).progress;
    expect(p.lap).toBe(2);
    expect(p.finished).toBe(true);
    expect(p.finishTime).toBe(1_500);
  });

  it("rejects any ring pass after the player has finished", () => {
    let p: RingProgress = initialProgress();
    for (const [ring, now] of [[0, 1], [1, 2], [2, 3], [0, 4], [1, 5], [2, 6]] as const) {
      p = applyRingPass(p, ring, now, config).progress;
    }
    expect(p.finished).toBe(true);
    const after = applyRingPass(p, 0, 7, config);
    expect(after.accepted).toBe(false);
    expect(after.progress.finishTime).toBe(6);
  });
});

describe("applyRingPass — edge cases", () => {
  it("does not mutate the progress object passed in (pure function)", () => {
    const start = initialProgress();
    const snapshot = { ...start };
    applyRingPass(start, 0, 1_000, config);
    expect(start).toEqual(snapshot);
  });

  it("rejects a ring id beyond the rings-per-lap range", () => {
    const start = initialProgress();
    const res = applyRingPass(start, 5, 1_000, config); // valid ids are 0..2
    expect(res.accepted).toBe(false);
    expect(res.progress).toEqual(start);
  });

  it("rejects a negative ring id", () => {
    const start = initialProgress();
    expect(applyRingPass(start, -1, 1_000, config).accepted).toBe(false);
  });

  it("handles a single-ring-per-lap course", () => {
    const oneRing: ScoringConfig = { ringsPerLap: 1, totalLaps: 2 };
    let p: RingProgress = initialProgress();
    p = applyRingPass(p, 0, 100, oneRing).progress; // lap 1 complete
    expect(p.lap).toBe(1);
    expect(p.finished).toBe(false);
    p = applyRingPass(p, 0, 200, oneRing).progress; // lap 2 complete -> finish
    expect(p.lap).toBe(2);
    expect(p.finished).toBe(true);
    expect(p.finishTime).toBe(200);
  });

  it("finishes after a single lap when totalLaps is 1", () => {
    const oneLap: ScoringConfig = { ringsPerLap: 2, totalLaps: 1 };
    let p: RingProgress = initialProgress();
    p = applyRingPass(p, 0, 10, oneLap).progress;
    expect(p.finished).toBe(false);
    p = applyRingPass(p, 1, 20, oneLap).progress;
    expect(p.finished).toBe(true);
    expect(p.finishTime).toBe(20);
  });

  it("returns fresh, independent progress objects from initialProgress", () => {
    const a = initialProgress();
    const b = initialProgress();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("computeLeaderboard", () => {
  it("ranks finished players ahead of unfinished, by finish time ascending", () => {
    const entries: LeaderboardInput[] = [
      { id: "slow", ringsPassed: 6, finished: true, finishTime: 2_000 },
      { id: "fast", ringsPassed: 6, finished: true, finishTime: 1_000 },
    ];
    const ranked = computeLeaderboard(entries);
    expect(ranked.map((e) => e.id)).toEqual(["fast", "slow"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2]);
  });

  it("ranks unfinished players behind finished ones, by progress descending", () => {
    const entries: LeaderboardInput[] = [
      { id: "behind", ringsPassed: 2, finished: false, finishTime: 0 },
      { id: "ahead", ringsPassed: 5, finished: false, finishTime: 0 },
      { id: "done", ringsPassed: 6, finished: true, finishTime: 1_000 },
    ];
    const ranked = computeLeaderboard(entries);
    expect(ranked.map((e) => e.id)).toEqual(["done", "ahead", "behind"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties deterministically by id", () => {
    const entries: LeaderboardInput[] = [
      { id: "b", ringsPassed: 3, finished: false, finishTime: 0 },
      { id: "a", ringsPassed: 3, finished: false, finishTime: 0 },
    ];
    const ranked = computeLeaderboard(entries);
    expect(ranked.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("computeLeaderboard — edge cases", () => {
  it("returns an empty array for no players", () => {
    expect(computeLeaderboard([])).toEqual([]);
  });

  it("ranks a single player first", () => {
    const ranked = computeLeaderboard([
      { id: "solo", ringsPassed: 1, finished: false, finishTime: 0 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rank).toBe(1);
  });

  it("breaks a finish-time tie between two finished players by id", () => {
    const entries: LeaderboardInput[] = [
      { id: "zoe", ringsPassed: 6, finished: true, finishTime: 5_000 },
      { id: "amy", ringsPassed: 6, finished: true, finishTime: 5_000 },
    ];
    expect(computeLeaderboard(entries).map((e) => e.id)).toEqual(["amy", "zoe"]);
  });

  it("keeps a finished player ahead of an unfinished one with equal ring count", () => {
    const entries: LeaderboardInput[] = [
      { id: "stuck", ringsPassed: 6, finished: false, finishTime: 0 },
      { id: "done", ringsPassed: 6, finished: true, finishTime: 9_000 },
    ];
    expect(computeLeaderboard(entries).map((e) => e.id)).toEqual(["done", "stuck"]);
  });

  it("assigns a complete, gap-free 1..n ranking for a full lobby", () => {
    const entries: LeaderboardInput[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      ringsPassed: i,
      finished: false,
      finishTime: 0,
    }));
    const ranks = computeLeaderboard(entries).map((e) => e.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not mutate the input array", () => {
    const entries: LeaderboardInput[] = [
      { id: "b", ringsPassed: 1, finished: false, finishTime: 0 },
      { id: "a", ringsPassed: 2, finished: false, finishTime: 0 },
    ];
    const before = entries.map((e) => e.id);
    computeLeaderboard(entries);
    expect(entries.map((e) => e.id)).toEqual(before);
  });
});
