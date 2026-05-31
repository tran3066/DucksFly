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

  return (
    <>
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
