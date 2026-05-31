// Chase-camera tuning. Modeled on the Unity prototype CameraFollowController
// (rigid offset, level horizon, no roll) but adapted to three.js conventions.
//
// IMPORTANT handedness note: Unity cameras look down +Z; three.js cameras look
// down -Z. Porting Unity's constant Euler(pitch,0,0) verbatim makes a three.js
// camera face BACKWARD (-Z), so the duck ends up behind the camera and the
// runway numbers count down (reversed). We therefore aim with lookAt() toward a
// point AHEAD of the duck (+Z); lookAt uses world-up, so the horizon never rolls.

export interface FollowCameraConfig {
  /** Distance behind the duck along world -Z. */
  back: number
  /** Height above the duck. */
  up: number
  /** Sideways offset (world X). Usually 0. */
  lateral: number
  /** How far ahead of the duck (+Z) the camera aims. Higher = flatter look. */
  lookAhead: number
  /** Position smoothing 0..1 per frame. 1 = rigid. Lower = softer follow. */
  damp: number
}

export const DEFAULT_FOLLOW: FollowCameraConfig = {
  back: 9,
  up: 4,
  lateral: 0,
  lookAhead: 6,
  damp: 1, // rigid (no jump). The horizon stays level via lookAt's world-up.
}
