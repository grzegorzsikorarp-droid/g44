#!/usr/bin/env node
// OIPiP w Słupsku. Generator plików z tokenami.
// Czyta tokens.json (jedyne źródło) i tworzy obok niego tokens.css, tokens.dtcg.json, tokens.ts,
// tailwind.preset.cjs i tailwind.theme.css. Wymaga Node.js 18 lub nowszego, bez dodatkowych pakietów.
// Uruchomienie z katalogu repozytorium: node brand/tokens/generuj.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const T = JSON.parse(readFileSync(join(DIR, 'tokens.json'), 'utf8'));
const VERSION = (T.meta && T.meta.version) || String(T.version);
const THEMES = T.color.themes.map((t) => t.id);
const FIRST = THEMES[0];
const COLORS = T.color.tokens;
const FAMILY_SANS = T.type.families.sans;
const SPACING = T.spacing.tokens;
const RADIUS = T.radius.tokens;
const SHADOW = (T.shadow && T.shadow.tokens) || [];
const OTHER = Object.entries(T).filter(([k, v]) => !['name', 'version', 'meta', 'color', 'type', 'spacing', 'radius', 'shadow'].includes(k) && v && Array.isArray(v.tokens));
const STYLES = T.type.groups.flatMap((g) => g.styles);
const UPPER = new Set(['etykieta', 'etykieta-paska', 'przycisk']);
// Tytuł strony i nagłówek sekcji zmniejszają się na węższych ekranach (wartości z opisów tokenów).
const RESPONSIVE = { 'tytul-strony': 'max(34px, 5vw)', 'naglowek-sekcji': 'max(22px, 2.86vw)' };
const RESPONSIVE_FROM = '1120px';

const ALIAS = /^\{([A-Za-z0-9_.-]+)\}$/;
const byName = Object.fromEntries(COLORS.map((c) => [c.name, c]));
const themeVal = (v, theme) => (typeof v === 'string' ? v : v[theme] ?? v[FIRST]);
const cssVal = (v) => { const m = ALIAS.exec(v); return m ? `var(--${m[1]})` : v; };
function resolve(name, theme, depth = 0) {
  const v = themeVal(byName[name].value, theme);
  const m = ALIAS.exec(v);
  if (!m) return v;
  if (depth > 16) throw new Error(`Za długi łańcuch aliasów przy ${name}`);
  return resolve(m[1], theme, depth + 1);
}
const out = (file, text) => writeFileSync(join(DIR, file), text.endsWith('\n') ? text : text + '\n', 'utf8');

// ---------- tokens.css ----------
function tokensCss() {
  const L = ['/* OIPiP w Słupsku. Plik wygenerowany z tokens.json przez generuj.mjs, nie zmieniaj go ręcznie. */',
    `/* Wersja ${VERSION}. Motyw jasny w :root, ciemny po ustawieniu data-theme="ciemny" na <html> albo na fragmencie strony. */`, ''];
  for (const [i, theme] of THEMES.entries()) {
    const lines = [];
    for (const c of COLORS) {
      const has = typeof c.value === 'string' ? i === 0 : c.value[theme] !== undefined;
      if (has) lines.push(`  --${c.name}: ${cssVal(themeVal(c.value, theme))};`);
    }
    for (const s of SHADOW) {
      const has = typeof s.value === 'string' ? i === 0 : s.value[theme] !== undefined;
      if (has) lines.push(`  --${s.name}: ${themeVal(s.value, theme)};`);
    }
    const sel = i === 0 ? `:root, [data-theme="${theme}"]` : `[data-theme="${theme}"]`;
    L.push(`${sel} {`, ...lines, `  color-scheme: ${i === 0 ? 'light' : 'dark'};`, '}', '');
  }
  L.push(':root {');
  for (const t of SPACING) L.push(`  --${t.name}: ${t.value};`);
  for (const t of RADIUS) L.push(`  --${t.name}: ${t.value};`);
  for (const [, fam] of OTHER) for (const t of fam.tokens) L.push(`  --${t.name}: ${t.value};`);
  L.push(`  --font-sans: ${FAMILY_SANS};`, '}', '');
  for (const s of STYLES) {
    const up = UPPER.has(s.name) ? ' text-transform: uppercase;' : '';
    L.push(`.oi-t-${s.name} { font-family: var(--font-sans); font-size: ${s.fontSize}; line-height: ${s.lineHeight}; font-weight: ${s.fontWeight}; font-style: ${s.fontStyle}; letter-spacing: ${s.letterSpacing};${up} }`);
  }
  L.push('', `@media (max-width: ${RESPONSIVE_FROM}) {`);
  for (const [n, size] of Object.entries(RESPONSIVE)) L.push(`  .oi-t-${n} { font-size: ${size}; }`);
  L.push('}');
  return L.join('\n');
}

