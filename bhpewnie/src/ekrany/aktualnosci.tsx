import { useEffect, useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, Przycisk } from '../komponenty/podstawowe'
import { t } from '../dane/wczytaj'
import { datePoPolsku, wypelnij } from '../silnik/parametry'
import wbudowane from '../../content/aktualnosci-wbudowane.json'

export interface Wpis {
  id: string
  tytul: string
  zrodlo: string
  data: string
  wchodzi_w_zycie?: string
  od_redakcji: string[]
  odnosnik: string
}

/** Wpisy w paczce instalacyjnej — czytelne bez internetu (zasada 2). */
export const AKTUALNOSCI_WBUDOWANE = (wbudowane as any).wpisy as Wpis[]

function dniDo(dataDocelowa: string, dzis: string): number {
  return Math.ceil(
    (new Date(dataDocelowa + 'T00:00:00Z').getTime() - new Date(dzis + 'T00:00:00Z').getTime()) / 86400000,
  )
}

/* ================= E3.1 Strumień ================= */

export function StrumienAktualnosci() {
  const { nawiguj, stan, zmienStan, dzis } = useAplikacja()
  const [wpisy, ustawWpisy] = useState<Wpis[]>(AKTUALNOSCI_WBUDOWANE)
  const [bezSieci, ustawBezSieci] = useState(false)

  // Jedyne połączenie sieciowe aplikacji: statyczny plik z prasówką.
  useEffect(() => {
    let aktualne = true
    fetch(new URL('prasowka.json', document.baseURI), { cache: 'no-cache' })
      .then((o) => (o.ok ? o.json() : Promise.reject(new Error('brak'))))
      .then((dane) => {
        if (!aktualne) return
        ustawWpisy(dane.wpisy as Wpis[])
        ustawBezSieci(false)
        zmienStan((s) => ({ ...s, prasowkaOdswiezona: new Date().toISOString().slice(0, 10) }))
      })
      .catch(() => {
        // B2: żadnego komunikatu błędu — tylko informacja, kiedy ostatnio się udało.
        if (aktualne) ustawBezSieci(true)
      })
    return () => { aktualne = false }
  }, [zmienStan])

  return (
    <>
      <Naglowek tytul={t('aktualnosci.naglowek')} />
      <div className="kolumna" style={{ flex: 1 }}>
        {bezSieci && (
          <div className="pas">
            <Ikona nazwa="gazeta" rozmiar={22} />
            <p>
              {t('aktualnosci.offline').replace(
                '{data}',
                stan.prasowkaOdswiezona ? datePoPolsku(stan.prasowkaOdswiezona) : 'przy instalacji',
              )}
            </p>
          </div>
        )}

        <ul className="lista-czysta">
          {wpisy.map((w) => {
            const dni = w.wchodzi_w_zycie ? dniDo(w.wchodzi_w_zycie, dzis) : null
            return (
              <li key={w.id}>
                <button className="karta kolumna kolumna--ciasna" style={{ textAlign: 'left', width: '100%' }}
                        onClick={() => nawiguj('E3.2', { id: w.id })}>
                  <span className="drobne"><b style={{ color: 'var(--morski-ciemny)' }}>{w.zrodlo}</b> · {datePoPolsku(w.data)}</span>
                  <b style={{ fontSize: '1.125rem' }}>{w.tytul}</b>
                  {dni !== null && (
                    <span className="znacznik znacznik--spokojny" style={{ fontSize: '1rem' }}>
                      {dni > 0 ? `${dni} ${t('aktualnosci.licznik')}` : 'przepis już obowiązuje'}
                    </span>
                  )}
                  <span className="opis">{wypelnij(w.od_redakcji[0], dzis).tekst}</span>
                </button>
              </li>
            )
          })}
        </ul>

        <Przycisk odmiana="obrys" ikona="ksiazka" onClick={() => nawiguj('E3.3')}>{t('aktualnosci.archiwum')}</Przycisk>
      </div>
    </>
  )
}

/* ================= E3.2 Wpis ================= */

export function WpisAktualnosci({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, dzis, chmurka, zmienStan, stan } = useAplikacja()
  const wpis = useMemo(() => AKTUALNOSCI_WBUDOWANE.find((w) => w.id === dane.id), [dane.id])
  if (!wpis) return null

  const dni = wpis.wchodzi_w_zycie ? dniDo(wpis.wchodzi_w_zycie, dzis) : null
  const zapisanePrzypomnienie = Boolean(stan.przerwane[`przepis-${wpis.id}`])

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={wpis.zrodlo} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <div>
          <h1>{wpis.tytul}</h1>
          <p className="drobne">{datePoPolsku(wpis.data)}</p>
        </div>

        {dni !== null && (
          <div className="blok-ile">
            <p className="oczko">Wejście w życie</p>
            <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--morski-ciemny)', marginTop: 4 }}>
              {dni > 0 ? `za ${dni} dni` : 'już obowiązuje'}
            </p>
            <p className="drobne">{datePoPolsku(wpis.wchodzi_w_zycie!)}</p>
          </div>
        )}

        {wpis.od_redakcji.map((zdanie, i) => (
          <p key={i} style={{ fontSize: '1.0625rem' }}>{wypelnij(zdanie, dzis).tekst}</p>
        ))}

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Odnośnik do źródła</p>
          <p className="drobne">{wpis.odnosnik}</p>
          <Przycisk odmiana="obrys" onClick={() => chmurka('Prototyp — odnośnik do źródła jeszcze nie działa.')}>
            {t('aktualnosci.zrodlo')}
          </Przycisk>
        </div>

        {wpis.wchodzi_w_zycie && (
          <Przycisk
            odmiana={zapisanePrzypomnienie ? 'drugi' : 'glowny'}
            ikona="dzwonek"
            onClick={() => {
              zmienStan((s) => ({
                ...s,
                budziki: { ...s.budziki, wejscie_przepisu: true },
                przerwane: { ...s.przerwane, [`przepis-${wpis.id}`]: { krok: wpis.wchodzi_w_zycie!, kiedy: new Date().toISOString() } },
              }))
              chmurka('Odezwiemy się w dniu wejścia przepisu w życie.')
            }}
          >
            {zapisanePrzypomnienie ? 'Przypomnimy Ci o tym' : t('aktualnosci.przypomnij')}
          </Przycisk>
        )}
      </div>
    </>
  )
}

/* ================= E3.3 Archiwum ================= */

export function ArchiwumAktualnosci() {
  const { wroc, nawiguj, dzis } = useAplikacja()
  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('aktualnosci.archiwum')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="pas pas--spokojny">
          <Ikona nazwa="tarcza" rozmiar={22} />
          <p>Te wpisy są w paczce aplikacji — przeczytasz je także bez internetu.</p>
        </div>
        <ul className="lista-czysta">
          {AKTUALNOSCI_WBUDOWANE.map((w) => (
            <li key={w.id}>
              <button className="kafel kafel--swobodny" onClick={() => nawiguj('E3.2', { id: w.id })}>
                <span className="kafel__ikona"><Ikona nazwa="gazeta" /></span>
                <span className="kafel__tresc">
                  <b>{w.tytul}</b>
                  <span className="drobne" style={{ display: 'block' }}>{w.zrodlo} · {datePoPolsku(w.data)}</span>
                </span>
                <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
