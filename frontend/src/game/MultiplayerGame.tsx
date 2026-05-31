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
import { raceConnection } from '../net/connection'
import { ServerPicker } from '../net/ServerPicker'
import { useRace, isHost } from '../net/useRace'
import type { PlayerView, RaceSnapshot } from '../net/types'
import { getProfile, saveProfile } from '../net/profile'
import { getInitialRoomCode, normalizeCode, buildShareLink, CODE_LENGTH } from '../net/lobbyCode'
import { POSITION_SEND_HZ } from '@shared/constants'
import {
  Overlay,
  Panel,
  Button,
  TextInput,
  KeyCap,
  formatTime,
  COLORS,
  FONT,
  MONO,
  UI_KEYFRAMES,
} from './ui'

/** Mirrors backend MIN_PLAYERS_TO_START (src/logic/stateMachine.ts). */
const MIN_PLAYERS_TO_START = 2
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
    finishedRef.current = false
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

      {race.phase === 'racing' && <RaceHud race={race} self={self} spinning={spinning} />}
      {race.phase === 'countdown' && <Countdown endsAt={race.countdownEndsAt} />}
      {!connected && <Connect race={race} onExit={onExit} />}
      {connected && race.phase === 'lobby' && <Lobby race={race} self={self} onExit={onExit} />}
      {connected && race.phase === 'finished' && <Results race={race} self={self} onExit={onExit} />}
      {race.phase === 'racing' && <ControlsLegend />}
    </div>
  )
}

/** Pre-connection screen: pick a name + duck, then host or join a lobby by code. */
function Connect({ race, onExit }: { race: RaceSnapshot; onExit?: () => void }) {
  const profile = useMemo(getProfile, [])
  const initialCode = useMemo(getInitialRoomCode, [])
  const [name, setName] = useState(profile.name)
  const [variant, setVariant] = useState<DuckVariant>(profile.variant)
  const [mode, setMode] = useState<'host' | 'join'>(initialCode ? 'join' : 'host')
  const [code, setCode] = useState(initialCode)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const connecting = race.status === 'connecting'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const finalName = name.trim() || profile.name
    saveProfile({ name: finalName, variant })
    if (mode === 'host') {
      void raceConnection.host({ name: finalName, duckVariant: variant })
    } else {
      const c = normalizeCode(code)
      if (c.length < CODE_LENGTH) return
      void raceConnection.joinByCode(c, { name: finalName, duckVariant: variant })
    }
  }

  return (
    <Overlay>
      <Panel width={440}>
        <h1 style={titleStyle}>
          <span style={{ fontSize: '1.6rem' }}>🦆</span> Multiplayer
        </h1>
        <p style={subStyle}>Race other ducks live through the same sky.</p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Your name">
            <TextInput value={name} onChange={setName} placeholder="name" maxLength={16} />
          </Field>

          <Field label="Duck">
            <Segmented
              options={[
                { id: 'male', label: 'Male' },
                { id: 'female', label: 'Female' },
              ]}
              value={variant}
              onChange={(v) => setVariant(v as DuckVariant)}
            />
          </Field>

          <Segmented
            options={[
              { id: 'host', label: 'Host a lobby' },
              { id: 'join', label: 'Join a lobby' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'host' | 'join')}
          />

          {mode === 'join' && (
            <Field label="Invite code">
              <TextInput
                value={code}
                onChange={(v) => setCode(normalizeCode(v))}
                placeholder="ABCD"
                uppercase
                maxLength={CODE_LENGTH}
              />
            </Field>
          )}

          <Button
            type="submit"
            variant="primary"
            accent={mode === 'host' ? COLORS.accentBlue : COLORS.accent}
            disabled={connecting || (mode === 'join' && normalizeCode(code).length < CODE_LENGTH)}
            style={{ marginTop: 4 }}
          >
            {connecting ? 'Connecting…' : mode === 'host' ? 'Create lobby' : 'Join lobby'}
          </Button>

          {race.status === 'error' && race.error && (
            <div style={{ color: COLORS.bad, fontSize: '0.85rem' }}>{race.error}</div>
          )}
        </form>

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          {onExit && (
            <Button variant="ghost" onClick={onExit} style={{ padding: '8px 14px' }}>
              ← Menu
            </Button>
          )}
          <button type="button" onClick={() => setShowAdvanced((s) => !s)} style={linkStyle}>
            {showAdvanced ? 'Hide server' : 'Server settings'}
          </button>
        </div>

        {showAdvanced && (
          <div style={{ marginTop: 12 }}>
            <ServerPicker disabled={connecting} />
          </div>
        )}
      </Panel>
    </Overlay>
  )
}

