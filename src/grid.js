import { rayTriangle, triangleBounds } from './geometry.js'

/**
 * XZ uniform grid over triangles. VR maps are mostly vertical surfaces, so index
 * by footprint and keep Y for the exact intersection test. Cheap to build, fast
 * enough for a few hundred thousand triangles.
 */
export class GridXZ {
  constructor (triangles, cellSize = 1) {
    this.cellSize = cellSize
    this.cells = new Map()
    for (let index = 0; index < triangles.length; index += 1) {
      const tri = triangles[index]
      const [minX, , minZ, maxX, , maxZ] = triangleBounds(tri.a, tri.b, tri.c)
      const x0 = Math.floor(minX / cellSize)
      const x1 = Math.floor(maxX / cellSize)
      const z0 = Math.floor(minZ / cellSize)
      const z1 = Math.floor(maxZ / cellSize)
      for (let ix = x0; ix <= x1; ix += 1) {
        for (let iz = z0; iz <= z1; iz += 1) {
          const key = `${ix}:${iz}`
          let bucket = this.cells.get(key)
          if (!bucket) {
            bucket = []
            this.cells.set(key, bucket)
          }
          bucket.push(index)
        }
      }
    }
    this.triangles = triangles
  }

  cellKey (x, z) {
    return `${Math.floor(x / this.cellSize)}:${Math.floor(z / this.cellSize)}`
  }

  at (x, z) {
    return this.cells.get(this.cellKey(x, z)) ?? []
  }

  /**
   * Marches the ray through XZ cells (Amanatides-Woo) and tests candidates.
   * Returns the nearest distance, or null.
   */
  raycast (origin, direction, maxDistance) {
    const dx = direction[0]
    const dz = direction[2]
    const horizontal = Math.hypot(dx, dz)

    if (horizontal < 1e-6) return this.raycastVertical(origin, direction, maxDistance)

    let x = origin[0]
    let z = origin[2]
    let ix = Math.floor(x / this.cellSize)
    let iz = Math.floor(z / this.cellSize)

    const stepX = dx > 0 ? 1 : -1
    const stepZ = dz > 0 ? 1 : -1
    const invDx = dx !== 0 ? 1 / Math.abs(dx) : Infinity
    const invDz = dz !== 0 ? 1 / Math.abs(dz) : Infinity

    const boundaryX = (ix + (dx > 0 ? 1 : 0)) * this.cellSize
    const boundaryZ = (iz + (dz > 0 ? 1 : 0)) * this.cellSize

    let tMaxX = dx !== 0 ? Math.abs(boundaryX - x) * invDx : Infinity
    let tMaxZ = dz !== 0 ? Math.abs(boundaryZ - z) * invDz : Infinity
    const tDeltaX = this.cellSize * invDx
    const tDeltaZ = this.cellSize * invDz

    let best = null
    let travelled = 0

    while (travelled <= maxDistance) {
      const bucket = this.cells.get(`${ix}:${iz}`)
      if (bucket) {
        for (const index of bucket) {
          const tri = this.triangles[index]
          const hit = rayTriangle(origin, direction, tri.a, tri.b, tri.c, maxDistance)
          if (hit !== null && (best === null || hit < best)) best = hit
        }
        if (best !== null && best <= travelled) break
      }

      if (tMaxX < tMaxZ) {
        travelled = tMaxX
        ix += stepX
        tMaxX += tDeltaX
      } else {
        travelled = tMaxZ
        iz += stepZ
        tMaxZ += tDeltaZ
      }
      if (travelled > maxDistance) break
    }

    return best
  }

  raycastVertical (origin, direction, maxDistance) {
    const bucket = this.at(origin[0], origin[2])
    let best = null
    for (const index of bucket) {
      const tri = this.triangles[index]
      const hit = rayTriangle(origin, direction, tri.a, tri.b, tri.c, maxDistance)
      if (hit !== null && (best === null || hit < best)) best = hit
    }
    return best
  }
}
