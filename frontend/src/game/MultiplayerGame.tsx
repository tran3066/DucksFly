// Multiplayer game: the SAME canonical flight (shared `FlightScene` + `FlightRig`)
// with the backend sync layer (`net/*`) wired on top. Each browser simulates its
// own duck locally (client-authoritative) and streams pos/vel/quat ~20x/sec; the
// server relays everyone else, scores ring passes, and rules collisions. Remote
// ducks reuse the same animated `avatar/Duck` (animation inferred from vel/quat).
//
// The OLD multiplayer sim/yaw model is gone — this flies with the exact same
// model as single-player, so the two never diverge. Only the seed source, sim
// gate (racing phase), spawn slot, pose stream, ring report, and overlays differ.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
import { FlightScene } from './FlightScene'
import type { FlightRigProps } from './FlightRig'
import { CrashFlash } from './CrashFlash'
import { RemoteDucks } from './RemoteDuck'
import { raceConnection, SERVER_URL } from '../net/connection'
import { useRace, isHost } from '../net/useRace'
import type { PlayerView, RaceSnapshot } from '../net/types'
import { POSITION_SEND_HZ } from '@shared/constants'
import '../test/test.css'

/** Mirrors backend MIN_PLAYERS_TO_START (src/logic/stateMachine.ts). */
const MIN_PLAYERS_TO_START = 2
/** Mirrors backend SPAWN_SPACING (src/rooms/RaceRoom.ts) so local spawn matches. */
const SPAWN_SPACING = 5

const randomName = () => `Duck-${Math.floor(1000 + Math.random() * 9000)}`

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

export function MultiplayerGame({ onExit }: { onExit?: () => void }) {
  const race = useRace()

  const stateRef = useRef<DuckState>(spawnState(0))
  const actionsRef = useRef<DuckActions>({ ...makeIdleActions(), confidence: 1 })
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions())
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')
  const finishedRef = useRef(false)

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

  // Sim runs only while racing; FlightRig reads this ref each frame.
  const runningRef = useRef(false)
  runningRef.current = race.phase === 'racing'

  const fireImpulse = useRef(() => {
    impulseRef.current = true
  }).current
  const keyRef = useKeyboardControls(true, fireImpulse)

  const connected = race.status === 'connected'
  const self = race.players.find((p) => p.id === race.sessionId)
  const variant: DuckVariant = self?.duckVariant ?? 'male'

  // Latest players/sessionId, read at (re)spawn. Kept in refs so the spawn-reset
  // effect does NOT depend on `race.players` (a fresh array each ~20Hz snapshot).
  const playersRef = useRef(race.players)
  playersRef.current = race.players
  const sessionIdRef = useRef(race.sessionId)
  sessionIdRef.current = race.sessionId

  // Build the world from the SERVER's seed so every client gets the identical
  // course; falls back to a fixed seed before connecting, just for a preview.
  const map = useMemo(() => buildMap(race.mapSeed || 1337), [race.mapSeed])
  const mapRef = useRef<MapDef>(map)
  mapRef.current = map

  // On entering "racing": reset the local sim to this player's spawn slot. Depends
  // ONLY on the phase, so it runs once per race start (not on every snapshot).
  useEffect(() => {
    if (race.phase !== 'racing') return
    const index = Math.max(0, playersRef.current.findIndex((p) => p.id === sessionIdRef.current))
    stateRef.current = spawnState(index)
    passedRingsRef.current = new Set()
    ringPulseAtRef.current = new Map()
    boostRef.current = 0
    setPassedRingIds(new Set())
    setRingPulseAt(new Map())
  }, [race.phase])

  // Stream our authoritative pose to the server while racing.
  useEffect(() => {
    if (race.phase !== 'racing') return
    const id = window.setInterval(() => {
      const s = stateRef.current
      raceConnection.sendState({
        pos: [s.position[0], s.position[1], s.position[2]],
        vel: [s._lean, s.verticalVel, s.speed],
        quat: poseToQuat(s.yaw, s.pitch, s.roll),
      })
    }, 1000 / POSITION_SEND_HZ)
    return () => window.clearInterval(id)
  }, [race.phase])

  // Local spin feedback when the server rules we collided.
  const [spinning, setSpinning] = useState(false)
  useEffect(() => {
    return raceConnection.onSpinOut((playerId) => {
      if (playerId !== race.sessionId) return
      setSpinning(true)
      window.setTimeout(() => setSpinning(false), 1200)
    })
  }, [race.sessionId])

  // Local red flash when we crash into a tree / ring rim (client-local respawn).
  const [crashAt, setCrashAt] = useState(0)
  const onCrash = useRef(() => setCrashAt(performance.now())).current

  const reportRing = (ringId: number) => {
    // Server validates passes in order; out-of-range ids are harmlessly ignored.
    if (race.ringCount > 0 && ringId >= race.ringCount) return
    raceConnection.ringPassed(ringId, self?.lap ?? 0)
  }

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
    duckVisual: { scale: 1, modelYaw: 0, crossfade: 0.25 },
    animCfg: DEFAULT_ANIM_MAP,
    clipRef,
    keyRef,
    mergedRef: mergedActionsRef,
    mapRef,
    variant,
    runningRef,
    enableFinish: false, // finishing is server-authoritative in multiplayer
    finishedRef,
    onFinish: undefined,
    passedRingsRef,
    ringPulseAtRef,
    boostRef,
    boostSpeedRef,
    boostDurationRef,
    onRingsChanged: syncRings,
    onRingPassed: reportRing,
    onCrash,
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
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

      {race.phase === 'racing' && <RaceHud race={race} self={self} spinning={spinning} />}
      {race.phase === 'countdown' && <Countdown endsAt={race.countdownEndsAt} />}
      {(!connected || race.phase === 'lobby') && <Lobby race={race} self={self} onExit={onExit} />}
      {race.phase === 'finished' && <Results race={race} />}
      {race.phase === 'racing' && <ControlsLegend />}
    </div>
  )
}

