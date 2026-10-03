import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Snapshot } from '../core/types';
import { createApp } from './app';
import { Auth } from './auth';
import { Backups } from './backup';
import { loadConfig } from './config';
import { openDatabase, type DB } from './db';
import { Game } from './game';
import { Passkeys } from './passkeys';
import { Push } from './push';
import { Hub } from './realtime';

const ORIGIN = 'https://grosmots.test';
const T0 = Date.UTC(2026, 9, 5, 10, 0, 0);

interface Sent {
  endpoint: string;
  payload: { title: string; body: string; badge: number; url: string };
}

function setup(dbPath = ':memory:', dataDir?: string) {
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_ORIGIN: ORIGIN, DATA_DIR: dataDir ?? tmpdir() });
  const db = openDatabase(dbPath);
  const hub = new Hub();
  let now = T0;
  const sent: Sent[] = [];
  const failing = new Set<string>();
  const push = new Push(db, config, (async (sub: { endpoint: string }, payload: string) => {
    if (failing.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as Sent['payload'] });
    return { statusCode: 201, body: '', headers: {} };
  }) as never);
  const game = new Game(db, hub, push, () => now);
  game.seed(config.seedPlayers);
  const auth = new Auth(db);
  const backups = dataDir ? new Backups(db, join(dataDir, 'backups'), 30, 'Europe/Paris') : null;
  const app = createApp({ config, db, game, hub, auth, passkeys: new Passkeys(db, config), push, backups, serveClient: false });

  /** Un téléphone : garde son cookie de session comme un navigateur. */
  const phone = () => {
    let cookie = '';
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.request(path, {
        method,
        headers: {
          ...(method === 'GET' ? {} : { Origin: ORIGIN }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0] ?? '';
      if (setCookie?.includes('Max-Age=0')) cookie = '';
      const type = res.headers.get('content-type') ?? '';
      const data = type.includes('json') ? ((await res.json()) as any) : await res.text();
      return { status: res.status, data, res };
    };
    return { call, get cookie() { return cookie; } };
  };

  /** Crée une invitation, choisit un code et renvoie le téléphone connecté. */
  const join_ = async (playerId: string, pin: string) => {
    const p = phone();
    const { token } = auth.createInvitation(playerId, null, now);
    const res = await p.call('POST', `/api/auth/invitation/${token}`, { pin });
    expect(res.status).toBe(200);
    return p;
  };

  return {
    app, db, game, auth, hub, push, sent, failing, phone, join: join_,
    advance: (ms: number) => { now += ms; },
    get now() { return now; },
  };
}

let cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

describe('connexion', () => {
  it('invitation → code → connecté, et le lien ne resert pas', async () => {
    const t = setup();
    const p = t.phone();
    const { token } = t.auth.createInvitation('alexis', null, t.now);
    const info = await p.call('GET', `/api/auth/invitation/${token}`);
    expect(info.data.player.name).toBe('Alexis');
    expect((await p.call('POST', `/api/auth/invitation/${token}`, { pin: '123456' })).status).toBe(400);
    expect((await p.call('POST', `/api/auth/invitation/${token}`, { pin: '111111' })).status).toBe(400);
    const ok = await p.call('POST', `/api/auth/invitation/${token}`, { pin: '271828' });
    expect(ok.status).toBe(200);
    expect(ok.res.headers.get('set-cookie')).toMatch(/gm_session=.*HttpOnly.*Secure.*SameSite=Lax/i);
    expect((await p.call('GET', '/api/me')).data.player.id).toBe('alexis');
    expect((await t.phone().call('GET', `/api/auth/invitation/${token}`)).status).toBe(410);
  });

  it('code faux 5 fois → blocage 15 minutes, même avec le bon code', async () => {
    const t = setup();
    await t.join('gatho', '314159');
    const intruder = t.phone();
    for (let i = 0; i < 4; i++) {
      const res = await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '000001' });
      expect(res.status).toBe(400);
    }
    expect((await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '000001' })).status).toBe(423);
    expect((await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '314159' })).status).toBe(423);
    t.advance(16 * 60_000);
    expect((await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '314159' })).status).toBe(200);
  });

  it('refuse les requêtes venant d’un autre site', async () => {
    const t = setup();
    const p = await t.join('alexis', '271828');
    const res = await p.call('POST', '/api/reports', { id: 'evil-request-01', targetId: 'gatho' }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(t.game.snapshot().totals.gatho?.all).toBe(0);
  });

  it('sans session : 401 ; déconnexion : la session est révoquée', async () => {
    const t = setup();
    expect((await t.phone().call('GET', '/api/snapshot')).status).toBe(401);
    const p = await t.join('alexis', '271828');
    expect((await p.call('GET', '/api/snapshot')).status).toBe(200);
    const cookie = p.cookie;
    await p.call('POST', '/api/auth/logout');
    const replay = await t.app.request('/api/snapshot', { headers: { Cookie: cookie } });
    expect(replay.status).toBe(401);
  });

  it('le cookie garde la même valeur quand la session est prolongée', async () => {
    const t = setup();
    const p = await t.join('alexis', '271828');
    const before = p.cookie;
    t.advance(2 * 3600_000);
    const res = await p.call('GET', '/api/me');
    expect(res.res.headers.get('set-cookie')).toContain(before);
    expect(p.cookie).toBe(before);
  });
});

