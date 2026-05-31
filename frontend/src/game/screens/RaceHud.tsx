// In-race HUD (the "game in action" screen): own telemetry + race clock on the left, a live
// leaderboard on the right, and a control hint at the bottom. Shown while you're still flying
// (phase === 'racing' and you haven't crossed the line).

import { useEffect, useState } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { COLORS, KeyCap, formatTime } from '../ui'
import { HudRow, hudPanel, hudRowStyle } from './parts'

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

      <div style={{ ...hudPanel, top: 14, left: 14, minWidth: 170 }}>
        <HudRow label="time" value={formatTime(elapsed)} />
        <HudRow label="rings" value={`${self?.ringsPassed ?? 0} / ${ringCount}`} />
        <HudRow label="rank" value={`${self?.rank || '–'} / ${race.players.length}`} />
      </div>

      <div style={{ ...hudPanel, top: 14, right: 14, minWidth: 190 }}>
        <div style={{ color: COLORS.dim, marginBottom: 6, fontSize: '0.75rem', letterSpacing: 1 }}>
          LEADERBOARD
        </div>
        {ranked.map((p) => (
          <div key={p.id} style={hudRowStyle}>
            <span style={{ color: p.id === race.sessionId ? COLORS.gold : COLORS.text }}>
              {p.rank || '–'}. {p.name}
            </span>
            <span style={{ color: COLORS.dim }}>{p.finished ? '🏁' : `${p.ringsPassed}`}</span>
          </div>
        ))}
      </div>

      <ControlsLegend />
    </>
  )
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
