// The one place that decides which overlay is on screen. Exactly one screen renders at a
// time, chosen from (connection status, race phase, whether you've finished). The 3D scene
// stays mounted behind it the whole time — these are pure overlays. No stacked conditionals
// scattered through the game component; add or change a screen here and nowhere else.

import type { PlayerView, RaceSnapshot } from '../../net/types'
import { ConnectScreen } from './ConnectScreen'
import { LobbyScreen } from './LobbyScreen'
import { CountdownOverlay } from './CountdownOverlay'
import { RaceHud } from './RaceHud'
import { FinishedWaitingScreen } from './FinishedWaitingScreen'
import { ResultsScreen } from './ResultsScreen'

export function RaceScreens({
  race,
  self,
  ringCount,
  finished,
  onExit,
}: {
  race: RaceSnapshot
  self?: PlayerView
  /** Total rings on the locally-built course (the server holds no ring geometry). */
  ringCount: number
  /** True once we've crossed the line (local finish or server-confirmed) — drives the wait screen. */
  finished: boolean
  onExit?: () => void
}) {
  if (race.status !== 'connected') {
    return <ConnectScreen race={race} onExit={onExit} />
  }

  switch (race.phase) {
    case 'lobby':
      return <LobbyScreen race={race} self={self} onExit={onExit} />
    case 'countdown':
      return <CountdownOverlay endsAt={race.countdownEndsAt} />
    case 'racing':
      return finished ? (
        <FinishedWaitingScreen race={race} self={self} ringCount={ringCount} />
      ) : (
        <RaceHud race={race} self={self} ringCount={ringCount} />
      )
    case 'finished':
      return <ResultsScreen race={race} self={self} onExit={onExit} />
    default:
      return null
  }
}
