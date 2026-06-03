// Headless checks for the shared flight model. Run: `node test/kite-physics.test.mjs`
// Pure module, no DOM — same logic the laptop display and phone game use.
import { PHYS, createKite, stepKite, makeCrossingDetector } from '../public/kite-physics.js';
import { effectiveWind, SPOTS, spotById } from '../public/wind-spots.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); failures++; } else console.log('  ✓ ' + msg); };

// Run the model for `seconds` with fixed inputs; returns the kite + collected events.
function simulate({ barTarget, pull = 0, wind = 18, tau = 2, seconds = 20, dt = 0.05, kite = createKite() }) {
  const events = { crash: 0, relaunch: 0, takeoff: 0, landing: 0 };
  for (let t = 0; t < seconds; t += dt) {
    const ev = stepKite(kite, { barTarget, pull, windNow: wind, tau, dt });
    for (const k of Object.keys(events)) if (ev[k]) events[k]++;
  }
  return { kite, events };
}

console.log('kite-physics:');

// 1. Hold the bar at 45° -> kite settles at ~45° (not the edge).
{
  const { kite } = simulate({ barTarget: 45 });
  ok(Math.abs(kite.theta - 45) < 1 && !kite.crashed, 'holds 45° target without crashing');
}

// 2. Full tilt -> kite flies to the edge and crashes.
{
  const { kite, events } = simulate({ barTarget: PHYS.thetaMax });
  ok(kite.crashed && events.crash >= 1, 'full tilt crashes at the edge (one crash event)');
}

// 3. Crossing detector fires exactly once per genuine left->right crossing.
{
  const d = makeCrossingDetector(0.06);
  let crossings = 0;
  for (const s of [-0.5, -0.5, 0, 0.5, 0.5, 0.3]) if (d.detect(s).crossed12) crossings++;
  ok(crossings === 1, 'one click for a single left->right crossing');
}

// 4. A crashed kite relaunches only with enough wind.
{
  const crashed = () => Object.assign(createKite(), { theta: PHYS.thetaMax, crashed: true, crashSide: 1 });
  const weak = simulate({ barTarget: -PHYS.thetaMax, wind: PHYS.minWind - 2, seconds: 10, kite: crashed() });
  const strong = simulate({ barTarget: -PHYS.thetaMax, wind: 20, seconds: 10, kite: crashed() });
  ok(weak.kite.crashed, 'stays crashed below MIN_WIND');
  ok(!strong.kite.crashed, 'relaunches with enough wind when steering to centre');
}

// 5. Power: a strong pull while overhead pops a jump; more power = faster tracking.
{
  const { kite, events } = simulate({ barTarget: 0, pull: 0.8, wind: 20, seconds: 4 });
  ok(events.takeoff >= 1, 'strong pull while overhead triggers a takeoff');

  // Compare tracking speed at equal (sub-pop) power vs none, toward a 30° target.
  const slow = simulate({ barTarget: 30, pull: 0, seconds: 1 }).kite.theta;
  const fast = simulate({ barTarget: 30, pull: 0.5, seconds: 1 }).kite.theta;
  ok(fast > slow, `power shortens response (${fast.toFixed(1)}° > ${slow.toFixed(1)}° in 1s)`);
}

console.log('\nwind-spots:');

// effectiveWind stays positive and near base for a steady spot; thermal builds.
{
  const maui = spotById('maui');
  let min = Infinity, max = -Infinity;
  for (let t = 0; t < 60; t += 0.5) { const w = effectiveWind(maui, t); min = Math.min(min, w); max = Math.max(max, w); }
  ok(min > 0 && max < 60, 'steady spot wind stays in (0,60) kn');

  const garda = spotById('garda-ora');
  ok(effectiveWind(garda, 120) > effectiveWind(garda, 0), 'thermal spot builds wind over time');
  ok(SPOTS.length >= 5, 'has a handful of spots');
}

console.log(failures === 0 ? '\nAll physics checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
