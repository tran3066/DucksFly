export type { DuckActions, DuckState, PhysicsConfig } from './types';
export { DEFAULT_CONFIG, createInitialState, neutralActions } from './config';
export { step } from './step';
export { lerp, lerpAngle, interpolatePose, type RenderPose } from './interpolate';
