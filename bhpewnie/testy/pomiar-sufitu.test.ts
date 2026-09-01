import { describe, expect, it } from 'vitest'
import { wyliczHarmonogram, wyliczSurowy } from '../src/silnik/harmonogram'
import { profilBarbary } from '../src/magazyn/magazyn'
import type { IdBudzika } from '../src/typy'

/** Pomiar do ROZBIEZNOSCI.md: ile przypomnien odrzuca sufit 3/dobe przy pelnym grafiku. */
describe('pomiar: sufit 3 na dobe przy wlaczonych wszystkich budzikach', () => {
  it('podaje, ile przypomnien nie zmiesci sie w sufcie', () => {
    const teraz = new Date('2026-09-01T08:00:00')
    const profil = profilBarbary(teraz)
    profil.odpowiedzi.monitor = 'ponad4'          // wlacza takze budzik monitorowy
    profil.terminy = profil.terminy.map((t) => ({ ...t, przypomnienie: true }))
    const wlaczone: Partial<Record<IdBudzika, boolean>> = {
      przerwa_monitor: true, protokol_przed_nocka: true, badania_okresowe: true,
      szkolenie_bhp: true, alert_pogodowy: true, prasowka: true, powrot_po_pomocy: true,
    }
    const surowy = wyliczSurowy({ profil, wlaczone, powrotPoPomocy: 'wypadek' }, teraz)
    const zSufitem = wyliczHarmonogram({ profil, wlaczone, powrotPoPomocy: 'wypadek' }, teraz)
    const odrzucone = zSufitem.filter((p) => p.odrzucone).length

    console.log(`POMIAR: 14 dni, wszystkie budziki -> ${surowy.length} przypomnien wyliczonych, ` +
      `${odrzucone} odrzuconych przez sufit (${Math.round(odrzucone / surowy.length * 100)}%)`)
    expect(surowy.length).toBeGreaterThan(0)
  })
})
