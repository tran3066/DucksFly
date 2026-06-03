// Shared local-player tuning: duck visual, chase camera, flight physics, and boost.
// Every mode (solo race, infinite, multiplayer) uses these defaults so gameplay
// feels identical. Solo race may optionally overlay Leva sliders on top when
// debug is on (`useFlightLevaTuning`).

import type { AnimMapConfig } from '../avatar/animationMap'
import { DEFAULT_ANIM_MAP } from '../avatar/animationMap'
import { DEFAULT_FOLLOW, type FollowCameraConfig } from '../avatar/followConfig'
import { makeIdleActions } from '../shared/types/duckActions'
import { DEFAULT_MAP_CONFIG } from '../map'
import { createFlightState, DEFAULT_FLIGHT } from './flight'
import { BOOST } from './gameConfig'
import { FLAP_ANIM_SPEED } from './gestureConfig'
import type { FlightRigProps } from './FlightRig'
import type { FlightSession } from './useFlightSession'

export const STANDARD_DUCK_VISUAL: FlightRigProps['duckVisual'] = {
  scale: 1,
  modelYaw: 0,
  crossfade: 0.25,
  flapAnimSpeed: FLAP_ANIM_SPEED,
}

export const STANDARD_ANIM_CFG: AnimMapConfig = DEFAULT_ANIM_MAP

export const STANDARD_CAM_CFG: FollowCameraConfig = DEFAULT_FOLLOW

/** Chase-camera start position from a duck world position (default: spawn). */
export function computeStartCam(
  position: [number, number, number] = createFlightState().position,
): [number, number, number] {
  return [
    position[0] + STANDARD_CAM_CFG.lateral,
    position[1] + STANDARD_CAM_CFG.up,
    position[2] - STANDARD_CAM_CFG.back,
  ]
}

/** Push canonical flight/boost/action defaults into the session refs (MP, infinite, SP baseline). */
export function applyLocalFlightDefaults(session: FlightSession): void {
  session.cfgRef.current = { ...DEFAULT_FLIGHT }
  session.boostSpeedRef.current = BOOST.speed
  session.boostDurationRef.current = BOOST.durationSec
  session.actionsRef.current = { ...makeIdleActions(), confidence: 1 }
}

/** Leva panel schema defaults — kept here so `useFlightLevaTuning` and docs stay in sync. */
export const FLIGHT_LEVA_DEFAULTS = {
  duck: {
    scale: STANDARD_DUCK_VISUAL.scale,
    modelYaw: STANDARD_DUCK_VISUAL.modelYaw,
    crossfade: STANDARD_DUCK_VISUAL.crossfade,
    flapActiveThreshold: DEFAULT_ANIM_MAP.flapActiveThreshold,
    turnThreshold: DEFAULT_ANIM_MAP.turnThreshold,
  },
  cam: { ...DEFAULT_FOLLOW },
  flight: {
    baseForwardSpeed: DEFAULT_FLIGHT.baseForwardSpeed,
    diveAccel: DEFAULT_FLIGHT.diveAccel,
    gravity: DEFAULT_FLIGHT.gravity,
    liftMultiplier: DEFAULT_FLIGHT.liftMultiplier,
    impulseGain: DEFAULT_FLIGHT.impulseGain,
    maxClimbSpeed: DEFAULT_FLIGHT.maxClimbSpeed,
    maxDescentSpeed: DEFAULT_FLIGHT.maxDescentSpeed,
    diveSink: DEFAULT_FLIGHT.diveSink,
    maxRollDeg: DEFAULT_FLIGHT.maxRollDeg,
    lateralSpeedAtMaxBank: DEFAULT_FLIGHT.lateralSpeedAtMaxBank,
    lateralRange: DEFAULT_MAP_CONFIG.halfWidth,
    minAltitude: DEFAULT_FLIGHT.minAltitude,
    maxAltitude: DEFAULT_FLIGHT.maxAltitude,
  },
} as const
