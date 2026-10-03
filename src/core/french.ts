// Petites aides de français pour les textes générés.

/** « de Gatho », « d'Arnaud », « d'Alexis ». */
export function de(name: string): string {
  return /^[aeiouyhàâäéèêëîïôöûüÿæœ]/i.test(name) ? `d'${name}` : `de ${name}`;
}

/** « 1 point », « 3 points ». */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${Math.abs(count) > 1 ? pluralForm : singular}`;
}

/** Liste lisible : « Alexis », « Alexis et Gatho », « Alexis, Gatho et Arnaud ». */
export function listing(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}
