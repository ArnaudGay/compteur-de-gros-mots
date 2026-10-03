// La file d'attente du téléphone : taps et annulations ne se perdent pas et ne comptent
// jamais deux fois, quel que soit l'ordre d'arrivée des réponses et de l'état du serveur.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/defaults';
import type { EpisodeView, Player, Snapshot } from '../../core/types';
import type { ApiError as ApiErrorClass, StreamHandlers, Transport } from './api';

// Chaque test recharge les modules (état neuf) : la classe d'erreur doit venir de la même copie.
let ApiError: typeof ApiErrorClass;

/** Le minimum du navigateur dont l'état du téléphone a besoin. */
function installBrowser() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)?.add(fn);
  };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const storage = new Map<string, string>();
  const element = () => ({ style: {}, dataset: {}, setAttribute() {}, removeAttribute() {}, click() {}, append() {} });
  vi.stubGlobal('window', Object.assign(globalThis, { addEventListener: on, removeEventListener: off }));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
  });
  vi.stubGlobal('location', { hash: '#/' });
  vi.stubGlobal('history', { replaceState() {} });
  vi.stubGlobal('document', {
    documentElement: element(),
    body: element(),
    createElement: element,
    querySelectorAll: () => [],
    addEventListener: on,
    removeEventListener: off,
    visibilityState: 'visible',
  });
  vi.stubGlobal('navigator', { vibrate: () => true, userAgent: 'test', onLine: true });
  return {
    storage,
    dispatch: (type: string) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
}

const players: Player[] = ['a', 'b'].map((id, position) => ({ id, name: id.toUpperCase(), color: 'blue', isAdmin: id === 'a', position, archivedAt: null, createdAt: 0 }));

function snap(version: number, recent: EpisodeView[] = []): Snapshot {
  const totals: Snapshot['totals'] = {};
  for (const p of players) totals[p.id] = { today: 0, week: 0, month: 0, season: 0, all: 0 };
  for (const e of recent) {
    const t = totals[e.targetId];
    if (t && !e.voided) for (const k of ['today', 'week', 'month', 'season', 'all'] as const) t[k] += e.points;
  }
  return { version, now: Date.now(), phase: 'test', players, settings: DEFAULT_SETTINGS, seasons: [], currentSeasonId: null, totals, last: { a: null, b: null }, recent, contests: [] };
}

