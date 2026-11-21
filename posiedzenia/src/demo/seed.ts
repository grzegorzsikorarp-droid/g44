import {addDisplay, addFiled, advance, apply, createMeeting, secretCast, secretIssue, type Command, type Context, type SecretHooks} from '../shared/meeting.ts';
import {newItem} from '../shared/agenda.ts';
import {textToHtml} from '../shared/text.ts';
import {applyCompositionChange, defaultGeneral, organSettingsOf, type AuditEntry, type GeneralBundle, type GeneralSettings, type SiteSettings} from '../shared/settings.ts';
import {applyPrep, emptySpace, type PrepCommand, type PrepSpace} from '../shared/workspace.ts';
import {closedRefs} from '../shared/catalog.ts';
import {freezeLegacy, cascadeEnv} from '../shared/cascade.ts';
import {migrateMeetingV4} from '../shared/migrate.ts';
import {defaultDocTypes} from '../shared/doctypes.ts';
import {LAW} from '../shared/law.ts';
import {DEFAULT_INTROS, defaultPrefs, type EmailState, type MailPrefs, type MailSettings} from '../shared/mail.ts';
import {sha256} from '../shared/sha256.ts';
import {bytesToHex} from '../shared/blind.ts';
import type {Account, Actor, Choice, DisplayFile, DocType, MaterialRef, MaterialType, Meeting, Presenter, Roster} from '../shared/types.ts';

// Dane fikcyjne wersji próbnej — żadna z tych osób nie istnieje.
// Wersja 4 (SPEC-4 7.2): jeden zestaw danych dla dokumentów, przygotowania, poczty, pokazu i statystyk. Posiedzenia
// zakończone powstają tymi samymi poleceniami domeny co w aplikacji (na zegarze z dniami z tabeli 7.2), więc lista
// obecności, dziennik, głosowania i utrwalone poziomy materiału dla komunikacji są takie, jakie dałby serwer.
const people: [string, string, string, string, boolean][] = [
  ['p1', 'Barbara Wiśniewska', 'przewodniczacy', 'Przewodnicząca', true],
  ['p2', 'Tomasz Lewandowski', 'wiceprzewodniczacy', 'I Wiceprzewodniczący', true],
  ['p3', 'Ewa Dąbrowska', 'wiceprzewodniczacy', 'II Wiceprzewodnicząca', true],
  ['p4', 'Marta Kaczmarek', 'sekretarz', 'Sekretarz', false],
  ['p5', 'Paweł Zieliński', 'skarbnik', 'Skarbnik', false],
  ['p6', 'Joanna Szymańska', 'czlonek', 'Członek Prezydium', false],
  ['p7', 'Agnieszka Wójcik', 'czlonek', 'Członek Prezydium', false],
];
/** Wersja 4 (7.2): osoba dopisana do składu 01.04.2026. */
const joined: [string, string, string, string, boolean] = ['p8', 'Karolina Mazur', 'czlonek', 'Członek Prezydium', false];
/** Wersja 4 (7.2): osoba z końcem członkostwa 20.05.2026, wpisanym w składzie później (10.06.2026). */
const LEFT = 'p7';
const login = (name: string) => name.toLowerCase().replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]).replace(/\s+/g, '.');

/** Nazwy organów w wersji próbnej: fikcyjne, bez nazwy miejscowości. */
const demoForms = {
  prezydium: {genitive: 'Prezydium Okręgowej Rady (dane fikcyjne)', dative: 'Prezydium Okręgowej Rady (dane fikcyjne)', gender: 'n' as const,
    members: 'członków Prezydium', member: 'członek Prezydium', chairman: 'Przewodniczący Okręgowej Rady (dane fikcyjne)',
    regulation: 'Regulaminu Okręgowej Rady (dane fikcyjne)', regulationAct: 'załącznik do uchwały zjazdu (dane fikcyjne)'},
  rada: {genitive: 'Okręgowej Rady (dane fikcyjne)', dative: 'Okręgowej Radzie (dane fikcyjne)', gender: 'f' as const,
    members: 'członków Okręgowej Rady (dane fikcyjne)', member: 'członek Okręgowej Rady (dane fikcyjne)', chairman: 'Przewodniczący Okręgowej Rady (dane fikcyjne)',
    regulation: 'Regulaminu Okręgowej Rady (dane fikcyjne)', regulationAct: 'załącznik do uchwały zjazdu (dane fikcyjne)'},
};
/** Skład fikcyjny od początku kadencji fikcyjnej, z podstawą (wersja 3). */
const demoBasis = {kind: 'uchwala' as const, act: {organ: 'rada' as const, number: '12/I/2025', date: '2025-04-10'}};
const organs: Roster['organs'] = [
  {code: 'prezydium', name: 'Prezydium Okręgowej Rady (dane fikcyjne)', shortName: 'Prezydium', active: true, forms: demoForms.prezydium},
  {code: 'rada', name: 'Okręgowa Rada (dane fikcyjne)', shortName: 'Rada', active: false, forms: demoForms.rada},
];
const persons = [...people, joined].map(([id, name]) => ({id, name, sortName: name.split(' ').reverse().join(' ')}));
const membershipOf = ([personId, , func, label, canChair]: (typeof people)[number], order: number, since = '2025-04-10', basis: Roster['memberships'][number]['basis'] = demoBasis) =>
  ({organ: 'prezydium' as const, personId, func: func as never, label, order, canChair, since, basis});

/** Skład do 31.03.2026 (posiedzenie sprzed wersji 3 i posiedzenie 1). */
const rosterEarly: Roster = {organs, persons, memberships: people.map((p, i) => membershipOf(p, i))};

export const demoAccounts: Account[] = [
  ...[...people, joined].map(([personId, name]) => ({id: 'a-' + personId, username: login(name), kind: 'czlonek' as const, personId, displayName: name, label: '', admin: false, mustChange: false, disabled: false})),
  {id: 'a-biuro', username: 'biuro', kind: 'biuro', personId: null, displayName: 'Biuro', label: 'Obsługa posiedzeń', admin: true, mustChange: false, disabled: false},
  {id: 'a-kr', username: 'komisja.rewizyjna', kind: 'doradczy', personId: null, displayName: 'Halina Kowalczyk', label: 'Przewodnicząca Okręgowej Komisji Rewizyjnej', admin: false, mustChange: false, disabled: false},
  // Wersja 4 (4.4, 7.2): konto komunikacji widzi tylko odbyte posiedzenia, odnośniki do zdjęć i materiały dla komunikacji.
  {id: 'a-komunikacja', username: 'komunikacja', kind: 'komunikacja', personId: null, displayName: 'Komunikacja (dane fikcyjne)', label: '', admin: false, mustChange: false, disabled: false},
];
const office: Actor = {account: demoAccounts.find(a => a.id === 'a-biuro')!, personId: null, name: 'Biuro'};
const person = (id: string): Actor => ({account: demoAccounts.find(a => a.personId === id)!, personId: id, name: persons.find(p => p.id === id)!.name});

