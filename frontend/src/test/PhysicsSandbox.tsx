import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useControls, button, folder } from 'leva';
import { Group, Vector3 } from 'three';
import {
  DEFAULT_CONFIG,
  createInitialState,
  step,
  interpolatePose,
  type DuckActions,
  type DuckState,
  type PhysicsConfig,
} from '../physics';
import { buildMap, ringCrossing, DEFAULT_MAP_CONFIG, type MapDef } from '../map';
import { DuckModel } from './DuckModel';
import { MapView } from './MapView';
import { SKY_HORIZON } from '../theme/palette';
import { SimpleSky } from '../world/SimpleSky';
import { WorldLighting } from '../world/WorldLighting';

const MAX_FRAME_DT = 0.1; // clamp to avoid spiral-of-death after a stall

// Flap: each spacebar tap bumps the flap level by FLAP_KICK; it decays at
// FLAP_DECAY/s, so you must keep spamming Space to stay aloft. (Single lift
// source — we do NOT also fire flapImpulse, to avoid double-driving climb.)
const FLAP_KICK = 0.5;
const FLAP_DECAY = 1.2;
// Dive is a held throttle ramped by W/S (per second).
const DIVE_RATE = 2.0;

/** Keyboard-driven motion intent, integrated inside the fixed sim step. */
interface KbLevels {
  flap: number;
  lean: number;
  dive: number;
}

/** Non-motion inputs sourced from the leva panel (set rarely). */
interface MetaActions {
  confidence: number;
  quack: boolean;
  egg67: boolean;
}

/**
 * Fixed-timestep sim loop with render interpolation. The duck + camera are drawn
 * from the blend of the previous and current sim states (alpha = acc/dt), so
 * motion is smooth and frame-rate independent. Keyboard intent is integrated
 * INSIDE the fixed step so input is deterministic and in-phase with physics.
 */
function DuckRig({
  stateRef,
  prevRef,
  cfgRef,
  mapRef,
  passedRef,
  ringBoostRef,
  kbRef,
  keysRef,
  metaRef,
}: {
  stateRef: React.MutableRefObject<DuckState>;
  prevRef: React.MutableRefObject<DuckState>;
  cfgRef: React.MutableRefObject<PhysicsConfig>;
  mapRef: React.MutableRefObject<MapDef>;
  passedRef: React.MutableRefObject<Set<number>>;
  ringBoostRef: React.MutableRefObject<number>;
  kbRef: React.MutableRefObject<KbLevels>;
  keysRef: React.MutableRefObject<Set<string>>;
  metaRef: React.MutableRefObject<MetaActions>;
}) {
  const duckRef = useRef<Group>(null);
  const accRef = useRef(0);
  const camPos = useRef(new Vector3());
  const lookTarget = useRef(new Vector3());
  const lookCurrent = useRef(new Vector3());
  const camInit = useRef(false);
  const { camera } = useThree();

  useFrame((_, delta) => {
    const cfg = cfgRef.current;
    const dt = cfg.fixedDt;
    accRef.current += Math.min(delta, MAX_FRAME_DT);

    const zBefore = stateRef.current.position[2];

    while (accRef.current >= dt) {
      // Integrate keyboard intent deterministically, in lockstep with the sim.
      const kb = kbRef.current;
      const keys = keysRef.current;
      kb.flap = Math.max(0, kb.flap - FLAP_DECAY * dt); // decay -> must spam Space
      if (keys.has('KeyW')) kb.dive = Math.min(1, kb.dive + DIVE_RATE * dt);
      if (keys.has('KeyS')) kb.dive = Math.max(0, kb.dive - DIVE_RATE * dt);
      kb.lean = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

      const meta = metaRef.current;
      const actions: DuckActions = {
        flap: kb.flap,
        flapImpulse: false,
        lean: kb.lean,
        dive: kb.dive,
        quack: meta.quack,
        egg67: meta.egg67,
        confidence: meta.confidence,
      };

      prevRef.current = stateRef.current;
      stateRef.current = step(stateRef.current, actions, cfg, dt);
      accRef.current -= dt;
    }

    const curr = stateRef.current;
    const map = mapRef.current;

    // Lateral bounce walls: clamp the duck inside the corridor (placeholder for a
    // real velocity reflect — fine for the test run).
    if (curr.position[0] > map.halfWidth) curr.position[0] = map.halfWidth;
    else if (curr.position[0] < -map.halfWidth) curr.position[0] = -map.halfWidth;

    // Ring boost: detect flying through any not-yet-passed ring this frame (uses
    // authoritative sim state, not the interpolated render pose).
    for (const ring of map.rings) {
      if (passedRef.current.has(ring.id)) continue;
      const res = ringCrossing(
        zBefore,
        curr.position[2],
        curr.position[0],
        curr.position[1],
        ring,
        DEFAULT_MAP_CONFIG.duckRadius,
      );
      if (res === 'pass') {
        passedRef.current.add(ring.id);
        curr.speed += ringBoostRef.current;
      }
    }

    // Render pose = interpolation between prev and current sim states.
    const alpha = accRef.current / dt;
    const pose = interpolatePose(prevRef.current, curr, alpha);

    const duck = duckRef.current;
    if (!duck) return;
    duck.position.set(pose.position[0], pose.position[1], pose.position[2]);
    duck.rotation.order = 'YXZ';
    duck.rotation.set(pose.pitch, pose.yaw, pose.roll);

    // Chase camera: behind + above along heading. Both position and look-target
    // are eased (damped) so the bobbing altitude never snaps the view.
    const fwdX = Math.sin(pose.yaw);
    const fwdZ = Math.cos(pose.yaw);
    camPos.current.set(
      pose.position[0] - fwdX * 14,
      pose.position[1] + 6,
      pose.position[2] - fwdZ * 14,
    );
    lookTarget.current.set(pose.position[0], pose.position[1] + 1.5, pose.position[2]);
    if (!camInit.current) {
      camera.position.copy(camPos.current);
      lookCurrent.current.copy(lookTarget.current);
      camInit.current = true;
    }
    camera.position.lerp(camPos.current, 0.12);
    lookCurrent.current.lerp(lookTarget.current, 0.15);
    camera.lookAt(lookCurrent.current);
  });

  return <DuckModel ref={duckRef} />;
}

