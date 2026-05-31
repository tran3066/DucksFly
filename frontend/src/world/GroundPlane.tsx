import { useMemo } from 'react'
import * as THREE from 'three'

/** World meters covered by one repeat of the texture. */
const METERS_PER_REPEAT = 12

/**
 * Procedural tiling grass texture: a base green speckled with many small darker
 * and lighter "blades", so the ground reads as textured rather than flat — and
 * tiles seamlessly when set to RepeatWrapping. No image asset required; swap in
 * a real grass PNG via TextureLoader later if you want more detail.
 */
function makeGrassTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#3f7a45'
  ctx.fillRect(0, 0, size, size)

  const shades = ['#356b3b', '#4a8a4e', '#2f6135', '#58974f', '#46834a', '#5fa257']
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = shades[(Math.random() * shades.length) | 0]
    const x = Math.random() * size
    const y = Math.random() * size
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 3)
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8 // keep it crisp at the grazing angle the ground is viewed from
  return tex
}

/**
 * The corridor floor: one big plane with the tiling grass texture, repeated to
 * keep a consistent blade scale regardless of the plane's size.
 */
export function GroundPlane({
  width,
  length,
  y,
  midZ,
}: {
  width: number
  length: number
  y: number
  midZ: number
}) {
  const texture = useMemo(() => {
    const tex = makeGrassTexture()
    tex.repeat.set(width / METERS_PER_REPEAT, length / METERS_PER_REPEAT)
    return tex
  }, [width, length])

  return (
    <mesh position={[0, y, midZ]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[width, length]} />
      <meshStandardMaterial map={texture} roughness={1} metalness={0} />
    </mesh>
  )
}
