import { expect, test, type Page } from '@playwright/test'

async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ })).toBeVisible()
}

async function otworzPomoc(page: Page) {
  await page.getByRole('button', { name: 'Pomoc', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Pomoc' })).toBeVisible()
}

test('P7: pasek numerów alarmowych jest na KAŻDYM ekranie Pomocy', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)

  const paseknaEkranie = async () => {
    await expect(page.getByRole('group', { name: 'Numery alarmowe' })).toBeVisible()
    await expect(page.getByRole('link', { name: /112/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /800 70 2222/ })).toBeVisible()
  }

  await paseknaEkranie()                                   // E4.1
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await paseknaEkranie()                                   // E4.2
  await page.getByRole('button', { name: /Wypadek przy pracy/ }).click()
  await paseknaEkranie()                                   // E4.3
})

test('P7: ścieżka wypadkowa prowadzi krok po kroku, z ostrzeżeniem i rozgałęzieniem', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await page.getByRole('button', { name: /Wypadek przy pracy/ }).click()

  await expect(page.getByRole('heading', { name: 'Przerwij zagrożenie.' })).toBeVisible()
  await expect(page.getByText('Czego nie robić')).toBeVisible()
  await expect(page.getByText(/Nie wracaj po rzeczy/)).toBeVisible()

  // Rozgałęzienie w kroku 1
  await page.getByRole('button', { name: /Tak, mogę się poruszać/ }).click()
  await expect(page.getByRole('heading', { name: 'Sprawdź siebie.' })).toBeVisible()

  // Cofnięcie wraca do poprzedniego kroku
  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await expect(page.getByRole('heading', { name: 'Przerwij zagrożenie.' })).toBeVisible()
})

test('P7: przejście całej ścieżki kończy się kartą praw z wariantami', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await page.getByRole('button', { name: /Wypadek przy pracy/ }).click()
  await page.getByRole('button', { name: /Tak, mogę się poruszać/ }).click()

  for (let i = 0; i < 8; i++) {
    const dalej = page.getByRole('button', { name: 'Zrobione — dalej' })
    if (await dalej.count() === 0) break
    await dalej.click()
  }

  await expect(page.getByRole('heading', { name: /Masz to za sobą/ })).toBeVisible()
  await expect(page.getByText(/w ciągu 14 dni/)).toBeVisible()

  await page.getByRole('button', { name: /Zobacz, co Ci przysługuje/ }).click()
  await expect(page.getByRole('heading', { name: 'Co Ci teraz przysługuje' })).toBeVisible()
  await expect(page.getByText(/100% podstawy/)).toBeVisible()
  await expect(page.getByText(/przysługuje 1781 zł/)).toBeVisible()
  await expect(page.getByText(/Prawo zgłoszenia uwag i zastrzeżeń/)).toBeVisible()

  await page.getByRole('button', { name: /Przypomnij mi jutro o zgłoszeniu na piśmie/ }).click()
  await expect(page.getByText(/Przypomnimy Ci jutro/)).toBeVisible()
})

test('P7: krzyżyk w Pomocy zamyka bez pytania', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await page.getByRole('button', { name: /Wypadek przy pracy/ }).click()

  await page.getByRole('button', { name: 'Zamknij Pomoc' }).click()
  await expect(page.getByRole('heading', { name: 'Pomoc' })).toBeVisible()
})

test('P7: przerwana ścieżka proponuje powrót w to samo miejsce', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await page.getByRole('button', { name: /Wypadek przy pracy/ }).click()
  await page.getByRole('button', { name: /Tak, mogę się poruszać/ }).click()
  await page.getByRole('button', { name: 'Zamknij Pomoc' }).click()

  await expect(page.getByText(/Zaczęliśmy to wcześniej/)).toBeVisible()
  await page.getByRole('button', { name: 'Wróć tam, gdzie skończyliśmy' }).click()
  await expect(page.getByRole('heading', { name: 'Sprawdź siebie.' })).toBeVisible()
})

test('E4.10: ekran kryzysowy ma dokładnie dwa numery, dwa zdania i zdanie o 112', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Potrzebuję rozmowy/ }).click()

  await expect(page.getByText('Możesz teraz porozmawiać z człowiekiem.')).toBeVisible()
  await expect(page.getByText('To nic nie kosztuje i nie musisz się przedstawiać.')).toBeVisible()
  await expect(page.getByRole('link', { name: /800 70 2222/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /116 123/ })).toBeVisible()
  await expect(page.getByText('Jeśli zagrożone jest życie — dzwoń 112.')).toBeVisible()

  // Nic poza tym: dwa telefony i przycisk zamknięcia, bez paska alarmowego i belki.
  expect(await page.getByRole('link').count()).toBe(2)
  expect(await page.locator('nav.belka').count()).toBe(0)
})

test('E4.10: ekran kryzysowy nie zapamiętuje stanu', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Potrzebuję rozmowy/ }).click()
  await page.getByRole('button', { name: 'Zamknij' }).click()

  await page.reload()
  // Po ponownym otwarciu aplikacji nie ma śladu po ekranie kryzysowym.
  await expect(page.getByText('Możesz teraz porozmawiać z człowiekiem.')).toHaveCount(0)
})

test('P8: notatnik prawie-wypadków ma cztery pola i zapisuje lokalnie', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Notatnik prawie-wypadków/ }).click()

  await expect(page.getByText('Zapis wyłącznie w Twoim telefonie.')).toBeVisible()
  await page.getByRole('button', { name: 'Dodaj wpis' }).click()

  await page.getByPlaceholder(/Własnymi słowami/).fill('Paleta spadła z wózka tuż obok przejścia.')
  await page.getByPlaceholder(/Co by się stało/).fill('Gdyby ktoś tamtędy szedł, przygniotłaby mu nogi.')
  await page.getByPlaceholder(/Imiona i nazwiska/).fill('Anna z magazynu')
  await page.getByRole('button', { name: 'Zapisz' }).click()

  await expect(page.getByText(/Paleta spadła z wózka/)).toBeVisible()
  await expect(page.getByText(/przygniotłaby mu nogi/)).toBeVisible()
})

test('nękanie prowadzi do dziennika zamiast karty praw', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzPomoc(page)
  await page.getByRole('button', { name: /Coś się stało/ }).click()
  await page.getByRole('button', { name: /Nękanie/ }).click()

  await expect(page.getByText(/Zamiast karty praw prowadzimy Cię do dziennika/)).toBeVisible()
  await page.getByRole('button', { name: /Zapisz zdarzenie w dzienniku/ }).click()
  await expect(page.getByText('Zapis wyłącznie w Twoim telefonie.')).toBeVisible()
})
