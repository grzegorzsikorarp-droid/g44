import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'

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
  await expect(page.getByRole('button', { name: 'Sprawdź, co Ci przysługuje', exact: true })).toBeVisible()
}

test.afterAll(() => {
  writeFileSync('wyniki-axe.json', JSON.stringify(wyniki, null, 2) + '\n')
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
  await page.getByRole('button', { name: 'Sprawdź', exact: true }).click()
  await page.getByRole('button', { name: /Używam własnych ubrań/ }).click()
  await page.getByRole('button', { name: 'Nie, pracuję w swoim ubraniu' }).click()
  await page.getByRole('button', { name: 'Ja, w domu' }).click()
  await page.getByRole('button', { name: 'Tak', exact: true }).click()
  const { powazne } = await zbadaj(page, 'E2.3 karta wyniku')
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
  await page.getByRole('button', { name: 'Sprawdź', exact: true }).click()
  await page.getByRole('button', { name: /Pracuję w upale/ }).click()
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
