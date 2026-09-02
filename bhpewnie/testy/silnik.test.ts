import { describe, expect, it } from 'vitest'
import { policzUprawnienia, rozwiazProfil, WARTOSCI_BEZPIECZNE } from '../src/silnik/reguly'
import { profilBarbary, pustyProfil } from '../src/magazyn/magazyn'
import { POMINIETE, type Profil } from '../src/typy'

const DZIEN = '2026-09-01'
const DZIS = new Date('2026-09-01T08:00:00Z')

const idKafli = (p: Profil) => policzUprawnienia(p, DZIEN).map((k) => k.id)

/** Profil 2 z DoD Etapu A: zleceniobiorca pracujacy fizycznie w terenie. */
function zleceniobiorcaWTerenie(): Profil {
  return {
    ...pustyProfil(),
    odpowiedzi: {
      monitor: 'brak', dzwiganie: 'rzeczy', teren: true, zmiany: 'stale', pojazd: true,
      kontakt: 'brak', glos: false, chemia: true, biologia: false, halas: true,
      temperatura: true, urazowe: true, odziez: true, samotnie: false,
    },
    umowa: 'zlecenie',
    rocznik: 1990,
    status: 'brak',
  }
}

/** Profil 3 z DoD Etapu A: funkcjonariusz pracujacy zmianowo z nockami. */
function funkcjonariuszZmianowy(): Profil {
  return {
    ...pustyProfil(),
    odpowiedzi: {
      monitor: 'od2do4', dzwiganie: 'rzeczy', teren: true, zmiany: 'zmiany_noce', pojazd: true,
      kontakt: 'agresja', glos: false, chemia: false, biologia: false, halas: false,
      temperatura: true, urazowe: true, odziez: true, samotnie: false,
    },
    umowa: 'o_prace',
    rocznik: 1985,
    status: 'funkcjonariusz',
  }
}

describe('silnik regul — trzy profile daja rozne zestawy kafli (DoD Etapu A)', () => {
  it('daje trzy rozne zestawy uprawnien', () => {
    const barbara = idKafli(profilBarbary(DZIS))
    const zlecenie = idKafli(zleceniobiorcaWTerenie())
    const sluzba = idKafli(funkcjonariuszZmianowy())

    expect(new Set([barbara.join(), zlecenie.join(), sluzba.join()]).size).toBe(3)
    expect(barbara.length).toBeGreaterThan(0)
    expect(zlecenie.length).toBeGreaterThan(0)
    expect(sluzba.length).toBeGreaterThan(0)
  })

  it('Barbara: nocki na umowie o prace daja dodatek nocny z konkretna stawka', () => {
    const kafle = policzUprawnienia(profilBarbary(DZIS), DZIEN)
    const dodatek = kafle.find((k) => k.id === 'dodatek_nocny')
    expect(dodatek).toBeDefined()
    // Wrzesien 2026: wymiar 176 h -> 20% x 4806 / 176 = 5,46 zl
    expect(dodatek!.konkret).toContain('5,46')
    expect(dodatek!.podstawa).toContain('151')
  })

  it('Barbara: przemieszczanie ludzi wlacza kafel o sprzecie pomocniczym', () => {
    expect(idKafli(profilBarbary(DZIS))).toContain('sprzet_do_ludzi')
  })

  it('zlecenie: dodatek nocny i przerwy sa ukryte, bo nie wynikaja z mocy prawa', () => {
    const kafle = idKafli(zleceniobiorcaWTerenie())
    expect(kafle).not.toContain('dodatek_nocny')
    expect(kafle).not.toContain('przerwa_art134')
    expect(kafle).not.toContain('ekwiwalent_pranie')
  })

  it('zlecenie: uprawnienia niezalezne od umowy zostaja', () => {
    const kafle = idKafli(zleceniobiorcaWTerenie())
    expect(kafle).toContain('normy_dzwigania')
    expect(kafle).toContain('srodki_ochrony')
  })

  it('funkcjonariusz: przelacznik korzenia zdejmuje uprawnienia z Kodeksu pracy', () => {
    const kafle = idKafli(funkcjonariuszZmianowy())
    expect(kafle).not.toContain('dodatek_nocny')
    expect(kafle).not.toContain('przerwa_monitor')
    expect(kafle).toContain('sluzba_odrebne')
    expect(kafle).toContain('sluzba_brak_pip')
  })

  it('funkcjonariusz: badania maja wariant sluzbowy zamiast medycyny pracy', () => {
    const kafle = policzUprawnienia(funkcjonariuszZmianowy(), DZIEN)
    const badania = kafle.find((k) => k.id === 'badania_okresowe')
    expect(badania).toBeDefined()
    expect(badania!.konkret).toContain('Komisja lekarska')
  })

  it('wiek 50+ wlacza osobny kafel, mlodszy rocznik nie', () => {
    expect(idKafli(profilBarbary(DZIS))).toContain('pracownik_50plus')
    expect(idKafli(zleceniobiorcaWTerenie())).not.toContain('pracownik_50plus')
  })
})

