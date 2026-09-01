import type {
  KafelUprawnienia, ModulCechy, OdpowiedziCech, Profil, Status, Umowa,
  Uprawnienie, Warunek, WarunekZlozony, WektorCech,
} from '../typy'
import { POMINIETE } from '../typy'
import { STAN_PRAWNY, wypelnij, dzisIso } from './parametry'
import { moduly } from '../dane/wczytaj'

/**
 * WARTOSCI BEZPIECZNE (sekcja 4.1 briefu): przy pominietym pytaniu przyjmujemy te
 * wartosc, przy ktorej aplikacja pokazuje WIECEJ, nie mniej. Kafle z niej wynikajace
 * dostaja oznaczenie 'niepewne' — uzytkownik widzi, ze to zalezy od nieudzielonej odpowiedzi.
 */
export const WARTOSCI_BEZPIECZNE: WektorCech = {
  monitor: 'ponad4',
  dzwiganie: 'oba',
  teren: true,
  zmiany: 'zmiany_noce',
  pojazd: true,
  kontakt: 'agresja',
  glos: true,
  chemia: true,
  biologia: true,
  halas: true,
  temperatura: true,
  urazowe: true,
  odziez: true,
  samotnie: true,
}

export const UMOWA_BEZPIECZNA: Umowa = 'o_prace'

export interface RozwiazanyProfil {
  wektor: WektorCech
  umowa: Umowa
  status: Status
  rocznik: number | null
  wiek: number | null
  /** Cechy, na ktore uzytkownik nie odpowiedzial — zrodlo oznaczen 'niepewne'. */
  pominiete: Set<string>
}

export function rozwiazProfil(profil: Profil, dzien: string = dzisIso()): RozwiazanyProfil {
  const pominiete = new Set<string>()
  const wektor = {} as WektorCech
  for (const klucz of Object.keys(WARTOSCI_BEZPIECZNE) as (keyof OdpowiedziCech)[]) {
    const odpowiedz = profil.odpowiedzi[klucz]
    if (odpowiedz === POMINIETE || odpowiedz === undefined || odpowiedz === null) {
      pominiete.add(klucz)
      ;(wektor as any)[klucz] = WARTOSCI_BEZPIECZNE[klucz]
    } else {
      ;(wektor as any)[klucz] = odpowiedz
    }
  }
  let umowa: Umowa
  if (profil.umowa === POMINIETE) {
    pominiete.add('umowa')
    umowa = UMOWA_BEZPIECZNA
  } else {
    umowa = profil.umowa
  }
  const rok = Number(dzien.slice(0, 4))
  return {
    wektor,
    umowa,
    status: profil.status ?? 'brak',
    rocznik: profil.rocznik,
    wiek: profil.rocznik ? rok - profil.rocznik : null,
    pominiete,
  }
}

/* ---------- Ewaluacja warunkow (tresc jest DANA, nie kodem) ---------- */

function spelniony(warunek: Warunek, p: RozwiazanyProfil): boolean {
  let wynik: boolean
  if (warunek.status) {
    wynik = (warunek.wartosc_w ?? []).includes(p.status)
  } else if (warunek.modyfikator === 'umowa') {
    wynik = (warunek.wartosc_w ?? []).includes(p.umowa)
  } else if (warunek.modyfikator === 'rocznik') {
    wynik = warunek.wiek_od !== undefined && p.wiek !== null && p.wiek >= warunek.wiek_od
  } else if (warunek.cecha) {
    const wartosc = p.wektor[warunek.cecha]
    wynik = (warunek.wartosc_w ?? []).includes(wartosc as any)
  } else {
    wynik = false
  }
  return warunek.nie ? !wynik : wynik
}

export function warunekSpelniony(zlozony: WarunekZlozony, p: RozwiazanyProfil): boolean {
  if (zlozony.wszystkie && !zlozony.wszystkie.every((w) => spelniony(w, p))) return false
  if (zlozony.ktorakolwiek && !zlozony.ktorakolwiek.some((w) => spelniony(w, p))) return false
  return true
}

/** Ktore cechy dotyka warunek — do oznaczania kafli jako 'niepewne'. */
function cechyWarunku(zlozony: WarunekZlozony): string[] {
  const lista: string[] = []
  for (const w of [...(zlozony.wszystkie ?? []), ...(zlozony.ktorakolwiek ?? [])]) {
    if (w.cecha) lista.push(w.cecha)
    if (w.modyfikator) lista.push(w.modyfikator)
  }
  return lista
}

