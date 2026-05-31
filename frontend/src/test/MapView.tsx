import { Instance, Instances, Text } from '@react-three/drei';
import { DoubleSide } from 'three';
import type { MapDef, RingDef, TreeDef } from '../map';

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

  return (
    <group>
      {/* Single-color floor spanning the whole corridor. */}
      <mesh position={[0, map.floorY, midZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[map.halfWidth * 2, map.length]} />
        <meshStandardMaterial color="#2f5d3a" />
      </mesh>

      {/* Opaque lateral bounce walls (thin tall slabs) at x = +/- halfWidth.
          Opaque = no alpha-sort flicker as the camera climbs/dives. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (map.halfWidth + 0.5), map.ceiling / 2, midZ]}>
          <boxGeometry args={[1, map.ceiling, map.length]} />
          <meshStandardMaterial color="#8fb8cc" />
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

      <Trees trees={map.trees} />
    </group>
  );
}

/**
 * Low-poly conifer scenery: a tapered brown trunk + a green cone crown. Rendered
 * with instancing (one draw call per part) so hundreds of trees stay cheap.
 * Heights/radii come per-tree from the seed, so each side reads as varied forest.
 */
function Trees({ trees }: { trees: TreeDef[] }) {
  return (
    <group>
      <Instances limit={trees.length} castShadow>
        <cylinderGeometry args={[0.35, 0.6, 1, 6]} />
        <meshStandardMaterial color="#6b4a2b" />
        {trees.map((t) => {
          const trunkH = t.height * 0.4;
          return (
            <Instance
              key={t.id}
              position={[t.pos[0], trunkH / 2, t.pos[2]]}
              scale={[1, trunkH, 1]}
            />
          );
        })}
      </Instances>

      <Instances limit={trees.length} castShadow>
        <coneGeometry args={[1, 1, 7]} />
        <meshStandardMaterial color="#2e7d32" />
        {trees.map((t) => {
          const trunkH = t.height * 0.4;
          const crownH = t.height * 0.6;
          return (
            <Instance
              key={t.id}
              position={[t.pos[0], trunkH + crownH / 2, t.pos[2]]}
              scale={[t.radius, crownH, t.radius]}
            />
          );
        })}
      </Instances>
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
