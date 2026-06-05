// Lifetime stats overlay. Read-only: it talks to flightStore ONLY through the
// public selectors (no store internals, no localStorage). Renders overall +
// per-control totals, a per-mode breakdown, the multiplayer record, infinite
// PBs, and the per-distance race PB table.

import { type CSSProperties, type ReactNode } from 'react'
import {
  getAggregates,
  getPBs,
  getMpRecord,
  getInfinitePB,
  getRacePB,
  getTotalFlyS,
  getTotalDistance,
  getTotalRings,
  getModeFlyS,
  getPlayerName,
  type Control,
} from '../data/flightStore'
import {
  Overlay,
  Panel,
  Button,
  COLORS,
  FONT_DISPLAY,
  FONT_MONO,
  UI_KEYFRAMES,
  formatTime,
} from './ui'

/** Seconds → "12.3s" / "1:04.2" (formatTime takes ms). */
function flyTime(seconds: number): string {
  if (!seconds || seconds < 0) return '—'
  return formatTime(seconds * 1000)
}

/** Meters → "850 m" / "12.34 km". */
function dist(meters: number): string {
  if (!meters || meters < 0) return '0 m'
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${Math.round(meters)} m`
}

const CONTROL_LABEL: Record<Control, string> = { kb: '⌨️ Keyboard', cam: '📷 Camera' }

export function StatsScreen({ onClose }: { onClose: () => void }) {
  const agg = getAggregates()
  const pbs = getPBs()
  const mp = getMpRecord()

  // Race PB distances, ascending. (Reads the public PB snapshot only.)
  const raceDistances = Object.keys(pbs.race)
    .map(Number)
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b)

  return (
    <Overlay>
      <style>{UI_KEYFRAMES}</style>
      <Panel width={620} style={{ maxHeight: '82vh', overflowY: 'auto' }}>
        <div style={headerRow}>
          <div>
            <h1 style={title}>📊 Lifetime Stats</h1>
            <div style={subtitle}>{getPlayerName()}</div>
          </div>
          <Button variant="ghost" onClick={onClose} style={{ padding: '8px 16px' }}>
            ✕ Close
          </Button>
        </div>

        {/* Overall + per-control headline numbers. */}
        <Section label="Totals">
          <div style={statGrid}>
            <StatCard heading="Overall">
              <Line label="Fly time" value={flyTime(getTotalFlyS())} />
              <Line label="Distance" value={dist(getTotalDistance())} />
              <Line label="Rings" value={String(getTotalRings())} />
            </StatCard>
            {(['kb', 'cam'] as Control[]).map((c) => (
              <StatCard key={c} heading={CONTROL_LABEL[c]}>
                <Line label="Fly time" value={flyTime(getTotalFlyS(c))} />
                <Line label="Distance" value={dist(getTotalDistance(c))} />
                <Line label="Rings" value={String(getTotalRings(c))} />
              </StatCard>
            ))}
          </div>
        </Section>

        {/* Per-mode fly time + games played. */}
        <Section label="By mode">
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>Mode</Th>
                <Th center>Games</Th>
                <Th center>Fly time</Th>
              </tr>
            </thead>
            <tbody>
              <ModeRow label="♾️ Infinite" mode="infinite" games={agg.infinite.kb.games + agg.infinite.cam.games} />
              <ModeRow label="🏁 Race" mode="race" games={agg.race.kb.games + agg.race.cam.games} />
              <ModeRow
                label="🌐 Multiplayer"
                mode="multiplayer"
                games={agg.multiplayer.kb.games + agg.multiplayer.cam.games}
              />
            </tbody>
          </table>
        </Section>

        {/* Multiplayer win record. */}
        <Section label="Multiplayer record">
          <div style={statGrid}>
            <StatCard heading="Record">
              <Line label="Played" value={String(mp.played)} />
              <Line label="Won" value={String(mp.won)} />
              <Line label="Win rate" value={mp.played ? `${Math.round(mp.winRate * 100)}%` : '—'} />
            </StatCard>
          </div>
        </Section>

        {/* Infinite personal bests. */}
        <Section label="Infinite Run — personal bests">
          <div style={statGrid}>
            {(['kb', 'cam'] as Control[]).map((c) => {
              const pb = getInfinitePB(c)
              return (
                <StatCard key={c} heading={CONTROL_LABEL[c]}>
                  <Line label="Best distance" value={dist(pb.bestDistance)} />
                  <Line label="Best rings" value={String(pb.bestRings)} />
                  <Line label="Best fly time" value={flyTime(pb.bestFlyS)} />
                </StatCard>
              )
            })}
          </div>
        </Section>

        {/* Per-distance race PBs. */}
        <Section label="Race — personal bests by distance">
          {raceDistances.length === 0 ? (
            <div style={emptyNote}>No race finishes yet. Pick a distance and set a time!</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <Th>Distance</Th>
                  <Th center>⌨️ Time</Th>
                  <Th center>⌨️ Rings</Th>
                  <Th center>📷 Time</Th>
                  <Th center>📷 Rings</Th>
                </tr>
              </thead>
              <tbody>
                {raceDistances.map((d) => {
                  const kb = getRacePB(d, 'kb')
                  const cam = getRacePB(d, 'cam')
                  return (
                    <tr key={d}>
                      <Td>{dist(d)}</Td>
                      <Td center mono>{kb ? formatTime(kb.bestTimeMs) : '—'}</Td>
                      <Td center>{kb ? kb.bestRings : '—'}</Td>
                      <Td center mono>{cam ? formatTime(cam.bestTimeMs) : '—'}</Td>
                      <Td center>{cam ? cam.bestRings : '—'}</Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Section>
      </Panel>
    </Overlay>
  )
}

// ---- small presentational helpers (local to this screen) -----------------

function ModeRow({
  label,
  mode,
  games,
}: {
  label: string
  mode: 'infinite' | 'race' | 'multiplayer'
  games: number
}) {
  return (
    <tr>
      <Td>{label}</Td>
      <Td center>{games}</Td>
      <Td center mono>{flyTime(getModeFlyS(mode))}</Td>
    </tr>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={sectionLabel}>{label}</div>
      {children}
    </div>
  )
}

function StatCard({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      <div style={cardHeading}>{heading}</div>
      {children}
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={lineRow}>
      <span style={{ color: COLORS.slateDim }}>{label}</span>
      <span style={{ fontFamily: FONT_MONO, fontWeight: 600 }}>{value}</span>
    </div>
  )
}

function Th({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <th
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        fontSize: '0.72rem',
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: COLORS.slateDim,
        borderBottom: `1px solid ${COLORS.lineD}`,
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  center,
  mono,
}: {
  children: ReactNode
  center?: boolean
  mono?: boolean
}) {
  return (
    <td
      style={{
        textAlign: center ? 'center' : 'left',
        padding: '8px 10px',
        borderBottom: `1px solid ${COLORS.lineD}`,
        fontFamily: mono ? FONT_MONO : undefined,
        color: COLORS.slate,
      }}
    >
      {children}
    </td>
  )
}

// ---- styles ---------------------------------------------------------------

const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
}

const title: CSSProperties = {
  margin: 0,
  fontFamily: FONT_DISPLAY,
  fontWeight: 700,
  fontSize: '1.8rem',
  color: COLORS.slate,
}

const subtitle: CSSProperties = {
  marginTop: 2,
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '1rem',
  color: COLORS.orangeDeep,
}

const sectionLabel: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '0.95rem',
  color: COLORS.orangeDeep,
  marginBottom: 8,
}

const statGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 12,
}

const cardStyle: CSSProperties = {
  background: '#fff',
  border: `1px solid ${COLORS.lineD}`,
  borderRadius: 10,
  padding: '12px 14px',
}

const cardHeading: CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontWeight: 600,
  fontSize: '0.9rem',
  color: COLORS.slate,
  marginBottom: 8,
}

const lineRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '0.9rem',
  padding: '3px 0',
}

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.9rem',
}

const emptyNote: CSSProperties = {
  color: COLORS.slateDim,
  fontStyle: 'italic',
  padding: '6px 2px',
}
