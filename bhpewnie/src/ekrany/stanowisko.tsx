import { useMemo, useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Kafel, Naglowek, PodstawaPrawna, Przycisk, ZnakWerdyktu } from '../komponenty/podstawowe'
import { policzLuki, policzUprawnienia, rozwiazProfil } from '../silnik/reguly'
import { STAN_PRAWNY, datePoPolsku, parametr } from '../silnik/parametry'
import { opiszCzas, otwartyWpis, podsumuj, wpisyDnia, wpisyOd, zakresTygodnia } from '../silnik/ewidencja'
import { t } from '../dane/wczytaj'
import { pustyProfil } from '../magazyn/magazyn'
import type { KafelUprawnienia, Profil, StanKafla } from '../typy'
import { AKTUALNOSCI_WBUDOWANE } from './aktualnosci'
import { pismoZKafla, skryptZKafla } from '../silnik/dokumenty-uprawnien'

/**
 * Konkret kafla albo plakietka — nigdy oba naraz (design 1.2, §8.1).
 * Stan „zapytamy” nie pokazuje liczby, bo jej jeszcze nie zna; w jej miejscu
 * staje plakietka ze słowem. Znacznik świeżości jest osobną osią i dokłada się
 * do każdego z czterech stanów, nie podmieniając znaku werdyktu.
 */
function PlakietkaKafla({ kafel }: { kafel: KafelUprawnienia }) {
  if (kafel.stan === 'zapytamy') {
    return (
      <span className="znacznik znacznik--sprawdz">
        <Ikona nazwa="lupa" rozmiar={16} />
        {t('kafel.sprawdz_warunek')}
      </span>
    )
  }
  if (kafel.swiezosc === 'do_odswiezenia') {
    return (
      <span className="znacznik znacznik--odswiez">
        <Ikona nazwa="strzalka_w_kolo" rozmiar={16} />
        {t('kafel.do_odswiezenia')}
      </span>
    )
  }
  return null
}

const IKONY_CECH: Record<string, string> = {
  powszechne: 'tarcza', status: 'odznaka', monitor: 'monitor', dzwiganie: 'ciezar',
  zmiany: 'ksiezyc', odziez: 'ubranie', temperatura: 'slonce', teren: 'drzewo',
  biologia: 'igla', chemia: 'chemia', halas: 'ucho', urazowe: 'wykrzyknik',
  kontakt: 'dlon', glos: 'mowa', pojazd: 'kierownica', samotnie: 'samotnie',
}

export function opisStanowiska(profil: Profil, dzis: string): string {
  const r = rozwiazProfil(profil, dzis)
  const czesci: string[] = []
  const rytm = profil.odpowiedzi.zmiany
  if (rytm === 'zmiany_noce') czesci.push('zmiany z nockami')
  else if (rytm === 'zmiany') czesci.push('zmiany')
  else if (rytm === 'stale') czesci.push('stałe godziny')
  const umowy: Record<string, string> = { o_prace: 'umowa o pracę', zlecenie: 'zlecenie', dzialalnosc: 'własna działalność' }
  czesci.push(umowy[r.umowa])
  if (r.wiek !== null && r.wiek >= 50) czesci.push('50+')
  return czesci.join(' · ')
}

/* ================= E1.1 Co mi przysługuje ================= */

