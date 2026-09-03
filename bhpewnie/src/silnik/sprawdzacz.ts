import type { PytanieSprawdzacza, Sytuacja, Umowa, Werdykt } from '../typy'
import type { RozwiazanyProfil } from './reguly'
import { parametr, wypelnij } from './parametry'
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

/**
 * Wstawia wartości parametrów do wszystkich tekstów werdyktu — nagłówek włącznie,
 * bo próg bywa tym, co w nagłówku ma stać („Przysługuje Ci {temperatura_min_biurowa}”).
 */
function wypelnijWerdykt(w: Werdykt, dzien: string): Werdykt {
  return {
    ...w,
    naglowek: wypelnij(w.naglowek, dzien).tekst,
    uzasadnienie: wypelnij(w.uzasadnienie, dzien).tekst,
    ile: w.ile.map((x) => wypelnij(x, dzien).tekst),
    do_sprawdzenia: w.do_sprawdzenia?.map((x) => wypelnij(x, dzien).tekst),
  }
}

/* ---------- Punktacja (zmiana 1.2, punkt 5.2) ---------- */


/**
 * ZMIANA 1.3 — pytania warunkowe. Lista pytań widocznych przy danym komplecie
 * odpowiedzi. Warunek `gdy` czyta się tak samo jak w regułach werdyktu.
 */
export function widocznePytania(s: Sytuacja, odpowiedzi: Record<string, string>): PytanieSprawdzacza[] {
  return (s.pytania ?? []).filter((p) => !p.gdy
    || Object.entries(p.gdy).every(([pytanie, dopuszczalne]) => dopuszczalne.includes(odpowiedzi[pytanie])))
}

/**
 * ZMIANA 1.3, sekcja 4 — przeliczenie ciasnoty.
 *
 * Uzytkownik nie podaje liczb, tylko PRZEDZIALY („3–5 osob”, „10–20 m²”), bo
 * nikt nie zna kubatury swojego pokoju z dokladnoscia do metra. Liczymy wiec
 * oba konce przedzialu i rozrozniamy trzy odpowiedzi:
 *   `ponizej`  — norma jest przekroczona przy KAZDYM ukladzie liczb z przedzialow,
 *   `granica`  — moze byc przekroczona, zalezy od dokladnych wymiarow,
 *   `powyzej`  — nie jest przekroczona przy zadnym ukladzie.
 * Brak ktorejkolwiek odpowiedzi daje `nieznane`.
 *
 * Nie zaokraglamy na korzysc zadnej ze stron: przedzial wyniku podajemy wprost,
 * a wartosci norm nosza oznaczenie zrodla wymagajace potwierdzenia.
 */
export type StanCiasnoty = 'ponizej' | 'granica' | 'powyzej' | 'nieznane'

export interface WynikCiasnoty {
  stan: StanCiasnoty
  kubatura: [number, number]
  powierzchnia: [number, number]
}

function zakresOdpowiedzi(p: PytanieSprawdzacza | undefined, wartosc: string | undefined): [number, number] | null {
  const opcja = p?.opcje.find((o) => o.wartosc === wartosc)
  return opcja?.zakres ?? null
}

export function policzCiasnote(
  s: Sytuacja,
  odpowiedzi: Record<string, string>,
  dzien: string,
): WynikCiasnoty | null {
  const w = s.wyliczenie_ciasnoty
  if (!w) return null
  const pytanie = (id: string) => s.pytania?.find((p) => p.id === id)
  const osoby = zakresOdpowiedzi(pytanie(w.osoby), odpowiedzi[w.osoby])
  const pow = zakresOdpowiedzi(pytanie(w.powierzchnia), odpowiedzi[w.powierzchnia])
  const wys = zakresOdpowiedzi(pytanie(w.wysokosc), odpowiedzi[w.wysokosc])
  if (!osoby || !pow || !wys) return null

  const normaK = parametr(w.norma_kubatura, dzien)
  const normaP = parametr(w.norma_powierzchnia, dzien)
  // Norma wygasła albo nieznana — nie liczymy, zamiast liczyć na starej wartości (zasada 9).
  if (normaK.stan !== 'aktualny' || normaP.stan !== 'aktualny'
    || typeof normaK.wartosc !== 'number' || typeof normaP.wartosc !== 'number') {
    return { stan: 'nieznane', kubatura: [0, 0], powierzchnia: [0, 0] }
  }
  const progK = normaK.wartosc
  const progP = normaP.wartosc

  // Najgorszy uklad: najmniejsze pomieszczenie i najwiecej osob. Najlepszy: odwrotnie.
  const kubatura: [number, number] = [(pow[0] * wys[0]) / osoby[1], (pow[1] * wys[1]) / osoby[0]]
  const powierzchnia: [number, number] = [pow[0] / osoby[1], pow[1] / osoby[0]]

  const zaMaloZawsze = kubatura[1] < progK || powierzchnia[1] < progP
  const doscZawsze = kubatura[0] >= progK && powierzchnia[0] >= progP
  return {
    stan: zaMaloZawsze ? 'ponizej' : doscZawsze ? 'powyzej' : 'granica',
    kubatura,
    powierzchnia,
  }
}

