// Shown to a player the instant they cross the line, while the race is still running for
// everyone else (phase === 'racing' and self.finished). Their flight is already frozen at the
// finish line, so instead of staring into the void they get the live leaderboard plus a
// countdown of how long the rest of the field has left (the server's finish-grace window).

import { useEffect, useState } from 'react'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { Overlay, Panel, COLORS, MONO, formatTime } from '../ui'
import { Th, Td, tableStyle, rowMe, titleStyle } from './parts'

export function FinishedWaitingScreen({
  race,
  self,
  ringCount,
}: {
  race: RaceSnapshot
  self?: PlayerView
  ringCount: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [])

  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99))
  const myTime = self && self.finishTime > 0 ? self.finishTime - race.raceStartAt : 0
  const remaining = race.finishWindowEndsAt > 0 ? Math.max(0, race.finishWindowEndsAt - now) : 0
  const others = race.players.filter((p) => !p.finished).length

  return (
    <Overlay>
      <Panel width={460}>
        <h1 style={{ ...titleStyle, justifyContent: 'center' }}>🏁 You finished!</h1>
        <div style={{ textAlign: 'center', margin: '2px 0 14px' }}>
          <div style={{ fontFamily: MONO, fontSize: '2rem', fontWeight: 800, color: COLORS.gold }}>
            {formatTime(myTime)}
          </div>
          <div style={{ color: COLORS.dim, fontSize: '0.85rem', marginTop: 2 }}>
            rank {self?.rank || '–'} / {race.players.length} · {self?.collisions ?? 0} crashes
          </div>
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>Player</Th>
              <Th center>Rings</Th>
              <Th center>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} style={p.id === race.sessionId ? rowMe : undefined}>
                <Td center>{p.rank || '–'}</Td>
                <Td>
                  {p.name}
                  {p.id === race.sessionId ? ' (you)' : ''}
                </Td>
                <Td center>{`${p.ringsPassed} / ${ringCount}`}</Td>
                <Td center style={{ color: p.finished ? COLORS.good : COLORS.dim }}>
                  {p.finished ? '🏁 done' : 'flying'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ color: COLORS.faint, fontSize: '0.85rem', textAlign: 'center', margin: '16px 0 0' }}>
          {others > 0 ? (
            <>
              Waiting on {others} duck{others === 1 ? '' : 's'} ·{' '}
              <span style={{ color: COLORS.text, fontWeight: 700 }}>
                {Math.ceil(remaining / 1000)}s
              </span>{' '}
              left
            </>
          ) : (
            'Everyone finished — final results coming up…'
          )}
        </p>
      </Panel>
    </Overlay>
  )
}
