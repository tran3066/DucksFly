import { DuckPreview } from './world/DuckPreview'
import { PhysicsSandbox } from './test/PhysicsSandbox'
import { MultiplayerTest } from './test/MultiplayerTest'
import { PersonAPlayground } from './debug/PersonAPlayground'

// Temporary view switch so each person's harness coexists. Pick via URL:
//   ?view=map          -> environment / map generation sandbox (Person B)
//   ?view=multiplayer  -> server sync test harness (open in several tabs)
//   ?view=playground   -> Person A playground (real animated duck + follow cam)
//   (default)          -> duck preview (Person A)
// The real game shell replaces all of this later.
function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'map') return <PhysicsSandbox />
  if (view === 'multiplayer') return <MultiplayerTest />
  if (view === 'playground') return <PersonAPlayground />
  return <DuckPreview />
}

export default App
