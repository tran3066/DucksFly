// The real game entry (route ?view=game). Opens on the start menu, then mounts
// the chosen mode. Single-player and multiplayer are fully separate components
// that only share the gameplay core (FlightScene/FlightRig) — selecting one
// never touches the other's code path.

import { useState } from 'react'
import { StartMenu, type GameMode } from './StartMenu'
import { SinglePlayerGame } from './SinglePlayerGame'
import { MultiplayerGame } from './MultiplayerGame'
import { raceConnection } from '../net/connection'

export function Game() {
  const [mode, setMode] = useState<GameMode | null>(null)

  if (mode === 'single') return <SinglePlayerGame onExit={() => setMode(null)} />
  if (mode === 'multi')
    return (
      <MultiplayerGame
        onExit={() => {
          // Drop the room connection on the way back to the menu.
          raceConnection.leave()
          setMode(null)
        }}
      />
    )
  return <StartMenu onPick={setMode} />
}
