import { expect, test, type Page } from '@playwright/test'

/**
 * P11 — ewidencja czasu pracy (zmiana 1.2, punkt 6).
 * P12 — wyzwalacz zmiany rytmu (punkt 6.5).
 * B13 — ewidencja bez grafiku.
 *
 * Wpisy testowe wstawiamy do magazynu przed wejściem na ekran: przebieg
 * „Zaczynam → Kończę” trwałby tyle, ile trwa zmiana, a interesuje nas zachowanie
 * aplikacji, nie cierpliwość testu.
 */

const KLUCZ = 'bhpewnie'

interface WpisTestowy {
  data: string
  od: string
  do: string | null
  przerwy?: { od: string; do: string | null }[]
}

/** Wstawia profil i wpisy do pamięci urządzenia zanim aplikacja się uruchomi. */
async function przygotujStan(
  page: Page,
  opcje: { wpisy?: WpisTestowy[]; rytm?: 'stale' | 'zmiany'; status?: string; bezGrafiku?: boolean } = {},
) {
  await page.goto('/')
  await page.evaluate(({ klucz, opcje }) => {
    const teraz = new Date().toISOString()
    const grafik = opcje.bezGrafiku
      ? null
      : opcje.rytm === 'stale'
        ? {
          szablony: [], kalendarz: {}, snoPoNocce: { opoznienieMin: 30, dlugoscH: 7 },
          rytm: 'stale', stale: { od: '08:00', do: '16:00', dni: [1, 2, 3, 4, 5], odstepstwa: {} },
        }
        : {
          szablony: [{ skrot: 'D', nazwa: 'Dniówka', od: '07:00', do: '19:00', kolor: '#0e6e62', nocna: false }],
          kalendarz: {}, snoPoNocce: { opoznienieMin: 30, dlugoscH: 7 }, rytm: 'zmiany',
        }

    const stan = {
      wersja: 1,
      profil: {
        etykieta: 'Testowe stanowisko', ikona: null,
        odpowiedzi: {
          monitor: 'brak', dzwiganie: 'brak', teren: false, zmiany: opcje.rytm === 'stale' ? 'stale' : 'zmiany',
          pojazd: false, kontakt: 'brak', glos: false, chemia: false, biologia: false,
          halas: false, temperatura: false, urazowe: false, odziez: false, samotnie: false,
        },
        umowa: 'o_prace', rocznik: 1985, niepelnosprawnosc: 'brak_odpowiedzi',
        status: opcje.status ?? 'brak', grafik, terminy: [], miejscowosc: null, utworzony: teraz,
      },
      budziki: {}, dziennik: [], przerwane: {}, przerwanyKreator: null,
      wersjaSystemu: null, strefa: null, ostatniaProsbaOZgode: null,
      prasowkaOdswiezona: null, pobraneMaterialy: [], dataSymulowana: null,
      odpowiedziWarunkow: {},
      ewidencja: (opcje.wpisy ?? []).map((w, i) => ({
        id: `t${i}`, data: w.data, od: w.od, do: w.do, przerwy: w.przerwy ?? [],
        uwagi: '', zrodlo: 'reczny', utworzono: teraz, zmieniono: teraz,
      })),
      wyzwalaczRytmu: { ostatnio_pytano: null, wyciszony_do: null },
      umowaOdlozona: false,
    }
    window.localStorage.setItem(klucz, JSON.stringify(stan))
  }, { klucz: KLUCZ, opcje })
  await page.reload()
}

