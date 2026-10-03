// État de l'app côté téléphone : l'état reçu du serveur, les taps et les annulations pas
// encore confirmés (affichés tout de suite, et gardés si le réseau manque), les bandeaux.

import { CLOCK } from '../../core/defaults';
import { listing } from '../../core/french';
import { activeReporters, boundariesOf, decideMerge, pointsOf, type EpisodeLike, type ReportLike } from '../../core/merge';
import { addToTotals, periodBounds } from '../../core/periods';
import type { EpisodeView, LastPoint, Player, ReportOutcome, ReportResult, ReportView, Snapshot } from '../../core/types';
import { ApiError, type LinkStatus, type Me, type Transport } from './api';
import { ago } from './format';
import { haptic } from './haptics';
import { setBadge } from './pwa';
import { router } from './router.svelte';
import { applyTheme, readLocal, writeLocal, type ThemeChoice } from './storage';

export interface PendingTap {
  id: string;
  playerId: string;
  targetId: string;
  occurredAt: number;
  count: number;
  word: string | null;
  state: 'sending' | 'queued' | 'acked';
  ackVersion: number | null;
  /** Annulé avant confirmation : n'est plus affiché ni renvoyé (l'annulation suit dans `cancels`). */
  cancel?: boolean;
}

/** Une annulation (« Annuler », « Retirer »), gardée jusqu'à ce que le serveur l'ait prise en compte. */
export interface PendingCancel {
  reportId: string;
  playerId: string;
  state: 'sending' | 'queued' | 'acked';
  ackVersion: number | null;
}

export interface ToastAction {
  label: string;
  primary?: boolean;
  run: () => void | Promise<unknown>;
}

export interface Toast {
  id: number;
  key: string | null;
  tone: 'point' | 'confirm' | 'info' | 'error' | 'offline';
  title: string;
  detail?: string;
  actions: ToastAction[];
  duration: number;
  shownAt: number;
}

export type Sheet =
  | { kind: 'word'; reportId: string; targetId: string }
  | { kind: 'tile'; targetId: string }
  | { kind: 'episode'; episodeId: string };

type Prediction = Pick<ReportResult, 'outcome' | 'otherReporterIds' | 'episodeAgeMs' | 'suggestion'>;

/** Durée du bandeau « Annuler » après un tap. */
const UNDO_MS = 10_000;
/** Une case ignore un second tap aussi rapproché (double tap involontaire). */
const TILE_LOCK_MS = 300;

const like = (r: ReportView): ReportLike => ({ reporterId: r.reporterId, count: r.count, cancelled: r.cancelledAt !== null });

function toLike(e: EpisodeView): EpisodeLike {
  return {
    id: e.id,
    targetId: e.targetId,
    kind: e.kind,
    startedAt: e.startedAt,
    voided: e.voided,
    frozen: !!e.contest && e.contest.status !== 'withdrawn',
    reports: e.reports.map(like),
  };
}

function isAcknowledged(tap: PendingTap, snap: Snapshot): boolean {
  if (tap.ackVersion !== null && snap.version >= tap.ackVersion) return true;
  return snap.recent.some((e) => e.reports.some((r) => r.id === tap.id));
}

function isCancelAcknowledged(c: PendingCancel, snap: Snapshot): boolean {
  if (c.ackVersion !== null && snap.version >= c.ackVersion) return true;
  return snap.recent.some((e) => e.reports.some((r) => r.id === c.reportId && r.cancelledAt !== null));
}

/** Erreur passagère (pas de réseau, serveur indisponible) : on réessaiera. */
function retryable(error: unknown): boolean {
  return error instanceof ApiError && (error.offline || error.status >= 500);
}

function boundaries(view: Snapshot): number[] {
  return boundariesOf(view.settings.challengeStartedAt, view.seasons);
}

/** « il y a 4 s · par Alexis » : le signalement encore actif le plus récent d'un épisode. */
function lastOf(e: EpisodeView): LastPoint | null {
  const active = e.reports.filter((r) => r.cancelledAt === null);
  if (e.voided || e.points === 0 || active.length === 0) return null;
  return { at: Math.max(...active.map((r) => r.occurredAt)), episodeId: e.id, reporterIds: activeReporters(active.map(like)) };
}

