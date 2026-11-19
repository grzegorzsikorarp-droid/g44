import type {
  Actor, AgendaChange, AgendaItem, Ballot, BallotPurpose, Choice, DocType, MaterialRef, MaterialType, Meeting, MeetingMode,
  Presentation, Presenter, Roster, VoteMode,
} from './types.ts';
import {membership, organMembers, personName} from './roster.ts';
import {
  announceFirst, computeResult, docTypeFor, everyoneVoted, hasVoted, itemNumber, memberIds, openTally, pendingBefore,
  pendingPresence, presentMembers, quorumFor, quorumStated, reasumptionSignaturesNeeded, unhandledItems,
} from './rules.ts';
import {cleanTitle, newItem, parseAgendaText, presidiumTemplate} from './agenda.ts';
import {defaultDocTypes, docTypeById, docTypeName, plainFormulas} from './doctypes.ts';
import {plural} from './text.ts';

export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
const fail = (message: string, status = 400): never => { throw new DomainError(message, status); };
function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) fail(message, status);
}

export interface SecretHooks {
  openKey: (ballotId: string) => {n: string; e: string; fingerprint: string};
  tally: (ballotId: string) => {za: number; przeciw: number; wstrzymuje: number};
  closeKey: (ballotId: string) => void;
  /** Usuwa oddane karty z wyborami głosowania przerwanego bez rozstrzygnięcia (F7), zanim klucz zostanie zniszczony. */
  discard: (ballotId: string) => void;
}
/** `docTypes` to słownik rodzajów dokumentów (F11); bez niego obowiązują rodzaje domyślne. */
export interface Context { roster: Roster; now: number; newId: () => string; secret?: SecretHooks; docTypes?: DocType[] }

// Polecenia domeny. Pola oznaczone „wymagane” w opisie są w typie nieobowiązkowe tylko dlatego, że wymóg zależy
// od stanu posiedzenia; domena sprawdza je przy wykonaniu. Opis warunków jest w /home/user/przeglad/v2-A/KONTRAKT.md.
export type Command =
  | {type: 'details'; title?: string; date?: string; time?: string; place?: string; mode?: MeetingMode; link?: string; noticeDate?: string; endsAt?: number;
    /** F10: dane do protokołu, nieobowiązkowe, także po otwarciu. `convener` to identyfikator osoby ze składu albo pusty napis. */
    protocolNumber?: string; recorder?: string; convener?: string}
  | {type: 'deputy'; personId: string | null; basis?: string}
  | {type: 'invite'; accountId: string; on: boolean}
  | {type: 'item_add'; title: string; parentId?: string | null; afterId?: string | null}
  /** F11, F12: `docType` pusty albo null usuwa „Co jest głosowane”; `presenters` zastępuje listę osób (najwyżej 6). */
  | {type: 'item_edit'; itemId: string; title?: string; note?: string; presenters?: Presenter[]; docType?: string | null}
  | {type: 'item_move'; itemId: string; direction: -1 | 1}
  /** F8: przeniesienie punktu w projekcie porządku. `parentId` null to punkt główny, `beforeId` null to koniec grupy. */
  | {type: 'item_place'; itemId: string; parentId: string | null; beforeId: string | null}
  | {type: 'item_remove'; itemId: string}
  | {type: 'agenda_import'; text: string; replace: boolean}
  | {type: 'item_material'; itemId: string; materialId: string; on: boolean}
  | {type: 'item_mode'; itemId: string; mode: VoteMode; basis: string}
  | {type: 'open'}
  | {type: 'presence'; who: string; guest?: boolean; present: boolean}
  /** F9: potwierdzenie (`accept: true`) albo odrzucenie zgłoszonej obecności przez osobę prowadzącą obrady albo biuro. */
  | {type: 'presence_confirm'; who: string; guest?: boolean; accept: boolean}
  | {type: 'presence_confirm_all'}
  | {type: 'quorum'}
  /** F5: kontynuacja jako spotkanie robocze do końca posiedzenia. */
  | {type: 'working_start'; reason: 'brak_kworum' | 'bez_stwierdzenia'}
  /** F4: `reason` wymagane przy rozpoczęciu poza kolejnością przyjętego porządku obrad. */
  | {type: 'item_start'; itemId: string; reason?: string}
  /** F4: `reason` wymagane przy odroczeniu i wycofaniu punktu przyjętego porządku. */
  | {type: 'item_end'; itemId: string; status: 'zakonczony' | 'odroczony' | 'wycofany'; reason?: string}
  | {type: 'present'; kind: Presentation['kind'] | null; id?: string}
  /** F1: `purpose: 'proba'` otwiera głosowanie próbne. F11: `docType` to „Co jest głosowane”. */
  | {type: 'ballot_open'; itemId: string | null; purpose: BallotPurpose; subject: string; mode: VoteMode; minutes: number; materialId?: string | null; docType?: string | null}
  | {type: 'vote'; ballotId: string; choice: Choice}
  | {type: 'ballot_absent'; ballotId: string; personId: string}
  | {type: 'ballot_close'; ballotId: string}
  | {type: 'announce'; ballotId: string}
  | {type: 'agenda_change'; change: AgendaChange; minutes: number}
  /** F14: `proposedBy` wymagane, identyfikator członka obecnego na posiedzeniu. */
  | {type: 'mode_motion'; itemId: string; mode: 'tajne' | 'imienne'; minutes: number; proposedBy?: string}
  | {type: 'motion_create'; ballotId: string; justification: string}
  | {type: 'motion_sign'; motionId: string; on: boolean}
  | {type: 'motion_withdraw'; motionId: string}
  | {type: 'motion_vote'; motionId: string; minutes: number}
  | {type: 'reasumption_open'; motionId: string; minutes: number}
  | {type: 'chair_handover'; personId: string}
  | {type: 'chair_take'}
  | {type: 'break'; on: boolean}
  /** F4: `reason` wymagane, gdy zostały nierozpatrzone punkty. */
  | {type: 'close'; reason?: string}
  /** F7: zakończenie głosowania między posiedzeniami przed terminem; przy `przerwij` `reason` wymagane. */
  | {type: 'procedure_end'; how: 'policz' | 'przerwij'; reason?: string}
  /** F7: nowy termin głosowania między posiedzeniami, co najmniej 5 minut od teraz. */
  | {type: 'procedure_deadline'; endsAt: number}
  | {type: 'message'; text: string};

/** Nazwa rodzaju materiału ze słownika (F11), np. „Stanowisko”; nieznany rodzaj to „Materiał”. */
export const materialTypeLabel = (t: MaterialType, types: DocType[] = defaultDocTypes) => docTypeName(t, types);

export function createMeeting(input: {
  id: string; organ: Meeting['organ']; kind: Meeting['kind']; title: string; date: string; time: string;
  place: string; mode: MeetingMode; createdBy: string; now: number; newId: () => string; endsAt?: number;
}): Meeting {
  const agenda = input.kind === 'posiedzenie'
    ? presidiumTemplate.map(([title, kind]) => newItem(input.newId(), title, kind))
    : [];
  return {
    id: input.id, organ: input.organ, kind: input.kind, title: input.title.trim().slice(0, 200),
    date: input.date, time: input.time, place: input.place.trim().slice(0, 200), mode: input.mode,
    link: '', noticeDate: '', status: 'przygotowanie', endsAt: input.endsAt,
    invited: [], agenda, agendaAdopted: false, currentItemId: null, presentation: null, materials: [],
    attendance: {}, guests: {}, presenceLog: [], chair: {current: null, deputy: null, deputyBasis: '', changes: []},
    quorumChecks: [], ballots: [], motions: [], messages: [],
    log: [{at: input.now, text: input.kind === 'posiedzenie' ? 'Utworzono posiedzenie.' : 'Utworzono głosowanie między posiedzeniami (§ 14 ust. 5).', by: input.createdBy}],
    revision: 1, createdAt: input.now, createdBy: input.createdBy,
  };
}

// Dni między wysłaniem zawiadomienia a posiedzeniem — § 7 ust. 1 wymaga co najmniej 7.
export function noticeDays(m: Meeting) {
  if (!m.noticeDate || !m.date) return null;
  return Math.round((Date.parse(m.date + 'T12:00:00Z') - Date.parse(m.noticeDate + 'T12:00:00Z')) / 86400000);
}

export const isMember = (roster: Roster, m: Meeting, personId: string | null) => !!membership(roster, m.organ, personId);
export const canChairOrgan = (roster: Roster, organ: string, personId: string | null) => !!membership(roster, organ, personId)?.canChair;
export const isChairman = (roster: Roster, organ: string, personId: string | null) => membership(roster, organ, personId)?.func === 'przewodniczacy';
export function isOrganizer(roster: Roster, m: Meeting, actor: Actor) {
  return actor.account.admin || actor.account.kind === 'biuro' || canChairOrgan(roster, m.organ, actor.personId);
}
export function canView(roster: Roster, m: Meeting, actor: Actor) {
  return isOrganizer(roster, m, actor) || isMember(roster, m, actor.personId) || m.invited.includes(actor.account.id);
}

function log(m: Meeting, ctx: Context, actor: Actor | null, text: string, extra: {tag?: 'projekt'; ballotId?: string} = {}) {
  m.log.push({at: ctx.now, text, by: actor?.name ?? 'system', ...extra});
}
// F8: zmiana projektu porządku obrad po otwarciu posiedzenia trafia do dziennika z oznaczeniem `projekt`.
function draftLog(m: Meeting, ctx: Context, actor: Actor, text: string) {
  if (m.status !== 'przygotowanie') log(m, ctx, actor, `Zmieniono projekt porządku obrad. ${text}`, {tag: 'projekt'});
}
const docTypesOf = (ctx: Context) => ctx.docTypes ?? defaultDocTypes;
const disabledDocType = 'Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.';
/** Konto biura albo administratora: potwierdza obecność i widzi nieogłoszone wyniki. */
const isOffice = (actor: Actor) => actor.account.kind === 'biuro' || actor.account.admin;
// F2: dopóki wynik zamkniętego głosowania nie jest ogłoszony, prowadzenie obrad nie idzie dalej.
function requireAnnounced(m: Meeting) {
  const message = announceFirst(m);
  if (message) fail(message);
}
// F2: na trwającym posiedzeniu projekt porządku zmienia się dopiero po ogłoszeniu wyniku, bo przyjęcie porządku zapada
// przy ogłoszeniu (applyOutcome).
function requireDraftAnnounced(m: Meeting) {
  if (m.kind === 'posiedzenie' && m.status !== 'przygotowanie') requireAnnounced(m);
}
const workingRefusal = 'Na spotkaniu roboczym nie przeprowadza się głosowań.';
/** Najwyżej 500 znaków powodu bez zbędnych spacji; pusty napis, gdy powodu nie podano. */
const reasonOf = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
const name = (ctx: Context, id: string | null | undefined) => personName(ctx.roster, id);
const item = (m: Meeting, id: string | null | undefined) => m.agenda.find(i => i.id === id);
const ballot = (m: Meeting, id: string) => m.ballots.find(b => b.id === id) ?? fail('Nie znaleziono głosowania.', 404);
const openBallots = (m: Meeting) => m.ballots.filter(b => b.status === 'otwarte');
/** Otwarte głosowania w sprawach, bez głosowania próbnego, które nie blokuje innych czynności (F1). */
const regularOpen = (m: Meeting) => openBallots(m).filter(b => b.purpose !== 'proba');

