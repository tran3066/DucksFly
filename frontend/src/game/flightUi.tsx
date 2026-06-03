// HUD chrome shared by race, infinite, and multiplayer local flight.

import { useEffect, useRef, useState } from 'react'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { createFlightState } from './flight'
import { COLORS, FONT_MONO as MONO, KeyCap, cutPath } from './ui'

export type ControlsHintVariant = 'race' | 'infinite'

export function ControlsHint({
  cameraControl,
  variant = 'race',
}: {
  cameraControl: boolean
  variant?: ControlsHintVariant
}) {
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
          {variant === 'infinite' ? (
            <>Flap · lean · dive — one crash ends your run</>
          ) : (
            <>
              Flap your arms to fly · lean your shoulders to turn · drop your arms to dive · open your
              mouth to quack
            </>
          )}
        </span>
      ) : variant === 'infinite' ? (
        <>
          <KeyCap dark>Space</KeyCap> flap
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>A</KeyCap>/<KeyCap dark>D</KeyCap> lean
          <span style={{ opacity: 0.4 }}>·</span>
          <KeyCap dark>W</KeyCap> dive
          <span style={{ opacity: 0.4 }}>·</span>
          <span>crash = game over</span>
        </>
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

export const hudChipStyle: React.CSSProperties = {
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

export function DebugToggle({ debug, onToggle }: { debug: boolean; onToggle: () => void }) {
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

export function ExitButton({ onExit, style }: { onExit: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onExit} style={{ ...hudChipStyle, position: 'absolute', top: 20, right: 130, ...style }}>
      ← menu
    </button>
  )
}

interface HudSnapshot {
  s: DuckState
  a: DuckActions
  clip: string
  boost: number
  ringsPassed: number
}

export function FlightDebugHud({
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
      <span style={{ color: accent ? COLORS.yellow : COLORS.hudText, fontWeight: 500 }}>{value}</span>
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

export function BigStat({
  label,
  value,
  suffix,
  accent = COLORS.hudText,
}: {
  label: string
  value: string
  suffix?: string
  accent?: string
}) {
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
        {suffix && (
          <span style={{ fontSize: '1.1rem', color: COLORS.hudDim, fontWeight: 600, marginLeft: 4 }}>
            {suffix}
          </span>
        )}
      </span>
    </div>
  )
}