/** Ustawienia ogólne wersji próbnej: miejsce i kadencja fikcyjne, rodzaje spraw, wzór „Posiedzenie zwykłe”, poczta w trybie próby. */
export const demoSite: SiteSettings = {place: 'Sala posiedzeń (przykład)', term: 'I kadencja 2025–2029', termNumber: 'I', protocolNumberPattern: ''};
/** Poczta wersji próbnej (7.2): wysyłka włączona w trybie próby, każda wiadomość trafia do „Skrzynki (próba)”. */
export const demoMail: MailSettings = {
  enabled: true, host: 'smtp.example.org', port: 465, security: 'tls', user: 'posiedzenia@example.org', fromAddress: 'posiedzenia@example.org',
  fromName: 'Posiedzenia (przykład)', replyTo: 'biuro@example.org', privacyUrl: 'https://example.org/klauzula', controller: 'Administrator przykładowy',
  intros: {...DEFAULT_INTROS},
};
/** Adres aplikacji w wiadomościach wersji próbnej (K4-16). */
export const DEMO_APP_URL = 'https://example.org/posiedzenia';
export function demoGeneral(): GeneralSettings {
  const general = defaultGeneral(demoSite);
  general.caseTypes = [
    // Wersja 4 (7.2): trzy rodzaje spraw z poziomami w materiale dla komunikacji.
    {id: 'patronat', name: 'Patronat', docType: 'uchwala', organs: ['prezydium'], financial: false,
      keywords: ['patronat'], titlePattern: 'Uchwała nr … w sprawie objęcia patronatem', order: 5, active: true, comms: 'tytul'},
    {id: 'prawo_wykonywania_zawodu', name: 'Stwierdzenie prawa wykonywania zawodu', docType: 'uchwala', organs: ['prezydium'], financial: false,
      keywords: ['prawa wykonywania zawodu', 'pwz'], titlePattern: 'Uchwała nr … w sprawie stwierdzenia prawa wykonywania zawodu', presenterFunc: 'sekretarz', order: 10, active: true, comms: 'liczba'},
    {id: 'pomoc_losowa', name: 'Pomoc w przypadkach losowych', docType: 'uchwala', organs: ['prezydium'], financial: true,
      keywords: ['zapomoga', 'zdarzenie losowe'], titlePattern: 'Uchwała nr … w sprawie przyznania zapomogi', presenterFunc: 'skarbnik', order: 20, active: true, comms: 'pomin'},
  ];
  general.mail = structuredClone(demoMail);
  return general;
}
/** Słownik rodzajów dokumentów z poziomem w materiale dla komunikacji (wersja 4). */
export const demoDocTypes = (): DocType[] => structuredClone(defaultDocTypes);

const licence = (no: string, who: string, number: string) => `Uchwała nr ${no}/IX/2026
Prezydium Okręgowej Rady
z dnia 22 października 2026 r.
w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki

Na podstawie art. 3 ust. 1 ustawy z dnia 15 lipca 2011 r. o zawodach pielęgniarki i położnej uchwala się, co następuje:

§ 1
Stwierdza się prawo wykonywania zawodu pielęgniarki: ${who}, numer ${number} (dane fikcyjne).

§ 2
Uchwała wchodzi w życie z dniem podjęcia.`;

export interface DemoMaterial { ref: MaterialRef; html: string }
/** Plik wbudowany wersji próbnej: bajty powstają w przeglądarce przy starcie (`src/demo/files.ts`), nigdy w `localStorage`. */
export type BuiltinKind = 'slajd-1' | 'slajd-2' | 'slajd-3' | 'pdf-pokaz' | 'pdf-protokol-1' | 'pdf-protokol-2';
export interface DemoFileRow {
  id: string; meetingId: string; name: string; mime: string; size: number;
  purpose: 'material' | 'pokaz' | 'zlozone' | 'zgloszenie'; checked: string; sha256: string; created: number;
  /** Plik wbudowany (dane fikcyjne); bez tego pola plik dodała osoba w tej karcie przeglądarki. */
  builtin?: BuiltinKind;
}
export interface DemoContact {
  email: string | null; state: EmailState; confirmedAt: number | null; confirmedBy: 'kod' | 'administrator' | null; prefs: MailPrefs;
  /** Kod potwierdzenia: w wersji próbnej widoczny w „Skrzynce (próba)” (7.3). */
  code?: {address: string; code: string; expires: number; attempts: number; sentLog: number[]} | null;
}
export interface DemoSeed {
  roster: Roster; general: GeneralSettings; docTypes: DocType[]; meetings: Meeting[]; materials: {meetingId: string; ref: MaterialRef; html: string; /** Dodatek D-12: wcześniejsze wersje. */ older?: Record<number, string>}[];
  prep: Record<string, PrepSpace>; files: DemoFileRow[]; audit: Omit<AuditEntry, 'id'>[]; contacts: Record<string, DemoContact>;
  /** Dodatek D-10: poprzednie wizyty (posiedzenie, konto). */
  visits?: Record<string, Record<string, {lastAt: number; prevAt: number | null}>>;
}

// ---------------------------------------------------------------------------------------------------------------
// Pliki wbudowane: rozmiary i skróty liczy przeglądarka (`files.ts`); tu nazwy, rodzaje i liczby stron.
export const SLIDE_SIZE = {width: 1280, height: 720};
const slideRow = (meetingId: string, n: 1 | 2 | 3, now: number): DemoFileRow =>
  ({id: `plik_proba-${meetingId.slice(0, 8)}-slajd-${n}`, meetingId, name: `slajd-${n}.png`, mime: 'image/png', size: 0, purpose: 'pokaz', checked: '', sha256: '', created: now, builtin: `slajd-${n}`});
const pdfRow = (meetingId: string, kind: 'pdf-pokaz' | 'pdf-protokol-1' | 'pdf-protokol-2', name: string, purpose: DemoFileRow['purpose'], now: number): DemoFileRow =>
  ({id: `plik_proba-${meetingId.slice(0, 8)}-${kind}`, meetingId, name, mime: 'application/pdf', size: 0, purpose, checked: purpose === 'pokaz' ? 'ok:3' : '', sha256: '', created: now, builtin: kind});
const displayFile = (row: DemoFileRow, type: DisplayFile['type']): DisplayFile =>
  ({fileId: row.id, name: row.name, type, size: row.size, ...(type === 'png' ? SLIDE_SIZE : {})});

// ---------------------------------------------------------------------------------------------------------------
// Zegar i kontekst domeny dla posiedzeń z przeszłości (dni z tabeli 7.2, godziny w strefie Europe/Warsaw).
const warsaw = (day: string, hm: string) => {
  // Polska: czas zimowy UTC+1 do ostatniej niedzieli marca, letni UTC+2 do ostatniej niedzieli października (2026: 29.03 i 25.10).
  const summer = day >= '2026-03-29' && day < '2026-10-25';
  return Date.parse(`${day}T${hm}:00Z`) - (summer ? 2 : 1) * 3600000;
};
class Clock { now: number; constructor(now: number) { this.now = now; } add(min: number) { this.now += min * 60000; return this; } }