/* ---------- Warianty wg umowy i statusu ---------- */

/**
 * Status 'funkcjonariusz' jest PRZELACZNIKIEM KORZENIA (sekcja 4.1): przepina cala
 * macierz na reguly sluzbowe. Uprawnienie plynace wprost z Kodeksu pracy nie obowiazuje
 * w sluzbie — chyba ze redakcja dopisala mu jawny wariant 'funkcjonariusz'.
 */
function zastosujWariant(u: Uprawnienie, p: RozwiazanyProfil): Uprawnienie | null {
  let wynik: Uprawnienie = { ...u }
  const wariantUmowy = u.warianty?.[p.umowa]
  const wariantStatusu = u.warianty?.[p.status as keyof typeof u.warianty]

  for (const wariant of [wariantUmowy, wariantStatusu]) {
    if (!wariant) continue
    if (wariant.ukryte) return null
    wynik = {
      ...wynik,
      tytul: wariant.tytul ?? wynik.tytul,
      konkret: wariant.konkret ?? wynik.konkret,
      podstawa: wariant.podstawa ?? wynik.podstawa,
      wyjasnienie: wariant.wyjasnienie ?? wynik.wyjasnienie,
    }
  }

  if (p.status === 'funkcjonariusz' && u.zrodlo_kp && !wariantStatusu) return null
  return wynik
}

/* ---------- Glowna funkcja silnika ---------- */

export function policzUprawnienia(profil: Profil, dzien: string = dzisIso()): KafelUprawnienia[] {
  const p = rozwiazProfil(profil, dzien)
  const kafle: KafelUprawnienia[] = []

  for (const modul of moduly()) {
    for (const uprawnienie of modul.uprawnienia) {
      if (!warunekSpelniony(uprawnienie.gdy, p)) continue
      const zwariantem = zastosujWariant(uprawnienie, p)
      if (!zwariantem) continue

      const konkret = wypelnij(zwariantem.konkret, dzien)
      const wyjasnienie = wypelnij(zwariantem.wyjasnienie, dzien)
      const niepewne = cechyWarunku(uprawnienie.gdy).some((c) => p.pominiete.has(c))

      kafle.push({
        id: zwariantem.id,
        tytul: zwariantem.tytul,
        konkret: konkret.tekst,
        wyjasnienie: wyjasnienie.tekst,
        podstawa: zwariantem.podstawa,
        cecha: String(modul.cecha),
        niepewne,
        wygasly: konkret.wygasly,
        stan_prawny: STAN_PRAWNY,
        sprawdzacz: zwariantem.sprawdzacz,
        grupa: zwariantem.grupa ?? 'zasady',
        ikona: zwariantem.ikona,
      })
    }
  }

  // Kolejnosc na ekranie glownym: najpierw pieniadze i czas pracy (konkret, ktory da sie
  // policzyc), potem zdrowie, sprzet, zasady i przepisy grupy zawodowej. Kafle niepewne
  // zawsze na koncu — uzytkownik najpierw widzi to, czego jestesmy pewni.
  const WAGA_GRUPY: Record<string, number> = {
    pieniadze: 0, czas: 1, zdrowie: 2, ochrona: 3, zasady: 4, grupa: 5,
  }
  return kafle.sort((a, b) => {
    const roznicaPewnosci = Number(a.niepewne) - Number(b.niepewne)
    if (roznicaPewnosci !== 0) return roznicaPewnosci
    return (WAGA_GRUPY[a.grupa] ?? 9) - (WAGA_GRUPY[b.grupa] ?? 9)
  })
}

/** B9: ile kombinacji nie ma jeszcze przygotowanej tresci (licznik luk, tylko lokalnie). */
export function policzLuki(profil: Profil, dzien: string = dzisIso()): number {
  const p = rozwiazProfil(profil, dzien)
  let luki = 0
  for (const modul of moduly()) {
    if (modul.cecha === 'powszechne' || modul.cecha === 'status') continue
    const cecha = modul.cecha as keyof WektorCech
    const wartosc = p.wektor[cecha]
    const aktywna = wartosc !== false && wartosc !== 'brak'
    if (!aktywna) continue
    const maTresc = modul.uprawnienia.some((u) => warunekSpelniony(u.gdy, p) && zastosujWariant(u, p))
    if (!maTresc) luki++
  }
  return luki
}
