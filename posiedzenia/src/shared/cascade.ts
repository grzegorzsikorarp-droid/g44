import type {Account, AgendaItem, Ballot, DocType, Effective, FrozenSettings, ItemKind, Meeting, MeetingSettingKey, Organ, OrganCode, Roster, SettingSource, Stamp} from './types.ts';
import {APP_RULES, HOUSE_RULES, PROCEDURE_MIN_HOURS, agendaBasis, lawOf, shareText, type LegalProfile} from './law.ts';
import {matchCaseType, messagesText, nextProtocolNumber, NOTICE_TAGS, noticeTemplateOf, organSettingsOf, type CaseType, type GeneralBundle, type GeneralSettings, type MeetingTemplate} from './settings.ts';
import {itemNumber, needsVote, orderedAgenda, quorumOf, unannounced} from './rules.ts';
import {organOfCode, personName} from './roster.ts';
import {deputyOf, organRoster} from './role.ts';
import {dateDots, dateDotsOf, dateTimeText, minutesText, plural, timeOf} from './text.ts';

export type {Effective, SettingSource} from './types.ts';

// Wartość skuteczna i jej źródło (specyfikacja wersji 3, rozdz. 2.6). Jedna funkcja rozstrzyga kaskadę: prawo (poziom 0),
// ustawienia ogólne i wzór posiedzenia (1), posiedzenie i punkt (2), obrady (3). Posiedzenie w przygotowaniu dziedziczy
// ustawienia ogólne na bieżąco, a przy otwarciu zapisuje je u siebie (`freeze`). Odstępstwa do protokołu liczy też tylko
// ta funkcja (`deviations`), a przegląd przed otwarciem (`review`) z niej korzysta.

export interface CascadeEnv {
  law: LegalProfile; general: GeneralSettings; docTypes: DocType[]; roster: Roster; organ: Organ;
  /** Wersja 3, dodatkowe dane z serwera: konta (głos doradczy, goście), rewizja ustawień i ostatnia zmiana składu. */
  accounts?: Pick<Account, 'id' | 'kind' | 'displayName' | 'label' | 'disabled' | 'personId'>[];
  revision?: number;
  composition?: {at: number; text: string} | null;
  previousOpenedAt?: number | null;
  /** Dodatek U-03: numery protokołów innych posiedzeń tego organu z datami (do propozycji numeru). */
  protocols?: {date: string; number: string}[];
}
/** Środowisko kaskady dla organu z pakietu ustawień (serwer, wersja próbna i domena). */
export function cascadeEnv(input: {roster: Roster; bundle: GeneralBundle; organ: OrganCode; accounts?: CascadeEnv['accounts']; law?: Partial<Record<OrganCode, LegalProfile>>; composition?: CascadeEnv['composition']; previousOpenedAt?: number | null; protocols?: CascadeEnv['protocols']}): CascadeEnv {
  return {
    law: input.law?.[input.organ] ?? lawOf(input.organ), general: input.bundle.general, docTypes: input.bundle.docTypes, roster: input.roster,
    organ: organOfCode(input.roster, input.organ), accounts: input.accounts, revision: input.bundle.revision,
    composition: input.composition, previousOpenedAt: input.previousOpenedAt, protocols: input.protocols,
  };
}
/**
 * Dane z innych posiedzeń do środowiska kaskady (serwer i wersja próbna liczą to samo): ostatnie otwarcie wcześniejszego
 * posiedzenia tego organu (przegląd, D-14) i numery protokołów posiedzeń tego organu (U-03).
 */
export function othersOf(m: Pick<Meeting, 'id' | 'organ' | 'openedAt'>, all: Pick<Meeting, 'id' | 'organ' | 'kind' | 'openedAt' | 'date' | 'protocolNumber'>[]): {previousOpenedAt: number | null; protocols: {date: string; number: string}[]} {
  const same = all.filter(x => x.id !== m.id && x.organ === m.organ);
  const previous = same.filter(x => x.openedAt && x.openedAt <= (m.openedAt ?? Infinity)).map(x => x.openedAt!);
  return {
    previousOpenedAt: previous.length ? Math.max(...previous) : null,
    protocols: same.filter(x => x.kind === 'posiedzenie' && x.protocolNumber).map(x => ({date: x.date, number: x.protocolNumber!})),
  };
}
/** Proponowany numer protokołu posiedzenia (U-03) albo null bez wzoru numeru. */
export function protocolProposal(env: Pick<CascadeEnv, 'general' | 'protocols'>, m: Pick<Meeting, 'kind' | 'date'>): string | null {
  const pattern = env.general.site.protocolNumberPattern ?? '';
  if (m.kind !== 'posiedzenie' || !pattern || !m.date) return null;
  const year = m.date.slice(0, 4);
  const existing = (env.protocols ?? []).filter(p => p.date.slice(0, 4) === year).map(p => p.number);
  return nextProtocolNumber(pattern, env.general.site.termNumber, Number(year), existing);
}

export interface MeetingEffective {
  meeting: {
    voteMinutes: Effective<number>; motionMinutes: Effective<number>;
    messages: Effective<'zawsze' | 'gdy_sa_wiadomosci' | 'od_poczatku'>;
    quorum: Effective<{required: number; total: number; seats: number | null}>;
    majority: Effective<'zwykla'>; mode: Effective<'jawne'>;
    reasumption: Effective<{share: string} | null>;
    notice: Effective<{minDays: number; days: number | null; deadline: string | null}>;
    convener: Effective<string | null>;
    draftLive: Effective<boolean>;
    procedureMinHours?: Effective<number>;
  };
  items: Record<string, {
    kind: Effective<ItemKind>; docType: Effective<string | null>; voted: Effective<boolean>;
    voteMinutes: Effective<number>; caseType: Effective<string | null>; caseTypeGuess: string | null;
  }>;
  differences: Difference[];
  deviations: Deviation[];
  review?: ReviewRow[];
  protocolNumberProposal?: string | null;
}
export interface Difference { key: string; itemId?: string; text: string }
export type DeviationKind = 'zawiadomienie' | 'poza_zawiadomieniem' | 'pominiety_punkt' | 'gosc' | 'zastepstwo' | 'prowadzenie'
  | 'rodzaj_sprawy' | 'bez_glosowania' | 'tryb_procedury' | 'termin_procedury' | 'zatwierdzenie';
