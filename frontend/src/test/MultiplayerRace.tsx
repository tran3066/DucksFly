import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Text } from '@react-three/drei';
import { Euler, Group, Quaternion, Vector3 } from 'three';
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
import { DuckMesh } from './DuckMesh';
import { MapView } from './MapView';
import { raceConnection, SERVER_URL } from '../net/connection';
import { useRace, isHost } from '../net/useRace';
import type { PlayerView, RaceSnapshot } from '../net/types';
import type { DuckVariant } from '@shared/network';
import { POSITION_SEND_HZ } from '@shared/constants';
import './test.css';

/**
 * MultiplayerRace — the duck-flying prototype (Person C's `PhysicsSandbox`) with the
 * multiplayer layer wired on top, per docs/ARCHITECTURE.md.
 *
 * Authority split (docs §3): each browser simulates ITS OWN duck locally (instant,
 * client-authoritative) and reports pos/vel/quat to the server ~20x/sec (docs §5).
 * The server relays everyone else's positions, scores ring passes, and rules on
 * player-vs-player collisions. Remote ducks are interpolated toward the synced state.
 *
 * Reachable at /?view=race. Open in several tabs (need 2+ to start) to see sync.
 */

const MAX_FRAME_DT = 0.1;
const FLAP_KICK = 0.5;
const FLAP_DECAY = 1.2;
// Baseline flap the duck always holds: at ~0.4 it roughly hovers (gravity/climbThrust),
// so ducks stay aloft and spamming Space adds extra climb on top.
const FLAP_BASE = 0.4;
const DIVE_RATE = 2.0;

/** Mirrors backend MIN_PLAYERS_TO_START (src/logic/stateMachine.ts). */
const MIN_PLAYERS_TO_START = 2;
/** Mirrors backend SPAWN_SPACING (src/rooms/RaceRoom.ts) so local spawn matches. */
const SPAWN_SPACING = 5;

const randomName = () => `Duck-${Math.floor(1000 + Math.random() * 9000)}`;

interface KbLevels {
  flap: number;
  lean: number;
  dive: number;
}

/** Spawn the local duck at the same slot the server assigned (spread along +X). */
function spawnState(playerIndex: number): DuckState {
  const s = createInitialState();
  s.position = [playerIndex * SPAWN_SPACING, s.position[1], s.position[2]];
  return s;
}

/** Quaternion [x,y,z,w] from the duck's visual euler (YXZ: pitch=X, yaw=Y, roll=Z). */
const _euler = new Euler();
const _quat = new Quaternion();
function poseToQuat(yaw: number, pitch: number, roll: number): [number, number, number, number] {
  _euler.set(pitch, yaw, roll, 'YXZ');
  _quat.setFromEuler(_euler);
  return [_quat.x, _quat.y, _quat.z, _quat.w];
}

/**
 * Local authoritative flight rig (adapted from PhysicsSandbox): fixed-timestep sim +
 * render interpolation + chase camera. The sim only advances while `phaseRef` is
 * "racing"; in the lobby/countdown the duck sits at its spawn so nothing drifts.
 */
function LocalDuckRig({
  stateRef,
  prevRef,
  cfgRef,
  mapRef,
  passedRef,
  ringBoostRef,
  kbRef,
  keysRef,
  phaseRef,
  reportRing,
}: {
  stateRef: React.MutableRefObject<DuckState>;
  prevRef: React.MutableRefObject<DuckState>;
  cfgRef: React.MutableRefObject<PhysicsConfig>;
  mapRef: React.MutableRefObject<MapDef>;
  passedRef: React.MutableRefObject<Set<number>>;
  ringBoostRef: React.MutableRefObject<number>;
  kbRef: React.MutableRefObject<KbLevels>;
  keysRef: React.MutableRefObject<Set<string>>;
  phaseRef: React.MutableRefObject<string>;
  reportRing: (ringId: number) => void;
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
    const racing = phaseRef.current === 'racing';

    const zBefore = stateRef.current.position[2];

    if (racing) {
      accRef.current += Math.min(delta, MAX_FRAME_DT);
      while (accRef.current >= dt) {
        const kb = kbRef.current;
        const keys = keysRef.current;
        kb.flap = Math.max(FLAP_BASE, kb.flap - FLAP_DECAY * dt);
        if (keys.has('KeyW')) kb.dive = Math.min(1, kb.dive + DIVE_RATE * dt);
        if (keys.has('KeyS')) kb.dive = Math.max(0, kb.dive - DIVE_RATE * dt);
        kb.lean = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);

        const actions: DuckActions = {
          flap: kb.flap,
          flapImpulse: false,
          lean: kb.lean,
          dive: kb.dive,
          quack: false,
          egg67: false,
          confidence: 1,
        };

        prevRef.current = stateRef.current;
        stateRef.current = step(stateRef.current, actions, cfg, dt);
        accRef.current -= dt;
      }
    } else {
      accRef.current = 0;
      prevRef.current = stateRef.current;
    }

    const curr = stateRef.current;
    const map = mapRef.current;

    if (curr.position[0] > map.halfWidth) curr.position[0] = map.halfWidth;
    else if (curr.position[0] < -map.halfWidth) curr.position[0] = -map.halfWidth;

    // Client-local ring detection (docs §3): report each new pass to the server,
    // which validates + scores it. Boost is applied locally for instant feel.
    if (racing) {
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
          reportRing(ring.id);
        }
      }
    }

    const alpha = racing ? accRef.current / dt : 0;
    const pose = interpolatePose(prevRef.current, curr, alpha);

    const duck = duckRef.current;
    if (!duck) return;
    duck.position.set(pose.position[0], pose.position[1], pose.position[2]);
    duck.rotation.order = 'YXZ';
    duck.rotation.set(pose.pitch, pose.yaw, pose.roll);

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

  return <DuckMesh ref={duckRef} />;
}

