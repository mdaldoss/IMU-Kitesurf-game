// Kitesurf-bar simulator — Phase 1 relay server.
//
// Responsibilities:
//   1. Discover this machine's LAN IPv4 addresses.
//   2. Mint a self-signed TLS cert that lists those IPs as SANs (mobile
//      browsers reject certs with no matching SAN when you connect by IP).
//   3. Serve the two static pages over HTTPS (/ -> laptop, /phone -> phone).
//   4. Run a WebSocket relay on /ws: forward orientation packets from phone
//      clients to laptop clients verbatim, and broadcast a connection status.
//
// Browsers cannot act as WebSocket servers and only expose the device
// orientation sensors in a secure (HTTPS) context, which is why this tiny
// Node relay exists.

import https from 'node:https';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import selfsigned from 'selfsigned';
import { WebSocketServer } from 'ws';
import qrcode from 'qrcode-terminal';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8443;          // HTTPS (browsers)
const PLAIN_PORT = Number(process.env.PLAIN_PORT) || 8080; // HTTP/WS (native app)

// --- 1. LAN IPv4 discovery ------------------------------------------------
function lanIPv4Addresses() {
  const out = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

const lanIPs = lanIPv4Addresses();

// --- 2. Self-signed cert with IP SANs -------------------------------------
const altNames = [
  { type: 2, value: 'localhost' },        // type 2 = DNS
  { type: 7, ip: '127.0.0.1' },           // type 7 = IP
  ...lanIPs.map((ip) => ({ type: 7, ip })),
];
const pems = selfsigned.generate(
  [{ name: 'commonName', value: lanIPs[0] || 'localhost' }],
  { days: 365, keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames }] }
);

// --- 3. Static HTTPS server -----------------------------------------------
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
};

function resolveStaticPath(urlPath) {
  // Map friendly routes, then guard against path traversal.
  let rel = urlPath.split('?')[0];
  if (rel === '/' || rel === '') rel = '/laptop.html';
  else if (rel === '/phone') rel = '/phone.html';
  const resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return null; // escaped the public dir
  }
  return resolved;
}

async function handleRequest(req, res) {
  const filePath = resolveStaticPath(req.url);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    await readFile(filePath); // existence check (throws if missing)
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

// HTTPS for browsers (sensors need a secure context).
const server = https.createServer({ key: pems.private, cert: pems.cert }, handleRequest);
// Plain HTTP for the native (Capacitor) app: a native WebView can't click
// "proceed anyway" past a self-signed cert, so it talks cleartext over the LAN.
const httpServer = http.createServer(handleRequest);

// --- 4. WebSocket relay ----------------------------------------------------
const phones = new Set();
const laptops = new Set();

function broadcastStatus() {
  const msg = JSON.stringify({ t: 'status', phones: phones.size, laptops: laptops.size });
  for (const set of [phones, laptops]) {
    for (const sock of set) {
      if (sock.readyState === sock.OPEN) sock.send(msg);
    }
  }
}

function onConnection(ws) {
  ws.isAlive = true;
  ws.role = null;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.t === 'hello') {
      ws.role = msg.role === 'phone' ? 'phone' : 'laptop';
      (ws.role === 'phone' ? phones : laptops).add(ws);
      broadcastStatus();
      return;
    }

    // Relay orientation packets from phones to all laptops, untouched.
    if (msg.t === 'ori' && ws.role === 'phone') {
      const payload = data.toString();
      for (const laptop of laptops) {
        if (laptop.readyState === laptop.OPEN) laptop.send(payload);
      }
    }

    // Relay haptic "click" requests from laptops back to all phones.
    if (msg.t === 'buzz' && ws.role === 'laptop') {
      const payload = data.toString();
      for (const phone of phones) {
        if (phone.readyState === phone.OPEN) phone.send(payload);
      }
    }
  });

  ws.on('close', () => {
    phones.delete(ws);
    laptops.delete(ws);
    broadcastStatus();
  });
  ws.on('error', () => {});
}

// Both transports share the same relay sets, so a native phone and a browser
// laptop (or any mix) interoperate.
const wssSecure = new WebSocketServer({ server, path: '/ws' });
const wssPlain = new WebSocketServer({ server: httpServer, path: '/ws' });
wssSecure.on('connection', onConnection);
wssPlain.on('connection', onConnection);

// Heartbeat: drop sockets that stop responding so status stays honest.
const heartbeat = setInterval(() => {
  for (const wss of [wssSecure, wssPlain]) {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }
}, 10_000);
wssSecure.on('close', () => clearInterval(heartbeat));

// --- start ----------------------------------------------------------------
server.listen(PORT, () => {
  const host = lanIPs[0] || 'localhost';
  const laptopUrl = `https://${host}:${PORT}/`;
  const phoneUrl = `https://${host}:${PORT}/phone`;

  console.log('\n  Kitesurf IMU relay running (self-signed HTTPS)\n');
  console.log(`  Laptop display : ${laptopUrl}`);
  console.log(`  Phone sender   : ${phoneUrl}`);
  if (lanIPs.length > 1) {
    console.log(`  (other LAN IPs : ${lanIPs.slice(1).join(', ')})`);
  }
  console.log('\n  Scan this QR on the phone (then tap "proceed anyway" past the cert warning):\n');
  qrcode.generate(phoneUrl, { small: true });
  console.log('\n  Both devices must be on the same network. Ctrl+C to stop.\n');
});

httpServer.listen(PLAIN_PORT, () => {
  const host = lanIPs[0] || 'localhost';
  console.log(`  Native app (Capacitor) connects over cleartext LAN:`);
  console.log(`    laptop address to enter in the app : ${host}:${PLAIN_PORT}`);
  console.log(`    (relay endpoint: ws://${host}:${PLAIN_PORT}/ws)\n`);
});
