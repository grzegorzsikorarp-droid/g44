import type { DefinicjaBudzika, IdBudzika, Profil, ZaplanowanePrzypomnienie } from '../typy'
import { dodajDni, iso, oknoSnuPoNocce, ramyZmiany, szablonDnia } from './grafik'

/**
 * SILNIK HARMONOGRAMU — sedno prototypu.
 * Budzik jest REGUŁĄ, nie godziną. Harmonogram wyliczamy na 14 dni z grafiku
 * i z terminów użytkownika, a potem przycinamy sufitem 3 powiadomień na dobę.
 *
 * Uwaga inżynierska (patrz ROZBIEZNOSCI.md): wyliczenie harmonogramu jest w pełni
 * wykonalne w przeglądarce, ale SAMO WYZWOLENIE powiadomienia o zadanej godzinie
 * w czystej PWA nie jest niezawodne — brak Notification Triggers API.
 */

export const DEFINICJE_BUDZIKOW: DefinicjaBudzika[] = [
  {
    id: 'powrot_po_pomocy', nazwa: 'Powrót po ścieżce Pomocy',
    regula: 'następnego dnia po przejściu ścieżki', grupa: 'rytm', pierwszenstwo: 1,
  },
  {
    id: 'badania_okresowe', nazwa: 'Badania okresowe',
    regula: '30 i 7 dni przed terminem', grupa: 'terminy', pierwszenstwo: 2,
  },
  {
    id: 'szkolenie_bhp', nazwa: 'Szkolenie okresowe BHP',
    regula: '30 dni przed terminem', grupa: 'terminy', pierwszenstwo: 2,
  },
  {
    id: 'wejscie_przepisu', nazwa: 'Wejście przepisu w życie',
    regula: 'w dniu wejścia w życie', grupa: 'terminy', pierwszenstwo: 2,
  },
  {
    id: 'nowa_stawka_nocna', nazwa: 'Nowa stawka dodatku nocnego',
    regula: '1 stycznia i 1 lipca', grupa: 'terminy', pierwszenstwo: 2,
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }, { modyfikator: 'umowa', wartosc_w: ['o_prace'] }] },
  },
  {
    id: 'przerwa_monitor', nazwa: 'Przerwa przy monitorze',
    regula: 'co 2 godziny w trakcie zmiany', grupa: 'rytm', pierwszenstwo: 3,
    widoczny_gdy: { wszystkie: [{ cecha: 'monitor', wartosc_w: ['od2do4', 'ponad4'] }, { modyfikator: 'umowa', wartosc_w: ['o_prace'] }] },
  },
  {
    id: 'protokol_przed_nocka', nazwa: 'Protokół przed nocką',
    regula: '2 godziny przed zmianą N', grupa: 'rytm', pierwszenstwo: 3,
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }] },
  },
  {
    id: 'cisza_po_nocce', nazwa: 'Cisza po nocce',
    regula: 'okno snu wyliczone z grafiku', grupa: 'rytm', automatyczny: true, pierwszenstwo: 3,
    widoczny_gdy: { wszystkie: [{ cecha: 'zmiany', wartosc_w: ['zmiany_noce'] }] },
  },
  {
    id: 'alert_pogodowy', nazwa: 'Alert upałowy i zimowy',
    regula: 'gdy prognoza przekroczy próg z przepisów', grupa: 'otoczenie', pierwszenstwo: 4,
  },
  {
    id: 'prasowka', nazwa: 'Przegląd tygodnia',
    regula: 'wtorek, o godzinie którą wybierzesz', grupa: 'aktualnosci', pierwszenstwo: 5,
  },
]

export const SUFIT_NA_DOBE = 3

export interface WejscieHarmonogramu {
  profil: Profil
  wlaczone: Partial<Record<IdBudzika, boolean>>
  /** Ścieżka Pomocy przejdzia wczoraj — wywołuje przypomnienie o najwyższym pierwszeństwie. */
  powrotPoPomocy?: string | null
  /** Symulacja alertu pogodowego w prototypie. */
  alertPogodowy?: { dzien: string; tresc: string } | null
  godzinaPrasowki?: string
}

function dodaj(lista: ZaplanowanePrzypomnienie[], p: ZaplanowanePrzypomnienie) {
  lista.push(p)
}

/** Wylicza wszystkie przypomnienia na najbliższe 14 dni — przed przycięciem sufitem. */
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
        for (let g = 2; g < (koniec.getTime() - start.getTime()) / 3600000; g += 2) {
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

  // Powrót po ścieżce Pomocy — nazajutrz, najwyższe pierwszeństwo.
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

const PIERWSZENSTWO = new Map(DEFINICJE_BUDZIKOW.map((d) => [d.id, d.pierwszenstwo]))

/**
 * Sufit 3 powiadomień na dobę z pierwszeństwem (zasada 8):
 * powrót po Pomocy → terminy → rytmiczne → sezonowe → prasówka.
 * Odrzucone zostają na liście z oznaczeniem — pokazujemy je w podglądzie harmonogramu,
 * żeby użytkownik wiedział, czego się NIE spodziewać.
 */
export function zastosujSufit(lista: ZaplanowanePrzypomnienie[]): ZaplanowanePrzypomnienie[] {
  const wgDnia = new Map<string, ZaplanowanePrzypomnienie[]>()
  for (const p of lista) {
    const dzien = p.kiedy.slice(0, 10)
    if (!wgDnia.has(dzien)) wgDnia.set(dzien, [])
    wgDnia.get(dzien)!.push(p)
  }
  const wynik: ZaplanowanePrzypomnienie[] = []
  for (const [, dzienne] of wgDnia) {
    const wgWaznosci = [...dzienne].sort((a, b) => {
      const roznica = (PIERWSZENSTWO.get(a.budzik) ?? 9) - (PIERWSZENSTWO.get(b.budzik) ?? 9)
      return roznica !== 0 ? roznica : a.kiedy.localeCompare(b.kiedy)
    })
    const przyjete = new Set(wgWaznosci.slice(0, SUFIT_NA_DOBE))
    for (const p of dzienne) wynik.push({ ...p, odrzucone: !przyjete.has(p) })
  }
  return wynik.sort((a, b) => a.kiedy.localeCompare(b.kiedy))
}

export function wyliczHarmonogram(wejscie: WejscieHarmonogramu, teraz: Date = new Date()): ZaplanowanePrzypomnienie[] {
  return zastosujSufit(wyliczSurowy(wejscie, teraz))
}

/** „Następne przypomnienie: dziś 14:00” — to, co widzi użytkownik na ekranie budzików. */
export function nastepnePrzypomnienie(
  harmonogram: ZaplanowanePrzypomnienie[],
  teraz: Date = new Date(),
): ZaplanowanePrzypomnienie | null {
  const przyszle = harmonogram.filter((p) => !p.odrzucone && p.kiedy > teraz.toISOString())
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
