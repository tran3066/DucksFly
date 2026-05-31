import { describe, it, expect } from "vitest";
import type { RacePhase } from "@shared/network";
import {
  nextPhase,
  canTransition,
  MIN_PLAYERS_TO_START,
  type PhaseInputs,
} from "@/logic/stateMachine";

/**
 * The race phase machine (docs/ARCHITECTURE.md §7):
 *   lobby --(host starts, enough players)--> countdown
 *   countdown --(timer reaches zero)--> racing
 *   racing --(all finished OR time limit)--> finished
 *   finished --(play again)--> lobby
 *
 * `nextPhase` is a pure function: given the current phase and a snapshot of inputs, it
 * returns the phase that should now be active. `canTransition` guards illegal jumps.
 */

const base: PhaseInputs = {
  now: 1_000,
  playerCount: 4,
  startRequested: false,
  countdownEndsAt: 0,
  allFinished: false,
  raceDeadline: 0,
};

describe("nextPhase", () => {
  describe("from lobby", () => {
    it("stays in lobby until the host requests a start", () => {
      expect(nextPhase("lobby", { ...base, startRequested: false })).toBe("lobby");
    });

    it("moves to countdown when start is requested and there are enough players", () => {
      const inputs: PhaseInputs = {
        ...base,
        startRequested: true,
        playerCount: MIN_PLAYERS_TO_START,
      };
      expect(nextPhase("lobby", inputs)).toBe("countdown");
    });

    it("refuses to start with fewer than the minimum players", () => {
      const inputs: PhaseInputs = {
        ...base,
        startRequested: true,
        playerCount: MIN_PLAYERS_TO_START - 1,
      };
      expect(nextPhase("lobby", inputs)).toBe("lobby");
    });
  });

  describe("from countdown", () => {
    it("stays in countdown until the countdown end time is reached", () => {
      expect(
        nextPhase("countdown", { ...base, now: 4_000, countdownEndsAt: 5_000 }),
      ).toBe("countdown");
    });

    it("moves to racing once the countdown end time has passed", () => {
      expect(
        nextPhase("countdown", { ...base, now: 5_000, countdownEndsAt: 5_000 }),
      ).toBe("racing");
    });
  });

  describe("from racing", () => {
    it("keeps racing while players are still going and there is time", () => {
      expect(
        nextPhase("racing", { ...base, now: 10_000, allFinished: false, raceDeadline: 99_000 }),
      ).toBe("racing");
    });

    it("finishes when every player has finished", () => {
      expect(nextPhase("racing", { ...base, allFinished: true })).toBe("finished");
    });

    it("finishes when the race time limit is hit", () => {
      expect(
        nextPhase("racing", { ...base, now: 99_000, raceDeadline: 99_000 }),
      ).toBe("finished");
    });

    it("ignores a zero race deadline (no time limit set)", () => {
      expect(
        nextPhase("racing", { ...base, now: 999_999, raceDeadline: 0, allFinished: false }),
      ).toBe("racing");
    });

    it("keeps racing while the finish-grace window is still open", () => {
      expect(
        nextPhase("racing", { ...base, now: 10_000, finishWindowDeadline: 30_000 }),
      ).toBe("racing");
    });

    it("finishes once the finish-grace window has elapsed", () => {
      expect(
        nextPhase("racing", { ...base, now: 30_000, finishWindowDeadline: 30_000 }),
      ).toBe("finished");
    });

    it("ignores a zero/absent finish-grace deadline", () => {
      expect(nextPhase("racing", { ...base, now: 999_999, finishWindowDeadline: 0 })).toBe(
        "racing",
      );
      expect(nextPhase("racing", { ...base, now: 999_999 })).toBe("racing");
    });
  });

  describe("from finished", () => {
    it("stays finished until an explicit reset (play again) happens elsewhere", () => {
      expect(nextPhase("finished", base)).toBe("finished");
    });
  });
});

describe("nextPhase — edge cases", () => {
  it("never starts from an empty lobby even if a start is requested", () => {
    expect(nextPhase("lobby", { ...base, startRequested: true, playerCount: 0 })).toBe(
      "lobby",
    );
  });

  it("stays in countdown when no countdown end time has been set (0)", () => {
    // A degenerate input: countdownEndsAt must be a positive timestamp to advance.
    expect(nextPhase("countdown", { ...base, now: 10_000, countdownEndsAt: 0 })).toBe(
      "countdown",
    );
  });

  it("advances to racing when the clock is already well past the countdown end", () => {
    expect(
      nextPhase("countdown", { ...base, now: 1_000_000, countdownEndsAt: 5_000 }),
    ).toBe("racing");
  });

  it("finishes racing when both the all-finished and time-limit conditions are true", () => {
    expect(
      nextPhase("racing", { ...base, now: 99_000, raceDeadline: 99_000, allFinished: true }),
    ).toBe("finished");
  });

  it("stays finished regardless of any other input", () => {
    expect(
      nextPhase("finished", {
        ...base,
        startRequested: true,
        allFinished: true,
        playerCount: 8,
        now: 1_000_000,
        raceDeadline: 1,
        countdownEndsAt: 1,
      }),
    ).toBe("finished");
  });

  it("does not advance the countdown one millisecond early", () => {
    expect(
      nextPhase("countdown", { ...base, now: 4_999, countdownEndsAt: 5_000 }),
    ).toBe("countdown");
  });
});

describe("canTransition", () => {
  it("allows the four legal transitions", () => {
    expect(canTransition("lobby", "countdown")).toBe(true);
    expect(canTransition("countdown", "racing")).toBe(true);
    expect(canTransition("racing", "finished")).toBe(true);
    expect(canTransition("finished", "lobby")).toBe(true);
  });

  it("rejects skipping phases", () => {
    expect(canTransition("lobby", "racing")).toBe(false);
    expect(canTransition("lobby", "finished")).toBe(false);
    expect(canTransition("countdown", "finished")).toBe(false);
  });

  it("rejects going backwards (except finished -> lobby)", () => {
    expect(canTransition("countdown", "lobby")).toBe(false);
    expect(canTransition("racing", "countdown")).toBe(false);
    expect(canTransition("racing", "lobby")).toBe(false);
  });

  it("rejects no-op self transitions", () => {
    const phases: RacePhase[] = ["lobby", "countdown", "racing", "finished"];
    for (const p of phases) {
      expect(canTransition(p, p)).toBe(false);
    }
  });
});
