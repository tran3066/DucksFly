// Load the MediaPipe FaceLandmarker once. (Person A, Step 10.1)
//
// This is the second, independent ML model behind the quack signal. It mirrors
// the PoseLandmarker loader exactly: a FilesetResolver pointing at the WASM bundle
// (the compiled inference runtime), plus the face model .task file, wired up
// behind one async loader configured for VIDEO running mode (so the loop can call
// detectForVideo with a timestamp each read) and the GPU delegate (for speed).
// The crucial extra option here is outputFaceBlendshapes: true, which is what
// makes the model emit the named "jawOpen" score the mouth-open gesture reads. On
// any failure we rethrow a descriptive Error rather than returning null, so a dead
// model surfaces loudly instead of silently killing the quack stream.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision'

// Hosted tasks-vision WASM directory. Kept as a top-level const so it is easy to
// swap for a self-hosted /public path later without touching the loader logic.
export const FACE_WASM_PATH =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'

// The face_landmarker float16 model .task file. It bundles the 478-point face
// mesh plus the blendshape head we enable below for the jawOpen score.
export const FACE_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/**
 * Build a FaceLandmarker configured for per-read VIDEO inference on the GPU with
 * blendshapes enabled. Resolves to a usable instance the face loop (10.1) can hold
 * and reuse; never resolves to null. On any load failure (bad network, missing
 * model, no GPU delegate) it rejects with a descriptive Error.
 */
export async function createFaceLandmarker(): Promise<FaceLandmarker> {
  try {
    // Resolve the WASM fileset first; createFromOptions needs it to bootstrap.
    const vision = await FilesetResolver.forVisionTasks(FACE_WASM_PATH)

    return await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: 'GPU' },
      runningMode: 'VIDEO', // lets the loop call detectForVideo(video, timestamp)
      numFaces: 1, // one player: we only track the single face driving the duck
      outputFaceBlendshapes: true, // REQUIRED: produces the jawOpen score (10.2)
    })
  } catch (err) {
    // Rethrow loudly. Do NOT return null and do NOT swallow: a silent null here
    // would make the quack stream go dead with no explanation. We keep the
    // original error as `cause` so the stack trace is not lost.
    throw new Error(
      'Failed to load FaceLandmarker model: ' + (err as Error).message,
      { cause: err },
    )
  }
}
