import {useContext, useEffect, useState} from 'preact/hooks';
import {defaultDocTypes} from '../shared/doctypes.ts';
import type {DocType} from '../shared/types.ts';
import {MeetingCtx} from './context.ts';

// Słownik rodzajów dokumentów (F11, wersja 3, I-9). Przychodzi z danymi sesji (GET /api/session, pole `docTypes`) dla
// każdego zalogowanego, więc klient nie pyta o niego osobno. W posiedzeniu obowiązuje słownik zapisany przy otwarciu
// (`frozen.docTypes`), gdy posiedzenie go ma. Bez sesji obowiązują rodzaje domyślne. Po zmianie słownika przez biuro
// nowy słownik podaje setDocTypes (np. strona „Rodzaje dokumentów” po zapisie).
let cache: DocType[] | null = null;
const listeners = new Set<(types: DocType[]) => void>();

export function setDocTypes(types: DocType[]) {
  cache = types;
  for (const listener of listeners) listener(types);
}

/** Słownik rodzajów dokumentów: w posiedzeniu zapisany przy otwarciu, poza nim z danych sesji. */
export function useDocTypes() {
  const meeting = useContext(MeetingCtx);
  const [types, setTypes] = useState<DocType[]>(cache ?? defaultDocTypes);
  useEffect(() => {
    listeners.add(setTypes);
    if (cache) setTypes(cache);
    return () => { listeners.delete(setTypes); };
  }, []);
  return meeting?.m.frozen?.docTypes ?? types;
}
