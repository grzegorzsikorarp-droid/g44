// Składa wersję próbną w jeden plik HTML (styl i skrypt wewnątrz) do opublikowania jako strona.
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const dir = 'dist-demo', html = readFileSync(join(dir, 'demo.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+)"[^>]*>/g)].map(m => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"[^>]*><\/script>/g)].map(m => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
const page = `<title>Posiedzenia Prezydium</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<style>/* Strona na claude.ai: górny odstęp od paska systemowego daje już ramka */.topbar{padding-top:var(--odstep-1)}</style>
<div id="app" class="oi-root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
writeFileSync(join(dir, 'posiedzenia-proba.html'), page);
console.log(`posiedzenia-proba.html: ${(page.length / 1024).toFixed(0)} KB`);
