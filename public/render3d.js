// Chase-camera 3-D renderer for the sim — hand-rolled perspective projection
// onto a 2D canvas, no libraries, so it runs in any browser and the offline
// Capacitor WebView.
//
// World frame (matches kite3d.js): x = crosswind right, y = downwind, z = up,
// rider at the origin. The camera sits upwind/above the rider looking
// downwind, so the whole wind window fills the view; the board rotates under
// the rider to show the heading, and the water grid scrolls with the rider's
// motion over ground.

import { kitePos, P3 } from './kite3d.js';

const LINE_LEN = 22;          // metres — window sphere radius
const D2R = Math.PI / 180;

export function createRenderer3D(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  // camera — far enough upwind that the whole window (9→12→3) fits on both a
  // portrait phone and a landscape laptop screen
  const CAM = { x: 0, y: -36, z: 10 };
  const LOOK = { x: 0, y: 10, z: 7.5 };
  let F, R, U;               // basis vectors
  {
    const f = norm(sub(LOOK, CAM));
    const r = norm(cross(f, { x: 0, y: 0, z: 1 }));
    F = f; R = r; U = cross(r, f);
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function norm(v) { const m = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / m, y: v.y / m, z: v.z / m }; }
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

  let focal = 600;
  function project(p) {
    const rel = sub(p, CAM);
    const depth = dot(rel, F);
    if (depth < 0.5) return null;
    return {
      x: W / 2 + focal * dot(rel, R) / depth,
      y: H * 0.52 - focal * dot(rel, U) / depth,
      depth,
    };
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = Math.min(W * 0.95, H * 0.85);
  }

  function poly(points, stroke, width, alpha = 1) {
    let started = false;
    ctx.beginPath();
    for (const p of points) {
      if (!p) { started = false; continue; }
      if (!started) { ctx.moveTo(p.x, p.y); started = true; }
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.globalAlpha = alpha;
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  // power-zone tint: cool slate at the window edge → hot amber deep downwind
  function zoneColor(zone, a = 1) {
    const t = Math.min(1, zone * 1.4);
    const r = Math.round(70 + 185 * t), g = Math.round(90 + 80 * t), b = Math.round(130 - 80 * t);
    return `rgba(${r},${g},${b},${a})`;
  }

  const trail = [];            // recent kite positions (world points)

  // snap: the object returned by sim.step(); inputs: { steer }
  function render(snap, inputs = {}) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();

    // --- sky & water ---
    const horizon = project({ x: 0, y: 800, z: 0 });
    const hy = horizon ? horizon.y : H * 0.3;
    let g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, '#0d1730'); g.addColorStop(1, '#1d3a5f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy);
    g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, '#10304d'); g.addColorStop(1, '#0a1525');
    ctx.fillStyle = g; ctx.fillRect(0, hy, W, H - hy);

    // --- water grid, scrolling with the rider's motion over ground ---
    const S = 8, ox = ((snap.boardPos.x % S) + S) % S, oy = ((snap.boardPos.y % S) + S) % S;
    ctx.lineWidth = 1;
    for (let gy = -16; gy <= 110; gy += S) {
      const y = gy - oy;
      const a = project({ x: -90, y, z: 0 }), b = project({ x: 90, y, z: 0 });
      if (a && b) poly([a, b], '#7fb4e6', 1, 0.10);
    }
    for (let gx = -88; gx <= 88; gx += S) {
      const x = gx - ox;
      const a = project({ x, y: -14, z: 0 }), b = project({ x, y: 110, z: 0 });
      if (a && b) poly([a, b], '#7fb4e6', 1, 0.07);
    }

    // --- wind-window lattice, tinted by power-zone intensity ---
    // depth arcs (constant d): theta sweep
    for (const d of [0, 0.33, 0.66, 1]) {
      let prev = null;
      for (let th = -90; th <= 90; th += 7.5) {
        const k = kitePos(th, d);
        const p = project({ x: k.x * LINE_LEN, y: k.y * LINE_LEN, z: k.z * LINE_LEN });
        if (prev && p) {
          const zone = k.y * k.y;
          poly([prev, p], zoneColor(zone, d === 0 ? 0.55 : 0.3), d === 0 ? 1.6 : 1.1);
        }
        prev = p;
      }
    }
    // meridians (constant theta): edge → deep
    for (let th = -90; th <= 90; th += 30) {
      let prev = null;
      for (let d = 0; d <= 1.001; d += 0.125) {
        const k = kitePos(th, d);
        const p = project({ x: k.x * LINE_LEN, y: k.y * LINE_LEN, z: k.z * LINE_LEN });
        if (prev && p) poly([prev, p], zoneColor(k.y * k.y, 0.28), 1.1);
        prev = p;
      }
    }
    // clock labels at the window edge
    ctx.font = '11px ui-monospace, monospace'; ctx.fillStyle = 'rgba(180,200,225,0.6)';
    ctx.textAlign = 'center';
    for (const [th, label] of [[-90, '9'], [-45, '10:30'], [0, '12'], [45, '1:30'], [90, '3']]) {
      const k = kitePos(th, 0);
      const p = project({ x: k.x * (LINE_LEN + 1.6), y: k.y * (LINE_LEN + 1.6), z: k.z * (LINE_LEN + 1.6) + 0.6 });
      if (p) ctx.fillText(label, p.x, p.y);
    }

    // --- kite trail (shows the path through the power zone) ---
    // The sphere is centred on the rider, so a jumping rider lifts the kite too.
    const lift = snap.airborne ? snap.height : 0;
    const kw = kitePos(snap.theta, snap.d);
    const kiteWorld = { x: kw.x * LINE_LEN, y: kw.y * LINE_LEN, z: kw.z * LINE_LEN + lift };
    trail.push({ ...kiteWorld });
    if (trail.length > 50) trail.shift();
    for (let i = 1; i < trail.length; i++) {
      const a = project(trail[i - 1]), b = project(trail[i]);
      if (a && b) poly([a, b], '#58a6ff', 1.4, 0.5 * i / trail.length);
    }

    // --- rider, board, lines, kite ---
    const hRad = snap.heading * D2R;
    const dir = { x: Math.sin(hRad), y: Math.cos(hRad), z: 0 };   // board direction
    const side = { x: dir.y, y: -dir.x, z: 0 };

    // shadow under an airborne rider
    if (snap.airborne) {
      const sh = project({ x: 0, y: 0, z: 0.02 });
      if (sh) {
        ctx.beginPath();
        ctx.ellipse(sh.x, sh.y, Math.max(4, 16 - lift), Math.max(2, 5 - lift / 3), 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      }
    }

    // wake behind the board (length ∝ speed)
    if (!snap.airborne && snap.speed > 0.08) {
      const wlen = 2 + snap.speed * 7;
      for (const s of [-0.35, 0.35]) {
        const a = project({ x: side.x * s, y: side.y * s, z: 0.03 });
        const b = project({ x: side.x * s * 2.4 - dir.x * wlen, y: side.y * s * 2.4 - dir.y * wlen, z: 0.03 });
        if (a && b) poly([a, b], '#cfe7ff', 2, 0.35);
      }
    }

    // board: a quad in world space
    const bl = 0.75, bw = 0.22;
    const corners = [
      { x: dir.x * bl + side.x * bw, y: dir.y * bl + side.y * bw },
      { x: dir.x * bl - side.x * bw, y: dir.y * bl - side.y * bw },
      { x: -dir.x * bl - side.x * bw, y: -dir.y * bl - side.y * bw },
      { x: -dir.x * bl + side.x * bw, y: -dir.y * bl + side.y * bw },
    ].map((c) => project({ x: c.x, y: c.y, z: 0.08 + lift }));
    if (corners.every(Boolean)) {
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = snap.stalled && !snap.airborne ? '#8b949e' : '#e6edf3';
      ctx.fill();
    }

    // rider: legs/torso/head above the board centre
    const hip = project({ x: 0, y: 0, z: 0.9 + lift });
    const headP = project({ x: 0, y: 0, z: 1.65 + lift });
    const feet = project({ x: 0, y: 0, z: 0.1 + lift });
    if (hip && headP && feet) {
      poly([feet, hip, headP], '#e6edf3', 2.5, 0.95);
      ctx.beginPath(); ctx.arc(headP.x, headP.y, Math.max(2.5, 90 / headP.depth), 0, Math.PI * 2);
      ctx.fillStyle = '#e6edf3'; ctx.fill();
    }

    // kite + lines
    const kp = project(kiteWorld);
    if (kp) {
      const scale = focal / kp.depth;             // px per metre at the kite
      // lines from the rider's hands/bar
      const barW = 0.3;
      for (const s of [-1, 1]) {
        const hand = project({ x: side.x * barW * s, y: side.y * barW * s, z: 1.0 + lift });
        if (hand) poly([hand, kp], snap.crashed ? '#f85149' : '#3fb950', 1, 0.65);
      }
      // LEI canopy: an arced wing drawn around the kite point, rolled with theta
      const span = scale * 4.2, chord = span * 0.34;
      const roll = snap.theta * D2R * 0.9;
      ctx.save();
      ctx.translate(kp.x, kp.y);
      ctx.rotate(roll);
      const col = snap.crashed ? '#f85149' : snap.airborne ? '#3fb950' : '#58a6ff';
      ctx.beginPath();
      ctx.moveTo(-span / 2, chord * 0.45);
      ctx.quadraticCurveTo(0, -chord, span / 2, chord * 0.45);
      ctx.quadraticCurveTo(0, -chord * 0.25, -span / 2, chord * 0.45);
      ctx.fillStyle = col; ctx.fill();
      ctx.restore();
    }

    // steering target hint: where the bar is pushing the kite (faint chevron)
    if (inputs.steer != null && Math.abs(inputs.steer) > 0.08 && !snap.crashed) {
      const ahead = kitePos(Math.max(-88, Math.min(88, snap.theta + Math.sign(inputs.steer) * 18)), snap.d);
      const ap = project({ x: ahead.x * LINE_LEN, y: ahead.y * LINE_LEN, z: ahead.z * LINE_LEN });
      if (ap && kp) poly([kp, ap], '#e3b341', 1.5, 0.35 + 0.4 * Math.abs(inputs.steer));
    }

    // wind arrow, top-left in world: floats upwind pointing downwind
    const aw = [{ x: -12, y: -4, z: 9 }, { x: -12, y: 1, z: 9 }];
    const a0 = project(aw[0]), a1 = project(aw[1]);
    if (a0 && a1) {
      poly([a0, a1], '#8b949e', 2, 0.8);
      const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a1.x - 9 * Math.cos(ang - 0.45), a1.y - 9 * Math.sin(ang - 0.45));
      ctx.lineTo(a1.x - 9 * Math.cos(ang + 0.45), a1.y - 9 * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fillStyle = '#8b949e'; ctx.fill();
      ctx.fillText('wind', (a0.x + a1.x) / 2, a0.y - 8);
    }
  }

  resize();
  return { render, resize, clearTrail: () => { trail.length = 0; } };
}
