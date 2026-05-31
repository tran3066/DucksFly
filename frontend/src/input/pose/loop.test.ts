import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startPoseLoop } from './loop'
import type { PoseLoopOptions } from './loop'

// Step 02.2: the per-frame inference loop. We test it as pure logic with fake
// timing: no real webcam, no real model, no real requestAnimationFrame. We stub
// rAF/cancelAnimationFrame with a manual queue so we can step frames by hand,
// inject a fake landmarker whose detectForVideo we control, and a fake clock so
// the loop is fully deterministic. Each test asserts a different behavior; the
// busy-skip test is the adversarial overlap trap.

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

// A pose is a flat array of landmark points. We use a tiny one-point pose so the
// assertions are easy to read; the loop only cares about the array, not its size.
const FAKE_POSE = [{ x: 0.1, y: 0.2, z: 0, visibility: 1 }]

describe('startPoseLoop 02.2', () => {
  it('calls detectForVideo once per frame and pushes the first pose', async () => {
    // detectForVideo resolves synchronously with one pose. The loop wraps the
    // return in Promise.resolve, so we await a microtask before asserting.
    const detectForVideo = vi.fn().mockReturnValue({ landmarks: [FAKE_POSE] })
    const onLandmarks = vi.fn()

    startPoseLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onLandmarks,
      now: () => 1000,
    })

    stepFrame()
    await Promise.resolve() // let the .then(onLandmarks) microtask run

    expect(detectForVideo).toHaveBeenCalledTimes(1)
    // detectForVideo gets the video element and the injected clock value.
    expect(detectForVideo).toHaveBeenCalledWith({}, 1000)
    // onLandmarks receives the FIRST pose array (result.landmarks[0]), not the
    // wrapper object and not the whole landmarks list.
    expect(onLandmarks).toHaveBeenCalledTimes(1)
    expect(onLandmarks).toHaveBeenCalledWith(FAKE_POSE)
  })

  // ADVERSARIAL: a slow detect must not be allowed to overlap with later frames.
  // While one detect is still pending, every following frame is skipped (no new
  // detectForVideo call) but the loop keeps scheduling so cadence is preserved.
  it('ADVERSARIAL skips frames while a detect is still running', async () => {
    let resolveDetect: (v: unknown) => void = () => {}
    const detectForVideo = vi.fn(
      () =>
        new Promise((res) => {
          resolveDetect = res
        }),
    )
    const onLandmarks = vi.fn()

    // The real MediaPipe detectForVideo overloads only declare a synchronous
    // result; our loop also tolerates a promise (newer SDK shape), so we cast
    // the stub to the loop's narrow landmarker type for this never-resolving case.
    const landmarker = {
      detectForVideo,
    } as unknown as PoseLoopOptions['landmarker']

    startPoseLoop({
      landmarker,
      video: {} as HTMLVideoElement,
      onLandmarks,
      now: () => 0,
    })

    // Three frames, but the first detect never resolved, so frames 2 and 3 are
    // skipped: only ONE detectForVideo call across all three.
    stepFrame()
    stepFrame()
    stepFrame()
    expect(detectForVideo).toHaveBeenCalledTimes(1)

    // Resolve the in-flight detect, then flush the .then/.catch/.finally
    // microtask chain so the finally{} that clears busy has actually run before
    // we step the next frame.
    resolveDetect({ landmarks: [FAKE_POSE] })
    await flushMicrotasks()

    stepFrame()
    expect(detectForVideo).toHaveBeenCalledTimes(2)
  })

  it('stops cleanly: no detects after stop and rAF is cancelled', async () => {
    const detectForVideo = vi.fn().mockReturnValue({ landmarks: [FAKE_POSE] })

    const stop = startPoseLoop({
      landmarker: { detectForVideo },
      video: {} as HTMLVideoElement,
      onLandmarks: vi.fn(),
      now: () => 0,
    })

    stepFrame()
    await Promise.resolve()
    expect(detectForVideo).toHaveBeenCalledTimes(1)

    stop()

    // Any frames still parked in the queue after stop must be no-ops, and no new
    // frames get scheduled.
    stepFrame()
    stepFrame()

    expect(detectForVideo).toHaveBeenCalledTimes(1)
    expect(cancelAnimationFrame).toHaveBeenCalled()
  })
})