export interface Deviation { kind: DeviationKind; itemId?: string; at?: number; text: string; basis?: string }
/**
 * Wiersz przeglądu przed otwarciem. `target` mówi, do czego przewija „Pokaż”: 'zawiadomienie', 'zwolanie', 'sklad',
 * 'goscie', 'zastepstwo', 'glosowania', 'wzor', 'termin' albo 'punkt:{id}'.
 */
export interface ReviewRow { group: 'uzupelnic' | 'sprawdzic' | 'gotowe'; text: string; itemId?: string; target?: string; actions?: ('przyjmij' | 'odrzuc')[] }

/** Podstawa ilości członków do kworum (pytanie 5, wariant a): aktualny skład, nie liczba miejsc z uchwały. */
export const quorumTotal = (members: number, _seats: number | null) => members;

const templateOf = (env: CascadeEnv, m: Pick<Meeting, 'template' | 'organ'>): MeetingTemplate | undefined =>
  m.template ? organSettingsOf(env.general, m.organ).templates.find(t => t.id === m.template!.id) : undefined;
/** Słownik rodzajów dla posiedzenia: zapisany przy otwarciu albo bieżący. */
export const docTypesOfMeeting = (env: Pick<CascadeEnv, 'docTypes'>, m: Pick<Meeting, 'frozen'>) => m.frozen?.docTypes ?? env.docTypes;

/**
 * Ustawienie posiedzenia przed zamrożeniem: posiedzenie, wzór posiedzenia, ustawienia ogólne. Czasy głosowań (rdzeń)
 * i kanał wiadomości od początku posiedzenia (U-12, dodatek; bez wpisu w ustawieniach ogólnych `false`, jak dziś).
 */
function liveSetting(env: CascadeEnv, m: Meeting, key: 'voteMinutes' | 'motionMinutes'): Effective<number>;
function liveSetting(env: CascadeEnv, m: Meeting, key: 'messagesFromStart'): Effective<boolean>;
function liveSetting(env: CascadeEnv, m: Meeting, key: MeetingSettingKey): Effective<number | boolean> {
  const organ = organSettingsOf(env.general, m.organ);
  const general: Effective<number | boolean> = {value: key === 'messagesFromStart' ? !!organ.messagesFromStart : organ[key], source: 'ogolne', level: 1};
  const template = templateOf(env, m);
  const fromTemplate = template?.settings?.[key];
  const lower: Effective<number | boolean> = fromTemplate !== undefined
    ? {value: fromTemplate, source: 'szablon', level: 1, via: {kind: 'wzor', name: template!.name}, inherited: general.value, inheritedSource: 'ogolne'}
    : general;
  const own = m.settings?.[key];
  if (own === undefined) return lower;
  const out: Effective<number | boolean> = {value: own, source: 'posiedzenie', level: 2, inherited: lower.value, inheritedSource: lower.source};
  const stamp = m.settingStamps?.[key];
  if (stamp) out.stamp = stamp;
  return out;
}

/** Ustawienia zapisane przy otwarciu posiedzenia (zamrożenie). */
export function freeze(env: CascadeEnv, m: Meeting, now: number): FrozenSettings {
  const mark = <T>(e: Effective<T>): Effective<unknown> => ({...e, frozen: true});
  return {
    at: now, lawVersion: env.law.version, generalRevision: env.revision ?? 0,
    members: organRoster(env.roster, {organ: m.organ}).map(ms => ({personId: ms.personId, func: ms.func, label: ms.label, order: ms.order})),
    docTypes: structuredClone(env.docTypes),
    meeting: {
      voteMinutes: mark(liveSetting(env, m, 'voteMinutes')), motionMinutes: mark(liveSetting(env, m, 'motionMinutes')),
      messagesFromStart: mark(liveSetting(env, m, 'messagesFromStart')),
    } as Record<MeetingSettingKey, Effective<unknown>>,
  };
}
/** Zamrożenie przy przejściu na wersję 3 (rozdz. 2.10): wartości domyślne, skład i słownik z chwili migracji. */
export function freezeLegacy(env: CascadeEnv, m: Meeting, now: number): FrozenSettings {
  const f = freeze(env, {...m, settings: undefined, template: undefined}, now);
  f.legacy = true;
  // Posiedzenia sprzed wersji 3 mają kanał wiadomości jak w wersji 2 (gdy ktoś napisze), niezależnie od ustawień ogólnych.
  f.meeting.messagesFromStart = {value: false, source: 'ogolne', level: 1, frozen: true};
  for (const key of Object.keys(f.meeting) as MeetingSettingKey[]) f.meeting[key] = {...f.meeting[key], legacy: true};
  return f;
}

/** Czas głosowań posiedzenia: zapisany przy otwarciu albo z kaskady (posiedzenie, wzór, ustawienia ogólne). */
export function meetingSetting(env: CascadeEnv, m: Meeting, key: 'voteMinutes' | 'motionMinutes'): Effective<number> {
  return m.frozen ? m.frozen.meeting[key] as Effective<number> : liveSetting(env, m, key);
}
/** Kanał wiadomości od początku posiedzenia (U-12): zapisany przy otwarciu (stare zamrożenie bez klucza: `false`) albo z kaskady. */
export function meetingFlag(env: CascadeEnv, m: Meeting, key: 'messagesFromStart'): Effective<boolean> {
  if (m.frozen) return (m.frozen.meeting[key] as Effective<boolean> | undefined) ?? {value: false, source: 'ogolne', level: 1, frozen: true, ...(m.frozen.legacy ? {legacy: true as const} : {})};
  return liveSetting(env, m, key);
}
/**
 * Koniec głosowania między posiedzeniami (DA-21: „trwa domyślnie 24 godziny i co najmniej 24 godziny od rozpoczęcia”).
 * W przygotowaniu termin wpisany ręcznie (`endsAtSet`) obowiązuje bez zmian, a bez niego głosowanie trwa czas z ustawień
 * ogólnych liczony od rozpoczęcia, czyli od `now` przy poleceniu `open` (`fromStart`). Termin zapisany przy utworzeniu przed
 * tą zasadą (utworzenie + czas z ustawień, bez śladu) liczy się jak wartość domyślna. Po rozpoczęciu obowiązuje zapisany termin.
 * Domena, serwer, wersja próbna i klient wołają tę funkcję, więc reguła jest w jednym miejscu.
 */
