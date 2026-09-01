// Robi zrzuty kluczowych ekranów do przeglądu z zespołem.
// Wymaga uruchomionego podglądu: npm run preview
// Uruchomienie: node narzedzia/zrzuty-ekranow.mjs
import { chromium, devices } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const kat = process.env.KATALOG_ZRZUTOW ?? './zrzuty'
const b = await chromium.launch(process.env.PRZEGLADARKA ? { executablePath: process.env.PRZEGLADARKA } : {})

async function zrob(nazwa, kroki, ciemny = false) {
  const c = await b.newContext({ ...devices['Pixel 5'], colorScheme: ciemny ? 'dark' : 'light' })
  const p = await c.newPage()
  await p.goto('http://127.0.0.1:4173/')
  await kroki(p)
  await p.waitForTimeout(350)
  await p.screenshot({ path: `${kat}/w-${nazwa}.png` })
  await c.close()
}

const przyklad = async (p) => { await p.getByRole('button', { name: 'Zobacz, jak to działa' }).click(); await p.waitForTimeout(300) }

await mkdir(kat, { recursive: true })
await zrob('01-powitanie', async () => {})
await zrob('02-stanowisko', przyklad)
await zrob('03-stanowisko-ciemny', przyklad, true)
await zrob('04-wynik', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: 'Sprawdź', exact: true }).click()
  await p.getByRole('button', { name: /Używam własnych ubrań/ }).click()
  await p.getByRole('button', { name: 'Nie, pracuję w swoim ubraniu' }).click()
  await p.getByRole('button', { name: 'Ja, w domu' }).click()
  await p.getByRole('button', { name: 'Tak', exact: true }).click()
})
await zrob('05-wynik-szary', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: 'Sprawdź', exact: true }).click()
  await p.getByRole('button', { name: /Pracuję w upale/ }).click()
  await p.getByRole('button', { name: 'W pomieszczeniu' }).click()
  await p.getByRole('button', { name: 'Poniżej 25 °C' }).click()
  await p.getByRole('button', { name: 'Nie ma nic' }).click()
  await p.evaluate(() => document.querySelector('main').scrollTo(0, 400))
})
await zrob('06-pomoc-krok', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: 'Pomoc', exact: true }).click()
  await p.getByRole('button', { name: /Coś się stało/ }).click()
  await p.getByRole('button', { name: /Wypadek przy pracy/ }).click()
})
await zrob('07-budziki', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await p.getByRole('button', { name: /Moje budziki/ }).click()
})
await zrob('08-grafik', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: 'Ustawienia', exact: true }).click()
  await p.getByRole('button', { name: /Mój grafik/ }).click()
})
await zrob('09-dokument', async (p) => {
  await przyklad(p)
  await p.getByRole('button', { name: /Pobierz kartę moich uprawnień/ }).click()
  await p.evaluate(() => document.querySelector('main').scrollTo(0, 900))
})
await b.close()
console.log('zrzuty gotowe')
