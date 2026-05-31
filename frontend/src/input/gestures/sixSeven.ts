// "Six-seven" hand gesture (Person A, plan Step 11, redefined as a MOTION).
//
// Not a static finger sign: the player holds both hands in front of the torso
// (elbows bent, palms up) and rapidly alternates them up/down in OPPOSITE phase --
// left hand up while right is down, then left down while right up. We detect it
// from the POSE wrists we already track every frame (15 left, 16 right): watch the
// SIGN of (leftWristY - rightWristY) and fire when it flips back and forth at least
// `minSwaps` times inside a short rolling window (so the higher hand swaps quickly).
//
// y grows DOWNWARD in image space, so a SMALLER y is HIGHER:
//   left higher  <=> leftWrist.y  < rightWrist.y  (diff < 0)
//   right higher <=> rightWrist.y < leftWrist.y   (diff > 0)
//
// Pure + stateful via an explicit state object (like the other detectors): tests
// feed a sequence of frames + timestamps and count pulses; no React, no webcam.

import type { LandmarkFrame } from '../fixtures/landmarks'

// MediaPipe Pose landmark indices this gesture reads.
const LEFT_WRIST = 15
const RIGHT_WRIST = 16
const LEFT_ELBOW = 13
const RIGHT_ELBOW = 14
const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12
const LEFT_HIP = 23
const RIGHT_HIP = 24

export interface SixSevenConfig {
  /** Both wrists AND both elbows must be at least this visible (0..1) to count. */
  visMin: number
  /** How far apart the wrists must be (normalized y) for one to count as clearly
   *  HIGHER than the other. A dead band so jitter near level is not a swap. */
  ampThreshold: number
  /** Rolling window (ms): the swaps must happen within this long to fire. */
  windowMs: number
  /** Number of high/low swaps inside the window that triggers the gesture. */
  minSwaps: number
  /** After firing, suppress re-fire for this long so a held bout fires once. */
  cooldownMs: number
  /** Hands must be IN FRONT, not spread: both wrists within the shoulder X span
   *  widened by this normalized margin. Rejects arms-out swinging / waving. */
  frontXMargin: number
  /** Both elbows must be BENT (angle at the elbow, in degrees, at or below this).
   *  Rejects straight-arm swings; the move is "elbows ~90 degrees, forearms up". */
  elbowMaxDeg: number
}

export const DEFAULT_SIX_SEVEN: SixSevenConfig = {
  visMin: 0.5,
  ampThreshold: 0.04, // ~4% of frame height between the wrists = a clear high/low
  windowMs: 1500, // swaps must land within ~1.5s of each other
  minSwaps: 2, // at least two swaps (left-high -> right-high -> left-high)
  cooldownMs: 1200, // ~1.2s between eggs while the motion is held
  frontXMargin: 0.15, // wrists within the shoulders' X span +/- this (hands in front)
  elbowMaxDeg: 160, // both elbows bent (<=160 deg); a straight arm (~180) is rejected
}

export interface SixSevenState {
  /** Which hand is currently higher: -1 left, +1 right, 0 not yet established. */
  lastSign: number
  /** Timestamps (ms) of recent sign flips, pruned to the rolling window. */
  swapTimes: number[]
  /** Time of the last fire, for the cooldown. */
  lastFireMs: number
}