export function procedureEndAt(m: Pick<Meeting, 'status' | 'endsAt' | 'endsAtSet' | 'createdAt' | 'organ'>, general: GeneralSettings, now: number): {endsAt: number; fromStart: boolean; hours: number} {
  const hours = organSettingsOf(general, m.organ).procedureHours;
  if (m.status !== 'przygotowanie') return {endsAt: m.endsAt ?? now, fromStart: false, hours};
  const createdDefault = !m.endsAtSet && m.endsAt !== undefined && Math.abs(m.endsAt - (m.createdAt + hours * 3600000)) < 60000;
  if (m.endsAt !== undefined && !createdDefault) return {endsAt: m.endsAt, fromStart: false, hours};
  return {endsAt: now + hours * 3600000, fromStart: true, hours};
}

/** Czas głosowania w punkcie: własny albo posiedzenia. */
export const itemVoteMinutes = (env: CascadeEnv, m: Meeting, it: Pick<AgendaItem, 'voteMinutes'> | undefined) => it?.voteMinutes ?? meetingSetting(env, m, 'voteMinutes').value;

/** Warunek „projekt na żywo” (D2, rozdz. 4.6): punkt „Przyjęcie porządku obrad” albo całe spotkanie robocze. */
export function isDraftLive(m: Pick<Meeting, 'kind' | 'status' | 'agendaAdopted' | 'agenda' | 'currentItemId' | 'ballots' | 'working'>) {
  return m.kind === 'posiedzenie' && (m.status === 'trwa' || m.status === 'przerwa') && !m.agendaAdopted
    && (m.agenda.find(i => i.id === m.currentItemId)?.kind === 'porzadek' || !!m.working)
    && !m.ballots.some(b => b.status === 'otwarte') && !unannounced(m).length;
}

const quote = (t: string) => `„${t.replace(/„/g, '»').replace(/”/g, '«')}”`;
const typeName = (types: DocType[], id: string | null | undefined) => id ? types.find(t => t.id === id)?.name ?? id : 'Bez rodzaju';
const daysBefore = (iso: string, days: number) => new Date(Date.parse(iso + 'T12:00:00Z') - days * 86400000).toISOString().slice(0, 10);
function noticeDaysOf(m: Pick<Meeting, 'noticeDate' | 'date'>) {
  if (!m.noticeDate || !m.date) return null;
  return Math.round((Date.parse(m.date + 'T12:00:00Z') - Date.parse(m.noticeDate + 'T12:00:00Z')) / 86400000);
}
const who = (env: CascadeEnv, m: Meeting, personId: string | null | undefined) => {
  const ms = organRoster(env.roster, m).find(x => x.personId === personId);
  return ms ? `${personName(env.roster, personId)}, ${ms.label}` : personName(env.roster, personId);
};
const caseTypeOf = (env: CascadeEnv, id: string | null | undefined): CaseType | undefined => id ? env.general.caseTypes.find(c => c.id === id) : undefined;

function itemEffective(env: CascadeEnv, m: Meeting, it: AgendaItem, types: DocType[], meetingVote: Effective<number>, template?: MeetingTemplate) {
  const stamps = it.stamps ?? {};
  // Źródło „wzór posiedzenia” ma tylko punkt, który we wzorze jest (ten sam rodzaj i tytuł). Punkt dodany ręcznie albo
  // wczytany z tekstu ma rodzaj ustalony w tym posiedzeniu, bez odwołania do wzoru (zasada 4 z rozdz. 0).
  const norm = (t: string) => t.replace(/\s+/g, ' ').replace(/[.;:,\s]+$/, '').toLocaleLowerCase('pl');
  const inTemplate = (list: MeetingTemplate['items']): boolean => list.some(t => (t.kind === it.kind && norm(t.title) === norm(it.title)) || inTemplate(t.children ?? []));
  const kind: Effective<ItemKind> = stamps.kind
    ? {value: it.kind, source: 'punkt', level: 2, stamp: stamps.kind}
    : template && !inTemplate(template.items)
      ? {value: it.kind, source: 'posiedzenie', level: 2}
      : {value: it.kind, source: 'szablon', level: 1, ...(template ? {via: {kind: 'wzor' as const, name: template.name}} : {})};
  const caseType = caseTypeOf(env, it.caseType);
  const material = m.materials.find(x => it.materialIds.includes(x.id));
  let lower: Effective<string | null> = {value: null, source: 'punkt', level: 2};
  if (caseType) lower = {value: caseType.docType, source: 'ogolne', level: 1, via: {kind: 'rodzaj_sprawy', name: caseType.name}};
  else if (material) lower = {value: material.type, source: 'punkt', level: 2, via: {kind: 'material', name: material.title}};
  let docType: Effective<string | null> = lower;
  // Rodzaj sprawy uzupełnia puste „Co jest głosowane” (item_edit {caseType}); bez własnego śladu zmiany to nadal wartość wynikająca.
  if (it.docType && caseType && it.docType === caseType.docType && !stamps.docType) {
    docType = lower;
  } else if (it.docType) {
    const live = !!stamps.docType?.live;
    docType = {value: it.docType, source: live ? 'obrady' : 'punkt', level: live ? 3 : 2, ...(stamps.docType ? {stamp: stamps.docType} : {})};
    if (lower.value !== null || lower.via) { docType.inherited = lower.value; docType.inheritedSource = lower.source; }
  }
  const voted = needsVote(m, it, types);
  const lawBasis = docType.value ? env.law.acts.voted[docType.value] : undefined;
  let votedEff: Effective<boolean>;
  if (it.kind === 'porzadek') votedEff = {value: voted, source: 'prawo', level: 0, basis: agendaBasis(env.law, 'porzadek') ?? undefined};
  else if (it.kind === 'protokol') votedEff = {value: voted, source: 'prawo', level: 0, basis: env.law.acts.voted.protokol};
  else if (docType.value && lawBasis) votedEff = {value: voted, source: 'prawo', level: 0, basis: lawBasis, via: {kind: 'rodzaj_dokumentu', name: typeName(types, docType.value), basis: lawBasis}};
  else if (docType.value) votedEff = {value: voted, source: 'ogolne', level: 1, via: {kind: 'rodzaj_dokumentu', name: typeName(types, docType.value)}};
  else votedEff = {value: voted, source: 'ogolne', level: 1};
  let voteMinutes: Effective<number> = meetingVote;
  if (it.voteMinutes !== undefined) {
    const live = !!stamps.voteMinutes?.live;
    voteMinutes = {value: it.voteMinutes, source: live ? 'obrady' : 'punkt', level: live ? 3 : 2, inherited: meetingVote.value, inheritedSource: 'posiedzenie', ...(stamps.voteMinutes ? {stamp: stamps.voteMinutes} : {})};
  }
  const caseEff: Effective<string | null> = it.caseType
    ? {value: it.caseType, source: 'punkt', level: 2, ...(stamps.caseType ? {stamp: stamps.caseType} : {})}
    : {value: null, source: 'punkt', level: 2};
  return {kind, docType, voted: votedEff, voteMinutes, caseType: caseEff, caseTypeGuess: it.caseTypeGuess ?? null};
}