/** Ce que le serveur va répondre, calculé avec la même règle que lui. */
function predict(view: Snapshot, tap: PendingTap): Prediction {
  const d = decideMerge(
    view.recent.map(toLike),
    { targetId: tap.targetId, reporterId: tap.playerId, occurredAt: tap.occurredAt, count: tap.count },
    view.settings,
    boundaries(view),
  );
  if (d.kind === 'merge') {
    const outcome: ReportOutcome = d.after > d.before ? 'increment' : 'confirm';
    return {
      outcome,
      otherReporterIds: activeReporters(d.episode.reports).filter((id) => id !== tap.playerId),
      episodeAgeMs: Math.max(0, tap.occurredAt - d.episode.startedAt),
      suggestion: null,
    };
  }
  return {
    outcome: 'new',
    otherReporterIds: [],
    episodeAgeMs: 0,
    suggestion: d.suggestion
      ? { episodeId: d.suggestion.id, reporterIds: activeReporters(d.suggestion.reports), ageMs: Math.abs(tap.occurredAt - d.suggestion.startedAt) }
      : null,
  };
}

/** L'état du serveur + ce que ce téléphone a fait sans confirmation, pour un affichage instantané. */
export function applyPending(snap: Snapshot | null, pending: PendingTap[], cancels: PendingCancel[] = []): Snapshot | null {
  if (!snap) return null;
  const taps = pending.filter((p) => !p.cancel && !isAcknowledged(p, snap));
  const undo = cancels.filter((c) => !isCancelAcknowledged(c, snap));
  if (taps.length === 0 && undo.length === 0) return snap;
  const totals = structuredClone(snap.totals);
  const last = { ...snap.last };
  const recent: EpisodeView[] = snap.recent.map((e) => ({ ...e, reports: [...e.reports] }));
  const b = periodBounds(snap.settings, snap.seasons.find((s) => s.id === snap.currentSeasonId) ?? null, snap.now);
  const limits = boundaries(snap);

  for (const tap of taps) {
    const d = decideMerge(recent.map(toLike), { targetId: tap.targetId, reporterId: tap.playerId, occurredAt: tap.occurredAt, count: tap.count }, snap.settings, limits);
    const report: ReportView = {
      id: tap.id,
      reporterId: tap.playerId,
      count: tap.count,
      occurredAt: tap.occurredAt,
      word: tap.word,
      link: d.kind === 'merge' ? 'auto' : 'new',
      cancelledAt: null,
      cancelledBy: null,
    };
    let delta: number;
    let episode: EpisodeView;
    if (d.kind === 'merge') {
      episode = recent.find((e) => e.id === d.episode.id) ?? recent[0]!;
      episode.reports.push(report);
      episode.points = d.after;
      delta = d.after - d.before;
    } else {
      episode = {
        id: `pending-${tap.id}`,
        targetId: tap.targetId,
        kind: 'live',
        startedAt: tap.occurredAt,
        createdAt: tap.occurredAt,
        points: tap.count,
        voided: false,
        voidReason: null,
        voidNote: null,
        note: null,
        word: tap.word,
        reports: [report],
        contest: null,
      };
      recent.unshift(episode);
      delta = tap.count;
    }
    const t = totals[tap.targetId];
    if (t && delta > 0) addToTotals(t, b, episode.startedAt, delta);
    if (tap.occurredAt >= (last[tap.targetId]?.at ?? Number.NEGATIVE_INFINITY)) {
      last[tap.targetId] = { at: tap.occurredAt, episodeId: episode.id, reporterIds: activeReporters(episode.reports.map(like)) };
    }
  }

  for (const c of undo) {
    const episode = recent.find((e) => e.reports.some((r) => r.id === c.reportId && r.cancelledAt === null));
    if (!episode) continue;
    const before = episode.voided ? 0 : episode.points;
    episode.reports = episode.reports.map((r) => (r.id === c.reportId ? { ...r, cancelledAt: snap.now, cancelledBy: c.playerId } : r));
    episode.points = episode.voided ? 0 : pointsOf(episode.reports.map(like));
    const t = totals[episode.targetId];
    if (t && episode.points !== before) addToTotals(t, b, episode.startedAt, episode.points - before);
    if (last[episode.targetId]?.episodeId === episode.id) {
      const candidates = [episode, ...recent.filter((e) => e.targetId === episode.targetId && e.id !== episode.id)].map(lastOf);
      const replacement = candidates.filter((l): l is LastPoint => l !== null).sort((x, y) => y.at - x.at)[0];
      // Sans remplaçant dans les épisodes récents, l'état du serveur corrigera dans un instant.
      if (replacement) last[episode.targetId] = replacement;
    }
  }
  return { ...snap, totals, last, recent };
}

