// Model danych BHPewnie. Zasada 3: zawod nie istnieje w systemie —
// jednostka wiedzy jest CECHA STANOWISKA. Nie ma tu i nie moze byc tabeli zawodow.

/* ---------- 4.1. Slownik cech stanowiska (lista zamknieta, 18 pozycji) ---------- */

export type IdCechy =
  | 'monitor' | 'dzwiganie' | 'teren' | 'zmiany' | 'pojazd' | 'kontakt' | 'glos'
  | 'chemia' | 'biologia' | 'halas' | 'temperatura' | 'urazowe' | 'odziez' | 'samotnie'

export type IdModyfikatora = 'umowa' | 'rocznik' | 'niepelnosprawnosc'
export type IdStatusu = 'status'

export type Monitor = 'brak' | 'do2' | 'od2do4' | 'ponad4'
export type Dzwiganie = 'brak' | 'rzeczy' | 'ludzie' | 'oba'
export type Zmiany = 'stale' | 'zmiany' | 'zmiany_noce'
export type Kontakt = 'brak' | 'obsluga' | 'nerwowo' | 'agresja'
export type Umowa = 'o_prace' | 'zlecenie' | 'dzialalnosc'
export type Niepelnosprawnosc = 'tak' | 'nie' | 'brak_odpowiedzi'
export type Status =
  | 'brak' | 'nauczyciel' | 'funkcjonariusz' | 'cywil_w_sluzbie'
  | 'kierowca_zawodowy' | 'medyk' | 'kolejarz' | 'gornik'

/** Wartosc cechy albo jawne pominiecie pytania („Nie wiem — pomin”). */
export const POMINIETE = 'pominiete' as const
export type Pominiete = typeof POMINIETE

export interface OdpowiedziCech {
  monitor: Monitor | Pominiete
  dzwiganie: Dzwiganie | Pominiete
  teren: boolean | Pominiete
  zmiany: Zmiany | Pominiete
  pojazd: boolean | Pominiete
  kontakt: Kontakt | Pominiete
  glos: boolean | Pominiete
  chemia: boolean | Pominiete
  biologia: boolean | Pominiete
  halas: boolean | Pominiete
  temperatura: boolean | Pominiete
  urazowe: boolean | Pominiete
  odziez: boolean | Pominiete
  samotnie: boolean | Pominiete
}

/** Wektor cech po rozwiazaniu pominiec na wartosci bezpieczne. */
export type WektorCech = {
  [K in keyof OdpowiedziCech]: Exclude<OdpowiedziCech[K], Pominiete>
}

/* ---------- 4.4. Grafik ---------- */

export interface SzablonZmiany {
  skrot: string          // D, N, P...
  nazwa: string
  od: string             // 'HH:MM'
  do: string             // 'HH:MM'
  kolor: string
  nocna: boolean         // czy zmiana obejmuje godziny nocne 21:00-7:00
}

/** data ISO 'RRRR-MM-DD' -> skrot szablonu; brak klucza = dzien wolny */
export type Kalendarz = Record<string, string>

export interface Grafik {
  szablony: SzablonZmiany[]
  kalendarz: Kalendarz
  /** Okno snu po nocce: od konca zmiany N + opoznienie, przez ilosc godzin. */
  snoPoNocce: { opoznienieMin: number; dlugoscH: number }
}

/* ---------- Profil ---------- */

export interface Profil {
  /** Dowolna etykieta wpisana przez uzytkownika. NIE jest to zawod z listy. */
  etykieta: string | null
  ikona: string | null
  odpowiedzi: OdpowiedziCech
  umowa: Umowa | Pominiete
  rocznik: number | null
  niepelnosprawnosc: Niepelnosprawnosc
  status: Status
  grafik: Grafik | null
  /** Terminy wpisane przez uzytkownika: badania okresowe, szkolenie BHP. */
  terminy: TerminUzytkownika[]
  /** Miejscowosc do alertow — wpisywana recznie, NIGDY z lokalizacji urzadzenia. */
  miejscowosc: string | null
  utworzony: string
}

