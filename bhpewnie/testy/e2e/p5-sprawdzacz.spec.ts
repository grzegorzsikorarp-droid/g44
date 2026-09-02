import { expect, test, type Page } from '@playwright/test'

async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ })).toBeVisible()
}

async function otworzSprawe(page: Page, etykieta: RegExp) {
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: etykieta }).click()
}

test('P5 (zmiana 1.2): lista „Mam sprawę” ma osiem pozycji i nie dubluje kafli', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Mam sprawę' })).toBeVisible()

  const pozycje = page.locator('.ekran .lista-czysta > li')
  await expect(pozycje).toHaveCount(8)

  // Sytuacje przeniesione na kafle i do Pomocy zniknęły z listy.
  for (const usunieta of [/Siedzę przy monitorze/, /Używam własnych ubrań/, /Pracuję w nocy/, /Miałem wypadek/, /Pali się/]) {
    await expect(page.getByRole('button', { name: usunieta })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: /Czy to na pewno nie powinna być umowa o pracę/ })).toBeVisible()
})

test('P5: werdykt zielony — konkret i trzy akcje w stałej kolejności', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Każą mi dźwigać/)

  await page.getByRole('button', { name: 'Powyżej 30 kilogramów' }).click()

  // E2.4: reguła rozstrzygnięta wcześniej niż ostatnie pytanie — mówimy o tym wprost.
  await expect(page.getByText('Tyle już wiemy')).toBeVisible()
  await page.getByRole('button', { name: 'Pokaż wynik teraz' }).click()

  await expect(page.getByRole('heading', { name: /Ten ciężar przekracza obie normy/ })).toBeVisible()
  await expect(page.getByText('Przysługuje Ci', { exact: true })).toBeVisible()

  const akcje = page.locator('button.przycisk').filter({ hasText: /Pobierz wniosek PDF|Jak o to poprosić|Przypomnij mi/ })
  await expect(akcje.nth(0)).toHaveText(/Pobierz wniosek PDF/)
  await expect(akcje.nth(1)).toHaveText(/Jak o to poprosić/)
  await expect(akcje.nth(2)).toHaveText(/Przypomnij mi/)

  await expect(page.getByText('Informacja edukacyjna, nie porada prawna.')).toBeVisible()
})

test('P5: dźwiganie pokazuje obie normy i nigdy nie pyta o płeć', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Każą mi dźwigać/)

  for (const pytanie of ['Do 12 kilogramów', 'Dorywczo, kilka razy na zmianę', 'Sam(a)']) {
    await expect(page.locator('h1')).not.toContainText(/płe|kobiet|mężczy/i)
    await page.getByRole('button', { name: pytanie }).click()
  }

  await expect(page.getByText(/Normy dla kobiet/)).toBeVisible()
  await expect(page.getByText(/Normy dla mężczyzn/)).toBeVisible()
})

test('P5: werdykt bursztynowy — najwyżej dwie rzeczy do sprawdzenia', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Pracuję w upale albo na mrozie/)

  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Między 25 a 28 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  await expect(page.getByRole('heading', { name: /To zależy od dokładnej temperatury/ })).toBeVisible()
  await expect(page.getByText('Co sprawdzić')).toBeVisible()

  const pozycje = page.locator('.pas ul li')
  expect(await pozycje.count()).toBeLessThanOrEqual(2)
})

test('P5: werdykt szary — podaje powód i nie zostawia użytkownika samego', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Pracuję w upale albo na mrozie/)

  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Poniżej 25 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  await expect(page.getByRole('heading', { name: /Dziś progi nie są przekroczone/ })).toBeVisible()
  await expect(page.getByText('Nie przysługuje', { exact: true })).toBeVisible()
  await expect(page.getByText('Co Ci przysługuje zamiast tego')).toBeVisible()
})

test('P5: żaden werdykt nie używa czerwieni', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Pracuję w upale albo na mrozie/)
  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Poniżej 25 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  const tlo = await page.locator('.werdykt').evaluate((n) => getComputedStyle(n).backgroundColor)
  const [r, g] = tlo.match(/\d+/g)!.map(Number)
  // Czerwień = kanał czerwony wyraźnie dominujący. Stan „nie przysługuje” ma być neutralny.
  expect(r).toBeLessThan(g + 40)
})

test('P5: sytuacja 6 prowadzi do ewidencji czasu pracy', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Nie mam kiedy odpocząć/)
  await page.getByRole('button', { name: 'Powyżej 9 godzin' }).click()
  await page.getByRole('button', { name: 'Nie miałem(-am) wcale' }).click()
  await page.getByRole('button', { name: 'Ponad 11 godzin' }).click()

  await page.getByRole('button', { name: /Zacznij notować czas, żeby mieć dowód/ }).click()
  await expect(page.getByRole('heading', { name: 'Mój czas — dziś' })).toBeVisible()
})

test('P5: krzyżyk w sprawdzaczu pyta o potwierdzenie', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Każą mi dźwigać/)
  await page.getByRole('button', { name: 'Przerwij sprawdzanie' }).click()
  await expect(page.getByText(/zostaną skasowane/)).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do pytań' }).click()
  await expect(page.getByRole('heading', { name: /Ile mniej więcej waży/ })).toBeVisible()
})

test('P5: cofnięcie wraca o jeden ekran i zachowuje wcześniejsze odpowiedzi', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Każą mi dźwigać/)
  await page.getByRole('button', { name: 'Do 12 kilogramów' }).click()
  await expect(page.getByText('Pytanie 2 z 3')).toBeVisible()

  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await expect(page.getByText('Pytanie 1 z 3')).toBeVisible()
})

test('E2.6: skrypt rozmowy ma wersję ustną i mailową z tematem', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Każą mi dźwigać/)
  await page.getByRole('button', { name: 'Do 12 kilogramów' }).click()
  await page.getByRole('button', { name: 'Dorywczo, kilka razy na zmianę' }).click()
  await page.getByRole('button', { name: 'Sam(a)' }).click()

  await page.getByRole('button', { name: /Jak o to poprosić/ }).click()
  await expect(page.getByText('Do powiedzenia')).toBeVisible()
  await expect(page.getByText('Do wysłania')).toBeVisible()
  await expect(page.getByText(/Temat wiadomości:/)).toBeVisible()
})

test('sytuacja spoza prototypu pokazuje planszę, a nie ślepy zaułek', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Wysyłają mnie na szkolenie BHP/)
  await expect(page.getByText('W pełnej wersji').first()).toBeVisible()
  await page.getByRole('button', { name: 'Wróć do listy' }).click()
  await expect(page.getByRole('heading', { name: 'Mam sprawę' })).toBeVisible()
})
