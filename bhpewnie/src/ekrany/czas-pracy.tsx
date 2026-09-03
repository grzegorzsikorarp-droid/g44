import { useEffect, useId, useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, PodstawaPrawna, Przycisk, ZnakWerdyktu } from '../komponenty/podstawowe'
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

const DNI_KROTKIE = ['nd', 'pon', 'wt', 'śr', 'czw', 'pt', 'sob']
const MIESIACE_RZYMSKIE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

/** „pon 1 IX” — zapis dnia w liście ewidencji. */
function opiszDzien(dzien: string): string {
  const d = new Date(dzien + 'T12:00:00')
  return `${DNI_KROTKIE[d.getDay()]} ${Number(dzien.slice(8, 10))} ${MIESIACE_RZYMSKIE[Number(dzien.slice(5, 7)) - 1]}`
}

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
              <div className="licznik" data-test="licznik">
                <div className="rzad" style={{ justifyContent: 'space-between' }}>
                  <p className="oczko">Pracujesz od {otwarty.od}</p>
                  <span className="znacznik znacznik--spokojny">dzień otwarty</span>
                </div>
                <p className="licznik__liczba">
                  {opiszCzas(naZywo)}
                  {tik === -1 && ''}
                </p>
                <p className="drobne">
                  {przerwaTrwa
                    ? 'Przerwa trwa — czas przerwy nie jest liczony.'
                    : `w tym ${opiszCzas(podsumowanie.przerwy_min)} przerwy`}
                  {podsumowanie.plan_min !== null && ` · plan ${opiszCzas(podsumowanie.plan_min)}`}
                </p>
              </div>
              <Przycisk wielki ikona="stop" onClick={zakoncz}>Kończę pracę</Przycisk>
              <Przycisk odmiana={przerwaTrwa ? 'drugi' : 'obrys'} ikona={przerwaTrwa ? 'start' : 'pauza'} onClick={przelaczPrzerwe}>
                {przerwaTrwa ? 'Kończę przerwę' : 'Zaczynam przerwę'}
              </Przycisk>
            </>
          ) : (
            <Przycisk wielki ikona="start" onClick={zacznij}>Zaczynam pracę</Przycisk>
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
                    <button className="kafel kafel--swobodny" onClick={() => nawiguj('E7.2', { id: w.id })}>
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
          <Pole
            etykieta="Do" typ="time" wartosc={wpis.do ?? ''}
            naZmiane={(v) => zmien({ do: v || null })}
            blad={proba ? wynik.bledy.find((b) => b.includes('zakończenia')) : undefined}
          />
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
                blad={proba ? wynik.bledy.find((b) => b.includes(`${p.od}–${p.do}`)) : undefined}
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

        {/*
          Pas zbiorczy mówi ILE PÓL wymaga poprawy, nie co w nich jest — konkret stoi
          przy polu (design 1.2, §8.4). Bez terakoty: pomyłka we wpisie nie jest
          ryzykiem ze strony drugiego człowieka.
        */}
        {proba && wynik.bledy.length > 0 && (
          <div className="pas pas--uwaga" role="alert" data-test="bledy-wpisu">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <div className="kolumna kolumna--ciasna">
              <b>
                {wynik.bledy.length === 1 ? 'Jedno pole wymaga poprawy' : `${wynik.bledy.length} pola wymagają poprawy`}
              </b>
              <ul style={{ margin: '0 0 0 18px' }}>{wynik.bledy.map((b, i) => <li key={i}>{b}</li>)}</ul>
            </div>
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

/**
 * Pole z nazwanym stanem błędu (design 1.2, §8.4).
 *
 * Zdanie o błędzie stoi POZA elementem `<label>` i jest podpięte przez `aria-describedby`.
 * Wewnątrz etykiety zmieniałoby dostępną nazwę pola: czytnik ekranu odczytywałby
 * „Do, przerwa wychodzi poza godziny wpisu” zamiast nazwy pola.
 */
function Pole({
  etykieta, typ, wartosc, naZmiane, blad,
}: { etykieta: string; typ: string; wartosc: string; naZmiane: (v: string) => void; blad?: string }) {
  const id = useId()
  return (
    <div className="kolumna kolumna--ciasna" style={{ flex: 1, minWidth: 120 }}>
      <label className="oczko" htmlFor={id}>{etykieta}</label>
      <input
        id={id}
        className={`pole${blad ? ' pole--blad' : ''}`}
        type={typ}
        value={wartosc}
        aria-invalid={blad ? true : undefined}
        aria-describedby={blad ? `${id}-blad` : undefined}
        onChange={(e) => naZmiane(e.target.value)}
      />
      {blad && (
        <span className="pole-blad__zdanie" id={`${id}-blad`}>
          <Ikona nazwa="wykrzyknik" rozmiar={16} />
          {blad}
        </span>
      )}
    </div>
  )
}

/* ================= E7.3 Tydzień i miesiąc ================= */

export function TydzienIMiesiac() {
  const { stan, nawiguj, wroc, dzis } = useAplikacja()
  const profil = stan.profil
  const [zakresNazwa, ustawZakres] = useState<'tydzien' | 'miesiac'>('tydzien')
  // Pełna siatka na życzenie — dla tych, którzy chcą wszystkich pięciu kolumn.
  const [tabela, ustawTabela] = useState(false)

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
        <div className="tor-segmentow" role="group" aria-label="Zakres">
          {(['tydzien', 'miesiac'] as const).map((z) => (
            <button
              key={z}
              className="tor-segmentow__segment"
              aria-pressed={zakresNazwa === z}
              onClick={() => ustawZakres(z)}
            >
              {z === 'tydzien' ? 'Tydzień' : 'Miesiąc'}
            </button>
          ))}
        </div>

        <p className="opis">{datePoPolsku(zakres.od)} – {datePoPolsku(zakres.do)}</p>

        {/* Przewijane pudełko z dostępem z klawiatury — jak w E2.8. */}
        {/*
          LISTA DNI, nie tabela (design 1.2, §8.4). Pięć kolumn schodzi do trzech
          widocznych: data, fakt i różnica w pierwszej linii, plan i przerwy w drugiej
          jako zdanie. Plan i przerwy nie znikają — przestają być kolumnami.
          Wiersz jest celem dotykowym prowadzącym do szczegółu dnia.
        */}
        <div className="rzad" style={{ justifyContent: 'space-between' }}>
          <p className="oczko">Dzień po dniu</p>
          <button className="odnosnik drobne" onClick={() => ustawTabela(!tabela)}>
            {tabela ? 'Wróć do listy' : 'Zobacz tabelę'}
          </button>
        </div>

        {tabela ? (
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
                  return (
                    <tr key={d}>
                      <th scope="row">{Number(d.slice(8, 10))}.{d.slice(5, 7)}</th>
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
        ) : (
          <ul className="lista-czysta">
            {dni.map((d) => {
              const wDniu = wpisyDnia(stan.ewidencja, d)
              const p = podsumuj(wDniu, profil?.grafik ?? null)
              const maSygnal = dniZSygnalem.has(d)
              const roznica = p.plan_min === null || wDniu.length === 0 ? null : p.fakt_min - p.plan_min
              const klasaRoznicy = roznica === null ? '' : roznica > 0 ? 'roznica--ponad' : roznica < 0 ? 'roznica--nad' : 'roznica--zero'
              return (
                <li key={d}>
                  <button className="wiersz-dnia" onClick={() => nawiguj('E7.2', { data: d })}>
                    <span className="wiersz-dnia__gora">
                      <span className="wiersz-dnia__data">
                        {maSygnal && <Ikona nazwa="wykrzyknik" rozmiar={16} />}
                        {' '}{opiszDzien(d)}
                        {maSygnal && <span className="tylko-dla-czytnika"> — dzień z sygnałem</span>}
                      </span>
                      <span className="wiersz-dnia__liczby">
                        <b>{wDniu.length === 0 ? '—' : opiszCzas(p.fakt_min)}</b>
                        {roznica !== null && (
                          <span className={klasaRoznicy}>
                            {roznica > 0 ? '+' : ''}{opiszCzas(roznica)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="wiersz-dnia__dol">
                      {p.plan_min === null
                        ? 'ustaw grafik, żeby porównać'
                        : `plan ${opiszCzas(p.plan_min)}`}
                      {wDniu.length > 0 && ` · przerwy ${opiszCzas(p.przerwy_min)}`}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {podsumowanie.plan_min === null && (
          <p className="drobne" data-test="brak-grafiku">
            Kolumna „plan” jest pusta — ustaw grafik, żeby porównać fakt z planem.
          </p>
        )}

        {/* Dwie liczby, po które się tu przychodzi — reszta pod nimi, drobniej. */}
        <div className="karta kolumna kolumna--ciasna">
          <div className="blok-sumy">
            <div className="blok-sumy__pozycja">
              <span className="oczko">Przepracowane</span>
              <b className="blok-sumy__liczba">{opiszCzas(podsumowanie.fakt_min)}</b>
            </div>
            <div className="blok-sumy__pozycja">
              <span className="oczko">Ponad plan</span>
              <b className="blok-sumy__liczba roznica--ponad">
                {podsumowanie.ponad_plan_min === null ? '—' : `+${opiszCzas(podsumowanie.ponad_plan_min)}`}
              </b>
            </div>
          </div>
          {podsumowanie.ponad_plan_min === null && (
            <p className="drobne">Ustaw grafik, żeby porównać fakt z planem.</p>
          )}
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

/** Krótki tytuł sygnału — zdanie opisowe zostaje pod nim (design 1.2, §8.4). */
const TYTULY_SYGNALOW: Record<Sygnal['rodzaj'], string> = {
  odpoczynek_dobowy: 'Odpoczynek krótszy niż 11 godzin',
  odpoczynek_tygodniowy: 'Odpoczynek tygodniowy krótszy niż 35 godzin',
  brak_przerwy: 'Dniówka od 6 godzin bez zapisanej przerwy',
  brak_drugiej_przerwy: 'Dniówka powyżej 9 godzin bez drugiej przerwy',
  brak_trzeciej_przerwy: 'Dniówka powyżej 16 godzin bez trzeciej przerwy',
  tydzien_ponad_48: 'Tydzień powyżej 48 godzin',
  ponad_plan: 'Godziny ponad plan z grafiku',
}

function KartaSygnalu({
  sygnal, naSkrypt, naPrzypomnienie,
}: { sygnal: Sygnal; naSkrypt: () => void; naPrzypomnienie: () => void }) {
  return (
    <li>
      <div className={`karta kolumna kolumna--ciasna${sygnal.informacyjny ? '' : ' karta--sygnal'}`}>
        {/* Nagłówek stanu ze znakiem i słowem — jak na kartach werdyktu (design 1.2, §8.4). */}
        <p className={sygnal.informacyjny ? 'oczko' : 'sygnal__naglowek'}>
          {sygnal.informacyjny
            ? `Informacja · ${datePoPolsku(sygnal.data)}`
            : <><ZnakWerdyktu stan="zalezy" rozmiar={20} /> Do sprawdzenia</>}
        </p>
        <h2 style={{ fontSize: '1.1875rem', margin: 0 }}>{TYTULY_SYGNALOW[sygnal.rodzaj]}</h2>
        <p>{sygnal.opis}</p>
        <hr style={{ border: 0, borderTop: '1px solid var(--obrys)', margin: '2px 0' }} />
        <p className="drobne cyfry">{datePoPolsku(sygnal.data)}</p>
        <PodstawaPrawna tresc={sygnal.podstawa} stanPrawny={STAN_PRAWNY} />
        {!sygnal.informacyjny && (
          <div className="rzad">
            <Przycisk odmiana="drugi" ikona="mowa" onClick={naSkrypt}>Co mogę z tym zrobić</Przycisk>
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
        <p className="opis">
          {miesiacNazwa} · {wpisy.length} {wpisy.length === 1 ? 'dzień' : 'dni'} z wpisami ·{' '}
          {opiszCzas(podsumowanie.fakt_min)}
        </p>

        <p className="oczko">Podgląd dokumentu</p>

        {/*
          Miniatura A4 (design 1.2, §8.5). To podgląd, nie dokument do czytania — pismo
          jest małe celowo, żeby widać było, ile z miesiąca wejdzie na stronę.
          Pełną treść użytkownik dostaje w pliku PDF.
        */}
        <div className="miniatura-a4" aria-hidden="true">
          <h4>EWIDENCJA CZASU PRACY</h4>
          <p>{miesiacNazwa}</p>
          <div className="pole-imienia">Imię i nazwisko: ……………………………</div>
          <table>
            <thead>
              <tr><th>Dzień</th><th>Plan</th><th>Fakt</th><th>Różnica</th></tr>
            </thead>
            <tbody>
              {wpisy.slice(0, 14).map((w) => {
                const wy = wyliczWpis(w, profil?.grafik ?? null, null)
                const roznica = wy.roznica_min
                return (
                  <tr key={w.id}>
                    <td>{Number(w.data.slice(8, 10))} {['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'][Number(w.data.slice(5, 7)) - 1]}</td>
                    <td>{wy.plan_min === null ? '—' : opiszCzas(wy.plan_min)}</td>
                    <td>{opiszCzas(wy.fakt_min)}</td>
                    <td>{roznica === null ? '—' : `${roznica > 0 ? '+' : ''}${opiszCzas(roznica)}`}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="kreska" />
          <p>
            <b>Razem {opiszCzas(podsumowanie.fakt_min)}</b>
            {podsumowanie.ponad_plan_min !== null && ` · ponad plan +${opiszCzas(podsumowanie.ponad_plan_min)}`}
            {` · w nocy ${opiszCzas(podsumowanie.noce_min)}`}
          </p>
          {sygnaly.length > 0 && <p>Wykaz sygnałów: {sygnaly.length}</p>}
          <p style={{ marginTop: 6, color: '#5A6068' }}>
            Własna ewidencja pracownika prowadzona w aplikacji BHPewnie.
            Dokument pomocniczy — dane nie opuszczają urządzenia.
          </p>
          <p style={{ marginTop: 4, color: '#5A6068' }}>
            Fundusze Europejskie dla Rozwoju Społecznego 2021–2027 · Rzeczpospolita Polska ·
            Dofinansowane przez Unię Europejską · Forum Związków Zawodowych
          </p>
        </div>

        {/* Treść miniatury powtórzona dla czytnika ekranu — obrazek nie zastępuje danych. */}
        <p className="tylko-dla-czytnika">
          Dokument: Moja ewidencja czasu pracy — {miesiacNazwa}. Puste pole „Imię i nazwisko”.
          Razem {opiszCzas(podsumowanie.fakt_min)}, w nocy {opiszCzas(podsumowanie.noce_min)}.
          {sygnaly.length > 0 && ` Wykaz sygnałów: ${sygnaly.length}.`}
          {' '}Własna ewidencja pracownika. Dane nie opuszczają urządzenia.
          Pas oznaczeń: Fundusze Europejskie, Rzeczpospolita Polska, Unia Europejska,
          Forum Związków Zawodowych.
        </p>

        <Przycisk ikona="dokument" onClick={zapisz} wylaczony={zapisuje}>
          {zapisuje ? 'Składamy dokument…' : 'Pobierz PDF'}
        </Przycisk>
        <Przycisk odmiana="obrys" ikona="kalendarz" onClick={wroc}>Zmień miesiąc</Przycisk>

        {/*
          ZMIANA 1.3, sekcja 6 — adnotacja o mocy dowodowej. Stoi na ekranie, a nie
          tylko w pliku: człowiek ma wiedzieć, czym ten dokument jest, ZANIM go pobierze
          i zaniesie do pracodawcy. Pytanie o moc dowodową idzie do prawnika
          (ROZBIEZNOSCI.md, wpis 36) — do tego czasu treść nosi oznaczenie źródła.
        */}
        <p className="drobne">
          Zapis prowadzony samodzielnie przez pracownika. Nie zastępuje ewidencji czasu pracy
          prowadzonej przez pracodawcę. [treść do potwierdzenia przez specjalistę]
        </p>
      </div>
    </>
  )
}
