// Webcam debug panel + calibration gate. (Person A, plan Step 01.x -> 03.x glue)
//
// This is the ONE place the whole input pipeline is wired together exactly once:
// a single useWebcam (the camera-permission state machine), a single
// PoseLandmarker (the MediaPipe model), and a single pose loop (the per-frame
// rAF detect). Everything downstream -- the DebugOverlay dots and the
// calibration collector -- reads the landmarks the loop pushes into the shared
// Zustand store, so this component stays the only writer.
//
// It renders two surfaces:
//   1. a bottom-left "feed box" that is always visible once mounted: the mirrored
//      webcam video with the landmark overlay stacked on top, both flipped
//      together so the selfie mirror and the dots stay aligned.
//   2. a centered full-screen calibration gate that blocks until the player has
//      enabled the camera and captured a rest pose. Once calibrated it dismisses
//      and hands the computed Baseline back to the parent.
//
// Ref discipline: refs are only read/written inside effects and event handlers,
// never during render (this repo lints react-hooks rules strictly). Teardown
// stops the loop, closes the landmarker, and the controller stops the stream
// tracks, so nothing leaks on unmount.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebcam, attachStream, detachStream } from '../input/webcam'
import { createPoseLandmarker } from '../input/pose/poseLandmarker'
import { startPoseLoop } from '../input/pose/loop'
import { createFaceLandmarker } from '../input/pose/faceLandmarker'
import { startFaceLoop } from '../input/pose/faceLoop'
import {
  captureRestPose,
  computeBaseline,
  setBaseline,
  getBaseline,
  needsRecalibration,
  isFrameUsable,
} from '../input/calibration'
import { useInputStore } from '../input/store'
import type { LandmarkFrame } from '../input/fixtures/landmarks'
import { DebugOverlay } from './DebugOverlay'
import type { PoseLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision'
import type { Baseline } from '../input/calibration'

// Default feed-box width in px when the parent does not pass panelSize. The box
// is a 4:3 rectangle, so the height derives from this width.
const DEFAULT_PANEL_SIZE = 260

// Aspect ratio of the feed box (and the video inside it). Kept as numerator /
// denominator so the height calc and the CSS aspectRatio string agree.
const PANEL_ASPECT_W = 4
const PANEL_ASPECT_H = 3

// How long the visible "hold still" countdown runs before the capture starts, in
// whole seconds. The capture itself then samples for CAPTURE_MS.
const COUNTDOWN_SECONDS = 3

// How long captureRestPose samples the live pose loop, in ms. 2500ms (~2.5s of
// frames) is enough to average out per-frame jitter without making the player
// hold still uncomfortably long.
const CAPTURE_MS = 2500

// The phases the calibration gate moves through. 'idle' is the resting state
// (showing either "enable camera" or "ready to calibrate"); 'countdown' shows the
// 3..2..1 timer; 'capturing' is the actual sampling window; 'failed' means the
// capture saw no usable frames and the player should reframe and retry.
type GatePhase = 'idle' | 'countdown' | 'capturing' | 'failed'

// How often (ms) we re-check the live body scale against the stored baseline to
// decide whether to show the "recalibrate?" hint. 400ms is responsive enough to
// catch a player walking closer without polling every frame.
const DRIFT_POLL_MS = 400

// How many consecutive agreeing polls (~DRIFT_POLL_MS each) before the drift hint
// flips on or off. A 3-tick (~1.2s) debounce keeps a single odd frame or a brief
// lean from flashing the hint; the predicate itself stays pure in calibration.ts.
const DRIFT_DEBOUNCE_TICKS = 3

// Below this visibility we do not trust a shoulder landmark, matching the
// calibration capture gate (VIS_MIN). Used only for the live drift read.
const DRIFT_VIS_MIN = 0.5

/**
 * The player's current on-screen shoulder width (distance between landmarks 11
 * and 12), or 0 when the body is not cleanly tracked. 0 means "no usable read
 * this tick" so the drift watcher can skip it rather than treat a tracking blip
 * as a huge scale change.
 */
function liveShoulderWidth(frame: LandmarkFrame | null): number {
  if (!frame) return 0
  const l = frame[11]
  const r = frame[12]
  if (!l || !r) return 0
  if (l.visibility < DRIFT_VIS_MIN || r.visibility < DRIFT_VIS_MIN) return 0
  return Math.hypot(l.x - r.x, l.y - r.y)
}

export interface WebcamPanelProps {
  // Called once with the computed Baseline when calibration succeeds. Optional so
  // the panel can be mounted purely to preview the feed without a consumer.
  onCalibrated?: (baseline: Baseline) => void
  // Fires with `false` while the calibration gate is open and `true` once
  // calibration is complete, so the host can freeze gameplay (hold the duck
  // hovering) during calibration and resume it after. Also fires `false` again
  // when the player re-opens the gate to recalibrate. Pass a STABLE callback
  // (e.g. a useState setter) so it does not refire every render.
  onActiveChange?: (active: boolean) => void
  // Feed-box width in px; defaults to DEFAULT_PANEL_SIZE.
  panelSize?: number
}

/**
 * Owns the entire webcam + pose pipeline exactly once and renders the feed box
 * plus the calibration gate. Mount this a single time near the app root.
 */
export function WebcamPanel({
  onCalibrated,
  onActiveChange,
  panelSize,
}: WebcamPanelProps): React.JSX.Element {
  // --- Webcam state machine (Step 01). start() is the user-gesture entry point
  //     for getUserMedia; stop() is handled by the hook's controller on unmount
  //     via track teardown, but we also detach the video below. ---
  const { status, stream, error, start } = useWebcam()

  // The <video> the stream is attached to and the loop reads frames from. Touched
  // only in effects/handlers, never during render.
  const videoRef = useRef<HTMLVideoElement>(null)

  // The loaded PoseLandmarker, or null until createPoseLandmarker resolves. Held
  // in a ref (not state) because the loop reads it imperatively and we do not want
  // a re-render when it lands; modelReady (below) is the render-visible signal.
  const landmarkerRef = useRef<PoseLandmarker | null>(null)
  // The loaded FaceLandmarker (face mesh + jawOpen blendshape), or null until it
  // resolves. Loaded in parallel with the pose model.
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null)

  // The stop() returned by startPoseLoop, or null when the loop is not running.
  // Kept in a ref so the start-once effect and the unmount cleanup share it.
  const loopStopRef = useRef<(() => void) | null>(null)
  // The stop() for the time-sliced face loop, or null when it is not running.
  const faceLoopStopRef = useRef<(() => void) | null>(null)

  // Guard so the loop is created exactly once even if the start-once effect runs
  // again (StrictMode double-invoke, dependency changes). The ref above can be
  // nulled by cleanup, so we track "did we ever start" separately is unnecessary;
  // instead we simply check loopStopRef before starting.

  // Render-visible flags. modelReady flips true when the landmarker finishes
  // loading; videoReady flips true once the <video> actually has pixels (real
  // dimensions), which is when the loop is safe to start.
  const [modelReady, setModelReady] = useState(false)
  const [faceModelReady, setFaceModelReady] = useState(false)
  const [videoReady, setVideoReady] = useState(false)

  // A friendly message if the MediaPipe model fails to load. Shown in the feed box
  // and (if it happens) folded into the gate copy so a dead model is loud, not
  // silent.
  const [modelError, setModelError] = useState<string | null>(null)

  // Calibration gate state. `calibrated` dismisses the gate for good; `phase`
  // drives the in-gate UI; `countdown` is the visible 3..2..1 number.
  const [calibrated, setCalibrated] = useState(false)
  const [phase, setPhase] = useState<GatePhase>('idle')
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS)

  // Drift hint (03.3): true once the player's live body scale has drifted far
  // enough from the stored baseline that gameplay normalization would be off, so
  // we nudge them to recalibrate. Debounced in the watcher effect below.
  const [driftWarning, setDriftWarning] = useState(false)

  // Measured feed-box pixel size, fed to DebugOverlay so the canvas matches the
  // rendered video box exactly. Derived from panelSize + the 4:3 ratio as the
  // initial guess, then corrected by a ResizeObserver once the box is laid out.
  const boxWidth = panelSize ?? DEFAULT_PANEL_SIZE
  const boxHeight = Math.round((boxWidth * PANEL_ASPECT_H) / PANEL_ASPECT_W)
  const [overlaySize, setOverlaySize] = useState<{ w: number; h: number }>({
    w: boxWidth,
    h: boxHeight,
  })

  // The outer feed box, observed for its real pixel size so the overlay canvas
  // tracks any rounding the browser applies to the aspect-ratio layout.
  const boxRef = useRef<HTMLDivElement>(null)

  const isReady = status === 'ready'

  // --- Effect: load the PoseLandmarker once on mount, close it on unmount. ---
  useEffect(() => {
    let cancelled = false
    createPoseLandmarker()
      .then((lm) => {
        // If the component unmounted before the model resolved, close it
        // immediately so the GPU resources do not leak.
        if (cancelled) {
          lm.close()
          return
        }
        landmarkerRef.current = lm
        setModelReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setModelError(message)
      })

    return () => {
      cancelled = true
      // Stop any running loop before closing the model so no in-flight detect
      // touches a closed landmarker.
      if (loopStopRef.current) {
        loopStopRef.current()
        loopStopRef.current = null
      }
      if (landmarkerRef.current) {
        landmarkerRef.current.close()
        landmarkerRef.current = null
      }
    }
  }, [])

  // --- Effect: load the FaceLandmarker once on mount (in parallel with the pose
  //     model), close it on unmount. It feeds the face mesh + jawOpen; a failure
  //     here is non-fatal (the body pose still drives the duck), so we only warn. ---
  useEffect(() => {
    let cancelled = false
    createFaceLandmarker()
      .then((lm) => {
        if (cancelled) {
          lm.close()
          return
        }
        faceLandmarkerRef.current = lm
        setFaceModelReady(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.warn('[WebcamPanel] face model failed to load:', err)
      })

    return () => {
      cancelled = true
      if (faceLoopStopRef.current) {
        faceLoopStopRef.current()
        faceLoopStopRef.current = null
      }
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close()
        faceLandmarkerRef.current = null
      }
    }
  }, [])

  // --- Effect: attach the stream to the <video> when the camera is ready, and
  //     detach on cleanup. ---
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (!isReady || !stream) return

    // attachStream sets srcObject and calls play(); it never rejects.
    void attachStream(video, stream)

    return () => {
      detachStream(video)
    }
  }, [isReady, stream])

  // --- Effect: mark the video "ready" once it has real pixels. We listen for
  //     loadeddata/playing rather than trusting status, because the loop needs the
  //     element to have actual dimensions before detectForVideo will work. ---
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const markReady = () => setVideoReady(true)

    // If the element already has data (e.g. fast attach), flip immediately.
    if (video.readyState >= 2 && video.videoWidth > 0) {
      setVideoReady(true)
    }

    video.addEventListener('loadeddata', markReady)
    video.addEventListener('playing', markReady)

    return () => {
      video.removeEventListener('loadeddata', markReady)
      video.removeEventListener('playing', markReady)
      // When the stream goes away (camera stopped/lost), the video no longer has
      // pixels, so reset so a later re-enable re-arms the loop start.
      setVideoReady(false)
    }
  }, [isReady, stream])

  // --- Effect: start the pose loop exactly once, when BOTH the model is ready and
  //     the video has real pixels. Guarded by loopStopRef so a re-run never starts
  //     a second loop. ---
  useEffect(() => {
    const video = videoRef.current
    const landmarker = landmarkerRef.current
    if (!modelReady || !videoReady || !landmarker || !video) return
    // Already running: do not start a second loop.
    if (loopStopRef.current) return

    loopStopRef.current = startPoseLoop({
      landmarker,
      video,
      onLandmarks: (raw) =>
        useInputStore.getState().setLandmarks(
          // Normalize MediaPipe's landmark shape into the store's LandmarkFrame:
          // z and visibility are optional off the model, so we fill safe defaults
          // (z 0, visibility 1) to keep the downstream types total.
          raw.map((p) => ({
            x: p.x,
            y: p.y,
            z: p.z ?? 0,
            visibility: p.visibility ?? 1,
          })),
        ),
    })

    // No cleanup here on purpose: the loop must survive re-renders and is torn
    // down once in the model effect's unmount cleanup. Tearing it down here would
    // stop/restart the loop on every dependency tick.
  }, [modelReady, videoReady])

  // --- Effect: start the TIME-SLICED face loop once the face model is ready and
  //     the video has pixels. It runs every Nth frame (default 2) so it does not
  //     compete with the body pose, and writes faceLandmarks + jawOpen to the
  //     store (the overlay draws the mesh; the playground reads jawOpen). ---
  useEffect(() => {
    const video = videoRef.current
    const faceLm = faceLandmarkerRef.current
    if (!faceModelReady || !videoReady || !faceLm || !video) return
    if (faceLoopStopRef.current) return

    faceLoopStopRef.current = startFaceLoop({
      landmarker: faceLm,
      video,
      onFace: (r) =>
        useInputStore
          .getState()
          .setFace(
            r.landmarks
              ? r.landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 }))
              : null,
            r.jawOpen,
          ),
    })
  }, [faceModelReady, videoReady])

  // --- Effect: keep the overlay canvas the same pixel size as the rendered feed
  //     box, so the dots line up with the video. ResizeObserver corrects any
  //     fractional layout the aspect-ratio CSS produces. ---
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setOverlaySize({ w: Math.round(width), h: Math.round(height) })
        }
      }
    })
    observer.observe(box)

    return () => observer.disconnect()
  }, [])

  // --- Calibration handler: run a visible countdown, then sample the live pose
  //     loop and reduce it to a Baseline. ---
  const runCalibration = useCallback(async () => {
    // Visible 3..2..1 countdown so the player has time to settle into rest pose.
    setPhase('countdown')
    for (let n = COUNTDOWN_SECONDS; n >= 1; n--) {
      setCountdown(n)
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    // Sample the live store for CAPTURE_MS, then average + reduce.
    setPhase('capturing')
    const result = await captureRestPose(() => useInputStore.getState().landmarks, CAPTURE_MS)

    if (!result.ok) {
      // No usable frames: the player was out of frame or too dim. Let them retry.
      setPhase('failed')
      return
    }

    const baseline = computeBaseline(result.pose)
    // Write to the central in-memory store FIRST so every gesture stage (04+) and
    // the drift watcher read one source of truth; last write wins, so recalibrate
    // simply replaces the previous baseline. The store is deliberately not
    // persisted, so a page reload starts null and re-shows this gate.
    setBaseline(baseline)
    onCalibrated?.(baseline)
    setDriftWarning(false) // fresh baseline: clear any stale drift hint
    setCalibrated(true)
    setPhase('idle')
  }, [onCalibrated])

  // --- Recalibrate (03.3): re-open the gate mid-session. Reuses the whole
  //     countdown -> capture flow; the camera is already running, so the gate
  //     lands straight on the Calibrate button. ---
  const handleRecalibrate = useCallback(() => {
    setDriftWarning(false)
    setPhase('idle')
    setCalibrated(false)
  }, [])

  // --- Effect: watch for body-scale drift while calibrated and gameplay is live.
  //     Polls the latest landmarks, compares the live shoulder width to the stored
  //     baseline via the pure needsRecalibration predicate, and flips driftWarning
  //     only after DRIFT_DEBOUNCE_TICKS consecutive agreeing reads so it does not
  //     flicker. Ticks with no clean body read (live width 0) are skipped. ---
  useEffect(() => {
    // Not playing yet: no interval, and the hint stays hidden (it is gated on
    // `calibrated` in the render and cleared by runCalibration/handleRecalibrate),
    // so we never call setState synchronously in the effect body.
    if (!calibrated) return
    let driftStreak = 0
    let okStreak = 0
    const id = setInterval(() => {
      const live = liveShoulderWidth(useInputStore.getState().landmarks)
      if (live <= 0) return // body not cleanly tracked this tick; don't count it
      if (needsRecalibration(getBaseline(), live)) {
        driftStreak += 1
        okStreak = 0
        if (driftStreak >= DRIFT_DEBOUNCE_TICKS) setDriftWarning(true)
      } else {
        okStreak += 1
        driftStreak = 0
        if (okStreak >= DRIFT_DEBOUNCE_TICKS) setDriftWarning(false)
      }
    }, DRIFT_POLL_MS)
    return () => clearInterval(id)
  }, [calibrated])

  // --- Effect: report calibration-active state to the host. Fires false while
  //     the gate is open (initial load and every re-open to recalibrate) and true
  //     once calibration completes, so the playground can freeze the duck during
  //     calibration and start/resume it after. onActiveChange must be stable. ---
  useEffect(() => {
    onActiveChange?.(calibrated)
  }, [calibrated, onActiveChange])

  // The friendly status text for the chip and the gate. modelError takes priority
  // because a dead model means no dots will ever appear.
  const statusLabel = modelError
    ? 'model failed'
    : status === 'idle'
      ? 'camera off'
      : status === 'requesting'
        ? 'requesting...'
        : status === 'error'
          ? 'camera error'
          : !modelReady
            ? 'loading model...'
            : 'tracking'

  // Whether the feed box should show its centered hint instead of relying on the
  // (possibly black) video. True until we are genuinely ready to track.
  const showFeedHint = !isReady || !!modelError

  return (
    // Outer wrapper. During calibration it is a full-screen centered column (the
    // gate) that stacks: header -> feed box -> controls. After calibration it is
    // `display: contents` so it generates no box and the feed box (position fixed)
    // simply docks bottom-left. The feed box stays the SAME element across both,
    // so the <video> the pose + face loops bound to is never re-mounted.
    <div style={calibrated ? { display: 'contents' } : gateWrapperStyle}>
      {/* ----- GATE HEADER (above the video; calibration only) ----- */}
      {!calibrated && (
        <div style={{ maxWidth: 'min(560px, 92vw)', textAlign: 'center', color: '#e7eef5' }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, letterSpacing: 0.2 }}>
            Calibrate
          </h2>
          {phase === 'idle' && (
            <p style={gateTextStyle}>
              Stand back so your head, shoulders and both hands are in view. Strike
              a T-pose (arms straight out to your sides at shoulder height), then
              press Calibrate and hold still.
            </p>
          )}
          {phase === 'countdown' && (
            <p style={gateTextStyle}>Hold your T-pose...</p>
          )}
          {phase === 'capturing' && (
            <p style={{ ...gateTextStyle, color: '#e7eef5', fontWeight: 600 }}>Hold still...</p>
          )}
          {phase === 'failed' && (
            <p style={{ ...gateTextStyle, color: '#f3c0c0' }}>
              We could not see you clearly. Make sure your shoulders and both hands
              are in frame and well lit, then try again.
            </p>
          )}
        </div>
      )}

      {/* ----- FEED BOX: single, always-mounted; repositioned by `calibrated`.
          Centered + large inside the gate during calibration, then docked to the
          bottom-left afterwards. SAME element in both states (stable React-tree
          position, only its CSS changes) because the pose + face loops bind to
          this one <video> once; re-mounting it would silently break tracking. */}
      <div ref={boxRef} style={calibrated ? feedBoxDockedStyle(boxWidth) : feedBoxGateStyle}>
        {/* Mirror wrapper: flips BOTH the video and the overlay together so the
            selfie view and the dots stay aligned. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            transform: 'scaleX(-1)',
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
          <DebugOverlay width={overlaySize.w} height={overlaySize.h} />
        </div>

        {/* Status chip, top-left inside the box. Sits above the mirror wrapper
            and is NOT mirrored, so the text reads normally. */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '3px 8px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: '#e7eef5',
            background: 'rgba(8, 12, 17, 0.6)',
            backdropFilter: 'blur(6px)',
            pointerEvents: 'none',
          }}
        >
          {statusLabel}
        </div>

        {/* Live calibration readout (during calibration, once the camera is live):
            the "full debug" numbers that prove tracking works and show the baseline
            being measured in real time while the player holds still. */}
        {!calibrated && isReady && <CalibrationReadout capturing={phase === 'capturing'} />}

        {/* Centered hint when we are not actually tracking yet (camera off /
            requesting / error / model failed). */}
        {showFeedHint && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              padding: 16,
              fontSize: 12,
              lineHeight: 1.4,
              color: '#aebccb',
              pointerEvents: 'none',
            }}
          >
            {modelError
              ? 'Model failed to load. Reload the page to retry.'
              : status === 'idle'
                ? 'Camera is off'
                : status === 'requesting'
                  ? 'Requesting camera...'
                  : error}
          </div>
        )}

        {/* Recalibrate control + drift hint (03.3). Sibling of the status chip
            (NOT inside the mirror wrapper) so the button and text read normally.
            Shown only once the gate is dismissed and the camera is live; clicking
            re-opens the gate for a fresh capture. */}
        {calibrated && isReady && (
          <div
            style={{
              position: 'absolute',
              left: 8,
              right: 8,
              bottom: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              pointerEvents: 'none', // wrapper is click-through; the button re-enables
            }}
          >
            {driftWarning && (
              <div
                style={{
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                  color: '#1b1206',
                  background: 'rgba(255, 196, 74, 0.92)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                }}
              >
                Body size changed - recalibrate?
              </div>
            )}
            <button
              type="button"
              onClick={handleRecalibrate}
              style={recalibrateButtonStyle(driftWarning)}
            >
              Recalibrate
            </button>
          </div>
        )}
      </div>

      {/* ----- GATE CONTROLS (below the video; calibration only) ----- */}
      {!calibrated && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            maxWidth: 'min(560px, 92vw)',
            textAlign: 'center',
          }}
        >
          {!isReady ? (
            // Camera not running yet: the user-gesture button that calls start()
            // (required for getUserMedia), plus any error / model-failure note.
            <>
              {status === 'error' && (
                <p style={{ ...gateTextStyle, margin: 0, color: '#f3c0c0' }}>{error}</p>
              )}
              {modelError && (
                <p style={{ ...gateTextStyle, margin: 0, color: '#f3c0c0' }}>
                  The pose model failed to load. Reload the page to retry.
                </p>
              )}
              <button
                type="button"
                onClick={() => void start()}
                disabled={status === 'requesting'}
                style={primaryButtonStyle(status === 'requesting')}
              >
                {status === 'error'
                  ? 'Retry'
                  : status === 'requesting'
                    ? 'Requesting...'
                    : 'Enable camera'}
              </button>
            </>
          ) : phase === 'countdown' ? (
            // The big countdown number stands in for the button while it runs.
            <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1, color: '#e7eef5' }}>
              {countdown}
            </div>
          ) : (
            // Camera ready: the Calibrate button, disabled while a capture is in
            // flight so a double click cannot start two captures.
            <button
              type="button"
              onClick={() => void runCalibration()}
              disabled={phase === 'capturing' || !modelReady}
              style={primaryButtonStyle(phase === 'capturing' || !modelReady)}
            >
              {phase === 'failed'
                ? 'Try again (hold still)'
                : phase === 'capturing'
                  ? 'Capturing...'
                  : !modelReady
                    ? 'Loading model...'
                    : 'Calibrate (hold still)'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Shared style for the gate's primary button. Disabled state dims it and removes
 * the pointer cursor so the user can tell it is inert.
 */
function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    appearance: 'none',
    border: 'none',
    borderRadius: 12,
    padding: '12px 22px',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: 0.2,
    color: '#0b1015',
    background: disabled ? '#6f8aa3' : '#7cc4ff',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.7 : 1,
    boxShadow: disabled ? 'none' : '0 6px 18px rgba(124, 196, 255, 0.35)',
    transition: 'background 120ms ease, opacity 120ms ease',
  }
}

