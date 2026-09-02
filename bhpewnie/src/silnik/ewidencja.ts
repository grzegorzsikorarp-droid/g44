import type {
  Grafik, Profil, RodzajSygnalu, Sygnal, WpisCzasu, WyliczenieWpisu,
} from '../typy'
import { dodajDni, iso, poczatekTygodnia, ramyZmiany, szablonDnia } from './grafik'

/**
 * EWIDENCJA CZASU PRACY (zmiana 1.2, punkt 6).
 *
 * Grafik to plan. Ewidencja to fakt. Ten plik liczy jedno wobec drugiego i wskazuje
 * to, co dla bezpieczeństwa pracy istotne: naruszenia odpoczynku, brak przerw,
 * godziny ponad wymiar.
 *
 * Czego tu NIE MA i nie może być (punkt 11): wynagrodzenia, stawek, dodatków
 * za nadgodziny. Liczymy godziny, nie pieniądze — reszta jest poza zakresem BHP.
 *
 * Wszystko liczy się na urządzeniu i nigdzie nie jest wysyłane.
 */

/* ---------- Godziny nocne ---------- */

/** Domyślne godziny nocne wg Kodeksu pracy: osiem godzin między 21:00 a 7:00. */
export const NOC_OD = 21
export const NOC_DO = 7

/* ---------- Pomocnicze: minuty od północy ---------- */

export function minuty(godzina: string): number {
  const [g, m] = godzina.split(':').map(Number)
  return g * 60 + (m || 0)
}

