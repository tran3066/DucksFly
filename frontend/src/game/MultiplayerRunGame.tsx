// Multiplayer: shared `MainGameRunner` + `localFlightSetup` defaults + backend sync.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Quaternion } from 'three'
import type { DuckState } from '../physics'
import { buildMap, type MapDef } from '../map'
import type { DuckVariant } from '../avatar/loadDuck'
import { createFlightState } from './flight'
import { MainGameRunner } from './MainGameRunner'
import { applyLocalFlightDefaults, computeStartCam, STANDARD_CAM_CFG } from './localFlightSetup'
import { useApplyLocalFlightDefaults } from './useApplyLocalFlightDefaults'
import { useFlightSession } from './useFlightSession'
import { startMusic, stopMusic, playFinish } from './sfx'
import { Minimap } from './Minimap'
import { RemoteDucks } from './RemoteDuck'
import { type ControlMode } from './ModeChooser'
import { FlightDebugHud, GameChrome, useDebugToggle } from './flightUi'
import { useCalibrationStore } from '../input/calibration'
import { raceConnection } from '../net/connection'
import { useRace } from '../net/useRace'
import { POSITION_SEND_HZ } from '@shared/constants'
import { RaceScreens } from './screens/RaceScreens'
import { rankPlayers } from './screens/parts'
import { recordSession } from '../data/flightStore'

const SPAWN_SPACING = 5

function spawnState(playerIndex: number): DuckState {
  const s = createFlightState()
  s.position = [playerIndex * SPAWN_SPACING, s.position[1], s.position[2]]
  return s
}

const _euler = new Euler()
const _quat = new Quaternion()

function poseToQuat(yaw: number, pitch: number, roll: number): [number, number, number, number] {
  _euler.set(pitch, yaw, roll, 'YXZ')
  _quat.setFromEuler(_euler)
  return [_quat.x, _quat.y, _quat.z, _quat.w]
}

export function MultiplayerRunGame({
  onExit,
  controlMode,
  onSetControlMode,
}: {
  onExit?: () => void
  controlMode: ControlMode
  onSetControlMode: (mode: ControlMode) => void
}) {
  const race = useRace()
  const cameraControl = controlMode === 'camera'
  const debug = useDebugToggle()

  const racing = race.phase === 'racing'
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(!racing)
    return () => useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [racing])

  const session = useFlightSession({ makeInitialState: () => spawnState(0) })
  useApplyLocalFlightDefaults(session)
  const { stateRef, mergedActionsRef, clipRef, boostRef, passedRingsRef, reset } = session

  const finishedStreamRef = useRef(false)
  const [localFinished, setLocalFinished] = useState(false)
  const crashCountRef = useRef(0)

  const runningRef = useRef(false)
  runningRef.current = race.phase === 'racing'

  const self = race.players.find((p) => p.id === race.sessionId)
  const variant: DuckVariant = self?.duckVariant ?? 'male'
  const finished = localFinished || (self?.finished ?? false)

  const musicShouldPlay = race.phase === 'countdown' || race.phase === 'racing'
  useEffect(() => {
    if (musicShouldPlay) startMusic()
    else stopMusic()
  }, [musicShouldPlay])
  useEffect(() => () => stopMusic(), [])

  const playersRef = useRef(race.players)
  playersRef.current = race.players
  const sessionIdRef = useRef(race.sessionId)
  sessionIdRef.current = race.sessionId

  const map = useMemo(() => buildMap(race.mapSeed || 1337), [race.mapSeed])
  const mapRef = useRef<MapDef>(map)
  mapRef.current = map
  const ringCount = map.rings.length

  // Clear the local-finished flag when a race (re)starts. Done via the
  // adjust-on-change render pattern so the direct setState stays out of the effect
  // below (react-hooks/set-state-in-effect); the ref/baseline re-init stays in the
  // effect since those are not React state.
  const [prevRacing, setPrevRacing] = useState(racing)
  if (prevRacing !== racing) {
    setPrevRacing(racing)
    if (racing) setLocalFinished(false)
  }
  useEffect(() => {
    if (race.phase !== 'racing') return
    const index = Math.max(0, playersRef.current.findIndex((p) => p.id === sessionIdRef.current))
    reset(spawnState(index))
    applyLocalFlightDefaults(session)
    finishedStreamRef.current = false
    crashCountRef.current = 0
  }, [race.phase, reset, session])

  useEffect(() => {
    if (race.phase !== 'racing') return
    const id = window.setInterval(() => {
      const s = stateRef.current
      raceConnection.sendState({
        pos: [s.position[0], s.position[1], s.position[2]],
        vel: [s._lean, s.verticalVel, s.speed],
        quat: poseToQuat(s.yaw, s.pitch, s.roll),
        ringsPassed: passedRingsRef.current.size,
        collisions: crashCountRef.current,
        finished: finishedStreamRef.current,
      })
    }, 1000 / POSITION_SEND_HZ)
    return () => window.clearInterval(id)
  }, [race.phase, passedRingsRef, stateRef])

  const onCrash = useRef(() => {
    crashCountRef.current += 1
  }).current

  const onFinish = useRef(() => {
    finishedStreamRef.current = true
    setLocalFinished(true)
    stopMusic()
    playFinish()
  }).current

  // Record exactly one session when the race ends. `race.phase` flips to
  // 'finished' once; guard against the ~20 Hz snapshot re-renders. DNF still
  // records (games++ + aggregates) with won/finished false. Distance/rings/flyS
  // come from the LOCAL sim (PlayerView has no distance).
  const recordedRef = useRef(false)
  useEffect(() => {
    if (race.phase !== 'finished') {
      recordedRef.current = false
      return
    }
    if (recordedRef.current) return
    recordedRef.current = true
    const finishedSelf = self?.finished ?? false
    const won =
      finishedSelf &&
      rankPlayers(playersRef.current).find((p) => p.finished)?.id === sessionIdRef.current
    recordSession({
      mode: 'multiplayer',
      control: session.usedKeyboardRef.current ? 'kb' : 'cam',
      flyS: session.flySRef.current,
      distance: stateRef.current.distance,
      rings: passedRingsRef.current.size,
      won,
      finished: finishedSelf,
    })
  }, [race.phase, self, session, stateRef, passedRingsRef])

  return (
    <MainGameRunner
      map={map}
      startCam={computeStartCam(stateRef.current.position)}
      camCfg={STANDARD_CAM_CFG}
      session={session}
      cameraControl={cameraControl}
      rig={{
        mapRef,
        cameraControl,
        runningRef,
        enableFinish: true,
        variant,
        onFinish,
        onCrash,
      }}
      sceneChildren={<RemoteDucks players={race.players} sessionId={race.sessionId} />}
      overlay={
        <>
          {racing && (
            <Minimap
              stateRef={stateRef}
              players={race.players}
              sessionId={race.sessionId}
              length={map.length}
              halfWidth={map.halfWidth}
            />
          )}
          <RaceScreens
            race={race}
            self={self}
            ringCount={ringCount}
            finished={finished}
            onExit={onExit}
          />
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
            showControlToggle={!racing}
            controlToggleStyle={{ top: 12, left: 12 }}
          />
        </>
      }
    />
  )
}