/** „13–21 m³” albo „13 m³”, gdy oba konce sa takie same po zaokragleniu. */
function opiszZakres(z: [number, number], jednostka: string): string {
  const a = Math.round(z[0] * 10) / 10
  const b = Math.round(z[1] * 10) / 10
  const liczba = (x: number) => String(x).replace('.', ',')
  return a === b ? `${liczba(a)} ${jednostka}` : `${liczba(a)}–${liczba(b)} ${jednostka}`
}

/** Wstawia wyliczone przedzialy do tekstow werdyktu — przed podstawieniem parametrow. */
function wypelnijCiasnote(w: Werdykt, wynik: WynikCiasnoty): Werdykt {
  const podmien = (tekst: string) => tekst
    .replace('{kubatura_na_osobe}', opiszZakres(wynik.kubatura, 'm³'))
    .replace('{powierzchnia_na_osobe}', opiszZakres(wynik.powierzchnia, 'm²'))
  return {
    ...w,
    naglowek: podmien(w.naglowek),
    uzasadnienie: podmien(w.uzasadnienie),
    ile: w.ile.map(podmien),
    do_sprawdzenia: w.do_sprawdzenia?.map(podmien),
  }
}

/**
 * ZMIANA 1.3, sekcja 2 — próg niewiedzy w pakiecie umowy.
 * Trzy odpowiedzi „Nie wiem” na sześć pytań znaczą, że nie wiadomo dość, żeby
 * cokolwiek rozstrzygać. Reszta aplikacji przy pominiętym pytaniu przyjmuje
 * wartość bezpieczną i pokazuje WIĘCEJ, nie mniej; zdanie „nic nie musisz robić”
 * powiedziane komuś, kto sześć razy odpowiedział „nie wiem”, łamałoby tę zasadę.
 * Sam próg stoi w regule w `content/sytuacje/08-umowa.json` (`_nie_wiem`) —
 * tutaj tylko liczba, po której budujemy blok „co sprawdzić”.
 */
export const PROG_NIEWIEDZY = 3

export interface WynikPunktacji {
  punkty: number
  stwierdzone: string[]
  brakujace: string[]
  /** Zmiana 1.3: pytania, na które padło wprost „Nie wiem” — osobno od zwykłych braków. */
  niewiadome: string[]
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
  const niewiadome: string[] = []
  for (const [pytanie, wskazujaca] of Object.entries(s.punktacja.cechy)) {
    const opisBraku = s.punktacja.opisy_braku?.[pytanie] ?? s.punktacja.opisy[pytanie] ?? pytanie
    if (odpowiedzi[pytanie] === wskazujaca) {
      stwierdzone.push(s.punktacja.opisy[pytanie] ?? pytanie)
    } else {
      brakujace.push(opisBraku)
      // „Nie wiem” to co innego niż odpowiedź przecząca: przecząca jest wiedzą,
      // „nie wiem” jest jej brakiem. Zmiana 1.3 rozdziela te dwie rzeczy.
      if (odpowiedzi[pytanie] === 'nie_wiem') niewiadome.push(opisBraku)
    }
  }
  return { punkty: stwierdzone.length, stwierdzone, brakujace, niewiadome }
}

