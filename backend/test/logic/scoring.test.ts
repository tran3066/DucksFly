import { describe, it, expect } from "vitest";
import { computeLeaderboard, type LeaderboardInput } from "@/logic/scoring";

/**
 * Leaderboard ranking (docs/ARCHITECTURE.md §3). Ring/finish detection is client-side now;
 * the server only orders players: finishers first (by finish time ascending), then everyone
 * else by forward progress (proximity to the finish line) descending, ties broken
 * deterministically by id.
 */

describe("computeLeaderboard", () => {
  it("ranks finished players ahead of unfinished, by finish time ascending", () => {
    const entries: LeaderboardInput[] = [
      { id: "slow", progress: 2_000, finished: true, finishTime: 2_000 },
      { id: "fast", progress: 2_000, finished: true, finishTime: 1_000 },
    ];
    const ranked = computeLeaderboard(entries);
    expect(ranked.map((e) => e.id)).toEqual(["fast", "slow"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2]);
  });

  it("ranks unfinished players behind finished ones, by progress descending", () => {
    const entries: LeaderboardInput[] = [
      { id: "behind", progress: 200, finished: false, finishTime: 0 },
      { id: "ahead", progress: 800, finished: false, finishTime: 0 },
      { id: "done", progress: 2_000, finished: true, finishTime: 1_000 },
    ];
    const ranked = computeLeaderboard(entries);
    expect(ranked.map((e) => e.id)).toEqual(["done", "ahead", "behind"]);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("breaks ties deterministically by id", () => {
    const entries: LeaderboardInput[] = [
      { id: "b", progress: 300, finished: false, finishTime: 0 },
      { id: "a", progress: 300, finished: false, finishTime: 0 },
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
      { id: "solo", progress: 100, finished: false, finishTime: 0 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rank).toBe(1);
  });

  it("breaks a finish-time tie between two finished players by id", () => {
    const entries: LeaderboardInput[] = [
      { id: "zoe", progress: 2_000, finished: true, finishTime: 5_000 },
      { id: "amy", progress: 2_000, finished: true, finishTime: 5_000 },
    ];
    expect(computeLeaderboard(entries).map((e) => e.id)).toEqual(["amy", "zoe"]);
  });

  it("keeps a finished player ahead of an unfinished one that is further along", () => {
    const entries: LeaderboardInput[] = [
      { id: "stuck", progress: 1_999, finished: false, finishTime: 0 },
      { id: "done", progress: 1_000, finished: true, finishTime: 9_000 },
    ];
    expect(computeLeaderboard(entries).map((e) => e.id)).toEqual(["done", "stuck"]);
  });

  it("assigns a complete, gap-free 1..n ranking for a full lobby", () => {
    const entries: LeaderboardInput[] = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      progress: i * 100,
      finished: false,
      finishTime: 0,
    }));
    const ranks = computeLeaderboard(entries).map((e) => e.rank);
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not mutate the input array", () => {
    const entries: LeaderboardInput[] = [
      { id: "b", progress: 100, finished: false, finishTime: 0 },
      { id: "a", progress: 200, finished: false, finishTime: 0 },
    ];
    const before = entries.map((e) => e.id);
    computeLeaderboard(entries);
    expect(entries.map((e) => e.id)).toEqual(before);
  });
});
