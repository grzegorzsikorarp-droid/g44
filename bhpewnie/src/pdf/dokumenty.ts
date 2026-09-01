import { PDFDocument, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { t } from '../dane/wczytaj'
import { STAN_PRAWNY } from '../silnik/parametry'

/**
 * GENERATOR PDF PO STRONIE KLIENTA (sekcja 3 briefu).
 * Nic nie jest wysyłane — dokument powstaje w przeglądarce i zostaje na urządzeniu.
 *
 * Font: podzbiór IBM Plex Sans (licencja OFL) wgrany lokalnie do public/fonty.
 * Standardowe fonty PDF nie mają polskich znaków, więc bez osadzenia fontu
 * dokument byłby nieczytelny. To ten sam krój, którym pisany jest interfejs.
 *
 * Ograniczenie udokumentowane w ROZBIEZNOSCI.md (wpis 4): pdf-lib nie tworzy
 * PDF-a TAGOWANEGO (drzewo struktury wymagane przez PDF/UA). Ustawiamy metadane
 * i język dokumentu, ale pełna dostępność cyfrowa PDF wymaga innego narzędzia.
 */

const MARGINES = 56
const SZEROKOSC = 595.28   // A4 w punktach
const WYSOKOSC = 841.89

let pamiecFontow: { zwykly: ArrayBuffer; gruby: ArrayBuffer } | null = null

async function wczytajFonty(): Promise<{ zwykly: ArrayBuffer; gruby: ArrayBuffer }> {
  if (pamiecFontow) return pamiecFontow
  const [zwykly, gruby] = await Promise.all([
    fetch(new URL('fonty/pismo.ttf', document.baseURI)).then((o) => o.arrayBuffer()),
    fetch(new URL('fonty/pismo-gruby.ttf', document.baseURI)).then((o) => o.arrayBuffer()),
  ])
  pamiecFontow = { zwykly, gruby }
  return pamiecFontow
}

interface Pisarz {
  strona: PDFPage
  y: number
  dokument: PDFDocument
  zwykly: PDFFont
  gruby: PDFFont
}

function nowaStrona(p: Pisarz): void {
  p.strona = p.dokument.addPage([SZEROKOSC, WYSOKOSC])
  p.y = WYSOKOSC - MARGINES
}

function zawin(tekst: string, font: PDFFont, rozmiar: number, szerokosc: number): string[] {
  const slowa = tekst.split(/\s+/)
  const linie: string[] = []
  let biezaca = ''
  for (const slowo of slowa) {
    const proba = biezaca ? `${biezaca} ${slowo}` : slowo
    if (font.widthOfTextAtSize(proba, rozmiar) > szerokosc && biezaca) {
      linie.push(biezaca)
      biezaca = slowo
    } else {
      biezaca = proba
    }
  }
  if (biezaca) linie.push(biezaca)
  return linie
}

function pisz(
  p: Pisarz,
  tekst: string,
  opcje: { rozmiar?: number; gruby?: boolean; odstepPo?: number; srodek?: boolean; kolor?: [number, number, number] } = {},
): void {
  const rozmiar = opcje.rozmiar ?? 11
  const font = opcje.gruby ? p.gruby : p.zwykly
  const szerokosc = SZEROKOSC - 2 * MARGINES
  for (const linia of zawin(tekst, font, rozmiar, szerokosc)) {
    if (p.y < MARGINES + 96) nowaStrona(p)
    const x = opcje.srodek
      ? (SZEROKOSC - font.widthOfTextAtSize(linia, rozmiar)) / 2
      : MARGINES
    const [r, g, b] = opcje.kolor ?? [0.1, 0.12, 0.11]
    p.strona.drawText(linia, { x, y: p.y, size: rozmiar, font, color: rgb(r, g, b) })
    p.y -= rozmiar * 1.45
  }
  p.y -= opcje.odstepPo ?? 0
}

function linia(p: Pisarz, odstep = 10): void {
  p.y -= odstep
  p.strona.drawLine({
    start: { x: MARGINES, y: p.y },
    end: { x: SZEROKOSC - MARGINES, y: p.y },
    thickness: 0.7,
    color: rgb(0.78, 0.82, 0.8),
  })
  p.y -= odstep
}

/** Pole do wypełnienia ręcznie — aplikacja NIE zna imienia użytkownika. */
function poleDoWpisania(p: Pisarz, etykieta: string): void {
  if (p.y < MARGINES + 96) nowaStrona(p)
  p.strona.drawText(`${etykieta}:`, { x: MARGINES, y: p.y, size: 10, font: p.zwykly, color: rgb(0.35, 0.38, 0.37) })
  const odX = MARGINES + p.zwykly.widthOfTextAtSize(`${etykieta}: `, 10)
  p.strona.drawLine({
    start: { x: odX, y: p.y - 2 },
    end: { x: SZEROKOSC - MARGINES, y: p.y - 2 },
    thickness: 0.6,
    color: rgb(0.6, 0.64, 0.62),
    dashArray: [2, 2],
  })
  p.y -= 26
}

/**
 * Pas oznaczeń wg księgi wizualizacji: stała wysokość 76 pt, znaki 52 pt,
 * kolejność FE → barwy RP → UE → nadawca, odstęp między znakami ≥24 pt.
 *
 * Flagę UE i barwy RP rysujemy wektorowo (UE: pole 2:3, dwanaście gwiazd na okręgu
 * o promieniu ⅓ wysokości, #003399 i #FFCC00; RP: pole 5:8, biel i #D4213D).
 * Znak Funduszy Europejskich i godło RP muszą pochodzić z pliku źródłowego —
 * odrysowanie ich łamie księgę wizualizacji, więc zostaje miejsce z ramką kreskowaną.
 */
const WYSOKOSC_PASA = 76
const WYSOKOSC_ZNAKU = 52

function flagaUE(strona: PDFPage, x: number, y: number, wysokosc: number): number {
  const szerokosc = wysokosc * 1.5           // pole 2:3
  strona.drawRectangle({ x, y, width: szerokosc, height: wysokosc, color: rgb(0, 0.2, 0.6) })
  const srodekX = x + szerokosc / 2
  const srodekY = y + wysokosc / 2
  const promien = wysokosc / 3
  const promienGwiazdy = wysokosc * 0.055
  for (let i = 0; i < 12; i++) {
    const kat = (Math.PI / 6) * i - Math.PI / 2
    gwiazda(strona, srodekX + promien * Math.cos(kat), srodekY + promien * Math.sin(kat), promienGwiazdy)
  }
  return szerokosc
}

/** Gwiazda pięcioramienna, wierzchołkiem do góry — rysowana ścieżką SVG. */
function gwiazda(strona: PDFPage, x: number, y: number, r: number): void {
  const punkty: string[] = []
  for (let i = 0; i < 10; i++) {
    const promien = i % 2 === 0 ? r : r * 0.382
    const kat = (Math.PI / 5) * i - Math.PI / 2
    const px = promien * Math.cos(kat)
    const py = -promien * Math.sin(kat)   // ujemny, bo ścieżka SVG ma oś Y w dół
    punkty.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`)
  }
  strona.drawSvgPath(punkty.join(' ') + ' Z', { x, y, color: rgb(1, 0.8, 0), borderWidth: 0 })
}

function barwyRP(strona: PDFPage, x: number, y: number, wysokosc: number): number {
  const szerokosc = wysokosc * 1.6           // pole 5:8
  strona.drawRectangle({ x, y: y + wysokosc / 2, width: szerokosc, height: wysokosc / 2, color: rgb(1, 1, 1), borderColor: rgb(0.85, 0.83, 0.78), borderWidth: 0.5 })
  strona.drawRectangle({ x, y, width: szerokosc, height: wysokosc / 2, color: rgb(0.831, 0.129, 0.239) })
  return szerokosc
}

function miejsceNaZnak(strona: PDFPage, p: Pisarz, x: number, y: number, wysokosc: number, opis: string): number {
  const szerokosc = wysokosc * 1.9
  strona.drawRectangle({
    x, y, width: szerokosc, height: wysokosc,
    borderColor: rgb(0.72, 0.69, 0.64), borderWidth: 0.8, borderDashArray: [3, 3],
  })
  for (const [i, linia] of opis.split('\n').entries()) {
    strona.drawText(linia, {
      x: x + 6, y: y + wysokosc - 14 - i * 9, size: 6.5, font: p.zwykly, color: rgb(0.42, 0.45, 0.44),
    })
  }
  return szerokosc
}

function pasOznaczen(p: Pisarz): void {
  for (const strona of p.dokument.getPages()) {
    const dolPasa = MARGINES - 30
    strona.drawLine({
      start: { x: MARGINES, y: dolPasa + WYSOKOSC_PASA },
      end: { x: SZEROKOSC - MARGINES, y: dolPasa + WYSOKOSC_PASA },
      thickness: 0.7, color: rgb(0.85, 0.82, 0.78),
    })

    const yZnaku = dolPasa + (WYSOKOSC_PASA - WYSOKOSC_ZNAKU) / 2
    let x = MARGINES
    const odstep = 24

    // 1. Znak Funduszy Europejskich — wyłącznie z pliku źródłowego.
    x += miejsceNaZnak(strona, p, x, yZnaku, WYSOKOSC_ZNAKU, 'Znak Funduszy\nEuropejskich\n— plik źródłowy') + odstep
    // 2. Barwy Rzeczypospolitej Polskiej z podpisem (podpis jest częścią znaku).
    const szerokoscRP = barwyRP(strona, x, yZnaku + 12, WYSOKOSC_ZNAKU - 24)
    strona.drawText('Rzeczpospolita Polska', { x, y: yZnaku + 2, size: 6.5, font: p.zwykly, color: rgb(0.2, 0.22, 0.24) })
    x += Math.max(szerokoscRP, 78) + odstep
    // 3. Flaga Unii Europejskiej z podpisem.
    const szerokoscUE = flagaUE(strona, x, yZnaku + 12, WYSOKOSC_ZNAKU - 24)
    strona.drawText('Dofinansowane przez', { x, y: yZnaku + 9, size: 6.5, font: p.zwykly, color: rgb(0.2, 0.22, 0.24) })
    strona.drawText('Unię Europejską', { x, y: yZnaku + 1, size: 6.5, font: p.zwykly, color: rgb(0.2, 0.22, 0.24) })
    x += Math.max(szerokoscUE, 84) + odstep
    // 4. Nadawca.
    strona.drawText('Forum Związków', { x, y: yZnaku + 30, size: 7.5, font: p.gruby, color: rgb(0.17, 0.18, 0.21) })
    strona.drawText('Zawodowych', { x, y: yZnaku + 21, size: 7.5, font: p.gruby, color: rgb(0.17, 0.18, 0.21) })
    strona.drawText('opracowanie', { x, y: yZnaku + 10, size: 6.5, font: p.zwykly, color: rgb(0.42, 0.45, 0.44) })

    strona.drawText(t('pdf.stopka'), {
      x: MARGINES, y: dolPasa - 10, size: 6.5, font: p.zwykly, color: rgb(0.42, 0.45, 0.44),
    })
  }
}

async function zaczniejDokument(tytul: string): Promise<Pisarz> {
  const fonty = await wczytajFonty()
  const dokument = await PDFDocument.create()
  dokument.registerFontkit(fontkit)
  const zwykly = await dokument.embedFont(fonty.zwykly, { subset: true })
  const gruby = await dokument.embedFont(fonty.gruby, { subset: true })

  dokument.setTitle(tytul)
  dokument.setAuthor('Forum Związków Zawodowych')
  dokument.setSubject('Bezpieczeństwo i higiena pracy')
  dokument.setCreator('BHPewnie — prototyp')
  dokument.setProducer('BHPewnie')
  // Język dokumentu — element dostępności, który da się ustawić w pdf-lib.
  dokument.catalog.set(PDFName.of('Lang'), PDFString.of('pl-PL'))

  const strona = dokument.addPage([SZEROKOSC, WYSOKOSC])
  return { dokument, strona, y: WYSOKOSC - MARGINES, zwykly, gruby }
}

async function zakoncz(p: Pisarz): Promise<Blob> {
  pasOznaczen(p)
  const bajty = await p.dokument.save()
  return new Blob([bajty], { type: 'application/pdf' })
}

/* ---------- Karta moich uprawnień (E1.3) ---------- */

export interface DaneKartyUprawnien {
  opisStanowiska: string
  uprawnienia: { tytul: string; konkret: string; podstawa: string; niepewne: boolean }[]
}

export async function kartaUprawnien(dane: DaneKartyUprawnien): Promise<Blob> {
  const p = await zaczniejDokument('Karta moich uprawnień')

  pisz(p, 'BHPewnie — Forum Związków Zawodowych', { rozmiar: 9, kolor: [0.42, 0.45, 0.44] })
  pisz(p, 'KARTA MOICH UPRAWNIEŃ', { rozmiar: 17, gruby: true, odstepPo: 4 })
  pisz(p, `Stan prawny na ${STAN_PRAWNY}.`, { rozmiar: 9.5, kolor: [0.42, 0.45, 0.44], odstepPo: 8 })
  linia(p)

  poleDoWpisania(p, t('pdf.imie'))
  pisz(p, `Warunki pracy: ${dane.opisStanowiska}`, { rozmiar: 10.5, odstepPo: 10 })
  linia(p)

  pisz(p, 'Co Ci przysługuje', { rozmiar: 13, gruby: true, odstepPo: 6 })
  for (const u of dane.uprawnienia) {
    pisz(p, u.tytul + (u.niepewne ? '  (zależy od pominiętego pytania)' : ''), { rozmiar: 11.5, gruby: true })
    pisz(p, u.konkret, { rozmiar: 11 })
    pisz(p, `Podstawa: ${u.podstawa}`, { rozmiar: 9, kolor: [0.42, 0.45, 0.44], odstepPo: 8 })
  }

  linia(p)
  pisz(p, 'Informacja edukacyjna, nie porada prawna.', { rozmiar: 9, kolor: [0.42, 0.45, 0.44] })
  return zakoncz(p)
}

/* ---------- Wniosek do pracodawcy (E2.5) ---------- */

export interface DaneWniosku {
  tytul: string
  akapity: string[]
  podstawa: string
}

export async function wniosekDoPracodawcy(dane: DaneWniosku): Promise<Blob> {
  const p = await zaczniejDokument(dane.tytul)

  pisz(p, `Miejscowość i data: ……………………………`, { rozmiar: 10, kolor: [0.35, 0.38, 0.37], odstepPo: 6 })
  poleDoWpisania(p, t('pdf.imie'))
  poleDoWpisania(p, 'Stanowisko')
  poleDoWpisania(p, 'Pracodawca')
  linia(p)

  pisz(p, dane.tytul.toUpperCase(), { rozmiar: 14, gruby: true, srodek: true, odstepPo: 10 })
  for (const akapit of dane.akapity) pisz(p, akapit, { rozmiar: 11, odstepPo: 8 })

  pisz(p, `Podstawa prawna: ${dane.podstawa}`, { rozmiar: 10, kolor: [0.35, 0.38, 0.37], odstepPo: 4 })
  pisz(p, `Stan prawny na ${STAN_PRAWNY}.`, { rozmiar: 9, kolor: [0.42, 0.45, 0.44], odstepPo: 18 })

  pisz(p, 'Z poważaniem', { rozmiar: 11, odstepPo: 22 })
  poleDoWpisania(p, t('pdf.podpis'))
  return zakoncz(p)
}

/* ---------- Karta praw po zdarzeniu (E4.6) — ta sama droga co E1.3 ---------- */

export interface DaneKartyPraw {
  naglowek: string
  prawa: { tytul: string; opis: string; podstawa: string }[]
  coDalej: string[]
}

export async function kartaPrawPoZdarzeniu(dane: DaneKartyPraw): Promise<Blob> {
  const p = await zaczniejDokument(dane.naglowek)

  pisz(p, 'BHPewnie — Forum Związków Zawodowych', { rozmiar: 9, kolor: [0.42, 0.45, 0.44] })
  pisz(p, dane.naglowek.toUpperCase(), { rozmiar: 16, gruby: true, odstepPo: 4 })
  pisz(p, `Stan prawny na ${STAN_PRAWNY}.`, { rozmiar: 9.5, kolor: [0.42, 0.45, 0.44], odstepPo: 8 })
  linia(p)

  poleDoWpisania(p, t('pdf.imie'))
  poleDoWpisania(p, 'Data zdarzenia')
  linia(p)

  pisz(p, 'Co Ci przysługuje', { rozmiar: 13, gruby: true, odstepPo: 6 })
  for (const prawo of dane.prawa) {
    pisz(p, prawo.tytul, { rozmiar: 11.5, gruby: true })
    pisz(p, prawo.opis, { rozmiar: 11 })
    pisz(p, `Podstawa: ${prawo.podstawa}`, { rozmiar: 9, kolor: [0.42, 0.45, 0.44], odstepPo: 8 })
  }

  linia(p)
  pisz(p, 'Co zrobić dalej', { rozmiar: 13, gruby: true, odstepPo: 6 })
  for (const krok of dane.coDalej) pisz(p, `— ${krok}`, { rozmiar: 11, odstepPo: 4 })

  return zakoncz(p)
}

/* ---------- Zapis pliku ---------- */

export function zapiszPlik(blob: Blob, nazwa: string): void {
  const url = URL.createObjectURL(blob)
  const odnosnik = document.createElement('a')
  odnosnik.href = url
  odnosnik.download = nazwa
  document.body.appendChild(odnosnik)
  odnosnik.click()
  odnosnik.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
