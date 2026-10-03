import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { transform } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/** Liste récursive des fichiers d'un dossier, en chemins URL ("/icons/x.png"). */
function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : ['/' + relative(base, full).split('\\').join('/')];
  });
}

/**
 * Compile src/sw/sw.ts en /sw.js et y injecte la liste des fichiers à mettre en cache
 * (fichiers générés + dossier public). La version change dès qu'un fichier change.
 */
function serviceWorker(): Plugin {
  return {
    name: 'gros-mots-service-worker',
    apply: 'build',
    // Après les autres extensions, pour que la feuille de style soit déjà dans la liste.
    enforce: 'post',
    async generateBundle(_options, bundle) {
      const generated = Object.keys(bundle).map((file) => '/' + file);
      const publicFiles = listFiles('public').filter((file) => file !== '/robots.txt');
      const precache = ['/', ...generated.filter((f) => f !== '/index.html'), ...publicFiles].sort();
      const version = createHash('sha256').update(precache.join('\n')).update(pkg.version).digest('hex').slice(0, 12);
      const source = readFileSync('src/sw/sw.ts', 'utf8');
      const { code } = await transform(source, { loader: 'ts', target: 'es2020', minify: true });
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `self.__PRECACHE=${JSON.stringify(precache)};self.__VERSION=${JSON.stringify(version)};\n${code}`,
      });
    },
  };
}

/** Démo : tout (JS, CSS, polices) est inliné dans un seul index.html, publiable tel quel. */
function inlineEverything(): Plugin {
  return {
    name: 'gros-mots-inline-demo',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      // La démo n'a ni manifest, ni icônes, ni service worker.
      return html.replace(/\s*<link rel="(manifest|apple-touch-icon|icon)"[^>]*>/g, '');
    },
    generateBundle(_options, bundle) {
      const htmlAsset = bundle['index.html'];
      if (!htmlAsset || htmlAsset.type !== 'asset') return;
      let html = String(htmlAsset.source);
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === 'chunk' && file.endsWith('.js')) {
          // Les exports de l'admin ne sont jamais affichés dans la démo : on retire l'attribut
          // de téléchargement, que la page publiée ne peut de toute façon pas honorer.
          const code = output.code.replace(/<\/script/gi, '<\\/script').replace(/ download=""/g, '');
          const tag = new RegExp(`<script[^>]*src="/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
          html = html.replace(tag, () => `<script type="module">${code}</script>`);
          delete bundle[file];
        } else if (output.type === 'asset' && file.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          html = html.replace(tag, () => `<style>${String(output.source)}</style>`);
          delete bundle[file];
        }
      }
      // Format attendu par la page publiée : pas de <html>/<head>/<body>, juste le contenu.
      const title = /<title>[\s\S]*?<\/title>/.exec(html)?.[0] ?? '';
      const styles = html.match(/<style>[\s\S]*?<\/style>/g) ?? [];
      const scripts = html.match(/<script type="module">[\s\S]*?<\/script>/g) ?? [];
      htmlAsset.source = [title, ...styles, '<div id="app"></div>', ...scripts].join('\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [svelte(), demo ? inlineEverything() : serviceWorker()],
    publicDir: demo ? false : 'public',
    define: {
      __DEMO__: JSON.stringify(demo),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: demo ? 'dist/demo' : 'dist/client',
      emptyOutDir: true,
      target: 'es2022',
      modulePreload: false,
      assetsInlineLimit: demo ? () => true : 4096,
      cssCodeSplit: false,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://127.0.0.1:8787' },
      },
    },
  };
});
