// Single-player game: fly the finite course solo for a best time / clean run.
//
// This is the canonical Person A playground, rebuilt on the shared `FlightScene`
// + `FlightRig` so it stays pixel-identical to the tuned prototype while sharing
// ALL of its gameplay code with multiplayer. The sim always runs (`runningRef`
// true) and the run freezes at the finish line (`enableFinish`). No networking.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Leva, useControls, button, folder } from 'leva'
import { Group } from 'three'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { useKeyboardControls } from '../input/keyboard'
import { buildMap, DEFAULT_MAP_CONFIG, type MapDef } from '../map'
import { DEFAULT_FOLLOW } from '../avatar/followConfig'
import { DEFAULT_ANIM_MAP, type AnimMapConfig } from '../avatar/animationMap'
import { createFlightState, DEFAULT_FLIGHT, type FlightConfig } from './flight'
import { BOOST, BOOST_SLIDERS } from './gameConfig'
import { FLAP_ANIM_SPEED } from './gestureConfig'
import { FlightScene } from './FlightScene'
import type { FlightRigProps } from './FlightRig'
import { CrashFlash } from './CrashFlash'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import {
  Button,
  COLORS,
  FONT_BODY as FONT,
  FONT_DISPLAY,
  FONT_MONO as MONO,
  KeyCap,
  Overlay,
  Panel,
  UI_KEYFRAMES,
  cutPath,
  formatTime,
} from './ui'

