// Shared local-player session wiring for the flight modes.
//
// `SinglePlayerGame`, `MultiplayerGame`, and `InfiniteRunGame` drive their duck through the
// same `FlightScene` + `FlightRig`, and both used to hand-roll the SAME ~15 refs,
// the ring-sync state, and the impulse/keyboard plumbing. This hook owns that
// duplicated bundle in one place so new modes plug into a single seam.
//
// PURE REFACTOR: zero behavior change. It only consolidates the pieces that were
// byte-identical between the two wrappers. Mode-specific state (SP's Leva/finish
// UI, MP's networking/spawn-slot/finished-stream) stays in the wrappers.
//
// The caller supplies a `makeInitialState` factory (SP spawns at origin, MP at a
// slot), used for the initial `stateRef` and as the default for `reset()`. Because
// MP's spawn slot is only known once a race starts, `reset(initialState?)` accepts
// an explicit override for that case.

import { useCallback, useRef, useState } from 'react'
import { Group } from 'three'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { useKeyboardControls } from '../input/keyboard'
import { DEFAULT_FLIGHT, type FlightConfig } from './flight'
import { BOOST } from './gameConfig'

export interface UseFlightSessionOptions {
  /** Builds the duck's starting state. Used for the initial sim and the default
   *  `reset()` (SP: origin; MP: slot 0 before the race assigns a real index). */
  makeInitialState: () => DuckState
}

export function useFlightSession({ makeInitialState }: UseFlightSessionOptions) {
  // Keep the factory in a ref so `reset` can stay identity-stable even though the
  // caller passes a fresh inline closure each render.
  const makeInitialStateRef = useRef(makeInitialState)
  makeInitialStateRef.current = makeInitialState

  // Authoritative sim + control refs (read/written by FlightRig each frame).
  const stateRef = useRef<DuckState>(makeInitialState())
  const actionsRef = useRef<DuckActions>({ ...makeIdleActions(), confidence: 1 }) // slider/idle baseline
  const mergedActionsRef = useRef<DuckActions>(makeIdleActions()) // sliders + keyboard (drives anim + HUD)
  const cfgRef = useRef<FlightConfig>({ ...DEFAULT_FLIGHT })
  const impulseRef = useRef(false)
  const duckGroupRef = useRef<Group | null>(null)
  const clipRef = useRef<string>('idle_1')
  const finishedRef = useRef(false)
  const flySRef = useRef(0)
  const usedKeyboardRef = useRef(false)

  // Ring progress: the rig mutates the refs every frame; the React mirrors below
  // drive the rendered ring visuals and are refreshed via `syncRings`.
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

  const fireImpulse = useCallback(() => {
    impulseRef.current = true
  }, [])
  const keyRef = useKeyboardControls(true, fireImpulse)

  // Re-init the shared bundle for a fresh run. The caller layers its own
  // mode-specific resets (SP: timer/music/finish UI; MP: stream/crash flags) on top.
  const reset = useCallback((initialState?: DuckState) => {
    stateRef.current = initialState ?? makeInitialStateRef.current()
    finishedRef.current = false
    flySRef.current = 0
    usedKeyboardRef.current = false
    passedRingsRef.current = new Set()
    ringPulseAtRef.current = new Map()
    boostRef.current = 0
    setPassedRingIds(new Set())
    setRingPulseAt(new Map())
  }, [])

  return {
    stateRef,
    actionsRef,
    mergedActionsRef,
    cfgRef,
    impulseRef,
    duckGroupRef,
    clipRef,
    finishedRef,
    flySRef,
    usedKeyboardRef,
    passedRingsRef,
    ringPulseAtRef,
    boostRef,
    boostSpeedRef,
    boostDurationRef,
    passedRingIds,
    ringPulseAt,
    syncRings,
    fireImpulse,
    keyRef,
    reset,
  }
}

export type FlightSession = ReturnType<typeof useFlightSession>
