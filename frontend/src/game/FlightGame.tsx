// Shared local-player flight shell: `FlightScene` + `FlightRig` wiring used by
// solo race, infinite run, and multiplayer. Mode wrappers (SinglePlayerGame,
// MultiplayerGame, InfiniteRunGame) own networking and finish screens; duck/cam/flight
// defaults live in `localFlightSetup`, optional Leva in `useFlightLevaTuning`.
// they pass a built rig + overlays into this component so quack, 6-7, crash
// flash, and the scene never diverge between modes.

import { useCallback, useMemo, type ReactNode } from 'react'
import type { AnimMapConfig } from '../avatar/animationMap'
import type { FollowCameraConfig } from '../avatar/followConfig'
import type { DuckVariant } from '../avatar/loadDuck'
import type { MapDef } from '../map'
import { FlightScene } from './FlightScene'
import type { FlightRigProps } from './FlightRig'
import { CrashFlash } from './CrashFlash'
import { SixSevenOverlay } from './SixSevenOverlay'
import { useFlightFeedback } from './useFlightFeedback'
import type { FlightSession } from './useFlightSession'
import { ControlsHint, type ControlsHintVariant } from './flightUi'
import { STANDARD_ANIM_CFG, STANDARD_DUCK_VISUAL } from './localFlightSetup'
import { FONT, UI_KEYFRAMES } from './ui'

/** Options every mode shares when constructing a `FlightRig`. */
export type FlightRigBuildOptions = {
  mapRef: React.RefObject<MapDef>
  cameraControl: boolean
  runningRef: React.RefObject<boolean>
  enableFinish: boolean
  /** Omit to use `STANDARD_DUCK_VISUAL` from `localFlightSetup`. */
  duckVisual?: FlightRigProps['duckVisual']
  /** Omit to use `STANDARD_ANIM_CFG` from `localFlightSetup`. */
  animCfg?: AnimMapConfig
  variant?: DuckVariant
  onFinish?: () => void
  /** Extra handler after the shared crash flash (e.g. MP crash tally). */
  onCrash?: () => void
  onRingPassed?: (ringId: number) => void
  crashEndsRun?: boolean
  onGameOver?: () => void
}

/** Build rig props from the session hook + mode-specific overrides. */
export function buildFlightRig(session: FlightSession, opts: FlightRigBuildOptions): FlightRigProps {
  const { duckVisual, animCfg, ...rest } = opts
  return {
    stateRef: session.stateRef,
    actionsRef: session.actionsRef,
    cfgRef: session.cfgRef,
    impulseRef: session.impulseRef,
    duckRef: session.duckGroupRef,
    clipRef: session.clipRef,
    keyRef: session.keyRef,
    mergedRef: session.mergedActionsRef,
    passedRingsRef: session.passedRingsRef,
    ringPulseAtRef: session.ringPulseAtRef,
    boostRef: session.boostRef,
    boostSpeedRef: session.boostSpeedRef,
    boostDurationRef: session.boostDurationRef,
    finishedRef: session.finishedRef,
    flySRef: session.flySRef,
    usedKeyboardRef: session.usedKeyboardRef,
    onRingsChanged: session.syncRings,
    duckVisual: duckVisual ?? STANDARD_DUCK_VISUAL,
    animCfg: animCfg ?? STANDARD_ANIM_CFG,
    ...rest,
  }
}

export type FlightGameProps = {
  map: MapDef
  startCam: [number, number, number]
  camCfg: FollowCameraConfig
  session: FlightSession
  /** Rig from `buildFlightRig`; `onCrash` / `onSixSeven` may be omitted — this shell wires them. */
  rig: FlightRigProps
  /** Three.js children inside the scene (e.g. `RemoteDucks`). */
  sceneChildren?: ReactNode
  /** DOM overlays on top of the canvas (HUD, minimap, race screens, finish). */
  overlay?: ReactNode
  cameraControl: boolean
  showControlsHint?: boolean
  controlsHintVariant?: ControlsHintVariant
  /** Optional Leva panel slot (solo race debug). */
  leva?: ReactNode
  /** Extra chrome after the shared layers (debug HUD, control toggle, exit). */
  chrome?: ReactNode
}

export function FlightGame({
  map,
  startCam,
  camCfg,
  session,
  rig,
  sceneChildren,
  overlay,
  cameraControl,
  showControlsHint = false,
  controlsHintVariant = 'race',
  leva,
  chrome,
}: FlightGameProps) {
  const { crashAt, onCrash: flashCrash, sixSevenCount, onSixSeven: popSixSeven } = useFlightFeedback()

  const onCrash = useCallback(() => {
    flashCrash()
    rig.onCrash?.()
  }, [flashCrash, rig.onCrash])

  const onGameOver = useCallback(() => {
    flashCrash()
    rig.onGameOver?.()
  }, [flashCrash, rig.onGameOver])

  const onSixSeven = rig.onSixSeven ?? popSixSeven

  const mergedRig = useMemo(
    (): FlightRigProps => ({
      ...rig,
      onCrash,
      onGameOver: rig.onGameOver ? onGameOver : undefined,
      onSixSeven,
    }),
    [rig, onCrash, onGameOver, onSixSeven],
  )

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: FONT }}>
      <style>{UI_KEYFRAMES}</style>
      {leva}
      <FlightScene
        map={map}
        startCam={startCam}
        camCfg={camCfg}
        passedRingIds={session.passedRingIds}
        ringPulseAt={session.ringPulseAt}
        rig={mergedRig}
      >
        {sceneChildren}
      </FlightScene>

      <CrashFlash at={crashAt} />
      <SixSevenOverlay trigger={sixSevenCount} />

      {overlay}
      {chrome}
      {showControlsHint && <ControlsHint cameraControl={cameraControl} variant={controlsHintVariant} />}
    </div>
  )
}