describe('compter', () => {
  it('fusionne les doublons et reste idempotent', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const gatho = await t.join('gatho', '314159');
    const first = await alexis.call('POST', '/api/reports', { id: 'tap-alexis-0001', targetId: 'arnaud', occurredAt: t.now });
    expect(first.data).toMatchObject({ outcome: 'new', delta: 1 });
    t.advance(4000);
    const second = await gatho.call('POST', '/api/reports', { id: 'tap-gatho-00001', targetId: 'arnaud', occurredAt: t.now });
    expect(second.data).toMatchObject({ outcome: 'confirm', delta: 0, otherReporterIds: ['alexis'] });
    const retry = await alexis.call('POST', '/api/reports', { id: 'tap-alexis-0001', targetId: 'arnaud', occurredAt: t.now });
    expect(retry.data.outcome).toBe('duplicate');
    const snap = (await alexis.call('GET', '/api/snapshot')).data as Snapshot;
    expect(snap.totals.arnaud?.all).toBe(1);
    expect(second.data.version).toBeGreaterThan(first.data.version);
  });

  it('annuler le signalement d’un autre est interdit', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const gatho = await t.join('gatho', '314159');
    const tap = await alexis.call('POST', '/api/reports', { id: 'tap-alexis-0002', targetId: 'gatho' });
    expect((await gatho.call('POST', `/api/reports/${tap.data.reportId}/cancel`)).status).toBe(403);
    expect((await alexis.call('POST', `/api/reports/${tap.data.reportId}/cancel`)).data.delta).toBe(-1);
  });

  it('VAR : contestation, votes, point annulé', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const gatho = await t.join('gatho', '314159');
    const alexandre = await t.join('alexandre', '161803');
    const tap = await alexis.call('POST', '/api/reports', { id: 'tap-alexis-0003', targetId: 'gatho' });
    const contest = await gatho.call('POST', `/api/episodes/${tap.data.episodeId}/contest`, { reason: 'Je citais un film' });
    expect(contest.data.contest.status).toBe('open');
    expect((await gatho.call('POST', `/api/contests/${contest.data.contest.id}/vote`, { choice: 'invalid' })).status).toBe(403);
    await alexis.call('POST', `/api/contests/${contest.data.contest.id}/vote`, { choice: 'invalid' });
    const final = await alexandre.call('POST', `/api/contests/${contest.data.contest.id}/vote`, { choice: 'invalid' });
    expect(final.data.contest.status).toBe('accepted');
    expect(t.game.snapshot().totals.gatho?.all).toBe(0);
  });

  it('historique paginé et statistiques', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    for (let i = 0; i < 3; i++) {
      await alexis.call('POST', '/api/reports', { id: `tap-hist-${i}-000`, targetId: 'gatho', word: 'merde' });
      t.advance(60_000);
    }
    const page = await alexis.call('GET', '/api/episodes?limit=2');
    expect(page.data.items).toHaveLength(2);
    expect(page.data.next).toBeTruthy();
    const stats = await alexis.call('GET', '/api/stats?range=all');
    expect(stats.data.topWords).toEqual([{ word: 'merde', points: 3 }]);
  });
});

