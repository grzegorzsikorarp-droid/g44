import type { ReactNode } from 'react'
import type { StanKafla } from '../typy'
import { useEffect, useRef } from 'react'

/* ---------- Ikony: rysowane liniowo, zawsze z aria-hidden ---------- */

const SCIEZKI: Record<string, ReactNode> = {
  wstecz: <path d="M15 5 8 12l7 7" />,
  zamknij: <path d="M6 6l12 12M18 6L6 18" />,
  dalej: <path d="m9 6 6 6-6 6" />,
  ptaszek: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  fala: <path d="M3 12c2.5-4 4.5-4 7 0s4.5 4 7 0" />,
  kreska: <path d="M5 12h14" />,
  strzalka_w_kolo: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v4h-4" /></>,
  start: <path d="M8.5 5.8v12.4l10-6.2z" />,
  stop: <rect x="6.8" y="6.8" width="10.4" height="10.4" rx="1.5" />,
  pauza: <><path d="M9.5 7v10" /><path d="M14.5 7v10" /></>,
  tabela: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 10h16M10 10v9" /></>,
  wykrzyknik: <><path d="M12 7v7" /><path d="M12 17.2v.2" /><circle cx="12" cy="12" r="9" /></>,
  kropka: <circle cx="12" cy="12" r="7" />,
  kask: <><path d="M4 15a8 8 0 0 1 16 0" /><path d="M2.5 15h19v2.6h-19z" /><path d="M10 7.2V4.8h4v2.4" /></>,
  lupa: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.7-4.7" /><path d="m8 10.5 1.8 1.8 3.4-3.6" /></>,
  gazeta: <><path d="M4 5h13v14H6a2 2 0 0 1-2-2Z" /><path d="M17 8h3v9a2 2 0 0 1-2 2h-1" /><path d="M7 9h7M7 12.5h7M7 16h4" /></>,
  ratunek: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.6" /><path d="m5.7 5.7 3.8 3.8m5 5 3.8 3.8m0-12.6-3.8 3.8m-5 5-3.8 3.8" /></>,
  slonce: <><circle cx="12" cy="12" r="4.4" /><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5 5l1.9 1.9M17.1 17.1 19 19M19 5l-1.9 1.9M6.9 17.1 5 19" /></>,
  ksiezyc: <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 7 7 0 0 0 20 14.5Z" />,
  stetoskop: <><path d="M8 3v5a4 4 0 0 0 8 0V3" /><path d="M12 12v3.5a4.5 4.5 0 0 0 9 0V13" /><circle cx="21" cy="10.5" r="2" /></>,
  ciezar: <><path d="M9 8V6.5a3 3 0 0 1 6 0V8" /><path d="M5.5 8h13l1.5 12h-16z" /></>,
  tarcza: <><path d="M12 3 5 5.8v5.4c0 4.5 3 7.9 7 9.8 4-1.9 7-5.3 7-9.8V5.8Z" /><path d="m9 11.6 2.1 2.1L15 9.8" /></>,
  ubranie: <path d="m9 4-5 3 2 3.5 2-1V20h8v-10.5l2 1L20 7l-5-3a3 3 0 0 1-6 0Z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12.5" rx="2" /><path d="M9 21h6m-3-4v4" /></>,
  sen: <path d="M4 8h5l-5 6h5M13 4h4l-4 5h4M14 15h4l-4 5h4" />,
  dzwonek: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" /><path d="M10 18.5a2.2 2.2 0 0 0 4 0" /></>,
  dokument: <><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v4h4M9 12h6M9 15.5h6" /></>,
  kopiuj: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 5.5v-2h-12v12h2" /></>,
  mowa: <><path d="M4 5h16v11H9l-5 4Z" /><path d="M8 9h8M8 12h5" /></>,
  dlon: <path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5v-1a1.5 1.5 0 0 1 3 0V10m0-4.5a1.5 1.5 0 0 1 3 0V12m0-2a1.5 1.5 0 0 1 3 0v4.5A6.5 6.5 0 0 1 12.5 21h-1A6.5 6.5 0 0 1 7 18l-2.6-3.6a1.5 1.5 0 0 1 2.3-1.9L7 14" />,
  igla: <><path d="m19 3 2 2m-3.5.5 2 2M13 5l6 6-8 8H7v-4Z" /><path d="m10 10 2 2m-4 1 2 2" /></>,
  ogien: <path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.6-3 1.5-4 0 1.4.8 2.3 1.7 2.3 1.3 0 1.8-1.2 1.8-3.3 0-1.6-.4-3-.4-3Z" />,
  serce: <path d="M12 20.5C7 16.7 3.5 13.4 3.5 9.6a4.6 4.6 0 0 1 8.5-2.5A4.6 4.6 0 0 1 20.5 9.6c0 3.8-3.5 7.1-8.5 10.9Z" />,
  ksiazka: <><path d="M12 6.5C10 4.8 7 4.5 4 4.8v13.7c3-.3 6 0 8 1.5 2-1.5 5-1.8 8-1.5V4.8c-3-.3-6 0-8 1.7Z" /><path d="M12 6.5V20" /></>,
  zegar: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.4 2" /></>,
  kalendarz: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  koło_zebate: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 14.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-3-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H2.8a2 2 0 1 1 0-4H3a1.7 1.7 0 0 0 1.2-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V2.8a2 2 0 1 1 4 0V3a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
  notatnik: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  telefon: <path d="M6.8 3.5c.7 0 1.3.4 1.6 1l1.2 2.6c.3.7.1 1.5-.5 2l-1 .8a13 13 0 0 0 5.9 5.9l.9-1c.5-.6 1.3-.8 2-.5l2.6 1.2c.6.3 1 .9 1 1.6v2c0 1-.8 1.9-1.9 1.8C10.4 20.1 3.9 13.6 3 5.4c-.1-1 .8-1.9 1.8-1.9Z" />,
  osoba: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  chemia: <><path d="M10 3v6L5 18a2.5 2.5 0 0 0 2.2 3.5h9.6A2.5 2.5 0 0 0 19 18l-5-9V3" /><path d="M8.5 3h7M7.5 14h9" /></>,
  ucho: <><path d="M7 9a5 5 0 1 1 8 4c-1.3 1-2 1.7-2 3a2.5 2.5 0 0 1-5 0" /><path d="M6 19.5c-.7-1-1-2-1-3" /></>,
  drzewo: <path d="M12 3 6.5 10h3L5 16h5.5v5h3v-5H19l-4.5-6h3Z" />,
  kierownica: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M3.4 10.5C6 12 9 12 12 12s6 0 8.6-1.5M12 15v6" /></>,
  odznaka: <path d="M12 3l2 2h3l1 3 2 2-1 3 1 3-2 2-1 3h-3l-2 2-2-2H7l-1-3-2-2 1-3-1-3 2-2 1-3h3Z" />,
  teczka: <><rect x="3" y="7.5" width="18" height="12.5" rx="2" /><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M3 12.5h18" /></>,
  samotnie: <><circle cx="12" cy="7.5" r="3.5" /><path d="M6 20.5a6 6 0 0 1 12 0" /><path d="M3 4l18 16" /></>,
  gora: <path d="m6 15 6-6 6 6" />,
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
}