export function MojeStanowisko() {
  const { stan, nawiguj, dzis, przyklad } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const bezProfilu = stan.profil === null

  const kafle = useMemo(
    () => policzUprawnienia(profil, dzis, stan.odpowiedziWarunkow),
    [profil, dzis, stan.odpowiedziWarunkow],
  )
  const luki = useMemo(() => policzLuki(profil, dzis), [profil, dzis])
  const [rozwiniete, ustawRozwiniete] = useState(false)
  const aktualnosc = AKTUALNOSCI_WBUDOWANE[0]

  // Kafel stały „Mój czas pracy” (punkt 3.4) — liczony z ewidencji, nie z grafiku.
  const czasPracy = useMemo(() => {
    const dzisiejsze = wpisyDnia(stan.ewidencja, dzis)
    const tydzien = zakresTygodnia(dzis)
    const wTygodniu = wpisyOd(stan.ewidencja, tydzien.od, tydzien.do)
    if (stan.ewidencja.length === 0) return null
    return {
      dzis: podsumuj(dzisiejsze, profil.grafik).fakt_min,
      tydzien: podsumuj(wTygodniu, profil.grafik).fakt_min,
      trwa: otwartyWpis(stan.ewidencja) !== null,
    }
  }, [stan.ewidencja, dzis, profil.grafik])

  // Panel sezonowy — w prototypie symulacja pogody (brief 6.2). Lokalizacji NIE pobieramy;
  // miejscowość wpisuje użytkownik. Próg bierzemy z parametrów, a nie z liczby w kodzie:
  // 28 °C dotyczy każdego pomieszczenia, więc panel nie jest zawężony do jednej cechy.
  const TEMPERATURA_SYMULOWANA = 30
  const progPomieszczenie = parametr('napoje_prog_pomieszczenie', dzis)
  const progOtwarta = parametr('napoje_prog_otwarta', dzis)
  const przekroczonyProg =
    (progPomieszczenie.stan === 'aktualny' && TEMPERATURA_SYMULOWANA >= Number(progPomieszczenie.wartosc)) ||
    (profil.odpowiedzi.teren === true && progOtwarta.stan === 'aktualny' && TEMPERATURA_SYMULOWANA >= Number(progOtwarta.wartosc))
  // Symulacja tylko w sezonie: „Dziś 30 °C” w styczniu podważałoby wiarygodność aplikacji,
  // a poza sezonem panel zabierał 126 px sprzed przycisku „Pobierz kartę”.
  const miesiac = Number(dzis.slice(5, 7))
  const sezonUpalu = miesiac >= 5 && miesiac <= 9
  const pokazUpal = !bezProfilu && przekroczonyProg && sezonUpalu

  const naZleceniu = profil.umowa === 'zlecenie' || profil.umowa === 'dzialalnosc'

  return (
    <div className="ekran--warstwowy" style={{ display: 'contents' }}>
      {/*
        WARSTWA 1 — nagłówek stały (design 1.2, §8.2). Nie kurczy się i nie przewija.
        Kafel profilu, pasek aktualizacji, panel sezonowy i nagłówek listy: 223 px.
      */}
      <div className="warstwa-stala kolumna kolumna--ciasna" style={{ padding: '10px 16px 0' }}>
        <button className="kafel kafel--swobodny" onClick={() => nawiguj('E5.2')} style={{ minHeight: 80 }}>
          <span className="kafel__ikona"><Ikona nazwa="osoba" /></span>
          <span className="kafel__tresc">
            <b style={{ fontSize: '1.0625rem' }}>{profil.etykieta ?? t('stanowisko.naglowek')}</b>
            <span className="drobne" style={{ display: 'block' }}>
              {bezProfilu ? 'Profil jeszcze nieustawiony' : opisStanowiska(profil, dzis)}
            </span>
          </span>
          <span className="kafel__strzalka"><Ikona nazwa="dalej" rozmiar={20} /></span>
        </button>

        {/* Pasek aktualizacji w jednej linijce — 56 px zamiast 98 px. */}
        {!bezProfilu && (
          <button className="pas pas--spokojny pasek-jednolinijkowy" onClick={() => nawiguj('E5.2')}>
            <Ikona nazwa="strzalka_w_kolo" rozmiar={24} />
            <span className="pasek-jednolinijkowy__tekst">{t('stanowisko.aktualizuj')}</span>
            <Ikona nazwa="dalej" rozmiar={20} />
          </button>
        )}

        {bezProfilu && (
          <div className="pas pas--spokojny">
            <Ikona nazwa="wykrzyknik" rozmiar={22} />
            <div className="kolumna kolumna--ciasna">
              <p>{t('stanowisko.bez_profilu')}</p>
              <button onClick={() => nawiguj('E0.2')} className="odnosnik">
                {t('stanowisko.bez_profilu_przycisk')}
              </button>
            </div>
          </div>
        )}

        {/*
          Panel sezonowy zwinięty do jednej linii, 126 → 48 px. Cały jest przyciskiem,
          bo cel dotykowy nie może być mniejszy od reguły. Pełna treść — napoje, przerwy,
          obowiązki pracodawcy — stoi na karcie, do której ten pasek prowadzi.
        */}
        {pokazUpal && (
          <button
            className="pas pasek-jednolinijkowy pasek-sezonowy"
            onClick={() => nawiguj('E2.2', { sytuacja: 'upal' })}
          >
            <Ikona nazwa="slonce" rozmiar={24} />
            <span className="pasek-jednolinijkowy__tekst">
              Dziś {TEMPERATURA_SYMULOWANA} °C — napoje i przerwy
            </span>
            <Ikona nazwa="dalej" rozmiar={20} />
          </button>
        )}

        <div className="rzad" style={{ justifyContent: 'space-between', marginTop: 2 }}>
          <p className="oczko">{t('stanowisko.najwazniejsze')}</p>
          <span className="drobne">{kafle.length} {kafle.length === 1 ? 'uprawnienie' : 'uprawnień'}</span>
        </div>
      </div>

      {/* WARSTWA 2 — pole kafli. Jedyny element, który rośnie i kurczy się. */}
      <div className="warstwa-pole">
        <ul className="lista-czysta">
          {(rozwiniete ? kafle : kafle.slice(0, 3)).map((k) => (
            <li key={k.id}>
              <Kafel
                ikona={k.ikona ?? IKONY_CECH[k.cecha] ?? 'tarcza'}
                tytul={k.tytul}
                konkret={k.stan === 'zapytamy' ? undefined : k.konkret}
                stan={k.stan}
                doOdswiezenia={k.swiezosc === 'do_odswiezenia'}
                onClick={() => nawiguj('E1.2', { kafel: k })}
                znacznik={<PlakietkaKafla kafel={k} />}
              />
            </li>
          ))}
        </ul>

        <div className="kolumna" style={{ paddingTop: 12, paddingBottom: 16 }}>
          {kafle.length > 3 && (
            <Przycisk
              odmiana="obrys"
              ikona={rozwiniete ? 'gora' : 'dalej'}
              onClick={() => ustawRozwiniete(!rozwiniete)}
            >
              {rozwiniete ? 'Pokaż tylko najważniejsze' : t('stanowisko.pokaz_wszystkie').replace('{n}', String(kafle.length))}
            </Przycisk>
          )}

          {/* Kafel stały, poza sortowaniem — ewidencja czasu pracy (punkt 3.4). */}
          <Kafel
            ikona="zegar"
            tytul={t('stanowisko.czas_pracy')}
            konkret={
              czasPracy
                ? `dziś ${opiszCzas(czasPracy.dzis)} · w tym tygodniu ${opiszCzas(czasPracy.tydzien)}`
                : t('stanowisko.czas_pracy_pusty')
            }
            znacznik={czasPracy?.trwa
              ? <span className="znacznik znacznik--spokojny">dzień otwarty</span>
              : undefined}
            onClick={() => nawiguj('E7.1')}
          />

          {/* Pakiet umowy odłożony na później (punkt 5.1) — kafel stały do powrotu. */}
          {naZleceniu && stan.umowaOdlozona && (
            <Kafel
              ikona="dokument"
              tytul={t('stanowisko.umowa_kafel')}
              konkret={t('stanowisko.umowa_kafel_konkret')}
              onClick={() => nawiguj('E2.2', { sytuacja: 'umowa' })}
            />
          )}

          {luki > 0 && (
            <div className="pas">
              <Ikona nazwa="wykrzyknik" rozmiar={22} />
              <p>{t('stanowisko.luka')}</p>
            </div>
          )}

          <button className="karta kolumna kolumna--ciasna" style={{ textAlign: 'left' }} onClick={() => nawiguj('E3.2', { id: aktualnosc.id })}>
            <span className="oczko">Ostatnia aktualność</span>
            <b style={{ fontSize: '1.0625rem' }}>{aktualnosc.tytul}</b>
            <span className="drobne">{aktualnosc.zrodlo} · {aktualnosc.data}</span>
          </button>

          <Przycisk odmiana="obrys" ikona="kalendarz" onClick={() => nawiguj('E1.4')}>{t('stanowisko.terminy')}</Przycisk>
          <Przycisk odmiana="obrys" ikona="koło_zebate" onClick={() => nawiguj('E5.1')}>{t('ustawienia.naglowek')}</Przycisk>

          {przyklad && (
            <p className="drobne" style={{ textAlign: 'center' }}>
              Oglądasz przykład. Twój własny profil jest nietknięty — trzymamy go osobno.
            </p>
          )}
        </div>

        <div className="wygaszenie" aria-hidden="true" />
      </div>

      {/*
        WARSTWA 3 — pas akcji z dokumentem. Stały, nad nawigacją.
        To jedyna droga do dokumentu, który użytkownik zaniesie pracodawcy, więc
        nie może zależeć od tego, ile treści jest wyżej (ROZBIEZNOSCI.md, wpis 16).
      */}
      <div className="warstwa-pas">
        <Przycisk odmiana="drugi" ikona="dokument" onClick={() => nawiguj('E1.3')}>
          {t('stanowisko.karta_pdf')}
        </Przycisk>
      </div>
    </div>
  )
}

