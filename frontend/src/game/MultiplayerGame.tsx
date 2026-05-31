// Multiplayer game: the SAME canonical flight (shared `FlightScene` + `FlightRig`) with the
// backend sync layer (`net/*`) wired on top. Each browser simulates its own duck locally
// (client-authoritative) and streams pos/vel/quat ~20x/sec; the server relays everyone else.
//
// The course (rings, trees, finish line) is built entirely on the client from the shared
// `mapSeed` — the server holds no ring/map geometry. Finishing is client-detected exactly
// like single-player (`enableFinish`): the duck freezes at the finish line and we fold a
// `finished` flag (plus rings + crash counts) into the pose stream. The server just stamps a
// finish time, runs the grace window, and ranks. Every overlay lives in `screens/`; this file
// only owns the scene + sim wiring and hands the live snapshot to `<RaceScreens>`.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Euler, Group, Quaternion } from 'three'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { useKeyboardControls } from '../input/keyboard'
import { buildMap, type MapDef } from '../map'
import { DEFAULT_FOLLOW } from '../avatar/followConfig'
import { DEFAULT_ANIM_MAP } from '../avatar/animationMap'
import type { DuckVariant } from '../avatar/loadDuck'
import { createFlightState, DEFAULT_FLIGHT, type FlightConfig } from './flight'
import { BOOST } from './gameConfig'
import { FLAP_ANIM_SPEED } from './gestureConfig'
import { FlightScene } from './FlightScene'
import type { FlightRigProps } from './FlightRig'
import { CrashFlash } from './CrashFlash'
import { startMusic, stopMusic, playFinish } from './sfx'
import { Minimap } from './Minimap'
import { RemoteDucks } from './RemoteDuck'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import { raceConnection } from '../net/connection'
import { useRace } from '../net/useRace'
import { POSITION_SEND_HZ } from '@shared/constants'
import { FONT, UI_KEYFRAMES } from './ui'
import { RaceScreens } from './screens/RaceScreens'

/** Mirrors backend SPAWN_SPACING (src/rooms/RaceRoom.ts) so local spawn matches. */
const SPAWN_SPACING = 5

/** Spawn the local duck at the server-assigned slot (spread along +X). */
function spawnState(playerIndex: number): DuckState {
  const s = createFlightState()
  s.position = [playerIndex * SPAWN_SPACING, s.position[1], s.position[2]]
  return s
}

const _euler = new Euler()
const _quat = new Quaternion()
/** Quaternion [x,y,z,w] from the duck's visual euler (YXZ: pitch=X, yaw=Y, roll=Z). */
function poseToQuat(yaw: number, pitch: number, roll: number): [number, number, number, number] {
  _euler.set(pitch, yaw, roll, 'YXZ')
  _quat.setFromEuler(_euler)
  return [_quat.x, _quat.y, _quat.z, _quat.w]
}

