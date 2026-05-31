// Light, clean debug arena for the Person A playground.
//
// Per playtest direction: LIGHT theme, PLAIN flat ground (no grid lines), two
// PLAIN solid side walls (left + right) only, NO roof. Both axes feel infinite by
// recycling a fixed set of marks relative to the duck:
//   - forward distance marks recycle on the duck's Z (floor stripes + labels)
//   - altitude marks recycle on the duck's Y (wall stripes + labels on both walls)
// The walls are very tall and anchored at the ground, so they read as going up
// into the sky forever while the altitude numbers keep climbing.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import { Group } from 'three'
import type { DuckState } from '../physics'

const GROUND = '#d7dee6'
const WALL = '#c6d0da'
const FLOOR_MARK = '#aab6c2'
const WALL_MARK = '#9fb0c0'
const RAIL = '#5b7a99'
const LABEL = '#3b5168'

const MARK_STEP = 100 // metres between forward distance marks
const VIEW_AHEAD = 1400
const VIEW_BEHIND = 200
const VIEW_LEN = VIEW_AHEAD + VIEW_BEHIND
const MID_Z = (VIEW_AHEAD - VIEW_BEHIND) / 2
const DIST_COUNT = Math.ceil(VIEW_LEN / MARK_STEP) + 1

const WALL_HEIGHT = 12000 // tall: reads as "up into the sky" (one quad, cheap)
const ALT_STEP = 25 // metres between altitude marks on the walls
const ALT_ABOVE = 300 // altitude window kept above the duck
const ALT_BELOW = 100 // and below
const ALT_COUNT = Math.ceil((ALT_ABOVE + ALT_BELOW) / ALT_STEP) + 1

type TextRef = React.ComponentRef<typeof Text>

export function DebugArena({
  halfWidth,
  stateRef,
}: {
  /** Lateral range from the flight model: walls sit here. */
  halfWidth: number
  stateRef: React.RefObject<DuckState>
}) {
  const groundRef = useRef<Group>(null)
  const railRef = useRef<Group>(null)
  const distRefs = useRef<(Group | null)[]>([])
  const distLabelRefs = useRef<(TextRef | null)[]>([])
  const altGroupRef = useRef<Group>(null)
  const altRefs = useRef<(Group | null)[]>([])
  const altLeftLabelRefs = useRef<(TextRef | null)[]>([])
  const altRightLabelRefs = useRef<(TextRef | null)[]>([])

  const distIndices = useMemo(() => Array.from({ length: DIST_COUNT }, (_, i) => i), [])
  const altIndices = useMemo(() => Array.from({ length: ALT_COUNT }, (_, i) => i), [])
  const groundWidth = halfWidth * 2 + 600
  const inset = 0.5

  useFrame(() => {
    const z = stateRef.current.position[2]
    const y = stateRef.current.position[1]

    if (groundRef.current) groundRef.current.position.z = z
    if (railRef.current) railRef.current.position.z = z
    if (altGroupRef.current) altGroupRef.current.position.z = z

    // Forward distance marks recycle on Z.
    const firstD = Math.floor((z - VIEW_BEHIND) / MARK_STEP) * MARK_STEP
    for (let i = 0; i < DIST_COUNT; i++) {
      const d = firstD + i * MARK_STEP
      const g = distRefs.current[i]
      if (g) g.position.z = d
      const label = distLabelRefs.current[i]
      if (label) label.text = d >= 0 ? `${d}m` : ''
    }

    // Altitude marks recycle on Y (on both walls).
    const firstA = Math.floor((y - ALT_BELOW) / ALT_STEP) * ALT_STEP
    for (let i = 0; i < ALT_COUNT; i++) {
      const a = firstA + i * ALT_STEP
      const g = altRefs.current[i]
      if (g) g.position.y = a
      const t = a >= 0 ? `${a}m` : ''
      const lL = altLeftLabelRefs.current[i]
      const lR = altRightLabelRefs.current[i]
      if (lL) lL.text = t
      if (lR) lR.text = t
    }
  })

  return (
    <group>
      {/* Plain flat ground that follows the duck (no grid lines). */}
      <group ref={groundRef}>
        <mesh position={[0, 0, MID_Z]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[groundWidth, VIEW_LEN]} />
          <meshStandardMaterial color={GROUND} roughness={1} metalness={0} />
        </mesh>
      </group>

      {/* Two plain solid side walls + base rails (no roof). Follow the duck in Z. */}
      <group ref={railRef}>
        <mesh position={[-halfWidth, WALL_HEIGHT / 2, MID_Z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[VIEW_LEN, WALL_HEIGHT]} />
          <meshStandardMaterial color={WALL} roughness={1} metalness={0} />
        </mesh>
        <mesh position={[halfWidth, WALL_HEIGHT / 2, MID_Z]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[VIEW_LEN, WALL_HEIGHT]} />
          <meshStandardMaterial color={WALL} roughness={1} metalness={0} />
        </mesh>
        <mesh position={[-halfWidth, 0.1, MID_Z]}>
          <boxGeometry args={[0.4, 0.4, VIEW_LEN]} />
          <meshBasicMaterial color={RAIL} />
        </mesh>
        <mesh position={[halfWidth, 0.1, MID_Z]}>
          <boxGeometry args={[0.4, 0.4, VIEW_LEN]} />
          <meshBasicMaterial color={RAIL} />
        </mesh>
      </group>

      {/* Forward distance marks: floor stripe + flat floor label every 100m. */}
      {distIndices.map((i) => (
        <group key={i} ref={(g) => (distRefs.current[i] = g)}>
          <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[halfWidth * 2, 0.6]} />
            <meshBasicMaterial color={FLOOR_MARK} />
          </mesh>
          <Text
            ref={(t) => (distLabelRefs.current[i] = t)}
            position={[0, 0.05, 0]}
            rotation={[-Math.PI / 2, 0, Math.PI]}
            fontSize={5}
            color={LABEL}
            anchorX="center"
            anchorY="middle"
          >
            {''}
          </Text>
        </group>
      ))}

      {/* Altitude marks: a stripe across each wall + a label on each wall, every
          25m, recycled on the duck's altitude so they climb forever. */}
      <group ref={altGroupRef}>
        {altIndices.map((i) => (
          <group key={i} ref={(g) => (altRefs.current[i] = g)}>
            <mesh position={[-halfWidth + 0.1, 0, MID_Z]}>
              <boxGeometry args={[0.2, 0.25, VIEW_LEN]} />
              <meshBasicMaterial color={WALL_MARK} />
            </mesh>
            <mesh position={[halfWidth - 0.1, 0, MID_Z]}>
              <boxGeometry args={[0.2, 0.25, VIEW_LEN]} />
              <meshBasicMaterial color={WALL_MARK} />
            </mesh>
            <Text
              ref={(t) => (altLeftLabelRefs.current[i] = t)}
              position={[-halfWidth + inset, 1.6, 0]}
              rotation={[0, Math.PI / 2, 0]}
              fontSize={4}
              color={LABEL}
              anchorX="left"
              anchorY="middle"
            >
              {''}
            </Text>
            <Text
              ref={(t) => (altRightLabelRefs.current[i] = t)}
              position={[halfWidth - inset, 1.6, 0]}
              rotation={[0, -Math.PI / 2, 0]}
              fontSize={4}
              color={LABEL}
              anchorX="left"
              anchorY="middle"
            >
              {''}
            </Text>
          </group>
        ))}
      </group>
    </group>
  )
}
