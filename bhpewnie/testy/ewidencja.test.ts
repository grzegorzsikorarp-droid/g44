import { describe, expect, it } from 'vitest'
import {
  czasNaPytanieORytm, fakturaNaZywo, minutyNocne, nowyWpis, odstepstwaOdStalychGodzin,
  opiszCzas, podsumuj, sprawdzWpis, wykryjSygnaly, wyliczWpis, zakresTygodnia, zapomnianyDzien,
} from '../src/silnik/ewidencja'
import { profilBarbary, pustyProfil } from '../src/magazyn/magazyn'
import { pomalujDzien, pustyGrafik } from '../src/silnik/grafik'
import type { Profil, WpisCzasu } from '../src/typy'

const DZIS = '2026-09-01'

const wpis = (data: string, od: string, doGodz: string | null, przerwy: [string, string][] = []): WpisCzasu =>
  nowyWpis({ data, od, do: doGodz, przerwy: przerwy.map(([a, b]) => ({ od: a, do: b })) })

describe('ewidencja: liczenie wpisu', () => {
  it('odejmuje przerwy od czasu brutto', () => {
    const w = wpis(DZIS, '08:00', '16:00', [['12:00', '12:30']])
    const wy = wyliczWpis(w, null, null)
    expect(wy.fakt_min).toBe(7 * 60 + 30)
    expect(wy.przerwy_min).toBe(30)
  })

  it('wpis przez północ liczy się poprawnie', () => {
    const wy = wyliczWpis(wpis(DZIS, '19:00', '07:00'), null, null)
    expect(wy.fakt_min).toBe(12 * 60)
  })

  it('minuty nocne liczy według godzin 21–7', () => {
    expect(minutyNocne(wpis(DZIS, '19:00', '07:00'))).toBe(10 * 60)
    expect(minutyNocne(wpis(DZIS, '08:00', '16:00'))).toBe(0)
  })

  it('B13: bez grafiku plan jest pusty, a różnicy się nie liczy', () => {
    const wy = wyliczWpis(wpis(DZIS, '08:00', '16:00'), null, null)
    expect(wy.plan_min).toBeNull()
    expect(wy.roznica_min).toBeNull()
  })

  it('z grafikiem liczy różnicę wobec planu', () => {
    // Szablon „D” to dniówka 07:00–19:00, czyli 12 h planu.
    const grafik = pomalujDzien(pustyGrafik(), DZIS, 'D')
    const wy = wyliczWpis(wpis(DZIS, '07:00', '21:00'), grafik, null)
    expect(wy.plan_min).toBe(12 * 60)
    expect(wy.roznica_min).toBe(2 * 60)
  })

  it('opisuje czas po ludzku', () => {
    expect(opiszCzas(380)).toBe('6 h 20 min')
    expect(opiszCzas(480)).toBe('8 h')
    expect(opiszCzas(45)).toBe('45 min')
  })
})

describe('ewidencja: walidacja wpisu ręcznego', () => {
  it('przerwa poza godzinami wpisu jest błędem', () => {
    const wynik = sprawdzWpis(wpis(DZIS, '08:00', '16:00', [['17:00', '17:30']]))
    expect(wynik.bledy.length).toBeGreaterThan(0)
  })

  it('wpis dłuższy niż 16 h daje ostrzeżenie, nie blokadę', () => {
    const wynik = sprawdzWpis(wpis(DZIS, '06:00', '23:00'))
    expect(wynik.bledy).toEqual([])
    expect(wynik.ostrzezenia.length).toBe(1)
  })

  it('poprawny wpis przechodzi bez uwag', () => {
    expect(sprawdzWpis(wpis(DZIS, '08:00', '16:00', [['12:00', '12:15']]))).toEqual({ bledy: [], ostrzezenia: [] })
  })
})