export function MultiplayerGame({
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

  // Recalibrating freezes the local duck, so it is offered only OUTSIDE a live race
  // (lobby / countdown / finished). Reset to allowed on unmount so the menu / SP is
  // never left blocked.
  const racing = race.phase === 'racing'
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(!racing)
    return () => useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [racing])

  const stateRef = useRef<DuckState>(spawnState(0))
  const actionsRef = useRef<DuckActions>({ ...makeIdleActions(), confidence: 1 })
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions())
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')

  // Finish is client-detected (FlightRig freezes the duck at the finish line). `finishedRef`
  // is the per-frame freeze flag the rig owns; `finishedStreamRef` is what we fold into the
  // pose stream; `localFinished` drives the wait screen immediately (before the server echoes).
  const finishedRef = useRef(false)
  const finishedStreamRef = useRef(false)
  const [localFinished, setLocalFinished] = useState(false)
  // Tree/ring crashes this run (client-side respawns), reported for the leaderboard.
  const crashCountRef = useRef(0)

  const passedRingsRef = useRef<Set<number>>(new Set())
  const ringPulseAtRef = useRef<Map<number, number>>(new Map())
  const boostRef = useRef(0)
  const boostSpeedRef = useRef<number>(BOOST.speed)
  const boostDurationRef = useRef<number>(BOOST.durationSec)
  const [passedRingIds, setPassedRingIds] = useState<Set<number>>(() => new Set())
  const [ringPulseAt, setRingPulseAt] = useState<Map<number, number>>(() => new Map())
  const syncRings = () => {
    setPassedRingIds(new Set(passedRingsRef.current))
    setRingPulseAt(new Map(ringPulseAtRef.current))
  }

  // Sim runs while racing; once we cross the line the rig freezes via `finishedRef`, so the
  // duck never flies on into the void.
  const runningRef = useRef(false)
  runningRef.current = race.phase === 'racing'

  const fireImpulse = useRef(() => {
    impulseRef.current = true
  }).current
  const keyRef = useKeyboardControls(true, fireImpulse)

  const self = race.players.find((p) => p.id === race.sessionId)
  const variant: DuckVariant = self?.duckVariant ?? 'male'
  // We've crossed the line if either our local detection fired or the server has echoed it.
  const finished = localFinished || (self?.finished ?? false)

  // Race music: loop through the countdown and the run. Keyed on the PHASE only (not
  // the derived `finished` flag): crossing the line stops the loop explicitly in
  // onFinish, and the phase-only key means this effect won't fight to restart it, while
  // the next race starts it fresh on the countdown. (Reading `finished` here would
  // stop/restart the loop at the countdown->racing edge for a returning finisher, whose
  // localFinished is still stale-true until the racing-entry reset effect clears it.)
  // The startMusic guard makes it idempotent against the ~20Hz re-renders; the unmount
  // effect stops it so it never leaks into the menu.
  const musicShouldPlay = race.phase === 'countdown' || race.phase === 'racing'
  useEffect(() => {
    if (musicShouldPlay) startMusic()
    else stopMusic()
  }, [musicShouldPlay])
  useEffect(() => () => stopMusic(), [])

  // Latest players/sessionId, read at (re)spawn. Kept in refs so the spawn-reset effect does
  // NOT depend on `race.players` (a fresh array each ~20Hz snapshot).
  const playersRef = useRef(race.players)
  playersRef.current = race.players
  const sessionIdRef = useRef(race.sessionId)
  sessionIdRef.current = race.sessionId

  // Build the world from the SERVER's seed so every client gets the identical course; falls
  // back to a fixed seed before connecting, just for a preview. Ring count is derived here —
  // the server holds no ring geometry.
  const map = useMemo(() => buildMap(race.mapSeed || 1337), [race.mapSeed])
  const mapRef = useRef<MapDef>(map)
  mapRef.current = map
  const ringCount = map.rings.length

  // On entering "racing": reset the local sim to this player's spawn slot. Depends ONLY on the
  // phase, so it runs once per race start (not on every snapshot).
  useEffect(() => {
    if (race.phase !== 'racing') return
    const index = Math.max(0, playersRef.current.findIndex((p) => p.id === sessionIdRef.current))
    stateRef.current = spawnState(index)
    finishedRef.current = false
    finishedStreamRef.current = false
    crashCountRef.current = 0
    passedRingsRef.current = new Set()
    ringPulseAtRef.current = new Map()
    boostRef.current = 0
    setLocalFinished(false)
    setPassedRingIds(new Set())
    setRingPulseAt(new Map())
  }, [race.phase])

  // Stream our authoritative pose + progress to the server while racing. The progress numbers
  // (rings, crashes, finished) ride along so we don't need separate messages.
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
  }, [race.phase])

  // Local red flash + crash tally when we hit a tree / ring rim (client-local respawn).
  const [crashAt, setCrashAt] = useState(0)
  const onCrash = useRef(() => {
    crashCountRef.current += 1
    setCrashAt(performance.now())
  }).current

  // Fired once when the duck reaches the finish line (FlightRig, enableFinish).
  const onFinish = useRef(() => {
    finishedStreamRef.current = true
    setLocalFinished(true)
    stopMusic() // your race is over: stop the loop at the finish line
    playFinish() // ...and celebrate the crossing
  }).current

  const startCam: [number, number, number] = [
    stateRef.current.position[0] + DEFAULT_FOLLOW.lateral,
    createFlightState().position[1] + DEFAULT_FOLLOW.up,
    createFlightState().position[2] - DEFAULT_FOLLOW.back,
  ]

  const rig: FlightRigProps = {
    stateRef,
    actionsRef,
    cfgRef,
    impulseRef,
    duckRef: duckGroupRef,
    duckVisual: { scale: 1, modelYaw: 0, crossfade: 0.25, flapAnimSpeed: FLAP_ANIM_SPEED },
    animCfg: DEFAULT_ANIM_MAP,
    clipRef,
    keyRef,
    cameraControl,
    mergedRef: mergedActionsRef,
    mapRef,
    variant,
    runningRef,
    enableFinish: true, // finish line freezes the duck; we report the crossing to the server
    finishedRef,
    onFinish,
    passedRingsRef,
    ringPulseAtRef,
    boostRef,
    boostSpeedRef,
    boostDurationRef,
    onRingsChanged: syncRings,
    onCrash,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, fontFamily: FONT }}>
      <style>{UI_KEYFRAMES}</style>
      <FlightScene
        map={map}
        startCam={startCam}
        camCfg={DEFAULT_FOLLOW}
        passedRingIds={passedRingIds}
        ringPulseAt={ringPulseAt}
        rig={rig}
      >
        <RemoteDucks players={race.players} sessionId={race.sessionId} />
      </FlightScene>

      <CrashFlash at={crashAt} />

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

      {/* Camera/keyboard toggle, offered only outside a live race (switching mid-race
          could pop the calibration gate and freeze your duck). */}
      {!racing && (
        <ControlModeToggle
          mode={cameraControl ? 'camera' : 'keyboard'}
          onChange={onSetControlMode}
          style={{ top: 12, left: 12 }}
        />
      )}
    </div>
  )
}
