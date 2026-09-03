import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Logotyp, Naglowek, Przelacznik, Przycisk, ZnakFZZ } from '../komponenty/podstawowe'
import { t } from '../dane/wczytaj'
import { policzLuki, policzUprawnienia, rozwiazProfil, warunekSpelniony } from '../silnik/reguly'
import {
  DEFINICJE_BUDZIKOW, czestotliwoscBudzika, nastepnePrzypomnienie, opiszKiedy, wyliczHarmonogram,
} from '../silnik/harmonogram'
import { DNI_SKROTY, dodajDni, domyslneStaleGodziny, iso, nalozWzorzec, pomalujDzien, poczatekTygodnia, pustyGrafik, trybZGrafiku, WZORCE_ROTACJI } from '../silnik/grafik'
import { pustyProfil } from '../magazyn/magazyn'
import { datePoPolsku, dzisIso, STAN_PRAWNY } from '../silnik/parametry'
import { pytaniaKreatora } from '../dane/wczytaj'
import { opisStanowiska } from './stanowisko'
import type { Czestotliwosc, Grafik, IdBudzika, Profil, StaleGodziny } from '../typy'
import biblioteka from '../../content/biblioteka.json'

/* ================= E5.1 Menu ustawień ================= */

export function MenuUstawien() {
  const { stan, nawiguj, wroc, przyklad, wyjdzZPrzykladu } = useAplikacja()
  const pozycje = [
    { ekran: 'E5.2', ikona: 'osoba', napis: t('ustawienia.profil'), opis: 'zmień pojedynczą odpowiedź' },
    { ekran: 'E7.1', ikona: 'zegar', napis: t('stanowisko.czas_pracy'), opis: 'ewidencja godzin — tylko w tym telefonie' },
    { ekran: ekranGrafiku(stan.profil), ikona: 'kalendarz', napis: t('ustawienia.grafik'), opis: 'godziny, z których liczymy przypomnienia' },
    { ekran: 'E5.4', ikona: 'dzwonek', napis: t('ustawienia.budziki'), opis: 'co i kiedy ma się odezwać' },
    { ekran: 'E5.5', ikona: 'ksiazka', napis: t('ustawienia.materialy'), opis: 'co masz pobrane na telefon' },
    { ekran: 'E6.1', ikona: 'lupa', napis: t('quiz.naglowek'), opis: 'sprawdź się — bez punktów i rankingów' },
    { ekran: 'E5.6', ikona: 'tarcza', napis: t('ustawienia.o_aplikacji'), opis: 'kto ją zrobił i co z Twoimi danymi' },
    { ekran: 'E5.7', ikona: 'mowa', napis: t('ustawienia.uwaga'), opis: 'napisz nam, co poprawić' },
  ]
  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('ustawienia.naglowek')} />
      <div className="kolumna" style={{ flex: 1 }}>
        {pozycje.map((p) => (
          <button key={p.ekran} className="kafel kafel--swobodny" onClick={() => nawiguj(p.ekran)}>
            <span className="kafel__ikona"><Ikona nazwa={p.ikona} /></span>
            <span className="kafel__tresc">
              <b style={{ fontSize: '1.0625rem' }}>{p.napis}</b>
              <span className="drobne" style={{ display: 'block' }}>{p.opis}</span>
            </span>
            <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
          </button>
        ))}

        {przyklad && (
          <Przycisk odmiana="obrys" onClick={wyjdzZPrzykladu}>Wyjdź z przykładu i ustaw własną aplikację</Przycisk>
        )}
        <Przycisk odmiana="cichy" onClick={() => nawiguj('DEV')}>Ekran roboczy zespołu</Przycisk>
      </div>
    </>
  )
}

/* ================= E5.2 Mój profil ================= */