export function Ikona({ nazwa, rozmiar = 24 }: { nazwa: string; rozmiar?: number }) {
  return (
    <svg
      width={rozmiar} height={rozmiar} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flex: '0 0 auto' }}
    >
      {SCIEZKI[nazwa] ?? SCIEZKI.kropka}
    </svg>
  )
}

/* ---------- Logotyp: wariant 1c „Zawias” ---------- */

/**
 * P siedzi w kwadratowym polu wziętym z budowy znaku FZZ i należy jednocześnie
 * do skrótu BHP i do słowa „pewnie”. Zmiana grubości na wyjściu z pola (700 → 500)
 * pokazuje, gdzie kończy się skrót, a gdzie zaczyna zwykłe słowo.
 * Czerwieni FZZ tu nie ma — znak nadawcy występuje wyłącznie w blokach nadawcy.
 */
export function Logotyp({ rozmiar = 32 }: { rozmiar?: number }) {
  const pole = Math.round(rozmiar * 1.08)
  return (
    <span className="logotyp" style={{ fontSize: rozmiar }} aria-label="BHPewnie" role="img">
      <span aria-hidden="true">BH</span>
      <span
        className="logotyp__pole"
        style={{ width: pole, height: pole, fontSize: Math.round(rozmiar * 0.85) }}
        aria-hidden="true"
      >
        P
      </span>
      <span className="logotyp__slowo" aria-hidden="true">ewnie</span>
    </span>
  )
}

