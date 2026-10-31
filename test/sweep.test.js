import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { colliderTriangles } from '../src/colliders.js'
import { loadScene } from '../src/scene.js'
import { sweep } from '../src/sweep.js'

const SIZE = 10
const HEIGHT = 3

function meshBuilder () {
  const positions = []
  const indices = []
  const addQuad = (a, b, c, d) => {
    const base = positions.length / 3
    positions.push(...a, ...b, ...c, ...d)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { positions, indices, addQuad }
}

const p = (x, y, z) => [x, y, z]

function addRoom (mesh, { skip } = {}) {
  const s = SIZE
  const h = HEIGHT
  if (skip !== 'floor') mesh.addQuad(p(0, 0, 0), p(s, 0, 0), p(s, 0, s), p(0, 0, s))
  if (skip !== 'ceiling') mesh.addQuad(p(0, h, 0), p(0, h, s), p(s, h, s), p(s, h, 0))
  if (skip !== 'north') mesh.addQuad(p(0, 0, 0), p(0, h, 0), p(s, h, 0), p(s, 0, 0))
  if (skip !== 'south') mesh.addQuad(p(0, 0, s), p(s, 0, s), p(s, h, s), p(0, h, s))
  if (skip !== 'west') mesh.addQuad(p(0, 0, 0), p(0, 0, s), p(0, h, s), p(0, h, 0))
  if (skip !== 'east') mesh.addQuad(p(s, 0, 0), p(s, h, 0), p(s, h, s), p(s, 0, s))
}

function room (renderSkip, colliderSkip) {
  const render = meshBuilder()
  addRoom(render, { skip: renderSkip })
  const collider = meshBuilder()
  addRoom(collider, { skip: colliderSkip })
  return {
    version: 1,
    name: 'test room',
    spawn: [5, 0, 5],
    meshes: [{ name: 'room', positions: render.positions, indices: render.indices }],
    colliders: [{ type: 'mesh', positions: collider.positions, indices: collider.indices }]
  }
}

const types = (report) => new Set(report.findings.map((finding) => finding.type))

test('a sealed room is clean', () => {
  const report = sweep(loadScene(room()), { grid: 1 })
  assert.ok(report.summary.walkable > 50, 'found walkable floor')
  assert.equal(report.summary.passThrough, 0)
  assert.equal(report.summary.invisibleColliders, 0)
  assert.equal(report.summary.fallThrough, 0)
  assert.equal(report.summary.escapes, 0)
})

test('a wall without a collider is reported as pass-through', () => {
  const report = sweep(loadScene(room(null, 'east')), { grid: 1 })
  assert.ok(types(report).has('pass_through'))
  assert.ok(report.summary.passThrough > 0)
})

test('a floor without a collider is reported as fall-through', () => {
  const report = sweep(loadScene(room(null, 'floor')), { grid: 1 })
  assert.ok(types(report).has('fall_through'))
  assert.ok(report.summary.fallThrough > 0)
})

test('a missing wall lets the player reach the void', () => {
  const report = sweep(loadScene(room('east', 'east')), { grid: 1 })
  assert.ok(types(report).has('escape'))
  assert.ok(report.summary.escapes > 0)
})

test('collision with nothing visible is reported', () => {
  const scene = room()
  scene.colliders.push({
    type: 'box',
    corners: [
      [4, 0, 4], [6, 0, 4], [6, 0, 6], [4, 0, 6],
      [4, 3, 4], [6, 3, 4], [6, 3, 6], [4, 3, 6]
    ]
  })
  const report = sweep(loadScene(scene), { grid: 1 })
  assert.ok(types(report).has('invisible_collider'))
})

test('primitives convert to triangles', () => {
  assert.equal(
    colliderTriangles({
      type: 'box',
      corners: [
        [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
        [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]
      ]
    }).length,
    12
  )
  assert.equal(colliderTriangles({ type: 'sphere', center: [0, 0, 0], radius: 1 }).length, 32)
  assert.ok(colliderTriangles({ type: 'capsule', a: [0, 0, 0], b: [0, 2, 0], radius: 0.4 }).length > 16)
})

test('invalid scenes fail with a clear error', () => {
  assert.throws(() => loadScene({}), /at least one mesh/)
  assert.throws(() => loadScene({ meshes: [{ positions: [] }] }), /no triangles/)
})

test('cli writes a report and can fail a pipeline', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sweep-'))
  const scenePath = join(directory, 'scene.json')
  const reportPath = join(directory, 'report.json')
  writeFileSync(scenePath, JSON.stringify(room('east', 'east')))

  let status = 0
  try {
    execFileSync(process.execPath, ['src/cli.js', scenePath, `--json=${reportPath}`, '--fail', '--quiet'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      stdio: 'pipe'
    })
  } catch (error) {
    status = error.status
  }

  assert.equal(status, 1, 'exit code signals findings')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  assert.ok(report.summary.escapes > 0)
})
