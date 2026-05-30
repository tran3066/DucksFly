import { forwardRef } from 'react';
import { Group } from 'three';

/**
 * Placeholder duck. Faces +Z (forward at yaw=0). The parent <group> ref is
 * driven by the physics loop (position + yaw/pitch/roll).
 */
export const DuckMesh = forwardRef<Group>(function DuckMesh(_props, ref) {
  return (
    <group ref={ref}>
      {/* body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[1.4, 1, 2.2]} />
        <meshStandardMaterial color="#f4d03f" />
      </mesh>
      {/* head */}
      <mesh position={[0, 0.7, 0.9]}>
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshStandardMaterial color="#f4d03f" />
      </mesh>
      {/* beak — cone rotated to point +Z */}
      <mesh position={[0, 0.7, 1.5]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.25, 0.7, 12]} />
        <meshStandardMaterial color="#e67e22" />
      </mesh>
      {/* tail fin to read pitch/roll clearly */}
      <mesh position={[0, 0.25, -1.2]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.15, 0.9, 0.7]} />
        <meshStandardMaterial color="#d4ac0d" />
      </mesh>
    </group>
  );
});
