import type {
  Account, Actor, AgendaChange, AgendaItem, Ballot, BallotPurpose, ChairBasis, Choice, CommsLevel, DisplayFile, DisplayKind, DisplayRef, DocType, FiledDocument, FiledKind,
  ItemKind, MaterialRef, MaterialType, Meeting, MeetingMode, MeetingSettingKey, ModeDecision, OrganCode, Presentation, PresenceEvent, Presenter, Roster, Stamp, VoteMode, ClosedRef} from './types.ts';
import {organMembers, organOfCode, personName} from './roster.ts';
import {
  announceFirst, computeResult, docTypeFor, everyoneVoted, hasVoted, itemNumber, memberIdsOf, openTally, pendingBefore,
  pendingPresence, presentMembers, quorumOf, quorumStated, signaturesNeeded, unhandledItems,
} from './rules.ts';
import {cleanTitle, completeAgenda, itemKindLabel, newItem, parseAgendaText, presidiumTemplate, validateAgenda} from './agenda.ts';
import {defaultDocTypes, docTypeById, docTypeName, plainFormulas} from './doctypes.ts';
import {agendaBasis, LAW, PROCEDURE_MIN_HOURS, shareText, type LegalProfile} from './law.ts';
import {defaultGeneral, messagesText, MOTION_MINUTES, organSettingsOf, proposeCaseType, VOTE_MINUTES, type GeneralBundle, type MeetingTemplate, type SiteSettings} from './settings.ts';
import {cascadeEnv, freeze, itemVoteMinutes, meetingFlag, meetingSetting, procedureEndAt, quorumTotal, type CascadeEnv} from './cascade.ts';
import {
  attendanceRefusal, canChairPerson, canCreate, canDesignateDeputy, canKeepAttendance, canManageProcedure, canMessage, canPrepare,
  canSkipListed, canStartProcedure, canView as roleCanView, deputyOf, funcOf, insteadOfDeputyText, isChairmanOf, isOfficeAccount,
  isPresiding, openOption, organRoster, takeChairOption,
} from './role.ts';
import {dateDots, dateTimeText, hoursText, isoDayOf, minutesText, plural} from './text.ts';
import {
  canAddDisplay, canEditComms, canEditProtocolOf, canFile, canFixProtocolOf, canReleaseComms, canRemoveDisplay, canSetPhotos, canShow, isCommsAccount, wasShown,
} from './role.ts';
import {commsChoices, commsCeiling, commsLevelOfItem, commsLevels} from './comms.ts';
import {photosHost, photosUrlCheck, proposeProtocolOf, protocolCandidates, protocolOfIssue} from './catalog.ts';
import {canShowNow, blockingBallot, pageNoun} from './show.ts';
import {COMMS_LEVELS, commsLevelLabel, isCommsLevel} from './settings.ts';

export class DomainError extends Error {
  status: number;
  /** Wersja 4 (G-23): ostrzeżenie, po którym zapis wymaga potwierdzenia (`confirm: true`); serwer odpowiada 409 z polem `warning`. */
  warning?: string;
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
/**
 * `docTypes` to słownik rodzajów dokumentów (F11); bez niego obowiązują rodzaje domyślne. Wersja 3: `general` to pakiet
 * ustawień ogólnych (z niego słownik ma pierwszeństwo przed `docTypes`), `law` profile prawne organów, a `accounts`
 * konta (do rozróżnienia gości i osób z głosem doradczym, G-14). Bez nich obowiązują `defaultGeneral` i `LAW`.
 */
export interface Context {
  roster: Roster; now: number; newId: () => string; secret?: SecretHooks; docTypes?: DocType[];
  general?: GeneralBundle; law?: Partial<Record<OrganCode, LegalProfile>>; accounts?: Account[];
  /** Wersja 4 (G-33): zamknięte posiedzenia organu do „Dotyczy protokołu” (`closedRefs` z catalog.ts); czyta je etap D.2. */
  closedMeetings?: ClosedRef[];
}

// Polecenia domeny. Pola oznaczone „wymagane” w opisie są w typie nieobowiązkowe tylko dlatego, że wymóg zależy
// od stanu posiedzenia; domena sprawdza je przy wykonaniu. Opis warunków jest w /home/user/przeglad/v3-A/KONTRAKT.md.
export type Command =
  | {type: 'details'; title?: string; date?: string; time?: string; place?: string; mode?: MeetingMode; link?: string; noticeDate?: string; endsAt?: number | null;
    /** F10: dane do protokołu, nieobowiązkowe, także po otwarciu. `convener` to identyfikator osoby ze składu albo pusty napis. */
    protocolNumber?: string; recorder?: string; convener?: string}
  /** Wersja 3: tylko przewodniczący; `basis` jest pomijane (pole zniknie z klienta). */
  | {type: 'deputy'; personId: string | null; /** @deprecated wersja 3 */ basis?: string}
  /** Wersja 3: gość wymaga `invitedBy`, a przy zaproszeniu przez organ także `decision` (G-14). */
  | {type: 'invite'; accountId: string; on: boolean; invitedBy?: 'przewodniczacy' | 'organ'; decision?: string}
  | {type: 'item_add'; title: string; parentId?: string | null; afterId?: string | null}
  /**
   * F11, F12: `docType` pusty albo null usuwa „Co jest głosowane”; `presenters` zastępuje listę osób (najwyżej 6).
   * Wersja 3: `kind`, `caseType`, `caseTypeGuess: null` (odrzucenie propozycji), `voteMinutes` (null usuwa) i `reason`
   * (pominięcie punktu z regulaminu albo zmiana „Co jest głosowane” w trakcie obrad).
   */
  | {type: 'item_edit'; itemId: string; title?: string; note?: string; presenters?: Presenter[]; docType?: string | null;
    kind?: ItemKind; caseType?: string | null; caseTypeGuess?: null; voteMinutes?: number | null; reason?: string;
    /** Wersja 4: poziom i zdanie dla komunikacji (U-26, U-27, G-22; `level: null` przywraca poziom dziedziczony). */
    comms?: {level?: CommsLevel | null; sentence?: string};
    /** Wersja 4: „Dotyczy protokołu” (U-28, G-33); `null` usuwa, `protocolOfGuess: null` odrzuca propozycję. */
    protocolOf?: string | null; protocolOfGuess?: null;
    /** Wersja 4 (G-31, B2-W14): nazwa punktu, którą widziała osoba zmieniająca; inna nazwa daje 409. */
    expect?: {title?: string}}
  | {type: 'item_move'; itemId: string; direction: -1 | 1}
  /** F8: przeniesienie punktu w projekcie porządku. `parentId` null to punkt główny, `beforeId` null to koniec grupy. */
  | {type: 'item_place'; itemId: string; parentId: string | null; beforeId: string | null}
  /** Wersja 3: punkt wymieniony w regulaminie usuwa tylko canSkipListed z `reason` (DA-7). */
  | {type: 'item_remove'; itemId: string; reason?: string}
  | {type: 'agenda_import'; text: string; replace: boolean}
  | {type: 'item_material'; itemId: string; materialId: string; on: boolean}
  /** Wersja 3: tryb tajny albo imienny wymaga `decision` (G-13); `basis` jest pomijane. */
  | {type: 'item_mode'; itemId: string; mode: VoteMode; decision?: ModeDecision; /** @deprecated wersja 3 */ basis?: string}
  /** Wersja 3: ustawienia posiedzenia w przygotowaniu (czasy głosowań). */
  | {type: 'settings_set'; key: MeetingSettingKey; value: number | boolean}
  | {type: 'settings_reset'; key: MeetingSettingKey}
  /** Wersja 3: `reason` przy otwarciu zamiast wyznaczonego zastępcy i przy głosowaniu między posiedzeniami krótszym niż 24 godziny. */
  | {type: 'open'; reason?: string}
  | {type: 'presence'; who: string; guest?: boolean; present: boolean}
  /** F9: potwierdzenie (`accept: true`) albo odrzucenie zgłoszonej obecności; odrzuca tylko osoba prowadząca obrady (DA-19). */
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
  /** Wersja 3: przekazanie osobie ze zgłoszoną obecnością zapisuje jej obecność. */
  | {type: 'chair_handover'; personId: string}
  /** Wersja 3: kolejność do prowadzenia (DA-17); `chairLeft` zapisuje wyjście osoby prowadzącej, `reason` zamiast zastępcy. */
  | {type: 'chair_take'; chairLeft?: boolean; reason?: string}
  | {type: 'break'; on: boolean}
  /** F4: `reason` wymagane, gdy zostały nierozpatrzone punkty. */
  | {type: 'close'; reason?: string}
  /** F7: zakończenie głosowania między posiedzeniami przed terminem; przy `przerwij` `reason` wymagane. */
  | {type: 'procedure_end'; how: 'policz' | 'przerwij'; reason?: string}
  /** F7: nowy termin co najmniej 5 minut od teraz; wersja 3: termin krótszy niż 24 godziny od rozpoczęcia wymaga `reason`. */
  | {type: 'procedure_deadline'; endsAt: number; reason?: string}
  | {type: 'message'; text: string}
  // Wersja 4 (SPEC-4 5.1).
  /** Opis dla komunikacji po zamknięciu (U-49, G-39); pusty tekst usuwa opis. */
  | {type: 'comms_note'; text: string}
  /** „Udostępnij komunikacji” (U-48, DB-42, G-39). */
  | {type: 'comms_release'}
  /** Poprawka „Dotyczy protokołu” w głosowaniu po zamknięciu (G-38, K4-4). */
  | {type: 'ballot_protocol_fix'; ballotId: string; protocolOf: string; reason: string}
  /** Odnośnik do albumu zdjęć (U-32, G-23); pusty adres usuwa, `confirm` zapisuje mimo ostrzeżenia. */
  | {type: 'photos_set'; url: string; confirm?: boolean}
  /** „Protokół sporządzony” z osobą sporządzającą i datą wpisaną ręcznie (U-34, G-27); `date: null` usuwa fakt. */
  | {type: 'minutes_ready'; date: string | null; authorPersonId?: string}
  /** Plik do pokazania: nazwa, punkt, kolejność slajdów i opis (G-25, B3-15). */
  | {type: 'display_edit'; id: string; title?: string; itemId?: string | null; order?: string[]; description?: string}
  | {type: 'display_remove'; id: string}
  /** Pokaz (U-31, G-24): rozpoczęcie albo przełączenie, strona, zakończenie. Powrót do pokazu: `present {kind: 'pokaz', id}`. */
  | {type: 'show'; source: 'plik' | 'material'; id: string; page?: number}
  | {type: 'show_page'; page: number}
  | {type: 'show_end'};

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

/** Pakiet ustawień z kontekstu domeny; bez niego ustawienia domyślne i słownik z `ctx.docTypes` (testy wersji 2). */
export const defaultSite: SiteSettings = {place: '', term: '', termNumber: '', protocolNumberPattern: ''};
export function bundleOf(ctx: Pick<Context, 'general' | 'docTypes'>): GeneralBundle {
  return ctx.general ?? {general: defaultGeneral(defaultSite), docTypes: ctx.docTypes ?? defaultDocTypes, revision: 0};
}
const lawFor = (ctx: Pick<Context, 'law'>, organ: OrganCode): LegalProfile => ctx.law?.[organ] ?? LAW[organ];
/** Środowisko kaskady dla posiedzenia z kontekstu domeny. */
export function envOf(ctx: Pick<Context, 'roster' | 'general' | 'docTypes' | 'law' | 'accounts'>, organ: OrganCode): CascadeEnv {
  return cascadeEnv({roster: ctx.roster, bundle: bundleOf(ctx), organ, accounts: ctx.accounts, law: ctx.law});
}

/** Konta osób z głosem doradczym zapraszane z urzędu na każde nowe posiedzenie (DA-5). */
export const advisoryIds = (accounts: Pick<Account, 'id' | 'kind' | 'disabled'>[]) => accounts.filter(a => a.kind === 'doradczy' && !a.disabled).map(a => a.id);
const advisoryNote = 'Dodano osoby z głosem doradczym zawiadamiane o każdym posiedzeniu (§ 7 ust. 2).';

/**
 * Nowe posiedzenie albo głosowanie między posiedzeniami z ustawień ogólnych (wersja 3, U-04, U-17): punkty i pola
 * z wzoru posiedzenia, protokolant z wzoru albo z ustawień organu, zaproszone osoby z głosem doradczym (DA-5). Koniec
 * głosowania między posiedzeniami bez podanego terminu liczy się przy rozpoczęciu z czasu w ustawieniach (DA-21,
 * `procedureEndAt`); podany termin jest terminem wpisanym ręcznie. Strażnik G-12 (organ, tryb, głosowanie między posiedzeniami).
 * Serwer i wersja próbna wołają tę samą funkcję.
 */
export function newMeetingFromSettings(input: {
  id: string; kind: Meeting['kind']; organ?: OrganCode; template?: string; title?: string; date?: string; time?: string;
  place?: string; mode?: MeetingMode; endsAt?: number; actor: Actor;
}, ctx: Context): Meeting {
  const organ: OrganCode = input.organ ?? 'prezydium';
  ensure(['prezydium', 'rada', 'zjazd'].includes(organ), 'Nieznany organ.');
  const law = lawFor(ctx, organ);
  ensure(law.available, 'Posiedzeń tego organu nie prowadzimy jeszcze w aplikacji.');
  if (input.kind === 'procedura' && !law.betweenMeetings.allowed) fail(law.betweenMeetings.reason);
  ensure(canCreate(ctx.roster, organ, input.actor), input.kind === 'procedura' ? 'Głosowanie między posiedzeniami przygotowuje biuro, przewodniczący lub wiceprzewodniczący.' : 'Posiedzenie przygotowuje biuro, przewodniczący lub wiceprzewodniczący.', 403);
  const bundle = bundleOf(ctx);
  const settings = organSettingsOf(bundle.general, organ);
  const procedure = input.kind === 'procedura';
  let template: MeetingTemplate | undefined;
  if (!procedure) {
    template = input.template ? settings.templates.find(t => t.id === input.template) : settings.templates[0];
    ensure(template || !input.template, 'Nie znaleziono wzoru posiedzenia.', 404);
  }
  const mode: MeetingMode = procedure ? 'zdalne' : input.mode === 'zdalne' || input.mode === 'stacjonarne' ? input.mode : template?.defaults?.mode ?? 'stacjonarne';
  if (!procedure && mode === 'zdalne' && !law.remote.allowed) fail(law.remote.reason);
  const organ_ = organOfCode(ctx.roster, organ);
  const title = (input.title ?? '').trim() || (procedure ? `Głosowanie między posiedzeniami ${organ_.forms.genitive}` : `Posiedzenie ${organ_.forms.genitive}`);
  const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const time = (v: unknown) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : null;
  // U-17, D-6: bez podanej daty posiedzenie dostaje dziś + najkrótszy termin zawiadomienia + 1 dzień.
  const today = new Date(ctx.now + (procedure ? 0 : (law.notice.minDays + 1) * 86400000)).toISOString().slice(0, 10);
  const endsAt = procedure && Number(input.endsAt) > 0 ? Number(input.endsAt) : undefined;
  const m = createMeeting({
    id: input.id, organ, kind: input.kind, title,
    date: day(input.date) ?? today, time: time(input.time) ?? template?.defaults?.time ?? '10:00',
    place: procedure ? '' : String(input.place ?? bundle.general.site.place ?? ''), mode,
    createdBy: input.actor.name, now: ctx.now, newId: ctx.newId, endsAt,
  });
  if (template) {
    m.template = {id: template.id, name: template.name};
    m.agenda = [];
    for (const t of template.items) {
      const top = templateItem(m, ctx, t, null);
      for (const c of t.children ?? []) templateItem(m, ctx, c, top.id);
    }
    const recorder = template.defaults?.recorder || settings.recorder;
    if (recorder) m.recorder = recorder;
  } else if (!procedure && settings.recorder) m.recorder = settings.recorder;
  m.log[0].accountId = input.actor.account.id;
  if (endsAt) m.endsAtSet = {at: ctx.now, by: input.actor.name, accountId: input.actor.account.id};
  m.invited = advisoryIds(ctx.accounts ?? []);
  return m;
}
function templateItem(m: Meeting, ctx: Context, t: MeetingTemplate['items'][number], parentId: string | null) {
  const it = newItem(ctx.newId(), t.title, t.kind, parentId);
  if (t.docType) it.docType = t.docType;
  if (t.caseType) it.caseType = t.caseType;
  if (t.presenterFunc) {
    const ms = organMembers(ctx.roster, m.organ).find(x => x.func === t.presenterFunc);
    if (ms) it.presenters = [{name: personName(ctx.roster, ms.personId), role: ms.label, kind: 'referuje', personId: ms.personId}];
  }
  m.agenda.push(it);
  guessProtocolOf(m, ctx, it);
  return it;
}

// Dni między wysłaniem zawiadomienia a posiedzeniem — § 7 ust. 1 wymaga co najmniej 7.
export function noticeDays(m: Meeting) {
  if (!m.noticeDate || !m.date) return null;
  return Math.round((Date.parse(m.date + 'T12:00:00Z') - Date.parse(m.noticeDate + 'T12:00:00Z')) / 86400000);
}

/** Członek organu posiedzenia (według składu zapisanego przy otwarciu, a bez zapisu bieżącego). */
export const isMember = (roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, personId: string | null) => !!personId && organRoster(roster, m).some(x => x.personId === personId);
export const canChairOrgan = (roster: Roster, organ: string, personId: string | null) => canChairPerson(roster, {organ: organ as OrganCode}, personId);
export const isChairman = (roster: Roster, organ: string, personId: string | null) => isChairmanOf(roster, {organ: organ as OrganCode}, personId);
/** @deprecated Wersja 3: nakładka równa canPrepare z role.ts (bez flagi administratora). */
export const isOrganizer = (roster: Roster, m: Pick<Meeting, 'organ'>, actor: Actor) => canPrepare(roster, m, actor);
/** Kto widzi posiedzenie: biuro, członek organu, zaproszony (role.ts). */
export const canView = (roster: Roster, m: Meeting, actor: Actor) => roleCanView(roster, m, actor);

type LogExtra = {tag?: 'projekt' | 'ustawienia' | 'odstepstwo' | 'pokaz'; ballotId?: string; itemId?: string; displayId?: string};
function log(m: Meeting, ctx: Context, actor: Actor | null, text: string, extra: LogExtra = {}) {
  m.log.push({at: ctx.now, text, by: actor?.name ?? 'system', ...(actor ? {accountId: actor.account.id} : {}), ...extra});
}
// F8: zmiana projektu porządku obrad trafia do dziennika z oznaczeniem `projekt`; od wersji 3 także przed otwarciem
// (protokół wymienia tylko wpisy od otwarcia).
function draftLog(m: Meeting, ctx: Context, actor: Actor, text: string, itemId?: string) {
  log(m, ctx, actor, `Zmieniono projekt porządku obrad. ${text}`, {tag: 'projekt', ...(itemId ? {itemId} : {})});
}
/** Wpis dziennika o zmianie danych albo ustawień posiedzenia (rozdz. 2.8 pkt 2). */
const settingLog = (m: Meeting, ctx: Context, actor: Actor, text: string, itemId?: string) => log(m, ctx, actor, text, {tag: 'ustawienia', ...(itemId ? {itemId} : {})});
/** Słownik rodzajów: zapisany przy otwarciu posiedzenia, potem z ustawień ogólnych, z `ctx.docTypes`, domyślny. */
const docTypesOf = (ctx: Context, m?: Pick<Meeting, 'frozen'>) => m?.frozen?.docTypes ?? ctx.general?.docTypes ?? ctx.docTypes ?? defaultDocTypes;
const disabledDocType = 'Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.';
const stampOf = (ctx: Context, actor: Actor, extra: Partial<Stamp> = {}): Stamp => ({at: ctx.now, by: actor.name, accountId: actor.account.id, ...extra});
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
/** „Anna Grzegorczyk, I Wiceprzewodnicząca” według składu posiedzenia. */
const nameWithFunc = (ctx: Context, m: Meeting, id: string | null | undefined) => {
  const ms = organRoster(ctx.roster, m).find(x => x.personId === id);
  return ms ? `${name(ctx, id)}, ${ms.label}` : name(ctx, id);
};
const item = (m: Meeting, id: string | null | undefined) => m.agenda.find(i => i.id === id);
const ballot = (m: Meeting, id: string) => m.ballots.find(b => b.id === id) ?? fail('Nie znaleziono głosowania.', 404);
const openBallots = (m: Meeting) => m.ballots.filter(b => b.status === 'otwarte');
/** Otwarte głosowania w sprawach, bez głosowania próbnego, które nie blokuje innych czynności (F1). */
const regularOpen = (m: Meeting) => openBallots(m).filter(b => b.purpose !== 'proba');
const live = (m: Meeting) => m.status === 'trwa' || m.status === 'przerwa';

function requireChair(m: Meeting, actor: Actor) {
  ensure(m.kind === 'posiedzenie' ? m.chair.current !== null && m.chair.current === actor.personId : true,
    'Tę czynność wykonuje osoba prowadząca posiedzenie.', 403);
}
function requireLive(m: Meeting) {
  ensure(m.status === 'trwa' || m.status === 'przerwa', m.status === 'przygotowanie' ? 'Posiedzenie nie zostało jeszcze otwarte.' : 'Posiedzenie zostało zamknięte.');
}
function canEditAgenda(roster: Roster, m: Meeting, actor: Actor) {
  if (m.status === 'przygotowanie') return canPrepare(roster, m, actor);
  return m.kind === 'posiedzenie' && !m.agendaAdopted && m.status !== 'zakonczone' && m.chair.current === actor.personId;
}
/** Odmowa zmiany projektu porządku zależna od stanu posiedzenia (D1, DA-9: po otwarciu zmienia tylko osoba prowadząca). */
function agendaRefusal(m: Meeting) {
  if (m.agendaAdopted) return 'Przyjęty porządek obrad zmienia się w głosowaniu.';
  if (m.status === 'zakonczone') return 'Posiedzenie zostało zamknięte.';
  if (m.status === 'przygotowanie') return 'Porządek obrad poprawia biuro, przewodniczący albo wiceprzewodniczący, a po otwarciu posiedzenia osoba prowadząca obrady.';
  if (m.kind === 'procedura') return 'Po rozpoczęciu głosowania nie można zmieniać spraw.';
  return 'Po otwarciu posiedzenia projekt porządku obrad zmienia osoba prowadząca obrady (§ 9 ust. 1).';
}
const procedureManagerRefusal = 'Tę czynność wykonuje osoba, która rozpoczęła głosowanie, albo przewodniczący.';

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
  /** Wersja 3: czas z ustawień punktu albo posiedzenia, do wpisu, gdy osoba prowadząca wybrała inny. */
  setting?: {minutes: number; of: 'punkt' | 'posiedzenie'};
}) {
  const remote = m.kind === 'procedura';
  const trial = input.purpose === 'proba';
  // Wersja 3: uprawnieni i kworum ze składu zapisanego przy otwarciu (frozen.members), wynik liczenia bez zmian.
  const members = memberIdsOf(m, ctx.roster);
  const law = lawFor(ctx, m.organ);
  const quorum = quorumOf(law, quorumTotal(members.length, organSettingsOf(bundleOf(ctx).general, m.organ).seats?.count ?? null));
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
  ensure(remote || trial || eligible.length >= quorum, `Brak kworum. Obecnych ${eligible.length} z ${members.length}, wymagane ${quorum} (${law.quorum.basis}).`);
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
      const type = docTypeById(docTypesOf(ctx, m), input.docType);
      ensure(type, 'Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
      // F11: wskazany wprost rodzaj musi być włączony; rodzaj odziedziczony z punktu, materiału albo z głosowania
      // poddanego reasumpcji pozostaje dozwolony.
      ensure(type.active || input.docType === it?.docType || input.inherited, disabledDocType);
    }
    const chosen = docTypeFor(m, {explicit: input.docType, item: it, materialId: input.materialId, purpose: input.purpose, subject: input.subject});
    const type = docTypeById(docTypesOf(ctx, m), chosen);
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
  // Wersja 3 (poziom 3): czas inny niż w ustawieniach punktu albo posiedzenia trafia do wpisu.
  let timing = '';
  if (!trial && !remote && input.setting) {
    const expected = input.setting.minutes;
    if (expected !== minutes) timing = ` Czas głosowania ${minutesText(minutes)}, w ustawieniach ${input.setting.of === 'punkt' ? 'punktu' : 'posiedzenia'} ${minutesText(expected)}.`;
  }
  log(m, ctx, actor, trial ? `Otwarto głosowanie próbne ${b.mode}.` : `Otwarto głosowanie ${b.mode} nr ${b.number} ${quoted(b.subject)}.${timing}`);
  return b;
}

