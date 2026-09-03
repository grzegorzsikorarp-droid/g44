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

test('wszystkie osiem sytuacji prowadzi do werdyktu, żadna do planszy', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  // Plansza „w pełnej wersji” zniknęła z listy razem z ostatnią niepełną sytuacją.
  await expect(page.getByText('W pełnej wersji')).toHaveCount(0)
})

test('sytuacja 5: szkolenie BHP po godzinach odsyła do ewidencji czasu', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Wysyłają mnie na szkolenie BHP/)
  await page.getByRole('button', { name: 'Po pracy albo w dzień wolny' }).click()
  await page.getByRole('button', { name: 'Pracodawca', exact: true }).click()

  await expect(page.getByRole('heading', { name: /Szkolenie odbywa się w czasie pracy/ })).toBeVisible()
  await expect(page.getByText(/Mój czas pracy/).first()).toBeVisible()
})

test('sytuacja 3: środki ochrony pytają tylko o narażenia z profilu', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Nie dostałem środków ochrony/)

  // Barbara ma chemię i biologię, nie ma hałasu ani pracy w terenie.
  await expect(page.getByRole('button', { name: /substancjach chemicznych/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /materiale zakaźnym/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ochronników słuchu/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /pracy na dworze/ })).toHaveCount(0)

  await page.getByRole('button', { name: /materiale zakaźnym/ }).click()
  await page.getByRole('button', { name: /Zgłaszałem\(-am\) i nic się nie zmieniło/ }).click()
  await expect(page.getByRole('heading', { name: /obowiązek pracodawcy, nie prośba/ })).toBeVisible()
})

test('sytuacja 7: zimno — 16 °C przy pracy biurowej przekracza próg', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Jest zimno albo ciasno/)
  await page.getByRole('button', { name: 'Od 14 do 18 °C' }).click()
  await page.getByRole('button', { name: 'Siedząca albo lekka' }).click()
  await page.getByRole('button', { name: 'Nie, miejsca wystarcza' }).click()

  await expect(page.getByRole('heading', { name: /Przy pracy biurowej przysługuje Ci 18 °C/ })).toBeVisible()
  await expect(page.getByText(/co najmniej 14 °C/)).toBeVisible()
})

test('sytuacja 4: badania — żądanie zapłaty od pracownika daje zielony werdykt', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Mam badania okresowe/)
  await page.getByRole('button', { name: 'W godzinach mojej pracy' }).click()
  await page.getByRole('button', { name: 'Kazano mi zapłacić samemu' }).click()
  // Zostało jedno pytanie, więc wynik pośredni się nie pokazuje — droga byłaby dłuższa, nie krótsza.
  await expect(page.getByText('Tyle już wiemy')).toHaveCount(0)
  await page.getByRole('button', { name: 'Na miejscu albo w pobliżu' }).click()

  await expect(page.getByRole('heading', { name: /Badania okresowe są na koszt pracodawcy/ })).toBeVisible()
})

/**
 * ZMIANA 1.3, sekcja 4 — normy ciasnoty. Pytania o wymiary pojawiają się dopiero
 * po zgłoszeniu ciasnoty, a werdykt podaje przeliczoną wartość, nie ogólnik.
 */
test('zmiana 1.3: pytania o wymiary tylko po zgłoszeniu ciasnoty', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Jest zimno albo ciasno/)
  await expect(page.getByText('Pytanie 1 z 3')).toBeVisible()

  await page.getByRole('button', { name: 'Powyżej 18 °C' }).click()
  await page.getByRole('button', { name: 'Siedząca albo lekka' }).click()
  await expect(page.getByText('Pytanie 3 z 3')).toBeVisible()

  // „Tak” odsłania trzy pytania o wymiary — licznik rośnie w miejscu.
  await page.getByRole('button', { name: 'Tak, ledwo się mieścimy' }).click()
  await expect(page.getByRole('heading', { name: /Ile osób pracuje/ })).toBeVisible()
  await expect(page.getByText('Pytanie 4 z 6')).toBeVisible()
})

test('zmiana 1.3: ciasno na pewno — werdykt podaje przeliczone metry, nie ogólnik', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Jest zimno albo ciasno/)
  await page.getByRole('button', { name: 'Powyżej 18 °C' }).click()
  await page.getByRole('button', { name: 'Siedząca albo lekka' }).click()
  await page.getByRole('button', { name: 'Tak, ledwo się mieścimy' }).click()
  await page.getByRole('button', { name: 'Od sześciu do dziesięciu' }).click()
  await page.getByRole('button', { name: /do 10 m²/ }).click()
  await page.getByRole('button', { name: /Niskie/ }).click()

  await expect(page.getByRole('heading', { name: /mniej, niż przewiduje norma/ })).toBeVisible()
  // Liczby z przeliczenia ORAZ normy z parametrów.
  await expect(page.getByText(/m³ objętości/)).toBeVisible()
  // Normy padają w dwóch miejscach — w uzasadnieniu i w bloku „ile” — stąd `.first()`.
  await expect(page.getByText(/13 m³/).first()).toBeVisible()
  await expect(page.getByText(/2 m²/).first()).toBeVisible()
  // Oznaczenie źródła zostaje — wartości czekają na potwierdzenie.
  await expect(page.getByText(/czekają na potwierdzenie przez specjalistę/)).toBeVisible()
})

test('zmiana 1.3: układ na granicy daje bursztyn i prośbę o pomiar', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzSprawe(page, /Jest zimno albo ciasno/)
  await page.getByRole('button', { name: 'Powyżej 18 °C' }).click()
  await page.getByRole('button', { name: 'Siedząca albo lekka' }).click()
  await page.getByRole('button', { name: 'Tak, ledwo się mieścimy' }).click()
  await page.getByRole('button', { name: 'Od sześciu do dziesięciu' }).click()
  await page.getByRole('button', { name: /20–40 m²/ }).click()
  await page.getByRole('button', { name: /Zwykłe/ }).click()

  await expect(page.getByRole('heading', { name: /zależy od dokładnych wymiarów/ })).toBeVisible()
  await expect(page.getByText(/dokładne wymiary pomieszczenia/)).toBeVisible()
})
