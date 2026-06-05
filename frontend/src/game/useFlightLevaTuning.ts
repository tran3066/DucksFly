// Optional Leva tuning panels for the local duck (solo-race debug playground).
// Production paths use `localFlightSetup` defaults. Returns `showLevaPanel` so
// the caller (`.tsx` only) can mount `<Leva />` when debug is on.

import { useEffect } from 'react'
import { useControls, button, folder } from 'leva'
import type { AnimMapConfig } from '../avatar/animationMap'
import { DEFAULT_ANIM_MAP } from '../avatar/animationMap'
import type { FollowCameraConfig } from '../avatar/followConfig'
import { DEFAULT_FLIGHT } from './flight'
import { BOOST, BOOST_SLIDERS } from './gameConfig'
import { FLIGHT_LEVA_DEFAULTS } from './localFlightSetup'
import type { FlightRigProps } from './FlightRig'
import type { FlightSession } from './useFlightSession'
import { FLAP_ANIM_SPEED } from './gestureConfig'

export function useFlightLevaTuning(
  session: FlightSession,
  opts: {
    showPanel: boolean
    fireImpulse: () => void
    onReset: () => void
  },
) {
  const { actionsRef, cfgRef, boostSpeedRef, boostDurationRef } = session

  const actions = useControls('Actions (manual)', {
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    invertLean: false,
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
    flapImpulse: button(opts.fireImpulse),
    reset: button(opts.onReset),
  })

  const duckLeva = useControls('Duck', {
    scale: { value: FLIGHT_LEVA_DEFAULTS.duck.scale, min: 0.1, max: 5, step: 0.05 },
    modelYaw: { value: FLIGHT_LEVA_DEFAULTS.duck.modelYaw, min: -Math.PI, max: Math.PI, step: 0.01 },
    crossfade: { value: FLIGHT_LEVA_DEFAULTS.duck.crossfade, min: 0, max: 1, step: 0.01 },
    flapActiveThreshold: {
      value: FLIGHT_LEVA_DEFAULTS.duck.flapActiveThreshold,
      min: 0,
      max: 1,
      step: 0.01,
    },
    turnThreshold: { value: FLIGHT_LEVA_DEFAULTS.duck.turnThreshold, min: 0, max: 1, step: 0.01 },
  })

  const camCfg = useControls('Camera', {
    back: { value: FLIGHT_LEVA_DEFAULTS.cam.back, min: 2, max: 40 },
    up: { value: FLIGHT_LEVA_DEFAULTS.cam.up, min: 0, max: 30 },
    lateral: { value: FLIGHT_LEVA_DEFAULTS.cam.lateral, min: -10, max: 10, step: 0.1 },
    lookAhead: { value: FLIGHT_LEVA_DEFAULTS.cam.lookAhead, min: -10, max: 40 },
    damp: { value: FLIGHT_LEVA_DEFAULTS.cam.damp, min: 0.05, max: 1, step: 0.05 },
  })

  const cfg = useControls('Flight', {
    forward: folder({
      baseForwardSpeed: { value: FLIGHT_LEVA_DEFAULTS.flight.baseForwardSpeed, min: 4, max: 30 },
      diveAccel: { value: FLIGHT_LEVA_DEFAULTS.flight.diveAccel, min: 0, max: 80 },
    }),
    vertical: folder({
      gravity: { value: FLIGHT_LEVA_DEFAULTS.flight.gravity, min: 0, max: 20 },
      liftMultiplier: { value: FLIGHT_LEVA_DEFAULTS.flight.liftMultiplier, min: 4, max: 40 },
      impulseGain: { value: FLIGHT_LEVA_DEFAULTS.flight.impulseGain, min: 0, max: 8 },
      maxClimbSpeed: { value: FLIGHT_LEVA_DEFAULTS.flight.maxClimbSpeed, min: 2, max: 20 },
      maxDescentSpeed: { value: FLIGHT_LEVA_DEFAULTS.flight.maxDescentSpeed, min: 2, max: 20 },
      diveSink: { value: FLIGHT_LEVA_DEFAULTS.flight.diveSink, min: 0, max: 30 },
    }),
    banking: folder({
      maxRollDeg: { value: FLIGHT_LEVA_DEFAULTS.flight.maxRollDeg, min: 0, max: 70 },
      lateralSpeedAtMaxBank: {
        value: FLIGHT_LEVA_DEFAULTS.flight.lateralSpeedAtMaxBank,
        min: 0,
        max: 25,
      },
      lateralRange: { value: FLIGHT_LEVA_DEFAULTS.flight.lateralRange, min: 5, max: 200 },
    }),
    bounds: folder({
      minAltitude: { value: FLIGHT_LEVA_DEFAULTS.flight.minAltitude, min: 0, max: 20 },
      maxAltitude: { value: FLIGHT_LEVA_DEFAULTS.flight.maxAltitude, min: 20, max: 200 },
    }),
  })

  const [boost] = useControls('Boost (rings)', () => ({ ...BOOST_SLIDERS }), [
    BOOST.speed,
    BOOST.durationSec,
  ])

  useEffect(() => {
    boostSpeedRef.current = boost.boostSpeed
    boostDurationRef.current = boost.boostDuration
  }, [boost.boostSpeed, boost.boostDuration, boostSpeedRef, boostDurationRef])

  useEffect(() => {
    actionsRef.current = {
      flap: actions.flap,
      flapImpulse: false,
      lean: actions.invertLean ? -actions.lean : actions.lean,
      dive: actions.dive,
      quack: actions.quack,
      egg67: actions.egg67,
      confidence: actions.confidence,
    }
  }, [
    actions.flap,
    actions.lean,
    actions.invertLean,
    actions.dive,
    actions.quack,
    actions.egg67,
    actions.confidence,
    actionsRef,
  ])

  useEffect(() => {
    cfgRef.current = { ...DEFAULT_FLIGHT, ...cfg }
  }, [cfg, cfgRef])

  const duckVisual: FlightRigProps['duckVisual'] = {
    scale: duckLeva.scale,
    modelYaw: duckLeva.modelYaw,
    crossfade: duckLeva.crossfade,
    flapAnimSpeed: FLAP_ANIM_SPEED,
  }

  const animCfg: AnimMapConfig = {
    ...DEFAULT_ANIM_MAP,
    flapActiveThreshold: duckLeva.flapActiveThreshold,
    turnThreshold: duckLeva.turnThreshold,
  }

  return {
    camCfg: camCfg as FollowCameraConfig,
    duckVisual,
    animCfg,
    showLevaPanel: opts.showPanel,
  }
}
