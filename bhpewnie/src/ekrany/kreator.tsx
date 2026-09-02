import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Logotyp, Naglowek, Przycisk } from '../komponenty/podstawowe'
import { pytaniaKreatora, t } from '../dane/wczytaj'
import { policzUprawnienia } from '../silnik/reguly'
import { pustyProfil } from '../magazyn/magazyn'
import { domyslneStaleGodziny, nalozWzorzec, pomalujDzien, pustyGrafik, trybZGrafiku, WZORCE_ROTACJI, DNI_SKROTY, iso, dodajDni, poczatekTygodnia } from '../silnik/grafik'
import type { Grafik, OdpowiedziCech, Profil } from '../typy'
import { POMINIETE } from '../typy'

/* ================= E0.1 Powitanie ================= */

export function Powitanie() {
  const { nawiguj, uruchomPrzyklad, zmienStan } = useAplikacja()
  return (
    <div className="kolumna kolumna--luzna" style={{ flex: 1, justifyContent: 'center', paddingBottom: 24 }}>
      <div className="kolumna" style={{ textAlign: 'center', alignItems: 'center' }}>
        <Logotyp rozmiar={44} />
        <p style={{ fontSize: '1.125rem', marginTop: 8 }}>{t('powitanie.zdanie')}</p>
        <p className="opis">{t('powitanie.prywatnosc')}</p>
      </div>

      <div className="kolumna">
        <Przycisk
          wielki
          onClick={() => {
            zmienStan((s) => ({ ...s, przerwanyKreator: { nr: 0, odpowiedzi: {} } }))
            nawiguj('E0.2')
          }}
        >
          {t('powitanie.ustaw')}
        </Przycisk>
        <Przycisk odmiana="obrys" wielki onClick={uruchomPrzyklad}>{t('powitanie.przyklad')}</Przycisk>
      </div>

      <p className="drobne" style={{ textAlign: 'center' }}>
        Aplikacja Forum Związków Zawodowych. Prototyp roboczy — treści wymagają autoryzacji specjalistów.
      </p>
    </div>
  )
}

/* ================= Wspólna obsługa kreatora ================= */

const PYTANIA = pytaniaKreatora()
/** Kolejność ekranów kreatora — jedno pytanie na ekran. */
export const KOLEJNOSC_KREATORA = [
  'E0.2', 'E0.3', 'E0.4', 'E0.5', 'E0.6', 'E0.7', 'E0.8', 'E0.9', 'E0.10', 'E0.11',
  'E0.12', 'E0.13', 'E0.14', 'E0.15', 'E0.16', 'E0.17', 'E0.18', 'E0.19', 'E0.20', 'E0.21', 'E0.22', 'E0.23',
]

function pytanieEkranu(ekran: string) {
  return PYTANIA.find((p) => p.ekran === ekran)
}

function nastepnyEkran(biezacy: string, pomijamGrafik: boolean): string {
  const i = KOLEJNOSC_KREATORA.indexOf(biezacy)
  let nastepny = KOLEJNOSC_KREATORA[i + 1] ?? 'E0.22'
  if (pomijamGrafik && (nastepny === 'E0.16' || nastepny === 'E0.17')) nastepny = 'E0.18'
  return nastepny
}

function useKreator() {
  const { stan, zmienStan, nawiguj, wroc, zastapWidok, chmurka } = useAplikacja()
  const szkic = stan.przerwanyKreator ?? { nr: 0, odpowiedzi: {} }

  const zapiszOdpowiedz = (klucz: string, wartosc: unknown) => {
    zmienStan((s) => ({
      ...s,
      przerwanyKreator: { nr: (s.przerwanyKreator?.nr ?? 0) + 1, odpowiedzi: { ...(s.przerwanyKreator?.odpowiedzi ?? {}), [klucz]: wartosc } },
    }))
  }

  const idzDalej = (zBiezacego: string) => {
    const pomijam = szkic.odpowiedzi['pomijam_grafik'] === true
    nawiguj(nastepnyEkran(zBiezacego, pomijam))
  }

  return { szkic, zapiszOdpowiedz, idzDalej, nawiguj, wroc, zastapWidok, chmurka, zmienStan }
}

