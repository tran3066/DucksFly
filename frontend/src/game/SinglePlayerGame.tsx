// Single-player race: finite course + finish overlay. Flight/camera/duck tuning
// lives in `localFlightSetup` (defaults) and `useFlightLevaTuning` (debug Leva).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Leva, useControls } from 'leva'
import { getRacePB, type Control } from '../data/flightStore'
import { buildMap, DEFAULT_MAP_CONFIG, type MapDef } from '../map'
import { formatRaceDistance } from './raceDistance'
import { computeStartCam } from './localFlightSetup'
import { createFlightState } from './flight'
import { FlightGame, buildFlightRig } from './FlightGame'
import { useFlightSession } from './useFlightSession'
import { useFlightLevaTuning } from './useFlightLevaTuning'
import { startMusic, stopMusic, playFinish } from './sfx'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import { BigStat, DebugToggle, ExitButton, FlightDebugHud } from './flightUi'
import {
  Button,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO as MONO,
  Overlay,
  Panel,
  formatTime,
} from './ui'

export function SinglePlayerGame({
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
  const {
    stateRef,
    mergedActionsRef,
    finishedRef,
    passedRingsRef,
    boostRef,
    clipRef,
    fireImpulse,
    reset,
  } = session

  const runningRef = useRef(true)
  const [debug, setDebug] = useState(false)
  const [finished, setFinished] = useState(false)
  const runStartRef = useRef(performance.now())
  const [finishStats, setFinishStats] = useState<{ ms: number; rings: number; distance: number } | null>(null)

  const onFinish = useCallback(() => {
    setFinishStats({
      ms: performance.now() - runStartRef.current,
      rings: passedRingsRef.current.size,
      distance: stateRef.current.distance,
    })
    setFinished(true)
    stopMusic()
    playFinish()
  }, [passedRingsRef, stateRef])

  const resetState = useCallback(() => {
    reset()
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

  useEffect(() => {
    resetState()
  }, [world.seed, targetDist, resetState])

  const { camCfg, duckVisual, animCfg, showLevaPanel } = useFlightLevaTuning(session, {
    showPanel: debug,
    fireImpulse,
    onReset: resetState,
  })

  const rig = buildFlightRig(session, {
    mapRef,
    cameraControl,
    runningRef,
    enableFinish: true,
    duckVisual,
    animCfg,
    variant: 'male',
    onFinish,
  })

  return (
    <FlightGame
      map={map}
      startCam={computeStartCam()}
      camCfg={camCfg}
      session={session}
      rig={rig}
      cameraControl={cameraControl}
      showControlsHint
      leva={showLevaPanel ? <Leva /> : null}
      overlay={
        <>
          <RaceStats
            runStartRef={runStartRef}
            finishedRef={finishedRef}
            passedRingsRef={passedRingsRef}
            ringCount={map.rings.length}
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
          <DebugToggle debug={debug} onToggle={() => setDebug((d) => !d)} />
          <ControlModeToggle
            mode={cameraControl ? 'camera' : 'keyboard'}
            onChange={onSetControlMode}
            style={{ top: 20, right: 230 }}
          />
          {onExit && <ExitButton onExit={onExit} />}
        </>
      }
    />
  )
}

function RaceStats({
  runStartRef,
  finishedRef,
  passedRingsRef,
  ringCount,
}: {
  runStartRef: React.RefObject<number>
  finishedRef: React.RefObject<boolean>
  passedRingsRef: React.RefObject<Set<number>>
  ringCount: number
}) {
  const [snap, setSnap] = useState({ ms: 0, rings: 0 })
  const frozenMsRef = useRef<number | null>(null)
  useEffect(() => {
    const id = setInterval(() => {
      if (finishedRef.current) {
        if (frozenMsRef.current == null) frozenMsRef.current = performance.now() - runStartRef.current
      } else {
        frozenMsRef.current = null
      }
      setSnap({
        ms: frozenMsRef.current ?? performance.now() - runStartRef.current,
        rings: passedRingsRef.current.size,
      })
    }, 100)
    return () => clearInterval(id)
  }, [runStartRef, finishedRef, passedRingsRef])

  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 12,
      }}
    >
      <BigStat label="TIME" value={formatTime(snap.ms)} />
      <BigStat label="RINGS" value={`${snap.rings}`} suffix={`/ ${ringCount}`} accent={COLORS.gold} />
    </div>
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
  control: Control
  onReset: () => void
  onExit?: () => void
}) {
  const pb = getRacePB(targetDist, control)
  const newTimePb = !pb || stats.ms < pb.bestTimeMs
  const newRingsPb = !pb || stats.rings > pb.bestRings
  const newPb = newTimePb || newRingsPb
  const stat = (label: string, value: string, color: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </span>
      <span
        style={{
          color: COLORS.slateDim,
          fontFamily: MONO,
          fontSize: '0.7rem',
          letterSpacing: 1.5,
        }}
      >
        {label}
      </span>
    </div>
  )
  return (
    <Overlay dim={0.5}>
      <Panel width={470} style={{ textAlign: 'center', padding: '34px 44px' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.2rem',
            fontWeight: 700,
            color: COLORS.slate,
            marginBottom: 4,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
          }}
        >
          🏁 <span style={{ color: COLORS.orange }}>Finish!</span>
        </div>
        {newPb && (
          <p
            style={{
              color: COLORS.gold,
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: '1.15rem',
              margin: '0 0 8px',
            }}
          >
            ★ New personal best!
          </p>
        )}
        <p style={{ color: COLORS.slateDim, margin: '0 0 26px', fontWeight: 500 }}>
          {formatRaceDistance(targetDist)} race · Nice flying.
        </p>
        <div style={{ display: 'flex', gap: 38, justifyContent: 'center', margin: '0 0 28px' }}>
          {stat('TIME', formatTime(stats.ms), COLORS.cyanDeep)}
          {stat('RINGS', String(stats.rings), COLORS.yellowDeep)}
          {stat('DISTANCE', `${stats.distance.toFixed(0)}m`, COLORS.slate)}
        </div>
        <div style={{ display: 'flex', gap: 13, justifyContent: 'center' }}>
          <Button variant="primary" onClick={onReset}>
            Fly again
          </Button>
          {onExit && (
            <Button variant="ghost" onClick={onExit}>
              ← Menu
            </Button>
          )}
        </div>
      </Panel>
    </Overlay>
  )
}