function requireChair(m: Meeting, actor: Actor) {
  ensure(m.kind === 'posiedzenie' ? m.chair.current !== null && m.chair.current === actor.personId : true,
    'Tę czynność wykonuje osoba prowadząca posiedzenie.', 403);
}
function requireLive(m: Meeting) {
  ensure(m.status === 'trwa' || m.status === 'przerwa', m.status === 'przygotowanie' ? 'Posiedzenie nie zostało jeszcze otwarte.' : 'Posiedzenie zostało zamknięte.');
}
function canEditAgenda(roster: Roster, m: Meeting, actor: Actor) {
  if (m.status === 'przygotowanie') return isOrganizer(roster, m, actor);
  return m.kind === 'posiedzenie' && !m.agendaAdopted && m.status !== 'zakonczone' && m.chair.current === actor.personId;
}

// Punkty, które można procedować przed przyjęciem porządku obrad: do punktu „Przyjęcie porządku obrad” włącznie.
function allowedBeforeAdoption(m: Meeting, target: AgendaItem) {
  const top = m.agenda.filter(i => !i.parentId);
  const agendaPoint = top.findIndex(i => i.kind === 'porzadek');
  const root = target.parentId ? item(m, target.parentId)! : target;
  return agendaPoint >= 0 && top.indexOf(root) <= agendaPoint;
}

function applyAgendaChange(m: Meeting, ctx: Context, change: AgendaChange, afterAdoption: boolean) {
  if (change.op === 'dodaj') {
    ensure(change.title.trim(), 'Podaj nazwę punktu.');
    if (change.parentId) ensure(item(m, change.parentId) && !item(m, change.parentId)!.parentId, 'Podpunkt można dodać tylko do punktu głównego.');
    const added = newItem(ctx.newId(), change.title, 'sprawa', change.parentId ?? null);
    if (afterAdoption) added.addedAfterAdoption = true;
    let at = m.agenda.length;
    if (change.afterId) {
      const after = m.agenda.findIndex(i => i.id === change.afterId);
      ensure(after >= 0, 'Nie znaleziono punktu.');
      at = after + 1;
      while (!added.parentId && at < m.agenda.length && m.agenda[at].parentId) at++;
    } else if (change.parentId) {
      const parent = m.agenda.findIndex(i => i.id === change.parentId);
      at = parent + 1;
      while (at < m.agenda.length && m.agenda[at].parentId === change.parentId) at++;
    } else {
      const closing = m.agenda.findIndex(i => i.kind === 'zamkniecie');
      if (closing >= 0) at = closing;
    }
    m.agenda.splice(at, 0, added);
    return added;
  }
  const target = item(m, change.itemId);
  ensure(target, 'Nie znaleziono punktu.', 404);
  if (change.op === 'usun') {
    ensure(target.status === 'oczekuje', 'Można usunąć tylko punkt, którego jeszcze nie rozpoczęto.');
    ensure(!m.ballots.some(b => b.itemId === target.id || m.agenda.some(c => c.parentId === target.id && c.id === b.itemId)), 'Punkt ma już przeprowadzone głosowania. Zamiast go usuwać, oznacz go jako wycofany.');
    m.agenda = m.agenda.filter(i => i.id !== target.id && i.parentId !== target.id);
    return target;
  }
  const block = m.agenda.filter(i => i.id === target.id || i.parentId === target.id);
  m.agenda = m.agenda.filter(i => !block.includes(i));
  let at = change.beforeId ? m.agenda.findIndex(i => i.id === change.beforeId) : m.agenda.length;
  ensure(at >= 0, 'Nie znaleziono punktu.');
  m.agenda.splice(at, 0, ...block);
  return target;
}

// Tekst w cudzysłowie „…”, a cudzysłów wewnątrz zamienia się na »…« (brand/JEZYK.md).
const quoted = (text: string) => `„${text.replace(/„/g, '»').replace(/”/g, '«')}”`;

