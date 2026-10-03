import { describe, expect, it } from 'vitest';
import { addManual, report } from './commands';
import { buildStats } from './stats';
import { DAY, HOUR } from './time';
import { ctx, id, makeStore, run, T0 } from './testing';
import { buildSnapshot, history } from './views';

describe('totaux par période (heure de Paris)', () => {
  it('aujourd’hui, semaine et mois suivent le calendrier parisien', () => {
    const store = makeStore();
    const now = T0; // lundi 5 octobre 2026, 12 h à Paris
    const add = (targetId: string, occurredAt: number) =>
      run(store, () => addManual(store, ctx('alexis', now), { id: id('rep'), targetId, count: 1, occurredAt }));
    add('gatho', Date.UTC(2026, 9, 5, 5, 0)); // ce matin
    add('gatho', Date.UTC(2026, 9, 4, 21, 30)); // dimanche 23 h 30 à Paris : semaine précédente
    add('gatho', Date.UTC(2026, 8, 30, 21, 59)); // 30 septembre 23 h 59 à Paris : mois précédent
    add('gatho', Date.UTC(2026, 8, 30, 22, 1)); // 1er octobre 0 h 01 à Paris
    expect(buildSnapshot(store, now).totals.gatho).toEqual({ today: 1, week: 1, month: 3, season: 0, all: 4 });
  });

  it('dernier point : heure et témoins', () => {
    const store = makeStore();
    run(store, () => report(store, ctx('alexis', T0), { id: id('rep'), targetId: 'arnaud', occurredAt: T0 }));
    run(store, () => report(store, ctx('gatho', T0 + 4000), { id: id('rep'), targetId: 'arnaud', occurredAt: T0 + 4000 }));
    expect(buildSnapshot(store, T0 + 5000).last.arnaud).toMatchObject({ at: T0 + 4000, reporterIds: ['alexis', 'gatho'] });
    expect(buildSnapshot(store, T0 + 5000).last.gatho).toBeNull();
  });
});

describe('historique', () => {
  it('pagine du plus récent au plus ancien, filtre par joueur', () => {
    const store = makeStore();
    for (let i = 0; i < 7; i++) {
      run(store, () => report(store, ctx('alexis', T0 + i * HOUR), { id: id('rep'), targetId: i % 2 ? 'arnaud' : 'gatho', occurredAt: T0 + i * HOUR }));
    }
    const page1 = history(store, { limit: 3 });
    expect(page1.items.map((e) => e.startedAt)).toEqual([T0 + 6 * HOUR, T0 + 5 * HOUR, T0 + 4 * HOUR]);
    const page2 = history(store, { limit: 3, before: page1.next });
    expect(page2.items.map((e) => e.startedAt)).toEqual([T0 + 3 * HOUR, T0 + 2 * HOUR, T0 + HOUR]);
    const page3 = history(store, { limit: 3, before: page2.next });
    expect(page3.items).toHaveLength(1);
    expect(page3.next).toBeNull();
    expect(history(store, { playerId: 'arnaud' }).items).toHaveLength(3);
  });
});

describe('statistiques', () => {
  it('séries sans gros mot, pire journée, mots, balances', () => {
    const store = makeStore();
    const now = T0 + 10 * DAY;
    const add = (targetId: string, reporter: string, daysAgo: number, count = 1, word?: string) =>
      run(store, () =>
        addManual(store, ctx(reporter, now), { id: id('rep'), targetId, count, occurredAt: now - daysAgo * DAY, word }),
      );
    add('gatho', 'alexis', 9, 1, 'merde');
    add('gatho', 'alexis', 5, 3, 'putain');
    add('gatho', 'gatho', 2, 1, 'putain');
    const stats = buildStats(store, now, '30d');
    const gatho = stats.players.find((p) => p.playerId === 'gatho');
    expect(gatho).toMatchObject({ points: 5, currentStreak: 2, bestStreak: 3, selfReports: 1 });
    expect(gatho?.worstDay?.points).toBe(3);
    expect(stats.players.find((p) => p.playerId === 'alexis')).toMatchObject({ reportsOnOthers: 4, points: 0 });
    expect(stats.topWords).toEqual([
      { word: 'putain', points: 4 },
      { word: 'merde', points: 1 },
    ]);
    expect(stats.totalPoints).toBe(5);
    expect(stats.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(5);
  });
});
