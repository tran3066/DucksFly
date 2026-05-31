// One remote player's duck in the multiplayer game. Reuses the SAME animated
// `avatar/Duck` as the local player — the server only syncs pos/vel/quat, so we
// reconstruct its animation intent with `inferActions` (flap/dive from vertical
// velocity, lean from the banked quaternion). Position + orientation are eased
// toward the latest ~20Hz sample so the duck glides smoothly between updates.

import { useRef } from 'react'
import { Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Group, Quaternion, Vector3 } from 'three'
import type { DuckActions } from '../physics'
import { Duck } from '../avatar/Duck'
import { makeIdleActions } from '../shared/types/duckActions'
import { inferActions } from './inferActions'
import type { PlayerView } from '../net/types'

export function RemoteDuck({ player }: { player: PlayerView }) {
  // Latest snapshot, refreshed every render (the room patches ~20x/sec).
  const target = useRef(player)
  target.current = player

  const duckRef = useRef<Group | null>(null)
  const labelRef = useRef<Group>(null)
  const actionsRef = useRef<DuckActions>(makeIdleActions())
  const init = useRef(false)
  const targetPos = useRef(new Vector3())
  const targetQuat = useRef(new Quaternion())

  useFrame(() => {
    const p = target.current
    actionsRef.current = inferActions(p.vel, p.quat)

    const duck = duckRef.current
    if (!duck) return
    targetPos.current.set(p.pos.x, p.pos.y, p.pos.z)
    targetQuat.current.set(p.quat.x, p.quat.y, p.quat.z, p.quat.w)
    if (!init.current) {
      duck.position.copy(targetPos.current)
      duck.quaternion.copy(targetQuat.current)
      init.current = true
    } else {
      duck.position.lerp(targetPos.current, 0.2)
      duck.quaternion.slerp(targetQuat.current, 0.25)
    }
    // Keep the name tag over the duck without inheriting its bank/pitch.
    if (labelRef.current) labelRef.current.position.copy(duck.position)
  })

  const color = player.spunOut ? '#ff6b6b' : '#bfefff'
  return (
    <>
      <Duck ref={duckRef} variant={player.duckVariant} actionsRef={actionsRef} />
      <group ref={labelRef}>
        <Text position={[0, 3, 0]} fontSize={1.6} color={color} anchorX="center" anchorY="middle">
          {player.name}
        </Text>
      </group>
    </>
  )
}

export function RemoteDucks({
  players,
  sessionId,
}: {
  players: PlayerView[]
  sessionId?: string
}) {
  return (
    <>
      {players
        .filter((p) => p.id !== sessionId)
        .map((p) => (
          <RemoteDuck key={p.id} player={p} />
        ))}
    </>
  )
}
