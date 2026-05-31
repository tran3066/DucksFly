import { useSyncExternalStore } from "react";
import { raceConnection } from "./connection";
import type { RaceSnapshot } from "./types";

/** Subscribe a component to the live race snapshot. Re-renders on every state patch. */
export function useRace(): RaceSnapshot {
  return useSyncExternalStore(raceConnection.subscribe, raceConnection.getSnapshot);
}

/** True when the given snapshot's player is the host (allowed to start the race). */
export function isHost(snapshot: RaceSnapshot): boolean {
  return !!snapshot.sessionId && snapshot.sessionId === snapshot.hostId;
}
