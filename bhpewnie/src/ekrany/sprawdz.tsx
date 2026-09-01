import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, PlanszaPelnejWersji, PodstawaPrawna, Przycisk } from '../komponenty/podstawowe'
import { t, sytuacja as znajdzSytuacje } from '../dane/wczytaj'
import { doSprawdzenia, ocen, sytuacjeWKolejnosci, werdyktBezPytan } from '../silnik/sprawdzacz'
import { STAN_PRAWNY } from '../silnik/parametry'
import { rozwiazProfil } from '../silnik/reguly'
import { pustyProfil } from '../magazyn/magazyn'
import type { Werdykt } from '../typy'

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
              <button className="kafel" onClick={() => nawiguj('E2.2', { sytuacja: s.id })}>
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
  const { stan, wroc, zastapWidok, dzis } = useAplikacja()
  const id = dane.sytuacja as string
  const sytuacja = znajdzSytuacje(id)
  const profil = stan.profil ?? pustyProfil()
  const umowa = rozwiazProfil(profil, dzis).umowa

  const [nr, ustawNr] = useState(0)
  const [odpowiedzi, ustawOdpowiedzi] = useState<Record<string, string>>({})
  const [pytaOWyjscie, ustawPytaOWyjscie] = useState(false)

  if (!sytuacja) return null

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

  const pytania = sytuacja.pytania ?? []
  const pytanie = pytania[nr]

  const odpowiedz = (wartosc: string) => {
    const nowe = { ...odpowiedzi, [pytanie.id]: wartosc }
    ustawOdpowiedzi(nowe)
    if (nr + 1 < pytania.length) {
      ustawNr(nr + 1)
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
          {pytanie.opcje.map((o) => (
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
  const { nawiguj, wrocDoZakladki, dzis } = useAplikacja()
  const werdykt = dane.werdykt as Werdykt | null
  const idSytuacji = dane.sytuacja as string
  const sytuacja = znajdzSytuacje(idSytuacji)

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

        {/* Reguła nienegocjowalna: karta „nie przysługuje” zawsze kończy się tym blokiem.
            Aplikacja nie zostawia użytkownika z samą odmową. */}
        {(werdykt.pokrewne || werdykt.stan === 'nie_przysluguje') && (
          <div className="blok-zamiast kolumna kolumna--ciasna">
            <p className="oczko" style={{ color: 'var(--pewnosc-nacisk)' }}>
              {werdykt.stan === 'nie_przysluguje' ? t('wynik.zamiast') : t('wynik.pokrewne')}
            </p>
            {werdykt.pokrewne ? (
              <button
                className="kafel"
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
              <button className="kafel" onClick={() => wrocDoZakladki('E1.1')}>
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

        <PodstawaPrawna tresc={werdykt.podstawa} stanPrawny={STAN_PRAWNY} />

        {/* Trzy stałe akcje — ZAWSZE w tej kolejności (zasada 7). */}
        <div className="kolumna">
          <Przycisk ikona="dokument" onClick={() => nawiguj('E2.5', { werdykt })}>{t('wynik.pdf')}</Przycisk>
          <Przycisk odmiana="drugi" ikona="mowa" onClick={() => nawiguj('E2.6', { werdykt })}>{t('wynik.skrypt')}</Przycisk>
          <Przycisk odmiana="obrys" ikona="dzwonek" onClick={() => nawiguj('E2.7', { werdykt, sytuacja: idSytuacji })}>{t('wynik.przypomnij')}</Przycisk>
        </div>

        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
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
          Aplikacja ma sufit trzech przypomnień na dobę. Jeśli tego dnia będzie ich więcej, pokażemy, które odłożyliśmy.
        </p>
      </div>
    </>
  )
}