/**
 * One remote duck. Its target pos/quat come from the synced room state; each frame we
 * ease toward the latest sample (lightweight interpolation — docs glossary), so the
 * remote glides smoothly between the ~20 sparse updates per second.
 */
function RemoteDuck({ player }: { player: PlayerView }) {
  const ref = useRef<Group>(null);
  const target = useRef(player);
  target.current = player;
  const init = useRef(false);
  const targetPos = useRef(new Vector3());
  const targetQuat = useRef(new Quaternion());

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const p = target.current;
    targetPos.current.set(p.pos.x, p.pos.y, p.pos.z);
    targetQuat.current.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w);
    if (!init.current) {
      g.position.copy(targetPos.current);
      g.quaternion.copy(targetQuat.current);
      init.current = true;
    } else {
      g.position.lerp(targetPos.current, 0.2);
      g.quaternion.slerp(targetQuat.current, 0.25);
    }
  });

  const color = player.spunOut ? '#ff6b6b' : '#bfefff';
  return (
    <group ref={ref}>
      <DuckMesh />
      <Text position={[0, 3, 0]} fontSize={1.6} color={color} anchorX="center" anchorY="middle">
        {player.name}
      </Text>
    </group>
  );
}

function RemoteDucks({ players, sessionId }: { players: PlayerView[]; sessionId?: string }) {
  return (
    <>
      {players
        .filter((p) => p.id !== sessionId)
        .map((p) => (
          <RemoteDuck key={p.id} player={p} />
        ))}
    </>
  );
}

