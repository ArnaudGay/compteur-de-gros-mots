// Calculs de dates dans le fuseau du défi (Europe/Paris), changements d'heure compris.
// On stocke tout en UTC ; seuls les « jours », « semaines » et « mois » dépendent du fuseau.

import type { Millis } from './types';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = lundi … 6 = dimanche. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(ms: Millis, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday ?? 'Mon'] ?? 0,
  };
}

/** Décalage du fuseau par rapport à UTC à cet instant (ms). */
function offsetAt(ms: Millis, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Instant UTC correspondant à une heure murale dans le fuseau. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Millis {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return second;
}

export function startOfDay(ms: Millis, timeZone: string): Millis {
  const p = zonedParts(ms, timeZone);
  return zonedToUtc(p.year, p.month, p.day, 0, 0, timeZone);
}

/** Lundi 0 h de la semaine en cours. */
export function startOfWeek(ms: Millis, timeZone: string): Millis {
  const p = zonedParts(ms, timeZone);
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
  return zonedToUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, timeZone);
}

export function startOfMonth(ms: Millis, timeZone: string): Millis {
  const p = zonedParts(ms, timeZone);
  return zonedToUtc(p.year, p.month, 1, 0, 0, timeZone);
}

/** Jour calendaire dans le fuseau, au format AAAA-MM-JJ. */
export function dayKey(ms: Millis, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minuit, dans le fuseau, du jour donné au format AAAA-MM-JJ. */
export function startOfDayKey(key: string, timeZone: string): Millis {
  const [y, m, d] = key.split('-').map(Number);
  return zonedToUtc(y ?? 1970, m ?? 1, d ?? 1, 0, 0, timeZone);
}

function keyToUtcNoon(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
}

export function addDays(key: string, days: number): string {
  return new Date(keyToUtcNoon(key) + days * DAY).toISOString().slice(0, 10);
}

/** Nombre de jours calendaires de `from` à `to` (positif si `to` est après). */
export function daysBetween(from: string, to: string): number {
  return Math.round((keyToUtcNoon(to) - keyToUtcNoon(from)) / DAY);
}

/** Liste des jours de `from` à `to` inclus. */
export function dayRange(from: string, to: string): string[] {
  const days: string[] = [];
  for (let key = from; key <= to; key = addDays(key, 1)) days.push(key);
  return days;
}
