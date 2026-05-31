// Load the MediaPipe PoseLandmarker once. (Person A, Step 02.1)
//
// MediaPipe tasks-vision needs two things before it can run: a FilesetResolver
// pointing at the WASM bundle (the compiled inference runtime), and the pose
// model .task file. We wire both up here behind one async loader configured for
// VIDEO running mode (so the loop can call detectForVideo with a timestamp each
// frame) and the GPU delegate (for speed). On any failure we rethrow a
// descriptive Error rather than returning null, so a dead model surfaces loudly
// (the UI can show "camera/model failed") instead of silently killing the
// landmark stream.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

// Hosted tasks-vision WASM directory. Kept as a top-level const so it is easy to
// swap for a self-hosted /public path later without touching the loader logic.
export const WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'

// The pose_landmarker "lite" float16 model .task file. Lite keeps load time and
// per-frame cost low, which matters for a real-time game running alongside the
// renderer.
export const MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'

/**
 * Build a PoseLandmarker configured for per-frame VIDEO inference on the GPU.
 * Resolves to a usable instance the loop (02.2) can hold and reuse; never
 * resolves to null. On any load failure (bad network, missing model, no GPU
 * delegate) it rejects with a descriptive Error.
 */
export async function createPoseLandmarker(): Promise<PoseLandmarker> {
  try {
    // Resolve the WASM fileset first; createFromOptions needs it to bootstrap.
    const vision = await FilesetResolver.forVisionTasks(WASM_PATH)

    return await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO', // lets the loop call detectForVideo(video, timestamp)
      numPoses: 1, // one player: we only track the single body driving the duck
    })
  } catch (err) {
    // Rethrow loudly. Do NOT return null and do NOT swallow: a silent null here
    // would make the entire DuckActions stream go dead with no explanation. We
    // keep the original error as `cause` so the stack trace is not lost.
    throw new Error(
      'Failed to load PoseLandmarker model: ' + (err as Error).message,
      { cause: err },
    )
  }
}
