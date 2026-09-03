import { describe, expect, it } from 'vitest'
import {
  doSprawdzenia, ocen, ocenPosrednio, opcjeZCech, policzCiasnote, policzPunkty,
  sytuacjeWKolejnosci, widocznePytania,
} from '../src/silnik/sprawdzacz'
import { rozwiazProfil } from '../src/silnik/reguly'
import { pustyProfil } from '../src/magazyn/magazyn'
import { sytuacja as znajdz, sytuacje } from '../src/dane/wczytaj'
import { POMINIETE, type Profil } from '../src/typy'

const DZIEN = '2026-09-02'

describe('zmiana 1.2: lista „Mam sprawę”', () => {
  it('ma dokładnie osiem pozycji', () => {
    expect(sytuacje().length).toBe(8)
  })

  it('nie zawiera sytuacji przeniesionych na kafle ani do Pomocy', () => {
    const idki = sytuacje().map((s) => s.id)
    for (const usunieta of ['monitor', 'odziez', 'noc', 'wypadek', 'choroba', 'ewakuacja']) {
      expect(idki).not.toContain(usunieta)
    }
  })

  it('wszystkie osiem sytuacji jest pełnych — żadnej planszy „w pełnej wersji”', () => {
    expect(sytuacje().filter((s) => !s.pelna)).toEqual([])
    expect(sytuacje().map((s) => s.id).sort())
      .toEqual(['badania', 'dzwiganie', 'odpoczynek', 'srodki', 'szkolenie', 'umowa', 'upal', 'zimno'])
  })

  it('każda sytuacja ma regułę zbiorczą — żaden zestaw odpowiedzi nie kończy się pustką', () => {
    for (const s of sytuacje()) {
      const reguly = (s as unknown as { reguly?: { gdy?: Record<string, string[]> }[] }).reguly ?? []
      const zbiorcza = reguly.some((r) => Object.keys(r.gdy ?? {}).length === 0)
      expect(zbiorcza, `sytuacja ${s.id} bez reguły zbiorczej`).toBe(true)
    }
  })

  it('sezonowa idzie na górę w sezonie', () => {
    expect(sytuacjeWKolejnosci('2026-07-15')[0].id).toBe('upal')
  })

  it('każda pełna sytuacja ma od 2 do 6 pytań', () => {
    for (const s of sytuacje().filter((x) => x.pelna)) {
      expect(s.pytania!.length).toBeGreaterThanOrEqual(2)
      expect(s.pytania!.length).toBeLessThanOrEqual(6)
    }
  })
})

describe('zmiana 1.2: dźwiganie pokazuje obie normy i nie pyta o płeć', () => {
  const dzwiganie = znajdz('dzwiganie')!

  it('żadne pytanie nie dotyczy płci', () => {
    const tresci = dzwiganie.pytania!.map((p) => p.tresc.toLowerCase()).join(' ')
    expect(tresci).not.toContain('płe')
    expect(tresci).not.toContain('kobiet')
    expect(tresci).not.toContain('mężczy')
  })

  it('każdy werdykt wylicza obie tabele norm', () => {
    for (const wybor of [
      { ile_kg: 'ponad30', jak_czesto: 'stale', kto: 'sam' },
      { ile_kg: 'do30', jak_czesto: 'stale', kto: 'sam' },
      { ile_kg: 'do20', jak_czesto: 'dorywczo', kto: 'sam' },
      { ile_kg: 'do12', jak_czesto: 'dorywczo', kto: 'zespol' },
    ]) {
      const w = ocen(dzwiganie, wybor, 'o_prace', DZIEN)!
      const tekst = w.ile.join(' ')
      expect(tekst).toContain('kobiet')
      expect(tekst).toContain('mężczyzn')
    }
  })
})

