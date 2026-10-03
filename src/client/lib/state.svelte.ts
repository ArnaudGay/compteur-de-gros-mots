// État de l'app côté téléphone : l'état reçu du serveur, les taps pas encore confirmés
// (affichés tout de suite, et gardés si le réseau manque), les bandeaux, la connexion.

import { listing } from '../../core/french';
import { activeReporters, decideMerge, pointsOf, type EpisodeLike } from '../../core/merge';
import type { EpisodeView, Player, ReportOutcome, ReportResult, Snapshot } from '../../core/types';
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
  /** Annulé avant que le serveur ait répondu : on annulera dès la confirmation. */
  cancel?: boolean;
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

function toLike(e: EpisodeView): EpisodeLike {
  return {
    id: e.id,
    targetId: e.targetId,
    kind: e.kind,
    startedAt: e.startedAt,
    voided: e.voided,
    reports: e.reports.map((r) => ({ reporterId: r.reporterId, count: r.count, cancelled: r.cancelledAt !== null })),
  };
}

function isAcknowledged(tap: PendingTap, snap: Snapshot): boolean {
  if (tap.ackVersion !== null && snap.version >= tap.ackVersion) return true;
  return snap.recent.some((e) => e.reports.some((r) => r.id === tap.id));
}

/** Ce que le serveur va répondre, calculé avec la même règle que lui. */
function predict(view: Snapshot, tap: PendingTap): Prediction {
  const d = decideMerge(view.recent.map(toLike), { targetId: tap.targetId, reporterId: tap.playerId, occurredAt: tap.occurredAt, count: tap.count }, view.settings);
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

/** L'état du serveur + les taps pas encore confirmés, pour un affichage instantané. */
export function applyPending(snap: Snapshot | null, pending: PendingTap[]): Snapshot | null {
  if (!snap) return null;
  const active = pending.filter((p) => !isAcknowledged(p, snap));
  if (active.length === 0) return snap;
  const totals = structuredClone(snap.totals);
  const last = { ...snap.last };
  const recent: EpisodeView[] = snap.recent.map((e) => ({ ...e, reports: [...e.reports] }));
  for (const tap of active) {
    const d = decideMerge(recent.map(toLike), { targetId: tap.targetId, reporterId: tap.playerId, occurredAt: tap.occurredAt, count: tap.count }, snap.settings);
    const report = { id: tap.id, reporterId: tap.playerId, count: tap.count, occurredAt: tap.occurredAt, word: tap.word, link: d.kind === 'merge' ? ('auto' as const) : ('new' as const), cancelledAt: null, cancelledBy: null };
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
    if (t && delta > 0) {
      t.today += delta;
      t.week += delta;
      t.month += delta;
      t.all += delta;
      if (snap.currentSeasonId) t.season += delta;
    }
    last[tap.targetId] = {
      at: tap.occurredAt,
      episodeId: episode.id,
      reporterIds: activeReporters(episode.reports.map((r) => ({ reporterId: r.reporterId, count: r.count, cancelled: r.cancelledAt !== null }))),
    };
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
  toast = $state<Toast | null>(null);
  sheet = $state<Sheet | null>(null);
  clock = $state(Date.now());
  theme = $state<ThemeChoice>(readLocal<ThemeChoice>('gm.theme', 'auto'));
  reveal = $state<boolean>(readLocal('gm.reveal', false));

  view = $derived(applyPending(this.snapshot, this.pending));
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
    this.pending = readLocal<PendingTap[]>(this.queueKey(), []).map((p) => (p.state === 'acked' ? p : { ...p, state: 'queued' }));
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
    this.disconnect?.();
    this.disconnect = null;
    this.me = null;
    this.snapshot = null;
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
    const before = this.pending.length;
    this.pending = this.pending.filter((p) => !isAcknowledged(p, s));
    this.snapshot = s;
    if (this.pending.length !== before) this.persistQueue();
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

  private persistQueue(): void {
    if (!this.me) return;
    writeLocal(
      this.queueKey(),
      this.pending.filter((p) => p.state !== 'acked'),
    );
  }

  private patchPending(id: string, patch: Partial<PendingTap>): void {
    this.pending = this.pending.map((p) => (p.id === id ? { ...p, ...patch } : p));
  }

  private removePending(id: string): void {
    this.pending = this.pending.filter((p) => p.id !== id);
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
        const current = this.pending.find((p) => p.id === tap.id);
        if (current?.cancel) {
          await this.cancelReport(tap.id);
        } else if (result.outcome !== 'duplicate' && this.toast?.key === tap.id) {
          this.tapToast(tap, result, true);
        }
      } catch (error) {
        if (error instanceof ApiError && error.offline) {
          this.patchPending(tap.id, { state: 'queued' });
          if (this.toast?.key === tap.id) this.offlineToast(tap);
        } else if (error instanceof ApiError && error.status === 401) {
          this.patchPending(tap.id, { state: 'queued' });
          this.leaveApp();
        } else {
          this.removePending(tap.id);
          this.error(error);
        }
      } finally {
        this.persistQueue();
        this.sending.delete(tap.id);
      }
    })();
    this.sending.set(tap.id, job);
    return job;
  }

  /** Renvoie les taps gardés pendant une coupure, dans l'ordre. */
  async flush(): Promise<void> {
    for (const tap of this.pending.filter((p) => p.state === 'queued')) {
      if (this.sending.has(tap.id)) continue;
      this.patchPending(tap.id, { state: 'sending' });
      await this.send(tap);
      if (this.pending.find((p) => p.id === tap.id)?.state === 'queued') break;
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
        duration: 8000,
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
        duration: 8000,
      };
    } else {
      toast = {
        key: tap.id,
        tone: 'point',
        title: `+${tap.count} ${name}`,
        actions: [undo, { label: 'Quel mot ?', run: () => this.openWord(tap.id, tap.targetId) }],
        duration: 6000,
      };
    }
    if (keepTimer && this.toast?.key === tap.id) {
      // Réponse du serveur : on met à jour le bandeau sans relancer le compte à rebours.
      this.toast = { ...this.toast, ...toast };
    } else {
      this.showToast(toast);
    }
  }

  private offlineToast(tap: PendingTap): void {
    this.showToast({
      key: tap.id,
      tone: 'offline',
      title: 'Pas de réseau',
      detail: `Ton +${tap.count} pour ${this.name(tap.targetId)} partira dès le retour du réseau.`,
      actions: [{ label: 'Annuler', run: () => this.cancelTap(tap.id) }],
      duration: 6000,
    });
  }

  async cancelTap(reportId: string): Promise<void> {
    const tap = this.pending.find((p) => p.id === reportId);
    if (tap && tap.state === 'queued') {
      this.removePending(reportId);
      this.persistQueue();
      this.info('Annulé');
      return;
    }
    if (tap && tap.state === 'sending') {
      this.patchPending(reportId, { cancel: true });
      this.info('Annulé');
      return;
    }
    await this.cancelReport(reportId);
  }

  async cancelReport(reportId: string): Promise<void> {
    await this.act(
      () => this.transport.cancel(reportId),
      (r) => (r.delta < 0 ? 'Point annulé' : 'Signalement retiré'),
    );
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
      if (tap.state === 'queued') return;
      if (!(await this.whenSent(reportId))) return;
    }
    await this.act(() => this.transport.setWord(reportId, word));
  }

  /** Ajout différé ou +N : un épisode à part. */
  async addManual(targetId: string, count: number, occurredAt: number, note: string | null, word: string | null): Promise<boolean> {
    const result = await this.act(
      () => this.transport.manual({ id: crypto.randomUUID(), targetId, count, occurredAt, note, word }),
      () => `+${count} ${this.name(targetId)}`,
    );
    return result !== null;
  }
}

export const app = new AppState();

/** Points d'un épisode vu depuis l'interface (même règle que le serveur). */
export function episodePointsView(e: EpisodeView): number {
  return e.voided ? 0 : pointsOf(e.reports.map((r) => ({ reporterId: r.reporterId, count: r.count, cancelled: r.cancelledAt !== null })));
}
