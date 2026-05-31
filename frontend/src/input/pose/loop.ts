// Per-frame pose inference loop. (Person A, Step 02.2)
//
// This is the heartbeat of Person A's pipeline: a self-scheduling
// requestAnimationFrame loop that calls the PoseLandmarker once per frame and
// pushes the latest body landmarks to a consumer (in production, the Zustand
// store setter). Two flags keep it honest:
//   - running: flipped off by stop() so no further work happens after teardown.
//   - busy:    true while a detect is still in flight, so we SKIP overlapping
//              detects (a slow detect must not pile up and tank the frame rate).
//
// MediaPipe's detectForVideo may return a plain result OR a promise depending on
// version, so we wrap the return in Promise.resolve(...) to handle both shapes
// and only clear busy in the resolution handler.

import type { PoseLandmarker } from '@mediapipe/tasks-vision'

// A single body landmark point. x/y are normalized image coords (0..1); z and
// visibility are optional because gestures downstream may or may not use them.
export interface Landmark {
  x: number
  y: number
  z?: number
  visibility?: number
}

export interface PoseLoopOptions {
  // We only need detectForVideo, so we accept the narrow Pick instead of the
  // whole landmarker. This also makes the loop trivial to unit test with a stub.
  landmarker: Pick<PoseLandmarker, 'detectForVideo'>
  video: HTMLVideoElement
  // Called once per completed frame that produced at least one pose, with the
  // first pose's flat landmark array. In production this is the store setter.
  onLandmarks: (landmarks: Landmark[]) => void
  // Clock source. Defaults to performance.now; injectable so tests are
  // deterministic and so callers can supply a monotonic timestamp if needed.
  now?: () => number
}

/**
 * Start the inference loop and return a stop() function. The loop runs until
 * stop() is called: stop() flips running off and cancels the pending rAF so no
 * already-queued frame does any work after teardown.
 */
export function startPoseLoop(opts: PoseLoopOptions): () => void {
  let running = true
  let busy = false
  let frameId = 0
  const now = opts.now ?? (() => performance.now())

  const tick = () => {
    // After stop() this short-circuits, so a frame still parked in the rAF queue
    // at teardown time becomes a no-op.
    if (!running) return

    // Only start a detect when the previous one has finished. If busy, we skip
    // the detect for this frame but STILL schedule the next one below, so the
    // loop keeps a steady cadence while a slow detect is in flight.
    if (!busy) {
      busy = true
      Promise.resolve(opts.landmarker.detectForVideo(opts.video, now()))
        .then((result) => {
          // result.landmarks is an array of poses; with numPoses: 1 we take the
          // first. Only push when a pose actually exists this frame.
          const poses = result?.landmarks
          if (poses && poses.length > 0) opts.onLandmarks(poses[0])
        })
        .catch(() => {
          // Drop this frame's result on error and keep looping; a single bad
          // detect should never kill the whole pipeline.
        })
        .finally(() => {
          busy = false
        })
    }

    // Schedule the next frame every tick, busy or not.
    frameId = requestAnimationFrame(tick)
  }

  frameId = requestAnimationFrame(tick)

  return () => {
    running = false
    cancelAnimationFrame(frameId)
  }
}
