// Solo Infinite Run: streaming map + crash-ends-run. Uses shared `MainGameRunner`.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createInfiniteMap, type MapDef, type InfiniteMap } from '../map'
import { recordSession } from '../data/flightStore'
import { createFlightState } from './flight'
import { MainGameRunner } from './MainGameRunner'
import { computeStartCam, STANDARD_CAM_CFG } from './localFlightSetup'
import { useApplyLocalFlightDefaults } from './useApplyLocalFlightDefaults'
import { useFlightSession } from './useFlightSession'
import { startMusic, stopMusic } from './sfx'
import { type ControlMode } from './ModeChooser'
import { FlightDebugHud, GameChrome, LiveStatHud, ResultOverlay, useDebugToggle } from './flightUi'
import { useCalibrationStore } from '../input/calibration'
import { COLORS } from './ui'

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
  const debug = useDebugToggle()
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [])

  const [seed, setSeed] = useState(randomSeed)
  const streamerRef = useRef<InfiniteMap | null>(null)
  if (streamerRef.current === null) streamerRef.current = createInfiniteMap(seed)
  const [map, setMap] = useState<MapDef>(() => streamerRef.current!.getMap())
  const [, setMapVersion] = useState(0)

  const session = useFlightSession({ makeInitialState: createFlightState })
  useApplyLocalFlightDefaults(session)
  const { stateRef, mergedActionsRef, clipRef, boostRef, passedRingsRef, reset } = session

  const mapRef = useRef(map)
  mapRef.current = map

  const runningRef = useRef(true)
  const recordedRef = useRef(false)
  const [gameOver, setGameOver] = useState(false)
  const [crashStats, setCrashStats] = useState<{ distance: number; rings: number } | null>(null)

  useEffect(() => {
    startMusic()
    return () => stopMusic()
  }, [])

  // Start a fresh run when the seed changes (Restart). Uses the adjust-on-change
  // render pattern: React state updates + the (deterministic) streamer/ref rebuild
  // happen here instead of in an effect, keeping direct setState out of effects.
  const [prevSeed, setPrevSeed] = useState(seed)
  if (prevSeed !== seed) {
    setPrevSeed(seed)
    const streamer = createInfiniteMap(seed)
    streamerRef.current = streamer
    setMap(streamer.getMap())
    setMapVersion(streamer.getVersion())
    setGameOver(false)
    setCrashStats(null)
    reset()
    recordedRef.current = false
  }

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
    const distance = stateRef.current.distance
    const rings = passedRingsRef.current.size
    setCrashStats({ distance, rings })
    setGameOver(true)
    stopMusic()
    if (!recordedRef.current) {
      recordedRef.current = true
      recordSession({
        mode: 'infinite',
        control: session.usedKeyboardRef.current ? 'kb' : 'cam',
        flyS: session.flySRef.current,
        distance,
        rings,
        crashes: 1,
      })
    }
  }, [passedRingsRef, stateRef, session])

  const restart = useCallback(() => {
    setSeed(randomSeed())
    startMusic()
  }, [])

  return (
    <MainGameRunner
      map={map}
      startCam={computeStartCam()}
      camCfg={STANDARD_CAM_CFG}
      session={session}
      cameraControl={cameraControl}
      showControlsHint
      controlsHintVariant="infinite"
      rig={{
        mapRef,
        cameraControl,
        runningRef,
        enableFinish: false,
        variant: 'male',
        crashEndsRun: true,
        onGameOver,
      }}
      overlay={
        <>
          <LiveStatHud
            frozen={gameOver}
            stats={[
              {
                label: 'DISTANCE',
                read: () => `${stateRef.current.distance.toFixed(0)} m`,
                accent: COLORS.cyanDeep,
              },
              { label: 'RINGS', read: () => String(passedRingsRef.current.size), accent: COLORS.gold },
            ]}
          />
          {gameOver && crashStats && (
            <ResultOverlay
              width={440}
              title="💥 Crashed"
              subtitle="Your infinite run is over."
              stats={[
                { label: 'DISTANCE', value: `${crashStats.distance.toFixed(0)}m`, color: COLORS.cyanDeep },
                { label: 'RINGS', value: String(crashStats.rings), color: COLORS.yellowDeep },
              ]}
              primary={{ label: 'Restart', onClick: restart }}
              secondary={onExit ? { label: '← Menu', onClick: onExit } : undefined}
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
