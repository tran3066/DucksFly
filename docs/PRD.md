# DucksFly: Product Requirements Document

One-liner: Flap your arms in front of your webcam and fly a duck through a 3D
obstacle race against up to seven other people. There is no controller. Your body
is the controller.

- Status: Draft for a 24-hour hackathon build
- Audience: The judges who will score the demo, and the four-person team building it
- Related docs: [ARCHITECTURE.md](./ARCHITECTURE.md) (how it works),
  [DESIGN.md](./DESIGN.md) (how it looks), [TECH_STACK.md](./TECH_STACK.md) (what it is built with)

---

## 1. The Pitch

You stand up. You flap your arms. On screen, a low-poly mallard duck beats its wings
and climbs into a bright sky. You lean your body left, the duck banks left. You stop
flapping, the duck drops. You aim for a glowing ring, fly through it, and get a burst
of speed. Seven other ducks are doing the same thing around you, and the first one
across the finish line wins.

The important part: there is no keyboard, no game controller, and no phone. A normal
laptop webcam watches your body and turns your real movements into flight. You flap to
go up, you lean to turn, you stop to come down. Open your mouth and the duck quacks.

It runs entirely in a web browser tab. Anyone with a laptop and a webcam can play in
about ten seconds with no installation.

### Why this wins in a demo room
- It produces an instant reaction. A judge physically flaps their arms and a duck
  flies. That moment is the whole product, and it reads clearly to everyone watching.
- There is nothing to install. It is a web address. A judge plays on their own laptop
  immediately.
- The multiplayer is the spectacle. Eight people flapping their arms in the same room,
  racing each other live, is memorable.
- It is technically credible. Reading a person's body from a webcam in real time,
  simulating flight, and synchronizing eight players over a network, all inside a
  browser, is a genuinely hard set of problems solved together.

---

## 2. The Problem and the Insight

Motion-controlled games (games you play with your body instead of a controller) have
mostly disappeared from everyday life. The hardware that powered them is gone or
inconvenient: the Microsoft Kinect camera is discontinued, and virtual-reality
headsets are expensive and require setup.

The insight: every laptop already ships with a webcam, and modern browsers are now fast
enough to figure out where a person's arms, shoulders, and head are, in real time, from
that webcam, with no extra hardware. Almost nobody is using that capability to make a
fun, instantly-shareable, multiplayer game.

DucksFly turns the webcam everyone already owns into a full-body game controller, with
no download and no peripherals. The duck is the hook that makes people smile. The
body-as-controller is the part that is genuinely hard to copy.

---

## 3. Who Plays It (Personas)

We design against three concrete people. Naming them keeps the user stories honest.

- Maya, the first-time player and judge. She has never seen the game. She has a
  laptop, a webcam, and about a minute of patience. Success means she is flying and
  smiling before anyone explains anything.
- Leo, the booth host. He runs the demo. He needs to start races, get newcomers in
  fast, and recover quickly if something goes wrong in front of a crowd.
- Sam, the returning player. Sam has raced once and wants to win the next one. Sam
  cares about tight turns, ring timing, and beating friends.

A fourth, internal persona is the team itself (the four developers). Their needs show
up as the "developer stories" in section 5.7, because the shared data contracts have to
exist before anyone can build against them.

---

## 4. The Core Gameplay Loop

This is the cycle a player repeats. Everything in the product exists to serve it.

```mermaid
flowchart LR
    A[Stand at<br/>the webcam] --> B[Flap to<br/>take off]
    B --> C[Flap to climb,<br/>lean to turn,<br/>stop to descend]
    C --> D[Fly through rings<br/>for a speed boost]
    D --> E[Avoid other ducks;<br/>a crash respawns you]
    E --> F[Cross the finish line]
    F --> G[See your rank,<br/>then race again]
    G --> B
    classDef step fill:#EAF4FF,stroke:#3D7DBF,color:#10212F
    class A,B,C,D,E,F,G step
```

A race lasts roughly 60 to 120 seconds. There is no tutorial. If you can flap your
arms, you can play.

### Controls: your body maps to the duck

