import type { ModulCechy, PytanieKreatora, SciezkaPomocy, Sytuacja } from '../typy'

/**
 * PANEL REDAKCYJNY: cala tresc jest danymi, nie kodem. Zmiana brzmienia pytania,
 * kwoty czy podstawy prawnej = edycja pliku w katalogu content/, bez dotykania komponentow.
 * Pliki wciagane sa do paczki na etapie budowania — zasada 2 (dziala bez internetu).
 */

const modulyCech = import.meta.glob<{ default: ModulCechy }>('../../content/cechy/*.json', { eager: true })
const sytuacjePliki = import.meta.glob<{ default: Sytuacja }>('../../content/sytuacje/*.json', { eager: true })
const sciezkiPliki = import.meta.glob<{ default: SciezkaPomocy }>('../../content/pomoc/*.json', { eager: true })

let pamiecModulow: ModulCechy[] | null = null

export function moduly(): ModulCechy[] {
  if (pamiecModulow) return pamiecModulow
  pamiecModulow = Object.entries(modulyCech)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, m]) => (m as any).default as ModulCechy)
  return pamiecModulow
}

export function modulCechy(cecha: string): ModulCechy | undefined {
  return moduly().find((m) => m.cecha === cecha)
}

export function sytuacje(): Sytuacja[] {
  return Object.entries(sytuacjePliki)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, s]) => (s as any).default as Sytuacja)
}

export function sytuacja(id: string): Sytuacja | undefined {
  return sytuacje().find((s) => s.id === id)
}

export function sciezkiPomocy(): SciezkaPomocy[] {
  return Object.entries(sciezkiPliki)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, s]) => (s as any).default as SciezkaPomocy)
}

export function sciezkaPomocy(id: string): SciezkaPomocy | undefined {
  return sciezkiPomocy().find((s) => s.id === id)
}

/** Wszystkie pytania kreatora w kolejnosci ekranow E0.2 -> E0.21. */
export function pytaniaKreatora(): PytanieKreatora[] {
  return (kreator as any).pytania as PytanieKreatora[]
}

import kreator from '../../content/kreator.json'
import teksty from '../../content/teksty.json'

type Slownik = Record<string, string>

/** Napisy interfejsu — takze dane, nie kod. */
export function t(klucz: string): string {
  const wartosc = (teksty as unknown as Slownik)[klucz]
  if (wartosc === undefined) {
    if (import.meta.env?.DEV) console.warn(`Brak napisu: ${klucz}`)
    return klucz
  }
  return wartosc
}

export { teksty }
