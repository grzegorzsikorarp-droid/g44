import type { Sytuacja, Umowa, Werdykt } from '../typy'
import { wypelnij } from './parametry'
import { sytuacje } from '../dane/wczytaj'

/**
 * Silnik sprawdzaczy. Reguły są DANYMI (content/sytuacje/*.json), nie kodem —
 * redakcja zmienia brzmienie werdyktu bez dotykania komponentów.
 * Wygrywa pierwsza pasująca reguła, więc kolejność w pliku ma znaczenie:
 * od najbardziej szczegółowej do najogólniejszej.
 */

interface Regula {
  gdy: Record<string, string[]>
  umowa?: Umowa[]
  werdykt: Werdykt
}

export function listaSytuacji(): Sytuacja[] {
  return sytuacje()
}

/** Sezonowe na górze w sezonie; poza tym kolejność stała (E2.1). */
export function sytuacjeWKolejnosci(dzien: string): Sytuacja[] {
  const miesiac = Number(dzien.slice(5, 7))
  const lato = miesiac >= 6 && miesiac <= 9
  const zima = miesiac === 12 || miesiac <= 3
  const lista = [...listaSytuacji()]
  return lista.sort((a, b) => waga(a, lato, zima) - waga(b, lato, zima))
}

function waga(s: Sytuacja, lato: boolean, zima: boolean): number {
  if (lato && s.sezonowa === 'lato') return -1
  if (zima && s.sezonowa === 'zima') return -1
  return 0
}

function pasuje(regula: Regula, odpowiedzi: Record<string, string>, umowa: Umowa): boolean {
  if (regula.umowa && !regula.umowa.includes(umowa)) return false
  for (const [pytanie, dopuszczalne] of Object.entries(regula.gdy ?? {})) {
    if (!dopuszczalne.includes(odpowiedzi[pytanie])) return false
  }
  return true
}

/** Wstawia wartości parametrów do wszystkich tekstów werdyktu. */
function wypelnijWerdykt(w: Werdykt, dzien: string): Werdykt {
  return {
    ...w,
    uzasadnienie: wypelnij(w.uzasadnienie, dzien).tekst,
    ile: w.ile.map((x) => wypelnij(x, dzien).tekst),
    do_sprawdzenia: w.do_sprawdzenia?.map((x) => wypelnij(x, dzien).tekst),
  }
}

/* ---------- Punktacja (zmiana 1.2, punkt 5.2) ---------- */

export interface WynikPunktacji {
  punkty: number
  stwierdzone: string[]
  brakujace: string[]
}

/**
 * Liczy cechy stosunku pracy. „Nie wiem” nie jest cechą — liczy się jako zero,
 * ale trafia do listy rzeczy do sprawdzenia, bo to najczęściej brak wiedzy,
 * a nie brak cechy (patrz ROZBIEZNOSCI.md, badanie 3).
 */
export function policzPunkty(s: Sytuacja, odpowiedzi: Record<string, string>): WynikPunktacji | null {
  if (!s.punktacja) return null
  const stwierdzone: string[] = []
  const brakujace: string[] = []
  for (const [pytanie, wskazujaca] of Object.entries(s.punktacja.cechy)) {
    if (odpowiedzi[pytanie] === wskazujaca) {
      stwierdzone.push(s.punktacja.opisy[pytanie] ?? pytanie)
    } else {
      brakujace.push(s.punktacja.opisy_braku?.[pytanie] ?? s.punktacja.opisy[pytanie] ?? pytanie)
    }
  }
  return { punkty: stwierdzone.length, stwierdzone, brakujace }
}

