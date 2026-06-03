// Solo Infinite Run: a streaming deterministic world with no finish line.
// Crash (tree / ring rim) ends the run immediately; distance is the score.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createInfiniteMap, type MapDef, type InfiniteMap } from '../map'
import { DEFAULT_FOLLOW } from '../avatar/followConfig'
import { DEFAULT_ANIM_MAP } from '../avatar/animationMap'
import { makeIdleActions } from '../shared/types/duckActions'
import { createFlightState, DEFAULT_FLIGHT } from './flight'
import { BOOST } from './gameConfig'
import { FLAP_ANIM_SPEED } from './gestureConfig'
import { FlightScene } from './FlightScene'
import type { FlightRigProps } from './FlightRig'
import { useFlightSession } from './useFlightSession'
import { CrashFlash } from './CrashFlash'
import { startMusic, stopMusic } from './sfx'
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
} from './ui'

function randomSeed(): number {
  return Math.floor(Math.random() * 100_000)
}

export function InfiniteRunGame({
  onExit,
  controlMode,
  onSetControlMode,
}: {
  onExit?: () => void
  controlMode: ControlMode
  onSetControlMode: (mode: ControlMode) => void
}) {
  const cameraControl = controlMode === 'camera'
  useEffect(() => {
    useCalibrationStore.getState().setRecalibrateAllowed(true)
  }, [])

  const [seed, setSeed] = useState(randomSeed)
  const streamerRef = useRef<InfiniteMap | null>(null)
  const [map, setMap] = useState<MapDef>(() => createInfiniteMap(seed).getMap())
  const [, setMapVersion] = useState(0)

  const {
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
    keyRef,
    reset,
  } = useFlightSession({ makeInitialState: createFlightState })

  const mapRef = useRef(map)
  mapRef.current = map

  const runningRef = useRef(true)
  const [gameOver, setGameOver] = useState(false)
  const [crashStats, setCrashStats] = useState<{ distance: number; rings: number } | null>(null)
  const [crashAt, setCrashAt] = useState(0)

  useEffect(() => {
    startMusic()
    return () => stopMusic()
  }, [])

  // (Re)build the streamer when the seed changes (fresh run / Restart).
  useEffect(() => {
    const streamer = createInfiniteMap(seed)
    streamerRef.current = streamer
    const initial = streamer.getMap()
    mapRef.current = initial
    setMap(initial)
    setMapVersion(streamer.getVersion())
    reset()
    setGameOver(false)
    setCrashStats(null)
  }, [seed, reset])

  // Advance the windowed map as the duck moves (cheap no-op when unchanged).
  useEffect(() => {
    const id = window.setInterval(() => {
      const streamer = streamerRef.current
      if (!streamer || gameOver) return
      const z = stateRef.current.position[2]
      if (streamer.update(z)) {
        const next = streamer.getMap()
        mapRef.current = next
        setMap(next)
        setMapVersion(streamer.getVersion())
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [stateRef, gameOver])

  useEffect(() => {
    cfgRef.current = { ...DEFAULT_FLIGHT }
    boostSpeedRef.current = BOOST.speed
    boostDurationRef.current = BOOST.durationSec
    actionsRef.current = { ...makeIdleActions(), confidence: 1 }
  }, [cfgRef, boostSpeedRef, boostDurationRef, actionsRef])

  const onGameOver = useCallback(() => {
    setCrashStats({
      distance: stateRef.current.distance,
      rings: passedRingsRef.current.size,
    })
    setGameOver(true)
    setCrashAt(performance.now())
    stopMusic()
  }, [passedRingsRef, stateRef])

  const restart = useCallback(() => {
    setSeed(randomSeed())
    startMusic()
  }, [])

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
    duckVisual: { scale: 1, modelYaw: 0, crossfade: 0.25, flapAnimSpeed: FLAP_ANIM_SPEED },
    animCfg: DEFAULT_ANIM_MAP,
    clipRef,
    keyRef,
    cameraControl,
    mergedRef: mergedActionsRef,
    mapRef,
    variant: 'male',
    runningRef,
    enableFinish: false,
    finishedRef,
    flySRef,
    usedKeyboardRef,
    passedRingsRef,
    ringPulseAtRef,
    boostRef,
    boostSpeedRef,
    boostDurationRef,
    onRingsChanged: syncRings,
    crashEndsRun: true,
    onGameOver,
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
      />
      <InfiniteHud stateRef={stateRef} passedRingsRef={passedRingsRef} frozen={gameOver} />
      <ControlsHint cameraControl={cameraControl} />
      <ControlModeToggle
        mode={cameraControl ? 'camera' : 'keyboard'}
        onChange={onSetControlMode}
        style={{ top: 20, right: 230 }}
      />
      {onExit && <ExitButton onExit={onExit} />}
      <CrashFlash at={crashAt} />
      {gameOver && crashStats && (
        <GameOverOverlay stats={crashStats} onRestart={restart} onExit={onExit} />
      )}
    </div>
  )
}

function InfiniteHud({
  stateRef,
  passedRingsRef,
  frozen,
}: {
  stateRef: React.RefObject<{ distance: number }>
  passedRingsRef: React.RefObject<Set<number>>
  frozen: boolean
}) {
  const [snap, setSnap] = useState({ distance: 0, rings: 0 })
  const frozenDistRef = useRef<number | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (frozen) {
        if (frozenDistRef.current == null) frozenDistRef.current = stateRef.current.distance
      } else {
        frozenDistRef.current = null
      }
      setSnap({
        distance: frozenDistRef.current ?? stateRef.current.distance,
        rings: passedRingsRef.current.size,
      })
    }, 100)
    return () => clearInterval(id)
  }, [stateRef, passedRingsRef, frozen])

  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 12,
      }}
    >
      <HudTile label="DISTANCE" value={`${snap.distance.toFixed(0)} m`} accent={COLORS.cyanDeep} />
      <HudTile label="RINGS" value={String(snap.rings)} accent={COLORS.gold} />
    </div>
  )
}

function HudTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        padding: '8px 18px',
        minWidth: 96,
        borderRadius: 12,
        background: 'rgba(10,18,30,0.66)',
        border: '1px solid rgba(120,150,180,0.18)',
        backdropFilter: 'blur(6px)',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <span style={{ color: COLORS.hudDim, fontSize: '0.72rem', letterSpacing: 2, fontWeight: 700 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: '2.4rem',
          fontWeight: 800,
          lineHeight: 1.05,
          color: accent,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  )
}

function GameOverOverlay({
  stats,
  onRestart,
  onExit,
}: {
  stats: { distance: number; rings: number }
  onRestart: () => void
  onExit?: () => void
}) {
  return (
    <Overlay dim={0.5}>
      <Panel width={440} style={{ textAlign: 'center', padding: '34px 44px' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.1rem',
            fontWeight: 700,
            color: COLORS.slate,
            marginBottom: 8,
          }}
        >
          💥 Crashed
        </div>
        <p style={{ color: COLORS.slateDim, margin: '0 0 24px', fontWeight: 500 }}>
          Your infinite run is over.
        </p>
        <div style={{ display: 'flex', gap: 32, justifyContent: 'center', margin: '0 0 28px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color: COLORS.cyanDeep }}>
              {stats.distance.toFixed(0)}m
            </span>
            <span style={{ color: COLORS.slateDim, fontFamily: MONO, fontSize: '0.7rem', letterSpacing: 1.5 }}>
              DISTANCE
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color: COLORS.yellowDeep }}>
              {stats.rings}
            </span>
            <span style={{ color: COLORS.slateDim, fontFamily: MONO, fontSize: '0.7rem', letterSpacing: 1.5 }}>
              RINGS
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 13, justifyContent: 'center' }}>
          <Button variant="primary" onClick={onRestart}>
            Restart
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
        border: `1px solid ${COLORS.hudLine}`,
        clipPath: cutPath(),
        display: 'flex',
        alignItems: 'center',
        gap: 9,
      }}
    >
      {cameraControl ? (
        <span>Flap · lean · dive — one crash ends your run</span>
      ) : (
        <>
          <KeyCap dark>Space</KeyCap> flap
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>A</KeyCap>/<KeyCap dark>D</KeyCap> lean
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>W</KeyCap> dive
          <span style={{ opacity: 0.4 }}>·</span>
          <span>crash = game over</span>
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
  clipPath: cutPath(8),
}

function ExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button type="button" onClick={onExit} style={{ ...hudChipStyle, position: 'absolute', top: 20, right: 20 }}>
      ← menu
    </button>
  )
}