function seedContext(clock: Clock, roster: Roster, bundle: GeneralBundle, newId: () => string, closed: Meeting[], tally: Map<string, Choice[]>): Context {
  const secret: SecretHooks = {
    // Karty głosowań z przeszłości nie mają kluczy: klucz pokazuje się tylko w trwającym głosowaniu.
    openKey: () => ({n: 'ab'.repeat(128), e: '010001', fingerprint: 'PROBA-PROBA-PROBA-PROBA'}),
    tally: id => {
      const list = tally.get(id) ?? [];
      return {za: list.filter(c => c === 'za').length, przeciw: list.filter(c => c === 'przeciw').length, wstrzymuje: list.filter(c => c === 'wstrzymuje').length};
    },
    closeKey: () => {},
    discard: id => { tally.delete(id); },
  };
  return {roster, get now() { return clock.now; }, newId, secret, docTypes: bundle.docTypes, general: bundle, law: LAW, accounts: demoAccounts, closedMeetings: closedRefs(closed)} as Context;
}

/** Polecenia jednego posiedzenia z przeszłości na wspólnym zegarze. */
class Run {
  m: Meeting; ctx: Context; clock: Clock; tally: Map<string, Choice[]>;
  constructor(m: Meeting, ctx: Context, clock: Clock, tally: Map<string, Choice[]>) { this.m = m; this.ctx = ctx; this.clock = clock; this.tally = tally; }
  do(cmd: Command, who: Actor, min = 1) { this.clock.add(min); this.m = apply(this.m, cmd, who, this.ctx); return this; }
  item(test: (title: string) => boolean) { return this.m.agenda.find(i => test(i.title))!; }
  kind(kind: string) { return this.m.agenda.find(i => i.kind === kind && !i.parentId)!; }
  last() { return this.m.ballots.at(-1)!; }
  /** Głosy jawne albo imienne; `skip` nie głosuje (wyszedł albo nie oddał głosu). */
  vote(choices: Record<string, Choice>, chair: Actor) {
    const b = this.last();
    for (const [p, c] of Object.entries(choices)) if (b.eligible.includes(p)) this.do({type: 'vote', ballotId: b.id, choice: c}, person(p), 0.2);
    if (this.last().status === 'otwarte') this.do({type: 'ballot_close', ballotId: b.id}, chair, 0.5);
    return this.do({type: 'announce', ballotId: b.id}, chair, 0.5);
  }
  /** Głosowanie tajne: karty pobierają osoby z `choices`; pozostałe uprawnione nie pobierają karty. */
  secret(choices: Record<string, Choice>, chair: Actor) {
    const b = this.last();
    for (const [p, c] of Object.entries(choices)) {
      this.clock.add(0.2);
      this.m = secretIssue(this.m, b.id, person(p), this.ctx);
      this.tally.set(b.id, [...(this.tally.get(b.id) ?? []), c]);
      this.m = secretCast(this.m, b.id, this.ctx);
    }
    if (this.last().status === 'otwarte') this.do({type: 'ballot_close', ballotId: b.id}, chair, 0.5);
    return this.do({type: 'announce', ballotId: b.id}, chair, 0.5);
  }
  tick() { advance(this.m, this.ctx); return this; }
}
const yes = (ids: string[], except: string[] = [], choice: Choice = 'za') => Object.fromEntries(ids.filter(x => !except.includes(x)).map(x => [x, choice])) as Record<string, Choice>;

/** Zmiany składu w 2026 r. (7.2) tą samą funkcją co w ustawieniach ogólnych, z wpisami w historii zmian. */
function composition(general: GeneralSettings) {
  const newId = () => 'osoba';
  const add = applyCompositionChange(rosterEarly, organSettingsOf(general, 'prezydium'),
    {organ: 'prezydium', op: 'dodaj', personId: joined[0], func: 'czlonek', label: joined[3], since: '2026-04-01', basis: {kind: 'uchwala', act: {organ: 'rada', number: '31/I/2026', date: '2026-03-26'}}},
    {actor: office, now: warsaw('2026-04-01', '09:15'), today: '2026-04-01', newId});
  const end = applyCompositionChange(add.roster, add.settings,
    {organ: 'prezydium', op: 'koniec', personId: LEFT, since: '2026-05-20', basis: {kind: 'rezygnacja', date: '2026-05-20', to: 'Przewodnicząca Prezydium'}},
    {actor: office, now: warsaw('2026-06-10', '12:00'), today: '2026-06-10', newId});
  return {rosterApril: add.roster, roster: end.roster, settings: end.settings, audit: [...add.audit, ...end.audit]};
}

// ---------------------------------------------------------------------------------------------------------------
/**
 * Dane wersji próbnej (rozdz. 7.2). `now` to chwila pierwszego wczytania: dzisiejsze posiedzenie w przygotowaniu
 * i głosowanie między posiedzeniami w przygotowaniu mają dzisiejszą datę, posiedzenia zakończone stałe dni z 2026 r.
 */