/* ---------- Znak nadawcy FZZ ---------- */

/**
 * Oryginalny znak Forum Związków Zawodowych — w pełnych barwach, wyłącznie
 * w blokach nadawcy (stopka „O aplikacji”, pas oznaczeń w dokumentach A4).
 * Czerwień z tego znaku NIE przechodzi do interfejsu.
 */
export function ZnakFZZ({ rozmiar = 40 }: { rozmiar?: number }) {
  return (
    <svg width={rozmiar} height={rozmiar} viewBox="0 0 100 100" role="img"
         aria-label="Forum Związków Zawodowych" style={{ flex: '0 0 auto' }}>
      <rect x="4" y="4" width="92" height="92" fill="#FFFFFF" stroke="#2B2F36" strokeWidth="6" />
      <path d="M48 10 L90 10 L90 42 L68 42 L48 22 Z" fill="#F92E2E" />
      <path d="M50 72 L90 72 L90 90 L50 90 Z" fill="#F92E2E" />
      <path d="M22 10 Q48 12 48 36 L48 90 L10 90 L10 62 Q30 60 30 38 Q30 24 16 20 Z"
            fill="#FFFFFF" stroke="#2B2F36" strokeWidth="4.5" strokeLinejoin="round" />
      <text x="52" y="66" textAnchor="middle" fontFamily="'IBM Plex Sans', sans-serif"
            fontStyle="italic" fontWeight="700" fontSize="30" fill="#F5D442"
            stroke="#2B2F36" strokeWidth="1.4" paintOrder="stroke"
            transform="rotate(-5 52 62)">forum</text>
    </svg>
  )
}

/* ---------- Przycisk ---------- */

type Odmiana = 'glowny' | 'drugi' | 'obrys' | 'pomoc' | 'pomoc-jasny' | 'cichy'

export function Przycisk({
  children, onClick, odmiana = 'glowny', wielki, ikona, wylaczony, typ = 'button', opisDlaCzytnika,
}: {
  children: ReactNode
  onClick?: () => void
  odmiana?: Odmiana
  wielki?: boolean
  ikona?: string
  wylaczony?: boolean
  typ?: 'button' | 'submit'
  opisDlaCzytnika?: string
}) {
  return (
    <button
      type={typ}
      className={`przycisk przycisk--${odmiana}${wielki ? ' przycisk--wielki' : ''}`}
      onClick={onClick}
      disabled={wylaczony}
      aria-label={opisDlaCzytnika}
    >
      {ikona && <Ikona nazwa={ikona} rozmiar={22} />}
      <span>{children}</span>
    </button>
  )
}

/* ---------- Nagłówek ekranu ---------- */

export function Naglowek({
  tytul, oczko, naWstecz, naZamkniecie, opisZamkniecia,
}: {
  tytul?: string
  oczko?: string
  naWstecz?: () => void
  naZamkniecie?: () => void
  opisZamkniecia?: string
}) {
  return (
    <header className="naglowek">
      {naWstecz && (
        <button className="naglowek__ikona" onClick={naWstecz} aria-label="Wróć do poprzedniego ekranu">
          <Ikona nazwa="wstecz" />
        </button>
      )}
      <div className="naglowek__srodek">
        {oczko && <p className="oczko">{oczko}</p>}
        {tytul && <h1>{tytul}</h1>}
      </div>
      {naZamkniecie && (
        <button className="naglowek__ikona" onClick={naZamkniecie} aria-label={opisZamkniecia ?? 'Zamknij'}>
          <Ikona nazwa="zamknij" />
        </button>
      )}
    </header>
  )
}

/* ---------- Kafel ---------- */