describe('temps réel', () => {
  it('le flux envoie l’état complet dès la connexion, puis à chaque point', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const res = await t.app.request('/api/stream', { headers: { Cookie: alexis.cookie } });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('event: snapshot');
    expect(t.hub.size).toBe(1);
    await alexis.call('POST', '/api/reports', { id: 'tap-stream-0001', targetId: 'gatho' });
    let next = '';
    while (!next.includes('"all":1')) next += decoder.decode((await reader.read()).value);
    expect(next).toContain('event: snapshot');
    await reader.cancel();
  });
});

describe('administration', () => {
  it('réservée à l’admin', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    expect((await alexis.call('GET', '/api/admin/overview')).status).toBe(403);
    expect((await alexis.call('POST', '/api/admin/launch', {})).status).toBe(403);
    const arnaud = await t.join('arnaud', '141421');
    const overview = await arnaud.call('GET', '/api/admin/overview');
    expect(overview.data.players.map((p: { id: string; hasPin: boolean }) => [p.id, p.hasPin])).toEqual([
      ['arnaud', true],
      ['alexis', true],
      ['alexandre', false],
      ['gatho', false],
    ]);
    const invite = await arnaud.call('POST', '/api/admin/invitations', { playerId: 'gatho' });
    expect(invite.data.url).toMatch(/^https:\/\/grosmots\.test\/#\/invitation\/[A-Za-z0-9_-]+$/);
    expect((await arnaud.call('POST', '/api/admin/launch', { seasonName: 'Octobre' })).data.season.name).toBe('Octobre');
    const settings = await arnaud.call('PATCH', '/api/admin/settings', { pricePerPointCents: 50, forfeit: 'Le dernier paie le resto' });
    expect(settings.data.settings).toMatchObject({ pricePerPointCents: 50, forfeit: 'Le dernier paie le resto' });
  });

  it('lien spectateur : lecture seule, révocable', async () => {
    const t = setup();
    const arnaud = await t.join('arnaud', '141421');
    const link = await arnaud.call('POST', '/api/admin/spectator-links');
    const token = String(link.data.url).split('/').pop();
    const viewer = t.phone();
    expect((await viewer.call('GET', `/api/spectator/${token}`)).data.players).toHaveLength(4);
    expect((await viewer.call('POST', '/api/reports', { id: 'tap-viewer-0001', targetId: 'gatho' })).status).toBe(401);
    await arnaud.call('DELETE', `/api/admin/spectator-links/${link.data.id}`);
    expect((await viewer.call('GET', `/api/spectator/${token}`)).status).toBe(404);
  });

  it('export CSV', async () => {
    const t = setup();
    const arnaud = await t.join('arnaud', '141421');
    await arnaud.call('POST', '/api/reports', { id: 'tap-export-0001', targetId: 'gatho', word: 'bordel' });
    const csv = await arnaud.call('GET', '/api/admin/export.csv');
    expect(csv.data).toContain('"cible";"points"');
    expect(csv.data).toContain('"Gatho";"1";"compté";"Arnaud";"bordel"');
  });
});

