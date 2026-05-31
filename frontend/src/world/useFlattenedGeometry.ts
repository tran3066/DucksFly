import { useMemo } from 'react'
import * as THREE from 'three'
import { useFBX } from '@react-three/drei'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Load an FBX and flatten it into a single instanceable BufferGeometry: bake
 * each mesh's transform into its vertices, merge them (position + uv only, so
 * the parts are guaranteed mergeable), then re-base so the model sits on y=0 and
 * is centered in x/z. Returns the merged geometry plus its natural height, so
 * callers can scale instances to a target world height.
 *
 * Suspense-friendly (useFBX suspends while loading). Shared by Scenery and the
 * sky/cloud renderer so the extraction logic lives in one place.
 */
export function useFlattenedGeometry(url: string): {
  geometry: THREE.BufferGeometry
  baseHeight: number
} {
  const fbx = useFBX(url)

  return useMemo(() => {
    fbx.updateMatrixWorld(true)

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

    const geometry = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) ?? parts[0])

    geometry.computeBoundingBox()
    const bb = geometry.boundingBox!
    geometry.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
    geometry.computeBoundingBox()
    geometry.computeVertexNormals()

    const baseHeight = geometry.boundingBox!.max.y || 1
    return { geometry, baseHeight }
  }, [fbx])
}
