// Baked production gesture tuning for camera (MediaPipe) control.
//
// These are the values the Person A playground exposed as live Leva sliders and
// tuned by hand (see debug/PersonAPlayground.tsx "Gestures" controls + the
// turnCfgRef/diveCfgRef defaults). The playground let them be tweaked at runtime;
// the shipped game bakes the tuned defaults in as fixed constants so camera
// control feels identical without any debug UI. The flight model + ring boost
// config are already shared via game/flight.ts + game/gameConfig.ts; this file is
// the ONLY gesture-side tuning that was Leva-only and therefore had to be ported.

import { FlapStrategy } from '../input/gestures/flap'
import type { TurnMode } from '../input/gestures/lean'

// Mouth-open (Face Landmarker jawOpen blendshape, 0..1) above this reads as a
// quack this frame. (debug QUACK_THRESHOLD)
export const QUACK_THRESHOLD = 0.4

// Pose updates arrive slower than the render loop; a brief gap with no NEW
// landmark frame is normal. Only after this many ticks without a new frame do we
// treat the body as gone and zero the gestures + reset the flap detector.
// (debug STALE_POSE_TICKS)
export const STALE_POSE_TICKS = 15

// A detected binary flap raises a flap PULSE to 1.0 that decays at this rate
// (per second, exponential) so a gesture flap animates + pitches + climbs like a
// Space tap. (debug FLAP_PULSE_DECAY_RATE)
export const FLAP_PULSE_DECAY_RATE = 6

// Flap detector tuning (debug "Gestures" -> flapMode + flapTuning defaults).
// rate mode is the default: it tracks wrist MOVEMENT so the player can flap with
// arms in any comfortable position rather than holding them to a height.
export const GESTURE_FLAP = {
  flapMode: 'rate' as const,
  rateGain: 11.5,
  sensitivity: 0.02, // noiseEpsilon: wrist speed below this reads as no lift
  rateDecay: 0.3, // matches input/config.ts flapRateDecay
  highThreshold: 0.25, // binary mode only (body units)
  lowThreshold: 0.08, // binary mode only (body units)
  refractoryFrames: 6,
}

// Turn (lean) tuning (debug turnCfgRef + "turnTuning" defaults). mirrorSign -1
// steers correctly for the mirrored selfie webcam; maxTilt 28 degrees.
export const GESTURE_TURN = {
  turnMode: 'lean' as TurnMode,
  mirrorSign: -1,
  maxTiltRad: (28 * Math.PI) / 180,
  saturationWidthRatio: 0.8, // wing mode only
  smoothing: 0.4, // EMA per pose frame
}

// Dive tuning (debug diveCfgRef + "diveTuning" defaults): shoulder-widths the
// wrists must drop below the shoulders to begin / saturate the dive.
export const GESTURE_DIVE = {
  startBelow: 0.4,
  fullBelow: 1.5,
  smoothing: 0.4, // EMA per pose frame
}

// Wingbeat animation speed at a full flap (debug duckVisual.flapAnimSpeed). The
// game's <Duck> defaults to 1.8; the playground tuned this to 2.5, so we pass it
// explicitly for animation parity.
export const FLAP_ANIM_SPEED = 2.5

/** Build a FlapStrategy seeded with the baked production flap tuning. */
export function makeFlapStrategy(): FlapStrategy {
  return new FlapStrategy({
    flapMode: GESTURE_FLAP.flapMode,
    highThreshold: GESTURE_FLAP.highThreshold,
    lowThreshold: GESTURE_FLAP.lowThreshold,
    refractoryFrames: GESTURE_FLAP.refractoryFrames,
    gain: GESTURE_FLAP.rateGain,
    decay: GESTURE_FLAP.rateDecay,
    noiseEpsilon: GESTURE_FLAP.sensitivity,
  })
}
