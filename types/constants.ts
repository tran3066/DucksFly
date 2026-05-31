/**
 * Shared tunables that both the client and server must agree on. Numbers marked "tune in
 * playtesting" are starting points, not final values. Sourced from docs/PRD.md (8 players,
 * race length) and docs/ARCHITECTURE.md §5-§7 (15-20Hz updates, countdown).
 */

/** Maximum players in one race room (docs/PRD.md §5.4). */
export const MAX_PLAYERS = 8;

/** Server simulation ticks per second (collision checks, phase logic). */
export const SERVER_TICK_HZ = 20;

/** How often the server broadcasts a state snapshot (docs/ARCHITECTURE.md: 15-20/sec). */
export const SNAPSHOT_HZ = 20;

/** How often each client sends its own position to the server. */
export const POSITION_SEND_HZ = 20;

/**
 * Countdown length before racing begins, in ms. Doubles as the asset-load grace window:
 * the scene is already mounted behind the lobby, and this gives slower clients a moment to
 * finish loading before the sim starts.
 */
export const COUNTDOWN_MS = 5000;

/**
 * Once the FIRST player finishes, the rest get this long to cross the line before the race
 * is force-ended. Keeps a race from stalling forever on players who fly off into the void.
 */
export const FINISH_GRACE_MS = 20_000;

/**
 * How long a player stays spun out after a player-vs-player collision before the server
 * clears the flag (lets them collide — and be counted — again). Slightly longer than the
 * client spin animation so it finishes before the next possible bump.
 */
export const SPINOUT_RECOVERY_MS = 1500;

/** Length of a lobby invite code (server-generated, unambiguous characters). */
export const LOBBY_CODE_LENGTH = 4;

/**
 * Distance under which two ducks count as colliding, in world units. Server-authoritative
 * (docs/ARCHITECTURE.md §3). Tune in playtesting.
 */
export const COLLISION_RADIUS = 1.5;

/**
 * How far behind real time remote ducks are rendered, in ms, so their sparse network
 * updates can be smoothed (interpolation; docs/PRD.md §11 glossary). Tune in playtesting.
 */
export const INTERPOLATION_DELAY_MS = 100;
