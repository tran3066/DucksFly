// HUD chrome shared by race, infinite, and multiplayer local flight.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DuckActions, DuckState } from '../physics'
import { makeIdleActions } from '../shared/types/duckActions'
import { createFlightState } from './flight'
import { ControlModeToggle, type ControlMode } from './ModeChooser'
import {
  Button,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO as MONO,
  KeyCap,
  Overlay,
  Panel,
  cutPath,
} from './ui'

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

/**
 * Debug visibility for every mode. Hidden by default; toggled with the backtick
 * (`~`) key. Replaces the old always-visible "debug" chip so production play is
 * clean and the debug HUD / Leva panel only appear on demand.
 */
export function useDebugToggle(): boolean {
  const [debug, setDebug] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Backquote') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      setDebug((d) => !d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return debug
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

/** One readout in a `LiveStatHud`: a label + a function that reads its live value. */
export interface LiveStat {
  label: string
  read: () => string
  suffix?: string
  accent?: string
}

/**
 * Top-center live HUD shared by race + infinite. Polls each stat's `read()` on an
 * interval; when `frozen` flips true (finish / game-over) it captures the values
 * once and holds them so the final readout stays put.
 */
export function LiveStatHud({
  stats,
  frozen = false,
  intervalMs = 100,
}: {
  stats: LiveStat[]
  frozen?: boolean
  intervalMs?: number
}) {
  const statsRef = useRef(stats)
  statsRef.current = stats
  const [values, setValues] = useState<string[]>(() => stats.map((s) => s.read()))
  const frozenValuesRef = useRef<string[] | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (frozen) {
        if (frozenValuesRef.current == null) {
          frozenValuesRef.current = statsRef.current.map((s) => s.read())
        }
        setValues(frozenValuesRef.current)
      } else {
        frozenValuesRef.current = null
        setValues(statsRef.current.map((s) => s.read()))
      }
    }, intervalMs)
    return () => clearInterval(id)
  }, [frozen, intervalMs])

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
      {stats.map((s, i) => (
        <BigStat key={s.label} label={s.label} value={values[i] ?? ''} suffix={s.suffix} accent={s.accent} />
      ))}
    </div>
  )
}

/** One stat pill in a `ResultOverlay`. */
export interface ResultStat {
  label: string
  value: string
  color: string
}

/**
 * Shared end-of-run overlay for solo modes (race finish + infinite game-over).
 * Renders a title, optional PB badge + subtitle, a row of stat pills, and up to
 * two buttons. Multiplayer keeps its own results screen (different data shape).
 */
export function ResultOverlay({
  title,
  badge,
  subtitle,
  stats,
  primary,
  secondary,
  width = 460,
}: {
  title: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  stats: ResultStat[]
  primary: { label: string; onClick: () => void }
  secondary?: { label: string; onClick: () => void }
  width?: number
}) {
  return (
    <Overlay dim={0.5}>
      <Panel width={width} style={{ textAlign: 'center', padding: '34px 44px' }}>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: '2.1rem',
            fontWeight: 700,
            color: COLORS.slate,
            marginBottom: 6,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {title}
        </div>
        {badge && (
          <p
            style={{
              color: COLORS.gold,
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: '1.15rem',
              margin: '0 0 8px',
            }}
          >
            {badge}
          </p>
        )}
        {subtitle && (
          <p style={{ color: COLORS.slateDim, margin: '0 0 26px', fontWeight: 500 }}>{subtitle}</p>
        )}
        <div style={{ display: 'flex', gap: 36, justifyContent: 'center', margin: '0 0 28px' }}>
          {stats.map((s) => (
            <div
              key={s.label}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
            >
              <span style={{ fontFamily: MONO, fontSize: '2.1rem', fontWeight: 700, color: s.color, lineHeight: 1 }}>
                {s.value}
              </span>
              <span style={{ color: COLORS.slateDim, fontFamily: MONO, fontSize: '0.7rem', letterSpacing: 1.5 }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 13, justifyContent: 'center' }}>
          <Button variant="primary" onClick={primary.onClick}>
            {primary.label}
          </Button>
          {secondary && (
            <Button variant="ghost" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
        </div>
      </Panel>
    </Overlay>
  )
}

/**
 * Standard in-flight chrome: control-mode toggle + exit button, positioned
 * consistently across modes. The debug HUD / Leva are mounted separately by each
 * mode (gated by `useDebugToggle`), so this only covers the always-allowed chrome.
 */
export function GameChrome({
  cameraControl,
  onSetControlMode,
  onExit,
  showControlToggle = true,
  controlToggleStyle,
}: {
  cameraControl: boolean
  onSetControlMode: (mode: ControlMode) => void
  onExit?: () => void
  showControlToggle?: boolean
  controlToggleStyle?: React.CSSProperties
}) {
  return (
    <>
      {showControlToggle && (
        <ControlModeToggle
          mode={cameraControl ? 'camera' : 'keyboard'}
          onChange={onSetControlMode}
          style={controlToggleStyle ?? { top: 20, right: 130 }}
        />
      )}
      {onExit && <ExitButton onExit={onExit} style={{ right: 20 }} />}
    </>
  )
}
