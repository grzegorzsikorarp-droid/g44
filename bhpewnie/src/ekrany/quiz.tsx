import { useState } from 'react'
import { useAplikacja } from '../App'
import { Ikona, Naglowek, Przycisk } from '../komponenty/podstawowe'
import { t } from '../dane/wczytaj'
import quiz from '../../content/quiz.json'

interface PytanieQuizu {
  id: string
  pytanie: string
  opcje: { tekst: string; trafna: boolean }[]
  wyjasnienie: string
  material: string | null
}

const PYTANIA = (quiz as any).pytania as PytanieQuizu[]

/* ================= E6.1 Pytanie sprawdzianu ================= */

export function PytanieSprawdzianu({ dane }: { dane: Record<string, unknown> }) {
  const { nawiguj, wroc, zastapWidok } = useAplikacja()
  const nr = (dane.nr as number) ?? 0
  const trafne = (dane.trafne as number) ?? 0
  const pytanie = PYTANIA[nr]
  const [wybrana, ustawWybrana] = useState<number | null>(null)

  if (!pytanie) return null
  const odpowiedziano = wybrana !== null

  return (
    <>
      <Naglowek naWstecz={wroc} oczko={`${t('quiz.naglowek')} · pytanie ${nr + 1} z ${PYTANIA.length}`} />
      <div className="postep" role="progressbar" aria-valuemin={1} aria-valuemax={PYTANIA.length} aria-valuenow={nr + 1}>
        <span className="postep__wypelnienie" style={{ width: `${((nr + 1) / PYTANIA.length) * 100}%` }} />
      </div>

      <div className="kolumna kolumna--luzna" style={{ flex: 1, paddingTop: 16 }}>
        <h1>{pytanie.pytanie}</h1>

        <div className="kolumna">
          {pytanie.opcje.map((o, i) => {
            const pokazStan = odpowiedziano && (i === wybrana || o.trafna)
            return (
              <button
                key={i}
                className="odpowiedz"
                aria-pressed={wybrana === i}
                disabled={odpowiedziano}
                onClick={() => ustawWybrana(i)}
                style={pokazStan ? {
                  borderColor: o.trafna ? 'var(--zielony)' : 'var(--linia-mocna)',
                  background: o.trafna ? 'var(--zielony-tlo)' : 'var(--szary-stan-tlo)',
                } : undefined}
              >
                <span className="odpowiedz__znacznik" aria-hidden="true">
                  {pokazStan && o.trafna && <Ikona nazwa="ptaszek" rozmiar={16} />}
                </span>
                <span>{o.tekst}</span>
              </button>
            )
          })}
        </div>

        {odpowiedziano && (
          <>
            <div className="blok-ile">
              <p className="oczko">Dlaczego</p>
              <p style={{ marginTop: 6 }}>{pytanie.wyjasnienie}</p>
            </div>
            <Przycisk
              onClick={() => {
                const nowe = trafne + (pytanie.opcje[wybrana!].trafna ? 1 : 0)
                if (nr + 1 < PYTANIA.length) zastapWidok('E6.1', { nr: nr + 1, trafne: nowe })
                else zastapWidok('E6.2', { trafne: nowe })
              }}
            >
              {nr + 1 < PYTANIA.length ? 'Następne pytanie' : 'Zobacz wynik'}
            </Przycisk>
          </>
        )}
      </div>
    </>
  )
}

/* ================= E6.2 Wynik sprawdzianu ================= */

export function WynikSprawdzianu({ dane }: { dane: Record<string, unknown> }) {
  const { nawiguj, wrocDoZakladki, zastapWidok } = useAplikacja()
  const trafne = (dane.trafne as number) ?? 0

  return (
    <>
      <Naglowek oczko={t('quiz.naglowek')} />
      <div className="kolumna kolumna--luzna" style={{ flex: 1, justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p className="wielka-liczba">{trafne}<span style={{ fontSize: '1.5rem', color: 'var(--atrament-wtorny)' }}> z {PYTANIA.length}</span></p>
          <h1>{t('quiz.wynik').replace('{trafne}', String(trafne)).replace('{ile}', String(PYTANIA.length))}</h1>
          <p className="opis">{t('quiz.opis')}</p>
        </div>

        <div className="blok-ile">
          <p className="oczko">Co dalej</p>
          <p style={{ marginTop: 6 }}>
            Nie zapisujemy tego wyniku i nikomu go nie pokazujemy. Jeśli coś okazało się zaskoczeniem,
            zajrzyj do materiałów w bibliotece.
          </p>
        </div>

        <Przycisk odmiana="drugi" ikona="ksiazka" onClick={() => nawiguj('E4.11')}>{t('quiz.do_materialu')}</Przycisk>
        <Przycisk odmiana="obrys" onClick={() => zastapWidok('E6.1', { nr: 0, trafne: 0 })}>Zacznij od nowa</Przycisk>
        <Przycisk odmiana="cichy" onClick={() => wrocDoZakladki('E1.1')}>Wróć na ekran główny</Przycisk>
      </div>
    </>
  )
}
