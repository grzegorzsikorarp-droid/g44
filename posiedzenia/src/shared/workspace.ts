import type {Actor, AgendaItem, Meeting, OrganCode, Roster} from './types.ts';
import {apply, DomainError, type Command, type Context} from './meeting.ts';
import {effectiveMeeting, type CascadeEnv} from './cascade.ts';
import {canAcceptProposal, canPrepare, canRejectProposal, canSeeWorkspace, isCommsAccount, isService, organRoster} from './role.ts';
import {membership, personName} from './roster.ts';
import {itemNumber} from './rules.ts';
import {dateDots, isoDayOf, plural} from './text.ts';

// Wspólne przygotowanie posiedzenia (SPEC-4 DB-13, DB-14, 4.3.1, 5.1; B2 rozdz. 2, typy z B2 2.14 z poprawkami SPEC-4).
// Przestrzeń robocza to osobny dokument przy posiedzeniu (`prep_spaces`), nie dane posiedzenia: nic z niej nie trafia do
// protokołu, notatki, materiału dla komunikacji, teczki ani statystyk (B2-W18). Od otwarcia jest tylko do odczytu (G-29).
// Rdzeń: zgłoszenia z decyzją zwołującego (K4-3), uwagi i wątki przy punktach, gotowość i postęp. Zadania (D-11), uwagi do
// wersji materiału i przeniesienie uwagi (D-12), „Co nowego” (D-10) i „Teraz oglądają” (D-9) to dodatki: ich polecenia
// domena odrzuca jako nieznane, a pola widoku są puste.

export interface Proposal {
  id: string; title: string; justification: string; caseType?: string; presenterId?: string;
  attachment?: {id: string; name: string; size: number};
  accountId: string; byName: string; at: number; editedAt?: number;
  /** „Zgłoszone”, „Wpisane do projektu” (DB-14: bez słowa „decyzja”), „Odrzucone”, „Odłożone”, „Wycofane”, „Wygasłe”. */
  state: 'zgloszone' | 'wpisane' | 'odrzucone' | 'odlozone' | 'wycofane' | 'wygasle';
  decision?: {at: number; accountId: string; by: string; reason?: string; itemId?: string; note?: 'spotkanie_robocze' | 'otwarcie'};
  carriedFrom?: {meetingId: string | null; date: string | null};
}
export type CommentTarget = {kind: 'punkt'; itemId: string} | {kind: 'material'; materialId: string; version: number; quote?: string}
  | {kind: 'zgloszenie'; proposalId: string} | {kind: 'posiedzenie'};
export interface Comment {
  id: string; target: CommentTarget; parentId: string | null; text: string;
  accountId: string; byName: string; at: number; editedAt?: number; deleted?: {at: number};
  resolved?: {at: number; accountId: string; by: string};
  remark?: {state: 'otwarta' | 'uwzgledniona' | 'nieuwzgledniona'; version?: number; reason?: string; at?: number; by?: string};
  movedTo?: {materialId: string; at: number};
}
/** Dodatek D-11: typ istnieje, polecenia `task_*` dochodzą z dodatkiem. */
export interface Task {
  id: string; title: string; assignee: {personId: string} | {office: true}; due?: string; itemId?: string;
  accountId: string; byName: string; at: number;
  done?: {at: number; by: string}; cancelled?: {at: number; by: string}; carriedFrom?: {meetingId: string; date: string};
}
export interface PrepEvent { at: number; accountId: string; byName: string; text: string; itemId?: string; forAccounts?: string[] }
export interface PrepSpace {
  /** Identyfikator posiedzenia albo 'czekajace:{organ}' dla zgłoszeń czekających na posiedzenie (B2-W06). */
  meetingId: string; organ: OrganCode; revision: number;
  proposals: Proposal[]; comments: Comment[]; tasks: Task[]; events: PrepEvent[];
}
export type PrepCommand =
  | {type: 'proposal_add'; title: string; justification: string; caseType?: string; presenterId?: string; attachmentId?: string}
  | {type: 'proposal_edit'; proposalId: string; title?: string; justification?: string; caseType?: string | null; presenterId?: string | null}
  | {type: 'proposal_withdraw'; proposalId: string}
  | {type: 'proposal_accept'; proposalId: string; title?: string; place: 'przed_wolnymi_wnioskami' | 'w_uchwalach'}
  | {type: 'proposal_reject' | 'proposal_defer'; proposalId: string; reason: string}
  | {type: 'comment_add'; target: CommentTarget; text: string; parentId?: string}
  | {type: 'comment_edit'; commentId: string; text: string}
  | {type: 'comment_delete'; commentId: string}
  | {type: 'thread_resolve'; commentId: string; on: boolean};

