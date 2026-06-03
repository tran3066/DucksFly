import { useEffect } from 'react'
import { applyLocalFlightDefaults } from './localFlightSetup'
import type { FlightSession } from './useFlightSession'

/** Keep session refs on the canonical flight/boost/action defaults (all modes). */
export function useApplyLocalFlightDefaults(session: FlightSession) {
  useEffect(() => {
    applyLocalFlightDefaults(session)
    // Session refs are stable for the component lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