/** Wartości skuteczne posiedzenia, różnice, odstępstwa do protokołu i przegląd przed otwarciem. */
export function effectiveMeeting(env: CascadeEnv, m: Meeting, options: {review?: boolean; now?: number} = {}): MeetingEffective {
  const law = env.law;
  const types = docTypesOfMeeting(env, m);
  const frozen = m.frozen;
  const voteMinutes = meetingSetting(env, m, 'voteMinutes');
  const motionMinutes = meetingSetting(env, m, 'motionMinutes');
  const remote = m.mode === 'zdalne' || m.kind === 'procedura';
  // U-12 (dodatek): na posiedzeniu stacjonarnym kanał od początku albo dopiero po pierwszej wiadomości, według kaskady.
  const fromStart = meetingFlag(env, m, 'messagesFromStart');
  const messages: MeetingEffective['meeting']['messages'] = remote
    ? {value: 'zawsze', source: 'aplikacja', level: 0, appRule: 'kanal_zdalny'}
    : {...fromStart, value: fromStart.value ? 'od_poczatku' : 'gdy_sa_wiadomosci', inherited: fromStart.inherited === undefined ? undefined : fromStart.inherited ? 'od_poczatku' : 'gdy_sa_wiadomosci'};
  if (messages.inherited === undefined) delete messages.inherited;
  const members = organRoster(env.roster, m);
  const seats = organSettingsOf(env.general, m.organ).seats?.count ?? null;
  const total = members.length;
  const days = noticeDaysOf(m);
  const chairman = members.find(x => x.func === 'przewodniczacy')?.personId ?? null;
  const convenerId = m.convener ?? chairman;
  const deputy = deputyOf(env.roster, m);
  const meeting: MeetingEffective['meeting'] = {
    voteMinutes, motionMinutes, messages,
    quorum: {value: {required: quorumOf(law, quorumTotal(total, seats)), total, seats}, source: 'prawo', level: 0, basis: law.quorum.basis},
    majority: {value: 'zwykla', source: 'prawo', level: 0, basis: law.majority.basis},
    mode: {value: 'jawne', source: 'prawo', level: 0, basis: '§ 11 ust. 1'},
    reasumption: m.kind === 'procedura'
      ? {value: null, source: 'prawo', level: 0, basis: '§ 12 ust. 2'}
      : {value: {share: shareText(law.reasumption.share)}, source: 'prawo', level: 0, basis: law.reasumption.basis},
    notice: {value: {minDays: law.notice.minDays, days, deadline: m.date ? daysBefore(m.date, law.notice.minDays) : null}, source: 'prawo', level: 0, basis: law.notice.basis},
    convener: {value: convenerId, source: 'prawo', level: 0, basis: convenerId && convenerId === deputy ? law.convener.deputyBasis ?? law.convener.basis : law.convener.basis},
    draftLive: {value: isDraftLive(m), source: 'zasada', level: 0, rule: 'D2'},
  };
  if (m.kind === 'procedura') meeting.procedureMinHours = {value: PROCEDURE_MIN_HOURS, source: 'aplikacja', level: 0, appRule: 'czas_procedury'};
  const template = templateOf(env, m);
  const items: MeetingEffective['items'] = {};
  for (const it of m.agenda) items[it.id] = itemEffective(env, m, it, types, voteMinutes, template);

  const differences: Difference[] = [];
  const settingNames = {voteMinutes: 'Czas głosowania w sprawie', motionMinutes: 'Czas głosowań nad wnioskami'};
  for (const key of ['voteMinutes', 'motionMinutes'] as const) {
    const e = meeting[key];
    if (e.source === 'posiedzenie' && e.inherited !== undefined && e.inherited !== e.value) {
      differences.push({key, text: `${settingNames[key]} ${minutesText(e.value)}, ${e.inheritedSource === 'szablon' ? 'we wzorze posiedzenia' : 'w ustawieniach ogólnych'} ${minutesText(e.inherited)}.`});
    }
  }
  if (!remote && fromStart.source === 'posiedzenie' && fromStart.inherited !== undefined && fromStart.inherited !== fromStart.value) {
    differences.push({key: 'messagesFromStart', text: `Kanał wiadomości ${messagesText(fromStart.value)}, ${fromStart.inheritedSource === 'szablon' ? 'we wzorze posiedzenia' : 'w ustawieniach ogólnych'} ${messagesText(fromStart.inherited)}.`});
  }
  for (const it of m.agenda) {
    const e = items[it.id], nr = itemNumber(m.agenda, it.id);
    if (it.voteMinutes !== undefined && it.voteMinutes !== voteMinutes.value) {
      differences.push({key: 'voteMinutes', itemId: it.id, text: `Czas głosowania w punkcie ${nr} ${minutesText(it.voteMinutes)}, w ustawieniach posiedzenia ${minutesText(voteMinutes.value)}.`});
    }
    if (it.docType && e.docType.inherited !== undefined && e.docType.inherited !== e.docType.value && e.docType.source === 'punkt') {
      differences.push({key: 'docType', itemId: it.id, text: `Co jest głosowane w punkcie ${nr} ${quote(typeName(types, it.docType))}, a ${e.docType.inheritedSource === 'ogolne' ? 'z rodzaju sprawy' : 'z materiału'} wynika ${quote(typeName(types, e.docType.inherited))}.`});
    }
  }

  const deviations = frozen?.legacy ? [] : meetingDeviations(env, m);
  const out: MeetingEffective = {meeting, items, differences, deviations};
  const proposal = protocolProposal(env, m);
  if (proposal) out.protocolNumberProposal = proposal;
  if (options.review && m.status === 'przygotowanie') out.review = review(env, m, items, options.now ?? Date.now());
  return out;
}

