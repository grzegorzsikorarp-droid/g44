import type {Account, AgendaItem, DocType, ItemKind, LogEntry, Meeting, Roster} from './types.ts';
import {agendaBasis, isLockedDocType, type LegalProfile} from './law.ts';
import {completeAgenda} from './agenda.ts';
import {freezeLegacy, type CascadeEnv} from './cascade.ts';
import {defaultCommsLevel, type AuditEntry} from './settings.ts';
import {commsLevels} from './comms.ts';

// Wczytanie posiedzenia zapisanego przed wersją 2 (decyzje zleceniodawcy z 19.11.2026). Zmiana jest idempotentna
// i działa w miejscu: serwer stosuje ją przy każdym odczycie z bazy, a wersja próbna przy odczycie z localStorage.
// - F12: pole `presenter` (napis) staje się listą `presenters`; niepusty napis to jedna osoba referująca.
// - F11: materiał rodzaju „oswiadczenie”, którego tytuł zaczyna się od „Stanowisko”, dostaje rodzaj „stanowisko”.
// - F7: głosowanie przerwane traci wybory (`votes`), a lista głosujących w jawnym trafia do `aborted.voters`.
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
  // F7: głosowanie przerwane bez rozstrzygnięcia nie zachowuje wyborów; w jawnym zostaje lista głosujących.
  for (const b of m.ballots) {
    if (!b.aborted || !Object.keys(b.votes ?? {}).length) continue;
    if (!b.secret) b.aborted.voters ??= Object.keys(b.votes).sort();
    b.votes = {};
  }
  return m;
}

// Wersja 3 (specyfikacja, rozdz. 2.10): jednorazowa migracja danych przy pierwszym starcie. Serwer wykonuje ją pod
// kluczem meta 'ustawienia-v3', wersja próbna przy wczytaniu stanu bez znacznika `v3`. Każde zmienione posiedzenie
// trzeba zapisać, a drugi przebieg niczego już nie zmienia. Migracja przy odczycie (migrateMeeting) zostaje bez zmian.

/** Dawne brzmienie podstawy zastępstwa wpisanego przez przewodniczącego w wersji 2 (src/shared/meeting.ts). */
export const chairmanDeputyBasisV2 = 'wyznaczenie przez przewodniczącego (§ 16)';

/**
 * Posiedzenie po przejściu na wersję 3. Trwające, w przerwie i zakończone bez zamrożenia dostają `frozen` z `legacy`
 * (wartości domyślne, skład i słownik z chwili migracji). Posiedzenia w przygotowaniu tracą zastępcę wpisanego przez
 * biuro (bez `deputySet` i z podstawą inną niż dawne brzmienie przewodniczącego), dostają brakujące osoby z głosem
 * doradczym i brakujące punkty wymagane niezmiennikiem porządku. Zwraca true, gdy coś zmieniono.
 */
export function migrateMeetingV3(m: Meeting, input: {now: number; env: CascadeEnv; advisory: string[]; newId: () => string; titles?: Partial<Record<ItemKind, string>>}): boolean {
  if (m.frozen) return false;
  const {now, env} = input;
  if (m.status !== 'przygotowanie') {
    m.frozen = freezeLegacy(env, m, now);
    return true;
  }
  let changed = false;
  const note = (text: string, extra: Partial<LogEntry> = {}) => { m.log.push({at: now, text, by: 'system', ...extra}); changed = true; };
  if (m.chair.deputy && !m.chair.deputySet && m.chair.deputyBasis && m.chair.deputyBasis !== chairmanDeputyBasisV2) {
    m.chair.deputy = null;
    m.chair.deputyBasis = '';
    note('Usunięto zastępstwo wpisane przez biuro. Zastępcę wyznacza przewodniczący (§ 16 ust. 2).', {tag: 'ustawienia'});
  }
  const missing = input.advisory.filter(id => !m.invited.includes(id));
  if (missing.length) {
    m.invited = [...m.invited, ...missing];
    note('Dodano osoby z głosem doradczym zawiadamiane o każdym posiedzeniu (§ 7 ust. 2).', {tag: 'ustawienia'});
  }
  for (const it of completeAgenda(env.law, m, input.newId, input.titles)) {
    note(`Uzupełniono projekt porządku obrad o punkt „${it.title}” wymagany regulaminem (${agendaBasis(env.law, it.kind)}).`, {tag: 'projekt', itemId: it.id});
  }
  return changed;
}

/**
 * Rodzaje dokumentów po przejściu na wersję 3: „W wykazie aktów” dla uchwały, a formy aktów z regulaminu z wyłączonym
 * głosowaniem albo wyłączone wracają do stanu z regulaminu (G-1). Zwraca słownik i wpisy historii zmian.
 */
