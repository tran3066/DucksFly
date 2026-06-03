// The shared 3D scene for the real game. Owns the <Canvas> and everything inside
// it: sky, lights, the generated map, the local player's flight rig + chase
// camera, and a `children` slot for mode-specific scene content (multiplayer
// renders its remote ducks there). All modes use the shared `FlightGame` shell
// (SinglePlayerGame, MultiplayerGame, InfiniteRunGame)
// render this identically; only the injected rig props + children differ.

import { Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { MapDef } from '../map'
import { SKY_HORIZON } from '../theme/palette'
import { SimpleSky } from '../world/SimpleSky'
import { WorldLighting } from '../world/WorldLighting'
import { MapView } from '../test/MapView'
import { FollowCamera } from '../avatar/FollowCamera'
import { type FollowCameraConfig } from '../avatar/followConfig'
import { FlightRig, type FlightRigProps } from './FlightRig'

export interface FlightSceneProps {
  map: MapDef
  startCam: [number, number, number]
  camCfg: FollowCameraConfig
  /** Rings the local player has flown through (recolor green). */
  passedRingIds: Set<number>
  /** ring id -> performance.now() ms it was passed (drives the pass pop). */
  ringPulseAt: Map<number, number>
  /** Everything the local flight rig needs (see FlightRig). */
  rig: FlightRigProps
  /** Mode-specific scene content, e.g. remote ducks in multiplayer. */
  children?: ReactNode
}

export function FlightScene({
  map,
  startCam,
  camCfg,
  passedRingIds,
  ringPulseAt,
  rig,
  children,
}: FlightSceneProps) {
  return (
    <Canvas shadows camera={{ position: startCam, fov: 62, near: 0.1, far: 8000 }}>
      <color attach="background" args={[SKY_HORIZON]} />
      <Suspense fallback={null}>
        <SimpleSky map={map} />
      </Suspense>
      <WorldLighting
        preset="day"
        followRef={rig.stateRef}
        sunDistance={180}
        shadowExtent={160}
      />
      <MapView map={map} passedRingIds={passedRingIds} ringPulseAt={ringPulseAt} />
      <FlightRig {...rig} />
      {children}
      <FollowCamera stateRef={rig.stateRef} cfg={camCfg} />
    </Canvas>
  )
}
