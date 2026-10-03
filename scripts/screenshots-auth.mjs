// Captures des écrans d'invitation et de connexion, sur le vrai serveur (npm run build d'abord).
// Usage : node scripts/screenshots-auth.mjs [dossier]
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

const out = process.argv[2] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const DATA = '.shots-data';
rmSync(DATA, { recursive: true, force: true });
const env = { ...process.env, PORT: '8792', PUBLIC_ORIGIN: 'http://localhost:8792', DATA_DIR: DATA, NODE_ENV: 'test' };
const server = spawn('node', ['dist/server/main.js'], { env, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const invite = (id) => /#\/invitation\/([\w-]+)/.exec(execFileSync('node', ['dist/server/cli.js', 'invite', id], { env, encoding: 'utf8' }))?.[1];
const browser = await chromium.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      locale: 'fr-FR',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    await page.goto(`http://localhost:8792/#/invitation/${invite(scheme === 'light' ? 'alexis' : 'gatho')}`);
    await page.getByText('Choisis ton code').waitFor();
    for (const d of '27') await page.locator('.keys').getByRole('button', { name: d, exact: true }).click();
    await page.screenshot({ path: `${out}/${scheme}-a-invitation.png` });
    for (const d of '1828') await page.locator('.keys').getByRole('button', { name: d, exact: true }).click();
    await page.getByText('Retape-le').waitFor();
    for (const d of '271828') await page.locator('.keys').getByRole('button', { name: d, exact: true }).click();
    await page.getByText("C'est fait").waitFor();
    await page.screenshot({ path: `${out}/${scheme}-b-installer.png` });
    await page.getByRole('button', { name: /ouvrir le compteur/i }).click();
    await page.locator('.tile').first().waitFor();
    await page.getByRole('button', { name: 'Plus', exact: true }).click();
    await page.getByRole('button', { name: /Mon compte/ }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/${scheme}-c-compte.png` });
    await page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click();
    await page.getByText('ou choisis ton prénom').waitFor();
    await page.screenshot({ path: `${out}/${scheme}-d-connexion.png` });
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
  rmSync(DATA, { recursive: true, force: true });
}
console.log('captures dans', out);