/** Odstępstwa istotne prawnie, które trafiają do protokołu (rozdz. 2.8 pkt 4, brzmienia z rozdz. 5.8). */
function meetingDeviations(env: CascadeEnv, m: Meeting): Deviation[] {
  const law = env.law;
  const out: Deviation[] = [];
  const days = noticeDaysOf(m);
  if (m.kind === 'posiedzenie' && days !== null && days < law.notice.minDays) {
    out.push({kind: 'zawiadomienie', text: `Zawiadomienie wysłano ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, a regulamin wymaga co najmniej ${law.notice.minDays} dni (${law.notice.basis}).`, basis: law.notice.basis});
  }
  if (m.noticeItems) {
    for (const it of m.agenda) {
      if (m.noticeItems.includes(it.id)) continue;
      out.push({kind: 'poza_zawiadomieniem', itemId: it.id, text: `Punkt ${itemNumber(m.agenda, it.id)} ${quote(it.title)} dodano do projektu porządku obrad po wysłaniu zawiadomienia (${law.notice.basis}).`, basis: law.notice.basis});
    }
  }
  for (const s of m.skipped ?? []) {
    const basis = agendaBasis(law, s.kind) ?? law.agenda.listedBasis;
    const person = s.personId ?? env.roster.persons.find(p => p.name === s.by)?.id ?? null;
    out.push({kind: 'pominiety_punkt', at: s.at, text: `Z projektu porządku obrad pominięto punkt ${quote(s.title)}, wymieniony w ${basis}. Punkt pominięto decyzją ${person ? who(env, m, person) : s.by}. Powód ${quote(s.reason.replace(/\.$/, ''))}.`, basis});
  }
  for (const [accountId, invite] of Object.entries(m.guestInvites ?? {})) {
    if (!m.invited.includes(accountId)) continue;
    const account = env.accounts?.find(a => a.id === accountId);
    const name = account ? `${account.displayName}${account.label ? `, ${account.label}` : ''}` : accountId;
    out.push({kind: 'gosc', text: invite.by === 'organ'
      ? `Gość ${name} uczestniczy na zaproszenie ${env.organ.code === 'prezydium' ? 'Prezydium' : env.organ.forms.genitive}, ${invite.decision} (${law.guests.basis}).`
      : `Gość ${name} uczestniczy na zaproszenie przewodniczącego (${law.guests.basis}).`, basis: law.guests.basis});
  }
  const deputy = deputyOf(env.roster, m);
  if (deputy && m.chair.deputySet && law.deputy) {
    const set = m.chair.deputySet;
    out.push({kind: 'zastepstwo', at: set.at, text: `Zastępstwo przewodniczącego ${who(env, m, deputy)}, wyznaczenie przez przewodniczącego ${dateDotsOf(set.at)}, godz. ${timeOf(set.at)} (${law.deputy.basis}).`, basis: law.deputy.basis});
  }
  for (const c of m.chair.changes) {
    if (c.recordedExit) out.push({kind: 'prowadzenie', at: c.at, text: `O godz. ${timeOf(c.at)} zapisano wyjście osoby prowadzącej obrady. Wyjście zapisała osoba, która przejęła prowadzenie.`});
    if (c.basis !== 'zamiast_zastepcy') continue;
    const reason = quote((c.reasonGiven ?? '').replace(/\.$/, ''));
    out.push({kind: 'prowadzenie', at: c.at, text: c.opening
      ? `Posiedzenie otwiera ${who(env, m, c.to)} (zamiast wyznaczonego zastępcy, powód ${reason}).`
      : `Od godz. ${timeOf(c.at)} obrady prowadzi ${who(env, m, c.to)} (zamiast wyznaczonego zastępcy, powód ${reason}).`});
  }
  for (const e of m.log) {
    if (e.tag !== 'odstepstwo') continue;
    out.push({kind: /nie poddano pod głosowanie/.test(e.text) ? 'bez_glosowania' : 'rodzaj_sprawy', itemId: e.itemId, at: e.at, text: e.text});
  }
  if (m.kind === 'procedura') {
    for (const it of m.agenda) {
      if (!it.mode || !it.modeAct) continue;
      const act = it.modeAct;
      out.push({kind: 'tryb_procedury', itemId: it.id, text: act.kind === 'uchwala'
        ? `Głosowanie ${it.mode} na podstawie uchwały ${organSubject(env)} nr ${act.number} z dnia ${dateDots(act.date)} (§ 11 ust. 2).`
        : `Głosowanie ${it.mode} na podstawie głosowania nr ${act.number} na posiedzeniu ${organSubject(env)} z dnia ${dateDots(act.date)} (§ 11 ust. 2).`, basis: '§ 11 ust. 2'});
    }
    if (m.shortTerm && m.openedAt && m.endsAt && m.endsAt - m.openedAt < PROCEDURE_MIN_HOURS * 3600000) {
      out.push({kind: 'termin_procedury', at: m.shortTerm.at, text: `Głosowanie trwało krócej niż ${PROCEDURE_MIN_HOURS} godziny, do ${dateTimeText(m.endsAt)}. Powód ${quote(m.shortTerm.reason.replace(/\.$/, ''))}.`});
    }
  }
  return out;
}
/** Organ jako podmiot zdania: „Prezydium” w sprawach Prezydium (jak w dotychczasowych tekstach), inaczej pełna nazwa. */
const organSubject = (env: CascadeEnv) => env.organ.code === 'prezydium' ? 'Prezydium' : env.organ.name;

