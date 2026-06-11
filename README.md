# IMU Kitesurf Game

A kitesurf-bar simulator with three modes that share one flight model:

- **3D simulator** (`/sim`) — the realistic mode (see [PLAN.md](PLAN.md)): the
  kite flies the full 3-D wind window with a visible power zone, the board has a
  heading (twist the phone — yaw — to point upwind/crosswind/downwind), kite
  sizes 7–13 m, apparent wind, and pro-style send-to-jump. Works three ways:
  phone streaming to a laptop (trainer), standalone on the phone with its own
  sensors, or keyboard-only on a computer (←/→ steer, space = bar in, A/D =
  board heading).
- **Standalone phone game** (`/game`) — a single-device kite game: tilt to steer,
  pull the phone down to power up and jump, fly real-spot wind presets, score
  combos. No laptop or network needed. Runs in a phone browser or as the
  [Capacitor app](mobile/README.md) (real native haptics).
- **Trainer** — a laptop browser displays the kite and a control "bar"; a
  smartphone's motion sensors drive it over the LAN. Hold the phone level → kite
  at 12 o'clock; roll right/left → steer; pull down → power.

## 3D simulator (`/sim`)

The wind-window quarter sphere is drawn in 3-D from a chase camera: arcs are
tinted by power-zone intensity (hot = deep downwind). Park the kite at the
window edge and it barely pulls — you slow down; dive it through the hot zone
and the line tension (bottom bar) spikes and the board accelerates. Wind force
scales with apparent wind **squared**, so spot choice and riding direction
matter. Pinch too far upwind and the board stalls; bear away to rebuild speed.
Jumps work like the real thing: ride powered with the kite at ~10 o'clock, send
it hard past 12, sheet in — then redirect it forward before touchdown or you
land hard and dump your speed. Smaller kites turn faster, bigger ones pull
harder (⚙ settings). Physics lives in `public/kite3d.js`, `public/board3d.js`,
`public/sim3d.js`; rendering in `public/render3d.js` (hand-rolled projection,
no dependencies); tests in `test/sim3d.test.mjs`.

## Standalone game (`/game`)

Open the **Phone game** URL printed by `npm start` (or build the native app).
Tap **play**, grant motion access, and hold the phone facing you:

- **Tilt to steer** the kite around the wind window (or switch to *Bar style* in
  ⚙ settings; calibrate the centre while holding level).
- **Pull the phone down** to power the kite (the bar power meter fills); a strong
  pull with the kite **overhead** pops a **jump** — the rider lifts off the water.
- **Spin the phone mid-air** for trick bonuses (180°/360°/540°…).
- **Jump the buoys** that drift in along the water — be airborne when they reach
  you, or you wipe out.
- **Cross 12 o'clock** for combo points; **don't crash** into the water (tap
  *Relaunch* to recover).
- Pick a **spot** in ⚙ settings (Tarifa, Maui, Lake Garda thermal, Cape Town,
  Dakhla) — each has its own wind strength and gust character.

Score = airtime + clean 12-o'clock passes + jump height + tricks + cleared
buoys, with a combo multiplier that a crash resets; your best is kept on the
device.

## Phase 1 — IMU stream validation (this code)


## Phase 1 — IMU stream validation (this code)

Phase 1 proves the realtime sensor link and lets us agree on the steering
mapping. The phone streams its raw orientation (`alpha`/`beta`/`gamma`) to the
laptop, which shows the live numbers and a bar+kite visualization with
adjustable axis / sign / neutral so we can confirm "tilt right → kite right."

Kite lag (wind, line length, kite size) and the "pulled from both sides when
lowered" effect come in later phases.

### How it works

```
[Phone /phone]  --wss-->  [Node HTTPS + WebSocket relay]  --wss-->  [Laptop /]
```

Browsers can't be WebSocket servers, and the orientation sensors only work over
HTTPS, so a small Node relay serves both pages over a self-signed HTTPS cert and
forwards orientation packets from the phone to the laptop.

### Run it (self-signed, works offline)

```bash
npm install
npm start
```

The terminal prints the **laptop** and **phone** URLs plus a QR code.

1. On the **laptop**, open the laptop URL (e.g. `https://192.168.x.y:8443/`).
   Your browser warns about the self-signed cert — choose *Advanced →
   proceed anyway*.
2. On the **phone** (same Wi-Fi/hotspot), scan the QR or open the phone URL,
   bypass the same cert warning, tap **Enable sensors & connect**, and grant
   motion access (required on iOS).
3. Watch the laptop: the status dot turns green, latency/rate populate, and the
   raw angles update as you move the phone.

Set the port with `PORT=9000 npm start` if 8443 is taken.

### Validating the orientation

Hold the phone **landscape, flat, screen up, speaker edge to the right**.

