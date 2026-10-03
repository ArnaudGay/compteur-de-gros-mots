// Captures d'écran de la démo au format iPhone (clair et sombre), pour relire le design.
// Usage : npm run build:demo && node scripts/screenshots.mjs [dossier]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const fragment = readFileSync('dist/demo/index.html', 'utf8');
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${fragment}</body></html>`;
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((resolve) => server.listen(4567, resolve));

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
    userAgent: IPHONE_UA,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:4567/');
  await page.waitForSelector('.tile');
  await page.waitForTimeout(600);
  const shot = (name) => page.screenshot({ path: `${out}/${scheme}-${name}.png` });

  await shot('1-compteur');
  // Un tap sur Gatho : bandeau et flash.
  await page.locator('.tile .hit').nth(3).click();
  await page.waitForTimeout(250);
  await shot('2-tap');
  // Un deuxième témoin… c'est nous encore : on tape Alexis puis on regarde le bandeau.
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Classement' }).click();
  await page.waitForTimeout(400);
  await shot('3-classement');
  await page.getByRole('button', { name: 'Historique' }).click();
  await page.waitForTimeout(500);
  await shot('4-historique');
  await page.locator('article.item .open').first().click();
  await page.waitForTimeout(500);
  await shot('5-fiche');
  await page.getByRole('button', { name: 'Fermer' }).first().click();
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.waitForTimeout(600);
  await shot('6-stats');
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  await shot('7-stats-bas');
  await page.getByRole('button', { name: 'Plus' }).click();
  await page.waitForTimeout(300);
  await shot('8-plus');
  await page.getByRole('button', { name: 'Compteur' }).click();
  await page.locator('.tile .more').first().click();
  await page.waitForTimeout(400);
  await shot('9-menu-case');
  if (errors.length) console.log(scheme, 'erreurs :', errors);
  await context.close();
}
await browser.close();
server.close();
console.log('captures dans', out);