describe('notifications', () => {
  it('prévient la cible (pas l’auteur), et oublie les abonnements expirés', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const gatho = await t.join('gatho', '314159');
    const sub = (name: string) => ({ endpoint: `https://web.push.apple.com/${name}`, keys: { p256dh: 'BPk'.padEnd(87, 'x'), auth: 'abc'.padEnd(22, 'y') } });
    expect((await gatho.call('POST', '/api/me/push', sub('gatho'))).status).toBe(200);
    await alexis.call('POST', '/api/me/push', sub('alexis'));
    await alexis.call('POST', '/api/reports', { id: 'tap-push-00001', targetId: 'gatho', word: 'putain' });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.endpoint).toContain('gatho');
    expect(t.sent[0]?.payload.title).toBe("Alexis t'a compté un gros mot");
    expect(t.sent[0]?.payload.body).toBe('Total : 1 · « p****n »');

    t.failing.add('https://web.push.apple.com/gatho');
    await alexis.call('POST', '/api/reports', { id: 'tap-push-00002', targetId: 'gatho', occurredAt: t.now + 60_000 });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.push.count('gatho')).toBe(0);
  });

  it('les préférences coupent un type de notification', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const gatho = await t.join('gatho', '314159');
    await gatho.call('POST', '/api/me/push', { endpoint: 'https://web.push.apple.com/g2', keys: { p256dh: 'k', auth: 'a' } });
    await gatho.call('PUT', '/api/me/push/prefs', { point: false });
    await alexis.call('POST', '/api/reports', { id: 'tap-push-00003', targetId: 'gatho' });
    await new Promise((r) => setTimeout(r, 10));
    expect(t.sent).toHaveLength(0);
  });
});

describe('persistance', () => {
  it('tout est retrouvé après un redémarrage, sauvegarde comprise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grosmots-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'test.sqlite');
    const first = setup(path, dir);
    const alexis = await first.join('alexis', '271828');
    const gatho = await first.join('gatho', '314159');
    const tap = await alexis.call('POST', '/api/reports', { id: 'tap-persist-001', targetId: 'gatho', word: 'zut' });
    await gatho.call('POST', `/api/episodes/${tap.data.episodeId}/contest`, {});
    const backupRes = await alexis.call('GET', '/api/admin/overview');
    expect(backupRes.status).toBe(403);
    const backups = new Backups(first.db, join(dir, 'backups'), 30, 'Europe/Paris');
    const backup = await backups.run(first.now);
    first.db.close();

    const second = setup(path, dir);
    const snap = second.game.snapshot();
    expect(snap.totals.gatho?.all).toBe(1);
    expect(snap.contests).toHaveLength(1);
    expect(snap.recent[0]?.word).toBe('zut');
    expect(second.game.store.players.size).toBe(4);
    second.db.close();

    const restored: DB = openDatabase(join(dir, 'backups', backup.name));
    expect((restored.prepare('SELECT COUNT(*) AS n FROM reports').get() as { n: number }).n).toBe(1);
    restored.close();
  });
});