/**
 * ZNAKI WERDYKTU (design 1.2, rozstrzygnięcie 02).
 *
 * Znaki `✓ ~ —` z wydania 1.2 są wycofane: myślnik czytał się jak interpunkcja,
 * a fala jak literówka. Nowe trzy różnią się KONTUREM, nie tylko kolorem, więc
 * rozpoznaje się je w skali szarości i przy 200% powiększenia.
 *
 * Stan „zapytamy” nie ma znaku werdyktu, bo werdyktu jeszcze nie ma — ma znak
 * zapytania i plakietkę ze słowem.
 */
const ZNAKI_WERDYKTU: Record<StanKafla, { sciezka: ReactNode; opis: string }> = {
  przysluguje: {
    sciezka: <path d="M6 12.4 10.2 16.6 18 8.4" />,
    opis: 'przysługuje',
  },
  zapytamy: {
    sciezka: <><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.6a2.5 2.5 0 1 1 2.9 2.9v1.4" /><circle cx="12.4" cy="17" r="0.9" fill="currentColor" stroke="none" /></>,
    opis: 'zapytamy o jedno',
  },
  zalezy: {
    // Koło wypełnione do połowy — kształt sam mówi „częściowo”.
    sciezka: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></>,
    opis: 'to zależy',
  },
  nie_przysluguje: {
    sciezka: <><circle cx="12" cy="12" r="8.5" /><path d="M6.5 17.5 17.5 6.5" /></>,
    opis: 'nie przysługuje',
  },
}

export function ZnakWerdyktu({ stan, rozmiar = 24 }: { stan: StanKafla; rozmiar?: number }) {
  const z = ZNAKI_WERDYKTU[stan]
  return (
    <>
      <svg
        width={rozmiar} height={rozmiar} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
        aria-hidden="true"
      >
        {z.sciezka}
      </svg>
      <span className="tylko-dla-czytnika">{z.opis}</span>
    </>
  )
}

export function Kafel({
  ikona, tytul, konkret, znacznik, stan, doOdswiezenia, onClick, dzieci,
}: {
  ikona: string
  tytul: string
  konkret?: string
  znacznik?: ReactNode
  stan?: StanKafla
  /** Druga oś: wiek odpowiedzi. Nie podmienia znaku werdyktu. */
  doOdswiezenia?: boolean
  onClick?: () => void
  dzieci?: ReactNode
}) {
  const wnetrze = (
    <>
      <span className="kafel__ikona"><Ikona nazwa={ikona} /></span>
      <span className="kafel__tresc">
        <span className="kafel__tytul">{tytul}</span>
        {konkret && <span className="kafel__konkret">{konkret}</span>}
        {znacznik}
        {dzieci}
      </span>
      {stan && <span className="kafel__stan"><ZnakWerdyktu stan={stan} /></span>}
    </>
  )
  const klasa = [
    'kafel',
    stan ? `kafel--stan-${stan}` : '',
    doOdswiezenia ? 'kafel--do-odswiezenia' : '',
  ].filter(Boolean).join(' ')
  return onClick
    ? <button className={klasa} onClick={onClick}>{wnetrze}</button>
    : <div className={klasa}>{wnetrze}</div>
}

/* ---------- Przełącznik ---------- */

export function Przelacznik({
  nazwa, opis, wlaczony, onZmiana, plakietka, wylaczony,
}: {
  nazwa: string
  opis: string
  wlaczony: boolean
  onZmiana?: () => void
  plakietka?: string
  wylaczony?: boolean
}) {
  if (wylaczony) {
    // Wariant bez suwaka: tego budzika nie da się przełączyć, można tylko uzupełnić grafik.
    return (
      <div className="przelacznik">
        <span style={{ flex: 1 }}>
          <b style={{ display: 'block', fontSize: '1.0625rem' }}>{nazwa}</b>
          <span className="drobne">{opis}</span>
        </span>
        {plakietka && <span className="plakietka-auto">{plakietka}</span>}
      </div>
    )
  }
  return (
    <button className="przelacznik" role="switch" aria-checked={wlaczony} onClick={onZmiana}>
      <span style={{ flex: 1 }}>
        <b style={{ display: 'block', fontSize: '1.0625rem' }}>{nazwa}</b>
        <span className="drobne">{opis}</span>
      </span>
      <span className="przelacznik__suwak" />
    </button>
  )
}