export function SinglePlayerGame({
  onExit,
  controlMode,
  onSetControlMode,
}: {
  onExit?: () => void
  controlMode: ControlMode
  onSetControlMode: (mode: ControlMode) => void
}) {
  const cameraControl = controlMode === 'camera'
  // Single-player: recalibrating is always fine (it just freezes this one duck).
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [])
  const stateRef = useRef<DuckState>(createFlightState())
  const actionsRef = useRef<DuckActions>({ ...makeIdleActions(), confidence: 1 }) // slider baseline
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions()) // sliders + keyboard (drives anim + HUD)
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')
  const finishedRef = useRef(false)
  const runningRef = useRef(true) // single-player always simulates (freeze handled via finishedRef)

  const passedRingsRef = useRef<Set<number>>(new Set())
  const ringPulseAtRef = useRef<Map<number, number>>(new Map())
  const boostRef = useRef(0)
  const boostSpeedRef = useRef<number>(BOOST.speed)
  const boostDurationRef = useRef<number>(BOOST.durationSec)
  const [passedRingIds, setPassedRingIds] = useState<Set<number>>(() => new Set())
  const [ringPulseAt, setRingPulseAt] = useState<Map<number, number>>(() => new Map())
  const syncRings = useCallback(() => {
    setPassedRingIds(new Set(passedRingsRef.current))
    setRingPulseAt(new Map(ringPulseAtRef.current))
  }, [])

  const [debug, setDebug] = useState(false)
  const [finished, setFinished] = useState(false)
  // Wall-clock run timer: starts on (re)spawn, frozen at the finish line.
  const runStartRef = useRef(performance.now())
  const [finishStats, setFinishStats] = useState<{ ms: number; rings: number; distance: number } | null>(null)
  const onFinish = useCallback(() => {
    setFinishStats({
      ms: performance.now() - runStartRef.current,
      rings: passedRingsRef.current.size,
      distance: stateRef.current.distance,
    })
    setFinished(true)
  }, [])
  const [crashAt, setCrashAt] = useState(0)
  const onCrash = useCallback(() => setCrashAt(performance.now()), [])

  const fireImpulse = useCallback(() => {
    impulseRef.current = true
  }, [])
  const resetState = useCallback(() => {
    stateRef.current = createFlightState()
    finishedRef.current = false
    passedRingsRef.current = new Set()
    ringPulseAtRef.current = new Map()
    boostRef.current = 0
    runStartRef.current = performance.now()
    setFinished(false)
    setFinishStats(null)
    setPassedRingIds(new Set())
    setRingPulseAt(new Map())
  }, [])

  const keyRef = useKeyboardControls(true, fireImpulse)

  const world = useControls('World', {
    seed: { value: 1337, min: 0, max: 99999, step: 1 },
  })
  const map = useMemo(() => buildMap(world.seed), [world.seed])
  const mapRef = useRef<MapDef>(map)
  mapRef.current = map
  useEffect(() => {
    resetState()
  }, [world.seed, resetState])

  const actions = useControls('Actions (manual)', {
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    invertLean: false,
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
    // eslint-disable-next-line react-hooks/refs
    flapImpulse: button(fireImpulse),
    // eslint-disable-next-line react-hooks/refs
    reset: button(resetState),
  })

  const duckVisual = useControls('Duck', {
    scale: { value: 1, min: 0.1, max: 5, step: 0.05 },
    modelYaw: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    crossfade: { value: 0.25, min: 0, max: 1, step: 0.01 },
    flapActiveThreshold: { value: DEFAULT_ANIM_MAP.flapActiveThreshold, min: 0, max: 1, step: 0.01 },
    turnThreshold: { value: DEFAULT_ANIM_MAP.turnThreshold, min: 0, max: 1, step: 0.01 },
  })

  const cam = useControls('Camera', {
    back: { value: DEFAULT_FOLLOW.back, min: 2, max: 40 },
    up: { value: DEFAULT_FOLLOW.up, min: 0, max: 30 },
    lateral: { value: DEFAULT_FOLLOW.lateral, min: -10, max: 10, step: 0.1 },
    lookAhead: { value: DEFAULT_FOLLOW.lookAhead, min: -10, max: 40 },
    damp: { value: DEFAULT_FOLLOW.damp, min: 0.05, max: 1, step: 0.05 },
  })

  const cfg = useControls('Flight', {
    forward: folder({
      baseForwardSpeed: { value: DEFAULT_FLIGHT.baseForwardSpeed, min: 4, max: 30 },
      diveAccel: { value: DEFAULT_FLIGHT.diveAccel, min: 0, max: 80 },
    }),
    vertical: folder({
      gravity: { value: DEFAULT_FLIGHT.gravity, min: 0, max: 20 },
      liftMultiplier: { value: DEFAULT_FLIGHT.liftMultiplier, min: 4, max: 40 },
      impulseGain: { value: DEFAULT_FLIGHT.impulseGain, min: 0, max: 8 },
      maxClimbSpeed: { value: DEFAULT_FLIGHT.maxClimbSpeed, min: 2, max: 20 },
      maxDescentSpeed: { value: DEFAULT_FLIGHT.maxDescentSpeed, min: 2, max: 20 },
      diveSink: { value: DEFAULT_FLIGHT.diveSink, min: 0, max: 30 },
    }),
    banking: folder({
      maxRollDeg: { value: DEFAULT_FLIGHT.maxRollDeg, min: 0, max: 70 },
      lateralSpeedAtMaxBank: { value: DEFAULT_FLIGHT.lateralSpeedAtMaxBank, min: 0, max: 25 },
      lateralRange: { value: DEFAULT_MAP_CONFIG.halfWidth, min: 5, max: 200 },
    }),
    bounds: folder({
      minAltitude: { value: DEFAULT_FLIGHT.minAltitude, min: 0, max: 20 },
      maxAltitude: { value: DEFAULT_FLIGHT.maxAltitude, min: 20, max: 200 },
    }),
  })

  const [boost] = useControls('Boost (rings)', () => ({ ...BOOST_SLIDERS }), [
    BOOST.speed,
    BOOST.durationSec,
  ])

  useEffect(() => {
    boostSpeedRef.current = boost.boostSpeed
    boostDurationRef.current = boost.boostDuration
  }, [boost.boostSpeed, boost.boostDuration])

  useEffect(() => {
    actionsRef.current = {
      flap: actions.flap,
      flapImpulse: false,
      lean: actions.invertLean ? -actions.lean : actions.lean,
      dive: actions.dive,
      quack: actions.quack,
      egg67: actions.egg67,
      confidence: actions.confidence,
    }
  }, [
    actions.flap,
    actions.lean,
    actions.invertLean,
    actions.dive,
    actions.quack,
    actions.egg67,
    actions.confidence,
  ])

  useEffect(() => {
    cfgRef.current = { ...DEFAULT_FLIGHT, ...cfg }
  }, [cfg])

  const animCfg: AnimMapConfig = {
    ...DEFAULT_ANIM_MAP,
    flapActiveThreshold: duckVisual.flapActiveThreshold,
    turnThreshold: duckVisual.turnThreshold,
  }

  const start = createFlightState().position
  const startCam: [number, number, number] = [
    start[0] + DEFAULT_FOLLOW.lateral,
    start[1] + DEFAULT_FOLLOW.up,
    start[2] - DEFAULT_FOLLOW.back,
  ]

  const rig: FlightRigProps = {
    stateRef,
    actionsRef,
    cfgRef,
    impulseRef,
    duckRef: duckGroupRef,
    duckVisual: {
      scale: duckVisual.scale,
      modelYaw: duckVisual.modelYaw,
      crossfade: duckVisual.crossfade,
      flapAnimSpeed: FLAP_ANIM_SPEED,
    },
    animCfg,
    clipRef,
    keyRef,
    cameraControl,
    mergedRef: mergedActionsRef,
    mapRef,
    variant: 'male',
    runningRef,
    enableFinish: true,
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
      <Leva hidden={!debug} />
      <FlightScene
        map={map}
        startCam={startCam}
        camCfg={cam}
        passedRingIds={passedRingIds}
        ringPulseAt={ringPulseAt}
        rig={rig}
      />
      <Hud
        stateRef={stateRef}
        actionsRef={mergedActionsRef}
        clipRef={clipRef}
        boostRef={boostRef}
        passedRingsRef={passedRingsRef}
      />
      <ControlsHint cameraControl={cameraControl} />
      <DebugToggle debug={debug} onToggle={() => setDebug((d) => !d)} />
      <ControlModeToggle
        mode={cameraControl ? 'camera' : 'keyboard'}
        onChange={onSetControlMode}
        style={{ top: 20, right: 230 }}
      />
      {onExit && <ExitButton onExit={onExit} />}
      <CrashFlash at={crashAt} />
      {finished && finishStats && (
        <FinishOverlay stats={finishStats} onReset={resetState} onExit={onExit} />
      )}
    </div>
  )
}

