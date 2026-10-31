#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { loadScene, SceneError } from './scene.js'
import { sweep, formatReport } from './sweep.js'

const USAGE = `sonekk-sweep <scene.json> [options]

  --grid=1.0         sampling step in metres
  --eye=1.4          ray height above the floor
  --rays=16          horizontal rays per sample cell
  --max=20           maximum ray length
  --tolerance=0.15   allowed gap between visible surface and collider
  --json=out.json    write the full report
  --fail             exit code 1 when anything is found, for CI
  --quiet            no text output
`

function parseArgs (argv) {
  const options = {}
  let file = null
  let fail = false
  let quiet = false
  let jsonOut = null

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      file = file ?? arg
      continue
    }
    const [name, value] = arg.slice(2).split('=')
    switch (name) {
      case 'grid': options.grid = Number(value); break
      case 'eye': options.eyeHeight = Number(value); break
      case 'rays': options.rays = Number(value); break
      case 'max': options.maxDistance = Number(value); break
      case 'tolerance': options.tolerance = Number(value); break
      case 'json': jsonOut = value; break
      case 'fail': fail = true; break
      case 'quiet': quiet = true; break
      case 'help': console.log(USAGE); process.exit(0); break
      default: console.error(`unknown option: --${name}`); process.exit(2)
    }
  }

  if (!file) {
    console.error(USAGE)
    process.exit(2)
  }
  return { file, options, fail, quiet, jsonOut }
}

const { file, options, fail, quiet, jsonOut } = parseArgs(process.argv.slice(2))

let scene
try {
  scene = loadScene(JSON.parse(readFileSync(file, 'utf8')))
} catch (error) {
  if (error instanceof SceneError) {
    console.error(`invalid scene: ${error.message}`)
    process.exit(2)
  }
  console.error(String(error?.message ?? error))
  process.exit(2)
}

const report = sweep(scene, options)

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  if (!quiet) console.log(`report written to ${jsonOut}`)
}

if (!quiet) console.log(formatReport(report))

const total = report.findings.length
if (fail && total > 0) process.exit(1)
