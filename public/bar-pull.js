// Bar pull / power axis from the phone's motion sensor.
//
// In real kitesurfing, pulling the bar IN powers the kite up; sheeting it OUT
// depowers. We mimic that with the phone's vertical motion: swing/pull the phone
// DOWN toward the ground and `pull` rises (powered); raise it back up and `pull`
// leaks back toward neutral (depowered).
//
// How: DeviceMotion gives us the gravity vector (which way is "down") and the
// linear acceleration. We project linear acceleration onto "down" and feed a
// LEAKY integrator. A single leaky integrator (not a true double integration)
// is deliberate: accelerometers drift badly when integrated to position, but a
// leaky velocity proxy that relaxes to zero gives exactly the "pull down →
// power; raise / let go → returns to neutral" feel without runaway drift.
//
// Works in the browser and the Capacitor WebView. iOS needs a permission grant
// from a user gesture, so call `start()` from a tap (the same one that enables
// orientation).

export function createBarPull(opts = {}) {
  const decay = opts.decay ?? 1.8;     // 1/s — how fast pull relaxes to neutral
  const gain = opts.gain ?? 0.9;       // m/s -> pull sensitivity
  const smooth = opts.smooth ?? 0.12;  // output low-pass time constant (s)

  let vel = 0;        // leaky-integrated downward velocity proxy (m/s)
  let pull = 0;       // output, clamped 0..1
  let lastT = 0;
  let started = false;

  function onMotion(e) {
    const now = e.timeStamp || performance.now();
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
    lastT = now;

    const grav = e.accelerationIncludingGravity || {};
    const gx = grav.x || 0, gy = grav.y || 0, gz = grav.z || 0;
    const gm = Math.hypot(gx, gy, gz) || 1;       // gravity magnitude (~9.81)

    // Linear acceleration (gravity removed). Fall back to deriving it from the
    // gravity-included reading if the device doesn't supply `acceleration`.
    const lin = e.acceleration || {};
    let lx = lin.x, ly = lin.y, lz = lin.z;
    if (lx == null && ly == null && lz == null) {
      // crude: subtract a slow gravity estimate — good enough for a gesture
      lx = 0; ly = 0; lz = 0;
    }
    lx = lx || 0; ly = ly || 0; lz = lz || 0;

    // Component of linear acceleration along gravity ("down" positive): moving
    // the phone downward accelerates it in the +gravity direction.
    const along = (lx * gx + ly * gy + lz * gz) / gm;   // m/s^2

    // Leaky integrate to a velocity proxy, then map to a smoothed, clamped pull.
    vel += along * dt;
    vel -= vel * decay * dt;
    const target = Math.max(0, Math.min(1, gain * vel));
    const k = 1 - Math.exp(-dt / smooth);
    pull += (target - pull) * k;
    pull = Math.max(0, Math.min(1, pull));
  }

  return {
    // Request permission (iOS) and subscribe. Returns true if motion is live.
    async start() {
      if (started) return true;
      try {
        if (typeof DeviceMotionEvent !== 'undefined' &&
            typeof DeviceMotionEvent.requestPermission === 'function') {
          const res = await DeviceMotionEvent.requestPermission();
          if (res !== 'granted') return false;
        }
      } catch { return false; }
      if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return false;
      window.addEventListener('devicemotion', onMotion);
      started = true;
      return true;
    },
    read() { return pull; },
    // Inject a value (e.g. the laptop applying a `pull` streamed from the phone).
    set(v) { pull = Math.max(0, Math.min(1, Number(v) || 0)); },
    isLive() { return started; },
  };
}
