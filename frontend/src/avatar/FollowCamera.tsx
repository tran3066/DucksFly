// Chase camera. (Person A, Step 09)
//
// Sits at a fixed offset behind + above the duck and AIMS FORWARD (+Z) with
// lookAt. Modeled on the Unity prototype's rigid follow cam (no roll, level
// horizon, duck pinned to a fixed screen spot), but it must aim with lookAt
// rather than a constant Euler, because three.js cameras look down -Z while
// Unity's look down +Z -- copying Unity's Euler verbatim points the camera
// backward and hides the duck (the bug this fixes).
//
// lookAt keeps the horizon level (it uses world-up and applies no roll), so the
// earlier left-skew (caused by a camera-roll-on-lean term) cannot return.
//
// Camera is read from the useFrame `state` arg (not useThree()) so mutating it
// in the loop is lint-legal under the react-hooks rules.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { DuckState } from '../physics'
import { DEFAULT_FOLLOW, type FollowCameraConfig } from './followConfig'

export function FollowCamera({
  stateRef,
  cfg = DEFAULT_FOLLOW,
}: {
  stateRef: React.RefObject<DuckState>
  cfg?: FollowCameraConfig
}) {
  const aim = useRef(new Vector3())

  useFrame((state) => {
    const s = stateRef.current
    const cam = state.camera

    // Behind (-Z), above (+Y), at the same lateral X as the duck.
    const tx = s.position[0] + cfg.lateral
    const ty = s.position[1] + cfg.up
    const tz = s.position[2] - cfg.back

    if (cfg.damp >= 1) {
      cam.position.set(tx, ty, tz)
    } else {
      cam.position.x += (tx - cam.position.x) * cfg.damp
      cam.position.y += (ty - cam.position.y) * cfg.damp
      cam.position.z += (tz - cam.position.z) * cfg.damp
    }

    // Aim FORWARD: a point ahead of and slightly below the duck. World-up keeps
    // the horizon level (no roll, ever).
    aim.current.set(s.position[0], s.position[1], s.position[2] + cfg.lookAhead)
    cam.up.set(0, 1, 0)
    cam.lookAt(aim.current)
  })

  return null
}
