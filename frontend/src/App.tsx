import { DuckPreview } from './world/DuckPreview'
import { PhysicsSandbox } from './test/PhysicsSandbox'
import { MultiplayerTest } from './test/MultiplayerTest'

// Temporary view switch so each person's harness coexists. Pick via URL:
//   ?view=map          -> environment / map generation sandbox (Person B)
//   ?view=multiplayer  -> server sync test harness (open in several tabs)
//   (default)          -> duck preview (Person A)
function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'map') return <PhysicsSandbox />
  if (view === 'multiplayer') return <MultiplayerTest />
  return <DuckPreview />
}

export default App
