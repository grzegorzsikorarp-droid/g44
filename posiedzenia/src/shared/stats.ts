import type {Ballot, Choice, Meeting, OrganCode, Roster, VoteMode} from './types.ts';
import {organRoster} from './role.ts';
import {dateDots, isoDayOf, timeOf} from './text.ts';
import {csv} from './csv.ts';

// Statystyki obecności i głosowań członków organu (SPEC-4 DB-22, B4-01–B4-21, T-6). Jedna funkcja `memberStats` dla
// serwera i wersji próbnej. Czyta wyłącznie posiedzenia zakończone, skład zapisany przy otwarciu (`organRoster`) i listę
// obecności, a z głosowań tylko w jednym miejscu (`fact`): numer, przedmiot, tryb, uprawnionych, osoby, które oddały głos
// albo pobrały kartę (z tajnego tylko `secret.issued` jako zbiór), osoby, które wyszły bez głosu, wybór w imiennym
// i wybór w jawnym tylko dla samej osoby (`self`). Nie czyta godzin głosowań, wyników, liczby oddanych kart ani magazynu
// kart. W rdzeniu wersji 4 mianownik to skład zapisany przy otwarciu; okresy członkostwa (`roster.periods`) zawężą go
// w dodatku D-14 bez zmiany wyniku dla danych bez okresów. Moduł ładują tylko strony statystyk (B4-21): widok
// posiedzenia, panel, ekran sali i `secret.ts` go nie importują. Wzór: /home/user/przeglad/v4-projekt/proby-B4/stats.ts.

/** APP_RULES 'obecnosc_czesciowa': spóźnienie, wcześniejsze wyjście albo przerwa w obecności dłuższe niż tyle minut. */
export const PARTIAL_MINUTES = 15;
/** Dni RRRR-MM-DD, oba włącznie, liczone od dnia otwarcia posiedzenia (Europe/Warsaw). */
export interface StatsRange { from: string; to: string }
export interface StatsInput {
  meetings: Meeting[]; roster: Roster; range: StatsRange; organ?: OrganCode;
  /** Osoba oglądająca własne statystyki. Bez niej wynik nie zawiera żadnego głosu jawnego. */
  self?: string | null;
  /** Ograniczenie wyniku do wskazanych osób („Moje statystyki”: tylko `self`). */
  only?: string[];
  /** U-41: pierwszy dzień liczenia statystyk z ustawień ogólnych (puste: bez ograniczenia). */
  since?: string;
  /** Kadencja z `frozen.term` (nazwa albo numer); bez niej okres. */
  term?: string;
}
export type AttendanceKind = 'cala' | 'czesciowa' | 'nieobecnosc';
export type PartialReason = 'spoznienie' | 'wyjscie' | 'przerwa' | 'glosowanie';
export interface Tally { held: number; eligible: number; cast: number }
export interface Split { za: number; przeciw: number; wstrzymuje: number }
export interface VoteBlock { held: number; eligible: number; cast: number; jawne: Tally; imienne: Tally & Split; tajne: Tally; own?: Split }
export interface BallotRow { number: number; subject: string; mode: VoteMode; eligible: boolean; cast: boolean; left?: true; choice?: Choice }
export interface AttendanceRow { kind: AttendanceKind; remote: boolean; reasons: PartialReason[]; lateMin?: number; earlyMin?: number; gapMin?: number; unconfirmed?: true }
export interface MeetingRow { meetingId: string; day: string; title: string; kind: 'posiedzenie' | 'procedura'; working: boolean; legacy: boolean; attendance?: AttendanceRow; ballots: BallotRow[] }
export interface PersonStats {
  personId: string; name: string; label: string; current: boolean;
  meetings: {held: number; cala: number; czesciowa: number; nieobecnosc: number; zdalne: number; robocze: number};
  sessionVotes: VoteBlock; procedureVotes: VoteBlock; procedures: number;
  rows: MeetingRow[];
}
export type NoteKind = 'nieogloszone' | 'poza_skladem';
export interface StatsNote { kind: NoteKind; meetingId: string; day: string; personId?: string; ballot?: number }
export interface StatsResult { range: StatsRange; since: string | null; counted: {meetings: number; procedures: number; legacy: number}; persons: PersonStats[]; notes: StatsNote[] }

