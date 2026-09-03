import type { Czestotliwosc, DefinicjaBudzika, IdBudzika, Profil, ZaplanowanePrzypomnienie } from '../typy'
import { dodajDni, iso, oknoSnuPoNocce, ramyZmiany, szablonDnia } from './grafik'

/**
 * SILNIK HARMONOGRAMU — sedno prototypu.
 * Budzik jest REGUŁĄ, nie godziną. Harmonogram wyliczamy na 14 dni z grafiku
 * i z terminów użytkownika.
 *
 * ZMIANA 1.2 — zasada 8 w nowym brzmieniu: sufit trzech powiadomień na dobę
 * i reguła pierwszeństwa ZOSTAŁY USUNIĘTE. Pomiar z prototypu 1.1 pokazał,
 * że odrzucały dwie piąte przypomnień, o które użytkownik świadomie prosił
 * (ROZBIEZNOSCI.md, wpis 7). Przełącznik przy każdym budziku wystarcza:
 * użytkownik, który włączył przerwę przy monitorze, ma ją dostawać.
 * Sufitu nie wolno przywracać w żadnej postaci.
 *
 * ZMIANA 1.3 — hałas rozstrzygnięty wyborem, nie odrzucaniem. Każdy budzik
 * rytmiczny ma częstotliwość: „raz dziennie” (jedno powiadomienie obejmujące
 * całą serię, o starcie zmiany plus 15 minut) albo „za każdym razem” (dawna
 * seria). Domyślnie „raz dziennie”, bo domyślne „za każdym razem” byłoby
 * decyzją aplikacji podjętą za człowieka, a nie jego decyzją. Aplikacja
 * dalej nie odrzuca niczego, o co użytkownik poprosił.
 *
 * Uwaga inżynierska (patrz ROZBIEZNOSCI.md): wyliczenie harmonogramu jest w pełni
 * wykonalne w przeglądarce, ale SAMO WYZWOLENIE powiadomienia o zadanej godzinie
 * w czystej PWA nie jest niezawodne — brak Notification Triggers API.
 */

export const DEFINICJE_BUDZIKOW: DefinicjaBudzika[] = [
  {
    id: 'powrot_po_pomocy', nazwa: 'Powrót po ścieżce Pomocy',
    regula: 'następnego dnia po przejściu ścieżki', grupa: 'rytm',
  },
  {
    id: 'badania_okresowe', nazwa: 'Badania okresowe',
    regula: '30 i 7 dni przed terminem', grupa: 'terminy',
  },
  {
    id: 'szkolenie_bhp', nazwa: 'Szkolenie okresowe BHP',
    regula: '30 dni przed terminem', grupa: 'terminy',
  },
  {
    id: 'wejscie_przepisu', nazwa: 'Wejście przepisu w życie',
    regula: 'w dniu wejścia w życie', grupa: 'terminy',
  },
  {
    id: 'nowa_stawka_nocna', nazwa: 'Nowa stawka dodatku nocnego',
    regula: '1 stycznia i 1 lipca', grupa: 'terminy',
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }, { modyfikator: 'umowa', wartosc_w: ['o_prace'] }] },
  },
  {
    id: 'przerwa_monitor', nazwa: 'Przerwa przy monitorze',
    // Reguła opisuje UPRAWNIENIE (kiedy przerwa się należy), a tor częstotliwości —
    // jak często aplikacja o nim mówi. Od zmiany 1.3 to dwie różne rzeczy i nie wolno
    // ich mieszać: „co godzinę” w regule przy domyślnym „raz dziennie” byłoby kłamstwem.
    regula: 'przerwa należy się po każdej godzinie przy ekranie', grupa: 'rytm',
    widoczny_gdy: { wszystkie: [{ cecha: 'monitor', wartosc_w: ['od2do4', 'ponad4'] }, { modyfikator: 'umowa', wartosc_w: ['o_prace'] }] },
    czestotliwosc: {
      wybieralna: true, domyslna: 'raz_dziennie',
      opis_raz: 'raz na początku zmiany',
      opis_zawsze: 'co godzinę w trakcie zmiany',
      tresc_raz: 'Dziś pamiętaj o przerwach — przerwa należy Ci się po każdej godzinie przy ekranie.',
    },
  },
  {
    id: 'protokol_przed_nocka', nazwa: 'Protokół przed nocką',
    regula: '2 godziny przed zmianą N', grupa: 'rytm',
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }] },
    czestotliwosc: {
      wybieralna: true, domyslna: 'raz_dziennie',
      opis_raz: 'raz przed pierwszą nocką w serii',
      opis_zawsze: 'przed każdą nocką',
      tresc_raz: 'Zaczyna się seria nocek. Przejrzyj protokół — obowiązuje przed każdą z nich.',
    },
  },
  {
    id: 'cisza_po_nocce', nazwa: 'Cisza po nocce',
    regula: 'okno snu wyliczone z grafiku', grupa: 'rytm', automatyczny: true,
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }] },
  },
  {
    id: 'alert_pogodowy', nazwa: 'Alert upałowy i zimowy',
    regula: 'gdy prognoza przekroczy próg z przepisów', grupa: 'otoczenie',
  },
  {
    id: 'prasowka', nazwa: 'Przegląd tygodnia',
    regula: 'wtorek, o godzinie którą wybierzesz', grupa: 'aktualnosci',
  },
]