/**
 * Small pill style for the in-feed Recalibrate button. When `highlight` (drift
 * detected) it turns amber to draw the eye; otherwise it is a quiet dark chip.
 * pointerEvents:auto re-enables clicks inside the click-through wrapper.
 */
function recalibrateButtonStyle(highlight: boolean): React.CSSProperties {
  return {
    pointerEvents: 'auto',
    appearance: 'none',
    border: 'none',
    borderRadius: 999,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.2,
    color: highlight ? '#1b1206' : '#e7eef5',
    background: highlight ? '#ffc44a' : 'rgba(8, 12, 17, 0.72)',
    backdropFilter: 'blur(6px)',
    cursor: 'pointer',
    boxShadow: highlight ? '0 2px 10px rgba(255,196,74,0.45)' : '0 2px 8px rgba(0,0,0,0.3)',
    transition: 'background 120ms ease, color 120ms ease',
  }
}

// --- Gate layout styles (calibration only) --------------------------------

// Full-screen dim column that the gate stacks header -> video -> controls into.
const gateWrapperStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: 24,
  background: 'rgba(8, 12, 17, 0.55)',
  backdropFilter: 'blur(3px)',
  overflowY: 'auto', // scroll rather than clip on short viewports
}

// The feed box while the gate is open: centered + large, in the column's flow.
const feedBoxGateStyle: React.CSSProperties = {
  position: 'relative',
  flex: '0 0 auto',
  width: 'min(560px, 92vw)',
  aspectRatio: `${PANEL_ASPECT_W} / ${PANEL_ASPECT_H}`,
  borderRadius: 16,
  overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  background: '#10161d',
}