export function MojProfil() {
  const { stan, zmienStan, wroc, nawiguj, chmurka, dzis } = useAplikacja()
  const profil = stan.profil
  const pytania = useMemo(() => pytaniaKreatora(), [])

  if (!profil) {
    return (
      <>
        <Naglowek naWstecz={wroc} tytul={t('ustawienia.profil')} />
        <div className="kolumna" style={{ flex: 1 }}>
          <p className="opis">Nie masz jeszcze profilu. Odpowiedz na kilkanaście prostych pytań, a policzymy Twoje uprawnienia.</p>
          <Przycisk onClick={() => nawiguj('E0.2')}>Ustaw swoją aplikację</Przycisk>
        </div>
      </>
    )
  }

  const przedKafle = policzUprawnienia(profil, dzis)

  const zmienOdpowiedz = (cecha: string, wartosc: unknown) => {
    zmienStan((s) => {
      if (!s.profil) return s
      const nowy = { ...s.profil, odpowiedzi: { ...s.profil.odpowiedzi, [cecha]: wartosc } as any }
      const po = policzUprawnienia(nowy, dzis)
      const przybylo = po.filter((k) => !przedKafle.some((x) => x.id === k.id)).length
      const ubylo = przedKafle.filter((k) => !po.some((x) => x.id === k.id)).length
      const czesci: string[] = []
      if (przybylo) czesci.push(`Przybyły ${przybylo} uprawnienia.`)
      if (ubylo) czesci.push(`Ubyło ${ubylo}.`)
      if (czesci.length === 0) czesci.push('Lista uprawnień się nie zmieniła.')
      chmurka(t('ustawienia.przeliczono').replace('{zmiany}', czesci.join(' ')))
      return { ...s, profil: nowy }
    })
  }

  const zmienModyfikator = (pole: string, wartosc: unknown) => {
    zmienStan((s) => {
      if (!s.profil) return s
      const nowy = { ...s.profil, [pole]: wartosc } as typeof s.profil
      const po = policzUprawnienia(nowy!, dzis)
      const przybylo = po.filter((k) => !przedKafle.some((x) => x.id === k.id)).length
      const ubylo = przedKafle.filter((k) => !po.some((x) => x.id === k.id)).length
      const wylaczone = ubylo > 0 ? ' Przypomnienia, które przestały mieć zastosowanie, wyłączyliśmy.' : ''
      chmurka(
        t('ustawienia.przeliczono').replace(
          '{zmiany}',
          `Przybyły ${przybylo} uprawnienia, ubyło ${ubylo}.${wylaczone}`,
        ),
      )
      return { ...s, profil: nowy }
    })
  }

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('ustawienia.profil')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Twoje warunki pracy</p>
          <b style={{ fontSize: '1.0625rem' }}>{profil.etykieta ?? 'Bez nazwy'}</b>
          <p className="opis">{opisStanowiska(profil, dzis)}</p>
        </div>

        <p className="oczko">Pojedyncze odpowiedzi</p>
        {pytania.filter((p) => p.typ === 'tak_nie' && p.cecha).map((p) => {
          const wartosc = (profil.odpowiedzi as any)[p.cecha!]
          const maDopytanie = Boolean(p.dopytanie)
          const wlaczona = maDopytanie ? wartosc !== 'brak' && wartosc !== false : wartosc === true
          return (
            <div key={p.id} className="kolumna kolumna--ciasna">
              <Przelacznik
                nazwa={p.tresc}
                opis={wartosc === 'pominiete' ? 'pytanie pominięte — pokazujemy więcej' : maDopytanie ? `wybrano: ${String(wartosc)}` : ''}
                wlaczony={wlaczona}
                onZmiana={() => zmienOdpowiedz(p.cecha!, wlaczona ? (maDopytanie ? 'brak' : false) : (maDopytanie ? (p.dopytanie!.opcje[p.dopytanie!.opcje.length - 1].wartosc as string) : true))}
              />
            </div>
          )
        })}

        <p className="oczko" style={{ marginTop: 8 }}>Umowa</p>
        <div className="kolumna kolumna--ciasna">
          {[['o_prace', 'Umowa o pracę'], ['zlecenie', 'Umowa zlecenia'], ['dzialalnosc', 'Własna działalność']].map(([w, e]) => (
            <button key={w} className="odpowiedz" aria-pressed={profil.umowa === w} onClick={() => zmienModyfikator('umowa', w)}>
              <span className="odpowiedz__znacznik" aria-hidden="true" />
              <span>{e}</span>
            </button>
          ))}
        </div>

        <Przycisk odmiana="obrys" onClick={() => nawiguj('E0.2')}>Przejdź wszystkie pytania od nowa</Przycisk>
      </div>
    </>
  )
}

