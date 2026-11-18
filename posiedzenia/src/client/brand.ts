import type {ComponentType} from 'preact';

// Nazwy widoczne w interfejsie. Ustawia je punkt wejścia: aplikacja Izby albo wersja próbna z danymi fikcyjnymi.
export const brand = {
  demo: false,
  org: '',
  organShort: '',
  organLong: '',
  term: '',
  organAccounts: 'Prezydium',
  meetingTitle: 'Posiedzenie Prezydium',
  procedureTitle: 'Głosowanie między posiedzeniami',
  place: '',
  office: 'Biuro',
  loginScreen: null as ComponentType<{onDone: () => void}> | null,
  switchLabel: '',
};
export const setBrand = (values: Partial<typeof brand>) => Object.assign(brand, values);
