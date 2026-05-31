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
import { WebcamPanel } from './WebcamPanel'
import { useInputStore } from '../input/store'
import type { LandmarkFrame } from '../input/fixtures/landmarks'
import { FlapStrategy, wristHeight, type FlapMode } from '../input/gestures/flap'
import { config } from '../input/config'
import type { Baseline } from '../input/calibration'

// Mouth-open (the Face Landmarker jawOpen blendshape, 0..1) above this threshold
// reads as a quack this frame. Fed from WebcamPanel's time-sliced face loop.
const QUACK_THRESHOLD = 0.4

// Pose updates arrive slower than useFrame ticks, so a brief gap with no NEW
// landmark frame is normal (MediaPipe between detections; a present, still body
// still re-emits a fresh frame each detection). But if no new frame arrives for
// this many ticks the body has left the camera entirely (the pose loop stops
// emitting when it sees no body), so we decay the gesture flap to 0 -- the rate
// detector only relaxes on push(), which has stopped.
const STALE_POSE_TICKS = 15

// A detected binary flap raises a flap PULSE to 1.0 that then decays at this rate
// (per second, exponential). It makes a gesture flap feel like a Space tap -- the
// wings animate, the nose pitches up, and the duck climbs -- instead of a silent
// one-frame vertical kick. ~6 gives roughly a half-second wingbeat envelope.
const FLAP_PULSE_DECAY_RATE = 6

// Live gesture diagnostics surfaced in the HUD so we can see WHY a flap does or
// does not register: whether the sim is active, the current normalized wrist
// height (what the binary high/low thresholds compare against), the minimum
// visibility of the tracked joints (a low value means MediaPipe is unsure and the
// tracker holds its last height), the continuous rate-mode flap, and a running
// count of binary impulses fired.
interface GestureDebug {
  active: boolean
  h: number
  minVis: number
  flap: number
  impulses: number
}

