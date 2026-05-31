import type { PhysicsConfig, DuckState } from './types';

// Starting feel constants. Every one of these is exposed as a live slider in the
// test sandbox so the flap-vs-gravity / dive-vs-drag balance can be tuned by feel.
// Vertical model (integrated): at flap f the terminal vertical velocity is
//   (f*climbThrust - gravity) / vertDrag.
// Defaults below give: terminal sink ~ -8 u/s (f=0), terminal climb ~ +12 u/s (f=1),
// hover at f ~ 0.4 (gravity/climbThrust) — so you spam flap to keep ~0.4 average.
export const DEFAULT_CONFIG: PhysicsConfig = {
  gravity: 12,
  climbThrust: 30,
  flapKick: 3,
  diveAccel: 40,
  diveSink: 12,
  vertDrag: 1.5,
  drag: 0.35,
  minSpeed: 2,
  maxTurnRate: 1.6,
  turnDragK: 0.25,
  maxPitch: 0.9,
  maxRoll: 0.7,
  smoothingTau: 0.12,
  groundY: 0,
  ceilingY: 200,
  fixedDt: 1 / 60,
};

export function createInitialState(): DuckState {
  return {
    position: [0, 20, 0],
    yaw: 0,
    speed: 12,
    pitch: 0,
    roll: 0,
    verticalVel: 0,
    distance: 0,
    _flap: 0,
    _lean: 0,
    _dive: 0,
  };
}

export function neutralActions(): import('./types').DuckActions {
  return {
    flap: 0,
    flapImpulse: false,
    lean: 0,
    dive: 0,
    quack: false,
    egg67: false,
    confidence: 1,
  };
}