// „19 listopada 2026 r., godz. 18:00” w strefie Europe/Warsaw.
function dateTimeText(ts: number) {
  const date = new Intl.DateTimeFormat('pl-PL', {timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', year: 'numeric'}).format(ts);
  const time = new Intl.DateTimeFormat('pl-PL', {timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit'}).format(ts);
  return `${date} r., godz. ${time}`;
}

// Miejsce, w które applyAgendaChange wstawi dodawany punkt (bez sprawdzania danych), albo null, gdy punkt odniesienia nie istnieje.
function insertionIndex(agenda: AgendaItem[], change: {parentId: string | null; afterId: string | null}) {
  if (change.afterId) {
    let at = agenda.findIndex(i => i.id === change.afterId);
    if (at < 0) return null;
    at++;
    while (!change.parentId && at < agenda.length && agenda[at].parentId) at++;
    return at;
  }
  if (change.parentId) {
    let at = agenda.findIndex(i => i.id === change.parentId);
    if (at < 0) return null;
    at++;
    while (at < agenda.length && agenda[at].parentId === change.parentId) at++;
    return at;
  }
  const closing = agenda.findIndex(i => i.kind === 'zamkniecie');
  return closing >= 0 ? closing : agenda.length;
}

// Przedmiot głosowania nad zmianą porządku obrad: numer i tytuł punktu, a przy dodaniu także miejsce w porządku.
function describeChange(m: Meeting, change: AgendaChange) {
  const label = (it: AgendaItem) => `${itemNumber(m.agenda, it.id)} ${quoted(it.title)}`;
  if (change.op === 'dodaj') {
    const subject = `Wniosek o dodanie punktu ${quoted(cleanTitle(change.title))} do porządku obrad`;
    const at = insertionIndex(m.agenda, {parentId: change.parentId ?? null, afterId: change.afterId ?? null});
    if (at === null) return subject;
    const probe = {id: '\u0000nowy', parentId: change.parentId ?? null} as AgendaItem;
    const agenda = [...m.agenda.slice(0, at), probe, ...m.agenda.slice(at)];
    const no = itemNumber(agenda, probe.id);
    const parent = probe.parentId ? item(m, probe.parentId) : undefined;
    if (parent) return `${subject}, jako podpunktu ${no} w punkcie ${label(parent)}`;
    const top = agenda.filter(i => !i.parentId);
    const previous = top[top.indexOf(probe) - 1];
    return previous ? `${subject}, jako punktu ${no}, po punkcie ${label(previous)}` : `${subject}, jako punktu ${no}`;
  }
  const t = item(m, change.itemId);
  if (change.op === 'usun') return t ? `Wniosek o usunięcie punktu ${label(t)} z porządku obrad` : 'Wniosek o usunięcie punktu z porządku obrad';
  return t ? `Wniosek o przeniesienie punktu ${label(t)}` : 'Wniosek o przeniesienie punktu';
}

// Cele głosowań z własną formułą wyniku; pozostałe (uchwała, protokół, inna sprawa) zapisują rodzaj dokumentu i formuły.
const fixedFormula = new Set<BallotPurpose>(['porzadek', 'zmiana_porzadku', 'tryb', 'reasumpcja', 'wniosek', 'proba']);

function openBallot(m: Meeting, ctx: Context, actor: Actor, input: {
  itemId: string | null; purpose: BallotPurpose; subject: string; mode: VoteMode; minutes: number;
  materialId?: string | null; target?: Ballot['target']; reasumptionOf?: string; endsAt?: number; docType?: string | null; inherited?: boolean;
}) {
  const remote = m.kind === 'procedura';
  const trial = input.purpose === 'proba';
  const members = memberIds(ctx.roster, m.organ);
  const quorum = quorumFor(members.length);
  if (!remote) {
    ensure(m.status === 'trwa', m.status === 'przerwa' ? 'Trwa przerwa w obradach.' : 'Posiedzenie nie trwa.');
    ensure(!openBallots(m).length, 'Trwa inne głosowanie. Najpierw je zakończ.');
    requireAnnounced(m);
    ensure(trial || !m.working, workingRefusal);
    ensure(trial || m.agendaAdopted || ['porzadek', 'tryb', 'wniosek'].includes(input.purpose), 'Najpierw trzeba przyjąć porządek obrad.');
  }
  const it = input.itemId ? item(m, input.itemId) : undefined;
  if (input.itemId) ensure(it, 'Nie znaleziono punktu porządku obrad.', 404);
  ensure(input.subject.trim(), 'Podaj, czego dotyczy głosowanie.');
  if (input.mode !== 'jawne' && !trial) {
    ensure(it && it.mode === input.mode && it.modeBasis,
      input.mode === 'tajne' ? 'Głosowanie tajne jest możliwe dopiero po uchwaleniu przez Prezydium tajności głosowania.'
        : 'Głosowanie imienne jest możliwe dopiero po jego uchwaleniu przez Prezydium.');
  }
  if (input.mode === 'tajne') ensure(ctx.secret, 'Głosowanie tajne nie jest dostępne.');
  const eligible = remote ? members : presentMembers(m, ctx.roster);
  ensure(remote || trial || eligible.length >= quorum, `Brak kworum. Obecnych ${eligible.length} z ${members.length}, wymagane ${quorum} (§ 8 ust. 2).`);
  let material: Ballot['material'] = null;
  if (input.materialId) {
    const ref = m.materials.find(x => x.id === input.materialId);
    ensure(ref, 'Nie znaleziono materiału.', 404);
    material = {id: ref.id, version: ref.version, hash: ref.hash, title: ref.title};
  }
  const minutes = Math.round(Number(input.minutes));
  ensure(input.endsAt || (minutes >= 1 && minutes <= 240), 'Czas głosowania musi wynosić od 1 do 240 minut.');
  // F11: rodzaj sprawy i formuły wyniku zapisane w chwili otwarcia.
  let docType: string | undefined, formulas: Ballot['formulas'];
  if (!fixedFormula.has(input.purpose)) {
    if (input.docType) {
      const type = docTypeById(docTypesOf(ctx), input.docType);
      ensure(type, 'Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
      // F11: wskazany wprost rodzaj musi być włączony; rodzaj odziedziczony z punktu, materiału albo z głosowania
      // poddanego reasumpcji pozostaje dozwolony.
      ensure(type.active || input.docType === it?.docType || input.inherited, disabledDocType);
    }
    const chosen = docTypeFor(m, {explicit: input.docType, item: it, materialId: input.materialId, purpose: input.purpose, subject: input.subject});
    const type = docTypeById(docTypesOf(ctx), chosen);
    docType = chosen ?? undefined;
    formulas = type ? {adopted: type.adopted, rejected: type.rejected} : {...plainFormulas};
  }
  const id = ctx.newId();
  const b: Ballot = {
    // F1: głosowanie próbne nie ma numeru, a numeracja głosowań w sprawach je pomija.
    id, number: trial ? 0 : m.ballots.filter(x => x.purpose !== 'proba').length + 1, itemId: input.itemId, purpose: input.purpose,
    subject: input.subject.trim().slice(0, 400), material, mode: input.mode,
    modeBasis: input.mode === 'jawne' || trial ? '' : it!.modeBasis!, status: 'otwarte',
    openedAt: ctx.now, endsAt: input.endsAt ?? ctx.now + minutes * 60000, openedBy: actor.name,
    eligible, joined: [], absentDuring: [], membersTotal: members.length, quorum, remote, votes: {}, secret: null,
    target: input.target, reasumptionOf: input.reasumptionOf,
  };
  if (docType) b.docType = docType;
  if (formulas) b.formulas = formulas;
  if (input.mode === 'tajne') b.secret = {...ctx.secret!.openKey(id), issued: [], cast: 0};
  m.ballots.push(b);
  if (!remote) m.presentation = {kind: 'glosowanie', id, at: ctx.now};
  log(m, ctx, actor, trial ? `Otwarto głosowanie próbne ${b.mode}.` : `Otwarto głosowanie ${b.mode} nr ${b.number} ${quoted(b.subject)}.`);
  return b;
}

function closeBallot(m: Meeting, ctx: Context, b: Ballot, reason: NonNullable<Ballot['closeReason']>) {
  const counts = b.secret ? ctx.secret!.tally(b.id) : openTally(b);
  b.result = computeResult(b, counts);
  b.status = 'zamkniete';
  b.closedAt = ctx.now;
  b.closeReason = reason;
  if (b.secret) {
    b.secret.issued.sort();
    ctx.secret!.closeKey(b.id);
  }
  // F2: skutek rozstrzygnięcia zapada przy ogłoszeniu wyniku (applyOutcome), żeby nikt nie poznał go wcześniej.
  if (b.purpose !== 'proba' && (b.reasumptionOf || b.purpose === 'porzadek' || b.target)) b.outcomePending = true;
  const why = reason === 'wszyscy' ? 'zagłosowali wszyscy uprawnieni' : reason === 'czas' ? 'upłynął czas' : 'zakończone przez osobę prowadzącą obrady';
  const tally = `Za ${b.result.za}, przeciw ${b.result.przeciw}, wstrzymało się ${b.result.wstrzymuje}.`;
  log(m, ctx, null, b.purpose === 'proba' ? `Zakończono głosowanie próbne (${why}). ${tally}` : `Zakończono głosowanie nr ${b.number} (${why}). ${tally}`, {ballotId: b.id});
}

/**
 * Skutek rozstrzygnięcia głosowania, wykonywany przy ogłoszeniu wyniku (F2): przyjęcie porządku obrad i zakończenie
 * punktu „Przyjęcie porządku obrad”, zmiana porządku, tryb głosowania w punkcie, rozstrzygnięcie wniosku o reasumpcję
 * i zastąpienie wyniku głosowania poddanego reasumpcji. Głosowania zamknięte przed tą zasadą (bez `outcomePending`)
 * mają skutek już zapisany i drugi raz go nie dostają.
 */
function applyOutcome(m: Meeting, ctx: Context, b: Ballot) {
  if (!b.outcomePending || !b.result) return;
  delete b.outcomePending;
  const ok = b.result.adopted;
  if (b.reasumptionOf) {
    const original = m.ballots.find(x => x.id === b.reasumptionOf);
    if (original) original.supersededBy = b.id;
  }
  if (ok && b.purpose === 'porzadek') {
    m.agendaAdopted = true;
    const point = m.agenda.find(i => i.kind === 'porzadek');
    if (point && point.status !== 'zakonczony') { point.status = 'zakonczony'; point.endedAt = ctx.now; }
  }
  if (ok && b.target?.kind === 'zmiana_porzadku') applyAgendaChange(m, ctx, b.target.change, true);
  if (b.target?.kind === 'tryb' && ok) {
    const it = item(m, b.target.itemId);
    if (it) { it.mode = b.target.mode; it.modeBasis = `uchwalone przez Prezydium w głosowaniu nr ${b.number}`; }
  }
  if (b.target?.kind === 'reasumpcja') {
    const motion = m.motions.find(x => x.id === (b.target as {motionId: string}).motionId);
    if (motion) motion.status = ok ? 'przyjety' : 'odrzucony';
  }
}

// F7: przerwanie głosowania między posiedzeniami bez rozstrzygnięcia. Wyniku się nie liczy. Wybory nie zostają w danych:
// w jawnym zostaje tylko lista głosujących, a w tajnym karty z wyborami są usuwane (discard) i klucz niszczony jak przy
// zwykłym zamknięciu; lista pobranych kart zostaje uporządkowana alfabetycznie.
function abortBallot(m: Meeting, ctx: Context, actor: Actor, b: Ballot, reason: string) {
  b.status = 'zamkniete';
  b.closedAt = ctx.now;
  b.closeReason = 'przerwane';
  b.aborted = {reason, at: ctx.now, by: actor.name};
  if (!b.secret) b.aborted.voters = Object.keys(b.votes).sort();
  b.votes = {};
  if (b.secret) {
    b.secret.issued.sort();
    ctx.secret!.discard(b.id);
    ctx.secret!.closeKey(b.id);
  }
  log(m, ctx, actor, `Przerwano głosowanie nr ${b.number}. Rozstrzygnięcie nie zapadło.`, {ballotId: b.id});
}

// Zamyka głosowania po upływie czasu albo gdy zagłosowali wszyscy uprawnieni; kończy głosowanie między posiedzeniami.
export function advance(m: Meeting, ctx: Context) {
  let changed = false;
  for (const b of openBallots(m)) {
    if (ctx.now >= b.endsAt) { closeBallot(m, ctx, b, 'czas'); changed = true; }
    else if (everyoneVoted(b)) { closeBallot(m, ctx, b, 'wszyscy'); changed = true; }
  }
  if (m.kind === 'procedura' && m.status === 'trwa' && m.ballots.length && !openBallots(m).length) {
    m.status = 'zakonczone';
    m.closedAt = ctx.now;
    log(m, ctx, null, 'Głosowanie między posiedzeniami zakończone. Wszystkie głosowania zostały zamknięte.');
    changed = true;
  }
  return changed;
}

// `reportedAt`: obecność potwierdza zgłoszenie z tej godziny (F9). Zgłoszenie samo nie zmienia uprawnionych do głosowania.
function setPresence(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean, present: boolean, reportedAt?: number) {
  const map = guest ? m.guests : m.attendance;
  const before = map[who] ?? 'nieobecny';
  if ((before === 'obecny') === present) return;
  map[who] = present ? 'obecny' : before === 'obecny' ? 'wyszedl' : 'nieobecny';
  m.presenceLog.push({who, guest, type: present ? 'przybycie' : 'wyjscie', at: ctx.now, by: actor.name, ...(present && reportedAt ? {reportedAt} : {})});
  if (!guest) {
    for (const b of openBallots(m)) {
      if (present) {
        if (!b.eligible.includes(who)) { b.eligible.push(who); b.joined.push(who); }
        b.absentDuring = b.absentDuring.filter(id => id !== who);
      } else if (b.eligible.includes(who) && !hasVoted(b, who) && !b.absentDuring.includes(who)) {
        b.absentDuring.push(who);
      }
    }
  }
}

// F9: zgłoszenie obecności na posiedzeniu stacjonarnym czeka na potwierdzenie osoby prowadzącej obrady albo biura.
function reportPresence(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean) {
  const map = guest ? m.guests : m.attendance;
  if (map[who] === 'obecny' || map[who] === 'zgloszony') return;
  map[who] = 'zgloszony';
  m.presenceLog.push({who, guest, type: 'zgloszenie', at: ctx.now, by: actor.name});
}
// Odrzucenie albo wycofanie zgłoszenia: osoba wraca do stanu sprzed zgłoszenia („wyszedl”, gdy była już obecna).
function dropReport(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean) {
  const map = guest ? m.guests : m.attendance;
  if (map[who] !== 'zgloszony') return;
  map[who] = m.presenceLog.some(e => e.who === who && !!e.guest === guest && e.type === 'przybycie') ? 'wyszedl' : 'nieobecny';
  m.presenceLog.push({who, guest, type: 'odrzucenie', at: ctx.now, by: actor.name});
}
const reportTime = (m: Meeting, who: string, guest: boolean) =>
  [...m.presenceLog].reverse().find(e => e.who === who && !!e.guest === guest && e.type === 'zgloszenie')?.at;
/** Potwierdza zgłoszenia obecności: osoba prowadząca obrady albo biuro (F9). */
const confirmsPresence = (m: Meeting, actor: Actor) => (!!actor.personId && m.chair.current === actor.personId) || isOffice(actor);

export function apply(meeting: Meeting, cmd: Command, actor: Actor, ctx: Context): Meeting {
  const m = structuredClone(meeting);
  const roster = ctx.roster;
  ensure(canView(roster, m, actor), 'Brak dostępu do tego posiedzenia.', 403);
  advance(m, ctx);
  const posiedzenie = m.kind === 'posiedzenie';

  switch (cmd.type) {
    case 'details': {
      ensure(isOrganizer(roster, m, actor), 'Dane posiedzenia zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
      // Po otwarciu zmienia się już tylko odnośnik do połączenia i dane do protokołu (F10).
      const later = new Set(['type', 'link', 'protocolNumber', 'recorder', 'convener']);
      ensure(m.status === 'przygotowanie' || Object.keys(cmd).every(k => later.has(k)), 'Po otwarciu można zmienić tylko odnośnik do połączenia i dane do protokołu.');
      if (cmd.title !== undefined) { ensure(cmd.title.trim(), 'Podaj tytuł.'); m.title = cmd.title.trim().slice(0, 200); }
      if (cmd.date !== undefined) { ensure(/^\d{4}-\d{2}-\d{2}$/.test(cmd.date), 'Nieprawidłowa data.'); m.date = cmd.date; }
      if (cmd.time !== undefined) { ensure(/^\d{2}:\d{2}$/.test(cmd.time), 'Nieprawidłowa godzina.'); m.time = cmd.time; }
      if (cmd.place !== undefined) m.place = cmd.place.trim().slice(0, 200);
      if (cmd.mode !== undefined) { ensure(['stacjonarne', 'zdalne'].includes(cmd.mode), 'Nieprawidłowy tryb.'); m.mode = cmd.mode; }
      if (cmd.link !== undefined) {
        ensure(!cmd.link || /^https:\/\/\S+$/.test(cmd.link), 'Wpisz pełny odnośnik do połączenia, zaczynający się od https://.');
        m.link = cmd.link.slice(0, 500);
      }
      if (cmd.noticeDate !== undefined) { ensure(!cmd.noticeDate || /^\d{4}-\d{2}-\d{2}$/.test(cmd.noticeDate), 'Nieprawidłowa data zawiadomienia.'); m.noticeDate = cmd.noticeDate; }
      if (cmd.endsAt !== undefined) { ensure(m.kind === 'procedura' && cmd.endsAt > ctx.now, 'Ustaw koniec głosowania później niż teraz.'); m.endsAt = cmd.endsAt; }
      if (cmd.protocolNumber !== undefined) m.protocolNumber = String(cmd.protocolNumber).replace(/\s+/g, ' ').trim().slice(0, 60) || undefined;
      if (cmd.recorder !== undefined) m.recorder = String(cmd.recorder).replace(/\s+/g, ' ').trim().slice(0, 120) || undefined;
      if (cmd.convener !== undefined) {
        ensure(!cmd.convener || isMember(roster, m, cmd.convener), 'Zwołującego wybierz ze składu organu.');
        m.convener = cmd.convener || undefined;
      }
      break;
    }
    case 'deputy': {
      ensure(posiedzenie && m.status !== 'zakonczone', 'Zastępcę wyznacza się przed posiedzeniem lub w jego trakcie.');
      const chairman = isChairman(roster, m.organ, actor.personId);
      ensure(chairman || actor.account.admin || actor.account.kind === 'biuro', 'Zastępcę wyznacza przewodniczący (§ 16).', 403);
      if (cmd.personId) {
        const ms = membership(roster, m.organ, cmd.personId);
        ensure(ms?.func === 'wiceprzewodniczacy', 'Zastępcą przewodniczącego może być wiceprzewodniczący (§ 16).');
      }
      const basis = chairman ? 'wyznaczenie przez przewodniczącego (§ 16)' : (cmd.basis ?? '').trim();
      ensure(chairman || !cmd.personId || basis.length >= 5, 'Podaj podstawę wyznaczenia, np. uchwałę Prezydium (§ 16).');
      m.chair.deputy = cmd.personId;
      m.chair.deputyBasis = cmd.personId ? basis : '';
      log(m, ctx, actor, cmd.personId ? `Na czas nieobecności przewodniczącego prowadzi ${name(ctx, cmd.personId)} (${basis}).` : 'Usunięto wyznaczenie zastępcy.');
      break;
    }
    case 'invite': {
      ensure(isOrganizer(roster, m, actor), 'Zaproszenia zaznacza biuro, przewodniczący albo wiceprzewodniczący.', 403);
      ensure(m.status !== 'zakonczone', 'Posiedzenie jest zamknięte.');
      m.invited = cmd.on ? [...new Set([...m.invited, cmd.accountId])] : m.invited.filter(id => id !== cmd.accountId);
      break;
    }
    case 'item_add': {
      ensure(canEditAgenda(roster, m, actor), m.agendaAdopted ? 'Przyjęty porządek obrad zmienia się w głosowaniu.' : 'Porządek obrad poprawia biuro, przewodniczący albo wiceprzewodniczący, a po otwarciu posiedzenia osoba prowadząca obrady.', 403);
      requireDraftAnnounced(m);
      const added = applyAgendaChange(m, ctx, {op: 'dodaj', title: cmd.title, parentId: cmd.parentId ?? null, afterId: cmd.afterId ?? null}, false);
      draftLog(m, ctx, actor, `Dodano ${added.parentId ? 'podpunkt' : 'punkt'} ${itemNumber(m.agenda, added.id)} ${quoted(added.title)}.`);
      break;
    }
    case 'item_edit': {
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      if (cmd.title !== undefined) {
        ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
        ensure(cmd.title.trim(), 'Podaj nazwę punktu.');
        requireDraftAnnounced(m);
        const before = it.title;
        it.title = cmd.title.replace(/\s+/g, ' ').trim().slice(0, 400);
        if (it.title !== before) draftLog(m, ctx, actor, `Punkt ${itemNumber(m.agenda, it.id)} ${quoted(before)} ma nową nazwę ${quoted(it.title)}.`);
      }
      if (cmd.note !== undefined || cmd.presenters !== undefined || cmd.docType !== undefined) {
        ensure(isOrganizer(roster, m, actor) || m.chair.current === actor.personId, 'Notatki do protokołu prowadzi osoba prowadząca obrady albo biuro.', 403);
        if (cmd.note !== undefined) it.note = cmd.note.slice(0, 20000);
        if (cmd.presenters !== undefined) it.presenters = cleanPresenters(cmd.presenters);
        if (cmd.docType !== undefined) {
          const type = cmd.docType ? docTypeById(docTypesOf(ctx), cmd.docType) : undefined;
          ensure(!cmd.docType || type, 'Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
          // F11: rodzaju wyłączonego przez administratora nie wybiera się na nowo; już wybrany może zostać.
          ensure(!type || type.active || cmd.docType === it.docType, disabledDocType);
          if (cmd.docType) it.docType = cmd.docType; else delete it.docType;
        }
      }
      break;
    }
    case 'item_move': {
      ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      requireDraftAnnounced(m);
      const siblings = m.agenda.filter(i => i.parentId === it.parentId);
      const index = siblings.indexOf(it), other = siblings[index + cmd.direction];
      ensure(other, 'Punktu nie można przesunąć dalej.');
      const from = itemNumber(m.agenda, it.id);
      applyAgendaChange(m, ctx, {op: 'przesun', itemId: (cmd.direction < 0 ? it : other).id, beforeId: (cmd.direction < 0 ? other : it).id}, false);
      draftLog(m, ctx, actor, `Punkt ${quoted(it.title)} przeniesiono z pozycji ${from} na pozycję ${itemNumber(m.agenda, it.id)}.`);
      break;
    }
    case 'item_place': {
      ensure(canEditAgenda(roster, m, actor), m.agendaAdopted ? 'Przyjęty porządek obrad zmienia się w głosowaniu.' : 'Porządek obrad poprawia biuro, przewodniczący albo wiceprzewodniczący, a po otwarciu posiedzenia osoba prowadząca obrady.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      requireDraftAnnounced(m);
      const from = itemNumber(m.agenda, it.id);
      placeItem(m, it, cmd.parentId ?? null, cmd.beforeId ?? null);
      const to = itemNumber(m.agenda, it.id);
      if (to !== from) draftLog(m, ctx, actor, `Punkt ${quoted(it.title)} przeniesiono z pozycji ${from} na pozycję ${to}.`);
      break;
    }
    case 'item_remove': {
      ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(posiedzenie ? it.kind !== 'porzadek' : true, 'Punktu „Przyjęcie porządku obrad” nie można usunąć.');
      requireDraftAnnounced(m);
      const number = itemNumber(m.agenda, it.id);
      applyAgendaChange(m, ctx, {op: 'usun', itemId: it.id}, false);
      draftLog(m, ctx, actor, `Usunięto ${it.parentId ? 'podpunkt' : 'punkt'} ${number} ${quoted(it.title)}.`);
      break;
    }
    case 'agenda_import': {
      ensure(canEditAgenda(roster, m, actor), 'Porządek wczytuje biuro, przewodniczący albo wiceprzewodniczący przed jego przyjęciem.', 403);
      requireDraftAnnounced(m);
      const parsed = parseAgendaText(cmd.text.slice(0, 100000), {flat: m.kind === 'procedura'});
      ensure(parsed.items.length, parsed.warnings[0] ?? 'Brak punktów.');
      if (cmd.replace) {
        ensure(m.status === 'przygotowanie', 'Po otwarciu posiedzenia porządek można tylko uzupełniać.');
        ensure(!m.ballots.length && m.agenda.every(i => i.status === 'oczekuje' || i.kind === 'otwarcie'), 'Po rozpoczęciu obrad nie można zastąpić porządku. Dodawaj punkty pojedynczo.');
        m.agenda = [];
      }
      const ids: string[] = [];
      for (const p of parsed.items) {
        const it = newItem(ctx.newId(), p.title, posiedzenie ? p.kind : 'sprawa', p.parent === null ? null : ids[p.parent]);
        ids.push(it.id);
        m.agenda.push(it);
      }
      const count = `${parsed.items.length} ${plural(parsed.items.length, 'pozycja', 'pozycje', 'pozycji')}`;
      if (m.status === 'przygotowanie') log(m, ctx, actor, `Wczytano porządek obrad (${count}).`);
      else draftLog(m, ctx, actor, `Wczytano punkty z tekstu (${count}).`);
      break;
    }
    case 'item_material': {
      ensure(isOrganizer(roster, m, actor) || m.chair.current === actor.personId, 'Materiały przypisuje biuro albo osoba prowadząca obrady.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(m.materials.some(x => x.id === cmd.materialId), 'Nie znaleziono materiału.', 404);
      it.materialIds = cmd.on ? [...new Set([...it.materialIds, cmd.materialId])] : it.materialIds.filter(id => id !== cmd.materialId);
      break;
    }
    case 'item_mode': {
      ensure(m.kind === 'procedura' && m.status === 'przygotowanie' && isOrganizer(roster, m, actor), 'Tryb głosowania ustala się przed rozpoczęciem głosowania między posiedzeniami.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(['jawne', 'imienne', 'tajne'].includes(cmd.mode), 'Nieprawidłowy tryb głosowania.');
      ensure(cmd.mode === 'jawne' || cmd.basis.trim().length >= 5, 'Wpisz podstawę, czyli kiedy Prezydium uchwaliło tajność głosowania albo głosowanie imienne.');
      it.mode = cmd.mode === 'jawne' ? undefined : cmd.mode;
      it.modeBasis = cmd.mode === 'jawne' ? undefined : cmd.basis.trim().slice(0, 300);
      break;
    }
    case 'open': {
      ensure(m.status === 'przygotowanie', 'To posiedzenie zostało już otwarte.');
      ensure(canChairOrgan(roster, m.organ, actor.personId), posiedzenie ? 'Posiedzenie otwiera przewodniczący albo wiceprzewodniczący (§ 9 ust. 1).' : 'Głosowanie między posiedzeniami rozpoczyna przewodniczący albo wiceprzewodniczący.', 403);
      if (posiedzenie) {
        m.status = 'trwa';
        m.openedAt = ctx.now;
        m.chair.current = actor.personId;
        m.chair.changes.push({at: ctx.now, from: null, to: actor.personId!, by: actor.name, reason: 'otwarcie posiedzenia'});
        setPresence(m, ctx, actor, actor.personId!, false, true);
        const first = m.agenda.find(i => !i.parentId);
        if (first) { first.status = 'w_toku'; first.startedAt = ctx.now; m.currentItemId = first.id; m.presentation = {kind: 'punkt', id: first.id, at: ctx.now}; }
        const days = noticeDays(m);
        log(m, ctx, actor, `Otwarcie posiedzenia. Prowadzi ${actor.name}.`);
        if (days === null) log(m, ctx, null, 'Nie wpisano daty wysłania zawiadomienia (§ 7 ust. 1).');
        else if (days < 7) log(m, ctx, null, `Zawiadomienie wysłano ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, a regulamin wymaga co najmniej 7 dni (§ 7 ust. 1).`);
      } else {
        const acts = m.agenda.filter(i => !i.parentId);
        ensure(acts.length, 'Dodaj co najmniej jedną sprawę do głosowania.');
        ensure(m.endsAt && m.endsAt > ctx.now + 5 * 60000, 'Ustaw koniec głosowania co najmniej 5 minut od teraz.');
        m.status = 'trwa';
        m.openedAt = ctx.now;
        m.chair.current = actor.personId;
        for (const act of acts) {
          act.status = 'w_toku';
          act.startedAt = ctx.now;
          const ref = m.materials.find(x => act.materialIds.includes(x.id));
          const kind = act.docType ?? ref?.type;
          openBallot(m, ctx, actor, {
            itemId: act.id, purpose: kind === 'uchwala' ? 'uchwala' : 'inna', subject: act.title,
            mode: act.mode ?? 'jawne', minutes: 0, materialId: ref?.id ?? null, endsAt: m.endsAt,
          });
        }
        log(m, ctx, actor, `Rozpoczęto głosowanie między posiedzeniami. Potrwa do ${dateTimeText(m.endsAt)}.`);
      }
      break;
    }
    case 'presence': {
      ensure(posiedzenie, 'W głosowaniu między posiedzeniami nie prowadzi się listy obecności.');
      ensure(m.status !== 'zakonczone', 'Posiedzenie zostało zamknięte.');
      const guest = !!cmd.guest;
      const self = guest ? actor.account.id === cmd.who : actor.personId === cmd.who;
      ensure(self || m.chair.current === actor.personId || isOrganizer(roster, m, actor), 'Obecność innej osoby zapisuje osoba prowadząca obrady albo biuro.', 403);
      if (guest) ensure(m.invited.includes(cmd.who), 'Ta osoba nie jest zaproszona.');
      else ensure(isMember(roster, m, cmd.who), 'Ta osoba nie jest członkiem organu.');
      const state = (guest ? m.guests : m.attendance)[cmd.who] ?? 'nieobecny';
      if (!cmd.present && state === 'zgloszony') dropReport(m, ctx, actor, cmd.who, guest);
      // F9: na posiedzeniu stacjonarnym osoba zgłasza obecność, a potwierdza ją osoba prowadząca obrady albo biuro.
      else if (cmd.present && self && m.mode === 'stacjonarne' && !confirmsPresence(m, actor)) reportPresence(m, ctx, actor, cmd.who, guest);
      else setPresence(m, ctx, actor, cmd.who, guest, cmd.present, state === 'zgloszony' ? reportTime(m, cmd.who, guest) : undefined);
      break;
    }
    case 'presence_confirm': {
      ensure(posiedzenie && m.status !== 'zakonczone', 'Obecność potwierdza się na posiedzeniu.');
      ensure(confirmsPresence(m, actor), 'Obecność potwierdza osoba prowadząca obrady albo biuro.', 403);
      const guest = !!cmd.guest;
      ensure(((guest ? m.guests : m.attendance)[cmd.who] ?? 'nieobecny') === 'zgloszony', 'Ta osoba nie zgłosiła obecności albo zgłoszenie już rozpatrzono.', 409);
      if (cmd.accept) setPresence(m, ctx, actor, cmd.who, guest, true, reportTime(m, cmd.who, guest));
      else dropReport(m, ctx, actor, cmd.who, guest);
      break;
    }
    case 'presence_confirm_all': {
      ensure(posiedzenie && m.status !== 'zakonczone', 'Obecność potwierdza się na posiedzeniu.');
      ensure(confirmsPresence(m, actor), 'Obecność potwierdza osoba prowadząca obrady albo biuro.', 403);
      const pending = pendingPresence(m);
      ensure(pending.length, 'Nie ma zgłoszeń obecności do potwierdzenia.', 409);
      for (const p of pending) setPresence(m, ctx, actor, p.who, p.guest, true, p.at || undefined);
      break;
    }
    case 'quorum': {
      requireLive(m); requireChair(m, actor);
      const total = memberIds(roster, m.organ).length, present = presentMembers(m, roster).length, required = quorumFor(total);
      m.quorumChecks.push({at: ctx.now, present, required, by: actor.name});
      log(m, ctx, actor, present >= required ? `Stwierdzono kworum. Obecnych ${present} z ${total}, wymagane ${required}.` : `Stwierdzono brak kworum. Obecnych ${present} z ${total}, wymagane ${required}.`);
      break;
    }
    case 'working_start': {
      ensure(posiedzenie, 'Spotkanie robocze dotyczy posiedzenia.');
      requireLive(m); requireChair(m, actor);
      ensure(!m.working, 'To posiedzenie jest już spotkaniem roboczym.', 409);
      ensure(cmd.reason === 'brak_kworum' || cmd.reason === 'bez_stwierdzenia', 'Nieprawidłowy powód spotkania roboczego.');
      m.working = {at: ctx.now, by: actor.name, reason: cmd.reason};
      log(m, ctx, actor, 'Posiedzenie kontynuowane jako spotkanie robocze. Bez kworum Prezydium nie podejmuje uchwał (§ 8 ust. 2).');
      break;
    }
    case 'item_start': {
      requireLive(m); requireChair(m, actor);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(!regularOpen(m).length, 'Trwa głosowanie. Poczekaj na jego zakończenie.');
      if (posiedzenie) {
        requireAnnounced(m);
        // F5: po punkcie otwarcia obrady idą dalej po pozytywnym stwierdzeniu kworum albo jako spotkanie robocze.
        const root = it.parentId ? item(m, it.parentId)! : it;
        ensure(root.kind === 'otwarcie' || m.working || quorumStated(m), 'Nie stwierdzono kworum. Stwierdź kworum albo kontynuuj jako spotkanie robocze.');
      }
      ensure(m.agendaAdopted || m.working || allowedBeforeAdoption(m, it), 'Najpierw przyjmij porządek obrad. Dopiero potem przechodzi się do kolejnych spraw.');
      ensure(it.status !== 'wycofany', 'Ten punkt został wycofany.');
      // F4: rozpoczęcie poza kolejnością przyjętego porządku wymaga powodu do protokołu.
      const skipped = posiedzenie && m.agendaAdopted ? pendingBefore(m, it) : [];
      const reason = reasonOf(cmd.reason);
      if (skipped.length) {
        ensure(reason, 'Podaj powód rozpoczęcia punktu poza kolejnością przyjętego porządku obrad.');
        it.outOfOrder = {reason, at: ctx.now, by: actor.name};
      }
      const previous = item(m, m.currentItemId);
      if (previous && previous.id !== it.id && previous.status === 'w_toku' && previous.id !== it.parentId) {
        previous.status = 'zakonczony'; previous.endedAt = ctx.now;
        const parent = item(m, previous.parentId);
        if (parent && parent.id !== it.parentId && parent.status === 'w_toku') { parent.status = 'zakonczony'; parent.endedAt = ctx.now; }
      }
      if (it.parentId) {
        const parent = item(m, it.parentId)!;
        if (parent.status === 'oczekuje' || parent.status === 'odroczony') { parent.status = 'w_toku'; parent.startedAt ??= ctx.now; }
      }
      it.status = 'w_toku'; it.startedAt ??= ctx.now;
      m.currentItemId = it.id;
      m.presentation = {kind: 'punkt', id: it.id, at: ctx.now};
      log(m, ctx, actor, skipped.length
        ? `Rozpoczęto punkt ${itemNumber(m.agenda, it.id)} ${quoted(it.title)} poza kolejnością przyjętego porządku obrad. Powód ${quoted(reason)}.`
        : `Rozpoczęto punkt ${itemNumber(m.agenda, it.id)} ${quoted(it.title)}.`);
      break;
    }
    case 'item_end': {
      requireLive(m); requireChair(m, actor);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(['zakonczony', 'odroczony', 'wycofany'].includes(cmd.status), 'Nieprawidłowy status punktu.');
      ensure(!openBallots(m).some(b => b.itemId === it.id), 'W tym punkcie trwa głosowanie.');
      if (posiedzenie) requireAnnounced(m);
      ensure(it.kind !== 'porzadek' || m.agendaAdopted || cmd.status !== 'zakonczony', 'Porządek obrad nie został jeszcze przyjęty.');
      // F4: odroczenie i wycofanie punktu przyjętego porządku wymaga powodu do protokołu.
      const reason = cmd.status === 'zakonczony' ? '' : reasonOf(cmd.reason);
      if (cmd.status !== 'zakonczony' && posiedzenie && m.agendaAdopted) ensure(reason, cmd.status === 'odroczony' ? 'Podaj powód odroczenia punktu.' : 'Podaj powód wycofania punktu.');
      if (reason) it.statusReason = reason; else delete it.statusReason;
      it.status = cmd.status; it.endedAt = ctx.now;
      const label = {zakonczony: 'zakończony', odroczony: 'odroczony', wycofany: 'wycofany'}[cmd.status];
      log(m, ctx, actor, `Punkt ${itemNumber(m.agenda, it.id)} ${label}.${reason ? ` Powód ${quoted(reason)}.` : ''}`);
      break;
    }
    case 'present': {
      requireLive(m); requireChair(m, actor);
      if (!cmd.kind) { m.presentation = null; break; }
      ensure(['punkt', 'material', 'glosowanie', 'wynik'].includes(cmd.kind) && cmd.id, 'Nieprawidłowa prezentacja.');
      if (cmd.kind === 'punkt') ensure(item(m, cmd.id), 'Nie znaleziono punktu.', 404);
      if (cmd.kind === 'material') ensure(m.materials.some(x => x.id === cmd.id), 'Nie znaleziono materiału.', 404);
      if (cmd.kind === 'glosowanie' || cmd.kind === 'wynik') ballot(m, cmd.id!);
      m.presentation = {kind: cmd.kind, id: cmd.id!, at: ctx.now};
      break;
    }
    case 'ballot_open': {
      ensure(posiedzenie, 'W głosowaniu między posiedzeniami wszystkie głosowania otwierają się razem z jego rozpoczęciem.');
      requireLive(m); requireChair(m, actor);
      ensure(['uchwala', 'porzadek', 'protokol', 'wniosek', 'inna', 'proba'].includes(cmd.purpose), 'Nieprawidłowy rodzaj głosowania.');
      if (cmd.purpose === 'proba') {
        // F1: głosowanie próbne bez skutków, jawne albo tajne, bez punktu, materiału, kworum i uchwalania trybu.
        ensure(cmd.mode === 'jawne' || cmd.mode === 'tajne', 'Głosowanie próbne jest jawne albo tajne.');
        openBallot(m, ctx, actor, {itemId: null, purpose: 'proba', subject: (cmd.subject ?? '').trim() || 'Głosowanie próbne', mode: cmd.mode, minutes: cmd.minutes ?? 1});
        break;
      }
      ensure(['jawne', 'imienne', 'tajne'].includes(cmd.mode), 'Nieprawidłowy tryb głosowania.');
      if (cmd.purpose === 'porzadek') ensure(!m.agendaAdopted, 'Porządek obrad został już przyjęty. Jego zmiany głosuje się osobno.');
      // F3: tryb uchwalony przez Prezydium wiąże głosowanie w sprawie (bez wniosków, np. o poprawkę).
      const it = cmd.itemId ? item(m, cmd.itemId) : undefined;
      if (it?.mode && it.modeBasis && ['uchwala', 'protokol', 'inna'].includes(cmd.purpose) && cmd.mode !== it.mode) {
        fail(`Prezydium uchwaliło w tej sprawie głosowanie ${it.mode} (§ 11). Otwórz głosowanie w tym trybie.`);
      }
      openBallot(m, ctx, actor, {itemId: cmd.itemId, purpose: cmd.purpose, subject: cmd.subject, mode: cmd.mode, minutes: cmd.minutes, materialId: cmd.materialId, docType: cmd.docType});
      break;
    }
    case 'vote': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'otwarte', 'Głosowanie zostało zakończone.');
      ensure(!b.secret, 'W głosowaniu tajnym głos oddaje się kartą tajną.');
      ensure(['za', 'przeciw', 'wstrzymuje'].includes(cmd.choice), 'Wybierz „za”, „przeciw” albo „wstrzymuję się”.');
      ensure(actor.personId && b.eligible.includes(actor.personId), 'To konto nie jest uprawnione do udziału w tym głosowaniu.', 403);
      if (!b.remote) ensure(m.attendance[actor.personId] === 'obecny', 'Najpierw potwierdź obecność na posiedzeniu.');
      ensure(!(actor.personId in b.votes), 'Głos w tym głosowaniu został już oddany i nie można go zmienić.', 409);
      b.votes[actor.personId] = cmd.choice;
      break;
    }
    case 'ballot_absent': {
      requireLive(m); requireChair(m, actor);
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'otwarte' && !b.remote, 'Nieobecność oznacza się w trwającym głosowaniu na posiedzeniu.');
      ensure(b.eligible.includes(cmd.personId) && !hasVoted(b, cmd.personId), 'Ta osoba już zagłosowała albo nie jest uprawniona.');
      setPresence(m, ctx, actor, cmd.personId, false, false);
      if (!b.absentDuring.includes(cmd.personId)) b.absentDuring.push(cmd.personId);
      log(m, ctx, actor, `Nieobecność podczas głosowania nr ${b.number} (${name(ctx, cmd.personId)}).`);
      break;
    }
    case 'ballot_close': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'otwarte', 'Głosowanie zostało już zakończone.');
      ensure(b.remote ? canChairOrgan(roster, m.organ, actor.personId) : m.chair.current === actor.personId, 'Głosowanie kończy osoba prowadząca obrady.', 403);
      closeBallot(m, ctx, b, 'prowadzacy');
      break;
    }
    case 'announce': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'zamkniete', 'Wynik można ogłosić po zakończeniu głosowania.');
      if (posiedzenie) { requireLive(m); requireChair(m, actor); }
      else ensure(canChairOrgan(roster, m.organ, actor.personId) || isOrganizer(roster, m, actor), 'Wynik ogłasza osoba prowadząca obrady.', 403);
      b.announcedAt ??= ctx.now;
      applyOutcome(m, ctx, b);
      if (posiedzenie) m.presentation = {kind: 'wynik', id: b.id, at: ctx.now};
      log(m, ctx, actor, `Ogłoszono wynik głosowania nr ${b.number}.`);
      break;
    }
    case 'agenda_change': {
      ensure(!m.working, workingRefusal);
      ensure(posiedzenie && m.agendaAdopted, 'Przed przyjęciem porządek obrad poprawia się bezpośrednio.');
      requireLive(m); requireChair(m, actor);
      const subject = describeChange(m, cmd.change);
      if (cmd.change.op !== 'dodaj') ensure(item(m, cmd.change.itemId), 'Nie znaleziono punktu.', 404);
      openBallot(m, ctx, actor, {itemId: null, purpose: 'zmiana_porzadku', subject, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'zmiana_porzadku', change: cmd.change}});
      break;
    }
    case 'mode_motion': {
      ensure(posiedzenie, 'W głosowaniu między posiedzeniami tryb ustala się przed jego rozpoczęciem.');
      requireLive(m); requireChair(m, actor);
      ensure(!m.working, workingRefusal);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(cmd.mode === 'tajne' || cmd.mode === 'imienne', 'Nieprawidłowy tryb.');
      // F14: wniosek zgłasza członek organu obecny na posiedzeniu.
      ensure(cmd.proposedBy, 'Wskaż, kto zgłasza wniosek.');
      ensure(isMember(roster, m, cmd.proposedBy) && m.attendance[cmd.proposedBy] === 'obecny', 'Wniosek zgłasza członek Prezydium obecny na posiedzeniu.');
      const what = `głosowania ${cmd.mode === 'tajne' ? 'tajnego' : 'imiennego'} w punkcie ${itemNumber(m.agenda, it.id)} ${quoted(it.title)}`;
      log(m, ctx, actor, `Wniosek o przeprowadzenie ${what}, zgłasza ${name(ctx, cmd.proposedBy)}.`);
      openBallot(m, ctx, actor, {itemId: null, purpose: 'tryb', subject: `Wniosek o przeprowadzenie ${what}`, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'tryb', itemId: it.id, mode: cmd.mode, proposedBy: cmd.proposedBy}});
      break;
    }
    case 'motion_create': {
      ensure(posiedzenie, 'Reasumpcja dotyczy głosowań na posiedzeniu (§ 12).');
      requireLive(m);
      ensure(!m.working, workingRefusal);
      const b = ballot(m, cmd.ballotId);
      ensure(actor.personId && m.attendance[actor.personId] === 'obecny' && isMember(roster, m, actor.personId), 'Wniosek składa członek Prezydium obecny na posiedzeniu.', 403);
      ensure(b.status === 'zamkniete', 'Reasumpcja dotyczy zakończonego głosowania.');
      ensure(b.mode === 'jawne', 'Reasumpcji nie podlegają wyniki głosowania imiennego i tajnego (§ 12).');
      ensure(!['reasumpcja', 'tryb', 'proba'].includes(b.purpose) && !b.aborted, 'Tego głosowania nie można poddać reasumpcji.');
      ensure(!b.reasumptionOf && !b.supersededBy, 'Reasumpcję w tej sprawie już przeprowadzono, a można ją przeprowadzić tylko raz (§ 12).');
      ensure(!m.motions.some(x => x.ballotId === b.id && ['zbiera_podpisy', 'zlozony', 'glosowany', 'przyjety'].includes(x.status)), 'Wniosek o reasumpcję tego głosowania już jest rozpatrywany.');
      ensure(cmd.justification.trim().length >= 10, 'Uzasadnij wniosek, czyli napisz, dlaczego wynik budzi wątpliwości (§ 12).');
      const motion = {id: ctx.newId(), type: 'reasumpcja' as const, ballotId: b.id, justification: cmd.justification.trim().slice(0, 2000), createdBy: actor.personId, createdAt: ctx.now, signatures: [actor.personId], status: 'zbiera_podpisy' as const};
      m.motions.push(motion);
      log(m, ctx, actor, `Złożono wniosek o reasumpcję głosowania nr ${b.number}.`);
      fileIfSupported(m, ctx, motion.id);
      break;
    }
    case 'motion_sign': {
      requireLive(m);
      const motion = m.motions.find(x => x.id === cmd.motionId) ?? fail('Nie znaleziono wniosku.', 404);
      ensure(motion.status === 'zbiera_podpisy', 'Wniosek nie zbiera już podpisów.');
      ensure(actor.personId && m.attendance[actor.personId] === 'obecny' && isMember(roster, m, actor.personId), 'Wniosek podpisuje członek Prezydium obecny na posiedzeniu.', 403);
      motion.signatures = cmd.on ? [...new Set([...motion.signatures, actor.personId])] : motion.signatures.filter(id => id !== actor.personId);
      if (!motion.signatures.length) motion.status = 'wycofany';
      fileIfSupported(m, ctx, motion.id);
      break;
    }
    case 'motion_withdraw': {
      const motion = m.motions.find(x => x.id === cmd.motionId) ?? fail('Nie znaleziono wniosku.', 404);
      ensure(['zbiera_podpisy', 'zlozony'].includes(motion.status), 'Tego wniosku nie można już wycofać.');
      ensure(motion.createdBy === actor.personId, 'Wniosek wycofuje osoba, która go złożyła.', 403);
      motion.status = 'wycofany';
      log(m, ctx, actor, 'Wycofano wniosek o reasumpcję.');
      break;
    }
    case 'motion_vote': {
      requireLive(m); requireChair(m, actor);
      const motion = m.motions.find(x => x.id === cmd.motionId) ?? fail('Nie znaleziono wniosku.', 404);
      ensure(motion.status === 'zlozony', 'Wniosek nie ma jeszcze wymaganej liczby podpisów (§ 12).');
      const original = ballot(m, motion.ballotId);
      const b = openBallot(m, ctx, actor, {itemId: original.itemId, purpose: 'reasumpcja', subject: `Wniosek o reasumpcję głosowania nr ${original.number} ${quoted(original.subject)}`, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'reasumpcja', ballotId: original.id, motionId: motion.id}});
      motion.status = 'glosowany';
      motion.voteBallotId = b.id;
      break;
    }
    case 'reasumption_open': {
      requireLive(m); requireChair(m, actor);
      const motion = m.motions.find(x => x.id === cmd.motionId) ?? fail('Nie znaleziono wniosku.', 404);
      ensure(motion.status === 'przyjety' && !motion.repeatBallotId, 'Ponowne głosowanie wymaga przyjęcia wniosku o reasumpcję.');
      const original = ballot(m, motion.ballotId);
      const b = openBallot(m, ctx, actor, {itemId: original.itemId, purpose: original.purpose, subject: original.subject, mode: 'jawne', minutes: cmd.minutes, reasumptionOf: original.id, docType: original.docType, inherited: true});
      if (original.material) b.material = {...original.material};
      if (original.formulas) b.formulas = {...original.formulas};
      motion.repeatBallotId = b.id;
      break;
    }
    case 'chair_handover': {
      requireLive(m); requireChair(m, actor);
      ensure(canChairOrgan(roster, m.organ, cmd.personId), 'Obradom przewodniczy przewodniczący lub wiceprzewodniczący (§ 9 ust. 1).');
      ensure(m.attendance[cmd.personId] === 'obecny', 'Prowadzenie można przekazać osobie obecnej.');
      ensure(cmd.personId !== actor.personId, 'Prowadzisz już posiedzenie.');
      m.chair.changes.push({at: ctx.now, from: m.chair.current, to: cmd.personId, by: actor.name, reason: 'przekazanie prowadzenia'});
      m.chair.current = cmd.personId;
      log(m, ctx, actor, `Prowadzenie obrad przejmuje ${name(ctx, cmd.personId)}.`);
      break;
    }
    case 'chair_take': {
      requireLive(m);
      ensure(actor.personId && canChairOrgan(roster, m.organ, actor.personId), 'Prowadzić może przewodniczący lub wiceprzewodniczący (§ 9 ust. 1).', 403);
      ensure(m.chair.current !== actor.personId, 'Prowadzisz już posiedzenie.');
      ensure(m.attendance[actor.personId] === 'obecny', 'Najpierw potwierdź obecność.');
      const chairman = isChairman(roster, m.organ, actor.personId);
      const currentAway = !m.chair.current || m.attendance[m.chair.current] !== 'obecny';
      const deputyAway = !m.chair.deputy || m.attendance[m.chair.deputy] !== 'obecny';
      ensure(chairman || currentAway && (m.chair.deputy === actor.personId || deputyAway),
        currentAway ? 'Prowadzenie przejmuje wyznaczony zastępca (§ 16).' : 'Prowadzenie może przekazać osoba prowadząca; przewodniczący może je przejąć.', 403);
      m.chair.changes.push({at: ctx.now, from: m.chair.current, to: actor.personId, by: actor.name, reason: chairman ? 'przejęcie przez przewodniczącego' : 'zastępstwo podczas nieobecności osoby prowadzącej obrady'});
      m.chair.current = actor.personId;
      log(m, ctx, actor, `Prowadzenie obrad przejmuje ${actor.name}.`);
      break;
    }
    case 'break': {
      ensure(posiedzenie, 'Przerwa dotyczy posiedzenia.');
      requireLive(m); requireChair(m, actor);
      if (cmd.on) { ensure(m.status === 'trwa' && !regularOpen(m).length, 'Przerwę ogłasza się poza głosowaniem.'); requireAnnounced(m); m.status = 'przerwa'; log(m, ctx, actor, 'Przerwa w obradach.'); }
      else { ensure(m.status === 'przerwa', 'Obrady nie są przerwane.'); m.status = 'trwa'; log(m, ctx, actor, 'Wznowienie obrad.'); }
      break;
    }
    case 'close': {
      requireLive(m);
      ensure(posiedzenie ? m.chair.current === actor.personId : canChairOrgan(roster, m.organ, actor.personId), 'Posiedzenie zamyka osoba prowadząca obrady.', 403);
      if (!posiedzenie) { endProcedure(m, ctx, actor, 'policz', ''); break; }
      ensure(!regularOpen(m).length, 'Trwa głosowanie. Posiedzenie można zamknąć po jego zakończeniu.');
      requireAnnounced(m);
      // F4: zamknięcie z nierozpatrzonymi punktami wymaga powodu, który trafia do każdego z nich.
      const left = unhandledItems(m, docTypesOf(ctx));
      const reason = reasonOf(cmd.reason);
      if (left.length) {
        ensure(reason, 'Podaj powód zamknięcia posiedzenia przed rozpatrzeniem wszystkich punktów.');
        for (const it of left) it.statusReason = reason;
      }
      for (const b of openBallots(m)) closeBallot(m, ctx, b, 'prowadzacy');
      for (const it of m.agenda) if (it.status === 'w_toku') { it.status = 'zakonczony'; it.endedAt = ctx.now; }
      m.status = 'zakonczone';
      m.closedAt = ctx.now;
      m.presentation = null;
      const numbers = left.map(it => itemNumber(m.agenda, it.id)).join(', ');
      log(m, ctx, actor, left.length ? `Zamknięcie posiedzenia. Nie rozpatrzono ${plural(left.length, 'punktu', 'punktów', 'punktów')} ${numbers}. Powód ${quoted(reason)}.` : 'Zamknięcie posiedzenia.');
      break;
    }
    case 'procedure_end': {
      ensure(!posiedzenie, 'Tak kończy się głosowanie między posiedzeniami.');
      ensure(m.status === 'trwa', m.status === 'przygotowanie' ? 'Głosowanie między posiedzeniami jeszcze się nie rozpoczęło.' : 'Głosowanie między posiedzeniami jest już zakończone.');
      ensure(canChairOrgan(roster, m.organ, actor.personId), 'Głosowanie między posiedzeniami kończy przewodniczący albo wiceprzewodniczący.', 403);
      ensure(cmd.how === 'policz' || cmd.how === 'przerwij', 'Wybierz, czy zakończyć głosowanie z policzeniem głosów, czy przerwać je bez rozstrzygnięcia.');
      const reason = reasonOf(cmd.reason);
      if (cmd.how === 'przerwij') ensure(reason, 'Podaj powód przerwania głosowania.');
      endProcedure(m, ctx, actor, cmd.how, reason);
      break;
    }
    case 'procedure_deadline': {
      ensure(!posiedzenie, 'Termin zmienia się w głosowaniu między posiedzeniami.');
      ensure(m.status === 'trwa', m.status === 'przygotowanie' ? 'Przed rozpoczęciem termin ustawia się w danych głosowania.' : 'Głosowanie między posiedzeniami jest już zakończone.');
      ensure(canChairOrgan(roster, m.organ, actor.personId), 'Termin głosowania zmienia przewodniczący albo wiceprzewodniczący.', 403);
      const endsAt = Math.round(Number(cmd.endsAt));
      ensure(Number.isFinite(endsAt) && endsAt >= ctx.now + 5 * 60000, 'Ustaw nowy termin co najmniej 5 minut od teraz.');
      ensure(endsAt !== m.endsAt, 'To jest obecny termin głosowania.');
      const from = m.endsAt ?? ctx.now;
      m.endsAt = endsAt;
      for (const b of openBallots(m)) b.endsAt = endsAt;
      (m.deadlineChanges ??= []).push({at: ctx.now, from, to: endsAt, by: actor.name});
      log(m, ctx, actor, `Termin głosowania zmieniono z ${dateTimeText(from)} na ${dateTimeText(endsAt)}.`);
      m.messages.push({id: ctx.newId(), author: actor.account.id, authorName: actor.name, text: `Termin głosowania zmieniono na ${dateTimeText(endsAt)}.`, at: ctx.now});
      break;
    }
    case 'message': {
      ensure(m.status !== 'zakonczone', 'Posiedzenie zostało zamknięte.');
      const text = cmd.text.trim();
      ensure(text.length >= 1 && text.length <= 1000, 'Wiadomość może mieć od 1 do 1000 znaków.');
      m.messages.push({id: ctx.newId(), author: actor.account.id, authorName: actor.name, text, at: ctx.now});
      if (m.messages.length > 2000) m.messages.splice(0, m.messages.length - 2000);
      break;
    }
    default:
      fail('Nieznana czynność.');
  }
  advance(m, ctx);
  m.revision++;
  return m;
}

