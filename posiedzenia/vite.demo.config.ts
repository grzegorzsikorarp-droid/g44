import {defineConfig} from 'vite';
import preact from '@preact/preset-vite';

// Wersja próbna: jedna strona bez serwera (zapytania /api/ obsługuje src/demo/server.ts w przeglądarce).
// Fonty Titillium Web są osadzone w pliku, bo strona nie pobiera nic z zewnątrz. Znaku Izby w niej nie ma.
export default defineConfig({
  plugins: [preact()],
  publicDir: false,
  build: {
    outDir: 'dist-demo', emptyOutDir: true, target: 'es2020', sourcemap: false, modulePreload: false,
    assetsInlineLimit: (file: string) => file.endsWith('.woff2') ? true : undefined,
    rolldownOptions: {input: 'demo.html'},
  },
});