| What you do with your body | What the duck does | How the computer sees it |
|---|---|---|
| Flap your arms up and down | Climbs and speeds up | Camera tracking, watching how fast your arms move |
| Stop flapping | Descends, pulled down by gravity | The absence of arm movement |
| Lean or tilt your torso left or right | Banks and turns that direction | Camera tracking, watching the tilt of your shoulders |
| Tuck your arms in (stretch goal) | A steeper, faster dive | Camera tracking, arm position |
| Open your mouth (stretch goal) | Quacks, with a sound | Camera tracking of your face |
| Make the "six-seven" hand sign (stretch goal) | Triggers a hidden easter egg | Camera tracking of your hands |

The phrase "stretch goal" means a feature we attempt only if the core game is already
working. We will not risk the main experience for these.

Two of the controls are deliberately undecided and will be settled by playtesting (see
section 9). We will build both versions of each and pick whichever feels better.

---

## 5. User Stories

User stories describe a feature from the point of view of the person who benefits, in
the form: "As a [person], I want [something], so that [reason]." Each story below has
acceptance criteria, which are the concrete, checkable conditions that must be true for
the story to count as done.

### 5.1 Epic: Getting into a race quickly

Story 1: Joining without instructions
As Maya (first-time player), I want to start playing without reading anything, so that
I am flying within seconds of sitting down.
- The home screen shows a single obvious way to start ("Play" or similar).
- The only instruction shown is the core idea: flap to fly.
- No account, login, or form is required to play.

Story 2: Granting camera access clearly
As Maya, I want the game to explain why it needs my camera, so that I trust it and turn
the camera on.
- Before requesting the camera, a short, plain message explains that the camera is used
  only to read body movement and is not recorded or uploaded.
- If the camera is denied, the game shows a clear message on how to enable it and does
  not crash.

Story 3: Calibration so the game knows my body
As Maya, I want a quick setup step that learns my body and space, so that flapping and
leaning are read correctly regardless of my height or distance from the camera.
- The game shows a brief calibration pose (for example, stand still with arms out) for
  a few seconds.
- After calibration, a flap reliably reads as a flap and a lean reliably reads as a
  turn for that player.
- Calibration can be redone if the player moves their setup.

### 5.2 Epic: Flying that feels good

