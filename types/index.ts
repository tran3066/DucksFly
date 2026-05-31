/**
 * Shared contracts for DucksFly, imported by both the frontend and the backend via the
 * `@shared/*` path alias (e.g. `import { RaceRoomState } from "@shared/network"`).
 *
 * The two agreements from docs/ARCHITECTURE.md §4 are DuckActions and RaceRoomState; the
 * rest (messages, constants) are the networking contract built around them.
 */
export * from "./duckActions";
export * from "./network";
export * from "./messages";
export * from "./constants";
