import { DuckPreview } from './world/DuckPreview'
import { PhysicsSandbox } from './test/PhysicsSandbox'
import { MultiplayerTest } from './test/MultiplayerTest'
import { MultiplayerRace } from './test/MultiplayerRace'
import { PersonAPlayground } from './debug/PersonAPlayground'
import { Game } from './game/Game'

// View switch via URL. The real shipped game is `?view=game`; the rest are kept
// as legacy harnesses for history/reference (do not remove):
//   ?view=game         -> THE GAME: start menu -> single-player or multiplayer
//   ?view=map          -> single-player flight / map sandbox (Person C, legacy)
//   ?view=race         -> the flight prototype WITH multiplayer (legacy)
//   ?view=multiplayer  -> bare server sync test harness (legacy)
//   ?view=playground   -> Person A playground (legacy source of truth)
//   (default)          -> duck preview (Person A)
function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'game') return <Game />
  if (view === 'map') return <PhysicsSandbox />
  if (view === 'race') return <MultiplayerRace />
  if (view === 'multiplayer') return <MultiplayerTest />
  if (view === 'playground') return <PersonAPlayground />
  return <DuckPreview />
}

export default App
