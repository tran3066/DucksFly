// Shared input store (Zustand). The 02.2 pose loop writes the latest landmark
// frame here; the 02.3 debug overlay and the calibration collector read it. This
// is the single hand-off point between "raw pose tracking" and everything that
// consumes landmarks, so the loop stays a tiny writer and consumers stay pull-based.

import { create } from 'zustand'
import type { LandmarkFrame } from './fixtures/landmarks'

export interface InputStoreState {
  /** Latest pose (body) landmarks from the 02.2 loop, or null when no body is tracked. */
  landmarks: LandmarkFrame | null
  setLandmarks: (landmarks: LandmarkFrame | null) => void

  /**
   * Latest face-mesh landmarks (MediaPipe Face Landmarker, 478 points), or null
   * when no face is tracked. Updated on a time-sliced cadence (every Nth frame)
   * so the heavier face model does not compete with the body pose every frame.
   */
  faceLandmarks: LandmarkFrame | null
  /** Mouth-open amount, 0..1, from the Face Landmarker `jawOpen` blendshape. The
   *  quack gesture (Step 10) reads this; 0 when no face is tracked. */
  jawOpen: number
  setFace: (faceLandmarks: LandmarkFrame | null, jawOpen: number) => void
}

export const useInputStore = create<InputStoreState>((set) => ({
  landmarks: null,
  setLandmarks: (landmarks) => set({ landmarks }),
  faceLandmarks: null,
  jawOpen: 0,
  setFace: (faceLandmarks, jawOpen) => set({ faceLandmarks, jawOpen }),
}))