1. Hold it level and click **Zero / calibrate neutral** on the laptop.
2. Tilt right — the kite/bar should move **right**.
3. If it moves the wrong way, toggle **invert**. If the wrong number reacts,
   switch the **axis** (default is `beta` for this landscape grip). Adjust
   **full deflection** to taste. Settings persist across reloads.

### Haptic "click" at 12 o'clock

When the kite crosses the 12 o'clock center line, the laptop sends a `buzz`
back through the relay and the phone vibrates a short "click". A hysteresis
band (configurable on the laptop) means the kite must travel past ±band to
register a side, so jitter around center can't produce a stream of clicks —
you get one click per genuine left↔right crossing. The laptop also flashes the
center line and (optionally) plays a tick so you can confirm it without an
Android phone in hand.

**Reliable haptics (iPhone + Android): the native app.** Mobile browsers can't
fire haptics from a background WebSocket event (iOS Safari especially). For real,
dependable haptics, run the phone page inside the **Capacitor native shell** in
[`mobile/`](mobile/README.md) — same `public/phone.html`, but it detects the
native runtime and uses the OS haptics plugin (`haptic mode: native`). The app
connects to the laptop over cleartext `ws://` on the LAN (server prints the
address). This is the recommended path for iPhone.

The browser fallbacks below still work without installing anything:

**iPhone (browser) support:** iOS Safari has no Vibration API, so the phone falls
back to the "switch haptic" trick — programmatically toggling a hidden
`switch`-styled checkbox produces a system haptic tap on **iOS 17.4+ Safari**.
This often only fires from a direct tap, not a network event, which is why the
native app exists. The phone page's
`haptic mode` line shows which path is active (`vibration` on Android,
`ios-switch` on iPhone).

**Troubleshooting haptics (they can fail silently):** the phone page shows
`buzz received` and `last haptic call`, and there's a **Test haptic now** button.
Use them to localize a problem:

- *Test button buzzes, network buzzes don't, but `buzz received` increments* —
  the message arrives but the OS blocks haptics outside a direct tap. This is
  common: Android needs a prior interaction (the Enable tap covers it) and
  **iOS's switch trick generally only fires from a real touch, not an async
  network callback** — so iPhone network-triggered haptics may simply not be
  possible from the web.
- *`buzz received` does not increment* — the click isn't reaching the phone;
  check that the laptop's `clicks sent` is going up (i.e. the kite is actually
  crossing 12) and that both sockets are connected.
- *`buzz received` increments and the screen flashes blue, but no vibration* —
  the device/OS isn't vibrating (too-short pulse, silent mode, iOS < 17.4, or
  the switch trick unsupported).

The screen flashes blue on every received buzz regardless of haptic success, so
you can always confirm the network path.

### Kite flight model

With **Flight physics** on (default), the kite flies on a **wind window** (an arc
centred on the rider). The bar's tilt sets a **target angle** — where the kite
will settle — and the kite eases toward it with a first-order lag, just like a
real kite:

- Tilt the bar partway and the kite glides to that spot and **holds** there.
- Tilt it all the way and the kite flies to the edge and **crashes into the
  water** → **double buzz**.
- A crashed kite is held down by **water friction**: steering back toward the
  centre peels it off slowly, and only if there's **enough wind**. Once it's off
  the water it flies normally again.
- Crossing **12 o'clock** (the zenith) gives a single buzz.
- **Bar power (pull):** swing/pull the phone *down* toward the ground to pull the
  bar in (power up); raise it to depower. More power means a snappier kite, and a
  strong pull while the kite is overhead pops a **jump**. The laptop shows a live
  power meter. (Derived from the phone's motion sensor — see `public/bar-pull.js`.)

Controls (laptop, persisted):

- **Wind strength** (kn) — more wind makes the kite track faster; too little and a
  crashed kite won't relaunch.
- **Gust intensity** (%) — smoothly varying gusts on top of the base wind (shown
  live as `wind … kn`).
- **Response time** (s) — how long the kite takes to reach the bar's target at
  reference wind; wind and power both shorten it.

Turn **Flight physics off** to map the bar directly to a window angle (no
inertia, no crashes) — handy for re-checking the orientation/axis.

The flight model lives in shared modules (`public/kite-physics.js`,
`public/wind-spots.js`, `public/bar-pull.js`) used by both the laptop display and
the phone, and is covered by a headless test: `npm test`.

### Fallback: ngrok (clean HTTPS, needs internet)

If a device refuses the self-signed cert, expose the server through a tunnel:

```bash
npm start            # in one terminal
ngrok http 8443      # in another (requires an ngrok account/token)
```

Open the `https://….ngrok-free.app/` URL on the laptop and `…/phone` on the
phone — no cert warning, and iOS permission prompts work cleanly.

> Note: ngrok routes your sensor data through an external service. The
> self-signed path keeps everything on your local network.