// ---------- tokens.dtcg.json (W3C Design Tokens) ----------
function familyList() {
  return FAMILY_SANS.split(',').map((f) => f.trim().replace(/^"(.*)"$/, '$1'));
}
function hex8(rgba) {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(rgba);
  if (!m) return rgba;
  const h = (n) => Math.round(Number(n)).toString(16).padStart(2, '0');
  const a = m[4] === undefined ? '' : h(Number(m[4]) * 255);
  return `#${h(m[1])}${h(m[2])}${h(m[3])}${a}`;
}
function shadowObj(v) {
  const m = /^(\S+)\s+(\S+)\s+(\S+)(?:\s+(-?[\d.]+px))?\s+(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})$/.exec(v.trim());
  if (!m) return v;
  const px = (x) => (x === '0' ? '0px' : x);
  return { color: hex8(m[5]), offsetX: px(m[1]), offsetY: px(m[2]), blur: px(m[3]), spread: px(m[4] || '0') };
}
function dtcg() {
  const ref = (v) => { const m = ALIAS.exec(v); return m ? `{kolor.${m[1]}}` : v; };
  const o = { $description: `OIPiP w Słupsku, wersja ${VERSION}, format W3C Design Tokens. Plik wygenerowany z tokens.json przez generuj.mjs.` };
  o.kolor = Object.fromEntries(COLORS.map((c) => [c.name, { $type: 'color', $value: ref(themeVal(c.value, FIRST)), $description: c.usage }]));
  for (const theme of THEMES.slice(1)) {
    o[`kolor-${theme}`] = Object.fromEntries(COLORS.filter((c) => typeof c.value !== 'string' && c.value[theme] !== undefined)
      .map((c) => [c.name, { $type: 'color', $value: ref(c.value[theme]) }]));
  }
  o.odstep = Object.fromEntries(SPACING.map((t) => [t.name, { $type: 'dimension', $value: t.value, $description: t.usage }]));
  o.zaokraglenie = Object.fromEntries(RADIUS.map((t) => [t.name, { $type: 'dimension', $value: t.value, $description: t.usage }]));
  o.cien = Object.fromEntries(SHADOW.map((t) => [t.name, { $type: 'shadow', $value: shadowObj(themeVal(t.value, FIRST)), $description: t.usage }]));
  for (const theme of THEMES.slice(1)) {
    o[`cien-${theme}`] = Object.fromEntries(SHADOW.filter((t) => typeof t.value !== 'string' && t.value[theme] !== undefined)
      .map((t) => [t.name, { $type: 'shadow', $value: shadowObj(t.value[theme]) }]));
  }
  for (const [fam, f] of OTHER) {
    o[fam] = Object.fromEntries(f.tokens.map((t) => {
      const dim = /^-?[\d.]+(px|rem)$/.test(t.value);
      return [t.name, dim ? { $type: 'dimension', $value: t.value, $description: t.usage } : { $value: t.value, $description: t.usage }];
    }));
  }
  o.typografia = Object.fromEntries(STYLES.map((s) => [s.name, {
    $type: 'typography',
    $value: { fontFamily: familyList(), fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing === '0' ? '0em' : s.letterSpacing },
    $description: s.usage,
    $extensions: { 'pl.oipip-slupsk': { fontStyle: s.fontStyle, ...(UPPER.has(s.name) ? { textTransform: 'uppercase' } : {}) } },
  }]));
  return JSON.stringify(o, null, 2);
}

// ---------- tokens.ts ----------
function tokensTs() {
  const kolory = Object.fromEntries(THEMES.map((theme) => [theme, Object.fromEntries(COLORS.map((c) => [c.name, resolve(c.name, theme)]))]));
  const data = {
    version: VERSION,
    kolory,
    font: { sans: FAMILY_SANS },
    odstep: Object.fromEntries(SPACING.map((t) => [t.name, t.value])),
    zaokraglenie: Object.fromEntries(RADIUS.map((t) => [t.name, t.value])),
    cien: Object.fromEntries(SHADOW.map((t) => [t.name, typeof t.value === 'string' ? { [FIRST]: t.value } : t.value])),
    ...Object.fromEntries(OTHER.map(([fam, f]) => [fam, Object.fromEntries(f.tokens.map((t) => [t.name, t.value]))])),
    typografia: Object.fromEntries(STYLES.map((s) => [s.name, { fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, fontStyle: s.fontStyle, letterSpacing: s.letterSpacing }])),
  };
  return ['// OIPiP w Słupsku. Plik wygenerowany z tokens.json przez generuj.mjs, nie zmieniaj go ręcznie.',
    '// Wartości rozwiązane (bez aliasów). W interfejsie używaj zmiennych CSS z tokens.css, a tego pliku tam, gdzie CSS nie sięga (wykresy, PDF, e-mail).',
    `export const tokens = ${JSON.stringify(data, null, 2)} as const;`, '',
    `export type KolorOIPiP = keyof typeof tokens.kolory.${FIRST};`, 'export default tokens;'].join('\n');
}

