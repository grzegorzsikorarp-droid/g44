import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, PasekAlarmowy, PlanszaPelnejWersji, PodstawaPrawna, Przycisk } from '../komponenty/podstawowe'
import { t } from '../dane/wczytaj'
import { STAN_PRAWNY, wypelnij } from '../silnik/parametry'
import { rozwiazProfil } from '../silnik/reguly'
import { pustyProfil } from '../magazyn/magazyn'
import type { WpisDziennika } from '../typy'
import biblioteka from '../../content/biblioteka.json'
import gdzieSzukac from '../../content/gdzie-szukac.json'

const SCIEZKI = import.meta.glob<{ default: SciezkaPliku }>('../../content/pomoc/*.json', { eager: true })

interface KrokPliku {
  id: string
  naglowek: string
  tresc: string
  nie_rob?: string
  rozgalezienie?: { pytanie: string; opcje: { etykieta: string; idzDo: string }[] }
}

interface SciezkaPliku {
  id: string
  etykieta: string
  opis: string
  ikona: string
  pelna: boolean
  kroki: KrokPliku[]
  zamkniecie?: { naglowek: string; tresc: string[]; karta_praw?: string }
  karta_praw?: {
    naglowek: string
    prawa: { tytul: string; opis: string; podstawa: string; warianty?: Record<string, { tytul: string; opis: string; podstawa: string }> }[]
    co_dalej: string[]
    material?: string
  }
  zamiast_karty_praw?: string
  uwaga_dziennik?: string
  metryczka?: { autor: string; rola: string; data_opracowania: string; data_przegladu: string }
}

function sciezki(): SciezkaPliku[] {
  return Object.entries(SCIEZKI)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, m]) => (m as any).default as SciezkaPliku)
}

