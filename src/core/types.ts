// Types du cœur métier, partagés par le serveur, l'interface et la démo.

export type PlayerId = string;
/** Instant en millisecondes depuis l'epoch (UTC). */
export type Millis = number;

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  isAdmin: boolean;
  /** Position fixe dans la grille du compteur (ne bouge jamais avec le classement). */
  position: number;
  archivedAt: Millis | null;
  createdAt: Millis;
}

/** `live` : taps en direct, fusionnables. `manual` : ajout différé ou +N, jamais fusionné. */
export type EpisodeKind = 'live' | 'manual';
export type VoidReason = 'contest' | 'admin' | 'merged';

/** Un gros mot (ou une rafale) visant une personne, vu par un ou plusieurs témoins. */
export interface Episode {
  id: string;
  targetId: PlayerId;
  kind: EpisodeKind;
  /** Heure du premier signalement. */
  startedAt: Millis;
  note: string | null;
  createdAt: Millis;
  createdBy: PlayerId;
  voidedAt: Millis | null;
  voidedBy: PlayerId | null;
  voidReason: VoidReason | null;
  voidNote: string | null;
}

/** Comment un signalement a été rattaché à son épisode. */
export type ReportLink = 'new' | 'auto' | 'merged' | 'split' | 'manual';

/** Un signalement : un tap (ou un ajout +N) d'un témoin. */
export interface Report {
  /** Identifiant créé par le téléphone : garantit qu'un tap n'est enregistré qu'une fois. */
  id: string;
  episodeId: string;
  targetId: PlayerId;
  reporterId: PlayerId;
  count: number;
  occurredAt: Millis;
  receivedAt: Millis;
  word: string | null;
  link: ReportLink;
  cancelledAt: Millis | null;
  cancelledBy: PlayerId | null;
}

export type VoteChoice = 'valid' | 'invalid';
/** `accepted` : contestation acceptée, le point est annulé. `rejected` : le point est maintenu. */
export type ContestStatus = 'open' | 'accepted' | 'rejected' | 'withdrawn';

export interface Contest {
  id: string;
  episodeId: string;
  openedBy: PlayerId;
  openedAt: Millis;
  reason: string | null;
  deadline: Millis;
  votes: Record<PlayerId, VoteChoice>;
  status: ContestStatus;
  resolvedAt: Millis | null;
}

export interface Season {
  id: string;
  name: string;
  startsAt: Millis;
  endsAt: Millis | null;
}

export interface Settings {
  /** Deux signalements sur la même personne à moins de cet écart forment un seul épisode. */
  mergeWindowMs: number;
  /** Au-delà de la fusion automatique, on propose « C'est le même ? » jusqu'à cet écart. */
  suggestWindowMs: number;
  /** Délai pour contester un point. */
  contestWindowMs: number;
  /** Durée du vote. */
  voteDurationMs: number;
  /** Prix d'un point pour la cagnotte (0 = cagnotte désactivée). */
  pricePerPointCents: number;
  /** Gage de la lanterne rouge de la saison. */
  forfeit: string;
  /** Règles du défi, en texte libre. */
  rules: string;
  /** Date du lancement officiel ; avant, c'est la phase de test. */
  challengeStartedAt: Millis | null;
  timeZone: string;
}

export interface JournalEntry {
  at: Millis;
  actorId: PlayerId | null;
  action: string;
  data: Record<string, unknown>;
}

/** Événements métier, utilisés par le serveur pour les notifications. */
export type DomainEvent =
  | { type: 'point'; targetId: PlayerId; reporterId: PlayerId; delta: number; episodeId: string; word: string | null }
  | { type: 'contest-opened'; contestId: string; episodeId: string; openedBy: PlayerId; voters: PlayerId[] }
  | { type: 'contest-resolved'; contestId: string; episodeId: string; status: ContestStatus; openedBy: PlayerId }
  | { type: 'season-ended'; seasonId: string };

// ---------------------------------------------------------------------------
// Vues envoyées à l'interface

export interface ReportView {
  id: string;
  reporterId: PlayerId;
  count: number;
  occurredAt: Millis;
  word: string | null;
  link: ReportLink;
  cancelledAt: Millis | null;
  cancelledBy: PlayerId | null;
}

export interface ContestView extends Contest {
  /** Joueurs appelés à voter. */
  voters: PlayerId[];
  targetId: PlayerId;
}

export interface EpisodeView {
  id: string;
  targetId: PlayerId;
  kind: EpisodeKind;
  startedAt: Millis;
  /** Enregistrement du point par le serveur : le délai pour contester part de là. */
  createdAt: Millis;
  points: number;
  voided: boolean;
  voidReason: VoidReason | null;
  voidNote: string | null;
  note: string | null;
  word: string | null;
  reports: ReportView[];
  contest: ContestView | null;
}

export interface PeriodTotals {
  today: number;
  week: number;
  month: number;
  season: number;
  all: number;
}

export type Period = keyof PeriodTotals;

export interface LastPoint {
  at: Millis;
  episodeId: string;
  reporterIds: PlayerId[];
}

export interface Snapshot {
  version: number;
  now: Millis;
  phase: 'test' | 'live';
  players: Player[];
  settings: Settings;
  seasons: Season[];
  currentSeasonId: string | null;
  totals: Record<PlayerId, PeriodTotals>;
  last: Record<PlayerId, LastPoint | null>;
  /** Épisodes récents (au moins tous ceux des 2 dernières minutes), du plus récent au plus ancien. */
  recent: EpisodeView[];
  /** Contestations ouvertes et celles résolues depuis 7 jours. */
  contests: ContestView[];
}

/** Ce que voit la personne qui vient de taper. */
export type ReportOutcome = 'new' | 'increment' | 'confirm' | 'duplicate';

export interface ReportResult {
  reportId: string;
  episodeId: string;
  outcome: ReportOutcome;
  /** Points ajoutés au total de la cible par ce tap. */
  delta: number;
  /** Autres témoins de l'épisode (pour « Déjà compté par … »). */
  otherReporterIds: PlayerId[];
  /** Ancienneté du premier signalement de l'épisode au moment du tap. */
  episodeAgeMs: number;
  /** Épisode récent proposé pour « C'est le même ? ». */
  suggestion: { episodeId: string; reporterIds: PlayerId[]; ageMs: number } | null;
}

/** Effet d'une action sur le total de la cible. */
export interface ActionResult {
  delta: number;
}

/** Réponse du serveur : le résultat + la version de l'état qui l'inclut. */
export type Versioned<T> = T & { version: number };

export type StatsRange = 'season' | '30d' | 'all';

export interface PlayerStats {
  playerId: PlayerId;
  points: number;
  /** Jours entiers sans gros mot depuis le dernier (null si aucun dans la période). */
  currentStreak: number;
  bestStreak: number;
  worstDay: { day: string; points: number } | null;
  /** Signalements faits sur les autres. */
  reportsOnOthers: number;
  /** Autodénonciations. */
  selfReports: number;
  /** Points par jour, aligné sur `days`. */
  perDay: number[];
}

export interface StatsView {
  range: StatsRange;
  from: Millis;
  to: Millis;
  /** Jours (AAAA-MM-JJ, heure de Paris) couverts par `perDay`. */
  days: string[];
  players: PlayerStats[];
  /** Points par jour de semaine (0 = lundi) et tranche de 4 h (0 = 0 h-4 h). */
  heatmap: number[][];
  topWords: { word: string; points: number }[];
  totalPoints: number;
}
