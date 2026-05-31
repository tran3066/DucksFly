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

/** Countdown length before racing begins, in ms (docs/ARCHITECTURE.md §7: 3, 2, 1). */
export const COUNTDOWN_MS = 3000;

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