/** Zapis pliku bez wciągania generatora PDF — dziennik jest zwykłym tekstem. */
function zapiszNaUrzadzeniu(blob: Blob, nazwa: string): void {
  const url = URL.createObjectURL(blob)
  const odnosnik = document.createElement('a')
  odnosnik.href = url
  odnosnik.download = nazwa
  document.body.appendChild(odnosnik)
  odnosnik.click()
  odnosnik.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function sciezka(id: string): SciezkaPliku | undefined {
  return sciezki().find((s) => s.id === id)
}

/** Każdy ekran Pomocy kończy się paskiem numerów alarmowych — bez wyjątku. */
function ZPaskiem({ dzieci }: { dzieci: React.ReactNode }) {
  const { chmurka } = useAplikacja()
  return (
    <>
      <div className="kolumna" style={{ flex: 1 }}>{dzieci}</div>
      <div style={{ margin: '16px -16px 0' }}>
        <PasekAlarmowy naTelefon={(numer) => chmurka(`Prototyp — telefon wybrałby numer ${numer}.`)} />
      </div>
    </>
  )
}

/* ================= E4.1 Wejście do Pomocy ================= */

export function PomocWejscie() {
  const { nawiguj, stan } = useAplikacja()
  const przerwana = Object.entries(stan.przerwane).find(([id]) => id.startsWith('sciezka-'))

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek tytul="Pomoc" />

        {przerwana && (
          <div className="pas">
            <Ikona nazwa="zegar" rozmiar={22} />
            <div className="kolumna kolumna--ciasna">
              <p>{t('pomoc.wznow_pytanie')}</p>
              <div className="rzad">
                <Przycisk
                  odmiana="pomoc-jasny"
                  onClick={() => nawiguj('E4.3', {
                    sciezka: przerwana[0].replace('sciezka-', ''),
                    krok: przerwana[1].krok,
                  })}
                >
                  {t('pomoc.wznow_tak')}
                </Przycisk>
                <Przycisk odmiana="obrys" onClick={() => nawiguj('E4.2')}>{t('pomoc.wznow_nowa')}</Przycisk>
              </div>
            </div>
          </div>
        )}

        {/* Dwa rozdzielone wejścia — kroki albo od razu rozmowa z człowiekiem. */}
        <button className="kafel" style={{ minHeight: 84 }} onClick={() => nawiguj('E4.2')}>
          <span className="kafel__ikona" style={{ background: 'var(--ceglasty-tlo)', color: 'var(--ceglasty-ciemny)' }}>
            <Ikona nazwa="ratunek" />
          </span>
          <span className="kafel__tresc">
            <b style={{ fontSize: '1.125rem' }}>Coś się stało</b>
            <span className="drobne" style={{ display: 'block' }}>poprowadzę Cię krok po kroku</span>
          </span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>

        <button
          className="kafel"
          style={{ minHeight: 84, background: 'var(--ceglasty)', borderColor: 'var(--ceglasty)' }}
          onClick={() => nawiguj('E4.10')}
        >
          <span className="kafel__ikona" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>
            <Ikona nazwa="serce" />
          </span>
          <span className="kafel__tresc" style={{ color: '#fff' }}>
            <b style={{ fontSize: '1.125rem' }}>Potrzebuję rozmowy</b>
            <span style={{ display: 'block', fontSize: '0.875rem' }}>bez kroków, od razu telefon do człowieka</span>
          </span>
          <span className="kafel__strzalka" style={{ color: '#fff' }}><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>

        <p className="oczko" style={{ marginTop: 8 }}>Po zdarzeniu</p>
        <button className="kafel" onClick={() => nawiguj('E4.7')}>
          <span className="kafel__ikona"><Ikona nazwa="notatnik" /></span>
          <span className="kafel__tresc"><b>{t('dziennik.naglowek')}</b>
            <span className="drobne" style={{ display: 'block' }}>zapisz, co się stało — zanim się zatrze</span></span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>
        <button className="kafel" onClick={() => nawiguj('E4.9')}>
          <span className="kafel__ikona"><Ikona nazwa="wykrzyknik" /></span>
          <span className="kafel__tresc"><b>{t('dziennik.prawie')}</b>
            <span className="drobne" style={{ display: 'block' }}>omal się nie stało — warto to zgłosić</span></span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>

        <p className="oczko" style={{ marginTop: 8 }}>Do przeczytania</p>
        <button className="kafel" onClick={() => nawiguj('E4.11')}>
          <span className="kafel__ikona"><Ikona nazwa="ksiazka" /></span>
          <span className="kafel__tresc"><b>{t('pomoc.biblioteka')}</b>
            <span className="drobne" style={{ display: 'block' }}>materiały od specjalistów</span></span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>
        <button className="kafel" onClick={() => nawiguj('E4.13')}>
          <span className="kafel__ikona"><Ikona nazwa="osoba" /></span>
          <span className="kafel__tresc"><b>{t('pomoc.gdzie_szukac')}</b>
            <span className="drobne" style={{ display: 'block' }}>kto pomaga, kiedy i czy anonimowo</span></span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>
      </>
    } />
  )
}

/* ================= E4.2 Wybór sytuacji ================= */

export function WyborSytuacji() {
  const { nawiguj, wroc } = useAplikacja()
  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek tytul="Co się stało?" naZamkniecie={wroc} opisZamkniecia="Zamknij Pomoc" />
        <p className="opis">Wybierz to, co najbliższe. Poprowadzimy Cię krok po kroku, jeden krok na ekran.</p>
        <ul className="lista-czysta">
          {sciezki().map((s) => (
            <li key={s.id}>
              <button className="kafel" style={{ minHeight: 72 }} onClick={() => nawiguj('E4.3', { sciezka: s.id, krok: s.kroki[0]?.id })}>
                <span className="kafel__ikona" style={{ background: 'var(--ceglasty-tlo)', color: 'var(--ceglasty-ciemny)' }}>
                  <Ikona nazwa={s.ikona === 'krzyz' ? 'ratunek' : s.ikona} />
                </span>
                <span className="kafel__tresc">
                  <b style={{ fontSize: '1.0625rem' }}>{s.etykieta}</b>
                  <span className="drobne" style={{ display: 'block' }}>{s.opis}</span>
                  {!s.pelna && <span className="znacznik znacznik--szary" style={{ marginTop: 6 }}>{t('wspolne.w_pelnej_wersji')}</span>}
                </span>
                <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
              </button>
            </li>
          ))}
        </ul>
      </>
    } />
  )
}

/* ================= E4.3 Krok ścieżki i E4.4 Rozgałęzienie ================= */

