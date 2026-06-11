// Board / rider model — real units. Pure module, no DOM.
//
// The phone's yaw sets the board heading, measured from dead-downwind:
//   0° = running straight downwind, 90° = beam reach (crosswind),
//   >135° = pinching too high upwind. Sign = which way you point (left/right
//   looking downwind).
//
// Newton, not hand-waving: the kite hands us its line force in newtons
// (kite3d.js, F = ½ρACv²); we project it through a sailing polar into drive,
// subtract planing-board water drag, and divide by the mass of a 70 kg rider
// plus board/kite gear. With ~600 N of cruise drive on 80 kg the response to
// a kite reposition is a ~5–8 m/s² acceleration — felt almost instantly —
// and a power-zone dive (1.5–2.5 kN) shoves at over 1 g, just like the real
// yank in the harness.

export const B3 = {
  mass: 80,          // kg — 70 kg rider + ~10 kg board/kite/harness
  driveEff: 0.9,     // fraction of line force usable as drive at the ideal angle
  dragQ: 6.5,        // N/(m/s)² — planing water drag (quadratic)
  dragL: 12,         // N/(m/s) — rail/chop drag (linear)
  offPlane: 2.5,     // m/s — below this the hull ploughs: drag multiplies up
  offPlaneMul: 2.2,  // displacement-mode drag multiplier at standstill
  pinchQ: 30,        // extra quadratic drag at full pinch (rail dug in upwind)
  maxRatio: 1.55,    // top speed ≈ this × true wind: past it the apparent wind
                     // has swung so far forward the kite has no drive left
  headingTau: 0.35,  // s — yaw input smoothing
  airHeadingTau: 1.6,// s — heading barely steerable mid-air
  stallSpeed: 1.0,   // m/s — below this (on the water) the rider is stalled
  airDecay: 0.05,    // 1/s speed bleed while airborne
  airDrift: 0.35,    // airborne downwind drift, fraction of true wind speed
  leeway: 0.01,      // ever-present downwind slip, fraction-ish of wind (kn→m/s)
  KN: 1.9438,        // m/s -> knots
};

// Sailing polar: drive factor vs |heading from downwind| (deg).
const POLAR = [
  [0, 0.5], [45, 0.7], [90, 0.95], [110, 1.0], [125, 0.75],
  [135, 0.4], [142, 0.08], [150, 0], [180, 0],
];
export function polar(absHeading) {
  const h = Math.min(180, Math.max(0, absHeading));
  for (let i = 1; i < POLAR.length; i++) {
    if (h <= POLAR[i][0]) {
      const [h0, v0] = POLAR[i - 1], [h1, v1] = POLAR[i];
      return v0 + (v1 - v0) * (h - h0) / (h1 - h0);
    }
  }
  return 0;
}

export function createBoard() {
  return {
    heading: 95,        // start on a beam reach, pointing right
    speed: 3,           // m/s over ground
    pos: { x: 0, y: 0 },// metres; x = crosswind, y = downwind (+ = ground lost)
    stalled: false,
    windApp: 18,        // apparent wind at the kite (kn)
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const D2R = Math.PI / 180;

// Advance one timestep. `headingTarget` is the yaw input (deg from downwind,
// signed); `forceN` is the kite's line force in newtons this frame.
export function stepBoard(b, { headingTarget, forceN, windTrue, airborne = false, dt }) {
  const tau = airborne ? B3.airHeadingTau : B3.headingTau;
  // wrap-aware approach so ±180 doesn't spin the long way round
  let dh = headingTarget - b.heading;
  dh = ((dh + 540) % 360) - 180;
  b.heading += dh * (1 - Math.exp(-dt / tau));
  b.heading = clamp(b.heading, -178, 178);

  const a = Math.abs(b.heading);
  const windMs = windTrue * 0.514;
  if (airborne) {
    b.speed = Math.max(0, b.speed * (1 - B3.airDecay * dt));
    // the wind owns you mid-air: carried downwind
    b.pos.y += B3.airDrift * windMs * dt;
  } else {
    // forward-drive fade: as boat speed approaches maxRatio × wind, the
    // apparent wind angle closes out the drive (the real top-speed limiter)
    const fade = clamp(1 - b.speed / Math.max(2, windMs * B3.maxRatio), 0, 1);
    const drive = forceN * B3.driveEff * polar(a) * fade;          // N
    const pinch = a > 135 ? B3.pinchQ * (a - 135) / 45 : 0;
    let drag = (B3.dragQ + pinch) * b.speed * b.speed + B3.dragL * b.speed;
    if (b.speed < B3.offPlane) {                                   // hull ploughing
      drag *= 1 + (B3.offPlaneMul - 1) * (1 - b.speed / B3.offPlane);
    }
    b.speed = Math.max(0, b.speed + (drive - drag) / B3.mass * dt); // F = m·a
    b.stalled = b.speed < B3.stallSpeed;
  }

  b.pos.x += Math.sin(b.heading * D2R) * b.speed * dt;
  b.pos.y += Math.cos(b.heading * D2R) * b.speed * dt + B3.leeway * windTrue * dt;

  // Apparent wind at the kite: |wind vector − board velocity vector|.
  // Downwind run eats your wind; crosswind/upwind builds it.
  const vKn = b.speed * B3.KN;
  b.windApp = Math.sqrt(Math.max(0,
    windTrue * windTrue + vKn * vKn - 2 * windTrue * vKn * Math.cos(a * D2R)));
  return b;
}