export interface TerminUzytkownika {
  id: string
  nazwa: string
  data: string           // ISO
  przypomnienie: boolean
}

/* ---------- 4.3. Parametry zmienne w czasie ---------- */

export interface WierszParametru {
  id: string
  wartosc: number | string
  jednostka: string
  obowiazuje_od: string          // ISO
  obowiazuje_do: string | null   // ISO albo null = bezterminowo
  zrodlo: string
  /** Parametr liczony ze wzoru zamiast stalej wartosci (np. dodatek nocny). */
  wzor?: 'dodatek_nocny'
}

export type StanParametru =
  | { stan: 'aktualny'; wartosc: number | string; jednostka: string; zrodlo: string; obowiazuje_od: string }
  | { stan: 'wygasl'; komunikat: string; zrodlo: string; wygasl_dnia: string }
  | { stan: 'brak'; komunikat: string }

/* ---------- 4.2. Modul wiedzy cechy ---------- */

/** Deklaratywny warunek — TRESC JEST DANA, NIE KODEM (sekcja 3 briefu). */
export interface Warunek {
  cecha?: IdCechy
  modyfikator?: IdModyfikatora
  status?: true
  /** Wartosci, przy ktorych warunek jest spelniony. */
  wartosc_w?: (string | boolean | number)[]
  /** Dla rocznika: wiek nie mniejszy niz. */
  wiek_od?: number
  /** Zaprzeczenie calego warunku. */
  nie?: boolean
}

export interface WarunekZlozony {
  wszystkie?: Warunek[]
  ktorakolwiek?: Warunek[]
}

export interface WariantUprawnienia {
  /** Wariant moze ukryc uprawnienie (np. dodatek nocny przy zleceniu). */
  ukryte?: boolean
  tytul?: string
  konkret?: string
  podstawa?: string
  wyjasnienie?: string
}

export interface Uprawnienie {
  id: string
  tytul: string
  /** Zasada 5: kafel bez konkretu nie istnieje. Moze zawierac {parametr}. */
  konkret: string
  wyjasnienie: string
  podstawa: string
  parametry: string[]
  gdy: WarunekZlozony
  warianty?: Partial<Record<Umowa | Status, WariantUprawnienia>>
  /** Uprawnienie plynie z Kodeksu pracy — u funkcjonariusza nie obowiazuje wprost. */
  zrodlo_kp?: boolean
  /** Id sprawdzacza, do ktorego prowadzi kafel. */
  sprawdzacz?: string
  /** Grupa tematyczna na ekranie glownym — metadana redakcyjna. */
  grupa?: GrupaKafli
  /** Ikona kafla — metadana redakcyjna, domyslnie wynika z cechy. */
  ikona?: string
}

export type GrupaKafli = 'pieniadze' | 'czas' | 'zdrowie' | 'ochrona' | 'zasady' | 'grupa'

export interface ReguleTerminarza {
  nazwa: string
  regula: string
  zdarzenie_poczatkowe: string
}

export interface Metryczka {
  autor: string
  rola: string
  data_opracowania: string
  data_przegladu: string
}

export interface ModulCechy {
  cecha: IdCechy | 'powszechne' | 'status'
  prog: string
  pytanie?: PytanieKreatora
  uprawnienia: Uprawnienie[]
  terminarz?: ReguleTerminarza[]
  alerty?: { id: string; regula: string; tresc: string }[]
  metryczka: Metryczka
}

/* ---------- Kreator ---------- */

export interface OpcjaOdpowiedzi {
  wartosc: string | boolean
  etykieta: string
}

export interface PytanieKreatora {
  id: string
  ekran: string              // E0.2 ... E0.21
  cecha?: IdCechy | IdModyfikatora | IdStatusu
  tresc: string
  przyklady?: string[]
  typ: 'tak_nie' | 'wybor' | 'rocznik' | 'grafik'
  opcje?: OpcjaOdpowiedzi[]
  /** Dopytanie pojawia sie tylko po odpowiedzi twierdzacej. */
  dopytanie?: { tresc: string; opcje: OpcjaOdpowiedzi[] }
  /** Wartosc bezpieczna przy pominieciu: ta, przy ktorej pokazujemy WIECEJ. */
  bezpieczna: string | boolean
  mozna_pominac: boolean
}

