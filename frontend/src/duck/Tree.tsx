import { useMemo } from 'react'
import * as THREE from 'three'
import { useFBX, useTexture } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

const BASE = '/models/tree1'

/**
 * A static low-poly tree (Tree_01.fbx). Like the duck, the FBX does not embed
 * its texture — the diffuse atlas is applied here in code. Suspense-friendly:
 * render it inside a <Suspense> (drei's useFBX/useTexture suspend while loading).
 *
 *   <Suspense fallback={null}><Tree position={[3, 0, 0]} scale={0.05} /></Suspense>
 */
export function Tree(props: ThreeElements['group']) {
  const fbx = useFBX(`${BASE}/Tree_01.fbx`)
  // Low-poly palette atlas (8 KB), same style as the duck's texture. The other
  // PNGs in this folder (diffuse/normal/shadow/gloss) are intentionally ignored.
  const atlas = useTexture(`${BASE}/NaturePackLite_Texture_01.png`)

  const model = useMemo(() => {
    atlas.colorSpace = THREE.SRGBColorSpace
    // This atlas packs all its colors into the TOP-LEFT corner (the rest is gray
    // filler). Tree_01's UVs point at that corner, so we need the standard top-up
    // orientation here — unlike the duck, which needed flipY=false.
    atlas.flipY = true
    atlas.magFilter = THREE.NearestFilter // tiny palette atlas — keep color blocks crisp
    atlas.minFilter = THREE.NearestFilter

    // Clone so multiple <Tree>s (and HMR re-runs) don't share/mutate one object.
    const root = fbx.clone(true)
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.material = new THREE.MeshStandardMaterial({
        map: atlas,
        side: THREE.DoubleSide, // leaf cards may be single-sided planes
        metalness: 0,
        roughness: 0.9,
      })
    })

    return root
  }, [fbx, atlas])

  return (
    <group {...props}>
      <primitive object={model} />
    </group>
  )
}
