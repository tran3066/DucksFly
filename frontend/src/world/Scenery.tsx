import { useMemo } from 'react'
import * as THREE from 'three'
import { Instance, Instances, useFBX, useTexture } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ATLAS_URL, PACK_DIR } from './NatureProp'
import type { MapDef, SceneryItem, SceneryKind } from '../map'

// SceneryKind -> SimpleNaturePack filename prefix. Every file is `<Prefix>_0N.fbx`.
const FILE_PREFIX: Record<SceneryKind, string> = {
  tree: 'Tree',
  bush: 'Bush',
  rock: 'Rock',
  grass: 'Grass',
  flowers: 'Flowers',
  mushroom: 'Mushroom',
  stump: 'Stump',
  branch: 'Branch',
}

function fileFor(kind: SceneryKind, variant: number): string {
  return `${FILE_PREFIX[kind]}_0${variant}.fbx`
}

/**
 * Renders all the seed-generated scenery as instanced meshes — one draw call per
 * (kind, variant) regardless of how many copies, so a forest of hundreds of
 * props stays cheap. Wrap in <Suspense> (useFBX/useTexture suspend while loading).
 */
export function Scenery({ map }: { map: MapDef }) {
  const atlas = useTexture(ATLAS_URL)

  // One shared material for the whole pack (they all sample the same atlas).
  const material = useMemo(() => {
    atlas.colorSpace = THREE.SRGBColorSpace
    atlas.flipY = true // colors sit in the atlas's top-left corner (see NatureProp)
    atlas.magFilter = THREE.NearestFilter
    atlas.minFilter = THREE.NearestFilter
    return new THREE.MeshStandardMaterial({
      map: atlas,
      side: THREE.DoubleSide,
      metalness: 0,
      roughness: 0.9,
    })
  }, [atlas])

  // Group every scenery item by its model file so each file becomes one Instances.
  const groups = useMemo(() => {
    const byFile = new Map<string, SceneryItem[]>()
    for (const it of map.scenery) {
      const file = fileFor(it.kind, it.variant)
      const list = byFile.get(file)
      if (list) list.push(it)
      else byFile.set(file, [it])
    }
    return [...byFile.entries()]
  }, [map.scenery])

  return (
    <group>
      {groups.map(([file, items]) => (
        <ScatterGroup key={file} file={file} items={items} material={material} />
      ))}
    </group>
  )
}

function ScatterGroup({
  file,
  items,
  material,
}: {
  file: string
  items: SceneryItem[]
  material: THREE.Material
}) {
  const { geometry, baseHeight } = useModelGeometry(file)
  return (
    <Instances geometry={geometry} material={material} limit={items.length} castShadow receiveShadow>
      {items.map((it) => (
        <Instance
          key={it.id}
          position={it.pos}
          rotation={[0, it.rotationY, 0]}
          // Per-instance uniform scale normalizes the raw model to `height` meters.
          scale={it.height / baseHeight}
        />
      ))}
    </Instances>
  )
}

/**
 * Load one pack FBX and flatten it into a single instanceable BufferGeometry:
 * bake each mesh's transform into its vertices, merge them, then re-base so the
 * model sits on y=0 and is centered in x/z. Returns the merged geometry plus its
 * natural height (so callers can scale to a target world height).
 */
function useModelGeometry(file: string): { geometry: THREE.BufferGeometry; baseHeight: number } {
  const fbx = useFBX(`${PACK_DIR}/${file}`)

  return useMemo(() => {
    fbx.updateMatrixWorld(true)

    // Collect each mesh as position+uv only (drop index/normals) so the parts are
    // guaranteed mergeable; normals are recomputed once after the merge.
    const parts: THREE.BufferGeometry[] = []
    fbx.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh || !mesh.geometry) return
      let g = mesh.geometry.clone()
      g.applyMatrix4(mesh.matrixWorld)
      if (g.index) g = g.toNonIndexed()

      const clean = new THREE.BufferGeometry()
      clean.setAttribute('position', g.getAttribute('position'))
      const uv = g.getAttribute('uv')
      if (uv) clean.setAttribute('uv', uv)
      else {
        const n = clean.getAttribute('position').count
        clean.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
      }
      parts.push(clean)
    })

    const geometry =
      parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) ?? parts[0])

    // Re-base: center x/z, drop the base to y=0 so position [x,0,z] sits on ground.
    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
    geometry.computeBoundingBox()
    geometry.computeVertexNormals()

    const baseHeight = geometry.boundingBox!.max.y || 1
    return { geometry, baseHeight }
  }, [fbx])
}
