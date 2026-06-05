// Obstacle field for the standalone kite game. Pure logic (no DOM) so it can be
// unit-tested; the game page renders whatever `items()` returns.
//
// The rider is fixed at the bottom-centre of the wind-window view, so obstacles
// drift IN from a water edge toward the rider (progress `p`: 0 at the edge, 1 at
// the rider). When one arrives you must be airborne to clear it:
//   - 'buoy'   : jump it (airborne AND high enough) or you wipe out.
//   - 'kicker' : a harmless ramp/wave — bonus if you happen to be jumping it.
// `rng` is injectable so tests are deterministic.

export function createObstacles(opts = {}) {
  const rng = opts.rng || Math.random;
  const baseSpeed = opts.baseSpeed ?? 0.3;       // progress/sec edge -> rider
  const minGap = opts.minGap ?? 1.3;             // seconds between spawns
  const maxGap = opts.maxGap ?? 2.8;
  const clearHeight = opts.clearHeight ?? 1.2;   // kite height needed to clear a buoy
  const buoyChance = opts.buoyChance ?? 0.65;
  const firstIn = opts.firstIn ?? 1.6;

  let list = [], nextId = 0, timer = 0, nextIn = firstIn;

  function reset() { list = []; nextId = 0; timer = 0; nextIn = firstIn; }

  function spawn() {
    const side = rng() < 0.5 ? -1 : 1;           // -1 left edge, +1 right edge
    const type = rng() < buoyChance ? 'buoy' : 'kicker';
    list.push({ id: nextId++, side, p: 0, type, done: false, cleared: false });
  }

  // Advance the field. Returns { cleared, hit, hitType, spawned } for this step.
  function update(dt, { wind = 18, airborne = false, height = 0 } = {}) {
    const events = { cleared: 0, hit: false, hitType: null, spawned: 0 };
    timer += dt;
    if (timer >= nextIn) {
      timer -= nextIn;
      nextIn = minGap + rng() * (maxGap - minGap);
      spawn(); events.spawned++;
    }
    const speed = baseSpeed * (0.7 + wind / 50);  // windier = faster, harder
    for (const o of list) {
      o.p += speed * dt;
      if (!o.done && o.p >= 1) {
        o.done = true;
        if (o.type === 'buoy') {
          if (airborne && height >= clearHeight) { o.cleared = true; events.cleared++; }
          else { events.hit = true; events.hitType = 'buoy'; }
        } else if (airborne) {                    // kicker: bonus if jumped
          o.cleared = true; events.cleared++;
        }
      }
    }
    list = list.filter((o) => o.p < 1.2);         // cull once past the rider
    return events;
  }

  return { reset, update, items: () => list, clearHeight };
}

// Name a trick from how much the phone rotated (degrees) during a jump.
export function trickName(spinDeg) {
  if (spinDeg >= 700) return 'Double spin!';
  if (spinDeg >= 520) return '540°';
  if (spinDeg >= 320) return '360°';
  if (spinDeg >= 150) return '180°';
  return null;
}
