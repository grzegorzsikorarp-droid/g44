import type { KafelUprawnienia } from '../typy'

/**
 * Zasada 7 po uściśleniu ze zmiany 1.2: trzy stałe akcje — Pobierz wniosek PDF,
 * Jak o to poprosić, Przypomnij mi — stoją pod KAŻDYM rozstrzygnięciem, a kafel
 * w zakładce pierwszej też jest rozstrzygnięciem.
 *
 * Do 1.1 pismo i skrypt umiał złożyć tylko sprawdzacz (E2), bo tylko werdykt miał
 * pola `pismo` i `skrypt`. Tutaj składamy jedno i drugie z kafla uprawnienia.
 *
 * Nie wymyślamy podstaw prawnych: przepisujemy tę, którą ma uprawnienie — łącznie
 * ze znacznikiem [do uzupełnienia przez specjalistę], jeżeli tam stoi.
 */

export interface PismoZKafla {
  tytul: string
  akapity: string[]
  podstawa: string
}

export interface SkryptZKafla {
  ustny: string
  mail: { temat: string; tresc: string }
}

/** Zdanie o warunku — tylko jeśli użytkownik rozstrzygnął go na karcie. */
function zdanieOWarunku(kafel: KafelUprawnienia): string | null {
  if (!kafel.warunek || !kafel.odpowiedz) return null
  return `Na pytanie „${kafel.warunek.pytanie}” odpowiadam: ${kafel.odpowiedz.tekst}.`
}

export function pismoZKafla(kafel: KafelUprawnienia): PismoZKafla {
  const akapity: string[] = [
    `Zwracam się o zapewnienie uprawnienia: ${kafel.tytul.toLowerCase()}.`,
  ]

  const owarunku = zdanieOWarunku(kafel)
  if (owarunku) akapity.push(owarunku)

  akapity.push(`Zakres, o który wnoszę: ${kafel.konkret}`)
  akapity.push(kafel.wyjasnienie)

  if (kafel.niepewne) {
    akapity.push(
      'Uwaga: część danych o moim stanowisku nie została jeszcze doprecyzowana, '
      + 'więc zakres wymaga potwierdzenia w rozmowie.',
    )
  }

  akapity.push('Proszę o odpowiedź na piśmie w terminie ustalonym u pracodawcy.')

  return { tytul: `Wniosek: ${kafel.tytul}`, akapity, podstawa: kafel.podstawa }
}

export function skryptZKafla(kafel: KafelUprawnienia): SkryptZKafla {
  const owarunku = zdanieOWarunku(kafel)

  const ustny = [
    `Chciałem(-am) zapytać o jedną rzecz: ${kafel.tytul.toLowerCase()}.`,
    owarunku ? owarunku.replace('odpowiadam:', 'odpowiedziałem(-am):') : null,
    `Z tego, co sprawdziłem(-am), przysługuje mi: ${kafel.konkret}.`,
    'Chciałem(-am) ustalić, jak to wygląda u nas i co mam zrobić, żeby to załatwić.',
  ].filter(Boolean).join(' ')

  const tresc = [
    'Dzień dobry,',
    '',
    `zwracam się w sprawie uprawnienia: ${kafel.tytul.toLowerCase()}.`,
    owarunku ?? '',
    `Zakres: ${kafel.konkret}`,
    `Podstawa: ${kafel.podstawa}`,
    '',
    'Proszę o informację, w jakim trybie mogę to u nas załatwić.',
    '',
    'Z poważaniem',
  ].filter((w, i, tab) => !(w === '' && tab[i - 1] === '')).join('\n')

  return { ustny, mail: { temat: `Pytanie w sprawie: ${kafel.tytul}`, tresc } }
}
