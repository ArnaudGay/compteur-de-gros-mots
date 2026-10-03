import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // L'état du téléphone (src/client/lib/*.svelte.ts) utilise les runes de Svelte.
  plugins: [svelte()],
  define: {
    __DEMO__: 'false',
    __APP_VERSION__: '"test"',
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
  },
});