/* ================= E1.2 Karta uprawnienia z dopytaniem ================= */

const NAGLOWEK_STANU: Record<StanKafla, { napis: string; klasa: string }> = {
  przysluguje: { napis: 'Przysługuje Ci', klasa: 'werdykt--przysluguje' },
  zalezy: { napis: 'To zależy', klasa: 'werdykt--zalezy' },
  nie_przysluguje: { napis: 'Nie przysługuje', klasa: 'werdykt--nie_przysluguje' },
  // Stan nierozstrzygnięty NIE jest werdyktem, więc nie dostaje koloru rodziny.
  zapytamy: { napis: 'Zapytamy o jedno', klasa: 'blok-pytanie__stan' },
}

export function KartaUprawnienia({ dane }: { dane: Record<string, unknown> }) {
  const { wroc, nawiguj, stan, zmienStan, chmurka, dzis } = useAplikacja()
  const przekazany = dane.kafel as KafelUprawnienia | undefined

  // Kafel przeliczamy NA NOWO z bieżącego stanu, nie bierzemy zamrożonej kopii z nawigacji.
  // Dzięki temu odpowiedź na warunek zmienia kartę w miejscu, bez zmiany ekranu.
  const kafel = useMemo(() => {
    if (!przekazany || !stan.profil) return przekazany
    const swiezy = policzUprawnienia(stan.profil, dzis, stan.odpowiedziWarunkow)
      .find((k) => k.id === przekazany.id)
    return swiezy ?? przekazany
  }, [przekazany, stan.profil, stan.odpowiedziWarunkow, dzis])

  const [zmieniaOdpowiedz, ustawZmienia] = useState(false)

  if (!kafel) return null

  const naglowek = NAGLOWEK_STANU[kafel.stan]
  const pytaOWarunek = kafel.warunek && (kafel.stan === 'zapytamy' || zmieniaOdpowiedz)
  const szary = kafel.stan === 'nie_przysluguje'

  const odpowiedzNaWarunek = (nr: number) => {
    zmienStan((s) => ({ ...s, odpowiedziWarunkow: { ...s.odpowiedziWarunkow, [kafel.id]: nr } }))
    ustawZmienia(false)
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko="Uprawnienie" />
      <div className="kolumna kolumna--luzna" style={{ flex: 1 }}>
        {/*
          1. Tytuł i stan. Nierozstrzygnięte NIE wygląda jak rozstrzygnięte:
          komponent werdyktu ma kolor rodziny, znak i zdanie orzekające — trzy rzeczy,
          których stan „zapytamy” nie ma prawa mieć (design 1.2, §8.3).
          Po odpowiedzi ten blok zostaje ZASTĄPIONY werdyktem, nie dołożony obok.
        */}
        <div className={`werdykt ${naglowek.klasa}`}>
          <span className="werdykt__ikona"><ZnakWerdyktu stan={kafel.stan} rozmiar={30} /></span>
          <div>
            <p className="oczko" style={{ color: 'inherit', opacity: 0.85 }}>{naglowek.napis}</p>
            <h1 style={{ color: 'inherit', margin: '2px 0 0' }}>{kafel.tytul}</h1>
            {kafel.stan === 'zapytamy' && (
              <p style={{ color: 'inherit', marginTop: 6 }}>
                Nie wiemy jeszcze, czy Ci przysługuje. Wystarczy jedna odpowiedź.
              </p>
            )}
          </div>
        </div>

        {/* 2. Jedno pytanie, rozstrzygane w miejscu. */}
        {pytaOWarunek && (
          <div className="karta kolumna blok-pytanie" data-test="dopytanie">
            <p className="oczko">{t('kafel.pytanie_oczko')}</p>
            <h2 style={{ margin: 0 }}>{kafel.warunek!.pytanie}</h2>
            <div className="kolumna">
              {kafel.warunek!.odpowiedzi.map((o, i) => (
                <button key={i} className="odpowiedz" onClick={() => odpowiedzNaWarunek(i)}>
                  <span className="odpowiedz__znacznik" aria-hidden="true" />
                  <span>{o.tekst}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 3. Uzasadnienie: z cech profilu, a po rozstrzygnięciu — także z odpowiedzi. */}
        {!pytaOWarunek && (
          <>
            {kafel.odpowiedz && (
              <p style={{ fontSize: '1.0625rem' }}>{kafel.odpowiedz.uzasadnienie}</p>
            )}
            <p>{kafel.wyjasnienie}</p>

            {kafel.swiezosc === 'do_odswiezenia' && (
              <div className="pas">
                <Ikona nazwa="strzalka_w_kolo" rozmiar={22} />
                <div className="kolumna kolumna--ciasna">
                  <p>{t('kafel.niepewny_dopisek')}</p>
                  <button onClick={() => nawiguj('E5.2')} className="odnosnik">
                    {t('kafel.uzupelnij_odpowiedz')}
                  </button>
                </div>
              </div>
            )}

            {/* 4. ILE albo CO konkretnie. */}
            <div className={`blok-ile${kafel.wygasly || szary ? ' blok-ile--szary' : ''}`}>
              <p className="oczko">{t('wynik.ile')}</p>
              <p style={{ fontSize: '1.125rem', fontWeight: 700, marginTop: 6 }}>{kafel.konkret}</p>
            </div>

            {/* Bursztyn: najwyżej dwie rzeczy do sprawdzenia. */}
            {kafel.odpowiedz?.do_sprawdzenia && kafel.odpowiedz.do_sprawdzenia.length > 0 && (
              <div className="pas">
                <Ikona nazwa="lupa" rozmiar={22} />
                <div>
                  <p className="oczko" style={{ color: 'inherit' }}>{t('wynik.do_sprawdzenia')}</p>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {kafel.odpowiedz.do_sprawdzenia.slice(0, 2).map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </div>
              </div>
            )}

            {/* Szary NIGDY nie jest ślepym zaułkiem — blok obowiązkowy. */}
            {szary && kafel.odpowiedz?.zamiast && (
              <div className="blok-zamiast kolumna kolumna--ciasna">
                <p className="oczko" style={{ color: 'var(--pewnosc-nacisk)' }}>{t('wynik.zamiast')}</p>
                <ul style={{ margin: '2px 0 0 18px' }}>
                  {kafel.odpowiedz.zamiast.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}

            {/* 5. Zwijana podstawa prawna z datą stanu prawnego. */}
            <PodstawaPrawna tresc={kafel.podstawa} stanPrawny={kafel.stan_prawny} />

            {/* 6. Trzy stałe akcje, zawsze w tej kolejności (zasada 7). */}
            <div className="kolumna">
              {szary ? (
                <Przycisk ikona="tarcza" onClick={() => nawiguj('E1.1')}>{t('kafel.zamiast_szary')}</Przycisk>
              ) : (
                <Przycisk ikona="dokument" onClick={() => nawiguj('E2.5', { werdykt: { ...pismoZKafla(kafel), pismo: pismoZKafla(kafel), podstawa: kafel.podstawa } })}>
                  {t('wynik.pdf')}
                </Przycisk>
              )}
              <Przycisk
                odmiana="drugi" ikona="mowa"
                onClick={() => nawiguj('E2.6', { werdykt: { skrypt: skryptZKafla(kafel), podstawa: kafel.podstawa } })}
              >
                {t('wynik.skrypt')}
              </Przycisk>
              <Przycisk
                odmiana="obrys" ikona="dzwonek"
                onClick={() => {
                  zmienStan((s) => ({ ...s, budziki: { ...s.budziki, badania_okresowe: true } }))
                  chmurka('Ustawiliśmy przypomnienie. Zobaczysz je w „Moje budziki”.')
                }}
              >
                {t('wynik.przypomnij')}
              </Przycisk>
            </div>

            {/*
              8. Ślad odpowiedzi — 118 → 48 px (design 1.2, §8.3). To nie jest treść,
              do której się wraca, tylko ślad, że coś się wybrało. Zaoszczędzone 70 px
              trafia do trzech akcji, dzięki czemu trzecia mieści się także przy 150%.
            */}
            {kafel.warunek && kafel.odpowiedz && (
              <div className="slad-odpowiedzi">
                <span className="drobne">
                  {t('kafel.twoja_odpowiedz')}: <b>{kafel.odpowiedz.tekst}</b>
                </span>
                <button onClick={() => ustawZmienia(true)} className="odnosnik">Zmień</button>
              </div>
            )}
          </>
        )}

        {/* 7. Stopka. */}
        <p className="stopka-edu">{t('wspolne.edukacyjna')}</p>
      </div>
    </>
  )
}

/* ================= E1.3 Podgląd karty uprawnień PDF ================= */

export function PodgladKartyPdf() {
  const { stan, wroc, dzis, chmurka } = useAplikacja()
  const profil = stan.profil ?? pustyProfil()
  const kafle = useMemo(() => policzUprawnienia(profil, dzis), [profil, dzis])
  const [zapisuje, ustawZapisuje] = useState(false)

  const zapisz = async () => {
    ustawZapisuje(true)
    try {
      // Generator PDF wczytujemy dopiero przy zapisie — nie obciąża pierwszego uruchomienia.
      const { kartaUprawnien, zapiszPlik } = await import('../pdf/dokumenty')
      const blob = await kartaUprawnien({
        opisStanowiska: opisStanowiska(profil, dzis),
        uprawnienia: kafle.map((k) => ({ tytul: k.tytul, konkret: k.konkret, podstawa: k.podstawa, niepewne: k.niepewne })),
      })
      zapiszPlik(blob, 'karta-moich-uprawnien.pdf')
      chmurka('Zapisaliśmy plik na Twoim urządzeniu.')
    } catch {
      chmurka('Nie udało się złożyć dokumentu. Spróbuj jeszcze raz.')
    } finally {
      ustawZapisuje(false)
    }
  }

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={t('pdf.podglad')} tytul="Karta moich uprawnień" />
      <div className="kolumna" style={{ flex: 1 }}>
        <div className="dokument">
          <p style={{ fontSize: '0.8125rem', color: '#555' }}>BHPewnie — Forum Związków Zawodowych</p>
          <h4>Karta moich uprawnień</h4>
          <p style={{ fontSize: '0.8125rem', color: '#555' }}>Stan prawny na {STAN_PRAWNY}.</p>
          <div className="dokument__pole">{t('pdf.imie')}: ……………………………………………</div>
          <p style={{ marginTop: 10 }}><b>Warunki pracy:</b> {opisStanowiska(profil, dzis)}</p>
          <div style={{ marginTop: 12 }}>
            {kafle.map((k) => (
              <div key={k.id} style={{ padding: '7px 0', borderBottom: '1px solid #edefee' }}>
                <b>{k.tytul}</b>{k.niepewne && <i> (zależy od pominiętego pytania)</i>} — {k.konkret}
                <div style={{ color: '#666', fontSize: '0.8125rem' }}>Podstawa: {k.podstawa}</div>
              </div>
            ))}
          </div>
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

/* ================= E1.4 Moje terminy ================= */

export function MojeTerminy() {
  const { stan, zmienStan, wroc, chmurka, dzis } = useAplikacja()
  const profil = stan.profil
  const [edytowany, ustawEdytowany] = useState<string | null>(null)

  if (!profil) {
    return (
      <>
        <Naglowek naWstecz={wroc} tytul={t('stanowisko.terminy')} />
        <p className="opis">Najpierw ustaw swój profil — wtedy będziemy mieli co odliczać.</p>
      </>
    )
  }

  const doDnia = (data: string) => Math.ceil((new Date(data + 'T00:00:00').getTime() - new Date(dzis + 'T00:00:00').getTime()) / 86400000)

  return (
    <>
      <Naglowek naWstecz={wroc} tytul={t('stanowisko.terminy')} />
      <div className="kolumna" style={{ flex: 1 }}>
        <p className="opis">Terminy trzymamy tylko w tym telefonie. Możesz je poprawić, gdy dostaniesz nową datę.</p>

        {profil.terminy.map((termin) => {
          const dni = doDnia(termin.data)
          return (
            <div key={termin.id} className="karta kolumna kolumna--ciasna">
              <div className="rzad">
                <span className="kafel__ikona"><Ikona nazwa="stetoskop" /></span>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: '1.0625rem' }}>{termin.nazwa}</b>
                  <p className="drobne">{datePoPolsku(termin.data)}</p>
                </div>
                <span className={`znacznik ${dni > 30 ? 'znacznik--spokojny' : ''}`}>
                  {dni > 0 ? `za ${dni} dni` : dni === 0 ? 'dziś' : `${-dni} dni po terminie`}
                </span>
              </div>

              {edytowany === termin.id ? (
                <input
                  type="date" defaultValue={termin.data}
                  style={{ minHeight: 48, fontSize: '1rem', padding: '8px 10px', borderRadius: 10, border: '1.5px solid var(--linia-mocna)', background: 'var(--papier)', color: 'var(--atrament)' }}
                  onChange={(e) => {
                    const nowa = e.target.value
                    zmienStan((s) => ({
                      ...s,
                      profil: s.profil ? { ...s.profil, terminy: s.profil.terminy.map((x) => (x.id === termin.id ? { ...x, data: nowa } : x)) } : s.profil,
                    }))
                    ustawEdytowany(null)
                    chmurka('Zmieniliśmy termin. Przypomnienia przeliczyliśmy od nowa.')
                  }}
                />
              ) : (
                <div className="rzad">
                  <Przycisk odmiana="obrys" onClick={() => ustawEdytowany(termin.id)}>Zmień datę</Przycisk>
                  <Przycisk
                    odmiana={termin.przypomnienie ? 'drugi' : 'obrys'}
                    ikona="dzwonek"
                    onClick={() => {
                      zmienStan((s) => ({
                        ...s,
                        profil: s.profil ? { ...s.profil, terminy: s.profil.terminy.map((x) => (x.id === termin.id ? { ...x, przypomnienie: !x.przypomnienie } : x)) } : s.profil,
                        budziki: { ...s.budziki, [termin.id === 'szkolenie' ? 'szkolenie_bhp' : 'badania_okresowe']: !termin.przypomnienie },
                      }))
                      chmurka(termin.przypomnienie ? 'Wyłączyliśmy przypomnienie.' : 'Przypomnimy 30 i 7 dni przed terminem.')
                    }}
                  >
                    {termin.przypomnienie ? 'Przypominamy' : 'Przypomnij mi'}
                  </Przycisk>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