function closeBallot(m: Meeting, ctx: Context, b: Ballot, reason: NonNullable<Ballot['closeReason']>, actor: Actor | null = null) {
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
  // Wersja 3: zakończenie przed czasem podpisuje osoba, która je zakończyła (dawniej „system”).
  log(m, ctx, reason === 'prowadzacy' ? actor : null, b.purpose === 'proba' ? `Zakończono głosowanie próbne (${why}). ${tally}` : `Zakończono głosowanie nr ${b.number} (${why}). ${tally}`, {ballotId: b.id});
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
function setPresence(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean, present: boolean, reportedAt?: number, via?: PresenceEvent['via']) {
  const map = guest ? m.guests : m.attendance;
  const before = map[who] ?? 'nieobecny';
  if ((before === 'obecny') === present) return false;
  map[who] = present ? 'obecny' : before === 'obecny' ? 'wyszedl' : 'nieobecny';
  m.presenceLog.push({who, guest, type: present ? 'przybycie' : 'wyjscie', at: ctx.now, by: actor.name, ...(present && reportedAt ? {reportedAt} : {}), ...(via ? {via} : {}), accountId: actor.account.id});
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
  return true;
}

// F9: zgłoszenie obecności na posiedzeniu stacjonarnym czeka na potwierdzenie osoby prowadzącej obrady albo biura.
function reportPresence(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean) {
  const map = guest ? m.guests : m.attendance;
  if (map[who] === 'obecny' || map[who] === 'zgloszony') return;
  map[who] = 'zgloszony';
  m.presenceLog.push({who, guest, type: 'zgloszenie', at: ctx.now, by: actor.name, accountId: actor.account.id});
}
// Odrzucenie albo wycofanie zgłoszenia: osoba wraca do stanu sprzed zgłoszenia („wyszedl”, gdy była już obecna).
function dropReport(m: Meeting, ctx: Context, actor: Actor, who: string, guest: boolean) {
  const map = guest ? m.guests : m.attendance;
  if (map[who] !== 'zgloszony') return;
  map[who] = m.presenceLog.some(e => e.who === who && !!e.guest === guest && e.type === 'przybycie') ? 'wyszedl' : 'nieobecny';
  m.presenceLog.push({who, guest, type: 'odrzucenie', at: ctx.now, by: actor.name, accountId: actor.account.id});
}
const reportTime = (m: Meeting, who: string, guest: boolean) =>
  [...m.presenceLog].reverse().find(e => e.who === who && !!e.guest === guest && e.type === 'zgloszenie')?.at;
/** Potwierdza zgłoszenia obecności: osoba prowadząca obrady albo biuro (F9; wersja 3 bez flagi administratora). */
const confirmsPresence = (m: Meeting, actor: Actor) => isPresiding(m, actor) || isOfficeAccount(actor);

/** Czas głosowań nad wnioskami z ustawień posiedzenia (wpis przy innym czasie, O-13). */
const motionSetting = (ctx: Context, m: Meeting) => ({minutes: meetingSetting(envOf(ctx, m.organ), m, 'motionMinutes').value, of: 'posiedzenie' as const});

/** Polecenia, po których domena sprawdza niezmiennik porządku obrad (G-6). */
const agendaCommands = new Set<Command['type']>(['item_add', 'item_edit', 'item_move', 'item_place', 'item_remove', 'agenda_import']);
const ITEM_KINDS: ItemKind[] = ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie', 'sprawa'];
/** Organ jako podmiot zdania: „Prezydium” w sprawach Prezydium, inaczej pełna nazwa z danych. */
const organWord = (ctx: Context, organ: OrganCode) => organ === 'prezydium' ? 'Prezydium' : organOfCode(ctx.roster, organ).name;
/** Opis zmiany prowadzenia w `ChairChange.reason` (brzmienia z rozdz. 5.8 specyfikacji wersji 3). */
function chairReason(basis: ChairBasis, given: string) {
  switch (basis) {
    case 'przewodniczacy': return 'przejęcie prowadzenia przez przewodniczącego';
    case 'zastepca': return 'zastępstwo wyznaczone przez przewodniczącego, § 16 ust. 2';
    case 'bez_wyznaczenia': return 'bez wyznaczenia zastępcy przez przewodniczącego, § 9 ust. 1';
    case 'zamiast_zastepcy': return `zamiast wyznaczonego zastępcy, powód ${quoted(given.replace(/\.$/, ''))}`;
    case 'przekazanie': return 'przekazanie prowadzenia';
    case 'powrot': return 'powrót do prowadzenia po wyjściu zapisanym przy przejęciu';
  }
}
/** Propozycja rodzaju sprawy z tytułu punktu (I-13), tylko w przygotowaniu i dla punktu bez rodzaju sprawy. */
function guessCaseType(m: Meeting, ctx: Context, it: AgendaItem) {
  if (m.status !== 'przygotowanie' || it.caseType) return;
  const guess = proposeCaseType(bundleOf(ctx).general.caseTypes, m.organ, it.title);
  if (guess) it.caseTypeGuess = guess; else delete it.caseTypeGuess;
}
/** Tytuły punktów wymaganych regulaminem z wzoru posiedzenia (uzupełnianie porządku i powielenie). */
function titlesFor(ctx: Context, m: Pick<Meeting, 'organ' | 'template'>): Partial<Record<ItemKind, string>> {
  const settings = organSettingsOf(bundleOf(ctx).general, m.organ);
  const template = (m.template && settings.templates.find(t => t.id === m.template!.id)) ?? settings.templates[0];
  const out: Partial<Record<ItemKind, string>> = {};
  for (const t of template?.items ?? []) if (t.kind !== 'sprawa') out[t.kind] ??= t.title;
  return out;
}
/** Pominięcie punktu wymienionego w regulaminie (DA-7, G-7): uprawnienie, powód, wpis w `skipped` i w dzienniku. */
function skipListed(m: Meeting, ctx: Context, actor: Actor, it: AgendaItem, raw: unknown, law: LegalProfile) {
  const basis = agendaBasis(law, it.kind) ?? law.agenda.listedBasis;
  ensure(canSkipListed(ctx.roster, m, actor), 'Pominięcie punktu wymienionego w regulaminie zatwierdza przewodniczący (§ 14 ust. 3).', 403);
  const reason = reasonOf(raw);
  ensure(reason, `Podaj powód pominięcia punktu „${it.title}”. Trafi do protokołu (${basis}).`);
  (m.skipped ??= []).push({reason, at: ctx.now, by: actor.name, title: it.title, kind: it.kind, accountId: actor.account.id, personId: actor.personId});
  log(m, ctx, actor, `Pominięto punkt ${quoted(it.title)} wymieniony w ${basis}. Powód ${quoted(reason.replace(/\.$/, ''))}.`, {tag: 'projekt', itemId: it.id});
}
/** Pominięcie traci znaczenie, gdy punkt tego rodzaju wraca do projektu w przygotowaniu. */
function dropRestoredSkips(m: Meeting) {
  if (m.status !== 'przygotowanie' || !m.skipped?.length) return;
  m.skipped = m.skipped.filter(s => !m.agenda.some(i => i.kind === s.kind));
  if (!m.skipped.length) delete m.skipped;
}
/** „Co jest głosowane” wynikające z punktu (własne, z rodzaju sprawy albo z materiału). */
function effectiveDocType(m: Meeting, ctx: Context, it: AgendaItem) {
  if (it.docType) return it.docType;
  const c = it.caseType ? bundleOf(ctx).general.caseTypes.find(x => x.id === it.caseType) : undefined;
  return c?.docType ?? m.materials.find(x => it.materialIds.includes(x.id))?.type ?? null;
}
/** Punkt ma materiał albo rodzaj sprawy, który wymaga głosowania (G-9). */
function votedSource(m: Meeting, ctx: Context, it: AgendaItem, types: DocType[]) {
  const c = it.caseType ? bundleOf(ctx).general.caseTypes.find(x => x.id === it.caseType) : undefined;
  if (c && docTypeById(types, c.docType)?.voted) return {what: 'rodzaj sprawy' as const, name: c.name, type: c.docType};
  const material = m.materials.find(x => it.materialIds.includes(x.id) && docTypeById(types, x.type)?.voted);
  return material ? {what: 'materiał' as const, name: material.title, type: material.type} : null;
}
function requireVotedType(m: Meeting, ctx: Context, it: AgendaItem, types: DocType[], law: LegalProfile) {
  const source = votedSource(m, ctx, it, types);
  const chosen = it.docType ? docTypeById(types, it.docType) : undefined;
  if (!source || !chosen || chosen.voted) return;
  const basis = law.acts.voted[source.type];
  fail(`Ten punkt ma ${source.what} »${source.name}«, który wymaga głosowania${basis ? ` (${basis})` : ''}. Wybierz rodzaj, który się głosuje, albo zmień ${source.what}.`);
}
const typeLabel = (types: DocType[], id: string | null | undefined) => id ? docTypeName(id, types) : 'Bez rodzaju';
/** Data uchwały albo głosowania, które ustaliło tryb (G-13), albo null przy niepełnych danych. */
function modeDecisionOf(raw: unknown): ModeDecision | null {
  const d = raw as Partial<ModeDecision> | undefined;
  if (!d || typeof d !== 'object' || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return null;
  if (d.kind === 'uchwala') {
    const number = typeof d.number === 'string' ? d.number.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    return number ? {kind: 'uchwala', number, date: d.date} : null;
  }
  if (d.kind === 'glosowanie') {
    const number = Number(d.number);
    return Number.isInteger(number) && number > 0 ? {kind: 'glosowanie', number, date: d.date} : null;
  }
  return null;
}

// Wersja 4 (SPEC-4 5.1): pokaz, pliki do pokazania, dokumenty po posiedzeniu, materiał dla komunikacji.

const SHOW_REFUSALS = {
  who: 'Pokazuje osoba prowadząca obrady.',
  page: 'Tej strony nie ma w pliku.',
  closed: 'Posiedzenie zostało zamknięte.',
  item: 'Plik dodasz do bieżącego punktu albo do punktu, który jeszcze czeka.',
  shown: 'Ten plik pokazano na posiedzeniu, więc zostaje w dokumentacji.',
} as const;
/** „Trwa głosowanie nr {n}. Pokaz wróci po jego zakończeniu.” (G-24); przy głosowaniu próbnym bez numeru. */
const showBlocked = (m: Meeting) => {
  const b = blockingBallot(m);
  return b ? `Trwa ${b.purpose === 'proba' ? 'głosowanie próbne' : `głosowanie nr ${b.number}`}. Pokaz wróci po jego zakończeniu.` : 'Posiedzenie nie trwa.';
};
/** Liczba stron pokazu: PDF ze sprawdzenia (bez niej 999), seria obrazów, obraz 1, materiał tekstowy do 999 (B3-21). */
function showPages(m: Meeting, source: 'plik' | 'material', id: string): number {
  if (source === 'material') return 999;
  const d = m.displays?.find(x => x.id === id);
  if (!d) return 0;
  if (d.kind === 'obrazy') return d.files.length;
  if (d.kind === 'obraz' || d.kind === 'wideo') return 1;
  return d.pages ?? 999;
}
/** Opis pliku we wpisie dziennika (B3-13): „PDF, 12 stron”, „obrazy, 8 slajdów”, „obraz”, „wideo”. */
function displayKindText(d: DisplayRef) {
  if (d.kind === 'pdf') return d.pages ? `PDF, ${d.pages} ${plural(d.pages, 'strona', 'strony', 'stron')}` : 'PDF';
  if (d.kind === 'obrazy') return `obrazy, ${d.files.length} ${plural(d.files.length, 'slajd', 'slajdy', 'slajdów')}`;
  return d.kind === 'obraz' ? 'obraz' : 'wideo';
}
const showTitle = (m: Meeting, s: NonNullable<Meeting['show']>) => s.source === 'plik' ? m.displays?.find(d => d.id === s.id)?.title ?? '' : m.materials.find(x => x.id === s.id)?.title ?? '';
/** Zakończenie pokazu z wpisem (B3-13): „Zakończono pokaz „{tytuł}” na stronie {k} z {n}.”, przy obrazach „na slajdzie”, przy wideo bez strony. */
function endShow(m: Meeting, ctx: Context, actor: Actor | null) {
  const s = m.show;
  if (!s) return;
  const d = s.source === 'plik' ? m.displays?.find(x => x.id === s.id) : undefined;
  const title = quoted(showTitle(m, s));
  const where = d?.kind === 'wideo' || d?.kind === 'obraz' ? '' : ` na ${d?.kind === 'obrazy' ? 'slajdzie' : 'stronie'} ${s.page}${d && d.pages ? ` z ${d.kind === 'obrazy' ? d.files.length : d.pages}` : ''}`;
  log(m, ctx, actor, `Zakończono pokaz ${title}${where}.`, {tag: 'pokaz', itemId: s.itemId ?? undefined, ...(d ? {displayId: d.id} : {})});
  m.show = null;
  if (m.presentation?.kind === 'pokaz') m.presentation = null;
}
/** Punkt, do którego w trakcie obrad można dodać plik do pokazania (G-25): bieżący albo jeszcze nierozpatrzony. */
const liveItemOk = (m: Meeting, itemId: string | null) => {
  if (!itemId) return false;
  const it = m.agenda.find(i => i.id === itemId);
  return !!it && (it.id === m.currentItemId || it.status === 'oczekuje' || it.status === 'w_toku');
};
const displayRefusal = (m: Meeting) => m.status === 'przygotowanie' ? 'Pliki do pokazania dodaje biuro, przewodniczący albo wiceprzewodniczący.' : 'W trakcie obrad plik do pokazania dodaje osoba prowadząca obrady albo biuro.';

export interface DisplayInput { title: string; itemId: string | null; kind: DisplayKind; files: DisplayFile[]; pages: number | null; description?: string; pdf?: DisplayFile }
/**
 * Plik do pokazania (B3-03, B3-17, G-25): funkcja woła serwer albo wersja próbna po sprawdzeniu i zapisie pliku (jak
 * `addMaterial`). W trakcie obrad plik trafia do bieżącego albo nierozpatrzonego punktu i dostaje znacznik „dodany
 * w trakcie obrad” z wpisem w dzienniku; po zamknięciu nic nie dochodzi.
 */
export function addDisplay(meeting: Meeting, input: DisplayInput, actor: Actor, ctx: Context): {meeting: Meeting; display: DisplayRef} {
  const m = structuredClone(meeting);
  ensure(m.status !== 'zakonczone', SHOW_REFUSALS.closed, 409);
  ensure(canAddDisplay(ctx.roster, m, actor), displayRefusal(m), 403);
  const live_ = live(m);
  if (input.itemId) ensure(m.agenda.some(i => i.id === input.itemId), 'Nie znaleziono punktu.', 404);
  if (live_) ensure(liveItemOk(m, input.itemId), SHOW_REFUSALS.item);
  ensure(input.files.length >= 1, 'Wybierz plik.');
  const title = (input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || input.files[0].name;
  const d: DisplayRef = {
    id: ctx.newId(), title, kind: input.kind, files: input.files, pages: input.pages, itemId: input.itemId ?? null,
    addedAt: ctx.now, addedBy: actor.name, accountId: actor.account.id,
  };
  const description = (input.description ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 2000);
  if (description) d.description = description;
  if (input.pdf) d.pdf = input.pdf;
  if (live_) {
    d.live = true;
    log(m, ctx, actor, `Dodano w trakcie obrad plik do pokazania ${quoted(title)} w punkcie ${itemNumber(m.agenda, d.itemId!)}.`, {tag: 'pokaz', itemId: d.itemId ?? undefined, displayId: d.id});
  }
  (m.displays ??= []).push(d);
  m.revision++;
  return {meeting: m, display: d};
}

const FILED_NAMES: Record<FiledKind, string> = {
  protokol_sporzadzony: 'protokół sporządzony', protokol_podpisany: 'protokół podpisany (skan)', zawiadomienie: 'zawiadomienie',
  akt_podpisany: 'akt podpisany (skan)', inny: 'dokument',
};
const filedRefusal = (m: Pick<Meeting, 'status'>, kind?: FiledKind) => m.status !== 'zakonczone' && kind !== 'zawiadomienie'
  ? {text: 'Ten dokument dołącza się po zamknięciu posiedzenia.', status: 409}
  : {text: 'Dokumenty po posiedzeniu dołącza biuro, przewodniczący albo sekretarz.', status: 403};
export interface FiledInput { kind: FiledKind; title?: string; fileId: string; fileName: string; mime: FiledDocument['mime']; size: number; sha256: string; ballotId?: string }
/**
 * Dokument dołączony po posiedzeniu (U-33, G-26, K4-7): plik niczego nie ustawia, a bez faktu „Protokół sporządzony”
 * karta pokazuje wiersz „Do sprawdzenia”. Nowy plik tego samego rodzaju zastępuje poprzedni (poza „Inny dokument”;
 * akt podpisany zastępuje tylko akt tego samego głosowania).
 */
export function addFiled(meeting: Meeting, input: FiledInput, actor: Actor, ctx: Context): Meeting {
  const m = structuredClone(meeting);
  ensure(['protokol_sporzadzony', 'protokol_podpisany', 'zawiadomienie', 'akt_podpisany', 'inny'].includes(input.kind), 'Wybierz rodzaj dokumentu.');
  if (m.status !== 'zakonczone' && input.kind !== 'zawiadomienie') fail(filedRefusal(m, input.kind).text, 409);
  if (!canFile(ctx.roster, m, actor, input.kind)) { const r = filedRefusal(m, input.kind); fail(r.text, r.status === 409 ? 409 : 403); }
  if (input.kind === 'akt_podpisany') ensure(input.ballotId && m.ballots.some(b => b.id === input.ballotId), 'Wybierz głosowanie, którego dotyczy akt.');
  const doc: FiledDocument = {
    id: ctx.newId(), kind: input.kind, title: (input.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || input.fileName,
    fileId: input.fileId, fileName: input.fileName.slice(0, 255), mime: input.mime, size: input.size, sha256: input.sha256,
    ...(input.ballotId ? {ballotId: input.ballotId} : {}), at: ctx.now, by: actor.name, accountId: actor.account.id,
  };
  if (input.kind !== 'inny') {
    for (const f of m.filed ?? []) {
      if (f.kind !== input.kind || f.replacedAt) continue;
      if (input.kind === 'akt_podpisany' && f.ballotId !== input.ballotId) continue;
      f.replacedAt = ctx.now;
    }
  }
  (m.filed ??= []).push(doc);
  settingLog(m, ctx, actor, `Dołączono ${FILED_NAMES[input.kind]} ${quoted(doc.fileName)}.`);
  m.revision++;
  return m;
}
export function removeFiled(meeting: Meeting, id: string, actor: Actor, ctx: Context): Meeting {
  const m = structuredClone(meeting);
  const doc = (m.filed ?? []).find(f => f.id === id) ?? fail('Nie znaleziono pliku.', 404);
  if (!canFile(ctx.roster, m, actor, doc.kind)) { const r = filedRefusal(m, doc.kind); fail(r.text, r.status); }
  m.filed = (m.filed ?? []).filter(f => f.id !== id);
  settingLog(m, ctx, actor, `Usunięto ${FILED_NAMES[doc.kind]} ${quoted(doc.fileName)}.`);
  m.revision++;
  return m;
}

/** Odnośnik do albumu zdjęć (G-23, DB-38): wspólna część polecenia `photos_set` i funkcji `setPhotos`. */
function photosChange(m: Meeting, ctx: Context, actor: Actor, url: string, confirm: boolean) {
  ensure(m.status !== 'przygotowanie', 'Odnośnik do zdjęć wpisuje się od otwarcia posiedzenia.', 409);
  ensure(canSetPhotos(ctx.roster, m, actor), 'Odnośnik do zdjęć wpisuje biuro, przewodniczący albo osoba prowadząca obrady.', 403);
  const check = photosUrlCheck(url);
  if (!check.ok) return fail(check.error);
  if (check.warning && !confirm) { const e = new DomainError(check.warning, 409); e.warning = check.warning; throw e; }
  const had = m.photos;
  if (!check.url) {
    if (!had) return false;
    delete m.photos;
    settingLog(m, ctx, actor, 'Usunięto odnośnik do zdjęć.');
    return true;
  }
  if (had?.url === check.url) return false;
  m.photos = {url: check.url, at: ctx.now, by: actor.name, accountId: actor.account.id};
  settingLog(m, ctx, actor, `${had ? 'Zmieniono' : 'Ustawiono'} odnośnik do zdjęć (${photosHost(check.url)}).`);
  return true;
}
/** Odnośnik do zdjęć od konta „Komunikacja” (po zamknięciu), które nie widzi posiedzenia przez `apply` (4.4). */
export function setPhotos(meeting: Meeting, url: string, actor: Actor, ctx: Context, confirm = false): Meeting {
  const m = structuredClone(meeting);
  if (photosChange(m, ctx, actor, url, confirm)) m.revision++;
  return m;
}
/** Propozycja „Dotyczy protokołu” dla punktu „Przyjęcie protokołu” i jego podpunktów (U-28, `proposeProtocolOf`). */
function guessProtocolOf(m: Meeting, ctx: Context, it: AgendaItem) {
  const parent = it.parentId ? m.agenda.find(i => i.id === it.parentId) : undefined;
  if (it.kind !== 'protokol' && parent?.kind !== 'protokol') return;
  if (it.protocolOf || !ctx.closedMeetings) return;
  const guess = proposeProtocolOf(ctx.closedMeetings, m, it.title);
  if (guess) it.protocolOfGuess = guess; else delete it.protocolOfGuess;
}
/** Dzień zamkniętego posiedzenia do wpisów „Dotyczy protokołu”. */
const closedLabel = (ctx: Context, id: string | null | undefined) => {
  const c = id ? ctx.closedMeetings?.find(x => x.id === id) : undefined;
  return c ? `${c.kind === 'procedura' ? 'głosowanie między posiedzeniami' : 'posiedzenie'} z dnia ${dateDots(c.day)}` : '';
};
/** Poziomy materiału dla komunikacji utrwalone przy zamknięciu (DB-41), liczone przed zmianą stanu posiedzenia. */
const fixComms = (m: Meeting, ctx: Context) => {
  m.closedComms = commsLevels({...m, status: 'trwa', closedComms: undefined}, envOf(ctx, m.organ));
  m.commsInputs = 0;
};

export function apply(meeting: Meeting, cmd: Command, actor: Actor, ctx: Context): Meeting {
  const m = structuredClone(meeting);
  const roster = ctx.roster;
  ensure(canView(roster, m, actor), 'Brak dostępu do tego posiedzenia.', 403);
  advance(m, ctx);
  const posiedzenie = m.kind === 'posiedzenie';
  const law = lawFor(ctx, m.organ);
  const prep = m.status === 'przygotowanie';
  const closed = m.status === 'zakonczone';

  switch (cmd.type) {
    case 'details': {
      if (prep) ensure(canPrepare(roster, m, actor), 'Dane posiedzenia zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
      else ensure(isOfficeAccount(actor) || isPresiding(m, actor) || isChairmanOf(roster, m, actor.personId), 'Po otwarciu dane do protokołu zmienia biuro, osoba prowadząca obrady albo przewodniczący.', 403);
      // Po otwarciu zmienia się już tylko odnośnik do połączenia i dane do protokołu (F10).
      const later = new Set(['type', 'link', 'protocolNumber', 'recorder', 'convener']);
      ensure(prep || Object.keys(cmd).every(k => later.has(k)), 'Po otwarciu można zmienić tylko odnośnik do połączenia i dane do protokołu.');
      // Wersja 3: każda zmiana pola trafia do dziennika (rozdz. 2.8 pkt 2), etykieta w bierniku.
      const note = (label: string, was: string, now: string) => {
        if (was === now) return;
        settingLog(m, ctx, actor, !was ? `Ustawiono ${label} ${now}.` : !now ? `Usunięto ${label}.` : `Zmieniono ${label} z ${was} na ${now}.`);
      };
      const q = (v: string | undefined) => v ? quoted(v) : '';
      if (cmd.title !== undefined) { ensure(cmd.title.trim(), 'Podaj tytuł.'); const was = m.title; m.title = cmd.title.trim().slice(0, 200); note('tytuł', q(was), q(m.title)); }
      if (cmd.date !== undefined) { ensure(/^\d{4}-\d{2}-\d{2}$/.test(cmd.date), 'Nieprawidłowa data.'); const was = m.date; m.date = cmd.date; note('datę posiedzenia', dateDots(was), dateDots(m.date)); }
      if (cmd.time !== undefined) { ensure(/^\d{2}:\d{2}$/.test(cmd.time), 'Nieprawidłowa godzina.'); const was = m.time; m.time = cmd.time; note('godzinę', was, m.time); }
      if (cmd.place !== undefined) { const was = m.place; m.place = cmd.place.trim().slice(0, 200); note('miejsce', q(was), q(m.place)); }
      if (cmd.mode !== undefined) {
        ensure(['stacjonarne', 'zdalne'].includes(cmd.mode), 'Nieprawidłowy tryb.');
        if (cmd.mode === 'zdalne' && !law.remote.allowed) fail(law.remote.reason);
        const was = m.mode; m.mode = cmd.mode; note('tryb', q(was), q(m.mode));
      }
      if (cmd.link !== undefined) {
        ensure(!cmd.link || /^https:\/\/\S+$/.test(cmd.link), 'Wpisz pełny odnośnik do połączenia, zaczynający się od https://.');
        const was = m.link; m.link = cmd.link.slice(0, 500); note('odnośnik do połączenia', was, m.link);
      }
      if (cmd.noticeDate !== undefined) {
        ensure(!cmd.noticeDate || /^\d{4}-\d{2}-\d{2}$/.test(cmd.noticeDate), 'Nieprawidłowa data zawiadomienia.');
        const was = m.noticeDate;
        m.noticeDate = cmd.noticeDate;
        // Wersja 3: punkty obecne w projekcie przy pierwszym wpisaniu daty zawiadomienia (rozdz. 2.4 pkt 4).
        if (!was && m.noticeDate) m.noticeItems = m.agenda.map(i => i.id);
        if (!m.noticeDate) delete m.noticeItems;
        note('datę wysłania zawiadomienia', dateDots(was), dateDots(m.noticeDate));
      }
      if (cmd.endsAt !== undefined) {
        ensure(m.kind === 'procedura', 'Koniec głosowania ustawia się w głosowaniu między posiedzeniami.');
        ensure(prep, 'Po rozpoczęciu termin zmienia osoba, która rozpoczęła głosowanie, albo przewodniczący.', 409);
        const hours = organSettingsOf(bundleOf(ctx).general, m.organ).procedureHours;
        const was = procedureEndAt(m, bundleOf(ctx).general, ctx.now);
        const wasText = was.fromStart ? `${hoursText(hours)} od rozpoczęcia` : dateTimeText(was.endsAt);
        if (cmd.endsAt === null || cmd.endsAt === 0) {
          // DA-21: powrót do terminu z ustawień ogólnych, liczonego od rozpoczęcia.
          if (!was.fromStart) {
            delete m.endsAt; delete m.endsAtSet;
            settingLog(m, ctx, actor, `Przywrócono koniec głosowania z ustawień ogólnych (${hoursText(hours)} od rozpoczęcia).`);
          }
        } else {
          const value = Math.round(Number(cmd.endsAt));
          ensure(Number.isFinite(value) && value > ctx.now, 'Ustaw koniec głosowania później niż teraz.');
          m.endsAt = value;
          m.endsAtSet = {at: ctx.now, by: actor.name, accountId: actor.account.id};
          note('koniec głosowania', wasText, dateTimeText(m.endsAt));
        }
      }
      if (cmd.protocolNumber !== undefined) { const was = m.protocolNumber ?? ''; m.protocolNumber = String(cmd.protocolNumber).replace(/\s+/g, ' ').trim().slice(0, 60) || undefined; note('numer protokołu', was, m.protocolNumber ?? ''); }
      if (cmd.recorder !== undefined) { const was = m.recorder ?? ''; m.recorder = String(cmd.recorder).replace(/\s+/g, ' ').trim().slice(0, 120) || undefined; note('protokolanta', was, m.recorder ?? ''); }
      if (cmd.convener !== undefined) {
        if (cmd.convener) {
          ensure(isMember(roster, m, cmd.convener), 'Zwołującego wybierz ze składu organu.');
          // G-15: przewodniczący albo zastępca wyznaczony na to posiedzenie (DA-23, pytanie 6).
          ensure(isChairmanOf(roster, m, cmd.convener) || (law.convener.deputyMay && deputyOf(roster, m) === cmd.convener),
            'Posiedzenia Prezydium zwołuje przewodniczący (§ 14 ust. 3) albo zastępca, którego przewodniczący wyznaczył na to posiedzenie (§ 16 ust. 2).');
        }
        const was = m.convener;
        m.convener = cmd.convener || undefined;
        note('zwołującego', was ? nameWithFunc(ctx, m, was) : '', m.convener ? nameWithFunc(ctx, m, m.convener) : '');
      }
      break;
    }
    case 'settings_set':
    case 'settings_reset': {
      ensure(canPrepare(roster, m, actor), 'Ustawienia posiedzenia zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
      ensure(prep, 'Ustawienia posiedzenia zapisano przy otwarciu.', 409);
      const key = cmd.key;
      const env = envOf(ctx, m.organ);
      if (key === 'messagesFromStart') {
        // U-12 (dodatek): kanał wiadomości na posiedzeniu stacjonarnym; przy zdalnym i między posiedzeniami działa zawsze.
        const was = meetingFlag(env, m, key).value;
        if (cmd.type === 'settings_set') {
          ensure(typeof cmd.value === 'boolean', 'Wybierz, kiedy kanał wiadomości jest widoczny.');
          (m.settings ??= {})[key] = cmd.value as boolean;
          (m.settingStamps ??= {})[key] = stampOf(ctx, actor);
          if (was !== cmd.value) settingLog(m, ctx, actor, `Zmieniono kanał wiadomości z ${quoted(messagesText(was))} na ${quoted(messagesText(cmd.value as boolean))}.`);
        } else {
          if (m.settings?.[key] === undefined) break;
          delete m.settings[key];
          if (m.settingStamps) delete m.settingStamps[key];
          const restored = meetingFlag(env, m, key);
          settingLog(m, ctx, actor, `Przywrócono kanał wiadomości z ${restored.source === 'szablon' ? 'wzoru posiedzenia' : 'ustawień ogólnych'} (${quoted(messagesText(restored.value))}).`);
        }
        break;
      }
      ensure(key === 'voteMinutes' || key === 'motionMinutes', 'Nieznane ustawienie posiedzenia.');
      const label = key === 'voteMinutes' ? 'czas głosowania w sprawie' : 'czas głosowań nad wnioskami';
      const was = meetingSetting(env, m, key).value;
      if (cmd.type === 'settings_set') {
        const value = Number(cmd.value);
        ensure((key === 'voteMinutes' ? VOTE_MINUTES : MOTION_MINUTES).includes(value), 'Wybierz czas z listy.');
        (m.settings ??= {})[key] = value;
        (m.settingStamps ??= {})[key] = stampOf(ctx, actor);
        if (was !== value) settingLog(m, ctx, actor, `Zmieniono ${label} z ${minutesText(was, 'dopelniacz')} na ${minutesText(value, 'biernik')}.`);
      } else {
        if (m.settings?.[key] === undefined) break;
        delete m.settings[key];
        if (m.settingStamps) delete m.settingStamps[key];
        const restored = meetingSetting(env, m, key);
        settingLog(m, ctx, actor, `Przywrócono ${label} z ${restored.source === 'szablon' ? 'wzoru posiedzenia' : 'ustawień ogólnych'} (${minutesText(restored.value)}).`);
      }
      break;
    }
    case 'deputy': {
      // D1: zastępcę wyznacza tylko przewodniczący, bez potwierdzenia przez kogokolwiek (§ 16 ust. 2).
      ensure(isChairmanOf(roster, m, actor.personId), 'Zastępcę wyznacza przewodniczący (§ 16 ust. 2).', 403);
      ensure(canDesignateDeputy(roster, m, actor), posiedzenie ? 'Zastępcę wyznacza się przed posiedzeniem lub w jego trakcie.' : 'Zastępcę na głosowanie między posiedzeniami wyznacza się przed jego rozpoczęciem.');
      if (cmd.personId) ensure(funcOf(roster, m, cmd.personId) === 'wiceprzewodniczacy', 'Zastępcą przewodniczącego może być wiceprzewodniczący (§ 16 ust. 2).');
      const had = m.chair.deputy;
      m.chair.deputy = cmd.personId || null;
      if (cmd.personId) {
        m.chair.deputyBasis = 'wyznaczenie przez przewodniczącego (§ 16 ust. 2)';
        m.chair.deputySet = {at: ctx.now, by: actor.name, accountId: actor.account.id};
        settingLog(m, ctx, actor, `Zastępstwo przewodniczącego ${nameWithFunc(ctx, m, cmd.personId)}, wyznaczenie przez przewodniczącego (§ 16 ust. 2).`);
      } else {
        m.chair.deputyBasis = '';
        delete m.chair.deputySet;
        if (had) settingLog(m, ctx, actor, 'Usunięto wyznaczenie zastępcy przewodniczącego.');
      }
      break;
    }
    case 'invite': {
      ensure(!closed, 'Posiedzenie jest zamknięte.');
      if (prep) ensure(canPrepare(roster, m, actor), 'Zaproszenia zaznacza biuro, przewodniczący albo wiceprzewodniczący.', 403);
      else ensure(isPresiding(m, actor), 'W trakcie obrad gościa dopuszcza osoba prowadząca obrady.', 403);
      const account = ctx.accounts?.find(a => a.id === cmd.accountId);
      const label = account?.displayName ?? cmd.accountId;
      if (account?.kind === 'doradczy') {
        // DA-5, G-14: osoby z głosem doradczym zawiadamia się o każdym posiedzeniu.
        ensure(cmd.on, 'Osoby z głosem doradczym zawiadamia się o każdym posiedzeniu (§ 7 ust. 2).');
        if (!m.invited.includes(cmd.accountId)) { m.invited.push(cmd.accountId); settingLog(m, ctx, actor, `Dodano osobę z głosem doradczym ${label} (§ 7 ust. 2).`); }
        break;
      }
      if (cmd.on) {
        ensure(cmd.invitedBy && law.guests.by.some(g => g.kind === cmd.invitedBy), `Wskaż, kto zaprasza gościa (${law.guests.basis}).`);
        const decision = reasonOf(cmd.decision);
        if (cmd.invitedBy === 'organ') ensure(decision, 'Wpisz, kiedy Prezydium zaprosiło gościa, np. datę posiedzenia albo numer uchwały.');
        m.invited = [...new Set([...m.invited, cmd.accountId])];
        (m.guestInvites ??= {})[cmd.accountId] = {by: cmd.invitedBy!, ...(cmd.invitedBy === 'organ' ? {decision} : {}), at: ctx.now, recordedBy: actor.name, accountId: actor.account.id};
        settingLog(m, ctx, actor, cmd.invitedBy === 'organ'
          ? `Dodano gościa ${label} na zaproszenie ${organWord(ctx, m.organ)}, ${decision} (${law.guests.basis}).`
          : `Dodano gościa ${label} na zaproszenie przewodniczącego (${law.guests.basis}).`);
      } else if (m.invited.includes(cmd.accountId)) {
        m.invited = m.invited.filter(id => id !== cmd.accountId);
        if (m.guestInvites) delete m.guestInvites[cmd.accountId];
        settingLog(m, ctx, actor, `Usunięto zaproszenie gościa ${label}.`);
      }
      break;
    }
    case 'item_add': {
      ensure(canEditAgenda(roster, m, actor), agendaRefusal(m), 403);
      requireDraftAnnounced(m);
      const added = applyAgendaChange(m, ctx, {op: 'dodaj', title: cmd.title, parentId: cmd.parentId ?? null, afterId: cmd.afterId ?? null}, false);
      guessCaseType(m, ctx, added);
      guessProtocolOf(m, ctx, added);
      draftLog(m, ctx, actor, `Dodano ${added.parentId ? 'podpunkt' : 'punkt'} ${itemNumber(m.agenda, added.id)} ${quoted(added.title)}.`, added.id);
      break;
    }
    case 'item_edit': {
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      const nr = () => itemNumber(m.agenda, it.id);
      const types = docTypesOf(ctx, m);
      // G-31 (B2-W14): zmiana nazwy punktu, którą ktoś zmienił w międzyczasie, nie nadpisuje cudzej zmiany.
      if (cmd.expect?.title !== undefined && cmd.expect.title !== it.title) fail('Ktoś zmienił nazwę punktu w międzyczasie. Sprawdź nową nazwę i zapisz ponownie.', 409);
      if (cmd.comms !== undefined) {
        // U-26, U-27, G-22: w przygotowaniu osoby przygotowujące, po zamknięciu biuro, przewodniczący i osoba, która
        // zamknęła obrady; poziom tylko zaostrza (wobec poziomu 1, a po zamknięciu wobec poziomu utrwalonego).
        ensure(prep || closed, 'Poziom w materiale dla komunikacji zmienia się w przygotowaniu albo po zamknięciu posiedzenia.', 409);
        ensure(canEditComms(roster, m, actor), closed ? 'Po zamknięciu poziom i zdanie dla komunikacji zmienia biuro, przewodniczący albo osoba, która zamknęła obrady.' : 'Ustawienia punktu zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
        const env = envOf(ctx, m.organ);
        const before = commsLevelOfItem(m, it, env);
        const beforeSentence = it.comms?.sentence ?? '';
        const next: NonNullable<AgendaItem['comms']> = {...(it.comms ?? {}), stamp: stampOf(ctx, actor)};
        if (cmd.comms.level !== undefined) {
          if (cmd.comms.level === null) delete next.level;
          else {
            ensure(isCommsLevel(cmd.comms.level), 'Wybierz poziom z listy.');
            if (!commsChoices(m, it, env).includes(cmd.comms.level)) {
              fail(closed ? 'Po zamknięciu poziom przy punkcie można tylko ograniczyć.' : `Przy tym rodzaju sprawy materiał może zawierać najwyżej „${commsLevelLabel[commsCeiling(m, it, env).level]}”.`);
            }
            next.level = cmd.comms.level;
          }
        }
        if (cmd.comms.sentence !== undefined) {
          const sentence = String(cmd.comms.sentence ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
          ensure(sentence.length <= 300, 'Zdanie dla komunikacji może mieć najwyżej 300 znaków.');
          if (sentence) next.sentence = sentence; else delete next.sentence;
        }
        const after = commsLevelOfItem(m, {...it, comms: next}, env);
        const changedLevel = before !== after || (next.level ?? null) !== (it.comms?.level ?? null);
        const changedSentence = (next.sentence ?? '') !== beforeSentence;
        if (changedLevel || changedSentence) {
          it.comms = next;
          if (changedSentence) settingLog(m, ctx, actor, next.sentence ? `Ustawiono zdanie dla komunikacji w punkcie ${nr()}.` : `Usunięto zdanie dla komunikacji w punkcie ${nr()}.`, it.id);
          if (before !== after) settingLog(m, ctx, actor, `Zmieniono poziom w materiale dla komunikacji w punkcie ${nr()} z ${quoted(commsLevelLabel[before])} na ${quoted(commsLevelLabel[after])}.`, it.id);
          // DB-42: każda zmiana treści wpisywanej przez ludzi po zamknięciu wymaga ponownego udostępnienia.
          if (closed) m.commsInputs = (m.commsInputs ?? 0) + 1;
        }
      }
      if (cmd.protocolOf !== undefined || cmd.protocolOfGuess === null) {
        // U-28, G-33: w przygotowaniu osoby przygotowujące, w trakcie obrad osoba prowadząca przed głosowaniem w punkcie.
        ensure(!closed, 'Po zamknięciu poprawkę wpisuje się w głosowaniu (przewodniczący).', 409);
        if (!canEditProtocolOf(roster, m, actor, it.id)) fail(prep ? 'Ustawienia punktu zmienia biuro, przewodniczący albo wiceprzewodniczący.' : 'W trakcie obrad zmienia to osoba prowadząca obrady, przed głosowaniem w tym punkcie.', 403);
        if (cmd.protocolOf !== undefined) {
          if (cmd.protocolOf) {
            ensure(protocolCandidates(ctx.closedMeetings ?? [], m).some(c => c.id === cmd.protocolOf), 'Wybierz zamknięte posiedzenie, którego protokół czeka na przyjęcie.');
            if (it.protocolOf !== cmd.protocolOf) {
              it.protocolOf = cmd.protocolOf;
              settingLog(m, ctx, actor, `Ustawiono, że punkt ${nr()} dotyczy protokołu ${closedLabel(ctx, cmd.protocolOf).replace(/^posiedzenie/, 'posiedzenia').replace(/^głosowanie/, 'głosowania')}.`, it.id);
            }
            delete it.protocolOfGuess;
          } else if (it.protocolOf) {
            delete it.protocolOf;
            settingLog(m, ctx, actor, `Usunięto, którego protokołu dotyczy punkt ${nr()}.`, it.id);
          }
        }
        if (cmd.protocolOfGuess === null && it.protocolOfGuess) {
          delete it.protocolOfGuess;
          settingLog(m, ctx, actor, `Odrzucono propozycję, którego protokołu dotyczy punkt ${nr()}.`, it.id);
        }
      }
      if (cmd.title !== undefined) {
        ensure(canEditAgenda(roster, m, actor), agendaRefusal(m), 403);
        ensure(cmd.title.trim(), 'Podaj nazwę punktu.');
        requireDraftAnnounced(m);
        const before = it.title;
        it.title = cmd.title.replace(/\s+/g, ' ').trim().slice(0, 400);
        if (it.title !== before) draftLog(m, ctx, actor, `Punkt ${nr()} ${quoted(before)} ma nową nazwę ${quoted(it.title)}.`, it.id);
      }
      const prepSetting = (label: string) => {
        ensure(prep, label === 'kind' ? 'Rodzaj punktu zmienia się w przygotowaniu posiedzenia.' : 'Ustawienia punktu zmienia się w przygotowaniu posiedzenia.', 409);
        ensure(canPrepare(roster, m, actor), 'Ustawienia punktu zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
      };
      if (cmd.kind !== undefined && cmd.kind !== it.kind) {
        // G-8: rodzaj punktu zmienia się tylko w przygotowaniu. Zmiana rodzaju wymienionego w regulaminie to pominięcie (G-7).
        prepSetting('kind');
        ensure(ITEM_KINDS.includes(cmd.kind), 'Wybierz rodzaj punktu.');
        if (posiedzenie && it.kind in law.agenda.listed && !law.agenda.mandatory.includes(it.kind) && m.agenda.filter(i => i.kind === it.kind).length === 1) skipListed(m, ctx, actor, it, cmd.reason, law);
        const was = it.kind;
        it.kind = cmd.kind;
        (it.stamps ??= {}).kind = stampOf(ctx, actor);
        dropRestoredSkips(m);
        settingLog(m, ctx, actor, `Zmieniono rodzaj punktu ${nr()} z ${quoted(itemKindLabel[was])} na ${quoted(itemKindLabel[it.kind])}.`, it.id);
      }
      if (cmd.caseType !== undefined) {
        prepSetting('caseType');
        const caseTypes = bundleOf(ctx).general.caseTypes;
        const was = caseTypes.find(c => c.id === it.caseType);
        if (cmd.caseType) {
          const c = caseTypes.find(x => x.id === cmd.caseType && x.organs.includes(m.organ));
          ensure(c, 'Nieznany rodzaj sprawy. Wybierz rodzaj z listy.');
          ensure(c.active || c.id === it.caseType, 'Ten rodzaj sprawy jest wyłączony. Wybierz inny rodzaj.');
          it.caseType = c.id;
          // Rodzaj sprawy uzupełnia puste pola punktu, a wypełnione zostają (rozdz. 2.4 pkt 5).
          if (!it.docType) it.docType = c.docType;
          if (!it.presenters.length && c.presenterFunc) {
            const ms = organRoster(roster, m).find(x => x.func === c.presenterFunc);
            if (ms) it.presenters = [{name: name(ctx, ms.personId), role: ms.label, kind: 'referuje', personId: ms.personId}];
          }
          delete it.caseTypeGuess;
          if (was?.id !== c.id) settingLog(m, ctx, actor, was ? `Zmieniono rodzaj sprawy w punkcie ${nr()} z ${quoted(was.name)} na ${quoted(c.name)}.` : `Ustawiono rodzaj sprawy w punkcie ${nr()} ${quoted(c.name)}.`, it.id);
        } else if (it.caseType) {
          delete it.caseType;
          settingLog(m, ctx, actor, `Usunięto rodzaj sprawy w punkcie ${nr()}.`, it.id);
        }
        (it.stamps ??= {}).caseType = stampOf(ctx, actor);
        requireVotedType(m, ctx, it, types, law);
      }
      if (cmd.caseTypeGuess === null && it.caseTypeGuess) {
        prepSetting('caseTypeGuess');
        delete it.caseTypeGuess;
        settingLog(m, ctx, actor, `Odrzucono propozycję rodzaju sprawy w punkcie ${nr()}.`, it.id);
      }
      if (cmd.voteMinutes !== undefined) {
        prepSetting('voteMinutes');
        const env = envOf(ctx, m.organ);
        const meetingValue = meetingSetting(env, m, 'voteMinutes').value;
        const was = it.voteMinutes ?? meetingValue;
        if (cmd.voteMinutes === null) {
          if (it.voteMinutes !== undefined) {
            delete it.voteMinutes;
            if (it.stamps) delete it.stamps.voteMinutes;
            settingLog(m, ctx, actor, `Przywrócono czas głosowania w punkcie ${nr()} z ustawień posiedzenia (${minutesText(meetingValue)}).`, it.id);
          }
        } else {
          const value = Number(cmd.voteMinutes);
          ensure(VOTE_MINUTES.includes(value), 'Wybierz czas z listy.');
          it.voteMinutes = value;
          (it.stamps ??= {}).voteMinutes = stampOf(ctx, actor);
          if (was !== value) settingLog(m, ctx, actor, `Zmieniono czas głosowania w punkcie ${nr()} z ${minutesText(was, 'dopelniacz')} na ${minutesText(value, 'biernik')}.`, it.id);
        }
      }
      if (cmd.docType !== undefined && (cmd.docType || undefined) !== it.docType) {
        const next = cmd.docType || undefined;
        ensure(!closed, 'Posiedzenie zostało zamknięte.');
        const type = next ? docTypeById(types, next) : undefined;
        ensure(!next || type, 'Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
        // F11: rodzaju wyłączonego nie wybiera się na nowo; już wybrany może zostać.
        ensure(!type || type.active, disabledDocType);
        const wasName = typeLabel(types, effectiveDocType(m, ctx, it));
        if (prep) {
          ensure(canPrepare(roster, m, actor), 'Ustawienia punktu zmienia biuro, przewodniczący albo wiceprzewodniczący.', 403);
          if (next) it.docType = next; else delete it.docType;
          (it.stamps ??= {}).docType = stampOf(ctx, actor);
          requireVotedType(m, ctx, it, types, law);
          settingLog(m, ctx, actor, `Zmieniono co jest głosowane w punkcie ${nr()} z ${quoted(wasName)} na ${quoted(typeLabel(types, effectiveDocType(m, ctx, it)))}.`, it.id);
        } else {
          // G-10, DA-8: w trakcie obrad tylko osoba prowadząca, zawsze z powodem do protokołu.
          ensure(isPresiding(m, actor), 'W trakcie obrad rodzaj sprawy zmienia osoba prowadząca obrady.', 403);
          const reason = reasonOf(cmd.reason);
          ensure(reason, 'Podaj powód zmiany rodzaju sprawy. Trafi do protokołu.');
          const guarded = votedSource(m, ctx, it, types);
          if (next) it.docType = next; else delete it.docType;
          (it.stamps ??= {}).docType = stampOf(ctx, actor, {live: true, reason});
          const why = quoted(reason.replace(/\.$/, ''));
          const nowType = effectiveDocType(m, ctx, it);
          log(m, ctx, actor, guarded && !docTypeById(types, nowType)?.voted
            ? `W punkcie ${nr()} sprawy nie poddano pod głosowanie. Powód ${why}.`
            : `W punkcie ${nr()} zmieniono rodzaj sprawy z ${quoted(wasName)} na ${quoted(typeLabel(types, nowType))}. Powód ${why}.`, {tag: 'odstepstwo', itemId: it.id});
        }
      }
      if (cmd.note !== undefined || cmd.presenters !== undefined) {
        const allowed = prep ? canPrepare(roster, m, actor)
          : isOfficeAccount(actor) || isPresiding(m, actor) || (closed && cmd.presenters === undefined && isChairmanOf(roster, m, actor.personId));
        ensure(allowed, 'Notatki do protokołu prowadzi osoba prowadząca obrady albo biuro.', 403);
        if (cmd.presenters !== undefined) {
          ensure(!closed, 'Posiedzenie zostało zamknięte.');
          const was = JSON.stringify(it.presenters);
          it.presenters = cleanPresenters(cmd.presenters, roster, m);
          if (JSON.stringify(it.presenters) !== was) settingLog(m, ctx, actor, `Zmieniono osoby przy punkcie ${nr()}.`, it.id);
        }
        if (cmd.note !== undefined) it.note = cmd.note.slice(0, 20000);
      }
      break;
    }
    case 'item_move': {
      ensure(canEditAgenda(roster, m, actor), agendaRefusal(m), 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      requireDraftAnnounced(m);
      const siblings = m.agenda.filter(i => i.parentId === it.parentId);
      const index = siblings.indexOf(it), other = siblings[index + cmd.direction];
      ensure(other, 'Punktu nie można przesunąć dalej.');
      const from = itemNumber(m.agenda, it.id);
      applyAgendaChange(m, ctx, {op: 'przesun', itemId: (cmd.direction < 0 ? it : other).id, beforeId: (cmd.direction < 0 ? other : it).id}, false);
      draftLog(m, ctx, actor, `Punkt ${quoted(it.title)} przeniesiono z pozycji ${from} na pozycję ${itemNumber(m.agenda, it.id)}.`, it.id);
      break;
    }
    case 'item_place': {
      ensure(canEditAgenda(roster, m, actor), agendaRefusal(m), 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      requireDraftAnnounced(m);
      const from = itemNumber(m.agenda, it.id);
      placeItem(m, it, cmd.parentId ?? null, cmd.beforeId ?? null);
      const to = itemNumber(m.agenda, it.id);
      if (to !== from) draftLog(m, ctx, actor, `Punkt ${quoted(it.title)} przeniesiono z pozycji ${from} na pozycję ${to}.`, it.id);
      break;
    }
    case 'item_remove': {
      ensure(canEditAgenda(roster, m, actor), agendaRefusal(m), 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      // G-6: punkt obowiązkowy nie znika z porządku żadną drogą.
      if (posiedzenie && law.agenda.mandatory.includes(it.kind) && m.agenda.filter(i => i.kind === it.kind).length === 1) {
        fail(`Punktu „${it.title}” nie można usunąć. To punkt obowiązkowy (${agendaBasis(law, it.kind) ?? law.agenda.listedBasis}).`);
      }
      requireDraftAnnounced(m);
      const number = itemNumber(m.agenda, it.id);
      if (posiedzenie && it.kind in law.agenda.listed && m.agenda.filter(i => i.kind === it.kind).length === 1) skipListed(m, ctx, actor, it, cmd.reason, law);
      applyAgendaChange(m, ctx, {op: 'usun', itemId: it.id}, false);
      draftLog(m, ctx, actor, `Usunięto ${it.parentId ? 'podpunkt' : 'punkt'} ${number} ${quoted(it.title)}.`, it.id);
      break;
    }
    case 'agenda_import': {
      ensure(canEditAgenda(roster, m, actor), 'Porządek wczytuje biuro, przewodniczący albo wiceprzewodniczący przed jego przyjęciem.', 403);
      requireDraftAnnounced(m);
      const parsed = parseAgendaText(cmd.text.slice(0, 100000), {flat: m.kind === 'procedura'});
      ensure(parsed.items.length, parsed.warnings[0] ?? 'Brak punktów.');
      const replace = !!cmd.replace;
      if (replace) {
        ensure(prep, 'Po otwarciu posiedzenia porządek można tylko uzupełniać.');
        ensure(!m.ballots.length && m.agenda.every(i => i.status === 'oczekuje' || i.kind === 'otwarcie'), 'Po rozpoczęciu obrad nie można zastąpić porządku. Dodawaj punkty pojedynczo.');
        m.agenda = [];
      }
      // Punkt „Przyjęcie porządku obrad” dodany przez rozpoznawanie tekstu (parseAgendaText) to uzupełnienie z regulaminu.
      const autoAgendaPoint = posiedzenie && (parsed.warnings.some(w => w.startsWith('Dodano punkt „Przyjęcie porządku obrad”')));
      const ids: (string | null)[] = [];
      let auto: AgendaItem | undefined;
      for (const p of parsed.items) {
        let kind: ItemKind = posiedzenie ? p.kind : 'sprawa';
        // Dopisywanie do istniejącego porządku: punkt obowiązkowy, który już jest, zostaje zwykłą sprawą (G-6),
        // a przyjęcie porządku dodane przez rozpoznawanie tekstu nie powtarza się.
        if (posiedzenie && law.agenda.mandatory.includes(kind) && m.agenda.some(i => i.kind === kind)) {
          if (kind === 'porzadek' && autoAgendaPoint && p.parent === null && p.title === 'Przyjęcie porządku obrad') { ids.push(null); continue; }
          kind = 'sprawa';
        }
        const parent = p.parent === null ? null : ids[p.parent] ?? null;
        const it = newItem(ctx.newId(), p.title, kind, parent);
        if (autoAgendaPoint && kind === 'porzadek' && p.title === 'Przyjęcie porządku obrad' && !auto) auto = it;
        ids.push(it.id);
        m.agenda.push(it);
        guessCaseType(m, ctx, it);
        guessProtocolOf(m, ctx, it);
      }
      const count = `${parsed.items.length} ${plural(parsed.items.length, 'pozycja', 'pozycje', 'pozycji')}`;
      if (prep) log(m, ctx, actor, `Wczytano porządek obrad (${count}).`, {tag: 'projekt'});
      else draftLog(m, ctx, actor, `Wczytano punkty z tekstu (${count}).`);
      // G-6, N-4: brakujące punkty obowiązkowe i wymienione w regulaminie domena uzupełnia na ich zwykłych miejscach.
      const added = completeAgenda(law, m, ctx.newId, titlesFor(ctx, m));
      for (const it of auto ? [auto, ...added] : added) {
        log(m, ctx, actor, `Uzupełniono projekt porządku obrad o punkt ${quoted(it.title)} wymagany regulaminem (${agendaBasis(law, it.kind)}).`, {tag: 'projekt', itemId: it.id});
      }
      dropRestoredSkips(m);
      break;
    }
    case 'item_material': {
      ensure(!closed, 'Posiedzenie zostało zamknięte.');
      ensure(prep ? canPrepare(roster, m, actor) : isOfficeAccount(actor) || isPresiding(m, actor), 'Materiały przypisuje biuro albo osoba prowadząca obrady.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      const ref = m.materials.find(x => x.id === cmd.materialId) ?? fail('Nie znaleziono materiału.', 404);
      // G-11: materiału, nad którym trwa głosowanie, nie przypisuje się ani nie odłącza.
      ensure(!openBallots(m).some(b => b.material?.id === cmd.materialId), 'Trwa głosowanie nad tym materiałem.');
      const had = it.materialIds.includes(cmd.materialId);
      it.materialIds = cmd.on ? [...new Set([...it.materialIds, cmd.materialId])] : it.materialIds.filter(id => id !== cmd.materialId);
      if (had !== cmd.on) settingLog(m, ctx, actor, cmd.on ? `Dołączono materiał ${quoted(ref.title)} do punktu ${itemNumber(m.agenda, it.id)}.` : `Odłączono materiał ${quoted(ref.title)} od punktu ${itemNumber(m.agenda, it.id)}.`, it.id);
      break;
    }
    case 'item_mode': {
      ensure(m.kind === 'procedura' && prep && canPrepare(roster, m, actor), 'Tryb głosowania ustala się przed rozpoczęciem głosowania między posiedzeniami.', 403);
      const it = item(m, cmd.itemId) ?? fail('Nie znaleziono punktu.', 404);
      ensure(['jawne', 'imienne', 'tajne'].includes(cmd.mode), 'Nieprawidłowy tryb głosowania.');
      const nr = itemNumber(m.agenda, it.id);
      if (cmd.mode === 'jawne') {
        const had = !!it.mode;
        delete it.mode; delete it.modeBasis; delete it.modeAct;
        if (had) settingLog(m, ctx, actor, `Ustawiono głosowanie jawne w sprawie ${nr}.`, it.id);
        break;
      }
      // G-13: tajność albo głosowanie imienne tylko z danymi uchwały albo głosowania, które je ustaliło.
      const decision = modeDecisionOf(cmd.decision) ?? fail(`Wpisz, kiedy ${organWord(ctx, m.organ)} uchwaliło tajność albo głosowanie imienne. Podaj numer uchwały albo głosowania i datę.`);
      const organ = organWord(ctx, m.organ);
      it.mode = cmd.mode;
      it.modeAct = decision;
      it.modeBasis = decision.kind === 'uchwala' ? `uchwała ${organ} nr ${decision.number} z dnia ${dateDots(decision.date)}` : `głosowanie nr ${decision.number} na posiedzeniu ${organ} z dnia ${dateDots(decision.date)}`;
      settingLog(m, ctx, actor, decision.kind === 'uchwala'
        ? `Ustawiono głosowanie ${cmd.mode} w sprawie ${nr} na podstawie uchwały ${organ} nr ${decision.number} z dnia ${dateDots(decision.date)} (§ 11 ust. 2).`
        : `Ustawiono głosowanie ${cmd.mode} w sprawie ${nr} na podstawie głosowania nr ${decision.number} na posiedzeniu ${organ} z dnia ${dateDots(decision.date)} (§ 11 ust. 2).`, it.id);
      break;
    }
    case 'open': {
      ensure(prep, 'To posiedzenie zostało już otwarte.');
      const reason = reasonOf(cmd.reason);
      if (posiedzenie) {
        // DA-17: przewodniczący, wyznaczony zastępca, a bez wyznaczenia każdy wiceprzewodniczący; inny wiceprzewodniczący
        // przy wyznaczonym zastępcy tylko z powodem. Obecność otwierającego zapisuje się z otwarciem, bez biura (D1).
        const opt = openOption(roster, m, actor);
        if (!opt.allowed) throw new DomainError(opt.reason, 403);
        if (opt.needsReason) ensure(reason, insteadOfDeputyText(roster, m, 'otwarcie'));
        m.frozen = freeze(envOf(ctx, m.organ), m, ctx.now);
        m.status = 'trwa';
        m.openedAt = ctx.now;
        m.chair.current = actor.personId;
        m.chair.changes.push({at: ctx.now, from: null, to: actor.personId!, by: actor.name, reason: 'otwarcie posiedzenia', basis: opt.basis, opening: true, accountId: actor.account.id, ...(opt.needsReason ? {reasonGiven: reason} : {})});
        const reported = m.attendance[actor.personId!] === 'zgloszony' ? reportTime(m, actor.personId!, false) : undefined;
        setPresence(m, ctx, actor, actor.personId!, false, true, reported, 'otwarcie');
        const first = m.agenda.find(i => !i.parentId);
        if (first) { first.status = 'w_toku'; first.startedAt = ctx.now; m.currentItemId = first.id; m.presentation = {kind: 'punkt', id: first.id, at: ctx.now}; }
        const days = noticeDays(m);
        log(m, ctx, actor, `Otwarcie posiedzenia. Prowadzi ${actor.name}.`);
        if (opt.needsReason) log(m, ctx, actor, `Posiedzenie otwiera ${nameWithFunc(ctx, m, actor.personId)}, zamiast wyznaczonego zastępcy. Powód ${quoted(reason.replace(/\.$/, ''))}.`);
        if (days === null) log(m, ctx, null, `Nie wpisano daty wysłania zawiadomienia (${law.notice.basis}).`);
        else if (days < law.notice.minDays) log(m, ctx, null, `Zawiadomienie wysłano ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, a regulamin wymaga co najmniej ${law.notice.minDays} dni (${law.notice.basis}).`);
      } else {
        // DA-12, G-18: rozpoczyna przewodniczący albo zastępca wyznaczony na to głosowanie.
        ensure(canStartProcedure(roster, m, actor), 'Głosowanie między posiedzeniami rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie (§ 16 ust. 2).', 403);
        const acts = m.agenda.filter(i => !i.parentId);
        ensure(acts.length, 'Dodaj co najmniej jedną sprawę do głosowania.');
        // DA-21: bez terminu wpisanego ręcznie głosowanie trwa czas z ustawień ogólnych liczony od rozpoczęcia.
        const term = procedureEndAt(m, bundleOf(ctx).general, ctx.now);
        if (term.fromStart) m.endsAt = term.endsAt;
        ensure(m.endsAt && m.endsAt > ctx.now + 5 * 60000, 'Ustaw koniec głosowania co najmniej 5 minut od teraz.');
        // DA-21: krótszy termin niż 24 godziny tylko z powodem, który trafia do dokumentu z przebiegu.
        if (m.endsAt - ctx.now < PROCEDURE_MIN_HOURS * 3600000) {
          ensure(reason, `Głosowanie potrwa krócej niż ${hoursText(PROCEDURE_MIN_HOURS)}. Podaj powód. Trafi do dokumentu z przebiegu głosowania.`);
          m.shortTerm = {reason, at: ctx.now, by: actor.name, accountId: actor.account.id};
        }
        m.frozen = freeze(envOf(ctx, m.organ), m, ctx.now);
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
        if (m.shortTerm) log(m, ctx, actor, `Głosowanie potrwa krócej niż ${hoursText(PROCEDURE_MIN_HOURS)}. Powód ${quoted(reason.replace(/\.$/, ''))}.`);
        // DA-21: informacja w kanale z przedmiotem (tytuły spraw w kolejności) i terminem.
        const titles = acts.map(a => quoted(a.title.replace(/\.$/, '')));
        const subject = titles.length === 1 ? `w sprawie ${titles[0]}`
          : `w ${acts.length} sprawach, ${titles.slice(0, -1).join(', ')} i ${titles[titles.length - 1]}`;
        m.messages.push({id: ctx.newId(), author: actor.account.id, authorName: actor.name, at: ctx.now,
          text: `Rozpoczęto głosowanie między posiedzeniami ${subject}. Głosowanie potrwa do ${dateTimeText(m.endsAt)}.`});
      }
      break;
    }
    case 'presence': {
      ensure(posiedzenie, 'W głosowaniu między posiedzeniami nie prowadzi się listy obecności.');
      ensure(!closed, 'Posiedzenie zostało zamknięte.');
      const guest = !!cmd.guest;
      const self = guest ? actor.account.id === cmd.who : actor.personId === cmd.who;
      const state = (guest ? m.guests : m.attendance)[cmd.who] ?? 'nieobecny';
      if (!self) {
        // DA-19: cudzą obecność zapisuje osoba prowadząca obrady albo biuro (biuro bez odrzucania zgłoszeń, bez osoby
        // prowadzącej i bez wyjścia osoby uprawnionej w trakcie otwartego głosowania).
        const action = !cmd.present && state === 'zgloszony' ? 'odrzuc' : cmd.present ? 'przybycie' : 'wyjscie';
        ensure(canKeepAttendance(m, actor, cmd.who, action), attendanceRefusal(m, actor, cmd.who, action), 403);
      }
      if (guest) ensure(m.invited.includes(cmd.who), 'Ta osoba nie jest zaproszona.');
      else ensure(isMember(roster, m, cmd.who), 'Ta osoba nie jest członkiem organu.');
      if (!cmd.present && state === 'zgloszony') dropReport(m, ctx, actor, cmd.who, guest);
      // F9: na posiedzeniu stacjonarnym osoba zgłasza obecność, a potwierdza ją osoba prowadząca obrady albo biuro.
      else if (cmd.present && self && m.mode === 'stacjonarne' && !confirmsPresence(m, actor)) reportPresence(m, ctx, actor, cmd.who, guest);
      else setPresence(m, ctx, actor, cmd.who, guest, cmd.present, state === 'zgloszony' ? reportTime(m, cmd.who, guest) : undefined);
      break;
    }
    case 'presence_confirm': {
      ensure(posiedzenie && !closed, 'Obecność potwierdza się na posiedzeniu.');
      const action = cmd.accept ? 'potwierdz' : 'odrzuc';
      ensure(canKeepAttendance(m, actor, cmd.who, action), attendanceRefusal(m, actor, cmd.who, action), 403);
      const guest = !!cmd.guest;
      ensure(((guest ? m.guests : m.attendance)[cmd.who] ?? 'nieobecny') === 'zgloszony', 'Ta osoba nie zgłosiła obecności albo zgłoszenie już rozpatrzono.', 409);
      if (cmd.accept) setPresence(m, ctx, actor, cmd.who, guest, true, reportTime(m, cmd.who, guest));
      else dropReport(m, ctx, actor, cmd.who, guest);
      break;
    }
    case 'presence_confirm_all': {
      ensure(posiedzenie && !closed, 'Obecność potwierdza się na posiedzeniu.');
      ensure(confirmsPresence(m, actor), 'Obecność potwierdza osoba prowadząca obrady albo biuro.', 403);
      const pending = pendingPresence(m).filter(p => isPresiding(m, actor) || p.guest || p.who !== m.chair.current);
      ensure(pending.length, 'Nie ma zgłoszeń obecności do potwierdzenia.', 409);
      for (const p of pending) setPresence(m, ctx, actor, p.who, p.guest, true, p.at || undefined);
      break;
    }
    case 'quorum': {
      requireLive(m); requireChair(m, actor);
      const total = memberIdsOf(m, roster).length, present = presentMembers(m, roster).length;
      const required = quorumOf(law, quorumTotal(total, organSettingsOf(bundleOf(ctx).general, m.organ).seats?.count ?? null));
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
      // Wersja 4 (5.1, B3-13): przejście do innego punktu kończy pokaz z wpisem.
      if (m.show && m.show.itemId !== it.id) endShow(m, ctx, actor);
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
      if (cmd.kind === 'pokaz') {
        // G-24: powrót do pokazu (B3-11) tylko poza głosowaniem i tylko do trwającego pokazu.
        ensure(canShowNow(m), showBlocked(m), 409);
        ensure(m.show && cmd.id === m.show.id, 'Pokaz nie trwa.', 409);
        m.presentation = {kind: 'pokaz', id: m.show.id, at: ctx.now};
        break;
      }
      ensure(['punkt', 'material', 'glosowanie', 'wynik', 'projekt'].includes(cmd.kind) && cmd.id, 'Nieprawidłowa prezentacja.');
      if (cmd.kind === 'punkt') ensure(item(m, cmd.id), 'Nie znaleziono punktu.', 404);
      if (cmd.kind === 'material') ensure(m.materials.some(x => x.id === cmd.id), 'Nie znaleziono materiału.', 404);
      if (cmd.kind === 'glosowanie' || cmd.kind === 'wynik') ballot(m, cmd.id!);
      // D2: projekt porządku obrad w trybie zmian na ekranie sali; `id` to identyfikator posiedzenia.
      if (cmd.kind === 'projekt') {
        ensure(cmd.id === m.id, 'Nieprawidłowa prezentacja.');
        ensure(posiedzenie && !m.agendaAdopted, 'Projekt porządku obrad pokazuje się przed przyjęciem porządku.');
      }
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
      const env = envOf(ctx, m.organ);
      const setting = it || cmd.purpose === 'porzadek' ? {minutes: itemVoteMinutes(env, m, it), of: 'punkt' as const} : undefined;
      const opened = openBallot(m, ctx, actor, {itemId: cmd.itemId, purpose: cmd.purpose, subject: cmd.subject, mode: cmd.mode, minutes: cmd.minutes, materialId: cmd.materialId, docType: cmd.docType, setting});
      // DB-5, K4-4: „Dotyczy protokołu” utrwala się w głosowaniu przy jego otwarciu (punkt albo jego punkt główny).
      if (cmd.purpose === 'protokol') {
        const parent = it?.parentId ? item(m, it.parentId) : undefined;
        const of = it?.protocolOf ?? parent?.protocolOf;
        if (of) opened.protocolOf = of;
      }
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
      if (b.remote) ensure(canManageProcedure(roster, m, actor), procedureManagerRefusal, 403);
      else ensure(m.chair.current === actor.personId, 'Głosowanie kończy osoba prowadząca obrady.', 403);
      closeBallot(m, ctx, b, 'prowadzacy', actor);
      break;
    }
    case 'announce': {
      const b = ballot(m, cmd.ballotId);
      ensure(b.status === 'zamkniete', 'Wynik można ogłosić po zakończeniu głosowania.');
      // DA-3, DA-12: wynik ogłasza osoba prowadząca obrady, a w głosowaniu między posiedzeniami zarządzający albo przewodniczący.
      if (posiedzenie) { requireLive(m); ensure(isPresiding(m, actor), 'Wynik ogłasza osoba prowadząca obrady.', 403); }
      else ensure(canManageProcedure(roster, m, actor), 'Wynik ogłasza osoba, która rozpoczęła głosowanie, albo przewodniczący.', 403);
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
      // G-6: punktu obowiązkowego nie usuwa także głosowanie nad zmianą porządku.
      if (cmd.change.op === 'usun') {
        const target = item(m, cmd.change.itemId)!;
        if (law.agenda.mandatory.includes(target.kind) && m.agenda.filter(i => i.kind === target.kind).length === 1) fail(`Punktu „${target.title}” nie można usunąć. To punkt obowiązkowy (${agendaBasis(law, target.kind) ?? law.agenda.listedBasis}).`);
      }
      openBallot(m, ctx, actor, {itemId: null, purpose: 'zmiana_porzadku', subject, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'zmiana_porzadku', change: cmd.change}, setting: motionSetting(ctx, m)});
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
      openBallot(m, ctx, actor, {itemId: null, purpose: 'tryb', subject: `Wniosek o przeprowadzenie ${what}`, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'tryb', itemId: it.id, mode: cmd.mode, proposedBy: cmd.proposedBy}, setting: motionSetting(ctx, m)});
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
      const b = openBallot(m, ctx, actor, {itemId: original.itemId, purpose: 'reasumpcja', subject: `Wniosek o reasumpcję głosowania nr ${original.number} ${quoted(original.subject)}`, mode: 'jawne', minutes: cmd.minutes, target: {kind: 'reasumpcja', ballotId: original.id, motionId: motion.id}, setting: motionSetting(ctx, m)});
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
      ensure(canChairPerson(roster, m, cmd.personId), 'Obradom przewodniczy przewodniczący lub wiceprzewodniczący (§ 9 ust. 1).');
      // Wersja 3: przekazanie osobie ze zgłoszoną obecnością jest zarazem potwierdzeniem jej obecności (rozdz. 4.5 pkt 4).
      const state = m.attendance[cmd.personId] ?? 'nieobecny';
      ensure(state === 'obecny' || state === 'zgloszony', 'Prowadzenie można przekazać osobie obecnej.');
      ensure(cmd.personId !== actor.personId, 'Prowadzisz już posiedzenie.');
      if (state === 'zgloszony') setPresence(m, ctx, actor, cmd.personId, false, true, reportTime(m, cmd.personId, false), 'prowadzenie');
      m.chair.changes.push({at: ctx.now, from: m.chair.current, to: cmd.personId, by: actor.name, reason: chairReason('przekazanie', ''), basis: 'przekazanie', accountId: actor.account.id});
      m.chair.current = cmd.personId;
      log(m, ctx, actor, `Prowadzenie obrad przejmuje ${name(ctx, cmd.personId)}.`);
      break;
    }
    case 'chair_take': {
      requireLive(m);
      // D1, DA-17: kolejność do prowadzenia, bez potwierdzenia obecności i bez biura; obecność zapisuje się z przejęciem.
      const opt = takeChairOption(roster, m, actor, {chairLeft: !!cmd.chairLeft});
      if (!opt.allowed) throw new DomainError(opt.reason, 403);
      const reason = reasonOf(cmd.reason);
      if (opt.needsReason) ensure(reason, insteadOfDeputyText(roster, m, 'przejecie'));
      const from = m.chair.current;
      if (opt.recordsExit && from) {
        setPresence(m, ctx, actor, from, false, false, undefined, 'przejmujacy');
        log(m, ctx, actor, `Zapisano wyjście osoby prowadzącej obrady, ${nameWithFunc(ctx, m, from)}. Wyjście zapisała osoba, która przejmuje prowadzenie.`);
      }
      const me = actor.personId!;
      const state = m.attendance[me] ?? 'nieobecny';
      const recorded = setPresence(m, ctx, actor, me, false, true, state === 'zgloszony' ? reportTime(m, me, false) : undefined, 'prowadzenie');
      m.chair.changes.push({
        at: ctx.now, from, to: me, by: actor.name, reason: chairReason(opt.basis, reason), basis: opt.basis, accountId: actor.account.id,
        ...(opt.recordsExit ? {recordedExit: true as const} : {}), ...(opt.needsReason ? {reasonGiven: reason} : {}),
      });
      m.chair.current = me;
      const presence = recorded ? ' Obecność zapisano przy przejęciu.' : '';
      const who = nameWithFunc(ctx, m, me);
      log(m, ctx, actor, opt.basis === 'zastepca' ? `Prowadzenie obrad przejmuje ${who}, zastępca wyznaczony przez przewodniczącego (§ 16 ust. 2).${presence}`
        : opt.basis === 'zamiast_zastepcy' ? `Prowadzenie obrad przejmuje ${who}, zamiast wyznaczonego zastępcy. Powód ${quoted(reason.replace(/\.$/, ''))}.${presence}`
        : opt.basis === 'powrot' ? `Prowadzenie obrad ponownie przejmuje ${who}. Wcześniejsze wyjście tej osoby zapisano przy przejęciu prowadzenia.`
        : `Prowadzenie obrad przejmuje ${actor.name}.${presence}`);
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
      if (posiedzenie) ensure(m.chair.current === actor.personId, 'Posiedzenie zamyka osoba prowadząca obrady.', 403);
      else ensure(canManageProcedure(roster, m, actor), procedureManagerRefusal, 403);
      if (!posiedzenie) { endProcedure(m, ctx, actor, 'policz', ''); break; }
      ensure(!regularOpen(m).length, 'Trwa głosowanie. Posiedzenie można zamknąć po jego zakończeniu.');
      requireAnnounced(m);
      // F4: zamknięcie z nierozpatrzonymi punktami wymaga powodu, który trafia do każdego z nich.
      const left = unhandledItems(m, docTypesOf(ctx, m));
      const reason = reasonOf(cmd.reason);
      if (left.length) {
        ensure(reason, 'Podaj powód zamknięcia posiedzenia przed rozpatrzeniem wszystkich punktów.');
        for (const it of left) it.statusReason = reason;
      }
      for (const b of openBallots(m)) closeBallot(m, ctx, b, 'prowadzacy');
      // Wersja 4: zamknięcie kończy pokaz z wpisem (B3-13) i utrwala poziomy materiału dla komunikacji (DB-41).
      endShow(m, ctx, actor);
      for (const it of m.agenda) if (it.status === 'w_toku') { it.status = 'zakonczony'; it.endedAt = ctx.now; }
      fixComms(m, ctx);
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
      ensure(canManageProcedure(roster, m, actor), procedureManagerRefusal, 403);
      ensure(cmd.how === 'policz' || cmd.how === 'przerwij', 'Wybierz, czy zakończyć głosowanie z policzeniem głosów, czy przerwać je bez rozstrzygnięcia.');
      const reason = reasonOf(cmd.reason);
      if (cmd.how === 'przerwij') ensure(reason, 'Podaj powód przerwania głosowania.');
      endProcedure(m, ctx, actor, cmd.how, reason);
      break;
    }
    case 'procedure_deadline': {
      ensure(!posiedzenie, 'Termin zmienia się w głosowaniu między posiedzeniami.');
      ensure(m.status === 'trwa', m.status === 'przygotowanie' ? 'Przed rozpoczęciem termin ustawia się w danych głosowania.' : 'Głosowanie między posiedzeniami jest już zakończone.');
      ensure(canManageProcedure(roster, m, actor), procedureManagerRefusal, 403);
      const endsAt = Math.round(Number(cmd.endsAt));
      ensure(Number.isFinite(endsAt) && endsAt >= ctx.now + 5 * 60000, 'Ustaw nowy termin co najmniej 5 minut od teraz.');
      ensure(endsAt !== m.endsAt, 'To jest obecny termin głosowania.');
      // DA-21, G-18: termin krótszy niż 24 godziny od rozpoczęcia wymaga powodu do dokumentu z przebiegu.
      const reason = reasonOf(cmd.reason);
      if (endsAt - (m.openedAt ?? ctx.now) < PROCEDURE_MIN_HOURS * 3600000) {
        ensure(reason, `Głosowanie potrwa krócej niż ${hoursText(PROCEDURE_MIN_HOURS)}. Podaj powód. Trafi do dokumentu z przebiegu głosowania.`);
        m.shortTerm = {reason, at: ctx.now, by: actor.name, accountId: actor.account.id};
      }
      const from = m.endsAt ?? ctx.now;
      m.endsAt = endsAt;
      for (const b of openBallots(m)) b.endsAt = endsAt;
      (m.deadlineChanges ??= []).push({at: ctx.now, from, to: endsAt, by: actor.name});
      log(m, ctx, actor, `Termin głosowania zmieniono z ${dateTimeText(from)} na ${dateTimeText(endsAt)}.${reason ? ` Powód ${quoted(reason.replace(/\.$/, ''))}.` : ''}`);
      m.messages.push({id: ctx.newId(), author: actor.account.id, authorName: actor.name, text: `Termin głosowania zmieniono na ${dateTimeText(endsAt)}.`, at: ctx.now});
      break;
    }
    case 'message': {
      ensure(m.status !== 'zakonczone', 'Posiedzenie zostało zamknięte.');
      // G-28 (B2-W20): kanał wiadomości działa od otwarcia posiedzenia albo rozpoczęcia głosowania między posiedzeniami.
      ensure(m.status !== 'przygotowanie', 'Przed rozpoczęciem pisz w uwagach przygotowania. Kanał wiadomości działa od otwarcia posiedzenia.', 409);
      // DA-20, G-17: gość czyta kanał wiadomości, ale w nim nie pisze.
      ensure(canMessage(m, actor), 'Goście czytają wiadomości, ale ich nie piszą.', 403);
      const text = cmd.text.trim();
      ensure(text.length >= 1 && text.length <= 1000, 'Wiadomość może mieć od 1 do 1000 znaków.');
      m.messages.push({id: ctx.newId(), author: actor.account.id, authorName: actor.name, text, at: ctx.now});
      if (m.messages.length > 2000) m.messages.splice(0, m.messages.length - 2000);
      break;
    }
    case 'comms_note': {
      // U-49, G-39, DB-43: fakt po zamknięciu, zwykły tekst do 1500 znaków, z podpisem.
      ensure(closed, 'Opis dla komunikacji wpisuje się po zamknięciu posiedzenia.', 409);
      ensure(canEditComms(roster, m, actor), 'Opis dla komunikacji wpisuje biuro, przewodniczący albo osoba, która zamknęła obrady.', 403);
      const text = String(cmd.text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').trim();
      ensure(text.length <= 1500, 'Opis może mieć najwyżej 1500 znaków.');
      if (text === (m.commsNote?.text ?? '')) break;
      if (text) { m.commsNote = {text, at: ctx.now, by: actor.name, accountId: actor.account.id}; settingLog(m, ctx, actor, 'Zapisano opis dla komunikacji.'); }
      else { delete m.commsNote; settingLog(m, ctx, actor, 'Usunięto opis dla komunikacji.'); }
      m.commsInputs = (m.commsInputs ?? 0) + 1;
      break;
    }
    case 'comms_release': {
      // U-48, DB-42, G-39: udostępnienie kontu „Komunikacja”; nieważne po zmianie treści wpisywanej przez ludzi.
      ensure(closed, 'Materiał dla komunikacji udostępnia się po zamknięciu posiedzenia.', 409);
      ensure(canReleaseComms(roster, m, actor), 'Materiał udostępnia biuro, przewodniczący albo osoba, która zamknęła obrady.', 403);
      const again = !!m.commsReleased;
      m.commsReleased = {at: ctx.now, by: actor.name, accountId: actor.account.id, inputs: m.commsInputs ?? 0};
      settingLog(m, ctx, actor, again ? 'Ponownie udostępniono materiał dla komunikacji.' : 'Udostępniono materiał dla komunikacji.');
      break;
    }
    case 'ballot_protocol_fix': {
      // G-38, K4-4: po zamknięciu tylko przewodniczący i tylko przy pustym albo sprzecznym polu, z powodem do dziennika.
      ensure(closed, 'Poprawkę wpisuje się po zamknięciu posiedzenia.', 409);
      ensure(canFixProtocolOf(roster, m, actor), 'Poprawkę wpisuje przewodniczący (§ 13 ust. 3, § 15 pkt 3).', 403);
      const b = ballot(m, cmd.ballotId);
      ensure(b.purpose === 'protokol' && protocolOfIssue(m, b, ctx.closedMeetings ?? []), 'To głosowanie ma poprawnie wskazany protokół. Skutku głosowania nie zmienia się po zamknięciu.', 409);
      const target = (ctx.closedMeetings ?? []).find(c => c.id === cmd.protocolOf && c.organ === m.organ && c.id !== m.id && !c.working);
      ensure(target, 'Wybierz zamknięte posiedzenie, którego protokół czeka na przyjęcie.');
      const reason = reasonOf(cmd.reason);
      ensure(reason, 'Podaj powód poprawki. Trafi do dziennika.');
      const was = b.protocolOf ?? null;
      b.protocolOfFix = {from: was, to: target.id, reason, at: ctx.now, by: actor.name, accountId: actor.account.id};
      b.protocolOf = target.id;
      settingLog(m, ctx, actor, `Poprawiono, którego protokołu dotyczy głosowanie nr ${b.number}, z ${quoted(was ? closedLabel(ctx, was) || 'brak' : 'brak')} na ${quoted(closedLabel(ctx, target.id))}. Powód ${quoted(reason.replace(/\.$/, ''))}.`);
      break;
    }
    case 'photos_set': {
      if (!photosChange(m, ctx, actor, String(cmd.url ?? ''), !!cmd.confirm)) return meeting;
      break;
    }
    case 'minutes_ready': {
      // U-34, G-27, DB-6, K4-7: fakt po zamknięciu z osobą sporządzającą i datą wpisaną ręcznie.
      ensure(closed, 'Protokół sporządza się po zamknięciu posiedzenia.', 409);
      ensure(canFile(roster, m, actor), 'Dokumenty po posiedzeniu dołącza biuro, przewodniczący albo sekretarz.', 403);
      if (cmd.date === null) {
        if (!m.minutesReady) return meeting;
        delete m.minutesReady;
        settingLog(m, ctx, actor, 'Usunięto datę sporządzenia protokołu.');
        break;
      }
      const date = typeof cmd.date === 'string' ? cmd.date.trim() : '';
      ensure(/^\d{4}-\d{2}-\d{2}$/.test(date), 'Wpisz datę sporządzenia protokołu.');
      ensure(date <= isoDayOf(ctx.now), 'Data sporządzenia nie może być późniejsza niż dziś.');
      ensure(!m.closedAt || date >= isoDayOf(m.closedAt), 'Data sporządzenia nie może być wcześniejsza niż zakończenie obrad.');
      ensure(cmd.authorPersonId, 'Wybierz osobę, która sporządziła protokół.');
      const ms = organRoster(roster, m).find(x => x.personId === cmd.authorPersonId);
      ensure(ms, 'Protokół sporządza sekretarz albo członek Prezydium, który go zastępuje (§ 13 ust. 1, § 17 ust. 2 pkt 1).');
      const author = {personId: ms.personId, name: name(ctx, ms.personId), func: ms.label};
      m.minutesReady = {date, author, at: ctx.now, by: actor.name, accountId: actor.account.id};
      settingLog(m, ctx, actor, `Protokół sporządzono ${dateDots(date)}. Sporządza ${author.name}, ${author.func}.`);
      break;
    }
    case 'display_edit': {
      ensure(!closed, SHOW_REFUSALS.closed, 409);
      ensure(canAddDisplay(roster, m, actor), displayRefusal(m), 403);
      const d = (m.displays ?? []).find(x => x.id === cmd.id) ?? fail('Nie znaleziono pliku do pokazania.', 404);
      const changes: string[] = [];
      if (cmd.title !== undefined) {
        const title = String(cmd.title).replace(/\s+/g, ' ').trim().slice(0, 200);
        ensure(title, 'Podaj tytuł pliku do pokazania.');
        if (title !== d.title) { changes.push(`nazwę na ${quoted(title)}`); d.title = title; }
      }
      if (cmd.itemId !== undefined && (cmd.itemId ?? null) !== d.itemId) {
        if (cmd.itemId) ensure(m.agenda.some(i => i.id === cmd.itemId), 'Nie znaleziono punktu.', 404);
        if (live(m)) ensure(liveItemOk(m, cmd.itemId ?? null), SHOW_REFUSALS.item);
        d.itemId = cmd.itemId ?? null;
        changes.push(d.itemId ? `punkt na ${itemNumber(m.agenda, d.itemId)}` : 'punkt na brak punktu');
      }
      if (cmd.order !== undefined) {
        const ids = d.files.map(f => f.fileId);
        ensure(Array.isArray(cmd.order) && cmd.order.length === ids.length && ids.every(id => cmd.order!.includes(id)), 'Nieprawidłowa kolejność slajdów.');
        if (cmd.order.join() !== ids.join()) { d.files = cmd.order.map(id => d.files.find(f => f.fileId === id)!); changes.push('kolejność slajdów'); }
      }
      if (cmd.description !== undefined) {
        const description = String(cmd.description).replace(/\r\n?/g, '\n').trim().slice(0, 2000);
        if (description !== (d.description ?? '')) { if (description) d.description = description; else delete d.description; changes.push('opis'); }
      }
      if (!changes.length) return meeting;
      settingLog(m, ctx, actor, `Zmieniono plik do pokazania ${quoted(d.title)}: ${changes.join(', ')}.`.replace(': ', ', '), d.itemId ?? undefined);
      break;
    }
    case 'display_remove': {
      ensure(!closed, SHOW_REFUSALS.closed, 409);
      const d = (m.displays ?? []).find(x => x.id === cmd.id) ?? fail('Nie znaleziono pliku do pokazania.', 404);
      ensure(canAddDisplay(roster, m, actor), displayRefusal(m), 403);
      ensure(canRemoveDisplay(roster, m, actor, d), SHOW_REFUSALS.shown, 409);
      m.displays = (m.displays ?? []).filter(x => x.id !== d.id);
      log(m, ctx, actor, `Usunięto plik do pokazania ${quoted(d.title)}.`, {tag: 'pokaz', ...(d.itemId ? {itemId: d.itemId} : {}), displayId: d.id});
      break;
    }
    case 'show': {
      // G-24, B3-11, B3-13: rozpoczęcie albo przełączenie pokazu przez osobę prowadzącą, poza głosowaniem.
      ensure(!closed, SHOW_REFUSALS.closed, 409);
      ensure(canShow(m, actor), SHOW_REFUSALS.who, 403);
      ensure(canShowNow(m), showBlocked(m), 409);
      ensure(cmd.source === 'plik' || cmd.source === 'material', 'Nieprawidłowy pokaz.');
      const page = cmd.page === undefined ? 1 : Math.round(Number(cmd.page));
      let title = '', kindText = '', version: number | undefined, displayId: string | undefined;
      if (cmd.source === 'plik') {
        const d = (m.displays ?? []).find(x => x.id === cmd.id) ?? fail('Nie znaleziono pliku do pokazania.', 404);
        title = d.title; kindText = displayKindText(d); displayId = d.id;
      } else {
        const ref = m.materials.find(x => x.id === cmd.id) ?? fail('Nie znaleziono materiału.', 404);
        title = ref.title; version = ref.version;
      }
      ensure(Number.isInteger(page) && page >= 1 && page <= showPages(m, cmd.source, cmd.id), SHOW_REFUSALS.page);
      if (m.show) endShow(m, ctx, actor);
      m.show = {source: cmd.source, id: cmd.id, ...(version ? {version} : {}), page, itemId: m.currentItemId, startedAt: ctx.now, by: actor.name, accountId: actor.account.id};
      m.presentation = {kind: 'pokaz', id: cmd.id, at: ctx.now};
      const nr = m.currentItemId ? ` w punkcie ${itemNumber(m.agenda, m.currentItemId)}` : '';
      log(m, ctx, actor, cmd.source === 'plik' ? `Pokazano plik ${quoted(title)} (${kindText})${nr}.` : `Pokazano materiał ${quoted(title)}${nr}.`,
        {tag: 'pokaz', ...(m.currentItemId ? {itemId: m.currentItemId} : {}), ...(displayId ? {displayId} : {})});
      break;
    }
    case 'show_page': {
      ensure(!closed, SHOW_REFUSALS.closed, 409);
      ensure(canShow(m, actor), SHOW_REFUSALS.who, 403);
      ensure(canShowNow(m), showBlocked(m), 409);
      ensure(m.show && m.presentation?.kind === 'pokaz', 'Pokaz nie trwa.', 409);
      const page = Math.round(Number(cmd.page));
      ensure(Number.isInteger(page) && page >= 1 && page <= showPages(m, m.show.source, m.show.id), SHOW_REFUSALS.page);
      if (page === m.show.page) return meeting;
      m.show.page = page;
      break;
    }
    case 'show_end': {
      ensure(!closed, SHOW_REFUSALS.closed, 409);
      ensure(live(m), 'Posiedzenie nie trwa.', 409);
      ensure(canShow(m, actor), SHOW_REFUSALS.who, 403);
      if (!m.show) return meeting;
      endShow(m, ctx, actor);
      break;
    }
    default:
      fail('Nieznana czynność.');
  }
  // G-6: niezmiennik porządku obrad po każdym poleceniu, które zmienia projekt (także w przygotowaniu).
  if (agendaCommands.has(cmd.type)) {
    const problem = validateAgenda(law, m, meeting);
    if (problem) fail(problem);
  }
  advance(m, ctx);
  m.revision++;
  return m;
}

// F12: najwyżej 6 osób; wiersz bez imienia i nazwiska i bez funkcji znika, a z samą funkcją jest błędem.
function cleanPresenters(list: unknown, roster?: Roster, m?: Pick<Meeting, 'organ' | 'frozen'>): Presenter[] {
  ensure(Array.isArray(list), 'Nieprawidłowa lista osób przy punkcie.');
  const clean = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
  const out: Presenter[] = [];
  for (const raw of list as Record<string, unknown>[]) {
    const name = clean(raw?.name, 120), role = clean(raw?.role, 120);
    if (!name && !role) continue;
    ensure(name, 'Wpisz imię i nazwisko osoby albo usuń ten wiersz.');
    ensure(raw.kind === 'referuje' || raw.kind === 'prowadzi', 'Wybierz, czy osoba referuje, czy prowadzi punkt.');
    const p: Presenter = {name, role, kind: raw.kind};
    // B2-W11: osoba ze składu rozpoznana po imieniu i nazwisku (dokładnie jedna), bez wpisu w dzienniku.
    if (roster && m) {
      const same = organRoster(roster, m).filter(ms => personName(roster, ms.personId) === name);
      if (same.length === 1) p.personId = same[0].personId;
    }
    out.push(p);
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
  fixComms(m, ctx);
  m.status = 'zakonczone';
  m.closedAt = ctx.now;
  m.presentation = null;
  m.ended = {how, ...(reason ? {reason} : {}), at: ctx.now, by: actor.name};
  log(m, ctx, actor, how === 'policz'
    ? 'Głosowanie między posiedzeniami zakończono przed czasem.' // to brzmienie odczytuje projekt protokołu (minutes.ts)
    : `Głosowanie między posiedzeniami przerwano. Powód ${quoted(reason)}. Rozstrzygnięcie nie zapadło.`);
}

/**
 * F6: nowe posiedzenie przez powielenie (wersja 3, tabela powielenia w rozdz. 2.9). Kopiuje rodzaj, tytuł, datę, godzinę,
 * miejsce, tryb, odnośnik, wzór posiedzenia, ustawienia posiedzenia (ślad `copiedFrom`) i porządek (nowe identyfikatory,
 * bez punktów wycofanych, stany „oczekuje”, bez notatek, dat, trybów i powodów, z osobami przy punktach, rodzajem
 * „Co jest głosowane”, o ile nie jest wyłączony, potwierdzonym rodzajem sprawy, czasem głosowania i materiałami).
 * Nie kopiuje gości, zastępstwa (rozdz. 4.5 pkt 6), pominięć (pominięte punkty wracają z wpisem), daty zawiadomienia,
 * propozycji rodzajów spraw, danych do protokołu, zamrożenia i krótszego terminu. Zaprasza osoby z głosem doradczym
 * według bieżących kont (`advisory`, DA-5). Materiały dostają nowe identyfikatory; treść i pliki kopiuje wywołujący
 * według `materialMap` (stary identyfikator materiału na nowy).
 */
export function duplicateMeeting(src: Meeting, input: {id: string; now: number; newId: () => string; createdBy: string; docTypes?: DocType[];
  accountId?: string; advisory?: string[]; law?: LegalProfile; titles?: Partial<Record<ItemKind, string>>}) {
  const m = createMeeting({
    id: input.id, organ: src.organ, kind: src.kind, title: src.title, date: src.date, time: src.time, place: src.place,
    mode: src.mode, createdBy: input.createdBy, now: input.now, newId: input.newId,
  });
  m.link = src.link;
  m.invited = [...(input.advisory ?? [])];
  if (src.template) m.template = {...src.template};
  const copied = (): Stamp => ({at: input.now, by: input.createdBy, accountId: input.accountId ?? '', copiedFrom: src.date});
  if (src.settings && Object.keys(src.settings).length) {
    m.settings = {...src.settings};
    m.settingStamps = {};
    for (const key of Object.keys(src.settings) as MeetingSettingKey[]) m.settingStamps[key] = copied();
  }
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
    // F11: rodzaj wyłączony przez biuro nie przechodzi do nowego posiedzenia.
    if (i.docType && docTypeById(input.docTypes ?? defaultDocTypes, i.docType)?.active !== false) copy.docType = i.docType;
    if (i.caseType) { copy.caseType = i.caseType; copy.stamps = {...copy.stamps, caseType: copied()}; }
    if (i.voteMinutes !== undefined) { copy.voteMinutes = i.voteMinutes; copy.stamps = {...copy.stamps, voteMinutes: copied()}; }
    return copy;
  });
  m.materials = materials;
  // Wersja 4 (5.1): pliki do pokazania przechodzą razem z punktami, bez znacznika „dodany w trakcie obrad”. Pliki na dysku
  // kopiuje wywołujący (identyfikatory plików zostają ze źródła, dopóki ich nie zamieni).
  const displays = (src.displays ?? []).filter(d => !d.itemId || ids.has(d.itemId)).map(d => {
    const {live: _live, ...rest} = structuredClone(d);
    return {...rest, id: input.newId(), itemId: d.itemId ? ids.get(d.itemId)! : null, addedAt: input.now, addedBy: input.createdBy, accountId: input.accountId ?? ''};
  });
  if (displays.length) m.displays = displays;
  const day = src.date ? src.date.split('-').reverse().join('.') : '';
  m.log = [{at: input.now, text: `Utworzono przez powielenie ${src.kind === 'procedura' ? 'głosowania między posiedzeniami' : 'posiedzenia'} z dnia ${day}.`, by: input.createdBy, ...(input.accountId ? {accountId: input.accountId} : {})}];
  // Pominięte punkty z § 9 ust. 2 wracają na zwykłe miejsca (rozdz. 2.9, tabela powielenia).
  // Zastępca i goście nie przechodzą do kopii (rozdz. 4.5 pkt 6, tabela powielenia), ale kopia pamięta źródło, żeby
  // przygotowanie na każdym urządzeniu podpowiadało „Wyznacz ponownie” i „Zaproś ponownie”.
  const advisory = new Set(input.advisory ?? []);
  m.duplicatedFrom = {id: src.id, date: src.kind === 'procedura' && src.openedAt ? new Date(src.openedAt).toISOString().slice(0, 10) : src.date,
    deputy: src.chair.deputy ?? null, invited: src.invited.filter(id => !advisory.has(id))};
  const law = input.law ?? LAW[src.organ];
  for (const it of completeAgenda(law, m, input.newId, input.titles)) {
    if (!(it.kind in law.agenda.listed)) continue;
    m.log.push({at: input.now, text: `Przywrócono punkt ${quoted(it.title)} wymieniony w regulaminie (${agendaBasis(law, it.kind)}).`, by: input.createdBy, tag: 'projekt', itemId: it.id, ...(input.accountId ? {accountId: input.accountId} : {})});
  }
  return {meeting: m, materialMap};
}

function fileIfSupported(m: Meeting, ctx: Context, motionId: string) {
  const motion = m.motions.find(x => x.id === motionId)!;
  if (motion.status !== 'zbiera_podpisy') return;
  const present = presentMembers(m, ctx.roster);
  const valid = motion.signatures.filter(id => present.includes(id)).length;
  const law = lawFor(ctx, m.organ);
  if (valid >= signaturesNeeded(law, present.length)) {
    motion.status = 'zlozony';
    motion.filedAt = ctx.now;
    motion.presentAtFiling = present.length;
    log(m, ctx, null, `Wniosek o reasumpcję poparło ${valid} z ${present.length} obecnych, a wymagana jest ${shareText(law.reasumption.share)} (§ 12).`);
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