describe('ewidencja: sygnały', () => {
  const profil = pustyProfil()

  it('wykrywa odpoczynek dobowy krótszy niż 11 godzin', () => {
    const wpisy = [wpis('2026-09-01', '06:00', '18:00'), wpis('2026-09-02', '01:00', '09:00')]
    const sygnaly = wykryjSygnaly(wpisy, null, profil)
    expect(sygnaly.some((s) => s.rodzaj === 'odpoczynek_dobowy')).toBe(true)
    expect(sygnaly.find((s) => s.rodzaj === 'odpoczynek_dobowy')!.podstawa).toContain('132')
  })

  it('wykrywa dniówkę od 6 h bez zapisanej przerwy', () => {
    const sygnaly = wykryjSygnaly([wpis(DZIS, '08:00', '16:00')], null, profil)
    const brak = sygnaly.find((s) => s.rodzaj === 'brak_przerwy')
    expect(brak).toBeDefined()
    expect(brak!.opis).toContain('dodaj ją do wpisu')
  })

  it('zapisana przerwa zdejmuje sygnał', () => {
    const sygnaly = wykryjSygnaly([wpis(DZIS, '08:00', '16:00', [['12:00', '12:15']])], null, profil)
    expect(sygnaly.some((s) => s.rodzaj === 'brak_przerwy')).toBe(false)
  })

  it('wykrywa tydzień ponad 48 godzin i oznacza go jako orientacyjny', () => {
    const wpisy = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
      .map((d) => wpis(d, '06:00', '16:00', [['11:00', '11:15']]))
    const sygnaly = wykryjSygnaly(wpisy, null, profil)
    const tydzien = sygnaly.find((s) => s.rodzaj === 'tydzien_ponad_48')
    expect(tydzien).toBeDefined()
    expect(tydzien!.opis).toContain('orientacyjnie')
  })

  it('B13: bez grafiku sygnał „ponad plan” się nie pojawia, reszta działa', () => {
    const sygnaly = wykryjSygnaly([wpis(DZIS, '08:00', '16:00')], null, profil)
    expect(sygnaly.some((s) => s.rodzaj === 'ponad_plan')).toBe(false)
    expect(sygnaly.some((s) => s.rodzaj === 'brak_przerwy')).toBe(true)
  })

  it('funkcjonariusz: sygnały kodeksowe wyłączone, godziny ponad plan zostają', () => {
    const sluzba: Profil = { ...pustyProfil(), status: 'funkcjonariusz' }
    const grafik = pomalujDzien(pomalujDzien(pustyGrafik(), '2026-09-01', 'D'), '2026-09-02', 'D')
    const wpisy = [wpis('2026-09-01', '06:00', '20:00'), wpis('2026-09-02', '01:00', '12:00')]
    const sygnaly = wykryjSygnaly(wpisy, grafik, sluzba)
    expect(sygnaly.some((s) => s.rodzaj === 'odpoczynek_dobowy')).toBe(false)
    expect(sygnaly.some((s) => s.rodzaj === 'brak_przerwy')).toBe(false)
    const ponad = sygnaly.find((s) => s.rodzaj === 'ponad_plan')
    expect(ponad).toBeDefined()
    expect(ponad!.opis).toContain('pragmatyka')
  })
})

describe('ewidencja: podsumowania i zakresy', () => {
  it('tydzień liczy się od poniedziałku do niedzieli', () => {
    expect(zakresTygodnia('2026-09-02')).toEqual({ od: '2026-08-31', do: '2026-09-06' })
  })

  it('sumuje godziny, noce i dni z sygnałem', () => {
    const wpisy = [wpis('2026-09-01', '19:00', '07:00'), wpis('2026-09-03', '08:00', '16:00', [['12:00', '12:15']])]
    const sygnaly = wykryjSygnaly(wpisy, null, pustyProfil())
    const p = podsumuj(wpisy, null, sygnaly)
    expect(p.fakt_min).toBe(12 * 60 + 7 * 60 + 45)
    expect(p.noce_min).toBe(10 * 60)
    expect(p.plan_min).toBeNull()
  })
})

describe('ewidencja: otwarty dzień i licznik na żywo', () => {
  it('wpis bez godziny zakończenia sprzed dziś to zapomniany dzień', () => {
    const wpisy = [wpis('2026-08-31', '08:00', null)]
    expect(zapomnianyDzien(wpisy, DZIS)).not.toBeNull()
    expect(zapomnianyDzien([wpis(DZIS, '08:00', null)], DZIS)).toBeNull()
  })

  it('licznik na żywo odejmuje trwającą przerwę', () => {
    const w: WpisCzasu = { ...wpis(DZIS, '08:00', null), przerwy: [{ od: '10:00', do: null }] }
    const minut = fakturaNaZywo(w, new Date(`${DZIS}T10:30:00`))
    expect(minut).toBe(120)
  })
})

