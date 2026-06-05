// The single shared flight runner. Owns `FlightScene` (Canvas + sky + map + rig +
// camera) plus the crash flash and "6-7" overlay, and builds the `FlightRig` props
// from a mode's `FlightSession` + a small `rig` options bundle. Every mode
// (SingleplayerRaceRunGame, MultiplayerRunGame, InfiniteRunGame) mounts exactly one
// <MainGameRunner>; mode-specific networking / finish screens / streaming stay in
// the mode files and are passed in via `overlay`, `chrome`, and `sceneChildren`.

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

/** Mode-specific knobs for the shared rig. Everything else comes from the session. */
export type RigOptions = {
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
  /** Infinite Run only: a crash ends the run instead of respawning. */
  crashEndsRun?: boolean
  onGameOver?: () => void
}

export type MainGameRunnerProps = {
  map: MapDef
  startCam: [number, number, number]
  camCfg: FollowCameraConfig
  session: FlightSession
  /** Mode-specific rig knobs; the runner wires crash/game-over/6-7 internally. */
  rig: RigOptions
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

export function MainGameRunner({
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
}: MainGameRunnerProps) {
  const { crashAt, onCrash: flashCrash, sixSevenCount, onSixSeven: popSixSeven } = useFlightFeedback()

  const modeOnCrash = rig.onCrash
  const modeOnGameOver = rig.onGameOver

  const onCrash = useCallback(() => {
    flashCrash()
    modeOnCrash?.()
  }, [flashCrash, modeOnCrash])

  const onGameOver = useCallback(() => {
    flashCrash()
    modeOnGameOver?.()
  }, [flashCrash, modeOnGameOver])

  const mergedRig = useMemo<FlightRigProps>(
    () => ({
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
      mapRef: rig.mapRef,
      cameraControl: rig.cameraControl,
      runningRef: rig.runningRef,
      enableFinish: rig.enableFinish,
      variant: rig.variant,
      duckVisual: rig.duckVisual ?? STANDARD_DUCK_VISUAL,
      animCfg: rig.animCfg ?? STANDARD_ANIM_CFG,
      onFinish: rig.onFinish,
      onRingPassed: rig.onRingPassed,
      crashEndsRun: rig.crashEndsRun,
      onCrash,
      onGameOver: modeOnGameOver ? onGameOver : undefined,
      onSixSeven: popSixSeven,
    }),
    [session, rig, onCrash, onGameOver, modeOnGameOver, popSixSeven],
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
