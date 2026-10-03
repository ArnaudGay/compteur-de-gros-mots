import { expect, test } from '@playwright/test';
import { expectTotal, joinWithInvite, tap, tile, typeCode, type Phone } from './helpers';

// Un seul défi partagé par tous les tests, joués dans l'ordre.
test.describe.configure({ mode: 'serial' });

let arnaud: Phone;
let alexis: Phone;
let gatho: Phone;

test.afterAll(async () => {
  for (const phone of [arnaud, alexis, gatho]) await phone?.context.close();
});

test('invitation : on choisit son code et on arrive sur le tableau', async ({ browser }) => {
  arnaud = await joinWithInvite(browser, 'arnaud', '271828');
  alexis = await joinWithInvite(browser, 'alexis', '314159');
  gatho = await joinWithInvite(browser, 'gatho', '161803');
  await expect(arnaud.page.getByText('Phase de test')).toBeVisible();
  // Sur iPhone (hors app installée), on propose d'installer l'app.
  await expect(alexis.page.getByText(/Installe l'app sur ton iPhone/)).toBeVisible();
});

test('un tap compte tout de suite, et apparaît chez les autres en direct', async () => {
  await tap(alexis.page, 'Arnaud');
  await expect(alexis.page.locator('.toast')).toContainText('+1 Arnaud');
  await expectTotal(alexis.page, 'Arnaud', 1);
  await expectTotal(gatho.page, 'Arnaud', 1);
  await expectTotal(arnaud.page, 'Arnaud', 1);
  await expect(tile(gatho.page, 'Arnaud').locator('.foot')).toContainText('par Alexis');
});

test('le même gros mot signalé par un deuxième témoin ne compte qu’une fois', async () => {
  await tap(gatho.page, 'Arnaud');
  await expect(gatho.page.locator('.toast')).toContainText('Déjà compté par Alexis');
  await expectTotal(gatho.page, 'Arnaud', 1);
  await expectTotal(alexis.page, 'Arnaud', 1);
  // « C'est un autre » : c'était un deuxième gros mot.
  await gatho.page.locator('.toast').getByRole('button', { name: "C'est un autre" }).click();
  await expectTotal(gatho.page, 'Arnaud', 2);
  await expectTotal(alexis.page, 'Arnaud', 2);
});

test('« Annuler » retire le point chez tout le monde', async () => {
  await tap(alexis.page, 'Gatho');
  await expectTotal(gatho.page, 'Gatho', 1);
  await alexis.page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await expectTotal(alexis.page, 'Gatho', 0);
  await expectTotal(gatho.page, 'Gatho', 0);
});

test('sans réseau, le tap est gardé puis envoyé au retour', async () => {
  await alexis.context.setOffline(true);
  await expect(alexis.page.locator('.link')).toContainText(/hors ligne|reconnexion/);
  await tap(alexis.page, 'Alexandre');
  await expectTotal(alexis.page, 'Alexandre', 1);
  await expect(alexis.page.locator('.toast')).toContainText('Pas de réseau');
  await expectTotal(gatho.page, 'Alexandre', 0);
  await alexis.context.setOffline(false);
  await expect(alexis.page.locator('.link')).toContainText('en direct', { timeout: 20_000 });
  await expectTotal(gatho.page, 'Alexandre', 1);
  await expectTotal(alexis.page, 'Alexandre', 1);
});

test('VAR : contestation, votes à la majorité, point annulé', async () => {
  await tap(alexis.page, 'Gatho');
  await expectTotal(gatho.page, 'Gatho', 1);
  // Gatho conteste depuis le dernier point affiché sous le tableau.
  await gatho.page.locator('.feed-row', { hasText: 'Gatho' }).first().click();
  await gatho.page.getByPlaceholder('Pourquoi ? (facultatif)').fill('Je chantais');
  await gatho.page.getByRole('button', { name: 'Demander la VAR' }).click();
  await gatho.page.locator('.sheet').getByRole('button', { name: 'Fermer' }).click();

  // Les autres voient la demande de vote.
  await expect(alexis.page.locator('.notice')).toContainText('Gatho conteste un point');
  await alexis.page.locator('.notice').click();
  await alexis.page.getByRole('button', { name: 'Pas valable' }).click();
  await alexis.page.locator('.sheet').getByRole('button', { name: 'Fermer' }).click();

  await arnaud.page.locator('.notice').click();
  await arnaud.page.getByRole('button', { name: 'Pas valable' }).click();
  await expect(arnaud.page.getByText('Point annulé par le vote')).toBeVisible();
  await arnaud.page.locator('.sheet').getByRole('button', { name: 'Fermer' }).click();

  // Le lien de la bannière mène à l'historique : on revient au tableau.
  for (const phone of [alexis, arnaud]) await phone.page.getByRole('button', { name: 'Compteur' }).click();
  await expectTotal(gatho.page, 'Gatho', 0);
  await expectTotal(alexis.page, 'Gatho', 0);
});

test('historique et classement', async () => {
  const page = alexis.page;
  await page.getByRole('button', { name: 'Historique' }).click();
  await expect(page.locator('article.item').first()).toBeVisible();
  await expect(page.getByText('Annulé par la VAR')).toBeVisible();
  await page.getByRole('button', { name: 'Classement' }).click();
  await expect(page.locator('.ranking .row').first()).toContainText(/Alexis|Gatho/);
  await expect(page.getByText('lanterne rouge')).toBeVisible();
  await page.getByRole('button', { name: 'Compteur' }).click();
});

test('code faux 5 fois : blocage', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /Alexis/ }).click();
  for (const left of ['4 essais', '3 essais', '2 essais', '1 essai.']) {
    await typeCode(page, '999999');
    await expect(page.getByRole('alert')).toContainText(`Encore ${left}`);
  }
  await typeCode(page, '999999');
  await expect(page.getByRole('alert')).toContainText(/Trop d'essais/);
  await context.close();
});

