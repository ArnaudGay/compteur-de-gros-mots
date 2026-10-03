<script lang="ts" module>
  // Jeu d'icônes dessiné pour l'app (trait de 1,75 px), plutôt qu'une bibliothèque générique.
  const PATHS = {
    tally: '<path d="M5 5v14M9 5v14M13 5v14M17 5v14"/><path d="M3 17 21 7"/>',
    ranking: '<path d="M4 20v-7h5v7M9.5 20V5h5v15M15 20v-10h5v10M3 20h18"/>',
    history: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/>',
    stats: '<path d="M4 19.5h16"/><path d="M6.5 16v-3M10.5 16V8M14.5 16v-6M18.5 16V5"/>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    back: '<path d="M14.5 5 7.5 12l7 7"/>',
    next: '<path d="m9.5 5 7 7-7 7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    share: '<path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H6v9.5h12V11h-.5"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14"/>',
    bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.75 1.75H4.75z"/><path d="M10 20.5a2.1 2.1 0 0 0 4 0"/>',
    faceid: '<path d="M4 8.5V6.5A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16c1.5 1 3.5 1 5 0"/>',
    var: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M9 20.5h6M12 17v3.5"/><path d="m10 9 4 2-4 2z"/>',
    word: '<path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z"/><path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
    undo: '<path d="M9 13.5 4.5 9 9 4.5"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
    install: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>',
    user: '<circle cx="12" cy="8.5" r="3.75"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
    shield: '<path d="M12 3.5 19.5 6v6c0 4.5-3.2 7.5-7.5 8.5-4.3-1-7.5-4-7.5-8.5V6z"/>',
    book: '<path d="M5 18.5V5.5A2 2 0 0 1 7 3.5h12v14H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h12"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.75"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3A4.5 4.5 0 0 0 13 4.6l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3A4.5 4.5 0 0 0 11 19.4l1.2-1.2"/>',
    clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12h3.5"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    whistle: '<circle cx="9" cy="14" r="5"/><path d="M13.5 12.5 20.5 10V7.5H9.5"/><path d="M9 14h.01"/>',
  } as const;
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name, size = 24, label }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
>
  {@html PATHS[name]}
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
