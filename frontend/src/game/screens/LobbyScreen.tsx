// Connected lobby / wait screen: shows while phase === 'lobby'. Invite code + share link, the
// roster, ready/start controls. The host starts the race once enough players are present.

import { useState } from 'react'
import { raceConnection } from '../../net/connection'
import { isHost } from '../../net/useRace'
import type { PlayerView, RaceSnapshot } from '../../net/types'
import { buildShareLink } from '../../net/lobbyCode'
import { Overlay, Panel, Button, COLORS, MONO } from '../ui'
import { RosterTable, titleStyle, codeBox } from './parts'

/** Mirrors backend MIN_PLAYERS_TO_START (src/logic/stateMachine.ts). */
const MIN_PLAYERS_TO_START = 2

export function LobbyScreen({
  race,
  self,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  onExit?: () => void
}) {
  const canStart =
    isHost(race) && race.phase === 'lobby' && race.players.length >= MIN_PLAYERS_TO_START
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? race.code : buildShareLink(race.code)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      window.setTimeout(() => setCopied(null), 1400)
    } catch {
      setCopied(null)
    }
  }

  return (
    <Overlay>
      <Panel width={480}>
        <h1 style={titleStyle}>
          <span style={{ fontSize: '1.4rem' }}>🦆</span> Lobby
        </h1>

        <div style={codeBox}>
          <div>
            <div style={{ color: COLORS.dim, fontSize: '0.75rem', letterSpacing: 1 }}>
              INVITE CODE
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: 8,
                color: COLORS.gold,
              }}
            >
              {race.code || '····'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button onClick={() => copy('code')} style={{ padding: '7px 12px', fontSize: '0.85rem' }}>
              {copied === 'code' ? 'Copied!' : 'Copy code'}
            </Button>
            <Button onClick={() => copy('link')} style={{ padding: '7px 12px', fontSize: '0.85rem' }}>
              {copied === 'link' ? 'Copied!' : 'Copy link'}
            </Button>
          </div>
        </div>

        <RosterTable race={race} />

        <p style={{ color: COLORS.faint, fontSize: '0.8rem', margin: '10px 0 16px' }}>
          {race.players.length} player{race.players.length === 1 ? '' : 's'} · need{' '}
          {MIN_PLAYERS_TO_START}+ to start
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            variant={self?.ready ? 'ghost' : 'primary'}
            accent={COLORS.good}
            onClick={() => raceConnection.setReady(!self?.ready)}
          >
            {self?.ready ? 'Unready' : 'Ready up'}
          </Button>
          <Button
            variant="primary"
            accent={COLORS.accent}
            disabled={!canStart}
            onClick={() => raceConnection.startRace()}
          >
            {isHost(race) ? 'Start race' : 'Host starts'}
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