/**
 * Przegląd przed otwarciem: „Do uzupełnienia”, „Do sprawdzenia” (w tym propozycje rodzajów spraw z działaniami)
 * i „Gotowe”. Podstawa przekazania rodzaju sprawy (DA-22) pojawi się tu, gdy Izba przekaże uchwałę z § 14 ust. 1.
 */
function review(env: CascadeEnv, m: Meeting, items: MeetingEffective['items'], now: number): ReviewRow[] {
  const law = env.law;
  const rows: ReviewRow[] = [];
  const posiedzenie = m.kind === 'posiedzenie';
  // W głosowaniu między posiedzeniami pozycje to sprawy, a nie punkty porządku obrad.
  const unit = (it: AgendaItem) => !posiedzenie ? 'Sprawa' : it.parentId ? 'Podpunkt' : 'Punkt';
  for (const it of m.agenda) {
    if (it.kind === 'sprawa' && items[it.id].voted.value && !it.materialIds.length) {
      rows.push({group: 'uzupelnic', text: `${unit(it)} ${itemNumber(m.agenda, it.id)} bez materiału.`, itemId: it.id, target: `punkt:${it.id}`});
    }
  }
  if (posiedzenie) {
    const days = noticeDaysOf(m);
    if (days === null && m.date) {
      rows.push({group: 'sprawdzic', text: `Wyślij zawiadomienie najpóźniej ${dateDots(daysBefore(m.date, law.notice.minDays))} (${law.notice.minDays} dni przed posiedzeniem, ${law.notice.basis}).`, target: 'zawiadomienie'});
    } else if (days !== null && days >= law.notice.minDays) {
      rows.push({group: 'gotowe', text: `Zawiadomienie wysłano ${dateDots(m.noticeDate)}, ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem (${law.notice.basis}).`, target: 'zawiadomienie'});
    }
  }
  for (const it of m.agenda) {
    const guess = caseTypeOf(env, it.caseTypeGuess);
    if (!guess || it.caseType) continue;
    rows.push({group: 'sprawdzic', text: `Propozycja rodzaju sprawy w ${posiedzenie ? 'punkcie' : 'sprawie'} ${itemNumber(m.agenda, it.id)} »${guess.name}«.`, itemId: it.id, target: `punkt:${it.id}`, actions: ['przyjmij', 'odrzuc']});
  }
  const members = organRoster(env.roster, m).length;
  if (env.composition && (env.previousOpenedAt == null || env.composition.at > env.previousOpenedAt)) {
    rows.push({group: 'sprawdzic', text: `Skład ${env.organ.forms.genitive} zmieniono ${dateDotsOf(env.composition.at)}, ${env.composition.text}. Wymagane kworum ${quorumOf(law, members)} z ${members}.`, target: 'sklad'});
  }
  const seats = organSettingsOf(env.general, m.organ).seats?.count;
  if (seats && seats !== members) {
    rows.push({group: 'sprawdzic', text: `Skład liczy ${members} ${plural(members, 'osobę', 'osoby', 'osób')}, a uchwała ${organOfCode(env.roster, 'rada').forms.genitive} ustala ${seats} ${plural(seats, 'miejsce', 'miejsca', 'miejsc')}. Kworum liczy się ze składu.`, target: 'sklad'});
  }
  const deputy = deputyOf(env.roster, m);
  if (m.convener && deputy && m.convener === deputy) {
    rows.push({group: 'sprawdzic', text: `Zwołuje zastępca przewodniczącego. Zakres zastępstwa ustala ${organOfCode(env.roster, 'rada').name} (§ 16 ust. 1).`, target: 'zwolanie'});
  }
  for (const e of m.log) {
    if (!e.itemId || !e.text.startsWith('Uzupełniono projekt porządku obrad o punkt')) continue;
    const it = m.agenda.find(i => i.id === e.itemId);
    if (it) rows.push({group: 'sprawdzic', text: `Uzupełniono projekt porządku obrad o punkt ${quote(it.title)} wymagany regulaminem.`, itemId: it.id, target: `punkt:${it.id}`});
  }
  for (const s of m.skipped ?? []) {
    if (s.kind === 'protokol') rows.push({group: 'sprawdzic', text: `Pominięto punkt ${quote(s.title)}. Protokół poprzedniego posiedzenia przyjmuje się na następnym posiedzeniu (${law.minutes.adoptionBasis}).`});
  }
  if (m.template && !templateOf(env, m)) rows.push({group: 'sprawdzic', text: `Wzoru »${m.template.name}« już nie ma. Obowiązują ustawienia ogólne.`, target: 'wzor'});
  // DA-21: domyślny termin liczy się od rozpoczęcia, więc ostrzeżenie dotyczy tylko terminu wpisanego ręcznie.
  const term = m.kind === 'procedura' ? procedureEndAt(m, env.general, now) : null;
  if (term && !term.fromStart && term.endsAt - now < PROCEDURE_MIN_HOURS * 3600000) {
    rows.push({group: 'sprawdzic', text: `Głosowanie potrwa krócej niż ${PROCEDURE_MIN_HOURS} godziny. Przy rozpoczęciu trzeba będzie podać powód.`, target: 'termin'});
  }
  const top = m.agenda.filter(i => !i.parentId).length, sub = m.agenda.length - top;
  if (posiedzenie) {
    rows.push({group: 'gotowe', text: `Projekt porządku obrad, ${top} ${plural(top, 'punkt', 'punkty', 'punktów')}${sub ? ` i ${sub} ${plural(sub, 'podpunkt', 'podpunkty', 'podpunktów')}` : ''}.`});
  } else {
    rows.push({group: 'gotowe', text: `${top} ${plural(top, 'sprawa', 'sprawy', 'spraw')} do głosowania.`});
  }
  const advisory = (env.accounts ?? []).filter(a => a.kind === 'doradczy' && !a.disabled && m.invited.includes(a.id)).length;
  if (advisory) rows.push({group: 'gotowe', text: `Głos doradczy, ${advisory} ${plural(advisory, 'osoba zawiadamiana', 'osoby zawiadamiane', 'osób zawiadamianych')} o każdym posiedzeniu (${law.advisory.basis}).`, target: 'goscie'});
  return rows;
}