// ---------- Tailwind CSS 3 ----------
const q = (s) => `'${s.replace(/'/g, "\\'")}'`;
function tailwindV3() {
  const colors = COLORS.map((c) => `      ${q(c.name)}: 'var(--${c.name})',`).join('\n');
  const spacing = SPACING.map((t) => `        ${q(t.name)}: ${q(t.value)},`).join('\n');
  const shadows = SHADOW.map((t) => `      ${q(t.name)}: 'var(--${t.name})',`).join('\n');
  const fam = (name) => (OTHER.find(([k]) => k === name) || [null, { tokens: [] }])[1].tokens;
  const skos = fam('skos');
  const skew = skos.map((t) => `        ${q(t.name)}: ${q(t.value)},`).join('\n');
  const borders = fam('obramowanie').map((t) => `        ${q(t.name)}: ${q(t.value)},`).join('\n');
  const widths = fam('szerokosc').map((t) => `        ${q(t.name)}: ${q(t.value)},`).join('\n');
  const font = familyList().map((f) => (/\s/.test(f) ? `'"${f}"'` : q(f))).join(', ');
  return `// OIPiP w Słupsku. Preset Tailwind CSS 3, wygenerowany z tokens.json przez generuj.mjs.
// Kolory czytają zmienne z tokens.css, więc działa też motyw ciemny. Preset zastępuje domyślną paletę i cienie Tailwinda.
// Użycie w tailwind.config.js: presets: [require('./brand/tokens/tailwind.preset.cjs')]
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="ciemny"]'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
${colors}
    },
    boxShadow: {
      none: 'none',
${shadows}
    },
    // Izba nie zaokrągla rogów, więc każda klasa rounded-* daje 0.
    borderRadius: { none: '0', DEFAULT: '0', sm: '0', md: '0', lg: '0', xl: '0', '2xl': '0', '3xl': '0', full: '0' },
    extend: {
      fontFamily: { sans: [${font}] },
      spacing: {
${spacing}
      },
      skew: {
${skew}
      },
      borderWidth: {
${borders}
      },
      maxWidth: {
${widths}
      },
    },
  },
};`;
}

// ---------- Tailwind CSS 4 ----------
function tailwindV4() {
  const fam = (name) => (OTHER.find(([k]) => k === name) || [null, { tokens: [] }])[1].tokens;
  return `/* OIPiP w Słupsku. Motyw dla Tailwind CSS 4, wygenerowany z tokens.json przez generuj.mjs.
   Wczytaj po tokens.css, w kolejności z README.md. Motyw zastępuje domyślną paletę i cienie Tailwinda. */
@custom-variant dark (&:where([data-theme="ciemny"], [data-theme="ciemny"] *));

@theme inline {
  --color-*: initial;
${COLORS.map((c) => `  --color-${c.name}: var(--${c.name});`).join('\n')}
  --font-sans: ${FAMILY_SANS};
${SPACING.map((t) => `  --spacing-${t.name}: ${t.value};`).join('\n')}
  --shadow-*: initial;
${SHADOW.map((t) => `  --shadow-${t.name}: var(--${t.name});`).join('\n')}
  --radius-*: initial;
  --radius-none: 0;
${fam('szerokosc').map((t) => `  --container-${t.name}: ${t.value};`).join('\n')}
}

/* Izba nie zaokrągla rogów. rounded-full jest w Tailwindzie stałą klasą, dlatego wyłącza ją osobna reguła poza warstwami. */
.rounded-full { border-radius: 0; }`;
}

out('tokens.css', tokensCss());
out('tokens.dtcg.json', dtcg());
out('tokens.ts', tokensTs());
out('tailwind.preset.cjs', tailwindV3());
out('tailwind.theme.css', tailwindV4());
console.log(`Tokeny ${VERSION}: zapisano tokens.css, tokens.dtcg.json, tokens.ts, tailwind.preset.cjs i tailwind.theme.css.`);
