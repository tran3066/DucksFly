// Shared crash flash + "6-7" overlay wiring for every local flight mode.
// FlightRig plays quack / six-seven sounds in camera mode; onSixSeven drives the
// on-screen pop. Both SP and MP must use the same hook so behavior stays aligned.

import { useCallback, useState } from 'react'

export function useFlightFeedback() {
  const [crashAt, setCrashAt] = useState(0)
  const onCrash = useCallback(() => setCrashAt(performance.now()), [])

  const [sixSevenCount, setSixSevenCount] = useState(0)
  const onSixSeven = useCallback(() => setSixSevenCount((n) => n + 1), [])

  return { crashAt, onCrash, sixSevenCount, onSixSeven }
}
