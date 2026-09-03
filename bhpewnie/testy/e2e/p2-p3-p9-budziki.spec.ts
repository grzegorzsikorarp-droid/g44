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

test('zmiana 1.3: reguła budzika opisuje uprawnienie, tor — częstotliwość', async ({ page }) => {
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

  // Reguła mówi, KIEDY przerwa się należy — niezależnie od tego, jak często aplikacja mówi.
  await expect(page.getByText('przerwa należy się po każdej godzinie przy ekranie')).toBeVisible()
  await page.getByRole('switch', { name: /Przerwa przy monitorze/ }).click()

  // Dopiero tor mówi, jak często się odezwie — i domyślnie jest to raz dziennie.
  const tor = page.getByRole('group', { name: /Jak często: Przerwa przy monitorze/ })
  await expect(tor.getByRole('button', { name: 'raz dziennie' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('raz na początku zmiany')).toBeVisible()
  await tor.getByRole('button', { name: 'za każdym razem' }).click()
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

/**
 * ZMIANA 1.3, sekcja 1 — wybór częstotliwości przy budziku.
 * Sufit nie wraca: nic nie jest odrzucane. Zmienia się to, kto decyduje o serii.
 * Testujemy na „Protokole przed nocką”, bo profil przykładowy ma nocki, a pracę
 * przy monitorze poniżej progu — budzika monitorowego Barbara po prostu nie widzi.
 */
const TOR = /Jak często: Protokół przed nocką/

test('zmiana 1.3: budzik rytmiczny ma tor „raz dziennie / za każdym razem”', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)

  // Przed włączeniem budzika toru nie ma — ustawienie bez skutku byłoby atrapą.
  await expect(page.getByRole('group', { name: TOR })).toHaveCount(0)

  await page.getByRole('switch', { name: /Protokół przed nocką/ }).click()
  const tor = page.getByRole('group', { name: TOR })
  await expect(tor).toBeVisible()

  // Domyślnie „raz dziennie” — decyzja aplikacji nie może brzmieć „za każdym razem”.
  await expect(tor.getByRole('button', { name: 'raz dziennie' })).toHaveAttribute('aria-pressed', 'true')
  await expect(tor.getByRole('button', { name: 'za każdym razem' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByText('raz przed pierwszą nocką w serii')).toBeVisible()

  await tor.getByRole('button', { name: 'za każdym razem' }).click()
  await expect(tor.getByRole('button', { name: 'za każdym razem' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('przed każdą nocką')).toBeVisible()
})

test('zmiana 1.3: wybór częstotliwości zmienia harmonogram, a nie tylko napis', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)
  await page.getByRole('switch', { name: /Protokół przed nocką/ }).click()
  await page.getByText('Co i kiedy się odezwie').click()

  const pozycje = page.locator('.podstawa__wnetrze li')
  const przyRaz = await pozycje.count()

  await page.getByRole('group', { name: TOR }).getByRole('button', { name: 'za każdym razem' }).click()
  const przyZawsze = await pozycje.count()

  console.log(`Harmonogram: „raz dziennie” -> ${przyRaz} pozycji, „za każdym razem” -> ${przyZawsze}`)
  expect(przyZawsze).toBeGreaterThan(przyRaz)
})

test('zmiana 1.3: nadal nic nie jest odrzucane — sufit nie wrócił', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)
  await page.getByText('Co i kiedy się odezwie').click()
  await expect(page.getByText(/nic nie jest po drodze odrzucane/)).toBeVisible()
  // Zdanie o wyborze częstotliwości zastąpiło dawne zdanie o suficie.
  await expect(page.getByText(/sam wybierasz: raz dziennie czy za każdym razem/)).toBeVisible()
})

test('zmiana 1.3: budzik terminowy NIE ma wyboru częstotliwości', async ({ page }) => {
  // Badania i szkolenie odzywają się raz z natury — tor byłby tam pytaniem bez treści.
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)
  await page.getByRole('switch', { name: /Badania okresowe/ }).click()
  await expect(page.getByRole('group', { name: /Jak często: Badania okresowe/ })).toHaveCount(0)
})

/**
 * ZMIANA 1.3, badanie 2 (sekcja 8): czy tor „raz dziennie / za każdym razem”
 * mieści się na karcie budzika bez rozpychania listy — przy 16 px i przy 150%.
 */
test('badanie 2: tor częstotliwości nie rozpycha listy budzików', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzBudziki(page)

  // Mierzymy wysokość samej listy budzików, nie okna: lista i tak się przewija,
  // więc pytanie brzmi, o ile tor ją wydłuża i czy przełącznik zostaje czytelny.
  const lista = page.locator('.kolumna').filter({ has: page.locator('.przelacznik') }).first()
  const przed = await lista.evaluate((n) => Math.round(n.scrollHeight))
  await page.getByRole('switch', { name: /Protokół przed nocką/ }).click()
  const tor = page.getByRole('group', { name: /Jak często: Protokół przed nocką/ })

  const wysokoscToru = await tor.evaluate((n) => Math.round(n.getBoundingClientRect().height))
  const po = await lista.evaluate((n) => Math.round(n.scrollHeight))
  console.log(`Budziki: tor ma ${wysokoscToru} px, lista urosła o ${po - przed} px (16 px pisma)`)
  /*
    Zmierzone: 58 px toru + linijka opisu + odstępy = 106 px na jeden włączony budzik
    rytmiczny. Lista budzików i tak się przewija, więc nic nie wypada z ekranu;
    próg 120 px pilnuje, żeby tor nie urósł przy następnej zmianie w niezauważony
    sposób. Barbara ma najwyżej dwa budziki z wyborem, czyli 212 px w najgorszym razie.
  */
  expect(po - przed).toBeLessThanOrEqual(120)

  // Cele dotykowe w torze nie mogą schodzić poniżej reguły 3 (48 px).
  const cele = await tor.getByRole('button').evaluateAll((ns) =>
    ns.map((n) => Math.round(n.getBoundingClientRect().height)))
  for (const c of cele) expect(c, `segment ma ${c} px`).toBeGreaterThanOrEqual(48)

  // Napisy mieszczą się w jednej linii — inaczej tor byłby wyższy niż dwa wiersze.
  const zawijaSie = await tor.getByRole('button').evaluateAll((ns) =>
    ns.some((n) => n.scrollWidth > n.clientWidth + 1))
  expect(zawijaSie, 'napis w segmencie zawija się albo jest ucinany').toBe(false)

  // 150%: to samo, przy pismie 24 px.
  await page.addStyleTag({ content: 'html { font-size: 24px !important; }' })
  const cele150 = await tor.getByRole('button').evaluateAll((ns) =>
    ns.map((n) => Math.round(n.getBoundingClientRect().height)))
  const wBok = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  console.log(`Budziki przy 150%: segmenty ${cele150.join('/')} px, wystawanie w bok ${wBok} px`)
  expect(wBok).toBeLessThanOrEqual(1)
  for (const c of cele150) expect(c).toBeGreaterThanOrEqual(48)
})