test('Face ID : activer une passkey, puis se connecter d’un regard', async ({ browser }) => {
  const phone = await joinWithInvite(browser, 'alexandre', '141421');
  // Authentificateur virtuel de Chromium : il joue le rôle de Face ID.
  const cdp = await phone.context.newCDPSession(phone.page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  await phone.page.getByRole('button', { name: 'Plus', exact: true }).click();
  await phone.page.getByRole('button', { name: /Mon compte/ }).click();
  await phone.page.getByRole('button', { name: 'Activer Face ID' }).click();
  await expect(phone.page.getByText(/Face ID activé/)).toBeVisible();
  await phone.page.getByRole('button', { name: 'Se déconnecter de cet appareil' }).click();
  await expect(phone.page.getByRole('button', { name: 'Se connecter avec Face ID' })).toBeVisible();
  await phone.page.getByRole('button', { name: 'Se connecter avec Face ID' }).click();
  await expect(phone.page.locator('.tile')).toHaveCount(4);
  await expect(tile(phone.page, 'Alexandre').locator('.me')).toBeVisible();
  await phone.context.close();
});

test('admin : lancement officiel, les points de test ne comptent plus', async () => {
  const page = arnaud.page;
  await page.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('button', { name: 'Administration' }).click();
  await page.getByPlaceholder('Nom de la saison (par défaut : Saison 1)').fill('Octobre');
  await page.getByRole('button', { name: 'Lancer le défi officiellement' }).click();
  await page.getByRole('button', { name: 'Oui, lancer' }).click();
  await page.getByRole('button', { name: 'Compteur' }).click();
  await expect(page.getByText(/Octobre · jour 1/)).toBeVisible();
  await expectTotal(page, 'Arnaud', 0);
  await expectTotal(alexis.page, 'Arnaud', 0);
  await tap(page, 'Alexis');
  await expectTotal(alexis.page, 'Alexis', 1);
});

test('lien spectateur : lecture seule, en direct', async ({ browser }) => {
  const page = arnaud.page;
  await page.getByRole('button', { name: 'Plus', exact: true }).click();
  await page.getByRole('button', { name: 'Administration' }).click();
  await page.getByRole('button', { name: 'Créer un lien spectateur' }).click();
  const url = await page.locator('.invite span', { hasText: '#/spectateur/' }).first().textContent();
  expect(url).toBeTruthy();
  const viewer = await browser.newContext();
  const view = await viewer.newPage();
  await view.goto(url!.trim());
  await expect(view.getByText('spectateur')).toBeVisible();
  await expect(view.locator('.tile .hit')).toHaveCount(0);
  await expectTotal(view, 'Alexis', 1);
  await gatho.page.getByRole('button', { name: 'Compteur' }).click();
  await tap(gatho.page, 'Alexis');
  await expectTotal(view, 'Alexis', 1);
  await expect(tile(view, 'Alexis').locator('.foot')).toContainText(/Arnaud|Gatho/);
  await viewer.close();
});
