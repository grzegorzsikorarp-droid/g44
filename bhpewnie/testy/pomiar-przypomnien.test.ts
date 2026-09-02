import { describe, expect, it } from 'vitest'
import { wyliczHarmonogram } from '../src/silnik/harmonogram'
import { profilBarbary } from '../src/magazyn/magazyn'
import type { IdBudzika } from '../src/typy'

/**
 * Pomiar do ROZBIEZNOSCI.md. W 1.1 mierzylismy, ile przypomnien odrzuca sufit 3/dobe
 * (41%). Sufit zostal zniesiony w zmianie 1.2, wiec teraz mierzymy to, co po nim zostalo:
 * ile przypomnien na dobe dostaje uzytkownik z wszystkimi budzikami wlaczonymi.
 * To jest liczba, ktora zespol ma zobaczyc przed testami z ludzmi.
 */
describe('pomiar: ile przypomnien na dobe przy wszystkich budzikach', () => {
  it('podaje rozklad dobowy po zniesieniu sufitu', () => {
    const teraz = new Date('2026-09-01T08:00:00')
    const profil = profilBarbary(teraz)
    profil.odpowiedzi.monitor = 'ponad4'          // wlacza takze budzik monitorowy
    profil.terminy = profil.terminy.map((t) => ({ ...t, przypomnienie: true }))
    const wlaczone: Partial<Record<IdBudzika, boolean>> = {
      przerwa_monitor: true, protokol_przed_nocka: true, badania_okresowe: true,
      szkolenie_bhp: true, alert_pogodowy: true, prasowka: true, powrot_po_pomocy: true,
    }
    const harmonogram = wyliczHarmonogram({ profil, wlaczone, powrotPoPomocy: 'wypadek' }, teraz)

    const wgDnia = new Map<string, number>()
    for (const p of harmonogram) {
      const d = p.kiedy.slice(0, 10)
      wgDnia.set(d, (wgDnia.get(d) ?? 0) + 1)
    }
    const dobowe = [...wgDnia.values()]
    const najwiecej = Math.max(...dobowe)
    const srednia = dobowe.reduce((s, x) => s + x, 0) / dobowe.length

    console.log(`POMIAR 1.2: 14 dni, wszystkie budziki -> ${harmonogram.length} przypomnien, `
      + `srednio ${srednia.toFixed(1)} na dobe, najwiecej ${najwiecej} w jednej dobie, `
      + '0 odrzuconych (sufit zniesiony)')
    expect(harmonogram.length).toBeGreaterThan(0)
    expect(harmonogram.every((p) => !('odrzucone' in p))).toBe(true)
  })
})
