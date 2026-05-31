// The shared local-player flight rig — the canonical sim loop lifted out of the
// Person A playground (`PlaygroundRig`) and generalized so BOTH the single-player
// game and the multiplayer game drive their own duck through the exact same code.
//
// What it does each frame (fixed-timestep, ref-only — never reads/writes refs
// during render):
//   1. eases the slider/idle baseline with live keyboard into one merged action,
//   2. advances `flightStep` in fixed sub-steps while `runningRef` is true,
//   3. detects clean ring fly-throughs on the authoritative state and applies a
//      decaying overspeed boost (and reports the pass via `onRingPassed`),
//   4. positions + orients the duck and animates it via the reused `avatar/Duck`.
//
// Mode differences are injected, so SP and MP never touch each other:
//   - `runningRef`   : SP = always true; MP = (phase === 'racing').
//   - `enableFinish` : SP freezes at `map.length`; MP leaves finishing to the server.
//   - `onRingPassed` : MP reports the pass to the server; SP omits it.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Group } from 'three'
import type { DuckActions, DuckState } from '../physics'
import type { KeyActions } from '../input/keyboard'
import { ringCrossing, ringRimHit, treeHit, DEFAULT_MAP_CONFIG, type MapDef } from '../map'
import { Duck } from '../avatar/Duck'
import type { DuckVariant } from '../avatar/loadDuck'
import { type AnimMapConfig } from '../avatar/animationMap'
import { flightStep, createFlightState, type FlightConfig } from './flight'
import { lastCheckpointZ } from './respawn'
import { MAX_FRAME_DT, BOOST } from './gameConfig'
import { makeIdleActions } from '../shared/types/duckActions'
import { useInputStore } from '../input/store'
import { getBaseline, useCalibrationStore } from '../input/calibration'
import { diveFromArmsDown, type FlapStrategy } from '../input/gestures/flap'
import { computeLean, type LeanCalib } from '../input/gestures/lean'
import { detectSixSeven, makeSixSevenState } from '../input/gestures/sixSeven'
import { playSixSeven, isSixSevenPlaying } from './sfx'
import type { LandmarkFrame } from '../input/fixtures/landmarks'
import {
  GESTURE_TURN,
  GESTURE_DIVE,
  QUACK_THRESHOLD,
  STALE_POSE_TICKS,
  FLAP_PULSE_DECAY_RATE,
  makeFlapStrategy,
} from './gestureConfig'

/** Invulnerability window after a respawn, ms (matches the MP spin-out window). */
const RESPAWN_INVULN_MS = 1200
/** Suppress the "6-7" gesture for this long after a run (re)starts, so settling out
 *  of the calibration pose into the flying stance never reads as the gesture. */
const SIXSEVEN_START_GRACE_MS = 1500
/** Broad-phase cull: only test trees within this |Δz| of the duck, meters. */
const TREE_CULL_Z = 8

export interface FlightRigProps {
  stateRef: React.RefObject<DuckState>
  /** Slider/idle baseline action (must carry confidence=1 to actually move). */
  actionsRef: React.RefObject<DuckActions>
  cfgRef: React.RefObject<FlightConfig>
  impulseRef: React.RefObject<boolean>
  duckRef: React.RefObject<Group | null>
  duckVisual: { scale: number; modelYaw: number; crossfade: number; flapAnimSpeed?: number }
  animCfg: AnimMapConfig
  clipRef: React.RefObject<string>
  keyRef: React.RefObject<KeyActions>
  /** When true, fold MediaPipe camera gestures (flap/lean/dive/quack) into the
   *  merged actions, on top of the always-live keyboard. False = keyboard only
   *  (byte-identical to the pre-camera behavior). */
  cameraControl: boolean
  /** Sliders + keyboard merged here each frame; drives the duck anim + HUD. */
  mergedRef: React.RefObject<DuckActions>
  mapRef: React.RefObject<MapDef>
  variant?: DuckVariant
  /** Sim advances only while this is true (SP: always; MP: racing phase). */
  runningRef: React.RefObject<boolean>
  /** SP freezes the run at the finish line; MP leaves finishing to the server. */
  enableFinish: boolean
  finishedRef: React.RefObject<boolean>
  onFinish?: () => void
  passedRingsRef: React.RefObject<Set<number>>
  ringPulseAtRef: React.RefObject<Map<number, number>>
  boostRef: React.RefObject<number>
  boostSpeedRef: React.RefObject<number>
  boostDurationRef: React.RefObject<number>
  /** Fired (React state sync) when the passed-ring set changes, so MapView recolors. */
  onRingsChanged?: () => void
  /** Fired once per newly-passed ring (MP reports it to the server). */
  onRingPassed?: (ringId: number) => void
  /** Fired when the local duck crashes (tree/ring rim) and respawns; drives the flash. */
  onCrash?: () => void
  /** Fired once each time the "6-7" two-handed gesture is recognized; drives the
   *  on-screen "6 7" pop. Gated so it never fires while the 6-7 sound is playing. */
  onSixSeven?: () => void
}

