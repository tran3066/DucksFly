// Time-sliced face inference loop. (Person A, Step 10.1)
//
// This is the quack pipeline's heartbeat. It mirrors the body pose loop (02.2):
// a self-scheduling requestAnimationFrame loop that calls the FaceLandmarker and
// pushes the latest face signal to a consumer (in production, the store setter).
// The same two honesty flags apply:
//   - running: flipped off by stop() so no further work happens after teardown.
//   - busy:    true while a detect is still in flight, so we SKIP overlapping
//              detects (a slow detect must not pile up and tank the frame rate).
//
// The one extra thing the face loop does that the pose loop does NOT is THROTTLE,
// also called time-slicing. Quack is a stretch feature and must never steal the
// frame budget that the body pose (flap, lean, dive) needs every single frame.
// So even though this loop schedules a rAF every frame, it only actually runs the
// face model on every Nth frame (default every 2nd). At 60 FPS that is still ~30
// face reads per second, which is plenty for a mouth-open gesture, while leaving
// most frames free for the pose model.
//
// MediaPipe's detectForVideo may return a plain result OR a promise depending on
// version, so we wrap the return in Promise.resolve(...) to handle both shapes
// and only clear busy in the resolution handler.

import type { FaceLandmarker } from '@mediapipe/tasks-vision'

// What one face read produces for downstream gesture code.
//   - landmarks: the first face's 478-point mesh (normalized x/y, optional z),
//                or null when no face was detected this read.
//   - jawOpen:   the 0..1 "jawOpen" blendshape score, the primary mouth-open
//                signal the quack detector consumes. Defaults to 0 (closed) when
//                blendshapes are unavailable, never NaN or undefined.
export interface FaceResult {
  landmarks: Array<{ x: number; y: number; z?: number; visibility?: number }> | null
  jawOpen: number
}

export interface FaceLoopOptions {
  // We only need detectForVideo, so we accept the narrow Pick instead of the
  // whole landmarker. This also makes the loop trivial to unit test with a stub.
  landmarker: Pick<FaceLandmarker, 'detectForVideo'>
  video: HTMLVideoElement
  // Called once per completed face read with the first face's landmarks and the
  // mined jawOpen score. In production this is the store setter.
  onFace: (r: FaceResult) => void
  // Clock source. Defaults to performance.now; injectable so tests are
  // deterministic and so callers can supply a monotonic timestamp if needed.
  now?: () => number
  // Time-slice cadence: run the face model only once per this many rAF frames.
  // Defaults to 2 so the face model uses at most half the frames, leaving the
  // rest for the every-frame body pose loop. Must be >= 1.
  everyNthFrame?: number
}

/**
 * Start the time-sliced face loop and return a stop() function. The loop runs
 * until stop() is called: stop() flips running off and cancels the pending rAF so
 * no already-queued frame does any work after teardown.
 */
export function startFaceLoop(opts: FaceLoopOptions): () => void {
  let running = true
  let busy = false
  // Frame counter. We run the face model only on frames where
  // (frame % everyNthFrame === 0); the other frames just reschedule. We test the
  // modulo BEFORE incrementing so frame 0 is a run frame: the face model starts on
  // the very first frame rather than idling until the cadence first lines up.
  let frame = 0
  let rafId = 0
  const now = opts.now ?? (() => performance.now())
  // Guard against a zero/negative cadence that would make the modulo meaningless.
  const everyNthFrame = Math.max(1, opts.everyNthFrame ?? 2)

  const tick = () => {
    // After stop() this short-circuits, so a frame still parked in the rAF queue
    // at teardown time becomes a no-op.
    if (!running) return

    const isRunFrame = frame % everyNthFrame === 0
    frame += 1

    // Only start a detect on an eligible (throttled) frame whose previous detect
    // has finished. If skipped or busy we do no work this frame but STILL schedule
    // the next one below, so the loop keeps a steady cadence.
    if (isRunFrame && !busy) {
      busy = true
      Promise.resolve(opts.landmarker.detectForVideo(opts.video, now()))
        .then((result) => {
          // With numFaces: 1 we take the first face's mesh, or null if none.
          const landmarks = result?.faceLandmarks?.[0] ?? null
          // Mine the jawOpen blendshape from the first face's category list.
          // Missing blendshapes (older model or disabled output) default to 0 so
          // the quack detector reads a closed mouth instead of undefined.
          const jawOpen =
            result?.faceBlendshapes?.[0]?.categories?.find(
              (c) => c.categoryName === 'jawOpen',
            )?.score ?? 0
          opts.onFace({ landmarks, jawOpen })
        })
        .catch(() => {
          // Drop this read's result on error and keep looping; a single bad
          // detect should never kill the whole pipeline.
        })
        .finally(() => {
          busy = false
        })
    }

    // Schedule the next frame every tick, whether or not this frame ran a detect.
    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)

  return () => {
    running = false
    cancelAnimationFrame(rafId)
  }
}
