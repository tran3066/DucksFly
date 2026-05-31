import { describe, it, expect } from "vitest";
import { computeLeaderboard, type LeaderboardInput } from "@/logic/scoring";

/**
 * Leaderboard ranking (docs/ARCHITECTURE.md §3). Ring/finish detection is client-side now;
 * the server only orders players: finishers first (by finish time ascending), then everyone
 * else by rings passed descending, ties broken deterministically by id.
 */

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
