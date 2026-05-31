// Pure last-checkpoint lookup for crash respawn. Framework-free + deterministic
// (no RNG, no game state) so it is trivially unit-testable and behaves identically
// in single-player and multiplayer.

import type { Checkpoint } from '../map'

/**
 * Z of the last NON-finish checkpoint at or before `z`. Returns 0 (the start
 * plane) when the duck is still before the first checkpoint, so a crash always
 * snaps to a valid plane behind the duck and never to the finish line itself.
 */
export function lastCheckpointZ(z: number, checkpoints: Checkpoint[]): number {
  let best = 0
  for (const cp of checkpoints) {
    if (cp.isFinish) continue
    if (cp.z <= z && cp.z > best) best = cp.z
  }
  return best
}