class AppState {
  transport!: Transport;
  phase = $state<'boot' | 'auth' | 'app' | 'public'>('boot');
  me = $state<Me | null>(null);
  snapshot = $state.raw<Snapshot | null>(null);
  link = $state<LinkStatus>('connecting');
  pending = $state<PendingTap[]>([]);
  cancels = $state<PendingCancel[]>([]);
  toast = $state<Toast | null>(null);
  sheet = $state<Sheet | null>(null);
  clock = $state(Date.now());
  theme = $state<ThemeChoice>(readLocal<ThemeChoice>('gm.theme', 'auto'));
  reveal = $state<boolean>(readLocal('gm.reveal', false));

  view = $derived(applyPending(this.snapshot, this.pending, this.cancels));
  /** Taps et annulations qui attendent le retour du réseau (« 2 en attente »). */
  waiting = $derived(this.pending.filter((p) => p.state === 'queued' && !p.cancel).length + this.cancels.filter((c) => c.state === 'queued').length);
  /** Contestations où j'ai un vote à donner. */
  pendingVotes = $derived.by(() => {
    const me = this.me?.player.id;
    const view = this.view;
    if (!me || !view) return [];
    return view.contests.filter((c) => c.status === 'open' && c.voters.includes(me) && !c.votes[me]);
  });

  private offset = 0;
  private disconnect: (() => void) | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private toastSeq = 0;
  private sending = new Map<string, Promise<void>>();
  private flushing: Promise<void> | null = null;
  private flushAgain = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTileTap = new Map<string, number>();
  private lastCache = 0;

  // --- Démarrage -----------------------------------------------------------------

  async boot(transport: Transport): Promise<void> {
    this.transport = transport;
    // Dans la démo publiée, la page hôte choisit le thème : on ne le touche que sur demande.
    if (!__DEMO__ || this.theme !== 'auto') applyTheme(this.theme);
    setInterval(() => {
      this.clock = Date.now();
    }, 1000);
    window.addEventListener('online', () => void this.flush());
    $effect.root(() => {
      $effect(() => setBadge(this.pendingVotes.length));
    });
    const route = router.route;
    if (route.name === 'invite' || route.name === 'spectator') {
      this.phase = 'public';
      return;
    }
    await this.loadMe();
  }

  async loadMe(): Promise<void> {
    try {
      const me = await this.transport.me();
      if (me) {
        this.me = me;
        writeLocal('gm.me', me);
        this.enterApp();
      } else {
        this.leaveApp();
      }
    } catch {
      // Pas de réseau : on ouvre quand même avec les dernières données connues.
      const cached = readLocal<Me | null>('gm.me', null);
      if (cached) {
        this.me = cached;
        this.snapshot = readLocal<Snapshot | null>('gm.snapshot', null);
        this.enterApp();
      } else {
        this.phase = 'auth';
      }
    }
  }

