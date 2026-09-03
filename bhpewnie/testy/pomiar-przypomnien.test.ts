import { describe, expect, it } from 'vitest'
import { wyliczHarmonogram } from '../src/silnik/harmonogram'
import { profilBarbary } from '../src/magazyn/magazyn'
import type { Czestotliwosc, IdBudzika, ZaplanowanePrzypomnienie } from '../src/typy'

/**
 * Pomiar do ROZBIEZNOSCI.md, powtarzany przy kazdej zmianie regul powiadomien.
 *
 * 1.1 — mierzylismy, ile przypomnien odrzuca sufit 3/dobe (41%).
 * 1.2 — sufit zniesiony; zmierzylismy, co po nim zostalo: 99 przypomnien na 14 dni.
 * 1.3 — kazdy budzik rytmiczny ma wybor czestotliwosci, domyslnie „raz dziennie”.
 *       Mierzymy dwa warianty: ustawienia domyslne oraz wszystko na „za kazdym razem”,
 *       czyli gorna granice halasu, ktora swiadomie dopuszczamy (sekcja 1.5 zmiany 1.3).
 */

const TERAZ = new Date('2026-09-01T08:00:00')

const WLACZONE: Partial<Record<IdBudzika, boolean>> = {
  przerwa_monitor: true, protokol_przed_nocka: true, badania_okresowe: true,
  szkolenie_bhp: true, alert_pogodowy: true, prasowka: true, powrot_po_pomocy: true,
}

function policz(czestotliwosci: Partial<Record<IdBudzika, Czestotliwosc>>) {
  const profil = profilBarbary(TERAZ)
  profil.odpowiedzi.monitor = 'ponad4'          // wlacza takze budzik monitorowy
  profil.terminy = profil.terminy.map((t) => ({ ...t, przypomnienie: true }))
  const harmonogram = wyliczHarmonogram(
    { profil, wlaczone: WLACZONE, czestotliwosci, powrotPoPomocy: 'wypadek' },
    TERAZ,
  )
  const wgDnia = new Map<string, number>()
  for (const p of harmonogram) {
    const d = p.kiedy.slice(0, 10)
    wgDnia.set(d, (wgDnia.get(d) ?? 0) + 1)
  }
  const dobowe = [...wgDnia.values()]
  return {
    harmonogram,
    razem: harmonogram.length,
    najwiecej: Math.max(...dobowe),
    srednia: dobowe.reduce((s, x) => s + x, 0) / 14,
  }
}

/** Rozklad na budziki — bez tego nie da sie wskazac zrodla nadmiaru. */
function wgBudzika(lista: ZaplanowanePrzypomnienie[]): string {
  const m = new Map<string, number>()
  for (const p of lista) m.set(p.budzik, (m.get(p.budzik) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')
}

describe('pomiar: ile przypomnien na dobe przy wszystkich budzikach', () => {
  it('wariant domyslny — kazdy wybieralny budzik na „raz dziennie”', () => {
    const w = policz({})
    console.log(`POMIAR 1.3 (domyslnie): 14 dni -> ${w.razem} przypomnien, `
      + `srednio ${w.srednia.toFixed(1)} na dobe, najwiecej ${w.najwiecej} w jednej dobie, `
      + `0 odrzuconych. Rozklad: ${wgBudzika(w.harmonogram)}`)

    // Rozstrzygniecie zespolu: maksimum ponizej czterech na dobe (sekcja 1.5).
    expect(w.najwiecej).toBeLessThan(4)
    // Sufit nie wrocil — nic nie jest odrzucane.
    expect(w.harmonogram.every((p) => !('odrzucone' in p))).toBe(true)
  })

  it('wariant glosny — wszystko na „za kazdym razem”', () => {
    const w = policz({ przerwa_monitor: 'zawsze', protokol_przed_nocka: 'zawsze' })
    console.log(`POMIAR 1.3 (wszystko „za kazdym razem”): 14 dni -> ${w.razem} przypomnien, `
      + `srednio ${w.srednia.toFixed(1)} na dobe, najwiecej ${w.najwiecej} w jednej dobie. `
      + `Rozklad: ${wgBudzika(w.harmonogram)}`)

    // To jest gorna granica halasu, ktora dopuszczamy swiadomie — ma byc osiagalna,
    // czyli wybor „za kazdym razem” musi realnie wracac do serii z 1.2.
    expect(w.razem).toBeGreaterThan(policz({}).razem * 3)
  })
})
