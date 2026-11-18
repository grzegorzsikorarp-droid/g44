import type {ComponentType} from 'preact';

// Nazwy i znak widoczne w interfejsie. Ustawia je punkt wejścia: aplikacja Izby albo wersja próbna z danymi fikcyjnymi.
// Wersja próbna nie dostaje znaku ani nazwy Izby.
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
  office: 'Biuro',
  loginScreen: null as ComponentType<{onDone: () => void}> | null,
  switchLabel: '',
};
export const setBrand = (values: Partial<typeof brand>) => Object.assign(brand, values);
