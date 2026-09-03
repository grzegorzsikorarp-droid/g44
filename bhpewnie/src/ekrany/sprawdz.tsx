import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, PlanszaPelnejWersji, PodstawaPrawna, Przycisk, ZnakWerdyktu } from '../komponenty/podstawowe'
import { t, sytuacja as znajdzSytuacje } from '../dane/wczytaj'
import {
  doSprawdzenia, ocen, ocenPosrednio, opcjeZCech, sytuacjeWKolejnosci, werdyktBezPytan, widocznePytania,
} from '../silnik/sprawdzacz'
import { STAN_PRAWNY, wypelnij } from '../silnik/parametry'
import { rozwiazProfil } from '../silnik/reguly'
import { pustyProfil } from '../magazyn/magazyn'
import type { AkcjaWerdyktu, StanKafla, Umowa, Werdykt } from '../typy'
import porownanie from '../../content/porownanie-umow.json'

/* ================= E2.1 Lista sytuacji ================= */

export function ListaSytuacji() {
  const { nawiguj, dzis } = useAplikacja()
  const lista = useMemo(() => sytuacjeWKolejnosci(dzis), [dzis])

  return (
    <>
      <Naglowek tytul={t('sprawdz.naglowek')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <p className="opis">{t('sprawdz.opis')}</p>
        <ul className="lista-czysta">
          {lista.map((s) => (
            <li key={s.id}>
              <button className="kafel kafel--swobodny" onClick={() => nawiguj('E2.2', { sytuacja: s.id })}>
                <span className="kafel__ikona" style={s.pelna ? undefined : { background: 'var(--szary-stan-tlo)', color: 'var(--szary-stan)' }}>
                  <Ikona nazwa={s.pelna ? 'lupa' : 'dokument'} />
                </span>
                <span className="kafel__tresc">
                  <b style={{ fontSize: '1.0625rem' }}>{s.etykieta}</b>
                  {!s.pelna && <span className="drobne" style={{ display: 'block' }}>{t('wspolne.w_pelnej_wersji')}</span>}
                </span>
                <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
              </button>
            </li>
          ))}
        </ul>
        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

/* ================= E2.2 Pytania sprawdzacza ================= */

export function PytaniaSprawdzacza({ dane }: { dane: Record<string, unknown> }) {
  const { stan, wroc, nawiguj, zastapWidok, dzis } = useAplikacja()
  const id = dane.sytuacja as string
  const sytuacja = znajdzSytuacje(id)
  const profil = stan.profil ?? pustyProfil()
  /*
    W kreatorze profilu jeszcze nie ma — odpowiedź o umowie leży dopiero w szkicu.
    Bez tego pakiet umowy uruchomiony z kreatora widziałby wartość bezpieczną
    („umowa o pracę”) i pokazałby ekran informacyjny zamiast pytań.
  */
  const umowa = (dane.umowa as Umowa | undefined) ?? rozwiazProfil(profil, dzis).umowa

  const [nr, ustawNr] = useState(0)
  const [odpowiedzi, ustawOdpowiedzi] = useState<Record<string, string>>({})
  const [pytaOWyjscie, ustawPytaOWyjscie] = useState(false)
  const [pokazanoPosredni, ustawPokazanoPosredni] = useState(false)

  if (!sytuacja) return null

  // Zmiana 1.2, punkt 4.3: pozycja widoczna dla wszystkich, ale przy umowie o pracę
  // zamiast pytań pokazujemy krótki ekran informacyjny.
  if (sytuacja.nie_dotyczy?.gdy_umowa.includes(umowa)) {
    return (
      <>
        <Naglowek naWstecz={wroc} oczko={sytuacja.etykieta} />
        <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
          <h1>{sytuacja.nie_dotyczy.naglowek}</h1>
          <p style={{ fontSize: '1.0625rem' }}>{sytuacja.nie_dotyczy.tresc}</p>
          <Przycisk odmiana="drugi" ikona="tabela" onClick={() => nawiguj('E2.8')}>
            Zobacz porównanie form zatrudnienia
          </Przycisk>
          <Przycisk odmiana="obrys" onClick={wroc}>Wróć do listy spraw</Przycisk>
          <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
        </div>
      </>
    )
  }

  // Sytuacje niepełne: albo uczciwy werdykt od razu (zlecenie), albo plansza.
  if (!sytuacja.pelna) {
    const werdykt = werdyktBezPytan(sytuacja, umowa, dzis)
    if (werdykt) {
      return <KartaWyniku dane={{ sytuacja: id, werdykt, odpowiedzi: {} }} />
    }
    return (
      <>
        <Naglowek naWstecz={wroc} oczko={sytuacja.etykieta} />
        <PlanszaPelnejWersji czego={sytuacja.etykieta} naPowrot={wroc} />
      </>
    )
  }

  /*
    ZMIANA 1.3: lista pytań liczy się z dotychczasowych odpowiedzi, bo pytanie
    może mieć warunek `gdy`. Pytania o wymiary pomieszczenia pokazują się dopiero
    po „Tak, ledwo się mieścimy” — pytanie o kubaturę kogoś, kto właśnie powiedział,
    że miejsca wystarcza, to trzy dotknięcia bez żadnego skutku.
    Warunek wolno oprzeć wyłącznie na pytaniu STOJĄCYM WYŻEJ — pytanie zależne
    od późniejszego nigdy by się nie pojawiło.
  */
  const pytania = widocznePytania(sytuacja, odpowiedzi)
  const pytanie = pytania[nr]
  const opcje = opcjeZCech(sytuacja, pytanie, rozwiazProfil(profil, dzis))

  const odpowiedz = (wartosc: string) => {
    const nowe = { ...odpowiedzi, [pytanie.id]: wartosc }
    ustawOdpowiedzi(nowe)
    // Lista przeliczona z NOWĄ odpowiedzią: ta odpowiedź mogła właśnie odsłonić
    // albo ukryć pytania stojące dalej.
    const poOdpowiedzi = widocznePytania(sytuacja, nowe)
    if (nr + 1 < poOdpowiedzi.length) {
      /*
        E2.4 — wynik pośredni. Pokazujemy go tylko wtedy, gdy naprawdę oszczędza pracę:
        sprawa jest już rozstrzygnięta, a do końca zostały CO NAJMNIEJ dwa pytania.
        Przy jednym pytaniu do końca ekran pośredni tylko wydłużałby drogę.
        Najwyżej raz na przebieg.
      */
      const zostaloPytan = poOdpowiedzi.length - nr - 1
      const posredni = pokazanoPosredni || zostaloPytan < 2
        ? null
        : ocenPosrednio(sytuacja, nowe, umowa, dzis)
      ustawNr(nr + 1)
      if (posredni) {
        ustawPokazanoPosredni(true)
        nawiguj('E2.4', {
          sytuacja: id, werdykt: posredni, odpowiedzi: nowe, zostalo: zostaloPytan,
        })
      }
    } else {
      const werdykt = ocen(sytuacja, nowe, umowa, dzis)
      zastapWidok('E2.3', { sytuacja: id, werdykt, odpowiedzi: nowe })
    }
  }

  const cofnij = () => {
    if (nr === 0) return wroc()
    const bez = { ...odpowiedzi }
    delete bez[pytania[nr - 1].id]
    ustawOdpowiedzi(bez)
    ustawNr(nr - 1)
  }

  // Odpowiedź mogła zwinąć listę (np. cofnięcie „ciasno” na „nie”) — wtedy `nr`
  // wskazywałby poza koniec. Wracamy na ostatnie istniejące pytanie.
  if (!pytanie) {
    ustawNr(Math.max(0, pytania.length - 1))
    return null
  }

  return (
    <>
      <Naglowek
        oczko={sytuacja.etykieta}
        naWstecz={cofnij}
        naZamkniecie={() => ustawPytaOWyjscie(true)}
        opisZamkniecia="Przerwij sprawdzanie"
      />
      <div className="postep" role="progressbar" aria-valuemin={1} aria-valuemax={pytania.length} aria-valuenow={nr + 1}>
        <span className="postep__wypelnienie" style={{ width: `${((nr + 1) / pytania.length) * 100}%` }} />
      </div>

      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 16 }}>
        <p className="oczko">Pytanie {nr + 1} z {pytania.length}</p>
        <h1>{pytanie.tresc}</h1>
        <div className="kolumna">
          {opcje.map((o) => (
            <button key={o.wartosc} className="odpowiedz" onClick={() => odpowiedz(o.wartosc)}>
              <span className="odpowiedz__znacznik" aria-hidden="true" />
              <span>{o.etykieta}</span>
            </button>
          ))}
        </div>
      </div>

      {pytaOWyjscie && (
        <div className="nakladka" onClick={(e) => { if (e.target === e.currentTarget) ustawPytaOWyjscie(false) }}>
          <div className="arkusz" role="dialog" aria-modal="true" aria-label="Przerwać sprawdzanie?">
            <div className="uchwyt" />
            <div className="kolumna">
              <h2>Przerwać sprawdzanie? Odpowiedzi, których udzieliłeś(-aś), zostaną skasowane.</h2>
              <Przycisk odmiana="obrys" onClick={() => ustawPytaOWyjscie(false)}>Wróć do pytań</Przycisk>
              <Przycisk onClick={wroc}>Przerwij i skasuj</Przycisk>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ================= E2.3 Karta wyniku ================= */

/* Każdy stan niesie kolor, KSZTAŁT i SŁOWO — sam kolor nigdy nie wystarcza.
   Test: zrzut w skali szarości musi pozostać jednoznaczny. */
const NAGLOWKI_STANU: Record<string, { napis: string; ikona: string }> = {
  przysluguje: { napis: 'Przysługuje Ci', ikona: 'ptaszek' },
  zalezy: { napis: 'To zależy', ikona: 'fala' },
  nie_przysluguje: { napis: 'Nie przysługuje', ikona: 'kreska' },
}

export function KartaWyniku({ dane }: { dane: Record<string, unknown> }) {
  const { nawiguj, wrocDoZakladki, dzis, stan } = useAplikacja()
  const werdykt = dane.werdykt as Werdykt | null
  const idSytuacji = dane.sytuacja as string
  const sytuacja = znajdzSytuacje(idSytuacji)
  const umowa = rozwiazProfil(stan.profil ?? pustyProfil(), dzis).umowa

  if (!werdykt) {
    return (
      <>
        <Naglowek naWstecz={() => wrocDoZakladki('E2.1')} oczko={sytuacja?.etykieta} />
        <div className="kolumna" style={{ flex: 1, justifyContent: 'center' }}>
          <h1>Dla tego zestawu odpowiedzi nie mamy jeszcze gotowej wskazówki</h1>
          <p className="opis">{t('stanowisko.luka')}</p>
          <Przycisk odmiana="obrys" onClick={() => wrocDoZakladki('E2.1')}>Wróć do listy sytuacji</Przycisk>
        </div>
      </>
    )
  }

  const stanNaglowek = NAGLOWKI_STANU[werdykt.stan]
  const doSprawdzeniaLista = doSprawdzenia(werdykt)

  return (
    <>
      <Naglowek
        naWstecz={() => wrocDoZakladki('E2.1')}
        oczko={sytuacja?.etykieta}
        naZamkniecie={() => wrocDoZakladki('E2.1')}
        opisZamkniecia="Zamknij wynik"
      />

      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <div className={`werdykt werdykt--${werdykt.stan}`}>
          <span className="werdykt__ikona"><Ikona nazwa={stanNaglowek.ikona} rozmiar={30} /></span>
          <div>
            {/* Stan niesiony ikoną i słowem, nie samym kolorem (wymóg dostępności). */}
            <p className="oczko" style={{ color: 'inherit', opacity: 0.85 }}>{stanNaglowek.napis}</p>
            <h1 style={{ color: 'inherit', margin: '2px 0 0' }}>{werdykt.naglowek}</h1>
          </div>
        </div>

        <p style={{ fontSize: '1.0625rem' }}>{werdykt.uzasadnienie}</p>

        <div className={`blok-ile${werdykt.stan === 'nie_przysluguje' ? ' blok-ile--szary' : ''}`}>
          <p className="oczko">{t('wynik.ile')}</p>
          <ul>{werdykt.ile.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>

        {doSprawdzeniaLista.length > 0 && (
          <div className="pas">
            <Ikona nazwa="lupa" rozmiar={22} />
            <div>
              <p className="oczko" style={{ color: 'inherit' }}>{t('wynik.do_sprawdzenia')}</p>
              <ul style={{ margin: '6px 0 0 18px' }}>
                {doSprawdzeniaLista.map((x, i) => <li key={i}>{x}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/*
          Zmiana 1.2, punkt 5.1: z każdej szarej karty, której powodem jest umowa
          cywilnoprawna, prowadzi odnośnik do pakietu umowy. Odmowa nie może kończyć się
          zdaniem „bo masz zlecenie” bez pokazania, że to bywa do podważenia.
        */}
        {werdykt.stan === 'nie_przysluguje' && idSytuacji !== 'umowa'
          && (umowa === 'zlecenie' || umowa === 'dzialalnosc') && (
          <button
            className="kafel kafel--swobodny"
            data-test="odnosnik-pakiet-umowy"
            onClick={() => nawiguj('E2.2', { sytuacja: 'umowa' })}
          >
            <span className="kafel__ikona"><Ikona nazwa="dokument" /></span>
            <span className="kafel__tresc">
              <b style={{ display: 'block' }}>Sprawdź, czy Twoja umowa nie powinna być umową o pracę</b>
              <span className="drobne">Sześć pytań, minuta</span>
            </span>
            <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
          </button>
        )}

        {/* Reguła nienegocjowalna: karta „nie przysługuje” zawsze kończy się tym blokiem.
            Aplikacja nie zostawia użytkownika z samą odmową. */}
        {(werdykt.pokrewne || werdykt.stan === 'nie_przysluguje') && (
          <div className="blok-zamiast kolumna kolumna--ciasna">
            <p className="oczko" style={{ color: 'var(--pewnosc-nacisk)' }}>
              {werdykt.stan === 'nie_przysluguje' ? t('wynik.zamiast') : t('wynik.pokrewne')}
            </p>
            {werdykt.pokrewne ? (
              <button
                className="kafel kafel--swobodny"
                onClick={() => werdykt.pokrewne!.sprawdzacz && nawiguj('E2.2', { sytuacja: werdykt.pokrewne!.sprawdzacz })}
              >
                <span className="kafel__ikona"><Ikona nazwa="lupa" /></span>
                <span className="kafel__tresc">
                  <b style={{ display: 'block' }}>{werdykt.pokrewne.tytul}</b>
                  <span className="drobne">Sprawdź to w swojej sytuacji</span>
                </span>
                <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
              </button>
            ) : (
              <button className="kafel kafel--swobodny" onClick={() => wrocDoZakladki('E1.1')}>
                <span className="kafel__ikona"><Ikona nazwa="kask" /></span>
                <span className="kafel__tresc">
                  <b style={{ display: 'block' }}>Twoje pozostałe uprawnienia</b>
                  <span className="drobne">Zobacz, co przysługuje Ci na tym stanowisku</span>
                </span>
                <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
              </button>
            )}
          </div>
        )}

        {/* Zmiana 1.2, punkt 5.4: porównanie form zatrudnienia. */}
        {werdykt.porownanie && (
          <Przycisk odmiana="drugi" ikona="tabela" onClick={() => nawiguj(werdykt.porownanie!)}>
            Porównaj: co masz teraz, a co miałbyś na umowie o pracę
          </Przycisk>
        )}

        {/* Punkt 6.4: z sytuacji „Nie mam kiedy odpocząć” prowadzimy do ewidencji. */}
        {idSytuacji === 'odpoczynek' && (
          <button className="kafel kafel--swobodny" data-test="odnosnik-ewidencja" onClick={() => nawiguj('E7.1')}>
            <span className="kafel__ikona"><Ikona nazwa="zegar" /></span>
            <span className="kafel__tresc">
              <b style={{ display: 'block' }}>Zacznij notować czas, żeby mieć dowód</b>
              <span className="drobne">Godziny zostają na tym telefonie</span>
            </span>
            <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
          </button>
        )}

        <PodstawaPrawna tresc={werdykt.podstawa} stanPrawny={STAN_PRAWNY} />

        {/*
          Ostrzeżenie stoi NAD akcjami, nie pod nimi (zmiana 1.2, punkt 5.3).
          Konsultacja przed konfrontacją jest zasadą, a nie sugestią do przeczytania później.
        */}
        {werdykt.ostrzezenie && (
          <div className="ostrzezenie-ryzyka" data-test="ostrzezenie">
            <span className="ostrzezenie-ryzyka__plakietka">
              <Ikona nazwa="wykrzyknik" rozmiar={20} />
              ZANIM ZROBISZ KROK
            </span>
            <p>{werdykt.ostrzezenie}</p>
            {/*
              Jedno wyjście, nie trzy. Pomoc DAJE wyjście (numer, ścieżkę, człowieka);
              ostrzeżenie WSTRZYMUJE KROK i odsyła do Pomocy — stąd różnica w formie
              (ROZBIEZNOSCI_DESIGN.md, wpis (q)).
            */}
            <button className="odnosnik" onClick={() => nawiguj('E4.13')}>Z kim mogę porozmawiać</button>
          </div>
        )}

        {werdykt.akcje_wlasne
          ? <AkcjeWlasne akcje={werdykt.akcje_wlasne} idSytuacji={idSytuacji} />
          : (
            /* Trzy stałe akcje — ZAWSZE w tej kolejności (zasada 7). */
            <div className="kolumna">
              <Przycisk ikona="dokument" onClick={() => nawiguj('E2.5', { werdykt })}>{t('wynik.pdf')}</Przycisk>
              <Przycisk odmiana="drugi" ikona="mowa" onClick={() => nawiguj('E2.6', { werdykt })}>{t('wynik.skrypt')}</Przycisk>
              <Przycisk odmiana="obrys" ikona="dzwonek" onClick={() => nawiguj('E2.7', { werdykt, sytuacja: idSytuacji })}>{t('wynik.przypomnij')}</Przycisk>
            </div>
          )}

        {werdykt.informacja && (
          <div className="karta kolumna kolumna--ciasna">
            <p className="drobne">{werdykt.informacja}</p>
          </div>
        )}

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

/**
 * Trzy akcje własne zamiast standardowych (zmiana 1.2, punkt 5.5).
 * Nie ma tu „Pobierz wniosek” — celowo: pismo do pracodawcy w sprawie ustalenia
 * stosunku pracy, bez wcześniejszej konsultacji, jest ryzykowne dla użytkownika.
 */
function AkcjeWlasne({ akcje, idSytuacji }: { akcje: AkcjaWerdyktu[]; idSytuacji: string }) {
  const { nawiguj, zmienStan, chmurka } = useAplikacja()

  return (
    <div className="kolumna" data-test="akcje-wlasne">
      {akcje.map((a, i) => (
        <div key={i} className="karta kolumna kolumna--ciasna">
          <Przycisk
            odmiana={i === 0 ? 'glowny' : i === 1 ? 'drugi' : 'obrys'}
            ikona={a.ikona}
            onClick={() => {
              if (a.rodzaj === 'przypomnienie') {
                zmienStan((s) => ({
                  ...s,
                  budziki: { ...s.budziki, powrot_po_pomocy: true },
                  przerwane: {
                    ...s.przerwane,
                    [`przypomnienie-${idSytuacji}`]: { krok: `za ${a.wartosc} dni`, kiedy: new Date().toISOString() },
                  },
                }))
                chmurka('Przypomnimy za tydzień. Zobaczysz to w „Moje budziki”.')
              } else if (a.rodzaj === 'ekran' && a.wartosc) {
                nawiguj(a.wartosc)
              } else {
                // Numer i kontakt czekają na uzupełnienie — nie udajemy, że działają.
                chmurka('Ten kontakt czeka na uzupełnienie przez zespół projektu.')
              }
            }}
          >
            {a.etykieta}
          </Przycisk>
          {a.opis && <p className="drobne">{a.opis}</p>}
        </div>
      ))}
    </div>
  )
}

/* ================= E2.4 Wynik pośredni ================= */

/**
 * Ekran, którego brief 1.1 nie opisał, mimo że numer E2.4 był w numeracji zarezerwowany
 * (patrz ROZBIEZNOSCI.md, wpisy 2 i 15). Zmiana 1.2 wymienia go wprost jako „wynik pośredni”.
 *
 * Rola: gdy odpowiedzi udzielone do tej pory już rozstrzygają sprawę, a pytania jeszcze
 * zostały, pokazujemy to, co już wiadomo, i pozwalamy wybrać — zobaczyć wynik teraz
 * albo doprecyzować go do końca.
 */
export function WynikPosredni({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, zastapWidok } = useAplikacja()
  const werdykt = dane.werdykt as Werdykt | null
  const idSytuacji = dane.sytuacja as string
  const odpowiedzi = (dane.odpowiedzi ?? {}) as Record<string, string>
  const zostalo = Number(dane.zostalo ?? 0)
  const sytuacja = znajdzSytuacje(idSytuacji)

  if (!werdykt) return null
  const stanNaglowek = NAGLOWKI_STANU[werdykt.stan]

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={sytuacja?.etykieta} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="oczko">Tyle już wiemy</p>
        <div className={`werdykt werdykt--${werdykt.stan}`}>
          <span className="werdykt__ikona"><Ikona nazwa={stanNaglowek.ikona} rozmiar={30} /></span>
          <div>
            <p className="oczko" style={{ color: 'inherit', opacity: 0.85 }}>{stanNaglowek.napis}</p>
            <h1 style={{ color: 'inherit', margin: '2px 0 0' }}>{werdykt.naglowek}</h1>
          </div>
        </div>

        <p style={{ fontSize: '1.0625rem' }}>{werdykt.uzasadnienie}</p>

        <p className="opis">
          {zostalo === 1
            ? 'Zostało jeszcze jedno pytanie, które to doprecyzuje.'
            : `Zostały jeszcze ${zostalo} pytania, które to doprecyzują.`}
        </p>

        <div className="kolumna">
          <Przycisk onClick={() => zastapWidok('E2.3', { sytuacja: idSytuacji, werdykt, odpowiedzi })}>
            Pokaż wynik teraz
          </Przycisk>
          <Przycisk odmiana="obrys" onClick={wroc}>Odpowiedz do końca</Przycisk>
        </div>

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

/* ================= E2.8 Porównanie form zatrudnienia ================= */

/**
 * Wartość w porównaniu też niesie znak, nie sam tekst. „Nie” to odmowa,
 * „z umowy” albo „tylko gdy…” to stan zależny — prawo nie rozstrzyga, rozstrzyga umowa.
 */
function stanWartosci(wartosc: string): StanKafla {
  const w = wartosc.toLowerCase()
  if (w.startsWith('nie')) return 'nie_przysluguje'
  if (w.includes('tylko') || w.includes('ograniczony') || w.includes('jeśli') || w.includes('umowy')) return 'zalezy'
  return 'przysluguje'
}

export function PorownanieUmow() {
  const { wroc, nawiguj, stan, dzis } = useAplikacja()
  // Którą kolumnę oznaczyć jako „Ty” — to jedyne miejsce w aplikacji, gdzie dwie wartości
  // stoją obok siebie, więc trzeba powiedzieć, która jest jego (design 1.2, §8.6).
  const umowaUzytkownika = rozwiazProfil(stan.profil ?? pustyProfil(), dzis).umowa
  const mojaKolumna: 'cywilna' | 'etat' = umowaUzytkownika === 'o_prace' ? 'etat' : 'cywilna'
  const wiersze = porownanie.wiersze.map((w) => ({
    cecha: wypelnij(w.cecha, dzis).tekst,
    cywilna: wypelnij(w.cywilna, dzis).tekst,
    etat: wypelnij(w.etat, dzis).tekst,
  }))

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Porównanie" tytul={porownanie.tytul} />
      <div className="kolumna kolumna--luzna warstwa-pole" style={{ flex: 1 }}>
        <p className="opis">
          Co się zmienia w Twoich uprawnieniach, jeśli forma zatrudnienia jest inna.
          Wyłącznie to, co aplikacja zna z własnych modułów wiedzy.
        </p>

        <div className="rzad">
          <span className={`znacznik${mojaKolumna === 'cywilna' ? ' znacznik--spokojny' : ' znacznik--szary'}`}>
            {porownanie.naglowki.cywilna}{mojaKolumna === 'cywilna' ? ' — Ty' : ''}
          </span>
          <span className={`znacznik${mojaKolumna === 'etat' ? ' znacznik--spokojny' : ' znacznik--szary'}`}>
            {porownanie.naglowki.etat}{mojaKolumna === 'etat' ? ' — Ty' : ''}
          </span>
        </div>

        {/*
          LISTA PAR na telefonie, tabela dopiero od 600 px (design 1.2, §8.6).
          Nagłówek stoi PRZY DANEJ, nie 300 px wyżej w wierszu tabeli. Obie wartości
          niosą te same trzy znaki co kafle: „Nie” bez znaku byłoby jedynym miejscem
          w aplikacji, gdzie odmowa nie ma kształtu.
        */}
        <ul className="lista-czysta tylko-telefon">
          {wiersze.map((w, i) => (
            <li key={i}>
              <div className="para">
                <p className="para__nazwa">{w.cecha}</p>
                <div className="para__wartosci">
                  <div className="para__kolumna">
                    <span className="para__etykieta">{porownanie.naglowki.cywilna}</span>
                    <span className="para__wartosc">
                      <ZnakWerdyktu stan={stanWartosci(w.cywilna)} rozmiar={18} />
                      {w.cywilna}
                    </span>
                  </div>
                  <div className="para__kolumna">
                    <span className="para__etykieta">{porownanie.naglowki.etat}</span>
                    <span className="para__wartosc">
                      <ZnakWerdyktu stan={stanWartosci(w.etat)} rozmiar={18} />
                      {w.etat}
                    </span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="tabela-przewijana od-tabletu" tabIndex={0} role="region" aria-label="Porównanie form zatrudnienia">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">{porownanie.naglowki.cecha || 'Uprawnienie'}</th>
                <th scope="col">{porownanie.naglowki.cywilna}</th>
                <th scope="col">{porownanie.naglowki.etat}</th>
              </tr>
            </thead>
            <tbody>
              {wiersze.map((w, i) => (
                <tr key={i}>
                  <th scope="row">{w.cecha}</th>
                  <td>{w.cywilna}</td>
                  <td>{w.etat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p>{porownanie.pod_tabela}</p>

        <PodstawaPrawna tresc={porownanie.podstawa} stanPrawny={STAN_PRAWNY} />

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>

      {/*
        Wyjście z ekranu w stałym pasie — jak dokument w E1.1 i z tego samego powodu:
        to jedyne wyjście z ekranu, który sam niczego nie rozstrzyga (design 1.2, §8.6).
      */}
      <div className="warstwa-pas">
        <Przycisk odmiana="drugi" ikona="lupa" onClick={() => nawiguj('E2.2', { sytuacja: 'umowa' })}>
          Co zrobić, jeśli to moja sytuacja
        </Przycisk>
      </div>
    </>
  )
}

/* ================= E2.5 Podgląd wniosku PDF ================= */

export function PodgladWniosku({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, chmurka } = useAplikacja()
  const werdykt = dane.werdykt as Werdykt
  const [zapisuje, ustawZapisuje] = useState(false)

  const zapisz = async () => {
    ustawZapisuje(true)
    try {
      const { wniosekDoPracodawcy, zapiszPlik } = await import('../pdf/dokumenty')
      const blob = await wniosekDoPracodawcy({
        tytul: werdykt.pismo.tytul,
        akapity: werdykt.pismo.akapity,
        podstawa: werdykt.podstawa,
      })
      zapiszPlik(blob, 'wniosek-bhpewnie.pdf')
      chmurka('Zapisaliśmy pismo na Twoim urządzeniu.')
    } catch {
      chmurka('Nie udało się złożyć dokumentu. Spróbuj jeszcze raz.')
    } finally {
      ustawZapisuje(false)
    }
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={t('pdf.podglad')} tytul={werdykt.pismo.tytul} />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="dokument">
          <p style={{ textAlign: 'right', fontSize: '0.875rem' }}>……………………, dnia ……………………</p>
          <div className="dokument__pole">{t('pdf.imie')}: ……………………………………………</div>
          <div className="dokument__pole">Stanowisko: ……………………………………………</div>
          <div className="dokument__pole">Pracodawca: ……………………………………………</div>
          <h4>{werdykt.pismo.tytul}</h4>
          {werdykt.pismo.akapity.map((a, i) => (
            <p key={i} style={{ marginBottom: 10, textAlign: 'justify' }}>{a}</p>
          ))}
          <p style={{ fontSize: '0.875rem', color: '#555' }}>Podstawa prawna: {werdykt.podstawa}</p>
          <p style={{ fontSize: '0.8125rem', color: '#555' }}>Stan prawny na {STAN_PRAWNY}.</p>
          <div className="dokument__pole" style={{ marginTop: 24 }}>{t('pdf.podpis')}: ……………………………………</div>
          <div className="pas-oznaczen">
            <span className="pas-oznaczen__miejsce">Znak Funduszy Europejskich<br />— plik źródłowy</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'block', width: 52, height: 32, border: '1px solid #D9D2C8' }}>
                <span style={{ display: 'block', height: 16, background: '#FFFFFF' }} />
                <span style={{ display: 'block', height: 16, background: '#D4213D' }} />
              </span>
              <span style={{ fontSize: 10, color: '#5A6068' }}>Rzeczpospolita Polska</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'block', width: 48, height: 32, background: '#003399' }} />
              <span style={{ fontSize: 10, color: '#5A6068' }}>Dofinansowane przez<br />Unię Europejską</span>
            </span>
            <span style={{ fontSize: 11, color: '#22262B', fontWeight: 600 }}>
              Forum Związków<br />Zawodowych
            </span>
          </div>
          <p style={{ fontSize: '0.6875rem', color: '#5A6068', marginTop: 8 }}>{t('pdf.stopka')}</p>
        </div>

        <Przycisk ikona="dokument" onClick={zapisz} wylaczony={zapisuje}>
          {zapisuje ? 'Składamy dokument…' : t('pdf.zapisz')}
        </Przycisk>
        <Przycisk odmiana="obrys" onClick={wroc}>{t('wspolne.zamknij')}</Przycisk>
      </div>
    </>
  )
}

/* ================= E2.6 Skrypt rozmowy ================= */

export function SkryptRozmowy({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, chmurka } = useAplikacja()
  const werdykt = dane.werdykt as Werdykt

  const kopiuj = async (tekst: string) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(tekst)
      else {
        const pole = document.createElement('textarea')
        pole.value = tekst
        document.body.appendChild(pole)
        pole.select()
        document.execCommand('copy')
        pole.remove()
      }
      chmurka(t('wspolne.skopiowano'))
    } catch {
      chmurka('Nie udało się skopiować. Zaznacz tekst i skopiuj ręcznie.')
    }
  }

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('wynik.skrypt')} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="opis">
          Możesz powiedzieć to wprost albo wysłać wiadomość. Przepis jest w środku — grzecznie, ale konkretnie.
        </p>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">{t('skrypt.ustny')}</p>
          <p style={{ fontSize: '1.0625rem', fontStyle: 'italic' }}>„{werdykt.skrypt.ustny}”</p>
          <Przycisk odmiana="drugi" ikona="kopiuj" onClick={() => kopiuj(werdykt.skrypt.ustny)}>{t('wspolne.kopiuj')}</Przycisk>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">{t('skrypt.mail')}</p>
          <p><b>{t('skrypt.temat')}:</b> {werdykt.skrypt.mail.temat}</p>
          <p style={{ whiteSpace: 'pre-line' }}>{werdykt.skrypt.mail.tresc}</p>
          <Przycisk
            odmiana="drugi" ikona="kopiuj"
            onClick={() => kopiuj(`Temat: ${werdykt.skrypt.mail.temat}\n\n${werdykt.skrypt.mail.tresc}`)}
          >
            {t('wspolne.kopiuj')}
          </Przycisk>
        </div>

        <Przycisk odmiana="obrys" onClick={wroc}>{t('wspolne.zamknij')}</Przycisk>
      </div>
    </>
  )
}

/* ================= E2.7 Przypomnienie ================= */

export function PanelPrzypomnienia({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, zmienStan, chmurka, stan } = useAplikacja()
  const idSytuacji = dane.sytuacja as string
  const [kiedy, ustawKiedy] = useState<'jutro' | 'poniedzialek' | 'tydzien'>('poniedzialek')

  const opcje: { id: typeof kiedy; napis: string; opis: string }[] = [
    { id: 'jutro', napis: 'Jutro rano', opis: 'gdy chcesz wrócić do sprawy od razu' },
    { id: 'poniedzialek', napis: 'W poniedziałek', opis: 'najlepszy moment na rozmowę z przełożonym' },
    { id: 'tydzien', napis: 'Za tydzień', opis: 'gdy czekasz na odpowiedź' },
  ]

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('wynik.przypomnij')} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="opis">
          Przypomnienie zadziała jak budzik w telefonie — bez internetu i bez wysyłania czegokolwiek.
        </p>

        <div className="kolumna">
          {opcje.map((o) => (
            <button key={o.id} className="odpowiedz" aria-pressed={kiedy === o.id} onClick={() => ustawKiedy(o.id)}>
              <span className="odpowiedz__znacznik" aria-hidden="true" />
              <span>
                <b style={{ display: 'block' }}>{o.napis}</b>
                <span className="drobne">{o.opis}</span>
              </span>
            </button>
          ))}
        </div>

        <Przycisk
          ikona="dzwonek"
          onClick={() => {
            zmienStan((s) => ({
              ...s,
              budziki: { ...s.budziki, powrot_po_pomocy: true },
              przerwane: { ...s.przerwane, [`przypomnienie-${idSytuacji}`]: { krok: kiedy, kiedy: new Date().toISOString() } },
            }))
            chmurka('Ustawiliśmy przypomnienie. Zobaczysz je w „Moje budziki”.')
            wroc()
          }}
        >
          Ustaw przypomnienie
        </Przycisk>

        <p className="drobne">
          Dostaniesz dokładnie te przypomnienia, które włączysz — nic nie jest po drodze odrzucane.
          Wyłączyć możesz je w każdej chwili w „Moje budziki”.
        </p>
      </div>
    </>
  )
}
