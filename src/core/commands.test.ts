import { describe, expect, it } from 'vitest';
import {
  addManual,
  cancelReport,
  launchChallenge,
  mergeReport,
  openContest,
  report,
  resolveDueContests,
  setWord,
  splitReport,
  startSeason,
  updatePlayer,
  vote,
  withdrawContest,
} from './commands';
import { DomainError } from './errors';
import { HOUR, SECOND } from './time';
import { ctx, id, makeStore, run, T0 } from './testing';
import { buildSnapshot, computeTotals } from './views';
import type { Store } from './store';

function tap(store: Store, reporter: string, target: string, at: number, extra: { count?: number; word?: string; reportId?: string } = {}) {
  return run(store, () =>
    report(store, ctx(reporter, at), { id: extra.reportId ?? id('rep'), targetId: target, occurredAt: at, count: extra.count, word: extra.word }),
  );
}

function total(store: Store, player: string, now = T0 + HOUR): number {
  return computeTotals(store, now)[player]?.all ?? -1;
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Une erreur « ${code} » était attendue`);
}

describe('compter un gros mot', () => {
  it('un tap crée un épisode et ajoute 1 point', () => {
    const store = makeStore();
    const result = tap(store, 'alexis', 'arnaud', T0);
    expect(result).toMatchObject({ outcome: 'new', delta: 1, suggestion: null });
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('deux témoins du même gros mot à 5 s d’écart : 1 seul point, le second confirme', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0);
    const second = tap(store, 'gatho', 'arnaud', T0 + 5 * SECOND);
    expect(second).toMatchObject({ outcome: 'confirm', delta: 0, otherReporterIds: ['alexis'], episodeAgeMs: 5000 });
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('rafale : Alexis tape 3 fois, Gatho 2 fois → 3 points', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0);
    tap(store, 'gatho', 'arnaud', T0 + 1000);
    tap(store, 'alexis', 'arnaud', T0 + 4000);
    tap(store, 'gatho', 'arnaud', T0 + 5000);
    tap(store, 'alexis', 'arnaud', T0 + 8000);
    expect(total(store, 'arnaud')).toBe(3);
  });

  it('autodénonciation + signalement d’un autre = 1 point', () => {
    const store = makeStore();
    tap(store, 'arnaud', 'arnaud', T0);
    expect(tap(store, 'alexis', 'arnaud', T0 + 3000).outcome).toBe('confirm');
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('40 s plus tard : nouveau point, avec la proposition « C’est le même ? »', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    const second = tap(store, 'gatho', 'arnaud', T0 + 40 * SECOND);
    expect(second.outcome).toBe('new');
    expect(second.suggestion).toEqual({ episodeId: first.episodeId, reporterIds: ['alexis'], ageMs: 40_000 });
    expect(total(store, 'arnaud')).toBe(2);
  });

  it('renvoyer le même tap (réseau qui hoquette) ne compte pas deux fois', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0, { reportId: 'same-tap-0001' });
    const again = tap(store, 'alexis', 'arnaud', T0, { reportId: 'same-tap-0001' });
    expect(again.outcome).toBe('duplicate');
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('un identifiant déjà pris par quelqu’un d’autre est refusé', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0, { reportId: 'same-tap-0002' });
    expectError(() => tap(store, 'gatho', 'arnaud', T0, { reportId: 'same-tap-0002' }), 'conflict');
  });

  it('un tap hors ligne envoyé plus tard fusionne grâce à son heure réelle', () => {
    const store = makeStore();
    const online = tap(store, 'alexis', 'arnaud', T0);
    // Gatho a tapé 2 s avant Alexis, mais sans réseau : le tap arrive 10 minutes après.
    const offline = run(store, () =>
      report(store, ctx('gatho', T0 + 10 * 60 * SECOND), { id: id('rep'), targetId: 'arnaud', occurredAt: T0 - 2000 }),
    );
    expect(offline).toMatchObject({ outcome: 'confirm', episodeId: online.episodeId });
    expect(store.episodes.get(online.episodeId)?.startedAt).toBe(T0 - 2000);
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('heure du téléphone incohérente : l’heure du serveur fait foi', () => {
    const store = makeStore();
    const future = run(store, () => report(store, ctx('alexis', T0), { id: id('rep'), targetId: 'arnaud', occurredAt: T0 + HOUR }));
    expect(store.reports.get(future.reportId)?.occurredAt).toBe(T0);
    const ancient = run(store, () => report(store, ctx('gatho', T0), { id: id('rep'), targetId: 'alexis', occurredAt: T0 - 48 * HOUR }));
    expect(store.reports.get(ancient.reportId)?.occurredAt).toBe(T0);
  });

  it('anti-emballement : 10 taps maximum en 10 secondes', () => {
    const store = makeStore();
    for (let i = 0; i < 10; i++) tap(store, 'alexis', 'gatho', T0 + i * 100);
    expectError(() => tap(store, 'alexis', 'gatho', T0 + 1100), 'rate_limited');
    expect(total(store, 'gatho')).toBe(10);
    expect(tap(store, 'alexis', 'gatho', T0 + 11_000).delta).toBe(1);
  });

  it('refuse un joueur archivé et un nombre de points hors limites', () => {
    const store = makeStore();
    run(store, () => updatePlayer(store, ctx('arnaud', T0), { id: 'gatho', archived: true }));
    expectError(() => tap(store, 'alexis', 'gatho', T0), 'not_found');
    expectError(() => tap(store, 'gatho', 'alexis', T0), 'forbidden');
    expectError(() => tap(store, 'alexis', 'arnaud', T0, { count: 6 }), 'invalid');
  });

  it('enregistre le mot en minuscules', () => {
    const store = makeStore();
    const result = tap(store, 'alexis', 'arnaud', T0, { word: '  PUTAIN ' });
    expect(store.reports.get(result.reportId)?.word).toBe('putain');
  });
});

describe('corriger', () => {
  it('annuler son propre signalement retire le point', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    const result = run(store, () => cancelReport(store, ctx('alexis', T0 + 2000), { reportId: first.reportId }));
    expect(result.delta).toBe(-1);
    expect(total(store, 'arnaud')).toBe(0);
    // Annuler deux fois ne fait rien de plus.
    expect(run(store, () => cancelReport(store, ctx('alexis', T0 + 3000), { reportId: first.reportId })).delta).toBe(0);
  });

  it('on ne peut pas annuler le signalement d’un autre (sauf l’admin)', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'gatho', T0);
    expectError(() => run(store, () => cancelReport(store, ctx('gatho', T0), { reportId: first.reportId })), 'forbidden');
    expect(run(store, () => cancelReport(store, ctx('arnaud', T0), { reportId: first.reportId })).delta).toBe(-1);
  });

  it('annuler une confirmation ne change pas le total', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0);
    const confirm = tap(store, 'gatho', 'arnaud', T0 + 2000);
    expect(run(store, () => cancelReport(store, ctx('gatho', T0 + 3000), { reportId: confirm.reportId })).delta).toBe(0);
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('« C’est un autre » transforme une confirmation en nouveau point', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    const second = tap(store, 'gatho', 'arnaud', T0 + 10_000);
    const result = run(store, () => splitReport(store, ctx('gatho', T0 + 12_000), { reportId: second.reportId }));
    expect(result.delta).toBe(1);
    expect(total(store, 'arnaud')).toBe(2);
    expect(store.reports.get(second.reportId)?.episodeId).not.toBe(first.episodeId);
    expect(store.reports.get(second.reportId)?.link).toBe('split');
  });

  it('« C’est un autre » est refusé si le signalement est déjà seul', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    expectError(() => run(store, () => splitReport(store, ctx('alexis', T0), { reportId: first.reportId })), 'invalid');
  });

  it('« C’est le même » regroupe deux points en un', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    const second = tap(store, 'gatho', 'arnaud', T0 + 40_000);
    const result = run(store, () => mergeReport(store, ctx('gatho', T0 + 41_000), { reportId: second.reportId, episodeId: first.episodeId }));
    expect(result.delta).toBe(-1);
    expect(total(store, 'arnaud')).toBe(1);
    expect(store.episodes.get(second.episodeId)?.voidReason).toBe('merged');
    // L'épisode vide disparaît de l'historique.
    expect(buildSnapshot(store, T0 + 42_000).recent.map((e) => e.id)).not.toContain(second.episodeId);
  });

  it('« C’est le même » refuse une autre personne ou un point trop ancien', () => {
    const store = makeStore();
    const onArnaud = tap(store, 'alexis', 'arnaud', T0);
    const onGatho = tap(store, 'alexis', 'gatho', T0 + 5000);
    expectError(
      () => run(store, () => mergeReport(store, ctx('alexis', T0 + 6000), { reportId: onGatho.reportId, episodeId: onArnaud.episodeId })),
      'invalid',
    );
    const late = tap(store, 'gatho', 'arnaud', T0 + 2 * HOUR);
    expectError(
      () => run(store, () => mergeReport(store, ctx('gatho', T0 + 2 * HOUR), { reportId: late.reportId, episodeId: onArnaud.episodeId })),
      'invalid',
    );
  });

  it('préciser le mot après coup', () => {
    const store = makeStore();
    const first = tap(store, 'alexis', 'arnaud', T0);
    run(store, () => setWord(store, ctx('alexis', T0 + 1000), { reportId: first.reportId, word: 'Merde' }));
    expect(store.reports.get(first.reportId)?.word).toBe('merde');
    expectError(() => run(store, () => setWord(store, ctx('gatho', T0), { reportId: first.reportId, word: 'x' })), 'forbidden');
  });
});

describe('ajout différé et +N', () => {
  it('rattraper « +5 pour hier soir » crée un épisode à part', () => {
    const store = makeStore();
    const result = run(store, () =>
      addManual(store, ctx('alexis', T0), { id: id('rep'), targetId: 'gatho', count: 5, occurredAt: T0 - 15 * HOUR, note: 'Soirée foot' }),
    );
    expect(result.delta).toBe(5);
    expect(total(store, 'gatho')).toBe(5);
    // Un tap juste après ne fusionne pas avec un ajout manuel.
    expect(tap(store, 'arnaud', 'gatho', T0 - 15 * HOUR + 1000).outcome).toBe('new');
  });

  it('refuse le futur, plus de 60 jours et plus de 20 points', () => {
    const store = makeStore();
    const add = (count: number, occurredAt: number) =>
      run(store, () => addManual(store, ctx('alexis', T0), { id: id('rep'), targetId: 'gatho', count, occurredAt }));
    expectError(() => add(1, T0 + HOUR), 'invalid');
    expectError(() => add(1, T0 - 61 * 24 * HOUR), 'invalid');
    expectError(() => add(21, T0), 'invalid');
  });
});

describe('contester et voter', () => {
  function contested() {
    const store = makeStore();
    const point = tap(store, 'alexis', 'arnaud', T0);
    const contest = run(store, () => openContest(store, ctx('arnaud', T0 + HOUR), { episodeId: point.episodeId, reason: 'Je chantais' }));
    return { store, point, contest };
  }

  it('seule la personne visée peut contester, dans les 48 h', () => {
    const store = makeStore();
    const point = tap(store, 'alexis', 'arnaud', T0);
    expectError(() => run(store, () => openContest(store, ctx('gatho', T0), { episodeId: point.episodeId })), 'forbidden');
    expectError(() => run(store, () => openContest(store, ctx('arnaud', T0 + 49 * HOUR), { episodeId: point.episodeId })), 'expired');
  });

  it('2 votes « pas valable » sur 3 : le point est annulé', () => {
    const { store, point, contest } = contested();
    expect(contest.status).toBe('open');
    run(store, () => vote(store, ctx('alexis', T0 + 2 * HOUR), { contestId: contest.id, choice: 'invalid' }));
    expect(total(store, 'arnaud')).toBe(1);
    const resolved = run(store, () => vote(store, ctx('gatho', T0 + 3 * HOUR), { contestId: contest.id, choice: 'invalid' }));
    expect(resolved.status).toBe('accepted');
    expect(store.episodes.get(point.episodeId)?.voidReason).toBe('contest');
    expect(total(store, 'arnaud')).toBe(0);
  });

  it('2 votes « valable » : le point est maintenu et ne peut plus être contesté', () => {
    const { store, point, contest } = contested();
    run(store, () => vote(store, ctx('alexis', T0 + 2 * HOUR), { contestId: contest.id, choice: 'valid' }));
    const resolved = run(store, () => vote(store, ctx('alexandre', T0 + 2 * HOUR), { contestId: contest.id, choice: 'valid' }));
    expect(resolved.status).toBe('rejected');
    expect(total(store, 'arnaud')).toBe(1);
    expectError(() => run(store, () => openContest(store, ctx('arnaud', T0 + 3 * HOUR), { episodeId: point.episodeId })), 'conflict');
  });

  it('la personne qui conteste ne vote pas', () => {
    const { store, contest } = contested();
    expectError(() => run(store, () => vote(store, ctx('arnaud', T0 + 2 * HOUR), { contestId: contest.id, choice: 'invalid' })), 'forbidden');
  });

  it('à l’échéance sans majorité : égalité ou aucun vote, le point reste', () => {
    const { store, contest } = contested();
    run(store, () => vote(store, ctx('alexis', T0 + 2 * HOUR), { contestId: contest.id, choice: 'valid' }));
    run(store, () => vote(store, ctx('gatho', T0 + 2 * HOUR), { contestId: contest.id, choice: 'invalid' }));
    run(store, () => resolveDueContests(store, T0 + 50 * HOUR));
    expect(store.contests.get(contest.id)?.status).toBe('rejected');
    expect(total(store, 'arnaud')).toBe(1);
  });

  it('à l’échéance, 1 « pas valable » contre 0 : le point est annulé', () => {
    const { store, contest } = contested();
    run(store, () => vote(store, ctx('gatho', T0 + 2 * HOUR), { contestId: contest.id, choice: 'invalid' }));
    expect(run(store, () => resolveDueContests(store, T0 + HOUR))).toBe(0);
    expect(run(store, () => resolveDueContests(store, T0 + 50 * HOUR))).toBe(1);
    expect(store.contests.get(contest.id)?.status).toBe('accepted');
    expect(total(store, 'arnaud')).toBe(0);
  });

  it('retirer sa contestation, puis la relancer', () => {
    const { store, point, contest } = contested();
    run(store, () => withdrawContest(store, ctx('arnaud', T0 + 2 * HOUR), { contestId: contest.id }));
    expect(store.contests.get(contest.id)?.status).toBe('withdrawn');
    const again = run(store, () => openContest(store, ctx('arnaud', T0 + 3 * HOUR), { episodeId: point.episodeId }));
    expect(again.status).toBe('open');
  });

  it('si le témoin retire son signalement pendant le vote, la contestation est close', () => {
    const { store, point, contest } = contested();
    run(store, () => cancelReport(store, ctx('alexis', T0 + 2 * HOUR), { reportId: point.reportId }));
    expect(store.contests.get(contest.id)?.status).toBe('accepted');
  });

  it('émet les événements pour les notifications', () => {
    const store = makeStore();
    const point = store.transact(() => report(store, ctx('alexis', T0), { id: id('rep'), targetId: 'arnaud', occurredAt: T0 }));
    expect(point.events).toEqual([expect.objectContaining({ type: 'point', targetId: 'arnaud', reporterId: 'alexis', delta: 1 })]);
    const opened = store.transact(() => openContest(store, ctx('arnaud', T0 + HOUR), { episodeId: point.result.episodeId }));
    expect(opened.events).toEqual([expect.objectContaining({ type: 'contest-opened', voters: ['alexis', 'alexandre', 'gatho'] })]);
  });
});

describe('transactions', () => {
  it('une action refusée ne laisse aucune trace, même après des écritures', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0);
    const before = store.version;
    expect(() =>
      store.transact(() => {
        report(store, ctx('gatho', T0 + 60_000), { id: id('rep'), targetId: 'alexis', occurredAt: T0 + 60_000 });
        throw new Error('panne');
      }),
    ).toThrow('panne');
    expect(store.version).toBe(before);
    expect(total(store, 'alexis')).toBe(0);
    expect(store.reports.size).toBe(1);
  });

  it('si l’écriture sur disque échoue, la mémoire revient en arrière', () => {
    const store = makeStore();
    expect(() =>
      store.transact(
        () => report(store, ctx('gatho', T0), { id: id('rep'), targetId: 'alexis', occurredAt: T0 }),
        () => {
          throw new Error('disque plein');
        },
      ),
    ).toThrow('disque plein');
    expect(store.reports.size).toBe(0);
    expect(store.episodes.size).toBe(0);
  });
});

describe('lancement et saisons', () => {
  it('le lancement officiel écarte les points de la phase de test', () => {
    const store = makeStore();
    tap(store, 'alexis', 'arnaud', T0);
    expect(buildSnapshot(store, T0 + 1000).phase).toBe('test');
    run(store, () => launchChallenge(store, ctx('arnaud', T0 + HOUR), {}));
    tap(store, 'alexis', 'gatho', T0 + 2 * HOUR);
    const snap = buildSnapshot(store, T0 + 3 * HOUR);
    expect(snap.phase).toBe('live');
    expect(snap.totals.arnaud?.all).toBe(0);
    expect(snap.totals.gatho).toMatchObject({ all: 1, season: 1, today: 1 });
    expect(snap.seasons.map((s) => s.name)).toEqual(['Saison 1']);
    expectError(() => run(store, () => launchChallenge(store, ctx('arnaud', T0 + 4 * HOUR), {})), 'conflict');
  });

  it('une nouvelle saison repart de zéro sans perdre le total', () => {
    const store = makeStore();
    run(store, () => launchChallenge(store, ctx('arnaud', T0), {}));
    tap(store, 'alexis', 'gatho', T0 + HOUR);
    const tx = store.transact(() => startSeason(store, ctx('arnaud', T0 + 2 * HOUR), { name: 'Novembre' }));
    expect(tx.events).toEqual([expect.objectContaining({ type: 'season-ended' })]);
    tap(store, 'alexis', 'gatho', T0 + 3 * HOUR);
    const snap = buildSnapshot(store, T0 + 4 * HOUR);
    expect(snap.totals.gatho).toMatchObject({ all: 2, season: 1 });
    expect(snap.seasons.map((s) => s.name)).toEqual(['Saison 1', 'Novembre']);
  });

  it('seul l’admin lance le défi', () => {
    const store = makeStore();
    expectError(() => run(store, () => launchChallenge(store, ctx('gatho', T0), {})), 'forbidden');
  });
});
