// Składa ROZBIEZNOSCI.md w dokument Worda do krążenia w zespole projektowym.
// Rejestr jest dokumentem żywym — po każdej aktualizacji pliku .md warto odtworzyć .docx.
//
// Uruchomienie:
//   node narzedzia/rejestr-do-worda.mjs ROZBIEZNOSCI.md "BHPewnie-rejestr-rozbieznosci.docx"

import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, PageNumber,
  Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType,
} from 'docx'
import { readFileSync, writeFileSync } from 'node:fs'

const ZIELEN = '0F6B63'
const GRAFIT = '22262B'
const SZARY = '5A6068'
const OBRYS = 'D9D2C8'
const PODKLAD = 'F2EEE8'

const zrodlo = readFileSync(process.argv[2], 'utf8')
const wyjscie = process.argv[3]

/** Zamienia **pogrubienie**, `kod` i _kursywę_ na przebiegi tekstu. */
function przebiegi(tekst, bazowe = {}) {
  const wynik = []
  const wzor = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let ostatni = 0
  for (const m of tekst.matchAll(wzor)) {
    if (m.index > ostatni) wynik.push(new TextRun({ text: tekst.slice(ostatni, m.index), ...bazowe }))
    const kawalek = m[0]
    if (kawalek.startsWith('**')) {
      wynik.push(new TextRun({ text: kawalek.slice(2, -2), bold: true, ...bazowe }))
    } else {
      wynik.push(new TextRun({ text: kawalek.slice(1, -1), font: 'Consolas', size: 19, color: SZARY, ...bazowe }))
    }
    ostatni = m.index + kawalek.length
  }
  if (ostatni < tekst.length) wynik.push(new TextRun({ text: tekst.slice(ostatni), ...bazowe }))
  return wynik.length ? wynik : [new TextRun({ text: tekst, ...bazowe })]
}

const dzieci = []
const wiersze = zrodlo.split('\n')
let i = 0
let pierwszyNaglowek = true

while (i < wiersze.length) {
  const w = wiersze[i].replace(/^ {2,}/, '')

  // Tytuł dokumentu
  if (w.startsWith('# ')) {
    dzieci.push(new Paragraph({
      children: [new TextRun({ text: 'BHPewnie — rejestr rozbieżności', bold: true, size: 40, color: GRAFIT })],
      spacing: { after: 80 },
    }))
    dzieci.push(new Paragraph({
      children: [new TextRun({
        text: 'Forum Związków Zawodowych · prototyp roboczy aplikacji BHP · stan na 1 września 2026',
        size: 20, color: SZARY,
      })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ZIELEN, space: 8 } },
      spacing: { after: 280 },
    }))
    i++
    continue
  }

  // Nagłówek wpisu
  if (w.startsWith('## ')) {
    dzieci.push(new Paragraph({
      children: przebiegi(w.slice(3), { size: 26, bold: true, color: ZIELEN }),
      heading: HeadingLevel.HEADING_1,
      spacing: { before: pierwszyNaglowek ? 120 : 360, after: 140 },
      keepNext: true,
    }))
    pierwszyNaglowek = false
    i++
    continue
  }

  // Tabela
  if (w.startsWith('|')) {
    const surowe = []
    while (i < wiersze.length && wiersze[i].trimStart().startsWith('|')) {
      surowe.push(wiersze[i].trim())
      i++
    }
    const komorki = surowe
      .filter((r) => !/^\|[\s|:-]+\|$/.test(r))
      .map((r) => r.split('|').slice(1, -1).map((c) => c.trim()))
    const liczbaKolumn = Math.max(...komorki.map((r) => r.length))
    const szerokoscTabeli = 9070
    const szerokosci = liczbaKolumn === 3
      ? [4400, 2400, 2270]
      : Array(liczbaKolumn).fill(Math.floor(szerokoscTabeli / liczbaKolumn))

    dzieci.push(new Table({
      columnWidths: szerokosci,
      width: { size: szerokoscTabeli, type: WidthType.DXA },
      rows: komorki.map((rzad, nrRzedu) => new TableRow({
        tableHeader: nrRzedu === 0,
        children: rzad.map((tresc, nrKol) => new TableCell({
          width: { size: szerokosci[nrKol], type: WidthType.DXA },
          shading: nrRzedu === 0 ? { type: ShadingType.CLEAR, fill: PODKLAD } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: przebiegi(tresc, { size: 19, bold: nrRzedu === 0 }),
          })],
        })),
      })),
    }))
    dzieci.push(new Paragraph({ text: '', spacing: { after: 160 } }))
    continue
  }

  // Punkt listy
  if (w.startsWith('- ')) {
    dzieci.push(new Paragraph({
      children: przebiegi(w.slice(2), { size: 21 }),
      numbering: { reference: 'punkty', level: 0 },
      spacing: { after: 100 },
    }))
    i++
    continue
  }

  // Lista numerowana
  const numerowany = w.match(/^(\d+)\. (.+)$/)
  if (numerowany) {
    dzieci.push(new Paragraph({
      children: przebiegi(numerowany[2], { size: 21 }),
      numbering: { reference: 'kroki', level: 0 },
      spacing: { after: 100 },
    }))
    i++
    continue
  }

  // Linia oddzielająca — pomijamy, bo nagłówki same dzielą dokument
  if (w.trim() === '---' || w.trim() === '') { i++; continue }

  // Zwykły akapit
  dzieci.push(new Paragraph({
    children: przebiegi(w, { size: 21 }),
    spacing: { after: 140, line: 300 },
    alignment: AlignmentType.LEFT,
  }))
  i++
}

const dokument = new Document({
  creator: 'Forum Związków Zawodowych',
  title: 'BHPewnie — rejestr rozbieżności',
  description: 'Rejestr rozbieżności między briefem a prototypem roboczym aplikacji BHPewnie',
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 21, color: GRAFIT } },
    },
  },
  numbering: {
    config: [
      {
        reference: 'punkty',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 220 } } },
        }],
      },
      {
        reference: 'kroki',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 360, hanging: 220 } } },
        }],
      },
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: OBRYS, space: 6 } },
          children: [
            new TextRun({ text: 'BHPewnie · rejestr rozbieżności · strona ', size: 16, color: SZARY }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: SZARY }),
            new TextRun({ text: ' z ', size: 16, color: SZARY }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: SZARY }),
          ],
        })],
      }),
    },
    children: dzieci,
  }],
})

writeFileSync(wyjscie, await Packer.toBuffer(dokument))
console.log('zapisano:', wyjscie, '| akapitów i tabel:', dzieci.length)
