import {useEffect, useId, useRef, useState} from 'preact/hooks';
import {sortedDocTypes} from '../shared/doctypes.ts';
import {presenterGroups} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, DocType, Presenter} from '../shared/types.ts';
import {request} from './api.ts';
import {useSession} from './session.ts';
import {Button, Fact, Field} from './ui.tsx';

// Osoby przy punkcie porządku (F12) i „Co jest głosowane” (F11): edycja w przygotowaniu, w kafelkach projektu
// porządku i w karcie punktu oraz wyświetlanie faktów „Prowadzi punkt” i „Referuje”.

export const MAX_PRESENTERS = 6;
type Person = {id: string; displayName: string; label: string; kind: string; personId: string | null};

// Konta z /api/people (głos doradczy, goście) pobrane raz. Lista jest pusta dla osób, które nie przygotowują posiedzeń.
let people: Person[] | null = null;
let pending: Promise<Person[]> | null = null;
export function usePeople() {
  const [list, setList] = useState<Person[]>(people ?? []);
  useEffect(() => {
    if (people) { setList(people); return; }
    // Jedno zapytanie na stronę, także po błędzie (pusta lista bez ponownych prób).
    pending ??= request<{accounts: Person[]}>('/api/people').then(r => r.accounts).catch(() => []).then(list => (people = list));
    pending.then(setList);
  }, []);
  return list;
}

/** Podpowiedzi imion i nazwisk z funkcją: najpierw skład organu, potem pozostałe osoby ze składu i konta z funkcją. */
function useSuggestions(organ: string) {
  const s = useSession();
  const accounts = usePeople();
  const out = new Map<string, string>();
  const add = (name: string, role: string) => { if (name && !out.has(name)) out.set(name, role); };
  for (const ms of organMembers(s.roster, organ)) add(s.personName(ms.personId), ms.label);
  for (const ms of s.roster.memberships) if (ms.organ !== organ) add(s.personName(ms.personId), ms.label);
  for (const a of accounts) if (!a.personId && a.kind !== 'biuro') add(a.displayName, a.label);
  return [...out].map(([name, role]) => ({name, role}));
}

const kindOptions: [Presenter['kind'], string][] = [['referuje', 'Referuje'], ['prowadzi', 'Prowadzi punkt']];

/**
 * Lista „Prowadzą i referują”: w każdym wierszu imię i nazwisko (z podpowiedziami; wybrana osoba ze składu wpisuje
 * swoją funkcję sama), funkcja, wybór „Referuje” albo „Prowadzi punkt” i „Usuń osobę”. Najwyżej 6 osób.
 */
