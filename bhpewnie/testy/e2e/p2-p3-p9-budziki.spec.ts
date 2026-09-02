import { expect, test, type Page } from '@playwright/test'

async function wejdzZPrzykladem(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await expect(page.getByRole('button', { name: /Pobierz kartę moich uprawnień/ })).toBeVisible()
}

async function otworzBudziki(page: Page) {
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Moje budziki/ }).click()
  await expect(page.getByRole('heading', { name: 'Moje budziki' })).toBeVisible()
}

test('P3: budziki opisane są regułą, nie godziną', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)

  // Budzik „przerwa przy monitorze” nie jest widoczny — profil przykładowy ma
  // pracę przy ekranie poniżej progu. To celowe: pokazujemy tylko to, co dotyczy Ciebie.
  await expect(page.getByText('co 2 godziny w trakcie zmiany')).toHaveCount(0)
  await expect(page.getByText('2 godziny przed zmianą N')).toBeVisible()
  await expect(page.getByText('okno snu wyliczone z grafiku')).toBeVisible()
  await expect(page.getByText('30 i 7 dni przed terminem')).toBeVisible()
  await expect(page.getByText('wtorek, o godzinie którą wybierzesz')).toBeVisible()
})

test('P3: cisza po nocce ma plakietkę bez żargonu i nie ma przełącznika', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)

  const cisza = page.locator('.przelacznik').filter({ hasText: 'Cisza po nocce' })
  await expect(cisza).toBeVisible()
  // Plakietka mówi po polsku, bez skrótu „auto” — odbiorcą jest też osoba 50+ bez wprawy.
  await expect(cisza.getByText('samo się ustawia')).toBeVisible()
  // Brak roli przełącznika = użytkownik nie może jej wyłączyć ani ustawić godziny.
  expect(await cisza.getAttribute('role')).toBeNull()
})

test('P3: zasada 8 — po instalacji żaden budzik nie jest włączony', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Zobacz, jak to działa' }).click()
  await otworzBudziki(page)

  const przelaczniki = page.locator('[role="switch"]')
  const ile = await przelaczniki.count()
  expect(ile).toBeGreaterThan(0)
  for (let i = 0; i < ile; i++) {
    expect(await przelaczniki.nth(i).getAttribute('aria-checked')).toBe('false')
  }
})

test('P3: włączony budzik pokazuje wyliczony harmonogram — bez sufitu (zmiana 1.2)', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)

  await page.locator('[role="switch"]').filter({ hasText: 'Protokół przed nocką' }).click()
  await expect(page.getByText('Następne przypomnienie:')).toBeVisible()

  await page.getByText('Co i kiedy się odezwie').click()
  await expect(page.getByText(/nic nie jest po drodze odrzucane/)).toBeVisible()
  // Zasada 8 w nowym brzmieniu: sufit i pierwszeństwo zniknęły z interfejsu bez śladu.
  await expect(page.getByText(/[Ss]ufit/)).toHaveCount(0)
  await expect(page.getByText(/odłożone/)).toHaveCount(0)
})

test('zmiana 1.2: przerwa przy monitorze przypomina co godzinę', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Mój profil/ }).click()

  // Barbara ma monitor „do 2 h”; przełącznik trzeba wyłączyć i włączyć,
  // żeby przyjął najwyższą wartość dopytania („ponad 4 godziny”).
  const monitor = page.locator('[role="switch"]').filter({ hasText: /pracujesz przy komputerze/ })
  await monitor.click()
  await monitor.click()

  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await page.getByRole('button', { name: /Moje budziki/ }).click()
  await expect(page.getByText('co godzinę w trakcie zmiany')).toBeVisible()
})

test('P2: zmiana grafiku natychmiast przelicza przypomnienia i potwierdza to jednym zdaniem', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)
  await page.locator('[role="switch"]').filter({ hasText: 'Protokół przed nocką' }).click()

  await page.getByRole('button', { name: 'Wróć do poprzedniego ekranu' }).click()
  await page.getByRole('button', { name: /Mój grafik/ }).click()
  await page.getByRole('button', { name: 'D — Dniówka' }).click()
  await page.locator('button.dzien-grafiku').nth(8).click()

  await expect(page.getByText('Przeliczyliśmy przypomnienia z nowego grafiku.')).toBeVisible()
})

test('P9: zmiana umowy przelicza aplikację i mówi, co przybyło i ubyło', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Mój profil/ }).click()

  await page.getByRole('button', { name: 'Umowa zlecenia' }).click()
  await expect(page.getByText(/Przeliczyliśmy Twoją aplikację/)).toBeVisible()
  await expect(page.getByText(/ubyło/)).toBeVisible()
})

test('P9: po przejściu na zlecenie znikają uprawnienia z Kodeksu pracy', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Pokaż wszystkie uprawnienia/ }).click()
  await expect(page.getByText(/Dodatek za pracę w nocy/)).toBeVisible()

  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Mój profil/ }).click()
  await page.getByRole('button', { name: 'Umowa zlecenia' }).click()

  await page.getByRole('button', { name: 'Co mi przysługuje', exact: true }).click()
  await page.getByRole('button', { name: /Pokaż wszystkie uprawnienia/ }).click()
  await expect(page.getByText(/Dodatek za pracę w nocy/)).toHaveCount(0)
  // Uprawnienia niezależne od umowy zostają.
  await expect(page.getByText(/Normy dźwigania/)).toBeVisible()
})

test('na zleceniu „Nie mam kiedy odpocząć” daje szary werdykt i odsyła do pakietu umowy', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Mój profil/ }).click()
  await page.getByRole('button', { name: 'Umowa zlecenia' }).click()

  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Nie mam kiedy odpocząć/ }).click()
  await page.getByRole('button', { name: 'Powyżej 9 godzin' }).click()
  await page.getByRole('button', { name: 'Nie miałem(-am) wcale' }).click()
  await page.getByRole('button', { name: 'Mniej niż 11 godzin' }).click()

  await expect(page.getByRole('heading', { name: /Na zleceniu nie przysługuje z mocy prawa/ })).toBeVisible()
  await expect(page.locator('[data-test="odnosnik-pakiet-umowy"]')).toBeVisible()
})
