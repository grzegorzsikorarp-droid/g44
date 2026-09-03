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

/**
 * Grafik na dwoch poziomach (zmiana 1.2, punkt 7).
 * `stale` opisuje rytm „stale godziny” — E5.3a. `kalendarz` opisuje zmiany — E5.3b.
 * Przy przejsciu ze zmian na stale godziny kalendarza NIE KASUJEMY: uzytkownik moze wrocic.
 */
export interface StaleGodziny {
  od: string                 // 'HH:MM'
  do: string                 // 'HH:MM'
  /** Dni tygodnia, w ktore pracujesz: 1 = poniedzialek ... 7 = niedziela. */
  dni: number[]
  /** Odstepstwa: data ISO -> inne godziny albo dzien wolny. */
  odstepstwa: Record<string, { od: string; do: string } | 'wolne'>
}

export interface Grafik {
  szablony: SzablonZmiany[]
  kalendarz: Kalendarz
  /** Okno snu po nocce: od konca zmiany N + opoznienie, przez ilosc godzin. */
  snoPoNocce: { opoznienieMin: number; dlugoscH: number }
  /** Ktory poziom grafiku obowiazuje. Domyslnie 'zmiany' — tak dzialalo wydanie 1.1. */
  rytm?: 'stale' | 'zmiany'
  /** Wypelnione, gdy rytm = 'stale'. */
  stale?: StaleGodziny
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

/**
 * Dopytanie o JEDEN warunek, rozstrzygane na kaflu (zmiana 1.2, punkt 3.2).
 * Zawsze jedno pytanie. Jesli warunek wymaga dwoch pytan, to nie jest kafel,
 * tylko sytuacja z zakladki „Mam sprawe”.
 */
export interface OdpowiedzWarunku {
  tekst: string
  wynik: 'przysluguje' | 'zalezy' | 'nie_przysluguje'
  uzasadnienie: string
  /** Bursztyn: najwyzej dwie rzeczy do sprawdzenia. */
  do_sprawdzenia?: string[]
  /** Szary: co przysluguje zamiast tego — blok obowiazkowy. */
  zamiast?: string[]
}

export interface WarunekKafla {
  pytanie: string
  odpowiedzi: OdpowiedzWarunku[]
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
  /**
   * Jedno pytanie rozstrzygajace warunek. `null` (albo brak pola) = uprawnienie
   * bezwarunkowe, kafel od razu zielony.
   */
  warunek?: WarunekKafla | null
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

/**
 * Szesc stanow kafla (zmiana 1.2, punkt 3.3). Kolejnosc ma znaczenie w sortowaniu:
 * najpierw to, co przysluguje, potem to, co wymaga jednego dotkniecia.
 */
export type StanKafla =
  | 'przysluguje'      // warunek null albo rozstrzygniety na „tak”
  | 'sprawdz_warunek'  // warunek istnieje, nierozstrzygniety
  | 'zalezy'           // rozstrzygniety na „zalezy”
  | 'nie_przysluguje'  // rozstrzygniety na „nie”
  | 'niepewny'         // wynika z pominietego pytania kreatora
  | 'wygaszony'        // parametr po dacie obowiazuje_do bez nastepcy

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
  /** Wyliczony stan kafla — z warunku, pominiec i dat parametrow. */
  stan: StanKafla
  /** Pytanie do rozstrzygniecia na karcie E1.2, gdy stan = sprawdz_warunek. */
  warunek?: WarunekKafla | null
  /** Odpowiedz uzytkownika na warunek — indeks w `warunek.odpowiedzi`. */
  odpowiedz?: OdpowiedzWarunku | null
}

/** Odpowiedzi na warunki kafli: id uprawnienia -> indeks wybranej odpowiedzi. */
export type OdpowiedziWarunkow = Record<string, number>

/* ---------- Sprawdzacze (E2) ---------- */

export type StanWerdyktu = 'przysluguje' | 'zalezy' | 'nie_przysluguje'

export interface PytanieSprawdzacza {
  id: string
  tresc: string
  opcje: { wartosc: string; etykieta: string }[]
  /**
   * Zmiana 1.2, punkt 4.3, sytuacja 3: opcje budowane z CECH PROFILU, a nie wpisane
   * na sztywno. Uzytkownik ma wybierac z tego, co go faktycznie dotyczy — lista
   * pytan o narazenia, ktorych na jego stanowisku nie ma, jest szumem.
   * Etykiety leza w `etykiety_cech` sytuacji, wiec tresc zostaje w danych.
   */
  zrodlo_opcji?: 'cechy_profilu'
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
  /**
   * Zmiana 1.2: ostrzezenie nad akcjami. Uzyte w pakiecie umowy — konsultacja
   * PRZED konfrontacja z pracodawcem jest zasada, nie sugestia.
   */
  ostrzezenie?: string
  /** Zmiana 1.2: trzy akcje wlasne zamiast standardowych (punkt 5.5). */
  akcje_wlasne?: AkcjaWerdyktu[]
  /** Zmiana 1.2: odnosnik do ekranu porownania E2.8. */
  porownanie?: string
  /** Zdanie dodatkowe pod akcjami — np. o pozwie wolnym od oplat. */
  informacja?: string
}

export type RodzajAkcji = 'telefon' | 'kontakt' | 'przypomnienie' | 'ekran'

export interface AkcjaWerdyktu {
  rodzaj: RodzajAkcji
  etykieta: string
  /** Numer telefonu, ekran docelowy albo liczba dni do przypomnienia. */
  wartosc?: string
  opis?: string
  ikona?: string
}

/**
 * Zmiana 1.2, punkt 5.2: sytuacja rozstrzygana punktacja, a nie pojedyncza regula.
 * Silnik liczy, ile cech stosunku pracy zaszlo, i wstawia wynik jako pseudo-odpowiedz
 * `_punkty`, na ktora reaguja zwykle reguly. Dzieki temu tresc zostaje w danych.
 */
export interface PunktacjaSytuacji {
  /** id pytania -> wartosc odpowiedzi, ktora WSKAZUJE na cechy stosunku pracy. */
  cechy: Record<string, string>
  /** id pytania -> zdanie do wyliczenia w uzasadnieniu. */
  opisy: Record<string, string>
  /** Zdanie o braku danej cechy — do bloku „do sprawdzenia” przy bursztynie. */
  opisy_braku?: Record<string, string>
}

export interface Sytuacja {
  id: string
  etykieta: string
  pelna: boolean
  sezonowa?: 'lato' | 'zima'
  pytania?: PytanieSprawdzacza[]
  punktacja?: PunktacjaSytuacji
  /** Etykiety opcji budowanych z cech profilu — klucz to id cechy. */
  etykiety_cech?: Partial<Record<IdCechy, string>>
  /** Ekran informacyjny zamiast pytan, gdy sytuacja nie dotyczy tego uzytkownika. */
  nie_dotyczy?: { gdy_umowa: Umowa[]; naglowek: string; tresc: string }
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
}

export interface ZaplanowanePrzypomnienie {
  budzik: IdBudzika
  nazwa: string
  kiedy: string              // ISO z godzina
  powod: string
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

/* ---------- 6.2. Ewidencja czasu pracy (E7) ---------- */

export interface PrzerwaWpisu {
  od: string                 // 'HH:MM' czasu lokalnego
  do: string | null          // null = przerwa trwa
}

export interface WpisCzasu {
  id: string
  data: string               // ISO 'RRRR-MM-DD'
  od: string                 // 'HH:MM'
  do: string | null          // null = dzien jeszcze otwarty („Zaczynam” bez „Koncze”)
  przerwy: PrzerwaWpisu[]
  uwagi: string
  zrodlo: 'przycisk' | 'reczny'
  utworzono: string
  zmieniono: string
}

/** Wyliczane z wpisu i grafiku — NIGDY nie zapisywane. */
export interface WyliczenieWpisu {
  fakt_min: number
  plan_min: number | null    // null = brak grafiku na ten dzien (B13)
  roznica_min: number | null
  noce_min: number
  przerwy_min: number
  odpoczynek_od_poprzedniego_min: number | null
}

export type RodzajSygnalu =
  | 'odpoczynek_dobowy' | 'odpoczynek_tygodniowy' | 'brak_przerwy'
  | 'brak_drugiej_przerwy' | 'brak_trzeciej_przerwy' | 'tydzien_ponad_48'
  | 'ponad_plan'

export interface Sygnal {
  rodzaj: RodzajSygnalu
  data: string
  opis: string
  podstawa: string
  /** Informacja, nie naruszenie — np. godziny ponad plan. */
  informacyjny?: boolean
}

/* ---------- 6.5. Wyzwalacz zmiany rytmu ---------- */

export interface StanWyzwalaczaRytmu {
  /** ISO dnia ostatniego zapytania — nie pytamy czesciej niz co 30 dni. */
  ostatnio_pytano: string | null
  /** Uzytkownik powiedzial „Zostaw jak jest”. */
  wyciszony_do: string | null
}
