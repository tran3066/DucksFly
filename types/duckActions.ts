/**
 * DuckActions — the handoff from the input code (Person A) to the physics code (Person C).
 * It describes, for a single frame, what the player is trying to do.
 *
 * Source of truth: docs/ARCHITECTURE.md §4 ("The Two Shared Agreements").
 * Imported by both the frontend (produced by input, consumed by physics) and, if needed,
 * the backend. Keep field names identical on every side.
 */
export interface DuckActions {
  /** How hard the player is flapping, 0 (still) to 1 (full effort). */
  flap: number;
  /** True only on the exact frame a new flap begins (for a discrete climb impulse). */
  flapImpulse: boolean;
  /** Torso lean: -1 is full left, 0 is straight, +1 is full right. */
  lean: number;
  /** How much the player is diving, 0 (none) to 1 (full dive). */
  dive: number;
  /** Is the player's mouth open (drives the quack). */
  quack: boolean;
  /** Is the player making the "six-seven" hand sign (easter egg). */
  egg67: boolean;
  /** How confident the camera tracking is, 0 to 1 (lets us fail gracefully). */
  confidence: number;
}