describe('ewidencja: wyzwalacz zmiany rytmu (6.5)', () => {
  const stale = { od: '08:00', do: '16:00' }

  it('trzy wpisy 14–22 w ciągu 14 dni uruchamiają pytanie', () => {
    const wpisy = ['2026-08-25', '2026-08-27', '2026-08-31'].map((d) => wpis(d, '14:00', '22:00'))
    const odstepstwa = odstepstwaOdStalychGodzin(wpisy, stale, DZIS)
    expect(odstepstwa.length).toBe(3)
    expect(czasNaPytanieORytm(odstepstwa, { ostatnio_pytano: null, wyciszony_do: null }, DZIS)).toBe(true)
  })

  it('badanie 7: pojedyncze nadgodziny NIE uruchamiają pytania', () => {
    const wpisy = ['2026-08-25', '2026-08-27', '2026-08-31'].map((d) => wpis(d, '08:00', '19:00'))
    expect(odstepstwaOdStalychGodzin(wpisy, stale, DZIS).length).toBe(0)
  })

  it('„Zostaw jak jest” wycisza pytanie na 30 dni', () => {
    const wpisy = ['2026-08-25', '2026-08-27', '2026-08-31'].map((d) => wpis(d, '14:00', '22:00'))
    const odstepstwa = odstepstwaOdStalychGodzin(wpisy, stale, DZIS)
    expect(czasNaPytanieORytm(odstepstwa, { ostatnio_pytano: DZIS, wyciszony_do: '2026-10-01' }, DZIS)).toBe(false)
    expect(czasNaPytanieORytm(odstepstwa, { ostatnio_pytano: '2026-08-30', wyciszony_do: null }, DZIS)).toBe(false)
    expect(czasNaPytanieORytm(odstepstwa, { ostatnio_pytano: '2026-07-01', wyciszony_do: null }, DZIS)).toBe(true)
  })

  it('wpisy starsze niż 14 dni się nie liczą', () => {
    const wpisy = ['2026-08-01', '2026-08-05', '2026-08-31'].map((d) => wpis(d, '14:00', '22:00'))
    expect(odstepstwaOdStalychGodzin(wpisy, stale, DZIS).length).toBe(1)
  })
})

describe('ewidencja wobec grafiku Barbary', () => {
  it('plan bierze się z grafiku zmianowego, nie z osobnego ustawienia', () => {
    const grafik = profilBarbary(new Date(`${DZIS}T08:00:00`)).grafik!
    const dzienZDniowka = Object.entries(grafik.kalendarz).find(([, s]) => s === 'D')![0]
    const wy = wyliczWpis(wpis(dzienZDniowka, '07:00', '19:00'), grafik, null)
    expect(wy.plan_min).toBe(12 * 60)
    expect(wy.roznica_min).toBe(0)
  })
})

/* ---------- Badanie 5 z punktu 10: zmiana czasu urzędowego ---------- */

describe('ewidencja a zmiana czasu urzędowego', () => {
  it('nocka w noc cofnięcia zegarów liczy się jako 9 godzin, nie 8', () => {
    // W nocy z 24 na 25 października 2026 zegary cofają się o godzinę: doba ma 25 h.
    // Kto pracował 22:00–06:00 „na zegarze”, przepracował faktycznie dziewięć godzin.
    const wy = wyliczWpis(wpis('2026-10-24', '22:00', '06:00'), null, null)
    expect(wy.fakt_min).toBe(9 * 60)
  })

  it('nocka w noc przestawienia zegarów do przodu liczy się jako 7 godzin', () => {
    // W nocy z 28 na 29 marca 2026 doba ma 23 h.
    const wy = wyliczWpis(wpis('2026-03-28', '22:00', '06:00'), null, null)
    expect(wy.fakt_min).toBe(7 * 60)
  })

  it('zwykła nocka poza zmianą czasu liczy się jako 8 godzin', () => {
    expect(wyliczWpis(wpis('2026-09-10', '22:00', '06:00'), null, null).fakt_min).toBe(8 * 60)
  })
})
