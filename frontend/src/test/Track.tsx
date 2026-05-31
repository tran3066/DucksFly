import { Grid, Text } from '@react-three/drei';

const RUNWAY_LENGTH = 4000;
const MARKER_STEP = 50; // meters between numbered markers
const RAIL_X = 30; // half-width of the runway rails

/**
 * Visual reference ground for the physics sandbox. The infinite grid is the
 * main forward-motion cue; numbered markers + side posts give a distance gauge.
 */
export function Track() {
  const markers: number[] = [];
  for (let d = 0; d <= RUNWAY_LENGTH; d += MARKER_STEP) markers.push(d);

  return (
    <group>
      <Grid
        args={[RUNWAY_LENGTH * 2, RUNWAY_LENGTH * 2]}
        position={[0, 0.01, RUNWAY_LENGTH / 2]}
        cellSize={5}
        cellThickness={0.6}
        cellColor="#3a6e8f"
        sectionSize={25}
        sectionThickness={1.2}
        sectionColor="#5fd0ff"
        fadeDistance={400}
        fadeStrength={1.5}
        infiniteGrid
      />

      {markers.map((d) => (
        <group key={d} position={[0, 0, d]}>
          {/* center distance label, lying flat, facing up */}
          <Text
            position={[0, 0.1, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={6}
            color="#bfefff"
            anchorX="center"
            anchorY="middle"
          >
            {`${d}m`}
          </Text>
          {/* side posts for peripheral speed sensation */}
          <mesh position={[-RAIL_X, 2, 0]}>
            <boxGeometry args={[1, 4, 1]} />
            <meshStandardMaterial color={d % 100 === 0 ? '#ffcf5f' : '#2a8fbf'} />
          </mesh>
          <mesh position={[RAIL_X, 2, 0]}>
            <boxGeometry args={[1, 4, 1]} />
            <meshStandardMaterial color={d % 100 === 0 ? '#ffcf5f' : '#2a8fbf'} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
