import type {DocType} from './types.ts';
import {isLockedDocType, LAW, type LegalProfile} from './law.ts';

// Słownik rodzajów dokumentów (F11). Biuro (od wersji 3; wcześniej administrator) dodaje rodzaje, zmienia nazwy, formuły
// wyniku, kolejność, wykaz aktów i to, czy sprawa danego rodzaju wymaga głosowania. Rodzaju użytego w materiale albo
// głosowaniu nie da się usunąć, można go tylko wyłączyć. Formy aktów z regulaminu (law.acts.voted) zawsze wymagają
// głosowania, są włączone i nie da się ich usunąć (G-1). Identyfikatory domyślnych rodzajów są zgodne z dawną stałą listą.
export const defaultDocTypes: DocType[] = ([
  ['uchwala', 'Uchwała', 'Uchwała podjęta', 'Uchwała nie została podjęta', true],
  ['stanowisko', 'Stanowisko', 'Stanowisko przyjęte', 'Stanowisko nie zostało przyjęte', true],
  ['oswiadczenie', 'Oświadczenie', 'Oświadczenie przyjęte', 'Oświadczenie nie zostało przyjęte', true],
  ['apel', 'Apel', 'Apel przyjęty', 'Apel nie został przyjęty', true],
  ['rezolucja', 'Rezolucja', 'Rezolucja przyjęta', 'Rezolucja nie została przyjęta', true],
  ['deklaracja', 'Deklaracja', 'Deklaracja przyjęta', 'Deklaracja nie została przyjęta', true],
  ['sprawozdanie', 'Sprawozdanie', 'Sprawozdanie przyjęte', 'Sprawozdanie nie zostało przyjęte', true],
  ['protokol', 'Protokół', 'Protokół przyjęty', 'Protokół nie został przyjęty', true],
  ['informacja', 'Informacja', 'Przyjęto', 'Nie przyjęto', false],
  ['inny', 'Inny materiał', 'Przyjęto', 'Nie przyjęto', false],
] as [string, string, string, string, boolean][]).map(([id, name, adopted, rejected, voted], i) => ({id, name, adopted, rejected, voted, order: (i + 1) * 10, active: true, inActs: id === 'uchwala'}));

/** Formuły wyniku sprawy bez rodzaju dokumentu. */
export const plainFormulas = {adopted: 'Przyjęto', rejected: 'Nie przyjęto'};

export const docTypeById = (types: DocType[], id: string | null | undefined) => id ? types.find(t => t.id === id) : undefined;
/** Nazwa rodzaju dokumentu, np. „Stanowisko”; nieznany rodzaj to „Materiał”. */
export const docTypeName = (id: string | null | undefined, types: DocType[] = defaultDocTypes) => docTypeById(types, id)?.name ?? 'Materiał';
/** Rodzaje w kolejności ze słownika; z `onlyActive` bez wyłączonych. */
export const sortedDocTypes = (types: DocType[], onlyActive = false) => [...types].filter(t => !onlyActive || t.active).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pl'));

const bad = (message: string, status = 400): never => { throw Object.assign(new Error(message), {status}); };
const text = (value: unknown, missing: string, tooLong: string, max: number) => {
  const v = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!v) bad(missing);
  if (v.length > max) bad(tooLong);
  return v;
};

/** Odmowa zmiany formy aktu z regulaminu (G-1) z podstawą właściwą dla rodzaju. */
export const lockedDocTypeRefusal = (id: string, law: LegalProfile = LAW.prezydium) => `Ten rodzaj zawsze wymaga głosowania (${law.acts.voted[id]}). Możesz zmienić tylko nazwę i formuły wyniku.`;

/**
 * Sprawdza dane rodzaju dokumentu z formularza biura (POST albo PUT). Przy zmianie (`current`) pola,
 * których nie podano, zostają bez zmian. Zwraca kompletny rodzaj. Forma aktu z regulaminu nie traci wymogu głosowania
 * i nie może być wyłączona (G-1); nowy rodzaj z identyfikatorem formy aktu dostaje te same zasady.
 */
export function docTypeInput(input: Record<string, unknown>, types: DocType[], current?: DocType, law: LegalProfile = LAW.prezydium): DocType {
  const has = (k: string) => input[k] !== undefined;
  const name = has('name') || !current ? text(input.name, 'Wpisz nazwę rodzaju.', 'Nazwa rodzaju może mieć najwyżej 60 znaków.', 60) : current.name;
  if (types.some(t => t.id !== current?.id && t.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) bad('Rodzaj o tej nazwie już istnieje. Wpisz inną nazwę.', 409);
  const adopted = has('adopted') || !current ? text(input.adopted, 'Wpisz formułę wyniku, gdy sprawę przyjęto.', 'Formuła wyniku może mieć najwyżej 120 znaków.', 120) : current.adopted;
  const rejected = has('rejected') || !current ? text(input.rejected, 'Wpisz formułę wyniku, gdy sprawy nie przyjęto.', 'Formuła wyniku może mieć najwyżej 120 znaków.', 120) : current.rejected;
  if (has('voted') && typeof input.voted !== 'boolean') bad('Zaznacz, czy sprawa tego rodzaju wymaga głosowania.');
  if (has('active') && typeof input.active !== 'boolean') bad('Nieprawidłowy stan rodzaju.');
  if (has('order') && !(Number.isInteger(input.order) && (input.order as number) >= 0 && (input.order as number) <= 9999)) bad('Kolejność musi być liczbą całkowitą od 0 do 9999.');
  if (has('inActs') && typeof input.inActs !== 'boolean') bad('Zaznacz, czy rodzaj stoi w wykazie aktów protokołu.');
  const last = types.reduce((max, t) => Math.max(max, t.order), 0);
  const id = current?.id ?? newDocTypeId(name, types);
  if (isLockedDocType(id, law) && ((has('voted') && input.voted !== true) || (has('active') && input.active !== true))) bad(lockedDocTypeRefusal(id, law));
  return {
    id, name, adopted, rejected,
    voted: has('voted') ? input.voted as boolean : current?.voted ?? true,
    order: has('order') ? input.order as number : current?.order ?? last + 10,
    active: has('active') ? input.active as boolean : current?.active ?? true,
    inActs: has('inActs') ? input.inActs as boolean : current?.inActs ?? false,
  };
}

// Identyfikator z nazwy: małe litery bez polskich znaków, cyfry i podkreślenia, np. „Opinia prawna” daje „opinia_prawna”.
function newDocTypeId(name: string, types: DocType[]) {
  const base = name.toLocaleLowerCase('pl').replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)])
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'rodzaj';
  let id = base, n = 2;
  while (types.some(t => t.id === id)) id = `${base}_${n++}`;
  return id;
}
