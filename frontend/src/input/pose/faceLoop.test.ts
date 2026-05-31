import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startFaceLoop } from './faceLoop'
import type { FaceLoopOptions } from './faceLoop'

// Step 10.1: the TIME-SLICED face inference loop. Like the pose loop (02.2) we
// test it as pure logic with fake timing: no real webcam, no real model, no real
// requestAnimationFrame. We stub rAF/cancelAnimationFrame with a manual queue so
// we can step frames by hand, inject a fake landmarker whose detectForVideo we
// control, and a fake clock so the loop is fully deterministic. The extra wrinkle
// here is THROTTLING: the face model runs only every Nth rAF (time-slicing) so it
// does not compete with the body pose loop that runs every frame.

// Manual rAF driver. requestAnimationFrame just parks the callback in a queue and
// hands back an id; stepFrame() drains the queue once (the callbacks that re-arm
// the loop push the NEXT frame's callback, so one step == one animation frame).
let rafQueue: FrameRequestCallback[] = []
let rafId = 0

beforeEach(() => {
  rafQueue = []
  rafId = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb)
    return ++rafId
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Drain exactly one frame's worth of queued callbacks. We snapshot then clear the
// queue first so callbacks re-arming the loop land in the NEXT frame, not this one.
function stepFrame(t = 16) {
  const cbs = rafQueue
  rafQueue = []
  cbs.forEach((cb) => cb(t))
}

// Fully drain the microtask queue. The loop's detect handler is a
// .then().catch().finally() chain, so busy is only cleared several microtasks
// after the detect promise settles; a handful of awaits guarantees the whole
// chain has run before we assert.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// The face mesh result MediaPipe returns: faceLandmarks is an array of faces (we
// take the first), faceBlendshapes carries the named scores we mine jawOpen from.
const FAKE_FACE_LANDMARKS = [{ x: 0.5, y: 0.5, z: 0 }]
const FAKE_RESULT = {
  faceLandmarks: [FAKE_FACE_LANDMARKS],
  faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.7 }] }],
}

describe('startFaceLoop 10.1', () => {
  // THROTTLE: with everyNthFrame = 2 the model must run only every OTHER eligible
  // frame, not on every rAF. Across ~6 rAF ticks that is ~3 detect calls, not 6,
  // which is the whole point of time-slicing the face model away from the pose.
  it('THROTTLE runs detectForVideo only every Nth frame', async () => {
    const detectForVideo = vi.fn().mockReturnValue(FAKE_RESULT)
    const onFace = vi.fn()

    startFaceLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onFace,
      now: () => 1000,
      everyNthFrame: 2,
    })

    // Six animation frames. Because the detect resolves synchronously, busy clears
    // each time, so the only gate left is the every-2nd-frame throttle: ~3 runs.
    for (let i = 0; i < 6; i++) {
      stepFrame()
      await flushMicrotasks()
    }

    expect(detectForVideo).toHaveBeenCalledTimes(3)
  })

  it('reports the first face landmarks and the jawOpen blendshape score', async () => {
    const detectForVideo = vi.fn().mockReturnValue(FAKE_RESULT)
    const onFace = vi.fn()

    startFaceLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onFace,
      now: () => 1000,
      everyNthFrame: 2,
    })

    stepFrame()
    await flushMicrotasks()

    // detectForVideo gets the video element and the injected clock value.
    expect(detectForVideo).toHaveBeenCalledWith({}, 1000)
    expect(onFace).toHaveBeenCalledTimes(1)
    // onFace receives the FIRST face's landmark array and the mined jawOpen score.
    expect(onFace).toHaveBeenCalledWith({
      landmarks: FAKE_FACE_LANDMARKS,
      jawOpen: 0.7,
    })
  })

  it('defaults jawOpen to 0 when blendshapes are missing', async () => {
    // No faceBlendshapes at all: the loop must not throw and must report 0 so the
    // downstream quack detector reads a closed mouth rather than NaN/undefined.
    const detectForVideo = vi
      .fn()
      .mockReturnValue({ faceLandmarks: [FAKE_FACE_LANDMARKS] })
    const onFace = vi.fn()

    startFaceLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onFace,
      now: () => 0,
      everyNthFrame: 2,
    })

    stepFrame()
    await flushMicrotasks()

    expect(onFace).toHaveBeenCalledTimes(1)
    expect(onFace).toHaveBeenCalledWith({
      landmarks: FAKE_FACE_LANDMARKS,
      jawOpen: 0,
    })
  })

  // ADVERSARIAL: a slow detect must not be allowed to overlap with later eligible
  // frames. While one detect is still pending, every following eligible frame is
  // skipped (no new detectForVideo call) but the loop keeps scheduling so cadence
  // is preserved.
  it('ADVERSARIAL skips eligible frames while a detect is still running', async () => {
    let resolveDetect: (v: unknown) => void = () => {}
    const detectForVideo = vi.fn(
      () =>
        new Promise((res) => {
          resolveDetect = res
        }),
    )
    const onFace = vi.fn()

    // The real MediaPipe detectForVideo overloads only declare a synchronous
    // result; our loop also tolerates a promise (newer SDK shape), so we cast the
    // stub to the loop's narrow landmarker type for this never-resolving case.
    const landmarker = {
      detectForVideo,
    } as unknown as FaceLoopOptions['landmarker']

    startFaceLoop({
      landmarker,
      video: {} as HTMLVideoElement,
      onFace,
      now: () => 0,
      everyNthFrame: 2,
    })

    // Many frames, but the first detect never resolved, so every later eligible
    // frame is busy-skipped: only ONE detectForVideo call across all of them.
    for (let i = 0; i < 6; i++) stepFrame()
    expect(detectForVideo).toHaveBeenCalledTimes(1)

    // Resolve the in-flight detect, then flush the .then/.catch/.finally chain so
    // the finally{} that clears busy has actually run before we step further.
    resolveDetect(FAKE_RESULT)
    await flushMicrotasks()

    // Step until the next eligible frame fires a second detect.
    for (let i = 0; i < 2; i++) {
      stepFrame()
      await flushMicrotasks()
    }
    expect(detectForVideo).toHaveBeenCalledTimes(2)
  })

  it('stops cleanly: no detects after stop and rAF is cancelled', async () => {
    const detectForVideo = vi.fn().mockReturnValue(FAKE_RESULT)

    const stop = startFaceLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onFace: vi.fn(),
      now: () => 0,
      everyNthFrame: 2,
    })

    stepFrame()
    await flushMicrotasks()
    expect(detectForVideo).toHaveBeenCalledTimes(1)

    stop()

    // Any frames still parked in the queue after stop must be no-ops, and no new
    // frames get scheduled.
    stepFrame()
    stepFrame()
    stepFrame()
    stepFrame()

    expect(detectForVideo).toHaveBeenCalledTimes(1)
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
