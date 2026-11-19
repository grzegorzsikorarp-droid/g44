import type {Account, AgendaItem, Meeting, MeetingStatus, Motion, Presence, VoteMode} from '../shared/types.ts';

// Tabela znaczników stanu. Ekrany korzystają tylko z niej, żeby ten sam stan wyglądał wszędzie tak samo.
// - wypełnienie („trwa”): coś trwa teraz,
// - czerwony obrys („otwarte”): użytkownik ma coś zrobić,
// - szary obrys („zamkniete”): etap zamknięty albo wyjątek.
// Stan normalny nie dostaje znacznika (osoba obecna, konto aktywne, punkt oczekujący), a stan zawsze opisuje słowo.

export type Tone = 'trwa' | 'otwarte' | 'zamkniete';
export interface ChipState { label: string; tone: Tone }
const chip = (label: string, tone: Tone = 'zamkniete'): ChipState => ({label, tone});

/** Stan posiedzenia. Członek widzi „Zaplanowane” zamiast „W przygotowaniu”, a przerwa ma szary obrys. */
export function meetingState(status: MeetingStatus, member = false): ChipState {
  switch (status) {
    case 'przygotowanie': return chip(member ? 'Zaplanowane' : 'W przygotowaniu');
    case 'trwa': return chip('Trwa', 'trwa');
    case 'przerwa': return chip('Przerwa');
    case 'zakonczone': return chip('Zakończone');
  }
}

/** Stan punktu porządku. Bieżący punkt ma „Teraz”, punkt oczekujący nie ma znacznika. */
export function itemChip(item: Pick<AgendaItem, 'status'>, current = false): ChipState | null {
  if (current) return chip('Teraz', 'trwa');
  switch (item.status) {
    case 'w_toku': return chip('W toku', 'trwa');
    case 'zakonczony': return chip('Zakończony');
    case 'odroczony': return chip('Odroczony');
    case 'wycofany': return chip('Wycofany');
    default: return null;
  }
}

/** Porządek obrad przed przyjęciem i po nim. */
export const agendaChip = (adopted: boolean): ChipState => adopted ? chip('Przyjęty') : chip('Do przyjęcia', 'otwarte');

/** Trwające głosowanie, np. na liście posiedzeń. */
export const votingChip = (): ChipState => chip('Trwa głosowanie', 'trwa');

/** Obecność. Osoba obecna nie dostaje znacznika, a obecność zgłoszoną w aplikacji (F9) trzeba potwierdzić. */
export function presenceChip(status: Presence | undefined): ChipState | null {
  if (status === 'obecny') return null;
  if (status === 'zgloszony') return chip('Do potwierdzenia', 'otwarte');
  return status === 'wyszedl' ? chip('Wyjście') : chip('Brak potwierdzenia');
}

/** Rodzaj dokumentu w słowniku (F11). Rodzaj włączony nie dostaje znacznika. */
export const docTypeChip = (active: boolean): ChipState | null => active ? null : chip('Wyłączony');

/** Konto. Konto aktywne nie dostaje znacznika. */
export function accountChip(a: Pick<Account, 'disabled' | 'mustChange'>): ChipState | null {
  if (a.disabled) return chip('Zablokowane');
  return a.mustChange ? chip('Czeka na pierwsze logowanie') : null;
}

/** Wniosek o reasumpcję. */
export function motionChip(status: Motion['status']): ChipState {
  switch (status) {
    case 'zbiera_podpisy': return chip('Zbiera podpisy', 'otwarte');
    case 'zlozony': return chip('Złożony');
    case 'glosowany': return chip('Trwa głosowanie', 'trwa');
    case 'przyjety': return chip('Przyjęty');
    case 'odrzucony': return chip('Odrzucony');
    case 'wycofany': return chip('Wycofany');
  }
}

/** Wiersz gotowości posiedzenia. */
export type Readiness = 'gotowe' | 'uzupelnic' | 'sprawdzic';
export function readinessChip(state: Readiness): ChipState {
  switch (state) {
    case 'gotowe': return chip('Gotowe');
    case 'uzupelnic': return chip('Do uzupełnienia', 'otwarte');
    case 'sprawdzic': return chip('Do sprawdzenia', 'otwarte');
  }
}

/** Tryb głosowania w mianowniku: „głosowanie jawne”. */
export const modeName = (mode: VoteMode | string) => mode === 'tajne' ? 'tajne' : mode === 'imienne' ? 'imienne' : 'jawne';
/** Tryb głosowania w dopełniaczu: „wynik głosowania jawnego”. */
export const modeGenitive = (mode: VoteMode | string) => mode === 'tajne' ? 'tajnego' : mode === 'imienne' ? 'imiennego' : 'jawnego';

/** Chwila ogłoszenia trwającej przerwy (ostatni wpis „Przerwa w obradach.”) albo null, gdy przerwy nie ma. */
export function breakSince(m: Pick<Meeting, 'status' | 'log'>): number | null {
  if (m.status !== 'przerwa') return null;
  for (let i = m.log.length - 1; i >= 0; i--) if (m.log[i].text === 'Przerwa w obradach.') return m.log[i].at;
  return null;
}
