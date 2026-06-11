// Facade composing wind + 3-D kite + board into a single sim. Every front-end
// (laptop trainer, standalone phone, keyboard desktop, headless tests) calls
// exactly one function per frame: sim.step(inputs, dt).

import { createKite3, stepKite3, kitePos, kiteById, KITES, P3 } from './kite3d.js';
import { createBoard, stepBoard, polar, B3 } from './board3d.js';
import { effectiveWind, spotById } from './wind-spots.js';

export { KITES, P3, B3, polar, kitePos };

export function createSim3D({ kiteId = '12', spotId = 'maui' } = {}) {
  let kite = createKite3(kiteId);
  let board = createBoard();
  let spot = spotById(spotId);
  let tSec = 0;

  function reset() {
    const id = kite.def.id;
    kite = createKite3(id);
    board = createBoard();
    tSec = 0;
  }

  return {
    get kite() { return kite; },
    get board() { return board; },
    get spot() { return spot; },
    setKite(id) { kite.def = kiteById(id); },
    setSpot(id) { spot = spotById(id); reset(); },
    reset,

    // inputs: steer −1..1, pull 0..1, heading deg-from-downwind (signed),
    // dt seconds. `wind` (kn) overrides the spot model — used by the tests.
    step({ steer, pull = 0, heading = 95, dt, wind }) {
      tSec += dt;
      const windTrue = wind ?? effectiveWind(spot, tSec);

      // kite sees last frame's apparent wind; board consumes this frame's tension
      const ev = stepKite3(kite, {
        steer, pull, windApp: board.windApp, dt,
        riderSpeed: board.speed, heading: Math.abs(board.heading),
      });
      stepBoard(board, {
        headingTarget: heading, forceN: kite.crashed ? 0 : kite.forceN,
        windTrue, airborne: kite.airborne, dt,
      });
      // a botched landing dumps the rider's speed
      if (ev.landing) board.speed *= ev.clean ? 0.85 : 0.25;

      const pos = kitePos(kite.theta, kite.d);
      return {
        tSec, windTrue, windApp: board.windApp,
        theta: kite.theta, d: kite.d, omega: kite.omega, pos,
        tension: kite.tension, forceN: kite.forceN, zone: kite.zone,
        crashed: kite.crashed, airborne: kite.airborne,
        height: kite.height, vy: kite.vy,
        heading: board.heading, speed: board.speed,
        speedKn: board.speed * B3.KN,
        stalled: board.stalled, boardPos: { ...board.pos },
        events: ev,
      };
    },
  };
}
