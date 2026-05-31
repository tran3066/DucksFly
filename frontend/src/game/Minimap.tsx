// In-race minimap (multiplayer only): a vertical strip showing every duck's progress
// along the course so you can locate ducks you can't see on screen. Bottom = start
// (z=0), top = finish (z=length); horizontal offset within the strip = lateral X.
//
// Pure DOM overlay (no three.js) sampled on an interval — like `Hud` — so it does NOT
// re-render on every ~20Hz net patch and costs nothing in the render loop.

import { useEffect, useState } from 'react'
import type { DuckState } from '../physics'
import type { PlayerView } from '../net/types'
import { COLORS, FONT } from './ui'

interface Marker {
  id: string
  name: string
  topPct: number
  leftPct: number
  self: boolean
  finished: boolean
}

const SAMPLE_MS = 100
// The course band sits between the finish line (top) and start line (bottom).
const TOP_PCT = 8
const BOTTOM_PCT = 92

export function Minimap({
  stateRef,
  players,
  sessionId,
  length,
  halfWidth,
}: {
  stateRef: React.RefObject<DuckState>
  players: PlayerView[]
  sessionId?: string
  length: number
  halfWidth: number
}) {
  const [markers, setMarkers] = useState<Marker[]>([])

  useEffect(() => {
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    // +Z forward => bottom(start)→top(finish). +X is LEFT in world, so +X maps to the
    // left side of the strip to read intuitively. Markers ride within [TOP_PCT, BOTTOM_PCT]
    // so z=length lands on the finish line and z=0 on the start line.
    const toPos = (x: number, z: number) => ({
      topPct: TOP_PCT + (BOTTOM_PCT - TOP_PCT) * (1 - clamp01(z / length)),
      leftPct: 100 * clamp01((halfWidth - x) / (2 * halfWidth)),
    })

    const tick = () => {
      const next: Marker[] = []
      const s = stateRef.current
      if (s) {
        const p = toPos(s.position[0], s.position[2])
        next.push({ id: 'self', name: 'You', ...p, self: true, finished: false })
      }
      for (const pl of players) {
        if (pl.id === sessionId) continue
        const p = toPos(pl.pos.x, pl.pos.z)
        next.push({ id: pl.id, name: pl.name, ...p, self: false, finished: pl.finished })
      }
      setMarkers(next)
    }

    tick()
    const handle = window.setInterval(tick, SAMPLE_MS)
    return () => window.clearInterval(handle)
  }, [stateRef, players, sessionId, length, halfWidth])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        width: 74,
        height: '52vh',
        borderRadius: 10,
        background: 'rgba(20,30,40,0.72)',
        border: '1px solid rgba(120,150,180,0.18)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      {/* finish (top) + start (bottom) lines */}
      <Line label="🏁 FINISH" color={COLORS.gold} topPct={TOP_PCT} labelSide="above" />
      <Line label="START" color={COLORS.dim} topPct={BOTTOM_PCT} labelSide="below" />

      {markers.map((m) => (
        <div
          key={m.id}
          style={{
            position: 'absolute',
            top: `${m.topPct}%`,
            left: `${m.leftPct}%`,
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexDirection: m.leftPct > 55 ? 'row-reverse' : 'row',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              width: m.self ? 14 : 12,
              height: m.self ? 14 : 12,
              borderRadius: '50%',
              background: m.self ? COLORS.gold : m.finished ? COLORS.faint : COLORS.accentBlue,
              boxShadow: m.self ? `0 0 7px ${COLORS.gold}` : 'none',
              border: '1px solid rgba(0,0,0,0.4)',
              flex: 'none',
            }}
          />
          {!m.self && (
            <span
              style={{
                fontSize: 9,
                lineHeight: 1,
                color: m.finished ? COLORS.faint : COLORS.hudText,
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                maxWidth: 46,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {m.name}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function Line({
  label,
  color,
  topPct,
  labelSide,
}: {
  label: string
  color: string
  topPct: number
  labelSide: 'above' | 'below'
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: `${topPct}%`,
        left: 0,
        right: 0,
        transform: 'translateY(-50%)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ height: 2, background: color, opacity: 0.85 }} />
      <div
        style={{
          position: 'absolute',
          left: '50%',
          [labelSide === 'above' ? 'bottom' : 'top']: 5,
          transform: 'translateX(-50%)',
          fontSize: 8,
          letterSpacing: 0.5,
          color,
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </div>
  )
}