function PrzerwijKreator() {
  const { zmienStan, wrocDoZakladki, stan } = useAplikacja()
  const [pyta, ustawPyta] = useState(false)

  if (!pyta) {
    return (
      <button className="naglowek__ikona" onClick={() => ustawPyta(true)} aria-label="Przerwij ustawianie aplikacji">
        <Ikona nazwa="zamknij" />
      </button>
    )
  }
  return (
    <div className="nakladka" onClick={(e) => { if (e.target === e.currentTarget) ustawPyta(false) }}>
      <div className="arkusz" role="dialog" aria-modal="true" aria-label="Przerwać ustawianie?">
        <div className="uchwyt" />
        <div className="kolumna">
          <h2>{t('kreator.wyjscie_pytanie')}</h2>
          <Przycisk odmiana="obrys" onClick={() => ustawPyta(false)}>{t('kreator.wyjscie_wroc')}</Przycisk>
          <Przycisk
            odmiana="glowny"
            onClick={() => {
              zmienStan((s) => ({ ...s, przerwanyKreator: null }))
              wrocDoZakladki(stan.profil ? 'E1.1' : 'E0.1')
            }}
          >
            {t('kreator.wyjscie_potwierdz')}
          </Przycisk>
        </div>
      </div>
    </div>
  )
}

function PasekKroku({ ekran }: { ekran: string }) {
  const nr = KOLEJNOSC_KREATORA.indexOf(ekran) + 1
  const ile = KOLEJNOSC_KREATORA.length
  return (
    <div className="kolumna kolumna--ciasna">
      <div className="postep" role="progressbar" aria-valuemin={1} aria-valuemax={ile} aria-valuenow={nr}
           aria-label={`Krok ${nr} z ${ile}`}>
        <span className="postep__wypelnienie" style={{ width: `${(nr / ile) * 100}%` }} />
      </div>
    </div>
  )
}

/* ================= E0.2–E0.14 Pytania o cechy ================= */

