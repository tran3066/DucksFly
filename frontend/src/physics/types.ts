// Physics core types. Framework-free: no three.js / react imports here so the
// exact same simulation can run on any client (and the server, if needed).
//
// DuckActions matches docs/ARCHITECTURE.md §4 — produced by Person A's input code,
// consumed here by Person C's physics.

export interface DuckActions {
  /** 0..1, how hard you are flapping. Drives climb rate. */
  flap: number;
  /** true on the exact frame a new flap begins. Optional one-shot climb burst. */
  flapImpulse: boolean;
  /** -1..+1. -1 = full left, 0 = straight, +1 = full right. */
  lean: number;
  /** 0..1, how much you are diving. Trades altitude for forward speed. */
  dive: number;
  /** Mouth open. No physics effect. */
  quack: boolean;
  /** "six-seven" hand sign. No physics effect. */
  egg67: boolean;
  /** 0..1 tracking confidence. Scales eased inputs so low tracking fails gracefully. */
  confidence: number;
}

export interface DuckState {
  /** World position [x, y=altitude, z]. */
  position: [number, number, number];
  /** Heading in radians. yaw=0 faces +Z; increasing yaw turns left. */
  yaw: number;
  /** Forward scalar speed (units/s) along yaw. */
  speed: number;
  /** Visual nose angle (rad). >0 = nose down. Eased from dive. */
  pitch: number;
  /** Visual bank angle (rad). Banks toward lean (right lean = roll right). */
  roll: number;
  /** Vertical velocity (units/s). >0 climb, <0 sink. */
  verticalVel: number;
  /** Total forward distance travelled (for HUD / future checkpoints). */
  distance: number;

  // Eased/smoothed action targets (absorb input jitter). Normalized like the inputs.
  _flap: number;
  _lean: number;
  _dive: number;
}

export interface PhysicsConfig {
  /** Gravitational acceleration, always pulling down (units/s^2). */
  gravity: number;
  /** Upward thrust acceleration at flap=1 (units/s^2). Fights gravity to climb. */
  climbThrust: number;
  /** One-shot vertical velocity kick added on flapImpulse (units/s). Person A's
   * binary-flap model; the keyboard sandbox uses continuous flap instead. */
  flapKick: number;
  /** Forward acceleration at dive=1 (units/s^2). Only way to speed up. */
  diveAccel: number;
  /** Extra downward acceleration at dive=1 (units/s^2). */
  diveSink: number;
  /** Vertical air drag (per second). Bounds climb/sink to a terminal rate and
   * smooths flap impulses into arcs. */
  vertDrag: number;
  /** Linear drag coefficient on forward speed (per second). */
  drag: number;
  /** Minimum forward speed — glide floor (units/s). */
  minSpeed: number;
  /** Max yaw turn rate at |lean|=1 (rad/s). */
  maxTurnRate: number;
  /** Speed bleed from turning, scaled by |turnRate| (per second). */
  turnDragK: number;
  /** Visual nose-down angle at dive=1 (rad). */
  maxPitch: number;
  /** Visual bank angle at |lean|=1 (rad). */
  maxRoll: number;
  /** Smoothing time constant for easing actions toward targets (s). */
  smoothingTau: number;
  /** Ground altitude floor. */
  groundY: number;
  /** Ceiling altitude clamp. */
  ceilingY: number;
  /** Fixed integration timestep (s). */
  fixedDt: number;
}
