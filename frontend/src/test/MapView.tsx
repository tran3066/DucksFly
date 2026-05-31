import { Suspense, useRef } from 'react';
import { Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { DoubleSide, Mesh, MeshStandardMaterial } from 'three';
import type { MapDef, RingDef } from '../map';
import { Scenery } from '../world/Scenery';
import { GroundPlane } from '../world/GroundPlane';
import { Mountains } from '../world/Mountains';

/**
 * Placeholder environment renderer for the generation test run. Deliberately
 * simple (single-color floor, translucent boundary walls, basic torus rings) so
 * it never collides with Person B's real asset work — swap in real meshes later.
 *
 * `passedRingIds` recolors rings the duck has flown through (green). The optional
 * `ringPulseAt` maps a ring id -> the wall-clock ms (`performance.now()`) it was
 * passed, driving a short scale + emissive pop on that frame (request #4).
 */
export function MapView({
  map,
  passedRingIds,
  ringPulseAt,
}: {
  map: MapDef;
  passedRingIds: Set<number>;
  ringPulseAt?: Map<number, number>;
}) {
  const midZ = map.length / 2;

  // Extend the ground out past the furthest scenery AND the flanking mountain
  // range so both have something to stand on (no void between corridor + peaks).
  const sceneryReach = map.scenery.reduce((m, s) => Math.max(m, Math.abs(s.pos[0])), map.halfWidth);
  const groundHalfX = Math.max(sceneryReach, map.halfWidth + 520) + 20;

  return (
    <group>
      {/* Ground plane (tiling grass texture), widened to cover the scenery bands. */}
      <GroundPlane width={groundHalfX * 2} length={map.length} y={map.floorY} midZ={midZ} />

      {/* Mountain range lining both sides as a natural barrier (replaces the old
          translucent walls). The duck is still clamped to ±halfWidth by physics. */}
      <Suspense fallback={null}>
        <Mountains map={map} />
      </Suspense>

      {/* Start + finish + intermediate checkpoint lines, raised well clear of the
          floor (no near-coplanar z-fight) and rendered as solid stripes. */}
      {map.checkpoints.map((cp) => (
        <group key={cp.id} position={[0, 0, cp.z]}>
          <mesh position={[0, 1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[map.halfWidth * 2, 5]} />
            <meshStandardMaterial color={cp.isFinish ? '#ffd24a' : '#eef6ff'} side={DoubleSide} />
          </mesh>
          <Text
            position={[0, 6, 0]}
            fontSize={6}
            color={cp.isFinish ? '#ffd24a' : '#bfefff'}
            anchorX="center"
            anchorY="middle"
          >
            {cp.isFinish ? 'FINISH' : cp.z === 0 ? 'START' : `CP ${cp.id}`}
          </Text>
        </group>
      ))}

      {map.rings.map((ring) => (
        <Ring
          key={ring.id}
          ring={ring}
          passed={passedRingIds.has(ring.id)}
          pulseAt={ringPulseAt?.get(ring.id)}
        />
      ))}

      {/* Real seed-generated nature-pack scenery, instanced for performance. */}
      <Suspense fallback={null}>
        <Scenery map={map} />
      </Suspense>
    </group>
  );
}

/** Thick tube so the rim is a real, crashable obstacle around the fly-through hole. */
const RING_TUBE = 1.5;

// Fly-through feedback: a quick pop that decays to nothing over PULSE_DURATION.
const PULSE_DURATION = 0.45; // seconds
const PULSE_SCALE = 0.55; // extra scale at the peak of the pop
const PULSE_EMISSIVE = 2.6; // extra emissive intensity at the peak

function Ring({
  ring,
  passed,
  pulseAt,
}: {
  ring: RingDef;
  passed: boolean;
  pulseAt?: number;
}) {
  const meshRef = useRef<Mesh>(null);
  const matRef = useRef<MeshStandardMaterial>(null);

  // Animate the pass pop every frame (no React re-render). Both this and the
  // playground sim stamp pulseAt with the same wall clock (performance.now), so
  // the elapsed time is consistent. When idle (no/old pulse) it settles back to
  // the static scale + base emissive, matching the React-driven color.
  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;
    let pop = 0;
    if (pulseAt != null) {
      const t = (performance.now() - pulseAt) / 1000;
      if (t >= 0 && t < PULSE_DURATION) {
        const k = 1 - t / PULSE_DURATION; // 1 at the pass, 0 at the end
        pop = k * k; // ease-out so it snaps then softens
      }
    }
    mesh.scale.setScalar(1 + PULSE_SCALE * pop);
    mat.emissiveIntensity = 0.4 + PULSE_EMISSIVE * pop;
  });

  return (
    // Default torus lies in the XY plane (hole axis = Z), i.e. a vertical gate the
    // duck flies through travelling along +Z. No rotation needed.
    <mesh ref={meshRef} position={ring.pos}>
      <torusGeometry args={[ring.radius, RING_TUBE, 16, 40]} />
      <meshStandardMaterial
        ref={matRef}
        color={passed ? '#4ade80' : '#ff8c42'}
        emissive={passed ? '#22c55e' : '#7a3a12'}
        emissiveIntensity={0.4}
      />
    </mesh>
  );
}
