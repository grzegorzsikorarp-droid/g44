// Czyta rejestr ekranów z kodu i porównuje go z mapą ze zmiany 1.2, punkt 8.
// Uruchomienie: npm run ekrany
import { readFileSync, writeFileSync } from 'node:fs'

const zrodlo = readFileSync('src/rejestr-ekranow.ts', 'utf8')
const wpisy = [...zrodlo.matchAll(/\{ id: '([^']+)', nazwa: '([^']+)', grupa: '([^']+)', belka: (true|false), krzyzyk: '([^']+)' \}/g)]
  .map(([, id, nazwa, grupa, belka, krzyzyk]) => ({ id, nazwa, grupa, belka: belka === 'true', krzyzyk }))

/*
  Mapa ekranów po zmianie 1.2 (punkt 8). Wydanie 1.1 nosiło w tytule „48”, a wyliczenia
  w grupach sumowały się do 58 — zmiana 1.2 liczy mapę od nowa i podaje 66.
  Ta tablica jest źródłem prawdy dla porównania; zmienia się razem z dokumentem zmiany.
*/
const MAPA_12 = { E0: 23, E1: 4, E2: 8, E3: 3, E4: 13, E5: 8, E6: 2, E7: 5 }
const DEKLAROWANA_SUMA = 66

const zaimplementowane = wpisy.filter((w) => w.id !== 'DEV')
const wgGrup = {}
for (const w of zaimplementowane) wgGrup[w.grupa] = (wgGrup[w.grupa] ?? 0) + 1

console.log('EKRANY ZAIMPLEMENTOWANE WG GRUP (mapa zmiany 1.2)\n')
let sumaMapy = 0
let zgodne = true
for (const [grupa, oczekiwane] of Object.entries(MAPA_12)) {
  const jest = wgGrup[grupa] ?? 0
  sumaMapy += oczekiwane
  const status = jest === oczekiwane ? 'zgadza się' : `RÓŻNICA (${jest} zamiast ${oczekiwane})`
  if (jest !== oczekiwane) zgodne = false
  console.log(`  ${grupa}: ${String(jest).padStart(2)} / ${oczekiwane} — ${status}`)
}

// Grupa spoza mapy to też różnica — inaczej dopisany ekran przechodziłby niezauważony.
for (const grupa of Object.keys(wgGrup)) {
  if (!(grupa in MAPA_12)) {
    zgodne = false
    console.log(`  ${grupa}: ${wgGrup[grupa]} — GRUPA SPOZA MAPY`)
  }
}

console.log(`\n  Razem zaimplementowane: ${zaimplementowane.length}`)
console.log(`  Suma z mapy zmiany 1.2: ${sumaMapy}`)
console.log(`  Liczba deklarowana w punkcie 8: ${DEKLAROWANA_SUMA}`)

if (sumaMapy !== DEKLAROWANA_SUMA) {
  console.log(`\n  UWAGA: suma z grup (${sumaMapy}) różni się od liczby deklarowanej (${DEKLAROWANA_SUMA}).`)
  console.log('  Szczegóły w ROZBIEZNOSCI.md.')
}

const suma = zaimplementowane.length === DEKLAROWANA_SUMA
console.log(`\n  Zgodność z mapą: ${zgodne && suma ? 'PEŁNA' : 'do sprawdzenia'}`)

writeFileSync(
  'ekrany.json',
  JSON.stringify({
    wydanie: '1.2',
    zaimplementowane: zaimplementowane.length,
    wgGrup,
    sumaZMapy: sumaMapy,
    liczbaDeklarowana: DEKLAROWANA_SUMA,
    ekrany: wpisy,
  }, null, 2) + '\n',
)
console.log('\n  Zapisano ekrany.json')
process.exit(zgodne && suma ? 0 : 1)