/* ---------- Wynik silnika ---------- */

export interface KafelUprawnienia {
  id: string
  tytul: string
  konkret: string
  wyjasnienie: string
  podstawa: string
  cecha: string
  /** Wynika z pominietego pytania — pokazujemy, ale oznaczamy. */
  niepewne: boolean
  /** Parametr wygasl (zasada 9) — zamiast liczby komunikat zastepczy. */
  wygasly: boolean
  stan_prawny: string
  sprawdzacz?: string
  grupa: GrupaKafli
  ikona?: string
}

/* ---------- Sprawdzacze (E2) ---------- */

export type StanWerdyktu = 'przysluguje' | 'zalezy' | 'nie_przysluguje'

export interface PytanieSprawdzacza {
  id: string
  tresc: string
  opcje: { wartosc: string; etykieta: string }[]
}

export interface Werdykt {
  stan: StanWerdyktu
  naglowek: string
  uzasadnienie: string
  ile: string[]
  podstawa: string
  /** Bursztyn: najwyzej 2 rzeczy do sprawdzenia. */
  do_sprawdzenia?: string[]
  /** Szary: uprawnienie pokrewne zamiast slepego zaulka. */
  pokrewne?: { tytul: string; sprawdzacz?: string }
  pismo: { tytul: string; akapity: string[] }
  skrypt: { ustny: string; mail: { temat: string; tresc: string } }
}

export interface Sytuacja {
  id: string
  etykieta: string
  pelna: boolean
  sezonowa?: 'lato' | 'zima'
  pytania?: PytanieSprawdzacza[]
  metryczka?: Metryczka
}

/* ---------- Pomoc (E4) ---------- */

export interface KrokSciezki {
  id: string
  naglowek: string           // tryb rozkazujacy
  tresc: string              // najwyzej 2 zdania
  nie_rob?: string           // ostrzezenie „czego nie robic”
  rozgalezienie?: {
    pytanie: string
    opcje: { etykieta: string; idzDo: string }[]
  }
}

export interface SciezkaPomocy {
  id: string
  etykieta: string
  pelna: boolean
  kroki: KrokSciezki[]
  zamkniecie?: { naglowek: string; tresc: string[]; karta_praw?: string }
  metryczka?: Metryczka
}

/* ---------- Budziki (E5.4) ---------- */

export type IdBudzika =
  | 'przerwa_monitor' | 'protokol_przed_nocka' | 'cisza_po_nocce' | 'badania_okresowe'
  | 'szkolenie_bhp' | 'alert_pogodowy' | 'nowa_stawka_nocna' | 'wejscie_przepisu'
  | 'powrot_po_pomocy' | 'prasowka'

export interface DefinicjaBudzika {
  id: IdBudzika
  nazwa: string
  regula: string
  grupa: 'rytm' | 'terminy' | 'otoczenie' | 'aktualnosci'
  /** Cisza po nocce nie ma przelacznika — liczy sie sama z grafiku. */
  automatyczny?: boolean
  widoczny_gdy?: WarunekZlozony
  /** Pierwszenstwo przy sufcie 3 powiadomien na dobe (mniejsza liczba = wazniejsze). */
  pierwszenstwo: number
}

export interface ZaplanowanePrzypomnienie {
  budzik: IdBudzika
  nazwa: string
  kiedy: string              // ISO z godzina
  powod: string
  /** Odrzucone przez sufit 3/dobe — pokazujemy to w podgladzie harmonogramu. */
  odrzucone?: boolean
}

/* ---------- Dzienniki (E4.7-E4.9) ---------- */

export interface WpisDziennika {
  id: string
  rodzaj: 'zdarzenie' | 'prawie_wypadek'
  data: string
  godzina: string
  opis: string
  swiadkowie: string
  /** Tylko dla prawie-wypadku: co moglo sie stac. */
  co_moglo?: string
  utworzony: string
}
