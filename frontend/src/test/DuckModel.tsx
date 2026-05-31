import { forwardRef } from 'react';
import { Group } from 'three';
import { Duck } from '../world/Duck';

/**
 * Yaw offset (radians) to align the model's forward with +Z (down the track).
 * If the duck flies backwards/sideways, set this: Math.PI (faces -Z),
 * +/-Math.PI/2 (faces +/-X).
 */
const FACING_OFFSET = 0;

/**
 * Duck scale in the map. The <Duck> default (0.00003 ≈ 1.5 m) reads small at the
 * 14 m chase-cam distance, so scale it up for presence in the big corridor.
 */
const DUCK_MAP_SCALE = 0.00008;

/**
 * Bridges the real <Duck> model into the physics rig. The outer group is driven
 * each frame by DuckRig (position + yaw/pitch/roll); <Duck> handles its own
 * loading, texturing, flap animation, and tiny model scale. Same forwardRef
 * interface as the old placeholder DuckMesh, so DuckRig is unchanged.
 */
export const DuckModel = forwardRef<Group>(function DuckModel(_props, ref) {
  return (
    <group ref={ref}>
      <Duck clip="flight_straight" rotation={[0, FACING_OFFSET, 0]} scale={DUCK_MAP_SCALE} />
    </group>
  );
});