  enterApp(): void {
    const me = this.me;
    if (!me) return;
    this.phase = 'app';
    // Ce qui n'avait pas été confirmé avant la fermeture de l'app repart.
    this.pending = readLocal<PendingTap[]>(this.queueKey(), []).map((p) => (p.state === 'acked' ? p : { ...p, state: 'queued' }));
    this.cancels = readLocal<PendingCancel[]>(this.cancelKey(), []).map((c) => (c.state === 'acked' ? c : { ...c, state: 'queued' }));
    this.disconnect?.();
    this.disconnect = this.transport.connect({
      snapshot: (s) => this.onSnapshot(s),
      status: (status) => {
        this.link = status;
        if (status === 'live') void this.flush();
      },
      unauthorized: () => this.leaveApp(),
    });
    const route = router.route;
    if (route.name === 'login' || route.name === 'invite') router.go({ name: 'counter' }, true);
  }

  leaveApp(): void {
    // La file reste enregistrée pour ce joueur : elle repartira à sa prochaine connexion.
    this.persistQueue();
    this.disconnect?.();
    this.disconnect = null;
    this.me = null;
    this.snapshot = null;
    this.pending = [];
    this.cancels = [];
    writeLocal('gm.me', null);
    this.phase = 'auth';
  }

  async logout(): Promise<void> {
    await this.transport.logout().catch(() => undefined);
    this.leaveApp();
    router.go({ name: 'counter' }, true);
  }

  private onSnapshot(s: Snapshot): void {
    this.offset = s.now - Date.now();
    const pending = this.pending.filter((p) => !isAcknowledged(p, s));
    const cancels = this.cancels.filter((c) => !isCancelAcknowledged(c, s));
    const changed = pending.length !== this.pending.length || cancels.length !== this.cancels.length;
    if (changed) {
      this.pending = pending;
      this.cancels = cancels;
    }
    this.snapshot = s;
    if (changed) this.persistQueue();
    if (Date.now() - this.lastCache > 10_000) {
      this.lastCache = Date.now();
      writeLocal('gm.snapshot', s);
    }
  }

  // --- Aides ---------------------------------------------------------------------

  /** Heure du serveur (le téléphone peut être un peu décalé). */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  get now(): number {
    return this.clock + this.offset;
  }

  player(id: string): Player | undefined {
    return this.view?.players.find((p) => p.id === id);
  }

  name(id: string): string {
    return this.player(id)?.name ?? '?';
  }

  get meId(): string | null {
    return this.me?.player.id ?? null;
  }

  private queueKey(): string {
    return `gm.queue.${this.me?.player.id ?? 'personne'}`;
  }

  private cancelKey(): string {
    return `gm.cancels.${this.me?.player.id ?? 'personne'}`;
  }

  private persistQueue(): void {
    if (!this.me) return;
    writeLocal(
      this.queueKey(),
      this.pending.filter((p) => p.state !== 'acked'),
    );
    writeLocal(
      this.cancelKey(),
      this.cancels.filter((c) => c.state !== 'acked'),
    );
  }

  private patchPending(id: string, patch: Partial<PendingTap>): void {
    this.pending = this.pending.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }

  private removePending(id: string): void {
    this.pending = this.pending.filter((p) => p.id !== id);
  }

  private patchCancel(reportId: string, patch: Partial<PendingCancel>): void {
    this.cancels = this.cancels.map((c) => (c.reportId === reportId ? { ...c, ...patch } : c));
  }

  private removeCancel(reportId: string): void {
    this.cancels = this.cancels.filter((c) => c.reportId !== reportId);
  }

  setTheme(choice: ThemeChoice): void {
    this.theme = choice;
    writeLocal('gm.theme', choice);
    applyTheme(choice);
  }

  setReveal(value: boolean): void {
    this.reveal = value;
    writeLocal('gm.reveal', value);
  }

  // --- Bandeaux ------------------------------------------------------------------

