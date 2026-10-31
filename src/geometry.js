// Small vector / triangle toolkit. No dependencies, plain arrays [x, y, z].

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
]
export const length = (a) => Math.sqrt(dot(a, a))
export const normalize = (a) => {
  const len = length(a)
  return len > 1e-9 ? mul(a, 1 / len) : [0, 0, 0]
}

/**
 * Moller-Trumbore. Returns the distance along the ray, or null.
 * Back faces count as hits, geometry is treated as solid from both sides.
 */
export function rayTriangle (origin, direction, a, b, c, maxDistance) {
  const edge1 = sub(b, a)
  const edge2 = sub(c, a)
  const pvec = cross(direction, edge2)
  const det = dot(edge1, pvec)
  if (Math.abs(det) < 1e-9) return null

  const inv = 1 / det
  const tvec = sub(origin, a)
  const u = dot(tvec, pvec) * inv
  if (u < -1e-6 || u > 1 + 1e-6) return null

  const qvec = cross(tvec, edge1)
  const v = dot(direction, qvec) * inv
  if (v < -1e-6 || u + v > 1 + 1e-6) return null

  const t = dot(edge2, qvec) * inv
  if (t < 1e-4 || t > maxDistance) return null
  return t
}

export function triangleBounds (a, b, c) {
  return [
    Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2]),
    Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])
  ]
}

export function triangleCentroid (a, b, c) {
  return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3]
}

export function triangleArea (a, b, c) {
  return 0.5 * length(cross(sub(b, a), sub(c, a)))
}

/** Converts a flat positions array plus indices into triangle records. */
export function toTriangles (positions, indices) {
  const triangles = []
  const limit = indices ? indices.length : positions.length / 3
  for (let i = 0; i + 2 < limit; i += 3) {
    const ia = (indices ? indices[i] : i) * 3
    const ib = (indices ? indices[i + 1] : i + 1) * 3
    const ic = (indices ? indices[i + 2] : i + 2) * 3
    const a = [positions[ia], positions[ia + 1], positions[ia + 2]]
    const b = [positions[ib], positions[ib + 1], positions[ib + 2]]
    const c = [positions[ic], positions[ic + 1], positions[ic + 2]]
    if (!a.every(Number.isFinite) || !b.every(Number.isFinite) || !c.every(Number.isFinite)) continue
    triangles.push({ a, b, c })
  }
  return triangles
}

export function boundsOf (triangles) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const tri of triangles) {
    for (const point of [tri.a, tri.b, tri.c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (point[axis] < min[axis]) min[axis] = point[axis]
        if (point[axis] > max[axis]) max[axis] = point[axis]
      }
    }
  }
  return { min, max }
}
