import { useMemo } from 'react'
import * as THREE from 'three'
import { Instance, Instances, useTexture } from '@react-three/drei'
import { ATLAS_URL, PACK_DIR } from './NatureProp'
import { useFlattenedGeometry } from './useFlattenedGeometry'
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
  const { geometry, baseHeight } = useFlattenedGeometry(`${PACK_DIR}/${file}`)
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
