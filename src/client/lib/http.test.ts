import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('requêtes vers le serveur', () => {
  it('une requête restée sans réponse est abandonnée au bout de 15 s, comme une coupure réseau', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Requête abandonnée', 'AbortError')));
      });
    });
    const { ApiError } = await import('./api');
    const { createHttpTransport } = await import('./http');
    const pending = createHttpTransport().report({ id: 'tap-timeout-0001', targetId: 'gatho', occurredAt: Date.now(), count: 1, word: null });
    const outcome = pending.then(
      () => 'réponse',
      (error: unknown) => (error instanceof ApiError && error.offline ? 'hors ligne' : 'autre erreur'),
    );
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toBe('hors ligne');
  });
});
