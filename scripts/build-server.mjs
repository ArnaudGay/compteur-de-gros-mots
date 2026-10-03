// Compile le serveur TypeScript en JavaScript (dist/server). Les dépendances restent
// dans node_modules : seules les sources du projet sont regroupées.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

await build({
  entryPoints: ['src/server/main.ts', 'src/server/cli.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  define: {
    __DEMO__: 'false',
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  logLevel: 'info',
});
