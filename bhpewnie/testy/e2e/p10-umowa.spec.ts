import { expect, test, type Page } from '@playwright/test'

/**
 * P10 — pakiet „Czy to na pewno nie powinna być umowa o pracę?” (zmiana 1.2, punkt 5).
 * Przechodzimy kreator do pytania o umowę, wybieramy zlecenie i sprawdzamy
 * ekran przejściowy, obie drogi z niego, punktację na trzech zestawach odpowiedzi,
 * porównanie E2.8 i akcje bez generatora pisma.
 */

/** Kreator do pytania o umowę: 13 pytań o cechy → tryb pracy → E0.18. */
async function doPytaniaOUmowe(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ustaw swoją aplikację' }).click()

  // Trzynaście pytań o cechy — odpowiadamy „Nie”, żeby przebieg był krótki i powtarzalny.
  for (let i = 0; i < 13; i++) {
    await page.getByRole('button', { name: 'Nie', exact: true }).click()
  }
  // E0.15 tryb pracy: stałe godziny pomijają kalendarz zmian.
  await page.getByRole('button', { name: /Stałe godziny/ }).click()
  await expect(page.getByRole('heading', { name: 'Jaką masz umowę?' })).toBeVisible()
}

async function odpowiedzNaSzesc(page: Page, odpowiedzi: string[]) {
  for (const o of odpowiedzi) {
    await page.getByRole('button', { name: o, exact: true }).click()
  }
}

test('P10: po wyborze zlecenia pojawia się ekran przejściowy pakietu umowy', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()

  const arkusz = page.getByRole('dialog', { name: /Sprawdźmy jedną rzecz o Twojej umowie/ })
  await expect(arkusz).toBeVisible()
  await expect(arkusz.getByText(/Zajmie minutę/)).toBeVisible()
  await expect(arkusz.getByRole('button', { name: 'Sprawdź teraz' })).toBeVisible()
  await expect(arkusz.getByRole('button', { name: 'Później' })).toBeVisible()
})

test('P10: „Później” ustawia przypomnienie i zostawia kafel stały na ekranie głównym', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()
  await page.getByRole('button', { name: 'Później' }).click()
  await expect(page.getByText(/Przypomnimy za trzy dni/)).toBeVisible()

  // Dokańczamy kreator: przepisy szczególne, rocznik, niepełnosprawność, wynik, nazwa.
  await page.getByRole('button', { name: 'Nie należę' }).click()
  await page.getByRole('button', { name: '1990', exact: true }).click()
  await page.getByRole('button', { name: 'Nie', exact: true }).click()
  await page.getByRole('button', { name: /Pokaż, co mi przysługuje/ }).click()
  await page.getByRole('button', { name: 'Zostaw bez nazwy' }).click()

  await expect(page.getByRole('button', { name: /Sprawdź swoją umowę/ })).toBeVisible()
})

test('P10: sześć na sześć — zielony, porównanie i akcje bez wniosku', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click()

  await expect(page.getByRole('heading', { name: /Czy masz wyznaczone godziny pracy/ })).toBeVisible()
  await odpowiedzNaSzesc(page, ['Tak', 'Tak', 'Tak', 'Nie', 'Tak', 'Tak'])

  await expect(page.getByRole('heading', { name: /Twoja umowa ma cechy umowy o pracę/ })).toBeVisible()
  await expect(page.getByText(/masz wyznaczone godziny pracy/)).toBeVisible()

  // Ostrzeżenie stoi NAD akcjami.
  const ostrzezenie = page.locator('[data-test="ostrzezenie"]')
  await expect(ostrzezenie).toContainText('Ryzyko, że pracodawca zareaguje źle, jest realne')
  const akcje = page.locator('[data-test="akcje-wlasne"]')
  await expect(akcje).toBeVisible()

  // Trzy akcje własne, żadnego generatora pisma do pracodawcy.
  await expect(akcje.getByRole('button')).toHaveCount(3)
  await expect(akcje.getByRole('button').nth(0)).toContainText('inspekcji pracy')
  await expect(akcje.getByRole('button').nth(1)).toContainText('Punkt konsultacyjny')
  await expect(akcje.getByRole('button').nth(2)).toContainText('Przypomnij mi za tydzień')
  await expect(page.getByRole('button', { name: /Pobierz wniosek PDF/ })).toHaveCount(0)

  // Podstawa oznaczona jako wymagająca potwierdzenia.
  await page.getByText('Podstawa prawna').click()
  await expect(page.getByText(/art\. 22 § 1¹ i § 1²/)).toBeVisible()
  await expect(page.getByText(/do potwierdzenia przez specjalistę/).first()).toBeVisible()

  // Informacja o pozwie wolnym od opłat.
  await expect(page.getByText(/wolny od opłat sądowych/)).toBeVisible()
})

