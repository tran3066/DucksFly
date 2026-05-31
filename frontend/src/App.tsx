import { DuckPreview } from './world/DuckPreview'
import { PhysicsSandbox } from './test/PhysicsSandbox'

// Temporary view switch so each person's harness coexists. Pick via URL:
//   ?view=map   -> environment / map generation sandbox (Person B)
//   (default)   -> duck preview (Person A)
function App() {
  const view = new URLSearchParams(window.location.search).get('view')
  if (view === 'map') return <PhysicsSandbox />
  return <DuckPreview />
}

export default App
