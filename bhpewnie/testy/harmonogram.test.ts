import { describe, expect, it } from 'vitest'
import {
  DEFINICJE_BUDZIKOW, nastepnePrzypomnienie, wyliczHarmonogram, wyliczSurowy,
} from '../src/silnik/harmonogram'
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

  it('zasada 8 po zmianie 1.2: nic nie jest odrzucane — sufit nie istnieje', () => {
    const profil = profilBarbary(TERAZ)
    const wejscie = { profil, wlaczone: WSZYSTKIE, powrotPoPomocy: 'wypadek przy pracy' }
    const surowy = wyliczSurowy(wejscie, TERAZ)
    const harmonogram = wyliczHarmonogram(wejscie, TERAZ)
    expect(harmonogram.length).toBe(surowy.length)
    expect(harmonogram.every((p) => !('odrzucone' in p))).toBe(true)
  })

  it('zasada 8: wylaczony budzik nie planuje sie wcale — przelacznik jest jedynym filtrem', () => {
    const profil = profilBarbary(TERAZ)
    profil.odpowiedzi.monitor = 'ponad4'
    const bez = wyliczHarmonogram({ profil, wlaczone: { ...WSZYSTKIE, przerwa_monitor: false } }, TERAZ)
    const z = wyliczHarmonogram({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    expect(bez.some((p) => p.budzik === 'przerwa_monitor')).toBe(false)
    expect(z.some((p) => p.budzik === 'przerwa_monitor')).toBe(true)
  })

  it('zmiana 1.3: domyslnie przerwa przy monitorze odzywa sie RAZ na dniowke', () => {
    // Domyslna czestotliwosc to „raz dziennie” — jedno powiadomienie obejmujace cala serie.
    const profil = profilBarbary(TERAZ)
    profil.odpowiedzi.monitor = 'ponad4'
    const lista = wyliczSurowy({ profil, wlaczone: WSZYSTKIE }, TERAZ)
    const monitorowe = lista.filter((p) => p.budzik === 'przerwa_monitor')
    expect(monitorowe.length).toBeGreaterThan(0)
    const dzien = monitorowe[0].kiedy.slice(0, 10)
    const wDniu = monitorowe.filter((p) => p.kiedy.startsWith(dzien))
    expect(wDniu).toHaveLength(1)
    expect(wDniu[0].zbiorcze).toBe(true)
    expect(wDniu[0].powod).toMatch(/po każdej godzinie przy ekranie/)
  })

  it('zmiana 1.3: przy wyborze „za kazdym razem” wraca seria co godzine', () => {
    const profil = profilBarbary(TERAZ)
    profil.odpowiedzi.monitor = 'ponad4'
    const lista = wyliczSurowy(
      { profil, wlaczone: WSZYSTKIE, czestotliwosci: { przerwa_monitor: 'zawsze' } },
      TERAZ,
    )
    const monitorowe = lista.filter((p) => p.budzik === 'przerwa_monitor')
    const dzien = monitorowe[0].kiedy.slice(0, 10)
    const wDniu = monitorowe.filter((p) => p.kiedy.startsWith(dzien)).map((p) => new Date(p.kiedy).getTime())
    expect(wDniu.length).toBeGreaterThan(1)
    for (let i = 1; i < wDniu.length; i++) expect(wDniu[i] - wDniu[i - 1]).toBe(3600000)
    // Seria nie jest zbiorcza — kazde wystapienie to osobna przerwa.
    expect(monitorowe.every((p) => !p.zbiorcze)).toBe(true)
  })

  it('zmiana 1.3: sufit NIE wraca — zaden budzik nie jest odrzucany', () => {
    // Wybor czestotliwosci zageszcza serie, ale niczego nie usuwa: przy „zawsze”
    // harmonogram jest identyczny z tym sprzed zmiany 1.3.
    const profil = profilBarbary(TERAZ)
    profil.odpowiedzi.monitor = 'ponad4'
    const wszystkoZawsze = wyliczHarmonogram(
      { profil, wlaczone: WSZYSTKIE, czestotliwosci: { przerwa_monitor: 'zawsze', protokol_przed_nocka: 'zawsze' } },
      TERAZ,
    )
    const surowy = wyliczSurowy(
      { profil, wlaczone: WSZYSTKIE, czestotliwosci: { przerwa_monitor: 'zawsze', protokol_przed_nocka: 'zawsze' } },
      TERAZ,
    )
    expect(wszystkoZawsze).toHaveLength(surowy.length)
  })

  it('powrot po Pomocy planuje sie nazajutrz rano', () => {
    const profil = profilBarbary(TERAZ)
    const harmonogram = wyliczHarmonogram(
      { profil, wlaczone: WSZYSTKIE, powrotPoPomocy: 'wypadek przy pracy' },
      TERAZ,
    )
    const jutro = new Date(TERAZ.getTime() + 86400000).toISOString().slice(0, 10)
    const powrot = harmonogram.find((p) => p.budzik === 'powrot_po_pomocy' && p.kiedy.startsWith(jutro))
    expect(powrot).toBeDefined()
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

/**
 * ZMIANA 1.3, badanie 3 (sekcja 8): czy tresc powiadomienia zbiorczego miesci sie
 * w tym, co system pokazuje BEZ rozwijania powiadomienia.
 *
 * Android (NotificationCompat, jedna linia tekstu przy zwinietym powiadomieniu):
 * okolo 40 znakow tytulu i okolo 50 znakow tresci — dalej idzie wielokropek.
 * iOS (banner): dwie linie tresci, w praktyce okolo 110 znakow.
 * Zrodlem jest zachowanie systemowe, nie twardy limit API — dlatego pilnujemy
 * PIERWSZEGO ZDANIA: ono musi niesc cala informacje samo, bo reszta bywa ucieta.
 */
describe('zmiana 1.3: tresc powiadomienia zbiorczego', () => {
  const zbiorcze = DEFINICJE_BUDZIKOW
    .filter((d) => d.czestotliwosc?.wybieralna)
    .map((d) => ({ id: d.id, tresc: d.czestotliwosc!.tresc_raz }))

  it('kazdy budzik z wyborem ma tresc zbiorcza', () => {
    expect(zbiorcze.length).toBeGreaterThan(0)
    for (const z of zbiorcze) expect(z.tresc.length).toBeGreaterThan(0)
  })

  it('pierwsze zdanie miesci sie w oknie zwinietego powiadomienia (50 znakow)', () => {
    for (const z of zbiorcze) {
      const pierwsze = z.tresc.split(/(?<=[.!?])\s|\s—\s/)[0]
      expect(pierwsze.length, `${z.id}: „${pierwsze}”`).toBeLessThanOrEqual(50)
    }
  })

  it('cala tresc miesci sie w bannerze iOS (110 znakow)', () => {
    for (const z of zbiorcze) {
      expect(z.tresc.length, `${z.id}: ${z.tresc.length} znakow`).toBeLessThanOrEqual(110)
    }
  })
})
