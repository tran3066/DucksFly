import { Suspense } from 'react';
import { Text } from '@react-three/drei';
import { DoubleSide } from 'three';
import type { MapDef, RingDef } from '../map';
import { Scenery } from '../world/Scenery';

/**
 * Placeholder environment renderer for the generation test run. Deliberately
 * simple (single-color floor, translucent boundary walls, basic torus rings) so
 * it never collides with Person B's real asset work — swap in real meshes later.
 */
export function MapView({
  map,
  passedRingIds,
}: {
  map: MapDef;
  passedRingIds: Set<number>;
}) {
  const midZ = map.length / 2;

  // Extend the ground out past the furthest scenery so the flanking forest has
  // something to stand on (scenery is placed in bands beyond the corridor walls).
  const groundHalfX =
    map.scenery.reduce((m, s) => Math.max(m, Math.abs(s.pos[0])), map.halfWidth) + 20;

  return (
    <group>
      {/* Ground plane, widened to cover the scenery bands either side. */}
      <mesh position={[0, map.floorY, midZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[groundHalfX * 2, map.length]} />
        <meshStandardMaterial color="#2f5d3a" />
      </mesh>

      {/* Lateral bounce walls at x = +/- halfWidth. Translucent (with depthWrite
          off to avoid alpha-sort flicker) so the flanking forest reads through
          them — a soft boundary tint rather than a brick wall (see plan doc). */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (map.halfWidth + 0.5), map.ceiling / 2, midZ]}>
          <boxGeometry args={[1, map.ceiling, map.length]} />
          <meshStandardMaterial color="#8fb8cc" transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ))}

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
        <Ring key={ring.id} ring={ring} passed={passedRingIds.has(ring.id)} />
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

function Ring({ ring, passed }: { ring: RingDef; passed: boolean }) {
  return (
    // Default torus lies in the XY plane (hole axis = Z), i.e. a vertical gate the
    // duck flies through travelling along +Z. No rotation needed.
    <mesh position={ring.pos}>
      <torusGeometry args={[ring.radius, RING_TUBE, 16, 40]} />
      <meshStandardMaterial
        color={passed ? '#4ade80' : '#ff8c42'}
        emissive={passed ? '#166534' : '#7a3a12'}
        emissiveIntensity={0.4}
      />
    </mesh>
  );
}
