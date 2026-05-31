/**
 * Leaderboard ranking (docs/ARCHITECTURE.md §3). Pure and side-effect-free.
 *
 * Ring passing, lap counting, and finish detection all happen client-side now and arrive
 * folded into the pose stream — the server keeps no course geometry. All this module does is
 * order players for the leaderboard: finishers first (by finish time), then everyone else by
 * how far they got (rings passed). `ringsPassed`/`finishTime` are server-stored, client-fed.
 */

/** One player's standing, before ranking. */
export interface LeaderboardInput {
  id: string;
  ringsPassed: number;
  finished: boolean;
  finishTime: number;
}

/** A ranked standing (1 = first). */
export interface RankedEntry extends LeaderboardInput {
  rank: number;
}

/**
 * Rank players: finished players first (by finish time ascending), then unfinished players
 * by progress (rings passed) descending; ties broken deterministically by id. Does not
 * mutate the input array.
 */
export function computeLeaderboard(entries: LeaderboardInput[]): RankedEntry[] {
  return [...entries]
    .sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) {
        if (a.finishTime !== b.finishTime) return a.finishTime - b.finishTime;
      } else if (a.ringsPassed !== b.ringsPassed) {
        return b.ringsPassed - a.ringsPassed;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
