import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { E2E_DATA, E2E_PORT } from '../playwright.config';

/** Crée un lien d'invitation avec la petite commande d'administration du serveur. */
export function inviteToken(playerId: string): string {
  const output = execFileSync('node', ['dist/server/cli.js', 'invite', playerId], {
    env: { ...process.env, DATA_DIR: E2E_DATA, PUBLIC_ORIGIN: `http://localhost:${E2E_PORT}`, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
  const match = /#\/invitation\/([A-Za-z0-9_-]+)/.exec(output);
  if (!match?.[1]) throw new Error(`Pas de lien dans : ${output}`);
  return match[1];
}

export async function typeCode(page: Page, code: string): Promise<void> {
  for (const digit of code) await page.locator('.keys').getByRole('button', { name: digit, exact: true }).click();
}

export interface Phone {
  context: BrowserContext;
  page: Page;
}

/** Un téléphone qui rejoint le défi via son lien d'invitation. */
export async function joinWithInvite(browser: Browser, playerId: string, code: string): Promise<Phone> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/#/invitation/${inviteToken(playerId)}`);
  await expect(page.getByText('Choisis ton code à 6 chiffres')).toBeVisible();
  await typeCode(page, code);
  await expect(page.getByText('Retape-le pour confirmer.')).toBeVisible();
  await typeCode(page, code);
  await expect(page.getByText("C'est fait : tu fais partie du défi.")).toBeVisible();
  await page.getByRole('button', { name: /ouvrir le compteur/i }).click();
  await expect(page.locator('.tile')).toHaveCount(4);
  await expect(page.getByText('en direct')).toBeVisible();
  return { context, page };
}

export function tile(page: Page, name: string) {
  return page.locator('.tile', { has: page.locator('.name', { hasText: new RegExp(`^${name}$`, 'i') }) });
}

/** Le total affiché dans une case (lu depuis l'étiquette accessible du chiffre). */
export async function expectTotal(page: Page, name: string, value: number): Promise<void> {
  await expect(tile(page, name).locator('.number')).toHaveAttribute('aria-label', `${value} point${value > 1 ? 's' : ''}`);
}

export async function tap(page: Page, name: string): Promise<void> {
  await tile(page, name).locator('.hit').click();
}
