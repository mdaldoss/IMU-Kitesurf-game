// Bundle the single-source phone page into the Capacitor app's web assets.
// Run via `npm run copy:web` (also part of `npm run sync`). Keeps phone.html as
// the one source of truth shared by the browser and the native shell.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const www = join(here, 'www');

await mkdir(www, { recursive: true });
// The native app launches into the standalone game; the laptop "trainer" sensor
// page (phone.html) stays reachable at /trainer.html for IMU validation.
await copyFile(join(publicDir, 'game.html'), join(www, 'index.html'));
await copyFile(join(publicDir, 'phone.html'), join(www, 'trainer.html'));
await copyFile(join(publicDir, 'style.css'), join(www, 'style.css'));

// Shared ES modules imported by the phone pages (bar power, physics, spots).
for (const mod of ['bar-pull.js', 'kite-physics.js', 'wind-spots.js', 'kite-game.js']) {
  await copyFile(join(publicDir, mod), join(www, mod));
}
console.log('Copied public/game.html -> mobile/www/index.html (+ trainer.html, style.css, modules)');