export function FlightRig({
  stateRef,
  actionsRef,
  cfgRef,
  impulseRef,
  duckRef,
  duckVisual,
  animCfg,
  clipRef,
  keyRef,
  cameraControl,
  mergedRef,
  mapRef,
  variant = 'male',
  runningRef,
  enableFinish,
  finishedRef,
  onFinish,
  passedRingsRef,
  ringPulseAtRef,
  boostRef,
  boostSpeedRef,
  boostDurationRef,
  onRingsChanged,
  onRingPassed,
  onCrash,
  onSixSeven,
}: FlightRigProps) {
  const accRef = useRef(0)
  // performance.now() ms until which collisions are ignored (post-respawn grace).
  const invulnUntilRef = useRef(0)

  // --- MediaPipe gesture plumbing (camera control). Ported verbatim from the
  //     Person A playground's PlaygroundRig so the felt behavior is identical.
  //     The FlapStrategy must see each POSE frame exactly once (its velocity
  //     window counts pose frames), but useFrame runs faster than pose updates,
  //     so we only push when the store's landmark frame reference changes.
  //     gestureFlapRef carries continuous rate-mode lift between pose frames; the
  //     binary-mode impulse is fired one-shot through impulseRef. These refs are
  //     only consumed while cameraControl is true (gestures gate to 0 otherwise). ---
  const flapStrategyRef = useRef<FlapStrategy>(makeFlapStrategy())
  const lastPoseFrameRef = useRef<LandmarkFrame | null>(null)
  const gestureFlapRef = useRef(0)
  const flapPulseRef = useRef(0)
  const gestureLeanRef = useRef(0)
  const gestureDiveRef = useRef(0)
  const stalePoseTicksRef = useRef(0)
  // "6-7" easter egg: two-handed wrist alternation. Stateful detector + a one-shot
  // flag that is true for the single frame the gesture fires (consumed each frame).
  const sixSevenStateRef = useRef(makeSixSevenState())
  const egg67ShotRef = useRef(false)
  // Track the running edge so we can reset the 6-7 detector and start a short grace
  // window each time the run (re)starts, so the calibration->fly settle motion at
  // the start of a race never reads as the gesture.
  const wasRunningRef = useRef(false)
  const runStartMsRef = useRef(0)

  useFrame((_, delta) => {
    const cfg = cfgRef.current

    // Keep flight + walls in lockstep: the playable corridor is exactly the map's
    // half-width, so the lateral clamp always matches the rendered side walls.
    cfg.lateralRange = mapRef.current.halfWidth

    // A camera (re)calibrate gate is open: freeze the sim (the duck hovers) until
    // it closes. Only relevant in camera mode; keyboard mode never opens the gate.
    const calibrating = cameraControl && useCalibrationStore.getState().gateOpen
    const frozen = enableFinish && finishedRef.current
    const running = runningRef.current && !frozen && !calibrating

    // On each run (re)start, reset the 6-7 detector and stamp the start time so the
    // settle-into-flying motion right after calibration cannot fire a false egg.
    const now = performance.now()
    if (running && !wasRunningRef.current) {
      runStartMsRef.current = now
      sixSevenStateRef.current = makeSixSevenState()
    }
    wasRunningRef.current = running

    if (running) {
      accRef.current += Math.min(delta, MAX_FRAME_DT)

      // Decay the binary flap PULSE (the short-lived flap-field envelope a detected
      // gesture flap raises below) so a camera flap drives the wing animation,
      // nose-up pitch and sustained lift like a Space tap. Frame-rate independent.
      flapPulseRef.current *= Math.exp(-FLAP_PULSE_DECAY_RATE * delta)
      if (flapPulseRef.current < 0.01) flapPulseRef.current = 0

      // MediaPipe gestures (camera mode only). Read the body's flap/lean/dive once
      // per NEW pose frame: useFrame runs faster than pose updates, so pushing
      // every tick would feed the velocity tracker duplicate frames and dilute the
      // stroke; we push only when the store's landmark frame reference changes.
      if (cameraControl) {
        const poseFrame = useInputStore.getState().landmarks
        if (poseFrame && poseFrame !== lastPoseFrameRef.current) {
          lastPoseFrameRef.current = poseFrame
          stalePoseTicksRef.current = 0
          const flapOut = flapStrategyRef.current.push(poseFrame)
          gestureFlapRef.current = flapOut.flap
          if (flapOut.flapImpulse) {
            // A completed binary flap: fire the one-shot wingbeat kick AND raise the
            // flap pulse to full so it animates + pitches + climbs like a Space tap.
            impulseRef.current = true
            flapPulseRef.current = 1
          }
          // Body-driven steering: shoulder tilt measured against the calibrated
          // rest angle (0 if somehow uncalibrated), EMA-smoothed against jitter.
          const baseline = getBaseline()
          const calib: LeanCalib = {
            restShoulderAngle: baseline ? baseline.restShoulderAngle : 0,
            mirrorSign: GESTURE_TURN.mirrorSign,
            maxTiltRad: GESTURE_TURN.maxTiltRad,
            saturationWidthRatio: GESTURE_TURN.saturationWidthRatio,
          }
          const rawLean = computeLean(poseFrame, calib, GESTURE_TURN.turnMode)
          gestureLeanRef.current += GESTURE_TURN.smoothing * (rawLean - gestureLeanRef.current)
          // Body-driven dive: dropping both arms below the shoulders noses down.
          const rawDive = diveFromArmsDown(poseFrame, GESTURE_DIVE.startBelow, GESTURE_DIVE.fullBelow)
          gestureDiveRef.current += GESTURE_DIVE.smoothing * (rawDive - gestureDiveRef.current)
          // "6-7" easter egg: both hands (in front, elbows bent) alternating up/down
          // in opposite phase. On a detected bout, gate on the sound NOT already
          // playing so repeated moves never overlap or queue: one egg + sound + pop
          // plays fully before another can start. Uses pose wrists (no extra model).
          if (
            now - runStartMsRef.current >= SIXSEVEN_START_GRACE_MS &&
            detectSixSeven(sixSevenStateRef.current, poseFrame, now) &&
            !isSixSevenPlaying()
          ) {
            egg67ShotRef.current = true
            playSixSeven()
            onSixSeven?.()
          }
        } else {
          // No new pose this tick. A short gap is just MediaPipe between detections,
          // but a SUSTAINED gap means the body left the frame, so zero the gesture
          // lift/steering and reset the detector so a later return does not spike.
          stalePoseTicksRef.current += 1
          if (stalePoseTicksRef.current > STALE_POSE_TICKS) {
            gestureFlapRef.current = 0
            gestureLeanRef.current = 0
            gestureDiveRef.current = 0
            flapStrategyRef.current.reset()
            sixSevenStateRef.current = makeSixSevenState()
          }
        }
      }

      // Merge slider/idle baseline + live keyboard + (camera mode) body gestures
      // ONCE per frame. This merged object is the single source of truth for BOTH
      // the physics AND the duck's animation + HUD. When cameraControl is false
      // every gesture term is 0, so this is byte-identical to keyboard-only.
      const base = actionsRef.current
      const k = keyRef.current
      const gFlap = cameraControl ? gestureFlapRef.current + flapPulseRef.current : 0
      const gLean = cameraControl ? gestureLeanRef.current : 0
      const gDive = cameraControl ? gestureDiveRef.current : 0
      const gQuack = cameraControl && useInputStore.getState().jawOpen > QUACK_THRESHOLD
      const merged: DuckActions = {
        flap: Math.min(1, base.flap + k.flap + gFlap),
        flapImpulse: false,
        lean: Math.max(-1, Math.min(1, base.lean + k.lean + gLean)),
        dive: Math.min(1, base.dive + k.dive + gDive),
        quack: base.quack || gQuack,
        egg67: base.egg67 || egg67ShotRef.current,
        confidence: base.confidence,
      }
      mergedRef.current = merged
      egg67ShotRef.current = false // one-shot consumed: egg67 is true for exactly one frame

      const rings = mapRef.current.rings
      const scenery = mapRef.current.scenery
      const duckRadius = DEFAULT_MAP_CONFIG.duckRadius
      let ringsChanged = false
      let crashedThisFrame = false

      while (accRef.current >= cfg.fixedDt) {
        const stepActions: DuckActions = { ...merged, flapImpulse: impulseRef.current }
        impulseRef.current = false // one-shot, consumed by the first sub-step
        const prevZ = stateRef.current.position[2]
        stateRef.current = flightStep(stateRef.current, stepActions, cfg, cfg.fixedDt)
        const s2 = stateRef.current

        // Decaying OVERSPEED on top of the eased base speed (a raw one-shot add
        // would be pulled back by the model). Done BEFORE ring detection so the
        // crossing test covers the full sub-step travel (flight + boost).
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
        // sub-step [prevZ, currZ]. Each ring fires once (guarded by the passed set).
        for (let i = 0; i < rings.length; i++) {
          const ring = rings[i]
          if (passedRingsRef.current.has(ring.id)) continue
          const res = ringCrossing(prevZ, s2.position[2], s2.position[0], s2.position[1], ring, duckRadius)
          if (res === 'pass') {
            passedRingsRef.current.add(ring.id)
            ringPulseAtRef.current.set(ring.id, performance.now())
            boostRef.current = Math.max(boostRef.current, boostSpeedRef.current)
            ringsChanged = true
            onRingPassed?.(ring.id)
          }
        }

        // Collision -> respawn (client-local; deterministic from the seed so every
        // client agrees). Trees + ring rims only; bird-vs-bird is server-ruled.
        // Skipped during the post-respawn invulnerability grace.
        if (performance.now() >= invulnUntilRef.current) {
          let crashed = false

          // Ring rims: only rings not yet cleanly passed can clip you. Uses the same
          // [prevZ, currZ] plane crossing as the pass test (which already ran), and
          // rim vs hole are geometrically exclusive, so this never double-fires.
          for (let i = 0; i < rings.length && !crashed; i++) {
            const ring = rings[i]
            if (passedRingsRef.current.has(ring.id)) continue
            if (ringRimHit(prevZ, s2.position[2], s2.position[0], s2.position[1], ring, duckRadius)) {
              crashed = true
            }
          }

          // Tree trunks (broad-phase culled to the duck's current Z slab).
          for (let t = 0; t < scenery.length && !crashed; t++) {
            const item = scenery[t]
            if (item.kind !== 'tree') continue
            if (Math.abs(item.pos[2] - s2.position[2]) > TREE_CULL_Z) continue
            if (treeHit(s2.position[0], s2.position[1], s2.position[2], item, duckRadius)) {
              crashed = true
            }
          }

          if (crashed) {
            const cpZ = lastCheckpointZ(s2.position[2], mapRef.current.checkpoints)
            // Fresh state zeroes velocity + the eased _lean/_flap/_dive slots; keep
            // only the checkpoint Z (respawn on the centerline at the start altitude).
            const fresh = createFlightState()
            fresh.position = [0, fresh.position[1], cpZ]
            stateRef.current = fresh
            boostRef.current = 0 // consume any boost on a crash
            invulnUntilRef.current = performance.now() + RESPAWN_INVULN_MS
            crashedThisFrame = true
            break // stop integrating further sub-steps from the respawned state
          }
        }

        accRef.current -= cfg.fixedDt
      }

      if (ringsChanged) onRingsChanged?.()
      if (crashedThisFrame) {
        accRef.current = 0 // drop leftover sub-step time so respawn doesn't jump
        onCrash?.()
      }

      if (enableFinish) {
        const end = mapRef.current.length
        if (stateRef.current.position[2] >= end) {
          stateRef.current.position[2] = end
          finishedRef.current = true
          onFinish?.()
        }
      }
    } else {
      // Not advancing (frozen finish, MP lobby/countdown, or a camera (re)calibrate
      // gate): drop accumulated time so the sim can't "catch up" with a jump when it
      // resumes. While calibrating, relax the duck to idle and drop any queued
      // wingbeat so a Space tap (keyboard stays live) doesn't fire on resume.
      accRef.current = 0
      if (calibrating) {
        mergedRef.current = makeIdleActions()
        impulseRef.current = false
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
      variant={variant}
      actionsRef={mergedRef}
      scale={duckVisual.scale}
      modelYaw={duckVisual.modelYaw}
      crossfade={duckVisual.crossfade}
      flapAnimSpeed={duckVisual.flapAnimSpeed}
      animCfg={animCfg}
      clipRef={clipRef}
    />
  )
}
