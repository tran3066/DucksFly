// Solo Infinite Run: streaming map + crash-ends-run. Uses shared `FlightGame` shell.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createInfiniteMap, type MapDef, type InfiniteMap } from '../map'
import { FlightGame, buildFlightRig } from './FlightGame'
import { computeStartCam, STANDARD_CAM_CFG } from './localFlightSetup'
import { useApplyLocalFlightDefaults } from './useApplyLocalFlightDefaults'
import { useFlightSession } from './useFlightSession'
import { startMusic, stopMusic } from './sfx'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import { BigStat, ExitButton } from './flightUi'
import {
  Button,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO as MONO,
  Overlay,
  Panel,
} from './ui'

function randomSeed(): number {
  return Math.floor(Math.random() * 100_000)
}

export function InfiniteRunGame({
  onExit,
  controlMode,
  onSetControlMode,
}: {
  onExit?: () => void
  controlMode: ControlMode
  onSetControlMode: (mode: ControlMode) => void
}) {
  const cameraControl = controlMode === 'camera'
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [])

  const [seed, setSeed] = useState(randomSeed)
  const streamerRef = useRef<InfiniteMap | null>(null)
  const [map, setMap] = useState<MapDef>(() => createInfiniteMap(seed).getMap())
  const [, setMapVersion] = useState(0)

  const session = useFlightSession({ makeInitialState: createFlightState })
  useApplyLocalFlightDefaults(session)
  const { stateRef, passedRingsRef, reset } = session

  const mapRef = useRef(map)
  mapRef.current = map

  const runningRef = useRef(true)
  const [gameOver, setGameOver] = useState(false)
  const [crashStats, setCrashStats] = useState<{ distance: number; rings: number } | null>(null)

  useEffect(() => {
    startMusic()
    return () => stopMusic()
  }, [])

  useEffect(() => {
    const streamer = createInfiniteMap(seed)
    streamerRef.current = streamer
    const initial = streamer.getMap()
    mapRef.current = initial
    setMap(initial)
    setMapVersion(streamer.getVersion())
    reset()
    setGameOver(false)
    setCrashStats(null)
  }, [seed, reset])

  useEffect(() => {
    const id = window.setInterval(() => {
      const streamer = streamerRef.current
      if (!streamer || gameOver) return
      const z = stateRef.current.position[2]
      if (streamer.update(z)) {
        const next = streamer.getMap()
        mapRef.current = next
        setMap(next)
        setMapVersion(streamer.getVersion())
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [stateRef, gameOver])

  const onGameOver = useCallback(() => {
    setCrashStats({
      distance: stateRef.current.distance,
      rings: passedRingsRef.current.size,
    })
    setGameOver(true)
    stopMusic()
  }, [passedRingsRef, stateRef])

  const restart = useCallback(() => {
    setSeed(randomSeed())
    startMusic()
  }, [])

  const rig = buildFlightRig(session, {
    mapRef,
    cameraControl,
    runningRef,
    enableFinish: false,
    variant: 'male',
    crashEndsRun: true,
    onGameOver,
  })

  return (
    <FlightGame
      map={map}
      startCam={computeStartCam()}
      camCfg={STANDARD_CAM_CFG}
      session={session}
      rig={rig}
      cameraControl={cameraControl}
      showControlsHint
      controlsHintVariant="infinite"
      overlay={
        <>
          <InfiniteHud stateRef={stateRef} passedRingsRef={passedRingsRef} frozen={gameOver} />
          {gameOver && crashStats && (
            <GameOverOverlay stats={crashStats} onRestart={restart} onExit={onExit} />
          )}
        </>
      }
      chrome={
        <>
          <ControlModeToggle
            mode={cameraControl ? 'camera' : 'keyboard'}
            onChange={onSetControlMode}
            style={{ top: 20, right: 230 }}
          />
          {onExit && <ExitButton onExit={onExit} style={{ right: 20 }} />}
        </>
      }
    />
  )
}

function InfiniteHud({
  stateRef,
  passedRingsRef,
  frozen,
}: {
  stateRef: React.RefObject<{ distance: number }>
  passedRingsRef: React.RefObject<Set<number>>
  frozen: boolean
}) {
  const [snap, setSnap] = useState({ distance: 0, rings: 0 })
  const frozenDistRef = useRef<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (frozen) {
        if (frozenDistRef.current == null) frozenDistRef.current = stateRef.current.distance
      } else {
        frozenDistRef.current = null
      }
      setSnap({
        distance: frozenDistRef.current ?? stateRef.current.distance,
        rings: passedRingsRef.current.size,
      })
    }, 100)
    return () => clearInterval(id)
  }, [stateRef, passedRingsRef, frozen])

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
      <BigStat label="DISTANCE" value={`${snap.distance.toFixed(0)} m`} accent={COLORS.cyanDeep} />
      <BigStat label="RINGS" value={String(snap.rings)} accent={COLORS.gold} />
    </div>
  )
}

function GameOverOverlay({
  stats,
  onRestart,
  onExit,
}: {
  stats: { distance: number; rings: number }
  onRestart: () => void
  onExit?: () => void
}) {
  return (
    <Overlay dim={0.5}>
      <Panel width={440} style={{ textAlign: 'center', padding: '34px 44px' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.1rem',
            fontWeight: 700,
            color: COLORS.slate,
            marginBottom: 8,
          }}
        >
          💥 Crashed
        </div>
        <p style={{ color: COLORS.slateDim, margin: '0 0 24px', fontWeight: 500 }}>
          Your infinite run is over.
        </p>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', margin: '0 0 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color: COLORS.cyanDeep }}>
              {stats.distance.toFixed(0)}m
            </span>
            <span style={{ color: COLORS.slateDim, fontFamily: MONO, fontSize: '0.7rem', letterSpacing: 1.5 }}>
              DISTANCE
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color: COLORS.yellowDeep }}>
              {stats.rings}
            </span>
            <span style={{ color: COLORS.slateDim, fontFamily: MONO, fontSize: '0.7rem', letterSpacing: 1.5 }}>
              RINGS
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 13, justifyContent: 'center' }}>
          <Button variant="primary" onClick={onRestart}>
            Restart
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
