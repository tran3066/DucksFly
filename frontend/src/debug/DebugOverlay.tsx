// Landmark debug overlay (plan Step 02.3).
//
// Numbers in the store are invisible: without an overlay we cannot tell good
// tracking from garbage, and every later gesture bug becomes guesswork. This
// component is our eyes on the pipeline. It draws the 33 MediaPipe pose
// landmarks the 02.2 loop writes to the shared store as bright dots, plus a
// simple skeleton (connecting lines) on a transparent <canvas> stacked over the
// webcam <video> by the parent. Tracking quality reads at a glance: faint dots
// mean low visibility (weak tracking), solid dots mean confident tracking.
//
// The only pure-logic piece (and the only thing we unit-test) is project(),
// which maps normalized 0..1 landmark coordinates to canvas pixels. Every dot
// and line goes through it, so getting that one function right makes the whole
// overlay correct.

import { useEffect, useRef } from 'react'
import { FaceLandmarker } from '@mediapipe/tasks-vision'
import { useInputStore } from '../input/store'
import type { LandmarkFrame } from '../input/fixtures/landmarks'

/** A pixel-space point on the overlay canvas. */
export interface Pt {
  x: number
  y: number
}

/**
 * Map a normalized MediaPipe landmark (x, y in 0..1) to canvas pixel coords.
 *
 * Formula: pixel.x = clamp(normalized.x * canvasWidth), and the same for y with
 * the canvas height. y grows DOWNWARD in both MediaPipe image space and canvas
 * space, so no vertical flip is needed here. We do NOT flip x either: mirroring
 * is handled once in calibration (Step 03), so the overlay shows raw landmark
 * space and what you see matches exactly what the gesture math sees.
 *
 * The clamp matters because MediaPipe can return values slightly outside 0..1
 * when a joint leaves the frame. Clamping pins those off-frame joints to the
 * nearest canvas edge instead of drawing into the void, so the overlay never
 * hides a real tracking problem behind off-canvas garbage.
 */
export function project(
  p: { x: number; y: number },
  width: number,
  height: number,
): Pt {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v))
  return {
    x: clamp(p.x * width, width),
    y: clamp(p.y * height, height),
  }
}

/**
 * Resolve one face-mesh connection (a { start, end } pair of indices into a
 * landmark frame) into the two pixel-space points its line should span, or null
 * when the edge cannot be drawn.
 *
 * The face mesh ships its connection sets (tessellation, lips, oval) as arrays
 * of { start, end } index pairs. Each endpoint is an index into the 478-point
 * face frame. We GUARD every lookup: a frame can be shorter than the highest
 * index a connection set references (a partial or just-started detection), and
 * reading an out-of-range index would hand project() an undefined landmark and
 * crash the draw pass. Returning null lets the caller simply skip that edge.
 *
 * Both endpoints go through project() so the returned points are already in
 * canvas pixels. We do NOT flip x here: the parent mirrors the whole container,
 * so the overlay stays in raw landmark space exactly like the pose drawing.
 */
export function resolveEdge(
  frame: LandmarkFrame,
  edge: { start: number; end: number },
  width: number,
  height: number,
): [Pt, Pt] | null {
  const a = frame[edge.start]
  const b = frame[edge.end]
  if (!a || !b) return null
  return [project(a, width, height), project(b, width, height)]
}

// Skeleton edges to draw, as pairs of landmark indices. A subset is fine for a
// hackathon, but we include the joints gestures actually care about: both arms
// (shoulder -> elbow -> wrist), the shoulder line, the shoulder-to-hip sides,
// and the hip line. Together these read as a recognizable upper-body skeleton.
const CONNECTIONS: Array<[number, number]> = [
  [11, 13], // left shoulder -> left elbow
  [13, 15], // left elbow -> left wrist
  [12, 14], // right shoulder -> right elbow
  [14, 16], // right elbow -> right wrist
  [11, 12], // shoulder line
  [11, 23], // left shoulder -> left hip
  [12, 24], // right shoulder -> right hip
  [23, 24], // hip line
]

// Drawing constants. The dot color is intentionally a loud, high-contrast green
// so joints pop over any video frame; the skeleton lines are a soft translucent
// white so they read as faint structure without fighting the dots for attention.
const DOT_COLOR = '#39FF14' // bright neon green
const LINE_COLOR = 'rgba(255, 255, 255, 0.6)' // soft translucent white
const LINE_WIDTH = 2
const DOT_RADIUS = 4