interface HudSnapshot {
  s: DuckState
  a: DuckActions
  clip: string
  boost: number
  ringsPassed: number
}

function Hud({
  stateRef,
  actionsRef,
  clipRef,
  boostRef,
  passedRingsRef,
}: {
  stateRef: React.RefObject<DuckState>
  actionsRef: React.RefObject<DuckActions>
  clipRef: React.RefObject<string>
  boostRef: React.RefObject<number>
  passedRingsRef: React.RefObject<Set<number>>
}) {
  const [snap, setSnap] = useState<HudSnapshot>(() => ({
    s: createFlightState(),
    a: makeIdleActions(),
    clip: 'idle_1',
    boost: 0,
    ringsPassed: 0,
  }))

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({
        s: stateRef.current,
        a: actionsRef.current,
        clip: clipRef.current,
        boost: boostRef.current,
        ringsPassed: passedRingsRef.current.size,
      })
    }, 100)
    return () => clearInterval(id)
  }, [stateRef, actionsRef, clipRef, boostRef, passedRingsRef])

  const { s, a, clip, boost, ringsPassed } = snap
  const row = (label: string, value: string, accent = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2.5px 0' }}>
      <span style={{ color: COLORS.hudDim }}>{label}</span>
      <span style={{ color: accent ? COLORS.orange : COLORS.hudText, fontWeight: 500 }}>{value}</span>
    </div>
  )
  const header = (text: string) => (
    <div
      style={{
        color: COLORS.hudDim,
        textAlign: 'center',
        fontWeight: 700,
        letterSpacing: 3,
        fontSize: '0.62rem',
        padding: '0 0 9px',
        margin: '0 0 9px',
        borderBottom: `1px solid ${COLORS.hudLine}`,
      }}
    >
      {text}
    </div>
  )
  return (
    <div
      style={{
        position: 'absolute',
        top: 20,
        left: 20,
        width: 212,
        padding: '13px 15px',
        background: COLORS.hud,
        color: COLORS.hudText,
        fontFamily: MONO,
        fontSize: '0.78rem',
        border: `1px solid ${COLORS.hudLine}`,
        clipPath: cutPath(),
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        pointerEvents: 'none',
      }}
    >
      {header('FLIGHT')}
      {row('clip', clip || '-')}
      {row('speed', `${(s.speed + boost).toFixed(1)} u/s`)}
      {row('· cruise', `${s.speed.toFixed(1)} u/s`)}
      {row('· boost', `+${boost.toFixed(1)} u/s`, true)}
      {row('rings', `${ringsPassed}`)}
      {row('altitude', `${s.position[1].toFixed(1)} m`)}
      {row('vert vel', `${s.verticalVel.toFixed(1)} u/s`)}
      {row('lateral X', `${s.position[0].toFixed(1)} m`)}
      {row('distance', `${s.distance.toFixed(0)} m`)}
      <div style={{ marginTop: 11 }}>{header('INPUT')}</div>
      {row('flap', a.flap.toFixed(2))}
      {row('lean', a.lean.toFixed(2))}
      {row('dive', a.dive.toFixed(2))}
      {row('confidence', a.confidence.toFixed(2))}
      {row('quack', a.quack ? 'true' : 'false')}
      {row('egg67', a.egg67 ? 'true' : 'false')}
    </div>
  )
}