/** Live numeric readout, polled off the render loop to avoid re-rendering it. */
function Hud({
  stateRef,
  mapRef,
  passedRef,
}: {
  stateRef: React.MutableRefObject<DuckState>;
  mapRef: React.MutableRefObject<MapDef>;
  passedRef: React.MutableRefObject<Set<number>>;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);
  const s = stateRef.current;
  const map = mapRef.current;
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
      {row('flap', s._flap.toFixed(2))}
      {row('dive', s._dive.toFixed(2))}
      {row('rings', `${passedRef.current.size} / ${map.rings.length}`)}
      {row('progress', `${Math.min(100, (s.position[2] / map.length) * 100).toFixed(0)}%`)}
    </div>
  );
}

export function PhysicsSandbox() {
  const stateRef = useRef<DuckState>(createInitialState());
  const prevRef = useRef<DuckState>(stateRef.current);
  const cfgRef = useRef<PhysicsConfig>({ ...DEFAULT_CONFIG });
  const passedRef = useRef<Set<number>>(new Set());
  const ringBoostRef = useRef(8);
  const kbRef = useRef<KbLevels>({ flap: 0, lean: 0, dive: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const metaRef = useRef<MetaActions>({ confidence: 1, quack: false, egg67: false });

  // Flight controls. W/S/A/D are held (tracked in keysRef); Space is a discrete
  // flap tap — auto-repeat is ignored so you must actually spam it.
  useEffect(() => {
    const held = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault(); // stop page scroll
        if (e.repeat) return; // ignore key-repeat: one tap = one flap
        kbRef.current.flap = Math.min(1, kbRef.current.flap + FLAP_KICK);
        return;
      }
      if (held.includes(e.code)) {
        e.preventDefault();
        keysRef.current.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.code);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const world = useControls('World', {
    seed: { value: 1337, min: 0, max: 99999, step: 1 },
    ringBoost: { value: 8, min: 0, max: 30, step: 0.5 },
  });

  // Rebuild the world whenever the seed changes; reset the run so it's testable.
  const map = useMemo(() => buildMap(world.seed), [world.seed]);
  const mapRef = useRef<MapDef>(map);
  mapRef.current = map;
  ringBoostRef.current = world.ringBoost;
  useEffect(() => {
    stateRef.current = createInitialState();
    prevRef.current = stateRef.current;
    passedRef.current = new Set();
    kbRef.current = { flap: 0, lean: 0, dive: 0 };
  }, [world.seed]);

  const cfg = useControls('Physics', {
    vertical: folder({
      gravity: { value: DEFAULT_CONFIG.gravity, min: 0, max: 40 },
      climbThrust: { value: DEFAULT_CONFIG.climbThrust, min: 0, max: 100 },
      vertDrag: { value: DEFAULT_CONFIG.vertDrag, min: 0, max: 5, step: 0.05 },
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
      prevRef.current = stateRef.current;
      passedRef.current = new Set();
      kbRef.current = { flap: 0, lean: 0, dive: 0 };
    }),
  });

  cfgRef.current = { ...DEFAULT_CONFIG, ...cfg };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 26, -16], fov: 60, near: 1, far: 5000 }}>
        <color attach="background" args={[SKY_HORIZON]} />
        <Suspense fallback={null}>
          <SimpleSky map={map} />
        </Suspense>
        <WorldLighting preset="day" followRef={stateRef} sunDistance={180} shadowExtent={160} />
        <MapView map={map} passedRingIds={passedRef.current} />
        <DuckRig
          stateRef={stateRef}
          prevRef={prevRef}
          cfgRef={cfgRef}
          mapRef={mapRef}
          passedRef={passedRef}
          ringBoostRef={ringBoostRef}
          kbRef={kbRef}
          keysRef={keysRef}
          metaRef={metaRef}
        />
      </Canvas>
      <ActionPanel kbRef={kbRef} metaRef={metaRef} />
      <Hud stateRef={stateRef} mapRef={mapRef} passedRef={passedRef} />
      <ControlsLegend />
    </div>
  );
}

