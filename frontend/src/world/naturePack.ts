// Variant types and lists for the SimpleNaturePack props. Kept out of
// NatureProp.tsx so that file only exports React components (which keeps Fast
// Refresh working — react-refresh/only-export-components).

export type TreeVariant = 1 | 2 | 3 | 4 | 5
export const TREE_VARIANTS: TreeVariant[] = [1, 2, 3, 4, 5]

export type BushVariant = 1 | 2 | 3
export const BUSH_VARIANTS: BushVariant[] = [1, 2, 3]

export type RockVariant = 1 | 2 | 3 | 4 | 5
export const ROCK_VARIANTS: RockVariant[] = [1, 2, 3, 4, 5]

export type GrassVariant = 1 | 2
export const GRASS_VARIANTS: GrassVariant[] = [1, 2]

export type FlowerVariant = 1 | 2
export const FLOWER_VARIANTS: FlowerVariant[] = [1, 2]

export type MushroomVariant = 1 | 2
export const MUSHROOM_VARIANTS: MushroomVariant[] = [1, 2]

export type GroundVariant = 1 | 2 | 3
export const GROUND_VARIANTS: GroundVariant[] = [1, 2, 3]
