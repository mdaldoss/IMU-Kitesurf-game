// Chase-camera 3-D renderer for the sim — hand-rolled perspective projection
// onto a 2D canvas, no libraries or image assets, so it runs in any browser
// and the offline Capacitor WebView.
//
// World frame (matches kite3d.js): x = crosswind right, y = downwind, z = up,
// rider at the origin. The camera sits upwind/above the rider looking
// downwind, so the whole wind window fills the view; the board rotates under
// the rider to show the heading, and the water grid scrolls with the rider's
// motion over ground. Scenery (sun, mountains, clouds, waves, spray) is all
// procedural.

import { kitePos } from './kite3d.js';

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

  // deterministic hash for procedural scatter (waves, ridge line)
  const hash = (n) => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };

  const trail = [];            // recent kite positions (world points)
  const spray = [];            // particles {x,y,z,vx,vy,vz,life}
  let lastT = 0;

  // --- scenery pieces -------------------------------------------------------

  function drawSky(hy, t) {
    let g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, '#10213f'); g.addColorStop(0.65, '#27496b'); g.addColorStop(1, '#4a7396');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy);

    // sun + glow
    const sx = W * 0.76, sy = hy - H * 0.16, sr = Math.max(14, H * 0.035);
    g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 5);
    g.addColorStop(0, 'rgba(255,236,180,0.85)'); g.addColorStop(0.25, 'rgba(255,210,130,0.25)');
    g.addColorStop(1, 'rgba(255,210,130,0)');
    ctx.fillStyle = g; ctx.fillRect(sx - sr * 5, sy - sr * 5, sr * 10, sr * 10);
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fillStyle = '#ffe9b8'; ctx.fill();

    // clouds: soft blobs drifting slowly downwind (left → right of the sky)
    ctx.fillStyle = 'rgba(220,232,245,0.13)';
    for (let i = 0; i < 4; i++) {
      const speed = 8 + 6 * hash(i + 9);
      const cx = ((hash(i) * 1.6 * W + t * speed) % (W * 1.4)) - W * 0.2;
      const cy = hy * (0.18 + 0.5 * hash(i + 4));
      const s = H * (0.025 + 0.03 * hash(i + 7));
      for (let j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.ellipse(cx + (j - 1.5) * s * 1.4, cy + (j % 2) * s * 0.4, s * (1.3 - 0.18 * j), s * 0.75, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // mountain silhouettes on the horizon, two layers
    for (const [amp, col, seed] of [[0.085, '#1c3553', 17], [0.05, '#27496b', 53]]) {
      ctx.beginPath(); ctx.moveTo(0, hy + 1);
      for (let x = 0; x <= W; x += 14) {
        const n = x / W * 7 + seed;
        const h = (hash(Math.floor(n)) * (1 - (n % 1)) + hash(Math.floor(n) + 1) * (n % 1));
        ctx.lineTo(x, hy + 1 - h * H * amp);
      }
      ctx.lineTo(W, hy + 1); ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
    }
  }

  function drawWater(hy, snap, t) {
    let g = ctx.createLinearGradient(0, hy, 0, H);
    g.addColorStop(0, '#2c5d80'); g.addColorStop(0.35, '#17405f'); g.addColorStop(1, '#0a1c30');
    ctx.fillStyle = g; ctx.fillRect(0, hy, W, H - hy);

    // sun glitter column on the water
    const sx = W * 0.76;
    g = ctx.createLinearGradient(0, hy, 0, H * 0.85);
    g.addColorStop(0, 'rgba(255,225,150,0.20)'); g.addColorStop(1, 'rgba(255,225,150,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - W * 0.05, hy, W * 0.1, H * 0.85 - hy);

    // grid scrolling with motion over ground (faint, gives speed cues)
    const S = 8, ox = ((snap.boardPos.x % S) + S) % S, oy = ((snap.boardPos.y % S) + S) % S;
    for (let gy = -16; gy <= 110; gy += S) {
      const a = project({ x: -90, y: gy - oy, z: 0 }), b = project({ x: 90, y: gy - oy, z: 0 });
      if (a && b) poly([a, b], '#7fb4e6', 1, 0.07);
    }
    for (let gx = -88; gx <= 88; gx += S) {
      const a = project({ x: gx - ox, y: -14, z: 0 }), b = project({ x: gx - ox, y: 110, z: 0 });
      if (a && b) poly([a, b], '#7fb4e6', 1, 0.05);
    }

    // wave marks: short crests scattered on the plane, scrolling like the grid
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 42; i++) {
      const span = 160, depthSpan = 110;
      let wx = (hash(i + 1) * span) - span / 2 - snap.boardPos.x;
      let wy = (hash(i + 60) * depthSpan) - 10 - snap.boardPos.y;
      wx = ((wx % span) + span * 1.5) % span - span / 2;
      wy = ((wy % depthSpan) + depthSpan * 1.5) % depthSpan - 10;
      const bob = Math.sin(t * 1.7 + i * 2.1);
      const a = project({ x: wx - 1.2, y: wy, z: 0 });
      const b = project({ x: wx, y: wy + 0.45, z: 0.06 + 0.04 * bob });
      const c = project({ x: wx + 1.2, y: wy, z: 0 });
      if (a && b && c) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(b.x, b.y, c.x, c.y);
        ctx.strokeStyle = `rgba(200,228,250,${0.10 + 0.08 * bob})`;
        ctx.stroke();
      }
    }
  }

  function drawWindow() {
    for (const d of [0, 0.33, 0.66, 1]) {
      let prev = null;
      for (let th = -90; th <= 90; th += 7.5) {
        const k = kitePos(th, d);
        const p = project({ x: k.x * LINE_LEN, y: k.y * LINE_LEN, z: k.z * LINE_LEN });
        if (prev && p) {
          const zone = k.y * k.y;
          poly([prev, p], zoneColor(zone, d === 0 ? 0.5 : 0.26), d === 0 ? 1.6 : 1.1);
        }
        prev = p;
      }
    }
    for (let th = -90; th <= 90; th += 30) {
      let prev = null;
      for (let d = 0; d <= 1.001; d += 0.125) {
        const k = kitePos(th, d);
        const p = project({ x: k.x * LINE_LEN, y: k.y * LINE_LEN, z: k.z * LINE_LEN });
        if (prev && p) poly([prev, p], zoneColor(k.y * k.y, 0.24), 1.1);
        prev = p;
      }
    }
    ctx.font = '11px ui-monospace, monospace'; ctx.fillStyle = 'rgba(180,200,225,0.55)';
    ctx.textAlign = 'center';
    for (const [th, label] of [[-90, '9'], [-45, '10:30'], [0, '12'], [45, '1:30'], [90, '3']]) {
      const k = kitePos(th, 0);
      const p = project({ x: k.x * (LINE_LEN + 1.6), y: k.y * (LINE_LEN + 1.6), z: k.z * (LINE_LEN + 1.6) + 0.6 });
      if (p) ctx.fillText(label, p.x, p.y);
    }
  }

  // LEI kite: arced canopy with struts and wingtips, rolled with theta.
  function drawKite(kp, snap) {
    const scale = focal / kp.depth;
    const span = scale * 4.4, chord = span * 0.36;
    const roll = snap.theta * D2R * 0.9;
    const body = snap.crashed ? '#e0524e' : snap.airborne ? '#46c463' : '#58a6ff';
    const dark = snap.crashed ? '#9e2f2c' : snap.airborne ? '#2c8a44' : '#3c79c4';
    ctx.save();
    ctx.translate(kp.x, kp.y);
    ctx.rotate(roll);
    // canopy
    ctx.beginPath();
    ctx.moveTo(-span / 2, chord * 0.5);
    ctx.quadraticCurveTo(-span * 0.28, -chord * 1.05, 0, -chord * 1.1);
    ctx.quadraticCurveTo(span * 0.28, -chord * 1.05, span / 2, chord * 0.5);
    ctx.quadraticCurveTo(span * 0.26, -chord * 0.28, 0, -chord * 0.32);
    ctx.quadraticCurveTo(-span * 0.26, -chord * 0.28, -span / 2, chord * 0.5);
    ctx.fillStyle = body; ctx.fill();
    // leading edge
    ctx.beginPath();
    ctx.moveTo(-span / 2, chord * 0.5);
    ctx.quadraticCurveTo(-span * 0.28, -chord * 1.05, 0, -chord * 1.1);
    ctx.quadraticCurveTo(span * 0.28, -chord * 1.05, span / 2, chord * 0.5);
    ctx.strokeStyle = dark; ctx.lineWidth = Math.max(1, chord * 0.13); ctx.stroke();
    // struts
    ctx.lineWidth = Math.max(0.6, chord * 0.06); ctx.strokeStyle = dark;
    for (const fx of [-0.32, 0, 0.32]) {
      ctx.beginPath();
      ctx.moveTo(span * fx, -chord * (1.02 - 0.45 * Math.abs(fx)));
      ctx.lineTo(span * fx * 1.18, -chord * (0.30 - 0.5 * Math.abs(fx)));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Kitesurfer: posed stick figure — knees bent, leaning against the pull,
  // arms to the bar, harness line to the kite.
  function drawRider(snap, kp, lift, dirS) {
    const base = project({ x: 0, y: 0, z: 0.12 + lift });
    if (!base) return;
    const s = focal / base.depth;                 // px per metre at the rider
    const toKite = kp ? Math.atan2(kp.y - base.y, kp.x - base.x) : -Math.PI / 2;
    // lean: against the pull when powered (edging), upright when slack
    const lean = Math.min(0.5, 0.12 + snap.tension * 0.16) * (kp && kp.x < base.x ? 1 : -1);
    const up = -Math.PI / 2 + lean;
    const P = (px, py) => ({ x: base.x + px, y: base.y + py });
    // stance along the board's screen direction
    const stance = s * 0.34;
    const fxa = Math.cos(dirS) * stance, fya = Math.sin(dirS) * stance;
    const footL = P(-fxa, -fya), footR = P(fxa, fya);
    const knee = P(Math.cos(up) * s * 0.45 - Math.cos(dirS) * s * 0.06, Math.sin(up) * s * 0.45);
    const hip = P(Math.cos(up) * s * 0.82, Math.sin(up) * s * 0.82);
    const shoulder = P(Math.cos(up) * s * 1.34, Math.sin(up) * s * 1.34);
    const head = P(Math.cos(up) * s * 1.56, Math.sin(up) * s * 1.56);
    // bar sits toward the kite from the shoulders
    const bar = { x: shoulder.x + Math.cos(toKite) * s * 0.42, y: shoulder.y + Math.sin(toKite) * s * 0.42 };

    // harness line: hip → bar (the chicken loop)
    poly([hip, bar], '#d2a85a', Math.max(1, s * 0.035), 0.9);
    // legs (two, slightly split), torso
    poly([footL, knee, hip], '#0e1622', Math.max(1.5, s * 0.085), 0.95);
    poly([footR, knee], '#0e1622', Math.max(1.5, s * 0.085), 0.95);
    poly([hip, shoulder], '#2f6db3', Math.max(1.8, s * 0.105), 0.95);   // wetsuit top
    // arms to the bar
    poly([shoulder, bar], '#2f6db3', Math.max(1.2, s * 0.06), 0.95);
    // bar: short segment perpendicular to the lines
    const bperp = toKite + Math.PI / 2;
    poly([{ x: bar.x + Math.cos(bperp) * s * 0.22, y: bar.y + Math.sin(bperp) * s * 0.22 },
          { x: bar.x - Math.cos(bperp) * s * 0.22, y: bar.y - Math.sin(bperp) * s * 0.22 }],
      '#e6edf3', Math.max(1.5, s * 0.05));
    // head
    ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(2.5, s * 0.11), 0, Math.PI * 2);
    ctx.fillStyle = '#e8c39e'; ctx.fill();
    return bar;
  }

  function updateSpray(snap, dt, dir, side) {
    if (!snap.airborne && snap.speed > 3.5) {
      const n = Math.min(4, Math.round(snap.speed / 4));
      for (let i = 0; i < n; i++) {
        const sd = (Math.random() - 0.5);
        spray.push({
          x: -dir.x * 0.8 + side.x * sd * 0.7, y: -dir.y * 0.8 + side.y * sd * 0.7, z: 0.1,
          vx: -dir.x * snap.speed * 0.35 + side.x * sd * 2.5,
          vy: -dir.y * snap.speed * 0.35 + side.y * sd * 2.5,
          vz: 1.6 + Math.random() * 2.2, life: 0.7,
        });
      }
    }
    for (let i = spray.length - 1; i >= 0; i--) {
      const p = spray[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.z += p.vz * dt; p.vz -= 9.8 * dt;
      if (p.life <= 0 || p.z < 0) { spray.splice(i, 1); continue; }
      const q = project(p);
      if (q) {
        ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(0.8, focal / q.depth * 0.05), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(225,242,255,${0.55 * p.life / 0.7})`; ctx.fill();
      }
    }
  }

  // --- main -----------------------------------------------------------------

  // snap: the object returned by sim.step(); inputs: { steer }
  function render(snap, inputs = {}) {
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();
    const t = performance.now() / 1000;
    const dt = Math.min(0.05, t - lastT || 0.016);
    lastT = t;

    const horizon = project({ x: 0, y: 800, z: 0 });
    const hy = horizon ? horizon.y : H * 0.3;
    drawSky(hy, t);
    drawWater(hy, snap, t);
    drawWindow();

    // kite trail (path through the power zone). Sphere is centred on the
    // rider, so a jumping rider lifts the kite too.
    const lift = snap.airborne ? snap.height : 0;
    const kw = kitePos(snap.theta, snap.d);
    const kiteWorld = { x: kw.x * LINE_LEN, y: kw.y * LINE_LEN, z: kw.z * LINE_LEN + lift };
    trail.push({ ...kiteWorld });
    if (trail.length > 50) trail.shift();
    for (let i = 1; i < trail.length; i++) {
      const a = project(trail[i - 1]), b = project(trail[i]);
      if (a && b) poly([a, b], '#58a6ff', 1.4, 0.45 * i / trail.length);
    }

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
    if (!snap.airborne && snap.speed > 1.2) {
      const wlen = 1.5 + snap.speed * 0.9;
      for (const sdv of [-0.35, 0.35]) {
        const a = project({ x: side.x * sdv, y: side.y * sdv, z: 0.03 });
        const b = project({ x: side.x * sdv * 2.4 - dir.x * wlen, y: side.y * sdv * 2.4 - dir.y * wlen, z: 0.03 });
        if (a && b) poly([a, b], '#cfe7ff', 2, 0.35);
      }
    }
    updateSpray(snap, dt, dir, side);

    // board: a quad in world space
    const bl = 0.75, bw = 0.22;
    const corners = [
      { x: dir.x * bl + side.x * bw, y: dir.y * bl + side.y * bw },
      { x: dir.x * bl - side.x * bw, y: dir.y * bl - side.y * bw },
      { x: -dir.x * bl - side.x * bw, y: -dir.y * bl - side.y * bw },
      { x: -dir.x * bl + side.x * bw, y: -dir.y * bl + side.y * bw },
    ].map((c) => project({ x: c.x, y: c.y, z: 0.08 + lift }));
    let dirS = 0;
    if (corners.every(Boolean)) {
      dirS = Math.atan2(corners[0].y - corners[2].y, corners[0].x - corners[2].x);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const c of corners.slice(1)) ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = snap.stalled && !snap.airborne ? '#8b949e' : '#f0b34c';
      ctx.fill();
      ctx.strokeStyle = '#9a6c1f'; ctx.lineWidth = 1; ctx.stroke();
    }

    // kite + lines + rider
    const kp = project(kiteWorld);
    const barPt = drawRider(snap, kp, lift, dirS);
    if (kp) {
      const anchor = barPt || project({ x: 0, y: 0, z: 1 + lift });
      if (anchor) {
        // two flying lines, slightly split
        const lperp = Math.atan2(kp.y - anchor.y, kp.x - anchor.x) + Math.PI / 2;
        for (const sdv of [-1, 1]) {
          const a = { x: anchor.x + Math.cos(lperp) * 3 * sdv, y: anchor.y + Math.sin(lperp) * 3 * sdv };
          poly([a, kp], snap.crashed ? '#f85149' : '#9ad1a4', 1, 0.6);
        }
      }
      drawKite(kp, snap);
    }

    // steering target hint: where the bar is pushing the kite (faint chevron)
    if (inputs.steer != null && Math.abs(inputs.steer) > 0.08 && !snap.crashed && kp) {
      const ahead = kitePos(Math.max(-88, Math.min(88, snap.theta + Math.sign(inputs.steer) * 18)), snap.d);
      const ap = project({ x: ahead.x * LINE_LEN, y: ahead.y * LINE_LEN, z: ahead.z * LINE_LEN + lift });
      if (ap) poly([kp, ap], '#e3b341', 1.5, 0.35 + 0.4 * Math.abs(inputs.steer));
    }

    // wind arrow: floats upwind pointing downwind
    const a0 = project({ x: -12, y: -4, z: 9 }), a1 = project({ x: -12, y: 1, z: 9 });
    if (a0 && a1) {
      poly([a0, a1], '#aebfd1', 2, 0.85);
      const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
      ctx.beginPath();
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a1.x - 9 * Math.cos(ang - 0.45), a1.y - 9 * Math.sin(ang - 0.45));
      ctx.lineTo(a1.x - 9 * Math.cos(ang + 0.45), a1.y - 9 * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fillStyle = '#aebfd1'; ctx.fill();
      ctx.fillStyle = '#aebfd1';
      ctx.fillText('wind', (a0.x + a1.x) / 2, a0.y - 8);
    }
  }

  resize();
  return { render, resize, clearTrail: () => { trail.length = 0; spray.length = 0; } };
}