describe('zmiana 1.2: sytuacja 6 na zleceniu odsyła do pakietu umowy', () => {
  it('zlecenie daje szary werdykt z odnośnikiem do pakietu', () => {
    const w = ocen(znajdz('odpoczynek')!, { ile_dzis: 'ponad9', przerwa: 'brak', miedzy: 'ponizej11' }, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('nie_przysluguje')
    expect(w.pokrewne?.sprawdzacz).toBe('umowa')
  })

  it('umowa o pracę przy odpoczynku poniżej 11 h daje zielony werdykt', () => {
    const w = ocen(znajdz('odpoczynek')!, { ile_dzis: 'ponad9', przerwa: 'brak', miedzy: 'ponizej11' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.podstawa).toContain('132')
  })
})

describe('zmiana 1.2: pakiet umowy — punktacja', () => {
  const umowa = znajdz('umowa')!
  const wszystkieTak = { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'nie', sprzet: 'tak', wylacznosc: 'tak' }

  it('sześć cech na sześć daje zielony', () => {
    const wynik = policzPunkty(umowa, wszystkieTak)!
    expect(wynik.punkty).toBe(6)
    const w = ocen(umowa, wszystkieTak, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.uzasadnienie).toContain('masz wyznaczone godziny pracy')
  })

  it('trzy cechy na sześć dają bursztyn z dwoma rzeczami do sprawdzenia', () => {
    const trzy = { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie' }
    expect(policzPunkty(umowa, trzy)!.punkty).toBe(3)
    const w = ocen(umowa, trzy, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('zalezy')
    expect(doSprawdzenia(w).length).toBe(2)
  })

  it('jedna cecha na sześć daje szary z blokiem „zamiast tego”', () => {
    const jedna = { godziny: 'nie', miejsce: 'tak', nadzor: 'nie', zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie' }
    expect(policzPunkty(umowa, jedna)!.punkty).toBe(1)
    const w = ocen(umowa, jedna, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('nie_przysluguje')
    expect(w.ile.join(' ')).toContain('bezpieczne i higieniczne warunki')
  })

  it('„Nie wiem” liczy się jako zero punktów', () => {
    const nieWiem = Object.fromEntries(umowa.pytania!.map((p) => [p.id, 'nie_wiem']))
    expect(policzPunkty(umowa, nieWiem)!.punkty).toBe(0)
  })

  it('zielony i bursztyn mają ostrzeżenie przed konfrontacją', () => {
    for (const odp of [
      wszystkieTak,
      { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie' },
    ]) {
      const w = ocen(umowa, odp, 'zlecenie', DZIEN)!
      expect(w.ostrzezenie).toContain('Ryzyko, że pracodawca zareaguje źle, jest realne')
    }
  })

  it('żaden werdykt pakietu nie oferuje generatora pisma do pracodawcy', () => {
    for (const odp of [wszystkieTak, { godziny: 'nie', miejsce: 'nie', nadzor: 'nie', zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie' }]) {
      const w = ocen(umowa, odp, 'zlecenie', DZIEN)!
      expect(w.akcje_wlasne).toBeDefined()
      expect(w.akcje_wlasne!.length).toBe(3)
      expect(w.akcje_wlasne!.map((a) => a.etykieta).join(' ')).not.toContain('Pobierz wniosek')
      expect(w.akcje_wlasne![2].rodzaj).toBe('przypomnienie')
    }
  })

  it('podstawa art. 22 jest oznaczona jako wymagająca potwierdzenia', () => {
    const w = ocen(umowa, wszystkieTak, 'zlecenie', DZIEN)!
    expect(w.podstawa).toContain('art. 22 § 1¹ i § 1²')
    expect(w.podstawa).toContain('[do potwierdzenia przez specjalistę]')
  })

  it('przy umowie o pracę pakiet pokazuje ekran informacyjny zamiast pytań', () => {
    expect(umowa.nie_dotyczy?.gdy_umowa).toEqual(['o_prace'])
  })

  it('każdy werdykt pakietu prowadzi do porównania E2.8', () => {
    for (const odp of [wszystkieTak, { godziny: 'nie', miejsce: 'nie', nadzor: 'nie', zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie' }]) {
      expect(ocen(umowa, odp, 'zlecenie', DZIEN)!.porownanie).toBe('E2.8')
    }
  })
})

describe('E2.4: wynik pośredni', () => {
  it('pojawia się, gdy konkretna reguła jest już rozstrzygnięta', () => {
    const posredni = ocenPosrednio(znajdz('dzwiganie')!, { ile_kg: 'ponad30' }, 'o_prace', DZIEN)
    expect(posredni).not.toBeNull()
    expect(posredni!.stan).toBe('przysluguje')
  })

  it('reguła zbiorcza go nie wywołuje — inaczej pojawiałby się zawsze', () => {
    expect(ocenPosrednio(znajdz('dzwiganie')!, { ile_kg: 'do12' }, 'o_prace', DZIEN)).toBeNull()
  })

  it('pakiet umowy nie pokazuje wyniku pośredniego — punkty mają sens po sześciu pytaniach', () => {
    expect(ocenPosrednio(znajdz('umowa')!, { godziny: 'tak', miejsce: 'tak' }, 'zlecenie', DZIEN)).toBeNull()
  })
})

describe('zasady, których treść musi dotrzymać', () => {
  it('żaden werdykt nie jest czerwony — istnieją tylko trzy stany', () => {
    for (const s of sytuacje()) {
      const reguly = (s as unknown as { reguly?: { werdykt: { stan: string } }[] }).reguly ?? []
      for (const r of reguly) {
        expect(['przysluguje', 'zalezy', 'nie_przysluguje']).toContain(r.werdykt.stan)
      }
    }
  })

  it('każdy szary werdykt ma blok „zamiast tego”: pokrewne albo listę ile', () => {
    for (const s of sytuacje()) {
      const reguly = (s as unknown as { reguly?: { werdykt: { stan: string; ile: string[]; pokrewne?: unknown } }[] }).reguly ?? []
      for (const r of reguly.filter((x) => x.werdykt.stan === 'nie_przysluguje')) {
        expect(r.werdykt.pokrewne !== undefined || r.werdykt.ile.length > 0).toBe(true)
      }
    }
  })

  it('bursztyn ma najwyżej dwie rzeczy do sprawdzenia', () => {
    for (const s of sytuacje()) {
      const reguly = (s as unknown as { reguly?: { werdykt: { stan: string; do_sprawdzenia?: string[] } }[] }).reguly ?? []
      for (const r of reguly.filter((x) => x.werdykt.stan === 'zalezy')) {
        expect((r.werdykt.do_sprawdzenia ?? []).length).toBeLessThanOrEqual(2)
      }
    }
  })

  it('każda sytuacja ma metryczkę', () => {
    for (const s of sytuacje()) expect(s.metryczka?.autor).toBeTruthy()
  })
})

/* ---------- Cztery sytuacje domknięte po zmianie 1.2 ---------- */

describe('sytuacja 3: środki ochrony — opcje budowane z cech profilu', () => {
  const srodki = znajdz('srodki')!

  it('pyta wyłącznie o narażenia, które na tym stanowisku występują', () => {
    const profil: Profil = {
      ...pustyProfil(),
      umowa: 'o_prace',
      odpowiedzi: { ...pustyProfil().odpowiedzi, chemia: true, halas: true, biologia: false, odziez: false, teren: false, dzwiganie: 'brak', monitor: 'brak', glos: false, pojazd: false, samotnie: false, urazowe: false },
    }
    const opcje = opcjeZCech(srodki, srodki.pytania![0], rozwiazProfil(profil, DZIEN))
    const wartosci = opcje.map((o) => o.wartosc)
    expect(wartosci).toContain('chemia')
    expect(wartosci).toContain('halas')
    expect(wartosci).not.toContain('biologia')
    // Opcja własna sytuacji zamyka listę.
    expect(wartosci[wartosci.length - 1]).toBe('inne')
  })

  it('pominięte pytanie kreatora zostawia opcję na liście — wartość bezpieczna pokazuje więcej', () => {
    const profil: Profil = {
      ...pustyProfil(),
      odpowiedzi: { ...pustyProfil().odpowiedzi, chemia: POMINIETE },
    }
    const opcje = opcjeZCech(srodki, srodki.pytania![0], rozwiazProfil(profil, DZIEN))
    expect(opcje.map((o) => o.wartosc)).toContain('chemia')
  })

  it('powtórne zgłoszenie bez skutku daje zielony werdykt z prawem powstrzymania się', () => {
    const w = ocen(srodki, { czego_brakuje: 'chemia', czy_wie: 'zglaszalem' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.ile.join(' ')).toContain('powstrzymać się od pracy')
  })

  it('pytanie bez `zrodlo_opcji` zwraca swoje własne opcje bez zmian', () => {
    const drugie = srodki.pytania![1]
    expect(opcjeZCech(srodki, drugie, rozwiazProfil(pustyProfil(), DZIEN))).toEqual(drugie.opcje)
  })
})

describe('sytuacja 4: badania okresowe', () => {
  const badania = znajdz('badania')!

  it('żądanie zapłaty od pracownika daje zielony werdykt', () => {
    const w = ocen(badania, { kiedy: 'w_pracy', kto_placi: 'ja', dojazd: 'blisko' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.naglowek).toContain('koszt pracodawcy')
  })

  it('badanie po godzinach kieruje do reguły o godzinach pracy', () => {
    const w = ocen(badania, { kiedy: 'po_pracy', kto_placi: 'pracodawca', dojazd: 'blisko' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.ile.join(' ')).toContain('w godzinach pracy')
  })

  it('dojazd do innej miejscowości daje regułę o zwrocie kosztów', () => {
    const w = ocen(badania, { kiedy: 'w_pracy', kto_placi: 'pracodawca', dojazd: 'daleko' }, 'o_prace', DZIEN)!
    expect(w.ile.join(' ')).toContain('Zwrot kosztów przejazdu')
  })

  it('na zleceniu werdykt jest szary i odsyła do pakietu umowy', () => {
    const w = ocen(badania, { kiedy: 'w_pracy', kto_placi: 'ja', dojazd: 'blisko' }, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('nie_przysluguje')
    expect(w.pokrewne?.sprawdzacz).toBe('umowa')
  })
})

describe('sytuacja 5: szkolenie BHP', () => {
  const szkolenie = znajdz('szkolenie')!

  it('żądanie zapłaty daje zielony werdykt o koszcie pracodawcy', () => {
    const w = ocen(szkolenie, { kiedy: 'w_pracy', kto_placi: 'ja' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('przysluguje')
    expect(w.naglowek).toContain('koszt pracodawcy')
  })

  it('szkolenie po godzinach odsyła do ewidencji czasu pracy', () => {
    const w = ocen(szkolenie, { kiedy: 'po_pracy', kto_placi: 'pracodawca' }, 'o_prace', DZIEN)!
    expect(w.ile.join(' ')).toContain('Mój czas pracy')
  })

  it('na zleceniu werdykt jest bursztynowy, nie szary — instruktaż bywa obowiązkiem', () => {
    const w = ocen(szkolenie, { kiedy: 'w_pracy', kto_placi: 'pracodawca' }, 'zlecenie', DZIEN)!
    expect(w.stan).toBe('zalezy')
    expect(doSprawdzenia(w).length).toBeLessThanOrEqual(2)
  })
})

describe('sytuacja 7: zimno i ciasnota', () => {
  const zimno = znajdz('zimno')!

  it('poniżej 14 °C werdykt jest zielony niezależnie od rodzaju pracy', () => {
    for (const praca of ['biurowa', 'fizyczna']) {
      const w = ocen(zimno, { ile_stopni: 'ponizej14', jaka_praca: praca, ciasno: 'nie' }, 'o_prace', DZIEN)!
      expect(w.stan).toBe('przysluguje')
    }
  })

  it('16 °C przy pracy biurowej jest poniżej progu, przy fizycznej już nie', () => {
    const biuro = ocen(zimno, { ile_stopni: 'do18', jaka_praca: 'biurowa', ciasno: 'nie' }, 'o_prace', DZIEN)!
    expect(biuro.stan).toBe('przysluguje')
    const fizyczna = ocen(zimno, { ile_stopni: 'do18', jaka_praca: 'fizyczna', ciasno: 'nie' }, 'o_prace', DZIEN)!
    expect(fizyczna.stan).toBe('nie_przysluguje')
  })

  it('progi podstawiają się z parametrów, a nie z liczb w tekście', () => {
    const w = ocen(zimno, { ile_stopni: 'ponizej14', jaka_praca: 'fizyczna', ciasno: 'nie' }, 'o_prace', DZIEN)!
    expect(w.ile.join(' ')).toContain('18 °C')
    expect(w.ile.join(' ')).toContain('14 °C')
  })

  it('zmiana 1.3: zgloszona ciasnota bez wymiarow nie daje jeszcze werdyktu o ciasnocie', () => {
    // W 1.2 samo „ciasno: tak” dawalo bursztyn z kubatura „[do uzupelnienia]”.
    // Od 1.3 kubatura jest liczona, wiec do werdyktu potrzebne sa trzy wymiary;
    // sciezka bez nich spada na regule zbiorcza. W aplikacji ten stan nie wystapi,
    // bo pytania warunkowe zadaja te trzy pytania od razu po „Tak”.
    const w = ocen(zimno, { ile_stopni: 'powyzej18', jaka_praca: 'biurowa', ciasno: 'tak' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('nie_przysluguje')
    expect(widocznePytania(zimno, { ciasno: 'tak' })).toHaveLength(6)
  })

  it('brak termometru daje bursztyn z prośbą o pomiar', () => {
    const w = ocen(zimno, { ile_stopni: 'nie_wiem', jaka_praca: 'biurowa', ciasno: 'nie' }, 'o_prace', DZIEN)!
    expect(w.stan).toBe('zalezy')
    expect(w.pismo.tytul).toContain('pomiar')
  })
})

/**
 * ZMIANA 1.3, sekcja 2 — regula progowa „trzy razy Nie wiem”.
 * Badanie 4 z sekcji 8: sprawdzamy takze zbieg z wysoka punktacja.
 */
describe('zmiana 1.3: trzy „Nie wiem” w pakiecie umowy', () => {
  const umowa = znajdz('umowa')!

  const odp = (o: Partial<Record<string, string>>) => ({
    godziny: 'nie', miejsce: 'nie', nadzor: 'nie',
    zastepstwo: 'tak', sprzet: 'nie', wylacznosc: 'nie', ...o,
  } as Record<string, string>)

  it('trzy „Nie wiem” daja bursztyn mimo zera punktow', () => {
    const w = ocen(umowa, odp({ godziny: 'nie_wiem', miejsce: 'nie_wiem', nadzor: 'nie_wiem' }), 'zlecenie', '2026-09-03')
    expect(w?.stan).toBe('zalezy')
    expect(w?.naglowek).toMatch(/Za mało wiadomo/)
    expect(w?.uzasadnienie).toMatch(/Na 3 z sześciu pytań/)
  })

  it('blok „co sprawdzic” budujemy z pytan bez odpowiedzi, nie ze wszystkich brakow', () => {
    const w = ocen(umowa, odp({ sprzet: 'nie_wiem', wylacznosc: 'nie_wiem', zastepstwo: 'nie_wiem' }), 'zlecenie', '2026-09-03')
    expect(w?.do_sprawdzenia).toHaveLength(2)
    // Pytania odpowiedziane „nie” (godziny, miejsce, nadzor) nie moga tu trafic.
    expect(w?.do_sprawdzenia?.join(' ')).not.toMatch(/Czy godziny są rzeczywiście/)
    expect(w?.do_sprawdzenia?.join(' ')).toMatch(/sprzęt|zleceniodawców|zastępstwo/)
  })

  it('badanie 4: trzy „Nie wiem” i trzy „Tak” — niewiedza wygrywa z punktacja', () => {
    // Trzy cechy stwierdzone dawalyby bursztyn punktowy (3-4 punkty), ale regula
    // progowa stoi PRZED punktowa, wiec czlowiek dostaje werdykt o niewiedzy.
    const w = ocen(
      umowa,
      { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'nie_wiem', sprzet: 'nie_wiem', wylacznosc: 'nie_wiem' },
      'zlecenie', '2026-09-03',
    )
    expect(w?.stan).toBe('zalezy')
    expect(w?.naglowek).toMatch(/Za mało wiadomo/)
    // Oba werdykty sa bursztynowe, wiec zbieg nie zmienia koloru — zmienia tresc.
    expect(w?.uzasadnienie).not.toMatch(/Część cech wskazuje/)
  })

  it('dwa „Nie wiem” to za malo — rozstrzyga punktacja, nie prog', () => {
    const w = ocen(
      umowa,
      { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'nie', sprzet: 'nie_wiem', wylacznosc: 'nie_wiem' },
      'zlecenie', '2026-09-03',
    )
    // Cztery cechy stwierdzone -> bursztyn punktowy. Prog niewiedzy sie nie odpalil.
    expect(w?.stan).toBe('zalezy')
    expect(w?.naglowek).toMatch(/Część cech wskazuje/)
  })

  it('badanie 4: zielony werdykt wymaga najwyzej JEDNEGO „Nie wiem”', () => {
    // Arytmetyka progu: kazde „Nie wiem” to punkt mniej, a zielen zaczyna sie od pieciu
    // na szesc. Przy dwoch „Nie wiem” maksimum wynosi cztery, wiec zielony jest
    // nieosiagalny — nie z powodu reguly progowej, tylko z samego liczenia.
    const jedno = ocen(
      umowa,
      { godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'nie', sprzet: 'tak', wylacznosc: 'nie_wiem' },
      'zlecenie', '2026-09-03',
    )
    expect(jedno?.stan).toBe('przysluguje')

    const wszystkieZDwoma = policzPunkty(umowa, {
      godziny: 'tak', miejsce: 'tak', nadzor: 'tak', zastepstwo: 'nie', sprzet: 'nie_wiem', wylacznosc: 'nie_wiem',
    })
    expect(wszystkieZDwoma?.punkty).toBeLessThanOrEqual(4)
  })

  it('ostrzezenie o konfrontacji zostaje takze przy werdykcie z niewiedzy', () => {
    const w = ocen(umowa, odp({ godziny: 'nie_wiem', miejsce: 'nie_wiem', nadzor: 'nie_wiem' }), 'zlecenie', '2026-09-03')
    expect(w?.ostrzezenie).toMatch(/Ryzyko, że pracodawca zareaguje źle/)
  })
})

/**
 * ZMIANA 1.3, sekcja 4 — normy ciasnoty w sytuacji 7.
 * Wartosci (13 m³ i 2 m²) sa rozstrzygnieciem zespolu i nosza oznaczenie
 * wymagajace potwierdzenia. Silnik liczy z PRZEDZIALOW, wiec rozroznia
 * „na pewno za malo” od „moze byc za malo”.
 */
describe('zmiana 1.3: przeliczenie ciasnoty', () => {
  const zimno = znajdz('zimno')!
  const D = '2026-09-03'

  const bezCiasnoty = { ile_stopni: 'powyzej18', jaka_praca: 'biurowa', ciasno: 'nie' }
  const zCiasnota = (o: Record<string, string>) => ({
    ile_stopni: 'powyzej18', jaka_praca: 'biurowa', ciasno: 'tak', ...o,
  })

  it('pytania o wymiary pokazuja sie DOPIERO po zgloszeniu ciasnoty', () => {
    expect(widocznePytania(zimno, {}).map((p) => p.id)).toEqual(['ile_stopni', 'jaka_praca', 'ciasno'])
    expect(widocznePytania(zimno, bezCiasnoty).map((p) => p.id)).toEqual(['ile_stopni', 'jaka_praca', 'ciasno'])
    expect(widocznePytania(zimno, { ciasno: 'tak' }).map((p) => p.id))
      .toEqual(['ile_stopni', 'jaka_praca', 'ciasno', 'ile_osob', 'powierzchnia_pom', 'wysokosc_pom'])
  })

  it('dziesiec osob w malym niskim pomieszczeniu — norma przekroczona na pewno', () => {
    // 6-10 m², wysokosc 2,2-2,5 m, 6-10 osob: najlepszy uklad to 10*2,5/6 = 4,2 m³.
    const o = zCiasnota({ ile_osob: 'do10', powierzchnia_pom: 'do10', wysokosc_pom: 'niskie' })
    const c = policzCiasnote(zimno, o, D)
    expect(c?.stan).toBe('ponizej')
    const w = ocen(zimno, o, 'o_prace', D)
    expect(w?.stan).toBe('przysluguje')
    expect(w?.naglowek).toMatch(/mniej, niż przewiduje norma/)
    // Wynik podany liczbami, nie ogolnikiem.
    expect(w?.uzasadnienie).toMatch(/m³/)
    expect(w?.uzasadnienie).toMatch(/13 m³/)
  })

  it('dwie osoby w duzym pomieszczeniu — norma dotrzymana', () => {
    const o = zCiasnota({ ile_osob: 'do2', powierzchnia_pom: 'ponad40', wysokosc_pom: 'wysokie' })
    const c = policzCiasnote(zimno, o, D)
    expect(c?.stan).toBe('powyzej')
    expect(ocen(zimno, o, 'o_prace', D)?.stan).toBe('nie_przysluguje')
  })

  it('uklad na granicy daje bursztyn i prosbe o pomiar, a nie werdykt', () => {
    // 20-40 m², 2,5-3 m, 6-10 osob: od 20*2,5/10 = 5 m³ do 40*3/6 = 20 m³.
    const o = zCiasnota({ ile_osob: 'do10', powierzchnia_pom: 'do40', wysokosc_pom: 'zwykle' })
    const c = policzCiasnote(zimno, o, D)
    expect(c?.stan).toBe('granica')
    const w = ocen(zimno, o, 'o_prace', D)
    expect(w?.stan).toBe('zalezy')
    expect(w?.do_sprawdzenia?.join(' ')).toMatch(/dokładne wymiary/)
  })

  it('bez zgloszonej ciasnoty przeliczenia nie ma, a werdykt jest temperaturowy', () => {
    expect(policzCiasnote(zimno, bezCiasnoty, D)).toBeNull()
    expect(ocen(zimno, bezCiasnoty, 'o_prace', D)?.naglowek).toMatch(/progi nie są przekroczone/)
  })

  it('normy nosza oznaczenie wymagajace potwierdzenia', () => {
    const o = zCiasnota({ ile_osob: 'do10', powierzchnia_pom: 'do10', wysokosc_pom: 'niskie' })
    const w = ocen(zimno, o, 'o_prace', D)
    expect(w?.ile.join(' ')).toMatch(/czekają na potwierdzenie przez specjalistę/)
    expect(w?.podstawa).toMatch(/do uzupełnienia przez specjalistę/)
  })
})
