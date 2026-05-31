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

/** Invulnerability window after a respawn, ms (matches the MP spin-out window). */
const RESPAWN_INVULN_MS = 1200
/** Broad-phase cull: only test trees within this |Δz| of the duck, meters. */
const TREE_CULL_Z = 8

export interface FlightRigProps {
  stateRef: React.RefObject<DuckState>
  /** Slider/idle baseline action (must carry confidence=1 to actually move). */
  actionsRef: React.RefObject<DuckActions>
  cfgRef: React.RefObject<FlightConfig>
  impulseRef: React.RefObject<boolean>
  duckRef: React.RefObject<Group | null>
  duckVisual: { scale: number; modelYaw: number; crossfade: number }
  animCfg: AnimMapConfig
  clipRef: React.RefObject<string>
  keyRef: React.RefObject<KeyActions>
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
}: FlightRigProps) {
  const accRef = useRef(0)
  // performance.now() ms until which collisions are ignored (post-respawn grace).
  const invulnUntilRef = useRef(0)

  useFrame((_, delta) => {
    const cfg = cfgRef.current

    // Keep flight + walls in lockstep: the playable corridor is exactly the map's
    // half-width, so the lateral clamp always matches the rendered side walls.
    cfg.lateralRange = mapRef.current.halfWidth

    const frozen = enableFinish && finishedRef.current
    const running = runningRef.current && !frozen

    if (running) {
      accRef.current += Math.min(delta, MAX_FRAME_DT)

      // Merge slider/idle baseline with live keyboard ONCE per frame (neither
      // changes within a frame). This merged object is the single source of truth
      // for BOTH the physics AND the duck's animation + HUD.
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
      // Not advancing (frozen finish, or MP lobby/countdown): drop accumulated
      // time so the sim can't "catch up" with a jump when it resumes.
      accRef.current = 0
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
      animCfg={animCfg}
      clipRef={clipRef}
    />
  )
}
