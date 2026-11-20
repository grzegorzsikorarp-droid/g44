import type {ComponentType} from 'preact';

// Nazwy i znak widoczne w interfejsie. Ustawia je punkt wejścia: aplikacja Izby albo wersja próbna z danymi fikcyjnymi.
// Wersja próbna nie dostaje znaku ani nazwy Izby, dlatego wartości domyślne są neutralne.
export const brand = {
  demo: false,
  /** Pełna nazwa przy pierwszym użyciu, np. „Okręgowa Izba Pielęgniarek i Położnych w Słupsku”. */
  org: '',
  /** Wizytówka obok znaku: [cienka kursywa, pogrubione miasto]. */
  nameplate: null as [string, string] | null,
  /** Adres pliku ze znakiem Izby (zawsze na białym tle). */
  logo: null as string | null,
  /** Pełna nazwa organu, np. „Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku”. */
  organ: '',
  term: '',
  meetingTitle: 'Posiedzenie Prezydium',
  procedureTitle: 'Głosowanie między posiedzeniami',
  place: '',
  /** Biuro w mianowniku, wielką literą na początku zdania: „Biuro Izby”. */
  office: 'Biuro',
  /** Biuro w mianowniku w środku zdania: „biuro Izby”. */
  officeLower: 'biuro',
  /** Biuro w dopełniaczu: „od biura Izby”. */
  officeOf: 'biura',
  /** Biuro w celowniku: „zgłoś go biuru Izby”. */
  officeTo: 'biuru',
  /** Wersja 3: kto przyjął zasadę w linii źródła („Zasada przyjęta przez Izbę 20.11.2026.”); w wersji próbnej pusty. */
  houseBy: '',
  /** Regulamin w dopełniaczu: „§ 14 ust. 5 Regulaminu Okręgowej Rady Pielęgniarek i Położnych w Słupsku”. */
  regulation: 'Regulaminu',
  loginScreen: null as ComponentType<{onDone: () => void}> | null,
  switchLabel: '',
};
export const setBrand = (values: Partial<typeof brand>) => Object.assign(brand, values);
