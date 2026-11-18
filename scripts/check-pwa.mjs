// Validates the built PWA: manifest fields, icon files & sizes, service worker presence.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2] ?? 'dist';
const fail = (m) => { console.error('✗', m); process.exitCode = 1; };
const ok = (m) => console.log('✓', m);

const manifestPath = path.join(dir, 'manifest.webmanifest');
if (!existsSync(manifestPath)) { fail('manifest.webmanifest missing'); process.exit(1); }
const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color', 'id', 'scope']) {
  m[k] ? ok(`manifest.${k}`) : fail(`manifest.${k} missing`);
}
m.display === 'standalone' ? ok('display=standalone') : fail('display must be standalone');
const need = [['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']];
for (const [size, purpose] of need) {
  const icon = m.icons.find((i) => i.sizes === size && (i.purpose ?? 'any').includes(purpose));
  if (!icon) { fail(`icon ${size} ${purpose} missing`); continue; }
  const file = path.join(dir, icon.src);
  if (!existsSync(file)) { fail(`${icon.src} not found`); continue; }
  const meta = await sharp(file).metadata();
  `${meta.width}x${meta.height}` === size ? ok(`${icon.src} is ${size}`) : fail(`${icon.src} is ${meta.width}x${meta.height}`);
}
existsSync(path.join(dir, 'sw.js')) ? ok('sw.js present') : fail('sw.js missing');
const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
html.includes('manifest.webmanifest') ? ok('manifest linked from index.html') : fail('manifest link missing');
html.includes('apple-touch-icon') ? ok('apple-touch-icon linked') : fail('apple-touch-icon missing');
html.includes('viewport-fit=cover') ? ok('viewport-fit=cover (safe areas)') : fail('viewport-fit=cover missing');
/<script>(?!<\/script>)/.test(html.replace(/<script type="module"[^>]*><\/script>/g, '')) ? fail('inline script found (breaks CSP)') : ok('no inline scripts (CSP-safe)');