function episodeWith(reportId: string, occurredAt: number, cancelled = false): EpisodeView {
  return {
    id: `ep-${reportId.slice(0, 8)}`,
    targetId: 'b',
    kind: 'live',
    startedAt: occurredAt,
    createdAt: occurredAt,
    points: cancelled ? 0 : 1,
    voided: false,
    voidReason: null,
    voidNote: null,
    note: null,
    word: null,
    reports: [{ id: reportId, reporterId: 'a', count: 1, occurredAt, word: null, link: 'new', cancelledAt: cancelled ? Date.now() : null, cancelledBy: cancelled ? 'a' : null }],
    contest: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

const offline = () => new ApiError('network', 'Pas de réseau.');
const accepted = (input: { id: string }, version: number) => ({ reportId: input.id, episodeId: 'ep', outcome: 'new' as const, delta: 1, otherReporterIds: [], episodeAgeMs: 0, suggestion: null, version });

async function start() {
  const browser = installBrowser();
  ({ ApiError } = await import('./api'));
  const { app } = await import('./state.svelte');
  let stream!: StreamHandlers;
  const calls = { report: [] as string[], cancel: [] as string[] };
  const server = {
    report: async (input: { id: string }) => accepted(input, 101) as Awaited<ReturnType<Transport['report']>>,
    cancel: async (_id: string) => ({ delta: -1, version: 999 }),
  };
  const transport = {
    demo: false,
    me: async () => ({ player: players[0]!, session: null, passkeys: [], push: null }),
    connect: (handlers: StreamHandlers) => {
      stream = handlers;
      return () => undefined;
    },
    report: (input: { id: string }) => {
      calls.report.push(input.id);
      return server.report(input);
    },
    cancel: (id: string) => {
      calls.cancel.push(id);
      return server.cancel(id);
    },
  } as unknown as Transport;
  await app.boot(transport);
  stream.snapshot(snap(100));
  stream.status('live');
  await settle();
  const total = () => app.view?.totals.b?.all;
  const stored = (key: string) => JSON.parse(browser.storage.get(key) ?? 'null') as { reportId?: string }[] | null;
  return { app, stream: () => stream, calls, server, total, stored, dispatch: browser.dispatch };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('annuler un tap', () => {
  it('l’état du serveur arrive avant la réponse : l’annulation part quand même', async () => {
    const t = await start();
    const response = deferred<ReturnType<typeof accepted>>();
    t.server.report = () => response.promise;
    t.app.tap('b');
    const tap = t.app.pending[0]!;
    expect(t.total()).toBe(1);
    t.app.cancelTap(tap.id);
    expect(t.total()).toBe(0);
    expect(t.stored('gm.cancels.a')?.map((c) => c.reportId)).toEqual([tap.id]);
    t.stream().snapshot(snap(101, [episodeWith(tap.id, tap.occurredAt)]));
    expect(t.total()).toBe(0);
    response.resolve(accepted(tap, 101));
    await settle();
    expect(t.calls.cancel).toEqual([tap.id]);
    t.stream().snapshot(snap(999, [episodeWith(tap.id, tap.occurredAt, true)]));
    expect([t.app.pending.length, t.app.cancels.length, t.app.waiting, t.total()]).toEqual([0, 0, 0, 0]);
  });

  it('hors ligne puis app rouverte : le tap annulé ne part jamais, l’annulation si', async () => {
    const t = await start();
    const response = deferred<ReturnType<typeof accepted>>();
    t.server.report = () => response.promise;
    t.server.cancel = async () => {
      throw offline();
    };
    t.app.tap('b');
    const tap = t.app.pending[0]!;
    t.app.cancelTap(tap.id);
    response.reject(offline());
    await settle();
    expect([t.total(), t.app.pending[0]?.state, t.app.pending[0]?.cancel, t.app.waiting]).toEqual([0, 'queued', true, 1]);

    t.app.leaveApp();
    expect([t.app.pending.length, t.app.cancels.length]).toEqual([0, 0]);
    await t.app.loadMe();
    t.stream().snapshot(snap(100));
    expect([t.total(), t.app.cancels.length]).toEqual([0, 1]);

    t.calls.report.length = 0;
    t.calls.cancel.length = 0;
    t.server.cancel = async () => {
      throw new ApiError('not_found', 'Ce signalement est introuvable.', 404);
    };
    t.stream().status('live');
    await settle();
    expect([t.calls.report.length, t.calls.cancel.length]).toEqual([0, 1]);
    expect([t.app.pending.length, t.app.cancels.length, t.app.toast?.tone]).toEqual([0, 0, 'info']);
  });

  it('annuler un tap déjà confirmé, sans réseau : gardé et envoyé au retour', async () => {
    const t = await start();
    t.app.tap('b');
    const tap = t.app.pending[0]!;
    await settle();
    t.stream().snapshot(snap(101, [episodeWith(tap.id, tap.occurredAt)]));
    expect([t.total(), t.app.pending.length]).toEqual([1, 0]);
    t.server.cancel = async () => {
      throw offline();
    };
    t.app.cancelTap(tap.id);
    await settle();
    expect([t.total(), t.app.cancels[0]?.state, t.app.waiting]).toEqual([0, 'queued', 1]);
    t.server.cancel = async () => ({ delta: -1, version: 102 });
    t.dispatch('online');
    await settle();
    expect(t.calls.cancel).toEqual([tap.id, tap.id]);
    t.stream().snapshot(snap(102, [episodeWith(tap.id, tap.occurredAt, true)]));
    expect([t.total(), t.app.cancels.length]).toEqual([0, 0]);
  });

  it('un tap annulé pendant le renvoi d’un autre n’est jamais envoyé', async () => {
    const t = await start();
    t.server.report = async () => {
      throw offline();
    };
    t.app.tap('b');
    t.app.tap('a');
    await settle();
    const [first, second] = t.app.pending;
    t.calls.report.length = 0;
    const response = deferred<ReturnType<typeof accepted>>();
    t.server.report = (input) => (input.id === first!.id ? response.promise : Promise.resolve(accepted(input, 103)));
    t.server.cancel = async () => {
      throw new ApiError('not_found', 'Ce signalement est introuvable.', 404);
    };
    t.dispatch('online');
    await settle();
    t.app.cancelTap(second!.id);
    response.resolve(accepted(first!, 102));
    await settle();
    expect(t.calls.report).toEqual([first!.id]);
    expect(t.calls.cancel).toEqual([second!.id]);
  });
});

describe('requête sans réponse', () => {
  it('un tap bloqué en route ne retient pas les autres annulations', async () => {
    const t = await start();
    t.app.tap('b');
    const confirmed = t.app.pending[0]!;
    await settle();
    t.stream().snapshot(snap(101, [episodeWith(confirmed.id, confirmed.occurredAt)]));
    const stuck = deferred<ReturnType<typeof accepted>>();
    t.server.report = () => stuck.promise;
    t.app.tap('a');
    const hanging = t.app.pending.find((p) => p.targetId === 'a')!;
    t.app.cancelTap(hanging.id);
    t.app.cancelTap(confirmed.id);
    await settle();
    expect(t.calls.cancel).toEqual([confirmed.id]);
    stuck.resolve(accepted(hanging, 102));
    await settle();
    expect(t.calls.cancel).toEqual([confirmed.id, hanging.id]);
  });
});

describe('envoyer un tap', () => {
  it('double tap involontaire : un seul point ; le menu +N n’est jamais bloqué', async () => {
    const t = await start();
    t.server.report = () => new Promise(() => undefined);
    t.app.tap('b');
    t.app.tap('b');
    expect([t.total(), t.calls.report.length]).toEqual([1, 1]);
    await new Promise((r) => setTimeout(r, 320));
    t.app.tap('b');
    t.app.tap('b', 3);
    expect(t.calls.report.length).toBe(3);
  });

  it('erreur 500 du serveur : le tap est gardé, pas perdu', async () => {
    const t = await start();
    t.server.report = async () => {
      throw new ApiError('server', 'Le serveur a rencontré un problème.', 500);
    };
    t.app.tap('b');
    await settle();
    expect([t.app.pending.length, t.app.pending[0]?.state, t.stored('gm.queue.a')?.length, t.app.toast?.title]).toEqual([1, 'queued', 1, 'Serveur indisponible']);
  });

  it('refus pour débit : un tap de plus de 24 h est gardé pour plus tard, un tap récent est abandonné', async () => {
    const t = await start();
    t.server.report = async () => {
      throw offline();
    };
    t.app.tap('b');
    await settle();
    const old = { ...t.app.pending[0]!, occurredAt: Date.now() - 25 * 3_600_000 };
    t.app.pending = [old];
    t.server.report = async () => {
      throw new ApiError('rate_limited', 'Doucement : 10 gros mots maximum en 10 secondes.', 429);
    };
    t.dispatch('online');
    await settle();
    expect([t.app.pending.length, t.app.pending[0]?.state]).toEqual([1, 'queued']);
    t.app.pending = [{ ...old, id: 'fresh-tap-0001', occurredAt: Date.now() - 1000 }];
    t.dispatch('online');
    await settle();
    expect([t.app.pending.length, t.app.toast?.tone]).toEqual([0, 'error']);
  });
});
