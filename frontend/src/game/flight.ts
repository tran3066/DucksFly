// Canonical flight simulation for the real game (single-player AND multiplayer).
//
// This is the Unity-port infinite-runner model. It currently lives in
// `src/debug/flightModel.ts` (where it was first tuned in the Person A
// playground); the game imports it through this official path so callers never
// reach into `debug/`. Re-exporting (rather than moving) keeps a SINGLE source
// of truth — the legacy playground route keeps working untouched, and there is
// no risk of two copies drifting apart.

export {
  flightStep,
  createFlightState,
  DEFAULT_FLIGHT,
  type FlightConfig,
} from '../debug/flightModel'