export function MultiplayerRace() {
  const race = useRace();

  const stateRef = useRef<DuckState>(spawnState(0));
  const prevRef = useRef<DuckState>(stateRef.current);
  const cfgRef = useRef<PhysicsConfig>({ ...DEFAULT_CONFIG });
  const passedRef = useRef<Set<number>>(new Set());
  const ringBoostRef = useRef(8);
  const kbRef = useRef<KbLevels>({ flap: FLAP_BASE, lean: 0, dive: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const phaseRef = useRef<string>(race.phase);
  phaseRef.current = race.phase;

  const connected = race.status === 'connected';
  const self = race.players.find((p) => p.id === race.sessionId);

  // Latest players/sessionId, read at the moment we (re)spawn. Kept in a ref so the
  // spawn-reset effect below does NOT depend on `race.players` — that array is a fresh
  // reference on every ~20Hz snapshot, and depending on it would re-run the reset (and
  // snap the duck back to spawn) every frame, leaving it shaking in place.
  const playersRef = useRef(race.players);
  playersRef.current = race.players;
  const sessionIdRef = useRef(race.sessionId);
  sessionIdRef.current = race.sessionId;

  // Build the world from the SERVER's seed so every client gets the identical course
  // (docs §6). Falls back to a fixed seed before we've connected, just for a preview.
  const map = useMemo(() => buildMap(race.mapSeed || 1337), [race.mapSeed]);
  const mapRef = useRef<MapDef>(map);
  mapRef.current = map;

  // Flight keys (active any time; the rig only consumes them while racing).
  useEffect(() => {
    const held = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
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

  // On entering "racing": reset the local sim to this player's spawn slot. Depends ONLY
  // on the phase, so it runs once per race start (not on every position snapshot).
  useEffect(() => {
    if (race.phase !== 'racing') return;
    const index = Math.max(
      0,
      playersRef.current.findIndex((p) => p.id === sessionIdRef.current),
    );
    stateRef.current = spawnState(index);
    prevRef.current = stateRef.current;
    passedRef.current = new Set();
    kbRef.current = { flap: FLAP_BASE, lean: 0, dive: 0 };
  }, [race.phase]);

  // Stream our authoritative pose to the server while racing (docs §5).
  useEffect(() => {
    if (race.phase !== 'racing') return;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      raceConnection.sendState({
        pos: [s.position[0], s.position[1], s.position[2]],
        vel: [Math.sin(s.yaw) * s.speed, s.verticalVel, Math.cos(s.yaw) * s.speed],
        quat: poseToQuat(s.yaw, s.pitch, s.roll),
      });
    }, 1000 / POSITION_SEND_HZ);
    return () => window.clearInterval(id);
  }, [race.phase]);

  // Local spin feedback when the server rules we collided (docs §3 / §5).
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    return raceConnection.onSpinOut((playerId) => {
      if (playerId !== race.sessionId) return;
      setSpinning(true);
      window.setTimeout(() => setSpinning(false), 1200);
    });
  }, [race.sessionId]);

  const reportRing = (ringId: number) => {
    // Server validates ring passes in order against its own ring count; only the
    // in-range ids it expects will be accepted (the rest are harmlessly ignored).
    if (race.ringCount > 0 && ringId >= race.ringCount) return;
    raceConnection.ringPassed(ringId, self?.lap ?? 0);
  };

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Canvas shadows camera={{ position: [0, 26, -16], fov: 60, near: 1, far: 5000 }}>
        <Sky sunPosition={[100, 40, 100]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[50, 80, 20]} intensity={1.2} castShadow />
        <MapView map={map} passedRingIds={passedRef.current} />
        <LocalDuckRig
          stateRef={stateRef}
          prevRef={prevRef}
          cfgRef={cfgRef}
          mapRef={mapRef}
          passedRef={passedRef}
          ringBoostRef={ringBoostRef}
          kbRef={kbRef}
          keysRef={keysRef}
          phaseRef={phaseRef}
          reportRing={reportRing}
        />
        <RemoteDucks players={race.players} sessionId={race.sessionId} />
      </Canvas>

      {race.phase === 'racing' && <RaceHud race={race} self={self} spinning={spinning} />}
      {race.phase === 'countdown' && <Countdown endsAt={race.countdownEndsAt} />}
      {(!connected || race.phase === 'lobby') && <Lobby race={race} self={self} />}
      {race.phase === 'finished' && <Results race={race} />}
      {race.phase === 'racing' && <ControlsLegend />}
    </div>
  );
}

