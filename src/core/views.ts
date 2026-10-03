// Vues calculées à partir de l'état : ce que l'interface affiche.

import { currentSeason, eligibleVoters, episodePoints, toReportLike } from './commands';
import { activeReporters } from './merge';
import type { Store } from './store';
import { DAY, startOfDay, startOfMonth, startOfWeek } from './time';
import type {
  Contest,
  ContestView,
  Episode,
  EpisodeView,
  LastPoint,
  Millis,
  PeriodTotals,
  PlayerId,
  Snapshot,
} from './types';

export interface Bounds {
  /** Début de la période « total » : lancement officiel, ou rien en phase de test. */
  all: Millis;
  today: Millis;
  week: Millis;
  month: Millis;
  season: { start: Millis; end: Millis } | null;
}

export function bounds(store: Store, now: Millis): Bounds {
  const tz = store.settings.timeZone;
  const all = store.settings.challengeStartedAt ?? Number.NEGATIVE_INFINITY;
  const season = currentSeason(store, now);
  return {
    all,
    today: Math.max(all, startOfDay(now, tz)),
    week: Math.max(all, startOfWeek(now, tz)),
    month: Math.max(all, startOfMonth(now, tz)),
    season: season ? { start: Math.max(all, season.startsAt), end: season.endsAt ?? Number.POSITIVE_INFINITY } : null,
  };
}

/** Mot le plus cité par les témoins d'un épisode. */
export function episodeWord(store: Store, episodeId: string): string | null {
  const counts = new Map<string, number>();
  for (const r of store.reportsOf(episodeId)) {
    if (r.cancelledAt === null && r.word) counts.set(r.word, (counts.get(r.word) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [word, count] of counts) {
    if (count > bestCount) {
      best = word;
      bestCount = count;
    }
  }
  return best;
}

export function contestView(store: Store, contest: Contest): ContestView {
  const episode = store.episodes.get(contest.episodeId);
  return { ...contest, voters: eligibleVoters(store, contest), targetId: episode?.targetId ?? contest.openedBy };
}

export function episodeView(store: Store, episode: Episode): EpisodeView {
  const contests = store.contestsOf(episode.id);
  const latest = contests.reduce<Contest | null>((acc, c) => (!acc || c.openedAt > acc.openedAt ? c : acc), null);
  return {
    id: episode.id,
    targetId: episode.targetId,
    kind: episode.kind,
    startedAt: episode.startedAt,
    createdAt: episode.createdAt,
    points: episodePoints(store, episode),
    voided: episode.voidedAt !== null,
    voidReason: episode.voidReason,
    voidNote: episode.voidNote,
    note: episode.note,
    word: episodeWord(store, episode.id),
    reports: store
      .reportsOf(episode.id)
      .map((r) => ({
        id: r.id,
        reporterId: r.reporterId,
        count: r.count,
        occurredAt: r.occurredAt,
        word: r.word,
        link: r.link,
        cancelledAt: r.cancelledAt,
        cancelledBy: r.cancelledBy,
      }))
      .sort((a, b) => a.occurredAt - b.occurredAt),
    contest: latest ? contestView(store, latest) : null,
  };
}

/** Un épisode vidé par « C'est le même » n'a plus rien à montrer. */
function isVisible(episode: Episode): boolean {
  return episode.voidReason !== 'merged';
}

export function computeTotals(store: Store, now: Millis): Record<PlayerId, PeriodTotals> {
  const b = bounds(store, now);
  const totals: Record<PlayerId, PeriodTotals> = {};
  for (const p of store.players.values()) totals[p.id] = { today: 0, week: 0, month: 0, season: 0, all: 0 };
  for (const e of store.episodes.values()) {
    if (e.voidedAt !== null || e.startedAt < b.all) continue;
    const points = episodePoints(store, e);
    const t = totals[e.targetId];
    if (!t || points === 0) continue;
    t.all += points;
    if (e.startedAt >= b.today) t.today += points;
    if (e.startedAt >= b.week) t.week += points;
    if (e.startedAt >= b.month) t.month += points;
    if (b.season && e.startedAt >= b.season.start && e.startedAt < b.season.end) t.season += points;
  }
  return totals;
}

function lastPoints(store: Store, now: Millis): Record<PlayerId, LastPoint | null> {
  const b = bounds(store, now);
  const last: Record<PlayerId, LastPoint | null> = {};
  for (const p of store.players.values()) last[p.id] = null;
  for (const e of store.episodes.values()) {
    if (e.voidedAt !== null || e.startedAt < b.all) continue;
    const reports = store.reportsOf(e.id).filter((r) => r.cancelledAt === null);
    if (reports.length === 0 || episodePoints(store, e) === 0) continue;
    const at = Math.max(...reports.map((r) => r.occurredAt));
    const current = last[e.targetId];
    if (current === undefined) continue;
    if (!current || at > current.at) {
      last[e.targetId] = { at, episodeId: e.id, reporterIds: activeReporters(reports.map(toReportLike)) };
    }
  }
  return last;
}

/** Épisodes du plus récent au plus ancien, avec pagination par curseur « début:id ». */
export function history(
  store: Store,
  options: { before?: string | null; limit?: number; playerId?: PlayerId | null; contested?: boolean } = {},
): { items: EpisodeView[]; next: string | null } {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  let cursor: { at: number; id: string } | null = null;
  if (options.before) {
    const [at, id] = options.before.split(':');
    if (at && id && Number.isFinite(Number(at))) cursor = { at: Number(at), id };
  }
  const sorted = [...store.episodes.values()]
    .filter(isVisible)
    .filter((e) => !options.playerId || e.targetId === options.playerId)
    .filter((e) => !options.contested || store.contestsOf(e.id).some((c) => c.status === 'open'))
    .sort((a, b) => b.startedAt - a.startedAt || (a.id < b.id ? 1 : -1));
  const start = cursor
    ? sorted.findIndex((e) => e.startedAt < cursor.at || (e.startedAt === cursor.at && e.id < cursor.id))
    : 0;
  if (start < 0) return { items: [], next: null };
  const page = sorted.slice(start, start + limit);
  const lastItem = page[page.length - 1];
  const next = start + limit < sorted.length && lastItem ? `${lastItem.startedAt}:${lastItem.id}` : null;
  return { items: page.map((e) => episodeView(store, e)), next };
}

export function buildSnapshot(store: Store, now: Millis): Snapshot {
  const season = currentSeason(store, now);
  const recentFrom = now - Math.max(store.settings.suggestWindowMs, store.settings.mergeWindowMs) - 60_000;
  const sorted = [...store.episodes.values()].filter(isVisible).sort((a, b) => b.startedAt - a.startedAt);
  const recent = sorted.filter((e, i) => i < 40 || e.startedAt >= recentFrom).map((e) => episodeView(store, e));

  const weekAgo = now - 7 * DAY;
  const contests = [...store.contests.values()]
    .filter((c) => c.status === 'open' || (c.resolvedAt !== null && c.resolvedAt >= weekAgo))
    .sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.openedAt - a.openedAt)
    .map((c) => contestView(store, c));

  return {
    version: store.version,
    now,
    phase: store.settings.challengeStartedAt === null ? 'test' : 'live',
    players: [...store.players.values()].sort((a, b) => a.position - b.position),
    settings: store.settings,
    seasons: [...store.seasons.values()].sort((a, b) => a.startsAt - b.startsAt),
    currentSeasonId: season?.id ?? null,
    totals: computeTotals(store, now),
    last: lastPoints(store, now),
    recent,
    contests,
  };
}
