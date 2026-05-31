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
import { useInputStore } from '../input/store'

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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // jsdom and some headless contexts return null for getContext; bail rather
    // than throw so the overlay never crashes the app when it cannot draw.
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Always start from a blank canvas so stale dots never linger a frame.
    ctx.clearRect(0, 0, width, height)

    // No body tracked: leave the overlay blank (we already cleared above).
    if (!landmarks) return

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

    // 2) Dots on top. Tint each dot's opacity by its visibility so weak tracking
    //    looks faint and confident tracking looks solid; that makes a bad joint
    //    obvious at a glance instead of a confident-looking lie.
    for (const lm of landmarks) {
      if (!lm) continue
      const { x, y } = project(lm, width, height)
      // visibility is 0..1; fall back to fully opaque if it is ever missing, and
      // clamp into [0, 1] so a stray value cannot push alpha out of range.
      const visibility = lm.visibility ?? 1
      ctx.globalAlpha = Math.min(1, Math.max(0, visibility))
      ctx.fillStyle = DOT_COLOR
      ctx.beginPath()
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    }

    // Restore full opacity so we never leak a faded alpha into a later redraw.
    ctx.globalAlpha = 1
  }, [landmarks, width, height])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  )
}
