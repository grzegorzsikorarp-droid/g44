// Podcina IBM Plex Sans do znaków potrzebnych w polskich pismach urzędowych.
// Font idzie DO APLIKACJI, nie z sieci (zasada 1 briefu i reguła systemu wizualnego).
import subsetFont from 'subset-font'
import { readFile, writeFile, stat } from 'node:fs/promises'

const znaki = [
  Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join(''),
  'ĄĆĘŁŃÓŚŹŻąćęłńóśźż',
  '§°–—„”‚’…•·×≥≤±€',
  '⁰¹²³⁴⁵⁶⁷⁸⁹', // indeksy górne: art. 151⁸, art. 237⁹
].join('')

const pary = [
  ['/tmp/plex-Regular.ttf', 'public/fonty/pismo.ttf'],
  ['/tmp/plex-Bold.ttf', 'public/fonty/pismo-gruby.ttf'],
]

for (const [zrodlo, cel] of pary) {
  const wejscie = await readFile(zrodlo)
  const wynik = await subsetFont(wejscie, znaki, { targetFormat: 'truetype' })
  await writeFile(cel, wynik)
  const przed = (await stat(zrodlo)).size
  console.log(`${cel}: ${wynik.length} B (z ${przed} B, ${Math.round((1 - wynik.length / przed) * 100)}% mniej)`)
}
