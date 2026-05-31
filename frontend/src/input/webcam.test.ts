import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createWebcamController } from './webcam'

// Step 01.1: the camera-permission state machine. We test the pure controller
// (no React, no real browser) by injecting a mock getUserMedia. Each test asserts
// a different transition; the last is the adversarial double-start guard.
describe('webcam controller 01.1', () => {
  let getUserMedia: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getUserMedia = vi.fn()
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
