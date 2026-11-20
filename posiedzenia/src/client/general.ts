import {useEffect, useState} from 'preact/hooks';
import type {GeneralBundle} from '../shared/settings.ts';
import type {DocType} from '../shared/types.ts';
import {setDocTypes} from './doctypes.ts';

// Ustawienia ogólne (wersja 3, poziom 1 kaskady) z danych sesji: GET /api/session zwraca `general` dla biura,
// przewodniczącego i wiceprzewodniczących, a dla pozostałych null. Klient nie robi po nie dodatkowych zapytań.
// Po zmianie przez biuro (POST /api/settings, /api/composition, /api/doc-types) nowy pakiet podaje setGeneral.
let current: GeneralBundle | null = null;
const listeners = new Set<(bundle: GeneralBundle | null) => void>();

export function setGeneral(bundle: GeneralBundle | null) {
  current = bundle;
  if (bundle) setDocTypes(bundle.docTypes);
  for (const listener of listeners) listener(bundle);
}
/** Pakiet ustawień ogólnych bez subskrypcji (np. w obsłudze zdarzeń). */
export const generalNow = () => current;

/** Ustawienia ogólne z sesji albo null (osoba bez dostępu, wersja 2 serwera). */
export function useGeneral(): GeneralBundle | null {
  const [bundle, setBundle] = useState<GeneralBundle | null>(current);
  useEffect(() => {
    listeners.add(setBundle);
    setBundle(current);
    return () => { listeners.delete(setBundle); };
  }, []);
  return bundle;
}

/** Dane sesji: ustawienia ogólne i słownik rodzajów dokumentów (wywołuje powłoka aplikacji po GET /api/session). */
export function acceptSession(info: {general?: GeneralBundle | null; docTypes?: DocType[] | null}) {
  if (info.docTypes) setDocTypes(info.docTypes);
  setGeneral(info.general ?? null);
}