// ---------------------------------------------------------------------------------------------------------------
// Jedyne miejsce, które czyta głosowanie (Ballot). Test źródła pilnuje, żeby reszta pliku go nie dotykała (B4-T4).
interface Fact {
  number: number; subject: string; mode: VoteMode;
  eligible: ReadonlySet<string>; took: ReadonlySet<string>; left: ReadonlySet<string>;
  named?: ReadonlyMap<string, Choice>; selfChoice?: Choice;
}
const counts = (b: Ballot) => b.purpose !== 'proba' && b.status === 'zamkniete' && !b.aborted;
function fact(b: Ballot, self: string | null): Fact | null {
  if (!counts(b) || !b.announcedAt) return null;
  const took = new Set(b.mode === 'tajne' ? b.secret?.issued ?? [] : Object.keys(b.votes));
  const f: Fact = {number: b.number, subject: b.subject, mode: b.mode, eligible: new Set(b.eligible), took, left: new Set(b.absentDuring.filter(id => !took.has(id)))};
  if (b.mode === 'imienne') f.named = new Map(Object.entries(b.votes));
  if (b.mode !== 'tajne' && self && b.votes[self]) f.selfChoice = b.votes[self];
  return f;
}
const unannouncedNumbers = (m: Meeting) => m.ballots.filter(b => counts(b) && !b.announcedAt).map(b => b.number);
// ---------------------------------------------------------------------------------------------------------------

const MIN = 60000;
const emptyTally = (): Tally => ({held: 0, eligible: 0, cast: 0});
const block = (): VoteBlock => ({held: 0, eligible: 0, cast: 0, jawne: emptyTally(), imienne: {...emptyTally(), za: 0, przeciw: 0, wstrzymuje: 0}, tajne: emptyTally()});
const dayOf = (m: Meeting) => m.openedAt ? isoDayOf(m.openedAt) : m.date;
/** Koniec obrad: zamknięcie, a w danych bez godziny zamknięcia ostatni wpis. */
const endOf = (m: Meeting) => m.closedAt ?? Math.max(m.openedAt ?? 0, ...m.log.map(l => l.at), ...m.presenceLog.map(e => e.at));

/** Obecność na posiedzeniu z listy obecności (B4-06, APP_RULES 'obecnosc_czesciowa'). */
function attendanceOf(m: Meeting, personId: string, facts: Fact[]): AttendanceRow {
  const remote = m.mode === 'zdalne';
  const events = m.presenceLog.filter(e => e.who === personId && !e.guest && (e.type === 'przybycie' || e.type === 'wyjscie'));
  const reported = m.presenceLog.some(e => e.who === personId && !e.guest && (e.type === 'zgloszenie' || e.type === 'odrzucenie'));
  const start = m.openedAt ?? 0, end = endOf(m);
  const spans: [number, number][] = [];
  let open: number | null = null;
  for (const e of events) {
    // F9: godzina zgłoszenia jest godziną przybycia, bo opóźnienie potwierdzenia nie zależy od członka.
    if (e.type === 'przybycie') { if (open === null) open = e.reportedAt ?? e.at; }
    else if (open !== null) { spans.push([open, e.at]); open = null; }
  }
  if (open !== null) spans.push([open, end]);
  const inside = spans.map(([s0, s1]) => [Math.max(s0, start), Math.min(s1, end)] as [number, number]).filter(([s0, s1]) => s1 >= s0);
  if (!inside.length) return {kind: 'nieobecnosc', remote, reasons: [], ...(reported ? {unconfirmed: true as const} : {})};
  const reasons: PartialReason[] = [];
  const late = inside[0][0] - start, early = end - inside.at(-1)![1];
  let gap = 0;
  for (let i = 1; i < inside.length; i++) gap = Math.max(gap, inside[i][0] - inside[i - 1][1]);
  if (late > PARTIAL_MINUTES * MIN) reasons.push('spoznienie');
  if (early > PARTIAL_MINUTES * MIN) reasons.push('wyjscie');
  if (gap > PARTIAL_MINUTES * MIN) reasons.push('przerwa');
  if (facts.some(f => !f.eligible.has(personId) || f.left.has(personId))) reasons.push('glosowanie');
  const row: AttendanceRow = {kind: reasons.length ? 'czesciowa' : 'cala', remote, reasons};
  if (reasons.includes('spoznienie')) row.lateMin = Math.round(late / MIN);
  if (reasons.includes('wyjscie')) row.earlyMin = Math.round(early / MIN);
  if (reasons.includes('przerwa')) row.gapMin = Math.round(gap / MIN);
  return row;
}
function addVotes(target: VoteBlock, f: Fact, personId: string, self: string | null): BallotRow {
  const eligible = f.eligible.has(personId), cast = f.took.has(personId);
  const t = target[f.mode];
  target.held++; t.held++;
  if (eligible) { target.eligible++; t.eligible++; }
  if (cast) { target.cast++; t.cast++; }
  const row: BallotRow = {number: f.number, subject: f.subject, mode: f.mode, eligible, cast};
  if (f.left.has(personId)) row.left = true;
  const named = f.named?.get(personId);
  if (named) { target.imienne[named]++; row.choice = named; }
  if (self === personId && f.selfChoice) {
    target.own ??= {za: 0, przeciw: 0, wstrzymuje: 0};
    if (f.mode === 'jawne') target.own[f.selfChoice]++;
    else if (named) target.own[named]++;
    row.choice = f.selfChoice;
  }
  return row;
}

