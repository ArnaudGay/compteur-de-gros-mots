// Contrat entre l'interface et « le serveur » : le vrai (HTTP + SSE) ou la démo (en mémoire).

import type {
  ActionResult,
  Contest,
  EpisodeView,
  Player,
  ReportResult,
  Season,
  Settings,
  Snapshot,
  StatsRange,
  StatsView,
  Versioned,
  VoteChoice,
} from '../../core/types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Erreur réseau : l'action pourra être renvoyée plus tard. */
  get offline(): boolean {
    return this.code === 'network';
  }
}

export interface PasskeyInfo {
  id: string;
  label: string | null;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface PushPrefs {
  point: boolean;
  vote: boolean;
  result: boolean;
  season: boolean;
}

export interface Me {
  player: Player;
  session: { id: string; method: string; createdAt: number } | null;
  passkeys: PasskeyInfo[];
  push: { publicKey: string; prefs: PushPrefs; devices: number } | null;
}

export interface LoginPlayer {
  id: string;
  name: string;
  color: string;
  hasPin: boolean;
}

export interface SessionRow {
  id: string;
  playerId: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  method: string;
  current?: boolean;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export interface AdminOverview {
  players: (Player & { hasPin: boolean; pendingInvitation: boolean; passkeys: number; pushDevices: number })[];
  sessions: SessionRow[];
  spectatorLinks: { id: string; url: string; createdAt: number }[];
  backups: BackupInfo[];
}

export interface JournalRow {
  at: number;
  actorId: string | null;
  action: string;
  data: Record<string, unknown>;
}

export type LinkStatus = 'live' | 'connecting' | 'offline';

export interface StreamHandlers {
  snapshot: (snapshot: Snapshot) => void;
  status: (status: LinkStatus) => void;
  unauthorized?: () => void;
}

export interface ReportInput {
  id: string;
  targetId: string;
  occurredAt: number;
  count?: number;
  word?: string | null;
}

export interface ManualInput extends ReportInput {
  count: number;
  note?: string | null;
}

export interface Transport {
  readonly demo: boolean;

  // Connexion
  me(): Promise<Me | null>;
  loginPlayers(): Promise<LoginPlayer[]>;
  login(playerId: string, pin: string): Promise<void>;
  logout(): Promise<void>;
  invitation(token: string): Promise<{ player: { id: string; name: string; color: string }; expiresAt: number; hasPin: boolean }>;
  acceptInvitation(token: string, pin: string): Promise<void>;
  passkeyLogin(): Promise<void>;
  passkeyRegister(label: string | null): Promise<PasskeyInfo[]>;
  passkeyRemove(id: string): Promise<PasskeyInfo[]>;
  changePin(currentPin: string, newPin: string): Promise<void>;
  sessions(): Promise<SessionRow[]>;
  revokeSession(id: string): Promise<void>;

  // Notifications
  pushSubscribe(subscription: PushSubscriptionJSON): Promise<PushPrefs>;
  pushUnsubscribe(endpoint: string): Promise<void>;
  pushPrefs(prefs: Partial<PushPrefs>): Promise<PushPrefs>;
  pushTest(): Promise<number>;

  // Temps réel
  connect(handlers: StreamHandlers): () => void;
  spectate(token: string, handlers: StreamHandlers): () => void;

  // Le défi
  report(input: ReportInput): Promise<Versioned<ReportResult>>;
  manual(input: ManualInput): Promise<Versioned<ReportResult>>;
  cancel(reportId: string): Promise<Versioned<ActionResult>>;
  split(reportId: string): Promise<Versioned<ActionResult>>;
  merge(reportId: string, episodeId: string): Promise<Versioned<ActionResult>>;
  setWord(reportId: string, word: string | null): Promise<Versioned<ActionResult>>;
  contest(episodeId: string, reason: string | null): Promise<{ contest: Contest; version: number }>;
  vote(contestId: string, choice: VoteChoice): Promise<{ contest: Contest; version: number }>;
  withdraw(contestId: string): Promise<{ contest: Contest; version: number }>;
  history(params: { before?: string | null; limit?: number; player?: string | null; contested?: boolean }): Promise<{ items: EpisodeView[]; next: string | null }>;
  episode(id: string): Promise<EpisodeView>;
  stats(range: StatsRange, seasonId?: string | null): Promise<StatsView>;

  // Administration
  adminOverview(): Promise<AdminOverview>;
  invite(playerId: string): Promise<{ url: string; expiresAt: number }>;
  adminRevokeSession(id: string): Promise<void>;
  addPlayer(input: { id: string; name: string; color: string }): Promise<Player>;
  updatePlayer(id: string, patch: { name?: string; color?: string; isAdmin?: boolean; archived?: boolean }): Promise<Player>;
  updateSettings(patch: Partial<Omit<Settings, 'challengeStartedAt' | 'timeZone'>>): Promise<Settings>;
  launch(seasonName: string | null): Promise<Season>;
  newSeason(name: string | null): Promise<Season>;
  renameSeason(id: string, name: string): Promise<Season>;
  voidEpisode(id: string, note: string | null): Promise<Versioned<ActionResult>>;
  restoreEpisode(id: string): Promise<Versioned<ActionResult>>;
  createSpectatorLink(): Promise<{ id: string; url: string }>;
  revokeSpectatorLink(id: string): Promise<void>;
  journal(): Promise<JournalRow[]>;
  backupNow(): Promise<BackupInfo>;
  /** Adresse de téléchargement (export, sauvegarde), ou null si indisponible (démo). */
  downloadUrl(kind: 'json' | 'csv' | 'backup', name?: string): string | null;
}