Story 4: Flapping to climb
As Maya, I want flapping my arms to make the duck climb, so that the control feels
natural and physical.
- A clear flap makes the duck climb and gain speed.
- Stopping makes the duck descend under gravity.
- The duck reacts with no perceptible delay (the duck's movement is calculated on the
  player's own computer, so it never waits for the network; see
  [ARCHITECTURE.md](./ARCHITECTURE.md#3-who-decides-what)).

Story 5: Leaning to turn
As Sam (returning player), I want leaning my body to bank the duck, so that I can steer
through tight lines and beat other players.
- Leaning left turns the duck left; leaning right turns it right.
- Returning to center flies straight.
- Turning is smooth, not jumpy, even though camera tracking is naturally a little noisy.

Story 6: Forgiving, smooth input
As Maya, I want small accidental movements to be ignored, so that the duck does not
twitch when I am trying to fly straight.
- Tiny or jittery movements below a threshold do not change the duck's path.
- The game smooths the raw camera readings before they affect flight.

### 5.3 Epic: The race itself

Story 7: Rings that reward skill
As Sam, I want flying through rings to give me a speed boost, so that good aim is
rewarded.
- Passing through a ring grants a visible, temporary speed increase.
- A ring that has been passed looks visibly different (for example, dimmed) so players
  know it is spent.
- Rings are in the same place for every player in a race (the world is built from a
  shared recipe; see [ARCHITECTURE.md](./ARCHITECTURE.md#6-how-the-world-is-built-from-one-number)).

Story 8: Crashing and recovering
As Maya, I want a crash to be a small setback rather than the end, so that one mistake
does not ruin my race.
- Colliding with another duck causes a brief spin-out and a respawn at the last
  checkpoint reached.
- Respawning is fast and obvious, so the player understands what happened.
- Whether two players actually collided is decided by the server, so both players agree
  on the outcome (see [ARCHITECTURE.md](./ARCHITECTURE.md#3-who-decides-what)).

Story 9: Knowing where I am in the race
As Sam, I want to see my speed and my rank, so that I know how I am doing and push
harder.
- The screen shows current speed, current rank or position, and progress through the
  course.
- This information is readable at a glance while flying, not buried.

### 5.4 Epic: Playing with other people

Story 10: Seeing the other ducks
As Maya, I want to see the other players' ducks moving around me, so that it feels like
a real shared race.
- Other players' ducks appear in the world and move smoothly.
- Each remote duck has a nameplate so players can tell who is who.
- Remote ducks move smoothly even though their positions arrive over the network only a
  few times per second (the gaps are filled in by interpolation, explained in the
  [glossary](#11-glossary)).

Story 11: Finding ducks that are off screen
As Sam, I want an indicator pointing to players I cannot currently see, so that I can
track my rivals.
- An on-screen indicator (a minimap, directional arrows, or both) shows the rough
  location of off-screen ducks.
- The specific indicator style is an open decision (section 9).

Story 12: A lobby before the race
As Leo (host), I want a waiting area where players gather before the race, so that I can
get everyone in before starting.
- Players who have joined appear together in a lobby with their chosen duck.
- The host can see who is in and start the race when ready.
- The room supports up to eight players.

### 5.5 Epic: Making the duck yours

Story 13: Choosing a duck
As Sam, I want to pick my duck's appearance, so that I can recognize myself and stand
out.
- Before the race, the player can choose a duck variant (at minimum the male
  green-headed and female brown mallard already in the project).
- The chosen variant is what other players see for that player.

### 5.6 Epic: Moments of delight

Story 14: Quacking
As Maya, I want opening my mouth to make the duck quack, so that the game feels playful
and responsive to me.
- Opening the mouth plays a quack sound and a small visual cue.
- This is a stretch goal and is cut first if performance suffers.

Story 15: The hidden easter egg
As Sam, I want a hidden gesture to trigger something fun, so that discovering it feels
rewarding.
- Making the "six-seven" hand sign plays a sound and shows a brief animated "6-7" on
  screen.
- This is a stretch goal.

### 5.7 Epic: The team can build in parallel (developer stories)

Story 16: A shared definition of player input
As a developer, I want a single agreed definition of the player's actions (called
DuckActions), so that the person reading the camera and the person moving the duck can
work at the same time without blocking each other.
- A shared type describes one frame of player intent (flap amount, lean amount, dive,
  quack, easter egg, and a confidence value).
- It is defined at the start of the project and imported by both sides.

Story 17: A shared definition of network state
As a developer, I want a single agreed definition of what the server tracks (called
RaceRoomState), so that the networking, rendering, and gameplay code all agree on the
shape of the data.
- A shared type describes the race phase, the map recipe, and each player's position
  and status.
- It is defined at the start of the project.

Story 18: A placeholder duck from hour zero
As a developer, I want a simple stand-in duck (a basic shape) available immediately, so
that flight and rendering can be built before the final art is ready.
- A primitive placeholder is usable in the scene from the start.
- Swapping in the real, already-imported duck model later does not require rewriting the
  flight or rendering code.

---

## 6. Scope (Must, Should, Could, Will Not)

This uses the MoSCoW method, a common way to rank scope: Must have, Should have, Could
have, and Will not have. It keeps everyone honest about what actually has to ship.

### Must have (the demo fails without these)
- Webcam reading the player's body and producing player actions (Person A)
- Local flight physics: climbing, descending, turning, gravity (Person C)
- An animated duck the player controls, with a camera that follows it (Person A and B)
- A low-poly environment with rings that boost the player on pass (Person B)
- A server that hosts up to eight players, shares positions, and runs the race phases
  (Person D)
- The full screen flow: Home, Lobby, Countdown, Race, Leaderboard (Person D)
- Crash, spin-out, and respawn at a checkpoint (Person C)

### Should have
- A duck appearance picker (the male and female variants are already in the project)
- Nameplates above other players' ducks
- An off-screen duck indicator (minimap or arrows)
- A calibration step

### Could have (stretch goals)
- Mouth-open quack
- The "six-seven" hand easter egg
- A dive mechanic, weather, or special items

### Will not have (this hackathon)
- Accounts, saved progress, anti-cheat, mobile support, or matchmaking across the
  internet. A single shared lobby is enough.

---

## 7. The Duck Is Already in the Project

The player's avatar already exists in the repository: a rigged, fully-animated low-poly
mallard at [frontend/public/models/duck/](../frontend/public/models/duck/). "Rigged"
means it has an internal skeleton so it can be animated. It carries 22 animation clips
(flying, gliding, hovering, walking, swimming, taking off, landing, and idling) that we
map to game states. Two appearances ship for the picker: male (green head) and female
(brown). Details are in the model's own
[README](../frontend/public/models/duck/README.md) and in [DESIGN.md](./DESIGN.md).

Known gap: the model has no "quack" body animation. The quack will be driven by a mouth
movement, a sound, and a visual effect, not by a skeletal animation.

---

## 8. Success Metrics

How we judge whether the demo worked.

| What we measure | Target |
|---|---|
| Time from sitting down to flying | Under 30 seconds, with no instruction beyond "flap" |
| Delay between the player's movement and the duck reacting | No perceptible delay for the player's own duck |
| Players racing together in one room | 8 |
| Full races completed without the game crashing during the demo | 100 percent of demo races |
| Did a first-time player smile or laugh on their first flap | Yes (this is the real measure of success) |

---

## 9. Open Decisions

These are intentionally unresolved. They will be settled by playtesting, not by
guessing in advance.

| Decision | How we will resolve it |
|---|---|
| Does faster flapping mean more speed, or does a flap simply mean "climb"? | Build both, put them behind a setting, and play both to see which feels better. |
| Do players turn by leaning the torso, or by raising one arm higher than the other? | Build both, playtest, and pick the one that is easier and keeps eyes on the screen. |
| How do players dive: a physical head-down motion, or simply tucking arms in? | Build both, playtest. The head-down motion risks the player losing sight of the screen. |
| Off-screen duck indicator: minimap, arrows, or both? | Decide during playtesting based on what is readable while flying. |

---

## 10. Risks and How We Handle Them

| Risk | How likely | What we do about it |
|---|---|---|
| Reading three body signals (pose, face, hands) from one webcam is too slow | High | Body pose is the only required signal. Face and hands are optional, run less often, and are cut first if the game slows down. |
| Camera reading is noisy, making flight twitchy | High | Smooth and steady the readings before they affect flight; tune during playtesting. |
| Building the 3D art takes longer than expected | High | Use a placeholder duck from hour zero so flight and rendering can be built in parallel. The real duck is already imported. |
| Poor lighting at the venue breaks body tracking | Medium | Include a calibration step and test the actual venue lighting early. |
| Eight ducks over the network glitch or stutter | Medium | Each player simulates their own duck locally; the network only shares positions, which are smoothed on arrival. |
| Flapping tires players out | Low to medium | Keep races short (60 to 90 seconds); the "flap means climb" option requires less effort. |

---

## 11. Glossary

Plain-English definitions of terms used in this document. Deeper technical terms live in
[TECH_STACK.md](./TECH_STACK.md#glossary).

- Webcam body tracking (also called pose estimation): software that looks at a camera
  image and figures out where a person's joints are (shoulders, elbows, wrists, head).
  We use it to detect flapping and leaning. We never store or upload the video.
- MediaPipe: the specific Google library we use to do that body tracking in the browser.
  More in [TECH_STACK.md](./TECH_STACK.md#glossary).
- Interpolation: smoothly filling in the gaps between known points. Other players'
  positions arrive only a few times per second; interpolation calculates the in-between
  positions so their ducks glide instead of teleporting.
- Checkpoint: a saved spot on the course. After a crash, the player restarts from the
  last checkpoint they reached, not from the very beginning.
- Local simulation / client-authoritative: each player's own computer is in charge of
  calculating where their own duck is. This is why the player's duck reacts instantly.
  See [ARCHITECTURE.md](./ARCHITECTURE.md#3-who-decides-what).
- Stretch goal: a feature we attempt only after the core game works. It is the first
  thing cut if time or performance runs short.

---

## 12. Demo Script

What we actually show the judges, in about two minutes.

1. The hook (10 seconds). "This is a flying race game. There is no controller. You are
   the controller." The judge stands up.
2. The first flap (10 seconds). The judge flaps, the duck takes off. This single moment
   is the entire pitch.
3. The race (60 seconds). The judge and one or two teammates race through rings, live,
   on separate laptops.
4. The flourish (10 seconds). Someone makes the "six-seven" hand sign and the easter egg
   appears. Someone opens their mouth and the duck quacks.
5. The close (10 seconds). "All of this runs in a browser, using only a webcam, with no
   installation, for up to eight players. Built in 24 hours."
