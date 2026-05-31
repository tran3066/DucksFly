// Small presentational pieces + shared styles used across more than one race screen. Keeping
// them here means each screen file stays focused on its own layout, and the lobby/results
// tables, segmented controls, and HUD rows never get duplicated.

import { type CSSProperties, type ReactNode } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { COLORS, FONT } from '../ui'

/** Labelled vertical form field (name input, duck picker, …). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ color: COLORS.dim, fontSize: '0.8rem', letterSpacing: 0.5 }}>{label}</span>
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
    <div style={{ display: 'flex', gap: 6, background: 'rgba(10,16,28,0.5)', padding: 4, borderRadius: 12 }}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              padding: '9px 10px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT,
              fontSize: '0.9rem',
              fontWeight: 600,
              color: active ? '#0b1422' : COLORS.text,
              background: active ? COLORS.text : 'transparent',
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
          <Th>Duck</Th>
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
            <Td style={{ color: COLORS.dim }}>{p.duckVariant}</Td>
            <Td center>
              {p.ready ? (
                <span style={{ color: COLORS.good }}>ready</span>
              ) : (
                <span style={{ color: COLORS.faint }}>—</span>
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
      <span style={{ color: COLORS.dim }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}

export function Th({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <th
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        color: COLORS.dim,
        fontWeight: 600,
        fontSize: '0.78rem',
        letterSpacing: 0.5,
        borderBottom: '1px solid rgba(120,150,180,0.2)',
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
        padding: '8px 10px',
        borderBottom: '1px solid rgba(120,150,180,0.1)',
        fontSize: '0.9rem',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

// --- shared styles ---

export const titleStyle: CSSProperties = {
  fontSize: '1.5rem',
  fontWeight: 800,
  margin: '0 0 4px',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  color: COLORS.text,
}

export const subStyle: CSSProperties = {
  margin: '0 0 18px',
  color: COLORS.dim,
  fontSize: '0.9rem',
}

export const linkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: COLORS.dim,
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: '0.85rem',
  textDecoration: 'underline',
  padding: 0,
}

export const codeBox: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '14px 16px',
  borderRadius: 12,
  background: 'rgba(10,16,28,0.5)',
  border: '1px solid rgba(120,150,180,0.2)',
  margin: '8px 0 16px',
}

export const winnerBox: CSSProperties = {
  textAlign: 'center',
  padding: '16px 18px',
  borderRadius: 14,
  background: 'rgba(255,210,63,0.08)',
  border: '1px solid rgba(255,210,63,0.25)',
  margin: '6px 0 18px',
}

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

export const rowMe: CSSProperties = {
  background: 'rgba(255,210,63,0.08)',
}

export const hudPanel: CSSProperties = {
  position: 'absolute',
  padding: '12px 14px',
  borderRadius: 12,
  background: 'rgba(10,18,30,0.66)',
  color: COLORS.text,
  fontFamily: FONT,
  fontSize: '0.85rem',
  pointerEvents: 'none',
  backdropFilter: 'blur(6px)',
  border: '1px solid rgba(120,150,180,0.18)',
}

export const hudRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 18,
  lineHeight: 1.7,
}
