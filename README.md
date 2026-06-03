# IMU Kitesurf Game

A kitesurf-bar simulator. A laptop browser displays a kite and a control "bar";
a smartphone's motion sensors drive the bar. Hold the phone level → kite at 12
o'clock; roll it right/left → steer right/left.

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
centred on the rider) and the bar sets the **turn rate**, not a fixed position —
just like a real kite:

- Hold the bar tilted and the kite keeps flying to that side until it **crashes
  into the water** at the edge → **double buzz**.
- A crashed kite is held down by **water friction**: steering back toward the
  centre peels it off slowly, and only if there's **enough wind**. Once it's off
  the water it flies normally again.
- Crossing **12 o'clock** (the zenith) still gives a single buzz.

Controls (laptop, persisted):

- **Wind strength** (kn) — scales how fast the kite flies; too little wind and a
  crashed kite won't relaunch.
- **Gust intensity** (%) — smoothly varying gusts on top of the base wind (shown
  live as `wind … kn`).
- **Steering response** (°/s at full bar) — how aggressively the bar turns the
  kite.

Turn **Flight physics off** to map the bar directly to a window angle (no
inertia, no crashes) — handy for re-checking the orientation/axis.

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
