import type {
  Actor, AgendaChange, AgendaItem, Ballot, BallotPurpose, Choice, MaterialType, Meeting, MeetingMode,
  Presentation, Roster, VoteMode,
} from './types.ts';
import {membership, organMembers, personName} from './roster.ts';
import {
  computeResult, everyoneVoted, hasVoted, itemNumber, memberIds, openTally, presentMembers,
  quorumFor, reasumptionSignaturesNeeded,
} from './rules.ts';
import {newItem, parseAgendaText, presidiumTemplate} from './agenda.ts';

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
}
export interface Context { roster: Roster; now: number; newId: () => string; secret?: SecretHooks }

export type Command =
  | {type: 'details'; title?: string; date?: string; time?: string; place?: string; mode?: MeetingMode; link?: string; noticeDate?: string; endsAt?: number}
  | {type: 'deputy'; personId: string | null; basis?: string}
  | {type: 'invite'; accountId: string; on: boolean}
  | {type: 'item_add'; title: string; parentId?: string | null; afterId?: string | null}
  | {type: 'item_edit'; itemId: string; title?: string; note?: string; presenter?: string}
  | {type: 'item_move'; itemId: string; direction: -1 | 1}
  | {type: 'item_remove'; itemId: string}
  | {type: 'agenda_import'; text: string; replace: boolean}
  | {type: 'item_material'; itemId: string; materialId: string; on: boolean}
  | {type: 'item_mode'; itemId: string; mode: VoteMode; basis: string}
  | {type: 'open'}
  | {type: 'presence'; who: string; guest?: boolean; present: boolean}
  | {type: 'quorum'}
  | {type: 'item_start'; itemId: string}
  | {type: 'item_end'; itemId: string; status: 'zakonczony' | 'odroczony' | 'wycofany'}
  | {type: 'present'; kind: Presentation['kind'] | null; id?: string}
  | {type: 'ballot_open'; itemId: string | null; purpose: BallotPurpose; subject: string; mode: VoteMode; minutes: number; materialId?: string | null}
  | {type: 'vote'; ballotId: string; choice: Choice}
  | {type: 'ballot_absent'; ballotId: string; personId: string}
  | {type: 'ballot_close'; ballotId: string}
  | {type: 'announce'; ballotId: string}
  | {type: 'agenda_change'; change: AgendaChange; minutes: number}
  | {type: 'mode_motion'; itemId: string; mode: 'tajne' | 'imienne'; minutes: number}
  | {type: 'motion_create'; ballotId: string; justification: string}
  | {type: 'motion_sign'; motionId: string; on: boolean}
  | {type: 'motion_withdraw'; motionId: string}
  | {type: 'motion_vote'; motionId: string; minutes: number}
  | {type: 'reasumption_open'; motionId: string; minutes: number}
  | {type: 'chair_handover'; personId: string}
  | {type: 'chair_take'}
  | {type: 'break'; on: boolean}
  | {type: 'close'}
  | {type: 'message'; text: string};

const actLabels: Partial<Record<MaterialType, string>> = {
  uchwala: 'Uchwała', rezolucja: 'Rezolucja', oswiadczenie: 'Oświadczenie (stanowisko)', deklaracja: 'Deklaracja',
  apel: 'Apel', sprawozdanie: 'Sprawozdanie', protokol: 'Protokół',
};
export const materialTypeLabel = (t: MaterialType) => actLabels[t] ?? (t === 'informacja' ? 'Informacja' : 'Materiał');

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
    log: [{at: input.now, text: input.kind === 'posiedzenie' ? 'Utworzono posiedzenie.' : 'Utworzono procedurę głosowania między posiedzeniami (§ 14 ust. 5).', by: input.createdBy}],
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

function log(m: Meeting, ctx: Context, actor: Actor | null, text: string) {
  m.log.push({at: ctx.now, text, by: actor?.name ?? 'system'});
}
const name = (ctx: Context, id: string | null | undefined) => personName(ctx.roster, id);
const item = (m: Meeting, id: string | null | undefined) => m.agenda.find(i => i.id === id);
const ballot = (m: Meeting, id: string) => m.ballots.find(b => b.id === id) ?? fail('Nie znaleziono głosowania.', 404);
const openBallots = (m: Meeting) => m.ballots.filter(b => b.status === 'otwarte');

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
    ensure(!m.ballots.some(b => b.itemId === target.id || m.agenda.some(c => c.parentId === target.id && c.id === b.itemId)), 'Punkt ma już przeprowadzone głosowania — zamiast usuwać, oznacz go jako wycofany.');
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

