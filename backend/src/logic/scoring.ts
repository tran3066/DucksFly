/**
 * Ring/lap validation + leaderboard (server-authoritative scoring, docs/ARCHITECTURE.md §3).
 * All functions are pure and never mutate their inputs. Rings are passed in order
 * (0, 1, ..., ringsPerLap-1) each lap; completing the last ring increments the lap;
 * completing `totalLaps` finishes the player and stamps a finish time.
 */

/** One player's ring progress. */
export interface RingProgress {
  ringsPassed: number;
  /** Completed laps so far. */
  lap: number;
  finished: boolean;
  /** Epoch ms the player finished, or 0 if not finished. */
  finishTime: number;
}

/** Course configuration scoring is evaluated against. */
export interface ScoringConfig {
  ringsPerLap: number;
  totalLaps: number;
}

/** Result of attempting a ring pass: the (new) progress and whether it was accepted. */
export interface RingPassResult {
  progress: RingProgress;
  accepted: boolean;
}

/** A fresh, independent progress object. */
export function initialProgress(): RingProgress {
  return { ringsPassed: 0, lap: 0, finished: false, finishTime: 0 };
}

/**
 * Validate and apply a ring pass. Returns a new progress object (the input is never
 * mutated). A pass is rejected — leaving progress unchanged — if the player has already
 * finished or the ring is not the next expected one in sequence.
 */
export function applyRingPass(
  progress: RingProgress,
  ringId: number,
  now: number,
  config: ScoringConfig,
): RingPassResult {
  if (progress.finished) {
    return { progress: { ...progress }, accepted: false };
  }

  const expectedRing = progress.ringsPassed % config.ringsPerLap;
  if (ringId !== expectedRing) {
    return { progress: { ...progress }, accepted: false };
  }

  const ringsPassed = progress.ringsPassed + 1;
  let lap = progress.lap;
  let finished: boolean = progress.finished;
  let finishTime = progress.finishTime;

  if (ringsPassed % config.ringsPerLap === 0) {
    lap += 1;
    if (lap >= config.totalLaps) {
      finished = true;
      finishTime = now;
    }
  }

  return { progress: { ringsPassed, lap, finished, finishTime }, accepted: true };
}

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