/* ---------- Podstawa prawna (zwijana, z datą stanu prawnego) ---------- */

export function PodstawaPrawna({ tresc, stanPrawny }: { tresc: string; stanPrawny: string }) {
  return (
    <details className="podstawa">
      <summary>
        <Ikona nazwa="ksiazka" rozmiar={22} />
        <span style={{ flex: 1 }}>Podstawa prawna</span>
        <Ikona nazwa="dalej" rozmiar={20} />
      </summary>
      <div className="podstawa__wnetrze">
        <p>{tresc}</p>
        <p className="podstawa__stan">Stan prawny na {stanPrawny}.</p>
      </div>
    </details>
  )
}

/* ---------- Pasek numerów alarmowych: na KAŻDYM ekranie Pomocy ---------- */

export function PasekAlarmowy({ naTelefon }: { naTelefon?: (numer: string) => void }) {
  return (
    <div className="pasek-alarmowy" role="group" aria-label="Numery alarmowe">
      <a
        className="telefon-przycisk telefon-przycisk--112" href="tel:112"
        onClick={(e) => { if (naTelefon) { e.preventDefault(); naTelefon('112') } }}
      >
        112<small>numer alarmowy</small>
      </a>
      <a
        className="telefon-przycisk telefon-przycisk--wsparcie" href="tel:800702222"
        onClick={(e) => { if (naTelefon) { e.preventDefault(); naTelefon('800 70 2222') } }}
      >
        800 70 2222<small>wsparcie, całodobowo</small>
      </a>
    </div>
  )
}

/* ---------- Chmurka (komunikat chwilowy) ---------- */

export function Chmurka({ tresc, naZniknieciu }: { tresc: string; naZniknieciu: () => void }) {
  const zegar = useRef<number>()
  useEffect(() => {
    zegar.current = window.setTimeout(naZniknieciu, 2600)
    return () => window.clearTimeout(zegar.current)
  }, [tresc, naZniknieciu])
  return <div className="chmurka" role="status" aria-live="polite">{tresc}</div>
}

/* ---------- Nakładka (arkusz od dołu) ---------- */

export function Nakladka({ tytul, dzieci, naZamkniecie }: { tytul: string; dzieci: ReactNode; naZamkniecie: () => void }) {
  useEffect(() => {
    const naKlawisz = (e: KeyboardEvent) => { if (e.key === 'Escape') naZamkniecie() }
    window.addEventListener('keydown', naKlawisz)
    return () => window.removeEventListener('keydown', naKlawisz)
  }, [naZamkniecie])

  return (
    <div className="nakladka" onClick={(e) => { if (e.target === e.currentTarget) naZamkniecie() }}>
      <div className="arkusz" role="dialog" aria-modal="true" aria-label={tytul}>
        <div className="uchwyt" />
        <div className="kolumna">{dzieci}</div>
      </div>
    </div>
  )
}

/* ---------- Plansza „w pełnej wersji” ---------- */

export function PlanszaPelnejWersji({ czego, naPowrot }: { czego: string; naPowrot: () => void }) {
  return (
    <div className="kolumna kolumna--luzna" style={{ flex: 1, justifyContent: 'center', textAlign: 'center', padding: '20px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span className="kafel__ikona" style={{ width: 72, height: 72, borderRadius: '50%' }}>
          <Ikona nazwa="dokument" rozmiar={34} />
        </span>
      </div>
      <span className="znacznik znacznik--szary" style={{ margin: '0 auto' }}>W pełnej wersji</span>
      <h2>{czego}</h2>
      <p className="opis">
        Tę ścieżkę przygotowujemy do pełnej wersji aplikacji. W prototypie przeklikasz w całości trzy sprawdzacze
        i ścieżkę wypadkową — to na nich sprawdzamy, czy pomysł działa.
      </p>
      <Przycisk odmiana="obrys" onClick={naPowrot}>Wróć do listy</Przycisk>
    </div>
  )
}
