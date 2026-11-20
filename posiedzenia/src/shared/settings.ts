import type {Actor, ActRef, CompositionBasis, DocType, Func, ItemKind, MeetingMode, MeetingSettings, Membership, OrganCode, Roster} from './types.ts';
import {lawOf, agendaBasis, type LegalProfile} from './law.ts';
import {presidiumTemplate, itemKindLabel} from './agenda.ts';
import {organMembers, organOfCode} from './roster.ts';
import {dateDots, hoursText, minutesText, plural} from './text.ts';

export type {ActRef, CompositionBasis} from './types.ts';

// Poziom 1 kaskady ustawień (specyfikacja wersji 3, rozdz. 2.3): ustawienia ogólne, wzory posiedzeń, rodzaje spraw
// i skład organów. Zmienia je biuro (rodzaje dokumentów i skład też), konta administrator. Walidacja jest tylko tutaj,
// więc serwer i wersja próbna odrzucają to samo.

/** Dawne ustawienia siedziby; nazwa bez słowa „Izba” (wersja próbna). */
export interface SiteSettings {
  place: string;
  term: string;
  termNumber: string;
  /** Dodatek (D): wzór numeru protokołu, np. „[numer]/[kadencja]/[rok]”; pusty napis to brak propozycji. */
  protocolNumberPattern: string;
}
export interface TemplateItem { title: string; kind: ItemKind; docType?: string; caseType?: string; presenterFunc?: Func; children?: TemplateItem[] }
/** Wzór posiedzenia: punkty i ustawienia, od których zaczyna się nowe posiedzenie. */
export interface MeetingTemplate {
  id: string; name: string; items: TemplateItem[];
  settings?: Partial<MeetingSettings>;
  defaults?: {time?: string; mode?: MeetingMode; recorder?: string};
}
export interface OrganSettings {
  voteMinutes: number;
  motionMinutes: number;
  procedureHours: number;
  recorder: string;
  templates: MeetingTemplate[];
  seats?: {count: number; act: ActRef};
  /** Dodatek (D). */
  messagesFromStart?: boolean;
  /** Dodatek (D). */
  noticeTemplate?: string;
}
export interface CaseType {
  id: string; name: string;
  docType: string;
  organs: OrganCode[];
  financial: boolean;
  keywords: string[];
  titlePattern: string;
  presenterFunc?: Func;
  basis?: ActRef;
  order: number; active: boolean;
}
export interface GeneralSettings { site: SiteSettings; organs: Partial<Record<OrganCode, OrganSettings>>; caseTypes: CaseType[] }
/** Pakiet dla klienta i dla domeny: ustawienia, słownik rodzajów dokumentów i jedna rewizja wszystkiego, co zmienia biuro. */
export interface GeneralBundle { general: GeneralSettings; docTypes: DocType[]; revision: number }

export type SettingsArea = 'siedziba' | 'organ' | 'wzory' | 'rodzaje_dokumentow' | 'rodzaje_spraw' | 'sklad' | 'konta' | 'posiedzenia';
export interface AuditEntry {
  id: number; at: number; accountId: string; actor: string;
  area: SettingsArea; organ?: OrganCode; key: string; label: string; before: string; after: string; basis?: string;
}
export type SettingsChange =
  | {area: 'siedziba'; key: keyof SiteSettings; value: string}
  | {area: 'organ'; organ: OrganCode; key: Exclude<keyof OrganSettings, 'templates' | 'seats'>; value: number | boolean | string}
  | {area: 'wzory'; organ: OrganCode; template: MeetingTemplate}
  | {area: 'wzory'; organ: OrganCode; remove: string}
  | {area: 'rodzaje_spraw'; caseType: Partial<CaseType>};
export interface CompositionChange {
  organ: OrganCode; op: 'dodaj' | 'funkcja' | 'koniec' | 'liczba';
  personId?: string; name?: string;
  func?: Func; label?: string; count?: number;
  since: string;
  basis: CompositionBasis;
}

/** Dozwolone czasy głosowania w sprawie i głosowań nad wnioskami (G-3). */
export const VOTE_MINUTES = [1, 2, 3, 5, 10, 15];
export const MOTION_MINUTES = [1, 2, 3, 5];
export const PROCEDURE_HOURS = {min: 24, max: 336};
export const FUNCS: Func[] = ['przewodniczacy', 'wiceprzewodniczacy', 'sekretarz', 'skarbnik', 'czlonek'];
const ITEM_KINDS: ItemKind[] = ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie', 'sprawa'];