/** Connected lobby: show the invite code + share link, the roster, and start controls. */
function Lobby({
  race,
  self,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  onExit?: () => void
}) {
  const canStart =
    isHost(race) && race.phase === 'lobby' && race.players.length >= MIN_PLAYERS_TO_START
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? race.code : buildShareLink(race.code)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1400)
    } catch {
      setCopied(null)
    }
  }

  return (
    <Overlay>
      <Panel width={480}>
        <h1 style={titleStyle}>
          <span style={{ fontSize: '1.4rem' }}>🦆</span> Lobby
        </h1>

        <div style={codeBox}>
          <div>
            <div style={{ color: COLORS.dim, fontSize: '0.75rem', letterSpacing: 1 }}>
              INVITE CODE
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: 8,
                color: COLORS.gold,
              }}
            >
              {race.code || '····'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button onClick={() => copy('code')} style={{ padding: '7px 12px', fontSize: '0.85rem' }}>
              {copied === 'code' ? 'Copied!' : 'Copy code'}
            </Button>
            <Button onClick={() => copy('link')} style={{ padding: '7px 12px', fontSize: '0.85rem' }}>
              {copied === 'link' ? 'Copied!' : 'Copy link'}
            </Button>
          </div>
        </div>

        <RosterTable race={race} />

        <p style={{ color: COLORS.faint, fontSize: '0.8rem', margin: '10px 0 16px' }}>
          {race.players.length} player{race.players.length === 1 ? '' : 's'} · need{' '}
          {MIN_PLAYERS_TO_START}+ to start · {race.ringCount} rings
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant={self?.ready ? 'ghost' : 'primary'}
            accent={COLORS.good}
            onClick={() => raceConnection.setReady(!self?.ready)}
          >
            {self?.ready ? 'Unready' : 'Ready up'}
          </Button>
          <Button
            variant="primary"
            accent={COLORS.accent}
            disabled={!canStart}
            onClick={() => raceConnection.startRace()}
          >
            {isHost(race) ? 'Start race' : 'Host starts'}
          </Button>
          <Button
            variant="danger"
            onClick={() => (onExit ? onExit() : raceConnection.leave())}
            style={{ marginLeft: 'auto' }}
          >
            Leave
          </Button>
        </div>
      </Panel>
    </Overlay>
  )
}

