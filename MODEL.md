# Model Reference

## Overview

```
DrillStore
  ├── dataA: Drill[]
  ├── dataB: Drill[]
  └── dataC: Drill[]

Drill { name, steps: Step[], random }

Step
  ├── variants: Ball[]   ← pool, pick one randomly each rep
  └── ball: Ball         ← single fixed ball

Ball { height, drop, frequency, reps, speed, spin, type, scatter, delay }
```

---

## `Ball`

A single ball configuration — the atomic unit sent to the robot.

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `height` | int | -50..100 | Launch height |
| `drop` | number | -10..10 | Landing position offset (0.5 steps) |
| `frequency` | int | 30–120 | Balls per minute (BPM) |
| `reps` | int | 1–200 | Repetitions |
| `speed` | number | 0–10 | Abstract speed level |
| `spin` | number | 0–10 | Spin intensity |
| `type` | string | `"top"`\|`"back"` | Spin direction |
| `scatter` | number | 0–10 | Random drop variation |
| `delay` | int | 0+ ms | Per-ball send delay |

### Derived RPMs

`topRPM` / `bottomRPM` are NOT stored — they are computed on demand via `getRPMs()`.

```
baseSpeed = 970 + 630.5 × speed
spinFactor = 342 × spin

type = 'top':   topRPM = baseSpeed + spinFactor,  bottomRPM = baseSpeed - spinFactor
type = 'back':  topRPM = baseSpeed - spinFactor,  bottomRPM = baseSpeed + spinFactor
```

---

## `Step`

One position in a drill sequence. Two mutually exclusive modes.

| Field | Type | Description |
|-------|------|-------------|
| `variants` | Ball[] | Pool of candidates — pick one randomly each rep |
| `ball` | Ball \| null | Single fixed ball — fires every rep |

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Variant** | `variants.length > 0` | Random ball from pool |
| **Single** | `ball !== null` | The single ball |
| **Empty** | neither | Nothing fires |

---

## `Drill`

A named drill with an ordered sequence of steps.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `steps` | Step[] | Ordered step sequence |
| `random` | boolean | Shuffle step order during execution |

---

## `DrillStore`

Flat drill storage grouped by category A/B/C.

| Field | Type | Description |
|-------|------|-------------|
| `dataA` | Drill[] | Category A drills |
| `dataB` | Drill[] | Category B drills |
| `dataC` | Drill[] | Category C drills |

### JSON format

```json
{
  "dataA": [
    {
      "name": "BH Dura",
      "steps": [
        { "variants": [], "ball": { "height": 50, "drop": 0, "speed": 2, "spin": 2, "type": "top" } },
        { "variants": [{}, {}], "ball": null }
      ],
      "random": false
    }
  ],
  "dataB": [],
  "dataC": []
}
```
