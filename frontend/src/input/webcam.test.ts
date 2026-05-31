import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import {
  createWebcamController,
  attachStream,
  detachStream,
  messageFromError,
  classifyError,
} from './webcam'
import type { WebcamControllerDeps } from './webcam'

// Step 01.1: the camera-permission state machine. We test the pure controller
// (no React, no real browser) by injecting a mock getUserMedia. Each test asserts
// a different transition; the last is the adversarial double-start guard.
describe('webcam controller 01.1', () => {
  let getUserMedia: Mock<WebcamControllerDeps['getUserMedia']>

  beforeEach(() => {
    getUserMedia = vi.fn<WebcamControllerDeps['getUserMedia']>()
  })

  it('starts_in_idle', () => {
    const c = createWebcamController({ getUserMedia })
    const s = c.getState()
    expect(s.status).toBe('idle')
    expect(s.stream).toBeNull()
    expect(s.error).toBeNull()
  })

  it('request_moves_to_requesting_then_ready', async () => {
    const fakeStream = { id: 'fake' } as unknown as MediaStream
    getUserMedia.mockResolvedValue(fakeStream)
    const c = createWebcamController({ getUserMedia })
    const p = c.start()
    expect(c.getState().status).toBe('requesting') // synchronous transition
    await p
    expect(c.getState().status).toBe('ready')
    expect(c.getState().stream).toBe(fakeStream)
    expect(c.getState().error).toBeNull()
  })

  it('reject_moves_to_error', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const c = createWebcamController({ getUserMedia })
    await c.start()
    const s = c.getState()
    expect(s.status).toBe('error')
    expect(s.stream).toBeNull()
    expect(s.error).not.toBeNull()
  })

  // ADVERSARIAL: rapid double start (clicks / StrictMode re-invoke) must not spam
  // the browser permission API. Second start while still requesting is a no-op.
  it('ADVERSARIAL double_start_calls_getUserMedia_once', async () => {
    let resolveFn: (s: MediaStream) => void = () => {}
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((r) => {
        resolveFn = r
      }),
    )
    const c = createWebcamController({ getUserMedia })
    c.start()
    c.start() // second call while still requesting
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(c.getState().status).toBe('requesting')
    resolveFn({ id: 'fake' } as unknown as MediaStream)
  })
})

// Step 01.2: attaching the stream to a (hidden) <video> element so MediaPipe can
// read frames from it. We test the two tiny DOM helpers against a FAKE video
// object that only has the fields the helper touches (srcObject + play). The
// adversarial case covers a play() that rejects, which is common when the browser
// blocks autoplay; the helper must swallow it so the input pipeline never crashes.
describe('attachStream 01.2', () => {
  const makeVideo = (play = vi.fn().mockResolvedValue(undefined)) =>
    ({ srcObject: null as unknown, play } as unknown as HTMLVideoElement)
  const fakeStream = { id: 'fake' } as unknown as MediaStream

  it('attach_sets_srcObject', () => {
    const v = makeVideo()
    attachStream(v, fakeStream)
    // The stream must be wired onto the element so the video has frames to show.
    expect(v.srcObject).toBe(fakeStream)
  })

  it('attach_calls_play', () => {
    const play = vi.fn().mockResolvedValue(undefined)
    const v = makeVideo(play)
    attachStream(v, fakeStream)
    // autoPlay timing is not guaranteed, so we call play() ourselves exactly once.
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('detach_clears_srcObject', () => {
    const v = makeVideo()
    attachStream(v, fakeStream)
    detachStream(v)
    // Clean teardown: a reused element must not hold on to a dead stream.
    expect(v.srcObject).toBeNull()
  })

  it('ADVERSARIAL play_rejection_does_not_throw', async () => {
    const play = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    const v = makeVideo(play)
    // A blocked autoplay must not throw synchronously and the returned promise
    // must still resolve (the helper catches + logs the rejection internally).
    expect(() => attachStream(v, fakeStream)).not.toThrow()
    await expect(attachStream(v, fakeStream)).resolves.toBeUndefined()
    // srcObject is still set even though play() rejected.
    expect(v.srcObject).toBe(fakeStream)
  })
})

// Step 01.3: turning raw getUserMedia failures into clear, action-oriented text.
// We test messageFromError directly (pure string mapping by DOMException.name)
// and confirm the controller's error end-state routes through it. The adversarial
// case feeds in garbage that is not a DOMException and has no name; it must still
// produce a non-empty fallback string and an 'error' status, never a throw.
describe('webcam errors 01.3', () => {
  it('denied_maps_to_permission_message', () => {
    const msg = messageFromError(new DOMException('x', 'NotAllowedError'))
    expect(msg).not.toBe('')
    expect(msg.toLowerCase()).toContain('permission')
  })

  it('notfound_maps_to_missing_camera_message', () => {
    const msg = messageFromError(new DOMException('x', 'NotFoundError'))
    expect(msg).not.toBe('')
    expect(msg.toLowerCase()).toContain('camera')
  })

  it('messages_are_distinct', () => {
    const a = messageFromError(new DOMException('x', 'NotAllowedError'))
    const b = messageFromError(new DOMException('x', 'NotFoundError'))
    const c = messageFromError(new DOMException('x', 'NotReadableError'))
    // No copy-paste collisions, so the overlay tells the user which problem hit.
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
  })

  it('controller_reject_sets_error_message', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('x', 'NotFoundError'))
    const c = createWebcamController({ getUserMedia })
    await c.start()
    const s = c.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe(messageFromError(new DOMException('x', 'NotFoundError')))
  })

  it('ADVERSARIAL unknown_error_still_safe', async () => {
    const msg = messageFromError({ weird: true })
    // Garbage in: non-empty fallback string out, no throw.
    expect(msg).not.toBe('')
    const getUserMedia = vi.fn().mockRejectedValue({ weird: true })
    const c = createWebcamController({ getUserMedia })
    await c.start()
    const s = c.getState()
    expect(s.status).toBe('error')
    expect(s.error).not.toBe('')
    expect(s.error).not.toBeNull()
  })

  // The error state also carries a machine-readable "kind" alongside the friendly
  // message so the UI can branch (icon, retry copy) without string-matching text.
  it('classify_maps_names_to_kinds', () => {
    expect(classifyError(new DOMException('x', 'NotAllowedError'))).toBe('denied')
    expect(classifyError(new DOMException('x', 'SecurityError'))).toBe('denied')
    expect(classifyError(new DOMException('x', 'NotFoundError'))).toBe('no-camera')
    expect(classifyError(new DOMException('x', 'OverconstrainedError'))).toBe('no-camera')
    expect(classifyError(new DOMException('x', 'NotReadableError'))).toBe('in-use')
    expect(classifyError(new DOMException('x', 'AbortError'))).toBe('in-use')
    expect(classifyError({ weird: true })).toBe('unknown')
  })

  it('controller_error_state_carries_kind', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('x', 'NotAllowedError'))
    const c = createWebcamController({ getUserMedia })
    await c.start()
    const s = c.getState()
    expect(s.status).toBe('error')
    expect(s.errorKind).toBe('denied')
  })
})
