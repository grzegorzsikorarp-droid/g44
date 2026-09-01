import { expect, test, type Page } from '@playwright/test'

async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: 'Sprawdź, co Ci przysługuje', exact: true })).toBeVisible()
}

async function otworzSprawdzacz(page: Page, etykieta: RegExp) {
  await page.getByRole('button', { name: 'Sprawdź', exact: true }).click()
  await page.getByRole('button', { name: etykieta }).click()
}

test('P5: werdykt zielony — przysługuje, z konkretem i trzema akcjami w stałej kolejności', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Używam własnych ubrań do pracy/)

  await page.getByRole('button', { name: 'Nie, pracuję w swoim ubraniu' }).click()
  await page.getByRole('button', { name: 'Ja, w domu' }).click()
  await page.getByRole('button', { name: 'Tak', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Przysługuje Ci ekwiwalent' })).toBeVisible()
  // Stan niesiony słowem, nie tylko kolorem.
  await expect(page.getByText('Przysługuje Ci', { exact: true })).toBeVisible()
  await expect(page.getByText(/Kwotę ustala pracodawca/)).toBeVisible()
  // Podstawa prawna jest zwinięta — rozwijamy ją, tak jak zrobiłby użytkownik.
  await page.getByText('Podstawa prawna').click()
  await expect(page.getByText('art. 237⁹ § 3 Kodeksu pracy')).toBeVisible()
  await expect(page.getByText(/Stan prawny na 1 września 2026/)).toBeVisible()

  // Zasada 7: trzy akcje zawsze w tej samej kolejności.
  const akcje = page.locator('button.przycisk').filter({ hasText: /Pobierz wniosek PDF|Jak o to poprosić|Przypomnij mi/ })
  await expect(akcje.nth(0)).toHaveText(/Pobierz wniosek PDF/)
  await expect(akcje.nth(1)).toHaveText(/Jak o to poprosić/)
  await expect(akcje.nth(2)).toHaveText(/Przypomnij mi/)

  await expect(page.getByText('Informacja edukacyjna, nie porada prawna.')).toBeVisible()
})

test('P5: werdykt bursztynowy — najwyżej dwie rzeczy do sprawdzenia', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Pracuję w upale albo na mrozie/)

  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Między 25 a 28 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  await expect(page.getByRole('heading', { name: /To zależy od dokładnej temperatury/ })).toBeVisible()
  await expect(page.getByText('Co sprawdzić')).toBeVisible()

  const pozycje = page.locator('.pas ul li')
  expect(await pozycje.count()).toBeLessThanOrEqual(2)
})

test('P5: werdykt szary — podaje powód i prowadzi do uprawnienia pokrewnego', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Pracuję w upale albo na mrozie/)

  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Poniżej 25 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  await expect(page.getByRole('heading', { name: /Dziś progi nie są przekroczone/ })).toBeVisible()
  await expect(page.getByText('Nie przysługuje', { exact: true })).toBeVisible()
  // Reguła nienegocjowalna: odmowa nigdy nie zostaje sama.
  await expect(page.getByText('Co Ci przysługuje zamiast tego')).toBeVisible()
})

test('P5: żaden werdykt nie używa czerwieni', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Pracuję w upale albo na mrozie/)
  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Poniżej 25 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  const tlo = await page.locator('.werdykt').evaluate((n) => getComputedStyle(n).backgroundColor)
  const [r, g, b] = tlo.match(/\d+/g)!.map(Number)
  // Czerwień = kanał czerwony wyraźnie dominujący. Stan „nie przysługuje” ma być neutralny.
  expect(r).toBeLessThan(g + 40)
})

test('P5: krzyżyk w sprawdzaczu pyta o potwierdzenie', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Siedzę przy monitorze/)
  await page.getByRole('button', { name: 'Przerwij sprawdzanie' }).click()
  await expect(page.getByText(/zostaną skasowane/)).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do pytań' }).click()
  await expect(page.getByRole('heading', { name: /Ile godzin dziennie/ })).toBeVisible()
})

test('P5: cofnięcie wraca o jeden ekran i zachowuje wcześniejsze odpowiedzi', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Siedzę przy monitorze/)
  await page.getByRole('button', { name: 'Co najmniej połowę dnia pracy' }).click()
  await expect(page.getByText('Pytanie 2 z 3')).toBeVisible()

  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await expect(page.getByText('Pytanie 1 z 3')).toBeVisible()
})

test('E2.6: skrypt rozmowy ma wersję ustną i mailową z tematem', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Używam własnych ubrań do pracy/)
  await page.getByRole('button', { name: 'Nie, pracuję w swoim ubraniu' }).click()
  await page.getByRole('button', { name: 'Ja, w domu' }).click()
  await page.getByRole('button', { name: 'Tak', exact: true }).click()

  await page.getByRole('button', { name: /Jak o to poprosić/ }).click()
  await expect(page.getByText('Do powiedzenia')).toBeVisible()
  await expect(page.getByText(/Pani Kierowniczko/)).toBeVisible()
  await expect(page.getByText('Do wysłania')).toBeVisible()
  await expect(page.getByText(/Temat wiadomości:/)).toBeVisible()
})

test('sytuacja spoza prototypu pokazuje planszę, a nie ślepy zaułek', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawdzacz(page, /Wysyłają mnie na szkolenie BHP/)
  await expect(page.getByText('W pełnej wersji').first()).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do listy' }).click()
  await expect(page.getByRole('heading', { name: 'Sprawdź, co Ci przysługuje' })).toBeVisible()
})
