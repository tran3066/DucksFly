import { DuckPreview } from './world/DuckPreview'
import { PhysicsSandbox } from './test/PhysicsSandbox'
import { MultiplayerTest } from './test/MultiplayerTest'
import { MultiplayerRace } from './test/MultiplayerRace'

// Temporary view switch so each person's harness coexists. Pick via URL:
//   ?view=map          -> single-player flight / map sandbox (Person C)
//   ?view=race         -> the flight prototype WITH multiplayer (open in several tabs)
//   ?view=multiplayer  -> bare server sync test harness (open in several tabs)
//   (default)          -> duck preview (Person A)
function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'map') return <PhysicsSandbox />
  if (view === 'race') return <MultiplayerRace />
  if (view === 'multiplayer') return <MultiplayerTest />
  return <DuckPreview />
}

export default App