export function KrokSciezki({ dane }: { dane: Record<string, unknown> }) {
  const { nawiguj, wroc, zastapWidok, zmienStan, wrocDoZakladki } = useAplikacja()
  const idSciezki = dane.sciezka as string
  const s = sciezka(idSciezki)
  const [historia, ustawHistorie] = useState<string[]>([])

  if (!s) return null

  if (!s.pelna) {
    return (
      <ZPaskiem dzieci={
        <>
          <Naglowek naWstecz={wroc} naZamkniecie={() => wrocDoZakladki('E4.1')} opisZamkniecia="Zamknij Pomoc" oczko={s.etykieta} />
          {s.zamiast_karty_praw === 'dziennik' ? (
            <div className="kolumna kolumna--luzna" style={{ flex: 1, justifyContent: 'center' }}>
              <span className="znacznik znacznik--szary" style={{ margin: '0 auto' }}>{t('wspolne.w_pelnej_wersji')}</span>
              <h1>{s.etykieta}</h1>
              <p className="opis">{s.uwaga_dziennik}</p>
              <Przycisk odmiana="pomoc" ikona="notatnik" onClick={() => nawiguj('E4.8', { rodzaj: 'zdarzenie' })}>
                Zapisz zdarzenie w dzienniku
              </Przycisk>
              <Przycisk odmiana="obrys" onClick={() => wrocDoZakladki('E4.1')}>Wróć do Pomocy</Przycisk>
            </div>
          ) : (
            <PlanszaPelnejWersji czego={s.etykieta} naPowrot={() => wrocDoZakladki('E4.1')} />
          )}
        </>
      } />
    )
  }

  const idKroku = (dane.krok as string) ?? s.kroki[0].id
  const krok = s.kroki.find((k) => k.id === idKroku) ?? s.kroki[0]
  const numer = s.kroki.findIndex((k) => k.id === krok.id) + 1

  const dalej = (docelowy?: string) => {
    zmienStan((st) => ({
      ...st,
      przerwane: { ...st.przerwane, [`sciezka-${idSciezki}`]: { krok: docelowy ?? '', kiedy: new Date().toISOString() } },
    }))
    if (docelowy) {
      ustawHistorie([...historia, krok.id])
      zastapWidok('E4.3', { sciezka: idSciezki, krok: docelowy })
      return
    }
    const nastepny = s.kroki[numer]
    if (nastepny) {
      ustawHistorie([...historia, krok.id])
      zastapWidok('E4.3', { sciezka: idSciezki, krok: nastepny.id })
    } else {
      zmienStan((st) => {
        const przerwane = { ...st.przerwane }
        delete przerwane[`sciezka-${idSciezki}`]
        return { ...st, przerwane }
      })
      zastapWidok('E4.5', { sciezka: idSciezki })
    }
  }

  const cofnij = () => {
    const poprzedni = historia[historia.length - 1]
    if (poprzedni) {
      ustawHistorie(historia.slice(0, -1))
      zastapWidok('E4.3', { sciezka: idSciezki, krok: poprzedni })
    } else {
      wroc()
    }
  }

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek
          oczko={`${s.etykieta} · krok ${numer} z ${s.kroki.length}`}
          naWstecz={cofnij}
          naZamkniecie={() => wrocDoZakladki('E4.1')}
          opisZamkniecia="Zamknij Pomoc"
        />
        <div className="postep" role="progressbar" aria-valuemin={1} aria-valuemax={s.kroki.length} aria-valuenow={numer}>
          <span className="postep__wypelnienie" style={{ width: `${(numer / s.kroki.length) * 100}%`, background: 'var(--ceglasty)' }} />
        </div>

        <div className="krok-pomocy">
          <h1>{krok.naglowek}</h1>
          <p style={{ fontSize: '1.125rem' }}>{krok.tresc}</p>

          {krok.nie_rob && (
            <div className="nie-rob">
              <p className="oczko" style={{ color: 'inherit' }}>{t('pomoc.nie_rob')}</p>
              <p style={{ marginTop: 4 }}>{krok.nie_rob}</p>
            </div>
          )}

          {krok.rozgalezienie ? (
            <div className="kolumna">
              <p style={{ fontWeight: 700, fontSize: '1.0625rem' }}>{krok.rozgalezienie.pytanie}</p>
              {krok.rozgalezienie.opcje.map((o) => (
                <button key={o.idzDo} className="odpowiedz" onClick={() => dalej(o.idzDo)}>
                  <span className="odpowiedz__znacznik" aria-hidden="true" />
                  <span>{o.etykieta}</span>
                </button>
              ))}
            </div>
          ) : (
            <Przycisk odmiana="pomoc" wielki onClick={() => dalej()}>{t('pomoc.zrobione')}</Przycisk>
          )}
        </div>
      </>
    } />
  )
}