function describeChange(m: Meeting, change: AgendaChange) {
  if (change.op === 'dodaj') return `dodanie punktu „${change.title.trim()}”`;
  const t = item(m, change.itemId);
  const label = t ? `${itemNumber(m.agenda, t.id)}. ${t.title}` : '';
  return change.op === 'usun' ? `usunięcie punktu ${label}` : `przeniesienie punktu ${label}`;
}

function openBallot(m: Meeting, ctx: Context, actor: Actor, input: {
  itemId: string | null; purpose: BallotPurpose; subject: string; mode: VoteMode; minutes: number;
  materialId?: string | null; target?: Ballot['target']; reasumptionOf?: string; endsAt?: number;
}) {
  const remote = m.kind === 'procedura';
  const members = memberIds(ctx.roster, m.organ);
  const quorum = quorumFor(members.length);
  if (!remote) {
    ensure(m.status === 'trwa', m.status === 'przerwa' ? 'Trwa przerwa w obradach.' : 'Posiedzenie nie trwa.');
    ensure(!openBallots(m).length, 'Trwa inne głosowanie. Najpierw je zakończ.');
    ensure(m.agendaAdopted || ['porzadek', 'tryb', 'wniosek'].includes(input.purpose), 'Najpierw trzeba przyjąć porządek obrad.');
  }
  const it = input.itemId ? item(m, input.itemId) : undefined;
  if (input.itemId) ensure(it, 'Nie znaleziono punktu porządku obrad.', 404);
  ensure(input.subject.trim(), 'Podaj, czego dotyczy głosowanie.');
  if (input.mode !== 'jawne') {
    ensure(it && it.mode === input.mode && it.modeBasis,
      `Głosowanie ${input.mode === 'tajne' ? 'tajne' : 'imienne'} wymaga wcześniejszego postanowienia Prezydium (§ 11 ust. 2).`);
  }
  if (input.mode === 'tajne') ensure(ctx.secret, 'Głosowanie tajne nie jest dostępne.');
  const eligible = remote ? members : presentMembers(m, ctx.roster);
  ensure(remote || eligible.length >= quorum, `Brak kworum: obecnych ${eligible.length} z ${members.length}, wymagane ${quorum} (§ 8 ust. 2).`);
  let material: Ballot['material'] = null;
  if (input.materialId) {
    const ref = m.materials.find(x => x.id === input.materialId);
    ensure(ref, 'Nie znaleziono materiału.', 404);
    material = {id: ref.id, version: ref.version, hash: ref.hash, title: ref.title};
  }
  const minutes = Math.round(Number(input.minutes));
  ensure(input.endsAt || (minutes >= 1 && minutes <= 240), 'Czas głosowania: od 1 do 240 minut.');
  const id = ctx.newId();
  const b: Ballot = {
    id, number: m.ballots.length + 1, itemId: input.itemId, purpose: input.purpose,
    subject: input.subject.trim().slice(0, 400), material, mode: input.mode,
    modeBasis: input.mode === 'jawne' ? '' : it!.modeBasis!, status: 'otwarte',
    openedAt: ctx.now, endsAt: input.endsAt ?? ctx.now + minutes * 60000, openedBy: actor.name,
    eligible, joined: [], absentDuring: [], membersTotal: members.length, quorum, remote, votes: {}, secret: null,
    target: input.target, reasumptionOf: input.reasumptionOf,
  };
  if (input.mode === 'tajne') b.secret = {...ctx.secret!.openKey(id), issued: [], cast: 0};
  m.ballots.push(b);
  if (!remote) m.presentation = {kind: 'glosowanie', id, at: ctx.now};
  log(m, ctx, actor, `Otwarto głosowanie nr ${b.number} (${b.mode}): ${b.subject}.`);
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
    if (it) { it.mode = b.target.mode; it.modeBasis = `postanowienie Prezydium w głosowaniu nr ${b.number}`; }
  }
  if (b.target?.kind === 'reasumpcja') {
    const motion = m.motions.find(x => x.id === (b.target as {motionId: string}).motionId);
    if (motion) motion.status = ok ? 'przyjety' : 'odrzucony';
  }
  const why = reason === 'wszyscy' ? 'zagłosowali wszyscy uprawnieni' : reason === 'czas' ? 'upłynął czas' : 'zamknięte przez prowadzącego';
  log(m, ctx, null, `Zakończono głosowanie nr ${b.number} (${why}). Za ${b.result.za}, przeciw ${b.result.przeciw}, wstrzymało się ${b.result.wstrzymuje}.`);
}

