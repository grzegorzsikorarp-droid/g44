import type {AgendaItem, Meeting} from './types.ts';

// Wczytanie posiedzenia zapisanego przed wersją 2 (decyzje zleceniodawcy z 19.11.2026). Zmiana jest idempotentna
// i działa w miejscu: serwer stosuje ją przy każdym odczycie z bazy, a wersja próbna przy odczycie z localStorage.
// - F12: pole `presenter` (napis) staje się listą `presenters`; niepusty napis to jedna osoba referująca.
// - F11: materiał rodzaju „oswiadczenie”, którego tytuł zaczyna się od „Stanowisko”, dostaje rodzaj „stanowisko”.
export function migrateMeeting(m: Meeting): Meeting {
  for (const it of m.agenda) {
    const legacy = it as AgendaItem & {presenter?: unknown};
    if (!Array.isArray(legacy.presenters)) {
      const old = typeof legacy.presenter === 'string' ? legacy.presenter.trim() : '';
      legacy.presenters = old ? [{name: old, role: '', kind: 'referuje'}] : [];
    }
    if ('presenter' in legacy) delete legacy.presenter;
  }
  for (const x of m.materials) {
    if (x.type === 'oswiadczenie' && /^stanowisko/i.test(x.title.trim())) x.type = 'stanowisko';
  }
  return m;
}