/* ================= E4.5 Zamknięcie ścieżki ================= */

export function ZamkniecieSciezki({ dane }: { dane: Record<string, unknown> }) {
  const { nawiguj, wrocDoZakladki, dzis } = useAplikacja()
  const s = sciezka(dane.sciezka as string)
  if (!s?.zamkniecie) return null

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naZamkniecie={() => wrocDoZakladki('E4.1')} opisZamkniecia="Zamknij Pomoc" oczko={s.etykieta} />
        <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
          <h1>{s.zamkniecie.naglowek}</h1>
          <ul className="kolumna" style={{ listStyle: 'none' }}>
            {s.zamkniecie.tresc.map((x, i) => (
              <li key={i} className="rzad" style={{ alignItems: 'flex-start' }}>
                <span className="kafel__ikona" style={{ width: 32, height: 32, borderRadius: 9 }}>
                  <Ikona nazwa="ptaszek" rozmiar={18} />
                </span>
                <span style={{ flex: 1 }}>{wypelnij(x, dzis).tekst}</span>
              </li>
            ))}
          </ul>

          {s.karta_praw && (
            <Przycisk odmiana="pomoc" wielki ikona="tarcza" onClick={() => nawiguj('E4.6', { sciezka: s.id })}>
              Zobacz, co Ci przysługuje
            </Przycisk>
          )}
          <Przycisk odmiana="obrys" onClick={() => nawiguj('E4.8', { rodzaj: 'zdarzenie' })}>
            Zapisz to zdarzenie w dzienniku
          </Przycisk>
        </div>
      </>
    } />
  )
}

/* ================= E4.6 Karta praw po zdarzeniu ================= */

