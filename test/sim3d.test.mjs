// Headless checks for the 3-D sim (kite window + power zone + board).
// Run: `node test/sim3d.test.mjs`
import { createSim3D, kitePos, P3, B3, polar } from '../public/sim3d.js';
import { createKite3, stepKite3, kiteById } from '../public/kite3d.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } else console.log('  ✓ ' + msg); };

const DT = 1 / 60;

// Drive a sim for `seconds` with an input function of time.
function run(sim, seconds, inputs) {
  let snap;
  for (let t = 0; t < seconds; t += DT) snap = sim.step({ dt: DT, ...inputs(t) });
  return snap;
}
// Sine the kite: work it left/right around 12 with the bar in (the real
// light-wind technique — modest amplitude, kite stays between ~10:30 and 1:30).
const sining = (t) => ({ steer: Math.sin(t * 2.2) * 0.55, pull: 0.7, heading: 95, wind: 18 });
// Park it: no steering, bar out.
const parked = (t) => ({ steer: 0, pull: 0.1, heading: 95, wind: 18 });

console.log('kite3d — tension & power zone:');

// 1. Wind enters squared: same flying state, double wind ≈ 4x tension.
{
  const t12 = run(createSim3D(), 10, (t) => ({ ...sining(t), wind: 12 })).tension;
  const t24 = run(createSim3D(), 10, (t) => ({ ...sining(t), wind: 24 })).tension;
  const ratio = t24 / t12;
  ok(ratio > 2.5, `tension scales ~wind² (24kn/12kn ratio ${ratio.toFixed(1)}, capped by clamps)`);
}

// 2. A parked kite drifts to the window edge (low zone); sine-ing flies deep.
{
  const p = run(createSim3D(), 12, parked);
  const s = run(createSim3D(), 12, sining);
  ok(p.d < 0.25, `parked kite sits near the edge (d=${p.d.toFixed(2)})`);
  ok(s.zone > p.zone, `diving kite is deeper in the power zone (${s.zone.toFixed(2)} > ${p.zone.toFixed(2)})`);
  ok(s.tension > 2 * p.tension, `dive tension ≫ parked tension (${s.tension.toFixed(2)} vs ${p.tension.toFixed(2)})`);
}

// 3. Kite size: a 7 m turns faster than a 13 m; the 13 m pulls harder.
{
  const small = createSim3D({ kiteId: '7' }), big = createSim3D({ kiteId: '13' });
  const after = (sim) => run(sim, 0.8, () => ({ steer: 1, pull: 0.6, heading: 95, wind: 18 })).theta;
  const th7 = after(small), th13 = after(big);
  ok(th7 > th13, `7 m turns faster (θ ${th7.toFixed(0)}° vs ${th13.toFixed(0)}° after 0.8 s)`);
  const t7 = run(createSim3D({ kiteId: '7' }), 10, sining).tension;
  const t13 = run(createSim3D({ kiteId: '13' }), 10, sining).tension;
  ok(t13 > t7, `13 m pulls harder at equal wind (${t13.toFixed(2)} > ${t7.toFixed(2)})`);
}

// 4. The 3-D position is sane: edge at d=0, downwind at full depth, zenith up.
{
  const zen = kitePos(0, 0);
  ok(Math.abs(zen.z - 1) < 1e-9 && Math.abs(zen.y) < 1e-9, 'd=0, θ=0 is the zenith');
  const deep = kitePos(0, 1);
  ok(deep.y > 0.9, 'full depth swings the kite toward dead-downwind');
  const side = kitePos(90, 0);
  ok(Math.abs(side.x - 1) < 1e-9, 'θ=90, d=0 is the right window edge at the water');
}

// 5. Holding a full dive eventually flies the kite into the water (crash).
{
  const sim = createSim3D();
  let crashed = false;
  for (let t = 0; t < 15; t += DT) {
    const s = sim.step({ steer: 1, pull: 0.9, heading: 95, wind: 18, dt: DT });
    if (s.crashed) { crashed = true; break; }
  }
  ok(crashed, 'holding a hard dive crashes the kite at the water');
}

console.log('\nboard3d — heading, polar, apparent wind:');

// 6. Pinching too far upwind stalls the board; a beam reach keeps planing.
{
  const beam = run(createSim3D(), 20, (t) => ({ ...sining(t), heading: 100 }));
  const pinch = run(createSim3D(), 20, (t) => ({ ...sining(t), heading: 160 }));
  ok(beam.speed > 5, `beam reach sustains planing speed (${beam.speedKn.toFixed(0)} kn)`);
  ok(pinch.speed < 1.5 && pinch.stalled, `pinching past the polar stalls (${pinch.speedKn.toFixed(1)} kn)`);
  ok(polar(160) < 0.05 && polar(105) > 0.95, 'polar peaks past beam, dies upwind');
}

