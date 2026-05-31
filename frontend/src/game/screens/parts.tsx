// Small presentational pieces + shared styles used across more than one race screen. Keeping
// them here means each screen file stays focused on its own layout, and the lobby/results
// tables, segmented controls, and HUD rows never get duplicated.

import { type CSSProperties, type ReactNode } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { COLORS, FONT_BODY, FONT_DISPLAY, FONT_MONO, cutPath } from '../ui'

/** Labelled vertical form field (name input, duck picker, …). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          color: COLORS.slateDim,
          fontSize: '0.78rem',
          letterSpacing: 0.5,
          fontFamily: FONT_MONO,
          fontWeight: 500,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

/** Pill-style single-select toggle (Male/Female, Host/Join, …). */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: 'rgba(32,48,63,0.06)',
        padding: 4,
        border: `1px solid ${COLORS.lineD}`,
        clipPath: cutPath(8),
      }}
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              padding: '9px 12px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT_DISPLAY,
              fontSize: '0.9rem',
              fontWeight: 600,
              color: active ? '#fff' : COLORS.slate,
              background: active
                ? `linear-gradient(180deg, ${COLORS.orange}, ${COLORS.orangeDeep})`
                : 'transparent',
              clipPath: cutPath(6),
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** The lobby roster: who's here, their duck, and ready state. */
export function RosterTable({ race }: { race: RaceSnapshot }) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <Th>Player</Th>
          <Th center>Ready</Th>
        </tr>
      </thead>
      <tbody>
        {race.players.map((p) => (
          <tr key={p.id} style={p.id === race.sessionId ? rowMe : undefined}>
            <Td>
              {p.name}
              {p.id === race.sessionId ? ' (you)' : ''}
              {p.id === race.hostId ? ' · host' : ''}
            </Td>
            <Td center>
              {p.ready ? (
                <span style={{ color: COLORS.green, fontWeight: 700 }}>ready</span>
              ) : (
                <span style={{ color: COLORS.slateDim }}>—</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Sort players for any leaderboard view: finishers first (by time), then by rings. */
export function rankPlayers(players: PlayerView[]): PlayerView[] {
  return [...players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1
    if (a.finished && b.finished) return a.finishTime - b.finishTime
    return b.ringsPassed - a.ringsPassed
  })
}

export function medal(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return String(rank)
}

export function HudRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={hudRowStyle}>
      <span style={{ color: COLORS.hudDim }}>{label}</span>
      <span style={{ color: COLORS.hudText, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

export function Th({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <th
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        color: COLORS.slateDim,
        fontWeight: 700,
        fontSize: '0.7rem',
        letterSpacing: 1,
        textTransform: 'uppercase',
        fontFamily: FONT_MONO,
        borderBottom: `1px solid ${COLORS.lineD}`,
      }}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  center,
  style,
}: {
  children: ReactNode
  center?: boolean
  style?: CSSProperties
}) {
  return (
    <td
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '9px 10px',
        borderBottom: `1px solid ${COLORS.lineD}`,
        fontSize: '0.92rem',
        color: COLORS.slate,
        ...style,
      }}
    >
      {children}
    </td>
  )
}

// --- shared styles ---

export const titleStyle: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: '1.7rem',
  fontWeight: 700,
  margin: '0 0 4px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: COLORS.slate,
}

export const subStyle: CSSProperties = {
  margin: '0 0 18px',
  color: COLORS.slateDim,
  fontSize: '0.95rem',
  fontFamily: FONT_BODY,
}

export const linkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: COLORS.slateDim,
  cursor: 'pointer',
  fontFamily: FONT_BODY,
  fontSize: '0.85rem',
  textDecoration: 'underline',
  padding: 0,
}

export const codeBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '14px 18px',
  background: '#fff',
  border: `1px solid ${COLORS.lineD}`,
  clipPath: cutPath(10),
  margin: '8px 0 16px',
}

export const winnerBox: CSSProperties = {
  textAlign: 'center',
  padding: '16px 18px',
  background: 'rgba(255,138,31,0.1)',
  border: `1px solid ${COLORS.orange}55`,
  clipPath: cutPath(10),
  margin: '6px 0 18px',
}

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

export const rowMe: CSSProperties = {
  background: 'rgba(255,138,31,0.08)',
}

/** Dark HUD panel: chamfered navy chip used for all in-flight chrome. */
export const hudPanel: CSSProperties = {
  position: 'absolute',
  padding: '13px 15px',
  background: COLORS.hud,
  color: COLORS.hudText,
  fontFamily: FONT_MONO,
  fontSize: '0.8rem',
  pointerEvents: 'none',
  backdropFilter: 'blur(7px)',
  WebkitBackdropFilter: 'blur(7px)',
  border: `1px solid ${COLORS.hudLine}`,
  clipPath: cutPath(),
}

export const hudRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  lineHeight: 1.7,
  padding: '2px 0',
}