describe('relecture de sécurité', () => {
  it('des essais de code envoyés tous en même temps sont vérifiés un par un', async () => {
    const t = setup();
    await t.join('gatho', '314159');
    const intruder = t.phone();
    const burst = await Promise.all(
      Array.from({ length: 30 }, (_, i) => intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: i === 29 ? '314159' : '000001' })),
    );
    const statuses = burst.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(0);
    expect(statuses.filter((s) => s === 400)).toHaveLength(1);
    for (let i = 0; i < 4; i++) await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '000001' });
    expect((await intruder.call('POST', '/api/auth/login', { playerId: 'gatho', pin: '314159' })).status).toBe(423);
  });

  it('un nouveau lien annule les précédents, et un lien ne sert qu’une fois, même ouvert deux fois au même instant', async () => {
    const t = setup();
    const first = t.auth.createInvitation('alexis', null, t.now);
    const second = t.auth.createInvitation('alexis', null, t.now);
    expect((await t.phone().call('GET', `/api/auth/invitation/${first.token}`)).status).toBe(410);
    const [a, b] = await Promise.all([
      t.phone().call('POST', `/api/auth/invitation/${second.token}`, { pin: '271828' }),
      t.phone().call('POST', `/api/auth/invitation/${second.token}`, { pin: '662607' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 410]);
  });

  it('un nouveau code déconnecte les autres appareils', async () => {
    const t = setup();
    const phone = await t.join('alexis', '271828');
    const tablet = t.phone();
    expect((await tablet.call('POST', '/api/auth/login', { playerId: 'alexis', pin: '271828' })).status).toBe(200);
    const change = await phone.call('PUT', '/api/me/pin', { currentPin: '271828', newPin: '662607' });
    expect(change.data).toMatchObject({ ok: true, signedOut: 1 });
    expect((await tablet.call('GET', '/api/me')).status).toBe(401);
    expect((await phone.call('GET', '/api/me')).status).toBe(200);
    // Nouveau lien d'invitation (code oublié, compte repris) : toutes les sessions tombent.
    const fresh = await t.join('alexis', '577215');
    expect((await phone.call('GET', '/api/me')).status).toBe(401);
    expect((await fresh.call('GET', '/api/me')).status).toBe(200);
  });

  it('refuse les requêtes trop volumineuses', async () => {
    const t = setup();
    const res = await t.phone().call('POST', '/api/auth/login', { playerId: 'alexis', pin: 'x'.repeat(100_000) });
    expect(res.status).toBe(413);
  });

  it('révoquer un lien spectateur coupe aussi les flux déjà ouverts', async () => {
    const t = setup();
    const arnaud = await t.join('arnaud', '141421');
    const link = await arnaud.call('POST', '/api/admin/spectator-links');
    const token = String(link.data.url).split('/').pop();
    const res = await t.app.request(`/api/spectator/${token}/stream`);
    const reader = res.body!.getReader();
    await reader.read();
    expect(t.hub.size).toBe(1);
    await arnaud.call('DELETE', `/api/admin/spectator-links/${link.data.id}`);
    expect(t.hub.size).toBe(0);
    let done = false;
    while (!done) done = (await reader.read()).done;
    expect(done).toBe(true);
  });

  it('notifications : seulement vers les services connus, 10 appareils au plus', async () => {
    const t = setup();
    const alexis = await t.join('alexis', '271828');
    const keys = { p256dh: 'BPk'.padEnd(87, 'x'), auth: 'abc'.padEnd(22, 'y') };
    for (const endpoint of ['https://169.254.169.254/latest', 'https://app:8787/api', 'http://web.push.apple.com/x', 'https://web.push.apple.com.evil.example/x']) {
      expect((await alexis.call('POST', '/api/me/push', { endpoint, keys })).status).toBe(400);
    }
    for (let i = 0; i < 12; i++) {
      t.advance(1000);
      expect((await alexis.call('POST', '/api/me/push', { endpoint: `https://web.push.apple.com/device-${i}`, keys })).status).toBe(200);
    }
    expect(t.push.count('alexis')).toBe(10);
  });

  it('export CSV : aucun texte ne devient une formule', async () => {
    const t = setup();
    const arnaud = await t.join('arnaud', '141421');
    await arnaud.call('POST', '/api/reports', { id: 'tap-export-0002', targetId: 'gatho', word: '=HYPERLINK("x")' });
    const csv = await arnaud.call('GET', '/api/admin/export.csv');
    expect(csv.data).toContain(`"'=hyperlink(""x"")"`);
  });

  it('une sauvegarde faite à la main ne remplace pas celle de la nuit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grosmots-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    const t = setup(join(dir, 'test.sqlite'), dir);
    const backups = new Backups(t.db, join(dir, 'backups'), 30, 'Europe/Paris');
    const night = await backups.runDailyIfDue(Date.UTC(2026, 9, 5, 2, 10));
    const manual = await backups.run(Date.UTC(2026, 9, 5, 13, 0));
    expect(backups.list().map((b) => b.name).sort()).toEqual([night?.name, manual.name].sort());
    t.db.close();
  });
});
