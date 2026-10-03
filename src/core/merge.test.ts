import { describe, expect, it } from 'vitest';
import { decideMerge, pointsOf, type EpisodeLike } from './merge';

const windows = { mergeWindowMs: 20_000, suggestWindowMs: 120_000 };
const r = (reporterId: string, count = 1, cancelled = false) => ({ reporterId, count, cancelled });

function episode(id: string, startedAt: number, reports: ReturnType<typeof r>[], extra: Partial<EpisodeLike> = {}): EpisodeLike {
  return { id, targetId: 'arnaud', kind: 'live', startedAt, voided: false, reports, ...extra };
}

describe('pointsOf : chaque témoin compte de son côté, on garde le plus grand nombre', () => {
  it('deux témoins du même gros mot = 1 point', () => {
    expect(pointsOf([r('alexis'), r('gatho')])).toBe(1);
  });
  it('rafale vue 3 fois par l’un et 2 fois par l’autre = 3 points', () => {
    expect(pointsOf([r('alexis'), r('alexis'), r('alexis'), r('gatho'), r('gatho')])).toBe(3);
  });
  it('les signalements annulés ne comptent pas', () => {
    expect(pointsOf([r('alexis', 1, true), r('gatho')])).toBe(1);
    expect(pointsOf([r('alexis', 1, true)])).toBe(0);
  });
  it('un +2 compte pour 2', () => {
    expect(pointsOf([r('alexis', 2), r('gatho')])).toBe(2);
  });
});

describe('decideMerge', () => {
  const input = { targetId: 'arnaud', reporterId: 'gatho', occurredAt: 100_000, count: 1 };

  it('sans épisode récent : nouvel épisode, sans proposition', () => {
    expect(decideMerge([], input, windows)).toEqual({ kind: 'new', suggestion: null });
  });

  it('un autre témoin il y a 5 s : fusion, le point est confirmé (pas de +1)', () => {
    const decision = decideMerge([episode('e1', 95_000, [r('alexis')])], input, windows);
    expect(decision).toMatchObject({ kind: 'merge', before: 1, after: 1 });
  });

  it('le même témoin retape dans la fenêtre : +1 (deuxième gros mot)', () => {
    const decision = decideMerge([episode('e1', 95_000, [r('gatho')])], input, windows);
    expect(decision).toMatchObject({ kind: 'merge', before: 1, after: 2 });
  });

  it('juste à la limite de 20 s : nouvel épisode avec proposition « C’est le même ? »', () => {
    const decision = decideMerge([episode('e1', 80_000, [r('alexis')])], input, windows);
    expect(decision.kind).toBe('new');
    expect(decision.kind === 'new' && decision.suggestion?.id).toBe('e1');
  });

  it('au-delà de 2 min : ni fusion ni proposition', () => {
    expect(decideMerge([episode('e1', 100_000 - 120_000, [r('alexis')])], input, windows)).toEqual({ kind: 'new', suggestion: null });
  });

  it('pas de proposition si ce témoin a déjà signalé cet épisode (c’est forcément un autre gros mot)', () => {
    const decision = decideMerge([episode('e1', 40_000, [r('gatho')])], input, windows);
    expect(decision).toEqual({ kind: 'new', suggestion: null });
  });

  it('ignore les épisodes annulés, manuels, vides ou visant quelqu’un d’autre', () => {
    const candidates = [
      episode('void', 99_000, [r('alexis')], { voided: true }),
      episode('manual', 99_000, [r('alexis')], { kind: 'manual' }),
      episode('empty', 99_000, [r('alexis', 1, true)]),
      episode('other', 99_000, [r('alexis')], { targetId: 'alexis' }),
    ];
    expect(decideMerge(candidates, input, windows)).toEqual({ kind: 'new', suggestion: null });
  });

  it('préfère l’épisode où ce témoin a déjà signalé, puis le plus proche', () => {
    const candidates = [episode('mine', 85_000, [r('gatho')]), episode('closer', 98_000, [r('alexis')])];
    expect(decideMerge(candidates, input, windows)).toMatchObject({ kind: 'merge', episode: { id: 'mine' } });
    const others = [episode('far', 85_000, [r('alexis')]), episode('near', 98_000, [r('alexandre')])];
    expect(decideMerge(others, input, windows)).toMatchObject({ kind: 'merge', episode: { id: 'near' } });
  });

  it('un signalement hors ligne arrivé en retard se rattache à l’épisode qui suit de peu', () => {
    const decision = decideMerge([episode('e1', 103_000, [r('alexis')])], input, windows);
    expect(decision).toMatchObject({ kind: 'merge', episode: { id: 'e1' } });
  });
});
