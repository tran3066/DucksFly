import { describe, it, expect } from 'vitest'
import { flightStep, createFlightState, DEFAULT_FLIGHT } from './flightModel'
import { makeIdleActions } from '../shared/types/duckActions'

// Unity-port flight model. Each test pins one invariant of the infinite-runner
// feel: always forward, heading locked, lean strafes, flap lifts, no flap sinks.
const cfg = DEFAULT_FLIGHT
const act = (over: Partial<ReturnType<typeof makeIdleActions>> = {}) => ({
  ...makeIdleActions(),
  confidence: 1,
  ...over,
})

function run(actions: ReturnType<typeof act>, steps: number) {
  let s = createFlightState()
  for (let i = 0; i < steps; i++) s = flightStep(s, actions, cfg)
  return s
}

describe('flightStep (Unity-port)', () => {
  it('always moves forward (+Z) even with no input', () => {
    const s = run(act(), 60)
    expect(s.position[2]).toBeGreaterThan(0)
    expect(s.speed).toBeGreaterThan(0)
  })

  it('flap gains forward velocity above the base cruise (nose-up power)', () => {
    const cruise = run(act(), 60).speed
    const flapping = run(act({ flap: 1 }), 60).speed
    expect(flapping).toBeGreaterThan(cruise)
  })

  it('dive gains forward velocity above the base cruise', () => {
    const cruise = run(act(), 60).speed
    const diving = run(act({ dive: 1 }), 60).speed
    expect(diving).toBeGreaterThan(cruise)
  })

  it('flap leans the body strongly nose-UP (looks like flying up)', () => {
    const s = run(act({ flap: 1 }), 30)
    expect(s.pitch).toBeLessThan(-0.25) // clearly nose-up, not a faint tilt
  })

  it('dive leans the body strongly nose-DOWN (pitch > 0), toward the ground', () => {
    const s = run(act({ dive: 1 }), 30)
    expect(s.pitch).toBeGreaterThan(0.1) // clearly toward the ground, not just slight
  })

  it('no flap -> descends gently (loses altitude)', () => {
    const start = createFlightState().position[1]
    const s = run(act({ flap: 0 }), 60)
    expect(s.position[1]).toBeLessThan(start)
  })

  it('full flap -> climbs FAST (clear altitude gain in ~1s)', () => {
    const start = createFlightState().position[1]
    const flapping = run(act({ flap: 1 }), 60).position[1]
    // Should noticeably rise within a second, not just inch up.
    expect(flapping - start).toBeGreaterThan(6)
  })

  // Lean right (+1) must move the duck to SCREEN right. The camera looks down +Z,
  // so screen-right is world -X; screen-left is world +X.
  it('lean right (+1) -> world -X (screen right); left (-1) -> world +X', () => {
    const right = run(act({ lean: 1 }), 60).position[0]
    const left = run(act({ lean: -1 }), 60).position[0]
    expect(right).toBeLessThan(-0.5)
    expect(left).toBeGreaterThan(0.5)
  })

  // ADVERSARIAL: heading must stay locked at 0 no matter how hard you lean, so
  // the rigid world-axis camera never sees the duck spin.
  it('yaw stays locked at 0 regardless of lean', () => {
    expect(run(act({ lean: 1 }), 120).yaw).toBe(0)
    expect(run(act({ lean: -1 }), 120).yaw).toBe(0)
  })

  it('never sinks below the floor (minAltitude)', () => {
    const s = run(act({ flap: 0, dive: 1 }), 600) // dive hard for 10s
    expect(s.position[1]).toBeGreaterThanOrEqual(cfg.minAltitude - 1e-6)
  })

  it('never climbs above the ceiling (maxAltitude)', () => {
    const s = run(act({ flap: 1 }), 1200) // flap hard for 20s
    expect(s.position[1]).toBeLessThanOrEqual(cfg.maxAltitude + 1e-6)
  })

  it('does not drift past the lateral range (either direction)', () => {
    const s = run(act({ lean: 1 }), 1200)
    expect(Math.abs(s.position[0])).toBeLessThanOrEqual(cfg.lateralRange + 1e-6)
  })
})
