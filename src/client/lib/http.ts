// Transport réel : API HTTP du serveur + flux temps réel (SSE).

import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type { Snapshot } from '../../core/types';
import { ApiError, type StreamHandlers, type Transport } from './api';

/**
 * Au-delà, une requête est considérée comme perdue : sur iPhone, une requête partie juste
 * avant la mise en veille de l'app peut ne jamais répondre, et bloquerait la file d'attente.
 */
const TIMEOUT_MS = 15_000;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  let data: unknown = null;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if ((res.headers.get('content-type') ?? '').includes('application/json')) data = await res.json();
  } catch {
    // Pas de réseau, réponse coupée ou trop lente : l'action pourra être refaite.
    throw new ApiError('network', 'Pas de réseau. Réessaie quand la connexion revient.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    if (res.status >= 500 && !error) throw new ApiError('network', 'Le serveur ne répond pas. Réessaie dans un instant.', res.status);
    throw new ApiError(error?.code ?? 'server', error?.message ?? 'Une erreur est survenue.', res.status);
  }
  return data as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body);

/**
 * Flux SSE robuste pour iOS : Safari coupe les connexions quand l'app passe en arrière-plan
 * sans toujours le signaler. Au retour au premier plan, on rouvre systématiquement le flux.
 */
function openStream(url: string, handlers: StreamHandlers): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;

  const armWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    // Le serveur envoie un signe de vie toutes les 20 s : sans nouvelles depuis 45 s, on relance.
    watchdog = setTimeout(() => restart(), 45_000);
  };

  const connect = () => {
    if (closed) return;
    handlers.status(navigator.onLine === false ? 'offline' : 'connecting');
    source = new EventSource(url, { withCredentials: true });
    source.addEventListener('open', () => {
      attempts = 0;
      armWatchdog();
    });
    source.addEventListener('snapshot', (event) => {
      armWatchdog();
      handlers.status('live');
      handlers.snapshot(JSON.parse((event as MessageEvent<string>).data) as Snapshot);
    });
    source.addEventListener('ping', () => armWatchdog());
    source.addEventListener('error', () => {
      source?.close();
      source = null;
      handlers.status(navigator.onLine === false ? 'offline' : 'connecting');
      // Session expirée ? On vérifie avant de réessayer en boucle.
      void fetch('/api/me', { credentials: 'same-origin' })
        .then((res) => {
          if (res.status === 401) handlers.unauthorized?.();
        })
        .catch(() => undefined);
      schedule();
    });
  };

  const schedule = () => {
    if (closed || retry) return;
    attempts += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(attempts, 5));
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  };

  const restart = () => {
    source?.close();
    source = null;
    if (retry) clearTimeout(retry);
    retry = null;
    attempts = 0;
    connect();
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') restart();
  };
  const onOnline = () => restart();
  const onOffline = () => handlers.status('offline');
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('pageshow', onVisible);

  connect();
  return () => {
    closed = true;
    source?.close();
    if (retry) clearTimeout(retry);
    if (watchdog) clearTimeout(watchdog);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('pageshow', onVisible);
  };
}

