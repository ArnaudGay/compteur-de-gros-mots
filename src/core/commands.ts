// Toutes les actions qui modifient l'état. Chaque fonction vérifie d'abord, puis écrit :
// une action refusée ne laisse aucune trace. Les messages d'erreur sont affichés tels quels.

import { CLOCK, LIMITS, PLAYER_HUES, RATE_LIMIT } from './defaults';
import { fail } from './errors';
import { activeReporters, decideMerge, pointsOf, type EpisodeLike, type ReportLike } from './merge';
import type { Store } from './store';
import type {
  ActionResult,
  Contest,
  ContestStatus,
  Episode,
  Millis,
  Player,
  PlayerId,
  Report,
  ReportResult,
  Season,
  Settings,
  VoteChoice,
} from './types';

export interface Ctx {
  now: Millis;
  actorId: PlayerId;
  newId?: () => string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function newId(ctx: Ctx): string {
  return ctx.newId ? ctx.newId() : crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Aides

export function toReportLike(r: Report): ReportLike {
  return { reporterId: r.reporterId, count: r.count, cancelled: r.cancelledAt !== null };
}

export function toEpisodeLike(store: Store, e: Episode): EpisodeLike {
  return {
    id: e.id,
    targetId: e.targetId,
    kind: e.kind,
    startedAt: e.startedAt,
    voided: e.voidedAt !== null,
    reports: store.reportsOf(e.id).map(toReportLike),
  };
}

export function episodePoints(store: Store, e: Episode): number {
  if (e.voidedAt !== null) return 0;
  return pointsOf(store.reportsOf(e.id).map(toReportLike));
}

function requireActor(store: Store, ctx: Ctx): Player {
  const actor = store.players.get(ctx.actorId);
  if (!actor || actor.archivedAt !== null) fail('forbidden', "Ce compte n'a plus accès au défi.");
  return actor;
}

function requireAdmin(store: Store, ctx: Ctx): Player {
  const actor = requireActor(store, ctx);
  if (!actor.isAdmin) fail('forbidden', "Seul l'admin peut faire ça.");
  return actor;
}

function requireTarget(store: Store, targetId: PlayerId): Player {
  const target = store.players.get(targetId);
  if (!target || target.archivedAt !== null) fail('not_found', 'Joueur introuvable.');
  return target;
}

function requireEpisode(store: Store, episodeId: string): Episode {
  const episode = store.episodes.get(episodeId);
  if (!episode) fail('not_found', 'Ce point est introuvable.');
  return episode;
}

function requireReport(store: Store, reportId: string): Report {
  const report = store.reports.get(reportId);
  if (!report) fail('not_found', 'Ce signalement est introuvable.');
  return report;
}

function requireOwnReport(store: Store, ctx: Ctx, reportId: string): { report: Report; actor: Player } {
  const actor = requireActor(store, ctx);
  const report = requireReport(store, reportId);
  if (report.reporterId !== actor.id && !actor.isAdmin) fail('forbidden', "Seul l'auteur du signalement peut faire ça.");
  return { report, actor };
}

function cleanText(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

export function normalizeWord(value: string | null | undefined): string | null {
  const word = cleanText(value, LIMITS.wordMax);
  return word ? word.toLocaleLowerCase('fr-FR') : null;
}

function requireInt(value: number, min: number, max: number, message: string): number {
  if (!Number.isInteger(value) || value < min || value > max) fail('invalid', message);
  return value;
}

/** Heure du tap : celle du téléphone si elle est plausible, sinon celle du serveur. */
export function clampOccurredAt(occurredAt: Millis | undefined, now: Millis): Millis {
  if (occurredAt === undefined || !Number.isFinite(occurredAt)) return now;
  if (occurredAt > now + CLOCK.maxFutureMs || occurredAt < now - CLOCK.maxPastMs) return now;
  return Math.min(occurredAt, now);
}

function earliestStart(store: Store, episode: Episode): Millis {
  const reports = store.reportsOf(episode.id);
  if (reports.length === 0) return episode.startedAt;
  return Math.min(...reports.map((r) => r.occurredAt));
}

/** Recale le début d'un épisode en direct sur son premier signalement. */
function refreshStart(store: Store, episodeId: string): void {
  const episode = store.episodes.get(episodeId);
  if (!episode || episode.kind !== 'live') return;
  const startedAt = earliestStart(store, episode);
  if (startedAt !== episode.startedAt) store.putEpisode({ ...episode, startedAt });
}

function checkRateLimit(store: Store, reporterId: PlayerId, at: Millis, count: number): void {
  let recent = count;
  for (const r of store.reports.values()) {
    if (r.reporterId === reporterId && Math.abs(r.occurredAt - at) < RATE_LIMIT.windowMs) recent += r.count;
  }
  if (recent > RATE_LIMIT.taps) fail('rate_limited', 'Doucement : 10 gros mots maximum en 10 secondes.');
}

function openContestOf(store: Store, episodeId: string): Contest | undefined {
  return store.contestsOf(episodeId).find((c) => c.status === 'open');
}

/** Joueurs appelés à voter : tous les joueurs actifs sauf la personne qui conteste. */
export function eligibleVoters(store: Store, contest: Contest): PlayerId[] {
  return store
    .activePlayers()
    .map((p) => p.id)
    .filter((id) => id !== contest.openedBy);
}

// ---------------------------------------------------------------------------
// Compter

export interface ReportInput {
  id: string;
  targetId: PlayerId;
  occurredAt?: Millis;
  count?: number;
  word?: string | null;
}

/** Un tap « +1 » (ou +N en direct). Idempotent : renvoyer le même identifiant ne recompte pas. */
export function report(store: Store, ctx: Ctx, input: ReportInput): ReportResult {
  const actor = requireActor(store, ctx);
  if (!ID_PATTERN.test(input.id)) fail('invalid', 'Identifiant de signalement invalide.');

  const existing = store.reports.get(input.id);
  if (existing) {
    if (existing.reporterId !== actor.id) fail('conflict', 'Ce signalement existe déjà.');
    return {
      reportId: existing.id,
      episodeId: existing.episodeId,
      outcome: 'duplicate',
      delta: 0,
      otherReporterIds: [],
      episodeAgeMs: 0,
      suggestion: null,
    };
  }

  const target = requireTarget(store, input.targetId);
  const count = requireInt(input.count ?? 1, 1, LIMITS.liveCountMax, `Entre 1 et ${LIMITS.liveCountMax} points à la fois.`);
  const occurredAt = clampOccurredAt(input.occurredAt, ctx.now);
  checkRateLimit(store, actor.id, occurredAt, count);
  const word = normalizeWord(input.word);

  const candidates = store.episodesOf(target.id).map((e) => toEpisodeLike(store, e));
  const decision = decideMerge(candidates, { targetId: target.id, reporterId: actor.id, occurredAt, count }, store.settings);

  let episode: Episode;
  let outcome: ReportResult['outcome'];
  let delta: number;
  if (decision.kind === 'merge') {
    episode = requireEpisode(store, decision.episode.id);
    delta = decision.after - decision.before;
    outcome = delta > 0 ? 'increment' : 'confirm';
  } else {
    episode = {
      id: newId(ctx),
      targetId: target.id,
      kind: 'live',
      startedAt: occurredAt,
      note: null,
      createdAt: ctx.now,
      createdBy: actor.id,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      voidNote: null,
    };
    store.putEpisode(episode);
    delta = count;
    outcome = 'new';
  }

  const otherReporterIds = activeReporters(store.reportsOf(episode.id).map(toReportLike)).filter((id) => id !== actor.id);
  const episodeAgeMs = Math.max(0, occurredAt - episode.startedAt);

  store.putReport({
    id: input.id,
    episodeId: episode.id,
    targetId: target.id,
    reporterId: actor.id,
    count,
    occurredAt,
    receivedAt: ctx.now,
    word,
    link: decision.kind === 'merge' ? 'auto' : 'new',
    cancelledAt: null,
    cancelledBy: null,
  });
  refreshStart(store, episode.id);

  store.log({
    at: ctx.now,
    actorId: actor.id,
    action: 'report',
    data: { reportId: input.id, episodeId: episode.id, targetId: target.id, outcome, count },
  });
  if (delta > 0) store.emit({ type: 'point', targetId: target.id, reporterId: actor.id, delta, episodeId: episode.id, word });

  const suggestion =
    decision.kind === 'new' && decision.suggestion
      ? {
          episodeId: decision.suggestion.id,
          reporterIds: activeReporters(decision.suggestion.reports),
          ageMs: Math.abs(occurredAt - decision.suggestion.startedAt),
        }
      : null;

  return { reportId: input.id, episodeId: episode.id, outcome, delta, otherReporterIds, episodeAgeMs, suggestion };
}

export interface ManualInput {
  id: string;
  targetId: PlayerId;
  count: number;
  occurredAt: Millis;
  note?: string | null;
  word?: string | null;
}

/** Ajout différé ou +N : un épisode à part, jamais fusionné automatiquement. */
export function addManual(store: Store, ctx: Ctx, input: ManualInput): ReportResult {
  const actor = requireActor(store, ctx);
  if (!ID_PATTERN.test(input.id)) fail('invalid', 'Identifiant de signalement invalide.');
  const existing = store.reports.get(input.id);
  if (existing) {
    if (existing.reporterId !== actor.id) fail('conflict', 'Ce signalement existe déjà.');
    return { reportId: existing.id, episodeId: existing.episodeId, outcome: 'duplicate', delta: 0, otherReporterIds: [], episodeAgeMs: 0, suggestion: null };
  }
  const target = requireTarget(store, input.targetId);
  const count = requireInt(input.count, 1, LIMITS.manualCountMax, `Entre 1 et ${LIMITS.manualCountMax} points à la fois.`);
  if (!Number.isFinite(input.occurredAt) || input.occurredAt > ctx.now + CLOCK.maxFutureMs) fail('invalid', "L'heure ne peut pas être dans le futur.");
  if (input.occurredAt < ctx.now - LIMITS.manualMaxPastMs) fail('invalid', 'On ne peut pas rattraper un gros mot de plus de 60 jours.');
  const occurredAt = Math.min(input.occurredAt, ctx.now);
  const note = cleanText(input.note, LIMITS.noteMax);
  const word = normalizeWord(input.word);

  const episode: Episode = {
    id: newId(ctx),
    targetId: target.id,
    kind: 'manual',
    startedAt: occurredAt,
    note,
    createdAt: ctx.now,
    createdBy: actor.id,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    voidNote: null,
  };
  store.putEpisode(episode);
  store.putReport({
    id: input.id,
    episodeId: episode.id,
    targetId: target.id,
    reporterId: actor.id,
    count,
    occurredAt,
    receivedAt: ctx.now,
    word,
    link: 'manual',
    cancelledAt: null,
    cancelledBy: null,
  });
  store.log({ at: ctx.now, actorId: actor.id, action: 'manual', data: { reportId: input.id, episodeId: episode.id, targetId: target.id, count, note } });
  store.emit({ type: 'point', targetId: target.id, reporterId: actor.id, delta: count, episodeId: episode.id, word });
  return { reportId: input.id, episodeId: episode.id, outcome: 'new', delta: count, otherReporterIds: [], episodeAgeMs: 0, suggestion: null };
}

// ---------------------------------------------------------------------------
// Corriger

/** Annule un signalement (le sien, ou n'importe lequel pour l'admin). */
export function cancelReport(store: Store, ctx: Ctx, input: { reportId: string }): ActionResult {
  const { report: row, actor } = requireOwnReport(store, ctx, input.reportId);
  if (row.cancelledAt !== null) return { delta: 0 };
  const episode = requireEpisode(store, row.episodeId);
  const before = episodePoints(store, episode);
  store.putReport({ ...row, cancelledAt: ctx.now, cancelledBy: actor.id });
  const after = episodePoints(store, episode);
  store.log({ at: ctx.now, actorId: actor.id, action: 'cancel', data: { reportId: row.id, episodeId: episode.id } });

  // Plus aucun point : une contestation en cours n'a plus d'objet, elle est donnée gagnante.
  const contest = openContestOf(store, episode.id);
  if (contest && after === 0) resolveContest(store, contest, ctx.now, 'accepted');
  return { delta: after - before };
}

/** « C'est un autre » : le signalement devient un épisode à part entière. */
export function splitReport(store: Store, ctx: Ctx, input: { reportId: string }): ActionResult {
  const { report: row, actor } = requireOwnReport(store, ctx, input.reportId);
  if (row.cancelledAt !== null) fail('invalid', 'Ce signalement a été annulé.');
  const episode = requireEpisode(store, row.episodeId);
  if (episode.kind !== 'live' || episode.voidedAt !== null) fail('invalid', 'Ce point ne peut pas être séparé.');
  const others = store.reportsOf(episode.id).filter((r) => r.id !== row.id && r.cancelledAt === null);
  if (others.length === 0) fail('invalid', 'Ce signalement compte déjà comme un gros mot à part.');

  const before = episodePoints(store, episode);
  const fresh: Episode = {
    id: newId(ctx),
    targetId: episode.targetId,
    kind: 'live',
    startedAt: row.occurredAt,
    note: null,
    createdAt: ctx.now,
    createdBy: actor.id,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    voidNote: null,
  };
  store.putEpisode(fresh);
  store.putReport({ ...row, episodeId: fresh.id, link: 'split' });
  refreshStart(store, episode.id);
  const after = episodePoints(store, requireEpisode(store, episode.id)) + episodePoints(store, fresh);
  store.log({ at: ctx.now, actorId: actor.id, action: 'split', data: { reportId: row.id, from: episode.id, to: fresh.id } });
  if (after > before) {
    store.emit({ type: 'point', targetId: episode.targetId, reporterId: row.reporterId, delta: after - before, episodeId: fresh.id, word: row.word });
  }
  return { delta: after - before };
}

/** « C'est le même » : rattache le signalement à un autre épisode de la même personne. */
export function mergeReport(store: Store, ctx: Ctx, input: { reportId: string; episodeId: string }): ActionResult {
  const { report: row, actor } = requireOwnReport(store, ctx, input.reportId);
  if (row.cancelledAt !== null) fail('invalid', 'Ce signalement a été annulé.');
  const source = requireEpisode(store, row.episodeId);
  const dest = requireEpisode(store, input.episodeId);
  if (dest.id === source.id) return { delta: 0 };
  if (dest.targetId !== row.targetId) fail('invalid', 'Ce point ne vise pas la même personne.');
  if (dest.kind !== 'live' || dest.voidedAt !== null || source.kind !== 'live') fail('invalid', 'Ces points ne peuvent pas être regroupés.');
  if (Math.abs(row.occurredAt - dest.startedAt) > LIMITS.manualMergeMaxMs) fail('invalid', 'Ces deux points sont trop éloignés dans le temps.');

  const before = episodePoints(store, source) + episodePoints(store, dest);
  store.putReport({ ...row, episodeId: dest.id, link: 'merged' });
  refreshStart(store, dest.id);
  if (store.reportsOf(source.id).length === 0) {
    store.putEpisode({ ...source, voidedAt: ctx.now, voidedBy: actor.id, voidReason: 'merged', voidNote: null });
  } else {
    refreshStart(store, source.id);
  }
  const after = episodePoints(store, requireEpisode(store, source.id)) + episodePoints(store, requireEpisode(store, dest.id));
  store.log({ at: ctx.now, actorId: actor.id, action: 'merge', data: { reportId: row.id, from: source.id, to: dest.id } });

  const contest = openContestOf(store, source.id);
  if (contest && episodePoints(store, requireEpisode(store, source.id)) === 0) resolveContest(store, contest, ctx.now, 'accepted');
  return { delta: after - before };
}

/** Précise (ou efface) le mot prononcé. */
export function setWord(store: Store, ctx: Ctx, input: { reportId: string; word: string | null }): ActionResult {
  const { report: row, actor } = requireOwnReport(store, ctx, input.reportId);
  const word = normalizeWord(input.word);
  if (word === row.word) return { delta: 0 };
  store.putReport({ ...row, word });
  store.log({ at: ctx.now, actorId: actor.id, action: 'word', data: { reportId: row.id, word } });
  return { delta: 0 };
}

// ---------------------------------------------------------------------------
// Contester et voter

export function openContest(store: Store, ctx: Ctx, input: { episodeId: string; reason?: string | null }): Contest {
  const actor = requireActor(store, ctx);
  const episode = requireEpisode(store, input.episodeId);
  if (episode.targetId !== actor.id) fail('forbidden', 'Seule la personne visée peut contester ce point.');
  if (episode.voidedAt !== null || episodePoints(store, episode) === 0) fail('invalid', 'Ce point ne compte déjà plus.');
  if (ctx.now - episode.startedAt > store.settings.contestWindowMs) {
    fail('expired', `Le délai pour contester (${Math.round(store.settings.contestWindowMs / 3_600_000)} h) est dépassé.`);
  }
  const previous = store.contestsOf(episode.id);
  if (previous.some((c) => c.status === 'open')) fail('conflict', 'Une contestation est déjà en cours.');
  if (previous.some((c) => c.status === 'accepted' || c.status === 'rejected')) fail('conflict', 'Ce point a déjà été jugé.');

  const contest: Contest = {
    id: newId(ctx),
    episodeId: episode.id,
    openedBy: actor.id,
    openedAt: ctx.now,
    reason: cleanText(input.reason, LIMITS.reasonMax),
    deadline: ctx.now + store.settings.voteDurationMs,
    votes: {},
    status: 'open',
    resolvedAt: null,
  };
  const voters = eligibleVoters(store, contest);
  if (voters.length === 0) fail('invalid', "Personne d'autre ne peut voter.");
  store.putContest(contest);
  store.log({ at: ctx.now, actorId: actor.id, action: 'contest', data: { contestId: contest.id, episodeId: episode.id } });
  store.emit({ type: 'contest-opened', contestId: contest.id, episodeId: episode.id, openedBy: actor.id, voters });
  return contest;
}

export function vote(store: Store, ctx: Ctx, input: { contestId: string; choice: VoteChoice }): Contest {
  const actor = requireActor(store, ctx);
  const contest = store.contests.get(input.contestId);
  if (!contest) fail('not_found', 'Contestation introuvable.');
  if (contest.status !== 'open') fail('conflict', 'Le vote est terminé.');
  if (input.choice !== 'valid' && input.choice !== 'invalid') fail('invalid', 'Vote invalide.');
  if (!eligibleVoters(store, contest).includes(actor.id)) fail('forbidden', 'Tu ne peux pas voter sur ce point.');

  const updated: Contest = { ...contest, votes: { ...contest.votes, [actor.id]: input.choice } };
  store.putContest(updated);
  store.log({ at: ctx.now, actorId: actor.id, action: 'vote', data: { contestId: contest.id, choice: input.choice } });
  return evaluateContest(store, updated, ctx.now, false);
}

export function withdrawContest(store: Store, ctx: Ctx, input: { contestId: string }): Contest {
  const actor = requireActor(store, ctx);
  const contest = store.contests.get(input.contestId);
  if (!contest) fail('not_found', 'Contestation introuvable.');
  if (contest.openedBy !== actor.id) fail('forbidden', 'Seule la personne qui conteste peut retirer sa contestation.');
  if (contest.status !== 'open') fail('conflict', 'Le vote est déjà terminé.');
  return resolveContest(store, contest, ctx.now, 'withdrawn', actor.id);
}

/**
 * Majorité des votants appelés (2 sur 3 à quatre joueurs). À l'échéance, on regarde les
 * votes exprimés ; en cas d'égalité ou sans vote, le point reste.
 */
export function evaluateContest(store: Store, contest: Contest, now: Millis, final: boolean): Contest {
  const voters = eligibleVoters(store, contest);
  const threshold = Math.floor(voters.length / 2) + 1;
  let valid = 0;
  let invalid = 0;
  for (const id of voters) {
    const choice = contest.votes[id];
    if (choice === 'valid') valid += 1;
    else if (choice === 'invalid') invalid += 1;
  }
  if (invalid >= threshold) return resolveContest(store, contest, now, 'accepted');
  if (valid >= threshold) return resolveContest(store, contest, now, 'rejected');
  if (final) return resolveContest(store, contest, now, invalid > valid ? 'accepted' : 'rejected');
  return contest;
}

function resolveContest(store: Store, contest: Contest, now: Millis, status: ContestStatus, actorId: PlayerId | null = null): Contest {
  const resolved: Contest = { ...contest, status, resolvedAt: now };
  store.putContest(resolved);
  if (status === 'accepted') {
    const episode = store.episodes.get(contest.episodeId);
    if (episode && episode.voidedAt === null) {
      store.putEpisode({ ...episode, voidedAt: now, voidedBy: null, voidReason: 'contest', voidNote: null });
    }
  }
  store.log({ at: now, actorId, action: 'contest-resolved', data: { contestId: contest.id, status } });
  store.emit({ type: 'contest-resolved', contestId: contest.id, episodeId: contest.episodeId, status, openedBy: contest.openedBy });
  return resolved;
}

/** Clôt les votes arrivés à échéance. À appeler régulièrement. */
export function resolveDueContests(store: Store, now: Millis): number {
  let resolved = 0;
  for (const contest of [...store.contests.values()]) {
    if (contest.status === 'open' && contest.deadline <= now) {
      evaluateContest(store, contest, now, true);
      resolved += 1;
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Administration

export function voidEpisode(store: Store, ctx: Ctx, input: { episodeId: string; note?: string | null }): ActionResult {
  const actor = requireAdmin(store, ctx);
  const episode = requireEpisode(store, input.episodeId);
  if (episode.voidedAt !== null) return { delta: 0 };
  const before = episodePoints(store, episode);
  store.putEpisode({ ...episode, voidedAt: ctx.now, voidedBy: actor.id, voidReason: 'admin', voidNote: cleanText(input.note, LIMITS.reasonMax) });
  const contest = openContestOf(store, episode.id);
  if (contest) resolveContest(store, contest, ctx.now, 'accepted', actor.id);
  store.log({ at: ctx.now, actorId: actor.id, action: 'void', data: { episodeId: episode.id, note: input.note ?? null } });
  return { delta: -before };
}

export function restoreEpisode(store: Store, ctx: Ctx, input: { episodeId: string }): ActionResult {
  const actor = requireAdmin(store, ctx);
  const episode = requireEpisode(store, input.episodeId);
  if (episode.voidReason !== 'admin') fail('invalid', "Seul un point annulé par l'admin peut être rétabli.");
  store.putEpisode({ ...episode, voidedAt: null, voidedBy: null, voidReason: null, voidNote: null });
  store.log({ at: ctx.now, actorId: actor.id, action: 'restore', data: { episodeId: episode.id } });
  return { delta: episodePoints(store, requireEpisode(store, episode.id)) };
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,23}$/;

function requireHue(color: string): string {
  if (!(PLAYER_HUES as readonly string[]).includes(color)) fail('invalid', 'Couleur inconnue.');
  return color;
}

function requireName(name: string): string {
  const clean = cleanText(name, LIMITS.nameMax);
  if (!clean) fail('invalid', 'Le prénom est obligatoire.');
  return clean;
}

export function addPlayer(store: Store, ctx: Ctx, input: { id: string; name: string; color: string }): Player {
  const actor = requireAdmin(store, ctx);
  if (!SLUG.test(input.id)) fail('invalid', 'Identifiant invalide (lettres minuscules, chiffres et tirets).');
  if (store.players.has(input.id)) fail('conflict', 'Ce joueur existe déjà.');
  const position = Math.max(-1, ...[...store.players.values()].map((p) => p.position)) + 1;
  const player: Player = {
    id: input.id,
    name: requireName(input.name),
    color: requireHue(input.color),
    isAdmin: false,
    position,
    archivedAt: null,
    createdAt: ctx.now,
  };
  store.putPlayer(player);
  store.log({ at: ctx.now, actorId: actor.id, action: 'player-add', data: { playerId: player.id } });
  return player;
}

export function updatePlayer(
  store: Store,
  ctx: Ctx,
  input: { id: string; name?: string; color?: string; isAdmin?: boolean; archived?: boolean },
): Player {
  const actor = requireAdmin(store, ctx);
  const player = store.players.get(input.id);
  if (!player) fail('not_found', 'Joueur introuvable.');
  const next: Player = { ...player };
  if (input.name !== undefined) next.name = requireName(input.name);
  if (input.color !== undefined) next.color = requireHue(input.color);
  if (input.isAdmin !== undefined) next.isAdmin = input.isAdmin;
  if (input.archived !== undefined) next.archivedAt = input.archived ? (player.archivedAt ?? ctx.now) : null;
  if (player.id === actor.id && (!next.isAdmin || next.archivedAt !== null)) {
    fail('invalid', 'Tu ne peux pas retirer tes propres droits ni archiver ton compte.');
  }
  store.putPlayer(next);
  store.log({ at: ctx.now, actorId: actor.id, action: 'player-update', data: { playerId: player.id, ...input } });
  return next;
}

type EditableSettings = Omit<Settings, 'challengeStartedAt' | 'timeZone'>;

export function updateSettings(store: Store, ctx: Ctx, input: Partial<EditableSettings>): Settings {
  const actor = requireAdmin(store, ctx);
  const s = store.settings;
  const next: Settings = { ...s };
  const ms = (value: number | undefined, min: number, max: number, label: string) =>
    value === undefined ? undefined : requireInt(value, min, max, `${label} hors limites.`);

  next.mergeWindowMs = ms(input.mergeWindowMs, 5_000, 120_000, 'Fenêtre de fusion') ?? s.mergeWindowMs;
  next.suggestWindowMs = ms(input.suggestWindowMs, 10_000, 600_000, 'Fenêtre de proposition') ?? s.suggestWindowMs;
  next.contestWindowMs = ms(input.contestWindowMs, 3_600_000, 14 * 86_400_000, 'Délai de contestation') ?? s.contestWindowMs;
  next.voteDurationMs = ms(input.voteDurationMs, 3_600_000, 7 * 86_400_000, 'Durée du vote') ?? s.voteDurationMs;
  next.pricePerPointCents = ms(input.pricePerPointCents, 0, 10_000, 'Prix du point') ?? s.pricePerPointCents;
  if (input.forfeit !== undefined) next.forfeit = cleanText(input.forfeit, LIMITS.forfeitMax) ?? '';
  if (input.rules !== undefined) next.rules = input.rules.trim().slice(0, LIMITS.rulesMax);
  if (next.suggestWindowMs < next.mergeWindowMs) next.suggestWindowMs = next.mergeWindowMs;

  store.putSettings(next);
  store.log({ at: ctx.now, actorId: actor.id, action: 'settings', data: { ...input } });
  return next;
}

export function currentSeason(store: Store, now: Millis): Season | null {
  let current: Season | null = null;
  for (const s of store.seasons.values()) {
    if (s.startsAt <= now && (s.endsAt === null || s.endsAt > now) && (!current || s.startsAt > current.startsAt)) current = s;
  }
  return current;
}

function closeCurrentSeason(store: Store, now: Millis): void {
  const current = currentSeason(store, now);
  if (!current) return;
  store.putSeason({ ...current, endsAt: now });
  store.emit({ type: 'season-ended', seasonId: current.id });
}

function seasonName(store: Store, name: string | null | undefined): string {
  return cleanText(name, LIMITS.seasonNameMax) ?? `Saison ${store.seasons.size + 1}`;
}

/** Lancement officiel : les points de la phase de test ne comptent plus, la saison 1 démarre. */
export function launchChallenge(store: Store, ctx: Ctx, input: { seasonName?: string | null }): Season {
  const actor = requireAdmin(store, ctx);
  if (store.settings.challengeStartedAt !== null) fail('conflict', 'Le défi est déjà lancé : ouvre plutôt une nouvelle saison.');
  const name = seasonName(store, input.seasonName);
  store.putSettings({ ...store.settings, challengeStartedAt: ctx.now });
  const season: Season = { id: newId(ctx), name, startsAt: ctx.now, endsAt: null };
  store.putSeason(season);
  store.log({ at: ctx.now, actorId: actor.id, action: 'launch', data: { seasonId: season.id } });
  return season;
}

export function startSeason(store: Store, ctx: Ctx, input: { name?: string | null }): Season {
  const actor = requireAdmin(store, ctx);
  if (store.settings.challengeStartedAt === null) fail('invalid', "Lance d'abord le défi officiellement.");
  const name = seasonName(store, input.name);
  closeCurrentSeason(store, ctx.now);
  const season: Season = { id: newId(ctx), name, startsAt: ctx.now, endsAt: null };
  store.putSeason(season);
  store.log({ at: ctx.now, actorId: actor.id, action: 'season', data: { seasonId: season.id } });
  return season;
}

export function renameSeason(store: Store, ctx: Ctx, input: { id: string; name: string }): Season {
  const actor = requireAdmin(store, ctx);
  const season = store.seasons.get(input.id);
  if (!season) fail('not_found', 'Saison introuvable.');
  const name = cleanText(input.name, LIMITS.seasonNameMax);
  if (!name) fail('invalid', 'Le nom de la saison est obligatoire.');
  const next = { ...season, name };
  store.putSeason(next);
  store.log({ at: ctx.now, actorId: actor.id, action: 'season-rename', data: { seasonId: season.id, name } });
  return next;
}