export interface ReadinessCheck { key: 'material' | 'projekt_aktu' | 'referent' | 'rodzaj_sprawy' | 'protokol'; ok: boolean; text: string; actions?: ('przyjmij' | 'odrzuc')[] }
export interface Progress {
  ready: number; total: number; text: string; missing: string | null;
  proposalsWaiting: number;
  /** Dodatki D-11 i D-12; w rdzeniu 0. */
  myTasks: number; myTasksOverdue: number; openRemarks: number;
  notice: string | null;
}
export interface FeedRow { at: number; text: string; by: string; itemId?: string; target?: string }
export interface PresenceRow { name: string; label: string; where: string | null }
export interface PrepView {
  scope: 'pelny' | 'wlasne'; readOnly: boolean;
  proposals: Proposal[]; comments: Comment[]; tasks: Task[];
  readiness: Record<string, ReadinessCheck[]>; progress: Progress;
  feed: {forYou: FeedRow[]; other: FeedRow[]; since: number | null};
  presence: PresenceRow[];
  waitingCount: number;
}

/** Limity B2-W03, B2-W07, G-30, G-31 (stałe techniczne, nie ustawienia). */
export const PREP_LIMITS = {title: 400, justification: 2000, reason: 500, comment: 2000, comments: 300, waitingPerPerson: 10, editMinutes: 15, keepDays: 90, waitingDays: 365} as const;
export const waitingId = (organ: OrganCode) => `czekajace:${organ}`;
export const emptySpace = (meetingId: string, organ: OrganCode): PrepSpace => ({meetingId, organ, revision: 0, proposals: [], comments: [], tasks: [], events: []});

const fail = (message: string, status = 400): never => { throw new DomainError(message, status); };
function ensure(condition: unknown, message: string, status = 400): asserts condition { if (!condition) fail(message, status); }
const clean = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '';
const quoted = (text: string) => `„${text.replace(/„/g, '»').replace(/”/g, '«')}”`;

/** Komunikaty strażnika G-29–G-31 (rozdz. 3.4), dosłownie. */
export const PREP_REFUSALS = {
  opened: 'Posiedzenie otwarto. Przygotowanie można już tylko czytać.',
  proposeLive: 'Posiedzenie trwa. Wniosek o zmianę porządku obrad zgłoś osobie prowadzącej obrady. Przyjęty porządek zmienia Prezydium w głosowaniu.',
  title: 'Wpisz nazwę sprawy.',
  justification: 'Wpisz uzasadnienie.',
  tooMany: 'Masz już 10 zgłoszeń czekających na decyzję. Poczekaj na decyzję albo wycofaj któreś z nich.',
  reject: 'Odrzucić albo odłożyć zgłoszenie może przewodniczący albo zastępca, który zwołuje to posiedzenie (§ 7 ust. 1, § 14 ust. 3, § 16 ust. 2).',
  reason: 'Podaj powód. Zobaczy go osoba zgłaszająca.',
  comment: 'Uwaga może mieć od 1 do 2000 znaków.',
  comments: 'Przy tym posiedzeniu jest już 300 uwag.',
  edit: 'Uwagę można poprawić przez 15 minut i tylko przed pierwszą odpowiedzią.',
  see: 'Przygotowanie posiedzenia widzą członkowie Prezydium i biuro.',
  later: 'Przygotowanie będzie można przeczytać po zamknięciu posiedzenia.',
} as const;

/** Zgłoszenie składa członek organu albo osoba z głosem doradczym; biuro wpisuje punkty samo (G-30, 4.3.1). */
function mayPropose(roster: Roster, organ: OrganCode, a: Actor) {
  if (isService(a) || isCommsAccount(a)) return false;
  return (!!a.personId && !!membership(roster, organ, a.personId)) || a.account.kind === 'doradczy';
}
/** Nazwa osoby do podpisu zgłoszenia i uwagi: imię i nazwisko (biuro: nazwa konta). */
const signer = (a: Actor) => a.name;

export interface PrepContext extends Context {
  /** Plik zgłoszenia zapisany przez serwer albo wersję próbną (`purpose = 'zgloszenie'`), z tym posiedzeniem albo zbiorem czekających. */
  attachment?: (id: string) => {id: string; name: string; size: number} | null;
  /** Zgłoszenia tej osoby czekające w innych przestrzeniach organu (limit 10, G-30). */
  waitingElsewhere?: number;
}
export interface PrepResult {
  ws: PrepSpace;
  /** Posiedzenie po wpisaniu zgłoszenia do projektu (polecenia domeny meeting.ts w jednej transakcji). */
  meeting?: Meeting;
  /** Wpisane zgłoszenie z plikiem: serwer przenosi plik do materiałów punktu (B2-W04 pkt 3). */
  created?: {attachmentId: string; itemId: string; title: string};
  /** Zgłoszenia odłożone, które trafiają do zbioru czekających organu (B2-W06). */
  waiting?: Proposal[];
}

