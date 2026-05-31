// In-race HUD (the "game in action" screen): own telemetry + race clock on the left, a live
// leaderboard on the right, and a control hint at the bottom. Shown while you're still flying
// (phase === 'racing' and you haven't crossed the line).

import { useEffect, useState } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { COLORS, FONT_DISPLAY, FONT_MONO, KeyCap, cutPath, formatTime } from '../ui'
import { hudPanel, hudRowStyle } from './parts'

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

  // Once the first player crosses the line the server opens a finish-grace window; flash a
  // countdown at the top so everyone still flying knows the race is about to end.
  const finisher = race.players.find((p) => p.finished)
  const graceLeft =
    race.finishWindowEndsAt > 0 ? Math.max(0, Math.ceil((race.finishWindowEndsAt - Date.now()) / 1000)) : 0

  return (
    <>
      {finisher && race.finishWindowEndsAt > 0 && <FinishBanner name={finisher.name} secs={graceLeft} />}

      {/* Top-center: time + rings stat chips */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 10,
        }}
      >
        <StatChip label="TIME" value={formatTime(elapsed)} color={COLORS.cyan} />
        <StatChip
          label="RINGS"
          value={`${self?.ringsPassed ?? 0}`}
          suffix={`/${ringCount}`}
          color={COLORS.yellow}
        />
        <StatChip
          label="RANK"
          value={`${self?.rank || '–'}`}
          suffix={`/${race.players.length}`}
          color={COLORS.yellow}
        />
      </div>

      {/* Top-right: leaderboard */}
      <div style={{ ...hudPanel, top: 20, right: 20, minWidth: 200, pointerEvents: 'auto' }}>
        <div
          style={{
            color: COLORS.hudDim,
            marginBottom: 9,
            paddingBottom: 9,
            borderBottom: `1px solid ${COLORS.hudLine}`,
            fontSize: '0.65rem',
            letterSpacing: 2,
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          LEADERBOARD
        </div>
        {ranked.map((p) => (
          <div key={p.id} style={hudRowStyle}>
            <span
              style={{
                color: p.id === race.sessionId ? COLORS.yellow : COLORS.hudText,
                fontWeight: p.id === race.sessionId ? 700 : 500,
              }}
            >
              {p.rank || '–'}. {p.name}
            </span>
            <span style={{ color: COLORS.hudDim }}>{p.finished ? '🏁' : `${p.ringsPassed}`}</span>
          </div>
        ))}
      </div>

      <ControlsLegend />
    </>
  )
}

/** Top-center mono stat chip for time/rings/rank (HUD goal block). */
function StatChip({
  label,
  value,
  suffix,
  color,
}: {
  label: string
  value: string
  suffix?: string
  color: string
}) {
  return (
    <div
      style={{
        background: COLORS.hud,
        border: `1px solid ${COLORS.hudLine}`,
        clipPath: cutPath(),
        padding: '10px 22px',
        textAlign: 'center',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
      }}
    >
      <div style={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: '1.7rem', color, lineHeight: 1 }}>
        {value}
        {suffix && <span style={{ color: COLORS.hudDim, fontSize: '1.05rem' }}>{suffix}</span>}
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: '0.62rem',
          letterSpacing: 2,
          color: COLORS.hudDim,
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  )
}

/** Small flashing top-center banner: someone finished, the race ends in `secs`. */
function FinishBanner({ name, secs }: { name: string; secs: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 120,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 18px',
        background: COLORS.hud,
        border: `1px solid ${COLORS.yellow}`,
        color: COLORS.yellow,
        fontFamily: FONT_DISPLAY,
        fontSize: '0.95rem',
        fontWeight: 700,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        clipPath: cutPath(8),
        animation: 'ducksfly-flash 1s ease-in-out infinite',
      }}
    >
      🏁 {name} finished — race ends in {secs}s
    </div>
  )
}

function ControlsLegend() {
  return (
    <div
      style={{
        ...hudPanel,
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '11px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        color: COLORS.hudDim,
        pointerEvents: 'none',
      }}
    >
      <KeyCap dark>Space</KeyCap> flap
      <span style={{ opacity: 0.4 }}>·</span>
      <KeyCap dark>A</KeyCap>
      <KeyCap dark>D</KeyCap> lean
      <span style={{ opacity: 0.4 }}>·</span>
      <KeyCap dark>W</KeyCap> dive
    </div>
  )
}