/** Statystyki osób organu w okresie (B4-01–B4-17). */
export function memberStats(input: StatsInput): StatsResult {
  const organ = input.organ ?? 'prezydium';
  const self = input.self ?? null;
  const since = input.since || null;
  const from = since && since > input.range.from ? since : input.range.from;
  const notes: StatsNote[] = [];
  const persons = new Map<string, PersonStats>();
  const current = organRoster(input.roster, {organ});
  const person = (id: string, label: string) => {
    let p = persons.get(id);
    if (!p) {
      const now = current.find(ms => ms.personId === id);
      p = {personId: id, name: input.roster.persons.find(x => x.id === id)?.name ?? id, label: now?.label ?? label, current: !!now,
        meetings: {held: 0, cala: 0, czesciowa: 0, nieobecnosc: 0, zdalne: 0, robocze: 0}, sessionVotes: block(), procedureVotes: block(), procedures: 0, rows: []};
      persons.set(id, p);
    }
    return p;
  };
  for (const ms of current) if (!input.only || input.only.includes(ms.personId)) person(ms.personId, ms.label);
  const meetings = input.meetings
    .filter(m => m.organ === organ && m.status === 'zakonczone' && m.openedAt)
    .filter(m => !input.term || m.frozen?.term?.name === input.term || m.frozen?.term?.number === input.term)
    .map(m => ({m, day: dayOf(m)}))
    .filter(x => x.day >= from && x.day <= input.range.to && (!since || x.day >= since))
    .sort((x, y) => x.m.openedAt! - y.m.openedAt!);
  const counted = {meetings: 0, procedures: 0, legacy: 0};
  for (const {m, day} of meetings) {
    const procedure = m.kind === 'procedura';
    const legacy = !m.frozen || !!m.frozen.legacy;
    if (procedure) counted.procedures++; else counted.meetings++;
    if (legacy) counted.legacy++;
    for (const number of unannouncedNumbers(m)) notes.push({kind: 'nieogloszone', meetingId: m.id, day, ballot: number});
    const facts = m.ballots.map(b => fact(b, self)).filter((f): f is Fact => !!f);
    const members = organRoster(input.roster, m);
    for (const f of facts) for (const id of new Set([...f.eligible, ...f.took])) {
      if (!members.some(ms => ms.personId === id)) notes.push({kind: 'poza_skladem', meetingId: m.id, day, personId: id, ballot: f.number});
    }
    for (const ms of members) {
      if (input.only && !input.only.includes(ms.personId)) continue;
      const p = person(ms.personId, ms.label);
      const row: MeetingRow = {meetingId: m.id, day, title: m.title, kind: m.kind, working: !!m.working, legacy, ballots: []};
      if (procedure) {
        p.procedures++;
        for (const f of facts) row.ballots.push(addVotes(p.procedureVotes, f, ms.personId, self));
      } else {
        const a = attendanceOf(m, ms.personId, facts);
        row.attendance = a;
        p.meetings.held++;
        p.meetings[a.kind]++;
        if (a.kind !== 'nieobecnosc' && a.remote) p.meetings.zdalne++;
        if (m.working) p.meetings.robocze++;
        for (const f of facts) row.ballots.push(addVotes(p.sessionVotes, f, ms.personId, self));
      }
      p.rows.push(row);
    }
  }
  const order = new Map(current.map(ms => [ms.personId, ms.order]));
  const sortName = (id: string) => input.roster.persons.find(x => x.id === id)?.sortName ?? id;
  const list = [...persons.values()]
    .filter(p => !input.only || input.only.includes(p.personId))
    .sort((x, y) => (order.get(x.personId) ?? 1e6) - (order.get(y.personId) ?? 1e6) || sortName(x.personId).localeCompare(sortName(y.personId), 'pl'));
  return {range: {from, to: input.range.to}, since, counted, persons: list, notes};
}

