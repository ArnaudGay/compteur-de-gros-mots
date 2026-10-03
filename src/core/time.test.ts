import { describe, expect, it } from 'vitest';
import { addDays, dayKey, dayRange, daysBetween, startOfDay, startOfMonth, startOfWeek, zonedParts } from './time';

const TZ = 'Europe/Paris';

describe('dates à l’heure de Paris', () => {
  it('minuit à Paris ≠ minuit UTC', () => {
    // 5 octobre 2026, 23 h 30 UTC = 6 octobre, 1 h 30 à Paris (heure d'été, UTC+2).
    const t = Date.UTC(2026, 9, 5, 23, 30);
    expect(dayKey(t, TZ)).toBe('2026-10-06');
    expect(startOfDay(t, TZ)).toBe(Date.UTC(2026, 9, 5, 22, 0));
  });

  it('début de semaine le lundi', () => {
    // Dimanche 11 octobre 2026, 20 h à Paris.
    const sunday = Date.UTC(2026, 9, 11, 18, 0);
    expect(zonedParts(sunday, TZ).weekday).toBe(6);
    expect(startOfWeek(sunday, TZ)).toBe(Date.UTC(2026, 9, 4, 22, 0));
  });

  it('passage à l’heure d’hiver (25 octobre 2026)', () => {
    const afternoon = Date.UTC(2026, 9, 25, 14, 0); // 15 h à Paris, UTC+1
    expect(startOfDay(afternoon, TZ)).toBe(Date.UTC(2026, 9, 24, 22, 0)); // minuit était encore en UTC+2
    expect(startOfDay(Date.UTC(2026, 9, 26, 12, 0), TZ)).toBe(Date.UTC(2026, 9, 25, 23, 0));
  });

  it('passage à l’heure d’été (29 mars 2026)', () => {
    expect(startOfDay(Date.UTC(2026, 2, 29, 12, 0), TZ)).toBe(Date.UTC(2026, 2, 28, 23, 0));
    expect(startOfDay(Date.UTC(2026, 2, 30, 12, 0), TZ)).toBe(Date.UTC(2026, 2, 29, 22, 0));
  });

  it('début de mois', () => {
    expect(startOfMonth(Date.UTC(2026, 9, 15, 12), TZ)).toBe(Date.UTC(2026, 8, 30, 22, 0));
  });

  it('calculs sur les jours', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(daysBetween('2026-10-01', '2026-10-05')).toBe(4);
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3);
    expect(dayRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