export interface WejscieHarmonogramu {
  profil: Profil
  wlaczone: Partial<Record<IdBudzika, boolean>>
  /** Zmiana 1.3: wybór częstotliwości. Brak wpisu = wartość domyślna z definicji. */
  czestotliwosci?: Partial<Record<IdBudzika, Czestotliwosc>>
  /** Ścieżka Pomocy przejdzia wczoraj — wywołuje przypomnienie nazajutrz. */
  powrotPoPomocy?: string | null
  /** Symulacja alertu pogodowego w prototypie. */
  alertPogodowy?: { dzien: string; tresc: string } | null
  godzinaPrasowki?: string
}

function dodaj(lista: ZaplanowanePrzypomnienie[], p: ZaplanowanePrzypomnienie) {
  lista.push(p)
}

/**
 * Zmiana 1.3: częstotliwość obowiązująca dla budzika.
 * Budzik bez wyboru zachowuje się jak dawniej („zawsze”) — to jego jedyny tryb.
 * Budzik z wyborem bierze ustawienie użytkownika, a gdy go nie ma — wartość domyślną.
 */
export function czestotliwoscBudzika(
  id: IdBudzika,
  wybory: Partial<Record<IdBudzika, Czestotliwosc>> = {},
): Czestotliwosc {
  const def = DEFINICJE_BUDZIKOW.find((d) => d.id === id)
  if (!def?.czestotliwosc?.wybieralna) return 'zawsze'
  return wybory[id] ?? def.czestotliwosc.domyslna
}

/** Treść jednego powiadomienia zbiorczego — leży przy definicji, nie w kodzie ekranu. */
function trescZbiorcza(id: IdBudzika): string {
  return DEFINICJE_BUDZIKOW.find((d) => d.id === id)?.czestotliwosc?.tresc_raz ?? ''
}

