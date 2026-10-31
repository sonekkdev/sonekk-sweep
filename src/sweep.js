import { normalize } from './geometry.js'

const UP = [0, 1, 0]

export const DEFAULTS = {
  grid: 1,
  eyeHeight: 1.4,
  rays: 16,
  maxDistance: 20,
  tolerance: 0.15,
  maxFindings: 200,
  voidDistance: 25,
  ignore: []
}

/**
 * Ignore regions let a level mark intentional holes, windows and decoration so the
 * report stays signal. Each entry: { type?, min: [x,y,z], max: [x,y,z], reason }.
 */
function isIgnored (finding, ignore) {
  if (!Array.isArray(ignore) || ignore.length === 0) return false
  const [x, y, z] = finding.at
  return ignore.some((region) => {
    if (region.type && region.type !== finding.type) return false
    const min = region.min ?? [-Infinity, -Infinity, -Infinity]
    const max = region.max ?? [Infinity, Infinity, Infinity]
    return x >= min[0] && x <= max[0] && y >= min[1] && y <= max[1] && z >= min[2] && z <= max[2]
  })
}

/**
 * Walks a grid over the map and asks three questions:
 *   1. is there ground where the geometry says there is ground
 *   2. can a player see a surface that has no collision
 *   3. can a player see straight out of the world from somewhere they can stand
 *
 * Floors are found by casting up from below the map, so a ceiling never shadows the
 * floor. Multi level maps report the lowest floor per column, documented limitation.
 */
export function sweep (scene, options = {}) {
  const config = { ...DEFAULTS, ...options }
  const { min, max } = scene.bounds
  const findings = []
  const cells = []
  const badFloor = new Set()

  // Sample cell centres, half a grid inside the bounds. Sampling exactly on a wall
  // plane makes rays graze the surface and miss it.
  const startX = Math.ceil(min[0] / config.grid) * config.grid + config.grid / 2
  const startZ = Math.ceil(min[2] / config.grid) * config.grid + config.grid / 2
  const endX = max[0] - config.grid / 2 + 1e-9
  const endZ = max[2] - config.grid / 2 + 1e-9
  const riseFrom = min[1] - 1
  const riseDistance = max[1] - min[1] + 4

  for (let x = startX; x <= endX; x += config.grid) {
    for (let z = startZ; z <= endZ; z += config.grid) {
      const origin = [x, riseFrom, z]
      const renderHit = scene.renderGrid.raycast(origin, UP, riseDistance)
      const colliderHit = scene.colliderGrid.raycast(origin, UP, riseDistance)

      const cell = {
        x,
        z,
        floorY: colliderHit === null ? null : riseFrom + colliderHit,
        renderFloorY: renderHit === null ? null : riseFrom + renderHit
      }
      cells.push(cell)

      // Visible floor with nothing solid at that height: a hole you fall through.
      if (
        cell.renderFloorY !== null &&
        (cell.floorY === null || cell.floorY > cell.renderFloorY + config.tolerance)
      ) {
        badFloor.add(`${x}:${z}`)
        findings.push({
          type: 'fall_through',
          at: [x, round(cell.renderFloorY), z],
          cell: [x, z],
          detail: cell.floorY === null
            ? 'floor is rendered but has no collider'
            : `no collider on the visible floor, nearest solid is at ${round(cell.floorY)}`
        })
      } else if (
        cell.renderFloorY !== null &&
        cell.floorY !== null &&
        cell.floorY < cell.renderFloorY - config.tolerance
      ) {
        findings.push({
          type: 'floor_mismatch',
          at: [x, round(cell.renderFloorY), z],
          cell: [x, z],
          detail: `visible floor at ${round(cell.renderFloorY)}, collider at ${round(cell.floorY)}`
        })
      }
    }
  }

  const walkable = cells.filter((cell) => cell.floorY !== null && !badFloor.has(`${cell.x}:${cell.z}`))
  const walkMap = new Map(walkable.map((cell) => [key(cell.x, cell.z), cell]))

  // Eye height rays from every walkable cell.
  for (const cell of walkable) {
    const origin = [cell.x, cell.floorY + config.eyeHeight, cell.z]
    let passThrough = null
    let invisible = null

    for (let i = 0; i < config.rays; i += 1) {
      const angle = (i / config.rays) * Math.PI * 2
      const direction = [Math.cos(angle), 0, Math.sin(angle)]

      const renderHit = scene.renderGrid.raycast(origin, direction, config.maxDistance)
      const colliderHit = scene.colliderGrid.raycast(origin, direction, config.maxDistance)

      if (renderHit !== null && (colliderHit === null || renderHit < colliderHit - config.tolerance)) {
        if (!passThrough || renderHit < passThrough.distance) {
          passThrough = {
            type: 'pass_through',
            at: pointAt(origin, direction, renderHit),
            cell: [cell.x, cell.z],
            direction: normalize(direction),
            distance: round(renderHit),
            detail: colliderHit === null
              ? 'no collider behind visible geometry'
              : `collider is ${round(colliderHit - renderHit)} m behind the surface`
          }
        }
      } else if (colliderHit !== null && (renderHit === null || colliderHit < renderHit - config.tolerance)) {
        if (!invisible || colliderHit < invisible.distance) {
          invisible = {
            type: 'invisible_collider',
            at: pointAt(origin, direction, colliderHit),
            cell: [cell.x, cell.z],
            direction: normalize(direction),
            distance: round(colliderHit),
            detail: 'collision with nothing visible in front of it'
          }
        }
      }
    }

    if (passThrough) findings.push(passThrough)
    if (invisible) findings.push(invisible)
  }

  // Reachability from the spawn, then "can you see out of the world from here".
  const start = pickStart(walkable, scene.spawn)
  const reached = new Set()
  const reachedCells = []

  if (start) {
    const queue = [start]
    reached.add(key(start.x, start.z))
    reachedCells.push(start)

    while (queue.length) {
      const current = queue.pop()
      for (const [dx, dz] of [[config.grid, 0], [-config.grid, 0], [0, config.grid], [0, -config.grid]]) {
        const nx = current.x + dx
        const nz = current.z + dz
        const nxKey = key(nx, nz)
        if (reached.has(nxKey)) continue
        const next = walkMap.get(nxKey)
        if (!next) continue
        reached.add(nxKey)
        reachedCells.push(next)
        queue.push(next)
      }
    }
  }

  for (const cell of reachedCells) {
    const origin = [cell.x, cell.floorY + config.eyeHeight, cell.z]
    let open = null
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2
      const direction = [Math.cos(angle), 0, Math.sin(angle)]
      if (scene.colliderGrid.raycast(origin, direction, config.voidDistance) === null) {
        open = direction
        break
      }
    }
    if (open) {
      findings.push({
        type: 'escape',
        at: [cell.x, round(cell.floorY), cell.z],
        cell: [cell.x, cell.z],
        direction: normalize(open),
        detail: `nothing solid within ${config.voidDistance} m in at least one direction`
      })
    }
  }

  const clustered = clusterFindings(findings.filter((finding) => !isIgnored(finding, config.ignore)), config.grid * 1.5)
  const trimmed = clustered.slice(0, config.maxFindings)
  const count = (type) => trimmed.filter((finding) => finding.type === type).length

  return {
    version: 1,
    scene: scene.name,
    options: config,
    bounds: { min, max },
    summary: {
      cells: cells.length,
      walkable: walkable.length,
      reachable: reached.size,
      passThrough: count('pass_through'),
      invisibleColliders: count('invisible_collider'),
      fallThrough: count('fall_through'),
      floorMismatch: count('floor_mismatch'),
      escapes: count('escape'),
      truncated: clustered.length > trimmed.length
    },
    findings: trimmed
  }
}

