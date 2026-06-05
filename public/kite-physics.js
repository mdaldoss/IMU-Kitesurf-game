// Kite flight model on the "wind window" — a pure module with no DOM, so it can
// be imported in the browser (laptop display, phone game) and in Node for
// headless tests. Angles are in degrees; theta is measured from the zenith
// (0 = 12 o'clock, positive = right, negative = left). The kite crashes into the
// water at the horizontal edges (±thetaMax).
//
// Model: the bar inclination is a TARGET ANGLE on the window (where the kite
// will settle), and the kite eases toward it with a first-order lag. Wind and
// the power axis (`pull`, bar pulled in) both shorten the effective time
// constant, so a powered kite in strong wind reacts faster. A strong power-pull
// while the kite is overhead pops the rider off the water (jump).

export const PHYS = {
  thetaMax: 88,        // window half-width (deg); crash at the edge
  windRef: 18,         // reference wind (kn) at which `tau` is calibrated
  minWind: 6,          // below this a crashed kite can't relaunch
  relaunchDrag: 0.35,  // how sluggishly the kite peels off the water
  // jump model (height in arbitrary "window units", tuned for feel)
  gravity: 2.4,        // downward accel while airborne
  popGain: 3.5,        // takeoff velocity per unit power
  popPullMin: 0.55,    // power needed to pop
  popThetaMax: 45,     // must be within this of the zenith to load up & jump
  popArmBelow: 0.3,    // power must drop below this to re-arm the next pop
  edgeTensionBonus: 0.7, // extra vy multiplier from kite position at the edge
};

export function createKite() {
  return {
    theta: 0,          // angle from zenith (deg)
    crashed: false,
    crashSide: 0,      // -1 left, +1 right, 0 none
    height: 0,         // 0 = on the water
    vy: 0,             // vertical velocity while airborne
    airborne: false,
    popArmed: true,    // de-bounces repeated takeoffs from a held pull
  };
}

// Advance the kite one timestep. Mutates `k`; returns an events object with any
// of { crash, relaunch, takeoff, landing } set true this step.
export function stepKite(k, opts) {
  const {
    barTarget,                 // desired angle (deg), = steer * thetaMax
    pull = 0,                  // power axis 0..1 (bar pulled in)
    windNow,                   // instantaneous wind (kn)
    tau,                       // response time (s) at windRef, zero power
    dt,                        // timestep (s)
    windRef = PHYS.windRef,
    minWind = PHYS.minWind,
    relaunchDrag = PHYS.relaunchDrag,
    thetaMax = PHYS.thetaMax,
  } = opts;
  const events = {};

  // More wind and more power => snappier response (shorter effective tau).
  const windFactor = Math.max(0.3, windNow / windRef);
  const powerFactor = 1 + 1.2 * pull;
  const effTau = Math.max(0.05, tau / (windFactor * powerFactor));

  if (k.crashed) {
    // Pinned at the water edge: only steering back toward centre peels it off,
    // slowly, and only with enough wind.
    const awaySteering = k.crashSide * barTarget < 0;
    if (windNow >= minWind && awaySteering) {
      const kk = 1 - Math.exp(-dt / (effTau / relaunchDrag));
      k.theta += (barTarget - k.theta) * kk;
    }
    if (Math.abs(k.theta) < thetaMax - 10) {
      k.crashed = false; k.crashSide = 0; events.relaunch = true;
    }
  } else {
    const kk = 1 - Math.exp(-dt / effTau);
    k.theta += (barTarget - k.theta) * kk;
    // Crash at the physical edge — but not while jumping (you're in the air).
    if (!k.airborne && Math.abs(k.theta) >= thetaMax - 0.5) {
      k.theta = Math.sign(k.theta) * thetaMax;
      k.crashed = true; k.crashSide = Math.sign(k.theta);
      events.crash = true;
    }
  }
  k.theta = Math.max(-thetaMax, Math.min(thetaMax, k.theta));

  // --- vertical jump model ---
  // Re-arm once power is released, so a held pull doesn't fire repeatedly.
  if (pull < PHYS.popArmBelow) k.popArmed = true;
  const overhead = Math.abs(k.theta) < PHYS.popThetaMax;
  if (!k.airborne && !k.crashed && k.popArmed &&
      pull >= PHYS.popPullMin && overhead && windNow >= minWind) {
    k.airborne = true;
    k.popArmed = false;
    // Edge of the window builds line tension: more lateral kite position = higher pop.
    const edgeFactor = 1 + PHYS.edgeTensionBonus * Math.abs(k.theta) / thetaMax;
    k.vy = PHYS.popGain * pull * Math.min(1.6, windNow / windRef) * edgeFactor;
    events.takeoff = true;
  }
  if (k.airborne) {
    k.height += k.vy * dt;
    k.vy -= PHYS.gravity * dt;
    if (k.height <= 0) {
      k.height = 0; k.vy = 0; k.airborne = false;
      events.landing = true;
    }
  }

  return events;
}

// Schmitt-trigger crossing detector for the 12 o'clock click. Feed the kite's
// normalized side (theta / thetaMax, in -1..1); reports a crossing only after a
// genuine left<->right transition past ±hyst (no chatter around centre).
export function makeCrossingDetector(hyst) {
  let lastSign = 0;            // -1 left, +1 right, 0 not yet established
  return {
    reset() { lastSign = 0; },
    setHyst(h) { hyst = h; },
    detect(sNorm) {
      let sign = lastSign;
      if (sNorm > hyst) sign = 1;
      else if (sNorm < -hyst) sign = -1;
      let crossed12 = false;
      if (sign !== lastSign) {
        if (lastSign !== 0) crossed12 = true;   // skip the first side we land on
        lastSign = sign;
      }
      return { crossed12 };
    },
  };
}