export function KartaPraw({ dane }: { dane: Record<string, unknown> }) {
  const { stan, wroc, wrocDoZakladki, zmienStan, chmurka, dzis, nawiguj } = useAplikacja()
  const s = sciezka(dane.sciezka as string)
  const profil = stan.profil ?? pustyProfil()
  const status = rozwiazProfil(profil, dzis).status
  const [zapisuje, ustawZapisuje] = useState(false)

  const prawa = useMemo(() => {
    if (!s?.karta_praw) return []
    return s.karta_praw.prawa.map((p) => {
      const wariant = p.warianty?.[status]
      const zrodlo = wariant ?? p
      return {
        tytul: wypelnij(zrodlo.tytul, dzis).tekst,
        opis: wypelnij(zrodlo.opis, dzis).tekst,
        podstawa: zrodlo.podstawa,
      }
    })
  }, [s, status, dzis])

  if (!s?.karta_praw) return null

  const zapisz = async () => {
    ustawZapisuje(true)
    try {
      const { kartaPrawPoZdarzeniu, zapiszPlik } = await import('../pdf/dokumenty')
      const blob = await kartaPrawPoZdarzeniu({
        naglowek: s.karta_praw!.naglowek,
        prawa,
        coDalej: s.karta_praw!.co_dalej.map((x) => wypelnij(x, dzis).tekst),
      })
      zapiszPlik(blob, 'moje-prawa-po-zdarzeniu.pdf')
      chmurka('Zapisaliśmy kartę na Twoim urządzeniu.')
    } catch {
      chmurka('Nie udało się złożyć dokumentu. Spróbuj jeszcze raz.')
    } finally {
      ustawZapisuje(false)
    }
  }

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} naZamkniecie={() => wrocDoZakladki('E4.1')} opisZamkniecia="Zamknij Pomoc" oczko="Po zdarzeniu" />
        <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
          <div className="werdykt werdykt--przysluguje">
            <span className="werdykt__ikona"><Ikona nazwa="tarcza" rozmiar={30} /></span>
            <div>
              <p className="oczko" style={{ color: 'inherit', opacity: 0.85 }}>Twoje prawa</p>
              <h1 style={{ color: 'inherit', margin: '2px 0 0' }}>{s.karta_praw.naglowek}</h1>
            </div>
          </div>

          {status === 'funkcjonariusz' && (
            <div className="pas">
              <Ikona nazwa="odznaka" rozmiar={22} />
              <p>Pokazujemy wariant dla służby — w Twoim przypadku Kodeks pracy nie ma zastosowania wprost.</p>
            </div>
          )}

          <div className="kolumna">
            {prawa.map((p, i) => (
              <div key={i} className="karta kolumna kolumna--ciasna">
                <b style={{ fontSize: '1.0625rem' }}>{p.tytul}</b>
                <p>{p.opis}</p>
                <p className="drobne">Podstawa: {p.podstawa}</p>
              </div>
            ))}
          </div>

          <div className="blok-ile">
            <p className="oczko">Co zrobić dalej</p>
            <ul>{s.karta_praw.co_dalej.map((x, i) => <li key={i}>{wypelnij(x, dzis).tekst}</li>)}</ul>
          </div>

          <PodstawaPrawna
            tresc={prawa.map((p) => p.podstawa).filter((x, i, a) => a.indexOf(x) === i).join(' · ')}
            stanPrawny={STAN_PRAWNY}
          />

          <Przycisk ikona="dokument" odmiana="pomoc" onClick={zapisz} wylaczony={zapisuje}>
            {zapisuje ? 'Składamy dokument…' : 'Zapisz kartę praw (PDF)'}
          </Przycisk>

          <Przycisk
            odmiana="pomoc-jasny" ikona="dzwonek"
            onClick={() => {
              zmienStan((st) => ({ ...st, budziki: { ...st.budziki, powrot_po_pomocy: true } }))
              chmurka('Przypomnimy Ci jutro o zgłoszeniu na piśmie.')
            }}
          >
            {t('pomoc.przypomnij_jutro')}
          </Przycisk>

          {s.karta_praw.material && (
            <Przycisk odmiana="obrys" ikona="ksiazka" onClick={() => nawiguj('E4.12', { material: s.karta_praw!.material })}>
              Przeczytaj: co się dzieje po trudnym zdarzeniu
            </Przycisk>
          )}
        </div>
      </>
    } />
  )
}

/* ================= E4.7 / E4.9 Dzienniki ================= */

function ListaWpisow({ rodzaj }: { rodzaj: 'zdarzenie' | 'prawie_wypadek' }) {
  const { stan, nawiguj, wroc, chmurka } = useAplikacja()
  const wpisy = stan.dziennik.filter((w) => w.rodzaj === rodzaj)
  const tytul = rodzaj === 'zdarzenie' ? t('dziennik.naglowek') : t('dziennik.prawie')

  const eksportuj = () => {
    const tekst = wpisy
      .slice()
      .sort((a, b) => (a.data + a.godzina).localeCompare(b.data + b.godzina))
      .map((w) => [
        `${w.data} ${w.godzina}`,
        w.opis,
        w.co_moglo ? `Co mogło się stać: ${w.co_moglo}` : null,
        w.swiadkowie ? `Świadkowie: ${w.swiadkowie}` : null,
      ].filter(Boolean).join('\n'))
      .join('\n\n———\n\n')
    const blob = new Blob([tekst], { type: 'text/plain;charset=utf-8' })
    zapiszNaUrzadzeniu(blob, rodzaj === 'zdarzenie' ? 'dziennik-zdarzen.txt' : 'prawie-wypadki.txt')
    chmurka('Zapisaliśmy zestawienie na Twoim urządzeniu.')
  }

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} tytul={tytul} />
        <div className="pas pas--spokojny">
          <Ikona nazwa="tarcza" rozmiar={22} />
          <p>{t('dziennik.lokalnie')}</p>
        </div>

        {wpisy.length === 0 ? (
          <p className="opis">{t('dziennik.pusty')}</p>
        ) : (
          <ul className="lista-czysta">
            {wpisy.slice().sort((a, b) => (b.data + b.godzina).localeCompare(a.data + a.godzina)).map((w) => (
              <li key={w.id} className="karta kolumna kolumna--ciasna">
                <p className="oczko">{w.data} · {w.godzina}</p>
                <p>{w.opis}</p>
                {w.co_moglo && <p className="drobne"><b>Mogło się stać:</b> {w.co_moglo}</p>}
                {w.swiadkowie && <p className="drobne"><b>Widzieli:</b> {w.swiadkowie}</p>}
              </li>
            ))}
          </ul>
        )}

        <Przycisk ikona="notatnik" onClick={() => nawiguj('E4.8', { rodzaj })}>Dodaj wpis</Przycisk>
        {wpisy.length > 0 && (
          <Przycisk odmiana="obrys" ikona="dokument" onClick={eksportuj}>Zapisz zestawienie</Przycisk>
        )}
      </>
    } />
  )
}

