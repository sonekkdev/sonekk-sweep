import { toTriangles } from './geometry.js'

// Collider input is intentionally dumb: the exporter bakes transforms, so there is
// no rotation math here to get wrong.
//
// { "type": "mesh",    "positions": [...], "indices": [...] }
// { "type": "box",     "corners": [8 x [x,y,z]] }
// { "type": "sphere",  "center": [x,y,z], "radius": number }
// { "type": "capsule", "a": [x,y,z], "b": [x,y,z], "radius": number }

const BOX_FACES = [
  [0, 1, 2], [0, 2, 3],
  [4, 6, 5], [4, 7, 6],
  [0, 4, 5], [0, 5, 1],
  [1, 5, 6], [1, 6, 2],
  [2, 6, 7], [2, 7, 3],
  [3, 7, 4], [3, 4, 0]
]

export function colliderTriangles (collider) {
  switch (collider.type) {
    case 'mesh':
      return toTriangles(collider.positions, collider.indices)

    case 'box': {
      const corners = collider.corners
      if (!Array.isArray(corners) || corners.length !== 8) return []
      return BOX_FACES.map(([i, j, k]) => ({ a: corners[i], b: corners[j], c: corners[k] }))
    }

    case 'sphere':
      return sphereTriangles(collider.center, collider.radius, 1)

    case 'capsule':
      return capsuleTriangles(collider.a, collider.b, collider.radius)

    default:
      return []
  }
}

function sphereTriangles (center, radius, subdivisions) {
  // Octahedron subdivided, 8 * 4^n faces. One subdivision is 32 faces, plenty for
  // a conservative collision proxy.
  const base = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]
  ]
  let faces = [
    [0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2],
    [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]
  ]

  for (let step = 0; step < subdivisions; step += 1) {
    const points = base.slice()
    const cache = new Map()
    const midpoint = (i, j) => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`
      if (cache.has(key)) return cache.get(key)
      const p = points[i]
      const q = points[j]
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
      const len = Math.hypot(mid[0], mid[1], mid[2]) || 1
      points.push([mid[0] / len, mid[1] / len, mid[2] / len])
      const index = points.length - 1
      cache.set(key, index)
      return index
    }

    const next = []
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
    base.length = 0
    base.push(...points)
  }

  return faces.map(([i, j, k]) => {
    const scale = (p) => [
      center[0] + p[0] * radius,
      center[1] + p[1] * radius,
      center[2] + p[2] * radius
    ]
    return { a: scale(base[i]), b: scale(base[j]), c: scale(base[k]) }
  })
}

function capsuleTriangles (a, b, radius) {
  // Cylinder with 8 sides. The round caps are approximated by flat ends, which is
  // very slightly smaller than the real collider, so it can under report at the
  // tips. Documented in the README.
  const sides = 8
  const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1
  const dir = [axis[0] / length, axis[1] / length, axis[2] / length]

  let reference = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = normalize(cross(dir, reference))
  const v = cross(dir, u)

  const ring = (center) =>
    Array.from({ length: sides }, (_, i) => {
      const angle = (i / sides) * Math.PI * 2
      return [
        center[0] + (u[0] * Math.cos(angle) + v[0] * Math.sin(angle)) * radius,
        center[1] + (u[1] * Math.cos(angle) + v[1] * Math.sin(angle)) * radius,
        center[2] + (u[2] * Math.cos(angle) + v[2] * Math.sin(angle)) * radius
      ]
    })

  const bottom = ring(a)
  const top = ring(b)
  const triangles = []

  for (let i = 0; i < sides; i += 1) {
    const j = (i + 1) % sides
    triangles.push({ a: bottom[i], b: bottom[j], c: top[j] })
    triangles.push({ a: bottom[i], b: top[j], c: top[i] })
    triangles.push({ a: a, b: bottom[j], c: bottom[i] })
    triangles.push({ a: b, b: top[i], c: top[j] })
  }

  return triangles
}

function normalize (vector) {
  const len = Math.hypot(vector[0], vector[1], vector[2]) || 1
  return [vector[0] / len, vector[1] / len, vector[2] / len]
}

function cross (a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}