export function migrateDocTypesV3(types: DocType[], law: LegalProfile, now: number): {docTypes: DocType[]; audit: Omit<AuditEntry, 'id'>[]} {
  const audit: Omit<AuditEntry, 'id'>[] = [];
  const docTypes = types.map(t => {
    const out: DocType = {...t, inActs: typeof t.inActs === 'boolean' ? t.inActs : t.id === 'uchwala'};
    if (t.id === 'uchwala') out.inActs = true;
    if (isLockedDocType(t.id, law) && (!t.voted || !t.active)) {
      out.voted = true; out.active = true;
      audit.push({at: now, accountId: '', actor: 'Aplikacja', area: 'rodzaje_dokumentow', key: `rodzaj:${t.id}`, label: `Rodzaj dokumentu „${t.name}”`,
        before: `${t.voted ? 'wymaga głosowania' : 'bez głosowania'}, ${t.active ? 'włączony' : 'wyłączony'}`, after: `Przywrócono wymóg głosowania (${law.acts.voted[t.id]}).`});
    }
    return out;
  });
  return {docTypes, audit};
}

/** Wpisy historii zmian o rolach przy przejściu na wersję 3 (DA-2, DA-4). */
export function migrationNotesV3(accounts: Pick<Account, 'kind' | 'admin' | 'displayName' | 'personId'>[], roster: Roster, now: number): Omit<AuditEntry, 'id'>[] {
  const entry = (text: string): Omit<AuditEntry, 'id'> => ({at: now, accountId: '', actor: 'Aplikacja', area: 'konta', key: 'wersja-3', label: 'Przejście na wersję 3', before: '', after: text});
  const out = [entry('Konta biura mają dostęp do ustawień ogólnych (wersja 3).')];
  for (const a of accounts) {
    if (!a.admin || a.kind !== 'czlonek') continue;
    const name = a.personId ? roster.persons.find(p => p.id === a.personId)?.name ?? a.displayName : a.displayName;
    out.push(entry(`Uprawnienia administratora konta ${name} nie dają już uprawnień biura w posiedzeniach (wersja 3).`));
  }
  return out;
}

// Wersja 4 (SPEC-4 2.3, DB-28): jedna migracja jednorazowa pod kluczem meta 'wersja-4' (wersja próbna: `state.v4`).
// Znacznik `frozen.v4` NIE trafia do żadnego istniejącego posiedzenia (dopisuje go dopiero `freeze()` przy otwarciu),
// więc projekty protokołów posiedzeń sprzed wersji 4 zostają bez zmian (DB-4). Migracja przy odczycie (migrateMeeting)
// pól wersji 4 nie dotyka.

/** Rodzaje dokumentów z poziomem w materiale dla komunikacji (U-24) tam, gdzie kolumna jest pusta. */
export function migrateDocTypesV4(types: DocType[]): {docTypes: DocType[]; changed: boolean} {
  let changed = false;
  const docTypes = types.map(t => {
    if (t.comms) return t;
    changed = true;
    return {...t, comms: defaultCommsLevel(t)};
  });
  return {docTypes, changed};
}
/**
 * Posiedzenie po przejściu na wersję 4: kadencja przy otwarciu (`frozen.term`, DB-37) z bieżących ustawień ogólnych dla
 * posiedzeń z `frozen` bez kadencji oraz poziomy materiału dla komunikacji utrwalone (`closedComms`, DB-41) dla posiedzeń
 * zakończonych bez tego pola, według wartości domyślnych. Zwraca true, gdy coś zmieniono (wtedy trzeba zapisać posiedzenie
 * z `revision + 1`). Drugi przebieg niczego nie zmienia.
 */
export function migrateMeetingV4(m: Meeting, env: Pick<CascadeEnv, 'general' | 'docTypes'>): boolean {
  let changed = false;
  if (m.frozen && !m.frozen.term) {
    m.frozen.term = {name: env.general.site.term, number: env.general.site.termNumber};
    changed = true;
  }
  if (m.status === 'zakonczone' && !m.closedComms) {
    m.closedComms = commsLevels({...m, status: 'trwa'}, env);
    changed = true;
  }
  return changed;
}
/** Wpisy historii zmian migracji wersji 4 (rozdz. 2.3), każdy raz. */
export function migrationNotesV4(now: number): Omit<AuditEntry, 'id'>[] {
  const entry = (area: AuditEntry['area'], text: string): Omit<AuditEntry, 'id'> => ({at: now, accountId: '', actor: 'Aplikacja', area, key: 'wersja-4', label: 'Przejście na wersję 4', before: '', after: text});
  return [
    entry('rodzaje_dokumentow', 'Rodzaje dokumentów mają poziom w materiale dla komunikacji (wersja 4).'),
    entry('posiedzenia', 'Posiedzenia mają zapisaną kadencję (wersja 4).'),
    entry('posiedzenia', 'Zakończone posiedzenia mają utrwalone poziomy materiału dla komunikacji (wersja 4).'),
    entry('poczta', 'Poczta e-mail jest wyłączona do czasu ustawienia przez biuro (wersja 4).'),
  ];
}
