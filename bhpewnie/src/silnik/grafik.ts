import type { Grafik, SzablonZmiany } from '../typy'

export const DNI_SKROTY = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd']

export const SZABLONY_DOMYSLNE: SzablonZmiany[] = [
  { skrot: 'D', nazwa: 'Dniówka', od: '07:00', do: '19:00', kolor: '#0e6e62', nocna: false },
  { skrot: 'N', nazwa: 'Nocka', od: '19:00', do: '07:00', kolor: '#233b4a', nocna: true },
]

/** Wzorce rotacji jako przyspieszacz maowania kalendarza (sekcja 4.4). */
export const WZORCE_ROTACJI: { id: string; nazwa: string; opis: string; wzorzec: string[] }[] = [
  { id: 'dwa-dwa-trzy', nazwa: '2-2-3', opis: 'Dwie dniówki, dwie nocki, trzy dni wolne', wzorzec: ['D', 'D', 'N', 'N', '', '', ''] },
  { id: 'dzien-noc-wolne', nazwa: 'D / N / wolne', opis: 'Dniówka, nocka, dwa dni wolne', wzorzec: ['D', 'N', '', ''] },
  { id: 'same-dniowki', nazwa: 'Same dniówki', opis: 'Od poniedziałku do piątku', wzorzec: ['D', 'D', 'D', 'D', 'D', '', ''] },
]

export function pustyGrafik(): Grafik {
  return { szablony: [...SZABLONY_DOMYSLNE], kalendarz: {}, snoPoNocce: { opoznienieMin: 30, dlugoscH: 7 } }
}

export function iso(data: Date): string {
  return data.toISOString().slice(0, 10)
}

export function dodajDni(data: Date, dni: number): Date {
  return new Date(data.getTime() + dni * 86400000)
}

/** Poniedziałek tygodnia, w którym wypada podana data. */
export function poczatekTygodnia(data: Date): Date {
  const dzienTygodnia = (data.getDay() + 6) % 7
  const poniedzialek = dodajDni(data, -dzienTygodnia)
  return new Date(Date.UTC(poniedzialek.getFullYear(), poniedzialek.getMonth(), poniedzialek.getDate()))
}

export function szablonDnia(grafik: Grafik | null, dzien: string): SzablonZmiany | null {
  if (!grafik) return null
  const skrot = grafik.kalendarz[dzien]
  if (!skrot) return null
  return grafik.szablony.find((s) => s.skrot === skrot) ?? null
}

/** Czy w grafiku jest choć jedna zmiana nocna — od tego zależy cecha 'zmiany_noce'. */
export function maNocki(grafik: Grafik | null): boolean {
  if (!grafik) return false
  const nocne = new Set(grafik.szablony.filter((s) => s.nocna).map((s) => s.skrot))
  return Object.values(grafik.kalendarz).some((skrot) => nocne.has(skrot))
}

/** Cecha 'zmiany' wyliczana z grafiku, a nie pytana wprost. */
export function trybZGrafiku(grafik: Grafik | null): 'stale' | 'zmiany' | 'zmiany_noce' | null {
  if (!grafik || Object.keys(grafik.kalendarz).length === 0) return null
  if (maNocki(grafik)) return 'zmiany_noce'
  const skroty = new Set(Object.values(grafik.kalendarz))
  return skroty.size > 1 ? 'zmiany' : 'stale'
}

/** Malowanie kalendarza dotknięciem: ten sam szablon drugi raz = kasowanie dnia. */
export function pomalujDzien(grafik: Grafik, dzien: string, skrot: string): Grafik {
  const kalendarz = { ...grafik.kalendarz }
  if (kalendarz[dzien] === skrot) delete kalendarz[dzien]
  else kalendarz[dzien] = skrot
  return { ...grafik, kalendarz }
}

/** Nałożenie wzorca rotacji od wskazanego dnia na podaną liczbę dni. */
export function nalozWzorzec(grafik: Grafik, odDnia: Date, idWzorca: string, dni = 28): Grafik {
  const wzorzec = WZORCE_ROTACJI.find((w) => w.id === idWzorca)
  if (!wzorzec) return grafik
  const kalendarz = { ...grafik.kalendarz }
  for (let i = 0; i < dni; i++) {
    const dzien = iso(dodajDni(odDnia, i))
    const skrot = wzorzec.wzorzec[i % wzorzec.wzorzec.length]
    if (skrot) kalendarz[dzien] = skrot
    else delete kalendarz[dzien]
  }
  return { ...grafik, kalendarz }
}

export function polaczDateIGodzine(dzien: string, godzina: string): Date {
  const [g, m] = godzina.split(':').map(Number)
  const d = new Date(dzien + 'T00:00:00')
  d.setHours(g, m, 0, 0)
  return d
}

/** Początek i koniec zmiany; nocka kończy się nazajutrz. */
export function ramyZmiany(dzien: string, szablon: SzablonZmiany): { start: Date; koniec: Date } {
  const start = polaczDateIGodzine(dzien, szablon.od)
  let koniec = polaczDateIGodzine(dzien, szablon.do)
  if (koniec <= start) koniec = new Date(koniec.getTime() + 86400000)
  return { start, koniec }
}

/**
 * Okno snu po nocce (sekcja 4.4): od końca zmiany N + opóźnienie, przez zadaną liczbę godzin.
 * Liczone automatycznie z grafiku — użytkownik nie ustawia tu żadnej godziny.
 */
export function oknoSnuPoNocce(grafik: Grafik, dzien: string): { od: Date; do: Date } | null {
  const szablon = szablonDnia(grafik, dzien)
  if (!szablon || !szablon.nocna) return null
  const { koniec } = ramyZmiany(dzien, szablon)
  const od = new Date(koniec.getTime() + grafik.snoPoNocce.opoznienieMin * 60000)
  return { od, do: new Date(od.getTime() + grafik.snoPoNocce.dlugoscH * 3600000) }
}
