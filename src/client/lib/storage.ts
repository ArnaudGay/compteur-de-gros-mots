// Petites préférences et caches locaux. Le stockage peut être indisponible (navigation
// privée, données effacées) : tout est donc protégé et l'app marche sans.

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // stockage plein ou bloqué : tant pis pour le cache
  }
}

export type ThemeChoice = 'auto' | 'light' | 'dark';

/** Applique le thème et accorde la barre d'état d'iOS. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const light = '#f4f4f1';
  const dark = '#0c0c0b';
  for (const meta of metas) {
    const media = meta.dataset.media ?? meta.getAttribute('media') ?? '';
    meta.dataset.media = media;
    if (choice === 'auto') {
      meta.setAttribute('media', media);
      meta.content = media.includes('dark') ? dark : light;
    } else {
      meta.removeAttribute('media');
      meta.content = choice === 'dark' ? dark : light;
    }
  }
}