function FinishOverlay({
  stats,
  onReset,
  onExit,
}: {
  stats: { ms: number; rings: number; distance: number }
  onReset: () => void
  onExit?: () => void
}) {
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
        <p style={{ color: COLORS.slateDim, margin: '0 0 26px', fontWeight: 500 }}>Nice flying.</p>
        <div style={{ display: 'flex', gap: 38, justifyContent: 'center', margin: '0 0 28px' }}>
          {stat('TIME', formatTime(stats.ms), COLORS.cyanDeep)}
          {stat('RINGS', String(stats.rings), COLORS.orangeDeep)}
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

function ControlsHint({ cameraControl }: { cameraControl: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '11px 18px',
        background: COLORS.hud,
        color: COLORS.hudDim,
        fontFamily: MONO,
        fontSize: '0.8rem',
        pointerEvents: 'none',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        border: `1px solid ${COLORS.hudLine}`,
        clipPath: cutPath(),
        display: 'flex',
        alignItems: 'center',
        gap: 9,
      }}
    >
      {cameraControl ? (
        <span>
          Flap your arms to fly · lean your shoulders to turn · drop your arms to dive · open your
          mouth to quack
        </span>
      ) : (
        <>
          <KeyCap dark>Space</KeyCap> flap
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>A</KeyCap>
          <KeyCap dark>D</KeyCap> lean
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>W</KeyCap> dive
        </>
      )}
    </div>
  )
}

const hudChipStyle: React.CSSProperties = {
  padding: '9px 14px',
  background: COLORS.hud,
  border: `1px solid ${COLORS.hudLine}`,
  color: COLORS.hudText,
  fontFamily: MONO,
  fontSize: '0.78rem',
  cursor: 'pointer',
  backdropFilter: 'blur(7px)',
  WebkitBackdropFilter: 'blur(7px)',
  clipPath: cutPath(8),
}

function DebugToggle({ debug, onToggle }: { debug: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        ...hudChipStyle,
        position: 'absolute',
        top: 20,
        right: 20,
        color: debug ? COLORS.orange : COLORS.hudText,
        borderColor: debug ? COLORS.orange : COLORS.hudLine,
      }}
    >
      debug: {debug ? 'ON' : 'off'}
    </button>
  )
}

function ExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      style={{
        ...hudChipStyle,
        position: 'absolute',
        top: 20,
        right: 130,
      }}
    >
      ← menu
    </button>
  )
}
