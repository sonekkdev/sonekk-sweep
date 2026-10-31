# Sonekk Sweep

[![ci](https://github.com/sonekkdev/sonekk-sweep/actions/workflows/ci.yml/badge.svg)](https://github.com/sonekkdev/sonekk-sweep/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-PolyForm%20Small%20Business-blue)

Offline map checker for Unity VR levels. Export the scene, run one command, get a list of holes, missing colliders, fall-through floors, invisible walls and open edges, each with coordinates.

No engine, no GPU, no dependencies. It is a raycasting grid over your geometry, so the result is reproducible and it runs in CI.

```
scene: broken-room
cells 100, walkable 96, reachable 96
pass-through 0, invisible 0, fall-through 1, floor mismatch 0, escapes 1
  escape at 3.5, 0, 4.5 (nothing solid within 25 m in at least one direction)
  fall_through at 4.5, 0, 4.5 (no collider on the visible floor, nearest solid is at 3)
```

## Why

Players find the holes you missed, usually on launch day. Most of them are not subtle: a wall with no collider, a floor you fall through, a gap that lets you leave the map. Those are geometry facts, not opinions, so a machine can find them.

## Quick start

```bash
npm install -g sonekk-sweep
sonekk-sweep examples/broken-room.json
```

Or from a checkout:

```bash
node src/cli.js examples/broken-room.json
```

### Exporting from Unity

1. Copy `unity/Editor/SonekkSweepExport.cs` into `Assets/Editor/`
2. **Tools, Sonekk Sweep, Export Scene**
3. Save `sweepmap.json` and run the CLI on it

The exporter bakes transforms to world space, so meshes and colliders arrive already positioned. It reads `MeshFilter`, `MeshCollider`, `BoxCollider`, `SphereCollider` and `CapsuleCollider`.

## What it checks

| Finding | Meaning |
| --- | --- |
| `pass_through` | You can see a surface but there is no collider behind it. The wall you walk through. |
| `fall_through` | The floor is rendered, the collision is missing or lower. The hole you fall into. |
| `invisible_collider` | Collision where nothing is visible. The invisible wall that blocks a doorway. |
| `floor_mismatch` | Visible floor and collider floor are at different heights. |
| `escape` | From a spot you can walk to, nothing solid within range in some direction. You can leave the map. |

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--grid=1.0` | 1 m | sampling step |
| `--eye=1.4` | 1.4 m | ray height above the floor |
| `--rays=16` | 16 | horizontal rays per sample |
| `--max=20` | 20 m | ray length |
| `--tolerance=0.15` | 15 cm | allowed gap between surface and collider |
| `--json=out.json` | off | write the full report |
| `--fail` | off | exit 1 when anything is found, for CI |
| `--quiet` | off | no text output |

Example CI gate:

```yaml
- run: npx sonekk-sweep sweepmap.json --fail --quiet
```

## Scene format

```json
{
  "version": 1,
  "name": "level_01",
  "spawn": [0, 0, 0],
  "meshes": [{ "name": "walls", "positions": [0,0,0, 1,0,0, 1,3,0], "indices": [0,1,2] }],
  "colliders": [
    { "type": "mesh", "positions": [...], "indices": [...] },
    { "type": "box", "corners": [[x,y,z], "8 corners total"] },
    { "type": "sphere", "center": [0,1,0], "radius": 1 },
    { "type": "capsule", "a": [0,0,0], "b": [0,2,0], "radius": 0.4 }
  ]
}
```

## Ignore regions

Intentional holes, windows and decoration will be reported. Mark them so the report keeps its signal:

```js
sweep(scene, { ignore: [
  { type: 'pass_through', min: [12, 0, 0], max: [12, 3, 4], reason: 'glass window' }
]})
```

`type` is optional, coordinates are world space, anything inside the box is dropped before clustering.

## Limits, honestly

- Floors are found by casting up from below, so only the **lowest floor per column** is tested. Multi storey maps need one export per floor or a smaller sampling area.
- Sphere and capsule colliders are approximated by polygons, which can under report by a few centimetres at the edges.
- Rays are horizontal. Slopes, stairs and crouch spaces are not evaluated.
- It checks geometry and state, not gameplay: no logic bugs, no balance, no fun.
- Intentional holes (windows, decoration without collision) will be reported. Use `--tolerance` and ignore lists per level.

## Development

```bash
npm test
```

Eight tests build synthetic rooms: sealed, missing wall collider, missing floor collider, open wall, invisible box, primitive conversion, invalid input, and the CLI contract.

## License

PolyForm Small Business 1.0.0. Free for companies under 100 people and under 1M USD revenue. See [LICENSE](LICENSE).

Required Notice: Copyright 2026 sonekkdev (https://github.com/sonekkdev/sonekk-sweep)
