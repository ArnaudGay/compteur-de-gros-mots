// Débuts des périodes (aujourd'hui, semaine, mois, saison, total) et ajout de points aux
// totaux. Sans dépendance au Store : le serveur et le téléphone font exactement le même calcul.

import { startOfDay, startOfMonth, startOfWeek } from './time';
import type { Millis, PeriodTotals, Season, Settings } from './types';

export interface Bounds {
  /** Début de la période « total » : lancement officiel, ou rien en phase de test. */
  all: Millis;
  today: Millis;
  week: Millis;
  month: Millis;
  season: { start: Millis; end: Millis } | null;
}

export function periodBounds(settings: Pick<Settings, 'timeZone' | 'challengeStartedAt'>, season: Season | null, now: Millis): Bounds {
  const tz = settings.timeZone;
  const all = settings.challengeStartedAt ?? Number.NEGATIVE_INFINITY;
  return {
    all,
    today: Math.max(all, startOfDay(now, tz)),
    week: Math.max(all, startOfWeek(now, tz)),
    month: Math.max(all, startOfMonth(now, tz)),
    season: season ? { start: Math.max(all, season.startsAt), end: season.endsAt ?? Number.POSITIVE_INFINITY } : null,
  };
}

/** Ajoute (ou retire, si négatif) les points d'un épisode aux périodes où il compte. */
export function addToTotals(t: PeriodTotals, b: Bounds, startedAt: Millis, points: number): void {
  if (startedAt < b.all) return;
  t.all += points;
  if (startedAt >= b.today) t.today += points;
  if (startedAt >= b.week) t.week += points;
  if (startedAt >= b.month) t.month += points;
  if (b.season && startedAt >= b.season.start && startedAt < b.season.end) t.season += points;
}
