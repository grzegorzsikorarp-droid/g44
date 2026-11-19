import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {defineConfig, type Plugin} from 'vite';
import preact from '@preact/preset-vite';

// Znak i ikony Izby trafiają do zbudowanej aplikacji prosto z brand/, bez kopii w repozytorium.
// W trybie deweloperskim /brand/… serwuje Vite, bo folder leży w katalogu projektu.
function brandAssets(): Plugin {
  const icons = ['favicon.ico', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
  let root = process.cwd();
  return {
    name: 'posiedzenia-znak-izby',
    apply: 'build',
    configResolved(config) { root = config.root; },
    generateBundle() {
      const file = (path: string) => readFileSync(join(root, path));
      this.emitFile({type: 'asset', fileName: 'brand/logo/znak-oipip-slupsk.svg', source: file('brand/logo/znak-oipip-slupsk.svg')});
      for (const icon of icons) this.emitFile({type: 'asset', fileName: icon, source: file(`brand/logo/aplikacja/${icon}`)});
      const manifest = JSON.parse(file('brand/logo/aplikacja/site.webmanifest').toString('utf8'));
      this.emitFile({type: 'asset', fileName: 'site.webmanifest', source: JSON.stringify({...manifest, name: 'Posiedzenia Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku', short_name: 'Posiedzenia'}, null, 2)});
    },
  };
}

export default defineConfig({
  plugins: [preact(), brandAssets()],
  build: {outDir: 'dist/client', emptyOutDir: true, target: 'es2020', sourcemap: false},
});
