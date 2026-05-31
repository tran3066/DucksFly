// Lean / turn detection (Person A, plan Step 05). Pure logic, no React and no
// webcam: each function consumes one calibrated landmark frame and returns the
// `lean` channel of DuckActions, a number in -1..1 where negative steers the
// duck to SCREEN LEFT and positive steers it to SCREEN RIGHT. Unlike flap (Step
// 04) there is no state to keep: lean is read fresh from each frame, so these are
// plain functions, not classes, with no module-level mutable state.
//
// Two interpretation strategies the game A/B-tests between:
//   - leanFromShoulderTilt   : bank the torso left/right (shoulder-line angle)
//   - leanFromAsymmetricWing : raise one wrist higher than the other
//   - computeLean            : config.turnMode picks one of the two
//
// Two gotchas every formula here respects:
//   1. The webcam image is MIRRORED (the player's real left appears on the image
//      right). A single mirrorSign (+1 or -1), supplied by the caller in the
//      calibration, encodes the one sign flip needed; we multiply by it exactly
//      once so player-real-left maps to a negative lean.
//   2. A near player and a far player doing the SAME gesture must produce the
//      SAME lean. Shoulder tilt is an angle, which is already scale invariant (20
//      degrees is 20 degrees at any distance). The wing gap is a length, so we
//      divide it by the current frame's shoulder width to cancel body size.

import type { Landmark } from '../fixtures/landmarks'
import { shoulderWidth } from '../calibration'

// Re-export the turn-mode union so callers (and tests) import it from here
// alongside the lean functions instead of reaching back into config.
export type { TurnMode } from '../config'
import type { TurnMode } from '../config'

// MediaPipe Pose landmark indices Person A uses for lean.
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_WRIST = 15
const RIGHT_WRIST = 16

/**
 * One unified calibration for both lean strategies. The caller fills it from the
 * Step 03 baseline plus the fixed mirror sign; each strategy reads only the
 * fields it needs, so passing the whole object to either function type checks.
 *
 * - restShoulderAngle: the shoulder-line angle (radians) captured at calibration.
 *   Subtracting it makes each player's natural posture read as straight ahead.
 *   Comes from Baseline.restShoulderAngle.
 * - mirrorSign: +1 or -1, the single mirrored-webcam correction (Gotcha 1). It is
 *   NOT stored in the baseline; the caller supplies it (the tests pass +1, and -1
 *   to prove the flip happens exactly once).
 * - maxTiltRad: the tilt at which shoulder-tilt lean saturates to +/-1 (radians).
 *   Corresponds to config.leanMaxAngle (~0.5, about 28 degrees).
 * - saturationWidthRatio: the wrist gap, as a fraction of shoulder width, at
 *   which wing lean saturates to +/-1 (~0.8).
 */
export interface LeanCalib {
  restShoulderAngle: number
  mirrorSign: number
  maxTiltRad: number
  saturationWidthRatio: number
}

// Clamp a value into [lo, hi]. Defined locally because there are no shared Step
// 00 math helpers; the flap detectors keep their own clamp01 for the same
// reason. This guarantees the -1..1 contract holds even for extreme input.
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 05.1: lean from the shoulder-line tilt.
 *
 * The shoulder line runs from the left shoulder (11) to the right shoulder (12).
 * Level shoulders give a horizontal line whose angle is ~0; banking tilts the
 * line. We measure that angle with atan2, subtract the calibrated rest angle so
 * the player's neutral posture reads straight, apply the mirror sign once, scale
 * by the configured max tilt, and clamp to -1..1.
 *
 * y grows DOWNWARD in image space, so the right shoulder dropping lower has a
 * LARGER y. With the left shoulder at the smaller x and the right at the larger
 * x (dx positive), that makes the raw angle positive, which we map to a positive
 * (screen-right) lean. The angle is naturally scale invariant, so there is no
 * divide by shoulder width here (Gotcha 2 is satisfied for free).
 */
