import type { RacePhase } from "@shared/network";

/**
 * The race phase machine (docs/ARCHITECTURE.md §7). Pure, side-effect-free helpers the
 * RaceRoom drives each tick:
 *   lobby --(host starts, enough players)--> countdown
 *   countdown --(countdown timer reaches zero)--> racing
 *   racing --(all finished OR time limit)--> finished
 *   finished --(play again, handled by an explicit reset)--> lobby
 */

/** Minimum connected players required before the host can start a race. */
export const MIN_PLAYERS_TO_START = 2;

/** A snapshot of everything `nextPhase` needs to decide the current phase. */
export interface PhaseInputs {
  /** Current time, epoch ms. */
  now: number;
  /** Number of connected players. */
  playerCount: number;
  /** Has the host asked to start (only meaningful in the lobby). */
  startRequested: boolean;
  /** Epoch ms when the countdown ends; must be > 0 to advance to racing. */
  countdownEndsAt: number;
  /** Have all racing players finished. */
  allFinished: boolean;
  /** Epoch ms hard time limit for the race; 0 means no limit. */
  raceDeadline: number;
}

/**
 * Pure transition function: given the current phase and a snapshot of inputs, return the
 * phase that should now be active. Returns the same phase when no transition applies.
 */
export function nextPhase(current: RacePhase, inputs: PhaseInputs): RacePhase {
  switch (current) {
    case "lobby":
      return inputs.startRequested && inputs.playerCount >= MIN_PLAYERS_TO_START
        ? "countdown"
        : "lobby";

    case "countdown":
      return inputs.countdownEndsAt > 0 && inputs.now >= inputs.countdownEndsAt
        ? "racing"
        : "countdown";

    case "racing": {
      const timedOut = inputs.raceDeadline > 0 && inputs.now >= inputs.raceDeadline;
      return inputs.allFinished || timedOut ? "finished" : "racing";
    }

    case "finished":
      return "finished";
  }
}

/** The only legal forward transitions, plus finished -> lobby ("play again"). */
const LEGAL_TRANSITIONS: ReadonlyArray<readonly [RacePhase, RacePhase]> = [
  ["lobby", "countdown"],
  ["countdown", "racing"],
  ["racing", "finished"],
  ["finished", "lobby"],
];

/** Whether a direct phase change is allowed. Self-transitions and skips are rejected. */
export function canTransition(from: RacePhase, to: RacePhase): boolean {
  return LEGAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
}
