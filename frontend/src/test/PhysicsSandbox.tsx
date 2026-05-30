import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import { useControls, button, folder } from 'leva';
import { Group, Vector3 } from 'three';
import {
  DEFAULT_CONFIG,
  createInitialState,
  neutralActions,
  step,
  type DuckActions,
  type DuckState,
  type PhysicsConfig,
} from '../physics';
import { Track } from './Track';
import { DuckMesh } from './DuckMesh';

const MAX_FRAME_DT = 0.1; // clamp to avoid spiral-of-death after a stall

/** Runs the fixed-timestep physics loop and drives the duck + chase camera. */
function DuckRig({
  stateRef,
  actionsRef,
  cfgRef,
  impulseRef,
}: {
  stateRef: React.MutableRefObject<DuckState>;
  actionsRef: React.MutableRefObject<DuckActions>;
  cfgRef: React.MutableRefObject<PhysicsConfig>;
  impulseRef: React.MutableRefObject<boolean>;
}) {
  const duckRef = useRef<Group>(null);
  const accRef = useRef(0);
  const camTarget = useRef(new Vector3());
  const { camera } = useThree();

  useFrame((_, delta) => {
    const cfg = cfgRef.current;
    accRef.current += Math.min(delta, MAX_FRAME_DT);

    while (accRef.current >= cfg.fixedDt) {
      const actions: DuckActions = {
        ...actionsRef.current,
        flapImpulse: impulseRef.current,
      };
      impulseRef.current = false; // one-shot, consumed by first sub-step
      stateRef.current = step(stateRef.current, actions, cfg, cfg.fixedDt);
      accRef.current -= cfg.fixedDt;
    }

    const s = stateRef.current;
    const duck = duckRef.current;
    if (!duck) return;

    duck.position.set(s.position[0], s.position[1], s.position[2]);
    duck.rotation.order = 'YXZ';
    duck.rotation.set(s.pitch, s.yaw, s.roll);

    // Chase camera: sit behind + above the duck along its heading, ease in.
    const fwdX = Math.sin(s.yaw);
    const fwdZ = Math.cos(s.yaw);
    camTarget.current.set(
      s.position[0] - fwdX * 14,
      s.position[1] + 6,
      s.position[2] - fwdZ * 14,
    );
    camera.position.lerp(camTarget.current, 0.1);
    camera.lookAt(s.position[0], s.position[1] + 1.5, s.position[2]);
  });

  return <DuckMesh ref={duckRef} />;
}

/** Live numeric readout, polled off the render loop to avoid re-rendering it. */
function Hud({ stateRef }: { stateRef: React.MutableRefObject<DuckState> }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const s = stateRef.current;
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '12px 14px',
        borderRadius: 8,
        background: 'rgba(10,20,30,0.65)',
        color: '#dff6ff',
        font: '13px/1.5 ui-monospace, monospace',
        minWidth: 190,
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      {row('speed', `${s.speed.toFixed(1)} u/s`)}
      {row('altitude', `${s.position[1].toFixed(1)} m`)}
      {row('vert vel', `${s.verticalVel.toFixed(1)} u/s`)}
      {row('yaw', `${((s.yaw * 180) / Math.PI).toFixed(0)}°`)}
      {row('distance', `${s.distance.toFixed(0)} m`)}
    </div>
  );
}

export function PhysicsSandbox() {
  const stateRef = useRef<DuckState>(createInitialState());
  const actionsRef = useRef<DuckActions>(neutralActions());
  const cfgRef = useRef<PhysicsConfig>({ ...DEFAULT_CONFIG });
  const impulseRef = useRef(false);

  const actions = useControls('Actions', {
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
    flapImpulse: button(() => {
      impulseRef.current = true;
    }),
  });

  const cfg = useControls('Physics', {
    vertical: folder({
      gravity: { value: DEFAULT_CONFIG.gravity, min: 0, max: 40 },
      climbGain: { value: DEFAULT_CONFIG.climbGain, min: 0, max: 60 },
      flapKick: { value: DEFAULT_CONFIG.flapKick, min: 0, max: 30 },
      diveSink: { value: DEFAULT_CONFIG.diveSink, min: 0, max: 60 },
    }),
    forward: folder({
      diveAccel: { value: DEFAULT_CONFIG.diveAccel, min: 0, max: 150 },
      drag: { value: DEFAULT_CONFIG.drag, min: 0, max: 2, step: 0.01 },
      minSpeed: { value: DEFAULT_CONFIG.minSpeed, min: 0, max: 30 },
    }),
    turning: folder({
      maxTurnRate: { value: DEFAULT_CONFIG.maxTurnRate, min: 0, max: 5, step: 0.01 },
      turnDragK: { value: DEFAULT_CONFIG.turnDragK, min: 0, max: 2, step: 0.01 },
    }),
    feel: folder({
      maxPitch: { value: DEFAULT_CONFIG.maxPitch, min: 0, max: 1.57, step: 0.01 },
      maxRoll: { value: DEFAULT_CONFIG.maxRoll, min: 0, max: 1.57, step: 0.01 },
      smoothingTau: { value: DEFAULT_CONFIG.smoothingTau, min: 0, max: 0.5, step: 0.005 },
    }),
  });

  useControls({
    reset: button(() => {
      stateRef.current = createInitialState();
    }),
  });

  // Mirror reactive control values into refs the render loop reads each frame.
  actionsRef.current = {
    flap: actions.flap,
    flapImpulse: false,
    lean: actions.lean,
    dive: actions.dive,
    quack: actions.quack,
    egg67: actions.egg67,
    confidence: actions.confidence,
  };
  cfgRef.current = { ...DEFAULT_CONFIG, ...cfg };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 26, -16], fov: 60, far: 5000 }}>
        <Sky sunPosition={[100, 40, 100]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 20]} intensity={1.2} castShadow />
        <Track />
        <DuckRig
          stateRef={stateRef}
          actionsRef={actionsRef}
          cfgRef={cfgRef}
          impulseRef={impulseRef}
        />
      </Canvas>
      <Hud stateRef={stateRef} />
    </div>
  );
}