// The feed box after calibration: docked to the bottom-left corner.
function feedBoxDockedStyle(width: number): React.CSSProperties {
  return {
    position: 'fixed',
    left: 16,
    bottom: 16,
    width,
    aspectRatio: `${PANEL_ASPECT_W} / ${PANEL_ASPECT_H}`,
    borderRadius: 16,
    overflow: 'hidden',
    boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
    background: '#10161d',
    zIndex: 40,
  }
}

// Body copy inside the gate header / controls.
const gateTextStyle: React.CSSProperties = {
  margin: '0 auto',
  fontSize: 14,
  lineHeight: 1.5,
  color: '#aebccb',
}

// The live debug readout panel overlaid on the feed during calibration.
const readoutPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  padding: '8px 10px',
  borderRadius: 10,
  background: 'rgba(8, 12, 17, 0.72)',
  backdropFilter: 'blur(6px)',
  color: '#eaf4ff',
  font: '11px/1.5 ui-monospace, monospace',
  minWidth: 132,
  pointerEvents: 'none',
}

// The tracked upper-body joints whose visibility the readout counts (mirrors the
// TRACKED set the calibration capture gate uses: shoulders, elbows, wrists, hips).
const TRACKED_FOR_READOUT = [11, 12, 13, 14, 15, 16, 23, 24]

