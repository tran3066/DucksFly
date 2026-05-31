// In-race HUD (the "game in action" screen): own telemetry + race clock on the left, a live
// leaderboard on the right, and a control hint at the bottom. Shown while you're still flying
// (phase === 'racing' and you haven't crossed the line).

import { type CSSProperties, useEffect, useState } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { COLORS, KeyCap, formatTime } from '../ui'
import { hudPanel } from './parts'

export function RaceHud({
  race,
  self,
  ringCount,
}: {
  race: RaceSnapshot
  self?: PlayerView
  ringCount: number
}) {
  // Tick a few times a second so the clock + leaderboard stay live between state patches.
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 150)
    return () => window.clearInterval(id)
  }, [])

  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99))
  const elapsed = race.raceStartAt > 0 ? Date.now() - race.raceStartAt : 0
  const rank = self?.rank || 0
  const total = race.players.length

  // Once the first player crosses the line the server opens a finish-grace window; flash a
  // countdown at the top so everyone still flying knows the race is about to end.
  const finisher = race.players.find((p) => p.finished)
  const graceLeft =
    race.finishWindowEndsAt > 0 ? Math.max(0, Math.ceil((race.finishWindowEndsAt - Date.now()) / 1000)) : 0

  return (
    <>
      {finisher && race.finishWindowEndsAt > 0 && <FinishBanner name={finisher.name} secs={graceLeft} />}

      {/* Big, glanceable telemetry across the top-left: time, rings, position. */}
      <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', gap: 12 }}>
        <BigStat label="TIME" value={formatTime(elapsed)} />
        <BigStat
          label="RINGS"
          value={`${self?.ringsPassed ?? 0}`}
          suffix={`/ ${ringCount}`}
          accent={COLORS.accent}
        />
        <BigStat
          label="POSITION"
          value={rank ? `${rank}` : '–'}
          suffix={`/ ${total}`}
          accent={rank === 1 ? COLORS.gold : COLORS.accentBlue}
        />
      </div>

      <div style={{ ...hudPanel, top: 14, right: 14, minWidth: 220, padding: '14px 16px' }}>
        <div style={{ color: COLORS.dim, marginBottom: 10, fontSize: '0.8rem', letterSpacing: 1.5, fontWeight: 700 }}>
          LEADERBOARD
        </div>
        {ranked.map((p) => {
          const me = p.id === race.sessionId
          return (
            <div
              key={p.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 14,
                padding: '4px 6px',
                marginBottom: 2,
                borderRadius: 8,
                background: me ? 'rgba(255,210,63,0.12)' : 'transparent',
                fontSize: '1.05rem',
                fontWeight: me ? 800 : 600,
              }}
            >
              <span style={{ color: me ? COLORS.gold : COLORS.text }}>
                <span style={{ opacity: 0.6, marginRight: 8 }}>{p.rank || '–'}</span>
                {p.name}
                {me ? ' (you)' : ''}
              </span>
              <span style={{ color: p.finished ? COLORS.good : COLORS.dim, fontVariantNumeric: 'tabular-nums' }}>
                {p.finished ? '🏁' : `${p.ringsPassed}`}
              </span>
            </div>
          )
        })}
      </div>

      <ControlsLegend />
    </>
  )
}

/** A large, glanceable stat tile (big number + small caption). */
function BigStat({
  label,
  value,
  suffix,
  accent = COLORS.text,
}: {
  label: string
  value: string
  suffix?: string
  accent?: string
}) {
  return (
    <div
      style={{
        ...hudPanel,
        position: 'static',
        padding: '8px 18px',
        minWidth: 96,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <span style={{ color: COLORS.dim, fontSize: '0.72rem', letterSpacing: 2, fontWeight: 700 }}>
        {label}
      </span>
      <span style={bigValueStyle(accent)}>
        {value}
        {suffix && (
          <span style={{ fontSize: '1.1rem', color: COLORS.dim, fontWeight: 600, marginLeft: 4 }}>
            {suffix}
          </span>
        )}
      </span>
    </div>
  )
}

function bigValueStyle(color: string): CSSProperties {
  return {
    fontSize: '2.4rem',
    fontWeight: 800,
    lineHeight: 1.05,
    color,
    fontVariantNumeric: 'tabular-nums',
  }
}

/** Small flashing top-center banner: someone finished, the race ends in `secs`. */
function FinishBanner({ name, secs }: { name: string; secs: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 16px',
        borderRadius: 999,
        background: 'rgba(10,18,30,0.72)',
        border: `1px solid ${COLORS.gold}`,
        color: COLORS.gold,
        fontSize: '0.95rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        backdropFilter: 'blur(6px)',
        animation: 'ducksfly-flash 1s ease-in-out infinite',
      }}
    >
      🏁 {name} finished — race ends in {secs}s
    </div>
  )
}

function ControlsLegend() {
  return (
    <div style={{ ...hudPanel, bottom: 14, left: 14 }}>
      <div style={{ marginBottom: 2 }}>
        <KeyCap>Space</KeyCap>
        <span style={{ color: COLORS.dim }}>flap (climb)</span>
      </div>
      <div style={{ marginBottom: 2 }}>
        <KeyCap>W</KeyCap>
        <span style={{ color: COLORS.dim }}>dive</span>
      </div>
      <div>
        <KeyCap>A</KeyCap>
        <KeyCap>D</KeyCap>
        <span style={{ color: COLORS.dim }}>lean</span>
      </div>
    </div>
  )
}