// F12: najwyżej 6 osób; wiersz bez imienia i nazwiska i bez funkcji znika, a z samą funkcją jest błędem.
function cleanPresenters(list: unknown): Presenter[] {
  ensure(Array.isArray(list), 'Nieprawidłowa lista osób przy punkcie.');
  const clean = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const out: Presenter[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const name = clean(raw?.name, 120), role = clean(raw?.role, 120);
    if (!name && !role) continue;
    ensure(name, 'Wpisz imię i nazwisko osoby albo usuń ten wiersz.');
    ensure(raw.kind === 'referuje' || raw.kind === 'prowadzi', 'Wybierz, czy osoba referuje, czy prowadzi punkt.');
    out.push({name, role, kind: raw.kind});
  }
  ensure(out.length <= 6, 'Przy punkcie można wpisać najwyżej 6 osób.');
  return out;
}

// F8: przeniesienie punktu w projekcie porządku obrad (przeciąganie kafelków). Punkt główny przenosi się z podpunktami.
// Podpunkt może trafić tylko do punktu głównego; punkt z podpunktami, otwarcie, przyjęcie porządku i zamknięcie
// nie stają się podpunktami. Po otwarciu posiedzenia przenosi się tylko punkty oczekujące i tylko za punkt
// „Przyjęcie porządku obrad”.
function placeItem(m: Meeting, it: AgendaItem, parentId: string | null, beforeId: string | null) {
  ensure(parentId !== it.id && beforeId !== it.id, 'Punktu nie można umieścić względem niego samego.');
  const parent = parentId ? item(m, parentId) : undefined;
  if (parentId) {
    ensure(parent && !parent.parentId, 'Podpunkt można umieścić tylko w punkcie głównym.');
    ensure(!m.agenda.some(c => c.parentId === it.id), 'Punkt z podpunktami nie może stać się podpunktem.');
    ensure(!['otwarcie', 'porzadek', 'zamkniecie'].includes(it.kind), 'Ten punkt nie może stać się podpunktem.');
  }
  const before = beforeId ? item(m, beforeId) : undefined;
  if (beforeId) ensure(before && before.parentId === parentId, 'Nie znaleziono miejsca w porządku obrad.');
  if (m.status !== 'przygotowanie') {
    ensure(it.status === 'oczekuje', 'Przenieść można tylko punkt, którego jeszcze nie rozpoczęto.');
    const top = m.agenda.filter(i => !i.parentId);
    const agendaPoint = top.findIndex(i => i.kind === 'porzadek');
    const targetTop = parent ?? before;
    if (targetTop) ensure(top.indexOf(targetTop) > agendaPoint, 'Po otwarciu posiedzenia punkty przenosi się za punkt „Przyjęcie porządku obrad”.');
  }
  const block = m.agenda.filter(i => i.id === it.id || i.parentId === it.id);
  const rest = m.agenda.filter(i => !block.includes(i));
  let at: number;
  if (before) at = rest.indexOf(before);
  else if (parent) { at = rest.indexOf(parent) + 1; while (at < rest.length && rest[at].parentId === parent.id) at++; }
  else at = rest.length;
  it.parentId = parentId;
  rest.splice(at, 0, ...block);
  m.agenda = rest;
}