function RosterTable({ race }: { race: RaceSnapshot }) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <Th>Player</Th>
          <Th>Duck</Th>
          <Th center>Ready</Th>
        </tr>
      </thead>
      <tbody>
        {race.players.map((p) => (
          <tr key={p.id} style={p.id === race.sessionId ? rowMe : undefined}>
            <Td>
              {p.name}
              {p.id === race.sessionId ? ' (you)' : ''}
              {p.id === race.hostId ? ' · host' : ''}
            </Td>
            <Td style={{ color: COLORS.dim }}>{p.duckVariant}</Td>
            <Td center>
              {p.ready ? <span style={{ color: COLORS.good }}>ready</span> : <span style={{ color: COLORS.faint }}>—</span>}
            </Td>
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
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div
        key={secs}
        style={{
          fontFamily: FONT,
          fontSize: '9rem',
          fontWeight: 800,
          color: secs > 0 ? COLORS.text : COLORS.good,
          textShadow: '0 6px 30px rgba(0,0,0,0.6)',
          animation: 'ducksfly-pop 0.4s ease both',
        }}
      >
        {secs > 0 ? secs : 'GO!'}
      </div>
    </div>
  )
}

/** In-race HUD: own telemetry + a compact live leaderboard + race clock. */
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
  const elapsed = race.raceStartAt > 0 ? Date.now() - race.raceStartAt : 0

  return (
    <>
      <div style={{ ...hudPanel, top: 14, left: 14, minWidth: 170 }}>
        <HudRow label="time" value={formatTime(elapsed)} />
        <HudRow label="rings" value={`${self?.ringsPassed ?? 0} / ${race.ringCount}`} />
        <HudRow label="rank" value={`${self?.rank || '–'} / ${race.players.length}`} />
        {self?.finished && <div style={{ color: COLORS.good, marginTop: 6 }}>FINISHED</div>}
        {spinning && <div style={{ color: COLORS.bad, marginTop: 6 }}>SPUN OUT</div>}
      </div>

      <div style={{ ...hudPanel, top: 14, right: 14, minWidth: 190 }}>
        <div style={{ color: COLORS.dim, marginBottom: 6, fontSize: '0.75rem', letterSpacing: 1 }}>
          LEADERBOARD
        </div>
        {ranked.map((p) => (
          <div key={p.id} style={hudRowStyle}>
            <span style={{ color: p.id === race.sessionId ? COLORS.gold : COLORS.text }}>
              {p.rank || '–'}. {p.name}
            </span>
            <span style={{ color: COLORS.dim }}>
              {p.finished ? '🏁' : `${p.ringsPassed}`}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

/** Final standings over the frozen scene, with a clear winner + rematch. */
function Results({
  race,
  self,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  onExit?: () => void
}) {
  const ranked = [...race.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    if (a.finished && b.finished) return a.finishTime - b.finishTime
    return b.ringsPassed - a.ringsPassed
  })
  const winner = ranked.find((p) => p.finished)
  const youWon = winner && self && winner.id === self.id

  return (
    <Overlay>
      <Panel width={540}>
        <h1 style={{ ...titleStyle, justifyContent: 'center' }}>🏁 Race complete</h1>

        <div style={winnerBox}>
          {winner ? (
            <>
              <div style={{ fontSize: '0.8rem', color: COLORS.dim, letterSpacing: 1 }}>WINNER</div>
              <div style={{ fontSize: '1.7rem', fontWeight: 800, color: COLORS.gold }}>
                🏆 {winner.name}
                {youWon ? ' — that\'s you!' : ''}
              </div>
            </>
          ) : (
            <div style={{ color: COLORS.dim }}>No one crossed the line.</div>
          )}
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>Player</Th>
              <Th center>Rings</Th>
              <Th center>Crashes</Th>
              <Th center>Time</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.id} style={p.id === race.sessionId ? rowMe : undefined}>
                <Td center>{p.finished ? medal(i + 1) : 'DNF'}</Td>
                <Td>
                  {p.name}
                  {p.id === race.sessionId ? ' (you)' : ''}
                </Td>
                <Td center>{p.ringsPassed}</Td>
                <Td center style={{ color: p.collisions > 0 ? COLORS.bad : COLORS.dim }}>
                  {p.collisions}
                </Td>
                <Td center style={{ fontFamily: MONO, color: COLORS.dim }}>
                  {p.finished ? formatTime(p.finishTime - race.raceStartAt) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="primary" accent={COLORS.accent} onClick={() => raceConnection.playAgain()}>
            Play again
          </Button>
          <Button
            variant="danger"
            onClick={() => (onExit ? onExit() : raceConnection.leave())}
            style={{ marginLeft: 'auto' }}
          >
            Leave
          </Button>
        </div>
      </Panel>
    </Overlay>
  )
}

function ControlsLegend() {
  return (
    <div style={{ ...hudPanel, bottom: 14, left: 14 }}>
      <div style={{ marginBottom: 2 }}>
        <KeyCap>Space</KeyCap>
        <span style={{ color: COLORS.dim }}>flap (climb)</span>
      </div>
      <div style={{ marginBottom: 2 }}>
        <KeyCap>W</KeyCap>
        <span style={{ color: COLORS.dim }}>dive</span>
      </div>
      <div>
        <KeyCap>A</KeyCap>
        <KeyCap>D</KeyCap>
        <span style={{ color: COLORS.dim }}>lean</span>
      </div>
    </div>
  )
}

// --- small presentational helpers ---

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: COLORS.dim, fontSize: '0.8rem', letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, background: 'rgba(10,16,28,0.5)', padding: 4, borderRadius: 12 }}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              padding: '9px 10px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: '0.9rem',
              fontWeight: 600,
              color: active ? '#0b1422' : COLORS.text,
              background: active ? COLORS.text : 'transparent',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function medal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={hudRowStyle}>
      <span style={{ color: COLORS.dim }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

function Th({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <th
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        color: COLORS.dim,
        fontWeight: 600,
        fontSize: '0.78rem',
        letterSpacing: 0.5,
        borderBottom: '1px solid rgba(120,150,180,0.2)',
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  center,
  style,
}: {
  children: React.ReactNode
  center?: boolean
  style?: React.CSSProperties
}) {
  return (
    <td
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        borderBottom: '1px solid rgba(120,150,180,0.1)',
        fontSize: '0.9rem',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

// --- styles ---

const titleStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 800,
  margin: '0 0 4px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: COLORS.text,
}

const subStyle: React.CSSProperties = {
  margin: '0 0 18px',
  color: COLORS.dim,
  fontSize: '0.9rem',
}

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: COLORS.dim,
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: '0.85rem',
  textDecoration: 'underline',
  padding: 0,
}

const codeBox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '14px 16px',
  borderRadius: 12,
  background: 'rgba(10,16,28,0.5)',
  border: '1px solid rgba(120,150,180,0.2)',
  margin: '8px 0 16px',
}

const winnerBox: React.CSSProperties = {
  textAlign: 'center',
  padding: '16px 18px',
  borderRadius: 14,
  background: 'rgba(255,210,63,0.08)',
  border: '1px solid rgba(255,210,63,0.25)',
  margin: '6px 0 18px',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const rowMe: React.CSSProperties = {
  background: 'rgba(255,210,63,0.08)',
}

const hudPanel: React.CSSProperties = {
  position: 'absolute',
  padding: '12px 14px',
  borderRadius: 12,
  background: 'rgba(10,18,30,0.66)',
  color: COLORS.text,
  fontFamily: FONT,
  fontSize: '0.85rem',
  pointerEvents: 'none',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(120,150,180,0.18)',
}

const hudRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  lineHeight: 1.7,
}