/* ================= E5.3 Mój grafik ================= */

/**
 * Zmiana 1.2, punkt 7: grafik na dwóch poziomach.
 * E5.3a — stałe godziny, E5.3b — zmiany. Do którego trafiasz, decyduje rytm w profilu.
 * Kalendarza zmian NIE KASUJEMY przy przejściu na stałe godziny — można wrócić.
 */
export function ekranGrafiku(profil: Profil | null): string {
  return profil?.grafik?.rytm === 'stale' || profil?.odpowiedzi.zmiany === 'stale' ? 'E5.3a' : 'E5.3b'
}

/* ================= E5.3a Mój grafik — stałe godziny ================= */

export function GrafikStaleGodziny() {
  const { stan, zmienStan, wroc, nawiguj, chmurka } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const [stale, ustawStale] = useState<StaleGodziny>(
    profil.grafik?.stale ?? domyslneStaleGodziny(),
  )
  const [nowaData, ustawNowaData] = useState('')

  const maBudziki = Object.values(stan.budziki).some(Boolean)

  const zapisz = (nowe: StaleGodziny) => {
    ustawStale(nowe)
    zmienStan((s) => ({
      ...s,
      profil: s.profil
        ? {
          ...s.profil,
          // Kalendarz zmian zostaje nietknięty — to jest ta gwarancja z punktu 11.
          grafik: { ...(s.profil.grafik ?? pustyGrafik()), rytm: 'stale', stale: nowe },
          odpowiedzi: { ...s.profil.odpowiedzi, zmiany: 'stale' },
        }
        : s.profil,
    }))
    if (maBudziki) chmurka('Przeliczyliśmy przypomnienia z nowych godzin.')
  }

  const przelaczDzien = (nr: number) => {
    const dni = stale.dni.includes(nr) ? stale.dni.filter((d) => d !== nr) : [...stale.dni, nr].sort()
    zapisz({ ...stale, dni })
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Stałe godziny" tytul={t('ustawienia.grafik')} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        <p className="opis">
          Podaj godziny, w których zwykle pracujesz. Z nich liczymy przerwy w trakcie zmiany
          i porównujemy plan z ewidencją.
        </p>

        <div className="rzad">
          <label className="kolumna kolumna--ciasna" style={{ flex: 1 }}>
            <span className="oczko">Od</span>
            <input className="pole" type="time" value={stale.od} onChange={(e) => zapisz({ ...stale, od: e.target.value })} />
          </label>
          <label className="kolumna kolumna--ciasna" style={{ flex: 1 }}>
            <span className="oczko">Do</span>
            <input className="pole" type="time" value={stale.do} onChange={(e) => zapisz({ ...stale, do: e.target.value })} />
          </label>
        </div>

        <div className="kolumna kolumna--ciasna">
          <p className="oczko">Dni tygodnia</p>
          <div className="rzad" role="group" aria-label="Dni tygodnia, w które pracujesz">
            {DNI_SKROTY.map((skrot, i) => {
              const nr = i + 1
              const wlaczony = stale.dni.includes(nr)
              return (
                <button
                  key={skrot}
                  className="odpowiedz"
                  aria-pressed={wlaczony}
                  style={{ justifyContent: 'center', minWidth: 48, minHeight: 48, flex: '1 0 auto' }}
                  onClick={() => przelaczDzien(nr)}
                >
                  {skrot}
                </button>
              )
            })}
          </div>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Odstępstwa</p>
          {Object.keys(stale.odstepstwa).length === 0 && (
            <p className="drobne">Brak. Dopisz dzień, w którym pracowałeś(-aś) inaczej albo miałeś(-aś) wolne.</p>
          )}
          {Object.entries(stale.odstepstwa).map(([data, wartosc]) => (
            <div key={data} className="rzad" style={{ justifyContent: 'space-between' }}>
              <span>
                <b>{datePoPolsku(data)}</b>{' '}
                <span className="drobne">{wartosc === 'wolne' ? 'wolne' : `${wartosc.od}–${wartosc.do}`}</span>
              </span>
              <Przycisk
                odmiana="obrys" ikona="minus"
                opisDlaCzytnika={`Usuń odstępstwo ${data}`}
                onClick={() => {
                  const bez = { ...stale.odstepstwa }
                  delete bez[data]
                  zapisz({ ...stale, odstepstwa: bez })
                }}
              >
                Usuń
              </Przycisk>
            </div>
          ))}
          <div className="rzad">
            <input
              className="pole" type="date" value={nowaData} aria-label="Data odstępstwa"
              onChange={(e) => ustawNowaData(e.target.value)}
            />
            <Przycisk
              odmiana="obrys"
              wylaczony={!nowaData}
              onClick={() => {
                zapisz({ ...stale, odstepstwa: { ...stale.odstepstwa, [nowaData]: 'wolne' } })
                ustawNowaData('')
              }}
            >
              Dodaj jako wolne
            </Przycisk>
          </div>
        </div>

        <Przycisk odmiana="obrys" ikona="kalendarz" onClick={() => nawiguj('E5.3b')}>
          Pracuję na zmiany — przejdź do kalendarza
        </Przycisk>

        <p className="drobne">
          Z tych godzin liczymy przerwy w trakcie zmiany. Nie musisz podawać żadnych godzin
          przypomnień — wyliczymy je sami.
        </p>
      </div>
    </>
  )
}

