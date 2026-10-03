// Routes HTTP de l'app. Toutes les réponses d'erreur ont la forme { error: { code, message } },
// avec un message en français affichable tel quel.

import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import * as cmd from '../core/commands';
import { DomainError, type ErrorCode } from '../core/errors';
import { buildStats } from '../core/stats';
import { dayKey, zonedParts } from '../core/time';
import type { Player, PlayerId } from '../core/types';
import { episodeView, history } from '../core/views';
import { SESSION_COOKIE, SESSION_TTL, sha256, randomToken, type Auth, type SessionInfo } from './auth';
import type { Backups } from './backup';
import type { Config } from './config';
import type { DB } from './db';
import type { Game } from './game';
import type { Passkeys } from './passkeys';
import type { Push } from './push';
import type { Hub } from './realtime';

export interface Deps {
  config: Config;
  db: DB;
  game: Game;
  hub: Hub;
  auth: Auth;
  passkeys: Passkeys;
  push: Push | null;
  backups: Backups | null;
  serveClient: boolean;
}

type Env = { Variables: { session: SessionInfo | null; player: Player | null; token: string | null } };
type Ctx = Context<Env>;

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 410 | 423 | 429> = {
  invalid: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  expired: 410,
  locked: 423,
  rate_limited: 429,
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

async function input<T extends z.ZodType>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new DomainError('invalid', 'Requête illisible.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new DomainError('invalid', 'Données invalides.');
  return parsed.data;
}

const Id = z.string().min(1).max(100);
const Pin = z.string().max(20);
const OptionalText = z.string().max(4000).nullable().optional();

export function createApp(deps: Deps): Hono<Env> {
  const { config, game, hub, auth, passkeys, push, backups } = deps;
  const app = new Hono<Env>();
  const https = config.publicOrigin.startsWith('https:');

  const player = (c: Ctx): Player => {
    const p = c.get('player');
    if (!p) throw new DomainError('unauthenticated', 'Connecte-toi pour continuer.');
    return p;
  };
  const actor = (c: Ctx) => ({ now: game.now(), actorId: player(c).id });

  const setSession = (c: Ctx, token: string) =>
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: https, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL / 1000 });

  const clientIp = (c: Ctx): string => {
    if (config.trustProxy) {
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    try {
      return getConnInfo(c).remote.address ?? 'inconnue';
    } catch {
      return 'inconnue';
    }
  };

  const login = (c: Ctx, playerId: PlayerId, method: SessionInfo['method']) => {
    const p = game.store.players.get(playerId);
    if (!p || p.archivedAt !== null) throw new DomainError('forbidden', "Ce compte n'a plus accès au défi.");
    const token = auth.createSession(p.id, method, c.req.header('user-agent') ?? null, game.now());
    setSession(c, token);
    return c.json({ player: p });
  };

  // --- En-têtes de sécurité, cache, CSRF, session ------------------------------------

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    c.header('Content-Security-Policy', CSP);
    if (https) c.header('Strict-Transport-Security', 'max-age=31536000');
  });

  app.use('/api/*', async (c, next) => {
    // Seules les requêtes venant de l'app elle-même peuvent modifier quelque chose.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('origin') !== config.publicOrigin) {
      return c.json({ error: { code: 'forbidden', message: 'Requête refusée : origine inconnue.' } }, 403);
    }
    const now = game.now();
    const token = getCookie(c, SESSION_COOKIE) ?? null;
    const session = auth.getSession(token ?? undefined, now);
    const p = session ? (game.store.players.get(session.playerId) ?? null) : null;
    const active = p && p.archivedAt === null ? p : null;
    c.set('session', active ? session : null);
    c.set('player', active);
    c.set('token', active ? token : null);
    if (session && active && token && auth.touchSession(session, now)) setSession(c, token);
    await next();
    c.header('Cache-Control', 'no-store');
  });

  const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
    if (!c.get('player')) return c.json({ error: { code: 'unauthenticated', message: 'Connecte-toi pour continuer.' } }, 401);
    await next();
  };
  const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
    const p = c.get('player');
    if (!p) return c.json({ error: { code: 'unauthenticated', message: 'Connecte-toi pour continuer.' } }, 401);
    if (!p.isAdmin) return c.json({ error: { code: 'forbidden', message: "Seul l'admin peut faire ça." } }, 403);
    await next();
  };

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: { code: err.code, message: err.message } }, STATUS[err.code]);
    console.error('[erreur]', err);
    return c.json({ error: { code: 'server', message: 'Le serveur a rencontré un problème. Réessaie dans un instant.' } }, 500);
  });

  // --- Public ------------------------------------------------------------------------

  app.get('/api/health', (c) => c.json({ ok: true, version: __APP_VERSION__, clients: hub.size }));

  app.get('/api/auth/players', (c) =>
    c.json(
      game.store.activePlayers().map((p) => ({ id: p.id, name: p.name, color: p.color, hasPin: auth.hasPin(p.id) })),
    ),
  );

  app.post('/api/auth/login', async (c) => {
    const body = await input(c, z.object({ playerId: Id, pin: Pin }));
    await auth.checkPin(body.playerId, body.pin, clientIp(c), game.now());
    return login(c, body.playerId, 'pin');
  });

  app.post('/api/auth/logout', (c) => {
    const session = c.get('session');
    if (session) {
      auth.revokeSession(session.id);
      hub.disconnectSession(session.id);
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: https });
    return c.json({ ok: true });
  });

  app.get('/api/auth/invitation/:token', (c) => {
    const invitation = auth.findInvitation(c.req.param('token'), game.now());
    const p = game.store.players.get(invitation.playerId);
    if (!p) throw new DomainError('not_found', 'Joueur introuvable.');
    return c.json({ player: { id: p.id, name: p.name, color: p.color }, expiresAt: invitation.expiresAt, hasPin: auth.hasPin(p.id) });
  });

  app.post('/api/auth/invitation/:token', async (c) => {
    const body = await input(c, z.object({ pin: Pin }));
    const now = game.now();
    const invitation = auth.findInvitation(c.req.param('token'), now);
    await auth.setPin(invitation.playerId, body.pin, now);
    auth.markInvitationUsed(invitation.id, now);
    return login(c, invitation.playerId, 'invite');
  });

  app.post('/api/passkeys/login/options', async (c) => c.json(await passkeys.authenticationOptions(game.now())));

  app.post('/api/passkeys/login/verify', async (c) => {
    const body = await input(c, z.object({ flowId: z.string().max(100), response: z.any() }));
    const playerId = await passkeys.verifyAuthentication(body.flowId, body.response, game.now());
    return login(c, playerId, 'passkey');
  });

  // --- Spectateur (lecture seule, lien secret) -----------------------------------------

  const spectatorOk = (token: string) => {
    const row = deps.db.prepare('SELECT revoked_at FROM spectator_links WHERE token = ?').get(token) as { revoked_at: number | null } | undefined;
    if (!row || row.revoked_at !== null) throw new DomainError('not_found', "Ce lien spectateur n'est plus valable.");
  };

  app.get('/api/spectator/:token', (c) => {
    spectatorOk(c.req.param('token'));
    return c.json(game.snapshot());
  });

  const stream = (c: Ctx, sessionId: string | null) =>
    streamSSE(c, async (s) => {
      let open = true;
      const client = hub.add({
        sessionId,
        send: (event, data) => {
          void s.writeSSE({ event, data }).catch(() => {
            open = false;
          });
        },
        close: () => {
          open = false;
          s.abort();
        },
      });
      s.onAbort(() => {
        open = false;
        hub.remove(client.id);
      });
      c.header('X-Accel-Buffering', 'no');
      await s.writeSSE({ event: 'snapshot', data: JSON.stringify(game.snapshot()), retry: 3000 });
      while (open && !s.aborted) {
        await s.sleep(20_000);
        if (open && !s.aborted) await s.writeSSE({ event: 'ping', data: String(game.now()) });
      }
      hub.remove(client.id);
    });

  app.get('/api/spectator/:token/stream', (c) => {
    spectatorOk(c.req.param('token'));
    return stream(c, null);
  });

  // --- Joueurs connectés -----------------------------------------------------------------

  app.use('/api/me/*', requireAuth);
  app.use('/api/me', requireAuth);

  app.get('/api/me', (c) => {
    const p = player(c);
    const session = c.get('session');
    return c.json({
      player: p,
      session: session ? { id: session.id, method: session.method, createdAt: session.createdAt } : null,
      passkeys: passkeys.list(p.id),
      push: push ? { publicKey: push.publicKey, prefs: push.prefs(p.id), devices: push.count(p.id) } : null,
    });
  });

  app.put('/api/me/pin', async (c) => {
    const p = player(c);
    const body = await input(c, z.object({ currentPin: Pin, newPin: Pin }));
    const now = game.now();
    await auth.checkPin(p.id, body.currentPin, clientIp(c), now);
    await auth.setPin(p.id, body.newPin, now);
    return c.json({ ok: true });
  });

  app.get('/api/me/sessions', (c) => {
    const current = c.get('session')?.id;
    return c.json(auth.listSessions(player(c).id).map((s) => ({ ...s, current: s.id === current })));
  });

  app.delete('/api/me/sessions/:id', (c) => {
    const id = c.req.param('id');
    const own = auth.listSessions(player(c).id).some((s) => s.id === id);
    if (!own) throw new DomainError('not_found', 'Appareil introuvable.');
    auth.revokeSession(id);
    hub.disconnectSession(id);
    return c.json({ ok: true });
  });

  app.post('/api/me/passkeys/options', async (c) => {
    const session = c.get('session');
    if (!session) throw new DomainError('unauthenticated', 'Connecte-toi pour continuer.');
    return c.json(await passkeys.registrationOptions(player(c), session.id, game.now()));
  });

  app.post('/api/me/passkeys', async (c) => {
    const session = c.get('session');
    if (!session) throw new DomainError('unauthenticated', 'Connecte-toi pour continuer.');
    const body = await input(c, z.object({ response: z.any(), label: z.string().max(40).nullable().optional() }));
    await passkeys.verifyRegistration(player(c), session.id, body.response, body.label ?? null, game.now());
    return c.json({ passkeys: passkeys.list(player(c).id) });
  });

  app.delete('/api/me/passkeys/:id', (c) => {
    passkeys.remove(player(c).id, c.req.param('id'));
    return c.json({ passkeys: passkeys.list(player(c).id) });
  });

  app.post('/api/me/push', async (c) => {
    if (!push) throw new DomainError('invalid', 'Les notifications ne sont pas disponibles.');
    const body = await input(
      c,
      z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
    );
    push.subscribe(player(c).id, body, c.req.header('user-agent') ?? null, game.now());
    return c.json({ prefs: push.prefs(player(c).id) });
  });

  app.delete('/api/me/push', async (c) => {
    if (!push) return c.json({ ok: true });
    const body = await input(c, z.object({ endpoint: z.string().max(1000) }));
    push.unsubscribe(player(c).id, body.endpoint);
    return c.json({ ok: true });
  });

  app.put('/api/me/push/prefs', async (c) => {
    if (!push) throw new DomainError('invalid', 'Les notifications ne sont pas disponibles.');
    const body = await input(
      c,
      z.object({ point: z.boolean().optional(), vote: z.boolean().optional(), result: z.boolean().optional(), season: z.boolean().optional() }),
    );
    return c.json({ prefs: push.setPrefs(player(c).id, body) });
  });

  app.post('/api/me/push/test', async (c) => {
    if (!push) throw new DomainError('invalid', 'Les notifications ne sont pas disponibles.');
    const delivered = await push.sendTo(player(c).id, {
      title: 'Notifications activées',
      body: 'Tu seras prévenu quand on te compte un gros mot.',
      tag: 'test',
      url: '/#/',
      badge: 0,
    });
    return c.json({ delivered });
  });

  // --- Le défi ---------------------------------------------------------------------------

  app.use('/api/snapshot', requireAuth);
  app.use('/api/stream', requireAuth);
  app.use('/api/reports/*', requireAuth);
  app.use('/api/reports', requireAuth);
  app.use('/api/episodes/*', requireAuth);
  app.use('/api/episodes', requireAuth);
  app.use('/api/contests/*', requireAuth);
  app.use('/api/stats', requireAuth);

  app.get('/api/snapshot', (c) => c.json(game.snapshot()));
  app.get('/api/stream', (c) => stream(c, c.get('session')?.id ?? null));

  const ReportBody = z.object({
    id: z.string().max(100),
    targetId: Id,
    occurredAt: z.number().optional(),
    count: z.number().int().optional(),
    word: z.string().max(100).nullable().optional(),
  });

  app.post('/api/reports', async (c) => {
    const body = await input(c, ReportBody);
    const { result, version } = game.run((store) => cmd.report(store, actor(c), body));
    return c.json({ ...result, version });
  });

  app.post('/api/reports/manual', async (c) => {
    const body = await input(c, ReportBody.extend({ count: z.number().int(), occurredAt: z.number(), note: OptionalText }));
    const { result, version } = game.run((store) => cmd.addManual(store, actor(c), body));
    return c.json({ ...result, version });
  });

  app.post('/api/reports/:id/cancel', (c) => {
    const { result, version } = game.run((store) => cmd.cancelReport(store, actor(c), { reportId: c.req.param('id') }));
    return c.json({ ...result, version });
  });

  app.post('/api/reports/:id/split', (c) => {
    const { result, version } = game.run((store) => cmd.splitReport(store, actor(c), { reportId: c.req.param('id') }));
    return c.json({ ...result, version });
  });

  app.post('/api/reports/:id/merge', async (c) => {
    const body = await input(c, z.object({ episodeId: Id }));
    const { result, version } = game.run((store) => cmd.mergeReport(store, actor(c), { reportId: c.req.param('id'), episodeId: body.episodeId }));
    return c.json({ ...result, version });
  });

  app.put('/api/reports/:id/word', async (c) => {
    const body = await input(c, z.object({ word: z.string().max(100).nullable() }));
    const { result, version } = game.run((store) => cmd.setWord(store, actor(c), { reportId: c.req.param('id'), word: body.word }));
    return c.json({ ...result, version });
  });

  app.get('/api/episodes', (c) => {
    const q = c.req.query();
    return c.json(
      history(game.store, {
        before: q.before ?? null,
        limit: q.limit ? Number(q.limit) : 50,
        playerId: q.player || null,
        contested: q.contested === '1',
      }),
    );
  });

  app.get('/api/episodes/:id', (c) => {
    const episode = game.store.episodes.get(c.req.param('id'));
    if (!episode || episode.voidReason === 'merged') throw new DomainError('not_found', 'Ce point est introuvable.');
    return c.json(episodeView(game.store, episode));
  });

  app.post('/api/episodes/:id/contest', async (c) => {
    const body = await input(c, z.object({ reason: OptionalText }));
    const { result, version } = game.run((store) => cmd.openContest(store, actor(c), { episodeId: c.req.param('id'), reason: body.reason }));
    return c.json({ contest: result, version });
  });

  app.post('/api/contests/:id/vote', async (c) => {
    const body = await input(c, z.object({ choice: z.enum(['valid', 'invalid']) }));
    const { result, version } = game.run((store) => cmd.vote(store, actor(c), { contestId: c.req.param('id'), choice: body.choice }));
    return c.json({ contest: result, version });
  });

  app.post('/api/contests/:id/withdraw', (c) => {
    const { result, version } = game.run((store) => cmd.withdrawContest(store, actor(c), { contestId: c.req.param('id') }));
    return c.json({ contest: result, version });
  });

  app.get('/api/stats', (c) => {
    const range = c.req.query('range');
    const valid = range === 'season' || range === '30d' || range === 'all' ? range : 'season';
    return c.json(buildStats(game.store, game.now(), valid));
  });

  // --- Administration ------------------------------------------------------------------------

  app.use('/api/admin/*', requireAdmin);

  app.get('/api/admin/overview', (c) => {
    const now = game.now();
    const links = deps.db.prepare('SELECT id, token, created_at, revoked_at FROM spectator_links WHERE revoked_at IS NULL ORDER BY created_at DESC').all() as {
      id: string;
      token: string;
      created_at: number;
    }[];
    return c.json({
      players: [...game.store.players.values()]
        .sort((a, b) => a.position - b.position)
        .map((p) => ({
          ...p,
          hasPin: auth.hasPin(p.id),
          pendingInvitation: auth.hasPendingInvitation(p.id, now),
          passkeys: passkeys.list(p.id).length,
          pushDevices: push?.count(p.id) ?? 0,
        })),
      sessions: auth.listSessions(),
      spectatorLinks: links.map((l) => ({ id: l.id, url: `${config.publicOrigin}/#/spectateur/${l.token}`, createdAt: l.created_at })),
      backups: backups?.list() ?? [],
    });
  });

  app.post('/api/admin/invitations', async (c) => {
    const body = await input(c, z.object({ playerId: Id }));
    const p = game.store.players.get(body.playerId);
    if (!p || p.archivedAt !== null) throw new DomainError('not_found', 'Joueur introuvable.');
    const invitation = auth.createInvitation(p.id, player(c).id, game.now());
    return c.json({ url: `${config.publicOrigin}/#/invitation/${invitation.token}`, expiresAt: invitation.expiresAt });
  });

  app.delete('/api/admin/sessions/:id', (c) => {
    auth.revokeSession(c.req.param('id'));
    hub.disconnectSession(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/admin/players', async (c) => {
    const body = await input(c, z.object({ id: z.string().max(30), name: z.string().max(60), color: z.string().max(20) }));
    const { result, version } = game.run((store) => cmd.addPlayer(store, actor(c), body));
    return c.json({ player: result, version });
  });

  app.patch('/api/admin/players/:id', async (c) => {
    const body = await input(
      c,
      z.object({ name: z.string().max(60).optional(), color: z.string().max(20).optional(), isAdmin: z.boolean().optional(), archived: z.boolean().optional() }),
    );
    const { result, version } = game.run((store) => cmd.updatePlayer(store, actor(c), { id: c.req.param('id'), ...body }));
    if (body.archived) for (const s of auth.listSessions(result.id)) hub.disconnectSession(s.id);
    return c.json({ player: result, version });
  });

  app.patch('/api/admin/settings', async (c) => {
    const body = await input(
      c,
      z.object({
        mergeWindowMs: z.number().int().optional(),
        suggestWindowMs: z.number().int().optional(),
        contestWindowMs: z.number().int().optional(),
        voteDurationMs: z.number().int().optional(),
        pricePerPointCents: z.number().int().optional(),
        forfeit: z.string().max(1000).optional(),
        rules: z.string().max(8000).optional(),
      }),
    );
    const { result, version } = game.run((store) => cmd.updateSettings(store, actor(c), body));
    return c.json({ settings: result, version });
  });

  app.post('/api/admin/launch', async (c) => {
    const body = await input(c, z.object({ seasonName: z.string().max(100).nullable().optional() }));
    const { result, version } = game.run((store) => cmd.launchChallenge(store, actor(c), body));
    return c.json({ season: result, version });
  });

  app.post('/api/admin/seasons', async (c) => {
    const body = await input(c, z.object({ name: z.string().max(100).nullable().optional() }));
    const { result, version } = game.run((store) => cmd.startSeason(store, actor(c), body));
    return c.json({ season: result, version });
  });

  app.patch('/api/admin/seasons/:id', async (c) => {
    const body = await input(c, z.object({ name: z.string().max(100) }));
    const { result, version } = game.run((store) => cmd.renameSeason(store, actor(c), { id: c.req.param('id'), name: body.name }));
    return c.json({ season: result, version });
  });

  app.post('/api/admin/episodes/:id/void', async (c) => {
    const body = await input(c, z.object({ note: OptionalText }));
    const { result, version } = game.run((store) => cmd.voidEpisode(store, actor(c), { episodeId: c.req.param('id'), note: body.note }));
    return c.json({ ...result, version });
  });

  app.post('/api/admin/episodes/:id/restore', (c) => {
    const { result, version } = game.run((store) => cmd.restoreEpisode(store, actor(c), { episodeId: c.req.param('id') }));
    return c.json({ ...result, version });
  });

  app.post('/api/admin/spectator-links', (c) => {
    const token = randomToken(18);
    const id = sha256(token).slice(0, 16);
    deps.db
      .prepare('INSERT INTO spectator_links (id, token, created_by, created_at) VALUES (?, ?, ?, ?)')
      .run(id, token, player(c).id, game.now());
    return c.json({ id, url: `${config.publicOrigin}/#/spectateur/${token}` });
  });

  app.delete('/api/admin/spectator-links/:id', (c) => {
    deps.db.prepare('UPDATE spectator_links SET revoked_at = ? WHERE id = ?').run(game.now(), c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/api/admin/journal', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 500);
    const rows = deps.db.prepare('SELECT at, actor_id, action, data FROM journal ORDER BY id DESC LIMIT ?').all(limit) as {
      at: number;
      actor_id: string | null;
      action: string;
      data: string;
    }[];
    return c.json(rows.map((r) => ({ at: r.at, actorId: r.actor_id, action: r.action, data: JSON.parse(r.data) as unknown })));
  });

  app.get('/api/admin/export.json', (c) => {
    const s = game.store;
    c.header('Content-Disposition', `attachment; filename="gros-mots-${dayKey(game.now(), s.settings.timeZone)}.json"`);
    return c.json({
      exportedAt: game.now(),
      players: [...s.players.values()],
      episodes: [...s.episodes.values()],
      reports: [...s.reports.values()],
      contests: [...s.contests.values()],
      seasons: [...s.seasons.values()],
      settings: s.settings,
    });
  });

  app.get('/api/admin/export.csv', (c) => {
    const s = game.store;
    const tz = s.settings.timeZone;
    const name = (id: string) => s.players.get(id)?.name ?? id;
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['date', 'heure', 'cible', 'points', 'statut', 'témoins', 'mot', 'note'].map(cell).join(';')];
    const episodes = history(s, { limit: 200 });
    let page = episodes;
    const all = [...page.items];
    while (page.next) {
      page = history(s, { limit: 200, before: page.next });
      all.push(...page.items);
    }
    for (const e of all) {
      const p = zonedParts(e.startedAt, tz);
      const status = e.voided ? (e.voidReason === 'contest' ? 'annulé (VAR)' : 'annulé') : e.contest?.status === 'open' ? 'contesté' : 'compté';
      const witnesses = [...new Set(e.reports.filter((r) => r.cancelledAt === null).map((r) => name(r.reporterId)))].join(', ');
      lines.push(
        [dayKey(e.startedAt, tz), `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`, name(e.targetId), e.points, status, witnesses, e.word ?? '', e.note ?? '']
          .map(cell)
          .join(';'),
      );
    }
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="gros-mots-${dayKey(game.now(), tz)}.csv"`);
    return c.body('﻿' + lines.join('\r\n'));
  });

  app.post('/api/admin/backups', async (c) => {
    if (!backups) throw new DomainError('invalid', 'Les sauvegardes ne sont pas configurées.');
    return c.json(await backups.run(game.now()));
  });

  app.get('/api/admin/backups/:name', (c) => {
    const path = backups?.path(c.req.param('name'));
    if (!path) throw new DomainError('not_found', 'Sauvegarde introuvable.');
    c.header('Content-Type', 'application/vnd.sqlite3');
    c.header('Content-Disposition', `attachment; filename="${c.req.param('name')}"`);
    return c.body(readFileSync(path));
  });

  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Adresse inconnue.' } }, 404));

  // --- Fichiers de l'interface -------------------------------------------------------------------

  if (deps.serveClient) {
    app.use(
      '*',
      serveStatic({
        root: config.staticDir,
        onFound: (path, c) => {
          if (path.includes('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
          else c.header('Cache-Control', 'no-cache');
          if (path.endsWith('sw.js')) c.header('Service-Worker-Allowed', '/');
        },
      }),
    );
    // Anciennes adresses « à plat » : on renvoie vers la page unique.
    app.get('/invitation/:token', (c) => c.redirect(`/#/invitation/${c.req.param('token')}`));
    app.get('*', serveStatic({ root: config.staticDir, path: 'index.html', onFound: (_p, c) => c.header('Cache-Control', 'no-cache') }));
  }

  return app;
}