function clusterFindings (findings, radius) {
  const visited = new Array(findings.length).fill(false)
  const clusters = []

  for (let i = 0; i < findings.length; i += 1) {
    if (visited[i]) continue
    visited[i] = true
    const queue = [i]
    const group = []

    while (queue.length) {
      const index = queue.pop()
      const current = findings[index]
      group.push(current)

      for (let j = 0; j < findings.length; j += 1) {
        if (visited[j]) continue
        const other = findings[j]
        if (other.type !== current.type) continue
        if (Math.hypot(other.cell[0] - current.cell[0], other.cell[1] - current.cell[1]) <= radius) {
          visited[j] = true
          queue.push(j)
        }
      }
    }

    clusters.push({ ...group[0], count: group.length })
  }

  const order = ['escape', 'pass_through', 'invisible_collider', 'fall_through', 'floor_mismatch']
  return clusters.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))
}

function pickStart (walkable, spawn) {
  if (walkable.length === 0) return null
  if (!spawn) {
    const middle = walkable[Math.floor(walkable.length / 2)]
    return middle
  }
  let best = walkable[0]
  let bestDistance = Infinity
  for (const cell of walkable) {
    const distance = (cell.x - spawn[0]) ** 2 + (cell.z - spawn[2]) ** 2
    if (distance < bestDistance) {
      bestDistance = distance
      best = cell
    }
  }
  return best
}

const key = (x, z) => `${Math.round(x * 1000)}:${Math.round(z * 1000)}`
const pointAt = (origin, direction, distance) => [
  round(origin[0] + direction[0] * distance),
  round(origin[1] + direction[1] * distance),
  round(origin[2] + direction[2] * distance)
]
const round = (value) => Math.round(value * 1000) / 1000

export function formatReport (report) {
  const lines = []
  lines.push(`scene: ${report.scene}`)
  lines.push(
    `cells ${report.summary.cells}, walkable ${report.summary.walkable}, reachable ${report.summary.reachable}`
  )
  lines.push(
    `pass-through ${report.summary.passThrough}, invisible ${report.summary.invisibleColliders}, ` +
      `fall-through ${report.summary.fallThrough}, floor mismatch ${report.summary.floorMismatch}, ` +
      `escapes ${report.summary.escapes}`
  )

  for (const finding of report.findings.slice(0, 20)) {
    const [x, y, z] = finding.at
    lines.push(`  ${finding.type} at ${x}, ${y}, ${z} (${finding.detail})`)
  }
  if (report.findings.length > 20) lines.push(`  ... ${report.findings.length - 20} more`)
  if (report.summary.truncated) lines.push('  findings truncated, raise maxFindings to see all')
  return lines.join('\n')
}
