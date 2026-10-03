// La règle de fusion des doublons. Fonctions pures, utilisées par le serveur pour décider
// et par le téléphone pour prédire le résultat d'un tap avant la réponse du serveur.

import type { EpisodeKind, Millis, PlayerId } from './types';

export interface ReportLike {
  reporterId: PlayerId;
  count: number;
  cancelled: boolean;
}

export interface EpisodeLike {
  id: string;
  targetId: PlayerId;
  kind: EpisodeKind;
  startedAt: Millis;
  voided: boolean;
  reports: readonly ReportLike[];
}

export interface MergeInput {
  targetId: PlayerId;
  reporterId: PlayerId;
  occurredAt: Millis;
  count: number;
}

export interface MergeWindows {
  mergeWindowMs: number;
  suggestWindowMs: number;
}

export type MergeDecision =
  | { kind: 'merge'; episode: EpisodeLike; before: number; after: number }
  | { kind: 'new'; suggestion: EpisodeLike | null };

/**
 * Points d'un épisode : chaque témoin compte de son côté, on garde le plus grand nombre.
 * Deux personnes qui signalent le même gros mot = 1 point ; une rafale de 3 vue par
 * l'un et de 2 par l'autre = 3 points.
 */
export function pointsOf(reports: readonly ReportLike[]): number {
  const perReporter = new Map<PlayerId, number>();
  for (const r of reports) {
    if (r.cancelled) continue;
    perReporter.set(r.reporterId, (perReporter.get(r.reporterId) ?? 0) + r.count);
  }
  let max = 0;
  for (const value of perReporter.values()) max = Math.max(max, value);
  return max;
}

/** Témoins dont au moins un signalement est encore actif. */
export function activeReporters(reports: readonly ReportLike[]): PlayerId[] {
  const ids: PlayerId[] = [];
  for (const r of reports) if (!r.cancelled && !ids.includes(r.reporterId)) ids.push(r.reporterId);
  return ids;
}

function closest(episodes: EpisodeLike[], at: Millis): EpisodeLike | null {
  let best: EpisodeLike | null = null;
  for (const e of episodes) {
    if (!best) {
      best = e;
      continue;
    }
    const d = Math.abs(at - e.startedAt);
    const dBest = Math.abs(at - best.startedAt);
    if (d < dBest || (d === dBest && e.startedAt > best.startedAt)) best = e;
  }
  return best;
}

/**
 * Frontières qu'aucun épisode ne traverse : le lancement officiel et les débuts et fins de
 * saison. Sinon, un tap juste après le lancement rejoindrait un épisode de la phase de test,
 * ou un tap d'une nouvelle saison modifierait le classement final de la précédente.
 */
export function boundariesOf(challengeStartedAt: Millis | null, seasons: Iterable<{ startsAt: Millis; endsAt: Millis | null }>): Millis[] {
  const list = challengeStartedAt === null ? [] : [challengeStartedAt];
  for (const s of seasons) {
    list.push(s.startsAt);
    if (s.endsAt !== null) list.push(s.endsAt);
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

/** Numéro de la tranche de temps (entre deux frontières) où tombe un instant. */
export function segmentOf(at: Millis, boundaries: readonly Millis[]): number {
  let segment = 0;
  for (const b of boundaries) if (b <= at) segment += 1;
  return segment;
}

/**
 * Décide où va un nouveau signalement.
 * - Un épisode en direct de la même personne a commencé à moins de `mergeWindowMs` :
 *   on s'y rattache (de préférence à un épisode où ce témoin a déjà signalé, puis au plus proche).
 * - Sinon, nouvel épisode ; si un épisode d'un autre témoin date de moins de
 *   `suggestWindowMs`, on le propose pour « C'est le même ? ».
 * Seuls comptent les épisodes du même côté des frontières (`boundariesOf`).
 */
export function decideMerge(
  candidates: readonly EpisodeLike[],
  input: MergeInput,
  windows: MergeWindows,
  boundaries: readonly Millis[] = [],
): MergeDecision {
  const segment = segmentOf(input.occurredAt, boundaries);
  const live = candidates.filter(
    (e) =>
      e.targetId === input.targetId &&
      e.kind === 'live' &&
      !e.voided &&
      pointsOf(e.reports) > 0 &&
      segmentOf(e.startedAt, boundaries) === segment,
  );

  const inWindow = live.filter((e) => Math.abs(input.occurredAt - e.startedAt) < windows.mergeWindowMs);
  if (inWindow.length > 0) {
    const mine = inWindow.filter((e) => e.reports.some((r) => !r.cancelled && r.reporterId === input.reporterId));
    const episode = closest(mine.length > 0 ? mine : inWindow, input.occurredAt);
    if (episode) {
      const before = pointsOf(episode.reports);
      const after = pointsOf([...episode.reports, { reporterId: input.reporterId, count: input.count, cancelled: false }]);
      return { kind: 'merge', episode, before, after };
    }
  }

  const suggestable = live.filter(
    (e) =>
      Math.abs(input.occurredAt - e.startedAt) < windows.suggestWindowMs &&
      !e.reports.some((r) => !r.cancelled && r.reporterId === input.reporterId),
  );
  return { kind: 'new', suggestion: closest(suggestable, input.occurredAt) };
}