export function zMinut(min: number): string {
  const g = Math.floor(((min % 1440) + 1440) % 1440 / 60)
  const m = Math.round(((min % 1440) + 1440) % 1440 % 60)
  return `${String(g).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** „6 h 20 min” — zapis, którym mówimy o czasie pracy w całej aplikacji. */
export function opiszCzas(min: number): string {
  const znak = min < 0 ? '−' : ''
  const bez = Math.abs(Math.round(min))
  const g = Math.floor(bez / 60)
  const m = bez % 60
  if (g === 0) return `${znak}${m} min`
  if (m === 0) return `${znak}${g} h`
  return `${znak}${g} h ${m} min`
}

/* ---------- Ramy jednego wpisu ---------- */

/**
 * Wpis kończący się przed swoim początkiem przechodzi przez północ.
 * Zwracamy znaczniki czasu, żeby porównania działały też dla nocek.
 *
 * Badanie 5 z punktu 10 (zmiana czasu urzędowego): koniec liczymy jako TĘ SAMĄ GODZINĘ
 * NASTĘPNEGO DNIA, a nie „plus 24 godziny”. W nocy zmiany czasu doba ma 23 albo 25 godzin,
 * więc dodanie 86 400 000 ms dawało wynik krótszy (albo dłuższy) o godzinę od faktu.
 */
export function ramyWpisu(wpis: WpisCzasu): { start: Date; koniec: Date | null } {
  const start = new Date(`${wpis.data}T${wpis.od}:00`)
  if (!wpis.do) return { start, koniec: null }
  let koniec = new Date(`${wpis.data}T${wpis.do}:00`)
  if (koniec <= start) {
    const nastepny = new Date(`${wpis.data}T12:00:00`)
    nastepny.setDate(nastepny.getDate() + 1)
    koniec = new Date(`${iso(nastepny)}T${wpis.do}:00`)
  }
  return { start, koniec }
}

/** Ile minut wpisu przypada na godziny nocne. Liczone po minucie, bez skrótów. */
export function minutyNocne(wpis: WpisCzasu): number {
  const { start, koniec } = ramyWpisu(wpis)
  if (!koniec) return 0
  let suma = 0
  for (let t = start.getTime(); t < koniec.getTime(); t += 60000) {
    const g = new Date(t).getHours()
    if (g >= NOC_OD || g < NOC_DO) suma++
  }
  return suma
}

export function minutyPrzerw(wpis: WpisCzasu): number {
  let suma = 0
  for (const p of wpis.przerwy) {
    if (!p.do) continue
    let d = minuty(p.do) - minuty(p.od)
    if (d < 0) d += 1440
    suma += d
  }
  return suma
}

/** Plan z grafiku na dany dzień — w minutach. `null`, gdy grafiku nie ma (B13). */
export function planNaDzien(grafik: Grafik | null, dzien: string): number | null {
  if (!grafik) return null
  const szablon = szablonDnia(grafik, dzien)
  if (!szablon) return 0            // dzień wolny w grafiku to plan zerowy, nie brak planu
  const { start, koniec } = ramyZmiany(dzien, szablon)
  return Math.round((koniec.getTime() - start.getTime()) / 60000)
}

/**
 * Wylicza wszystko, czego nie zapisujemy: fakt, plan, różnicę, noc, przerwy
 * i odpoczynek od poprzedniego wpisu.
 */
export function wyliczWpis(
  wpis: WpisCzasu,
  grafik: Grafik | null,
  poprzedni: WpisCzasu | null,
): WyliczenieWpisu {
  const { start, koniec } = ramyWpisu(wpis)
  const przerwy_min = minutyPrzerw(wpis)
  const brutto = koniec ? Math.round((koniec.getTime() - start.getTime()) / 60000) : 0
  const plan_min = planNaDzien(grafik, wpis.data)

  let odpoczynek: number | null = null
  if (poprzedni) {
    const poprz = ramyWpisu(poprzedni)
    if (poprz.koniec) odpoczynek = Math.round((start.getTime() - poprz.koniec.getTime()) / 60000)
  }

  const fakt_min = Math.max(0, brutto - przerwy_min)
  return {
    fakt_min,
    plan_min,
    roznica_min: plan_min === null ? null : fakt_min - plan_min,
    noce_min: minutyNocne(wpis),
    przerwy_min,
    odpoczynek_od_poprzedniego_min: odpoczynek,
  }
}

/* ---------- Zakresy ---------- */

export function wpisyDnia(ewidencja: WpisCzasu[], dzien: string): WpisCzasu[] {
  return ewidencja.filter((w) => w.data === dzien).sort((a, b) => a.od.localeCompare(b.od))
}

export function wpisyOd(ewidencja: WpisCzasu[], od: string, doDnia: string): WpisCzasu[] {
  return ewidencja
    .filter((w) => w.data >= od && w.data <= doDnia)
    .sort((a, b) => (a.data + a.od).localeCompare(b.data + b.od))
}

export function zakresTygodnia(dzien: string): { od: string; do: string } {
  const poniedzialek = poczatekTygodnia(new Date(dzien + 'T12:00:00'))
  return { od: iso(poniedzialek), do: iso(dodajDni(poniedzialek, 6)) }
}

export function zakresMiesiaca(dzien: string): { od: string; do: string } {
  const rok = Number(dzien.slice(0, 4))
  const miesiac = Number(dzien.slice(5, 7))
  const ostatni = new Date(rok, miesiac, 0).getDate()
  return { od: `${dzien.slice(0, 7)}-01`, do: `${dzien.slice(0, 7)}-${String(ostatni).padStart(2, '0')}` }
}

export interface PodsumowanieZakresu {
  fakt_min: number
  plan_min: number | null
  ponad_plan_min: number | null
  noce_min: number
  przerwy_min: number
  dni_z_sygnalem: number
}

export function podsumuj(
  wpisy: WpisCzasu[],
  grafik: Grafik | null,
  sygnaly: Sygnal[] = [],
): PodsumowanieZakresu {
  let fakt = 0
  let noce = 0
  let przerwy = 0
  let plan = 0
  let znamyPlan = grafik !== null
  for (const w of wpisy) {
    const wy = wyliczWpis(w, grafik, null)
    fakt += wy.fakt_min
    noce += wy.noce_min
    przerwy += wy.przerwy_min
    if (wy.plan_min === null) znamyPlan = false
    else plan += wy.plan_min
  }
  return {
    fakt_min: fakt,
    plan_min: znamyPlan ? plan : null,
    ponad_plan_min: znamyPlan ? Math.max(0, fakt - plan) : null,
    noce_min: noce,
    przerwy_min: przerwy,
    dni_z_sygnalem: new Set(sygnaly.filter((s) => !s.informacyjny).map((s) => s.data)).size,
  }
}

/* ---------- Sygnały (E7.4) ---------- */

const PODSTAWY: Record<RodzajSygnalu, string> = {
  odpoczynek_dobowy: 'art. 132 Kodeksu pracy',
  odpoczynek_tygodniowy: 'art. 133 Kodeksu pracy',
  brak_przerwy: 'art. 134 Kodeksu pracy',
  brak_drugiej_przerwy: 'art. 134 Kodeksu pracy',
  brak_trzeciej_przerwy: 'art. 134 Kodeksu pracy',
  tydzien_ponad_48: 'art. 131 Kodeksu pracy',
  ponad_plan: 'ewidencja własna — informacja, nie naruszenie',
}

const DNI_PL = ['niedzielę', 'poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę']

function dzienSlownie(dzien: string): string {
  const d = new Date(dzien + 'T12:00:00')
  return `${DNI_PL[d.getDay()]} ${Number(dzien.slice(8, 10))}.${dzien.slice(5, 7)}`
}

/**
 * Wykrywa sygnały w zadanym zakresie.
 *
 * Dla statusu `funkcjonariusz` sygnały kodeksowe są WYŁĄCZONE: odpoczynek i przerwy
 * regulują pragmatyki służbowe, których prototyp nie zna. Zostają godziny ponad plan
 * — z dopiskiem o rekompensacie właściwej formacji.
 */
export function wykryjSygnaly(
  wpisy: WpisCzasu[],
  grafik: Grafik | null,
  profil: Profil | null,
): Sygnal[] {
  const sygnaly: Sygnal[] = []
  const funkcjonariusz = profil?.status === 'funkcjonariusz'
  const uporzadkowane = [...wpisy].sort((a, b) => (a.data + a.od).localeCompare(b.data + b.od))

  for (let i = 0; i < uporzadkowane.length; i++) {
    const w = uporzadkowane[i]
    const wy = wyliczWpis(w, grafik, i > 0 ? uporzadkowane[i - 1] : null)
    if (!w.do) continue

    if (!funkcjonariusz) {
      // Odpoczynek dobowy: 11 godzin nieprzerwanego odpoczynku.
      if (wy.odpoczynek_od_poprzedniego_min !== null && wy.odpoczynek_od_poprzedniego_min < 11 * 60) {
        sygnaly.push({
          rodzaj: 'odpoczynek_dobowy',
          data: w.data,
          opis: `Między ${dzienSlownie(uporzadkowane[i - 1].data)} a ${dzienSlownie(w.data)} `
            + `miałeś tylko ${opiszCzas(wy.odpoczynek_od_poprzedniego_min)} odpoczynku. Przysługuje 11 h.`,
          podstawa: PODSTAWY.odpoczynek_dobowy,
        })
      }

      // Przerwy w dniówce: 15 minut od 6 h, druga od 9 h, trzecia od 16 h.
      const zapisane = w.przerwy.filter((p) => p.do).length
      if (wy.fakt_min >= 6 * 60 && zapisane === 0) {
        sygnaly.push({
          rodzaj: 'brak_przerwy',
          data: w.data,
          opis: `W ${dzienSlownie(w.data)} przepracowałeś ${opiszCzas(wy.fakt_min)} bez zapisanej przerwy. `
            + 'Przy dniówce od 6 h przysługuje 15 minut wliczane do czasu pracy. '
            + 'Jeśli miałeś przerwę, dodaj ją do wpisu.',
          podstawa: PODSTAWY.brak_przerwy,
        })
      } else if (wy.fakt_min > 9 * 60 && zapisane < 2) {
        sygnaly.push({
          rodzaj: 'brak_drugiej_przerwy',
          data: w.data,
          opis: `W ${dzienSlownie(w.data)} dniówka przekroczyła 9 h. Przysługuje druga przerwa 15 minut.`,
          podstawa: PODSTAWY.brak_drugiej_przerwy,
        })
      }
      if (wy.fakt_min > 16 * 60 && zapisane < 3) {
        sygnaly.push({
          rodzaj: 'brak_trzeciej_przerwy',
          data: w.data,
          opis: `W ${dzienSlownie(w.data)} dniówka przekroczyła 16 h. Przysługuje trzecia przerwa 15 minut.`,
          podstawa: PODSTAWY.brak_trzeciej_przerwy,
        })
      }
    }
  }

  // Tygodniowo: odpoczynek 35 h i przeciętne 48 h.
  const tygodnie = new Map<string, WpisCzasu[]>()
  for (const w of uporzadkowane) {
    const klucz = zakresTygodnia(w.data).od
    if (!tygodnie.has(klucz)) tygodnie.set(klucz, [])
    tygodnie.get(klucz)!.push(w)
  }

  for (const [poczatek, wTygodniu] of tygodnie) {
    const suma = wTygodniu.reduce((s, w) => s + wyliczWpis(w, grafik, null).fakt_min, 0)
    if (!funkcjonariusz && suma > 48 * 60) {
      sygnaly.push({
        rodzaj: 'tydzien_ponad_48',
        data: poczatek,
        opis: `W tygodniu od ${dzienSlownie(poczatek)} wyszło ${opiszCzas(suma)}. `
          + 'Tygodniowy czas pracy nie powinien przeciętnie przekraczać 48 h. '
          + 'Liczymy orientacyjnie, dla jednego tygodnia — przepis mówi o przeciętnej w okresie rozliczeniowym.',
        podstawa: PODSTAWY.tydzien_ponad_48,
      })
    }

    if (!funkcjonariusz) {
      const najdluzszaPrzerwa = najdluzszyOdpoczynek(wTygodniu)
      if (najdluzszaPrzerwa !== null && najdluzszaPrzerwa < 35 * 60 && wTygodniu.length >= 5) {
        sygnaly.push({
          rodzaj: 'odpoczynek_tygodniowy',
          data: poczatek,
          opis: `W tygodniu od ${dzienSlownie(poczatek)} najdłuższa przerwa między dniówkami `
            + `wyniosła ${opiszCzas(najdluzszaPrzerwa)}. Tygodniowy odpoczynek to 35 h.`,
          podstawa: PODSTAWY.odpoczynek_tygodniowy,
        })
      }
    }

    // Godziny ponad plan — informacja, nie naruszenie. Działa tylko z grafikiem (B13).
    const podsumowanie = podsumuj(wTygodniu, grafik)
    if (podsumowanie.ponad_plan_min !== null && podsumowanie.ponad_plan_min > 0) {
      sygnaly.push({
        rodzaj: 'ponad_plan',
        data: poczatek,
        opis: `W tygodniu od ${dzienSlownie(poczatek)} przepracowałeś ${opiszCzas(podsumowanie.ponad_plan_min)} `
          + 'ponad plan z grafiku.'
          + (funkcjonariusz
            ? ' Zasady rekompensaty określa pragmatyka Twojej formacji [do uzupełnienia przez specjalistę od pragmatyk].'
            : ''),
        podstawa: PODSTAWY.ponad_plan,
        informacyjny: true,
      })
    }
  }

  return sygnaly.sort((a, b) => a.data.localeCompare(b.data))
}

/** Najdłuższa przerwa między kolejnymi dniówkami w zestawie wpisów. */
function najdluzszyOdpoczynek(wpisy: WpisCzasu[]): number | null {
  const uporzadkowane = [...wpisy].sort((a, b) => (a.data + a.od).localeCompare(b.data + b.od))
  let najdluzszy: number | null = null
  for (let i = 1; i < uporzadkowane.length; i++) {
    const poprz = ramyWpisu(uporzadkowane[i - 1])
    const ten = ramyWpisu(uporzadkowane[i])
    if (!poprz.koniec) continue
    const przerwa = Math.round((ten.start.getTime() - poprz.koniec.getTime()) / 60000)
    if (najdluzszy === null || przerwa > najdluzszy) najdluzszy = przerwa
  }
  return najdluzszy
}

/* ---------- Walidacja wpisu ręcznego (E7.2) ---------- */

export interface WynikWalidacji {
  bledy: string[]
  ostrzezenia: string[]
}

export function sprawdzWpis(wpis: WpisCzasu): WynikWalidacji {
  const bledy: string[] = []
  const ostrzezenia: string[] = []

  if (!/^\d{2}:\d{2}$/.test(wpis.od)) bledy.push('Podaj godzinę rozpoczęcia w formacie 08:00.')
  if (wpis.do && !/^\d{2}:\d{2}$/.test(wpis.do)) bledy.push('Podaj godzinę zakończenia w formacie 16:00.')
  if (bledy.length > 0) return { bledy, ostrzezenia }

  const { start, koniec } = ramyWpisu(wpis)
  if (koniec && koniec.getTime() === start.getTime()) {
    bledy.push('Godzina zakończenia musi być inna niż rozpoczęcia.')
  }

  const dlugosc = koniec ? (koniec.getTime() - start.getTime()) / 60000 : 0

  for (const p of wpis.przerwy) {
    if (!p.do) continue
    let dlugoscPrzerwy = minuty(p.do) - minuty(p.od)
    if (dlugoscPrzerwy < 0) dlugoscPrzerwy += 1440
    if (dlugoscPrzerwy <= 0) {
      bledy.push(`Przerwa ${p.od}–${p.do} nie ma długości. Popraw godziny.`)
      continue
    }
    // Przerwa musi mieścić się w obrębie wpisu — liczymy w minutach od startu.
    let odPrzerwy = minuty(p.od) - minuty(wpis.od)
    if (odPrzerwy < 0) odPrzerwy += 1440
    if (odPrzerwy + dlugoscPrzerwy > dlugosc) {
      bledy.push(`Przerwa ${p.od}–${p.do} wychodzi poza godziny wpisu.`)
    }
  }

  if (minutyPrzerw(wpis) >= dlugosc && dlugosc > 0) {
    bledy.push('Przerwy nie mogą zająć całego wpisu.')
  }

  // Ostrzeżenie, nie blokada — bywają dyżury.
  if (dlugosc > 16 * 60) {
    ostrzezenia.push(`Ten wpis trwa ${opiszCzas(dlugosc)}. Sprawdź, czy godziny się zgadzają.`)
  }

  return { bledy, ostrzezenia }
}

/* ---------- Otwarty dzień (E7.1) ---------- */

export function otwartyWpis(ewidencja: WpisCzasu[]): WpisCzasu | null {
  return ewidencja.find((w) => w.do === null) ?? null
}

/**
 * B12 z badania 4: dzień zostawiony bez „Kończę”. Wpis sprzed dziś, wciąż otwarty,
 * to nie jest trwający dyżur — to zapomniane naciśnięcie. Pytamy przy następnym otwarciu.
 */
export function zapomnianyDzien(ewidencja: WpisCzasu[], dzis: string): WpisCzasu | null {
  const otwarty = otwartyWpis(ewidencja)
  return otwarty && otwarty.data < dzis ? otwarty : null
}

export function trwajacaPrzerwa(wpis: WpisCzasu | null): boolean {
  return !!wpis && wpis.przerwy.some((p) => !p.do)
}

/** Ile minut trwa otwarty wpis w tej chwili — do licznika na E7.1. */
export function fakturaNaZywo(wpis: WpisCzasu, teraz: Date): number {
  const { start } = ramyWpisu(wpis)
  const brutto = Math.max(0, Math.round((teraz.getTime() - start.getTime()) / 60000))
  let przerwy = minutyPrzerw(wpis)
  const trwa = wpis.przerwy.find((p) => !p.do)
  if (trwa) {
    let odKiedy = Math.round((teraz.getTime() - new Date(`${wpis.data}T${trwa.od}:00`).getTime()) / 60000)
    if (odKiedy < 0) odKiedy += 1440
    przerwy += Math.max(0, odKiedy)
  }
  return Math.max(0, brutto - przerwy)
}

/* ---------- 6.5. Wyzwalacz zmiany rytmu ---------- */

export interface OdstepstwoRytmu {
  data: string
  ile_min: number
}

/**
 * Szuka wpisów, które zaczynają się albo kończą ponad 60 minut poza zadeklarowanym
 * przedziałem stałych godzin. Trzy takie w ciągu 14 dni to sygnał, że rytm się zmienił.
 *
 * Świadomie nie liczymy pojedynczych nadgodzin: przesunięcie KOŃCA o godzinę przy
 * niezmienionym POCZĄTKU to nadgodziny, nie zmianowość. Dopiero przesunięty początek
 * albo oba końce naraz świadczą o innym rytmie (badanie 7 z punktu 10).
 */
export function odstepstwaOdStalychGodzin(
  wpisy: WpisCzasu[],
  stale: { od: string; do: string },
  dzis: string,
): OdstepstwoRytmu[] {
  const granica = iso(dodajDni(new Date(dzis + 'T12:00:00'), -14))
  const wynik: OdstepstwoRytmu[] = []
  for (const w of wpisy) {
    if (w.data < granica || w.data > dzis || !w.do) continue
    const roznicaStartu = Math.abs(minuty(w.od) - minuty(stale.od))
    let roznicaKonca = Math.abs(minuty(w.do) - minuty(stale.do))
    if (roznicaKonca > 720) roznicaKonca = 1440 - roznicaKonca
    // Przesunięty początek zawsze się liczy; sam przesunięty koniec to nadgodziny.
    if (roznicaStartu > 60) wynik.push({ data: w.data, ile_min: Math.max(roznicaStartu, roznicaKonca) })
  }
  return wynik
}

export function czasNaPytanieORytm(
  odstepstwa: OdstepstwoRytmu[],
  stanWyzwalacza: { ostatnio_pytano: string | null; wyciszony_do: string | null },
  dzis: string,
): boolean {
  if (odstepstwa.length < 3) return false
  if (stanWyzwalacza.wyciszony_do && stanWyzwalacza.wyciszony_do > dzis) return false
  if (stanWyzwalacza.ostatnio_pytano) {
    const minelo = (new Date(dzis + 'T12:00:00').getTime()
      - new Date(stanWyzwalacza.ostatnio_pytano + 'T12:00:00').getTime()) / 86400000
    if (minelo < 30) return false
  }
  return true
}

/* ---------- Tworzenie wpisów ---------- */

export function nowyWpis(dane: Partial<WpisCzasu> & { data: string; od: string }): WpisCzasu {
  const teraz = new Date().toISOString()
  return {
    id: `w${Date.now()}${Math.floor(Math.random() * 1000)}`,
    data: dane.data,
    od: dane.od,
    do: dane.do ?? null,
    przerwy: dane.przerwy ?? [],
    uwagi: dane.uwagi ?? '',
    zrodlo: dane.zrodlo ?? 'reczny',
    utworzono: teraz,
    zmieniono: teraz,
  }
}