/** ISO dnia przesuniętego o `n` dni od dzisiaj — liczone lokalnie, jak w aplikacji. */
function dzien(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('P11: „Zaczynam” otwiera dzień, „Przerwa” zatrzymuje licznik, „Kończę” zapisuje wpis', async ({ page }) => {
  await przygotujStan(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await expect(page.getByRole('heading', { name: 'Mój czas — dziś' })).toBeVisible()

  await page.getByRole('button', { name: 'Zaczynam pracę' }).click()
  await expect(page.locator('[data-test="licznik"]')).toBeVisible()

  await page.getByRole('button', { name: 'Zaczynam przerwę' }).click()
  await expect(page.getByText(/Przerwa trwa/)).toBeVisible()
  await page.getByRole('button', { name: 'Kończę przerwę' }).click()

  await page.getByRole('button', { name: 'Kończę pracę' }).click()
  await expect(page.getByRole('button', { name: 'Zaczynam pracę' })).toBeVisible()
  await expect(page.getByText('Dzisiejsze wpisy')).toBeVisible()
})

test('P11: wpis ręczny — walidacja blokuje przerwę poza godzinami, ostrzega przy 17 h', async ({ page }) => {
  await przygotujStan(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Dodaj wpis ręcznie' }).click()

  await page.getByLabel('Od', { exact: true }).first().fill('08:00')
  await page.getByLabel('Do', { exact: true }).first().fill('16:00')
  await page.getByRole('button', { name: 'Dodaj przerwę' }).click()
  await page.getByLabel('Od', { exact: true }).nth(1).fill('17:00')
  await page.getByLabel('Do', { exact: true }).nth(1).fill('17:30')

  await page.getByRole('button', { name: 'Zapisz' }).click()
  await expect(page.locator('[data-test="bledy-wpisu"]')).toContainText('wychodzi poza godziny wpisu')

  // Poprawiamy przerwę i wydłużamy dzień ponad 16 h: ostrzeżenie, ale zapis przechodzi.
  await page.getByLabel('Od', { exact: true }).nth(1).fill('12:00')
  await page.getByLabel('Do', { exact: true }).nth(1).fill('12:15')
  await page.getByLabel('Od', { exact: true }).first().fill('06:00')
  await page.getByLabel('Do', { exact: true }).first().fill('23:30')
  await expect(page.locator('[data-test="ostrzezenia-wpisu"]')).toBeVisible()

  await page.getByRole('button', { name: 'Zapisz' }).click()
  await expect(page.getByRole('heading', { name: 'Mój czas — dziś' })).toBeVisible()
  await expect(page.getByText('06:00–23:30')).toBeVisible()
})

test('P11: tydzień pokazuje plan z grafiku i sumy', async ({ page }) => {
  await przygotujStan(page, {
    rytm: 'stale',
    wpisy: [{ data: dzien(0), od: '08:00', do: '18:00', przerwy: [{ od: '12:00', do: '12:15' }] }],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()

  await expect(page.getByRole('heading', { name: 'Tydzień i miesiąc' })).toBeVisible()
  // Design 1.2: na telefonie lista dni, nie tabela. Tabela na życzenie.
  await expect(page.locator('.wiersz-dnia')).toHaveCount(7)
  await expect(page.getByRole('table')).toHaveCount(0)
  await page.getByRole('button', { name: 'Zobacz tabelę' }).click()
  await expect(page.getByRole('table')).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do listy' }).click()

  // Blok sumy: dwie liczby, po które się tu przychodzi.
  await expect(page.getByText('Przepracowane')).toBeVisible()
  await expect(page.getByText('Ponad plan', { exact: true })).toBeVisible()

  // Przełącznik zakresu jest torem segmentów, nie parą przycisków.
  const tor = page.getByRole('group', { name: 'Zakres' })
  await expect(tor.getByRole('button', { name: 'Tydzień' })).toHaveAttribute('aria-pressed', 'true')
  await tor.getByRole('button', { name: 'Miesiąc' }).click()
  await expect(tor.getByRole('button', { name: 'Miesiąc' })).toHaveAttribute('aria-pressed', 'true')
})

test('P11: sygnał odpoczynku poniżej 11 h zostaje wykryty i podaje podstawę', async ({ page }) => {
  await przygotujStan(page, {
    rytm: 'stale',
    wpisy: [
      { data: dzien(-1), od: '06:00', do: '20:00' },
      { data: dzien(0), od: '02:00', do: '10:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await page.getByRole('button', { name: /Sygnały/ }).click()

  await expect(page.getByText(/odpoczynku\. Przysługuje 11 h/)).toBeVisible()
  const karta = page.locator('.karta--sygnal').filter({ hasText: 'Przysługuje 11 h' })
  await karta.getByText('Podstawa prawna').click()
  await expect(karta.getByText('art. 132 Kodeksu pracy')).toBeVisible()
  // Karta sygnału ma tytuł, znak stanu i akcję — nie samą lewą listwę.
  await expect(karta.getByRole('heading', { name: 'Odpoczynek krótszy niż 11 godzin' })).toBeVisible()
  await expect(karta.getByRole('button', { name: /Co mogę z tym zrobić/ })).toBeVisible()
})

test('P11: funkcjonariusz — sygnały kodeksowe wyłączone, godziny ponad plan zostają', async ({ page }) => {
  await przygotujStan(page, {
    status: 'funkcjonariusz',
    rytm: 'stale',
    wpisy: [
      { data: dzien(-1), od: '06:00', do: '20:00' },
      { data: dzien(0), od: '02:00', do: '10:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await page.getByRole('button', { name: /Sygnały/ }).click()

  await expect(page.locator('[data-test="funkcjonariusz-sygnaly"]')).toContainText('pragmatyka Twojej formacji')
  await expect(page.getByText(/Przysługuje 11 h/)).toHaveCount(0)
})

test('P11: eksport miesiąca ma puste pole imienia, stopkę i pas oznaczeń', async ({ page }) => {
  await przygotujStan(page, { rytm: 'stale', wpisy: [{ data: dzien(0), od: '08:00', do: '16:00' }] })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await page.getByRole('button', { name: /Eksport miesiąca/ }).click()

  await expect(page.getByRole('heading', { name: 'Eksport ewidencji' })).toBeVisible()
  // Miniatura A4: puste pole imienia, stopka i pas oznaczeń.
  const miniatura = page.locator('.miniatura-a4')
  await expect(miniatura).toBeVisible()
  await expect(miniatura).toContainText('Imię i nazwisko')
  await expect(miniatura).toContainText('Własna ewidencja pracownika')
  await expect(miniatura).toContainText('dane nie opuszczają urządzenia')
  await expect(miniatura).toContainText('Fundusze Europejskie')
  // Proporcja arkusza — podgląd pokazuje, ile z miesiąca wejdzie na stronę.
  const proporcja = await miniatura.evaluate((n) => {
    const r = n.getBoundingClientRect()
    return Math.abs(r.height / r.width - 297 / 210)
  })
  expect(proporcja).toBeLessThan(0.02)

  const pobranie = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Pobierz PDF' }).click()
  const plik = await pobranie
  expect(plik.suggestedFilename()).toMatch(/^ewidencja-\d{4}-\d{2}\.pdf$/)

  const { readFileSync } = await import('node:fs')
  const bajty = readFileSync((await plik.path())!)
  expect(bajty.subarray(0, 5).toString()).toBe('%PDF-')
  const { PDFDocument } = await import('pdf-lib')
  const dokument = await PDFDocument.load(bajty)
  // Badanie 6 z punktu 10: miesiąc ma się zmieścić na jednej–dwu stronach A4.
  expect(dokument.getPageCount()).toBeLessThanOrEqual(2)
})

test('B13: bez grafiku kolumna „plan” jest pusta, ale sygnały odpoczynku działają', async ({ page }) => {
  await przygotujStan(page, {
    bezGrafiku: true,
    wpisy: [
      { data: dzien(-1), od: '06:00', do: '20:00' },
      { data: dzien(0), od: '02:00', do: '10:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await expect(page.getByText('brak grafiku')).toBeVisible()
  await expect(page.getByText('ustaw grafik, żeby porównać').first()).toBeVisible()

  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await expect(page.locator('[data-test="brak-grafiku"]')).toContainText('ustaw grafik, żeby porównać')

  await page.getByRole('button', { name: /Sygnały/ }).click()
  // Sygnały niewymagające planu działają…
  await expect(page.getByText(/Przysługuje 11 h/)).toBeVisible()
  // …a ten, który planu wymaga, nie udaje, że coś wie.
  await expect(page.getByText(/ponad plan z grafiku/)).toHaveCount(0)
})

test('P12: trzy wpisy poza zadeklarowanymi godzinami wywołują pytanie o rytm — raz', async ({ page }) => {
  await przygotujStan(page, {
    rytm: 'stale',
    wpisy: [
      { data: dzien(-9), od: '14:00', do: '22:00' },
      { data: dzien(-6), od: '14:00', do: '22:00' },
      { data: dzien(-2), od: '14:00', do: '22:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()

  const pytanie = page.locator('[data-test="pytanie-o-rytm"]')
  await expect(pytanie).toContainText('Wygląda na to, że pracujesz na zmiany')

  await pytanie.getByRole('button', { name: 'Zostaw jak jest' }).click()
  await expect(page.getByText(/Nie wrócimy do tego przez 30 dni/)).toBeVisible()
  await expect(page.locator('[data-test="pytanie-o-rytm"]')).toHaveCount(0)

  // Po ponownym wejściu pytanie nadal jest wyciszone.
  await page.reload()
  await expect(page.locator('[data-test="pytanie-o-rytm"]')).toHaveCount(0)
})

test('P12: pojedyncze nadgodziny NIE wywołują pytania o rytm', async ({ page }) => {
  await przygotujStan(page, {
    rytm: 'stale',
    wpisy: [
      { data: dzien(-9), od: '08:00', do: '19:00' },
      { data: dzien(-6), od: '08:00', do: '19:00' },
      { data: dzien(-2), od: '08:00', do: '19:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await expect(page.locator('[data-test="pytanie-o-rytm"]')).toHaveCount(0)
})

test('P12: „Zmień” prowadzi do profilu, a kalendarz zmian nie jest kasowany', async ({ page }) => {
  await przygotujStan(page, {
    rytm: 'stale',
    wpisy: [
      { data: dzien(-9), od: '14:00', do: '22:00' },
      { data: dzien(-6), od: '14:00', do: '22:00' },
      { data: dzien(-2), od: '14:00', do: '22:00' },
    ],
  })
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.locator('[data-test="pytanie-o-rytm"]').getByRole('button', { name: 'Zmień' }).click()
  await expect(page.getByRole('heading', { name: 'Mój profil' })).toBeVisible()

  // Kalendarz zmian zostaje w pamięci urządzenia — punkt 11 zakazuje go kasować.
  const maKalendarz = await page.evaluate((klucz) => {
    const s = JSON.parse(window.localStorage.getItem(klucz) ?? '{}')
    return s.profil?.grafik !== null && s.profil?.grafik !== undefined
  }, KLUCZ)
  expect(maKalendarz).toBe(true)
})

test('E5.3a: stałe godziny mają dni tygodnia i listę odstępstw', async ({ page }) => {
  await przygotujStan(page, { rytm: 'stale' })
  await page.getByRole('button', { name: 'Ustawienia' }).click()
  await page.getByRole('button', { name: /Mój grafik/ }).click()

  await expect(page.getByText('Stałe godziny').first()).toBeVisible()
  await expect(page.getByRole('group', { name: /Dni tygodnia/ })).toBeVisible()
  await expect(page.getByText('Odstępstwa')).toBeVisible()
  await expect(page.getByRole('button', { name: /przejdź do kalendarza/ })).toBeVisible()
})
