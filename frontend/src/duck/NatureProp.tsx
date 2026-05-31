import { useMemo } from 'react'
import * as THREE from 'three'
import { useFBX, useTexture } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

// The SimpleNaturePack: a set of low-poly FBX props that all share one tiny
// palette atlas. The atlas lives one level up because it is shared by the pack.
const PACK_DIR = '/models/SimpleNaturePack'
const ATLAS_URL = '/models/NaturePackLite_Texture_01.png'

export type NaturePropProps = ThreeElements['group'] & {
  /** FBX filename within /models/SimpleNaturePack, e.g. "Tree_01.fbx". */
  file: string
}

/**
 * A static prop from the SimpleNaturePack (tree, bush, etc.). The FBX does not
 * embed its texture, so the shared palette atlas is applied here in code.
 * Suspense-friendly — render inside a <Suspense> (useFBX/useTexture suspend).
 *
 *   <Suspense fallback={null}><NatureProp file="Bush_01.fbx" scale={0.01} /></Suspense>
 *
 * Prefer the named presets below (<Tree>, <Bush>) which also carry a sane scale.
 */
export function NatureProp({ file, ...props }: NaturePropProps) {
  const fbx = useFBX(`${PACK_DIR}/${file}`)
  const atlas = useTexture(ATLAS_URL)

  const model = useMemo(() => {
    atlas.colorSpace = THREE.SRGBColorSpace
    // This atlas packs its colors into the TOP-LEFT corner (rest is gray filler),
    // and the pack's UVs point there, so it needs the standard top-up orientation.
    atlas.flipY = true
    atlas.magFilter = THREE.NearestFilter // tiny palette atlas — keep color blocks crisp
    atlas.minFilter = THREE.NearestFilter

    // Clone so multiple instances (and HMR re-runs) don't share/mutate one object.
    const root = fbx.clone(true)
    root.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.material = new THREE.MeshStandardMaterial({
        map: atlas,
        side: THREE.DoubleSide, // leaf/foliage cards may be single-sided planes
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

// Named presets. The default scale brings each model to a sensible world size;
// callers can still override scale (a later prop in the spread wins).
export function Tree(props: ThreeElements['group']) {
  return <NatureProp file="Tree_01.fbx" scale={0.01} {...props} />
}

export function Bush(props: ThreeElements['group']) {
  return <NatureProp file="Bush_01.fbx" scale={0.01} {...props} />
}
