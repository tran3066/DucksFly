import { PhysicsSandbox } from './test/PhysicsSandbox'
import { PersonAPlayground } from './debug/PersonAPlayground'

// Test-harness switcher (dev only). Both harnesses coexist so Person A and
// Person C never fight over App.tsx:
//   default  -> Person C physics sandbox (placeholder duck)
//   ?mode=a  -> Person A playground (real animated duck + follow cam)
// The real game shell replaces all of this later.
function App() {
  const mode = new URLSearchParams(window.location.search).get('mode')
  if (mode === 'a') return <PersonAPlayground />
  return <PhysicsSandbox />
}

export default App
