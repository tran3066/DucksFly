// Person A test playground (route: ?mode=a).
//
// A playable replica of the Unity prototype so input/animation/camera can be
// tuned and tested. The duck auto-flies forward forever (infinite runner); SPACE
// flaps to climb, no input gently descends, A/D bank-strafe left/right, W dives.
// It uses the Unity-port flight model (src/debug/flightModel.ts) and a RIGID
// chase camera (no roll, constant pitch) so the view never skews. Person C's
// physics module is untouched and still drives his own sandbox (default route).
//
// Game mode vs debug: by default the leva panel is HIDDEN and the defaults are
// tuned to be immediately playable. Toggle "debug" (top-right) to reveal every
// slider. Ref discipline: refs are only read/written in effects or useFrame,
// never during render (react-hooks rules).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Leva, useControls, button, folder } from 'leva'
import { Group } from 'three'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { useKeyboardControls, type KeyActions } from '../input/keyboard'
import { DebugArena } from './DebugArena'
import { flightStep, createFlightState, DEFAULT_FLIGHT, type FlightConfig } from './flightModel'
import { Duck } from '../avatar/Duck'
import { FollowCamera } from '../avatar/FollowCamera'
import { DEFAULT_FOLLOW } from '../avatar/followConfig'
import { DEFAULT_ANIM_MAP, type AnimMapConfig } from '../avatar/animationMap'

const MAX_FRAME_DT = 0.1 // clamp to avoid spiral-of-death after a tab stall
const BG = '#e9eef3' // light, clean test-bed background

/** Runs the fixed-timestep flight model and positions the duck from the result. */
function PlaygroundRig({
  stateRef,
  actionsRef,
  cfgRef,
  impulseRef,
  duckRef,
  duckVisual,
  animCfg,
  clipRef,
  keyRef,
  mergedRef,
}: {
  stateRef: React.RefObject<DuckState>
  actionsRef: React.RefObject<DuckActions>
  cfgRef: React.RefObject<FlightConfig>
  impulseRef: React.RefObject<boolean>
  duckRef: React.RefObject<Group | null>
  duckVisual: { scale: number; modelYaw: number; crossfade: number }
  animCfg: AnimMapConfig
  clipRef: React.RefObject<string>
  keyRef: React.RefObject<KeyActions>
  mergedRef: React.RefObject<DuckActions>
}) {
  const accRef = useRef(0)

  useFrame((_, delta) => {
    const cfg = cfgRef.current
    accRef.current += Math.min(delta, MAX_FRAME_DT)

    // Merge the slider baseline with live keyboard input ONCE per frame (neither
    // changes within a frame). This merged object is the single source of truth
    // for BOTH the physics AND the duck's animation + HUD, so holding Space (flap)
    // actually swings the wings -- previously the Duck read the slider-only ref and
    // never saw keyboard flap, so it stayed gliding.
    const base = actionsRef.current
    const k = keyRef.current
    const merged: DuckActions = {
      flap: Math.min(1, base.flap + k.flap),
      flapImpulse: false,
      lean: Math.max(-1, Math.min(1, base.lean + k.lean)),
      dive: Math.min(1, base.dive + k.dive),
      quack: base.quack,
      egg67: base.egg67,
      confidence: base.confidence,
    }
    mergedRef.current = merged

    while (accRef.current >= cfg.fixedDt) {
      const stepActions: DuckActions = { ...merged, flapImpulse: impulseRef.current }
      impulseRef.current = false // one-shot, consumed by the first sub-step
      stateRef.current = flightStep(stateRef.current, stepActions, cfg, cfg.fixedDt)
      accRef.current -= cfg.fixedDt
    }

    const s = stateRef.current
    const g = duckRef.current
    if (!g) return
    g.position.set(s.position[0], s.position[1], s.position[2])
    g.rotation.order = 'YXZ'
    g.rotation.set(s.pitch, s.yaw, s.roll)
  })

  return (
    <Duck
      ref={duckRef}
      actionsRef={mergedRef}
      scale={duckVisual.scale}
      modelYaw={duckVisual.modelYaw}
      crossfade={duckVisual.crossfade}
      animCfg={animCfg}
      clipRef={clipRef}
    />
  )
}

interface HudSnapshot {
  s: DuckState
  a: DuckActions
  clip: string
}