// Zamyka głosowania po upływie czasu albo gdy zagłosowali wszyscy uprawnieni; kończy procedurę.
export function advance(m: Meeting, ctx: Context) {
  let changed = false;
  for (const b of openBallots(m)) {
    if (ctx.now >= b.endsAt) { closeBallot(m, ctx, b, 'czas'); changed = true; }
    else if (everyoneVoted(b)) { closeBallot(m, ctx, b, 'wszyscy'); changed = true; }
  }
  if (m.kind === 'procedura' && m.status === 'trwa' && m.ballots.length && !openBallots(m).length) {
    m.status = 'zakonczone';
    m.closedAt = ctx.now;
    log(m, ctx, null, 'Procedura zakończona — wszystkie głosowania zostały zamknięte.');
    changed = true;
  }
  return changed;
}

function setPresence(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean, present: boolean) {
  const map = guest ? m.guests : m.attendance;
  const before = map[who] ?? 'nieobecny';
  if ((before === 'obecny') === present) return;
  map[who] = present ? 'obecny' : before === 'obecny' ? 'wyszedl' : 'nieobecny';
  m.presenceLog.push({who, guest, type: present ? 'przybycie' : 'wyjscie', at: ctx.now, by: actor.name});
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

export function apply(meeting: Meeting, cmd: Command, actor: Actor, ctx: Context): Meeting {
  const m = structuredClone(meeting);
  const roster = ctx.roster;
  ensure(canView(roster, m, actor), 'Brak dostępu do tego posiedzenia.', 403);
  advance(m, ctx);
  const posiedzenie = m.kind === 'posiedzenie';

  switch (cmd.type) {
    case 'details': {
      ensure(isOrganizer(roster, m, actor), 'Szczegóły posiedzenia zmienia organizator.', 403);
      ensure(m.status === 'przygotowanie' || cmd.link !== undefined && Object.keys(cmd).length === 2, 'Po otwarciu można zmienić tylko odnośnik do połączenia.');
      if (cmd.title !== undefined) { ensure(cmd.title.trim(), 'Podaj tytuł.'); m.title = cmd.title.trim().slice(0, 200); }
      if (cmd.date !== undefined) { ensure(/^\d{4}-\d{2}-\d{2}$/.test(cmd.date), 'Nieprawidłowa data.'); m.date = cmd.date; }
      if (cmd.time !== undefined) { ensure(/^\d{2}:\d{2}$/.test(cmd.time), 'Nieprawidłowa godzina.'); m.time = cmd.time; }
      if (cmd.place !== undefined) m.place = cmd.place.trim().slice(0, 200);
      if (cmd.mode !== undefined) { ensure(['stacjonarne', 'zdalne'].includes(cmd.mode), 'Nieprawidłowy tryb.'); m.mode = cmd.mode; }
      if (cmd.link !== undefined) {
        ensure(!cmd.link || /^https:\/\/\S+$/.test(cmd.link), 'Odnośnik do połączenia musi zaczynać się od https://');
        m.link = cmd.link.slice(0, 500);
      }
      if (cmd.noticeDate !== undefined) { ensure(!cmd.noticeDate || /^\d{4}-\d{2}-\d{2}$/.test(cmd.noticeDate), 'Nieprawidłowa data zawiadomienia.'); m.noticeDate = cmd.noticeDate; }
      if (cmd.endsAt !== undefined) { ensure(m.kind === 'procedura' && cmd.endsAt > ctx.now, 'Termin zakończenia musi być w przyszłości.'); m.endsAt = cmd.endsAt; }
      break;
    }
    case 'deputy': {
      ensure(posiedzenie && m.status !== 'zakonczone', 'Zastępcę wyznacza się przed posiedzeniem lub w jego trakcie.');
      const chairman = isChairman(roster, m.organ, actor.personId);
      ensure(chairman || actor.account.admin || actor.account.kind === 'biuro', 'Zastępcę wyznacza przewodniczący (§ 16 ust. 2).', 403);
      if (cmd.personId) {
        const ms = membership(roster, m.organ, cmd.personId);
        ensure(ms?.func === 'wiceprzewodniczacy', 'Zastępcą przewodniczącego może być wiceprzewodniczący (§ 16 ust. 2).');
      }
      const basis = chairman ? 'wyznaczenie przez przewodniczącego (§ 16 ust. 2)' : (cmd.basis ?? '').trim();
      ensure(chairman || !cmd.personId || basis.length >= 5, 'Podaj podstawę wyznaczenia, np. uchwałę Prezydium (§ 16 ust. 3).');
      m.chair.deputy = cmd.personId;
      m.chair.deputyBasis = cmd.personId ? basis : '';
      log(m, ctx, actor, cmd.personId ? `Na czas nieobecności przewodniczącego prowadzi: ${name(ctx, cmd.personId)} — ${basis}.` : 'Usunięto wyznaczenie zastępcy.');
      break;
    }
    case 'invite': {
      ensure(isOrganizer(roster, m, actor), 'Zaproszenia wysyła organizator.', 403);
      ensure(m.status !== 'zakonczone', 'Posiedzenie jest zamknięte.');
      m.invited = cmd.on ? [...new Set([...m.invited, cmd.accountId])] : m.invited.filter(id => id !== cmd.accountId);
      break;
    }
    case 'item_add': {
      ensure(canEditAgenda(roster, m, actor), m.agendaAdopted ? 'Przyjęty porządek obrad zmienia się w głosowaniu.' : 'Porządek obrad edytuje organizator, a po otwarciu prowadzący.', 403);
      const added = applyAgendaChange(m, ctx, {op: 'dodaj', title: cmd.title, parentId: cmd.parentId ?? null, afterId: cmd.afterId ?? null}, false);
      if (m.status !== 'przygotowanie') log(m, ctx, actor, `Dodano punkt porządku: ${added.title}.`);
      break;
    }
    case 'item_edit': {
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      if (cmd.title !== undefined) {
        ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
        ensure(cmd.title.trim(), 'Podaj nazwę punktu.');
        it.title = cmd.title.replace(/\s+/g, ' ').trim().slice(0, 400);
      }
      if (cmd.note !== undefined || cmd.presenter !== undefined) {
        ensure(isOrganizer(roster, m, actor) || m.chair.current === actor.personId, 'Notatki prowadzi prowadzący lub biuro.', 403);
        if (cmd.note !== undefined) it.note = cmd.note.slice(0, 20000);
        if (cmd.presenter !== undefined) it.presenter = cmd.presenter.slice(0, 200);
      }
      break;
    }
    case 'item_move': {
      ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      const siblings = m.agenda.filter(i => i.parentId === it.parentId);
      const index = siblings.indexOf(it), other = siblings[index + cmd.direction];
      ensure(other, 'Punktu nie można przesunąć dalej.');
      applyAgendaChange(m, ctx, {op: 'przesun', itemId: (cmd.direction < 0 ? it : other).id, beforeId: (cmd.direction < 0 ? other : it).id}, false);
      break;
    }
    case 'item_remove': {
      ensure(canEditAgenda(roster, m, actor), 'Przyjęty porządek obrad zmienia się w głosowaniu.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(posiedzenie ? it.kind !== 'porzadek' : true, 'Punktu „Przyjęcie porządku obrad” nie można usunąć.');
      applyAgendaChange(m, ctx, {op: 'usun', itemId: it.id}, false);
      break;
    }
    case 'agenda_import': {
      ensure(canEditAgenda(roster, m, actor), 'Porządek wczytuje organizator przed jego przyjęciem.', 403);
      const parsed = parseAgendaText(cmd.text.slice(0, 100000));
      ensure(parsed.items.length, parsed.warnings[0] ?? 'Brak punktów.');
      if (cmd.replace) {
        ensure(m.status === 'przygotowanie', 'Po otwarciu posiedzenia porządek można tylko uzupełniać.');
        ensure(!m.ballots.length && m.agenda.every(i => i.status === 'oczekuje' || i.kind === 'otwarcie'), 'Po rozpoczęciu obrad nie można zastąpić porządku — dodawaj punkty pojedynczo.');
        m.agenda = [];
      }
      const ids: string[] = [];
      for (const p of parsed.items) {
        const it = newItem(ctx.newId(), p.title, posiedzenie ? p.kind : 'sprawa', p.parent === null ? null : ids[p.parent]);
        ids.push(it.id);
        m.agenda.push(it);
      }
      log(m, ctx, actor, `Wczytano porządek obrad (${parsed.items.length} pozycji).`);
      break;
    }
    case 'item_material': {
      ensure(isOrganizer(roster, m, actor) || m.chair.current === actor.personId, 'Materiały przypisuje organizator lub prowadzący.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(m.materials.some(x => x.id === cmd.materialId), 'Nie znaleziono materiału.', 404);
      it.materialIds = cmd.on ? [...new Set([...it.materialIds, cmd.materialId])] : it.materialIds.filter(id => id !== cmd.materialId);
      break;
    }
    case 'item_mode': {
      ensure(m.kind === 'procedura' && m.status === 'przygotowanie' && isOrganizer(roster, m, actor), 'Tryb głosowania w procedurze ustala organizator przed jej rozpoczęciem.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(['jawne', 'imienne', 'tajne'].includes(cmd.mode), 'Nieprawidłowy tryb głosowania.');
      ensure(cmd.mode === 'jawne' || cmd.basis.trim().length >= 5, 'Podaj podstawę: postanowienie Prezydium o głosowaniu tajnym lub imiennym (§ 11 ust. 2).');
      it.mode = cmd.mode === 'jawne' ? undefined : cmd.mode;
      it.modeBasis = cmd.mode === 'jawne' ? undefined : cmd.basis.trim().slice(0, 300);
      break;
    }
    case 'open': {
      ensure(m.status === 'przygotowanie', 'To posiedzenie zostało już otwarte.');
      ensure(canChairOrgan(roster, m.organ, actor.personId), posiedzenie ? 'Posiedzenie otwiera przewodniczący lub wiceprzewodniczący (§ 9 ust. 1).' : 'Procedurę rozpoczyna przewodniczący lub wiceprzewodniczący.', 403);
      if (posiedzenie) {
        m.status = 'trwa';
        m.openedAt = ctx.now;
        m.chair.current = actor.personId;
        m.chair.changes.push({at: ctx.now, from: null, to: actor.personId!, by: actor.name, reason: 'otwarcie posiedzenia'});
        setPresence(m, ctx, actor, actor.personId!, false, true);
        const first = m.agenda.find(i => !i.parentId);
        if (first) { first.status = 'w_toku'; first.startedAt = ctx.now; m.currentItemId = first.id; m.presentation = {kind: 'punkt', id: first.id, at: ctx.now}; }
        const days = noticeDays(m);
        log(m, ctx, actor, `Otwarcie posiedzenia. Prowadzi: ${actor.name}.`);
        if (days === null) log(m, ctx, null, 'Uwaga: nie wpisano daty wysłania zawiadomienia (§ 7 ust. 1).');
        else if (days < 7) log(m, ctx, null, `Uwaga: zawiadomienie wysłano ${days} dni przed posiedzeniem — regulamin wymaga co najmniej 7 dni (§ 7 ust. 1).`);
      } else {
        const acts = m.agenda.filter(i => !i.parentId);
        ensure(acts.length, 'Dodaj co najmniej jedną sprawę do głosowania.');
        ensure(m.endsAt && m.endsAt > ctx.now + 5 * 60000, 'Termin zakończenia głosowania musi przypadać co najmniej 5 minut od teraz.');
        m.status = 'trwa';
        m.openedAt = ctx.now;
        m.chair.current = actor.personId;
        for (const act of acts) {
          act.status = 'w_toku';
          act.startedAt = ctx.now;
          const ref = m.materials.find(x => act.materialIds.includes(x.id));
          openBallot(m, ctx, actor, {
            itemId: act.id, purpose: ref?.type === 'uchwala' ? 'uchwala' : 'inna', subject: act.title,
            mode: act.mode ?? 'jawne', minutes: 0, materialId: ref?.id ?? null, endsAt: m.endsAt,
          });
        }
        log(m, ctx, actor, `Rozpoczęto głosowanie między posiedzeniami. Koniec: termin wyznaczony przez prowadzącego.`);
      }
      break;
    }
    case 'presence': {
      ensure(posiedzenie, 'W procedurze między posiedzeniami nie prowadzi się listy obecności.');
      ensure(m.status !== 'zakonczone', 'Posiedzenie zostało zamknięte.');
      const guest = !!cmd.guest;
      const self = guest ? actor.account.id === cmd.who : actor.personId === cmd.who;
      ensure(self || m.chair.current === actor.personId || isOrganizer(roster, m, actor), 'Obecność innej osoby zaznacza prowadzący lub biuro.', 403);
      if (guest) ensure(m.invited.includes(cmd.who), 'Ta osoba nie jest zaproszona.');
      else ensure(isMember(roster, m, cmd.who), 'Ta osoba nie jest członkiem organu.');
      setPresence(m, ctx, actor, cmd.who, guest, cmd.present);
      break;
    }
    case 'quorum': {
      requireLive(m); requireChair(m, actor);
      const total = memberIds(roster, m.organ).length, present = presentMembers(m, roster).length, required = quorumFor(total);
      m.quorumChecks.push({at: ctx.now, present, required, by: actor.name});
      log(m, ctx, actor, present >= required ? `Stwierdzono kworum: obecnych ${present} z ${total} (wymagane ${required}).` : `Brak kworum: obecnych ${present} z ${total} (wymagane ${required}).`);
      break;
    }
    case 'item_start': {
      requireLive(m); requireChair(m, actor);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(!openBallots(m).length, 'Trwa głosowanie — poczekaj na jego zakończenie.');
      ensure(m.agendaAdopted || allowedBeforeAdoption(m, it), 'Najpierw przyjmij porządek obrad — dopiero potem przechodzi się do kolejnych spraw.');
      ensure(it.status !== 'wycofany', 'Ten punkt został wycofany.');
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
      log(m, ctx, actor, `Punkt ${itemNumber(m.agenda, it.id)}: ${it.title}.`);
      break;
    }
    case 'item_end': {
      requireLive(m); requireChair(m, actor);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(['zakonczony', 'odroczony', 'wycofany'].includes(cmd.status), 'Nieprawidłowy status punktu.');
      ensure(!openBallots(m).some(b => b.itemId === it.id), 'W tym punkcie trwa głosowanie.');
      ensure(it.kind !== 'porzadek' || m.agendaAdopted || cmd.status !== 'zakonczony', 'Porządek obrad nie został jeszcze przyjęty.');
      it.status = cmd.status; it.endedAt = ctx.now;
      const label = {zakonczony: 'zakończony', odroczony: 'odroczony', wycofany: 'wycofany'}[cmd.status];
      log(m, ctx, actor, `Punkt ${itemNumber(m.agenda, it.id)} ${label}.`);
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
      ensure(posiedzenie, 'W procedurze głosowania otwierają się razem z jej rozpoczęciem.');
      requireLive(m); requireChair(m, actor);
      ensure(['uchwala', 'porzadek', 'protokol', 'wniosek', 'inna'].includes(cmd.purpose), 'Nieprawidłowy rodzaj głosowania.');
      ensure(['jawne', 'imienne', 'tajne'].includes(cmd.mode), 'Nieprawidłowy tryb głosowania.');
      if (cmd.purpose === 'porzadek') ensure(!m.agendaAdopted, 'Porządek obrad został już przyjęty — jego zmiany głosuje się osobno.');
      openBallot(m, ctx, actor, {itemId: cmd.itemId, purpose: cmd.purpose, subject: cmd.subject, mode: cmd.mode, minutes: cmd.minutes, materialId: cmd.materialId});
      break;
    }
    case 'vote': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'otwarte', 'Głosowanie zostało zakończone.');
      ensure(!b.secret, 'W głosowaniu tajnym głos oddaje się kartą tajną.');
      ensure(['za', 'przeciw', 'wstrzymuje'].includes(cmd.choice), 'Wybierz: za, przeciw albo wstrzymuję się.');
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
      log(m, ctx, actor, `Podczas głosowania nr ${b.number} oznaczono nieobecność: ${name(ctx, cmd.personId)}.`);
      break;
    }
    case 'ballot_close': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'otwarte', 'Głosowanie zostało już zakończone.');
      ensure(b.remote ? canChairOrgan(roster, m.organ, actor.personId) : m.chair.current === actor.personId, 'Głosowanie zamyka prowadzący.', 403);
      closeBallot(m, ctx, b, 'prowadzacy');
      break;
    }
    case 'announce': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'zamkniete', 'Wynik można ogłosić po zakończeniu głosowania.');
      if (posiedzenie) { requireLive(m); requireChair(m, actor); }
      else ensure(canChairOrgan(roster, m.organ, actor.personId) || isOrganizer(roster, m, actor), 'Wynik ogłasza prowadzący.', 403);
      b.announcedAt ??= ctx.now;
      if (posiedzenie) m.presentation = {kind: 'wynik', id: b.id, at: ctx.now};
      log(m, ctx, actor, `Ogłoszono wynik głosowania nr ${b.number}.`);
      break;
    }
    case 'agenda_change': {
      ensure(posiedzenie && m.agendaAdopted, 'Przed przyjęciem porządek obrad poprawia się bezpośrednio.');
      requireLive(m); requireChair(m, actor);
      const subject = `Zmiana porządku obrad: ${describeChange(m, cmd.change)}`;
      if (cmd.change.op !== 'dodaj') ensure(item(m, cmd.change.itemId), 'Nie znaleziono punktu.', 404);
      openBallot(m, ctx, actor, {itemId: null, purpose: 'zmiana_porzadku', subject, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'zmiana_porzadku', change: cmd.change}});
      break;
    }
    case 'mode_motion': {
      ensure(posiedzenie, 'W procedurze tryb ustala się przed jej rozpoczęciem.');
      requireLive(m); requireChair(m, actor);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(cmd.mode === 'tajne' || cmd.mode === 'imienne', 'Nieprawidłowy tryb.');
      const subject = `Wniosek o przeprowadzenie głosowania ${cmd.mode === 'tajne' ? 'tajnego' : 'imiennego'} w sprawie: ${it.title}`;
      openBallot(m, ctx, actor, {itemId: null, purpose: 'tryb', subject, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'tryb', itemId: it.id, mode: cmd.mode}});
      break;
    }
    case 'motion_create': {
      ensure(posiedzenie, 'Reasumpcja dotyczy głosowań na posiedzeniu (§ 12 ust. 2).');
      requireLive(m);
      const b = ballot(m, cmd.ballotId);
      ensure(actor.personId && m.attendance[actor.personId] === 'obecny' && isMember(roster, m, actor.personId), 'Wniosek składa członek Prezydium obecny na posiedzeniu.', 403);
      ensure(b.status === 'zamkniete', 'Reasumpcja dotyczy zakończonego głosowania.');
      ensure(b.mode === 'jawne', 'Reasumpcji nie podlegają wyniki głosowania imiennego i tajnego (§ 12 ust. 4).');
      ensure(!['reasumpcja', 'tryb'].includes(b.purpose), 'Tego głosowania nie można poddać reasumpcji.');
      ensure(!b.reasumptionOf && !b.supersededBy, 'Reasumpcja w tej sprawie została już przeprowadzona — tylko jeden raz (§ 12 ust. 3).');
      ensure(!m.motions.some(x => x.ballotId === b.id && ['zbiera_podpisy', 'zlozony', 'glosowany', 'przyjety'].includes(x.status)), 'Wniosek o reasumpcję tego głosowania już jest rozpatrywany.');
      ensure(cmd.justification.trim().length >= 10, 'Uzasadnij wniosek — dlaczego wynik budzi wątpliwości (§ 12 ust. 1).');
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
      ensure(motion.status === 'zlozony', 'Wniosek nie ma jeszcze wymaganej liczby podpisów (§ 12 ust. 5).');
      const original = ballot(m, motion.ballotId);
      const b = openBallot(m, ctx, actor, {itemId: original.itemId, purpose: 'reasumpcja', subject: `Wniosek o reasumpcję głosowania nr ${original.number}: ${original.subject}`, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'reasumpcja', ballotId: original.id, motionId: motion.id}});
      motion.status = 'glosowany';
      motion.voteBallotId = b.id;
      break;
    }
    case 'reasumption_open': {
      requireLive(m); requireChair(m, actor);
      const motion = m.motions.find(x => x.id === cmd.motionId) ?? fail('Nie znaleziono wniosku.', 404);
      ensure(motion.status === 'przyjety' && !motion.repeatBallotId, 'Ponowne głosowanie wymaga przyjęcia wniosku o reasumpcję.');
      const original = ballot(m, motion.ballotId);
      const b = openBallot(m, ctx, actor, {itemId: original.itemId, purpose: original.purpose, subject: original.subject, mode: 'jawne', minutes: cmd.minutes, reasumptionOf: original.id});
      if (original.material) b.material = {...original.material};
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
      log(m, ctx, actor, `Prowadzenie obrad przejmuje: ${name(ctx, cmd.personId)}.`);
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
        currentAway ? 'Prowadzenie przejmuje wyznaczony zastępca (§ 16 ust. 2).' : 'Prowadzenie może przekazać osoba prowadząca; przewodniczący może je przejąć.', 403);
      m.chair.changes.push({at: ctx.now, from: m.chair.current, to: actor.personId, by: actor.name, reason: chairman ? 'przejęcie przez przewodniczącego' : 'zastępstwo podczas nieobecności prowadzącego'});
      m.chair.current = actor.personId;
      log(m, ctx, actor, `Prowadzenie obrad przejmuje: ${actor.name}.`);
      break;
    }
    case 'break': {
      ensure(posiedzenie, 'Przerwa dotyczy posiedzenia.');
      requireLive(m); requireChair(m, actor);
      if (cmd.on) { ensure(m.status === 'trwa' && !openBallots(m).length, 'Przerwę ogłasza się poza głosowaniem.'); m.status = 'przerwa'; log(m, ctx, actor, 'Przerwa w obradach.'); }
      else { ensure(m.status === 'przerwa', 'Obrady nie są przerwane.'); m.status = 'trwa'; log(m, ctx, actor, 'Wznowienie obrad.'); }
      break;
    }
    case 'close': {
      requireLive(m);
      ensure(posiedzenie ? m.chair.current === actor.personId : canChairOrgan(roster, m.organ, actor.personId), 'Posiedzenie zamyka prowadzący.', 403);
      if (posiedzenie) ensure(!openBallots(m).length, 'Trwa głosowanie — zamknięcie możliwe po jego zakończeniu.');
      else for (const b of openBallots(m)) closeBallot(m, ctx, b, 'prowadzacy');
      for (const it of m.agenda) if (it.status === 'w_toku') { it.status = 'zakonczony'; it.endedAt = ctx.now; }
      m.status = 'zakonczone';
      m.closedAt = ctx.now;
      m.presentation = null;
      log(m, ctx, actor, posiedzenie ? 'Zamknięcie posiedzenia.' : 'Procedura zakończona przez prowadzącego.');
      break;
    }
    case 'message': {
      ensure(m.status !== 'zakonczone', 'Posiedzenie zostało zamknięte.');
      const text = cmd.text.trim();
      ensure(text.length >= 1 && text.length <= 1000, 'Wiadomość: od 1 do 1000 znaków.');
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

function fileIfSupported(m: Meeting, ctx: Context, motionId: string) {
  const motion = m.motions.find(x => x.id === motionId)!;
  if (motion.status !== 'zbiera_podpisy') return;
  const present = presentMembers(m, ctx.roster);
  const valid = motion.signatures.filter(id => present.includes(id)).length;
  if (valid >= reasumptionSignaturesNeeded(present.length)) {
    motion.status = 'zlozony';
    motion.filedAt = ctx.now;
    motion.presentAtFiling = present.length;
    log(m, ctx, null, `Wniosek o reasumpcję poparło ${valid} z ${present.length} obecnych — wymagana 1/3 (§ 12 ust. 5).`);
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