export function createHttpTransport(): Transport {
  return {
    demo: false,

    async me() {
      try {
        return await get('/api/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    loginPlayers: () => get('/api/auth/players'),
    login: async (playerId, pin) => {
      await post('/api/auth/login', { playerId, pin });
    },
    logout: async () => {
      await post('/api/auth/logout');
    },
    invitation: (token) => get(`/api/auth/invitation/${encodeURIComponent(token)}`),
    acceptInvitation: async (token, pin) => {
      await post(`/api/auth/invitation/${encodeURIComponent(token)}`, { pin });
    },
    async passkeyLogin() {
      const { flowId, options } = await post<{ flowId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
        '/api/passkeys/login/options',
      );
      const response = await startAuthentication({ optionsJSON: options }).catch(() => {
        throw new ApiError('cancelled', 'Face ID annulé.');
      });
      await post('/api/passkeys/login/verify', { flowId, response });
    },
    async passkeyRegister(label) {
      const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/me/passkeys/options');
      const response = await startRegistration({ optionsJSON: options }).catch(() => {
        throw new ApiError('cancelled', 'Activation de Face ID annulée.');
      });
      return (await post<{ passkeys: Awaited<ReturnType<Transport['passkeyRegister']>> }>('/api/me/passkeys', { response, label })).passkeys;
    },
    passkeyRemove: async (id) => (await request<{ passkeys: Awaited<ReturnType<Transport['passkeyRemove']>> }>('DELETE', `/api/me/passkeys/${encodeURIComponent(id)}`)).passkeys,
    changePin: async (currentPin, newPin) => (await request<{ signedOut?: number }>('PUT', '/api/me/pin', { currentPin, newPin })).signedOut ?? 0,
    sessions: () => get('/api/me/sessions'),
    revokeSession: async (id) => {
      await request('DELETE', `/api/me/sessions/${encodeURIComponent(id)}`);
    },

    pushSubscribe: async (subscription) => (await post<{ prefs: Awaited<ReturnType<Transport['pushSubscribe']>> }>('/api/me/push', subscription)).prefs,
    pushUnsubscribe: async (endpoint) => {
      await request('DELETE', '/api/me/push', { endpoint });
    },
    pushPrefs: async (prefs) => (await request<{ prefs: Awaited<ReturnType<Transport['pushPrefs']>> }>('PUT', '/api/me/push/prefs', prefs)).prefs,
    pushTest: async () => (await post<{ delivered: number }>('/api/me/push/test')).delivered,

    connect: (handlers) => openStream('/api/stream', handlers),
    spectate: (token, handlers) => openStream(`/api/spectator/${encodeURIComponent(token)}/stream`, handlers),

    report: (input) => post('/api/reports', input),
    manual: (input) => post('/api/reports/manual', input),
    cancel: (id) => post(`/api/reports/${encodeURIComponent(id)}/cancel`),
    split: (id) => post(`/api/reports/${encodeURIComponent(id)}/split`),
    merge: (id, episodeId) => post(`/api/reports/${encodeURIComponent(id)}/merge`, { episodeId }),
    setWord: (id, word) => request('PUT', `/api/reports/${encodeURIComponent(id)}/word`, { word }),
    contest: (episodeId, reason) => post(`/api/episodes/${encodeURIComponent(episodeId)}/contest`, { reason }),
    vote: (contestId, choice) => post(`/api/contests/${encodeURIComponent(contestId)}/vote`, { choice }),
    withdraw: (contestId) => post(`/api/contests/${encodeURIComponent(contestId)}/withdraw`),
    history: (params) => {
      const q = new URLSearchParams();
      if (params.before) q.set('before', params.before);
      if (params.limit) q.set('limit', String(params.limit));
      if (params.player) q.set('player', params.player);
      if (params.contested) q.set('contested', '1');
      return get(`/api/episodes?${q.toString()}`);
    },
    episode: (id) => get(`/api/episodes/${encodeURIComponent(id)}`),
    stats: (range, seasonId) => get(`/api/stats?range=${range}${seasonId ? `&season=${encodeURIComponent(seasonId)}` : ''}`),

    adminOverview: () => get('/api/admin/overview'),
    invite: (playerId) => post('/api/admin/invitations', { playerId }),
    adminRevokeSession: async (id) => {
      await request('DELETE', `/api/admin/sessions/${encodeURIComponent(id)}`);
    },
    addPlayer: async (input) => (await post<{ player: Awaited<ReturnType<Transport['addPlayer']>> }>('/api/admin/players', input)).player,
    updatePlayer: async (id, patch) =>
      (await request<{ player: Awaited<ReturnType<Transport['updatePlayer']>> }>('PATCH', `/api/admin/players/${encodeURIComponent(id)}`, patch)).player,
    updateSettings: async (patch) => (await request<{ settings: Awaited<ReturnType<Transport['updateSettings']>> }>('PATCH', '/api/admin/settings', patch)).settings,
    launch: async (seasonName) => (await post<{ season: Awaited<ReturnType<Transport['launch']>> }>('/api/admin/launch', { seasonName })).season,
    newSeason: async (name) => (await post<{ season: Awaited<ReturnType<Transport['newSeason']>> }>('/api/admin/seasons', { name })).season,
    renameSeason: async (id, name) =>
      (await request<{ season: Awaited<ReturnType<Transport['renameSeason']>> }>('PATCH', `/api/admin/seasons/${encodeURIComponent(id)}`, { name })).season,
    voidEpisode: (id, note) => post(`/api/admin/episodes/${encodeURIComponent(id)}/void`, { note }),
    restoreEpisode: (id) => post(`/api/admin/episodes/${encodeURIComponent(id)}/restore`),
    createSpectatorLink: () => post('/api/admin/spectator-links'),
    revokeSpectatorLink: async (id) => {
      await request('DELETE', `/api/admin/spectator-links/${encodeURIComponent(id)}`);
    },
    journal: () => get('/api/admin/journal'),
    backupNow: () => post('/api/admin/backups'),
    downloadUrl: (kind, name) => {
      if (kind === 'json') return '/api/admin/export.json';
      if (kind === 'csv') return '/api/admin/export.csv';
      return name ? `/api/admin/backups/${encodeURIComponent(name)}` : null;
    },
  };
}
