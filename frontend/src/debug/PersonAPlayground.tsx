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

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Leva, useControls, button, folder } from 'leva'
import { Group } from 'three'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { useKeyboardControls, type KeyActions } from '../input/keyboard'
import { buildMap, ringCrossing, DEFAULT_MAP_CONFIG, type MapDef } from '../map'
import { MapView } from '../test/MapView'
import { SimpleSky } from '../world/SimpleSky'
import { flightStep, createFlightState, DEFAULT_FLIGHT, type FlightConfig } from './flightModel'
import { Duck } from '../avatar/Duck'
import { FollowCamera } from '../avatar/FollowCamera'
import { DEFAULT_FOLLOW } from '../avatar/followConfig'
import { DEFAULT_ANIM_MAP, type AnimMapConfig } from '../avatar/animationMap'
import { MAX_FRAME_DT, BOOST, BOOST_SLIDERS } from './playgroundConfig'

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
  mapRef,
  finishedRef,
  onFinish,
  passedRingsRef,
  ringPulseAtRef,
  boostRef,
  boostSpeedRef,
  boostDurationRef,
  onRingsChanged,
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
  mapRef: React.RefObject<MapDef>
  finishedRef: React.RefObject<boolean>
  onFinish: () => void
  passedRingsRef: React.RefObject<Set<number>>
  ringPulseAtRef: React.RefObject<Map<number, number>>
  boostRef: React.RefObject<number>
  boostSpeedRef: React.RefObject<number>
  boostDurationRef: React.RefObject<number>
  onRingsChanged: () => void
}) {
  const accRef = useRef(0)

  useFrame((_, delta) => {
    const cfg = cfgRef.current

    // Keep flight + walls in lockstep: the playable corridor is exactly the map's
    // half-width, so the lateral clamp always matches the rendered side walls.
    cfg.lateralRange = mapRef.current.halfWidth

    // While the run is frozen at the finish line we stop advancing the sim (the
    // duck holds its final pose); we still fall through to re-draw it below so the
    // chase camera can settle behind it.
    if (!finishedRef.current) {
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

      const rings = mapRef.current.rings
      const duckRadius = DEFAULT_MAP_CONFIG.duckRadius
      let ringsChanged = false

      while (accRef.current >= cfg.fixedDt) {
        const stepActions: DuckActions = { ...merged, flapImpulse: impulseRef.current }
        impulseRef.current = false // one-shot, consumed by the first sub-step
        const prevZ = stateRef.current.position[2]
        stateRef.current = flightStep(stateRef.current, stepActions, cfg, cfg.fixedDt)
        const s2 = stateRef.current

        // Apply the boost as a decaying OVERSPEED on top of the eased base speed:
        // the flight model pulls `speed` back toward its target, so a raw one-shot
        // add would vanish. Adding extra +Z displacement here survives that easing
        // and decays smoothly over ~boostDuration. Done BEFORE ring detection so
        // the crossing test covers the full sub-step travel (flight + boost) with
        // no skipped sliver.
        if (boostRef.current > BOOST.cutoff) {
          const extra = boostRef.current * cfg.fixedDt
          s2.position[2] += extra
          s2.distance += extra
          const rate = BOOST.decaySharpness / Math.max(BOOST.minDurationSec, boostDurationRef.current)
          boostRef.current *= Math.exp(-rate * cfg.fixedDt)
        } else {
          boostRef.current = 0
        }

        // Ring fly-through detection on the AUTHORITATIVE state over the whole
        // sub-step [prevZ, currZ]. Only a clean pass through the hole boosts (a
        // 'miss' = sailed past outside the ring = no effect). Each ring fires once
        // (guarded by the passed set); the boost it grants starts next sub-step.
        for (let i = 0; i < rings.length; i++) {
          const ring = rings[i]
          if (passedRingsRef.current.has(ring.id)) continue
          const res = ringCrossing(prevZ, s2.position[2], s2.position[0], s2.position[1], ring, duckRadius)
          if (res === 'pass') {
            passedRingsRef.current.add(ring.id)
            ringPulseAtRef.current.set(ring.id, performance.now())
            // Refresh (not stack) the overspeed so back-to-back rings stay snappy.
            boostRef.current = Math.max(boostRef.current, boostSpeedRef.current)
            ringsChanged = true
          }
        }

        accRef.current -= cfg.fixedDt
      }

      // Push newly-passed rings to React state so MapView recolors + flashes.
      if (ringsChanged) onRingsChanged()

      // Finish line: clamp at the end of the finite track and freeze the run once.
      const end = mapRef.current.length
      if (stateRef.current.position[2] >= end) {
        stateRef.current.position[2] = end
        finishedRef.current = true
        onFinish()
      }
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
  boost: number
  ringsPassed: number
}

/** Live readout. Snapshots refs on a timer (in an effect) so render never reads a ref. */
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
      {/* Ground velocity = eased cruise (s.speed) + the decaying ring boost. The
          boost is a separate term applied straight to position, so we add it here
          to show the TRUE speed; the cruise + bonus breakdown is below. */}
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

export function PersonAPlayground() {
  const stateRef = useRef<DuckState>(createFlightState())
  const actionsRef = useRef<DuckActions>(makeIdleActions()) // slider baseline
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions()) // sliders + keyboard (drives anim + HUD)
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')
  const finishedRef = useRef(false)

  // Ring state. The refs are the authoritative copy the sim loop reads/writes each
  // sub-step; the React state mirrors them so MapView recolors + flashes (updated
  // only on the frames a new ring is passed, never per render).
  const passedRingsRef = useRef<Set<number>>(new Set())
  const ringPulseAtRef = useRef<Map<number, number>>(new Map())
  const boostRef = useRef(0) // current decaying overspeed (u/s)
  const boostSpeedRef = useRef<number>(BOOST.speed) // mirror of the leva slider
  const boostDurationRef = useRef<number>(BOOST.durationSec) // mirror of the leva slider
  const [passedRingIds, setPassedRingIds] = useState<Set<number>>(() => new Set())
  const [ringPulseAt, setRingPulseAt] = useState<Map<number, number>>(() => new Map())
  // Snapshot the ring refs into state (called from the sim loop on a new pass).
  const syncRings = useCallback(() => {
    setPassedRingIds(new Set(passedRingsRef.current))
    setRingPulseAt(new Map(ringPulseAtRef.current))
  }, [])

  // Debug toggle: off by default so mode=a is a clean, playable game. On reveals
  // the whole leva panel. Plain React state (not a ref) so the Leva hidden prop
  // and the button label re-render.
  const [debug, setDebug] = useState(false)
  // Finish state drives the results overlay (ref freezes the sim; state re-renders).
  const [finished, setFinished] = useState(false)
  const onFinish = useCallback(() => setFinished(true), [])

  // Stable handlers: ref access lives inside event callbacks, never in render.
  const fireImpulse = useCallback(() => {
    impulseRef.current = true
  }, [])
  const resetState = useCallback(() => {
    stateRef.current = createFlightState()
    finishedRef.current = false
    passedRingsRef.current = new Set()
    ringPulseAtRef.current = new Map()
    boostRef.current = 0
    setFinished(false)
    setPassedRingIds(new Set())
    setRingPulseAt(new Map())
  }, [])

  // Keyboard (Space = flap, A/D = lean, W = dive). Always on in the playground.
  const keyRef = useKeyboardControls(true, fireImpulse)

  // Seed-driven world. buildMap is pure/deterministic, so the same seed always
  // yields the identical terrain. Rebuilding on seed change also resets the run.
  const world = useControls('World', {
    seed: { value: 1337, min: 0, max: 99999, step: 1 },
  })
  const map = useMemo(() => buildMap(world.seed), [world.seed])
  const mapRef = useRef<MapDef>(map)

  // Reset the run whenever the seed (and thus the map) changes. Split to satisfy
  // both hook rules at the root rather than suppress them:
  //   - ref writes (mapRef/stateRef/finishedRef) happen in an effect, never
  //     during render (react-hooks/refs).
  //   - the one React state we must clear (the finish overlay) is adjusted during
  //     render via React's documented previous-value pattern, which is the
  //     recommended alternative to resetting state inside an effect
  //     (avoids react-hooks/set-state-in-effect and the extra render pass).
  const [prevMap, setPrevMap] = useState(map)
  if (prevMap !== map) {
    setPrevMap(map)
    if (finished) setFinished(false)
  }
  useEffect(() => {
    mapRef.current = map
    stateRef.current = createFlightState()
    finishedRef.current = false
  }, [map])

  const actions = useControls('Actions (manual)', {
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    invertLean: false, // flip if left/right feels backward on screen
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
    flapImpulse: button(fireImpulse),
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
      // Corridor half-width: defaults to the map's so flight clamp == rendered
      // walls. The rig re-asserts cfg.lateralRange = map.halfWidth each frame.
      lateralRange: { value: DEFAULT_MAP_CONFIG.halfWidth, min: 5, max: 200 },
    }),
    bounds: folder({
      minAltitude: { value: DEFAULT_FLIGHT.minAltitude, min: 0, max: 20 },
      maxAltitude: { value: DEFAULT_FLIGHT.maxAltitude, min: 20, max: 200 },
    }),
  })

  // Slider defaults + ranges come from playgroundConfig (BOOST_SLIDERS). leva only
  // reads a control's `value` once (on first mount) and its store can survive Vite
  // HMR, so editing the config would otherwise NOT show up. Passing the schema as a
  // function + a deps array of the config values makes leva re-seed the sliders
  // whenever those change, so editing playgroundConfig.ts updates the panel live.
  // NOTE: the function form returns a [values, set] tuple, hence the destructure.
  const [boost] = useControls(
    'Boost (rings)',
    () => ({ ...BOOST_SLIDERS }),
    [BOOST.speed, BOOST.durationSec],
  )

  // Mirror leva values into the refs the sim loop reads (in effects, not render).
  useEffect(() => {
    boostSpeedRef.current = boost.boostSpeed
    boostDurationRef.current = boost.boostDuration
  }, [boost.boostSpeed, boost.boostDuration])

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
      <Canvas shadows camera={{ position: startCam, fov: 62, near: 0.1, far: 8000 }}>
        <Suspense fallback={null}>
          <SimpleSky map={map} />
        </Suspense>
        <ambientLight intensity={0.6} />
        <hemisphereLight color="#ffffff" groundColor="#c8d2dc" intensity={0.5} />
        <directionalLight position={[50, 80, 20]} intensity={1.2} castShadow />
        <MapView map={map} passedRingIds={passedRingIds} ringPulseAt={ringPulseAt} />
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
          mapRef={mapRef}
          finishedRef={finishedRef}
          onFinish={onFinish}
          passedRingsRef={passedRingsRef}
          ringPulseAtRef={ringPulseAtRef}
          boostRef={boostRef}
          boostSpeedRef={boostSpeedRef}
          boostDurationRef={boostDurationRef}
          onRingsChanged={syncRings}
        />
        <FollowCamera stateRef={stateRef} cfg={cam} />
      </Canvas>
      <Hud
        stateRef={stateRef}
        actionsRef={mergedActionsRef}
        clipRef={clipRef}
        boostRef={boostRef}
        passedRingsRef={passedRingsRef}
      />
      <ControlsHint />
      <DebugToggle debug={debug} onToggle={() => setDebug((d) => !d)} />
      {finished && <FinishOverlay stateRef={stateRef} onReset={resetState} />}
    </div>
  )
}