/**
 * Linia źródła wartości (rozdz. 2.6, tabela brzmień). `at` mówi, gdzie wartość jest oglądana, `show` formatuje wartość,
 * a `houseBy` to „przez Izbę” w aplikacji i pusty napis w wersji próbnej.
 */
export function sourceText(e: Effective<unknown>, o: {at: 'ogolne' | 'wzor' | 'posiedzenie' | 'punkt' | 'obrady'; show: (v: unknown) => string; houseBy: string}): string {
  if (e.frozen && !['prawo', 'zasada', 'aplikacja'].includes(e.source)) return e.legacy ? 'Zapisane przy przejściu na wersję 3.' : 'Ustalone przy otwarciu posiedzenia.';
  if (e.via?.kind === 'rodzaj_sprawy') return `Wynika z rodzaju sprawy »${e.via.name}«.`;
  if (e.via?.kind === 'rodzaj_dokumentu' && e.source === 'prawo') return `Wynika z rodzaju dokumentu »${e.via.name}« (${e.via.basis ?? e.basis}).`;
  if (e.via?.kind === 'material') return `Wynika z materiału »${e.via.name}«.`;
  switch (e.source) {
    case 'prawo': return e.basis ? `Ustalone regulaminem, ${e.basis}.` : 'Ustalone regulaminem.';
    case 'zasada': {
      const rule = HOUSE_RULES.find(r => r.id === e.rule);
      return [`Zasada przyjęta`, o.houseBy, rule ? dateDots(rule.date) : ''].filter(Boolean).join(' ') + '.';
    }
    case 'aplikacja': {
      const rule = APP_RULES.find(r => r.id === e.appRule);
      return rule ? `Ustalone w aplikacji. ${rule.text}` : 'Ustalone w aplikacji.';
    }
    case 'ogolne':
      if (o.at === 'ogolne') return 'Ustawienie ogólne.';
      return o.at === 'punkt' ? 'Jak w ustawieniach posiedzenia.' : 'Jak w ustawieniach ogólnych.';
    case 'szablon':
      if (o.at === 'wzor' && e.inherited !== undefined) return `Zmienione dla tego wzoru. W ustawieniach ogólnych ${o.show(e.inherited)}.`;
      if (o.at === 'punkt') return 'Jak w ustawieniach posiedzenia.';
      return `Jak we wzorze posiedzenia »${e.via?.name ?? ''}«.`;
    case 'posiedzenie':
      if (o.at === 'punkt') return 'Jak w ustawieniach posiedzenia.';
      if (e.stamp?.copiedFrom) return `Skopiowane z posiedzenia z dnia ${dateDots(e.stamp.copiedFrom) || e.stamp.copiedFrom}.`;
      if (e.inherited === undefined) return 'Zmienione dla tego posiedzenia.';
      return `Zmienione dla tego posiedzenia. ${e.inheritedSource === 'szablon' ? 'We wzorze posiedzenia' : 'W ustawieniach ogólnych'} ${o.show(e.inherited)}.`;
    case 'punkt':
      if (e.stamp?.copiedFrom) return `Skopiowane z posiedzenia z dnia ${dateDots(e.stamp.copiedFrom) || e.stamp.copiedFrom}.`;
      return e.inherited !== undefined && e.inheritedSource === 'posiedzenie' ? `Zmienione dla tego punktu. W ustawieniach posiedzenia ${o.show(e.inherited)}.` : 'Zmienione dla tego punktu.';
    case 'obrady': {
      const at = e.stamp ? ` o godz. ${timeOf(e.stamp.at)}` : '';
      return `Zmienione w trakcie obrad${at}.${e.stamp?.reason ? ` Powód ${quote(e.stamp.reason.replace(/\.$/, ''))}.` : ''}`;
    }
  }
  return '';
}
/** Ślad pod wartością zmienioną: „Zmiana 20.11.2026, godz. 11:15, konto Biuro Izby.” */
export const stampText = (s: Stamp) => `Zmiana ${dateDotsOf(s.at)}, godz. ${timeOf(s.at)}, konto ${s.by}.`;

/**
 * Podstawa rozstrzygnięcia pod liczbami (L3-06, O-06). Tylko dla głosowań z widocznym wynikiem: wywołujący nie podaje
 * głosowań, których wyniku osoba jeszcze nie widzi.
 */
