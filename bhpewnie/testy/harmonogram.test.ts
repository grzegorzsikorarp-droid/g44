import { describe, expect, it } from 'vitest'
import { nastepnePrzypomnienie, SUFIT_NA_DOBE, wyliczHarmonogram, wyliczSurowy } from '../src/silnik/harmonogram'
import { profilBarbary } from '../src/magazyn/magazyn'
import { maNocki, nalozWzorzec, oknoSnuPoNocce, pomalujDzien, pustyGrafik, trybZGrafiku } from '../src/silnik/grafik'
import type { IdBudzika } from '../src/typy'

const TERAZ = new Date('2026-09-01T08:00:00')
const WSZYSTKIE: Partial<Record<IdBudzika, boolean>> = {
  przerwa_monitor: true, protokol_przed_nocka: true, badania_okresowe: true,
  szkolenie_bhp: true, alert_pogodowy: true, prasowka: true,
}

describe('grafik', () => {
  it('malowanie dotknieciem: drugie dotkniecie tego samego szablonu kasuje dzien', () => {
    let g = pustyGrafik()
    g = pomalujDzien(g, '2026-09-01', 'D')
    expect(g.kalendarz['2026-09-01']).toBe('D')
    g = pomalujDzien(g, '2026-09-01', 'D')
    expect(g.kalendarz['2026-09-01']).toBeUndefined()
  })

  it('wzorzec rotacji 2-2-3 uklada dniowki, nocki i dni wolne', () => {
    const g = nalozWzorzec(pustyGrafik(), TERAZ, 'dwa-dwa-trzy', 7)
    expect(Object.values(g.kalendarz)).toEqual(['D', 'D', 'N', 'N'])
    expect(maNocki(g)).toBe(true)
  })

  it('tryb pracy wynika z grafiku, a nie z osobnego pytania', () => {
    expect(trybZGrafiku(nalozWzorzec(pustyGrafik(), TERAZ, 'dwa-dwa-trzy', 7))).toBe('zmiany_noce')
    expect(trybZGrafiku(nalozWzorzec(pustyGrafik(), TERAZ, 'same-dniowki', 7))).toBe('stale')
    expect(trybZGrafiku(pustyGrafik())).toBeNull()
  })

  it('okno snu po nocce liczy sie samo: koniec zmiany + 30 minut, przez 7 godzin', () => {
    const grafik = profilBarbary(TERAZ).grafik!
    const dzienZNocka = Object.entries(grafik.kalendarz).find(([, s]) => s === 'N')![0]
    const okno = oknoSnuPoNocce(grafik, dzienZNocka)
    expect(okno).not.toBeNull()
    expect(okno!.od.getHours()).toBe(7)
    expect(okno!.od.getMinutes()).toBe(30)
    expect((okno!.do.getTime() - okno!.od.getTime()) / 3600000).toBe(7)
  })
})

describe('harmonogram na 14 dni', () => {
  it('wylicza przypomnienia z grafiku, nie z recznie wpisanych godzin', () => {
    const profil = profilBarbary(TERAZ)
    const lista = wyliczSurowy({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    expect(lista.length).toBeGreaterThan(0)
    expect(lista.some((p) => p.budzik === 'protokol_przed_nocka')).toBe(true)
    expect(lista.every((p, i) => i === 0 || lista[i - 1].kiedy <= p.kiedy)).toBe(true)
  })

  it('cisza po nocce pojawia sie bez wlaczania jakiegokolwiek przelacznika', () => {
    const profil = profilBarbary(TERAZ)
    const lista = wyliczSurowy({ profil, wlaczone: {} }, TERAZ)
    expect(lista.some((p) => p.budzik === 'cisza_po_nocce')).toBe(true)
  })

  it('zasada 8: sufit 3 powiadomien na dobe jest dotrzymany', () => {
    const profil = profilBarbary(TERAZ)
    const harmonogram = wyliczHarmonogram(
      { profil, wlaczone: WSZYSTKIE, powrotPoPomocy: 'wypadek przy pracy' },
      TERAZ,
    )
    const wgDnia = new Map<string, number>()
    for (const p of harmonogram.filter((x) => !x.odrzucone)) {
      const d = p.kiedy.slice(0, 10)
      wgDnia.set(d, (wgDnia.get(d) ?? 0) + 1)
    }
    for (const [, ile] of wgDnia) expect(ile).toBeLessThanOrEqual(SUFIT_NA_DOBE)
  })

  it('pierwszenstwo: powrot po Pomocy wygrywa z rytmem zmiany', () => {
    const profil = profilBarbary(TERAZ)
    const harmonogram = wyliczHarmonogram(
      { profil, wlaczone: WSZYSTKIE, powrotPoPomocy: 'wypadek przy pracy' },
      TERAZ,
    )
    const jutro = new Date(TERAZ.getTime() + 86400000).toISOString().slice(0, 10)
    const powrot = harmonogram.find((p) => p.budzik === 'powrot_po_pomocy' && p.kiedy.startsWith(jutro))
    expect(powrot).toBeDefined()
    expect(powrot!.odrzucone).toBeFalsy()
  })

  it('odrzucone przez sufit zostaja widoczne w podgladzie, zamiast znikac po cichu', () => {
    const profil = profilBarbary(TERAZ)
    const harmonogram = wyliczHarmonogram({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    expect(harmonogram.some((p) => p.odrzucone)).toBe(true)
  })

  it('podaje najblizsze przypomnienie do pokazania na ekranie budzikow', () => {
    const profil = profilBarbary(TERAZ)
    const harmonogram = wyliczHarmonogram({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    const nastepne = nastepnePrzypomnienie(harmonogram, TERAZ)
    expect(nastepne).not.toBeNull()
    expect(new Date(nastepne!.kiedy).getTime()).toBeGreaterThan(TERAZ.getTime())
  })

  it('bez grafiku dzialaja tylko przypomnienia terminowe', () => {
    // Termin tak dobrany, zeby wyprzedzenie 30 dni wypadlo w oknie 14 dni.
    const zaDni = (n: number) => new Date(TERAZ.getTime() + n * 86400000).toISOString().slice(0, 10)
    const profil = {
      ...profilBarbary(TERAZ),
      grafik: null,
      terminy: [{ id: 'badania', nazwa: 'Badania okresowe', data: zaDni(35), przypomnienie: true }],
    }
    const lista = wyliczSurowy({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    expect(lista.some((p) => p.budzik === 'cisza_po_nocce')).toBe(false)
    expect(lista.some((p) => p.budzik === 'badania_okresowe')).toBe(true)
  })

  it('okno 14 dni: przypomnienie o terminie odleglym o 64 dni jeszcze sie nie planuje', () => {
    const profil = profilBarbary(TERAZ)
    profil.terminy = profil.terminy.map((t) => ({ ...t, przypomnienie: true }))
    const lista = wyliczSurowy({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    expect(lista.some((p) => p.budzik === 'badania_okresowe')).toBe(false)
  })
})
