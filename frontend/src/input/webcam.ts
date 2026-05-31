// Webcam capture: the camera-permission state machine. (Person A, Step 01.1)
//
// Split into a pure controller (createWebcamController) that owns the state
// machine and is testable with an injected getUserMedia mock, plus a thin React
// hook (useWebcam) that wires the controller into component state via
// useSyncExternalStore. Every DuckActions frame ultimately comes from this
// stream, so the status must be a clean idle -> requesting -> ready | error.

import { useRef, useSyncExternalStore } from 'react'

export type WebcamStatus = 'idle' | 'requesting' | 'ready' | 'error'

export interface WebcamState {
  status: WebcamStatus
  stream: MediaStream | null
  error: string | null
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

const IDLE: WebcamState = { status: 'idle', stream: null, error: null }

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

  const start = async (): Promise<void> => {
    // No-op guard: do not re-request while a request is in flight or succeeded.
    if (state.status === 'requesting' || state.status === 'ready') return
    setState({ status: 'requesting', error: null })
    try {
      const stream = await deps.getUserMedia({ video: true })
      setState({ status: 'ready', stream })
    } catch (e) {
      // Full error-type mapping lands in Step 01.3; any non-null message is fine here.
      setState({ status: 'error', stream: null, error: messageFromError(e) })
    }
  }

  const stop = () => {
    if (state.stream) for (const t of state.stream.getTracks()) t.stop()
    setState({ status: 'idle', stream: null, error: null })
  }

  return { getState, subscribe, start, stop }
}

function messageFromError(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  return String(e)
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
