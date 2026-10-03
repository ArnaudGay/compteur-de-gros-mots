// Génère les icônes de l'app (public/icons) avec Chromium : un carton jaune « #@! » sur fond encre.
// Usage : node scripts/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const font = readFileSync('src/client/fonts/big-shoulders-display-latin-900-normal.woff2').toString('base64');
const INK = '#111110';
const CARD = '#f5c400';

/** scale : taille du carton par rapport à l'icône (plus petit pour les icônes « maskable »). */
function iconHtml(size, { scale = 1, background = INK, mono = false } = {}) {
  const w = size * 0.5 * scale;
  const h = size * 0.68 * scale;
  return `<!doctype html><html><head><style>
    @font-face { font-family: 'BS'; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 900; }
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${background}; }
    .wrap { width: ${size}px; height: ${size}px; display: grid; place-items: center; }
    .card { width: ${w}px; height: ${h}px; border-radius: ${w * 0.1}px; background: ${mono ? '#fff' : CARD};
      transform: rotate(-9deg); display: grid; place-items: center;
      box-shadow: ${mono ? 'none' : `0 ${size * 0.02}px ${size * 0.05}px rgba(0,0,0,.35)`}; }
    .txt { font-family: 'BS'; font-weight: 900; font-size: ${w * 0.5}px; color: ${INK}; letter-spacing: 0.01em;
      transform: translateY(${w * 0.03}px); ${mono ? 'display:none;' : ''} }
  </style></head><body><div class="wrap"><div class="card"><span class="txt">#@!</span></div></div></body></html>`;
}

const outputs = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.78 },
  { file: 'badge-96.png', size: 96, background: 'transparent', mono: true, scale: 1.15 },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const o of outputs) {
  await page.setViewportSize({ width: o.size, height: o.size });
  await page.setContent(iconHtml(o.size, o));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `public/icons/${o.file}`, omitBackground: o.background === 'transparent' });
  console.log('icône', o.file);
}
await browser.close();

// Favicon vectoriel : le carton avec une bande de censure (le texte serait illisible à 16 px).
writeFileSync(
  'public/icons/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${INK}"/><g transform="rotate(-9 16 16)"><rect x="8.5" y="5" width="15" height="22" rx="1.8" fill="${CARD}"/><rect x="11" y="14.5" width="10" height="3.6" rx="0.6" fill="${INK}"/></g></svg>\n`,
);
console.log('icône favicon.svg');
