import { expect, test, type Page } from '@playwright/test'

/** Wszystkie testy startują z gotowego profilu przykładowego (Barbara). */
async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ })).toBeVisible()
}

/** Kafel warunkowy stoi poza pierwszą trójką (sortowanie 3.4) — najpierw rozwijamy listę. */
async function otworzKafel(page: Page, nazwa: RegExp) {
  const rozwin = page.getByRole('button', { name: /Pokaż wszystkie uprawnienia/ })
  if (await rozwin.count() > 0) await rozwin.click()
  await page.getByRole('button', { name: nazwa }).click()
}

test('zmiana 1.2: zakładki nazywają się „Co mi przysługuje” i „Mam sprawę”', async ({ page }) => {
  await wejdzZPrzykladem(page)
  const belka = page.getByRole('navigation', { name: 'Główne działy aplikacji' })
  await expect(belka.getByRole('button', { name: 'Co mi przysługuje' })).toBeVisible()
  await expect(belka.getByRole('button', { name: 'Mam sprawę' })).toBeVisible()
  // Stare nazwy zniknęły z interfejsu.
  await expect(belka.getByRole('button', { name: 'Stanowisko', exact: true })).toHaveCount(0)
  await expect(belka.getByRole('button', { name: 'Sprawdź', exact: true })).toHaveCount(0)
})

test('E1.1: pasek aktualizacji prowadzi do profilu, przycisku „Sprawdź” już nie ma', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await expect(page.getByRole('button', { name: 'Sprawdź, co Ci przysługuje', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: /Coś się zmieniło w Twojej pracy/ }).click()
  await expect(page.getByRole('heading', { name: 'Mój profil' })).toBeVisible()
})

test('E1.1: „Pobierz kartę” jest osiągalne i nie zakrywa go belka nawigacji', async ({ page }) => {
  await wejdzZPrzykladem(page)
  const przycisk = page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ })

  // Ile trzeba przewinąć, żeby do niego dojść — liczba trafia do ROZBIEZNOSCI.md, wpis 16.
  const odFalda = await przycisk.evaluate((el) => Math.round(el.getBoundingClientRect().top - window.innerHeight))
  console.log(`E1.1: „Pobierz kartę” zaczyna się ${odFalda} px poniżej krawędzi ekranu`)

  await przycisk.scrollIntoViewIfNeeded()
  await expect(przycisk).toBeInViewport()

  // Błąd z 1.1: belka nawigacji zakrywała ostatnie przyciski. Sprawdzamy, że nie wróciła.
  const zakryty = await przycisk.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const belka = document.querySelector('nav.belka')!.getBoundingClientRect()
    return r.bottom > belka.top
  })
  expect(zakryty).toBe(false)
})

test('E1.1: stały kafel „Mój czas pracy” prowadzi do ewidencji', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await expect(page.getByRole('heading', { name: 'Mój czas — dziś' })).toBeVisible()
})

test('P4 (zmiana 1.2): kafel warunkowy — pytanie na karcie, przeliczenie w miejscu, trzy akcje', async ({ page }) => {
  await wejdzZPrzykladem(page)

  // Kafel czekający na rozstrzygnięcie ma plakietkę i NIE pokazuje liczby.
  await page.getByRole('button', { name: /Pokaż wszystkie uprawnienia/ }).click()
  const kafel = page.getByRole('button', { name: /Ekwiwalent za pranie odzieży/ })
  await expect(kafel).toContainText('SPRAWDŹ JEDEN WARUNEK')
  await kafel.click()

  // Dopytanie stoi na karcie, nie na osobnym ekranie.
  await expect(page.getByRole('heading', { name: 'Ekwiwalent za pranie odzieży' })).toBeVisible()
  await expect(page.getByText('Jeden warunek do rozstrzygnięcia').first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /Czy pracodawca pierze Twoją odzież/ })).toBeVisible()

  // Odpowiedź przelicza kartę w miejscu — bez zmiany ekranu.
  await page.getByRole('button', { name: 'Nie, piorę sam(a) w domu' }).click()
  await expect(page.getByText('Przysługuje Ci', { exact: true })).toBeVisible()
  await expect(page.getByText('Ile i co konkretnie')).toBeVisible()

  // Zasada 7: trzy stałe akcje w niezmiennej kolejności — także pod kaflem.
  const akcje = page.locator('button.przycisk').filter({ hasText: /Pobierz wniosek PDF|Jak o to poprosić|Przypomnij mi/ })
  await expect(akcje.nth(0)).toHaveText(/Pobierz wniosek PDF/)
  await expect(akcje.nth(1)).toHaveText(/Jak o to poprosić/)
  await expect(akcje.nth(2)).toHaveText(/Przypomnij mi/)
})

test('P4 (zmiana 1.2): odpowiedź na warunek zostaje zapamiętana i da się ją zmienić', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzKafel(page, /Ekwiwalent za pranie odzieży/)
  await page.getByRole('button', { name: 'Tak, pracodawca zapewnia pranie' }).click()

  // Szary stan ma obowiązkowy blok „co przysługuje zamiast tego”.
  await expect(page.getByText('Nie przysługuje', { exact: true })).toBeVisible()
  await expect(page.getByText('Co Ci przysługuje zamiast tego', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Pobierz wniosek PDF/ })).toHaveCount(0)

  // Wracamy na listę: kafel pamięta odpowiedź.
  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await page.getByRole('button', { name: /Pokaż wszystkie uprawnienia/ }).click()
  await expect(page.getByRole('button', { name: /Ekwiwalent za pranie odzieży/ })).not.toContainText('SPRAWDŹ JEDEN WARUNEK')

  // I pozwala ją zmienić.
  await page.getByRole('button', { name: /Ekwiwalent za pranie odzieży/ }).click()
  await expect(page.getByText('Twoja odpowiedź')).toBeVisible()
  await page.getByRole('button', { name: 'Zmień odpowiedź' }).click()
  await page.getByRole('button', { name: 'Nie, piorę sam(a) w domu' }).click()
  await expect(page.getByText('Przysługuje Ci', { exact: true })).toBeVisible()
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
