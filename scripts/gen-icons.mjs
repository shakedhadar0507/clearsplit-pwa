// Generates PWA icons from an inline SVG using sharp.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const mark = (pad, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient></defs>
<rect width="512" height="512" rx="${rounded ? 144 : 0}" fill="url(#g)"/>
<g transform="translate(${pad} ${pad}) scale(${(512 - 2 * pad) / 512})">
<path d="M304 160a112 112 0 1 0 0 192" fill="none" stroke="#fff" stroke-width="48" stroke-linecap="round"/>
<circle cx="352" cy="256" r="40" fill="#5eead4"/></g></svg>`;

mkdirSync('public/icons', { recursive: true });
const out = [
  ['public/icons/icon-192.png', 192, mark(0, true)],
  ['public/icons/icon-512.png', 512, mark(0, true)],
  ['public/icons/maskable-512.png', 512, mark(72, false)],
  ['public/icons/apple-touch-icon.png', 180, mark(24, false)],
];
for (const [file, size, svg] of out) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log('wrote', file);
}