export function demoData(now: number, newId: () => string, hash: (html: string) => string): DemoSeed {
  const materials: DemoSeed['materials'] = [];
  const files: DemoFileRow[] = [];
  const audit: Omit<AuditEntry, 'id'>[] = [];
  const material = (meetingId: string, title: string, number: string, text: string, type: MaterialType = 'uchwala', at = now) => {
    const html = textToHtml(text);
    const ref: MaterialRef = {id: newId(), title, type, number, version: 1, hash: hash(html), size: html.length, fileId: null, fileName: null, createdAt: at};
    materials.push({meetingId, ref, html});
    return ref;
  };
  const general = demoGeneral();
  const docTypes = demoDocTypes();
  const bundle: GeneralBundle = {general, docTypes, revision: 1};
  const tally = new Map<string, Choice[]>();
  const closed: Meeting[] = [];
  const env = (roster: Roster) => cascadeEnv({roster, bundle, organ: 'prezydium', accounts: demoAccounts, law: LAW});

  // Skład w czasie (7.2): dopisanie 01.04.2026 i koniec członkostwa 20.05.2026 wpisany 10.06.2026.
  const {rosterApril, roster, settings, audit: changes} = composition(general);
  general.organs.prezydium = settings;
  audit.push(...changes);

  const chair = person('p1');
  const pastMeeting = (day: string, title: string, mode: Meeting['mode'], r: Roster, clock: Clock, kind: Meeting['kind'] = 'posiedzenie') => {
    const m = createMeeting({id: newId(), organ: 'prezydium', kind, title, date: day, time: kind === 'procedura' ? '00:00' : '10:00', place: kind === 'procedura' ? '' : mode === 'zdalne' ? '' : 'Sala posiedzeń (przykład)', mode, createdBy: 'Biuro', now: clock.now, newId});
    m.template = kind === 'posiedzenie' ? {id: 'zwykle', name: 'Posiedzenie zwykłe'} : undefined;
    m.invited = ['a-kr'];
    return new Run(m, seedContext(clock, r, bundle, newId, closed, tally), clock, tally);
  };
  const members = (r: Roster) => r.memberships.filter(ms => ms.organ === 'prezydium').map(ms => ms.personId);
  /** Otwarcie, obecność (stacjonarnie zgłoszenie i potwierdzenie), kworum i przyjęcie porządku. */
  const opening = (run: Run, present: string[], o: {late?: string; unconfirmed?: string} = {}) => {
    run.do({type: 'open'}, chair, 0);
    for (const p of present.filter(x => x !== 'p1' && x !== o.late)) run.do({type: 'presence', who: p, present: true}, person(p), 0.2);
    if (o.unconfirmed) run.do({type: 'presence', who: o.unconfirmed, present: true}, person(o.unconfirmed), 0.3);
    if (run.m.mode === 'stacjonarne') for (const p of present.filter(x => x !== 'p1' && x !== o.late)) run.do({type: 'presence_confirm', who: p, accept: true}, chair, 0.1);
    run.do({type: 'quorum'}, chair, 1);
    run.do({type: 'item_start', itemId: run.kind('porzadek').id}, chair, 1);
    run.do({type: 'ballot_open', itemId: run.kind('porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, 0.5);
    return run.vote(yes(present.filter(x => x !== o.late)), chair);
  };
  const subUnder = (run: Run, kind: string, title: string, presenters: Presenter[] = []) => {
    run.do({type: 'item_add', title, parentId: run.kind(kind).id}, office, 0);
    const it = run.m.agenda.filter(i => i.title === title).at(-1)!;
    if (presenters.length) run.do({type: 'item_edit', itemId: it.id, presenters}, office, 0);
    return it.id;
  };
  const secretary: Presenter = {name: 'Marta Kaczmarek', role: 'Sekretarz', kind: 'referuje', personId: 'p4'};
  const treasurer: Presenter = {name: 'Paweł Zieliński', role: 'Skarbnik', kind: 'referuje', personId: 'p5'};

  // --- Posiedzenie sprzed wersji 3, zamknięte 15.01.2026 (`frozen.legacy`, wynik jednego głosowania bez ogłoszenia).
  {
    const clock = new Clock(warsaw('2026-01-15', '09:30'));
    const run = pastMeeting('2026-01-15', 'Posiedzenie Prezydium', 'stacjonarne', rosterEarly, clock);
    const a = subUnder(run, 'uchwaly', 'Uchwała nr 3/I/2026 w sprawie planu pracy Prezydium na 2026 r.', [secretary]);
    const b = subUnder(run, 'uchwaly', 'Uchwała nr 4/I/2026 w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki', [secretary]);
    run.do({type: 'details', noticeDate: '2026-01-07', protocolNumber: '1/I/2026', convener: 'p1'}, office, 0);
    clock.now = warsaw('2026-01-15', '10:00');
    const present = members(rosterEarly).filter(p => p !== 'p6');
    opening(run, present);
    for (const [id, title] of [[a, 'Uchwała nr 3/I/2026 w sprawie planu pracy Prezydium na 2026 r.'], [b, 'Uchwała nr 4/I/2026 w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki']]) {
      run.do({type: 'item_start', itemId: id, reason: 'Kolejność z porządku obrad.'}, chair, 2);
      run.do({type: 'ballot_open', itemId: id, purpose: 'uchwala', subject: title, mode: 'jawne', minutes: 2}, chair, 3);
      run.vote(yes(present), chair);
    }
    run.do({type: 'close', reason: 'Wyczerpano sprawy przewidziane na to posiedzenie.'}, chair, 20);
    const m = run.m;
    // Dane sprzed wersji 3: zamrożenie przy przejściu (`legacy`), bez `v4`; wynik ostatniej uchwały bez ogłoszenia
    // (sprzed zasady F2, K4-35), więc statystyki go pomijają. Kadencję i poziomy utrwalone uzupełnia migracja wersji 4.
    m.frozen = freezeLegacy(env(rosterEarly), m, m.openedAt!);
    delete m.closedComms; delete m.commsInputs; delete m.template;
    const unannounced = m.ballots.filter(x => x.purpose === 'uchwala').at(-1)!;
    delete unannounced.announcedAt;
    m.log = m.log.filter(l => !l.text.startsWith(`Ogłoszono wynik głosowania nr ${unannounced.number}`));
    migrateMeetingV4(m, {general, docTypes});
    closed.push(m);
  }

  // --- Posiedzenie 1, zamknięte, stacjonarne, 12.03.2026.
  let first: Meeting;
  {
    const clock = new Clock(warsaw('2026-02-26', '12:00'));
    const run = pastMeeting('2026-03-12', 'Posiedzenie Prezydium', 'stacjonarne', rosterEarly, clock);
    run.do({type: 'details', noticeDate: '2026-03-04', protocolNumber: '3/I/2026', convener: 'p1'}, office, 0);
    const patronage = subUnder(run, 'uchwaly', 'Uchwała nr 21/I/2026 w sprawie objęcia patronatem konferencji „Pielęgniarstwo 2026”', [{name: 'Tomasz Lewandowski', role: 'I Wiceprzewodniczący', kind: 'referuje', personId: 'p2'}]);
    const licenceId = subUnder(run, 'uchwaly', 'Uchwała nr 22/I/2026 w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki', [secretary]);
    const aid = subUnder(run, 'uchwaly', 'Uchwała nr 23/I/2026 w sprawie przyznania zapomogi', [treasurer]);
    const report = subUnder(run, 'sprawozdania', 'Sprawozdanie z działalności Prezydium za 2025 r. (przykład)', [{name: 'Barbara Wiśniewska', role: 'Przewodnicząca', kind: 'referuje', personId: 'p1'}]);
    run.do({type: 'item_edit', itemId: patronage, caseType: 'patronat', comms: {sentence: 'Prezydium objęło patronatem konferencję dla pielęgniarek i położnych (przykład).'}}, office, 0);
    run.do({type: 'item_edit', itemId: licenceId, caseType: 'prawo_wykonywania_zawodu'}, office, 0);
    run.do({type: 'item_edit', itemId: aid, caseType: 'pomoc_losowa'}, office, 0);
    run.do({type: 'item_edit', itemId: report, docType: 'sprawozdanie', comms: {sentence: 'Prezydium przyjęło sprawozdanie z działalności za ubiegły rok (przykład).'}}, office, 0);
    const reportRef = material(run.m.id, 'Sprawozdanie z działalności Prezydium za 2025 r. (przykład)', '', 'Sprawozdanie z działalności (dane fikcyjne)\n\n1. Prezydium odbyło 11 posiedzeń.\n2. Podjęło 64 uchwały.', 'sprawozdanie', clock.now);
    run.m.materials.push(reportRef);
    run.m.agenda.find(i => i.id === report)!.materialIds = [reportRef.id];
    clock.now = warsaw('2026-03-12', '10:00');
    const all = members(rosterEarly);
    // Spóźnienie 25 minut (p5), zgłoszenie obecności bez potwierdzenia (p7), wyjście 40 minut przed końcem (p6),
    // wyjście w trakcie głosowania bez głosu (p2), jedna osoba bez karty w głosowaniu tajnym (p3).
    const present = all.filter(p => p !== 'p7');
    opening(run, present, {late: 'p5', unconfirmed: 'p7'});
    clock.now = warsaw('2026-03-12', '10:25');
    run.do({type: 'presence', who: 'p5', present: true}, person('p5'), 0);
    run.do({type: 'presence_confirm', who: 'p5', accept: true}, chair, 0.5);
    run.do({type: 'item_start', itemId: report, reason: 'Kolejność z porządku obrad.'}, chair, 3);
    run.do({type: 'ballot_open', itemId: report, purpose: 'inna', subject: 'Przyjęcie sprawozdania z działalności Prezydium za 2025 r.', mode: 'jawne', minutes: 2, docType: 'sprawozdanie'}, chair, 5);
    run.vote(yes(present), chair);
    run.do({type: 'item_start', itemId: patronage, reason: 'Kolejność z porządku obrad.'}, chair, 3);
    run.do({type: 'ballot_open', itemId: patronage, purpose: 'uchwala', subject: run.item(t => t.startsWith('Uchwała nr 21/')).title, mode: 'jawne', minutes: 2}, chair, 4);
    // p2 wychodzi w trakcie głosowania, zanim odda głos, i wraca po nim.
    run.do({type: 'presence', who: 'p2', present: false}, person('p2'), 0.3);
    run.vote(yes(present, ['p2']), chair);
    run.do({type: 'presence', who: 'p2', present: true}, person('p2'), 1);
    run.do({type: 'presence_confirm', who: 'p2', accept: true}, chair, 0.2);
    run.do({type: 'item_start', itemId: licenceId, reason: 'Kolejność z porządku obrad.'}, chair, 3);
    run.do({type: 'mode_motion', itemId: licenceId, mode: 'imienne', minutes: 2, proposedBy: 'p4'}, chair, 1);
    run.vote(yes(present), chair);
    run.do({type: 'ballot_open', itemId: licenceId, purpose: 'uchwala', subject: run.item(t => t.startsWith('Uchwała nr 22/')).title, mode: 'imienne', minutes: 2}, chair, 2);
    run.vote({...yes(present), p5: 'wstrzymuje'}, chair);
    run.do({type: 'item_start', itemId: aid, reason: 'Kolejność z porządku obrad.'}, chair, 3);
    run.do({type: 'mode_motion', itemId: aid, mode: 'tajne', minutes: 2, proposedBy: 'p5'}, chair, 1);
    run.vote(yes(present), chair);
    run.do({type: 'ballot_open', itemId: aid, purpose: 'uchwala', subject: run.item(t => t.startsWith('Uchwała nr 23/')).title, mode: 'tajne', minutes: 2}, chair, 2);
    run.secret({p1: 'za', p2: 'za', p4: 'za', p5: 'przeciw', p6: 'za'}, chair);
    clock.now = warsaw('2026-03-12', '11:50');
    run.do({type: 'presence', who: 'p6', present: false}, person('p6'), 0);
    clock.now = warsaw('2026-03-12', '12:28');
    run.do({type: 'close', reason: 'Wyczerpano sprawy przewidziane na to posiedzenie.'}, chair, 2);
    // Po zamknięciu: „Protokół sporządzony” z osobą sporządzającą i plikiem PDF, odnośnik do albumu (ostrzeżenie G-23),
    // opis dla komunikacji i udostępnienie materiału (DB-42).
    clock.now = warsaw('2026-03-20', '13:00');
    const proto = pdfRow(run.m.id, 'pdf-protokol-1', 'protokol-12-03-2026.pdf', 'zlozone', clock.now);
    files.push(proto);
    run.m = addFiled(run.m, {kind: 'protokol_sporzadzony', fileId: proto.id, fileName: proto.name, mime: 'application/pdf', size: proto.size, sha256: proto.sha256}, person('p4'), run.ctx);
    run.do({type: 'minutes_ready', date: '2026-03-20', authorPersonId: 'p4'}, person('p4'), 2);
    run.do({type: 'photos_set', url: 'https://example.org/album-przykladowy', confirm: true}, office, 60);
    run.do({type: 'comms_note', text: 'Prezydium omówiło plan konferencji i przyjęło sprawozdanie za ubiegły rok (dane fikcyjne).'}, chair, 30);
    run.do({type: 'comms_release'}, chair, 5);
    first = run.m;
    closed.push(first);
  }

  // --- Posiedzenie 2, zamknięte, zdalne, 15.04.2026 (przyjęcie protokołu posiedzenia 1, pokaz, sprawa bez rodzaju).
  {
    const clock = new Clock(warsaw('2026-04-02', '12:00'));
    const run = pastMeeting('2026-04-15', 'Posiedzenie Prezydium', 'zdalne', rosterApril, clock);
    run.do({type: 'details', noticeDate: '2026-04-07', protocolNumber: '4/I/2026', convener: 'p1', link: 'https://example.org/spotkanie-przykladowe'}, office, 0);
    const protocolItem = run.kind('protokol').id;
    run.do({type: 'item_edit', itemId: protocolItem, protocolOf: first.id}, office, 0);
    const current = run.kind('sprawozdania').id;
    const plan = subUnder(run, 'sprawozdania', 'Plan szkoleń na II kwartał 2026 r. (przykład)', [{name: 'Ewa Dąbrowska', role: 'II Wiceprzewodnicząca', kind: 'referuje', personId: 'p3'}]);
    const request = subUnder(run, 'sprawozdania', 'Wniosek o zapomogę (dane fikcyjne)', [{name: 'Zofia Przykładowa', role: 'osoba spoza składu', kind: 'referuje'}]);
    const licenceId = subUnder(run, 'uchwaly', 'Uchwała nr 30/I/2026 w sprawie stwierdzenia prawa wykonywania zawodu położnej', [secretary]);
    run.do({type: 'item_edit', itemId: licenceId, caseType: 'prawo_wykonywania_zawodu'}, office, 0);
    // Pliki do pokazania przy planie szkoleń: trzy slajdy (z plikiem PDF prezentacji) i trzystronicowy PDF.
    const slides = ([1, 2, 3] as const).map(n => slideRow(run.m.id, n, clock.now));
    const pdf = pdfRow(run.m.id, 'pdf-pokaz', 'przykladowy-dokument.pdf', 'pokaz', clock.now);
    files.push(...slides, pdf);
    run.m = addDisplay(run.m, {title: 'Przykładowa prezentacja', itemId: plan, kind: 'obrazy', files: slides.map(s => displayFile(s, 'png')), pages: 3,
      description: 'Trzy slajdy z napisem „Przykładowa prezentacja” i numerem slajdu na kolorowym tle.'}, office, run.ctx).meeting;
    run.m = addDisplay(run.m, {title: 'Przykładowy dokument', itemId: plan, kind: 'pdf', files: [displayFile(pdf, 'pdf')], pages: 3}, office, run.ctx).meeting;
    void current;
    clock.now = warsaw('2026-04-15', '10:00');
    const all = members(rosterApril);
    const present = all.filter(p => p !== 'p7');
    opening(run, present);
    run.do({type: 'item_start', itemId: protocolItem}, chair, 2);
    run.do({type: 'ballot_open', itemId: protocolItem, purpose: 'protokol', subject: 'Przyjęcie protokołu posiedzenia z dnia 12.03.2026', mode: 'jawne', minutes: 2}, chair, 3);
    run.vote(yes(present), chair);
    // Przerwa w obecności 30 minut (p3, posiedzenie zdalne).
    run.do({type: 'presence', who: 'p3', present: false}, person('p3'), 1);
    run.do({type: 'item_start', itemId: plan, reason: 'Kolejność z porządku obrad.'}, chair, 2);
    const [deck, doc] = run.m.displays!;
    run.do({type: 'show', source: 'plik', id: deck.id}, chair, 1);
    run.do({type: 'show_page', page: 2}, chair, 2);
    run.do({type: 'show_page', page: 3}, chair, 2);
    run.do({type: 'show', source: 'plik', id: doc.id}, chair, 2);
    run.do({type: 'show_page', page: 2}, chair, 3);
    run.do({type: 'show_page', page: 3}, chair, 3);
    run.do({type: 'show_end'}, chair, 2);
    run.do({type: 'presence', who: 'p3', present: true}, person('p3'), 15);
    run.do({type: 'item_start', itemId: request, reason: 'Kolejność z porządku obrad.'}, chair, 3);
    run.do({type: 'item_end', itemId: request, status: 'zakonczony'}, chair, 6);
    run.do({type: 'item_start', itemId: licenceId, reason: 'Kolejność z porządku obrad.'}, chair, 2);
    run.do({type: 'ballot_open', itemId: licenceId, purpose: 'uchwala', subject: run.item(t => t.startsWith('Uchwała nr 30/')).title, mode: 'jawne', minutes: 2}, chair, 2);
    run.vote(yes(present), chair);
    run.do({type: 'close', reason: 'Wyczerpano sprawy przewidziane na to posiedzenie.'}, chair, 15);
    // Plik protokołu dołączony bez faktu „Protokół sporządzony” (wiersz „Do sprawdzenia”, K4-7); materiał czeka na udostępnienie.
    clock.now = warsaw('2026-04-28', '09:30');
    const proto = pdfRow(run.m.id, 'pdf-protokol-2', 'protokol-15-04-2026.pdf', 'zlozone', clock.now);
    files.push(proto);
    run.m = addFiled(run.m, {kind: 'protokol_sporzadzony', fileId: proto.id, fileName: proto.name, mime: 'application/pdf', size: proto.size, sha256: proto.sha256}, office, run.ctx);
    closed.push(run.m);
  }

  // --- Spotkanie robocze, zamknięte, 02.06.2026: bez kworum, notatka, osoba po końcu członkostwa w składzie z otwarcia.
  {
    const clock = new Clock(warsaw('2026-05-25', '12:00'));
    const run = pastMeeting('2026-06-02', 'Posiedzenie Prezydium', 'stacjonarne', rosterApril, clock);
    run.do({type: 'details', noticeDate: '2026-05-26', convener: 'p1'}, office, 0);
    clock.now = warsaw('2026-06-02', '10:00');
    run.do({type: 'open'}, chair, 0);
    for (const p of ['p3', 'p4']) run.do({type: 'presence', who: p, present: true}, person(p), 0.5);
    run.do({type: 'presence_confirm_all'}, chair, 1);
    run.do({type: 'quorum'}, chair, 3);
    run.do({type: 'working_start', reason: 'brak_kworum'}, chair, 1);
    run.do({type: 'close', reason: 'Spotkanie robocze bez kworum, sprawy przechodzą na następne posiedzenie.'}, chair, 40);
    closed.push(run.m);
  }

  // --- Głosowanie między posiedzeniami, zakończone, 10.09.2026: jedna osoba bez głosu, bez wiadomości sprzed rozpoczęcia.
  {
    const clock = new Clock(warsaw('2026-09-08', '12:00'));
    const run = pastMeeting('2026-09-10', 'Głosowanie między posiedzeniami', 'zdalne', roster, clock, 'procedura');
    const act = newItem(newId(), 'Uchwała nr 52/I/2026 w sprawie delegowania przedstawicieli na kongres (przykład)', 'sprawa');
    const ref = material(run.m.id, act.title, '52/I/2026', 'Prezydium Okręgowej Rady\n\n§ 1\nDeleguje się dwie osoby na kongres (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.', 'uchwala', clock.now);
    run.m.materials.push(ref);
    act.materialIds = [ref.id];
    run.m.agenda.push(act);
    clock.now = warsaw('2026-09-10', '09:00');
    run.do({type: 'open'}, chair, 0);
    const b = run.m.ballots.find(x => x.status === 'otwarte')!;
    for (const p of members(roster).filter(x => x !== 'p5')) run.do({type: 'vote', ballotId: b.id, choice: 'za'}, person(p), 30);
    run.do({type: 'procedure_end', how: 'policz'}, chair, 60 * 20);
    if (run.m.ballots.some(x => x.status === 'zamkniete' && !x.announcedAt && !x.aborted)) for (const x of run.m.ballots.filter(y => !y.announcedAt)) run.do({type: 'announce', ballotId: x.id}, chair, 1);
    closed.push(run.m);
  }

  // --- Dzisiejsze posiedzenie w przygotowaniu i głosowanie między posiedzeniami w przygotowaniu (wersja 2 i 3).
  const {meeting, procedure} = preparation(now, newId, material);
  // Wersja 4 (7.2): pliki do pokazania przy „Sprawy bieżące” i przestrzeń robocza z trzema zgłoszeniami i uwagami.
  const clock = new Clock(now - 3 * 86400000);
  const ctx = seedContext(clock, roster, bundle, newId, closed, tally);
  const slides = ([1, 2, 3] as const).map(n => slideRow(meeting.id, n, clock.now));
  const pdf = pdfRow(meeting.id, 'pdf-pokaz', 'przykladowy-dokument.pdf', 'pokaz', clock.now);
  files.push(...slides, pdf);
  const currentItem = meeting.agenda.find(i => i.kind === 'sprawozdania')!.id;
  let today = addDisplay(meeting, {title: 'Przykładowa prezentacja', itemId: currentItem, kind: 'obrazy', files: slides.map(s => displayFile(s, 'png')), pages: 3,
    description: 'Trzy slajdy z napisem „Przykładowa prezentacja” i numerem slajdu na kolorowym tle.'}, office, ctx).meeting;
  clock.add(5);
  today = addDisplay(today, {title: 'Przykładowy dokument', itemId: currentItem, kind: 'pdf', files: [displayFile(pdf, 'pdf')], pages: 3}, office, ctx).meeting;
  let ws = emptySpace(today.id, 'prezydium');
  const prep = (cmd: PrepCommand, who: Actor, min = 30) => {
    clock.add(min);
    const r = applyPrep(ws, today, cmd, who, {...ctx, now: clock.now});
    ws = r.ws;
    if (r.meeting) today = r.meeting;
    return r;
  };
  prep({type: 'proposal_add', title: 'Uchwała w sprawie objęcia patronatem konkursu „Pielęgniarka roku” (przykład)', justification: 'Organizatorzy proszą o patronat przed ogłoszeniem konkursu (dane fikcyjne).', caseType: 'patronat', presenterId: 'p2'}, person('p2'));
  prep({type: 'proposal_add', title: 'Informacja o remoncie sali szkoleniowej (przykład)', justification: 'Warto omówić termin remontu przed planowaniem szkoleń (dane fikcyjne).'}, person('p6'));
  prep({type: 'proposal_add', title: 'Stanowisko w sprawie dyżurów nocnych (przykład)', justification: 'Sprawa wymaga przygotowania projektu stanowiska (dane fikcyjne).'}, person('p5'));
  const [accepted, rejected] = ws.proposals;
  prep({type: 'proposal_accept', proposalId: accepted.id, place: 'w_uchwalach'}, office, 60);
  prep({type: 'proposal_reject', proposalId: rejected.id, reason: 'Termin remontu nie jest jeszcze znany. Sprawa wróci, gdy będzie harmonogram (dane fikcyjne).'}, person('p1'), 45);
  const reportItem = today.agenda.find(i => i.docType === 'sprawozdanie')!;
  const q = prep({type: 'comment_add', target: {kind: 'punkt', itemId: reportItem.id}, text: 'Czy sprawozdanie obejmuje też kontrolę wydatków na szkolenia?'}, person('p6'), 90);
  const question = q.ws.comments.at(-1)!;
  prep({type: 'comment_add', target: {kind: 'punkt', itemId: reportItem.id}, parentId: question.id, text: 'Tak, w punkcie 1 sprawozdania (dane fikcyjne).'}, person('p3'), 40);
  prep({type: 'thread_resolve', commentId: question.id, on: true}, person('p3'), 5);
  const positionItem = today.agenda.find(i => i.docType === 'stanowisko')!;
  prep({type: 'comment_add', target: {kind: 'punkt', itemId: positionItem.id}, text: 'Proponuję dopisać zdanie o obsadzie w weekendy.'}, person('p4'), 120);
  // Dodatek D-12 (7.2): uwaga do wersji 1 projektu stanowiska, uwzględniona w wersji 2 (druga wersja dodana przez osobę referującą).
  const positionMat = positionItem.materialIds[0];
  const remark = prep({type: 'comment_add', target: {kind: 'material', materialId: positionMat, version: 1, quote: 'obsada dyżurów powinna odpowiadać potrzebom pacjentów'}, text: 'Warto dodać, kto ustala obsadę w weekendy (dane fikcyjne).'}, person('p2'), 20).ws.comments.at(-1)!;
  const entry = materials.find(x => x.ref.id === positionMat)!;
  const html2 = textToHtml('Prezydium Okręgowej Rady (dane fikcyjne)\n\nPrezydium zwraca uwagę, że obsada dyżurów powinna odpowiadać potrzebom pacjentów, także w weekendy (przykład).');
  entry.older = {1: entry.html};
  entry.html = html2;
  entry.ref = {...entry.ref, version: 2, hash: hash(html2), size: html2.length};
  today = {...today, materials: today.materials.map(r => r.id === positionMat ? {...entry.ref} : r)};
  clock.add(15);
  today.log.push({at: clock.now, text: `Dodano nową wersję materiału „${entry.ref.title}” (wersja 2).`, by: 'Joanna Szymańska', accountId: 'a-p6', tag: 'projekt', itemId: positionItem.id});
  prep({type: 'remark_state', commentId: remark.id, state: 'uwzgledniona', version: 2}, person('p6'), 10);
  // Dodatek D-11 (7.2): zadania z terminem, jedno po terminie; zadanie dla członka przydziela zwołująca.
  const yesterday = new Date(now - 86400000).toISOString().slice(0, 10), later = new Date(now + 5 * 86400000).toISOString().slice(0, 10);
  prep({type: 'task_add', title: 'Przygotować projekt uchwały w sprawie patronatu (przykład)', assignee: {personId: 'p4'}, due: yesterday}, person('p1'), 15);
  prep({type: 'task_add', title: 'Zarezerwować salę szkoleniową (przykład)', assignee: {office: true}, due: later, itemId: reportItem.id}, person('p3'), 15);

  // Adresy kont fikcyjnych (7.2): „Potwierdzony”, „Czeka na potwierdzenie” i „Brak adresu”.
  const confirmedAt = warsaw('2026-09-01', '10:00');
  const contact = (email: string | null, state: EmailState, by: DemoContact['confirmedBy'] = state === 'potwierdzony' ? 'kod' : null): DemoContact =>
    ({email, state, confirmedAt: state === 'potwierdzony' ? confirmedAt : null, confirmedBy: by, prefs: {...defaultPrefs}});
  // Dodatek D-9 (7.3): część osób fikcyjnych pozwala pokazywać, że ogląda przygotowanie (po „Zmień osobę” przez 2 minuty).
  const watching = (c: DemoContact): DemoContact => ({...c, prefs: {...c.prefs, showPresence: true}});
  const contacts: Record<string, DemoContact> = {
    'a-p1': watching(contact('barbara.wisniewska@example.org', 'potwierdzony')),
    'a-p2': watching(contact('tomasz.lewandowski@example.org', 'potwierdzony', 'administrator')),
    'a-p3': watching(contact('ewa.dabrowska@example.org', 'niepotwierdzony')),
    'a-p4': contact('marta.kaczmarek@example.org', 'potwierdzony'),
    'a-p5': contact(null, 'brak'),
    'a-p6': contact('joanna.szymanska@example.org', 'potwierdzony'),
    'a-p7': contact(null, 'brak'),
    'a-p8': contact('karolina.mazur@example.org', 'potwierdzony'),
    'a-biuro': watching(contact('biuro@example.org', 'potwierdzony', 'administrator')),
    'a-kr': contact(null, 'brak'),
    'a-komunikacja': contact('komunikacja@example.org', 'potwierdzony', 'administrator'),
  };
  // Dodatek D-10 (7.3): poprzednia wizyta każdej osoby fikcyjnej sprzed zmian w przygotowaniu, więc „Co nowego” ma treść.
  const firstChange = Math.min(...ws.events.map(e => e.at), ...ws.comments.map(c => c.at));
  const visits = {[today.id]: Object.fromEntries(Object.keys(contacts).map(id => [id, {lastAt: firstChange - 60000, prevAt: null}]))};
  return {roster, general, docTypes, meetings: [today, procedure, ...closed], materials, prep: {[today.id]: ws}, files, audit, contacts, visits};
}

/** Posiedzenie w przygotowaniu i głosowanie między posiedzeniami w przygotowaniu (dane wersji 2 i 3 bez zmian). */
function preparation(now: number, newId: () => string, material: (meetingId: string, title: string, number: string, text: string, type?: MaterialType) => MaterialRef) {
  const today = new Date(now - new Date(now).getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const notice = new Date(now - 9 * 86400000).toISOString().slice(0, 10);
  const meeting: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'posiedzenie', title: 'Posiedzenie Prezydium (próbne)', date: today, time: '10:00', place: 'Sala posiedzeń (przykład)', mode: 'stacjonarne', createdBy: 'Biuro', now, newId});
  meeting.noticeDate = notice;
  // Wersja 3: wzór posiedzenia i osoba z głosem doradczym zaproszona z urzędu (DA-5).
  meeting.template = {id: 'zwykle', name: 'Posiedzenie zwykłe'};
  meeting.invited = ['a-kr'];
  // Osoby przy punktach (F12): funkcje ze składu fikcyjnego, a sprawozdanie referuje osoba z głosem doradczym.
  const secretary: Presenter = {name: 'Marta Kaczmarek', role: 'Sekretarz', kind: 'referuje'};
  meeting.agenda.find(i => i.kind === 'protokol')!.presenters = [secretary];
  // Sprawy bieżące z rodzajami dokumentów ze słownika (F11), każde z formułą wyniku.
  const current = meeting.agenda.find(i => i.kind === 'sprawozdania')!;
  const report = material(meeting.id, 'Sprawozdanie z kontroli finansowej za III kwartał 2026 r. (przykład)', '',
    'Sprawozdanie z kontroli finansowej (dane fikcyjne)\n\n1. Kontrola objęła wydatki w III kwartale 2026 r.\n2. Nie stwierdzono nieprawidłowości.', 'sprawozdanie');
  const position = material(meeting.id, 'Stanowisko w sprawie bezpiecznej obsady dyżurów (przykład)', '',
    'Prezydium Okręgowej Rady (dane fikcyjne)\n\nPrezydium zwraca uwagę, że obsada dyżurów powinna odpowiadać potrzebom pacjentów (przykład).', 'stanowisko');
  meeting.materials.push(report, position);
  const reportItem = newItem(newId(), report.title, 'sprawa', current.id);
  reportItem.materialIds = [report.id];
  reportItem.docType = 'sprawozdanie';
  reportItem.presenters = [{name: 'Halina Kowalczyk', role: 'Przewodnicząca Okręgowej Komisji Rewizyjnej', kind: 'referuje'}];
  const positionItem = newItem(newId(), position.title, 'sprawa', current.id);
  positionItem.materialIds = [position.id];
  positionItem.docType = 'stanowisko';
  positionItem.presenters = [{name: 'Ewa Dąbrowska', role: 'II Wiceprzewodnicząca', kind: 'prowadzi'}, {name: 'Joanna Szymańska', role: 'Członek Prezydium', kind: 'referuje'}];
  meeting.agenda.splice(meeting.agenda.indexOf(current) + 1, 0, reportItem, positionItem);
  const resolutions = meeting.agenda.find(i => i.kind === 'uchwaly')!;
  const acts: [string, string, string][] = [
    ['117', 'Katarzyna Nowicka', '1170001P'], ['118', 'Magdalena Pawlak', '1180002P'], ['119', 'Natalia Michalska', '1190003P'],
  ];
  let at = meeting.agenda.indexOf(resolutions) + 1;
  for (const [no, who, number] of acts) {
    const title = `Uchwała nr ${no}/IX/2026 w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki`;
    const ref = material(meeting.id, title, `${no}/IX/2026`, licence(no, who, number));
    meeting.materials.push(ref);
    const sub = newItem(newId(), title, 'sprawa', resolutions.id);
    sub.materialIds = [ref.id];
    sub.presenters = [secretary];
    meeting.agenda.splice(at++, 0, sub);
  }
  const patronage = material(meeting.id, 'Uchwała nr 108/IX/2026 w sprawie objęcia patronatem konferencji', '108/IX/2026',
    'Prezydium Okręgowej Rady\n\n§ 1\nObejmuje się patronatem konferencję „Pielęgniarstwo 2027” (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  meeting.materials.push(patronage);
  const sub = newItem(newId(), patronage.title, 'sprawa', resolutions.id);
  sub.materialIds = [patronage.id];
  sub.presenters = [{name: 'Tomasz Lewandowski', role: 'I Wiceprzewodniczący', kind: 'referuje'}];
  meeting.agenda.splice(at, 0, sub);

  // Wersja 3 (DA-21): bez terminu wpisanego ręcznie głosowanie trwa 24 godziny od rozpoczęcia, więc rozpoczęcie w próbie
  // nie wymaga powodu także wtedy, gdy ktoś rozpocznie je później.
  const procedure: Meeting = createMeeting({id: newId(), organ: 'prezydium', kind: 'procedura', title: 'Głosowanie między posiedzeniami (próbne)', date: today, time: '00:00', place: '', mode: 'zdalne', createdBy: 'Biuro', now, newId});
  const act = newItem(newId(), 'Uchwała nr 130/IX/2026 w sprawie delegowania przedstawicieli na szkolenie', 'sprawa');
  const ref = material(procedure.id, act.title, '130/IX/2026', 'Prezydium Okręgowej Rady\n\n§ 1\nDeleguje się dwie osoby na szkolenie regionalne (przykład).\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.');
  procedure.materials.push(ref);
  act.materialIds = [ref.id];
  procedure.agenda.push(act);
  procedure.invited = ['a-kr'];
  return {meeting, procedure};
}

/** Skład bieżący wersji próbnej (po zmianach z 2026 r.); stan sprzed wersji 4 bierze z niego tylko formy organów. */
export const demoRoster: Roster = composition(demoGeneral()).roster;
/** Zgodność ze stanem sprzed wersji 4: dane bez zmian wersji 4. */
export function demoMeetings(now: number, newId: () => string, hash: (html: string) => string) {
  const d = demoData(now, newId, hash);
  return {meetings: d.meetings, materials: d.materials};
}
/** Skrót SHA-256 pliku wbudowanego (te same bajty przy każdym wczytaniu). */
export const sha256Hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));