// F7: zakończenie głosowania między posiedzeniami przed terminem z policzeniem głosów albo przerwanie bez rozstrzygnięcia.
function endProcedure(m: Meeting, ctx: Context, actor: Actor, how: 'policz' | 'przerwij', reason: string) {
  for (const b of openBallots(m)) {
    if (how === 'policz') closeBallot(m, ctx, b, 'prowadzacy');
    else abortBallot(m, ctx, actor, b, reason);
  }
  for (const it of m.agenda) if (it.status === 'w_toku') { it.status = 'zakonczony'; it.endedAt = ctx.now; }
  m.status = 'zakonczone';
  m.closedAt = ctx.now;
  m.presentation = null;
  m.ended = {how, ...(reason ? {reason} : {}), at: ctx.now, by: actor.name};
  log(m, ctx, actor, how === 'policz'
    ? 'Głosowanie między posiedzeniami zakończono przed czasem.' // to brzmienie odczytuje projekt protokołu (minutes.ts)
    : `Głosowanie między posiedzeniami przerwano. Powód ${quoted(reason)}. Rozstrzygnięcie nie zapadło.`);
}

/**
 * F6: nowe posiedzenie przez powielenie. Kopiuje rodzaj, tytuł, datę, godzinę, miejsce, tryb, odnośnik, zaproszenia,
 * zastępstwo i porządek (nowe identyfikatory, bez punktów wycofanych, stany „oczekuje”, bez notatek, dat, trybów
 * i powodów, z osobami przy punktach, rodzajem „Co jest głosowane”, o ile nie jest wyłączony, i materiałami).
 * Materiały dostają nowe identyfikatory;
 * treść i pliki kopiuje wywołujący według `materialMap` (stary identyfikator materiału na nowy). Bez daty zawiadomienia,
 * terminu głosowania między posiedzeniami i danych do protokołu.
 */
