// The shared 3D scene for the real game. Owns the <Canvas> and everything inside
// it: sky, lights, the generated map, the local player's flight rig + chase
// camera, and a `children` slot for mode-specific scene content (multiplayer
// renders its remote ducks there). Both SinglePlayerGame and MultiplayerGame
// render this identically; only the injected rig props + children differ.

import { Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import type { MapDef } from '../map'
import { SimpleSky } from '../world/SimpleSky'
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
      <Suspense fallback={null}>
        <SimpleSky map={map} />
      </Suspense>
      <ambientLight intensity={0.6} />
      <hemisphereLight color="#ffffff" groundColor="#c8d2dc" intensity={0.5} />
      <directionalLight position={[50, 80, 20]} intensity={1.2} castShadow />
      <MapView map={map} passedRingIds={passedRingIds} ringPulseAt={ringPulseAt} />
      <FlightRig {...rig} />
      {children}
      <FollowCamera stateRef={rig.stateRef} cfg={camCfg} />
    </Canvas>
  )
}
