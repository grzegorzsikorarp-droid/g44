import {useEffect, useState} from 'preact/hooks';
import {defaultDocTypes} from '../shared/doctypes.ts';
import type {DocType} from '../shared/types.ts';
import {request} from './api.ts';

// Słownik rodzajów dokumentów (F11) pobrany raz z GET /api/doc-types i wspólny dla wszystkich ekranów. Do czasu
// wczytania (i bez połączenia) obowiązują rodzaje domyślne. Strona „Rodzaje dokumentów” po zapisie podaje nowy słownik.
let cache: DocType[] | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(types: DocType[]) => void>();

export function setDocTypes(types: DocType[]) {
  cache = types;
  for (const listener of listeners) listener(types);
}

function load() {
  loading ??= request<{docTypes: DocType[]}>('/api/doc-types')
    .then(r => setDocTypes(r.docTypes))
    // Bez połączenia zostają rodzaje domyślne i nie ma ponownych prób przy kolejnych ekranach (także po głosie tajnym
    // aplikacja nie wysyła dodatkowych zapytań). Strona „Rodzaje dokumentów” podaje nowy słownik po każdej zmianie.
    .catch(() => setDocTypes(defaultDocTypes))
    .finally(() => { loading = null; });
  return loading;
}

/** Słownik rodzajów dokumentów wspólny dla ekranów. Po zmianie przez administratora nowy słownik podaje setDocTypes. */
export function useDocTypes() {
  const [types, setTypes] = useState<DocType[]>(cache ?? defaultDocTypes);
  useEffect(() => {
    listeners.add(setTypes);
    if (cache) setTypes(cache); else load();
    return () => { listeners.delete(setTypes); };
  }, []);
  return types;
}