/** Lobby / join overlay. Reuses the harness styles from test.css. */
function Lobby({
  race,
  self,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  onExit?: () => void
}) {
  const [name, setName] = useState(randomName)
  const [variant, setVariant] = useState<DuckVariant>('male')
  const connected = race.status === 'connected'
  const canStart =
    isHost(race) && race.phase === 'lobby' && race.players.length >= MIN_PLAYERS_TO_START

  const join = (e: FormEvent) => {
    e.preventDefault()
    void raceConnection.join({ name: name.trim() || randomName(), duckVariant: variant })
  }

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 4px' }}>🦆 DucksFly · Race</h1>
        <p className="tip" style={{ margin: '0 0 16px' }}>
          server <code>{SERVER_URL}</code> · status{' '}
          <b className={`st-${race.status}`}>{race.status}</b>
        </p>

        {!connected ? (
          <form className="join" onSubmit={join} style={{ marginTop: 0 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
            <select value={variant} onChange={(e) => setVariant(e.target.value as DuckVariant)}>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
            <button type="submit" disabled={race.status === 'connecting'}>
              {race.status === 'connecting' ? 'connecting…' : 'Join race'}
            </button>
            {race.status === 'error' && <span className="err">{race.error}</span>}
            <p className="tip" style={{ width: '100%' }}>
              Open this page in several tabs to add players ({MIN_PLAYERS_TO_START}+ to start).
            </p>
            {onExit && (
              <button type="button" className="leave" onClick={onExit}>
                ← menu
              </button>
            )}
          </form>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button onClick={() => raceConnection.setReady(!self?.ready)}>
                {self?.ready ? 'Unready' : 'Ready up'}
              </button>
              <button disabled={!canStart} onClick={() => raceConnection.startRace()}>
                {isHost(race) ? 'Start race' : 'Host starts'}
              </button>
              <button className="leave" onClick={() => raceConnection.leave()}>
                Leave
              </button>
            </div>
            <PlayerTable race={race} />
            <p className="tip">
              {race.players.length} player(s) · need {MIN_PLAYERS_TO_START}+ · seed{' '}
              {race.mapSeed} · {race.ringCount} rings
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function PlayerTable({ race }: { race: RaceSnapshot }) {
  return (
    <table className="players" style={{ margin: '8px 0' }}>
      <thead>
        <tr>
          <th>name</th>
          <th>duck</th>
          <th>ready</th>
          <th>rings</th>
        </tr>
      </thead>
      <tbody>
        {race.players.map((p) => (
          <tr key={p.id} className={p.id === race.sessionId ? 'me' : ''}>
            <td>
              {p.name}
              {p.id === race.sessionId ? ' (you)' : ''}
              {p.id === race.hostId ? ' 👑' : ''}
            </td>
            <td>{p.duckVariant}</td>
            <td>{p.ready ? '✓' : ''}</td>
            <td>{p.ringsPassed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Big 3 · 2 · 1 over the live scene during the countdown phase. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [secs, setSecs] = useState(() => Math.ceil((endsAt - Date.now()) / 1000))
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecs(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)))
    }, 100)
    return () => window.clearInterval(id)
  }, [endsAt])
  return (
    <div style={{ ...overlayStyle, pointerEvents: 'none' }}>
      <div style={{ fontSize: '8rem', fontWeight: 700, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
        {secs > 0 ? secs : 'GO!'}
      </div>
    </div>
  )
}

/** In-race HUD: own telemetry + a compact live leaderboard. */
function RaceHud({
  race,
  self,
  spinning,
}: {
  race: RaceSnapshot
  self?: PlayerView
  spinning: boolean
}) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 150)
    return () => clearInterval(id)
  }, [])
  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99))
  return (
    <>
      <div style={{ ...hudPanel, top: 12, left: 12, minWidth: 180 }}>
        <div style={hudRow}>
          <span style={{ opacity: 0.7 }}>rings</span>
          <span>
            {self?.ringsPassed ?? 0} / {race.ringCount}
          </span>
        </div>
        <div style={hudRow}>
          <span style={{ opacity: 0.7 }}>rank</span>
          <span>
            {self?.rank || '-'} / {race.players.length}
          </span>
        </div>
        {self?.finished && <div style={{ color: '#79e58a', marginTop: 4 }}>FINISHED 🏁</div>}
        {spinning && <div style={{ color: '#ff8a8a', marginTop: 4 }}>SPUN OUT 💫</div>}
      </div>

      <div style={{ ...hudPanel, top: 12, right: 12, minWidth: 170 }}>
        <div style={{ opacity: 0.7, marginBottom: 4 }}>leaderboard</div>
        {ranked.map((p) => (
          <div key={p.id} style={hudRow}>
            <span style={{ color: p.id === race.sessionId ? '#ffd23f' : undefined }}>
              {p.rank || '–'}. {p.name}
            </span>
            <span>{p.ringsPassed}</span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Final standings over the frozen scene. */
function Results({ race }: { race: RaceSnapshot }) {
  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99))
  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>🏁 Final standings</h1>
        <table className="players">
          <thead>
            <tr>
              <th>#</th>
              <th>name</th>
              <th>rings</th>
              <th>fin</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={p.id === race.sessionId ? 'me' : ''}>
                <td>{p.rank || ''}</td>
                <td>
                  {p.name}
                  {p.id === race.sessionId ? ' (you)' : ''}
                </td>
                <td>{p.ringsPassed}</td>
                <td>{p.finished ? '🏁' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ marginTop: 14 }} onClick={() => raceConnection.leave()}>
          Back to lobby
        </button>
      </div>
    </div>
  )
}

function ControlsLegend() {
  const keyStyle: React.CSSProperties = {
    display: 'inline-block',
    minWidth: 18,
    padding: '1px 6px',
    margin: '0 4px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    textAlign: 'center',
  }
  return (
    <div style={{ ...hudPanel, bottom: 12, left: 12, font: '12px/1.5 ui-monospace, monospace' }}>
      <div>
        <span style={keyStyle}>Space</span>
        <span style={{ opacity: 0.7 }}>flap (climb)</span>
      </div>
      <div>
        <span style={keyStyle}>W</span>
        <span style={{ opacity: 0.7 }}>dive</span>
      </div>
      <div>
        <span style={keyStyle}>A</span>/<span style={keyStyle}>D</span>
        <span style={{ opacity: 0.7 }}>lean left / right</span>
      </div>
    </div>
  )
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(10,16,28,0.55)',
  color: '#e7ecf5',
}

const panelStyle: React.CSSProperties = {
  background: 'rgba(17,21,31,0.92)',
  border: '1px solid #2c3445',
  borderRadius: 12,
  padding: '22px 26px',
  minWidth: 420,
  maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
}

const hudPanel: React.CSSProperties = {
  position: 'absolute',
  padding: '12px 14px',
  borderRadius: 8,
  background: 'rgba(10,20,30,0.65)',
  color: '#dff6ff',
  font: '13px/1.5 ui-monospace, monospace',
  pointerEvents: 'none',
  backdropFilter: 'blur(4px)',
}

const hudRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
}