describe('wartosci bezpieczne przy pominietych pytaniach', () => {
  it('pominiecie ustawia wartosc pokazujaca WIECEJ i oznacza kafle jako niepewne', () => {
    const pusty = pustyProfil()
    const rozwiazany = rozwiazProfil(pusty, DZIEN)
    expect(rozwiazany.wektor).toEqual(WARTOSCI_BEZPIECZNE)
    expect(rozwiazany.umowa).toBe('o_prace')

    const kafle = policzUprawnienia(pusty, DZIEN)
    expect(kafle.length).toBeGreaterThan(0)
    const zalezneOdCech = kafle.filter((k) => k.cecha !== 'powszechne' && k.cecha !== 'status')
    expect(zalezneOdCech.every((k) => k.niepewne)).toBe(true)
  })

  it('kafle pewne sa przed niepewnymi', () => {
    const profil: Profil = { ...pustyProfil(), umowa: 'o_prace', rocznik: 1974, odpowiedzi: { ...pustyProfil().odpowiedzi, odziez: true } }
    const kafle = policzUprawnienia(profil, DZIEN)
    const pierwszyNiepewny = kafle.findIndex((k) => k.niepewne)
    const ostatniPewny = kafle.map((k) => k.niepewne).lastIndexOf(false)
    if (pierwszyNiepewny !== -1) expect(ostatniPewny).toBeLessThan(pierwszyNiepewny)
  })

  it('B8: odpowiedzi sprzeczne nie blokuja — obie cechy zostaja wlaczone', () => {
    const profil: Profil = {
      ...pustyProfil(),
      umowa: 'o_prace',
      odpowiedzi: { ...pustyProfil().odpowiedzi, monitor: 'ponad4', teren: true, dzwiganie: 'oba' },
    }
    const kafle = idKafli(profil)
    expect(kafle).toContain('przerwa_monitor')
    expect(kafle).toContain('pomieszczenie_ogrzewane')
  })
})

describe('zasada 5: kafel bez konkretu nie istnieje', () => {
  it('kazdy kafel ma niepusty konkret i date stanu prawnego', () => {
    for (const profil of [profilBarbary(DZIS), zleceniobiorcaWTerenie(), funkcjonariuszZmianowy(), pustyProfil()]) {
      for (const kafel of policzUprawnienia(profil, DZIEN)) {
        expect(kafel.konkret.trim().length).toBeGreaterThan(0)
        expect(kafel.stan_prawny.length).toBeGreaterThan(0)
        expect(kafel.podstawa.trim().length).toBeGreaterThan(0)
      }
    }
  })
})

/* ---------- Zmiana 1.2: warunek rozstrzygany na kaflu ---------- */