/** Lobby / join overlay. Reuses the harness styles from test.css. */
function Lobby({ race, self }: { race: RaceSnapshot; self?: PlayerView }) {
  const [name, setName] = useState(randomName);
  const [variant, setVariant] = useState<DuckVariant>('male');
  const connected = race.status === 'connected';
  const canStart =
    isHost(race) && race.phase === 'lobby' && race.players.length >= MIN_PLAYERS_TO_START;

  const join = (e: FormEvent) => {
    e.preventDefault();
    void raceConnection.join({ name: name.trim() || randomName(), duckVariant: variant });
  };

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 4px' }}>🦆 DucksFly · Race</h1>
        <p className="tip" style={{ margin: '0 0 16px' }}>
          server <code>{SERVER_URL}</code> · status{' '}
          <b className={`st-${race.status}`}>{race.status}</b>
        </p>

        {!connected ? (
          <form className="join" onSubmit={join} style={{ marginTop: 0 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name" />
            <select value={variant} onChange={(e) => setVariant(e.target.value as DuckVariant)}>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
            <button type="submit" disabled={race.status === 'connecting'}>
              {race.status === 'connecting' ? 'connecting…' : 'Join race'}
            </button>
            {race.status === 'error' && <span className="err">{race.error}</span>}
            <p className="tip" style={{ width: '100%' }}>
              Open this page in several tabs to add players ({MIN_PLAYERS_TO_START}+ to start).
            </p>
          </form>
        ) : (
          <>
            <div className="actions" style={{ marginTop: 0 }}>
              <button onClick={() => raceConnection.setReady(!self?.ready)}>
                {self?.ready ? 'Unready' : 'Ready up'}
              </button>
              <button disabled={!canStart} onClick={() => raceConnection.startRace()}>
                {isHost(race) ? 'Start race' : 'Host starts'}
              </button>
              <button className="leave" onClick={() => raceConnection.leave()}>
                Leave
              </button>
            </div>
            <PlayerTable race={race} />
            <p className="tip">
              {race.players.length} player(s) · need {MIN_PLAYERS_TO_START}+ · seed{' '}
              {race.mapSeed} · {race.ringCount} rings
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function PlayerTable({ race }: { race: RaceSnapshot }) {
  return (
    <table className="players" style={{ margin: '8px 0' }}>
      <thead>
        <tr>
          <th>name</th>
          <th>duck</th>
          <th>ready</th>
          <th>rings</th>
        </tr>
      </thead>
      <tbody>
        {race.players.map((p) => (
          <tr key={p.id} className={p.id === race.sessionId ? 'me' : ''}>
            <td>
              {p.name}
              {p.id === race.sessionId ? ' (you)' : ''}
              {p.id === race.hostId ? ' 👑' : ''}
            </td>
            <td>{p.duckVariant}</td>
            <td>{p.ready ? '✓' : ''}</td>
            <td>{p.ringsPassed}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Big 3 · 2 · 1 over the live scene during the countdown phase. */
function Countdown({ endsAt }: { endsAt: number }) {
  const [secs, setSecs] = useState(() => Math.ceil((endsAt - Date.now()) / 1000));
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecs(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    }, 100);
    return () => window.clearInterval(id);
  }, [endsAt]);
  return (
    <div style={{ ...overlayStyle, pointerEvents: 'none' }}>
      <div style={{ fontSize: '8rem', fontWeight: 700, textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>
        {secs > 0 ? secs : 'GO!'}
      </div>
    </div>
  );
}

/** In-race HUD: own telemetry + a compact live leaderboard. */
function RaceHud({
  race,
  self,
  spinning,
}: {
  race: RaceSnapshot;
  self?: PlayerView;
  spinning: boolean;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 150);
    return () => clearInterval(id);
  }, []);
  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return (
    <>
      <div style={{ ...hudPanel, top: 12, left: 12, minWidth: 180 }}>
        <div style={hudRow}>
          <span style={{ opacity: 0.7 }}>rings</span>
          <span>
            {self?.ringsPassed ?? 0} / {race.ringCount}
          </span>
        </div>
        <div style={hudRow}>
          <span style={{ opacity: 0.7 }}>rank</span>
          <span>
            {self?.rank || '-'} / {race.players.length}
          </span>
        </div>
        {self?.finished && <div style={{ color: '#79e58a', marginTop: 4 }}>FINISHED 🏁</div>}
        {spinning && <div style={{ color: '#ff8a8a', marginTop: 4 }}>SPUN OUT 💫</div>}
      </div>

      <div style={{ ...hudPanel, top: 12, right: 12, minWidth: 170 }}>
        <div style={{ opacity: 0.7, marginBottom: 4 }}>leaderboard</div>
        {ranked.map((p) => (
          <div key={p.id} style={hudRow}>
            <span style={{ color: p.id === race.sessionId ? '#ffd23f' : undefined }}>
              {p.rank || '–'}. {p.name}
            </span>
            <span>{p.ringsPassed}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Final standings over the frozen scene. */
function Results({ race }: { race: RaceSnapshot }) {
  const ranked = [...race.players].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <h1 style={{ fontSize: '1.3rem', margin: '0 0 12px' }}>🏁 Final standings</h1>
        <table className="players">
          <thead>
            <tr>
              <th>#</th>
              <th>name</th>
              <th>rings</th>
              <th>fin</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className={p.id === race.sessionId ? 'me' : ''}>
                <td>{p.rank || ''}</td>
                <td>
                  {p.name}
                  {p.id === race.sessionId ? ' (you)' : ''}
                </td>
                <td>{p.ringsPassed}</td>
                <td>{p.finished ? '🏁' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button style={{ marginTop: 14 }} onClick={() => raceConnection.leave()}>
          Back to lobby
        </button>
      </div>
    </div>
  );
}

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
  return (
    <div style={{ ...hudPanel, bottom: 12, left: 12, font: '12px/1.5 ui-monospace, monospace' }}>
      <div>
        <span style={keyStyle}>Space</span>
        <span style={{ opacity: 0.7 }}>spam to flap (climb)</span>
      </div>
      <div>
        <span style={keyStyle}>W</span>/<span style={keyStyle}>S</span>
        <span style={{ opacity: 0.7 }}>dive more / less</span>
      </div>
      <div>
        <span style={keyStyle}>A</span>/<span style={keyStyle}>D</span>
        <span style={{ opacity: 0.7 }}>lean left / right</span>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(10,16,28,0.55)',
  color: '#e7ecf5',
};

const panelStyle: React.CSSProperties = {
  background: 'rgba(17,21,31,0.92)',
  border: '1px solid #2c3445',
  borderRadius: 12,
  padding: '22px 26px',
  minWidth: 420,
  maxWidth: 560,
  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
};

const hudPanel: React.CSSProperties = {
  position: 'absolute',
  padding: '12px 14px',
  borderRadius: 8,
  background: 'rgba(10,20,30,0.65)',
  color: '#dff6ff',
  font: '13px/1.5 ui-monospace, monospace',
  pointerEvents: 'none',
  backdropFilter: 'blur(4px)',
};

const hudRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
};
