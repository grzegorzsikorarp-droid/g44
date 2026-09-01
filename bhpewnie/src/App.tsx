import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import './style/globalne.css'
import { EKRANY, wpisEkranu } from './rejestr-ekranow'
import { Chmurka, Ikona } from './komponenty/podstawowe'
import {
  czyTrybPrzykladu, maWlasnyProfil, sprzatnijPrzerwane, wczytaj, wgrajPrzyklad,
  wlaczTrybPrzykladu, wyczyscPrzyklad, wylaczTrybPrzykladu, zapisz, type StanAplikacji,
} from './magazyn/magazyn'
import { t } from './dane/wczytaj'
import { dzisIso } from './silnik/parametry'
import { EKRANY_KOMPONENTY } from './ekrany/spis'

export interface Widok { id: string; dane?: Record<string, unknown> }

interface KontekstAplikacji {
  stan: StanAplikacji
  zmienStan: (przeksztalc: (s: StanAplikacji) => StanAplikacji) => void
  widok: Widok
  nawiguj: (id: string, dane?: Record<string, unknown>) => void
  zastapWidok: (id: string, dane?: Record<string, unknown>) => void
  wroc: () => void
  wrocDoZakladki: (id: string) => void
  chmurka: (tresc: string) => void
  przyklad: boolean
  uruchomPrzyklad: () => void
  wyjdzZPrzykladu: () => void
  /** Dzisiejsza data — z uwzględnieniem daty symulowanej z ekranu deweloperskiego. */
  dzis: string
}

const Kontekst = createContext<KontekstAplikacji | null>(null)

export function useAplikacja(): KontekstAplikacji {
  const k = useContext(Kontekst)
  if (!k) throw new Error('Brak kontekstu aplikacji')
  return k
}

const ZAKLADKI: { id: string; ekran: string; napis: string; ikona: string; pomoc?: boolean }[] = [
  { id: 'stanowisko', ekran: 'E1.1', napis: t('nawigacja.stanowisko'), ikona: 'kask' },
  { id: 'sprawdz', ekran: 'E2.1', napis: t('nawigacja.sprawdz'), ikona: 'lupa' },
  { id: 'aktualnosci', ekran: 'E3.1', napis: t('nawigacja.aktualnosci'), ikona: 'gazeta' },
  { id: 'pomoc', ekran: 'E4.1', napis: t('nawigacja.pomoc'), ikona: 'ratunek', pomoc: true },
]

const EKRANY_ZAKLADEK: Record<string, string> = {
  E1: 'stanowisko', E2: 'sprawdz', E3: 'aktualnosci', E4: 'pomoc', E5: 'stanowisko', E6: 'stanowisko',
}