/** Wstawia w treść werdyktu listy cech wyliczone z odpowiedzi. */
function wypelnijCechy(w: Werdykt, wynik: WynikPunktacji): Werdykt {
  const lista = (x: string[]) => (x.length > 0 ? x.join('; ') : 'żadna')
  const podmien = (tekst: string) => tekst
    .replace('{cechy_stwierdzone}', lista(wynik.stwierdzone))
    .replace('{cechy_brakujace}', lista(wynik.brakujace))
    .replace('{punkty}', String(wynik.punkty))
    .replace('{niewiadome}', String(wynik.niewiadome.length))
  return {
    ...w,
    uzasadnienie: podmien(w.uzasadnienie),
    ile: w.ile.map(podmien),
    // Bursztyn: dwa najważniejsze brakujące fakty — nie więcej (zasada 7).
    // Gdy werdykt powstał z niewiedzy (zmiana 1.3, sekcja 2), listę budujemy
    // z pytań, na które padło „Nie wiem” — a nie ze wszystkich braków.
    do_sprawdzenia: w.do_sprawdzenia
      ? w.do_sprawdzenia.map(podmien)
      : (w.stan === 'zalezy'
        ? (wynik.niewiadome.length >= PROG_NIEWIEDZY ? wynik.niewiadome : wynik.brakujace).slice(0, 2)
        : undefined),
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
  // Punktacja wchodzi do reguł jako zwykła pseudo-odpowiedź `_punkty`;
  // liczba „nie wiem” tak samo, jako `_nie_wiem` (zmiana 1.3, sekcja 2).
  // Dzięki temu reguła progowa leży w danych, a nie w kodzie silnika.
  const zPunktami = wynik
    ? { ...odpowiedzi, _punkty: String(wynik.punkty), _nie_wiem: String(wynik.niewiadome.length) }
    : odpowiedzi
  // Ciasnota wchodzi tą samą drogą co punktacja: jako pseudo-odpowiedź w regułach.
  const ciasnota = policzCiasnote(sytuacja, odpowiedzi, dzien)
  const zCiasnota = ciasnota ? { ...zPunktami, _ciasnota: ciasnota.stan } : zPunktami
  const trafiona = reguly.find((r) => pasuje(r, zCiasnota, umowa))
  if (!trafiona) return null
  // KOLEJNOŚĆ MA ZNACZENIE: najpierw wstawiamy listy cech, potem parametry.
  // Odwrotnie {cechy_stwierdzone} zostałoby wzięte za nieznany parametr i zastąpione
  // komunikatem „[do uzupełnienia przez specjalistę]”.
  const zCechami = wynik ? wypelnijCechy(trafiona.werdykt, wynik) : trafiona.werdykt
  const zLiczbami = ciasnota ? wypelnijCiasnote(zCechami, ciasnota) : zCechami
  return wypelnijWerdykt(zLiczbami, dzien)
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

/**
 * Buduje opcje pytania z cech, które na TYM stanowisku są aktywne (punkt 4.3, sytuacja 3).
 * Cecha nieaktywna („nie pracuję z chemią”) nie ma po co stać na liście — a pominięta
 * w kreatorze zostaje, bo wartość bezpieczna każe pokazywać więcej, nie mniej.
 *
 * Opcje własne sytuacji (np. „Czegoś innego”) zawsze zamykają listę.
 */
export function opcjeZCech(
  sytuacja: Sytuacja,
  pytanie: PytanieSprawdzacza,
  profil: RozwiazanyProfil,
): { wartosc: string; etykieta: string }[] {
  if (pytanie.zrodlo_opcji !== 'cechy_profilu') return pytanie.opcje
  const etykiety = sytuacja.etykiety_cech ?? {}
  const zCech = (Object.keys(etykiety) as (keyof typeof etykiety)[])
    .filter((cecha) => {
      const wartosc = profil.wektor[cecha as keyof typeof profil.wektor]
      return wartosc !== false && wartosc !== 'brak'
    })
    .map((cecha) => ({ wartosc: String(cecha), etykieta: etykiety[cecha]! }))
  return [...zCech, ...pytanie.opcje]
}

/** P5: bursztyn ma najwyżej dwie rzeczy do sprawdzenia — pilnujemy tego w kodzie. */
export function doSprawdzenia(w: Werdykt): string[] {
  return (w.do_sprawdzenia ?? []).slice(0, 2)
}