// 6b. Real magnitudes: cruise line force ≈ one body weight; speed ≈ wind.
{
  const s = run(createSim3D(), 20, sining);
  ok(s.forceN > 350 && s.forceN < 1600,
    `cruise line force is human-scale (${s.forceN.toFixed(0)} N ≈ ${(s.forceN / 9.81).toFixed(0)} kg)`);
  ok(s.speedKn > 10 && s.speedKn < 36, `cruise speed ~wind speed (${s.speedKn.toFixed(0)} kn in 18 kn)`);
}

// 7. Park the kite while riding -> the board bleeds speed, and the effect of
//    the kite leaving the power zone is felt almost instantly (F = m·a on
//    80 kg: drag ≈ 500 N at cruise ⇒ ~5 m/s² the moment drive vanishes).
{
  const sim = createSim3D();
  run(sim, 15, sining);                      // get up to cruise
  const cruising = sim.board.speed;
  const soon = run(sim, 0.7, parked).speed;  // kite just left the zone
  ok(cruising - soon > 1.0,
    `deceleration is near-instant (${((cruising - soon) / 0.7).toFixed(1)} m/s² in the first 0.7 s)`);
  const after = run(sim, 7.3, parked).speed;
  ok(after < cruising * 0.5, `parking the kite bleeds speed (${(cruising * B3.KN).toFixed(0)} → ${(after * B3.KN).toFixed(0)} kn)`);
}

// 8. Apparent wind: crosswind riding builds it, a downwind run eats it.
{
  const cross = run(createSim3D(), 15, (t) => ({ ...sining(t), heading: 110 }));
  ok(cross.windApp > cross.windTrue, `upwind-ish apparent > true (${cross.windApp.toFixed(1)} > ${cross.windTrue}kn)`);
  const sim = createSim3D();
  run(sim, 15, sining);
  const deep = run(sim, 6, (t) => ({ ...sining(t), heading: 10 }));
  ok(deep.windApp < deep.windTrue, `downwind run apparent < true (${deep.windApp.toFixed(1)} < ${deep.windTrue}kn)`);
}

console.log('\nkite3d — jumps (send-and-load):');

// Ride to cruise, send the kite hard across 12, sheet in on the far side.
function jumpRun(sendSteer, { pullOnSend = 0.95, redirect = true } = {}) {
  const sim = createSim3D({ kiteId: '9' });
  run(sim, 12, (t) => ({ steer: Math.sin(t * 2.2) * 0.55, pull: 0.6, heading: 105, wind: 22 }));
  // park briefly at ~10 o'clock (left), bar out to re-arm the pop
  run(sim, 1.2, () => ({ steer: -0.45, pull: 0.15, heading: 105, wind: 22 }));
  let peak = 0, took = false, landedClean = null, drift0 = null, drift1 = null;
  for (let t = 0; t < 8; t += DT) {
    const steer = t < 0.9 ? sendSteer                       // send: hard right
      : (redirect && took ? -0.8 : 0.15);                   // then back forward (or not)
    const s = sim.step({ steer, pull: t < 0.25 ? 0.2 : pullOnSend, heading: 105, wind: 22, dt: DT });
    if (s.events.takeoff) { took = true; drift0 = s.boardPos.y; }
    if (took && s.airborne) peak = Math.max(peak, s.height);
    if (took && s.events.landing) { landedClean = s.events.clean; drift1 = s.boardPos.y; break; }
  }
  return { peak, took, landedClean, drift: drift1 != null ? drift1 - drift0 : 0, speed: sim.board.speed };
}

// 9. A fast send jumps far higher than a slow one or a standing hop.
{
  const fast = jumpRun(1.0);
  const slow = jumpRun(0.45);
  ok(fast.took && slow.took, 'both sends take off');
  ok(fast.peak > slow.peak * 1.3, `faster send → higher jump (${fast.peak.toFixed(1)}m vs ${slow.peak.toFixed(1)}m)`);
  ok(fast.peak > 2, `a committed send gets real height (${fast.peak.toFixed(1)}m)`);
}

// 10. The rider is dragged downwind while airborne.
{
  const j = jumpRun(1.0);
  ok(j.drift > 0, `airborne drift is downwind (+${j.drift.toFixed(1)}m)`);
}

// 11. Redirecting the kite forward lands clean; leaving it behind dumps speed.
{
  const good = jumpRun(1.0, { redirect: true });
  const bad = jumpRun(1.0, { redirect: false });
  ok(good.landedClean === true, 'redirected kite → clean landing');
  ok(bad.landedClean === false, 'kite left behind → botched landing');
  ok(good.speed > bad.speed, `clean landing keeps speed (${good.speed.toFixed(2)} > ${bad.speed.toFixed(2)})`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