function addProposal(ws: PrepSpace, cmd: Extract<PrepCommand, {type: 'proposal_add'}>, actor: Actor, ctx: PrepContext, roster: Roster) {
  const title = clean(cmd.title, PREP_LIMITS.title), justification = clean(cmd.justification, PREP_LIMITS.justification);
  ensure(title, PREP_REFUSALS.title);
  ensure(justification, PREP_REFUSALS.justification);
  const mine = ws.proposals.filter(p => p.accountId === actor.account.id && p.state === 'zgloszone').length + (ctx.waitingElsewhere ?? 0);
  ensure(mine < PREP_LIMITS.waitingPerPerson, PREP_REFUSALS.tooMany, 409);
  const p: Proposal = {id: ctx.newId(), title, justification, accountId: actor.account.id, byName: signer(actor), at: ctx.now, state: 'zgloszone'};
  if (cmd.caseType) {
    const c = (ctx.general?.general.caseTypes ?? []).find(x => x.id === cmd.caseType && x.organs.includes(ws.organ) && x.active);
    ensure(c, 'Nieznany rodzaj sprawy. Wybierz rodzaj z listy.');
    p.caseType = c.id;
  }
  const presenter = cmd.presenterId ?? actor.personId ?? undefined;
  if (presenter) {
    ensure(membership(roster, ws.organ, presenter) || presenter === actor.personId, 'Osobę referującą wybierz ze składu organu.');
    p.presenterId = presenter;
  }
  if (cmd.attachmentId) p.attachment = ctx.attachment?.(cmd.attachmentId) ?? fail('Nie znaleziono pliku zgłoszenia. Dodaj go jeszcze raz.', 404);
  ws.proposals.push(p);
  ws.events.push({at: ctx.now, accountId: actor.account.id, byName: signer(actor), text: `Zgłoszono sprawę ${quoted(title)}.`});
}
const proposal = (ws: PrepSpace, id: string) => ws.proposals.find(p => p.id === id) ?? fail('Nie znaleziono zgłoszenia.', 404);
function editOwn(ws: PrepSpace, p: Proposal, cmd: Extract<PrepCommand, {type: 'proposal_edit'}>, actor: Actor, ctx: PrepContext, roster: Roster) {
  ensure(p.accountId === actor.account.id, 'Zgłoszenie poprawia osoba, która je złożyła.', 403);
  ensure(p.state === 'zgloszone', 'Zgłoszenie ma już decyzję. Nie można go poprawić.', 409);
  if (cmd.title !== undefined) { const t = clean(cmd.title, PREP_LIMITS.title); ensure(t, PREP_REFUSALS.title); p.title = t; }
  if (cmd.justification !== undefined) { const t = clean(cmd.justification, PREP_LIMITS.justification); ensure(t, PREP_REFUSALS.justification); p.justification = t; }
  if (cmd.caseType !== undefined) {
    if (!cmd.caseType) delete p.caseType;
    else {
      const c = (ctx.general?.general.caseTypes ?? []).find(x => x.id === cmd.caseType && x.organs.includes(ws.organ) && x.active);
      ensure(c, 'Nieznany rodzaj sprawy. Wybierz rodzaj z listy.');
      p.caseType = c.id;
    }
  }
  if (cmd.presenterId !== undefined) {
    if (!cmd.presenterId) delete p.presenterId;
    else { ensure(membership(roster, ws.organ, cmd.presenterId), 'Osobę referującą wybierz ze składu organu.'); p.presenterId = cmd.presenterId; }
  }
  p.editedAt = ctx.now;
}
function withdraw(ws: PrepSpace, p: Proposal, actor: Actor, ctx: PrepContext) {
  ensure(p.accountId === actor.account.id, 'Zgłoszenie wycofuje osoba, która je złożyła.', 403);
  ensure(p.state === 'zgloszone', 'Zgłoszenie ma już decyzję. Nie można go wycofać.', 409);
  p.state = 'wycofane';
  p.decision = {at: ctx.now, accountId: actor.account.id, by: signer(actor)};
}

/**
 * Zbiór zgłoszeń czekających na posiedzenie organu (B2-W06): tylko zgłoszenie i jego wycofanie, gdy żadne posiedzenie
 * nie jest w przygotowaniu. Zwraca nową przestrzeń z rewizją +1.
 */
