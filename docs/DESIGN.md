# DucksFly: Visual Design and Three.js Art Direction

This document describes how DucksFly should look, and how to build that look in code.
It covers both the **3D world** (lights, materials, terrain) and the **2D interface**
(menus, HUD, calibration). For what the game is, see [PRD.md](./PRD.md); for how it
works, see [ARCHITECTURE.md](./ARCHITECTURE.md).

**UI source of truth (interactive mock):**
[frontend/design_prototype/ducksfly-ui-new.html](../frontend/design_prototype/ducksfly-ui-new.html).
Open that file in a browser and use the top switcher (`Mode`, `Menu`, `Calibrate`,
`In-Game`, `Finish`) to preview each screen. The React game at `?view=game` should
converge on this spec.

Terms specific to 3D graphics and lighting are explained the first time they appear, and
collected in the [glossary](#10-glossary) at the end. The 3D library names (three.js,
React Three Fiber, drei) are explained in
[TECH_STACK.md](./TECH_STACK.md#glossary); briefly: three.js draws the 3D world, React
Three Fiber lets us describe that world in React, and drei is a set of ready-made helpers
for it.

---

## 1. The Art Direction in One Sentence

Bright, friendly, low-poly. "Low-poly" means 3D shapes built from a small number of flat
faces, so they look clean and simple rather than detailed and realistic, like folded
paper or a children's toy. The reference points are games like Crossy Road, Alto's
Odyssey, and Monument Valley, not photorealism. Above all, everything must read clearly
on a projector from across a room.

### The four guiding principles

1. Readability over detail. A duck seen from far away must still clearly be a duck.
   That means strong, recognizable shapes, high color contrast, and no fine surface
   detail that turns to noise at a distance.
2. Flat shading. We keep the hard, faceted look of low-poly geometry rather than
   smoothing it. The lighting, not the textures, creates the sense of form.
3. One warm key light plus soft fill light. A single main light acts as the sun, and two
   gentle fill lights keep the shadows from going pure black. This is cheap to render and
   looks consistent everywhere.
4. Depth through fog, not detail. Distant shapes fade into the sky color. This lets us
   keep the geometry simple and still feel like a wide-open sky.

---

## 2. Color Palette

A small, warm, bright palette. These are the design tokens (named, reusable color values
that the whole project refers to, so colors stay consistent).

| Role | Hex value | Where it is used |
|---|---|---|
| Sky, top | `#7EC8FF` | the top of the sky gradient |
| Sky, horizon | `#D7F0FF` | the horizon; the fog and background blend to this |
| Sun / main light | `#FFF4D6` | the warm color of the main light |
| Ambient fill | `#BFE3FF` | a soft, cool global fill light |
| Ground / grass | `#8FCB6B` | terrain |
| Water | `#4FA3D1` | rivers and sea, slightly see-through |
| Sand / land edge | `#E8D9A8` | beaches and paths |
| Forest | `#5E9E58` | tree canopies |
| Ring, active | `#FFC93C` (glowing) | boost rings, made to glow so they stand out against the sky |
| Ring, passed | `#9AA7B0` | a ring after you have flown through it (dimmed) |
| Duck, male | from `mallard-male.png` | green head, brown body |
| Duck, female | from `mallard-female.png` | brown |
| Danger / crash | `#FF5C5C` | the flash on a crash, and hazard accents |
| Ring orange (UI accent) | `#FF8A1F` | rings, primary CTAs, brand emphasis in `Fly` |
| Cyan (solo / camera) | `#29C2E8` | single-player and camera-mode accents |
| Green (success / tracking) | `#57B94F` | calibration checks, “tracking” states |
| UI text on bright panels | `#20303F` | slate body text on cream cards |
| UI text muted | `#5E7184` | secondary copy on bright panels |
| Bright panel fill | `#F4F9FD` | menus, modals, finish card |
| HUD panel fill | `rgba(16,27,38,.72)` | in-game overlays over the 3D scene |
| HUD text | `#EAF6FF` | primary copy on dark HUD panels |
| HUD text muted | `#9FC0D4` | labels and secondary HUD copy |
| Page sky wash | `#BFE1F7` | full-screen backdrop behind bright UI |

Keep 3D colors in one file (for example `src/theme/palette.ts`) so the sky, the fog, and
the lights all refer to the same horizon color. That shared color is what makes the depth
illusion work (see section 3). UI tokens should live beside them (or in
`src/game/ui.tsx` CSS variables) so menus and HUD stay aligned with the prototype.

---

## 3. Lighting Setup (the heart of the look)

Low-poly art succeeds or fails on its lighting. The whole world uses one set of three
lights, applied once at the top of the scene. Do not add separate lights to individual
objects.

First, the three terms, in plain language:
- Ambient light: a flat light that hits everything equally from all directions. It has no
  direction and casts no shadows. Its job is to keep shadowed areas from being pure
  black.
- Hemisphere light: a light with a sky color coming from above and a ground color coming
  from below, blending in between. It cheaply imitates the way real outdoor light bounces
  off the sky and the ground. This is the secret ingredient for nice low-poly shading.
- Directional light: a light that shines in one direction with parallel rays, like the
  sun. It is the only light that casts shadows in our setup.
- Fog: a setting that fades objects to a chosen color as they get farther away. We set
  the fog color to the horizon color so distant geometry melts into the sky.

```mermaid
flowchart LR
    AMB["Ambient light<br/>(soft global base,<br/>no shadows)"] --> SCENE["The scene"]
    HEMI["Hemisphere light<br/>(sky color above,<br/>ground color below)"] --> SCENE
    SUN["Directional light, the 'sun'<br/>(warm, the only shadow caster)"] --> SCENE
    FOG["Fog<br/>(fades distance into the sky color)"] --> SCENE

    classDef l fill:#FFF3D6,stroke:#C99A2E,color:#3A2E10
    classDef s fill:#EAF4FF,stroke:#3D7DBF,color:#10212F
    class AMB,HEMI,SUN,FOG l
    class SCENE s
```

| Light | Its job | Rough settings |
|---|---|---|
| Ambient light | Lifts shadows so nothing is pure black | color `#BFE3FF`, intensity about 0.4 |
| Hemisphere light | Free-looking outdoor fill; does most of the shading | sky `#9FD8FF`, ground `#8FCB6B`, intensity about 0.6 |
| Directional light (the sun) | The single warm main light and the only shadow caster | color `#FFF4D6`, intensity about 1.2, position `[-40, 60, 30]` |
| Fog | Fades distant geometry into the sky | color equals the horizon `#D7F0FF`, starts near 60, fully faded by 300 |

### How to build it in React Three Fiber

```tsx
import { Sky } from '@react-three/drei'

function WorldLighting() {
  return (
    <>
      {/* Soft global base so faces in shadow stay readable */}
      <ambientLight color="#BFE3FF" intensity={0.4} />

      {/* Sky-above, ground-below fill: does most of the low-poly shading for free */}
      <hemisphereLight color="#9FD8FF" groundColor="#8FCB6B" intensity={0.6} />

      {/* The sun: one warm main light, the only shadow caster */}
      <directionalLight
        color="#FFF4D6"
        intensity={1.2}
        position={[-40, 60, 30]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
    </>
  )
}

// At the top-level Canvas:
// <Canvas shadows camera={{ fov: 60, near: 0.1, far: 320, position: [0, 4, 10] }}>
//   <color attach="background" args={['#D7F0FF']} />
//   <fog attach="fog" args={['#D7F0FF', 60, 300]} />
//   <Sky sunPosition={[-40, 60, 30]} turbidity={2} rayleigh={0.6} />
//   <WorldLighting />
//   ...
// </Canvas>
```

Why one directional light and not several: every extra shadow-casting light multiplies
the rendering cost and tends to look muddy on flat-shaded shapes. One angled sun gives
clean, readable shading. Make the visible sun (drei's `<Sky sunPosition>`) match the
directional light's position so the bright spot in the sky agrees with where the shadows
fall.

Shadow budget (keeping shadows cheap):
- Only one light casts shadows (the sun). Everything else has shadows turned off.
- A 2048-by-2048 shadow map is plenty of resolution. Drop to 1024 if the frame rate dips
  with eight ducks on screen. (A "shadow map" is an off-screen image the renderer uses to
  work out what is in shadow; bigger means sharper but slower.)
- Fit the shadow camera bounds tightly around the play area. A shadow region larger than
  needed wastes resolution and makes shadows both blurrier and slower.

---

## 4. Materials and Shading (the low-poly rules)

A "material" describes how a surface looks: its color and how it responds to light.

| Rule | Why |
|---|---|
| Use a standard material with flat shading turned on | Flat shading keeps the hard faceted faces that define the low-poly look, while still reacting correctly to the light setup. |
| No metalness, medium roughness (metalness 0, roughness about 0.8) | This gives a matte, paper-like surface with no shiny highlights. ("Metalness" and "roughness" are the two main sliders of a standard material: metalness controls how metal-like a surface is, roughness controls how sharp or soft its reflections are.) |
| Use simple colors or tiny texture images, not detailed photo textures | Keeps the look flat and cheap to render. The duck uses a 32-by-32-pixel color image. |
| Use nearest-neighbor filtering on those tiny images | This keeps the color blocks crisp instead of smearing them into a blur. ("Filtering" is how the renderer scales a small image up; nearest-neighbor picks the closest pixel, preserving hard edges.) |
| Flip the vertical orientation off for textures that came from FBX files | FBX files expect their images oriented this way; otherwise textures appear upside down. |
| Avoid bump, roughness, and similar detail maps entirely | They fight the flat look and cost memory. |

### The duck specifically

The rigged mallard's assets are at
[frontend/public/models/duck/](../frontend/public/models/duck/); its loader,
[loadDuck.ts](../frontend/src/world/loadDuck.ts), is already set up to these rules:

- Its texture is a 32-by-32-pixel color image (`mallard-male.png` or
  `mallard-female.png`). Importantly, the texture is not stored inside the model file; the
  loader applies it, using nearest-neighbor filtering and the FBX orientation fix.
- It uses metalness 0 and roughness about 0.8, so it is matte and reads well under the
  light setup.
- Two appearances ship for the picker: male (green head) and female (brown).

Warning: load the duck through `loadDuck.ts`, not with a raw model loader. The raw model
renders white because its texture lives in a separate file. See the model's
[README](../frontend/public/models/duck/README.md).

---

## 5. The Duck: Animation Design

The duck carries 22 animation clips packed into a single timeline, which the loader
slices apart using [animations.json](../frontend/src/world/animations.json). Map
them to flight states like this:

```mermaid
stateDiagram-v2
    [*] --> Idle: on the ground
    Idle --> TakeOff: a flap is detected
    TakeOff --> Flying: now airborne
    Flying --> TurnLeft: leaning left
    Flying --> TurnRight: leaning right
    Flying --> Gliding: stopped flapping (descending)
    Gliding --> Flying: flapping again
    Flying --> Landing: near the ground
    Landing --> Idle
```

| Game state | Clip or clips | Loops? |
|---|---|---|
| On the ground, waiting | `idle_1`, `idle_2`, `sitting_idle_1`, `sitting_idle_2` | yes |
| Taking off | `take_off` | plays once |
| Flapping and climbing | `flight_straight` | yes |
| Banking | `flight_turn_left`, `flight_turn_right` | yes |
| Gliding and descending | `glide_straight`, `glide_turn_left`, `glide_turn_right` | yes |
| Slow, holding position | `hover_flight` | yes |
| Landing | `touch_down`, `water_touch_down` | plays once |
| On water | `swim_straight`, `swim_left`, `swim_right`, `water_idle_1` | yes |

- Crossfade between clips (blend over about a quarter second) so transitions look smooth.
  The loader's `play()` function does this. ("Crossfade" means blending the end of one
  animation into the start of the next instead of snapping between them.)
- There is no quack animation in the model. Drive the quack with a head or beak movement,
  a small visual effect, and a sound. Do not look for a quack clip; it does not exist.

---

## 6. Building the Environment

The world is built from the server's map recipe (the seed; see
[ARCHITECTURE.md](./ARCHITECTURE.md#6-how-the-world-is-built-from-one-number)). It is
layered to create a sense of depth.

```
+---------------------------------------------------------------+
|  Sky: a gradient from light blue at the top to pale at horizon |
|     The sun disc, positioned to match the main light          |
|        Low-poly cloud blocks, drifting slowly                  |
|     Glowing boost rings along the flight path                  |
|  Water (slightly see-through)   Forest   Hills (fading to fog) |
|  The ground fades into fog at the horizon                      |
+---------------------------------------------------------------+
```

| Element | Approach |
|---|---|
| Sky | drei's `<Sky>` gradient, with its sun position matched to the directional light |
| Clouds | Low-poly cloud shapes, drawn as instances (see note below), drifting gently |
| Terrain | A low-poly height map built from the seed, flat-shaded, with grass, sand, and forest color bands |
| Water | A single see-through plane with a subtle wobble; no reflections |
| Rings | Ring (torus) shapes with a glowing active color so they pop against the sky; dimmed once passed |
| Props | Trees and rocks placed by the seed and drawn as instances; keep the counts modest |
| Horizon | Anything past the fog distance is simply sky color, so no geometry is needed out there |

Performance budget (this must hold up with eight ducks at a smooth frame rate):
- Draw repeated objects (clouds, trees) as "instances." Instancing means drawing many
  copies of the same shape in a single, cheap operation instead of one expensive
  operation per copy.
- Only one light casts shadows.
- Keep the total number of separate draw operations modest (a few hundred at most).
- For other players' ducks, draw the same model but do not run their physics; just smooth
  their incoming positions (interpolation; see the
  [PRD glossary](./PRD.md#11-glossary)).
- Profile early. The real budget is MediaPipe plus the 3D rendering plus eight ducks all
  running on one machine at once (see [PRD.md](./PRD.md#10-risks-and-how-we-handle-them)).

---

## 7. The Interface (Low-Poly UI)

The 2D layer uses a **low-poly UI** language that matches the 3D world: faceted clip
corners, warm orange ring accents, cyan solo/camera accents, and a bright daytime sky
behind menus. **Two surface treatments** keep play readable:

| Surface | When | Look |
|---|---|---|
| **Bright panels** | Menus, mode picker, calibration, finish card | Cream `#F4F9FD` cards, dark slate text, “pressed” gradient buttons |
| **Dark HUD panels** | Anything over the live 3D scene | Translucent navy `rgba(16,27,38,.72)`, light text, mono stats |

Simulation stays in WebGL; text-heavy UI stays in **DOM** (see
[ARCHITECTURE.md](./ARCHITECTURE.md)). Do not draw HUD labels in the canvas unless there
is a strong reason.

### 7.1 Visual language

- **Faceted corners:** panels and buttons use a clipped corner (13px chamfer), not plain
  `border-radius`, via a shared `--cut` clip-path polygon.
- **Depth on buttons:** primary buttons use a 4px “physical” press: resting shadow
  `0 6px 0 rgba(20,40,60,.18)`, active state shifts down 4px.
- **Brand mark:** low-poly duck SVG beside the wordmark; “Fly” in orange
  (`#FF8A1F`), rest of title in white with a soft shadow (readable on sky).
- **Background:** procedural low-poly sky mesh (triangulated gradient + block clouds +
  faceted hills + floating orange rings). A light grain overlay (~5% opacity) adds
  texture. The in-game HUD screen uses a simpler static sky gradient as placeholder
  until the live scene shows through.
- **Motion:** staggered `rise` entrance (0.5s, cubic-bezier `.2,.7,.3,1`) on menu
  blocks; respect `prefers-reduced-motion` (disable entrance and ambient loops).
- **Desktop-first:** below 980px width, hide the game UI and show a single message:
  “This is a desktop experience.”

### 7.2 Typography

Load from Google Fonts (see prototype `<head>`):

| Role | Family | Weights | Use |
|---|---|---|---|
| Display | **Fredoka** | 500, 600, 700 | Titles, buttons, card headings |
| Body | **Outfit** | 400–800 | Paragraphs, form labels |
| Mono | **JetBrains Mono** | 400, 500, 700 | HUD stats, invite codes, key caps |

```html
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

### 7.3 UI color tokens (CSS)

These mirror `:root` in the prototype:

```css
:root {
  --orange: #ff8a1f;       /* rings, primary CTA, brand accent */
  --orange-deep: #f06d10;
  --cyan: #29c2e8;         /* solo / camera */
  --cyan-deep: #15a6cc;
  --green: #57b94f;        /* success, tracking */
  --green-deep: #3f9a3f;

  --slate: #20303f;        /* text on bright panels */
  --slate-dim: #5e7184;
  --cream: #f4f9fd;        /* bright panel fill */
  --line-d: rgba(32, 48, 63, 0.12);

  --hud: rgba(16, 27, 38, 0.72);
  --hud-line: rgba(180, 225, 255, 0.2);
  --hud-txt: #eaf6ff;
  --hud-dim: #9fc0d4;

  --r: 13px;
  --cut: polygon(0 var(--r), var(--r) 0, 100% 0, 100% calc(100% - var(--r)),
    calc(100% - var(--r)) 100%, 0 100%);
  --shadow: 0 20px 44px -20px rgba(20, 40, 60, 0.5);

  --f-disp: "Fredoka", system-ui, sans-serif;
  --f-body: "Outfit", system-ui, sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

**Button variants**

| Class | Fill | Text | Use |
|---|---|---|---|
| `btn-orange` | gradient orange → orange-deep | white | Primary actions (start, fly again) |
| `btn-cyan` | gradient cyan → cyan-deep | white | Camera / solo emphasis |
| `btn-ghost` | white + border | slate | Secondary (keyboard, menu) |

### 7.4 Components

| Component | Rules |
|---|---|
| **Card** | `background: var(--cream)`, `clip-path: var(--cut)`, top gloss gradient overlay |
| **Key cap** | White chip, mono font, mini chamfer, `0 2px 0` shadow — control hints |
| **Hints bar** | Inline key caps separated by `·`; slate-dim labels |
| **Check row** (calibration) | White row, diamond status icon (green = ok, grey = wait) |
| **Gauge** | Chamfered track; fill animates green → cyan for flap test |
| **HUD panel** | `hpanel`: dark fill, blur, chamfer, mono rows with label / value |
| **Stat block** | Large mono number (time = cyan, rings = orange) + small caps label |

### 7.5 Screens (prototype → React)

| Prototype `#id` | React component(s) | Notes |
|---|---|---|
| `mode` | `ModeChooser` | Overlays start menu until camera vs keyboard is chosen |
| `menu` | `StartMenu` | Single / multiplayer cards; hints bar at bottom |
| `calib` | `WebcamPanel` / calibration flow | Two-column: live cam + checklist + flap gauge |
| `hud` | `RaceHud`, `SinglePlayerGame` debug HUD | See layout below; multiplayer also uses lobby/results overlays |
| `finish` | `FinishedWaitingScreen`, `ResultsScreen` | Finish card: time, rings, distance, fly again / menu |

**Not in the HTML prototype but required in the shipped game:** `ConnectScreen` (host/join),
`LobbyScreen` (invite code, roster, ready/start). Style them as **bright panels** like
`mode` / `menu`, not dark HUD.

### 7.6 In-game HUD layout

Keep the **center and lower-middle of the viewport clear** during flight. Persistent chrome
should cover roughly **≤25%** of the viewport on desktop.

```
+------------------------------------------------------------------+
| [FLIGHT telemetry]     [ TIME ] [ RINGS ]     [mode][debug][menu]|
|  speed, alt, input      top-center goals       top-right controls |
|                                                                   |
|                         [ NEXT RING ▼ ]                          |
|                         (compass, center-top)                     |
|                                                                   |
| [YOUR WINGS / flap power]              [ Space · A/D · W hints ]   |
|  bottom-left (camera mode)              bottom-center pill       |
+------------------------------------------------------------------+
```

| Zone | Content |
|---|---|
| Top-left | `FLIGHT` block: speed, altitude, distance; `INPUT` block: flap, lean, dive, confidence |
| Top-center | Two stat chips: **TIME** (cyan), **RINGS** (orange, e.g. `3/12`) |
| Top-right | Control mode toggle, debug flag, back to menu |
| Center-top | “Next ring” chevron + label (optional; hide when no target) |
| Bottom-left | Camera-only: skeleton preview + flap power gauge |
| Bottom-center | Keyboard/camera hints (single compact pill) |

**Multiplayer additions** (not all shown in prototype HUD mock):

- Top-center **finish banner** when someone crosses the line (grace countdown).
- Top-right **leaderboard** list during race (keep narrow; scroll if >4 players).
- Full-screen **countdown** overlay: large mono numerals, `GO!` in green.

### 7.7 3D ↔ UI consistency

| 3D element | UI echo |
|---|---|
| Orange boost rings | `--orange` on HUD ring count, compass, CTAs |
| Daytime sky gradient | Page background and bright-screen wash `#BFE1F7` |
| Low-poly terrain | Faceted panel corners and SVG duck mark |
| Cyan water / cool accents | Camera mode, time stat |
| Green grass | Success checks, tracking indicator |

Nameplates above remote ducks remain **3D** (billboard text), not DOM HUD.

### 7.8 Easter egg

The “six-seven” hand sign still triggers a punchy on-screen **6-7** with sound when
detected; style it with display font and orange accent so it fits the UI kit.

---

## 8. Design Tokens: Quick Reference for Implementers

### 3D world (`src/theme/palette.ts`)

```ts
// Single source of truth for sky, fog, and lights
export const SKY_TOP     = '#7EC8FF'
export const SKY_HORIZON = '#D7F0FF'  // also fog AND Canvas background
export const SUN_COLOR   = '#FFF4D6'
export const AMBIENT     = '#BFE3FF'
export const HEMI_SKY    = '#9FD8FF'
export const HEMI_GROUND = '#8FCB6B'
export const RING_ACTIVE = '#FFC93C'  // 3D ring mesh (close to UI --orange)
export const DANGER      = '#FF5C5C'

export const SUN_POSITION: [number, number, number] = [-40, 60, 30]
export const FOG_NEAR = 60
export const FOG_FAR  = 300
```

The golden rule: the background color, the fog color, and the `<Sky>` horizon must all be
the same value. When they match, low-poly geometry melts into the horizon and the world
feels huge for almost no extra geometry.

### 2D UI (target: `src/game/ui.tsx` or shared `src/theme/ui.css`)

```ts
export const UI = {
  orange: '#ff8a1f',
  orangeDeep: '#f06d10',
  cyan: '#29c2e8',
  cyanDeep: '#15a6cc',
  green: '#57b94f',
  slate: '#20303f',
  slateDim: '#5e7184',
  cream: '#f4f9fd',
  hudBg: 'rgba(16,27,38,0.72)',
  hudText: '#eaf6ff',
  hudDim: '#9fc0d4',
  skyWash: '#bfe1f7',
  radius: 13,
  shadow: '0 20px 44px -20px rgba(20, 40, 60, 0.5)',
} as const

export const FONTS = {
  display: '"Fredoka", system-ui, sans-serif',
  body: '"Outfit", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
} as const
```

Implement `--cut` clip-path and button press shadows once in `GameUiStyles` (or a CSS
module) and reuse on every panel and button.

---

## 9. Why These Choices

A short summary of the reasoning, so future changes do not accidentally break the look.

- Flat shading and simple colors are chosen because they read clearly at a distance and
  on a projector, which is the demo environment, and because they are cheap to render,
  which leaves performance headroom for body tracking and eight players.
- One sun plus two soft fill lights is chosen because multiple shadow-casting lights are
  both slower and muddier on faceted shapes; one angled light gives clean form.
- Fog matched to the horizon is chosen because it creates depth and a sense of scale for
  free, letting the geometry stay simple.
- Instancing repeated objects is chosen because the performance budget is tight: body
  tracking, rendering, and eight ducks share one machine.

---

## 10. Glossary

- Low-poly UI: 2D interface that echoes low-poly 3D — chamfered panels, flat color
  blocks, and simple shadows instead of glassmorphism or SaaS dashboard layouts.
- Bright panel / dark HUD: the two UI surfaces; cream cards for flows, navy overlays
  for in-game stats.
- Clip-path chamfer: cutting a corner off a rectangle with CSS `clip-path: polygon(...)`
  instead of rounding with `border-radius`.
- Design tokens: named, reusable values (colors, fonts, radii) shared across components.
- Low-poly: 3D shapes made of relatively few flat faces, for a clean, simple,
  toy-or-papercraft look rather than realism.
- Flat shading: rendering that keeps each face a single, flat tone, preserving the hard
  faceted edges of low-poly geometry (as opposed to smooth shading that hides them).
- Material: the description of how a surface looks, including its color and how it
  reacts to light.
- Metalness and roughness: the two main controls of a standard material. Metalness sets
  how metal-like a surface is; roughness sets how sharp (low) or soft (high) its
  reflections are. We use metalness 0 and roughness about 0.8 for a matte look.
- Texture: an image wrapped onto a 3D surface to give it color or detail. The duck uses a
  tiny 32-by-32-pixel one.
- Filtering (nearest-neighbor): how the renderer scales an image up. Nearest-neighbor
  keeps hard pixel edges, which suits our tiny color textures.
- Ambient light: a flat, directionless light that lifts shadows so they are not pure
  black.
- Hemisphere light: a light with a sky color from above and a ground color from below,
  imitating bounced outdoor light.
- Directional light: a sun-like light with parallel rays shining in one direction; in our
  setup it is the only light that casts shadows.
- Fog: a setting that fades distant objects to a chosen color; we use the horizon color.
- Shadow map: an off-screen image the renderer uses to figure out what is in shadow.
  Larger is sharper but slower.
- Instancing: drawing many copies of the same shape in one cheap operation instead of one
  operation per copy. Used for clouds and trees.
- Crossfade: blending smoothly from one animation into the next rather than snapping
  between them.
- Rigged: a model that has an internal skeleton, which is what lets it be animated.
- Draw operation (draw call): one instruction to the graphics hardware to draw something.
  Fewer is faster, which is why we instance repeated objects.