test('P10: E2.8 — tabela porównania form zatrudnienia', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click()
  await odpowiedzNaSzesc(page, ['Tak', 'Tak', 'Tak', 'Nie', 'Tak', 'Tak'])

  await page.getByRole('button', { name: /Porównaj: co masz teraz/ }).click()
  await expect(page.getByRole('heading', { name: /Co masz teraz, a co miałbyś na umowie o pracę/ })).toBeVisible()

  // Design 1.2: na telefonie tabeli nie ma — osiem par, nagłówek przy danej.
  const pary = page.locator('.para')
  await expect(pary).toHaveCount(8)
  await expect(pary.first()).toContainText('zlecenie / działalność')
  await expect(pary.first()).toContainText('umowa o pracę')
  await expect(page.getByRole('table')).toBeHidden()
  await expect(page.getByText(/tego aplikacja nie liczy, ale doradca tak/)).toBeVisible()

  // Strona nie przewija się w bok — to była przyczyna zamiany tabeli na listę.
  const przewijaSieWBok = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(przewijaSieWBok).toBe(false)
})

test('P10: trzy na sześć — bursztyn z dwoma brakującymi faktami', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click()
  await odpowiedzNaSzesc(page, ['Tak', 'Tak', 'Tak', 'Tak', 'Nie', 'Nie'])

  await expect(page.getByRole('heading', { name: /Część cech wskazuje na stosunek pracy/ })).toBeVisible()
  await expect(page.getByText('Co sprawdzić')).toBeVisible()
  const pozycje = page.locator('.pas ul li')
  expect(await pozycje.count()).toBeLessThanOrEqual(2)
  await expect(page.locator('[data-test="ostrzezenie"]')).toBeVisible()
})

test('P10: jeden na sześć — szary bez ostrzeżenia, z uprawnieniami zleceniobiorcy', async ({ page }) => {
  await doPytaniaOUmowe(page)
  await page.getByRole('button', { name: /Umowa zlecenia/ }).click()
  await page.getByRole('button', { name: 'Sprawdź teraz' }).click()
  await odpowiedzNaSzesc(page, ['Nie', 'Tak', 'Nie', 'Tak', 'Nie', 'Nie'])

  await expect(page.getByRole('heading', { name: /Twoja umowa wygląda na zlecenie/ })).toBeVisible()
  await expect(page.getByText(/bezpieczne i higieniczne warunki/)).toBeVisible()
  // Ostrzeżenia przed konfrontacją nie ma — nie ma o co konfrontować.
  await expect(page.locator('[data-test="ostrzezenie"]')).toHaveCount(0)
})

test('P10: przy umowie o pracę pakiet pokazuje ekran informacyjny zamiast pytań', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Czy to na pewno nie powinna być umowa o pracę/ }).click()

  await expect(page.getByRole('heading', { name: 'Masz umowę o pracę' })).toBeVisible()
  await expect(page.getByText(/Możesz go pokazać komuś, kogo to dotyczy/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /Czy masz wyznaczone godziny pracy/ })).toHaveCount(0)
  await page.getByRole('button', { name: /Zobacz porównanie form zatrudnienia/ }).click()
  await expect(page.locator('.para')).toHaveCount(8)
})