export function makeSixSevenState(): SixSevenState {
  return { lastSign: 0, swapTimes: [], lastFireMs: -Infinity }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

interface Pt {
  x: number
  y: number
}

// Angle (degrees) at the elbow, between the upper arm (elbow->shoulder) and the
// forearm (elbow->wrist). ~180 is a straight arm; ~90 is the bent "front" pose.
// A degenerate (zero-length) limb is reported as straight so it gets rejected.
function elbowAngleDeg(shoulder: Pt, elbow: Pt, wrist: Pt): number {
  const ax = shoulder.x - elbow.x
  const ay = shoulder.y - elbow.y
  const bx = wrist.x - elbow.x
  const by = wrist.y - elbow.y
  const magA = Math.hypot(ax, ay)
  const magB = Math.hypot(bx, by)
  if (magA < 1e-6 || magB < 1e-6) return 180
  const cos = clamp((ax * bx + ay * by) / (magA * magB), -1, 1)
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * The full "six-seven" pose gate: this is the EXACT-move filter that stops ordinary
 * hand swinging from triggering. Requires, for both arms:
 *   - the wrists AND elbows visible (so we are really seeing two arms);
 *   - both wrists in the vertical torso band (chest height, not overhead/at-legs);
 *   - both wrists IN FRONT (within the shoulders' X span widened by frontXMargin),
 *     so arms-out / spread waving is rejected;
 *   - both elbows BENT (angle <= elbowMaxDeg), so straight-arm swinging is rejected.
 * Only when all hold does the alternation count toward the gesture.
 */
function validSixSevenPose(frame: LandmarkFrame, cfg: SixSevenConfig): boolean {
  const lw = frame[LEFT_WRIST]
  const rw = frame[RIGHT_WRIST]
  const le = frame[LEFT_ELBOW]
  const re = frame[RIGHT_ELBOW]
  const ls = frame[LEFT_SHOULDER]
  const rs = frame[RIGHT_SHOULDER]
  const lh = frame[LEFT_HIP]
  const rh = frame[RIGHT_HIP]
  if (!lw || !rw || !le || !re || !ls || !rs || !lh || !rh) return false
  // Both arms genuinely seen (wrists and elbows).
  if (lw.visibility < cfg.visMin || rw.visibility < cfg.visMin) return false
  if (le.visibility < cfg.visMin || re.visibility < cfg.visMin) return false

  // Vertical band: chest height, not overhead or down at the legs.
  const shoulderY = (ls.y + rs.y) / 2
  const hipY = (lh.y + rh.y) / 2
  const torso = Math.max(hipY - shoulderY, 1e-3) // guard a degenerate/inverted pose
  const top = shoulderY - 0.5 * torso
  const bottom = hipY + 0.2 * torso
  if (lw.y <= top || lw.y >= bottom || rw.y <= top || rw.y >= bottom) return false

  // Horizontal band: hands IN FRONT (near the torso centre), not arms-out.
  const minX = Math.min(ls.x, rs.x) - cfg.frontXMargin
  const maxX = Math.max(ls.x, rs.x) + cfg.frontXMargin
  if (lw.x < minX || lw.x > maxX || rw.x < minX || rw.x > maxX) return false

  // Both elbows bent (~90), not straight: rejects straight-arm swinging.
  if (elbowAngleDeg(ls, le, lw) > cfg.elbowMaxDeg) return false
  if (elbowAngleDeg(rs, re, rw) > cfg.elbowMaxDeg) return false

  return true
}

/**
 * Feed one pose frame + a timestamp. Returns true on the single frame the gesture
 * is recognized (the rising edge of a completed alternation bout), false otherwise.
 *
 * A "swap" is the higher hand changing (the sign of leftY - rightY flipping, past
 * the dead band so jitter near level does not count). `minSwaps` swaps inside
 * `windowMs` fire once, then a cooldown keeps a held alternation from spamming.
 * An invalid pose (a wrist hidden, hands not in front of the torso, or only one
 * hand) never advances the swap count, so one-handed waving / overhead motion is
 * ignored.
 */
export function detectSixSeven(
  state: SixSevenState,
  frame: LandmarkFrame | null,
  nowMs: number,
  cfg: SixSevenConfig = DEFAULT_SIX_SEVEN,
): boolean {
  // Drop swaps that fell out of the rolling window, regardless of pose validity.
  state.swapTimes = state.swapTimes.filter((t) => nowMs - t <= cfg.windowMs)

  if (!frame || !validSixSevenPose(frame, cfg)) {
    return false
  }

  const diff = frame[LEFT_WRIST].y - frame[RIGHT_WRIST].y // <0 left higher, >0 right higher
  let sign = state.lastSign
  // Only switch which hand is "higher" once they are CLEARLY apart (past the dead
  // band); near-level frames hold the last sign so tiny jitter is not a swap.
  if (Math.abs(diff) >= cfg.ampThreshold) {
    sign = diff < 0 ? -1 : 1
  }

  // A swap: the clearly-higher hand changed. Record when it happened.
  if (sign !== 0 && state.lastSign !== 0 && sign !== state.lastSign) {
    state.swapTimes.push(nowMs)
  }
  if (sign !== 0) state.lastSign = sign

  // Re-prune so a swap just pushed at nowMs is kept and stale ones are dropped.
  state.swapTimes = state.swapTimes.filter((t) => nowMs - t <= cfg.windowMs)

  // Enough swaps in the window, and past the post-fire cooldown -> fire once.
  if (state.swapTimes.length >= cfg.minSwaps && nowMs - state.lastFireMs >= cfg.cooldownMs) {
    state.lastFireMs = nowMs
    state.swapTimes = [] // reset the bout so a held alternation does not keep firing
    return true
  }
  return false
}
