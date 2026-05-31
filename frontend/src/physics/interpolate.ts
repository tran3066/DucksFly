// Render interpolation. The simulation advances in fixed steps; what we DRAW is
// the blend between the previous and current sim states at the fractional time
// `alpha = accumulator / fixedDt`. This decouples rendering from the discrete sim
// so motion is smooth and frame-rate independent ("Fix Your Timestep").
//
// Pure & framework-free: the network layer reuses this to interpolate remote
// ducks between the few position updates that arrive per second.

import type { DuckState } from './types';

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-arc angle interpolation (handles wrap at +/- PI). */
export const lerpAngle = (a: number, b: number, t: number): number => {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
};

/** Just the fields needed to place the duck mesh + camera for a frame. */
export interface RenderPose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
  roll: number;
}

export function interpolatePose(prev: DuckState, curr: DuckState, t: number): RenderPose {
  return {
    position: [
      lerp(prev.position[0], curr.position[0], t),
      lerp(prev.position[1], curr.position[1], t),
      lerp(prev.position[2], curr.position[2], t),
    ],
    yaw: lerpAngle(prev.yaw, curr.yaw, t),
    pitch: lerpAngle(prev.pitch, curr.pitch, t),
    roll: lerpAngle(prev.roll, curr.roll, t),
  };
}
