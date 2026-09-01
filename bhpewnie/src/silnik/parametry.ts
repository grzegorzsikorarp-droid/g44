import type { StanParametru, WierszParametru } from '../typy'
import daneParametrow from '../../content/parametry.json'
import daneWymiaru from '../../content/wymiar-czasu-pracy.json'

const MIESIACE_PL = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
]

export const STAN_PRAWNY: string = (daneParametrow as any).stan_prawny
const WIERSZE = (daneParametrow as any).parametry as WierszParametru[]

export function dzisIso(teraz: Date = new Date()): string {
  return teraz.toISOString().slice(0, 10)
}

/** Wymiar czasu pracy danego miesiaca wg art. 130 KP (plik generowany). */
export function wymiarGodzin(miesiacIso: string): number | null {
  const wiersz = (daneWymiaru as any).miesiace.find((m: any) => m.miesiac === miesiacIso)
  return wiersz ? wiersz.wymiar_godzin : null
}

/**
 * Dodatek za prace w nocy — art. 151(8) KP: 20% stawki godzinowej wynikajacej
 * z minimalnego wynagrodzenia. Stawka godzinowa = minimalne / wymiar czasu pracy
 * DANEGO MIESIACA, wiec dodatek zmienia sie co miesiac (5,22-6,01 zl w 2026).
 */
export function dodatekNocny(dzien: string): { wartosc: number; wymiar: number } | null {
  const miesiac = dzien.slice(0, 7)
  const wymiar = wymiarGodzin(miesiac)
  const minimalne = wartoscLiczbowa('minimalne_wynagrodzenie', dzien)
  if (wymiar === null || minimalne === null) return null
  return { wartosc: Math.round((0.2 * minimalne / wymiar) * 100) / 100, wymiar }
}

function wybierzWiersz(id: string, dzien: string): WierszParametru | null {
  const pasujace = WIERSZE.filter(
    (w) => w.id === id && w.obowiazuje_od <= dzien && (w.obowiazuje_do === null || w.obowiazuje_do >= dzien),
  )
  return pasujace.length > 0 ? pasujace[pasujace.length - 1] : null
}

/** Ostatni znany wiersz, ktory juz wygasl — potrzebny do komunikatu zastepczego. */
function ostatniWygasly(id: string, dzien: string): WierszParametru | null {
  const minione = WIERSZE.filter((w) => w.id === id && w.obowiazuje_do !== null && w.obowiazuje_do < dzien)
    .sort((a, b) => (a.obowiazuje_do! < b.obowiazuje_do! ? -1 : 1))
  return minione.length > 0 ? minione[minione.length - 1] : null
}

/**
 * ZASADA NIEPRZEKRACZALNA NR 9: nigdy nieaktualna liczba jako pewna.
 * Po uplywie 'obowiazuje_do' bez nowego wiersza NIE zwracamy starej wartosci —
 * zwracamy komunikat zastepczy z miesiacem zmiany.
 */
export function parametr(id: string, dzien: string = dzisIso()): StanParametru {
  const wiersz = wybierzWiersz(id, dzien)
  if (wiersz) {
    if (wiersz.wzor === 'dodatek_nocny') {
      const wyliczony = dodatekNocny(dzien)
      if (!wyliczony) {
        return {
          stan: 'brak',
          komunikat: 'Tej wartości jeszcze nie znamy. Uzupełnimy ją, gdy tylko będzie znana.',
        }
      }
      return {
        stan: 'aktualny',
        wartosc: wyliczony.wartosc,
        jednostka: wiersz.jednostka,
        zrodlo: wiersz.zrodlo,
        obowiazuje_od: wiersz.obowiazuje_od,
      }
    }
    return {
      stan: 'aktualny',
      wartosc: wiersz.wartosc,
      jednostka: wiersz.jednostka,
      zrodlo: wiersz.zrodlo,
      obowiazuje_od: wiersz.obowiazuje_od,
    }
  }

  const wygasly = ostatniWygasly(id, dzien)
  if (wygasly) {
    const koniec = new Date(wygasly.obowiazuje_do + 'T00:00:00Z')
    const nastepny = new Date(Date.UTC(koniec.getUTCFullYear(), koniec.getUTCMonth() + 1, 1))
    const miesiac = MIESIACE_PL[nastepny.getUTCMonth()]
    return {
      stan: 'wygasl',
      komunikat: `Ta kwota zmienia się od ${miesiac}. Sprawdzamy nową wartość.`,
      zrodlo: wygasly.zrodlo,
      wygasl_dnia: wygasly.obowiazuje_do!,
    }
  }

  return { stan: 'brak', komunikat: '[do uzupełnienia przez specjalistę]' }
}

function wartoscLiczbowa(id: string, dzien: string): number | null {
  const wiersz = wybierzWiersz(id, dzien)
  if (!wiersz || typeof wiersz.wartosc !== 'number') return null
  return wiersz.wartosc
}

export function sformatujLiczbe(wartosc: number | string): string {
  if (typeof wartosc === 'string') return wartosc
  return Number.isInteger(wartosc)
    ? wartosc.toLocaleString('pl-PL')
    : wartosc.toFixed(2).replace('.', ',')
}

/**
 * Wstawia wartosci parametrow do tekstu kafla: "Dodatek {dodatek_nocny_stawka} za godzine".
 * Jesli ktorykolwiek parametr wygasl, caly tekst zastepuje komunikat (zasada 9)
 * i zwracamy wygasly = true, zeby kafel dostal inne oznaczenie wizualne.
 */
export function wypelnij(
  szablon: string,
  dzien: string = dzisIso(),
): { tekst: string; wygasly: boolean } {
  let wygasly = false
  let komunikatZastepczy = ''
  const tekst = szablon.replace(/\{([a-z0-9_]+)\}/gi, (_dopasowanie, id: string) => {
    const stan = parametr(id, dzien)
    if (stan.stan === 'aktualny') {
      // Po polsku procent pisze się bez spacji („100%”), ale stopnie ze spacją („28 °C”).
      const laczenie = stan.jednostka.startsWith('%') ? '' : ' '
      return `${sformatujLiczbe(stan.wartosc)}${laczenie}${stan.jednostka}`.trim()
    }
    wygasly = true
    komunikatZastepczy = stan.komunikat
    return '…'
  })
  return wygasly ? { tekst: komunikatZastepczy, wygasly: true } : { tekst, wygasly: false }
}

export function datePoPolsku(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return `${d.getUTCDate()} ${MIESIACE_PL[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
