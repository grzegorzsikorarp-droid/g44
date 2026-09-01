import { describe, expect, it } from 'vitest'
import { dodatekNocny, parametr, wymiarGodzin, wypelnij } from '../src/silnik/parametry'

describe('parametry z datami obowiazywania', () => {
  it('zwraca wartosc obowiazujaca w danym dniu', () => {
    const p = parametr('minimalne_wynagrodzenie', '2026-09-01')
    expect(p.stan).toBe('aktualny')
    if (p.stan === 'aktualny') expect(p.wartosc).toBe(4806)
  })

  it('parametr jeszcze nieobowiazujacy nie jest pokazywany jako pewny', () => {
    // Nowa definicja mobbingu obowiazuje od 5 listopada 2026.
    const przed = parametr('mobbing_zadoscuczynienie_min', '2026-09-01')
    const po = parametr('mobbing_zadoscuczynienie_min', '2026-11-06')
    expect(przed.stan).not.toBe('aktualny')
    expect(po.stan).toBe('aktualny')
  })

  it('ZASADA 9 / B10: po uplywie obowiazuje_do NIE pokazujemy starej kwoty', () => {
    // Jednorazowe odszkodowanie obowiazuje do 31 marca 2027.
    const wTerminie = parametr('odszkodowanie_1proc', '2027-03-31')
    expect(wTerminie.stan).toBe('aktualny')

    const poTerminie = parametr('odszkodowanie_1proc', '2027-04-02')
    expect(poTerminie.stan).toBe('wygasl')
    if (poTerminie.stan === 'wygasl') {
      expect(poTerminie.komunikat).toBe('Ta kwota zmienia się od kwietnia. Sprawdzamy nową wartość.')
      // Najwazniejsze: stara liczba nie moze sie nigdzie pojawic.
      expect(poTerminie.komunikat).not.toContain('1781')
    }
  })

  it('wygasly parametr zastepuje CALY tekst kafla, a nie tylko liczbe', () => {
    const wynik = wypelnij('Jednorazowe odszkodowanie: {odszkodowanie_1proc} za kazdy procent', '2027-04-02')
    expect(wynik.wygasly).toBe(true)
    expect(wynik.tekst).not.toContain('1781')
    expect(wynik.tekst).toContain('Sprawdzamy')
  })

  it('nieznany parametr oznaczamy jawnie, zamiast zmyslac wartosc', () => {
    const p = parametr('nieistniejacy_parametr', '2026-09-01')
    expect(p.stan).toBe('brak')
    if (p.stan === 'brak') expect(p.komunikat).toContain('do uzupełnienia')
  })
})

describe('dodatek nocny liczony z wymiaru czasu pracy (art. 130 KP)', () => {
  it('wymiar godzin zgadza sie z kalendarzem 2026', () => {
    expect(wymiarGodzin('2026-07')).toBe(184) // najdluzszy miesiac
    expect(wymiarGodzin('2026-11')).toBe(160) // 11 listopada w srode obniza wymiar
  })

  it('stawka miesci sie w widelkach 5,22-6,01 zl podanych w briefie', () => {
    for (let m = 1; m <= 12; m++) {
      const dzien = `2026-${String(m).padStart(2, '0')}-15`
      const wynik = dodatekNocny(dzien)
      expect(wynik).not.toBeNull()
      expect(wynik!.wartosc).toBeGreaterThanOrEqual(5.22)
      expect(wynik!.wartosc).toBeLessThanOrEqual(6.01)
    }
  })

  it('stawka zmienia sie miedzy miesiacami — nie jest stala', () => {
    expect(dodatekNocny('2026-07-15')!.wartosc).toBe(5.22)
    expect(dodatekNocny('2026-11-15')!.wartosc).toBe(6.01)
  })

  it('ROZBIEZNOSC 1: w listopadzie 2026 stawka to 6,01 zl, a nie 5,22 zl z przykladu w briefie', () => {
    // Brief, sekcja 6.2: „Dodatek za prace w nocy — 5,22 zl za kazda godzine nocna” (listopad 2026).
    // Wyliczenie wg wzoru z sekcji 4.3 daje dla listopada 2026 (wymiar 160 h) 6,01 zl.
    // 5,22 zl wypada w lipcu 2026 (wymiar 184 h). Szczegoly w ROZBIEZNOSCI.md.
    expect(dodatekNocny('2026-11-15')!.wartosc).not.toBe(5.22)
  })
})