export function PresentersEditor(props: {value: Presenter[]; onChange: (value: Presenter[]) => void; organ: string; no?: string}) {
  const id = useId();
  const suggestions = useSuggestions(props.organ);
  const rows = props.value;
  const set = (i: number, patch: Partial<Presenter>) => props.onChange(rows.map((p, j) => j === i ? {...p, ...patch} : p));
  const typeName = (i: number, name: string) => {
    const known = suggestions.find(x => x.name === name.trim());
    set(i, known && !rows[i].role.trim() ? {name, role: known.role} : {name});
  };
  const full = rows.length >= MAX_PRESENTERS;
  // Po „Dodaj osobę” fokus przechodzi na pole imienia i nazwiska w nowym wierszu, a po „Usuń osobę” na „Dodaj osobę”.
  const box = useRef<HTMLDivElement>(null);
  const count = useRef(rows.length);
  useEffect(() => {
    const before = count.current;
    count.current = rows.length;
    if (rows.length > before) [...(box.current?.querySelectorAll<HTMLInputElement>('.person-row input[list]') ?? [])].at(-1)?.focus();
    else if (rows.length < before) box.current?.querySelector<HTMLElement>('.people-add button')?.focus();
  }, [rows.length]);
  return <div class="people-editor" role="group" aria-labelledby={`${id}-t`} ref={box}>
    <span class="oi-field__label" id={`${id}-t`}>Prowadzą i referują</span>
    <datalist id={`${id}-l`}>{suggestions.map(x => <option key={x.name} value={x.name}>{x.role}</option>)}</datalist>
    {rows.length === 0 && <p class="muted small">Nikogo nie wpisano. Dodaj osobę, która referuje sprawę albo prowadzi punkt.</p>}
    {rows.map((p, i) => {
      const who = p.name.trim() || `osoba ${i + 1}`;
      return <div class="person-row" key={i}>
        <div class="row">
          <Field label="Imię i nazwisko"><input list={`${id}-l`} value={p.name} maxLength={120} autocomplete="off" onInput={e => typeName(i, (e.target as HTMLInputElement).value)}/></Field>
          <Field label="Funkcja"><input value={p.role} maxLength={120} onInput={e => set(i, {role: (e.target as HTMLInputElement).value})}/></Field>
        </div>
        <div class="person-tools">
          <div class="oi-seg seg-field" role="group" aria-label={`Rola przy punkcie, ${who}`}>
            {kindOptions.map(([value, label]) => <button key={value} type="button" class="oi-opt" aria-pressed={p.kind === value} onClick={() => set(i, {kind: value})}>{label}</button>)}
          </div>
          <Button kind="ghost" quiet small label={`Usuń osobę, ${who}`} onClick={() => props.onChange(rows.filter((_, j) => j !== i))}>Usuń osobę</Button>
        </div>
      </div>;
    })}
    <div class="people-add"><Button small disabled={full} reason={full ? `Przy punkcie można wpisać najwyżej ${MAX_PRESENTERS} osób.` : undefined}
      label={props.no ? `Dodaj osobę w punkcie ${props.no}` : undefined}
      onClick={() => props.onChange([...rows, {name: '', role: '', kind: 'referuje'}])}>Dodaj osobę</Button></div>
  </div>;
}

/** Osoby bez pustych wierszy, w postaci, w jakiej zapisze je domena (do porównania przed zapisem). */
export const cleanPresenters = (list: Presenter[]) => list.map(p => ({name: p.name.replace(/\s+/g, ' ').trim(), role: p.role.replace(/\s+/g, ' ').trim(), kind: p.kind})).filter(p => p.name || p.role);
export const samePresenters = (a: Presenter[], b: Presenter[]) => JSON.stringify(cleanPresenters(a)) === JSON.stringify(cleanPresenters(b));

/**
 * Fakty „Prowadzi punkt” i „Referuje” z etykietą nad wartością, każda osoba w osobnym wierszu („Imię Nazwisko, Funkcja”).
 * Odmiana `compact` składa się z samych elementów tekstowych, więc może stać w wierszu porządku obrad (także w przycisku).
 */
export function PeopleFacts(props: {it: Pick<AgendaItem, 'presenters'>; compact?: boolean}) {
  const groups = presenterGroups(props.it);
  if (!groups.length) return null;
  if (props.compact) return <span class="people-facts is-compact">
    {groups.map(g => <span class="people-fact" key={g.kind}><span class="people-fact__label">{g.label}</span>{g.people.map((p, i) => <span class="person-line" key={i}>{p}</span>)}</span>)}
  </span>;
  return <dl class="facts people-facts">
    {groups.map(g => <Fact key={g.kind} label={g.label}>{g.people.map((p, i) => <span class="person-line" key={i}>{p}</span>)}</Fact>)}
  </dl>;
}

/**
 * Lista „Co jest głosowane” ze słownika rodzajów (bez wyłączonych, chyba że rodzaj jest już wybrany).
 * `empty` to napis pozycji bez rodzaju, np. „Wynika z materiału”.
 */
export function DocTypeSelect(props: {types: DocType[]; value: string; onChange: (value: string) => void; empty: string; label?: string; hint?: string}) {
  const list = sortedDocTypes(props.types).filter(t => t.active || t.id === props.value);
  return <Field label={props.label ?? 'Co jest głosowane w tym punkcie'} hint={props.hint}>
    <select value={props.value} onChange={e => props.onChange((e.target as HTMLSelectElement).value)}>
      <option value="">{props.empty}</option>
      {list.map(t => <option key={t.id} value={t.id}>{t.name}{t.active ? '' : ' (wyłączony)'}</option>)}
    </select>
  </Field>;
}