/** Live readout. Snapshots refs on a timer (in an effect) so render never reads a ref. */
function Hud({
  stateRef,
  actionsRef,
  clipRef,
}: {
  stateRef: React.RefObject<DuckState>
  actionsRef: React.RefObject<DuckActions>
  clipRef: React.RefObject<string>
}) {
  const [snap, setSnap] = useState<HudSnapshot>(() => ({
    s: createFlightState(),
    a: makeIdleActions(),
    clip: 'idle_1',
  }))

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({ s: stateRef.current, a: actionsRef.current, clip: clipRef.current })
    }, 100)
    return () => clearInterval(id)
  }, [stateRef, actionsRef, clipRef])

  const { s, a, clip } = snap
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
      {row('speed', `${s.speed.toFixed(1)} u/s`)}
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

export function PersonAPlayground() {
  const stateRef = useRef<DuckState>(createFlightState())
  const actionsRef = useRef<DuckActions>(makeIdleActions()) // slider baseline
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions()) // sliders + keyboard (drives anim + HUD)
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')

  // Debug toggle: off by default so mode=a is a clean, playable game. On reveals
  // the whole leva panel. Plain React state (not a ref) so the Leva hidden prop
  // and the button label re-render.
  const [debug, setDebug] = useState(false)

  // Stable handlers: ref access lives inside event callbacks, never in render.
  const fireImpulse = useCallback(() => {
    impulseRef.current = true
  }, [])
  const resetState = useCallback(() => {
    stateRef.current = createFlightState()
  }, [])

  // Keyboard (Space = flap, A/D = lean, W = dive). Always on in the playground.
  const keyRef = useKeyboardControls(true, fireImpulse)

  const actions = useControls('Actions (manual)', {
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    invertLean: false, // flip if left/right feels backward on screen
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
    // leva's button() takes its handler at definition time; the closures only run
    // on click, never during render (false positives for react-hooks/refs).
    // eslint-disable-next-line react-hooks/refs
    flapImpulse: button(fireImpulse),
    // eslint-disable-next-line react-hooks/refs
    reset: button(resetState),
  })

  const duckVisual = useControls('Duck', {
    scale: { value: 1, min: 0.1, max: 5, step: 0.05 }, // multiplier on the auto-fitted size
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
      lateralRange: { value: DEFAULT_FLIGHT.lateralRange, min: 5, max: 80 },
    }),
    bounds: folder({
      minAltitude: { value: DEFAULT_FLIGHT.minAltitude, min: 0, max: 20 },
      maxAltitude: { value: DEFAULT_FLIGHT.maxAltitude, min: 20, max: 200 },
    }),
  })

  // Mirror leva values into the refs the sim loop reads (in effects, not render).
  useEffect(() => {
    actionsRef.current = {
      flap: actions.flap,
      flapImpulse: false, // impulses go through impulseRef (one-shot button)
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

  // Start the camera exactly where the rigid follow cam will hold it, so frame 1
  // is already correct (behind + above the duck's start, level horizon).
  const start = createFlightState().position
  const startCam: [number, number, number] = [
    start[0] + DEFAULT_FOLLOW.lateral,
    start[1] + DEFAULT_FOLLOW.up,
    start[2] - DEFAULT_FOLLOW.back,
  ]

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      {/* leva panel only shows when debug is on; values persist when hidden. */}
      <Leva hidden={!debug} />
      <Canvas camera={{ position: startCam, fov: 62, near: 0.1, far: 8000 }}>
        <color attach="background" args={[BG]} />
        <ambientLight intensity={0.9} />
        <hemisphereLight color="#ffffff" groundColor="#c8d2dc" intensity={0.6} />
        <directionalLight position={[30, 80, 20]} intensity={0.8} />
        <DebugArena halfWidth={cfg.lateralRange} stateRef={stateRef} />
        <PlaygroundRig
          stateRef={stateRef}
          actionsRef={actionsRef}
          cfgRef={cfgRef}
          impulseRef={impulseRef}
          duckRef={duckGroupRef}
          duckVisual={duckVisual}
          animCfg={animCfg}
          clipRef={clipRef}
          keyRef={keyRef}
          mergedRef={mergedActionsRef}
        />
        <FollowCamera stateRef={stateRef} cfg={cam} />
      </Canvas>
      <Hud stateRef={stateRef} actionsRef={mergedActionsRef} clipRef={clipRef} />
      <ControlsHint />
      <DebugToggle debug={debug} onToggle={() => setDebug((d) => !d)} />
    </div>
  )
}

/** Bottom-center reminder of the keyboard controls. */
function ControlsHint() {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        borderRadius: 8,
        background: 'rgba(20,30,40,0.72)',
        color: '#eaf4ff',
        font: '13px/1 ui-monospace, monospace',
        letterSpacing: 0.5,
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      SPACE flap · A / D lean · W dive
    </div>
  )
}

/** Always-visible debug toggle (top-right). Shows/hides the leva panel. */
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
