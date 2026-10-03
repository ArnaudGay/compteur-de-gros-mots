import type { Settings } from './types';
import { HOUR } from './time';

/**
 * Teintes disponibles pour les joueurs (palette validée pour le daltonisme, voir les
 * variables CSS --hue-*). Le jaune est réservé à l'accent, le rouge aux alertes.
 */
export const PLAYER_HUES = ['blue', 'orange', 'aqua', 'violet', 'magenta', 'green'] as const;
export type PlayerHue = (typeof PLAYER_HUES)[number];

export const DEFAULT_PLAYERS: { id: string; name: string; color: PlayerHue; isAdmin: boolean }[] = [
  { id: 'arnaud', name: 'Arnaud', color: 'blue', isAdmin: true },
  { id: 'alexis', name: 'Alexis', color: 'orange', isAdmin: false },
  { id: 'alexandre', name: 'Alexandre', color: 'aqua', isAdmin: false },
  { id: 'gatho', name: 'Gatho', color: 'violet', isAdmin: false },
];

export const DEFAULT_RULES = `Le but : arrêter de dire des gros mots. Le moins de points gagne.

Compter
- Tu entends un gros mot : tape sur la case de la personne. Un tap, un point.
- Tu en as dit un : compte-le toi-même, sur l'honneur.
- Si quelqu'un l'a déjà compté, ton tap sert de confirmation : le point ne compte qu'une fois.
- Une erreur : « Annuler » juste après, ou depuis l'historique.

Contester
- Un point injuste : conteste-le dans les 48 h. Les trois autres votent, la majorité décide.
- Sans majorité au bout de 48 h, le point reste.

À fixer entre vous
- « Putain, putain, putain » : 1 point ou 3 ?
- L'anglais, « mince » et « zut », les messages écrits, les paroles de chansons : ça compte ?
- Le prix d'un gros mot pour la cagnotte, et le gage de la lanterne rouge.`;

export const DEFAULT_SETTINGS: Settings = {
  mergeWindowMs: 20_000,
  suggestWindowMs: 120_000,
  contestWindowMs: 48 * HOUR,
  voteDurationMs: 48 * HOUR,
  pricePerPointCents: 0,
  forfeit: '',
  rules: DEFAULT_RULES,
  challengeStartedAt: null,
  timeZone: 'Europe/Paris',
};

/** Anti-emballement : nombre maximal de taps par personne sur la fenêtre donnée. */
export const RATE_LIMIT = { taps: 10, windowMs: 10_000 };

/** Écart toléré entre l'heure du téléphone et celle du serveur. */
export const CLOCK = { maxFutureMs: 5_000, maxPastMs: 24 * HOUR };

export const LIMITS = {
  liveCountMax: 5,
  manualCountMax: 20,
  manualMaxPastMs: 60 * 24 * HOUR,
  noteMax: 140,
  wordMax: 30,
  reasonMax: 200,
  nameMax: 24,
  seasonNameMax: 40,
  forfeitMax: 140,
  rulesMax: 4000,
  /** Jusqu'où « C'est le même » peut aller chercher un épisode. */
  manualMergeMaxMs: HOUR,
};

/** Mots proposés quand on précise le gros mot (complétés par les plus fréquents). */
export const SUGGESTED_WORDS = ['putain', 'merde', 'bordel', 'con', 'chiant', 'fait chier', 'connard', 'enfoiré'];
