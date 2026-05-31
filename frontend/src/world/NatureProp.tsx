import { useMemo } from 'react'
import * as THREE from 'three'
import { useFBX, useTexture } from '@react-three/drei'
import type { ThreeElements } from '@react-three/fiber'

// The SimpleNaturePack: a set of low-poly FBX props that all share one tiny
// palette atlas, which lives in the pack folder alongside the models.
const PACK_DIR = '/models/SimpleNaturePack'
const ATLAS_URL = `${PACK_DIR}/NaturePackLite_Texture_01.png`

export type NaturePropProps = ThreeElements['group'] & {
  /** FBX filename within /models/SimpleNaturePack, e.g. "Tree_01.fbx". */
  file: string
  /**
   * If set, normalize the model so its bounding-box height equals this many
   * world units, regardless of the FBX's raw export scale. Use for props whose
   * source models have inconsistent scales (the rocks). Leave unset and use the
   * `scale` prop for props that share a consistent raw scale (trees, ground).
   */
  fitHeight?: number
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
export function NatureProp({ file, fitHeight, ...props }: NaturePropProps) {
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

    // Optionally normalize to a target height, so props with wildly different
    // raw export scales (rocks: 0.1 to 195 units) all come out usably sized.
    if (fitHeight) {
      const h = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).y
      if (h > 0) root.scale.multiplyScalar(fitHeight / h)
    }

    return root
  }, [fbx, atlas, fitHeight])

  return (
    <group {...props}>
      <primitive object={model} />
    </group>
  )
}

// Named presets. The default scale brings each model to a sensible world size;
// callers can still override scale (a later prop in the spread wins).

/** The available tree shapes in the pack (Tree_01.fbx … Tree_05.fbx). */
export type TreeVariant = 1 | 2 | 3 | 4 | 5
export const TREE_VARIANTS: TreeVariant[] = [1, 2, 3, 4, 5]

export function Tree({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: TreeVariant }) {
  return <NatureProp file={`Tree_0${variant}.fbx`} scale={0.01} {...props} />
}

/** The available bushes in the pack (Bush_01.fbx … Bush_03.fbx). */
export type BushVariant = 1 | 2 | 3
export const BUSH_VARIANTS: BushVariant[] = [1, 2, 3]

export function Bush({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: BushVariant }) {
  return <NatureProp file={`Bush_0${variant}.fbx`} scale={0.01} {...props} />
}

// The branch is authored at near-unit scale (~0.8 units long), unlike the
// ~30–80 unit foliage, so it needs scale ~1.5 (not 0.01) to read as a ~1.2-unit
// fallen branch. fitHeight is wrong here — it's long and thin, not tall.
export function Branch(props: ThreeElements['group']) {
  return <NatureProp file="Branch_01.fbx" scale={1.5} {...props} />
}

/** A tree stump (single model). */
export function Stump(props: ThreeElements['group']) {
  return <NatureProp file="Stump_01.fbx" scale={0.01} {...props} />
}

/** The available mushrooms in the pack (Mushroom_01.fbx … Mushroom_02.fbx). */
export type MushroomVariant = 1 | 2
export const MUSHROOM_VARIANTS: MushroomVariant[] = [1, 2]

// Small ground detail — normalize to ~0.3 units tall.
export function Mushroom({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: MushroomVariant }) {
  return <NatureProp file={`Mushroom_0${variant}.fbx`} fitHeight={0.3} {...props} />
}

/** The available ground tiles in the pack (Ground_01.fbx … Ground_03.fbx). */
export type GroundVariant = 1 | 2 | 3
export const GROUND_VARIANTS: GroundVariant[] = [1, 2, 3]

// Ground tiles are modular ~30-unit squares — about 16x smaller in raw units
// than the trees — so they need a much larger scale than the foliage presets.
// At 0.4 each tile is ~12 world units square (Ground_02 carries a raised hill).
export function Ground({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: GroundVariant }) {
  return <NatureProp file={`Ground_0${variant}.fbx`} scale={0.4} {...props} />
}

/** The available rocks in the pack (Rock_01.fbx … Rock_05.fbx). */
export type RockVariant = 1 | 2 | 3 | 4 | 5
export const ROCK_VARIANTS: RockVariant[] = [1, 2, 3, 4, 5]

// Rock source models have wildly inconsistent raw scales (~0.1 to ~195 units),
// so a single `scale` can't work. Normalize each to ~1.2 units tall instead;
// callers can still vary size per placement with the `scale` prop.
export function Rock({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: RockVariant }) {
  return <NatureProp file={`Rock_0${variant}.fbx`} fitHeight={1.2} {...props} />
}

/** The available grass tufts in the pack (Grass_01.fbx … Grass_02.fbx). */
export type GrassVariant = 1 | 2
export const GRASS_VARIANTS: GrassVariant[] = [1, 2]

// Grass tufts are small foliage; normalize to ~0.4 units tall (scale varies in
// the source like the rocks, so fitHeight is safer than a fixed scale).
export function Grass({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: GrassVariant }) {
  return <NatureProp file={`Grass_0${variant}.fbx`} fitHeight={0.4} {...props} />
}

/** The available flower clusters in the pack (Flowers_01.fbx … Flowers_02.fbx). */
export type FlowerVariant = 1 | 2
export const FLOWER_VARIANTS: FlowerVariant[] = [1, 2]

// Small foliage like grass — normalize to ~0.4 units tall.
export function Flowers({
  variant = 1,
  ...props
}: ThreeElements['group'] & { variant?: FlowerVariant }) {
  return <NatureProp file={`Flowers_0${variant}.fbx`} fitHeight={0.4} {...props} />
}
