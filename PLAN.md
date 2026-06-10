# Realism Roadmap — IMU Kitesurf Simulator

Goal: evolve the current 1-D wind-window tracker into a believable kite + board
simulation driven by the phone IMU, playable both as **laptop trainer (phone =
controller)** and as a **standalone phone game** (same physics module, two
front-ends).

Everything below keeps the existing architecture: all physics stays in
headless, DOM-free modules (`public/kite-physics.js` + new modules) shared by
`laptop.html`, `game.html` and the Capacitor app, and covered by
`test/*.test.mjs`.

---

## 0. Current state (baseline)

- Kite position is a single angle `theta` (−88°..+88°) tracking a bar target
  with a first-order lag `tau` (1.8 s), sped up by wind and pull.
- Bar pull = leaky integral of vertical phone acceleration (0..1).
- No kite size, no elevation in the window, no board/rider, jump is a simple
  "pull hard while overhead" pop.

## 1. Kite model: 3-D wind window + kite size

**Why:** real kites move in a quarter-sphere (clock positions 9→12→3 *and*
depth into the power zone), and power depends on *where* the kite is and *how
fast* it is moving, not just bar input.

**State** (new module `kite3d.js`; the legacy 1-D `kite-physics.js` keeps the
old 2-D pages working):

```
theta  : clock angle in the window, −90..+90  (0 = 12 o'clock, ±90 = water)
d      : window depth 0..1  (0 = parked at the window edge, 1 = deep in the
         power zone, dead downwind of the rider)
omega  : kite angular speed (deg/s) — steering output, also jump lift (§4)
```

The kite's true 3-D position on the line-length sphere has a closed form
(x = crosswind, y = downwind, z = up; `td = d · depthMax · 90°`):

```
pos = L · ( cos(td)·sin(theta),  sin(td),  cos(td)·cos(theta) )
```

so `d = 0` traces the window-edge arc (9→12→3) and growing `d` swings the kite
downwind into the power zone at the same clock angle. Depth is **dynamic, not
directly steered**: a turning, sheeted-in kite flies deep (`d` rises with
|omega| and pull), a parked kite drifts back to the edge — exactly the real
behaviour, and it makes the power zone *visible* (§1b). The kite crashes when
its elevation reaches the water (z ≈ 0): at the side edges, or downwind if you
hold a dive too long.

## 1b. Seeing it: the 3-D view

A new page (`/sim`, `sim3d.html`) renders the scene in 3-D from a chase camera
behind/above the rider, looking downwind — no rendering library, just a small
hand-rolled perspective projection onto a `<canvas>` (`render3d.js`), so it
stays dependency-free and runs in the Capacitor WebView offline:

- the **wind-window lattice**: meridians/arcs of the quarter sphere, with cells
  tinted by power-zone intensity (cool at the edge/zenith, hot deep downwind);
- the **kite** on the sphere with its two lines, visibly leaving the edge and
  swinging through the power zone when you dive it;
- the **board + rider** at the origin, rotated to the current heading, with a
  scrolling water grid + wake showing speed and direction (upwind / crosswind /
  downwind at a glance), and a wind arrow;
- HUD: wind true/apparent, board speed, heading label, line tension, jump
  height.

**Kite size** — new `KITES` table; size sets turn rate and raw power:

| Kite  | turn-rate factor | power factor | notes                       |
|-------|------------------|--------------|-----------------------------|
| 7 m   | 1.6              | 0.75         | twitchy, for 25+ kn         |
| 9 m   | 1.25             | 0.9          |                             |
| 12 m  | 1.0 (reference)  | 1.1          | current feel ≈ this         |
| 13 m  | 0.85             | 1.2          | slow, grunty, light wind    |

Turn rate: `omega_max = K_TURN * steer * windNow/windRef * kite.turnFactor *
(0.6 + 0.8*pull)` — sheeting in (pull) makes the kite respond faster, exactly
as in real life; a depowered bar barely steers.

**Power-zone model** — replaces the implicit "always pulling" assumption.
Line tension (0..1+) that everything else consumes:

```
zone     = cos(theta_from_downwind)        // 1 deep in the zone, →0 at window edge/zenith
dynamic  = 1 + K_DYN * |omega| / omega_ref // a moving kite generates apparent wind
tension  = kite.powerFactor * (windNow/windRef)^2 * zone * dynamic * sheet(pull)
```

`sheet(pull)` maps bar position to angle of attack: ~0.35 bar-out, ~1.0 bar-in.
Wind enters **squared** (aerodynamic force ∝ v²) — this single change makes
wind-spot choice matter far more than today.

Park the kite at 12 → low tension, you slow down. Dive it through the zone →
tension spike, you accelerate. This is the core realism win.

## 2. Bar feel: wind-scaled pull effort + haptics

We can't make the phone physically heavier, so we emulate "harder bar" by
**requiring more physical work for the same sheeting** and by haptic feedback:

- `bar-pull.js`: scale the accel→pull gain by `windRef/windNow` (clamped).
  In 30 kn you must move the phone faster/further to reach pull = 1 than in
  12 kn — your arm genuinely works harder.
- Add a slow "bar pressure" haptic channel: continuous light ticks whose rate
  scales with current line tension (Capacitor Haptics on phone; `{t:'buzz'}`
  relay messages in trainer mode). Tension spikes (dive, gust, jump send) get a
  heavy transient.
- Keep left/right steering as today (roll in portrait, pitch in bar mode) —
  that mapping already mimics pushing the bar tips.

## 3. Board & rider: yaw = heading, polar speed model

**Input:** phone yaw (`alpha`) → board heading relative to wind, calibrated at
session start ("face downwind, tap to zero"). Trainer/desktop fallback: A/D or
left/right arrows nudge heading.