export function duplicateMeeting(src: Meeting, input: {id: string; now: number; newId: () => string; createdBy: string; docTypes?: DocType[]}) {
  const m = createMeeting({
    id: input.id, organ: src.organ, kind: src.kind, title: src.title, date: src.date, time: src.time, place: src.place,
    mode: src.mode, createdBy: input.createdBy, now: input.now, newId: input.newId,
  });
  m.link = src.link;
  m.invited = [...src.invited];
  m.chair.deputy = src.chair.deputy;
  m.chair.deputyBasis = src.chair.deputyBasis;
  const withdrawn = new Set(src.agenda.filter(i => i.status === 'wycofany').map(i => i.id));
  const kept = src.agenda.filter(i => !withdrawn.has(i.id) && !(i.parentId && withdrawn.has(i.parentId)));
  const used = new Set(kept.flatMap(i => i.materialIds));
  const attachedElsewhere = new Set(src.agenda.filter(i => !kept.includes(i)).flatMap(i => i.materialIds));
  const materialMap = new Map<string, string>();
  const materials: MaterialRef[] = [];
  for (const ref of src.materials) {
    if (!used.has(ref.id) && attachedElsewhere.has(ref.id)) continue;
    const id = input.newId();
    materialMap.set(ref.id, id);
    materials.push({...ref, id, version: 1, createdAt: input.now});
  }
  const ids = new Map(kept.map(i => [i.id, input.newId()]));
  m.agenda = kept.map(i => {
    const copy = newItem(ids.get(i.id)!, i.title, i.kind, i.parentId ? ids.get(i.parentId) ?? null : null);
    copy.title = i.title;
    copy.materialIds = i.materialIds.filter(x => materialMap.has(x)).map(x => materialMap.get(x)!);
    copy.presenters = (i.presenters ?? []).map(p => ({...p}));
    // F11: rodzaj wyłączony przez administratora nie przechodzi do nowego posiedzenia.
    if (i.docType && docTypeById(input.docTypes ?? defaultDocTypes, i.docType)?.active !== false) copy.docType = i.docType;
    return copy;
  });
  m.materials = materials;
  const day = src.date ? src.date.split('-').reverse().join('.') : '';
  m.log = [{at: input.now, text: `Utworzono przez powielenie ${src.kind === 'procedura' ? 'głosowania między posiedzeniami' : 'posiedzenia'} z dnia ${day}.`, by: input.createdBy}];
  return {meeting: m, materialMap};
}

