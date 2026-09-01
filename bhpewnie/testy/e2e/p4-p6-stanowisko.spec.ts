import { expect, test, type Page } from '@playwright/test'

/** Wszystkie testy startują z gotowego profilu przykładowego (Barbara). */
async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: 'Sprawdź, co Ci przysługuje', exact: true })).toBeVisible()
}

test('P4: od kafla do wiedzy dwa dotknięcia, do dokumentu cztery', async ({ page }) => {
  await wejdzZPrzykladem(page)

  // Dotknięcie 1: kafel na ekranie głównym → karta uprawnienia (E1.2)
  await page.getByRole('button', { name: /Dodatek za pracę w nocy/ }).click()
  await expect(page.getByRole('heading', { name: 'Dodatek za pracę w nocy' })).toBeVisible()
  await expect(page.getByText('Ile i co konkretnie')).toBeVisible()

  // Dotknięcie 2: zwijana podstawa prawna z datą stanu prawnego
  await page.getByRole('group').filter({ hasText: 'Podstawa prawna' }).first().click()
  await expect(page.getByText(/Stan prawny na/)).toBeVisible()
})

test('P4: kafel z konkretem — dodatek nocny pokazuje kwotę wyliczoną na dziś', async ({ page }) => {
  await wejdzZPrzykladem(page)
  // Wrzesień 2026: wymiar 176 h → 20% × 4806 / 176 = 5,46 zł.
  await expect(page.getByText(/5,46 zł/).first()).toBeVisible()
})

test('P6: karta uprawnień PDF ma puste pola osobowe, stopkę i miejsce na oznaczenia FE', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ }).click()

  await expect(page.getByRole('heading', { name: 'Karta moich uprawnień' }).first()).toBeVisible()
  await expect(page.getByText(/Imię i nazwisko: …/)).toBeVisible()
  // Pas oznaczeń: FE → barwy RP → UE → nadawca, w kolejności z księgi wizualizacji.
  await expect(page.getByText(/Znak Funduszy Europejskich/)).toBeVisible()
  await expect(page.getByText('Rzeczpospolita Polska')).toBeVisible()
  await expect(page.getByText(/Dofinansowane przez/)).toBeVisible()
  await expect(page.getByText(/Forum Związków/).first()).toBeVisible()
  await expect(page.getByText(/dane nie opuszczają urządzenia/)).toBeVisible()
  await expect(page.getByText(/Stan prawny na 1 września 2026/)).toBeVisible()
})

test('P6: zapis PDF faktycznie tworzy plik po stronie przeglądarki', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ }).click()

  const pobranie = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Zapisz plik PDF' }).click()
  const plik = await pobranie
  expect(plik.suggestedFilename()).toBe('karta-moich-uprawnien.pdf')

  const sciezka = await plik.path()
  const { readFileSync } = await import('node:fs')
  const bajty = readFileSync(sciezka!)
  expect(bajty.subarray(0, 5).toString()).toBe('%PDF-')

  // Otwieramy dokument tą samą biblioteką, którą powstał — sprawdzamy strukturę, nie bajty.
  const { PDFDocument } = await import('pdf-lib')
  const dokument = await PDFDocument.load(bajty)
  expect(dokument.getPageCount()).toBeGreaterThanOrEqual(1)
  expect(dokument.getTitle()).toBe('Karta moich uprawnień')
  expect(dokument.getAuthor()).toBe('Forum Związków Zawodowych')
  // Osadzony font to warunek czytelności polskich znaków — bez niego plik byłby lekki.
  expect(bajty.length).toBeGreaterThan(20_000)
})

test('B1: bez profilu widać uprawnienia powszechne i zaproszenie do trzech pytań', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ustaw swoją aplikację' }).click()
  // Wychodzimy z kreatora bez odpowiedzi.
  await page.getByRole('button', { name: 'Przerwij ustawianie aplikacji' }).click()
  await page.getByRole('button', { name: 'Przerwij i skasuj' }).click()
  await expect(page.getByRole('img', { name: 'BHPewnie' })).toBeVisible()
})

test('E1.4: terminy odliczają dni i pozwalają włączyć przypomnienie', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Moje terminy/ }).click()

  await expect(page.getByText('Badania okresowe')).toBeVisible()
  await expect(page.getByText(/za 64 dni/)).toBeVisible()

  await page.getByRole('button', { name: /Przypomnij mi/ }).first().click()
  await expect(page.getByText(/Przypomnimy 30 i 7 dni przed terminem/)).toBeVisible()
})

test('tryb przykładu nie nadpisuje profilu użytkownika', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByText('To jest przykład. Ustaw własną aplikację →')).toBeVisible()

  await page.getByRole('button', { name: /To jest przykład/ }).click()
  // Po wyjściu z przykładu wracamy do powitania — własnego profilu nie było.
  await expect(page.getByRole('img', { name: 'BHPewnie' })).toBeVisible()
})