/** Udział procentowy zaokrąglony do całości; bez mianownika `null` (w interfejsie „–”). */
export const share = (n: number, d: number) => d ? Math.round(100 * n / d) : null;
/** Frekwencja osoby: obecność całą albo częściową wobec posiedzeń, na których była członkiem (B4-07). */
export const turnout = (p: PersonStats) => share(p.meetings.cala + p.meetings.czesciowa, p.meetings.held);

/**
 * Okres z parametrów adresu (B4-14, 6.3): rok (domyślnie bieżący), kadencja z `frozen.term` albo dwie daty włącznie.
 * Błędy dosłownie z 6.3 i 6.9.
 */
export function statsRangeInput(q: {od?: string | null; do?: string | null; kadencja?: string | null; rok?: string | null}, today: string): {range: StatsRange; term?: string} | {error: string} {
  if (q.kadencja) return {range: {from: '0000-01-01', to: '9999-12-31'}, term: q.kadencja};
  if (q.od || q.do) {
    const ok = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
    if (!ok(q.od) || !ok(q.do)) return {error: 'Wpisz datę początku i końca okresu.'};
    if (q.od! > q.do!) return {error: 'Początek okresu nie może być późniejszy niż koniec.'};
    return {range: {from: q.od!, to: q.do!}};
  }
  const year = q.rok && /^\d{4}$/.test(q.rok) ? q.rok : today.slice(0, 4);
  return {range: {from: `${year}-01-01`, to: `${year}-12-31`}};
}
/** Linia źródła na ekranie, wydruku i w pierwszym wierszu CSV (K4-37, 6.3). */
export function statsSourceLines(r: StatsResult, at: number): string[] {
  const lines = [`Stan na ${dateDots(isoDayOf(at))}, godz. ${timeOf(at)}. Liczone z posiedzeń zakończonych i głosowań z ogłoszonym wynikiem.`];
  if (r.since) lines.push(`Statystyki liczą posiedzenia od ${dateDots(r.since)} (ustawienia ogólne).`);
  if (r.counted.legacy) lines.push('Dla posiedzeń sprzed wersji 3 skład pochodzi z chwili przejścia na wersję 3, tak jak w projekcie protokołu.');
  return lines;
}
const attendanceWord: Record<AttendanceKind, string> = {cala: 'Obecność przez całe obrady', czesciowa: 'Obecność częściowa', nieobecnosc: 'Nieobecność'};
const reasonText = (a: AttendanceRow) => [
  a.reasons.includes('spoznienie') ? `spóźnienie ${a.lateMin} min` : '', a.reasons.includes('wyjscie') ? `wyjście ${a.earlyMin} min przed końcem` : '',
  a.reasons.includes('przerwa') ? `przerwa w obecności ${a.gapMin} min` : '', a.reasons.includes('glosowanie') ? 'nieobecność przy głosowaniu' : '',
  a.unconfirmed ? 'zgłoszenie bez potwierdzenia' : '',
].filter(Boolean).join(', ');
const choiceWord: Record<Choice, string> = {za: 'za', przeciw: 'przeciw', wstrzymuje: 'wstrzymanie się'};
/**
 * CSV statystyk (B4-24). „Moje statystyki”: jeden wiersz na głosowanie (posiedzenie bez głosowań to jeden wiersz), z linią
 * źródła w pierwszym wierszu; głos tylko z jawnych i imiennych. „Statystyki składu” (dodatek D-13): jeden wiersz na osobę.
 */
