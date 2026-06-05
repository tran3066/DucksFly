// Single-player race: finite course + finish overlay. Flight/camera/duck tuning
// lives in `localFlightSetup` (defaults) and `useFlightLevaTuning` (debug Leva).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Leva, useControls } from 'leva'
import { getRacePB, recordSession } from '../data/flightStore'
import { buildMap, DEFAULT_MAP_CONFIG, type MapDef } from '../map'
import { formatRaceDistance } from './raceDistance'
import { computeStartCam } from './localFlightSetup'
import { createFlightState } from './flight'
import { MainGameRunner } from './MainGameRunner'
import { useFlightSession } from './useFlightSession'
import { useApplyLocalFlightDefaults } from './useApplyLocalFlightDefaults'
import { useFlightLevaTuning } from './useFlightLevaTuning'
import { startMusic, stopMusic, playFinish } from './sfx'
import { type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import {
  FlightDebugHud,
  GameChrome,
  LiveStatHud,
  ResultOverlay,
  useDebugToggle,
} from './flightUi'
import { COLORS, FONT_MONO as MONO, formatTime } from './ui'

export function SingleplayerRaceRunGame({
  targetDist,
  onExit,
  controlMode,
  onSetControlMode,
}: {
  targetDist: number
  onExit?: () => void
  controlMode: ControlMode
  onSetControlMode: (mode: ControlMode) => void
}) {
  const cameraControl = controlMode === 'camera'

  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [])

  useEffect(() => {
    startMusic()
    return () => stopMusic()
  }, [])

  const session = useFlightSession({ makeInitialState: createFlightState })
  useApplyLocalFlightDefaults(session)
  const { stateRef, mergedActionsRef, passedRingsRef, boostRef, clipRef, fireImpulse, reset } = session

  const runningRef = useRef(true)
  const debug = useDebugToggle()
  const [finished, setFinished] = useState(false)
  const runStartRef = useRef(0)
  const [finishStats, setFinishStats] = useState<{ ms: number; rings: number; distance: number } | null>(null)

  const recordedRef = useRef(false)
  const onFinish = useCallback(() => {
    const ms = performance.now() - runStartRef.current
    const rings = passedRingsRef.current.size
    const distance = stateRef.current.distance
    setFinishStats({ ms, rings, distance })
    setFinished(true)
    stopMusic()
    playFinish()
    if (!recordedRef.current) {
      recordedRef.current = true
      recordSession({
        mode: 'race',
        control: session.usedKeyboardRef.current ? 'kb' : 'cam',
        flyS: session.flySRef.current,
        distance,
        rings,
        targetDist,
        timeMs: ms,
        finished: true,
      })
    }
  }, [passedRingsRef, stateRef, session, targetDist])

  const resetState = useCallback(() => {
    reset()
    recordedRef.current = false
    runStartRef.current = performance.now()
    setFinished(false)
    setFinishStats(null)
    startMusic()
  }, [reset])

  const world = useControls('World', {
    seed: { value: 1337, min: 0, max: 99999, step: 1 },
  })
  const map = useMemo(
    () => buildMap(world.seed, { ...DEFAULT_MAP_CONFIG, length: targetDist }),
    [world.seed, targetDist],
  )
  const mapRef = useRef<MapDef>(map)
  mapRef.current = map

  // Reset the run when the seed/distance (and thus the map) changes. The React
  // state clears use the adjust-on-change render pattern; the ref re-init, timer,
  // and music restart run in an effect so nothing impure happens during render
  // (keeps react-hooks/set-state-in-effect + purity satisfied).
  const [prevMap, setPrevMap] = useState(map)
  if (prevMap !== map) {
    setPrevMap(map)
    setFinished(false)
    setFinishStats(null)
  }
  useEffect(() => {
    reset()
    recordedRef.current = false
    runStartRef.current = performance.now()
    startMusic()
  }, [map, reset])

  const { camCfg, duckVisual, animCfg } = useFlightLevaTuning(session, {
    showPanel: debug,
    fireImpulse,
    onReset: resetState,
  })

  return (
    <MainGameRunner
      map={map}
      startCam={computeStartCam()}
      camCfg={camCfg}
      session={session}
      cameraControl={cameraControl}
      showControlsHint
      leva={debug ? <Leva /> : null}
      rig={{
        mapRef,
        cameraControl,
        runningRef,
        enableFinish: true,
        duckVisual,
        animCfg,
        variant: 'male',
        onFinish,
      }}
      overlay={
        <>
          <LiveStatHud
            frozen={finished}
            stats={[
              { label: 'TIME', read: () => formatTime(performance.now() - runStartRef.current) },
              {
                label: 'RINGS',
                read: () => String(passedRingsRef.current.size),
                suffix: `/ ${map.rings.length}`,
                accent: COLORS.gold,
              },
            ]}
          />
          <RaceDistanceBadge distanceLabel={formatRaceDistance(targetDist)} />
          {finished && finishStats && (
            <FinishOverlay
              stats={finishStats}
              targetDist={targetDist}
              control={session.usedKeyboardRef.current ? 'kb' : 'cam'}
              onReset={resetState}
              onExit={onExit}
            />
          )}
        </>
      }
      chrome={
        <>
          {debug && (
            <FlightDebugHud
              stateRef={stateRef}
              actionsRef={mergedActionsRef}
              clipRef={clipRef}
              boostRef={boostRef}
              passedRingsRef={passedRingsRef}
            />
          )}
          <GameChrome
            cameraControl={cameraControl}
            onSetControlMode={onSetControlMode}
            onExit={onExit}
          />
        </>
      }
    />
  )
}

function RaceDistanceBadge({ distanceLabel }: { distanceLabel: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: 20,
        padding: '8px 14px',
        background: 'rgba(10,18,30,0.66)',
        border: '1px solid rgba(120,150,180,0.18)',
        borderRadius: 10,
        backdropFilter: 'blur(6px)',
        pointerEvents: 'none',
        fontFamily: MONO,
        fontSize: '0.82rem',
        fontWeight: 700,
        letterSpacing: 1,
        color: COLORS.hudDim,
      }}
    >
      RACE · <span style={{ color: COLORS.hudText }}>{distanceLabel}</span>
    </div>
  )
}

function FinishOverlay({
  stats,
  targetDist,
  control,
  onReset,
  onExit,
}: {
  stats: { ms: number; rings: number; distance: number }
  targetDist: number
  control: 'kb' | 'cam'
  onReset: () => void
  onExit?: () => void
}) {
  const pb = getRacePB(targetDist, control)
  const newTimePb = !pb || stats.ms < pb.bestTimeMs
  const newRingsPb = !pb || stats.rings > pb.bestRings
  const newPb = newTimePb || newRingsPb
  return (
    <ResultOverlay
      width={470}
      title={
        <>
          🏁 <span style={{ color: COLORS.orange }}>Finish!</span>
        </>
      }
      badge={newPb ? '★ New personal best!' : undefined}
      subtitle={`${formatRaceDistance(targetDist)} race · Nice flying.`}
      stats={[
        { label: 'TIME', value: formatTime(stats.ms), color: COLORS.cyanDeep },
        { label: 'RINGS', value: String(stats.rings), color: COLORS.yellowDeep },
        { label: 'DISTANCE', value: `${stats.distance.toFixed(0)}m`, color: COLORS.slate },
      ]}
      primary={{ label: 'Fly again', onClick: onReset }}
      secondary={onExit ? { label: '← Menu', onClick: onExit } : undefined}
    />
  )
}
