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
await copyFile(join(publicDir, 'phone.html'), join(www, 'index.html'));
await copyFile(join(publicDir, 'style.css'), join(www, 'style.css'));
console.log('Copied public/phone.html -> mobile/www/index.html (+ style.css)');