export function statsCsv(r: StatsResult, kind: 'moje' | 'sklad', at: number): string {
  const lead = statsSourceLines(r, at);
  if (kind === 'moje') {
    const p = r.persons[0];
    const rows: (string | number)[][] = [];
    for (const row of p?.rows ?? []) {
      const base = [row.day, row.kind === 'procedura' ? 'głosowanie między posiedzeniami' : row.working ? 'spotkanie robocze' : 'posiedzenie', row.title,
        row.attendance ? attendanceWord[row.attendance.kind] : '', row.attendance ? reasonText(row.attendance) : '',
        row.attendance ? [row.attendance.lateMin, row.attendance.earlyMin, row.attendance.gapMin].filter(x => x !== undefined).join(', ') : ''];
      if (!row.ballots.length) { rows.push([...base, '', '', '', '', '']); continue; }
      for (const x of row.ballots) rows.push([...base, x.number, x.mode, x.eligible ? 'tak' : 'nie', x.mode === 'tajne' ? (x.cast ? 'karta pobrana' : 'karta niepobrana') : x.cast ? 'głos oddany' : x.left ? 'wyjście w trakcie głosowania' : 'bez głosu', x.mode !== 'tajne' && x.choice ? choiceWord[x.choice] : '']);
    }
    return csv(['Dzień', 'Rodzaj', 'Tytuł', 'Obecność', 'Powód obecności częściowej', 'Minuty', 'Głosowanie nr', 'Tryb', 'Prawo głosu', 'Udział', 'Głos'], rows, lead);
  }
  return csv(['Imię i nazwisko', 'Funkcja', 'Członkostwo do', 'Posiedzenia', 'Obecność przez całe obrady', 'Obecność częściowa', 'Nieobecność', 'W tym zdalnie', 'W tym spotkania robocze', 'Frekwencja (%)',
    'Głosowania odbyte', 'Prawo głosu', 'Głos oddany albo karta', 'Jawne prawo głosu', 'Jawne głos oddany', 'Imienne prawo głosu', 'Imienne głos oddany', 'Imienne za', 'Imienne przeciw', 'Imienne wstrzymanie się',
    'Tajne prawo głosu', 'Tajne karta pobrana', 'Między posiedzeniami prawo głosu', 'Między posiedzeniami głos albo karta'],
  r.persons.map(p => [p.name, p.label, '', p.meetings.held, p.meetings.cala, p.meetings.czesciowa, p.meetings.nieobecnosc, p.meetings.zdalne, p.meetings.robocze, turnout(p) ?? '',
    p.sessionVotes.held, p.sessionVotes.eligible, p.sessionVotes.cast, p.sessionVotes.jawne.eligible, p.sessionVotes.jawne.cast, p.sessionVotes.imienne.eligible, p.sessionVotes.imienne.cast,
    p.sessionVotes.imienne.za, p.sessionVotes.imienne.przeciw, p.sessionVotes.imienne.wstrzymuje, p.sessionVotes.tajne.eligible, p.sessionVotes.tajne.cast, p.procedureVotes.eligible, p.procedureVotes.cast]), lead);
}
/** Statystyki składu bez rozkładu głosów i bez wierszy (dodatek D-13): to, co mogą dostać osoby z `canSeeRosterStats`. */
export function rosterView(r: StatsResult): StatsResult {
  return {...r, persons: r.persons.map(p => ({...p, rows: [], sessionVotes: {...p.sessionVotes, own: undefined}, procedureVotes: {...p.procedureVotes, own: undefined}}))};
}

/**
 * Dodatek D-13 (B4-23–B4-26, DB-23, T-6): „Statystyki składu” wszystkich osób bez wierszy i bez głosów jawnych; uwagi
 * „Do sprawdzenia” tylko dla osób z `seesStatsNotes` (biuro, przewodniczący), bez wydruku i CSV.
 */
export function rosterStats(input: Omit<StatsInput, 'self' | 'only'>, o: {notes: boolean}): StatsResult {
  const r = rosterView(memberStats({...input, self: null}));
  return o.notes ? r : {...r, notes: []};
}
/** „Posiedzenia po kolei” jednej osoby (B4-26): wiersze z obecnością i udziałem, wybór tylko z głosowań imiennych. */
export function rosterPersonStats(input: Omit<StatsInput, 'self' | 'only'>, personId: string, o: {notes: boolean}): StatsResult {
  const r = memberStats({...input, self: null, only: [personId]});
  return {...r, persons: r.persons.map(p => ({...p, sessionVotes: {...p.sessionVotes, own: undefined}, procedureVotes: {...p.procedureVotes, own: undefined}})),
    notes: o.notes ? r.notes.filter(n => !n.personId || n.personId === personId) : []};
}
/** Frekwencja składu w okresie (B4-07): suma obecności wobec sumy miejsc w składach posiedzeń. */
export function rosterTurnout(r: StatsResult): {present: number; places: number; percent: number | null} {
  const present = r.persons.reduce((n, p) => n + p.meetings.cala + p.meetings.czesciowa, 0), places = r.persons.reduce((n, p) => n + p.meetings.held, 0);
  return {present, places, percent: share(present, places)};
}
/** Nazwy plików „Statystyk składu” (B4-24, B1-07), bez imion i nazwisk. */
export const rosterFileName = (r: StatsResult, ext: 'csv' | 'html') => `${r.range.from === '0000-01-01' ? 'kadencja' : r.range.from}_${r.range.to === '9999-12-31' ? 'kadencja' : r.range.to}-prezydium-statystyki-skladu.${ext}`;
