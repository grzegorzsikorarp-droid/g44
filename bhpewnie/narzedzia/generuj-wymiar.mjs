// Generuje wymiar czasu pracy dla kazdego miesiaca — art. 130 Kodeksu pracy:
// wymiar = 40 h x pelne tygodnie + 8 h x pozostale dni pn-pt,
//          minus 8 h za kazde swieto przypadajace w dniu INNYM niz niedziela.
// Rownowaznie: 8 h x (dni pn-pt) - 8 h x (swieta poza niedziela).
// Potrzebne, bo dodatek nocny = 20% minimalnego / wymiar danego miesiaca (zmienia sie co miesiac).
import { writeFile } from 'node:fs/promises'

function wielkanoc(rok) {
  // Algorytm Meeusa/Jonesa/Butchera
  const a = rok % 19, b = Math.floor(rok / 100), c = rok % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const miesiac = Math.floor((h + l - 7 * m + 114) / 31)
  const dzien = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(rok, miesiac - 1, dzien))
}
const iso = (d) => d.toISOString().slice(0, 10)
const przesun = (d, dni) => new Date(d.getTime() + dni * 86400000)

function swieta(rok) {
  const w = wielkanoc(rok)
  return [
    { data: `${rok}-01-01`, nazwa: 'Nowy Rok' },
    { data: `${rok}-01-06`, nazwa: 'Trzech Kroli' },
    { data: iso(w), nazwa: 'Wielkanoc' },
    { data: iso(przesun(w, 1)), nazwa: 'Poniedzialek Wielkanocny' },
    { data: `${rok}-05-01`, nazwa: 'Swieto Pracy' },
    { data: `${rok}-05-03`, nazwa: 'Swieto Konstytucji 3 Maja' },
    { data: iso(przesun(w, 49)), nazwa: 'Zielone Swiatki' },
    { data: iso(przesun(w, 60)), nazwa: 'Boze Cialo' },
    { data: `${rok}-08-15`, nazwa: 'Wniebowziecie NMP' },
    { data: `${rok}-11-01`, nazwa: 'Wszystkich Swietych' },
    { data: `${rok}-11-11`, nazwa: 'Narodowe Swieto Niepodleglosci' },
    { data: `${rok}-12-25`, nazwa: 'Boze Narodzenie' },
    { data: `${rok}-12-26`, nazwa: 'Drugi dzien Bozego Narodzenia' },
  ]
}

function wymiarRoku(rok) {
  const s = swieta(rok)
  const miesiace = []
  for (let m = 0; m < 12; m++) {
    const dni = new Date(Date.UTC(rok, m + 1, 0)).getUTCDate()
    let robocze = 0
    for (let d = 1; d <= dni; d++) {
      const dzien = new Date(Date.UTC(rok, m, d)).getUTCDay()
      if (dzien >= 1 && dzien <= 5) robocze++
    }
    const swietaObnizajace = s.filter((x) => {
      const dt = new Date(x.data + 'T00:00:00Z')
      return dt.getUTCFullYear() === rok && dt.getUTCMonth() === m && dt.getUTCDay() !== 0
    })
    const godziny = robocze * 8 - swietaObnizajace.length * 8
    miesiace.push({
      miesiac: `${rok}-${String(m + 1).padStart(2, '0')}`,
      dni_pn_pt: robocze,
      swieta_obnizajace: swietaObnizajace.map((x) => x.nazwa),
      wymiar_godzin: godziny,
    })
  }
  return miesiace
}

const rok = 2026
const dane = {
  _uwaga: 'Plik generowany: node narzedzia/generuj-wymiar.mjs. Podstawa: art. 130 Kodeksu pracy.',
  rok,
  swieta: swieta(rok),
  miesiace: wymiarRoku(rok),
}
await writeFile('content/wymiar-czasu-pracy.json', JSON.stringify(dane, null, 2) + '\n')
console.table(dane.miesiace.map((m) => ({ miesiac: m.miesiac, wymiar: m.wymiar_godzin, stawka_nocna: (0.2 * 4806 / m.wymiar_godzin).toFixed(2) })))
