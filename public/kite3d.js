// 3-D kite flight model on the wind-window quarter sphere. Pure module, no
// DOM — shared by the /sim page (laptop trainer + standalone phone) and the
// headless tests.
//
// Coordinates (rider at the origin, lines of length 1 in "window units"):
//   x = crosswind (right when looking downwind), y = downwind, z = up.
// The kite lives on the sphere, parametrized by:
//   theta : clock angle, −90 (9 o'clock, left water) .. 0 (12) .. +90 (3 o'clock)
//   d     : window depth 0..1 — 0 on the window-edge arc, 1 deep in the power
//           zone (swung toward dead-downwind at the same clock angle)
// Closed-form position (td = d * depthMax * 90°):
//   pos = ( cos(td)·sin(theta), sin(td), cos(td)·cos(theta) )
//
// Depth is dynamic, not steered directly: a turning, sheeted-in kite flies
// deep into the window; a parked kite drifts back out to the edge. Line
// tension — the single output everything else consumes — follows the real
// scaling: wind², projected position in the zone (power zone), sheeting
// (angle of attack) and kite speed (apparent wind of the moving kite).

export const KITES = [
  { id: '7',  name: '7 m',  area: 7,  turn: 1.6  },
  { id: '9',  name: '9 m',  area: 9,  turn: 1.25 },
  { id: '12', name: '12 m', area: 12, turn: 1.0  },
  { id: '13', name: '13 m', area: 13, turn: 0.85 },
];
export const kiteById = (id) => KITES.find((k) => k.id === String(id)) || KITES[2];

export const P3 = {
  windRef: 18,        // kn — turn rates calibrated here
  minWind: 6,         // below this a crashed kite can't relaunch
  thetaMax: 90,       // water at the clock sides (geometry)
  thetaPin: 86,       // steering pins here: a parked kite rests just above the
                      // water at 9/3 o'clock instead of crashing — it only hits
                      // the water if flown there with depth/speed (z < crashZ)
  depthMax: 0.8,      // d=1 swings 0.8·90° = 72° from the edge toward downwind
  omegaMax: 80,       // deg/s at full steer (12 m, windRef, mid pull)
  omegaTau: 0.15,     // s — steering latency (measured ~0.1 s on real LEI kites)
  depthTauIn: 0.55,   // s — how fast a dive carries the kite into the zone
  depthTauOut: 1.5,   // s — how fast a parked kite drifts back to the edge
  zoneBase: 0.18,     // tension floor at the edge (a parked kite still pulls a bit)
  // real aero force: F = ½·ρ·A·C_L·v_a²  (v_a = apparent wind, m/s)
  rho: 1.225,         // air density kg/m³
  clMin: 0.4,         // C_L bar fully out (measured LEI depower range 0.4→1.0)
  clMax: 1.0,         // C_L bar fully in
  forceMax: 3500,     // N — safety clamp (line sets break around 4–5 kN)
  forceBody: 650,     // N ≈ one 'body weight' unit for the normalized tension HUD
  crashZ: 0.05,       // elevation (sin) below which the kite hits the water
  relaunchDrag: 0.35, // sluggish peel-off from the water
  // jump model — height in metres, velocities m/s
  sendWindow: 0.7,    // s after a 12-crossing in which a pull pops the jump
  sendOmegaMin: 25,   // deg/s crossing speed for a "send" (slower = just a turn)
  popPullMin: 0.55,   // bar-in threshold to pop
  popArmBelow: 0.3,   // bar must come out below this to re-arm
  jumpGain: 7,        // m/s takeoff velocity scale for a full send
  hopGain: 4,         // m/s for the standing pop (no send) — a small hop
  gravity: 9.81,
  hangGravity: 4.6,   // effective gravity with the kite overhead, bar in
  minSendSpeed: 3.5,  // board speed (m/s) needed to load a real send
};

