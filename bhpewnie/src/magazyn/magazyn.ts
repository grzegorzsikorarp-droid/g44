import type {
  Grafik, IdBudzika, OdpowiedziWarunkow, Profil, StanWyzwalaczaRytmu, WpisCzasu, WpisDziennika,
} from '../typy'
import { POMINIETE } from '../typy'

/**
 * Zasada nieprzekraczalna nr 1: zero danych na zewnatrz.
 * Jedyne miejsce zapisu to pamiec przegladarki na TYM urzadzeniu.
 * Nie ma kont, nie ma synchronizacji, nie ma zadnego wysylania.
 */

const KLUCZ = 'bhpewnie'
const KLUCZ_PRZYKLAD = 'bhpewnie-przyklad'

export interface StanAplikacji {
  wersja: number
  profil: Profil | null
  budziki: Partial<Record<IdBudzika, boolean>>
  dziennik: WpisDziennika[]
  /** Przerwane sciezki Pomocy — trzymane 7 dni (B7). */
  przerwane: Record<string, { krok: string; kiedy: string }>
  /** Przerwany kreator i sprawdzacz (B7). */
  przerwanyKreator: { nr: number; odpowiedzi: Record<string, unknown> } | null
  /** B11: wersja systemu przy ostatnim uruchomieniu. */
  wersjaSystemu: string | null
  /** B5: strefa czasowa przy ostatnim uruchomieniu. */
  strefa: string | null
  /** B3: kiedy ostatnio pytalismy o zgode na powiadomienia. */
  ostatniaProsbaOZgode: string | null
  /** Data ostatniego udanego odswiezenia prasowki (B2). */
  prasowkaOdswiezona: string | null
  pobraneMaterialy: string[]
  /** Data symulowana — tylko ekran deweloperski, do pokazania zasady 9. */
  dataSymulowana: string | null
  /** Zmiana 1.2: odpowiedzi na warunki kafli — id uprawnienia → nr odpowiedzi. */
  odpowiedziWarunkow: OdpowiedziWarunkow
  /** Zmiana 1.2: ewidencja czasu pracy (E7). Nigdy nigdzie nie wysylana. */
  ewidencja: WpisCzasu[]
  /** Zmiana 1.2: stan wyzwalacza zmiany rytmu (punkt 6.5). */
  wyzwalaczRytmu: StanWyzwalaczaRytmu
  /** Zmiana 1.2: pakiet umowy odlozony na pozniej — kafel staly w E1.1. */
  umowaOdlozona: boolean
}

export function pustyProfil(): Profil {
  return {
    etykieta: null,
    ikona: null,
    odpowiedzi: {
      monitor: POMINIETE, dzwiganie: POMINIETE, teren: POMINIETE, zmiany: POMINIETE,
      pojazd: POMINIETE, kontakt: POMINIETE, glos: POMINIETE, chemia: POMINIETE,
      biologia: POMINIETE, halas: POMINIETE, temperatura: POMINIETE, urazowe: POMINIETE,
      odziez: POMINIETE, samotnie: POMINIETE,
    },
    umowa: POMINIETE,
    rocznik: null,
    niepelnosprawnosc: 'brak_odpowiedzi',
    status: 'brak',
    grafik: null,
    terminy: [],
    miejscowosc: null,
    utworzony: new Date().toISOString(),
  }
}

function pustyStan(): StanAplikacji {
  return {
    wersja: 1,
    profil: null,
    budziki: {},          // Zasada 8: nic domyslnie wlaczone.
    dziennik: [],
    przerwane: {},
    przerwanyKreator: null,
    wersjaSystemu: null,
    strefa: null,
    ostatniaProsbaOZgode: null,
    prasowkaOdswiezona: null,
    pobraneMaterialy: [],
    dataSymulowana: null,
    odpowiedziWarunkow: {},
    ewidencja: [],
    wyzwalaczRytmu: { ostatnio_pytano: null, wyciszony_do: null },
    umowaOdlozona: false,
  }
}

function dostepny(): boolean {
  try {
    const probka = '__bhpewnie__'
    window.localStorage.setItem(probka, '1')
    window.localStorage.removeItem(probka)
    return true
  } catch {
    return false
  }
}

/** Awaryjna pamiec w RAM — gdy przegladarka blokuje zapis (tryb prywatny). */
let awaryjny: Record<string, string> = {}

function czytajSurowo(klucz: string): string | null {
  if (dostepny()) return window.localStorage.getItem(klucz)
  return awaryjny[klucz] ?? null
}

function pisSurowo(klucz: string, wartosc: string): void {
  if (dostepny()) window.localStorage.setItem(klucz, wartosc)
  else awaryjny[klucz] = wartosc
}