export function PytanieCechy({ dane }: { dane: Record<string, unknown> }) {
  const ekran = (dane.ekran as string) ?? 'E0.2'
  const pytanie = pytanieEkranu(ekran)!
  const { szkic, zapiszOdpowiedz, idzDalej, wroc } = useKreator()
  const [dopytanie, ustawDopytanie] = useState(false)

  if (!pytanie) return null

  const odpowiedzTak = () => {
    if (pytanie.dopytanie) ustawDopytanie(true)
    else { zapiszOdpowiedz(pytanie.cecha!, true); idzDalej(ekran) }
  }

  const odpowiedzNie = () => {
    // Cecha z dopytaniem ma wartość „brak” zamiast false — inaczej wygląda w silniku.
    const wartoscNie = pytanie.dopytanie ? (pytanie.cecha === 'monitor' || pytanie.cecha === 'dzwiganie' || pytanie.cecha === 'kontakt' ? 'brak' : false) : false
    zapiszOdpowiedz(pytanie.cecha!, wartoscNie)
    idzDalej(ekran)
  }

  const wybierzDopytanie = (wartosc: string) => {
    zapiszOdpowiedz(pytanie.cecha!, wartosc)
    idzDalej(ekran)
  }

  const pomin = () => {
    zapiszOdpowiedz(pytanie.cecha!, POMINIETE)
    idzDalej(ekran)
  }

  return (
    <>
      <Naglowek
        oczko={`Pytanie ${KOLEJNOSC_KREATORA.indexOf(ekran) + 1} z ${KOLEJNOSC_KREATORA.length}`}
        naWstecz={wroc}
      />
      <PasekKroku ekran={ekran} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>{dopytanie ? pytanie.dopytanie!.tresc : pytanie.tresc}</h1>

        {!dopytanie && pytanie.przyklady && (
          <div className="przyklady">
            <p className="oczko">{t('kreator.przyklady')}</p>
            <ul>{pytanie.przyklady.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}

        <div className="kolumna">
          {dopytanie
            ? pytanie.dopytanie!.opcje.map((o) => (
                <button key={String(o.wartosc)} className="odpowiedz" onClick={() => wybierzDopytanie(String(o.wartosc))}>
                  <span className="odpowiedz__znacznik" aria-hidden="true" />
                  <span>{o.etykieta}</span>
                </button>
              ))
            : (
              <>
                <button className="odpowiedz" onClick={odpowiedzTak}>
                  <span className="odpowiedz__znacznik" aria-hidden="true" />
                  <span>Tak</span>
                </button>
                <button className="odpowiedz" onClick={odpowiedzNie}>
                  <span className="odpowiedz__znacznik" aria-hidden="true" />
                  <span>Nie</span>
                </button>
              </>
            )}
        </div>

        <div style={{ marginTop: 'auto' }}>
          <Przycisk odmiana="cichy" onClick={pomin}>{t('wspolne.pomin')}</Przycisk>
          <p className="drobne" style={{ textAlign: 'center', marginTop: 4 }}>
            Gdy pominiesz pytanie, pokażemy więcej uprawnień i oznaczymy je jako zależne od Twojej odpowiedzi.
          </p>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

/* ================= E0.15 Stałe godziny czy zmiany ================= */

export function TrybPracy() {
  const { zapiszOdpowiedz, idzDalej, wroc, zmienStan, nawiguj } = useKreator()

  const wybierz = (tryb: 'stale' | 'zmiany') => {
    zapiszOdpowiedz('tryb_pracy', tryb)
    if (tryb === 'stale') {
      zmienStan((s) => ({
        ...s,
        przerwanyKreator: {
          nr: (s.przerwanyKreator?.nr ?? 0) + 1,
          odpowiedzi: { ...(s.przerwanyKreator?.odpowiedzi ?? {}), tryb_pracy: 'stale', pomijam_grafik: true },
        },
      }))
      nawiguj('E0.18')
    } else {
      idzDalej('E0.15')
    }
  }

  const odloz = () => {
    zmienStan((s) => ({
      ...s,
      przerwanyKreator: {
        nr: (s.przerwanyKreator?.nr ?? 0) + 1,
        odpowiedzi: { ...(s.przerwanyKreator?.odpowiedzi ?? {}), tryb_pracy: 'zmiany', pomijam_grafik: true },
      },
    }))
    nawiguj('E0.18')
  }

  return (
    <>
      <Naglowek oczko={`Pytanie ${KOLEJNOSC_KREATORA.indexOf('E0.15') + 1} z ${KOLEJNOSC_KREATORA.length}`} naWstecz={wroc} />
      <PasekKroku ekran="E0.15" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>Stałe godziny czy zmiany?</h1>
        <div className="kolumna">
          <button className="odpowiedz" onClick={() => wybierz('stale')}>
            <span className="odpowiedz__znacznik" aria-hidden="true" />
            <span>Stałe godziny</span>
          </button>
          <button className="odpowiedz" onClick={() => wybierz('zmiany')}>
            <span className="odpowiedz__znacznik" aria-hidden="true" />
            <span>Zmiany</span>
          </button>
        </div>
        <div className="pas pas--spokojny">
          <Ikona nazwa="kalendarz" rozmiar={22} />
          <div>
            <p>{t('kreator.grafik_pozniej')}</p>
            <button onClick={odloz} style={{ fontWeight: 700, marginTop: 6, textDecoration: 'underline' }}>
              {t('kreator.grafik_odloz')}
            </button>
          </div>
        </div>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

/* ================= E0.16 Szablony zmian ================= */

export function SzablonyZmian() {
  const { szkic, zmienStan, nawiguj, wroc } = useKreator()
  const grafik = (szkic.odpowiedzi['grafik'] as Grafik | undefined) ?? pustyGrafik()

  const zapiszGrafik = (nowy: Grafik) => {
    zmienStan((s) => ({
      ...s,
      przerwanyKreator: { nr: s.przerwanyKreator?.nr ?? 0, odpowiedzi: { ...(s.przerwanyKreator?.odpowiedzi ?? {}), grafik: nowy } },
    }))
  }

  return (
    <>
      <Naglowek oczko="Twoje zmiany" naWstecz={wroc} />
      <PasekKroku ekran="E0.16" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>Jak nazywają się Twoje zmiany?</h1>
        <p className="opis">Zostawiliśmy dwie najczęstsze. Możesz je zmienić teraz albo później w ustawieniach.</p>

        <div className="kolumna">
          {grafik.szablony.map((s, i) => (
            <div key={s.skrot} className="karta kolumna kolumna--ciasna">
              <div className="rzad">
                <span className="kafel__ikona" style={{ background: s.nocna ? '#233b4a' : 'var(--morski)', color: '#fff' }}>
                  <Ikona nazwa={s.nocna ? 'ksiezyc' : 'slonce'} />
                </span>
                <div style={{ flex: 1 }}>
                  <b>{s.skrot} — {s.nazwa}</b>
                  <p className="drobne">{s.od}–{s.do}</p>
                </div>
              </div>
              <div className="rzad">
                <label className="drobne" style={{ flex: 1 }}>
                  Od
                  <input
                    type="time" value={s.od} style={polaStyl}
                    onChange={(e) => {
                      const szablony = [...grafik.szablony]
                      szablony[i] = { ...s, od: e.target.value }
                      zapiszGrafik({ ...grafik, szablony })
                    }}
                  />
                </label>
                <label className="drobne" style={{ flex: 1 }}>
                  Do
                  <input
                    type="time" value={s.do} style={polaStyl}
                    onChange={(e) => {
                      const szablony = [...grafik.szablony]
                      szablony[i] = { ...s, do: e.target.value }
                      zapiszGrafik({ ...grafik, szablony })
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <Przycisk onClick={() => { zapiszGrafik(grafik); nawiguj('E0.17') }}>Dalej — ułóż tygodnie</Przycisk>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

const polaStyl: React.CSSProperties = {
  display: 'block', width: '100%', minHeight: 48, marginTop: 4, padding: '8px 10px',
  fontSize: '1rem', borderRadius: 10, border: '1.5px solid var(--linia-mocna)',
  background: 'var(--papier)', color: 'var(--atrament)',
}

/* ================= E0.17 Kalendarz ================= */

export function KalendarzGrafiku() {
  const { szkic, zmienStan, nawiguj, wroc } = useKreator()
  const grafikStart = (szkic.odpowiedzi['grafik'] as Grafik | undefined) ?? pustyGrafik()
  const [grafik, ustawGrafik] = useState<Grafik>(grafikStart)
  const [pedzel, ustawPedzel] = useState<string>('D')
  const dzisiaj = new Date()
  const poczatek = poczatekTygodnia(dzisiaj)

  const zapisz = (nowy: Grafik) => {
    ustawGrafik(nowy)
    zmienStan((s) => ({
      ...s,
      przerwanyKreator: { nr: s.przerwanyKreator?.nr ?? 0, odpowiedzi: { ...(s.przerwanyKreator?.odpowiedzi ?? {}), grafik: nowy } },
    }))
  }

  const tygodnie = [0, 1, 2, 3]

  return (
    <>
      <Naglowek oczko="Twój grafik" naWstecz={wroc} />
      <PasekKroku ekran="E0.17" />
      <div className="kolumna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>Ułóż swoje zmiany</h1>
        <p className="opis">Wybierz zmianę i dotykaj dni. Drugie dotknięcie tego samego dnia go czyści.</p>

        <div className="rzad" role="group" aria-label="Wybór malowanej zmiany">
          {grafik.szablony.map((s) => (
            <button
              key={s.skrot}
              className="odpowiedz"
              aria-pressed={pedzel === s.skrot}
              style={{ justifyContent: 'center', minHeight: 56 }}
              onClick={() => ustawPedzel(s.skrot)}
            >
              {s.skrot} — {s.nazwa}
            </button>
          ))}
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Szybkie ułożenie</p>
          <div className="kolumna kolumna--ciasna">
            {WZORCE_ROTACJI.map((w) => (
              <button key={w.id} className="kafel" onClick={() => zapisz(nalozWzorzec(grafik, poczatek, w.id, 28))}>
                <span className="kafel__ikona"><Ikona nazwa="kalendarz" /></span>
                <span className="kafel__tresc">
                  <b>{w.nazwa}</b>
                  <span className="drobne" style={{ display: 'block' }}>{w.opis}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="kolumna kolumna--ciasna">
          <div className="siatka-dni" aria-hidden="true">
            {DNI_SKROTY.map((d) => <span key={d} className="drobne" style={{ textAlign: 'center' }}>{d}</span>)}
          </div>
          {tygodnie.map((tydzien) => (
            <div className="siatka-dni" key={tydzien}>
              {DNI_SKROTY.map((_, i) => {
                const data = dodajDni(poczatek, tydzien * 7 + i)
                const dzien = iso(data)
                const skrot = grafik.kalendarz[dzien]
                const szablon = grafik.szablony.find((s) => s.skrot === skrot)
                const klasa = szablon ? (szablon.nocna ? ' dzien-grafiku--nocna' : ' dzien-grafiku--dzienna') : ''
                const dzis = iso(dzisiaj) === dzien
                return (
                  <button
                    key={dzien}
                    className={`dzien-grafiku${klasa}${dzis ? ' dzien-grafiku--dzis' : ''}`}
                    onClick={() => zapisz(pomalujDzien(grafik, dzien, pedzel))}
                    aria-label={`${data.getDate()} dnia — ${szablon ? szablon.nazwa : 'wolne'}`}
                  >
                    <small>{data.getDate()}</small>
                    <span>{skrot ?? '—'}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <Przycisk onClick={() => nawiguj('E0.18')}>
          {trybZGrafiku(grafik) ? 'Gotowe — dalej' : 'Pomiń grafik'}
        </Przycisk>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

/* ================= E0.18–E0.21 Modyfikatory ================= */

function EkranWyboru({ ekran }: { ekran: string }) {
  const pytanie = pytanieEkranu(ekran)!
  const { zapiszOdpowiedz, idzDalej, wroc } = useKreator()

  return (
    <>
      <Naglowek oczko={`Pytanie ${KOLEJNOSC_KREATORA.indexOf(ekran) + 1} z ${KOLEJNOSC_KREATORA.length}`} naWstecz={wroc} />
      <PasekKroku ekran={ekran} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>{pytanie.tresc}</h1>
        <div className="kolumna">
          {pytanie.opcje!.map((o) => (
            <button
              key={String(o.wartosc)}
              className="odpowiedz"
              onClick={() => { zapiszOdpowiedz(pytanie.cecha!, o.wartosc); idzDalej(ekran) }}
            >
              <span className="odpowiedz__znacznik" aria-hidden="true" />
              <span>{o.etykieta}</span>
            </button>
          ))}
        </div>
        {pytanie.mozna_pominac && (
          <div style={{ marginTop: 'auto' }}>
            <Przycisk odmiana="cichy" onClick={() => { zapiszOdpowiedz(pytanie.cecha!, POMINIETE); idzDalej(ekran) }}>
              {t('wspolne.pomin')}
            </Przycisk>
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

/* ================= E0.18 Umowa + ekran przejściowy pakietu umowy ================= */

/**
 * Zmiana 1.2, punkt 5.1. Po wyborze zlecenia albo własnej działalności zatrzymujemy się
 * na jeden panel. To NIE jest osobny ekran mapy — panel wchodzi w miejsce, w którym
 * użytkownik już stoi, żeby nie rozdymać kreatora (E0 zostaje przy 23 ekranach).
 */
export function Umowa() {
  const pytanie = pytanieEkranu('E0.18')!
  const { zapiszOdpowiedz, idzDalej, wroc, nawiguj, zmienStan, chmurka } = useKreator()
  const [pytaOPakiet, ustawPytaOPakiet] = useState(false)

  const [wybrana, ustawWybrana] = useState<string | null>(null)

  const wybierz = (wartosc: unknown) => {
    zapiszOdpowiedz(pytanie.cecha!, wartosc)
    if (wartosc === 'zlecenie' || wartosc === 'dzialalnosc') {
      ustawWybrana(String(wartosc))
      ustawPytaOPakiet(true)
    } else {
      idzDalej('E0.18')
    }
  }

  return (
    <>
      <Naglowek oczko={`Pytanie ${KOLEJNOSC_KREATORA.indexOf('E0.18') + 1} z ${KOLEJNOSC_KREATORA.length}`} naWstecz={wroc} />
      <PasekKroku ekran="E0.18" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>{pytanie.tresc}</h1>
        <div className="kolumna">
          {pytanie.opcje!.map((o) => (
            <button key={String(o.wartosc)} className="odpowiedz" onClick={() => wybierz(o.wartosc)}>
              <span className="odpowiedz__znacznik" aria-hidden="true" />
              <span>{o.etykieta}</span>
            </button>
          ))}
        </div>
        {pytanie.mozna_pominac && (
          <div style={{ marginTop: 'auto' }}>
            <Przycisk odmiana="cichy" onClick={() => { zapiszOdpowiedz(pytanie.cecha!, POMINIETE); idzDalej('E0.18') }}>
              {t('wspolne.pomin')}
            </Przycisk>
          </div>
        )}
      </div>

      {pytaOPakiet && (
        <div className="nakladka" onClick={(e) => { if (e.target === e.currentTarget) ustawPytaOPakiet(false) }}>
          <div className="arkusz" role="dialog" aria-modal="true" aria-label="Sprawdźmy jedną rzecz o Twojej umowie" data-test="pakiet-umowy">
            <div className="uchwyt" />
            <div className="kolumna">
              <h2>Ważne: sprawdźmy jedną rzecz o Twojej umowie</h2>
              <p>
                Sześć pytań pokaże, czy Twoja praca nie ma cech umowy o pracę. Zajmie minutę.
              </p>
              <Przycisk
                onClick={() => {
                  ustawPytaOPakiet(false)
                  idzDalej('E0.18')
                  nawiguj('E2.2', { sytuacja: 'umowa', umowa: wybrana })
                }}
              >
                Sprawdź teraz
              </Przycisk>
              <Przycisk
                odmiana="obrys"
                onClick={() => {
                  // „Później” zostawia ślad: kafel stały w E1.1 i przypomnienie za 3 dni.
                  zmienStan((s) => ({ ...s, umowaOdlozona: true, budziki: { ...s.budziki, powrot_po_pomocy: true } }))
                  chmurka('Przypomnimy za trzy dni. Kafel „Sprawdź swoją umowę” zostaje na ekranie głównym.')
                  ustawPytaOPakiet(false)
                  idzDalej('E0.18')
                }}
              >
                Później
              </Przycisk>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}
export function PrzepisySzczegolne() { return <EkranWyboru ekran="E0.19" /> }
export function Niepelnosprawnosc() { return <EkranWyboru ekran="E0.21" /> }

/* ================= E0.20 Rok urodzenia ================= */

export function RokUrodzenia() {
  const { zapiszOdpowiedz, idzDalej, wroc } = useKreator()
  const rokTeraz = new Date().getFullYear()
  const lata = useMemo(() => {
    const wynik: number[] = []
    for (let r = rokTeraz - 18; r >= rokTeraz - 80; r--) wynik.push(r)
    return wynik
  }, [rokTeraz])

  return (
    <>
      <Naglowek oczko={`Pytanie ${KOLEJNOSC_KREATORA.indexOf('E0.20') + 1} z ${KOLEJNOSC_KREATORA.length}`} naWstecz={wroc} />
      <PasekKroku ekran="E0.20" />
      <div className="kolumna" style={{ flex: 1, paddingTop: 12, minHeight: 0 }}>
        <h1>W którym roku się urodziłeś(-aś)?</h1>
        <p className="opis">Pytamy tylko dlatego, że część uprawnień zależy od wieku.</p>
        <div
          className="kolumna kolumna--ciasna"
          style={{ overflowY: 'auto', maxHeight: '48dvh', paddingRight: 4 }}
          role="group"
          aria-label="Lista lat urodzenia"
        >
          {lata.map((rok) => (
            <button
              key={rok}
              className="odpowiedz"
              style={{ justifyContent: 'center', minHeight: 52, fontSize: '1.25rem' }}
              onClick={() => { zapiszOdpowiedz('rocznik', rok); idzDalej('E0.20') }}
            >
              {rok}
            </button>
          ))}
        </div>
        <Przycisk odmiana="cichy" onClick={() => { zapiszOdpowiedz('rocznik', null); idzDalej('E0.20') }}>
          {t('wspolne.pomin')}
        </Przycisk>
      </div>
      <div style={{ position: 'absolute', top: 14, right: 16 }}><PrzerwijKreator /></div>
    </>
  )
}

/* ================= Budowa profilu ze szkicu ================= */

export function zbudujProfil(odpowiedzi: Record<string, unknown>): Profil {
  const profil = pustyProfil()
  const cechy: (keyof OdpowiedziCech)[] = [
    'monitor', 'dzwiganie', 'teren', 'pojazd', 'kontakt', 'glos', 'chemia',
    'biologia', 'halas', 'temperatura', 'urazowe', 'odziez', 'samotnie',
  ]
  for (const cecha of cechy) {
    if (cecha in odpowiedzi) (profil.odpowiedzi as any)[cecha] = odpowiedzi[cecha]
  }

  const grafik = odpowiedzi['grafik'] as Grafik | undefined
  if (grafik && Object.keys(grafik.kalendarz).length > 0) {
    profil.grafik = { ...grafik, rytm: 'zmiany' }
    profil.odpowiedzi.zmiany = trybZGrafiku(grafik) ?? POMINIETE
  } else if (odpowiedzi['tryb_pracy'] === 'stale') {
    // Zmiana 1.2, punkt 7: stałe godziny to pełnoprawny grafik (E5.3a), nie brak grafiku.
    // Silnik budzików i ewidencja liczą z niego tak samo jak z kalendarza zmian.
    profil.odpowiedzi.zmiany = 'stale'
    profil.grafik = { ...pustyGrafik(), rytm: 'stale', stale: domyslneStaleGodziny() }
  } else if (odpowiedzi['tryb_pracy'] === 'zmiany') {
    // Deklaracja zmian bez grafiku: nie wiemy o nockach — wartość bezpieczna.
    profil.odpowiedzi.zmiany = POMINIETE
  }

  if ('umowa' in odpowiedzi) profil.umowa = odpowiedzi['umowa'] as Profil['umowa']
  if ('status' in odpowiedzi && odpowiedzi['status'] !== POMINIETE) profil.status = odpowiedzi['status'] as Profil['status']
  if ('rocznik' in odpowiedzi) profil.rocznik = (odpowiedzi['rocznik'] as number | null) ?? null
  if ('niepelnosprawnosc' in odpowiedzi && odpowiedzi['niepelnosprawnosc'] !== POMINIETE) {
    profil.niepelnosprawnosc = odpowiedzi['niepelnosprawnosc'] as Profil['niepelnosprawnosc']
  }
  return profil
}

function odmianaUprawnien(n: number): string {
  if (n === 1) return 'uprawnienie'
  const dziesiatki = n % 100
  const jednosci = n % 10
  if (jednosci >= 2 && jednosci <= 4 && !(dziesiatki >= 12 && dziesiatki <= 14)) return 'uprawnienia'
  return 'uprawnień'
}

/* ================= E0.22 Wynik ================= */

export function WynikKreatora() {
  const { stan, zmienStan, nawiguj, dzis } = useAplikacja()
  const szkic = stan.przerwanyKreator ?? { nr: 0, odpowiedzi: {} }
  const profil = useMemo(() => zbudujProfil(szkic.odpowiedzi), [szkic.odpowiedzi])
  const kafle = useMemo(() => policzUprawnienia(profil, dzis), [profil, dzis])
  const pewne = kafle.filter((k) => !k.niepewne).length

  return (
    <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 24 }}>
      <div style={{ textAlign: 'center' }} className="kolumna kolumna--ciasna">
        <p className="oczko">Gotowe</p>
        <p className="wielka-liczba" style={{ animation: 'odsloniecie .4s ease both' }}>{kafle.length}</p>
        <h1>Na Twoim stanowisku przysługuje Ci {kafle.length} {odmianaUprawnien(kafle.length)}</h1>
        {pewne !== kafle.length && (
          <p className="drobne">
            {pewne} {pewne === 1 ? 'jest pewne' : 'z nich są pewne'}. Reszta zależy od pytań, które pominięto —
            oznaczyliśmy je przerywaną ramką.
          </p>
        )}
      </div>

      <ul className="lista-czysta">
        {kafle.map((k, i) => (
          <li key={k.id} style={{ animation: 'odsloniecie .45s ease both', animationDelay: `${0.15 + i * 0.09}s` }}>
            <div className={`kafel${k.niepewne ? ' kafel--niepewny' : ''}`}>
              <span className="kafel__ikona"><Ikona nazwa={k.niepewne ? 'wykrzyknik' : 'ptaszek'} /></span>
              <span className="kafel__tresc">
                <b>{k.tytul}</b>
                <span className="kafel__konkret" style={{ display: 'block' }}>{k.konkret}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Przycisk
        wielki
        onClick={() => {
          zmienStan((s) => ({ ...s, profil, przerwanyKreator: null }))
          nawiguj('E0.23')
        }}
      >
        {t('kreator.wynik_dalej')}
      </Przycisk>
    </div>
  )
}

/* ================= E0.23 Nazwa profilu ================= */

export function NazwaProfilu() {
  const { stan, zmienStan, wrocDoZakladki } = useAplikacja()
  const [nazwa, ustawNazwe] = useState('')

  const zakoncz = (etykieta: string | null) => {
    zmienStan((s) => ({ ...s, profil: s.profil ? { ...s.profil, etykieta } : s.profil }))
    wrocDoZakladki('E1.1')
  }

  return (
    <>
      <Naglowek oczko="Ostatni krok" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 12 }}>
        <h1>{t('kreator.nazwa_naglowek')}</h1>
        <p className="opis">{t('kreator.nazwa_opis')}</p>
        <label>
          <span className="oczko">Nazwa profilu</span>
          <input
            type="text" value={nazwa} onChange={(e) => ustawNazwe(e.target.value)}
            style={polaStyl} placeholder="np. Oddział wewnętrzny" maxLength={40}
          />
        </label>
        <div className="kolumna" style={{ marginTop: 'auto' }}>
          <Przycisk onClick={() => zakoncz(nazwa.trim() || null)}>Zapisz i przejdź dalej</Przycisk>
          <Przycisk odmiana="cichy" onClick={() => zakoncz(null)}>{t('kreator.nazwa_pominiecie')}</Przycisk>
        </div>
      </div>
    </>
  )
}
