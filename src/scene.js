import { toTriangles, boundsOf } from './geometry.js'
import { colliderTriangles } from './colliders.js'
import { GridXZ } from './grid.js'

export class SceneError extends Error {}

export function loadScene (data) {
  if (!data || typeof data !== 'object') throw new SceneError('scene must be an object')
  if (!Array.isArray(data.meshes) || data.meshes.length === 0) {
    throw new SceneError('scene.meshes must contain at least one mesh')
  }

  const render = []
  for (const mesh of data.meshes) {
    if (!Array.isArray(mesh.positions)) throw new SceneError('mesh.positions must be an array')
    render.push(...toTriangles(mesh.positions, mesh.indices))
  }
  if (render.length === 0) throw new SceneError('scene has no triangles')

  const colliderTris = []
  for (const collider of data.colliders ?? []) {
    colliderTris.push(...colliderTriangles(collider))
  }

  const bounds = boundsOf(render)
  return {
    name: typeof data.name === 'string' ? data.name : 'scene',
    spawn: Array.isArray(data.spawn) ? data.spawn : null,
    render,
    collider: colliderTris,
    bounds,
    renderGrid: new GridXZ(render, 1),
    colliderGrid: new GridXZ(colliderTris, 1)
  }
}
