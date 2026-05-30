# Mallard Duck model

The player avatar for DucksFly. Imported from the Unity Asset Store package
**"Low Poly Bird: Mallard Duck"** (productId 231310, v1.0) and stripped down to
the web-relevant files only — all Unity engine glue (`.meta`, `.cs`, `.mat`,
`.prefab`, `.controller`, the demo scene) was removed.

## Files
| File | What it is |
|---|---|
| `mallard-duck.fbx` | Rigged mesh + skeleton + all animations (3.7 MB, FBX 7400 binary) |
| `mallard-male.png` | Male (green-head) texture — 32×32 color atlas |
| `mallard-female.png` | Female (brown) texture — 32×32 color atlas |
| `animations.json` | Frame ranges that slice the single FBX take into 22 named clips |
| `loadDuck.ts` | Loader: applies the texture + re-slices the clips for three.js |

## Two things that will bite you if you don't know them

1. **Textures are NOT embedded in the FBX.** Unity bound them via `.mat` files
   that we deleted. You must apply the PNG yourself in code (`loadDuck.ts` does
   this). Without it the duck renders untextured/white.

2. **All 22 animations live in ONE timeline.** The FBX has a single take
   (`Bird_Rig|MallardDuckAnimation`, 1812 frames). three.js `FBXLoader` gives
   you that one long clip — it can't read Unity's clip split. `loadDuck.ts`
   re-slices it with `THREE.AnimationUtils.subclip` using `animations.json`.

## Usage

```ts
import { loadDuck } from '/models/duck/loadDuck' // adjust import to your setup

const duck = await loadDuck('male')   // or 'female'
scene.add(duck.scene)
duck.play('idle_1')

// render loop:
duck.update(delta)

// when MediaPipe reports a flap:
duck.play('flight_straight')
```

Requires `three` (`npm i three @types/three`). For react-three-fiber, wrap
`duck.scene` in `<primitive object={duck.scene} />` and drive `duck.update(dt)`
from `useFrame`.

## Animation clips (mapped to DuckActions)
- **Air:** `flight_straight`, `flight_turn_left`, `flight_turn_right`,
  `glide_straight`, `glide_turn_left`, `glide_turn_right`, `hover_flight`
- **Transitions (one-shot):** `take_off`, `touch_down`, `water_take_off`,
  `water_touch_down`, `sit_down`, `stand_up`
- **Water:** `swim_straight`, `swim_left`, `swim_right`, `water_idle_1`
- **Ground:** `walk`, `idle_1`, `idle_2`, `sitting_idle_1`, `sitting_idle_2`

> No `quack` clip exists in this pack — the mouth/quack action (Person A) has no
> matching skeletal animation; drive it via a mouth bone, blendshape, or VFX.