function wczytajZ(klucz: string): StanAplikacji {
  try {
    const surowe = czytajSurowo(klucz)
    if (!surowe) return pustyStan()
    return { ...pustyStan(), ...(JSON.parse(surowe) as StanAplikacji) }
  } catch {
    return pustyStan()
  }
}

/* ---------- Tryb przykladu: OSOBNY magazyn, nie nadpisuje profilu uzytkownika ---------- */

let trybPrzykladu = false

export function wlaczTrybPrzykladu(): void { trybPrzykladu = true }
export function wylaczTrybPrzykladu(): void { trybPrzykladu = false }
export function czyTrybPrzykladu(): boolean { return trybPrzykladu }

function aktywnyKlucz(): string {
  return trybPrzykladu ? KLUCZ_PRZYKLAD : KLUCZ
}

export function wczytaj(): StanAplikacji {
  return wczytajZ(aktywnyKlucz())
}

export function zapisz(stan: StanAplikacji): void {
  pisSurowo(aktywnyKlucz(), JSON.stringify(stan))
}

export function zmien(zmiana: (s: StanAplikacji) => StanAplikacji): StanAplikacji {
  const nowy = zmiana(wczytaj())
  zapisz(nowy)
  return nowy
}

/** Czy uzytkownik ma juz wlasny profil (niezaleznie od trybu przykladu). */
export function maWlasnyProfil(): boolean {
  return wczytajZ(KLUCZ).profil !== null
}

export function wyczyscPrzyklad(): void {
  pisSurowo(KLUCZ_PRZYKLAD, JSON.stringify(pustyStan()))
}

/** B7: sciezki Pomocy pamietamy 7 dni, potem zapominamy. */
export function sprzatnijPrzerwane(stan: StanAplikacji, teraz: Date = new Date()): StanAplikacji {
  const granica = new Date(teraz.getTime() - 7 * 86400000).toISOString()
  const przerwane: StanAplikacji['przerwane'] = {}
  for (const [id, wpis] of Object.entries(stan.przerwane)) {
    if (wpis.kiedy >= granica) przerwane[id] = wpis
  }
  return { ...stan, przerwane }
}

/* ---------- 4.5. Profil przykladowy „Barbara” ---------- */

export function grafikBarbary(dzisiaj: Date = new Date()): Grafik {
  const kalendarz: Record<string, string> = {}
  // Rotacja 2-2-3 na 28 dni do przodu: D D N N wolne wolne wolne
  const wzorzec = ['D', 'D', 'N', 'N', '', '', '']
  for (let i = 0; i < 28; i++) {
    const dzien = new Date(dzisiaj.getTime() + i * 86400000)
    const skrot = wzorzec[i % 7]
    if (skrot) kalendarz[dzien.toISOString().slice(0, 10)] = skrot
  }
  return {
    szablony: [
      { skrot: 'D', nazwa: 'Dniówka', od: '07:00', do: '19:00', kolor: '#0e6e62', nocna: false },
      { skrot: 'N', nazwa: 'Nocka', od: '19:00', do: '07:00', kolor: '#233b4a', nocna: true },
    ],
    kalendarz,
    snoPoNocce: { opoznienieMin: 30, dlugoscH: 7 },
  }
}

/**
 * Profil przykladowy z sekcji 4.5 briefu. UWAGA: to nie jest „zawod pielegniarka” —
 * to zestaw CECH stanowiska, ktory akurat odpowiada pracy w ochronie zdrowia.
 */
export function profilBarbary(dzisiaj: Date = new Date()): Profil {
  const zaDni = (n: number) => new Date(dzisiaj.getTime() + n * 86400000).toISOString().slice(0, 10)
  return {
    etykieta: 'Oddział wewnętrzny',
    ikona: null,
    odpowiedzi: {
      monitor: 'do2',
      dzwiganie: 'ludzie',
      teren: false,
      zmiany: 'zmiany_noce',
      pojazd: false,
      kontakt: 'agresja',
      glos: false,
      chemia: true,
      biologia: true,
      halas: false,
      temperatura: false,
      urazowe: true,
      odziez: true,
      samotnie: true,
    },
    umowa: 'o_prace',
    rocznik: 1974,
    niepelnosprawnosc: 'brak_odpowiedzi',
    status: 'medyk',
    grafik: grafikBarbary(dzisiaj),
    terminy: [
      { id: 'badania', nazwa: 'Badania okresowe', data: zaDni(64), przypomnienie: false },
      { id: 'szkolenie', nazwa: 'Szkolenie okresowe BHP', data: zaDni(121), przypomnienie: false },
    ],
    miejscowosc: 'Twoja okolica',
    utworzony: dzisiaj.toISOString(),
  }
}

export function wgrajPrzyklad(dzisiaj: Date = new Date()): void {
  const stan = pustyStan()
  stan.profil = profilBarbary(dzisiaj)
  pisSurowo(KLUCZ_PRZYKLAD, JSON.stringify(stan))
}
