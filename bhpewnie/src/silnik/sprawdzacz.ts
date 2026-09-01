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

export function ocen(
  sytuacja: Sytuacja,
  odpowiedzi: Record<string, string>,
  umowa: Umowa,
  dzien: string,
): Werdykt | null {
  const reguly = ((sytuacja as unknown as { reguly?: Regula[] }).reguly ?? [])
  const trafiona = reguly.find((r) => pasuje(r, odpowiedzi, umowa))
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
