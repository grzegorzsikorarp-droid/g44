import type {LogEntry, PresenceEvent} from './types.ts';

// Filtry przebiegu obrad w panelu prowadzenia (O-07, dodatek wersji 3): wpisy dziennika jednego rodzaju, a przy
// „Obecność” także zdarzenia z listy obecności. Wspólne dla aplikacji i wersji próbnej (klient), testowane w tests/dodatki.

// Wersja 4 (6.12): pozycja „Pokaz” z wpisami pokazu plików (`tag: 'pokaz'`, B3-13).
export type LogFilter = 'wszystko' | 'glosowania' | 'porzadek' | 'obecnosc' | 'odstepstwa' | 'pokaz';
export const LOG_FILTERS: [LogFilter, string][] = [['wszystko', 'Wszystko'], ['glosowania', 'Głosowania'], ['porzadek', 'Porządek'], ['obecnosc', 'Obecność'], ['odstepstwa', 'Odstępstwa'], ['pokaz', 'Pokaz']];

/** Czy wpis dziennika należy do filtra: głosowania i wnioski, porządek i punkty, obecność i kworum, odstępstwa i wpisy z powodem. */
export function inLogFilter(l: Pick<LogEntry, 'text' | 'tag' | 'ballotId'>, filter: LogFilter) {
  switch (filter) {
    case 'wszystko': return true;
    case 'glosowania': return !!l.ballotId || /^(Otwarto głosowanie|Zakończono głosowanie|Przerwano głosowanie|Ogłoszono wynik|Nieobecność podczas głosowania|Wniosek o |Złożono wniosek|Wycofano wniosek)/.test(l.text);
    case 'porzadek': return l.tag === 'projekt' || /^(Rozpoczęto punkt|Punkt \d)/.test(l.text);
    case 'obecnosc': return /^(Stwierdzono (brak )?kworum|Zapisano wyjście osoby prowadzącej|Posiedzenie kontynuowane jako spotkanie robocze)/.test(l.text);
    case 'odstepstwa': return l.tag === 'odstepstwo' || /[Pp]owód „/.test(l.text);
    case 'pokaz': return l.tag === 'pokaz';
  }
}

/** Zdarzenie obecności słowami, bez odmiany nazwiska: „przybycie przy otwarciu posiedzenia”, „wyjście”, „zgłoszenie obecności”. */
export function presenceWhat(e: Pick<PresenceEvent, 'type' | 'reportedAt' | 'via'>) {
  const what = e.type === 'zgloszenie' ? 'zgłoszenie obecności' : e.type === 'odrzucenie' ? 'odrzucenie zgłoszenia obecności'
    : e.type === 'wyjscie' ? 'wyjście' : e.reportedAt ? 'potwierdzenie zgłoszonej obecności' : 'przybycie';
  const via = e.via === 'otwarcie' ? ' przy otwarciu posiedzenia' : e.via === 'prowadzenie' ? ' przy przejęciu prowadzenia obrad' : e.via === 'przejmujacy' ? ', zapisane przez osobę, która przejęła prowadzenie' : '';
  return what + via;
}
