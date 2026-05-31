// Tests first (plan Step 02.3). Pure logic only: we do NOT render React or touch
// a real canvas here. We test the exported project() helper that turns a
// normalized MediaPipe landmark (x, y in 0..1) into pixel coordinates for the
// overlay canvas. Each case is self-contained with literal points (no fixtures),
// so the math is verified in isolation from the drawing code.

import { describe, it, expect } from 'vitest'
import { project, resolveEdge } from './DebugOverlay'

describe('project (normalized -> pixels)', () => {
  it('scales center to canvas center', () => {
    // The middle of the normalized space maps to the middle of the canvas:
    // 0.5 * 640 = 320, 0.5 * 480 = 240. Confirms the basic multiply-by-size map.
    expect(project({ x: 0.5, y: 0.5 }, 640, 480)).toEqual({ x: 320, y: 240 })
  })

  it('maps the corners to canvas edges', () => {
    // Both extremes land exactly on the canvas edges. y grows downward in both
    // MediaPipe and canvas space, so (1, 1) is the bottom-right, not top-right.
    expect(project({ x: 0, y: 0 }, 640, 480)).toEqual({ x: 0, y: 0 })
    expect(project({ x: 1, y: 1 }, 640, 480)).toEqual({ x: 640, y: 480 })
  })

  it('uses width for x and height for y on a non-square canvas', () => {
    // Width drives x and height drives y: 1 * 1280 = 1280, 0.25 * 200 = 50. If
    // the axes were ever swapped this would come out wrong, so it guards that.
    expect(project({ x: 1, y: 0.25 }, 1280, 200)).toEqual({ x: 1280, y: 50 })
  })

  it('ADVERSARIAL: clamps out-of-range landmarks to the canvas bounds', () => {
    // MediaPipe can return values slightly outside 0..1 when a joint leaves the
    // frame. We pin those to the nearest edge instead of drawing off-canvas:
    // x = 1.2 clamps to the right edge (640), y = -0.1 clamps to the top (0).
    expect(project({ x: 1.2, y: -0.1 }, 640, 480)).toEqual({ x: 640, y: 0 })
  })
})

describe('resolveEdge (face-mesh connection -> two pixel points)', () => {
  // The face mesh ships its connections as { start, end } index pairs into a
  // landmark array. resolveEdge looks those two indices up, guards every access
  // (an endpoint can be out of range for a short or partial frame), and returns
  // the two projected pixel points only when BOTH endpoints exist. Drawing code
  // can then loop the connection set and skip whatever resolveEdge skips.
  const frame = [
    { x: 0, y: 0, z: 0, visibility: 1 }, // index 0 -> top-left
    { x: 0.5, y: 0.5, z: 0, visibility: 1 }, // index 1 -> center
    { x: 1, y: 1, z: 0, visibility: 1 }, // index 2 -> bottom-right
  ]

  it('projects both endpoints when both indices are in range', () => {
    // start=0 -> (0,0), end=2 -> (640,480) on a 640x480 canvas. Confirms both
    // ends go through project() so the line lands in pixel space.
    expect(resolveEdge(frame, { start: 0, end: 2 }, 640, 480)).toEqual([
      { x: 0, y: 0 },
      { x: 640, y: 480 },
    ])
  })

  it('ADVERSARIAL: returns null when an endpoint index is out of range', () => {
    // The mesh constants index up to 477, but a frame might be shorter (or empty)
    // on a partial detection. Index 99 does not exist here, so the edge is
    // skipped (null) instead of crashing on an undefined landmark.
    expect(resolveEdge(frame, { start: 0, end: 99 }, 640, 480)).toBeNull()
    expect(resolveEdge(frame, { start: 99, end: 1 }, 640, 480)).toBeNull()
  })
})
