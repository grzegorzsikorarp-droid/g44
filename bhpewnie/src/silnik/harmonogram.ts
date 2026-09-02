import type { DefinicjaBudzika, IdBudzika, Profil, ZaplanowanePrzypomnienie } from '../typy'
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
    regula: 'co godzinę w trakcie zmiany', grupa: 'rytm',
    widoczny_gdy: { wszystkie: [{ cecha: 'monitor', wartosc_w: ['od2do4', 'ponad4'] }, { modyfikator: 'umowa', wartosc_w: ['o_prace'] }] },
  },
  {
    id: 'protokol_przed_nocka', nazwa: 'Protokół przed nocką',
    regula: '2 godziny przed zmianą N', grupa: 'rytm',
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }] },
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
  /** Ścieżka Pomocy przejdzia wczoraj — wywołuje przypomnienie nazajutrz. */
  powrotPoPomocy?: string | null
  /** Symulacja alertu pogodowego w prototypie. */
  alertPogodowy?: { dzien: string; tresc: string } | null
  godzinaPrasowki?: string
}

function dodaj(lista: ZaplanowanePrzypomnienie[], p: ZaplanowanePrzypomnienie) {
  lista.push(p)
}

/** Wylicza wszystkie przypomnienia na najbliższe 14 dni. */
export function wyliczSurowy(wejscie: WejscieHarmonogramu, teraz: Date = new Date()): ZaplanowanePrzypomnienie[] {
  const { profil, wlaczone } = wejscie
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
        for (let g = 1; g < (koniec.getTime() - start.getTime()) / 3600000; g += 1) {
          dodaj(lista, {
            budzik: 'przerwa_monitor', nazwa: 'Przerwa przy monitorze',
            kiedy: new Date(start.getTime() + g * 3600000).toISOString(),
            powod: `w trakcie zmiany ${szablon.skrot}`,
          })
        }
      }

      if (wlaczone.protokol_przed_nocka && szablon.nocna) {
        dodaj(lista, {
          budzik: 'protokol_przed_nocka', nazwa: 'Protokół przed nocką',
          kiedy: new Date(start.getTime() - 2 * 3600000).toISOString(),
          powod: `2 godziny przed zmianą ${szablon.skrot}`,
        })
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