/**
 * Results card shown when the duck reaches the finish line. Snapshots the final
 * run stats once on mount (in an effect, so render never reads the ref) and
 * offers a restart that resets the run from the start.
 */
function FinishOverlay({
  stateRef,
  onReset,
}: {
  stateRef: React.RefObject<DuckState>
  onReset: () => void
}) {
  const [stats, setStats] = useState<{ distance: number; speed: number } | null>(null)
  useEffect(() => {
    const s = stateRef.current
    setStats({ distance: s.distance, speed: s.speed })
  }, [stateRef])

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8,14,22,0.45)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          padding: '28px 36px',
          borderRadius: 14,
          background: 'rgba(20,30,40,0.92)',
          color: '#eaf4ff',
          font: '15px/1.6 ui-monospace, monospace',
          textAlign: 'center',
          minWidth: 260,
          boxShadow: '0 12px 48px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, color: '#ffd24a' }}>
          FINISH
        </div>
        <div style={{ margin: '14px 0', opacity: 0.85 }}>
          <div>distance flown: {(stats?.distance ?? 0).toFixed(0)} m</div>
          <div>final speed: {(stats?.speed ?? 0).toFixed(1)} u/s</div>
        </div>
        <button
          type="button"
          onClick={onReset}
          style={{
            marginTop: 6,
            padding: '8px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            font: '14px/1 ui-monospace, monospace',
            cursor: 'pointer',
          }}
        >
          fly again
        </button>
      </div>
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