export function DziennikZdarzen() { return <ListaWpisow rodzaj="zdarzenie" /> }
export function NotatnikPrawieWypadkow() { return <ListaWpisow rodzaj="prawie_wypadek" /> }

/* ================= E4.8 Wpis do dziennika ================= */

export function WpisDoDziennika({ dane }: { dane: Record<string, unknown> }) {
  const { zmienStan, wroc, chmurka } = useAplikacja()
  const rodzaj = (dane.rodzaj as 'zdarzenie' | 'prawie_wypadek') ?? 'zdarzenie'
  const teraz = new Date()
  const [data, ustawDate] = useState(teraz.toISOString().slice(0, 10))
  const [godzina, ustawGodzine] = useState(teraz.toTimeString().slice(0, 5))
  const [opis, ustawOpis] = useState('')
  const [coMoglo, ustawCoMoglo] = useState('')
  const [swiadkowie, ustawSwiadkow] = useState('')

  const zapisz = () => {
    const wpis: WpisDziennika = {
      id: `w-${Date.now()}`,
      rodzaj, data, godzina, opis,
      swiadkowie,
      co_moglo: rodzaj === 'prawie_wypadek' ? coMoglo : undefined,
      utworzony: new Date().toISOString(),
    }
    zmienStan((s) => ({ ...s, dziennik: [...s.dziennik, wpis] }))
    chmurka('Zapisaliśmy wpis. Zostaje w tym telefonie.')
    wroc()
  }

  const pole: React.CSSProperties = {
    display: 'block', width: '100%', minHeight: 48, marginTop: 4, padding: '10px 12px',
    fontSize: '1rem', borderRadius: 10, border: '1.5px solid var(--linia-mocna)',
    background: 'var(--papier)', color: 'var(--atrament)', fontFamily: 'inherit',
  }

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} tytul={rodzaj === 'zdarzenie' ? 'Nowy wpis' : 'Prawie-wypadek'} />
        <div className="pas pas--spokojny">
          <Ikona nazwa="tarcza" rozmiar={22} />
          <p>{t('dziennik.lokalnie')}</p>
        </div>

        <div className="rzad">
          <label style={{ flex: 1 }}>
            <span className="oczko">Data</span>
            <input type="date" value={data} onChange={(e) => ustawDate(e.target.value)} style={pole} />
          </label>
          <label style={{ flex: 1 }}>
            <span className="oczko">Godzina</span>
            <input type="time" value={godzina} onChange={(e) => ustawGodzine(e.target.value)} style={pole} />
          </label>
        </div>

        <label>
          <span className="oczko">{t('dziennik.co_sie_stalo')}</span>
          <textarea value={opis} onChange={(e) => ustawOpis(e.target.value)} rows={4} style={pole}
                    placeholder="Własnymi słowami: gdzie, co robiłeś(-aś), co się stało." />
        </label>

        {rodzaj === 'prawie_wypadek' && (
          <label>
            <span className="oczko">{t('dziennik.co_moglo')}</span>
            <textarea value={coMoglo} onChange={(e) => ustawCoMoglo(e.target.value)} rows={3} style={pole}
                      placeholder="Co by się stało, gdyby zabrakło szczęścia." />
          </label>
        )}

        <label>
          <span className="oczko">{t('dziennik.kto_widzial')}</span>
          <input type="text" value={swiadkowie} onChange={(e) => ustawSwiadkow(e.target.value)} style={pole}
                 placeholder="Imiona i nazwiska, jeśli je znasz" />
        </label>

        {rodzaj === 'prawie_wypadek' && (
          <div className="pas">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <p>Prawie-wypadek warto zgłosić przełożonemu albo służbie BHP — zanim skończy się gorzej. Ten wpis pomoże Ci to opowiedzieć.</p>
          </div>
        )}

        <Przycisk onClick={zapisz} wylaczony={opis.trim().length === 0}>{t('wspolne.zapisz')}</Przycisk>
      </>
    } />
  )
}

