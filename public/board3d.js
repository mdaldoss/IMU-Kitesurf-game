// Board / rider model. Pure module, no DOM.
//
// The phone's yaw sets the board heading, measured from dead-downwind:
//   0° = running straight downwind, 90° = beam reach (crosswind),
//   >135° = pinching too high upwind. Sign = which way you point (left/right
//   looking downwind).
//
// Speed comes from a simple sailing polar driven by the kite's line tension:
// drive peaks a touch above a beam reach, dies past ~140° (the board stalls
// if you pinch), and is modest dead downwind. Apparent wind feeds back into
// the kite: riding crosswind/upwind powers it up, running deep softens it.

export const B3 = {
  drive: 0.5,        // tension·polar -> acceleration
  drag: 0.45,        // quadratic water drag
  lin: 0.05,         // linear (rail/chop) drag
  pinchDrag: 0.5,    // extra drag while pinching past the polar's edge
  speedKn: 16,       // normalized speed 1.0 ≈ this many knots (display + apparent wind)
  headingTau: 0.35,  // s — yaw input smoothing
  airHeadingTau: 1.6,// s — heading barely steerable mid-air
  stallSpeed: 0.12,  // below this (not airborne) the rider sinks off the plane
  airDecay: 0.05,    // 1/s speed bleed while airborne
  driftGain: 0.008,  // downwind drift per kn of wind while airborne (~30 m on a 5 m jump)
  leeway: 0.02,      // small ever-present downwind slip on the water
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
    speed: 0.6,         // normalized; 1 ≈ cruise
    pos: { x: 0, y: 0 },// metres-ish; x = crosswind, y = downwind (+ = lost ground)
    stalled: false,
    windApp: 18,        // apparent wind at the kite (kn)
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const D2R = Math.PI / 180;

// Advance one timestep. `headingTarget` is the yaw input (deg from downwind,
// signed); `tension` is the kite's line tension this frame.
export function stepBoard(b, { headingTarget, tension, windTrue, airborne = false, dt }) {
  const tau = airborne ? B3.airHeadingTau : B3.headingTau;
  // wrap-aware approach so ±180 doesn't spin the long way round
  let dh = headingTarget - b.heading;
  dh = ((dh + 540) % 360) - 180;
  b.heading += dh * (1 - Math.exp(-dt / tau));
  b.heading = clamp(b.heading, -178, 178);

  const a = Math.abs(b.heading);
  if (airborne) {
    b.speed = Math.max(0, b.speed * (1 - B3.airDecay * dt));
    // the wind owns you mid-air: carried downwind
    b.pos.y += B3.driftGain * windTrue * dt * 60;
  } else {
    const drive = B3.drive * tension * polar(a);
    const pinch = a > 135 ? B3.pinchDrag * (a - 135) / 45 : 0;
    const drag = (B3.drag + pinch) * b.speed * b.speed + B3.lin * b.speed;
    b.speed = Math.max(0, b.speed + (drive - drag) * dt);
    b.stalled = b.speed < B3.stallSpeed;
  }

  // velocity over ground (normalized speed -> kn -> m/s-ish for the world pos)
  const vKn = b.speed * B3.speedKn;
  const v = vKn * 0.514;
  b.pos.x += Math.sin(b.heading * D2R) * v * dt;
  b.pos.y += Math.cos(b.heading * D2R) * v * dt + B3.leeway * windTrue * dt;

  // Apparent wind at the kite: |wind vector − board velocity vector|.
  // Downwind run eats your wind; crosswind/upwind builds it.
  b.windApp = Math.sqrt(Math.max(0,
    windTrue * windTrue + vKn * vKn - 2 * windTrue * vKn * Math.cos(a * D2R)));
  return b;
}
