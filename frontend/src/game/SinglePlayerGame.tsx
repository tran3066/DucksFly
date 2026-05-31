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
import { SixSevenOverlay } from './SixSevenOverlay'
import { startMusic, stopMusic, playFinish } from './sfx'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import { useCalibrationStore } from '../input/calibration'
import { Overlay, Panel, Button, KeyCap, formatTime, COLORS, FONT, MONO, UI_KEYFRAMES } from './ui'

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
  // Race music: single-player flies from mount, so start the loop here and stop it
  // when leaving. The finish stops it (onFinish) and "Fly again" restarts it
  // (resetState).
  useEffect(() => {
    startMusic()
    return () => stopMusic()
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
    stopMusic() // race over: stop the loop at the finish line
    playFinish() // ...and celebrate the crossing
  }, [])
  const [crashAt, setCrashAt] = useState(0)
  const onCrash = useCallback(() => setCrashAt(performance.now()), [])
  // "6-7" gesture pop: a counter the rig bumps on each detection; the overlay
  // replays its animation when it changes.
  const [sixSevenCount, setSixSevenCount] = useState(0)
  const onSixSeven = useCallback(() => setSixSevenCount((n) => n + 1), [])

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
    startMusic() // (re)start the loop for the fresh run / new seed
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
    onSixSeven,
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
        style={{ top: 48, right: 12 }}
      />
      {onExit && <ExitButton onExit={onExit} />}
      <CrashFlash at={crashAt} />
      <SixSevenOverlay trigger={sixSevenCount} />
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
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{value}</span>
    </div>
  )
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'rgba(20,30,40,0.78)',
        color: '#eaf4ff',
        font: '13px/1.5 ui-monospace, monospace',
        minWidth: 220,
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ opacity: 0.8, marginBottom: 6, fontWeight: 600 }}>STATE</div>
      {row('clip', clip || '-')}
      {row('speed', `${(s.speed + boost).toFixed(1)} u/s`)}
      {row('· cruise', `${s.speed.toFixed(1)} u/s`)}
      {row('· boost', `+${boost.toFixed(1)} u/s`)}
      {row('rings', `${ringsPassed}`)}
      {row('altitude', `${s.position[1].toFixed(1)} m`)}
      {row('vert vel', `${s.verticalVel.toFixed(1)} u/s`)}
      {row('lateral X', `${s.position[0].toFixed(1)} m`)}
      {row('distance', `${s.distance.toFixed(0)} m`)}
      <div style={{ opacity: 0.8, margin: '8px 0 6px', fontWeight: 600 }}>DUCKACTIONS</div>
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
  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontFamily: MONO, fontSize: '1.5rem', fontWeight: 700, color: COLORS.text }}>
        {value}
      </span>
      <span style={{ color: COLORS.dim, fontSize: '0.78rem', letterSpacing: 0.5 }}>{label}</span>
    </div>
  )
  return (
    <Overlay dim={0.5}>
      <Panel width={420} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: COLORS.gold, marginBottom: 4 }}>
          🏁 Finish!
        </div>
        <p style={{ color: COLORS.dim, margin: '0 0 20px', fontSize: '0.9rem' }}>Nice flying.</p>
        <div style={{ display: 'flex', justifyContent: 'space-around', margin: '0 0 22px' }}>
          {stat('time', formatTime(stats.ms))}
          {stat('rings', String(stats.rings))}
          {stat('distance', `${stats.distance.toFixed(0)}m`)}
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <Button variant="primary" accent={COLORS.accentBlue} onClick={onReset}>
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
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        borderRadius: 12,
        background: 'rgba(10,18,30,0.66)',
        color: COLORS.text,
        fontFamily: FONT,
        fontSize: '0.85rem',
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
        border: '1px solid rgba(120,150,180,0.18)',
      }}
    >
      {cameraControl ? (
        <span>
          Flap your arms to fly · lean your shoulders to turn · drop your arms to dive ·
          open your mouth to quack
        </span>
      ) : (
        <>
          <KeyCap>Space</KeyCap> flap
          <span style={{ margin: '0 8px', color: COLORS.faint }}>·</span>
          <KeyCap>A</KeyCap>
          <KeyCap>D</KeyCap> lean
          <span style={{ margin: '0 8px', color: COLORS.faint }}>·</span>
          <KeyCap>W</KeyCap> dive
        </>
      )}
    </div>
  )
}

function DebugToggle({ debug, onToggle }: { debug: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(40,60,80,0.4)',
        background: debug ? '#3b82f6' : 'rgba(20,30,40,0.72)',
        color: '#eaf4ff',
        font: '12px/1 ui-monospace, monospace',
        cursor: 'pointer',
      }}
    >
      {debug ? 'debug: ON' : 'debug: off'}
    </button>
  )
}

function ExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      type="button"
      onClick={onExit}
      style={{
        position: 'absolute',
        top: 12,
        right: 110,
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid rgba(40,60,80,0.4)',
        background: 'rgba(20,30,40,0.72)',
        color: '#eaf4ff',
        font: '12px/1 ui-monospace, monospace',
        cursor: 'pointer',
      }}
    >
      ← menu
    </button>
  )
}