export function createKite3(kiteId = '12') {
  return {
    def: kiteById(kiteId),
    theta: 0, d: 0.15, omega: 0,
    crashed: false, crashSide: 0,
    airborne: false, height: 0, vy: 0,
    popArmed: true,
    tack: 0,              // side (sign of theta) the kite was on at takeoff
    sendT: Infinity,      // seconds since the last fast 12-crossing
    sendOmega: 0,         // |omega| at that crossing
    sendFrom: 0,          // which side the kite came FROM on that crossing
    tension: 0,           // line force in 'body weights' (forceN / forceBody)
    forceN: 0,            // line force, newtons — what the board model consumes
    zone: 0,
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const D2R = Math.PI / 180;

// 3-D unit position of the kite on the window sphere.
export function kitePos(theta, d) {
  const td = d * P3.depthMax * Math.PI / 2;
  const c = Math.cos(td), t = theta * D2R;
  return { x: c * Math.sin(t), y: Math.sin(td), z: c * Math.cos(t) };
}

// Advance one timestep. Mutates `k`; returns events:
// { crash, relaunch, takeoff, landing, clean } (landing.clean = kite was
// redirected forward before touchdown).
export function stepKite3(k, opts) {
  const {
    steer,              // bar input −1..1
    pull = 0,           // bar sheeted in 0..1
    windApp,            // apparent wind at the kite (kn)
    dt,
    riderSpeed = 0,     // board speed, normalized (≈1 = cruise) — gates the send
    heading = 90,       // |deg from downwind| — edging bonus for jumps
  } = opts;
  const ev = {};
  const def = k.def;
  const windF = clamp(windApp / P3.windRef, 0.25, 1.9);

  if (k.crashed) {
    // Pinned on the water at the side: steering back toward centre slowly
    // peels it off (needs wind). Depth stays ~0 while relaunching.
    k.d += (0 - k.d) * (1 - Math.exp(-dt / 0.4));
    const away = k.crashSide * steer < 0;
    if (windApp >= P3.minWind && away) {
      const target = steer * P3.thetaMax;
      const kk = 1 - Math.exp(-dt / (1.2 / (windF * P3.relaunchDrag)));
      k.theta += (target - k.theta) * kk;
    }
    if (Math.abs(k.theta) < 70) { k.crashed = false; k.crashSide = 0; ev.relaunch = true; }
    k.tension = 0; k.forceN = 0; k.zone = 0; k.omega = 0;
    return ev;
  }

  // --- steering: omega chases a target turn rate ---------------------------
  // Smaller kites turn faster; wind and a sheeted-in bar both speed the
  // response; a fully depowered bar barely steers (real bar-out behaviour).
  const omegaTarget = steer * P3.omegaMax * def.turn * windF * (0.55 + 0.65 * pull);
  k.omega += (omegaTarget - k.omega) * (1 - Math.exp(-dt / P3.omegaTau));

  const prevTheta = k.theta;
  k.theta += k.omega * dt;
  if (Math.abs(k.theta) >= P3.thetaPin) {
    k.theta = Math.sign(k.theta) * P3.thetaPin;
    k.omega = 0;
  }

  // Fast crossing of 12 o'clock = a "send" (the jump trigger, §jump below).
  if (Math.sign(prevTheta) !== Math.sign(k.theta) && prevTheta !== 0 && k.theta !== 0 &&
      Math.abs(k.omega) >= P3.sendOmegaMin) {
    k.sendT = 0; k.sendOmega = Math.abs(k.omega); k.sendFrom = Math.sign(prevTheta);
  }
  k.sendT += dt;

  // --- window depth: dives carry the kite into the power zone --------------
  const dTarget = clamp(0.12 + Math.abs(k.omega) / 75 + 0.35 * Math.max(0, pull - 0.35), 0, 1);
  const tauD = dTarget > k.d ? P3.depthTauIn : P3.depthTauOut;
  k.d += (dTarget - k.d) * (1 - Math.exp(-dt / tauD));

  // --- line force, the real way: F = ½·ρ·A·C_L·v_a² ------------------------
  // v_a is the apparent wind at the kite; a moving kite multiplies its own
  // airspeed (the `dyn` term), which is why dives spike the force 2–4×.
  const pos = kitePos(k.theta, k.d);
  k.zone = pos.y * pos.y;                       // cos² of angle from downwind
  const zoneF = P3.zoneBase + (1 - P3.zoneBase) * k.zone;
  const cl = P3.clMin + (P3.clMax - P3.clMin) * pull;   // sheeting = angle of attack
  const dyn = 1 + 0.7 * Math.min(1.5, Math.abs(k.omega) / 70);  // moving kite
  const va = windApp * 0.514;                   // kn -> m/s
  k.forceN = clamp(0.5 * P3.rho * def.area * cl * va * va * zoneF * dyn, 0, P3.forceMax);
  k.tension = k.forceN / P3.forceBody;          // ~body weights, for HUD/jump scaling

  // --- crash: kite reaches the water (side edge, or a dive held too long) --
  if (!k.airborne && pos.z < P3.crashZ) {
    k.crashed = true; k.crashSide = Math.sign(k.theta) || 1;
    k.tension = 0; k.forceN = 0; ev.crash = true;
    return ev;
  }

  // --- jump: send-and-load, with the old standing pop as a mini-hop --------
  if (pull < P3.popArmBelow) k.popArmed = true;
  if (!k.airborne && k.popArmed && pull >= P3.popPullMin && windApp >= P3.minWind) {
    const sent = k.sendT <= P3.sendWindow && riderSpeed >= P3.minSendSpeed;
    if (sent) {
      // Faster send + more tension + harder edge = higher jump.
      const sendF = 0.35 + 0.65 * Math.min(2.0, k.sendOmega / 70);
      const tenF = 0.45 + 0.55 * Math.min(1.5, k.tension);
      const edgeF = 0.55 + 0.45 * clamp((heading - 60) / 60, 0, 1);
      k.vy = P3.jumpGain * sendF * tenF * edgeF;
      k.tack = k.sendFrom;          // side to redirect back toward for a clean landing
    } else if (Math.abs(k.theta) < 45 && Math.abs(k.omega) < P3.sendOmegaMin) {
      // standing pop: kite parked overhead, sharp pull — a small hop only.
      // (A fast-moving kite mid-send must cross 12 first; pulling early just
      // powers the turn, as on the water.)
      k.vy = P3.hopGain * pull * Math.min(1.4, windF);
      k.tack = 0;
    } else {
      k.vy = 0;
    }
    if (k.vy > 0) {
      k.airborne = true; k.popArmed = false; k.height = 0;
      k.sendT = Infinity;
      ev.takeoff = true;
    }
  }

  if (k.airborne) {
    // Hang-time: kite parked near 12, bar in => floaty descent.
    const hang = clamp(pos.z, 0, 1) * pull;
    const g = P3.gravity + (P3.hangGravity - P3.gravity) * hang;
    k.height += k.vy * dt;
    k.vy -= g * dt;
    if (k.height <= 0) {
      k.height = 0; k.vy = 0; k.airborne = false;
      // Clean landing = kite redirected back past 12 toward the takeoff side
      // (or nearly there and still turning that way) before touchdown.
      const redirected = k.tack === 0 ||
        Math.sign(k.theta) === k.tack ||
        (Math.abs(k.theta) < 20 && Math.sign(k.omega) === k.tack);
      ev.landing = true; ev.clean = redirected;
    }
  }

  return ev;
}