/* ================= E4.10 Ekran kryzysowy ================= */
/* Zasada z briefu: NIC poza dwoma zdaniami, dwoma numerami i zdaniem o 112.
   Ekran nie zapamiętuje żadnego stanu. */

export function EkranKryzysowy() {
  const { wrocDoZakladki, chmurka } = useAplikacja()
  return (
    <>
      <Naglowek naZamkniecie={() => wrocDoZakladki('E4.1')} opisZamkniecia="Zamknij" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, justifyContent: 'center' }}>
        <p style={{ fontSize: '1.375rem', fontWeight: 700 }}>{t('kryzys.zdanie1')}</p>
        <p style={{ fontSize: '1.125rem' }}>{t('kryzys.zdanie2')}</p>

        <a
          className="przycisk przycisk--pomoc przycisk--wielki"
          href="tel:800702222"
          style={{ flexDirection: 'column', minHeight: 96, gap: 2, textDecoration: 'none' }}
          onClick={(e) => { e.preventDefault(); chmurka('Prototyp — telefon wybrałby numer 800 70 2222.') }}
        >
          <span style={{ fontSize: '2rem' }}>{t('kryzys.telefon1')}</span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{t('kryzys.telefon1_opis')}</span>
        </a>

        <a
          className="przycisk przycisk--pomoc-jasny przycisk--wielki"
          href="tel:116123"
          style={{ flexDirection: 'column', minHeight: 96, gap: 2, textDecoration: 'none' }}
          onClick={(e) => { e.preventDefault(); chmurka('Prototyp — telefon wybrałby numer 116 123.') }}
        >
          <span style={{ fontSize: '2rem' }}>{t('kryzys.telefon2')}</span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{t('kryzys.telefon2_opis')}</span>
        </a>

        <p style={{ fontSize: '1.0625rem', fontWeight: 700, color: 'var(--ceglasty-ciemny)', textAlign: 'center' }}>
          {t('kryzys.zycie')}
        </p>
      </div>
    </>
  )
}

/* ================= E4.11 Biblioteka i E4.12 Materiał ================= */

interface MaterialPliku {
  id: string
  dzial: string
  tytul: string
  opis: string
  czas_czytania: string
  rozmiar_mb: number
  tresc: string[]
  objawy_alarmowe?: string[]
  zastrzezenie?: string
  metryczka: { autor: string; rola: string; data_opracowania: string; data_przegladu: string }
}

export function Biblioteka() {
  const { nawiguj, wroc, stan, zmienStan, chmurka } = useAplikacja()
  const dzialy = (biblioteka as any).dzialy as { id: string; nazwa: string; opis: string }[]
  const materialy = (biblioteka as any).materialy as MaterialPliku[]

  const pobierz = (m: MaterialPliku) => {
    // B12: sprawdzamy miejsce przed pobraniem (w prototypie limit umowny).
    const zajete = stan.pobraneMaterialy.length * 1.1
    if (zajete + m.rozmiar_mb > 8) {
      chmurka(t('blad.mala_pamiec').replace('{ile}', String(Math.ceil(zajete + m.rozmiar_mb - 8))))
      return
    }
    zmienStan((s) => ({ ...s, pobraneMaterialy: [...new Set([...s.pobraneMaterialy, m.id])] }))
    chmurka('Materiał jest już dostępny bez internetu.')
  }

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} tytul={t('pomoc.biblioteka')} />
        <p className="opis">Materiały opracowane przez specjalistów. Każdy ma metryczkę — wiesz, kto i kiedy je napisał.</p>

        {dzialy.map((d) => (
          <section key={d.id} className="kolumna kolumna--ciasna">
            <p className="oczko">{d.nazwa}</p>
            {materialy.filter((m) => m.dzial === d.id).map((m) => (
              <div key={m.id} className="karta kolumna kolumna--ciasna">
                <button style={{ textAlign: 'left' }} onClick={() => nawiguj('E4.12', { material: m.id })}>
                  <b style={{ fontSize: '1.0625rem' }}>{m.tytul}</b>
                  <p className="drobne">{m.opis}</p>
                  <p className="drobne">{m.czas_czytania} · {m.rozmiar_mb} MB</p>
                </button>
                <Przycisk
                  odmiana={stan.pobraneMaterialy.includes(m.id) ? 'drugi' : 'obrys'}
                  onClick={() => pobierz(m)}
                >
                  {stan.pobraneMaterialy.includes(m.id) ? 'Pobrane — dostępne bez internetu' : 'Pobierz na telefon'}
                </Przycisk>
              </div>
            ))}
          </section>
        ))}
      </>
    } />
  )
}

