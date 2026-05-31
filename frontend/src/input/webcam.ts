// Webcam capture: the camera-permission state machine. (Person A, Step 01.1)
//
// Split into a pure controller (createWebcamController) that owns the state
// machine and is testable with an injected getUserMedia mock, plus a thin React
// hook (useWebcam) that wires the controller into component state via
// useSyncExternalStore. Every DuckActions frame ultimately comes from this
// stream, so the status must be a clean idle -> requesting -> ready | error.

import { useRef, useSyncExternalStore } from 'react'

export type WebcamStatus = 'idle' | 'requesting' | 'ready' | 'error'

// The machine-readable category of a webcam failure. The UI can branch on this
// (which icon to show, what retry copy to use) without string-matching the
// human-facing message, which varies by browser. 'denied' = the user blocked the
// permission prompt; 'no-camera' = no usable device; 'in-use' = another app holds
// the camera; 'disconnected' = a working camera vanished mid-session (USB unplug,
// OS revoke); 'unknown' = anything we did not specifically classify.
export type WebcamErrorKind =
  | 'denied'
  | 'no-camera'
  | 'in-use'
  | 'disconnected'
  | 'unknown'

export interface WebcamState {
  status: WebcamStatus
  stream: MediaStream | null
  error: string | null
  // Only meaningful while status === 'error'; null otherwise. Carried alongside
  // the friendly `error` string so callers get both a category and a message.
  errorKind: WebcamErrorKind | null
}

export interface WebcamControllerDeps {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>
}

export interface WebcamController {
  getState: () => WebcamState
  subscribe: (listener: () => void) => () => void
  start: () => Promise<void>
  stop: () => void
}

const IDLE: WebcamState = { status: 'idle', stream: null, error: null, errorKind: null }

/**
 * Pure, framework-free webcam controller. Inject getUserMedia so tests pass a
 * mock and production passes the real browser function. start() is guarded so it
 * is a no-op while already requesting or ready (prevents duplicate permission
 * prompts from rapid clicks or React StrictMode double-invokes).
 */
export function createWebcamController(deps: WebcamControllerDeps): WebcamController {
  let state: WebcamState = IDLE
  const listeners = new Set<() => void>()

  const setState = (patch: Partial<WebcamState>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const getState = () => state

  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  // Device-lost handler (Step 01.3): a camera can vanish AFTER we reach 'ready'
  // (USB unplug, OS revoke). getUserMedia never rejects for this, so we instead
  // listen to the stream's video track 'ended' event and flip back to 'error'.
  // Guarded so a manual stop() does not get reported as a disconnect.
  const handleDeviceLost = () => {
    if (state.status !== 'ready') return
    setState({
      status: 'error',
      stream: null,
      error: 'Camera disconnected. Reconnect it and retry.',
      errorKind: 'disconnected',
    })
  }

  const start = async (): Promise<void> => {
    // No-op guard: do not re-request while a request is in flight or succeeded.
    if (state.status === 'requesting' || state.status === 'ready') return
    setState({ status: 'requesting', error: null, errorKind: null })
    try {
      const stream = await deps.getUserMedia({ video: true })
      // Watch every video track so an unplugged/revoked camera surfaces as error.
      // { once: true } means a single 'ended' event maps to a single transition.
      // Wrapped in a typeof guard so a minimal fake stream (no getVideoTracks)
      // does not throw and the success path stays robust.
      if (typeof stream.getVideoTracks === 'function') {
        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', handleDeviceLost, { once: true })
        }
      }
      setState({ status: 'ready', stream, error: null, errorKind: null })
    } catch (e) {
      // Route every rejection through the pure mappers so the error state carries
      // both a machine-readable kind and a friendly, action-oriented message.
      setState({
        status: 'error',
        stream: null,
        error: messageFromError(e),
        errorKind: classifyError(e),
      })
    }
  }

  const stop = () => {
    // Remove our device-lost listeners and stop the tracks so teardown does not
    // re-trigger handleDeviceLost (the status guard above also protects us).
    if (state.stream) {
      if (typeof state.stream.getVideoTracks === 'function') {
        for (const track of state.stream.getVideoTracks()) {
          track.removeEventListener('ended', handleDeviceLost)
        }
      }
      for (const t of state.stream.getTracks()) t.stop()
    }
    setState({ status: 'idle', stream: null, error: null, errorKind: null })
  }

  return { getState, subscribe, start, stop }
}

// ---------------------------------------------------------------------------
// Step 01.2: stream-to-video DOM helpers
// ---------------------------------------------------------------------------
// These are the only DOM-touching parts of the input pipeline. They take an
// HTMLVideoElement and operate on it, so the React side owns the actual hidden
// <video> ref and tests can pass a fake object that only has srcObject + play.

/**
 * Wire a MediaStream onto a <video> element and start playback.
 *
 * Returns a Promise so callers can await playback, but it NEVER rejects: a
 * blocked autoplay (very common when the video is not yet muted, or on iOS) makes
 * play() reject, and we swallow + log that so it can never crash the input
 * pipeline. We wrap play() in Promise.resolve(...) so the helper still returns a
 * promise even when a fake video's play() returns undefined.
 */
export function attachStream(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream
  return Promise.resolve(video.play()).catch((err) => {
    console.warn('[webcam] video.play() rejected:', err)
  })
}

/**
 * Clear a <video> element's stream. Called on teardown so a reused element does
 * not hold on to a dead stream (which would otherwise show a frozen last frame).
 */
export function detachStream(video: HTMLVideoElement): void {
  video.srcObject = null
}

// ---------------------------------------------------------------------------
// Step 01.3: error classification
// ---------------------------------------------------------------------------
// All getUserMedia failure translation lives here as two pure functions. We map
// by DOMException.name (stable across browsers), never by message text (which
// varies), and always have a default branch so unknown/garbage values are safe.

/**
 * Map an unknown error value to its WebcamErrorKind category.
 *
 * Uses an optional-chained read of `.name` so null, undefined, and non-object
 * inputs (the ADVERSARIAL garbage case) fall through to 'unknown' without ever
 * throwing.
 */
export function classifyError(err: unknown): WebcamErrorKind {
  const name = (err as { name?: string } | null)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-camera'
    case 'NotReadableError':
    case 'AbortError':
      return 'in-use'
    default:
      return 'unknown'
  }
}

/**
 * Map an unknown error value to a short, action-oriented message for the user.
 * The DebugOverlay renders this string verbatim, so keep it human and concise.
 * Built on classifyError so the kind and the message can never disagree.
 */
export function messageFromError(err: unknown): string {
  switch (classifyError(err)) {
    case 'denied':
      return 'Camera permission denied. Allow camera access, then click to retry.'
    case 'no-camera':
      return 'No camera found. Plug in or enable a webcam, then retry.'
    case 'in-use':
      return 'Camera is in use by another app. Close it and retry.'
    case 'disconnected':
      return 'Camera disconnected. Reconnect it and retry.'
    default:
      return 'Could not start the camera. Check your device and retry.'
  }
}

export interface UseWebcam extends WebcamState {
  start: () => Promise<void>
  stop: () => void
}

/**
 * React hook over the controller. Creates one controller per mount and
 * re-renders when its state changes.
 */
export function useWebcam(): UseWebcam {
  const ref = useRef<WebcamController | null>(null)
  if (!ref.current) {
    ref.current = createWebcamController({
      getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    })
  }
  const controller = ref.current
  const state = useSyncExternalStore(controller.subscribe, controller.getState)
  return { ...state, start: controller.start, stop: controller.stop }
}
