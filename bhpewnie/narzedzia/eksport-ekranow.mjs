// Czyta rejestr ekranów z kodu i porównuje go z mapą z sekcji 5 briefu.
// Uruchomienie: npm run ekrany
import { readFileSync, writeFileSync } from 'node:fs'

const zrodlo = readFileSync('src/rejestr-ekranow.ts', 'utf8')
const wpisy = [...zrodlo.matchAll(/\{ id: '([^']+)', nazwa: '([^']+)', grupa: '([^']+)', belka: (true|false), krzyzyk: '([^']+)' \}/g)]
  .map(([, id, nazwa, grupa, belka, krzyzyk]) => ({ id, nazwa, grupa, belka: belka === 'true', krzyzyk }))

// Liczby ekranów podane w briefie przy nagłówkach grup.
const BRIEF = { E0: 23, E1: 4, E2: 6, E3: 3, E4: 13, E5: 7, E6: 2 }
const DEKLAROWANA_SUMA = 48   // liczba z tytułu „Mapa ekranów (48)”

const zaimplementowane = wpisy.filter((w) => w.id !== 'DEV')
const wgGrup = {}
for (const w of zaimplementowane) wgGrup[w.grupa] = (wgGrup[w.grupa] ?? 0) + 1

console.log('EKRANY ZAIMPLEMENTOWANE WG GRUP\n')
let sumaBriefu = 0
let zgodne = true
for (const [grupa, oczekiwane] of Object.entries(BRIEF)) {
  const jest = wgGrup[grupa] ?? 0
  sumaBriefu += oczekiwane
  const status = jest === oczekiwane ? 'zgadza się' : `RÓŻNICA (${jest} zamiast ${oczekiwane})`
  if (jest !== oczekiwane) zgodne = false
  console.log(`  ${grupa}: ${String(jest).padStart(2)} / ${oczekiwane} — ${status}`)
}

console.log(`\n  Razem zaimplementowane: ${zaimplementowane.length}`)
console.log(`  Suma z nagłówków grup w briefie: ${sumaBriefu}`)
console.log(`  Liczba z tytułu „Mapa ekranów (${DEKLAROWANA_SUMA})”: ${DEKLAROWANA_SUMA}`)

if (sumaBriefu !== DEKLAROWANA_SUMA) {
  console.log(`\n  UWAGA: brief sam sobie przeczy — wyliczenia w grupach dają ${sumaBriefu},`)
  console.log(`  a tytuł mówi o ${DEKLAROWANA_SUMA}. Zaimplementowano wszystkie ${sumaBriefu} wymienione ekrany.`)
  console.log('  Szczegóły w ROZBIEZNOSCI.md, wpis 2.')
}

const brakujace = zaimplementowane.length !== sumaBriefu
console.log(`\n  Zgodność z mapą grup: ${zgodne && !brakujace ? 'PEŁNA' : 'do sprawdzenia'}`)

writeFileSync(
  'ekrany.json',
  JSON.stringify({ zaimplementowane: zaimplementowane.length, wgGrup, sumaZGrupBriefu: sumaBriefu, liczbaZTytuluBriefu: DEKLAROWANA_SUMA, ekrany: wpisy }, null, 2) + '\n',
)
console.log('\n  Zapisano ekrany.json')
process.exit(zgodne ? 0 : 1)