interface ReadoutStats {
  tracked: boolean // every tracked joint is visible enough to compute a baseline
  visible: number // how many of the 8 tracked joints are currently visible
  shoulderWidth: number
  wristY: number
  tiltDeg: number
}

const EMPTY_READOUT: ReadoutStats = {
  tracked: false,
  visible: 0,
  shoulderWidth: 0,
  wristY: 0,
  tiltDeg: 0,
}

/**
 * Live "full debug" numbers overlaid on the calibration feed: how many tracked
 * joints are visible plus the three baseline measurements (shoulder width, wrist
 * height, shoulder tilt) computed from the CURRENT frame, refreshed several times
 * a second. This is the visible proof that tracking is working and the baseline
 * is being measured in real time while the player holds still. Display-only: it
 * never writes the store; runCalibration owns the actual capture.
 */
function CalibrationReadout({ capturing }: { capturing: boolean }): React.JSX.Element {
  const [stats, setStats] = useState<ReadoutStats>(EMPTY_READOUT)

  useEffect(() => {
    const id = setInterval(() => {
      const frame = useInputStore.getState().landmarks
      if (!frame) {
        setStats(EMPTY_READOUT)
        return
      }
      let visible = 0
      for (const i of TRACKED_FOR_READOUT) {
        const lm = frame[i]
        if (lm && lm.visibility >= 0.5) visible += 1
      }
      // Only compute a baseline once every tracked joint is visible; otherwise
      // show the count so the player knows to step back / reframe.
      if (!isFrameUsable(frame)) {
        setStats({ ...EMPTY_READOUT, visible })
        return
      }
      const b = computeBaseline(frame)
      setStats({
        tracked: true,
        visible,
        shoulderWidth: b.shoulderWidth,
        wristY: b.restWristY,
        tiltDeg: (b.restShoulderAngle * 180) / Math.PI,
      })
    }, 120)
    return () => clearInterval(id)
  }, [])

  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{value}</span>
    </div>
  )

  return (
    <div style={readoutPanelStyle}>
      <div
        style={{
          fontWeight: 700,
          marginBottom: 4,
          color: stats.tracked ? '#39FF14' : '#ffc44a',
        }}
      >
        {capturing ? 'capturing...' : stats.tracked ? 'tracking OK' : 'move into frame'}
      </div>
      {row('joints', `${stats.visible}/8`)}
      {row('shoulder w', stats.tracked ? stats.shoulderWidth.toFixed(3) : '-')}
      {row('wrist y', stats.tracked ? stats.wristY.toFixed(3) : '-')}
      {row('tilt', stats.tracked ? `${stats.tiltDeg.toFixed(1)} deg` : '-')}
    </div>
  )
}