function fileIfSupported(m: Meeting, ctx: Context, motionId: string) {
  const motion = m.motions.find(x => x.id === motionId)!;
  if (motion.status !== 'zbiera_podpisy') return;
  const present = presentMembers(m, ctx.roster);
  const valid = motion.signatures.filter(id => present.includes(id)).length;
  if (valid >= reasumptionSignaturesNeeded(present.length)) {
    motion.status = 'zlozony';
    motion.filedAt = ctx.now;
    motion.presentAtFiling = present.length;
    log(m, ctx, null, `Wniosek o reasumpcję poparło ${valid} z ${present.length} obecnych, a wymagana jest 1/3 (§ 12).`);
  }
}

// Tajne głosowanie: wydanie karty (ślepy podpis) uprawnionej osobie — zapisuje tylko, że kartę pobrała.
export function secretIssue(meeting: Meeting, ballotId: string, actor: Actor, ctx: Context) {
  const m = structuredClone(meeting);
  advance(m, ctx);
  const b = ballot(m, ballotId);
  ensure(b.status === 'otwarte' && b.secret, 'To głosowanie tajne zostało zakończone.', 409);
  ensure(actor.personId && b.eligible.includes(actor.personId), 'To konto nie jest uprawnione do udziału w tym głosowaniu.', 403);
  if (!b.remote) ensure(m.attendance[actor.personId] === 'obecny', 'Najpierw potwierdź obecność na posiedzeniu.');
  ensure(!b.secret.issued.includes(actor.personId), 'Kartę do tego głosowania już pobrano.', 409);
  b.secret.issued.push(actor.personId);
  b.absentDuring = b.absentDuring.filter(id => id !== actor.personId);
  m.revision++;
  return m;
}

export function secretCast(meeting: Meeting, ballotId: string, ctx: Context) {
  const m = structuredClone(meeting);
  const b = ballot(m, ballotId);
  ensure(b.status === 'otwarte' && b.secret && ctx.now < b.endsAt, 'To głosowanie tajne zostało zakończone.', 409);
  ensure(b.secret.cast < b.secret.issued.length, 'Liczba głosów przekracza liczbę wydanych kart.', 409);
  b.secret.cast++;
  advance(m, ctx);
  m.revision++;
  return m;
}

export function membersOf(roster: Roster, m: Meeting) {
  return organMembers(roster, m.organ);
}
