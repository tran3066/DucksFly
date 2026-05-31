import type { DuckActions, DuckState, PhysicsConfig } from './types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Frame-rate-independent exponential smoothing toward a target.
 * tau is the time constant (s): larger = slower/smoother response.
 */
function ease(current: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  const a = 1 - Math.exp(-dt / tau);
  return current + (target - current) * a;
}

/**
 * Advance the duck one fixed timestep.
 *
 * Energy model (see prompts/person-c-physics-plan.md):
 *  - flap  -> climb only (banks altitude); never adds forward speed.
 *  - dive  -> trades altitude for forward speed; the ONLY way to accelerate.
 *  - drag  -> forward momentum always decays toward the glide floor.
 *  - lean  -> yaw turn rate (+ gentle speed bleed); roll/pitch are visual.
 *
 * Pure: returns a new state, mutates nothing. Same function runs on every client.
 */
export function step(
  state: DuckState,
  actions: DuckActions,
  cfg: PhysicsConfig,
  dt: number = cfg.fixedDt,
): DuckState {
  // Low tracking confidence fades inputs toward neutral rather than snapping.
  const conf = clamp(actions.confidence, 0, 1);
  const flapTarget = clamp(actions.flap, 0, 1) * conf;
  const leanTarget = clamp(actions.lean, -1, 1) * conf;
  const diveTarget = clamp(actions.dive, 0, 1) * conf;

  // 1. Ease raw actions toward targets (absorbs MediaPipe jitter).
  const _flap = ease(state._flap, flapTarget, cfg.smoothingTau, dt);
  const _lean = ease(state._lean, leanTarget, cfg.smoothingTau, dt);
  const _dive = ease(state._dive, diveTarget, cfg.smoothingTau, dt);

  // 2. Vertical: INTEGRATE velocity so it has inertia (no instantaneous snap).
  //    flap thrust fights gravity; vertical drag bounds it to a terminal rate and
  //    turns flap impulses into smooth arcs instead of a sawtooth.
  let verticalVel = state.verticalVel;
  verticalVel += (_flap * cfg.climbThrust - cfg.gravity) * dt;
  if (actions.flapImpulse) verticalVel += cfg.flapKick; // one-shot (binary-flap model)

  // 3. Dive: convert altitude into forward speed, plus extra downward accel.
  let speed = state.speed + _dive * cfg.diveAccel * dt;
  verticalVel -= _dive * cfg.diveSink * dt;

  // 4. Drag: forward momentum decays toward the glide floor; vertical air drag
  //    gives terminal climb/sink and smooths the vertical response.
  speed -= cfg.drag * speed * dt;
  verticalVel -= cfg.vertDrag * verticalVel * dt;

  // 5. Turn: lean<0 = left = yaw increases. Gentle speed bleed on sharp turns.
  const turnRate = -_lean * cfg.maxTurnRate;
  let yaw = state.yaw + turnRate * dt;
  speed -= Math.abs(turnRate) * cfg.turnDragK * speed * dt;

  speed = Math.max(speed, cfg.minSpeed);

  // 6. Integrate position. yaw=0 -> +Z forward.
  const fwdX = Math.sin(yaw);
  const fwdZ = Math.cos(yaw);
  let [x, y, z] = state.position;
  x += fwdX * speed * dt;
  z += fwdZ * speed * dt;
  y += verticalVel * dt;

  // Clamp altitude; kill vertical velocity at the floor/ceiling.
  if (y <= cfg.groundY) {
    y = cfg.groundY;
    if (verticalVel < 0) verticalVel = 0;
  } else if (y >= cfg.ceilingY) {
    y = cfg.ceilingY;
    if (verticalVel > 0) verticalVel = 0;
  }

  // Normalize yaw to (-PI, PI] to keep numbers tidy.
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));

  // 7. Visual angles ease toward their targets.
  const pitch = ease(state.pitch, _dive * cfg.maxPitch, cfg.smoothingTau, dt);
  const roll = ease(state.roll, _lean * cfg.maxRoll, cfg.smoothingTau, dt);

  return {
    position: [x, y, z],
    yaw,
    speed,
    pitch,
    roll,
    verticalVel,
    distance: state.distance + speed * dt,
    _flap,
    _lean,
    _dive,
  };
}