export function basisSentences(env: CascadeEnv, m: Meeting, b: Ballot): string[] {
  if (!b.result || b.purpose === 'proba' || b.aborted) return [];
  const law = env.law;
  const out = [`Zwykła większość głosów, więcej głosów za niż przeciw (${law.majority.basis}).`];
  if (b.remote) {
    out.push(`W głosowaniu ${b.result.participants} z ${b.membersTotal} członków, wymagane co najmniej ${b.quorum} (${law.betweenMeetings.allowed ? law.betweenMeetings.quorumBasis ?? law.quorum.basis : law.quorum.basis}). Kworum ${b.result.quorumMet ? 'było zachowane' : 'nie było zachowane'}.`);
  } else {
    out.push(`Kworum ${b.quorum} z ${b.membersTotal} (${law.quorum.basis}) ${b.result.quorumMet ? 'było zachowane' : 'nie było zachowane'}.`);
  }
  if (b.mode !== 'jawne') {
    const what = b.mode === 'tajne' ? 'Tajność głosowania' : 'Głosowanie imienne';
    const verb = organSubject(env) === 'Prezydium' ? 'uchwaliło' : env.organ.forms.gender === 'f' ? 'uchwaliła' : env.organ.forms.gender === 'm' ? 'uchwalił' : 'uchwaliło';
    const motion = m.ballots.find(x => x.target?.kind === 'tryb' && x.target.itemId === b.itemId && x.target.mode === b.mode && x.result?.adopted && x.announcedAt);
    const item = m.agenda.find(i => i.id === b.itemId);
    if (motion && motion.target?.kind === 'tryb') {
      out.push(`${what} ${organSubject(env)} ${verb} w głosowaniu nr ${motion.number} (§ 11 ust. 2).`);
      if (motion.target.proposedBy) out.push(`Wniosek zgłasza ${who(env, m, motion.target.proposedBy)}.`);
    } else if (item?.modeAct) {
      out.push(item.modeAct.kind === 'uchwala'
        ? `${what} ${organSubject(env)} ${verb} uchwałą nr ${item.modeAct.number} z dnia ${dateDots(item.modeAct.date)} (§ 11 ust. 2).`
        : `${what} ${organSubject(env)} ${verb} w głosowaniu nr ${item.modeAct.number} na posiedzeniu z dnia ${dateDots(item.modeAct.date)} (§ 11 ust. 2).`);
    } else if (b.modeBasis) {
      out.push(`${what} ${b.modeBasis} (§ 11 ust. 2).`);
    }
  }
  return out;
}

/**
 * Treść zawiadomienia z wzoru organu i danych posiedzenia (U-15, dodatek; § 7 ust. 1). Dane wstawia się bez odmiany (I-17):
 * termin „3 grudnia 2026 r., godz. 10:00”, miejsce (przy posiedzeniu zdalnym „posiedzenie zdalne” i odnośnik), porządek
 * obrad z numerami punktów, nazwa organu w dopełniaczu i odnośnik do połączenia. Tekst bez twardych spacji, do skopiowania.
 */
export function noticeText(env: Pick<CascadeEnv, 'general' | 'organ'>, m: Pick<Meeting, 'organ' | 'date' | 'time' | 'place' | 'mode' | 'link' | 'agenda'>): string {
  const template = noticeTemplateOf(organSettingsOf(env.general, m.organ));
  const day = /^\d{4}-\d{2}-\d{2}$/.test(m.date) ? new Intl.DateTimeFormat('pl-PL', {timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric'}).format(Date.parse(m.date + 'T12:00:00Z')) + ' r.' : m.date;
  const remote = m.mode === 'zdalne';
  const link = remote ? m.link || 'odnośnik do połączenia nie jest jeszcze wpisany' : m.link;
  const place = remote ? `posiedzenie zdalne, ${link}` : m.place || 'miejsce nie jest jeszcze wpisane';
  // Kropka na końcu tytułu znika, ale nie po skrócie („… z dnia 22 października 2026 r.”).
  // Bez wyrażeń wstecznych (lookbehind), bo cel kompilacji to ES2020 i starsze przeglądarki ich nie znają.
  const title = (t: string) => { const s = t.replace(/\s+$/, ''); return /(^|[\s(])(r|nr|ust|pkt|art|godz|np|tj|tzw|ok|im|ul|al|św)\.$/u.test(s) ? s : s.replace(/\.+$/, ''); };
  const agenda = orderedAgenda(m.agenda).filter(i => i.status !== 'wycofany').map(i => `${itemNumber(m.agenda, i.id)}. ${title(i.title)}`).join('\n');
  const values: Record<string, string> = {
    [NOTICE_TAGS.termin]: `${day}, godz. ${m.time}`, [NOTICE_TAGS.miejsce]: place, [NOTICE_TAGS.porzadek]: agenda,
    [NOTICE_TAGS.organ]: env.organ.forms.genitive, [NOTICE_TAGS.odnosnik]: link,
  };
  return template.replace(/\[[^\]\n]{1,40}\]/g, tag => values[tag] ?? tag);
}

/** Tytuł rodzaju sprawy w propozycji: „Propozycja »…«, bo tytuł zawiera słowo „…”.” albo null bez propozycji. */
export function guessText(env: Pick<CascadeEnv, 'general'>, organ: OrganCode, it: Pick<AgendaItem, 'title' | 'caseTypeGuess'>): string | null {
  if (!it.caseTypeGuess) return null;
  const match = matchCaseType(env.general.caseTypes, organ, it.title);
  const c = env.general.caseTypes.find(x => x.id === it.caseTypeGuess);
  if (!c) return null;
  return match?.id === c.id ? `Propozycja »${c.name}«, bo tytuł zawiera ${match.keyword.includes(' ') ? 'słowa' : 'słowo'} „${match.keyword}”.` : `Propozycja »${c.name}«.`;
}