  showToast(toast: Omit<Toast, 'id' | 'shownAt'>): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    const id = ++this.toastSeq;
    this.toast = { ...toast, id, shownAt: Date.now() };
    this.toastTimer = setTimeout(() => {
      if (this.toast?.id === id) this.toast = null;
    }, toast.duration);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = null;
  }

  info(title: string, detail?: string): void {
    this.showToast({ key: null, tone: 'info', title, detail, actions: [], duration: 3500 });
  }

  error(error: unknown): void {
    const message = error instanceof ApiError || error instanceof Error ? error.message : 'Une erreur est survenue.';
    if (error instanceof ApiError && error.code === 'cancelled') return;
    this.showToast({ key: null, tone: 'error', title: message, actions: [], duration: 5000 });
  }

  /** Exécute une action et affiche l'erreur éventuelle. */
  async act<T>(fn: () => Promise<T>, success?: (result: T) => string | null): Promise<T | null> {
    try {
      const result = await fn();
      const message = success?.(result);
      if (message) this.info(message);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) this.leaveApp();
      this.error(error);
      return null;
    }
  }

  // --- Compter ---------------------------------------------------------------------

  tap(targetId: string, count = 1): void {
    const me = this.me;
    const view = this.view;
    if (!me || !view) return;
    if (count === 1) {
      // Double tap involontaire : la case ignore un second tap dans les 0,3 s.
      const at = performance.now();
      if (at - (this.lastTileTap.get(targetId) ?? Number.NEGATIVE_INFINITY) < TILE_LOCK_MS) return;
      this.lastTileTap.set(targetId, at);
    }
    haptic();
    const tap: PendingTap = {
      id: crypto.randomUUID(),
      playerId: me.player.id,
      targetId,
      occurredAt: this.serverNow(),
      count,
      word: null,
      state: 'sending',
      ackVersion: null,
    };
    const prediction = predict(view, tap);
    this.pending = [...this.pending, tap];
    this.persistQueue();
    this.tapToast(tap, prediction);
    void this.send(tap);
  }

  private send(tap: PendingTap): Promise<void> {
    const job = (async () => {
      try {
        const result = await this.transport.report({ id: tap.id, targetId: tap.targetId, occurredAt: tap.occurredAt, count: tap.count, word: tap.word });
        this.patchPending(tap.id, { state: 'acked', ackVersion: result.version });
        const cancelled = this.pending.find((p) => p.id === tap.id)?.cancel === true || this.cancels.some((c) => c.reportId === tap.id);
        if (!cancelled && result.outcome !== 'duplicate' && this.toast?.key === tap.id) this.tapToast(tap, result, true);
      } catch (error) {
        const cancelled = this.pending.find((p) => p.id === tap.id)?.cancel === true;
        if (retryable(error)) {
          this.patchPending(tap.id, { state: 'queued' });
          if (!cancelled && this.toast?.key === tap.id) this.offlineToast(tap, error instanceof ApiError && error.status > 0);
        } else if (error instanceof ApiError && error.status === 401) {
          this.patchPending(tap.id, { state: 'queued' });
          this.leaveApp();
        } else if (error instanceof ApiError && error.code === 'rate_limited' && tap.occurredAt < this.serverNow() - CLOCK.maxPastMs + 60_000) {
          // Tap de plus de 24 h (longue coupure) : le serveur le date d'aujourd'hui, et il en arrive
          // trop d'un coup. On l'enverra un peu plus tard plutôt que de le perdre.
          this.patchPending(tap.id, { state: 'queued' });
          this.retryLater(11_000);
        } else {
          this.removePending(tap.id);
          if (!cancelled) this.error(error);
        }
      } finally {
        this.persistQueue();
        this.sending.delete(tap.id);
        // Une annulation attendait la réponse de ce tap : elle peut partir.
        if (this.cancels.some((c) => c.reportId === tap.id && c.state === 'queued')) void this.flush();
      }
    })();
    this.sending.set(tap.id, job);
    return job;
  }

  private retryLater(ms: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, ms);
  }

  /**
   * Renvoie ce qui attend le réseau : d'abord les annulations (un tap annulé ne doit jamais
   * partir), puis les taps, dans l'ordre. Un seul envoi à la fois.
   */
  flush(): Promise<void> {
    this.flushAgain = true;
    if (!this.flushing) {
      this.flushing = (async () => {
        while (this.flushAgain && this.me) {
          this.flushAgain = false;
          if (!(await this.sendCancels())) break;
          if (!(await this.sendQueuedTaps())) break;
        }
      })().finally(() => {
        this.flushing = null;
      });
    }
    return this.flushing;
  }

  /** Renvoie faux si le réseau manque encore. */
  private async sendQueuedTaps(): Promise<boolean> {
    for (;;) {
      // Relu à chaque tour : un tap annulé ou complété pendant l'envoi précédent est pris en compte.
      const next = this.pending.find((p) => p.state === 'queued' && !p.cancel && !this.sending.has(p.id));
      if (!next) return true;
      this.patchPending(next.id, { state: 'sending' });
      await this.send(next);
      if (this.pending.find((p) => p.id === next.id)?.state === 'queued') return false;
    }
  }

  /** Renvoie faux si le réseau manque encore. */
  private async sendCancels(): Promise<boolean> {
    for (;;) {
      // Un tap encore en route sera annulé dès sa réponse (voir `send`) : on ne l'attend pas ici,
      // pour que les autres annulations partent sans délai.
      const job = this.cancels.find((c) => c.state === 'queued' && !this.sending.has(c.reportId));
      if (!job) return true;
      this.patchCancel(job.reportId, { state: 'sending' });
      try {
        const result = await this.transport.cancel(job.reportId);
        this.patchCancel(job.reportId, { state: 'acked', ackVersion: result.version });
        this.removePending(job.reportId);
      } catch (error) {
        if (retryable(error)) {
          this.patchCancel(job.reportId, { state: 'queued' });
          return false;
        }
        if (error instanceof ApiError && error.status === 401) {
          this.patchCancel(job.reportId, { state: 'queued' });
          this.leaveApp();
          return false;
        }
        // Introuvable : le tap n'était jamais arrivé au serveur. Sinon (refus), rien à refaire.
        this.removeCancel(job.reportId);
        this.removePending(job.reportId);
        if (!(error instanceof ApiError && error.code === 'not_found')) this.error(error);
      } finally {
        this.persistQueue();
      }
    }
  }

  private async whenSent(reportId: string): Promise<boolean> {
    await this.sending.get(reportId);
    const tap = this.pending.find((p) => p.id === reportId);
    return !tap || tap.state === 'acked';
  }

  private tapToast(tap: PendingTap, result: Prediction, keepTimer = false): void {
    const name = this.name(tap.targetId);
    const undo: ToastAction = { label: 'Annuler', run: () => this.cancelTap(tap.id) };
    let toast: Omit<Toast, 'id' | 'shownAt'>;
    if (result.outcome === 'confirm') {
      const others = listing(result.otherReporterIds.map((id) => this.name(id)));
      toast = {
        key: tap.id,
        tone: 'confirm',
        title: `Déjà compté par ${others}`,
        detail: `${ago(this.serverNow() - result.episodeAgeMs, this.serverNow()).replace(/^il y a/, 'Il y a').replace("à l'instant", "À l'instant")}. Ton signalement confirme le point.`,
        actions: [{ label: "C'est un autre", primary: true, run: () => this.splitTap(tap.id) }, undo],
        duration: UNDO_MS,
      };
    } else if (result.suggestion) {
      const suggestion = result.suggestion;
      const who = listing(suggestion.reporterIds.map((id) => this.name(id)));
      toast = {
        key: tap.id,
        tone: 'point',
        title: `+${tap.count} ${name}`,
        detail: `${who} en a compté un ${ago(this.serverNow() - suggestion.ageMs, this.serverNow())}.`,
        actions: [{ label: "C'est le même", primary: true, run: () => this.mergeTap(tap.id, suggestion.episodeId) }, undo],
        duration: UNDO_MS,
      };
    } else {
      toast = {
        key: tap.id,
        tone: 'point',
        title: `+${tap.count} ${name}`,
        actions: [undo, { label: 'Quel mot ?', run: () => this.openWord(tap.id, tap.targetId) }],
        duration: UNDO_MS,
      };
    }
    if (keepTimer && this.toast?.key === tap.id) {
      // Réponse du serveur : on met à jour le bandeau sans relancer le compte à rebours.
      this.toast = { ...this.toast, ...toast };
    } else {
      this.showToast(toast);
    }
  }

  private offlineToast(tap: PendingTap, serverDown = false): void {
    this.showToast({
      key: tap.id,
      tone: 'offline',
      title: serverDown ? 'Serveur indisponible' : 'Pas de réseau',
      detail: `Ton +${tap.count} pour ${this.name(tap.targetId)} partira ${serverDown ? 'dès que le serveur répondra' : 'dès le retour du réseau'}.`,
      actions: [{ label: 'Annuler', run: () => this.cancelTap(tap.id) }],
      duration: UNDO_MS,
    });
  }

  /** Ce que l'annulation va changer, d'après l'affichage actuel. */
  private cancelMessage(reportId: string): string {
    const episode = this.view?.recent.find((e) => e.reports.some((r) => r.id === reportId));
    if (!episode || episode.voided) return 'Signalement retiré';
    const after = pointsOf(episode.reports.filter((r) => r.id !== reportId).map(like));
    return after < episode.points ? 'Point annulé' : "Signalement retiré. Le point reste : un autre témoin l'a compté.";
  }

  /**
   * Annule un de mes signalements (ou, pour l'admin, celui d'un autre). L'affichage change
   * tout de suite ; l'annulation est gardée sur le téléphone jusqu'à ce que le serveur l'ait
   * prise en compte, même sans réseau ou si l'app est fermée entre-temps.
   */
  cancelTap(reportId: string): void {
    const me = this.me;
    if (!me) return;
    const message = this.cancelMessage(reportId);
    if (this.pending.some((p) => p.id === reportId)) this.patchPending(reportId, { cancel: true });
    if (!this.cancels.some((c) => c.reportId === reportId)) {
      this.cancels = [...this.cancels, { reportId, playerId: me.player.id, state: 'queued', ackVersion: null }];
    }
    this.persistQueue();
    this.info(message);
    void this.flush();
  }

  async splitTap(reportId: string): Promise<void> {
    if (!(await this.whenSent(reportId))) return this.info('Pas encore envoyé : réessaie quand le réseau revient.');
    await this.act(
      () => this.transport.split(reportId),
      (r) => (r.delta > 0 ? 'Compté comme un autre gros mot' : null),
    );
  }

  async mergeTap(reportId: string, episodeId: string): Promise<void> {
    if (!(await this.whenSent(reportId))) return this.info('Pas encore envoyé : réessaie quand le réseau revient.');
    await this.act(
      () => this.transport.merge(reportId, episodeId),
      () => 'Regroupé : un seul gros mot',
    );
  }

  openWord(reportId: string, targetId: string): void {
    this.dismissToast();
    this.sheet = { kind: 'word', reportId, targetId };
  }

  async setWord(reportId: string, word: string | null): Promise<void> {
    const tap = this.pending.find((p) => p.id === reportId);
    if (tap && tap.state !== 'acked') {
      this.patchPending(reportId, { word });
      this.persistQueue();
      // Pas encore envoyé : le mot partira avec le tap.
      if (tap.state === 'queued') return this.info(word ? 'Mot enregistré' : 'Mot retiré');
      if (!(await this.whenSent(reportId))) return;
    }
    await this.act(
      () => this.transport.setWord(reportId, word),
      () => (word ? 'Mot enregistré' : 'Mot retiré'),
    );
  }

  /**
   * Ajout différé ou +N : un épisode à part. `requestId` reste le même tant que le formulaire
   * est ouvert : réessayer après une réponse perdue ne compte pas deux fois.
   */
  async addManual(requestId: string, targetId: string, count: number, occurredAt: number, note: string | null, word: string | null): Promise<boolean> {
    const result = await this.act(
      () => this.transport.manual({ id: requestId, targetId, count, occurredAt, note, word }),
      () => `+${count} ${this.name(targetId)}`,
    );
    return result !== null;
  }
}

export const app = new AppState();

/** Points d'un épisode vu depuis l'interface (même règle que le serveur). */
export function episodePointsView(e: EpisodeView): number {
  return e.voided ? 0 : pointsOf(e.reports.map(like));
}