/**
 * Owns the leva "Actions" panel in isolation (its updates never touch the
 * Canvas). It pushes the non-motion inputs into metaRef for the sim, and mirrors
 * the keyboard-driven flap/lean/dive levels back onto the sliders for display.
 */
function ActionPanel({
  kbRef,
  metaRef,
}: {
  kbRef: React.MutableRefObject<KbLevels>;
  metaRef: React.MutableRefObject<MetaActions>;
}) {
  const [vals, set] = useControls('Actions', () => ({
    flap: { value: 0, min: 0, max: 1, step: 0.01 },
    lean: { value: 0, min: -1, max: 1, step: 0.01 },
    dive: { value: 0, min: 0, max: 1, step: 0.01 },
    confidence: { value: 1, min: 0, max: 1, step: 0.01 },
    quack: false,
    egg67: false,
  }));
  metaRef.current = { confidence: vals.confidence, quack: vals.quack, egg67: vals.egg67 };

  // Mirror the keyboard throttle onto the sliders at ~20 Hz (display only).
  useEffect(() => {
    const id = setInterval(() => {
      const kb = kbRef.current;
      set({
        flap: Math.round(kb.flap * 100) / 100,
        lean: Math.round(kb.lean * 100) / 100,
        dive: Math.round(kb.dive * 100) / 100,
      });
    }, 50);
    return () => clearInterval(id);
  }, [kbRef, set]);

  return null;
}

/** Static on-screen reminder of the flight keys. */
function ControlsLegend() {
  const keyStyle: React.CSSProperties = {
    display: 'inline-block',
    minWidth: 18,
    padding: '1px 6px',
    margin: '0 4px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.3)',
    textAlign: 'center',
  };
  const row = (keys: React.ReactNode, label: string) => (
    <div style={{ marginBottom: 2 }}>
      {keys}
      <span style={{ opacity: 0.7 }}>{label}</span>
    </div>
  );
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        padding: '10px 12px',
        borderRadius: 8,
        background: 'rgba(10,20,30,0.65)',
        color: '#dff6ff',
        font: '12px/1.5 ui-monospace, monospace',
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      {row(<span style={keyStyle}>Space</span>, 'spam to flap (climb)')}
      {row(<><span style={keyStyle}>W</span>/<span style={keyStyle}>S</span></>, 'dive more / less')}
      {row(<><span style={keyStyle}>A</span>/<span style={keyStyle}>D</span></>, 'lean left / right')}
    </div>
  );
}