/** Wylicza wszystkie przypomnienia na najbliższe 14 dni. */
export function wyliczSurowy(wejscie: WejscieHarmonogramu, teraz: Date = new Date()): ZaplanowanePrzypomnienie[] {
  const { profil, wlaczone } = wejscie
  const czestotliwosci = wejscie.czestotliwosci ?? {}
  const lista: ZaplanowanePrzypomnienie[] = []
  const grafik = profil.grafik

  for (let i = 0; i < 14; i++) {
    const data = dodajDni(teraz, i)
    const dzien = iso(data)
    const szablon = szablonDnia(grafik, dzien)

    // Rytm zmiany — tylko w dni, w których faktycznie pracujesz.
    if (szablon && grafik) {
      const { start, koniec } = ramyZmiany(dzien, szablon)

      if (wlaczone.przerwa_monitor) {
        if (czestotliwoscBudzika('przerwa_monitor', czestotliwosci) === 'zawsze') {
          for (let g = 1; g < (koniec.getTime() - start.getTime()) / 3600000; g += 1) {
            dodaj(lista, {
              budzik: 'przerwa_monitor', nazwa: 'Przerwa przy monitorze',
              kiedy: new Date(start.getTime() + g * 3600000).toISOString(),
              powod: `w trakcie zmiany ${szablon.skrot}`,
            })
          }
        } else {
          // Jedno powiadomienie obejmujące całą serię — kwadrans po starcie zmiany,
          // żeby nie wpadło w moment przebierania się i wchodzenia na stanowisko.
          dodaj(lista, {
            budzik: 'przerwa_monitor', nazwa: 'Przerwa przy monitorze',
            kiedy: new Date(start.getTime() + 15 * 60000).toISOString(),
            powod: trescZbiorcza('przerwa_monitor'),
            zbiorcze: true,
          })
        }
      }

      if (wlaczone.protokol_przed_nocka && szablon.nocna) {
        // „Raz dziennie” przy protokole znaczy „raz na serię”: budzik powtarza się
        // z dnia na dzień, nie w obrębie doby, więc jedyne sensowne zagęszczenie
        // to pierwsza nocka po dniu bez nocki (ROZBIEZNOSCI.md, wpis 33).
        const zawsze = czestotliwoscBudzika('protokol_przed_nocka', czestotliwosci) === 'zawsze'
        const wczoraj = szablonDnia(grafik, iso(dodajDni(data, -1)))
        if (zawsze || !wczoraj?.nocna) {
          dodaj(lista, {
            budzik: 'protokol_przed_nocka', nazwa: 'Protokół przed nocką',
            kiedy: new Date(start.getTime() - 2 * 3600000).toISOString(),
            powod: zawsze ? `2 godziny przed zmianą ${szablon.skrot}` : trescZbiorcza('protokol_przed_nocka'),
            zbiorcze: !zawsze,
          })
        }
      }

      // Cisza po nocce: automatyczna, bez przełącznika (zasada 8).
      const okno = oknoSnuPoNocce(grafik, dzien)
      if (okno) {
        dodaj(lista, {
          budzik: 'cisza_po_nocce', nazwa: 'Cisza po nocce',
          kiedy: okno.od.toISOString(),
          powod: `wyliczone z grafiku — sen do ${okno.do.getHours()}:00`,
        })
      }
    }

    // Terminy użytkownika.
    for (const termin of profil.terminy) {
      if (!termin.przypomnienie) continue
      const budzik: IdBudzika = termin.id === 'szkolenie' ? 'szkolenie_bhp' : 'badania_okresowe'
      if (!wlaczone[budzik]) continue
      const wyprzedzenia = budzik === 'badania_okresowe' ? [30, 7] : [30]
      for (const dni of wyprzedzenia) {
        const kiedy = dodajDni(new Date(termin.data + 'T09:00:00'), -dni)
        if (iso(kiedy) === dzien) {
          dodaj(lista, {
            budzik, nazwa: termin.nazwa,
            kiedy: kiedy.toISOString(),
            powod: `${dni} dni przed terminem (${termin.data})`,
          })
        }
      }
    }

    // Prasówka — wtorek o godzinie użytkownika.
    if (wlaczone.prasowka && data.getDay() === 2) {
      const [g, m] = (wejscie.godzinaPrasowki ?? '18:00').split(':').map(Number)
      const kiedy = new Date(data)
      kiedy.setHours(g, m, 0, 0)
      dodaj(lista, { budzik: 'prasowka', nazwa: 'Przegląd tygodnia', kiedy: kiedy.toISOString(), powod: 'wtorek' })
    }

    // Alert pogodowy (w prototypie symulowany).
    if (wlaczone.alert_pogodowy && wejscie.alertPogodowy?.dzien === dzien) {
      const kiedy = new Date(dzien + 'T06:30:00')
      dodaj(lista, { budzik: 'alert_pogodowy', nazwa: 'Alert pogodowy', kiedy: kiedy.toISOString(), powod: wejscie.alertPogodowy.tresc })
    }
  }

  // Powrót po ścieżce Pomocy — nazajutrz rano.
  if (wejscie.powrotPoPomocy) {
    const kiedy = dodajDni(teraz, 1)
    kiedy.setHours(10, 0, 0, 0)
    dodaj(lista, {
      budzik: 'powrot_po_pomocy', nazwa: 'Powrót po ścieżce Pomocy',
      kiedy: kiedy.toISOString(), powod: wejscie.powrotPoPomocy,
    })
  }

  return lista.sort((a, b) => a.kiedy.localeCompare(b.kiedy))
}

/**
 * Harmonogram widziany przez użytkownika. Od zmiany 1.2 jest tożsamy z surowym:
 * nic nie jest odrzucane, bo każde przypomnienie ma za sobą świadomie włączony przełącznik.
 */
export function wyliczHarmonogram(wejscie: WejscieHarmonogramu, teraz: Date = new Date()): ZaplanowanePrzypomnienie[] {
  return wyliczSurowy(wejscie, teraz)
}

/** „Następne przypomnienie: dziś 14:00” — to, co widzi użytkownik na ekranie budzików. */
export function nastepnePrzypomnienie(
  harmonogram: ZaplanowanePrzypomnienie[],
  teraz: Date = new Date(),
): ZaplanowanePrzypomnienie | null {
  const przyszle = harmonogram.filter((p) => p.kiedy > teraz.toISOString())
  return przyszle.length > 0 ? przyszle[0] : null
}

export function opiszKiedy(kiedyIso: string, teraz: Date = new Date()): string {
  const kiedy = new Date(kiedyIso)
  const godzina = `${String(kiedy.getHours()).padStart(2, '0')}:${String(kiedy.getMinutes()).padStart(2, '0')}`
  const dzisiaj = iso(teraz)
  const jutro = iso(dodajDni(teraz, 1))
  const dzien = iso(kiedy)
  if (dzien === dzisiaj) return `dziś ${godzina}`
  if (dzien === jutro) return `jutro ${godzina}`
  const DNI = ['w niedzielę', 'w poniedziałek', 'we wtorek', 'w środę', 'w czwartek', 'w piątek', 'w sobotę']
  return `${DNI[kiedy.getDay()]} ${godzina}`
}
