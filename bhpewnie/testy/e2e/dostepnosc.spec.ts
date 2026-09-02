import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Sekcja 9 briefu: dostępność od pierwszego commita, nie na końcu.
 * Wyniki axe zapisujemy do pliku — mają być dowodem, a nie deklaracją.
 */

const wyniki: Record<string, { powazne: number; wszystkie: number; reguly: string[] }> = {}

async function zbadaj(page: Page, nazwa: string) {
  // AxeBuilder niesie własną kopię typów playwright-core — rzutowanie jest tu bezpieczne.
  const raport = await new AxeBuilder({ page: page as never })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const powazne = raport.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  wyniki[nazwa] = {
    powazne: powazne.length,
    wszystkie: raport.violations.length,
    reguly: raport.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length}×)`),
  }
  return { raport, powazne }
}

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

/*
  Testy chodzą równolegle, a każdy proces ma własną kopię `wyniki`. Bez scalenia
  ostatni zapisujący nadpisywał wyniki pozostałych i plik pokazywał mniej ekranów,
  niż faktycznie zbadano.
*/
test.afterAll(() => {
  const dotychczas = existsSync('wyniki-axe.json')
    ? JSON.parse(readFileSync('wyniki-axe.json', 'utf8'))
    : {}
  writeFileSync('wyniki-axe.json', JSON.stringify({ ...dotychczas, ...wyniki }, null, 2) + '\n')
})

test('axe: ekran powitalny bez błędów krytycznych', async ({ page }) => {
  await page.goto('/')
  const { powazne } = await zbadaj(page, 'E0.1 powitanie')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: pytanie kreatora bez błędów krytycznych', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Ustaw swoją aplikację' }).click()
  const { powazne } = await zbadaj(page, 'E0.2 pytanie kreatora')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: ekran główny bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  const { powazne } = await zbadaj(page, 'E1.1 moje stanowisko')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: karta wyniku bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Każą mi dźwigać/ }).click()
  await page.getByRole('button', { name: 'Do 12 kilogramów' }).click()
  await page.getByRole('button', { name: 'Dorywczo, kilka razy na zmianę' }).click()
  await page.getByRole('button', { name: 'Sam(a)' }).click()
  const { powazne } = await zbadaj(page, 'E2.3 karta wyniku')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

/* ---------- Ekrany dodane w zmianie 1.2 (punkt 9) ---------- */

test('axe: E1.2 z dopytaniem o warunek bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzKafel(page, /Ekwiwalent za pranie odzieży/)
  await expect(page.locator('[data-test="dopytanie"]')).toBeVisible()
  const { powazne } = await zbadaj(page, 'E1.2 karta z dopytaniem')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E1.2 po rozstrzygnięciu warunku bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzKafel(page, /Ekwiwalent za pranie odzieży/)
  await page.getByRole('button', { name: 'Nie, piorę sam(a) w domu' }).click()
  const { powazne } = await zbadaj(page, 'E1.2 karta rozstrzygnięta')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E2.8 porównanie form zatrudnienia bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Czy to na pewno nie powinna być umowa o pracę/ }).click()
  await page.getByRole('button', { name: /Zobacz porównanie form zatrudnienia/ }).click()
  const { powazne } = await zbadaj(page, 'E2.8 porównanie umów')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E7.1 mój czas — dziś bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  const { powazne } = await zbadaj(page, 'E7.1 mój czas dziś')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E7.2 wpis ręczny bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Dodaj wpis ręcznie' }).click()
  await page.getByRole('button', { name: 'Dodaj przerwę' }).click()
  const { powazne } = await zbadaj(page, 'E7.2 wpis ręczny')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E7.3 tydzień i miesiąc bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  const { powazne } = await zbadaj(page, 'E7.3 tydzień i miesiąc')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E7.4 sygnały bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await page.getByRole('button', { name: /Sygnały/ }).click()
  const { powazne } = await zbadaj(page, 'E7.4 sygnały')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E7.5 eksport ewidencji bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: /Mój czas pracy/ }).click()
  await page.getByRole('button', { name: 'Ten tydzień' }).click()
  await page.getByRole('button', { name: /Eksport miesiąca/ }).click()
  const { powazne } = await zbadaj(page, 'E7.5 eksport ewidencji')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: E5.3a stałe godziny bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Ustawienia' }).click()
  await page.getByRole('button', { name: /Mój grafik/ }).click()
  await page.getByRole('button', { name: /Pracuję w stałych godzinach/ }).click()
  const { powazne } = await zbadaj(page, 'E5.3a stałe godziny')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: ekran kryzysowy bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Pomoc', exact: true }).click()
  await page.getByRole('button', { name: /Potrzebuję rozmowy/ }).click()
  const { powazne } = await zbadaj(page, 'E4.10 ekran kryzysowy')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('axe: budziki bez błędów krytycznych', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await page.getByRole('button', { name: /Moje budziki/ }).click()
  const { powazne } = await zbadaj(page, 'E5.4 budziki')
  expect(powazne, JSON.stringify(powazne.map((v) => v.id))).toEqual([])
})

test('cele dotykowe mają co najmniej 48 pikseli', async ({ page }) => {
  await wejdzZPrzykladem(page)
  const zaMale = await page.evaluate(() => {
    const wynik: string[] = []
    for (const el of document.querySelectorAll('button, a[href], [role="switch"]')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.height < 48 || r.width < 48) {
        wynik.push(`${(el.textContent ?? '').trim().slice(0, 30)} — ${Math.round(r.width)}×${Math.round(r.height)}`)
      }
    }
    return wynik
  })
  expect(zaMale, zaMale.join(' | ')).toEqual([])
})

test('pismo bazowe ma co najmniej 16 pikseli', async ({ page }) => {
  await wejdzZPrzykladem(page)
  const rozmiar = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))
  expect(rozmiar).toBeGreaterThanOrEqual(16)
})

test('E2.8: tabela porównania nie wywołuje przewijania strony w bok przy 150%', async ({ page }) => {
  // Badanie 1 z punktu 10: karta z dopytaniem i tabela mają się mieścić także po powiększeniu.
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Czy to na pewno nie powinna być umowa o pracę/ }).click()
  await page.getByRole('button', { name: /Zobacz porównanie form zatrudnienia/ }).click()
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%' })
  await page.waitForTimeout(300)
  const wBok = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(wBok).toBe(false)
})

test('E1.2: trzy akcje są osiągalne przy powiększeniu 150%', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await otworzKafel(page, /Ekwiwalent za pranie odzieży/)
  await page.getByRole('button', { name: 'Nie, piorę sam(a) w domu' }).click()
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%' })
  await page.waitForTimeout(300)

  const przypomnij = page.getByRole('button', { name: /Przypomnij mi/ })
  await przypomnij.scrollIntoViewIfNeeded()
  await expect(przypomnij).toBeInViewport()
})

test('powiększenie do 200% nie wywołuje przewijania w poziomie', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await page.waitForTimeout(300)
  const poziome = await page.evaluate(() => {
    const el = document.querySelector('main.ekran')!
    return { strona: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
             tresc: el.scrollWidth > el.clientWidth + 1 }
  })
  expect(poziome.strona).toBe(false)
  expect(poziome.tresc).toBe(false)
})

test('stan werdyktu niesie ikona i słowo, nie sam kolor', async ({ page }) => {
  await wejdzZPrzykladem(page)
  await page.getByRole('button', { name: 'Mam sprawę', exact: true }).click()
  await page.getByRole('button', { name: /Dziś jest upał|Pracuję w upale/ }).click()
  await page.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await page.getByRole('button', { name: 'Powyżej 28 °C' }).click()
  await page.getByRole('button', { name: 'Nie ma nic' }).click()

  const werdykt = page.locator('.werdykt')
  await expect(werdykt.getByText('Przysługuje Ci')).toBeVisible()
  expect(await werdykt.locator('svg').count()).toBeGreaterThan(0)
})

test('cała aplikacja jest obsługiwalna z klawiatury', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('Tab')
  const pierwszy = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40))
  expect(pierwszy).toBeTruthy()

  // Widoczny stan skupienia (wymóg 2.4.7).
  const obrys = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return getComputedStyle(el).outlineStyle
  })
  expect(obrys).not.toBe('none')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /pracujesz przy komputerze/ })).toBeVisible()
})

test('tryb ciemny zmienia tło i zachowuje czytelny tekst', async ({ page, browser }) => {
  const kontekst = await browser.newContext({ colorScheme: 'dark' })
  const strona = await kontekst.newPage()
  await strona.goto('/')
  const kolory = await strona.evaluate(() => {
    const s = getComputedStyle(document.body)
    return { tlo: s.backgroundColor, tekst: s.color }
  })
  // Ciemny motyw: tło ciemniejsze od tekstu.
  const jasnosc = (c: string) => c.match(/\d+/g)!.slice(0, 3).reduce((a, b) => a + Number(b), 0)
  expect(jasnosc(kolory.tlo)).toBeLessThan(jasnosc(kolory.tekst))
  await kontekst.close()
})