export function leanFromShoulderTilt(landmarks: Landmark[], calib: LeanCalib): number {
  const lShoulder = landmarks[LEFT_SHOULDER]
  const rShoulder = landmarks[RIGHT_SHOULDER]

  // Vector from the left shoulder (11) to the right shoulder (12).
  const dx = rShoulder.x - lShoulder.x
  const dy = rShoulder.y - lShoulder.y // remember: y grows downward

  // Raw shoulder-line angle. Level shoulders (dy ~ 0, dx > 0) give ~0.
  const rawAngle = Math.atan2(dy, dx)

  // Subtract the player's calibrated rest angle so their natural stance is 0,
  // then WRAP the difference into (-pi, pi]. The wrap is essential: with a real
  // mirrored webcam MediaPipe lands the LEFT shoulder (11) at a LARGER image x
  // than the RIGHT (12), so the raw shoulder-line angle sits near +/-pi, not 0.
  // Without wrapping, a left tilt and a right tilt both produce large SAME-sign
  // differences and the lean sticks to one side. atan2(sin, cos) folds the
  // difference back to the true small relative tilt regardless of orientation.
  const relAngle = rawAngle - calib.restShoulderAngle
  const wrapped = Math.atan2(Math.sin(relAngle), Math.cos(relAngle))

  // Apply the single mirror correction, scale to -1..1, then clamp.
  const scaled = (wrapped * calib.mirrorSign) / calib.maxTiltRad
  return clamp(scaled, -1, 1)
}

/**
 * 05.2: lean from raising one wrist higher than the other.
 *
 * The left wrist is landmark 15 and the right wrist is landmark 16. Because y
 * grows DOWNWARD, a smaller y means a wrist is physically higher. The signed
 * vertical gap (lWrist.y - rWrist.y) is positive when the RIGHT wrist is higher
 * (its y is smaller), which we map to a positive (screen-right) lean.
 *
 * We divide that gap by the CURRENT frame's shoulder width (Gotcha 2) so a near
 * player and a far player with the same proportional arm pose produce the same
 * number. shoulderWidth() (shared with calibration and flap) clamps a degenerate
 * width to a tiny epsilon, so the divide never blows up; we also return 0 outright
 * when the width is degenerate so an untracked frame stays idle rather than
 * producing a huge value from a near-zero divisor. Then we apply the mirror
 * correction once, scale by the saturation ratio, and clamp to -1..1.
 */
export function leanFromAsymmetricWing(landmarks: Landmark[], calib: LeanCalib): number {
  const lWrist = landmarks[LEFT_WRIST]
  const rWrist = landmarks[RIGHT_WRIST]

  // Body-size reference: the distance between the shoulders (11, 12). This is
  // clamped to an epsilon floor inside shoulderWidth(), so it is never 0.
  const width = shoulderWidth(landmarks)

  // Degenerate frame (shoulders on top of each other): the width is just the
  // epsilon floor, and dividing a real gap by it would yield a huge value. Stay
  // idle instead so an untracked / collapsed pose reads as no steering.
  const SHOULDER_WIDTH_EPSILON = 1e-6
  if (width <= SHOULDER_WIDTH_EPSILON) return 0

  // y grows downward, so the right wrist being higher (smaller y) gives a
  // positive gap, which we want to map to a positive (screen-right) lean.
  const verticalGap = lWrist.y - rWrist.y

  // Normalize by body size so near and far players read equal.
  const ratio = verticalGap / width

  // Apply the mirror correction once, scale, then clamp.
  const scaled = (ratio * calib.mirrorSign) / calib.saturationWidthRatio
  return clamp(scaled, -1, 1)
}

/**
 * 05.3: single entry point the rest of the pipeline calls so it never branches on
 * turn mode itself. turnMode 'wing' runs the asymmetric-wing strategy; 'lean'
 * (the default) runs shoulder-tilt. Both branches already return a clamped value
 * in -1..1. An unknown mode falls back to the shoulder-tilt strategy so a bad
 * config value can never return undefined.
 *
 * NOTE: the committed config union is 'lean' | 'wing' (see config.ts), so the
 * default 'lean' is the shoulder-tilt mode. This differs from the plan's draft
 * 'shoulder' | 'wing'; the committed union wins.
 */
export function computeLean(landmarks: Landmark[], calib: LeanCalib, turnMode: TurnMode): number {
  switch (turnMode) {
    case 'wing':
      return leanFromAsymmetricWing(landmarks, calib)
    case 'lean':
    default:
      return leanFromShoulderTilt(landmarks, calib)
  }
}