**State** (new `board3d.js`, headless + tested):

```
heading : deg from downwind, 0 = dead downwind, 90 = beam reach, >135 = pinching
speed   : board speed (kn-equivalent units)
```

**Speed model** — a simple sailing polar, driven by line tension from §1:

```
drive  = tension * polar(heading)
polar(h): 0.55 at 0° (downwind), peak 1.0 near 100–110° … 0 at ~140°
drag   = K_DRAG * speed^2  (+ extra rail drag when pinching upwind)
dspeed/dt = drive − drag
```

- Pinch beyond ~135° off downwind → `polar → 0`, the board stalls and stops,
  exactly the "too far upwind" behaviour you described. Below ~2 kn the rider
  sinks (run penalty / restart drift downwind).
- Kite out of the power zone (parked high, or drifting to the edge while you
  ride toward it) → tension drops → you visibly decelerate. Dive-and-climb
  ("sine-ing" the kite) becomes the real technique to keep speed in light wind.
- **Apparent wind:** `windApparent = windTrue + K_APP * speed * cos(heading)`
  feeds back into §1 tension — riding upwind powers the kite up, bearing off
  deep downwind softens it. One line of code, big realism payoff.

**UI:** small compass/wind arrow + board on the water, heading-coloured wake.
On phone the rider/board view sits in the lower third of the screen, kite
window above.

## 4. Jumps the way pros do them (kite send)

Replace the current "pull hard while overhead" pop with a **send-and-load**
mechanic that matches the 10-o'clock → 13-o'clock (i.e. past 12) theory:

1. **Detect the send:** rider is riding (speed above threshold, heading
   roughly crosswind/upwind, kite around 10/11 or 1/2). Player steers hard so
   the kite crosses 12 toward the opposite side. We already have the
   12-crossing Schmitt detector — extend it to record **crossing speed**
   `omega_cross`.
2. **Load & pop:** within a short window (~0.6 s) after the crossing, bar pull
   ≥ threshold while still edging (heading upwind-ish) triggers takeoff.
3. **Jump height:**
   `vy0 = K_JUMP * omega_cross/omega_ref * tension * (0.5 + 0.5*edge)`
   where `edge = clamp((heading−60)/60, 0, 1)`.
   Faster send + more wind + harder edge = higher jump — exactly the theory.
   The old standing-pop stays as a mini-hop (low `vy0`) so beginners still get
   feedback.
4. **Airborne:** kite at/near 12 gives hang-time (reduced effective gravity
   while `phi` high and bar in). The rider **drifts downwind** during the
   jump: `x_downwind += K_DRIFT * windNow * airtime` and `speed` bleeds off.
5. **Landing redirect:** to land clean you must steer the kite back **in front
   of you** (past 12 toward the original side) before touchdown. Land with the
   kite redirected and bar in → keep most of `speed` and ride away (+combo
   score). Land with the kite still behind 12 → hard penalty: speed dumped to
   near zero, possible crash, screen shake + heavy haptic.

Spins/tricks (existing yaw-spin detection) layer on top unchanged, but scoring
should multiply by jump height so big sent jumps dominate.

## 5. Platforms: laptop trainer now, standalone phone game next

- **Shared core:** `kite3d.js`, `board3d.js`, `bar-pull.js`, `wind-spots.js`
  stay headless ES modules, composed by a `sim3d.js` facade (one
  `sim.step(inputs, dt)` call) so every front-end runs the identical sim.
- **Laptop trainer (`/` + `/phone`):** unchanged transport (WS relay). Add the
  board/heading panel and kite-size selector to `laptop.html`. Add a
  **keyboard/mouse simulator** mode to `phone.html` (arrows = steer/yaw, space
  hold = pull) so the whole sim is testable on a computer with no phone — this
  also unlocks CI-style manual testing.
- **Standalone phone (`game.html` + Capacitor `mobile/`):** same sim, portrait
  layout (kite window top, water/board bottom), yaw calibration screen, native
  haptics for bar pressure. No server needed — already true today, keep it.

## 6. Implementation order

| Phase | Deliverable | Files | Test focus |
|-------|-------------|-------|------------|
| 1 | v² wind power, kite sizes, sheeting, tension output | `kite3d.js` (new) | tension vs wind/size/pull curves |
| 2 | 3-D window (`theta`,`d`), power-zone map, dynamic (moving-kite) power | `kite3d.js` | park ⇒ low tension; dive ⇒ spike |
| 3 | Board model: yaw heading, polar, stall upwind, apparent wind | `board3d.js` (new) | stall ≥135°, sine-ing keeps speed |
| 4 | Send-to-jump, downwind drift, landing redirect | `kite3d.js` | height ∝ ω_cross; bad landing penalty |
| 5 | 3-D chase-camera view + `/sim` page (WS / sensors / keyboard inputs) | `render3d.js`, `sim3d.html`, `sim3d.js`, `server.js` | manual |
| 6 | Bar effort scaling + tension haptics | `bar-pull.js`, `sim3d.html` | gain vs wind |
| 7 | Phone portrait layout, yaw calibration, Capacitor sync | `mobile/` | on-device |

Each phase lands behind sensible defaults so the game stays playable at every
commit; new constants go in the existing `PHYS`-style tables so tuning sessions
(on real wind feel) are one-file edits.

## 7. Tuning targets ("does it feel real?")

- 12 m in 15 kn: kite takes ~3–4 s edge-to-edge; 7 m in 25 kn: ~1.5 s.
- Parking at 12 while riding bleeds speed to a stop in ~6–8 s.
- Pinching past ~45° to the true wind stalls the board within ~3 s.
- A well-timed send in 25 kn jumps ~2–3× higher than a standing pop, with
  visible downwind travel during the jump.
