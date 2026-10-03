// Statistiques : courbes par jour, séries sans gros mot, moments critiques, top des mots.

import { currentSeason, episodePoints } from './commands';
import type { Store } from './store';
import { DAY, dayKey, dayRange, daysBetween, startOfDay, zonedParts } from './time';
import type { Millis, PlayerStats, StatsRange, StatsView } from './types';
import { episodeWord } from './views';

/** Statistiques sur une période ; `seasonId` permet de revoir une saison terminée. */
export function buildStats(store: Store, nowArg: Millis, range: StatsRange, seasonId?: string | null): StatsView {
  const tz = store.settings.timeZone;
  const launched = store.settings.challengeStartedAt;
  let firstEpisode = nowArg;
  for (const e of store.episodes.values()) if (e.startedAt < firstEpisode) firstEpisode = e.startedAt;
  const allFrom = launched ?? firstEpisode;

  const pastSeason = range === 'season' && seasonId ? store.seasons.get(seasonId) : undefined;
  // Pour une saison terminée, la période s'arrête à sa fin.
  const now = pastSeason?.endsAt ? Math.min(nowArg, pastSeason.endsAt - 1) : nowArg;

  let from: Millis;
  if (range === '30d') from = Math.max(allFrom, startOfDay(now - 29 * DAY, tz));
  else if (range === 'season') from = Math.max(allFrom, (pastSeason ?? currentSeason(store, now))?.startsAt ?? allFrom);
  else from = allFrom;
  from = Math.min(from, now);

  const firstDay = dayKey(from, tz);
  const today = dayKey(now, tz);
  const days = dayRange(firstDay, today);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const players = store.activePlayers();
  const stats = new Map<string, PlayerStats>(
    players.map((p) => [
      p.id,
      {
        playerId: p.id,
        points: 0,
        currentStreak: 0,
        bestStreak: 0,
        worstDay: null,
        reportsOnOthers: 0,
        selfReports: 0,
        perDay: days.map(() => 0),
      },
    ]),
  );
  const heatmap = Array.from({ length: 7 }, () => Array.from({ length: 6 }, () => 0));
  const words = new Map<string, number>();
  let totalPoints = 0;

  for (const e of store.episodes.values()) {
    if (e.voidedAt !== null || e.startedAt < from || e.startedAt > now) continue;
    const points = episodePoints(store, e);
    const s = stats.get(e.targetId);
    if (!s || points === 0) continue;
    s.points += points;
    totalPoints += points;
    const i = dayIndex.get(dayKey(e.startedAt, tz));
    if (i !== undefined) s.perDay[i] = (s.perDay[i] ?? 0) + points;
    const parts = zonedParts(e.startedAt, tz);
    const row = heatmap[parts.weekday];
    if (row) row[Math.floor(parts.hour / 4)] = (row[Math.floor(parts.hour / 4)] ?? 0) + points;
    const word = episodeWord(store, e.id);
    if (word) words.set(word, (words.get(word) ?? 0) + points);
  }

  for (const r of store.reports.values()) {
    if (r.cancelledAt !== null || r.occurredAt < from || r.occurredAt > now) continue;
    const s = stats.get(r.reporterId);
    if (!s) continue;
    if (r.reporterId === r.targetId) s.selfReports += r.count;
    else s.reportsOnOthers += r.count;
  }

  for (const s of stats.values()) {
    const pointDays = days.filter((_, i) => (s.perDay[i] ?? 0) > 0);
    for (let i = 0; i < days.length; i++) {
      const value = s.perDay[i] ?? 0;
      const day = days[i];
      if (day && value > 0 && (!s.worstDay || value > s.worstDay.points)) s.worstDay = { day, points: value };
    }
    const last = pointDays[pointDays.length - 1];
    const first = pointDays[0];
    if (!last || !first) {
      // Aucun gros mot sur la période : tous les jours comptent, aujourd'hui compris.
      s.currentStreak = daysBetween(firstDay, today) + 1;
      s.bestStreak = s.currentStreak;
      continue;
    }
    s.currentStreak = daysBetween(last, today);
    let best = Math.max(s.currentStreak, daysBetween(firstDay, first));
    for (let i = 1; i < pointDays.length; i++) {
      const prev = pointDays[i - 1];
      const next = pointDays[i];
      if (prev && next) best = Math.max(best, daysBetween(prev, next) - 1);
    }
    s.bestStreak = best;
  }

  const topWords = [...words.entries()]
    .map(([word, points]) => ({ word, points }))
    .sort((a, b) => b.points - a.points || a.word.localeCompare(b.word, 'fr'))
    .slice(0, 10);

  return {
    range,
    from,
    to: now,
    days,
    players: players.map((p) => stats.get(p.id)).filter((s): s is PlayerStats => s !== undefined),
    heatmap,
    topWords,
    totalPoints,
  };
}