// Face-mesh drawing style. The face mesh is drawn as LINES ONLY (never all 478
// dots, which would be unreadable noise) in three layers, faintest first so the
// mouth ends up on top:
//   1) the full tessellation (the whole face surface) as very thin, faint lines
//      so the head reads as soft structure without fighting the pose dots;
//   2) the face oval (the outline of the head) a touch brighter so the head
//      boundary is legible;
//   3) the lips brightest and slightly thicker, because the MOUTH is what the
//      quack gesture reads, so it must stand out from everything else.
const FACE_MESH_COLOR = 'rgba(150, 200, 255, 0.22)' // very faint cool blue
const FACE_MESH_WIDTH = 0.5
const FACE_OVAL_COLOR = 'rgba(150, 200, 255, 0.5)' // same hue, a touch brighter
const FACE_OVAL_WIDTH = 1
const LIPS_COLOR = '#ff5cf0' // bright magenta so the mouth pops
const LIPS_WIDTH = 1.5

/**
 * Canvas overlay that subscribes to the shared store's landmark frame and
 * repaints dots + skeleton whenever the landmarks (or canvas size) change. The
 * canvas is absolutely positioned at the top-left with pointerEvents: none so
 * the parent can stack it directly over the <video> and clicks pass through.
 */
export function DebugOverlay({
  width,
  height,
}: {
  width: number
  height: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // The latest landmark frame from the 02.2 loop, or null when no body is
  // tracked. Reading it as a selector means this component only re-renders when
  // the frame reference changes, which is exactly when we want to repaint.
  const landmarks = useInputStore((s) => s.landmarks)

  // The latest face-mesh frame (up to 478 points) from the loop, or null when no
  // face is tracked. Read as its own selector so adding a face does not force a
  // body repaint and vice versa; the draw effect below depends on both.
  const faceLandmarks = useInputStore((s) => s.faceLandmarks)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // jsdom and some headless contexts return null for getContext; bail rather
    // than throw so the overlay never crashes the app when it cannot draw.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Always start from a blank canvas so stale dots never linger a frame.
    ctx.clearRect(0, 0, width, height)

    // ---- BODY POSE ----------------------------------------------------------
    // Draw the pose only when a body is tracked. We no longer early-return on a
    // missing body: the face mesh below can be present and worth drawing even
    // when the pose model has no body this frame (e.g. only the head is framed).
    if (landmarks) {
      // 1) Skeleton lines first, so the dots draw on top and stay crisp. We only
      //    draw an edge when BOTH of its endpoints exist in the frame.
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = LINE_WIDTH
      for (const [a, b] of CONNECTIONS) {
        const lmA = landmarks[a]
        const lmB = landmarks[b]
        if (!lmA || !lmB) continue
        const pa = project(lmA, width, height)
        const pb = project(lmB, width, height)
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.stroke()
      }

      // 2) Dots on top. Tint each dot's opacity by its visibility so weak
      //    tracking looks faint and confident tracking looks solid; that makes a
      //    bad joint obvious at a glance instead of a confident-looking lie.
      for (const lm of landmarks) {
        if (!lm) continue
        const { x, y } = project(lm, width, height)
        // visibility is 0..1; fall back to fully opaque if it is ever missing,
        // and clamp into [0, 1] so a stray value cannot push alpha out of range.
        const visibility = lm.visibility ?? 1
        ctx.globalAlpha = Math.min(1, Math.max(0, visibility))
        ctx.fillStyle = DOT_COLOR
        ctx.beginPath()
        ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }

      // Restore full opacity so we never leak a faded alpha into a later redraw.
      ctx.globalAlpha = 1
    }

    // ---- FACE MESH ----------------------------------------------------------
    // Draw the face mesh as LINES ONLY, on top of the pose, when a face frame is
    // present. Three layers, faintest first so the mouth lands on top:
    //   tessellation (whole face) -> face oval (head outline) -> lips (mouth).
    // drawEdges() walks one connection set, resolving + guarding each { start,
    // end } pair through resolveEdge(); out-of-range endpoints are skipped so a
    // partial frame can never crash the draw pass. We never draw the 478 dots.
    if (faceLandmarks) {
      const drawEdges = (
        connections: Array<{ start: number; end: number }>,
        color: string,
        lineWidth: number,
      ) => {
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth
        for (const edge of connections) {
          const pts = resolveEdge(faceLandmarks, edge, width, height)
          if (!pts) continue
          const [pa, pb] = pts
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.lineTo(pb.x, pb.y)
          ctx.stroke()
        }
      }

      drawEdges(
        FaceLandmarker.FACE_LANDMARKS_TESSELATION,
        FACE_MESH_COLOR,
        FACE_MESH_WIDTH,
      )
      drawEdges(
        FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
        FACE_OVAL_COLOR,
        FACE_OVAL_WIDTH,
      )
      drawEdges(FaceLandmarker.FACE_LANDMARKS_LIPS, LIPS_COLOR, LIPS_WIDTH)
    }
  }, [landmarks, faceLandmarks, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  )
}