/** Pierwszy wzór posiedzenia Prezydium: dzisiejszy szablon (src/shared/agenda.ts, presidiumTemplate). */
export const presidiumMeetingTemplate: MeetingTemplate = {id: 'zwykle', name: 'Posiedzenie zwykłe', items: presidiumTemplate.map(([title, kind]) => ({title, kind}))};
export const defaultOrganSettings: OrganSettings = {voteMinutes: 2, motionMinutes: 2, procedureHours: 24, recorder: '', templates: [presidiumMeetingTemplate]};
export function defaultGeneral(site: SiteSettings): GeneralSettings {
  return {site: {...site}, organs: {prezydium: structuredClone(defaultOrganSettings)}, caseTypes: []};
}
/** Ustawienia organu: zapisane albo domyślne (np. dla danych bez wpisu). */
export const organSettingsOf = (g: GeneralSettings, organ: OrganCode): OrganSettings => g.organs[organ] ?? defaultOrganSettings;

const bad = (message: string, status = 400): never => { throw Object.assign(new Error(message), {status}); };
const clean = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max + 1) : '';
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T12:00:00Z'));
const tooLong = (max: number) => `Tekst może mieć najwyżej ${max} ${plural(max, 'znak', 'znaki', 'znaków')}.`;
function text(v: unknown, max: number, missing?: string) {
  const t = clean(v, max);
  if (!t && missing) bad(missing);
  if (t.length > max) bad(tooLong(max));
  return t;
}
const available = (organ: OrganCode) => { if (!lawOf(organ).available) bad('Posiedzeń tego organu nie prowadzimy jeszcze w aplikacji.'); };
/** Słowo z nazwy: małe litery bez polskich znaków, np. „Pomoc w przypadkach losowych” daje „pomoc_w_przypadkach_losowych”. */
export function slug(name: string, taken: string[], fallback: string) {
  const base = name.toLocaleLowerCase('pl').replace(/[ąćęłńóśźż]/g, c => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)])
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || fallback;
  let id = base, n = 2;
  while (taken.includes(id)) id = `${base}_${n++}`;
  return id;
}

const siteLabels: Record<keyof SiteSettings, string> = {place: 'Domyślne miejsce posiedzeń', term: 'Nazwa kadencji', termNumber: 'Numer kadencji', protocolNumberPattern: 'Wzór numeru protokołu'};
const organLabels: Record<string, string> = {
  voteMinutes: 'Czas głosowania w sprawie', motionMinutes: 'Czas głosowań nad wnioskami', procedureHours: 'Czas trwania głosowania między posiedzeniami',
  recorder: 'Protokolant domyślny', messagesFromStart: 'Kanał wiadomości na posiedzeniu stacjonarnym', noticeTemplate: 'Wzór zawiadomienia',
};
/** Ustawienia z dodatków (D), których rdzeń wersji 3 jeszcze nie zmienia. */
const addOns = new Set(['protocolNumberPattern', 'messagesFromStart', 'noticeTemplate']);
const addOnRefusal = 'Tego ustawienia nie można jeszcze zmienić.';
const shown = (v: string) => v ? `„${v}”` : 'brak';

/** Krótki opis wzoru do historii zmian, np. „7 punktów, czas głosowania w sprawie 2 minuty”. */
export function templateSummary(t: MeetingTemplate, organ: OrganSettings) {
  const count = t.items.length + t.items.reduce((n, i) => n + (i.children?.length ?? 0), 0);
  const parts = [`${count} ${plural(count, 'punkt', 'punkty', 'punktów')}`,
    `czas głosowania w sprawie ${minutesText(t.settings?.voteMinutes ?? organ.voteMinutes)}`,
    `czas głosowań nad wnioskami ${minutesText(t.settings?.motionMinutes ?? organ.motionMinutes)}`];
  if (t.defaults?.time) parts.push(`godzina ${t.defaults.time}`);
  if (t.defaults?.mode) parts.push(`tryb ${t.defaults.mode}`);
  if (t.defaults?.recorder) parts.push(`protokolant ${t.defaults.recorder}`);
  return parts.join(', ');
}

