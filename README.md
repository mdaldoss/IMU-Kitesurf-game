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
