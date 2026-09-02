import { useEffect, useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, PodstawaPrawna, Przycisk } from '../komponenty/podstawowe'
import { t } from '../dane/wczytaj'
import { STAN_PRAWNY, datePoPolsku } from '../silnik/parametry'
import {
  czasNaPytanieORytm, fakturaNaZywo, nowyWpis, odstepstwaOdStalychGodzin, opiszCzas, otwartyWpis,
  podsumuj, sprawdzWpis, trwajacaPrzerwa, wpisyDnia, wpisyOd, wykryjSygnaly, wyliczWpis,
  zakresMiesiaca, zakresTygodnia, zapomnianyDzien,
} from '../silnik/ewidencja'
import { dodajDni, iso } from '../silnik/grafik'
import type { Sygnal, WpisCzasu } from '../typy'

/**
 * GRUPA E7 — EWIDENCJA CZASU PRACY (zmiana 1.2, punkt 6).
 *
 * Grafik to plan, ewidencja to fakt. Aplikacja porównuje jedno z drugim i wskazuje to,
 * co dla bezpieczeństwa pracy istotne. Wszystko lokalnie; nic nie jest wysyłane —
 * nie ma tu ani synchronizacji, ani eksportu do chmury, ani wpisu do kalendarza systemowego.
 *
 * Świadomie NIE liczymy wynagrodzenia ani stawek za nadgodziny: tylko godziny (punkt 11).
 */

/** „08:00” z bieżącej chwili — zapisujemy czas lokalny, nie UTC. */
function terazHHMM(teraz: Date = new Date()): string {
  return `${String(teraz.getHours()).padStart(2, '0')}:${String(teraz.getMinutes()).padStart(2, '0')}`
}

/* ================= E7.1 Mój czas — dziś ================= */