/** Niezmiennik porządku obrad dla wzoru posiedzenia (G-2): punkty obowiązkowe po jednym, punkty z § 9 ust. 2 obecne. */
export function templateViolation(law: LegalProfile, items: TemplateItem[]): string | null {
  for (const kind of law.agenda.mandatory) {
    const count = items.filter(i => i.kind === kind).length + items.reduce((n, i) => n + (i.children ?? []).filter(c => c.kind === kind).length, 0);
    if (count === 0) return `Tego punktu nie można usunąć ze wzoru. Regulamin wymienia go w porządku obrad (${agendaBasis(law, kind)}).`;
    if (count > 1) return `Punkt „${itemKindLabel[kind]}” może wystąpić w porządku tylko raz.`;
  }
  for (const kind of Object.keys(law.agenda.listed) as ItemKind[]) {
    if (!items.some(i => i.kind === kind || (i.children ?? []).some(c => c.kind === kind))) return `Tego punktu nie można usunąć ze wzoru. Regulamin wymienia go w porządku obrad (${agendaBasis(law, kind)}).`;
  }
  return null;
}

function templateInput(raw: MeetingTemplate, organ: OrganCode, b: GeneralBundle, existing: MeetingTemplate[]): MeetingTemplate {
  const law = lawOf(organ);
  if (!raw || typeof raw !== 'object') bad('Nieprawidłowy wzór posiedzenia.');
  const name = text(raw.name, 80, 'Wpisz nazwę wzoru.');
  if (existing.some(t => t.id !== raw.id && t.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) bad('Wzór o tej nazwie już istnieje. Wpisz inną nazwę.', 409);
  if (!Array.isArray(raw.items)) bad('Nieprawidłowe punkty wzoru.');
  const item = (x: TemplateItem, child: boolean): TemplateItem => {
    const out: TemplateItem = {title: text(x?.title, 400, 'Wpisz nazwę punktu.'), kind: ITEM_KINDS.includes(x?.kind) ? x.kind : bad('Wybierz rodzaj punktu.')};
    if (child && out.kind !== 'sprawa') bad('Podpunkt wzoru jest zwykłą sprawą.');
    if (x.docType) { if (!b.docTypes.some(t => t.id === x.docType)) bad('Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.'); out.docType = x.docType; }
    if (x.caseType) { if (!b.general.caseTypes.some(c => c.id === x.caseType)) bad('Nieznany rodzaj sprawy. Wybierz rodzaj z listy.'); out.caseType = x.caseType; }
    if (x.presenterFunc) { if (!FUNCS.includes(x.presenterFunc)) bad('Wybierz funkcję osoby referującej z listy.'); out.presenterFunc = x.presenterFunc; }
    if (!child && Array.isArray(x.children) && x.children.length) out.children = x.children.map(c => item(c, true));
    return out;
  };
  const items = raw.items.map(x => item(x, false));
  const count = items.length + items.reduce((n, i) => n + (i.children?.length ?? 0), 0);
  if (count > 40) bad('Wzór może mieć najwyżej 40 punktów.');
  const violation = templateViolation(law, items);
  if (violation) bad(violation);
  const out: MeetingTemplate = {id: raw.id && typeof raw.id === 'string' ? raw.id.slice(0, 40) : slug(name, existing.map(t => t.id), 'wzor'), name, items};
  const settings: Partial<MeetingSettings> = {};
  if (raw.settings?.voteMinutes !== undefined && raw.settings.voteMinutes !== null) settings.voteMinutes = minutesInput(raw.settings.voteMinutes, VOTE_MINUTES);
  if (raw.settings?.motionMinutes !== undefined && raw.settings.motionMinutes !== null) settings.motionMinutes = minutesInput(raw.settings.motionMinutes, MOTION_MINUTES);
  if (raw.settings?.messagesFromStart !== undefined) bad(addOnRefusal);
  if (Object.keys(settings).length) out.settings = settings;
  const defaults: NonNullable<MeetingTemplate['defaults']> = {};
  if (raw.defaults?.time) { if (!/^\d{2}:\d{2}$/.test(raw.defaults.time)) bad('Nieprawidłowa godzina.'); defaults.time = raw.defaults.time; }
  if (raw.defaults?.mode) {
    if (raw.defaults.mode !== 'stacjonarne' && raw.defaults.mode !== 'zdalne') bad('Nieprawidłowy tryb.');
    if (raw.defaults.mode === 'zdalne' && !law.remote.allowed) bad(law.remote.reason);
    defaults.mode = raw.defaults.mode;
  }
  if (raw.defaults?.recorder) defaults.recorder = text(raw.defaults.recorder, 120);
  if (Object.keys(defaults).length) out.defaults = defaults;
  return out;
}

function minutesInput(v: unknown, allowed: number[]) {
  const n = Number(v);
  if (!allowed.includes(n)) bad('Wybierz czas z listy.');
  return n;
}

function actRefInput(v: unknown, fallbackOrgan: OrganCode): ActRef {
  const a = (v ?? {}) as Partial<ActRef>;
  const number = clean(a.number, 60);
  if (!number || !isDay(a.date)) bad('Wpisz numer i datę uchwały.');
  if (number.length > 60) bad(tooLong(60));
  const organ = a.organ && ['prezydium', 'rada', 'zjazd'].includes(a.organ) ? a.organ : fallbackOrgan;
  return {organ, number, date: a.date as string};
}

function caseTypeInput(raw: Partial<CaseType>, b: GeneralBundle): CaseType {
  if (!raw || typeof raw !== 'object') bad('Nieprawidłowy rodzaj sprawy.');
  const current = raw.id ? b.general.caseTypes.find(c => c.id === raw.id) ?? bad('Nie znaleziono rodzaju sprawy.', 404) : undefined;
  const has = (k: keyof CaseType) => raw[k] !== undefined;
  const name = has('name') || !current ? text(raw.name, 80, 'Wpisz nazwę rodzaju sprawy.') : current.name;
  if (b.general.caseTypes.some(c => c.id !== current?.id && c.name.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) bad('Rodzaj sprawy o tej nazwie już istnieje. Wpisz inną nazwę.', 409);
  let docType = current?.docType ?? '';
  if (has('docType') || !current) {
    const type = b.docTypes.find(t => t.id === raw.docType) ?? bad('Wybierz, co jest głosowane.');
    if (!type.active && type.id !== current?.docType) bad('Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.');
    docType = type.id;
  }
  let organs = current?.organs ?? ['prezydium'];
  if (has('organs')) {
    if (!Array.isArray(raw.organs) || !raw.organs.length) bad('Wybierz organ.');
    for (const o of raw.organs!) available(o);
    organs = [...new Set(raw.organs!)];
  }
  if (has('financial') && typeof raw.financial !== 'boolean') bad('Zaznacz, czy to sprawa finansowa.');
  let keywords = current?.keywords ?? [];
  if (has('keywords')) {
    if (!Array.isArray(raw.keywords)) bad('Nieprawidłowe słowa w tytule punktu.');
    keywords = [...new Set(raw.keywords!.map(k => clean(k, 40).toLocaleLowerCase('pl')).filter(Boolean))];
    if (keywords.some(k => k.length < 2 || k.length > 40)) bad('Słowo może mieć od 2 do 40 znaków.');
    if (keywords.length > 10) bad('Wpisz najwyżej 10 słów.');
  }
  const titlePattern = has('titlePattern') ? text(raw.titlePattern, 200) : current?.titlePattern ?? '';
  let presenterFunc = current?.presenterFunc;
  if (has('presenterFunc')) {
    if (raw.presenterFunc && !FUNCS.includes(raw.presenterFunc)) bad('Wybierz funkcję osoby referującej z listy.');
    presenterFunc = raw.presenterFunc || undefined;
  }
  let basis = current?.basis;
  if (has('basis')) basis = raw.basis ? actRefInput(raw.basis, 'rada') : undefined;
  if (has('order') && !(Number.isInteger(raw.order) && raw.order! >= 0 && raw.order! <= 9999)) bad('Kolejność musi być liczbą całkowitą od 0 do 9999.');
  if (has('active') && typeof raw.active !== 'boolean') bad('Nieprawidłowy stan rodzaju sprawy.');
  const last = b.general.caseTypes.reduce((max, c) => Math.max(max, c.order), 0);
  const out: CaseType = {
    id: current?.id ?? slug(name, b.general.caseTypes.map(c => c.id), 'sprawa'), name, docType, organs,
    financial: has('financial') ? raw.financial! : current?.financial ?? false, keywords, titlePattern,
    order: has('order') ? raw.order! : current?.order ?? last + 10, active: has('active') ? raw.active! : current?.active ?? true,
  };
  if (presenterFunc) out.presenterFunc = presenterFunc;
  if (basis) out.basis = basis;
  return out;
}

const funcName: Record<Func, string> = {przewodniczacy: 'Przewodniczący', wiceprzewodniczacy: 'Wiceprzewodniczący', sekretarz: 'Sekretarz', skarbnik: 'Skarbnik', czlonek: 'Członek'};
/** Nazwa funkcji do list wyboru i historii, np. „Wiceprzewodniczący”; członek organu z nazwą organu, np. „Członek Prezydium”. */
export function funcLabel(func: Func, organ: OrganCode) {
  if (func !== 'czlonek') return funcName[func];
  return organ === 'prezydium' ? 'Członek Prezydium' : funcName.czlonek;
}

const caseTypeLabel = (c: CaseType) => `Rodzaj sprawy „${c.name}”`;
const caseTypeFields: [keyof CaseType, string, (c: CaseType, b: GeneralBundle) => string][] = [
  ['name', 'nazwa', c => shown(c.name)],
  ['docType', 'co jest głosowane', (c, b) => shown(b.docTypes.find(t => t.id === c.docType)?.name ?? c.docType)],
  ['financial', 'sprawa finansowa', c => c.financial ? 'tak' : 'nie'],
  ['keywords', 'słowa w tytule punktu', c => c.keywords.length ? c.keywords.join(', ') : 'brak'],
  ['titlePattern', 'wzór tytułu punktu', c => shown(c.titlePattern)],
  ['presenterFunc', 'domyślnie referuje', c => c.presenterFunc ? funcLabel(c.presenterFunc, c.organs[0] ?? 'prezydium') : 'brak'],
  ['basis', 'podstawa przekazania', c => c.basis ? `uchwała nr ${c.basis.number} z ${dateDots(c.basis.date)}` : 'brak'],
  ['order', 'kolejność', c => String(c.order)],
  ['active', 'stan', c => c.active ? 'włączony' : 'wyłączony'],
];

/**
 * Zmiana ustawień ogólnych przez biuro. Zwraca nowy pakiet (rewizja +1, gdy coś się zmieniło) i wpisy historii zmian
 * z wartością przed i po w języku interfejsu. Błędy mają `status` (400 dane, 404 brak, 409 konflikt).
 */
export function applySettingsChange(b: GeneralBundle, change: SettingsChange, env: {actor: Actor; now: number; roster: Roster}): {bundle: GeneralBundle; audit: Omit<AuditEntry, 'id'>[]} {
  const next: GeneralBundle = structuredClone(b);
  const audit: Omit<AuditEntry, 'id'>[] = [];
  const entry = (e: Pick<AuditEntry, 'area' | 'key' | 'label' | 'before' | 'after'> & {organ?: OrganCode; basis?: string}) => {
    if (e.before !== e.after) audit.push({at: env.now, accountId: env.actor.account.id, actor: env.actor.name, ...e});
  };
  if (!change || typeof change !== 'object') bad('Nieprawidłowa zmiana ustawień.');
  switch (change.area) {
    case 'siedziba': {
      if (!(change.key in siteLabels)) bad('Nieznane ustawienie.');
      if (addOns.has(change.key)) bad(addOnRefusal);
      const max = change.key === 'termNumber' ? 10 : 200;
      const value = text(change.value, max, change.key === 'place' ? 'Wpisz miejsce posiedzeń.' : change.key === 'term' ? 'Wpisz nazwę kadencji.' : 'Wpisz numer kadencji.');
      const before = next.general.site[change.key];
      next.general.site[change.key] = value;
      entry({area: 'siedziba', key: change.key, label: siteLabels[change.key], before: shown(before), after: shown(value)});
      break;
    }
    case 'organ': {
      available(change.organ);
      if (!(change.key in organLabels)) bad('Nieznane ustawienie.');
      if (addOns.has(change.key)) bad(addOnRefusal);
      const organ = next.general.organs[change.organ] ??= structuredClone(defaultOrganSettings);
      let before = '', after = '';
      if (change.key === 'voteMinutes' || change.key === 'motionMinutes') {
        const value = minutesInput(change.value, change.key === 'voteMinutes' ? VOTE_MINUTES : MOTION_MINUTES);
        before = minutesText(organ[change.key]); after = minutesText(value);
        organ[change.key] = value;
      } else if (change.key === 'procedureHours') {
        const value = Number(change.value);
        if (!Number.isInteger(value) || value < PROCEDURE_HOURS.min || value > PROCEDURE_HOURS.max) bad('Ustaw od 24 do 336 godzin.');
        before = hoursText(organ.procedureHours); after = hoursText(value);
        organ.procedureHours = value;
      } else if (change.key === 'recorder') {
        const value = text(change.value, 120);
        before = shown(organ.recorder); after = shown(value);
        organ.recorder = value;
      }
      entry({area: 'organ', organ: change.organ, key: change.key, label: organLabels[change.key], before, after});
      break;
    }
    case 'wzory': {
      available(change.organ);
      const organ = next.general.organs[change.organ] ??= structuredClone(defaultOrganSettings);
      if ('remove' in change) {
        const at = organ.templates.findIndex(t => t.id === change.remove);
        if (at < 0) bad('Nie znaleziono wzoru posiedzenia.', 404);
        if (organ.templates.length <= 1) bad('Nie można usunąć ostatniego wzoru posiedzenia.');
        const [removed] = organ.templates.splice(at, 1);
        entry({area: 'wzory', organ: change.organ, key: `wzor:${removed.id}`, label: `Wzór posiedzenia „${removed.name}”`, before: templateSummary(removed, organ), after: 'usunięty'});
        break;
      }
      const t = templateInput(change.template, change.organ, next, organ.templates);
      const at = organ.templates.findIndex(x => x.id === t.id);
      const before = at >= 0 ? organ.templates[at] : undefined;
      if (at >= 0) organ.templates[at] = t; else organ.templates.push(t);
      const beforeText = before ? templateSummary(before, organ) : 'brak';
      let afterText = templateSummary(t, organ);
      if (before && beforeText === afterText && JSON.stringify(before) !== JSON.stringify(t)) afterText += ' (zmienione punkty albo nazwa)';
      entry({area: 'wzory', organ: change.organ, key: `wzor:${t.id}`, label: `Wzór posiedzenia „${t.name}”`, before: beforeText, after: afterText});
      break;
    }
    case 'rodzaje_spraw': {
      const c = caseTypeInput(change.caseType, next);
      const at = next.general.caseTypes.findIndex(x => x.id === c.id);
      const before = at >= 0 ? next.general.caseTypes[at] : undefined;
      if (at >= 0) next.general.caseTypes[at] = c; else next.general.caseTypes.push(c);
      if (!before) entry({area: 'rodzaje_spraw', key: `rodzaj:${c.id}`, label: caseTypeLabel(c), before: 'brak', after: 'dodany'});
      else for (const [key, label, show] of caseTypeFields) {
        entry({area: 'rodzaje_spraw', key: `rodzaj:${c.id}:${key}`, label: `${caseTypeLabel(c)}, ${label}`, before: show(before, b), after: show(c, next)});
      }
      break;
    }
    default: bad('Nieznany obszar ustawień.');
  }
  if (audit.length) next.revision = b.revision + 1;
  else return {bundle: b, audit};
  return {bundle: next, audit};
}

/** Podstawa zmiany składu słowami, do historii, przeglądu i protokołu. */
export function compositionBasisText(basis: CompositionBasis, roster: Roster): string {
  const act = (a: ActRef) => `Uchwała ${organOfCode(roster, a.organ).forms.genitive} nr ${a.number} z ${dateDots(a.date)}`;
  if (basis.kind === 'uchwala') return act(basis.act);
  if (basis.kind === 'rezygnacja') return `Rezygnacja złożona ${dateDots(basis.date)} ${basis.to}`;
  const stated = basis.act ? `${act(basis.act).replace(/^Uchwała/, 'uchwała')}` : 'uchwała stwierdzająca do dopisania';
  return `Wygaśnięcie mandatu ${dateDots(basis.date)}, ${basis.event}, ${stated}`;
}

function basisInput(raw: CompositionBasis, onlyAct: boolean): CompositionBasis {
  const b = (raw ?? {}) as Partial<CompositionBasis> & Record<string, unknown>;
  if (onlyAct && b.kind !== 'uchwala') bad('Wpisz numer i datę uchwały.');
  if (b.kind === 'uchwala') return {kind: 'uchwala', act: actRefInput(b.act, 'rada')};
  if (b.kind === 'rezygnacja') {
    const to = clean(b.to, 200);
    if (!isDay(b.date) || !to) bad('Wpisz datę rezygnacji i to, komu ją złożono.');
    if (to.length > 200) bad(tooLong(200));
    return {kind: 'rezygnacja', date: b.date as string, to};
  }
  if (b.kind === 'wygasniecie') {
    const event = clean(b.event, 200);
    if (!isDay(b.date) || !event) bad('Wpisz, co się stało i kiedy.');
    if (event.length > 200) bad(tooLong(200));
    const out: CompositionBasis = {kind: 'wygasniecie', date: b.date as string, event};
    if (b.act) out.act = actRefInput(b.act, 'rada');
    return out;
  }
  return bad('Ta zmiana wymaga podstawy. Wpisz, na czym się opiera.');
}

/** Komunikat G-5 dla niepełnej podstawy albo null, gdy podstawa jest kompletna (np. powód nieaktywnego „Zapisz”). */
export function basisProblem(basis: CompositionBasis | null | undefined, onlyAct = false): string | null {
  try { basisInput(basis as CompositionBasis, onlyAct); return null; } catch (e) { return (e as Error).message; }
}

/**
 * Zmiana składu organu z podstawą (DA-13, G-5). Zmiana obowiązuje od `since` (najpóźniej dziś) i nie czeka na koniec
 * posiedzeń: trwających nie dotyczy, bo ich skład zapisano przy otwarciu. `canChair` wylicza się z funkcji i profilu.
 */
export function applyCompositionChange(roster: Roster, settings: OrganSettings, change: CompositionChange, env: {actor: Actor; now: number; today: string; newId: () => string}):
  {roster: Roster; settings: OrganSettings; audit: Omit<AuditEntry, 'id'>[]} {
  if (!change || typeof change !== 'object') bad('Nieprawidłowa zmiana składu.');
  available(change.organ);
  const law = lawOf(change.organ);
  if (!['dodaj', 'funkcja', 'koniec', 'liczba'].includes(change.op)) bad('Wybierz rodzaj zmiany.');
  if (!isDay(change.since)) bad('Wpisz datę, od której zmiana obowiązuje.');
  if (change.since > env.today) bad('Zmianę składu wpisz w dniu, od którego obowiązuje, albo później.');
  const basis = basisInput(change.basis, change.op === 'liczba');
  const next: Roster = structuredClone(roster);
  const nextSettings: OrganSettings = structuredClone(settings);
  const members = () => organMembers(next, change.organ);
  const organ = organOfCode(next, change.organ);
  const label = `Skład ${organ.forms.genitive}`;
  const basisText = compositionBasisText(basis, next);
  const audit: Omit<AuditEntry, 'id'>[] = [];
  const push = (key: string, before: string, after: string) => audit.push({at: env.now, accountId: env.actor.account.id, actor: env.actor.name, area: 'sklad', organ: change.organ, key, label, before, after, basis: basisText});
  const person = (id: string) => next.persons.find(p => p.id === id)?.name ?? id;
  const describe = (ms: Membership) => `${person(ms.personId)}, ${ms.label}`;
  const funcOf = () => FUNCS.includes(change.func!) ? change.func! : bad('Wybierz funkcję.');
  const labelOf = (func: Func) => {
    const l = clean(change.label, 120);
    if (l.length > 120) bad(tooLong(120));
    return l || funcLabel(func, change.organ);
  };
  const oneChairman = (func: Func, personId: string) => {
    if (func === 'przewodniczacy' && members().some(ms => ms.func === 'przewodniczacy' && ms.personId !== personId)) bad('W składzie jest już przewodniczący. Najpierw zmień funkcję albo zakończ członkostwo tej osoby.');
  };
  if (change.op === 'liczba') {
    const count = Number(change.count);
    if (!Number.isInteger(count) || count < 1 || count > 50) bad('Wpisz liczbę miejsc od 1 do 50.');
    const before = settings.seats ? String(settings.seats.count) : 'nie wpisano';
    nextSettings.seats = {count, act: (basis as {act: ActRef}).act};
    audit.push({at: env.now, accountId: env.actor.account.id, actor: env.actor.name, area: 'sklad', organ: change.organ, key: 'miejsca', label: `Liczba miejsc w ${organ.forms.dative}`, before, after: String(count), basis: basisText});
    return {roster: next, settings: nextSettings, audit};
  }
  if (change.op === 'dodaj') {
    const func = funcOf();
    let personId = change.personId ?? '';
    if (personId) {
      if (!next.persons.some(p => p.id === personId)) bad('Wybierz osobę z listy.');
    } else {
      const name = clean(change.name, 120);
      if (name.length < 3) bad('Wpisz imię i nazwisko.');
      if (name.length > 120) bad(tooLong(120));
      personId = slug(name, next.persons.map(p => p.id), 'osoba');
      const parts = name.split(' ');
      next.persons.push({id: personId, name, sortName: parts.length > 1 ? `${parts.at(-1)} ${parts.slice(0, -1).join(' ')}` : name});
    }
    if (members().some(ms => ms.personId === personId)) bad('Ta osoba jest już w składzie.', 409);
    oneChairman(func, personId);
    const order = members().reduce((max, ms) => Math.max(max, ms.order), -1) + 1;
    const ms: Membership = {organ: change.organ, personId, func, label: labelOf(func), order, canChair: law.chair.funcs.includes(func), since: change.since, basis};
    next.memberships.push(ms);
    push(`osoba:${personId}`, 'brak', describe(ms));
  } else {
    const ms = next.memberships.find(x => x.organ === change.organ && x.personId === change.personId) ?? bad('Ta osoba nie jest w składzie.', 404);
    const before = describe(ms);
    if (change.op === 'funkcja') {
      const func = funcOf();
      oneChairman(func, ms.personId);
      Object.assign(ms, {func, label: labelOf(func), canChair: law.chair.funcs.includes(func), since: change.since, basis});
      push(`osoba:${ms.personId}`, before, describe(ms));
    } else {
      next.memberships = next.memberships.filter(x => x !== ms);
      push(`osoba:${ms.personId}`, before, 'koniec członkostwa');
    }
  }
  return {roster: next, settings: nextSettings, audit};
}

/** Rodzaj sprawy z tytułu punktu i słowo, które go wskazało; bez trafienia null (I-13). */
export function matchCaseType(caseTypes: CaseType[], organ: OrganCode, title: string): {id: string; keyword: string} | null {
  const t = title.toLocaleLowerCase('pl');
  for (const c of [...caseTypes].filter(c => c.active && c.organs.includes(organ)).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'pl'))) {
    const keyword = c.keywords.find(k => k && t.includes(k.toLocaleLowerCase('pl')));
    if (keyword) return {id: c.id, keyword};
  }
  return null;
}
/** Rodzaj sprawy proponowany dla tytułu punktu: pierwszy według kolejności rodzaj aktywny w organie, którego słowo zawiera tytuł. */
export const proposeCaseType = (caseTypes: CaseType[], organ: OrganCode, title: string): string | null => matchCaseType(caseTypes, organ, title)?.id ?? null;

/** Wpis historii zmian rodzaju dokumentu (dodanie, zmiana, usunięcie) dla serwera i wersji próbnej. */
export function docTypeAudit(actor: Actor, now: number, before: DocType | undefined, after: DocType | undefined): Omit<AuditEntry, 'id'> {
  const describe = (t?: DocType) => t ? `${t.name}; ${t.adopted}; ${t.rejected}; ${t.voted ? 'wymaga głosowania' : 'bez głosowania'}; ${t.inActs ? 'w wykazie aktów' : 'poza wykazem aktów'}; ${t.active ? 'włączony' : 'wyłączony'}; kolejność ${t.order}` : 'brak';
  const t = (after ?? before)!;
  return {at: now, accountId: actor.account.id, actor: actor.name, area: 'rodzaje_dokumentow', key: `rodzaj:${t.id}`, label: `Rodzaj dokumentu „${t.name}”`, before: describe(before), after: after ? describe(after) : 'usunięty'};
}