export function applyWaiting(waiting: PrepSpace, cmd: PrepCommand, actor: Actor, ctx: PrepContext): PrepSpace {
  const ws = structuredClone(waiting);
  ensure(mayPropose(ctx.roster, ws.organ, actor), 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.', 403);
  if (cmd.type === 'proposal_add') addProposal(ws, cmd, actor, ctx, ctx.roster);
  else if (cmd.type === 'proposal_withdraw') withdraw(ws, proposal(ws, cmd.proposalId), actor, ctx);
  else fail('Nieznana czynność.');
  ws.revision++;
  return ws;
}

/** Miejsce nowego punktu ze zgłoszenia (B2-W04 pkt 1): przed „Informacje bieżące i wolne wnioski” albo podpunkt „Podjęcie uchwał”. */
function placeFor(m: Meeting, place: 'przed_wolnymi_wnioskami' | 'w_uchwalach'): {parentId: string | null; afterId: string | null} {
  if (place === 'w_uchwalach') {
    const parent = m.agenda.find(i => i.kind === 'uchwaly' && !i.parentId);
    if (parent) return {parentId: parent.id, afterId: null};
  }
  const tops = m.agenda.filter(i => !i.parentId);
  const at = tops.findIndex(i => i.kind === 'wolne_wnioski' || i.kind === 'zamkniecie');
  if (m.kind === 'procedura' || at < 0) return {parentId: null, afterId: tops.at(-1)?.id ?? null};
  return {parentId: null, afterId: at > 0 ? tops[at - 1].id : null};
}

/**
 * Jedno polecenie przestrzeni roboczej (tabela 4.3.1, 5.1, G-29–G-31). Przy wpisaniu zgłoszenia do projektu zwraca też
 * nowe posiedzenie: `item_add` (niezmiennik G-6), osoba referująca i rodzaj sprawy (`item_edit`) oraz wpis `tag: 'projekt'`
 * „Dodano punkt „{nazwa}” ze zgłoszenia {imię i nazwisko}, {funkcja}.” Przeniesienie pliku do materiałów wykonuje
 * wywołujący (serwer, wersja próbna) według `created`, w tej samej transakcji.
 */
export function applyPrep(space: PrepSpace, meeting: Meeting, cmd: PrepCommand, actor: Actor, ctx: PrepContext): PrepResult {
  const ws = structuredClone(space);
  const roster = ctx.roster;
  const scope = canSeeWorkspace(roster, meeting, actor);
  ensure(scope, PREP_REFUSALS.see, 403);
  if (meeting.status !== 'przygotowanie') fail(cmd?.type === 'proposal_add' ? PREP_REFUSALS.proposeLive : PREP_REFUSALS.opened, 409);
  if (!cmd || typeof cmd !== 'object') fail('Nieznana czynność.');
  const out: PrepResult = {ws};
  switch (cmd.type) {
    case 'proposal_add': {
      ensure(mayPropose(roster, meeting.organ, actor), 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.', 403);
      addProposal(ws, cmd, actor, ctx, roster);
      break;
    }
    case 'proposal_edit': editOwn(ws, proposal(ws, cmd.proposalId), cmd, actor, ctx, roster); break;
    case 'proposal_withdraw': withdraw(ws, proposal(ws, cmd.proposalId), actor, ctx); break;
    case 'proposal_accept': {
      ensure(canAcceptProposal(roster, meeting, actor), 'Zgłoszenie do projektu wpisuje biuro, przewodniczący albo wiceprzewodniczący.', 403);
      const p = proposal(ws, cmd.proposalId);
      ensure(p.state === 'zgloszone', 'To zgłoszenie ma już decyzję.', 409);
      const title = clean(cmd.title ?? p.title, PREP_LIMITS.title) || p.title;
      const where = placeFor(meeting, cmd.place === 'w_uchwalach' ? 'w_uchwalach' : 'przed_wolnymi_wnioskami');
      let m = apply(meeting, {type: 'item_add', title, parentId: where.parentId, afterId: where.afterId}, actor, ctx);
      const added = [...m.agenda].reverse().find(i => i.title === title.replace(/\s+/g, ' ').trim() && !meeting.agenda.some(x => x.id === i.id)) ?? fail('Nie udało się dodać punktu.', 500);
      // B2-W04 pkt 4: jeden wpis w dzienniku zamiast wpisu o dodaniu punktu, z autorem zgłoszenia.
      const entry = [...m.log].reverse().find(l => l.itemId === added.id && l.tag === 'projekt');
      const func = authorFunc(roster, meeting, p, ctx);
      if (entry) entry.text = `Dodano punkt ${quoted(added.title)} ze zgłoszenia ${p.byName}${func ? `, ${func}` : ''}.`;
      const edit: Command = {type: 'item_edit', itemId: added.id};
      if (p.presenterId) {
        const ms = organRoster(roster, meeting).find(x => x.personId === p.presenterId) ?? membership(roster, meeting.organ, p.presenterId);
        edit.presenters = [{name: personName(roster, p.presenterId), role: ms?.label ?? '', kind: 'referuje'}];
      }
      if (p.caseType) edit.caseType = p.caseType;
      if (edit.presenters || edit.caseType) m = apply(m, edit, actor, ctx);
      p.state = 'wpisane';
      p.decision = {at: ctx.now, accountId: actor.account.id, by: signer(actor), itemId: added.id};
      out.meeting = m;
      if (p.attachment) out.created = {attachmentId: p.attachment.id, itemId: added.id, title: p.title};
      ws.events.push({at: ctx.now, accountId: actor.account.id, byName: signer(actor), text: `Wpisano zgłoszenie ${quoted(p.title)} do projektu porządku obrad.`, itemId: added.id, forAccounts: [p.accountId]});
      break;
    }
    case 'proposal_reject':
    case 'proposal_defer': {
      ensure(canRejectProposal(roster, meeting, actor), PREP_REFUSALS.reject, 403);
      const p = proposal(ws, cmd.proposalId);
      ensure(p.state === 'zgloszone', 'To zgłoszenie ma już decyzję.', 409);
      const reason = clean(cmd.reason, PREP_LIMITS.reason);
      ensure(reason, PREP_REFUSALS.reason);
      p.state = cmd.type === 'proposal_reject' ? 'odrzucone' : 'odlozone';
      p.decision = {at: ctx.now, accountId: actor.account.id, by: signer(actor), reason};
      if (p.state === 'odlozone') out.waiting = [carried(p, meeting)];
      ws.events.push({at: ctx.now, accountId: actor.account.id, byName: signer(actor), text: `${p.state === 'odrzucone' ? 'Odrzucono' : 'Odłożono'} zgłoszenie ${quoted(p.title)}. Powód ${quoted(reason.replace(/\.$/, ''))}.`, forAccounts: [p.accountId]});
      break;
    }
    case 'comment_add': {
      ensure(scope === 'pelny', PREP_REFUSALS.see, 403);
      const text = clean(cmd.text, PREP_LIMITS.comment + 1);
      ensure(text.length >= 1 && text.length <= PREP_LIMITS.comment, PREP_REFUSALS.comment);
      ensure(ws.comments.length < PREP_LIMITS.comments, PREP_REFUSALS.comments, 409);
      let target = cmd.target;
      let parentId: string | null = null;
      if (cmd.parentId) {
        const parent = ws.comments.find(c => c.id === cmd.parentId) ?? fail('Nie znaleziono uwagi.', 404);
        ensure(!parent.parentId, 'Odpowiada się na pierwszą uwagę wątku.');
        parentId = parent.id;
        target = parent.target;
      }
      ensure(target && typeof target === 'object', 'Wskaż, czego dotyczy uwaga.');
      if (target.kind === 'punkt') ensure(meeting.agenda.some(i => i.id === target.itemId), 'Nie znaleziono punktu.', 404);
      else if (target.kind === 'zgloszenie') proposal(ws, target.proposalId);
      else if (target.kind !== 'posiedzenie') fail('Nieznana czynność.');
      const t: CommentTarget = target.kind === 'punkt' ? {kind: 'punkt', itemId: target.itemId} : target.kind === 'zgloszenie' ? {kind: 'zgloszenie', proposalId: target.proposalId} : {kind: 'posiedzenie'};
      ws.comments.push({id: ctx.newId(), target: t, parentId, text, accountId: actor.account.id, byName: signer(actor), at: ctx.now});
      break;
    }
    case 'comment_edit': {
      const c = ws.comments.find(x => x.id === cmd.commentId) ?? fail('Nie znaleziono uwagi.', 404);
      ensure(c.accountId === actor.account.id, 'Uwagę poprawia osoba, która ją napisała.', 403);
      ensure(!c.deleted && ctx.now - c.at <= PREP_LIMITS.editMinutes * 60000 && !ws.comments.some(x => x.parentId === c.id), PREP_REFUSALS.edit, 409);
      const text = clean(cmd.text, PREP_LIMITS.comment + 1);
      ensure(text.length >= 1 && text.length <= PREP_LIMITS.comment, PREP_REFUSALS.comment);
      if (text !== c.text) { c.text = text; c.editedAt = ctx.now; }
      break;
    }
    case 'comment_delete': {
      const c = ws.comments.find(x => x.id === cmd.commentId) ?? fail('Nie znaleziono uwagi.', 404);
      ensure(c.accountId === actor.account.id, 'Uwagę usuwa osoba, która ją napisała.', 403);
      ensure(!c.deleted, 'Tę uwagę już usunięto.', 409);
      c.deleted = {at: ctx.now};
      c.text = '';
      break;
    }
    case 'thread_resolve': {
      ensure(scope === 'pelny', PREP_REFUSALS.see, 403);
      const c = ws.comments.find(x => x.id === cmd.commentId) ?? fail('Nie znaleziono uwagi.', 404);
      ensure(!c.parentId, 'Rozstrzygnięty jest cały wątek. Wybierz pierwszą uwagę wątku.');
      ensure(c.accountId === actor.account.id || canPrepare(roster, meeting, actor), 'Wątek oznacza autor pierwszej uwagi albo osoba, która przygotowuje posiedzenie.', 403);
      if (cmd.on) c.resolved = {at: ctx.now, accountId: actor.account.id, by: signer(actor)}; else delete c.resolved;
      break;
    }
    default: fail('Nieznana czynność.');
  }
  ws.revision++;
  return out;
}
/** Funkcja autora zgłoszenia ze składu (dziennik B2-W04 pkt 4): „Sekretarz”, „Członek Prezydium” albo opis konta. */
function authorFunc(roster: Roster, m: Meeting, p: Proposal, ctx: Context) {
  const account = ctx.accounts?.find(a => a.id === p.accountId);
  const personId = account?.personId ?? null;
  if (personId) return organRoster(roster, m).find(x => x.personId === personId)?.label ?? membership(roster, m.organ, personId)?.label ?? '';
  return account?.kind === 'doradczy' ? (account.label || 'głos doradczy') : account?.label ?? '';
}
const carried = (p: Proposal, m: Pick<Meeting, 'id' | 'date'>): Proposal => {
  const {decision: _d, ...rest} = p;
  return {...structuredClone(rest), state: 'zgloszone', carriedFrom: {meetingId: m.id, date: m.date || null}};
};

/**
 * Otwarcie posiedzenia (B2-W05, 5.1): zgłoszenia bez decyzji dostają stan „Odłożone” z dopiskiem, a ich kopie wracają
 * do zbioru czekających organu (`toWaiting`). Serwer i wersja próbna wołają to po `open`.
 */
export function onOpen(space: PrepSpace, now: number, m?: Pick<Meeting, 'id' | 'date'>): PrepSpace {
  const ws = structuredClone(space);
  let changed = false;
  for (const p of ws.proposals) {
    if (p.state !== 'zgloszone') continue;
    p.state = 'odlozone';
    p.decision = {at: now, accountId: '', by: 'Aplikacja', reason: 'Posiedzenie otwarto przed decyzją w sprawie zgłoszenia.', note: 'otwarcie'};
    changed = true;
  }
  if (changed) ws.revision++;
  void m;
  return ws;
}
/** Zgłoszenia odłożone przy otwarciu, które przechodzą do czekających (kopie w stanie „Zgłoszone”). */
export function deferredOnOpen(before: PrepSpace, after: PrepSpace, m: Pick<Meeting, 'id' | 'date'>): Proposal[] {
  return after.proposals.filter(p => p.decision?.note === 'otwarcie' && before.proposals.find(x => x.id === p.id)?.state === 'zgloszone').map(p => carried(p, m));
}
/** Dopisuje zgłoszenia do zbioru czekających organu. */
export function toWaiting(waiting: PrepSpace, list: Proposal[]): PrepSpace {
  if (!list.length) return waiting;
  const ws = structuredClone(waiting);
  for (const p of list) if (!ws.proposals.some(x => x.id === p.id)) ws.proposals.push(p);
  ws.revision++;
  return ws;
}
/**
 * Nowe albo powielone posiedzenie organu (B2-W06, B2-W17) przejmuje wszystkie zgłoszenia czekające. Zgłoszenie bez
 * źródła dostaje „Zgłoszone przed utworzeniem posiedzenia.”, a odłożone „Z posiedzenia z dnia {data}.” (`carriedFrom`).
 * Uwagi starego posiedzenia zostają przy nim. Zadania (D-11) przechodzą dopiero z dodatkiem.
 */
export function carryOver(waiting: PrepSpace, _previous: PrepSpace | null, target: Pick<Meeting, 'id' | 'organ'>): {ws: PrepSpace; waiting: PrepSpace} {
  const ws = emptySpace(target.id, target.organ);
  const moved = waiting.proposals.filter(p => p.state === 'zgloszone');
  ws.proposals = moved.map(p => ({...structuredClone(p), carriedFrom: p.carriedFrom ?? {meetingId: null, date: null}}));
  if (moved.length) ws.revision = 1;
  const rest = structuredClone(waiting);
  rest.proposals = rest.proposals.filter(p => p.state !== 'zgloszone');
  if (moved.length) rest.revision++;
  return {ws, waiting: rest};
}
/** Zdanie o pochodzeniu zgłoszenia przeniesionego (B2-W06). */
export const carriedText = (p: Proposal) => !p.carriedFrom ? null : p.carriedFrom.date ? `Z posiedzenia z dnia ${dateDots(p.carriedFrom.date)}.` : 'Zgłoszone przed utworzeniem posiedzenia.';

/**
 * Usuwanie po terminie (DB-13, DB-36, B2-W19): przestrzeń znika 90 dni po zamknięciu posiedzenia, a zgłoszenie
 * czekające wygasa po 365 dniach bez decyzji (wpis dla zgłaszającego). Zwraca identyfikatory do usunięcia i przestrzenie
 * do zapisania.
 */
export function purgeOld(spaces: PrepSpace[], meetings: Pick<Meeting, 'id' | 'status' | 'closedAt'>[], now: number): {remove: string[]; update: PrepSpace[]} {
  const remove: string[] = [], update: PrepSpace[] = [];
  for (const s of spaces) {
    if (s.meetingId.startsWith('czekajace:')) {
      const ws = structuredClone(s);
      let changed = false;
      for (const p of ws.proposals) {
        if (p.state === 'zgloszone' && now - p.at > PREP_LIMITS.waitingDays * 86400000) {
          p.state = 'wygasle';
          p.decision = {at: now, accountId: '', by: 'Aplikacja', reason: 'Zgłoszenie czekało ponad 365 dni bez decyzji.'};
          ws.events.push({at: now, accountId: '', byName: 'Aplikacja', text: `Zgłoszenie ${quoted(p.title)} wygasło po 365 dniach bez decyzji.`, forAccounts: [p.accountId]});
          changed = true;
        }
      }
      const before = ws.proposals.length;
      ws.proposals = ws.proposals.filter(p => p.state === 'zgloszone' || now - (p.decision?.at ?? p.at) < PREP_LIMITS.waitingDays * 86400000);
      if (changed || ws.proposals.length !== before) { ws.revision++; update.push(ws); }
      continue;
    }
    const m = meetings.find(x => x.id === s.meetingId);
    if (!m) { remove.push(s.meetingId); continue; }
    if (m.status === 'zakonczone' && m.closedAt && now - m.closedAt > PREP_LIMITS.keepDays * 86400000) remove.push(s.meetingId);
  }
  return {remove, update};
}

// Gotowość punktu i postęp (B2-W12): jedna funkcja dla karty „Przygotowanie posiedzenia”, wiersza punktu, przeglądu przed
// otwarciem (cascade.ts) i informacji o postępie e-mailem, więc braki nie mogą się rozjechać.

const ACT_GENITIVE: Record<string, string> = {uchwala: 'uchwały', stanowisko: 'stanowiska', oswiadczenie: 'oświadczenia', rezolucja: 'rezolucji', deklaracja: 'deklaracji', apel: 'apelu'};
const missingWhat: Record<ReadinessCheck['key'], (c: ReadinessCheck) => string> = {
  material: () => 'materiału', projekt_aktu: c => c.text.replace(/^Brak (projektu \S+)\..*$/, '$1'), referent: () => 'osoby referującej',
  rodzaj_sprawy: () => 'decyzji o rodzaju sprawy', protokol: () => 'protokołu',
};
/** Sprawdzenia gotowości jednego punktu (puste, gdy żadne nie ma zastosowania). */
export function itemReadiness(env: CascadeEnv, m: Meeting, it: AgendaItem, eff: Pick<ReturnType<typeof effectiveMeeting>, 'items'> = effectiveMeeting(env, m)): ReadinessCheck[] {
  const out: ReadinessCheck[] = [];
  const e = eff.items[it.id];
  const voted = !!e?.voted.value;
  if ((it.kind === 'sprawa' && voted) || it.kind === 'sprawozdania') {
    out.push({key: 'material', ok: it.materialIds.length > 0, text: it.materialIds.length ? 'Materiał dodano.' : 'Brak materiału.'});
  }
  const docType = e?.docType.value ?? null;
  if (it.kind === 'sprawa' && docType && ACT_GENITIVE[docType] && env.law.acts.voted[docType]) {
    const has = m.materials.some(x => it.materialIds.includes(x.id) && x.type === docType);
    out.push({key: 'projekt_aktu', ok: has, text: has ? `Projekt ${ACT_GENITIVE[docType]} dodano.`
      : `Brak projektu ${ACT_GENITIVE[docType]}. Projekt przygotowuje sekretarz, a w sprawach finansowych skarbnik (§ 17 ust. 2 pkt 3, § 18 ust. 2 pkt 1).`});
  }
  if (it.kind === 'sprawa') {
    const ok = it.presenters.some(p => p.kind === 'referuje' || p.kind === 'prowadzi');
    out.push({key: 'referent', ok, text: ok ? 'Osobę referującą wpisano.' : 'Brak osoby referującej.'});
  }
  const guess = it.caseTypeGuess && !it.caseType ? env.general.caseTypes.find(c => c.id === it.caseTypeGuess) : undefined;
  if (guess) out.push({key: 'rodzaj_sprawy', ok: false, text: `Propozycja rodzaju sprawy »${guess.name}« czeka na przyjęcie albo odrzucenie.`, actions: ['przyjmij', 'odrzuc']});
  return out;
}
/** Gotowość każdego punktu, w którym choć jedno sprawdzenie ma zastosowanie (`readiness` z B2 2.14). */
export function readiness(env: CascadeEnv, m: Meeting): Record<string, ReadinessCheck[]> {
  const eff = effectiveMeeting(env, m);
  const out: Record<string, ReadinessCheck[]> = {};
  for (const it of m.agenda) {
    const checks = itemReadiness(env, m, it, eff);
    if (checks.length) out[it.id] = checks;
  }
  return out;
}
/** „Gotowe {r} z {n} {punktu|punktów}.” (po „z” „punktu” tylko przy n = 1, 6.5). */
export const progressText = (ready: number, total: number) => `Gotowe ${ready} z ${total} ${total === 1 ? 'punktu' : 'punktów'}.`;
/**
 * Postęp przygotowań (6.5, B2-W12): liczba gotowych punktów, jedno zdanie o brakach z numerami (najwyżej 5 pozycji, potem
 * „i {k} innych”), zgłoszenia czekające na decyzję zwołującego i zdanie o zawiadomieniu z przeglądu.
 */
export function progress(env: CascadeEnv, m: Meeting, ws: PrepSpace | null, _actor?: Actor, now = Date.now()): Progress {
  const checks = readiness(env, m);
  const ids = Object.keys(checks);
  const ready = ids.filter(id => checks[id].every(c => c.ok)).length;
  const unit = m.kind === 'procedura' ? 'w sprawie' : 'w punkcie';
  const gaps = m.agenda.flatMap(it => (checks[it.id] ?? []).filter(c => !c.ok).map(c => `${missingWhat[c.key](c)} ${unit} ${itemNumber(m.agenda, it.id)}`));
  const shown = gaps.slice(0, 5);
  const rest = gaps.length - shown.length;
  const missing = !gaps.length ? null
    : `Brakuje ${rest > 0 ? `${shown.join(', ')} i ${rest} ${plural(rest, 'innej', 'innych', 'innych')}` : shown.length < 2 ? shown[0] : `${shown.slice(0, -1).join(', ')} i ${shown.at(-1)}`}.`;
  const review = effectiveMeeting(env, m, {review: true, now}).review ?? [];
  const notice = m.kind === 'posiedzenie' ? review.find(r => r.target === 'zawiadomienie')?.text ?? null : null;
  return {ready, total: ids.length, text: progressText(ready, ids.length), missing,
    proposalsWaiting: ws ? ws.proposals.filter(p => p.state === 'zgloszone').length : 0, myTasks: 0, myTasksOverdue: 0, openRemarks: 0, notice};
}

/**
 * Widok przestrzeni roboczej dla osoby (B2-W02, Z10): pełny dla członków organu i biura, dla osoby z głosem doradczym
 * tylko własne zgłoszenia i decyzje w ich sprawie, dla pozostałych `null`. Po otwarciu tylko do odczytu; w statusach
 * „trwa” i „przerwa” widok posiedzenia przestrzeni nie dostaje (T-5, S-25), a po zamknięciu czyta ją osobna trasa.
 */
export function prepView(ws: PrepSpace, m: Meeting, actor: Actor, roster: Roster, extra: {env: CascadeEnv; waiting?: PrepSpace | null; presence?: PresenceRow[]; previousVisit?: number | null; now?: number}): PrepView | null {
  const scope = canSeeWorkspace(roster, m, actor);
  if (!scope) return null;
  const waitingCount = (extra.waiting?.proposals ?? []).filter(p => p.state === 'zgloszone').length;
  const readOnly = m.status !== 'przygotowanie';
  if (scope === 'wlasne') {
    const own = ws.proposals.filter(p => p.accountId === actor.account.id);
    return {scope, readOnly, proposals: structuredClone(own), comments: [], tasks: [], readiness: {},
      progress: {ready: 0, total: 0, text: '', missing: null, proposalsWaiting: 0, myTasks: 0, myTasksOverdue: 0, openRemarks: 0, notice: null},
      feed: {forYou: [], other: [], since: null}, presence: [], waitingCount: 0};
  }
  return {
    scope, readOnly, proposals: structuredClone(ws.proposals), comments: structuredClone(ws.comments), tasks: [],
    readiness: readiness(extra.env, m), progress: progress(extra.env, m, ws, actor, extra.now),
    feed: {forYou: [], other: [], since: null}, presence: [], waitingCount,
  };
}
/** Dzień w strefie Europe/Warsaw do ETag przygotowania i zakończonego posiedzenia (2.4, K4-24). */
export const dayOf = (now: number) => isoDayOf(now);