export function MaterialBiblioteki({ dane }: { dane: Record<string, unknown> }) {
  const { wroc } = useAplikacja()
  const materialy = (biblioteka as any).materialy as MaterialPliku[]
  const m = materialy.find((x) => x.id === dane.material)
  if (!m) return null

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} oczko={t('pomoc.biblioteka')} />
        <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
          <h1>{m.tytul}</h1>
          <p className="drobne">{m.czas_czytania}</p>
          {m.tresc.map((akapit, i) => <p key={i} style={{ fontSize: '1.0625rem' }}>{akapit}</p>)}

          {m.objawy_alarmowe && m.objawy_alarmowe.length > 0 && (
            <div className="pas">
              <Ikona nazwa="wykrzyknik" rozmiar={22} />
              <div>
                <p className="oczko" style={{ color: 'inherit' }}>Kiedy iść do lekarza</p>
                <ul style={{ margin: '6px 0 0 18px' }}>
                  {m.objawy_alarmowe.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
            </div>
          )}

          {m.zastrzezenie && <p className="drobne">{m.zastrzezenie}</p>}

          <div className="karta kolumna kolumna--ciasna">
            <p className="oczko">Metryczka</p>
            <p className="drobne">Opracowanie: {m.metryczka.autor} — {m.metryczka.rola}</p>
            <p className="drobne">Data opracowania: {m.metryczka.data_opracowania} · następny przegląd: {m.metryczka.data_przegladu}</p>
          </div>
        </div>
      </>
    } />
  )
}

/* ================= E4.13 Gdzie szukać pomocy ================= */

interface Instytucja {
  id: string
  nazwa: string
  dla_kogo: string
  kiedy: string
  anonimowo: boolean
  platne: boolean
  jak_sie_zglosic: string
  branzowa: boolean
}

export function GdzieSzukacPomocy() {
  const { wroc } = useAplikacja()
  const instytucje = (gdzieSzukac as any).instytucje as Instytucja[]
  const powszechne = instytucje.filter((i) => !i.branzowa)
  const branzowe = instytucje.filter((i) => i.branzowa)

  const Karta = ({ i }: { i: Instytucja }) => (
    <div className="karta kolumna kolumna--ciasna">
      <b style={{ fontSize: '1.0625rem' }}>{i.nazwa}</b>
      <div className="rzad" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className={`znacznik ${i.anonimowo ? 'znacznik--spokojny' : 'znacznik--szary'}`}>
          {i.anonimowo ? 'można anonimowo' : 'trzeba się przedstawić'}
        </span>
        <span className={`znacznik ${i.platne ? '' : 'znacznik--spokojny'}`}>
          {i.platne ? 'płatne' : 'bezpłatne'}
        </span>
      </div>
      <p><b>Dla kogo:</b> {i.dla_kogo}</p>
      <p><b>Kiedy:</b> {i.kiedy}</p>
      <p className="drobne"><b>Jak się zgłosić:</b> {i.jak_sie_zglosic}</p>
    </div>
  )

  return (
    <ZPaskiem dzieci={
      <>
        <Naglowek naWstecz={wroc} tytul={t('pomoc.gdzie_szukac')} />
        <p className="opis">Przy każdym miejscu piszemy wprost: dla kogo, kiedy, czy anonimowo i czy płatnie.</p>
        {powszechne.map((i) => <Karta key={i.id} i={i} />)}
        {branzowe.length > 0 && (
          <>
            <p className="oczko" style={{ marginTop: 8 }}>Osobne systemy branżowe</p>
            {branzowe.map((i) => <Karta key={i.id} i={i} />)}
          </>
        )}
      </>
    } />
  )
}