/** Runs the fixed-timestep flight model and positions the duck from the result. */
function PlaygroundRig({
  stateRef,
  actionsRef,
  cfgRef,
  activeRef,
  flapStrategyRef,
  gestureDbgRef,
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
  activeRef: React.RefObject<boolean>
  flapStrategyRef: React.RefObject<FlapStrategy>
  gestureDbgRef: React.RefObject<GestureDebug>
  impulseRef: React.RefObject<boolean>
  duckRef: React.RefObject<Group | null>
  duckVisual: {
    scale: number
    modelYaw: number
    crossfade: number
    flapAnimSpeed: number
    flapHoldSeconds: number
  }
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
  // Gesture-flap plumbing. The FlapStrategy must see each POSE frame exactly once
  // (its velocity window counts pose frames), but useFrame runs faster than pose
  // updates, so we only push when the store's landmark frame reference changes.
  // gestureFlapRef carries the continuous rate-mode lift between pose frames; the
  // binary-mode impulse is fired one-shot through impulseRef.
  const lastPoseFrameRef = useRef<LandmarkFrame | null>(null)
  const gestureFlapRef = useRef(0)
  const flapPulseRef = useRef(0)
  const stalePoseTicksRef = useRef(0)

  useFrame((_, delta) => {
    const cfg = cfgRef.current

    // Keep flight + walls in lockstep: the playable corridor is exactly the map's
    // half-width, so the lateral clamp always matches the rendered side walls.
    cfg.lateralRange = mapRef.current.halfWidth

    // Surface whether the sim is actually running, for the HUD gesture readout.
    gestureDbgRef.current.active = activeRef.current

    // Calibration in progress: HOLD the duck where it is (do not advance the sim),
    // relax it to the idle/hover pose, and drop any accumulated time so the run
    // does not lurch forward the instant calibration completes. On first load the
    // duck waits at its start pose (y=100, a good viewing height); a mid-run
    // recalibrate freezes it in place. We still fall through to re-draw it so the
    // chase camera stays settled behind the waiting duck.
    if (!activeRef.current) {
      mergedRef.current = makeIdleActions()
      accRef.current = 0
      // Drop any one-shot wingbeat queued while frozen (the keyboard stays live
      // during calibration, so a Space tap would otherwise latch impulseRef and
      // fire a climb kick the instant the run resumes). The sim loop is the only
      // other place this is cleared, and it does not run while inactive.
      impulseRef.current = false
    } else if (!finishedRef.current) {
      // While the run is frozen at the finish line we likewise stop advancing the
      // sim (the duck holds its final pose); the same re-draw below settles the cam.
      accRef.current += Math.min(delta, MAX_FRAME_DT)

      // Decay the binary flap PULSE (the short-lived flap-field envelope a detected
      // flap raises, below) so a gesture flap drives the wing animation, the
      // nose-up pitch and sustained lift -- it feels like a Space tap rather than a
      // silent one-frame vertical kick. Frame-rate independent so the felt length
      // is the same regardless of FPS.
      flapPulseRef.current *= Math.exp(-FLAP_PULSE_DECAY_RATE * delta)
      if (flapPulseRef.current < 0.01) flapPulseRef.current = 0

      // Merge the slider baseline with live keyboard input ONCE per frame (neither
      // changes within a frame). This merged object is the single source of truth
      // for BOTH the physics AND the duck's animation + HUD, so holding Space (flap)
      // actually swings the wings -- previously the Duck read the slider-only ref and
      // never saw keyboard flap, so it stayed gliding.
      // Read the body's flap gesture once per NEW pose frame. useFrame runs faster
      // than pose updates, so pushing every tick would feed the velocity tracker
      // duplicate frames and dilute the stroke; we push only when the store's
      // landmark frame reference actually changes. Rate mode contributes a
      // continuous lift (gestureFlapRef); binary mode fires a one-shot impulse
      // through impulseRef. No body in frame means no gesture lift.
      const poseFrame = useInputStore.getState().landmarks
      if (poseFrame && poseFrame !== lastPoseFrameRef.current) {
        // A genuinely new pose frame: feed it to the strategy exactly once.
        lastPoseFrameRef.current = poseFrame
        stalePoseTicksRef.current = 0
        const flapOut = flapStrategyRef.current.push(poseFrame)
        gestureFlapRef.current = flapOut.flap
        if (flapOut.flapImpulse) {
          // A completed binary flap: fire the one-shot wingbeat kick AND raise the
          // flap pulse to full, so this flap animates + pitches + climbs like a
          // Space tap rather than only nudging vertical velocity.
          impulseRef.current = true
          flapPulseRef.current = 1
        }
        // Diagnostics for the HUD: the live height the thresholds compare against,
        // the joint visibility (low = MediaPipe unsure, tracker holds), and a
        // running impulse count. (gesture flap is written each frame below so the
        // readout shows the pulse.)
        const dbg = gestureDbgRef.current
        dbg.h = wristHeight(poseFrame)
        dbg.minVis = Math.min(
          poseFrame[11].visibility,
          poseFrame[12].visibility,
          poseFrame[15].visibility,
          poseFrame[16].visibility,
        )
        if (flapOut.flapImpulse) dbg.impulses += 1
      } else {
        // No new pose this tick. A short gap is just MediaPipe between detections,
        // but a SUSTAINED gap means the body left the frame, so zero the gesture
        // lift and reset the detector buffer so a later return does not spike.
        stalePoseTicksRef.current += 1
        if (stalePoseTicksRef.current > STALE_POSE_TICKS) {
          gestureFlapRef.current = 0
          flapStrategyRef.current.reset()
        }
      }

      const base = actionsRef.current
      const k = keyRef.current
      // The body's flap contribution to the flap field: rate mode supplies a
      // continuous value (gestureFlapRef); binary mode supplies the decaying pulse
      // a detected flap raised. Either way it drives the wing animation, nose-up
      // pitch and lift -- the same flap field Space writes.
      const gestureFlap = gestureFlapRef.current + flapPulseRef.current
      gestureDbgRef.current.flap = gestureFlap
      const merged: DuckActions = {
        flap: Math.min(1, base.flap + k.flap + gestureFlap),
        flapImpulse: false,
        lean: Math.max(-1, Math.min(1, base.lean + k.lean)),
        dive: Math.min(1, base.dive + k.dive),
        // Quack fires from the slider OR an open mouth (jawOpen blendshape).
        quack: base.quack || useInputStore.getState().jawOpen > QUACK_THRESHOLD,
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
      flapAnimSpeed={duckVisual.flapAnimSpeed}
      flapHoldSeconds={duckVisual.flapHoldSeconds}
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
  jawOpen: number
  gesture: GestureDebug
}

/** Live readout. Snapshots refs on a timer (in an effect) so render never reads a ref. */
function Hud({
  stateRef,
  actionsRef,
  clipRef,
  boostRef,
  passedRingsRef,
  gestureDbgRef,
}: {
  stateRef: React.RefObject<DuckState>
  actionsRef: React.RefObject<DuckActions>
  clipRef: React.RefObject<string>
  boostRef: React.RefObject<number>
  passedRingsRef: React.RefObject<Set<number>>
  gestureDbgRef: React.RefObject<GestureDebug>
}) {
  const [snap, setSnap] = useState<HudSnapshot>(() => ({
    s: createFlightState(),
    a: makeIdleActions(),
    clip: 'idle_1',
    boost: 0,
    ringsPassed: 0,
    jawOpen: 0,
    gesture: { active: false, h: 0, minVis: 0, flap: 0, impulses: 0 },
  }))

  useEffect(() => {
    const id = setInterval(() => {
      setSnap({
        s: stateRef.current,
        a: actionsRef.current,
        clip: clipRef.current,
        boost: boostRef.current,
        ringsPassed: passedRingsRef.current.size,
        jawOpen: useInputStore.getState().jawOpen,
        gesture: { ...gestureDbgRef.current },
      })
    }, 100)
    return () => clearInterval(id)
  }, [stateRef, actionsRef, clipRef, boostRef, passedRingsRef, gestureDbgRef])

  const { s, a, clip, boost, ringsPassed, jawOpen, gesture } = snap
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
      {row('mouth jawOpen', jawOpen.toFixed(2))}
      {row('egg67', a.egg67 ? 'true' : 'false')}
      <div style={{ opacity: 0.8, margin: '8px 0 6px', fontWeight: 600 }}>GESTURE (flap)</div>
      {row('sim active', gesture.active ? 'yes' : 'no (calibrating)')}
      {/* Live wrist height in body units: how far the wrists are above the
          shoulder line. Binary flap fires when this crosses the high threshold. */}
      {row('wrist height', gesture.h.toFixed(2))}
      {/* Min joint visibility: if this dips below 0.5 the tracker holds its last
          height (so fast, blurry hand swings can stop registering). */}
      {row('joint vis', gesture.minVis.toFixed(2))}
      {row('gesture flap', gesture.flap.toFixed(2))}
      {row('flap impulses', `${gesture.impulses}`)}
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
  // Body-driven flap. The strategy owns the gesture detectors (config.flapMode
  // picks binary vs rate); it is rebuilt when the mode toggles (effect below).
  const flapStrategyRef = useRef<FlapStrategy>(new FlapStrategy())
  // Live gesture diagnostics: the rig writes them each frame, the HUD reads them.
  const gestureDbgRef = useRef<GestureDebug>({
    active: false,
    h: 0,
    minVis: 0,
    flap: 0,
    impulses: 0,
  })

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

  // Calibration gate: the game is INACTIVE (the duck is held hovering, the sim
  // paused) until calibration completes, and again whenever the player re-opens
  // the gate to recalibrate. WebcamPanel drives this via onActiveChange; activeRef
  // mirrors it for the useFrame sim loop (refs are only written in effects).
  const [active, setActive] = useState(false)
  const activeRef = useRef(false)
  useEffect(() => {
    activeRef.current = active
  }, [active])

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

  // Calibration baseline captured by the WebcamPanel gate at the start of the
  // session. Held for the gesture steps (04+) that will normalize wrist lift and
  // lean against it; for now we just stash and log it so calibration is verifiable.
  const baselineRef = useRef<Baseline | null>(null)
  const handleCalibrated = useCallback((b: Baseline) => {
    baselineRef.current = b
    console.info('[calibration] baseline captured:', b)
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

  // Body gesture A/B + live tuning. 'binary' = one climb kick per completed flap;
  // 'rate' = continuous lift scaled by flap speed. The thresholds default LOWER
  // than the unit-test config (0.6/0.2) so a natural wing-flap triggers without
  // raising the hands to head height; tune them live here while playing. The
  // numbers are in body units (shoulder-widths of wrist height above the
  // shoulder line), so a value of 0.35 means "wrists about a third of a
  // shoulder-width above the shoulders arms the flap".
  const gestures = useControls('Gestures', {
    // Default to RATE: it tracks wrist MOVEMENT (flap speed), so you can flap with
    // your arms in any comfortable position instead of holding them up to a height.
    flapMode: { value: 'rate', options: ['binary', 'rate'] },
    flapTuning: folder({
      // --- Rate mode (default) ---
      // Maps flap speed to lift. Higher = the same flap climbs harder / registers
      // more easily, and a gentle swing already holds altitude instead of sinking.
      // Crank toward 20 to make even small swings launch you up.
      rateGain: { value: 10.0, min: 0, max: 20, step: 0.1 },
      // Motion floor: wrist speed below this is treated as noise (no lift). Lower =
      // catches gentler flaps (at the cost of more jitter sensitivity).
      sensitivity: { value: 0.02, min: 0, max: 0.1, step: 0.005 },
      rateDecay: { value: config.flapRateDecay, min: 0.05, max: 1, step: 0.05 },
      // --- Binary mode only: wrist height (body units) to arm / disarm a beat ---
      highThreshold: { value: 0.25, min: 0, max: 1.5, step: 0.01 },
      lowThreshold: { value: 0.08, min: 0, max: 1, step: 0.01 },
      refractoryFrames: { value: config.flapRefractoryFrames, min: 0, max: 20, step: 1 },
    }),
  })

  const duckVisual = useControls('Duck', {
    scale: { value: 1, min: 0.1, max: 5, step: 0.05 }, // multiplier on the auto-fitted size
    modelYaw: { value: 0, min: -Math.PI, max: Math.PI, step: 0.01 },
    crossfade: { value: 0.25, min: 0, max: 1, step: 0.01 },
    // Max wingbeat speed at a full-strength flap (the actual speed scales with the
    // flap value), and how long the flap clip is held after a stroke so brief dips
    // do not restart the wing cycle mid-swing.
    flapAnimSpeed: { value: 2.5, min: 1, max: 4, step: 0.1 },
    flapHoldSeconds: { value: 0.35, min: 0, max: 1, step: 0.05 },
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

  // Rebuild the flap strategy when the mode or any tuning slider changes, so
  // binary vs rate and the live thresholds take effect immediately (each rebuild
  // owns fresh detector state). Done in an effect, never render.
  useEffect(() => {
    const high = gestures.highThreshold
    // Keep low strictly below high so the detector's hysteresis guard never throws
    // mid-drag when the sliders cross.
    const low = Math.min(gestures.lowThreshold, high - 0.01)
    flapStrategyRef.current = new FlapStrategy({
      flapMode: gestures.flapMode as FlapMode,
      highThreshold: high,
      lowThreshold: low,
      refractoryFrames: gestures.refractoryFrames,
      gain: gestures.rateGain,
      decay: gestures.rateDecay,
      noiseEpsilon: gestures.sensitivity,
    })
  }, [
    gestures.flapMode,
    gestures.highThreshold,
    gestures.lowThreshold,
    gestures.refractoryFrames,
    gestures.rateGain,
    gestures.rateDecay,
    gestures.sensitivity,
  ])

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
          activeRef={activeRef}
          flapStrategyRef={flapStrategyRef}
          gestureDbgRef={gestureDbgRef}
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
        gestureDbgRef={gestureDbgRef}
      />
      <ControlsHint />
      <DebugToggle debug={debug} onToggle={() => setDebug((d) => !d)} />
      {finished && <FinishOverlay stateRef={stateRef} onReset={resetState} />}
      {/* Webcam feed (bottom-left) + landmark overlay, plus the start-of-session
          calibration gate. Owns the entire MediaPipe pipeline; mount it once.
          onActiveChange freezes the duck (held hovering) while the gate is open
          and starts/resumes the run once calibration completes. */}
      <WebcamPanel onCalibrated={handleCalibrated} onActiveChange={setActive} />
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