describe('zmiana 1.2: szesc stanow kafla', () => {
  const zMonitorem = (): Profil => ({
    ...pustyProfil(),
    umowa: 'o_prace',
    rocznik: 1980,
    odpowiedzi: { ...pustyProfil().odpowiedzi, monitor: 'ponad4', odziez: true, dzwiganie: 'ludzie' },
  })

  it('uprawnienie bezwarunkowe jest od razu w stanie przysluguje', () => {
    const kafle = policzUprawnienia(zMonitorem(), DZIEN)
    const przerwa = kafle.find((k) => k.id === 'przerwa_monitor')!
    expect(przerwa.warunek).toBeNull()
    expect(przerwa.stan).toBe('przysluguje')
  })

  it('uprawnienie warunkowe bez odpowiedzi czeka w stanie sprawdz_warunek', () => {
    const okulary = policzUprawnienia(zMonitorem(), DZIEN).find((k) => k.id === 'okulary_monitor')!
    expect(okulary.stan).toBe('sprawdz_warunek')
    expect(okulary.warunek?.pytanie.length).toBeGreaterThan(0)
    expect(okulary.warunek!.odpowiedzi.length).toBeGreaterThanOrEqual(2)
    expect(okulary.warunek!.odpowiedzi.length).toBeLessThanOrEqual(3)
  })

  it('odpowiedz na warunek przelicza kafel na zielony, bursztynowy albo szary', () => {
    const stanDla = (nr: number) =>
      policzUprawnienia(zMonitorem(), DZIEN, { okulary_monitor: nr }).find((k) => k.id === 'okulary_monitor')!
    expect(stanDla(0).stan).toBe('przysluguje')
    expect(stanDla(1).stan).toBe('zalezy')
    expect(stanDla(1).odpowiedz?.do_sprawdzenia?.length).toBeLessThanOrEqual(2)
  })

  it('stan szary ma obowiazkowy blok „co przysluguje zamiast tego”', () => {
    const kafel = policzUprawnienia(zMonitorem(), DZIEN, { ekwiwalent_pranie: 1 })
      .find((k) => k.id === 'ekwiwalent_pranie')!
    expect(kafel.stan).toBe('nie_przysluguje')
    expect(kafel.odpowiedz?.zamiast?.length).toBeGreaterThan(0)
  })

  it('pominiete pytanie kreatora bije warunek — kafel jest niepewny, nie „do sprawdzenia”', () => {
    const profil: Profil = { ...zMonitorem(), odpowiedzi: { ...zMonitorem().odpowiedzi, odziez: POMINIETE } }
    const kafel = policzUprawnienia(profil, DZIEN).find((k) => k.id === 'ekwiwalent_pranie')!
    expect(kafel.stan).toBe('niepewny')
    expect(kafel.niepewne).toBe(true)
  })

  it('kazdy warunek ma dokladnie jedno pytanie i najwyzej trzy odpowiedzi', () => {
    for (const kafel of policzUprawnienia(zMonitorem(), DZIEN)) {
      if (!kafel.warunek) continue
      expect(typeof kafel.warunek.pytanie).toBe('string')
      expect(kafel.warunek.odpowiedzi.length).toBeLessThanOrEqual(3)
      for (const o of kafel.warunek.odpowiedzi) {
        expect(o.uzasadnienie.trim().length).toBeGreaterThan(0)
        if (o.wynik === 'zalezy') expect(o.do_sprawdzenia?.length).toBeGreaterThan(0)
        if (o.wynik === 'nie_przysluguje') expect(o.zamiast?.length).toBeGreaterThan(0)
      }
    }
  })

  it('sortowanie 3.4: przysluguje przed zalezy, do sprawdzenia przed niepewnym', () => {
    const profil: Profil = { ...zMonitorem(), odpowiedzi: { ...zMonitorem().odpowiedzi, halas: POMINIETE } }
    const kafle = policzUprawnienia(profil, DZIEN, { okulary_monitor: 1 })
    const waga = { przysluguje: 0, zalezy: 1, sprawdz_warunek: 2, nie_przysluguje: 3, niepewny: 4, wygaszony: 5 }
    const kolejnosc = kafle.map((k) => waga[k.stan])
    expect(kolejnosc).toEqual([...kolejnosc].sort((a, b) => a - b))
  })
})