/** Wstawia w treść werdyktu listy cech wyliczone z odpowiedzi. */
function wypelnijCechy(w: Werdykt, wynik: WynikPunktacji): Werdykt {
  const lista = (x: string[]) => (x.length > 0 ? x.join('; ') : 'żadna')
  const podmien = (tekst: string) => tekst
    .replace('{cechy_stwierdzone}', lista(wynik.stwierdzone))
    .replace('{cechy_brakujace}', lista(wynik.brakujace))
    .replace('{punkty}', String(wynik.punkty))
  return {
    ...w,
    uzasadnienie: podmien(w.uzasadnienie),
    ile: w.ile.map(podmien),
    // Bursztyn: dwa najważniejsze brakujące fakty — nie więcej (zasada 7).
    do_sprawdzenia: w.do_sprawdzenia
      ? w.do_sprawdzenia.map(podmien)
      : (w.stan === 'zalezy' ? wynik.brakujace.slice(0, 2) : undefined),
  }
}

export function ocen(
  sytuacja: Sytuacja,
  odpowiedzi: Record<string, string>,
  umowa: Umowa,
  dzien: string,
): Werdykt | null {
  const reguly = ((sytuacja as unknown as { reguly?: Regula[] }).reguly ?? [])
  const wynik = policzPunkty(sytuacja, odpowiedzi)
  // Punktacja wchodzi do reguł jako zwykła pseudo-odpowiedź `_punkty`.
  const zPunktami = wynik ? { ...odpowiedzi, _punkty: String(wynik.punkty) } : odpowiedzi
  const trafiona = reguly.find((r) => pasuje(r, zPunktami, umowa))
  if (!trafiona) return null
  // KOLEJNOŚĆ MA ZNACZENIE: najpierw wstawiamy listy cech, potem parametry.
  // Odwrotnie {cechy_stwierdzone} zostałoby wzięte za nieznany parametr i zastąpione
  // komunikatem „[do uzupełnienia przez specjalistę]”.
  const zCechami = wynik ? wypelnijCechy(trafiona.werdykt, wynik) : trafiona.werdykt
  return wypelnijWerdykt(zCechami, dzien)
}

/**
 * E2.4 — wynik pośredni. Zwraca werdykt tylko wtedy, gdy KONKRETNA reguła
 * (z niepustym `gdy`) jest już w całości rozstrzygnięta, a pytania jeszcze zostały.
 *
 * Reguła zbiorcza `gdy: {}` łapie wszystko, więc pasowałaby już po pierwszej odpowiedzi —
 * i wynik pośredni pojawiałby się zawsze. Dlatego jej tu nie bierzemy pod uwagę.
 * Sytuacje rozstrzygane punktacją (pakiet umowy) też są wyłączone: tam punkty
 * mają sens dopiero po wszystkich sześciu pytaniach.
 */
export function ocenPosrednio(
  sytuacja: Sytuacja,
  odpowiedzi: Record<string, string>,
  umowa: Umowa,
  dzien: string,
): Werdykt | null {
  if (sytuacja.punktacja) return null
  const reguly = ((sytuacja as unknown as { reguly?: Regula[] }).reguly ?? [])
  const trafiona = reguly.find((r) => {
    const klucze = Object.keys(r.gdy ?? {})
    if (klucze.length === 0) return false
    if (!klucze.every((k) => odpowiedzi[k] !== undefined)) return false
    return pasuje(r, odpowiedzi, umowa)
  })
  return trafiona ? wypelnijWerdykt(trafiona.werdykt, dzien) : null
}

/**
 * Czy dla tej sytuacji mamy odpowiedź od razu, bez zadawania pytań?
 * Dotyczy „Pracuję w nocy” i „Nie mam kiedy odpocząć” przy zleceniu —
 * brief wymaga tam uczciwego szarego werdyktu zamiast planszy.
 */
export function werdyktBezPytan(sytuacja: Sytuacja, umowa: Umowa, dzien: string): Werdykt | null {
  if (sytuacja.pelna) return null
  return ocen(sytuacja, {}, umowa, dzien)
}

/** P5: bursztyn ma najwyżej dwie rzeczy do sprawdzenia — pilnujemy tego w kodzie. */
export function doSprawdzenia(w: Werdykt): string[] {
  return (w.do_sprawdzenia ?? []).slice(0, 2)
}
