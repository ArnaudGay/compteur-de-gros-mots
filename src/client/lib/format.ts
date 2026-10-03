// Dates, durées et montants en français, à l'heure de Paris.

import { DAY, HOUR, MINUTE, dayKey, daysBetween, zonedParts } from '../../core/time';

const TZ = 'Europe/Paris';
const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function clock(ms: number): string {
  const p = zonedParts(ms, TZ);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** « à l'instant », « il y a 12 s », « il y a 3 min », « il y a 2 h », « hier à 14:32 », « mardi à 9:10 », « le 3 oct. ». */
export function ago(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 5000) return "à l'instant";
  if (diff < MINUTE) return `il y a ${Math.floor(diff / 1000)} s`;
  if (diff < HOUR) return `il y a ${Math.floor(diff / MINUTE)} min`;
  const days = daysBetween(dayKey(ms, TZ), dayKey(now, TZ));
  if (days === 0) return `il y a ${Math.floor(diff / HOUR)} h`;
  if (days === 1) return `hier à ${clock(ms)}`;
  if (days < 7) return `${WEEKDAYS[zonedParts(ms, TZ).weekday]} à ${clock(ms)}`;
  const p = zonedParts(ms, TZ);
  return `le ${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** Libellé d'un jour pour regrouper l'historique. */
export function dayLabel(key: string, todayKey: string): string {
  const diff = daysBetween(key, todayKey);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  const weekday = WEEKDAYS[(date.getUTCDay() + 6) % 7] ?? '';
  const label = `${weekday} ${d} ${MONTHS[(m ?? 1) - 1]}`;
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return (label.charAt(0).toUpperCase() + label.slice(1)) + (sameYear ? '' : ` ${y}`);
}

/** « 3 oct. » */
export function shortDate(ms: number): string {
  const p = zonedParts(ms, TZ);
  return `${p.day} ${MONTHS_SHORT[p.month - 1]}`;
}

/** « 3 octobre 2026 à 14:32 » */
export function longDate(ms: number): string {
  const p = zonedParts(ms, TZ);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year} à ${clock(ms)}`;
}

/** « encore 23 h », « encore 12 min » */
export function remaining(deadline: number, now: number): string {
  const diff = deadline - now;
  if (diff <= 0) return 'terminé';
  if (diff < HOUR) return `encore ${Math.max(1, Math.ceil(diff / MINUTE))} min`;
  if (diff < 2 * DAY) return `encore ${Math.ceil(diff / HOUR)} h`;
  return `encore ${Math.ceil(diff / DAY)} jours`;
}

const euros = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export function money(cents: number): string {
  return euros.format(cents / 100);
}

export function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

export function hours(ms: number): string {
  return `${Math.round(ms / HOUR)} h`;
}

/** Jours entiers depuis une date (0 = aujourd'hui). */
export function daysSince(ms: number, now: number): number {
  return daysBetween(dayKey(ms, TZ), dayKey(now, TZ));
}

export function today(now: number): string {
  return dayKey(now, TZ);
}

/** Pour <input type="datetime-local"> : « 2026-10-03T14:32 » à l'heure de Paris. */
export function toLocalInput(ms: number): string {
  const p = zonedParts(ms, TZ);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export { TZ };
