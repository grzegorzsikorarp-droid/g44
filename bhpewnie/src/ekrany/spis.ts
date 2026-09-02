import type { ComponentType } from 'react'
import { Powitanie, PytanieCechy, TrybPracy, SzablonyZmian, KalendarzGrafiku, Umowa, PrzepisySzczegolne, RokUrodzenia, Niepelnosprawnosc, WynikKreatora, NazwaProfilu } from './kreator'
import { MojeStanowisko, KartaUprawnienia, PodgladKartyPdf, MojeTerminy } from './stanowisko'
import { ListaSytuacji, PytaniaSprawdzacza, KartaWyniku, WynikPosredni, PorownanieUmow, PodgladWniosku, SkryptRozmowy, PanelPrzypomnienia } from './sprawdz'
import { StrumienAktualnosci, WpisAktualnosci, ArchiwumAktualnosci } from './aktualnosci'
import { PomocWejscie, WyborSytuacji, KrokSciezki, ZamkniecieSciezki, KartaPraw, DziennikZdarzen, WpisDoDziennika, NotatnikPrawieWypadkow, EkranKryzysowy, Biblioteka, MaterialBiblioteki, GdzieSzukacPomocy } from './pomoc'
import { MenuUstawien, MojProfil, MojGrafik, GrafikStaleGodziny, MojeBudziki, PobraneMaterialy, OAplikacji, ZglosUwage, EkranDeweloperski } from './ustawienia'
import { PytanieSprawdzianu, WynikSprawdzianu } from './quiz'
import { MojCzasDzis, WpisCzasuEkran, TydzienIMiesiac, SygnalyCzasu, EksportEwidencji } from './czas-pracy'

type Ekran = ComponentType<{ dane: Record<string, unknown> }>

/** Pytania o cechy dzielą jeden komponent — różni je tylko treść z content/kreator.json. */
function pytanie(ekran: string): Ekran {
  return function EkranPytania() {
    return PytanieCechy({ dane: { ekran } })
  } as unknown as Ekran
}

export const EKRANY_KOMPONENTY: Record<string, Ekran> = {
  'E0.1': Powitanie as Ekran,
  'E0.2': pytanie('E0.2'), 'E0.3': pytanie('E0.3'), 'E0.4': pytanie('E0.4'), 'E0.5': pytanie('E0.5'),
  'E0.6': pytanie('E0.6'), 'E0.7': pytanie('E0.7'), 'E0.8': pytanie('E0.8'), 'E0.9': pytanie('E0.9'),
  'E0.10': pytanie('E0.10'), 'E0.11': pytanie('E0.11'), 'E0.12': pytanie('E0.12'),
  'E0.13': pytanie('E0.13'), 'E0.14': pytanie('E0.14'),
  'E0.15': TrybPracy as Ekran,
  'E0.16': SzablonyZmian as Ekran,
  'E0.17': KalendarzGrafiku as Ekran,
  'E0.18': Umowa as Ekran,
  'E0.19': PrzepisySzczegolne as Ekran,
  'E0.20': RokUrodzenia as Ekran,
  'E0.21': Niepelnosprawnosc as Ekran,
  'E0.22': WynikKreatora as Ekran,
  'E0.23': NazwaProfilu as Ekran,

  'E1.1': MojeStanowisko as Ekran,
  'E1.2': KartaUprawnienia,
  'E1.3': PodgladKartyPdf as Ekran,
  'E1.4': MojeTerminy as Ekran,

  'E2.1': ListaSytuacji as Ekran,
  'E2.2': PytaniaSprawdzacza,
  'E2.3': KartaWyniku,
  'E2.4': WynikPosredni,
  'E2.5': PodgladWniosku,
  'E2.6': SkryptRozmowy,
  'E2.7': PanelPrzypomnienia,
  'E2.8': PorownanieUmow as Ekran,

  'E3.1': StrumienAktualnosci as Ekran,
  'E3.2': WpisAktualnosci,
  'E3.3': ArchiwumAktualnosci as Ekran,

  'E4.1': PomocWejscie as Ekran,
  'E4.2': WyborSytuacji as Ekran,
  'E4.3': KrokSciezki,
  'E4.4': KrokSciezki,
  'E4.5': ZamkniecieSciezki,
  'E4.6': KartaPraw,
  'E4.7': DziennikZdarzen as Ekran,
  'E4.8': WpisDoDziennika,
  'E4.9': NotatnikPrawieWypadkow as Ekran,
  'E4.10': EkranKryzysowy as Ekran,
  'E4.11': Biblioteka as Ekran,
  'E4.12': MaterialBiblioteki,
  'E4.13': GdzieSzukacPomocy as Ekran,

  'E5.1': MenuUstawien as Ekran,
  'E5.2': MojProfil as Ekran,
  'E5.3a': GrafikStaleGodziny as Ekran,
  'E5.3b': MojGrafik as Ekran,
  'E5.4': MojeBudziki as Ekran,
  'E5.5': PobraneMaterialy as Ekran,
  'E5.6': OAplikacji as Ekran,
  'E5.7': ZglosUwage as Ekran,

  'E6.1': PytanieSprawdzianu,
  'E6.2': WynikSprawdzianu,

  'E7.1': MojCzasDzis as Ekran,
  'E7.2': WpisCzasuEkran,
  'E7.3': TydzienIMiesiac as Ekran,
  'E7.4': SygnalyCzasu,
  'E7.5': EksportEwidencji as Ekran,

  DEV: EkranDeweloperski as Ekran,
}
