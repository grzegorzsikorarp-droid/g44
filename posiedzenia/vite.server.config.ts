import {defineConfig} from 'vite';
import {builtinModules} from 'node:module';

// Serwer razem z bibliotekami trafia do jednego pliku dist/server.mjs,
// więc do uruchomienia gotowej paczki wystarcza sam Node.js.
export default defineConfig({
  publicDir: false,
  ssr: {noExternal: true},
  build: {
    ssr: 'src/server/main.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'node24',
    sourcemap: false,
    rolldownOptions: {
      external: [...builtinModules, ...builtinModules.map(m => 'node:' + m)],
      output: {entryFileNames: 'server.mjs'},
    },
  },
});
