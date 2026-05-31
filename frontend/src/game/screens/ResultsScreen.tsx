// End screen (phase === 'finished'): final standings over the frozen scene, with a clear
// winner, per-player stats (rings, crashes, time), and rematch / leave.

import { raceConnection } from '../../net/connection'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { Overlay, Panel, Button, COLORS, MONO, formatTime } from '../ui'
import { Th, Td, tableStyle, rowMe, titleStyle, winnerBox, medal, rankPlayers } from './parts'

export function ResultsScreen({
  race,
  self,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  onExit?: () => void
}) {
  const ranked = rankPlayers(race.players)
  const winner = ranked.find((p) => p.finished)
  const youWon = winner && self && winner.id === self.id

  return (
    <Overlay>
      <Panel width={540}>
        <h1 style={{ ...titleStyle, justifyContent: 'center' }}>🏁 Race complete</h1>

        <div style={winnerBox}>
          {winner ? (
            <>
              <div style={{ fontSize: '0.8rem', color: COLORS.dim, letterSpacing: 1 }}>WINNER</div>
              <div style={{ fontSize: '1.7rem', fontWeight: 800, color: COLORS.gold }}>
                🏆 {winner.name}
                {youWon ? " — that's you!" : ''}
              </div>
            </>
          ) : (
            <div style={{ color: COLORS.dim }}>No one crossed the line.</div>
          )}
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <Th center>#</Th>
              <Th>Player</Th>
              <Th center>Rings</Th>
              <Th center>Crashes</Th>
              <Th center>Time</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.id} style={p.id === race.sessionId ? rowMe : undefined}>
                <Td center>{p.finished ? medal(i + 1) : 'DNF'}</Td>
                <Td>
                  {p.name}
                  {p.id === race.sessionId ? ' (you)' : ''}
                </Td>
                <Td center>{p.ringsPassed}</Td>
                <Td center style={{ color: p.collisions > 0 ? COLORS.bad : COLORS.dim }}>
                  {p.collisions}
                </Td>
                <Td center style={{ fontFamily: MONO, color: COLORS.dim }}>
                  {p.finished ? formatTime(p.finishTime - race.raceStartAt) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <Button variant="primary" accent={COLORS.accent} onClick={() => raceConnection.playAgain()}>
            Play again
          </Button>
          <Button
            variant="danger"
            onClick={() => (onExit ? onExit() : raceConnection.leave())}
            style={{ marginLeft: 'auto' }}
          >
            Leave
          </Button>
        </div>
      </Panel>
    </Overlay>
  )
}