/* ================= E5.3b Mój grafik — zmiany ================= */

export function MojGrafik() {
  const { stan, zmienStan, wroc, nawiguj, chmurka } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const [grafik, ustawGrafik] = useState<Grafik>(profil.grafik ?? pustyGrafik())
  const [pedzel, ustawPedzel] = useState('D')
  const dzisiaj = new Date()
  const poczatek = poczatekTygodnia(dzisiaj)
  const pusty = Object.keys(grafik.kalendarz).length === 0

  const zapisz = (nowy: Grafik) => {
    const zRytmem: Grafik = { ...nowy, rytm: 'zmiany' }
    ustawGrafik(zRytmem)
    zmienStan((s) => ({
      ...s,
      profil: s.profil
        ? { ...s.profil, grafik: zRytmem, odpowiedzi: { ...s.profil.odpowiedzi, zmiany: trybZGrafiku(zRytmem) ?? s.profil.odpowiedzi.zmiany } }
        : s.profil,
    }))
  }

  const maBudziki = Object.values(stan.budziki).some(Boolean)

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Zmiany" tytul={t('ustawienia.grafik')} />
      <div className="kolumna" style={{ flex: 1 }}>
        {/* Przy przejściu ze stałych godzin na zmiany kalendarz startuje pusty — podpowiadamy wzorce. */}
        {pusty && (
          <div className="pas pas--spokojny">
            <Ikona nazwa="kalendarz" rozmiar={22} />
            <p>
              Kalendarz jest pusty. Najszybciej wypełnisz go wzorcem rotacji poniżej,
              a potem poprawisz pojedyncze dni dotknięciem.
            </p>
          </div>
        )}

        <div className="rzad">
          {grafik.szablony.map((s) => (
            <button key={s.skrot} className="odpowiedz" aria-pressed={pedzel === s.skrot}
                    style={{ justifyContent: 'center', minHeight: 56 }} onClick={() => ustawPedzel(s.skrot)}>
              {s.skrot} — {s.nazwa}
            </button>
          ))}
        </div>

        <div className="rzad" style={{ flexWrap: 'wrap' }}>
          {WZORCE_ROTACJI.map((w) => (
            <Przycisk key={w.id} odmiana="obrys" onClick={() => {
              zapisz(nalozWzorzec(grafik, poczatek, w.id, 28))
              if (maBudziki) chmurka('Przeliczyliśmy przypomnienia z nowego grafiku.')
            }}>
              {w.nazwa}
            </Przycisk>
          ))}
        </div>

        <div className="kolumna kolumna--ciasna">
          <div className="siatka-dni" aria-hidden="true">
            {DNI_SKROTY.map((d) => <span key={d} className="drobne" style={{ textAlign: 'center' }}>{d}</span>)}
          </div>
          {[0, 1, 2, 3].map((tydzien) => (
            <div className="siatka-dni" key={tydzien}>
              {DNI_SKROTY.map((_, i) => {
                const data = dodajDni(poczatek, tydzien * 7 + i)
                const dzien = iso(data)
                const skrot = grafik.kalendarz[dzien]
                const szablon = grafik.szablony.find((s) => s.skrot === skrot)
                const klasa = szablon ? (szablon.nocna ? ' dzien-grafiku--nocna' : ' dzien-grafiku--dzienna') : ''
                return (
                  <button key={dzien} className={`dzien-grafiku${klasa}${iso(dzisiaj) === dzien ? ' dzien-grafiku--dzis' : ''}`}
                          aria-label={`${data.getDate()} — ${szablon ? szablon.nazwa : 'wolne'}`}
                          onClick={() => {
                            zapisz(pomalujDzien(grafik, dzien, pedzel))
                            if (maBudziki) chmurka('Przeliczyliśmy przypomnienia z nowego grafiku.')
                          }}>
                    <small>{data.getDate()}</small>
                    <span>{skrot ?? '—'}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <Przycisk odmiana="obrys" ikona="zegar" onClick={() => nawiguj('E5.3a')}>
          Pracuję w stałych godzinach
        </Przycisk>

        <p className="drobne">
          Z grafiku liczymy protokół przed nocką, ciszę po nocce i przerwy w trakcie zmiany.
          Nie musisz podawać żadnych godzin przypomnień — wyliczymy je sami.
        </p>
      </div>
    </>
  )
}

/* ================= E5.4 Moje budziki ================= */

const NAZWY_GRUP: Record<string, string> = {
  rytm: 'W rytmie zmiany',
  terminy: 'Terminy',
  otoczenie: 'Otoczenie',
  aktualnosci: 'Aktualności',
}

export function MojeBudziki() {
  const { stan, zmienStan, wroc, dzis } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const rozwiazany = useMemo(() => rozwiazProfil(profil, dzis), [profil, dzis])
  const [zgoda, ustawZgode] = useState<'nieznana' | 'udzielona' | 'odmowa'>(
    typeof Notification !== 'undefined'
      ? (Notification.permission === 'granted' ? 'udzielona' : Notification.permission === 'denied' ? 'odmowa' : 'nieznana')
      : 'odmowa',
  )

  const harmonogram = useMemo(
    () => wyliczHarmonogram({
      profil,
      wlaczone: stan.budziki,
      czestotliwosci: stan.czestotliwosci,
      powrotPoPomocy: stan.budziki.powrot_po_pomocy ? 'ścieżka Pomocy' : null,
    }, new Date()),
    [profil, stan.budziki, stan.czestotliwosci],
  )
  const nastepne = nastepnePrzypomnienie(harmonogram, new Date())

  const widoczne = DEFINICJE_BUDZIKOW.filter(
    (d) => !d.widoczny_gdy || warunekSpelniony(d.widoczny_gdy, rozwiazany),
  )

  const przelacz = (id: IdBudzika) => {
    zmienStan((s) => ({ ...s, budziki: { ...s.budziki, [id]: !s.budziki[id] } }))
  }

  const ustawCzestotliwosc = (id: IdBudzika, c: Czestotliwosc) => {
    zmienStan((s) => ({ ...s, czestotliwosci: { ...s.czestotliwosci, [id]: c } }))
  }

  const popros = async () => {
    if (typeof Notification === 'undefined') return ustawZgode('odmowa')
    const wynik = await Notification.requestPermission()
    ustawZgode(wynik === 'granted' ? 'udzielona' : 'odmowa')
    zmienStan((s) => ({ ...s, ostatniaProsbaOZgode: new Date().toISOString() }))
  }

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('budziki.naglowek')} />
      <div className="kolumna" style={{ flex: 1 }}>
        {/* B3: odmowa zgody nie zmienia przełączników — pokazujemy pasek z drogą wyjścia. */}
        {zgoda === 'odmowa' && (
          <div className="pas">
            <Ikona nazwa="dzwonek" rozmiar={22} />
            <div className="kolumna kolumna--ciasna">
              <p>{t('budziki.brak_zgody')}</p>
              <Przycisk odmiana="obrys" onClick={popros}>{t('budziki.brak_zgody_przycisk')}</Przycisk>
            </div>
          </div>
        )}
        {zgoda === 'nieznana' && (
          <Przycisk odmiana="drugi" ikona="dzwonek" onClick={popros}>Pozwól aplikacji się odezwać</Przycisk>
        )}

        {nastepne && (
          <div className="blok-ile">
            <p className="oczko">{t('budziki.nastepne')}</p>
            <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--morski-ciemny)', marginTop: 4 }}>
              {nastepne.nazwa} — {opiszKiedy(nastepne.kiedy, new Date())}
            </p>
            <p className="drobne">{nastepne.powod}</p>
          </div>
        )}

        {(['rytm', 'terminy', 'otoczenie', 'aktualnosci'] as const).map((grupa) => (
          <section key={grupa} className="kolumna kolumna--ciasna">
            <p className="oczko">{NAZWY_GRUP[grupa]}</p>
            {widoczne.filter((d) => d.grupa === grupa).map((d) => {
              const wlaczony = d.automatyczny ? true : Boolean(stan.budziki[d.id])
              const wybor = d.czestotliwosc
              const teraz = czestotliwoscBudzika(d.id, stan.czestotliwosci)
              return (
                <div key={d.id}>
                  <Przelacznik
                    nazwa={d.nazwa}
                    opis={d.regula}
                    wlaczony={wlaczony}
                    wylaczony={d.automatyczny}
                    plakietka={d.automatyczny ? t('budziki.auto') : undefined}
                    onZmiana={() => przelacz(d.id)}
                  />
                  {/*
                    ZMIANA 1.3, sekcja 1.4 — tor częstotliwości. Pokazujemy go tylko przy
                    budziku WŁĄCZONYM: wybór częstotliwości dla czegoś, co milczy, jest
                    ustawieniem bez skutku, a lista budzików urosłaby o pusty tor przy
                    każdej pozycji (ROZBIEZNOSCI.md, wpis 34).
                  */}
                  {wybor?.wybieralna && wlaczony && (
                    <div className="wybor-czestotliwosci">
                      <div className="tor-segmentow" role="group" aria-label={`Jak często: ${d.nazwa}`}>
                        {(['raz_dziennie', 'zawsze'] as const).map((c) => (
                          <button
                            key={c}
                            className="tor-segmentow__segment"
                            aria-pressed={teraz === c}
                            onClick={() => ustawCzestotliwosc(d.id, c)}
                          >
                            {c === 'raz_dziennie' ? 'raz dziennie' : 'za każdym razem'}
                          </button>
                        ))}
                      </div>
                      <p className="drobne">
                        {teraz === 'raz_dziennie' ? wybor.opis_raz : wybor.opis_zawsze}
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </section>
        ))}

        <details className="podstawa">
          <summary>
            <Ikona nazwa="zegar" rozmiar={22} />
            <span style={{ flex: 1 }}>{t('budziki.harmonogram')}</span>
            <Ikona nazwa="dalej" rozmiar={20} />
          </summary>
          <div className="podstawa__wnetrze">
            <p className="drobne">{t('budziki.sufit')}</p>
            <ul style={{ margin: '10px 0 0 18px' }}>
              {harmonogram.slice(0, 14).map((p, i) => (
                <li key={i}>
                  <b>{opiszKiedy(p.kiedy, new Date())}</b> — {p.nazwa}
                </li>
              ))}
            </ul>
            {harmonogram.length === 0 && <p className="drobne">Nic nie jest jeszcze zaplanowane — włącz budzik albo ustaw grafik.</p>}
          </div>
        </details>

        {/* B4: dokładne alarmy na Androidzie. */}
        <div className="pas">
          <Ikona nazwa="zegar" rozmiar={22} />
          <p>{t('budziki.niedokladne')}</p>
        </div>

        <p className="drobne">{t('budziki.opis')}</p>
      </div>
    </>
  )
}

/* ================= E5.5 Pobrane materiały ================= */

export function PobraneMaterialy() {
  const { stan, zmienStan, wroc, chmurka } = useAplikacja()
  const materialy = (biblioteka as any).materialy as { id: string; tytul: string; rozmiar_mb: number }[]
  const pobrane = materialy.filter((m) => stan.pobraneMaterialy.includes(m.id))
  const zajete = pobrane.reduce((suma, m) => suma + m.rozmiar_mb, 0)

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('ustawienia.materialy')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="blok-ile">
          <p className="oczko">Zajęte miejsce</p>
          <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--morski-ciemny)' }}>{zajete.toFixed(1)} MB</p>
        </div>

        {pobrane.length === 0 ? (
          <p className="opis">Nie masz jeszcze pobranych materiałów. Możesz je pobrać w bibliotece, w zakładce Pomoc.</p>
        ) : (
          pobrane.map((m) => (
            <div key={m.id} className="karta rzad">
              <span style={{ flex: 1 }}><b>{m.tytul}</b><br /><span className="drobne">{m.rozmiar_mb} MB</span></span>
              <Przycisk odmiana="obrys" onClick={() => {
                zmienStan((s) => ({ ...s, pobraneMaterialy: s.pobraneMaterialy.filter((x) => x !== m.id) }))
                chmurka('Usunęliśmy materiał z telefonu.')
              }}>Usuń</Przycisk>
            </div>
          ))
        )}
      </div>
    </>
  )
}

/* ================= E5.6 O aplikacji ================= */

export function OAplikacji() {
  const { wroc } = useAplikacja()
  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('ustawienia.o_aplikacji')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Co robimy z Twoimi danymi</p>
          <p><b>Nic.</b> Aplikacja nie ma kont ani logowania, nie zbiera statystyk i niczego nie wysyła.</p>
          <p>Wszystko, co tu ustawisz — profil, grafik, dziennik zdarzeń — zostaje w pamięci tego urządzenia.</p>
          <p className="drobne">
            Z internetu pobieramy wyłącznie dwie rzeczy: strumień aktualności i materiały biblioteki.
            Reszta działa offline.
          </p>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Dostępność</p>
          <p>Pismo od 16 pikseli, powiększenie do 200%, cele dotykowe od 48 pikseli, tryb ciemny, obsługa czytnikiem ekranu.</p>
          <p className="drobne">Deklaracja dostępności: [do uzupełnienia przez specjalistę]</p>
        </div>

        {/* Blok nadawcy — jedyne miejsce w aplikacji, gdzie występuje czerwień znaku FZZ. */}
        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Kto za tym stoi</p>
          <div className="blok-nadawcy">
            <ZnakFZZ rozmiar={48} />
            <span>
              <b style={{ display: 'block' }}>{t('nadawca.kto')}</b>
              <span className="drobne">{t('nadawca.projekt')}</span>
            </span>
          </div>
          <p className="drobne">Projekt finansowany ze środków Funduszy Europejskich.</p>
          <p className="drobne">Sygnatariusze i oznaczenia FE: [do uzupełnienia przez specjalistę]</p>
          <p className="drobne">Regulamin: [do uzupełnienia przez specjalistę]</p>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Wersja</p>
          <Logotyp rozmiar={24} />
          <p className="drobne">Prototyp roboczy 0.1 · stan prawny treści: {STAN_PRAWNY}</p>
          <p className="drobne">
            Wszystkie treści prawne mają charakter roboczy i wymagają autoryzacji specjalistów przed publikacją.
          </p>
        </div>
      </div>
    </>
  )
}

/* ================= E5.7 Zgłoś uwagę ================= */

export function ZglosUwage() {
  const { wroc, chmurka } = useAplikacja()
  const [tresc, ustawTresc] = useState('')

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('ustawienia.uwaga')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <p className="opis">
          Napisz, co było niejasne albo co nie zadziałało. Wiadomość otworzy się w Twoim programie pocztowym —
          aplikacja niczego nie wysyła sama.
        </p>
        <textarea
          value={tresc} onChange={(e) => ustawTresc(e.target.value)} rows={6}
          placeholder="Na przykład: nie wiedziałem, co znaczy „ekwiwalent”."
          style={{
            width: '100%', minHeight: 140, padding: '12px', fontSize: '1rem', fontFamily: 'inherit',
            borderRadius: 12, border: '1.5px solid var(--linia-mocna)', background: 'var(--papier)', color: 'var(--atrament)',
          }}
        />
        <Przycisk
          ikona="mowa"
          onClick={() => {
            const adres = `mailto:?subject=${encodeURIComponent('BHPewnie — uwaga do prototypu')}&body=${encodeURIComponent(tresc)}`
            window.location.href = adres
            chmurka('Otwieramy Twój program pocztowy.')
          }}
        >
          Napisz do nas
        </Przycisk>
        <p className="drobne">Adres odbiorcy: [do uzupełnienia przez specjalistę]</p>
      </div>
    </>
  )
}

/* ================= Ekran roboczy zespołu (B9) ================= */

export function EkranDeweloperski() {
  const { stan, zmienStan, wroc, dzis } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const luki = policzLuki(profil, dzis)
  const kafle = policzUprawnienia(profil, dzis)

  return (
    <>
      <Naglowek naWstecz={wroc} tytul="Ekran roboczy zespołu" />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="pas">
          <Ikona nazwa="wykrzyknik" rozmiar={22} />
          <p>Ten ekran nie należy do mapy aplikacji. Służy zespołowi projektowemu do testów prototypu.</p>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Licznik luk treściowych (B9)</p>
          <p style={{ fontSize: '2rem', fontWeight: 800, color: luki > 0 ? 'var(--bursztyn-tekst)' : 'var(--morski-ciemny)' }}>{luki}</p>
          <p className="drobne">Cechy aktywne w profilu, dla których nie mamy jeszcze żadnego kafla. Liczba zostaje lokalnie.</p>
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Kafle w tym profilu</p>
          <p><b>{kafle.length}</b> łącznie, w tym <b>{kafle.filter((k) => k.niepewne).length}</b> niepewnych
            i <b>{kafle.filter((k) => k.wygasly).length}</b> z wygasłym parametrem.</p>
        </div>

        {/* Dowód działania zasady 9 bez czekania na kalendarz. */}
        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Data symulowana (test zasady 9)</p>
          <p className="drobne">
            Ustaw datę po wygaśnięciu parametru (np. 2027-04-02), żeby zobaczyć komunikat zastępczy zamiast starej kwoty.
          </p>
          <input
            type="date"
            value={stan.dataSymulowana ?? dzisIso()}
            onChange={(e) => zmienStan((s) => ({ ...s, dataSymulowana: e.target.value }))}
            style={{ minHeight: 48, fontSize: '1rem', padding: '8px 10px', borderRadius: 10, border: '1.5px solid var(--linia-mocna)', background: 'var(--papier)', color: 'var(--atrament)' }}
          />
          {stan.dataSymulowana && (
            <Przycisk odmiana="obrys" onClick={() => zmienStan((s) => ({ ...s, dataSymulowana: null }))}>
              Wróć do dzisiejszej daty
            </Przycisk>
          )}
        </div>

        <div className="karta kolumna kolumna--ciasna">
          <p className="oczko">Sufit powiadomień — usunięty w zmianie 1.2</p>
          <p className="drobne">
            Pomiar na prototypie 1.1 pokazał, że sufit trzech na dobę odrzucał 41% przypomnień, o które
            użytkownik świadomie prosił. Zostaje sam przełącznik przy każdym budziku.
          </p>
        </div>
      </div>
    </>
  )
}
