import {defineConfig} from 'vite';
import preact from '@preact/preset-vite';

// Wersja próbna: jedna strona bez serwera (zapytania /api/ obsługuje src/demo/server.ts w przeglądarce).
export default defineConfig({
  plugins: [preact()],
  publicDir: false,
  build: {outDir: 'dist-demo', emptyOutDir: true, target: 'es2020', sourcemap: false, modulePreload: false, rolldownOptions: {input: 'demo.html'}},
});