export default function App() {
  const [stan, ustawStan] = useState<StanAplikacji>(() => sprzatnijPrzerwane(wczytaj()))
  const [stos, ustawStos] = useState<Widok[]>(() => [{ id: wczytaj().profil ? 'E1.1' : 'E0.1' }])
  const [komunikat, ustawKomunikat] = useState<string | null>(null)
  const [przyklad, ustawPrzyklad] = useState(false)

  const widok = stos[stos.length - 1]

  const zmienStan = useCallback((przeksztalc: (s: StanAplikacji) => StanAplikacji) => {
    ustawStan((poprzedni) => {
      const nowy = przeksztalc(poprzedni)
      zapisz(nowy)
      return nowy
    })
  }, [])

  const nawiguj = useCallback((id: string, dane?: Record<string, unknown>) => {
    ustawStos((s) => [...s, { id, dane }])
  }, [])

  const zastapWidok = useCallback((id: string, dane?: Record<string, unknown>) => {
    ustawStos((s) => [...s.slice(0, -1), { id, dane }])
  }, [])

  const wroc = useCallback(() => {
    ustawStos((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const wrocDoZakladki = useCallback((id: string) => {
    ustawStos([{ id }])
  }, [])

  const chmurka = useCallback((tresc: string) => ustawKomunikat(tresc), [])

  const uruchomPrzyklad = useCallback(() => {
    wgrajPrzyklad(new Date())
    wlaczTrybPrzykladu()
    ustawPrzyklad(true)
    ustawStan(sprzatnijPrzerwane(wczytaj()))
    ustawStos([{ id: 'E1.1' }])
  }, [])

  const wyjdzZPrzykladu = useCallback(() => {
    wyczyscPrzyklad()
    wylaczTrybPrzykladu()
    ustawPrzyklad(false)
    const wlasny = wczytaj()
    ustawStan(sprzatnijPrzerwane(wlasny))
    ustawStos([{ id: wlasny.profil ? 'E1.1' : 'E0.1' }])
  }, [])

  // B5 i B11: przy każdym uruchomieniu porównujemy strefę czasową i wersję systemu.
  useEffect(() => {
    const strefa = Intl.DateTimeFormat().resolvedOptions().timeZone
    const wersjaSystemu = navigator.userAgent
    zmienStan((s) => {
      const zmianaStrefy = s.strefa !== null && s.strefa !== strefa
      if (zmianaStrefy) {
        ustawKomunikat('Zmieniła się strefa czasowa. Przeliczyliśmy godziny przypomnień.')
      }
      return { ...s, strefa, wersjaSystemu }
    })
  }, [zmienStan])

  const dzis = stan.dataSymulowana ?? dzisIso()

  const wartosc = useMemo<KontekstAplikacji>(() => ({
    stan, zmienStan, widok, nawiguj, zastapWidok, wroc, wrocDoZakladki, chmurka,
    przyklad, uruchomPrzyklad, wyjdzZPrzykladu, dzis,
  }), [stan, zmienStan, widok, nawiguj, zastapWidok, wroc, wrocDoZakladki, chmurka,
      przyklad, uruchomPrzyklad, wyjdzZPrzykladu, dzis])

  const wpis = wpisEkranu(widok.id)
  const Komponent = EKRANY_KOMPONENTY[widok.id]
  const aktywnaZakladka = wpis ? EKRANY_ZAKLADEK[wpis.grupa] : null

  return (
    <Kontekst.Provider value={wartosc}>
      <div className="aplikacja">
        {przyklad && (
          <div className="pas pas--przyklad">
            <Ikona nazwa="osoba" rozmiar={20} />
            <button
              onClick={wyjdzZPrzykladu}
              style={{ flex: 1, textAlign: 'left', font: 'inherit', fontWeight: 700 }}
            >
              {t('przyklad.pasek')}
            </button>
          </div>
        )}

        <main className="ekran" key={widok.id} id="tresc-glowna">
          {Komponent ? <Komponent dane={widok.dane ?? {}} /> : <BrakEkranu id={widok.id} />}
        </main>

        {wpis?.belka && (
          <nav className="belka" aria-label="Główne działy aplikacji">
            {ZAKLADKI.map((z) => (
              <button
                key={z.id}
                className={`belka__zakladka${z.pomoc ? ' belka__zakladka--pomoc' : ''}`}
                aria-current={aktywnaZakladka === z.id ? 'page' : undefined}
                onClick={() => wrocDoZakladki(z.ekran)}
              >
                <Ikona nazwa={z.ikona} rozmiar={26} />
                <span>{z.napis}</span>
              </button>
            ))}
          </nav>
        )}

        {komunikat && <Chmurka tresc={komunikat} naZniknieciu={() => ustawKomunikat(null)} />}
      </div>
    </Kontekst.Provider>
  )
}

function BrakEkranu({ id }: { id: string }) {
  const { wrocDoZakladki } = useAplikacja()
  return (
    <div className="kolumna" style={{ paddingTop: 40 }}>
      <h1>Tego ekranu jeszcze nie ma</h1>
      <p className="opis">Ekran „{id}” jest w rejestrze, ale nie ma jeszcze widoku. To błąd prototypu.</p>
      <button className="przycisk przycisk--glowny" onClick={() => wrocDoZakladki('E1.1')}>
        Wróć na ekran główny
      </button>
    </div>
  )
}

export { EKRANY, maWlasnyProfil, czyTrybPrzykladu }
export type { ReactNode }