export function MojCzasDzis() {
  const { stan, zmienStan, nawiguj, wroc, chmurka, dzis } = useAplikacja()
  const profil = stan.profil
  const otwarty = otwartyWpis(stan.ewidencja)
  const zapomniany = zapomnianyDzien(stan.ewidencja, dzis)

  // Licznik na żywo tyka co minutę — bez animacji, bez migotania.
  const [tik, ustawTik] = useState(0)
  useEffect(() => {
    if (!otwarty) return
    const id = window.setInterval(() => ustawTik((x) => x + 1), 60000)
    return () => window.clearInterval(id)
  }, [otwarty])

  /*
    Wyzwalacz zmiany rytmu (punkt 6.5). Pytamy RAZ i nie częściej niż co 30 dni.
    „Zostaw jak jest” wycisza pytanie na 30 dni — i nie kasuje żadnych danych.
  */
  const stale = profil?.grafik?.rytm === 'stale' ? profil.grafik.stale : undefined
  const odstepstwa = useMemo(
    () => (stale ? odstepstwaOdStalychGodzin(stan.ewidencja, stale, dzis) : []),
    [stale, stan.ewidencja, dzis],
  )
  const pytamORytm = stale !== undefined && czasNaPytanieORytm(odstepstwa, stan.wyzwalaczRytmu, dzis)

  const dzisiejsze = wpisyDnia(stan.ewidencja, dzis)
  const podsumowanie = podsumuj(dzisiejsze, profil?.grafik ?? null)
  const naZywo = otwarty && otwarty.data === dzis ? fakturaNaZywo(otwarty, new Date()) : 0
  const przerwaTrwa = trwajacaPrzerwa(otwarty)

  const zacznij = () => {
    const wpis = nowyWpis({ data: dzis, od: terazHHMM(), zrodlo: 'przycisk' })
    zmienStan((s) => ({ ...s, ewidencja: [...s.ewidencja, wpis] }))
    chmurka('Zaczęliśmy liczyć. Naciśnij „Kończę”, gdy skończysz.')
  }

  const zakoncz = () => {
    if (!otwarty) return
    zmienStan((s) => ({
      ...s,
      ewidencja: s.ewidencja.map((w) => (w.id === otwarty.id
        ? {
          ...w,
          do: terazHHMM(),
          // Trwającą przerwę domykamy razem z dniem — inaczej zostałaby otwarta na zawsze.
          przerwy: w.przerwy.map((p) => (p.do ? p : { ...p, do: terazHHMM() })),
          zmieniono: new Date().toISOString(),
        }
        : w)),
    }))
    chmurka('Zapisaliśmy dzień. Możesz go poprawić w każdej chwili.')
  }

  const przelaczPrzerwe = () => {
    if (!otwarty) return
    zmienStan((s) => ({
      ...s,
      ewidencja: s.ewidencja.map((w) => {
        if (w.id !== otwarty.id) return w
        const trwa = w.przerwy.find((p) => !p.do)
        return {
          ...w,
          przerwy: trwa
            ? w.przerwy.map((p) => (p.do ? p : { ...p, do: terazHHMM() }))
            : [...w.przerwy, { od: terazHHMM(), do: null }],
          zmieniono: new Date().toISOString(),
        }
      }),
    }))
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Ewidencja" tytul="Mój czas — dziś" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="opis">
          {datePoPolsku(dzis)}. Notujesz tylko dla siebie — te godziny nie opuszczają tego telefonu.
        </p>

        {/* Badanie 4 z punktu 10: dzień zostawiony bez „Kończę”. Pytamy przy następnym otwarciu. */}
        {zapomniany && (
          <div className="pas" data-test="zapomniany-dzien">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <div className="kolumna kolumna--ciasna">
              <p>
                <b>{datePoPolsku(zapomniany.data)} nie zamknąłeś(-aś) dnia.</b>{' '}
                Zacząłeś(-aś) o {zapomniany.od}. O której skończyłeś(-aś)?
              </p>
              <Przycisk odmiana="drugi" onClick={() => nawiguj('E7.2', { id: zapomniany.id })}>
                Uzupełnij godzinę zakończenia
              </Przycisk>
            </div>
          </div>
        )}

        {pytamORytm && (
          <div className="karta kolumna kolumna--ciasna" data-test="pytanie-o-rytm">
            <p className="oczko">Zauważyliśmy coś w Twoich godzinach</p>
            <p>
              <b>Wygląda na to, że pracujesz na zmiany.</b>{' '}
              W ciągu ostatnich dwóch tygodni {odstepstwa.length} razy zaczynałeś(-aś) albo kończył(-aś)
              ponad godzinę poza zadeklarowanymi godzinami. Zmienić ustawienie na zmiany i włączyć kalendarz?
            </p>
            <div className="rzad">
              <Przycisk
                onClick={() => {
                  zmienStan((s) => ({
                    ...s,
                    wyzwalaczRytmu: { ostatnio_pytano: dzis, wyciszony_do: null },
                  }))
                  nawiguj('E5.2')
                }}
              >
                Zmień
              </Przycisk>
              <Przycisk
                odmiana="obrys"
                onClick={() => {
                  zmienStan((s) => ({
                    ...s,
                    wyzwalaczRytmu: { ostatnio_pytano: dzis, wyciszony_do: iso(dodajDni(new Date(dzis + 'T12:00:00'), 30)) },
                  }))
                  chmurka('Zostawiamy jak jest. Nie wrócimy do tego przez 30 dni.')
                }}
              >
                Zostaw jak jest
              </Przycisk>
            </div>
          </div>
        )}

        {/* Duży przełącznik Zaczynam / Kończę — jedyny przycisk, który ma 72 px. */}
        <div className="kolumna">
          {otwarty && otwarty.data === dzis ? (
            <>
              <div className="blok-ile" data-test="licznik">
                <p className="oczko">Dzień otwarty od {otwarty.od}</p>
                <p style={{ fontSize: '2rem', fontWeight: 700, marginTop: 4 }}>
                  {opiszCzas(naZywo)}
                  {tik === -1 && ''}
                </p>
                {przerwaTrwa && <p className="drobne">Przerwa trwa — czas przerwy nie jest liczony.</p>}
              </div>
              <Przycisk wielki ikona="stop" onClick={zakoncz}>Kończę</Przycisk>
              <Przycisk odmiana={przerwaTrwa ? 'drugi' : 'obrys'} ikona={przerwaTrwa ? 'start' : 'pauza'} onClick={przelaczPrzerwe}>
                {przerwaTrwa ? 'Wracam z przerwy' : 'Przerwa'}
              </Przycisk>
            </>
          ) : (
            <Przycisk wielki ikona="start" onClick={zacznij}>Zaczynam</Przycisk>
          )}
        </div>

        {/* Dzisiejsze wpisy. */}
        {dzisiejsze.length > 0 && (
          <>
            <p className="oczko">Dzisiejsze wpisy</p>
            <ul className="lista-czysta">
              {dzisiejsze.map((w) => {
                const wy = wyliczWpis(w, profil?.grafik ?? null, null)
                return (
                  <li key={w.id}>
                    <button className="kafel" onClick={() => nawiguj('E7.2', { id: w.id })}>
                      <span className="kafel__ikona"><Ikona nazwa="zegar" /></span>
                      <span className="kafel__tresc">
                        <b style={{ display: 'block' }}>{w.od}–{w.do ?? '…'}</b>
                        <span className="drobne">
                          {w.do ? opiszCzas(wy.fakt_min) : 'trwa'}
                          {wy.przerwy_min > 0 && ` · przerwy ${opiszCzas(wy.przerwy_min)}`}
                          {w.zrodlo === 'reczny' && ' · wpis ręczny'}
                        </span>
                      </span>
                      <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {/* Podsumowanie dnia. */}
        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Dzisiaj</p>
          <Wiersz nazwa="Przepracowane" wartosc={opiszCzas(podsumowanie.fakt_min)} />
          <Wiersz nazwa="Przerwy" wartosc={opiszCzas(podsumowanie.przerwy_min)} />
          <Wiersz
            nazwa="Plan z grafiku"
            wartosc={podsumowanie.plan_min === null ? 'brak grafiku' : opiszCzas(podsumowanie.plan_min)}
          />
          <Wiersz
            nazwa="Różnica"
            wartosc={podsumowanie.plan_min === null
              ? 'ustaw grafik, żeby porównać'
              : opiszCzas(podsumowanie.fakt_min - podsumowanie.plan_min)}
          />
        </div>

        <Przycisk odmiana="obrys" ikona="plus" onClick={() => nawiguj('E7.2')}>Dodaj wpis ręcznie</Przycisk>
        <Przycisk odmiana="drugi" ikona="tabela" onClick={() => nawiguj('E7.3')}>Ten tydzień</Przycisk>

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

function Wiersz({ nazwa, wartosc }: { nazwa: string; wartosc: string }) {
  return (
    <div className="rzad" style={{ justifyContent: 'space-between' }}>
      <span>{nazwa}</span>
      <b className="cyfry">{wartosc}</b>
    </div>
  )
}

/* ================= E7.2 Wpis ręczny i edycja ================= */

export function WpisCzasuEkran({ dane }: { dane: Record<string, unknown> }) {
  const { stan, zmienStan, wroc, chmurka, dzis } = useAplikacja()
  const id = dane.id as string | undefined
  const istniejacy = id ? stan.ewidencja.find((w) => w.id === id) : undefined

  const [wpis, ustawWpis] = useState<WpisCzasu>(() => istniejacy ?? nowyWpis({ data: dzis, od: '08:00', do: '16:00' }))
  const [proba, ustawProba] = useState(false)

  const wynik = sprawdzWpis(wpis)
  const mozna = wynik.bledy.length === 0

  const zmien = (co: Partial<WpisCzasu>) => ustawWpis((w) => ({ ...w, ...co, zmieniono: new Date().toISOString() }))

  const zapisz = () => {
    ustawProba(true)
    if (!mozna) return
    zmienStan((s) => ({
      ...s,
      ewidencja: istniejacy
        ? s.ewidencja.map((w) => (w.id === wpis.id ? wpis : w))
        : [...s.ewidencja, wpis],
    }))
    chmurka(istniejacy ? 'Poprawiliśmy wpis.' : 'Zapisaliśmy wpis.')
    wroc()
  }

  const usun = () => {
    zmienStan((s) => ({ ...s, ewidencja: s.ewidencja.filter((w) => w.id !== wpis.id) }))
    chmurka('Skasowaliśmy wpis.')
    wroc()
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Ewidencja" tytul={istniejacy ? 'Popraw wpis' : 'Nowy wpis'} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <Pole etykieta="Data" typ="date" wartosc={wpis.data} naZmiane={(v) => zmien({ data: v })} />

        <div className="rzad">
          <Pole etykieta="Od" typ="time" wartosc={wpis.od} naZmiane={(v) => zmien({ od: v })} />
          <Pole etykieta="Do" typ="time" wartosc={wpis.do ?? ''} naZmiane={(v) => zmien({ do: v || null })} />
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Przerwy</p>
          {wpis.przerwy.length === 0 && <p className="drobne">Nie zapisałeś(-aś) jeszcze żadnej przerwy.</p>}
          {wpis.przerwy.map((p, i) => (
            <div key={i} className="rzad">
              <Pole
                etykieta="Od" typ="time" wartosc={p.od}
                naZmiane={(v) => zmien({ przerwy: wpis.przerwy.map((x, j) => (j === i ? { ...x, od: v } : x)) })}
              />
              <Pole
                etykieta="Do" typ="time" wartosc={p.do ?? ''}
                naZmiane={(v) => zmien({ przerwy: wpis.przerwy.map((x, j) => (j === i ? { ...x, do: v || null } : x)) })}
              />
              <Przycisk
                odmiana="obrys" ikona="minus"
                opisDlaCzytnika={`Usuń przerwę ${i + 1}`}
                onClick={() => zmien({ przerwy: wpis.przerwy.filter((_, j) => j !== i) })}
              >
                Usuń
              </Przycisk>
            </div>
          ))}
          <Przycisk
            odmiana="obrys" ikona="plus"
            onClick={() => zmien({ przerwy: [...wpis.przerwy, { od: '12:00', do: '12:15' }] })}
          >
            Dodaj przerwę
          </Przycisk>
        </div>

        <label className="kolumna kolumna--ciasna">
          <span className="oczko">Uwagi</span>
          <textarea
            className="pole"
            rows={3}
            value={wpis.uwagi}
            placeholder="np. polecenie kierownika, awaria"
            onChange={(e) => zmien({ uwagi: e.target.value })}
          />
        </label>

        {proba && wynik.bledy.length > 0 && (
          <div className="pas pas--powaga" role="alert" data-test="bledy-wpisu">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <ul style={{ margin: '0 0 0 18px' }}>{wynik.bledy.map((b, i) => <li key={i}>{b}</li>)}</ul>
          </div>
        )}

        {wynik.ostrzezenia.length > 0 && (
          <div className="pas" data-test="ostrzezenia-wpisu">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <ul style={{ margin: '0 0 0 18px' }}>{wynik.ostrzezenia.map((o, i) => <li key={i}>{o}</li>)}</ul>
          </div>
        )}

        <Przycisk ikona="ptaszek" onClick={zapisz}>Zapisz</Przycisk>
        {istniejacy && <Przycisk odmiana="obrys" ikona="minus" onClick={usun}>Usuń wpis</Przycisk>}
      </div>
    </>
  )
}

function Pole({
  etykieta, typ, wartosc, naZmiane,
}: { etykieta: string; typ: string; wartosc: string; naZmiane: (v: string) => void }) {
  return (
    <label className="kolumna kolumna--ciasna" style={{ flex: 1, minWidth: 120 }}>
      <span className="oczko">{etykieta}</span>
      <input className="pole" type={typ} value={wartosc} onChange={(e) => naZmiane(e.target.value)} />
    </label>
  )
}

/* ================= E7.3 Tydzień i miesiąc ================= */

export function TydzienIMiesiac() {
  const { stan, nawiguj, wroc, dzis } = useAplikacja()
  const profil = stan.profil
  const [zakresNazwa, ustawZakres] = useState<'tydzien' | 'miesiac'>('tydzien')

  const zakres = zakresNazwa === 'tydzien' ? zakresTygodnia(dzis) : zakresMiesiaca(dzis)
  const wpisy = wpisyOd(stan.ewidencja, zakres.od, zakres.do)
  const sygnaly = useMemo(
    () => wykryjSygnaly(wpisy, profil?.grafik ?? null, profil),
    [wpisy, profil],
  )
  const podsumowanie = podsumuj(wpisy, profil?.grafik ?? null, sygnaly)

  // Wiersz na każdy dzień zakresu, także pusty — inaczej dziura w tygodniu jest niewidoczna.
  const dni: string[] = []
  for (let d = new Date(zakres.od + 'T12:00:00'); iso(d) <= zakres.do; d = dodajDni(d, 1)) dni.push(iso(d))
  const dniZSygnalem = new Set(sygnaly.filter((s) => !s.informacyjny).map((s) => s.data))

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Ewidencja" tytul="Tydzień i miesiąc" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <div className="rzad" role="group" aria-label="Zakres">
          <Przycisk odmiana={zakresNazwa === 'tydzien' ? 'glowny' : 'obrys'} onClick={() => ustawZakres('tydzien')}>
            Tydzień
          </Przycisk>
          <Przycisk odmiana={zakresNazwa === 'miesiac' ? 'glowny' : 'obrys'} onClick={() => ustawZakres('miesiac')}>
            Miesiąc
          </Przycisk>
        </div>

        <p className="opis">{datePoPolsku(zakres.od)} – {datePoPolsku(zakres.do)}</p>

        {/* Przewijane pudełko z dostępem z klawiatury — jak w E2.8. */}
        <div className="tabela-przewijana" tabIndex={0} role="region" aria-label="Ewidencja dzień po dniu">
          <table className="tabela">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Plan</th>
                <th scope="col">Fakt</th>
                <th scope="col">Przerwy</th>
                <th scope="col">Różnica</th>
              </tr>
            </thead>
            <tbody>
              {dni.map((d) => {
                const wDniu = wpisyDnia(stan.ewidencja, d)
                const p = podsumuj(wDniu, profil?.grafik ?? null)
                const maSygnal = dniZSygnalem.has(d)
                return (
                  <tr key={d}>
                    <th scope="row">
                      {maSygnal && <span aria-hidden="true" style={{ marginRight: 6 }}>!</span>}
                      {Number(d.slice(8, 10))}.{d.slice(5, 7)}
                      {maSygnal && <span className="tylko-dla-czytnika"> — dzień z sygnałem</span>}
                    </th>
                    <td className="cyfry">{p.plan_min === null ? '—' : opiszCzas(p.plan_min)}</td>
                    <td className="cyfry">{wDniu.length === 0 ? '—' : opiszCzas(p.fakt_min)}</td>
                    <td className="cyfry">{wDniu.length === 0 ? '—' : opiszCzas(p.przerwy_min)}</td>
                    <td className="cyfry">
                      {p.plan_min === null || wDniu.length === 0 ? '—' : opiszCzas(p.fakt_min - p.plan_min)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {podsumowanie.plan_min === null && (
          <p className="drobne" data-test="brak-grafiku">
            Kolumna „plan” jest pusta — ustaw grafik, żeby porównać fakt z planem.
          </p>
        )}

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Razem w tym zakresie</p>
          <Wiersz nazwa="Godziny łącznie" wartosc={opiszCzas(podsumowanie.fakt_min)} />
          <Wiersz
            nazwa="Ponad plan"
            wartosc={podsumowanie.ponad_plan_min === null ? 'ustaw grafik, żeby porównać' : opiszCzas(podsumowanie.ponad_plan_min)}
          />
          <Wiersz nazwa="W nocy" wartosc={opiszCzas(podsumowanie.noce_min)} />
          <Wiersz nazwa="Dni z sygnałem" wartosc={String(podsumowanie.dni_z_sygnalem)} />
        </div>

        <Przycisk odmiana="drugi" ikona="wykrzyknik" onClick={() => nawiguj('E7.4', { zakres: zakresNazwa })}>
          Sygnały ({sygnaly.filter((s) => !s.informacyjny).length})
        </Przycisk>
        <Przycisk odmiana="obrys" ikona="dokument" onClick={() => nawiguj('E7.5')}>Eksport miesiąca</Przycisk>

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

/* ================= E7.4 Sygnały ================= */

export function SygnalyCzasu({ dane }: { dane: Record<string, unknown> }) {
  const { stan, nawiguj, wroc, zmienStan, chmurka, dzis } = useAplikacja()
  const profil = stan.profil
  const zakresNazwa = (dane.zakres as string) ?? 'tydzien'
  const zakres = zakresNazwa === 'miesiac' ? zakresMiesiaca(dzis) : zakresTygodnia(dzis)
  const wpisy = wpisyOd(stan.ewidencja, zakres.od, zakres.do)
  const sygnaly = wykryjSygnaly(wpisy, profil?.grafik ?? null, profil)
  const funkcjonariusz = profil?.status === 'funkcjonariusz'

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Ewidencja" tytul="Sygnały" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="opis">{datePoPolsku(zakres.od)} – {datePoPolsku(zakres.do)}</p>

        {/*
          Funkcjonariusz: sygnały kodeksowe są WYŁĄCZONE, bo odpoczynek i przerwy
          regulują pragmatyki służbowe, których prototyp nie zna. Mówimy o tym wprost,
          zamiast po cichu pokazywać pustą listę.
        */}
        {funkcjonariusz && (
          <div className="pas pas--spokojny" data-test="funkcjonariusz-sygnaly">
            <Ikona nazwa="odznaka" rozmiar={22} />
            <p>
              Sygnały o odpoczynku i przerwach są wyłączone: w służbie te kwestie reguluje
              pragmatyka Twojej formacji [do uzupełnienia przez specjalistę od pragmatyk].
              Godziny ponad plan liczymy nadal.
            </p>
          </div>
        )}

        {sygnaly.length === 0 && (
          <div className="karta kolumna kolumna--ciasna">
            <b>Brak sygnałów w tym zakresie</b>
            <p className="drobne">
              To nie znaczy, że wszystko jest w porządku — znaczy, że w zapisanych godzinach
              nie widzimy naruszeń. Im dokładniej notujesz, tym więcej widać.
            </p>
          </div>
        )}

        <ul className="lista-czysta">
          {sygnaly.map((s, i) => <KartaSygnalu key={i} sygnal={s} naSkrypt={() => nawiguj('E2.2', { sytuacja: 'odpoczynek' })} naPrzypomnienie={() => {
            zmienStan((st) => ({ ...st, budziki: { ...st.budziki, powrot_po_pomocy: true } }))
            chmurka('Ustawiliśmy przypomnienie. Zobaczysz je w „Moje budziki”.')
          }} />)}
        </ul>

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

function KartaSygnalu({
  sygnal, naSkrypt, naPrzypomnienie,
}: { sygnal: Sygnal; naSkrypt: () => void; naPrzypomnienie: () => void }) {
  return (
    <li>
      <div className={`karta kolumna kolumna--ciasna${sygnal.informacyjny ? '' : ' karta--sygnal'}`}>
        <div className="rzad">
          <span className="kafel__ikona">
            <Ikona nazwa={sygnal.informacyjny ? 'zegar' : 'wykrzyknik'} />
          </span>
          <div style={{ flex: 1 }}>
            <p className="oczko">
              {sygnal.informacyjny ? 'Informacja' : 'Sygnał'} · {datePoPolsku(sygnal.data)}
            </p>
            <p>{sygnal.opis}</p>
          </div>
        </div>
        <PodstawaPrawna tresc={sygnal.podstawa} stanPrawny={STAN_PRAWNY} />
        {!sygnal.informacyjny && (
          <div className="rzad">
            <Przycisk odmiana="drugi" ikona="mowa" onClick={naSkrypt}>Jak o to poprosić</Przycisk>
            <Przycisk odmiana="obrys" ikona="dzwonek" onClick={naPrzypomnienie}>Przypomnij mi</Przycisk>
          </div>
        )}
      </div>
    </li>
  )
}

/* ================= E7.5 Eksport ewidencji ================= */

export function EksportEwidencji() {
  const { stan, wroc, chmurka, dzis } = useAplikacja()
  const profil = stan.profil
  const zakres = zakresMiesiaca(dzis)
  const wpisy = wpisyOd(stan.ewidencja, zakres.od, zakres.do)
  const sygnaly = wykryjSygnaly(wpisy, profil?.grafik ?? null, profil)
  const podsumowanie = podsumuj(wpisy, profil?.grafik ?? null, sygnaly)
  const [zapisuje, ustawZapisuje] = useState(false)

  const miesiacNazwa = datePoPolsku(zakres.od).replace(/^\d+\s/, '')

  const zapisz = async () => {
    ustawZapisuje(true)
    try {
      const { ewidencjaMiesiaca, zapiszPlik } = await import('../pdf/dokumenty')
      const blob = await ewidencjaMiesiaca({
        miesiac: miesiacNazwa,
        wiersze: wpisy.map((w) => {
          const wy = wyliczWpis(w, profil?.grafik ?? null, null)
          return {
            data: w.data,
            plan: wy.plan_min === null ? '—' : opiszCzas(wy.plan_min),
            fakt: opiszCzas(wy.fakt_min),
            przerwy: opiszCzas(wy.przerwy_min),
            ponad: wy.roznica_min === null ? '—' : opiszCzas(Math.max(0, wy.roznica_min)),
            uwagi: w.uwagi,
          }
        }),
        sumy: {
          godziny: opiszCzas(podsumowanie.fakt_min),
          ponad: podsumowanie.ponad_plan_min === null ? '—' : opiszCzas(podsumowanie.ponad_plan_min),
          noce: opiszCzas(podsumowanie.noce_min),
        },
        sygnaly: sygnaly.map((s) => `${datePoPolsku(s.data)}: ${s.opis}`),
      })
      zapiszPlik(blob, `ewidencja-${zakres.od.slice(0, 7)}.pdf`)
      chmurka('Zapisaliśmy dokument na Twoim urządzeniu.')
    } catch {
      chmurka('Nie udało się złożyć dokumentu. Spróbuj jeszcze raz.')
    } finally {
      ustawZapisuje(false)
    }
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={t('pdf.podglad')} tytul="Eksport ewidencji" />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="dokument">
          <p style={{ fontSize: '0.8125rem', color: '#555' }}>BHPewnie — Forum Związków Zawodowych</p>
          <h4>Moja ewidencja czasu pracy — {miesiacNazwa}</h4>
          <div className="dokument__pole">{t('pdf.imie')}: ……………………………………………</div>

          <table className="tabela" style={{ marginTop: 12, minWidth: 0 }}>
            <thead>
              <tr>
                <th scope="col">Dzień</th>
                <th scope="col">Plan</th>
                <th scope="col">Faktycznie</th>
                <th scope="col">Przerwy</th>
                <th scope="col">Ponad plan</th>
              </tr>
            </thead>
            <tbody>
              {wpisy.map((w) => {
                const wy = wyliczWpis(w, profil?.grafik ?? null, null)
                return (
                  <tr key={w.id}>
                    <th scope="row">{Number(w.data.slice(8, 10))}.{w.data.slice(5, 7)}</th>
                    <td>{wy.plan_min === null ? '—' : opiszCzas(wy.plan_min)}</td>
                    <td>{opiszCzas(wy.fakt_min)}</td>
                    <td>{opiszCzas(wy.przerwy_min)}</td>
                    <td>{wy.roznica_min === null ? '—' : opiszCzas(Math.max(0, wy.roznica_min))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {wpisy.length === 0 && <p style={{ marginTop: 10 }}>W tym miesiącu nie ma jeszcze żadnych wpisów.</p>}

          <p style={{ marginTop: 10 }}>
            <b>Razem:</b> {opiszCzas(podsumowanie.fakt_min)} ·{' '}
            <b>ponad plan:</b> {podsumowanie.ponad_plan_min === null ? '—' : opiszCzas(podsumowanie.ponad_plan_min)} ·{' '}
            <b>w nocy:</b> {opiszCzas(podsumowanie.noce_min)}
          </p>

          {sygnaly.length > 0 && (
            <>
              <p style={{ marginTop: 10 }}><b>Wykaz sygnałów</b></p>
              <ul style={{ margin: '4px 0 0 18px' }}>
                {sygnaly.map((s, i) => <li key={i}>{datePoPolsku(s.data)}: {s.opis}</li>)}
              </ul>
            </>
          )}

          <p style={{ fontSize: '0.8125rem', color: '#555', marginTop: 12 }}>
            Własna ewidencja pracownika prowadzona w aplikacji BHPewnie.
            Dokument pomocniczy — dane nie opuszczają urządzenia.
          </p>

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
        </div>

        <Przycisk ikona="dokument" onClick={zapisz} wylaczony={zapisuje}>
          {zapisuje ? 'Składamy dokument…' : t('pdf.zapisz')}
        </Przycisk>
        <Przycisk odmiana="obrys" onClick={wroc}>{t('wspolne.zamknij')}</Przycisk>
      </div>
    </>
  )
}
