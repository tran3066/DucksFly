// Shared input store (Zustand). The 02.2 pose loop writes the latest landmark
// frame here; the 02.3 debug overlay and the calibration collector read it. This
// is the single hand-off point between "raw pose tracking" and everything that
// consumes landmarks, so the loop stays a tiny writer and consumers stay pull-based.

import { create } from 'zustand'
import type { LandmarkFrame } from './fixtures/landmarks'

export interface InputStoreState {
  /** Latest pose landmarks from the 02.2 loop, or null when no body is tracked. */
  landmarks: LandmarkFrame | null
  setLandmarks: (landmarks: LandmarkFrame | null) => void
}

export const useInputStore = create<InputStoreState>((set) => ({
  landmarks: null,
  setLandmarks: (landmarks) => set({ landmarks }),
}))
