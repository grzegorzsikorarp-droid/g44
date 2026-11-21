import type {Actor, Ballot, ClosedRef, Meeting, Roster} from './types.ts';
import {canReleaseComms, canSeeCatalog, isCommsAccount, isService, organRoster, seesPhotosLink} from './role.ts';
import {lawOf} from './law.ts';
import {ballotDocType} from './rules.ts';
import {meetingTurnout, periodTurnout} from './turnout.ts';
import {actBallots, actNumber, paperDay, t} from './papers.ts';
import type {CascadeEnv} from './cascade.ts';
import {commsChangedAt, commsLevelOfItem, commsRelease} from './comms.ts';
import type {ArchiveInfo} from './view.ts';
import {dateDots, isoDayOf, timeOf} from './text.ts';
import {csv} from './csv.ts';

// Katalog odbytych posiedzeń, stan protokołu, przyjęcie protokołu i zestawienie za okres (SPEC-4 DB-5, DB-6, DB-24,
// DB-25, DB-38, B1-19, B1-24–B1-30). Wszystko liczone z danych posiedzeń; nic nie zapisuje się w posiedzeniu, którego
// protokół przyjęto (jedno polecenie domeny zmienia jedno posiedzenie).

/** Przyjęcie protokołu posiedzenia: na którym posiedzeniu, kiedy i w którym głosowaniu (B1-19, DB-5). */
export interface Adoption { meetingId: string; date: string; ballotNumber: number; at: number; kind: Meeting['kind'] }
const announced = (b: Ballot) => b.status === 'zamkniete' && !!b.announcedAt && !b.aborted && !!b.result;
/**
 * Przyjęcia protokołów (DB-5): ogłoszony, przyjęty wynik głosowania o celu `protokol` z utrwalonym `Ballot.protocolOf`
 * na posiedzeniu albo w głosowaniu między posiedzeniami, które zostało zamknięte; głosowanie zastąpione ogłoszonym
 * wynikiem reasumpcji się nie liczy. Klucz to identyfikator posiedzenia, którego protokół przyjęto; przy kilku
 * przyjęciach liczy się pierwsze.
 */
export function protocolAdoptions(meetings: Meeting[]): Map<string, Adoption> {
  const out = new Map<string, Adoption>();
  const list = meetings.filter(m => m.status === 'zakonczone')
    .flatMap(m => m.ballots.map(b => ({m, b})))
    .filter(({m, b}) => b.purpose === 'protokol' && !!b.protocolOf && announced(b) && b.result!.adopted
      && !(b.supersededBy && m.ballots.some(x => x.id === b.supersededBy && announced(x))))
    .sort((x, y) => x.b.announcedAt! - y.b.announcedAt!);
  for (const {m, b} of list) if (!out.has(b.protocolOf!)) out.set(b.protocolOf!, {meetingId: m.id, date: paperDay(m), ballotNumber: b.number, at: b.announcedAt!, kind: m.kind});
  return out;
}
/** Zamknięte posiedzenia do „Dotyczy protokołu” (G-33) z rozpoznanym przyjęciem. */
export function closedRefs(meetings: Meeting[], adoptions = protocolAdoptions(meetings)): ClosedRef[] {
  return meetings.filter(m => m.status === 'zakonczone')
    .map(m => ({id: m.id, organ: m.organ, kind: m.kind, day: paperDay(m), working: m.kind === 'posiedzenie' && !!m.working, adopted: adoptions.has(m.id), title: m.title}))
    .sort((a, b) => a.day.localeCompare(b.day));
}

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
/** Data z tekstu („z dnia 22 października 2026 r.” albo „22.10.2026”) w zapisie RRRR-MM-DD albo `null`. */
export function dateInText(text: string): string | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const word = new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`, 'i').exec(text);
  if (word) return `${word[3]}-${pad(MONTHS.indexOf(word[2].toLowerCase()) + 1)}-${pad(Number(word[1]))}`;
  const dots = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/.exec(text);
  return dots ? `${dots[3]}-${pad(Number(dots[2]))}-${pad(Number(dots[1]))}` : null;
}
/** Posiedzenia, których protokół może przyjąć punkt (G-33): ten sam organ, zamknięte, bez przyjęcia, nie spotkanie robocze. */
export function protocolCandidates(closed: ClosedRef[], m: Pick<Meeting, 'id' | 'organ'>): ClosedRef[] {
  return closed.filter(c => c.organ === m.organ && c.id !== m.id && !c.working && !c.adopted);
}
/**
 * Propozycja „Dotyczy protokołu” (U-28, 6.5 wiersz 10): posiedzenie z datą z tytułu punktu, a bez niej ostatnie
 * zamknięte posiedzenie bez przyjętego protokołu. Propozycja nie działa bez przyjęcia (I-13 SPEC-3).
 */
export function protocolOfProposal(closed: ClosedRef[], m: Pick<Meeting, 'id' | 'organ'>, title: string): {id: string; why: 'data' | 'ostatnie'} | null {
  const list = protocolCandidates(closed, m);
  const day = dateInText(title);
  const byDay = day ? list.find(c => c.day === day) : undefined;
  if (byDay) return {id: byDay.id, why: 'data'};
  const last = list.at(-1);
  return last ? {id: last.id, why: 'ostatnie'} : null;
}
export const proposeProtocolOf = (closed: ClosedRef[], m: Pick<Meeting, 'id' | 'organ'>, title: string) => protocolOfProposal(closed, m, title)?.id ?? null;
/** Linia propozycji w ustawieniach punktu (6.5 wiersz 10). */
export function protocolOfProposalText(closed: ClosedRef[], p: {id: string; why: 'data' | 'ostatnie'}): string {
  const c = closed.find(x => x.id === p.id);
  const what = c?.kind === 'procedura' ? 'głosowanie między posiedzeniami' : 'posiedzenie';
  return `Propozycja »${what} z dnia ${dateDots(c?.day ?? '')}«, bo ${p.why === 'data' ? 'tytuł punktu zawiera tę datę' : 'to ostatnie posiedzenie bez przyjętego protokołu'}.`;
}
/**
 * Wiersz „Do sprawdzenia” przy głosowaniu o przyjęcie protokołu na zamkniętym posiedzeniu (G-38, K4-4): pole
 * `protocolOf` puste albo sprzeczne z datą w przedmiocie głosowania; inaczej `null`.
 */
export function protocolOfIssue(m: Pick<Meeting, 'status'>, b: Ballot, closed: ClosedRef[]): string | null {
  if (m.status !== 'zakonczone' || b.purpose !== 'protokol' || b.aborted || b.status !== 'zamkniete') return null;
  if (!b.protocolOf) return `Głosowanie nr ${b.number} nie wskazuje, którego protokołu dotyczy.`;
  const target = closed.find(c => c.id === b.protocolOf);
  const subjectDay = dateInText(b.subject);
  if (target && subjectDay && subjectDay !== target.day) return `Głosowanie nr ${b.number} wskazuje protokół posiedzenia z dnia ${dateDots(target.day)}, a przedmiot głosowania mówi o dniu ${dateDots(subjectDay)}.`;
  return null;
}

/** Stan protokołu w katalogu i karcie dokumentów (DB-6, B1-27, 6.8). */
export interface ProtocolState { state: 'projekt' | 'sporzadzony' | 'przyjety' | 'notatka'; label: string; text: string; overdue: boolean; deadline: string | null }
const addDays = (iso: string, days: number) => { const [y, mo, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10); };
/** Termin sporządzenia protokołu (§ 13 ust. 2): dzień zakończenia obrad i 21 dni z profilu prawnego. */
export const minutesDeadline = (m: Pick<Meeting, 'organ' | 'closedAt'>) => m.closedAt ? addDays(isoDayOf(m.closedAt), lawOf(m.organ).minutes.deadlineDays) : null;
export function protocolState(m: Meeting, adoption: Adoption | null, today: string): ProtocolState {
  const law = lawOf(m.organ);
  const deadline = minutesDeadline(m);
  if (m.kind === 'posiedzenie' && m.working) return {state: 'notatka', label: 'Notatka', text: 'Spotkanie robocze bez kworum, bez protokołu.', overdue: false, deadline: null};
  const scan = (m.filed ?? []).filter(f => f.kind === 'protokol_podpisany' && !f.replacedAt).at(-1);
  if (adoption) {
    const where = adoption.kind === 'procedura' ? 'w głosowaniu między posiedzeniami' : 'na posiedzeniu';
    const text = `Przyjęty ${dateDots(isoDayOf(adoption.at))} ${where} z dnia ${dateDots(adoption.date)} (głosowanie nr ${adoption.ballotNumber}).${scan ? ` Podpisany skan dołączono ${dateDots(isoDayOf(scan.at))}.` : ''}`;
    return {state: 'przyjety', label: 'Przyjęty', text, overdue: false, deadline};
  }
  if (m.minutesReady) {
    const r = m.minutesReady;
    return {state: 'sporzadzony', label: 'Sporządzony', text: `Sporządzony ${dateDots(r.date)}. Sporządza ${r.author.name}, ${r.author.func}. Do wglądu w biurze (${law.minutes.deadlineBasis}).`, overdue: false, deadline};
  }
  const overdue = !!deadline && today > deadline;
  return {state: 'projekt', label: 'Projekt', text: `${deadline ? `Termin sporządzenia ${dateDots(deadline)} (${law.minutes.deadlineBasis}).` : ''}${overdue ? ' Termin minął.' : ''}`.trim(), overdue, deadline};
}
/**
 * Wiersze „Do sprawdzenia” przy protokole (6.8, K4-7, G-38): plik protokołu bez faktu „Protokół sporządzony” i głosowania
 * o przyjęcie protokołu z pustym albo sprzecznym polem. Widzą je biuro i przewodniczący.
 */
export function protocolChecks(m: Meeting, closed: ClosedRef[]): string[] {
  const out: string[] = [];
  if (!m.minutesReady && (m.filed ?? []).some(f => f.kind === 'protokol_sporzadzony' && !f.replacedAt)) out.push('Dołączono plik protokołu. Wpisz datę sporządzenia i osobę, która sporządziła protokół.');
  for (const b of m.ballots) { const issue = protocolOfIssue(m, b, closed); if (issue) out.push(issue); }
  return out;
}

const PHOTO_HOSTS = ['photos.app.goo.gl', 'photos.google.com'];
export type PhotosCheck = {ok: true; url: string; warning?: string} | {ok: false; error: string};
/**
 * Odnośnik do albumu zdjęć (B1-29, G-23, DB-38): tylko `https`, do 500 znaków, bez danych logowania i znaków
 * sterujących; host inny niż Zdjęcia Google daje ostrzeżenie (zapis po potwierdzeniu). Pusty adres usuwa odnośnik.
 * Serwer nigdy go nie pobiera.
 */
export function photosUrlCheck(text: string): PhotosCheck {
  const value = String(text ?? '').trim();
  if (!value) return {ok: true, url: ''};
  if (value.length > 500) return {ok: false, error: 'Adres może mieć najwyżej 500 znaków.'};
  if (!/^https:\/\//i.test(value)) return {ok: false, error: 'Wpisz adres zaczynający się od https://.'};
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return {ok: false, error: 'Ten adres nie jest poprawny.'};
  let url: URL;
  try { url = new URL(value); } catch { return {ok: false, error: 'Ten adres nie jest poprawny.'}; }
  if (url.protocol !== 'https:' || !url.hostname) return {ok: false, error: 'Ten adres nie jest poprawny.'};
  if (url.username || url.password) return {ok: false, error: 'Adres nie może zawierać nazwy użytkownika ani hasła.'};
  const host = url.hostname.toLowerCase();
  return PHOTO_HOSTS.includes(host) ? {ok: true, url: url.href} : {ok: true, url: url.href, warning: 'To nie jest adres albumu Zdjęć Google. Sprawdź, czy odnośnik prowadzi do właściwego albumu.'};
}
export const photosHost = (url: string) => { try { return new URL(url).hostname; } catch { return ''; } };
/** Tekst odnośnika do albumu zamiast całego adresu (K4-27). */
export const photosLinkText = (url: string) => `Album zdjęć z posiedzenia (${photosHost(url)})`;

// Katalog odbytych posiedzeń (B1-24–B1-28, 6.9).

export interface CatalogFilter { rok?: string; kadencja?: string; rodzaj?: 'wszystkie' | 'posiedzenia' | 'glosowania'; stan?: ProtocolState['state'] | 'wszystkie'; brak?: boolean; q?: string }
export interface CatalogRow {
  id: string; scope: 'pelny' | 'wiersz'; kind: Meeting['kind']; working: boolean; mode: Meeting['mode']; day: string; title: string; place: string;
  protocol: ProtocolState;
  /** „Uchwała 3, stanowisko 1” (podjęte akty według rodzajów dokumentów). */
  acts: string;
  /** Adres albumu dla osób z `seesPhotosLink`, inaczej tylko „jest” albo „brak” (DB-38). */
  photos: {url: string} | 'jest' | 'brak';
  // Pola tylko w zakresie 'pelny'. Wiersz konta „Komunikacja” (zakres 'wiersz') ich nie ma: rozdz. 4.4 wylicza zakres
  // wiersza bez nich, a przypis 10 do 4.3.3 mówi „bez dokumentów organu” (poprawka D1K-05).
  term?: string | null; protocolNumber?: string;
  turnout?: {present: number; members: number};
  complete?: {have: number; of: number; items: {label: string; ok: boolean}[]};
  /** Stan udostępnienia materiału dla komunikacji (DB-42) dla osób, które udostępniają, i konta „Komunikacja” (6.9, 4.4). */
  commsRelease?: 'brak' | 'udostepniony' | 'zmieniony';
  /** Chwila ostatniego udostępnienia („Udostępniono {data}, godz. {g}.”, 4.4), przy tych samych osobach co `commsRelease`. */
  commsReleasedAt?: number | null;
}
/** Komplet dokumentów posiedzenia (6.9): przy notatce projekt notatki i odnośnik. */
export function completeness(m: Meeting, adoption: Adoption | null) {
  const filed = (kind: string) => (m.filed ?? []).some(f => f.kind === kind && !f.replacedAt);
  const items = m.kind === 'posiedzenie' && m.working
    ? [{label: 'projekt notatki', ok: true}, {label: 'odnośnik do zdjęć', ok: !!m.photos}]
    : [{label: 'protokół sporządzony', ok: !!m.minutesReady}, {label: 'plik protokołu sporządzonego', ok: filed('protokol_sporzadzony')},
      {label: 'protokół przyjęty', ok: !!adoption}, {label: 'skan podpisanego protokołu', ok: filed('protokol_podpisany')}, {label: 'odnośnik do zdjęć', ok: !!m.photos}];
  return {have: items.filter(i => i.ok).length, of: items.length, items};
}
/** Podjęte akty według rodzajów dokumentów: „Uchwała 3, stanowisko 1”. */
export function actsSummary(m: Meeting, env: Pick<CascadeEnv, 'docTypes'>): string {
  const counts = new Map<string, number>();
  for (const b of actBallots(m, env)) { const d = ballotDocType(m, b) ?? 'inny'; counts.set(d, (counts.get(d) ?? 0) + 1); }
  const types = m.frozen?.docTypes ?? env.docTypes;
  return [...counts].map(([d, n], i) => { const name = types.find(x => x.id === d)?.name ?? d; return `${i ? name.toLowerCase() : name} ${n}`; }).join(', ');
}
/**
 * Wiersze katalogu dla osoby (B1-27): tylko posiedzenia zakończone, które osoba może zobaczyć (`canSeeCatalog`),
 * od najnowszego, z filtrami z adresu (B1-25).
 */
export function catalogRows(meetings: Meeting[], env: Pick<CascadeEnv, 'roster' | 'docTypes'>, actor: Actor, filter: CatalogFilter, o: {today: string; adoptions?: Map<string, Adoption>}): CatalogRow[] {
  const adoptions = o.adoptions ?? protocolAdoptions(meetings);
  const q = (filter.q ?? '').trim().toLocaleLowerCase('pl').slice(0, 100);
  const rows: CatalogRow[] = [];
  for (const m of meetings) {
    if (m.status !== 'zakonczone') continue;
    const scope = canSeeCatalog(env.roster, m, actor);
    if (!scope) continue;
    const day = paperDay(m);
    const adoption = adoptions.get(m.id) ?? null;
    // Konto „Komunikacja” (zakres 'wiersz') dostaje stan protokołu z datą przyjęcia, bez terminu sporządzenia i osoby (4.4).
    const full = protocolState(m, adoption, o.today);
    const protocol = scope === 'pelny' ? full
      : {...full, text: adoption ? `Przyjęty ${dateDots(isoDayOf(adoption.at))}.` : '', overdue: false, deadline: null};
    const complete = completeness(m, adoption);
    const term = m.frozen?.term ? m.frozen.term.name : null;
    if (filter.rok && !day.startsWith(filter.rok)) continue;
    if (filter.kadencja && term !== filter.kadencja && m.frozen?.term?.number !== filter.kadencja) continue;
    if (filter.rodzaj === 'posiedzenia' && m.kind !== 'posiedzenie') continue;
    if (filter.rodzaj === 'glosowania' && m.kind !== 'procedura') continue;
    if (filter.stan && filter.stan !== 'wszystkie' && protocol.state !== filter.stan) continue;
    if (filter.brak && complete.have === complete.of) continue;
    if (q) {
      const hay = [m.title, m.protocolNumber ?? '', ...actBallots(m, env).flatMap(b => [actNumber(m, b), b.material?.title ?? b.subject])].join(' ').toLocaleLowerCase('pl');
      if (!hay.includes(q)) continue;
    }
    const row: CatalogRow = {
      id: m.id, scope, kind: m.kind, working: m.kind === 'posiedzenie' && !!m.working, mode: m.mode, day, title: m.title, place: m.place,
      protocol, acts: actsSummary(m, env),
      photos: m.photos ? (seesPhotosLink(env.roster, m, actor) ? {url: m.photos.url} : 'jest') : 'brak',
    };
    if (scope === 'pelny') Object.assign(row, {term, protocolNumber: m.protocolNumber?.trim() ?? '', turnout: meetingTurnout(m, env.roster), complete});
    if (canReleaseComms(env.roster, m, actor) || isCommsAccount(actor)) Object.assign(row, {commsRelease: commsRelease(m), commsReleasedAt: m.commsReleased?.at ?? null});
    rows.push(row);
  }
  return rows.sort((a, b) => b.day.localeCompare(a.day) || a.title.localeCompare(b.title, 'pl'));
}
/** CSV katalogu (B1-11): kolumna „Zdjęcia” tylko „jest” albo „brak” (K4-31); bez konta „Komunikacja”. */
export function catalogCsv(rows: CatalogRow[], actor: Actor): string {
  if (isCommsAccount(actor)) throw Object.assign(new Error('To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.'), {status: 403});
  return csv(['Dzień', 'Rodzaj', 'Tryb', 'Tytuł', 'Numer protokołu', 'Stan protokołu', 'Podjęte akty', 'Obecnych', 'Zdjęcia', 'Komplet dokumentów'],
    rows.map(r => [r.day, r.kind === 'procedura' ? 'głosowanie między posiedzeniami' : r.working ? 'spotkanie robocze' : 'posiedzenie', r.mode, r.title, r.protocolNumber ?? '', r.protocol.label,
      r.acts, r.turnout ? `${r.turnout.present} z ${r.turnout.members}` : '', r.photos === 'brak' ? 'brak' : 'jest', r.complete ? `${r.complete.have} z ${r.complete.of}` : '']));
}

// Zestawienie za okres (B1-30, DB-25): bez danych o osobach.

export interface PeriodReport {
  from: string; to: string; organ: string; at: number;
  meetings: {id: string; day: string; kind: string; mode: string; protocolNumber: string; protocol: string; turnout: string; acts: number; photos: string}[];
  counts: {meetings: number; remote: number; working: number; procedures: number; acts: {id: string; name: string; count: number}[]; turnout: string};
  pending: number;
  actsByCase: {group: string; level: 'lista' | 'liczba'; count: number; items: {number: string; subject: string; day: string}[]; numbers: string[]}[];
}
/** Okres zestawienia (6.9): daty RRRR-MM-DD, początek nie później niż koniec, najwyżej 5 lat. */
export function periodInput(from: string | null | undefined, to: string | null | undefined): {from: string; to: string} | {error: string} {
  const ok = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
  if (!ok(from) || !ok(to)) return {error: 'Wpisz datę początku i końca okresu.'};
  if (from! > to!) return {error: 'Początek okresu nie może być późniejszy niż koniec.'};
  if (Date.parse(to! + 'T12:00:00Z') - Date.parse(from! + 'T12:00:00Z') > (5 * 365 + 2) * 86400000) return {error: 'Okres może mieć najwyżej 5 lat.'};
  return {from: from!, to: to!};
}
export function periodReport(meetings: Meeting[], env: CascadeEnv, period: {from: string; to: string}, o: {at: number; today: string}): PeriodReport {
  const adoptions = protocolAdoptions(meetings);
  const list = meetings.filter(m => m.organ === env.organ.code && m.status === 'zakonczone')
    .filter(m => { const d = paperDay(m); return d >= period.from && d <= period.to; })
    .sort((a, b) => paperDay(a).localeCompare(paperDay(b)));
  const types = env.docTypes;
  const actCounts = new Map<string, number>();
  const groups = new Map<string, PeriodReport['actsByCase'][number]>();
  for (const m of list) for (const b of actBallots(m, env)) {
    const d = ballotDocType(m, b) ?? 'inny';
    actCounts.set(d, (actCounts.get(d) ?? 0) + 1);
    const item = m.agenda.find(i => i.id === b.itemId);
    const caseType = env.general.caseTypes.find(c => c.id === item?.caseType);
    const level = commsLevelOfItem(m, item, env);
    const group = caseType?.name ?? `${(m.frozen?.docTypes ?? types).find(x => x.id === d)?.name ?? 'Akt'} bez rodzaju sprawy`;
    const g = groups.get(group) ?? {group, level: level === 'pelna' || level === 'tytul' ? 'lista' as const : 'liczba' as const, count: 0, items: [], numbers: []};
    g.count++;
    const number = actNumber(m, b);
    if (g.level === 'lista') { const title = (b.material?.title ?? b.subject).trim(); const at = title.indexOf(' w sprawie '); g.items.push({number, subject: at >= 0 ? title.slice(at + ' w sprawie '.length) : title, day: paperDay(m)}); }
    else if (number) g.numbers.push(number);
    groups.set(group, g);
  }
  const pt = periodTurnout(list, env.roster, period, env.organ.code);
  return {
    from: period.from, to: period.to, organ: env.organ.forms?.genitive ?? env.organ.name, at: o.at,
    meetings: list.map(m => {
      const tr = meetingTurnout(m, env.roster);
      return {id: m.id, day: paperDay(m), kind: m.kind === 'procedura' ? 'głosowanie między posiedzeniami' : m.working ? 'spotkanie robocze' : 'posiedzenie', mode: m.mode === 'zdalne' ? 'zdalne' : 'stacjonarne',
        protocolNumber: m.protocolNumber?.trim() ?? '', protocol: protocolState(m, adoptions.get(m.id) ?? null, o.today).label, turnout: `${tr.present} z ${tr.members}`, acts: actBallots(m, env).length, photos: m.photos?.url ?? ''};
    }),
    counts: {meetings: list.filter(m => m.kind === 'posiedzenie').length, remote: list.filter(m => m.kind === 'posiedzenie' && m.mode === 'zdalne').length, working: list.filter(m => m.kind === 'posiedzenie' && m.working).length,
      procedures: list.filter(m => m.kind === 'procedura').length, acts: [...actCounts].map(([d, count]) => ({id: d, name: types.find(x => x.id === d)?.name ?? d, count})),
      turnout: pt.seats ? `${Math.round(100 * pt.present / pt.seats)}% (${pt.present} z ${pt.seats})` : '–'},
    pending: list.filter(m => !(m.kind === 'posiedzenie' && m.working) && !adoptions.has(m.id)).length,
    actsByCase: [...groups.values()],
  };
}
/** Mianownik liczby mnogiej rodzaju dokumentu w zestawieniu („Podjęte uchwały 6, stanowiska 1.”); inny rodzaj małą literą. */
const ACT_PLURAL: Record<string, string> = {uchwala: 'uchwały', stanowisko: 'stanowiska', oswiadczenie: 'oświadczenia', apel: 'apele', rezolucja: 'rezolucje', deklaracja: 'deklaracje'};
const actsLine = (acts: PeriodReport['counts']['acts']) => acts.length
  ? `Podjęte ${acts.map(a => `${ACT_PLURAL[a.id] ?? a.name.toLocaleLowerCase('pl')} ${a.count}`).join(', ')}.` : 'Podjęte akty 0.';
/** Treść zestawienia do druku (B1-30 pkt 1–5). Adres albumu tylko w wydruku (K4-31). */
export function periodReportHtml(r: PeriodReport, roster: Roster): string {
  void roster;
  const out = [`<header><p class="draft">${t(`Stan na ${dateDots(isoDayOf(r.at))}, godz. ${timeOf(r.at)}. Zestawienie z zapisu aplikacji.`)}</p><h1>${t(`Zestawienie posiedzeń ${r.organ} za okres ${dateDots(r.from)}–${dateDots(r.to)}`)}</h1></header>`];
  if (r.pending) out.push(`<p>${t(`Dane posiedzeń bez przyjętego protokołu mogą się jeszcze zmienić (${r.pending}).`)}</p>`);
  if (!r.meetings.length) return out.concat(`<p>${t('W tym okresie nie zakończyło się żadne posiedzenie Prezydium.')}</p>`).join('');
  out.push(`<h2>${t('Liczby')}</h2><ul class="paper-list"><li>${t(`Posiedzenia ${r.counts.meetings}, w tym zdalne ${r.counts.remote} i spotkania robocze ${r.counts.working}.`)}</li><li>${t(`Głosowania między posiedzeniami ${r.counts.procedures}.`)}</li>`
    + `<li>${t(actsLine(r.counts.acts))}</li><li>${t(`Średnia frekwencja ${r.counts.turnout}.`)}</li></ul>`);
  out.push(`<h2>${t('Posiedzenia')}</h2><div class="table-wrap" role="region" tabindex="0" aria-label="${t('Posiedzenia w okresie')}"><table><thead><tr>${['Data', 'Rodzaj', 'Tryb', 'Numer protokołu', 'Stan protokołu', 'Obecnych', 'Podjęte akty', 'Zdjęcia'].map(h => `<th scope="col">${t(h)}</th>`).join('')}</tr></thead><tbody>`
    + r.meetings.map(m => `<tr><th scope="row">${t(dateDots(m.day))}</th><td>${t(m.kind)}</td><td>${t(m.mode)}</td><td>${t(m.protocolNumber || 'brak numeru')}</td><td>${t(m.protocol)}</td><td>${t(m.turnout)}</td><td class="oi-liczba">${m.acts}</td><td>${m.photos ? t(m.photos) : t('brak')}</td></tr>`).join('') + '</tbody></table></div>');
  if (r.actsByCase.length) {
    out.push(`<h2>${t('Podjęte akty według rodzajów spraw')}</h2>`);
    for (const g of r.actsByCase) {
      out.push(`<h3>${t(`${g.group}, ${g.count}`)}</h3>`);
      if (g.level === 'lista') out.push('<ul class="paper-list">' + g.items.map(i => `<li>${t(`${i.number ? `${i.number}, ` : ''}${i.subject}, posiedzenie z dnia ${dateDots(i.day)}`)}</li>`).join('') + '</ul>');
      else if (g.numbers.length) out.push(`<p>${t(`Numery ${g.numbers.join(', ')}.`)}</p>`);
    }
  }
  const photos = r.meetings.filter(m => m.photos);
  if (photos.length) out.push(`<h2>${t('Odnośniki do zdjęć')}</h2><ul class="paper-list">` + photos.map(m => `<li>${t(`${dateDots(m.day)}, ${m.photos}`)}</li>`).join('') + '</ul>');
  return out.join('');
}
/** CSV zestawienia: posiedzenia albo akty (B1-30); odnośnik do albumu tylko „jest” albo „brak” (K4-31). */
export function periodReportCsv(r: PeriodReport, part: 'posiedzenia' | 'akty'): string {
  if (part === 'posiedzenia') return csv(['Data', 'Rodzaj', 'Tryb', 'Numer protokołu', 'Stan protokołu', 'Obecnych', 'Podjęte akty', 'Zdjęcia'],
    r.meetings.map(m => [m.day, m.kind, m.mode, m.protocolNumber, m.protocol, m.turnout, m.acts, m.photos ? 'jest' : 'brak']));
  return csv(['Rodzaj sprawy', 'Liczba', 'Numer', 'W sprawie', 'Data posiedzenia'],
    r.actsByCase.flatMap(g => g.level === 'lista' ? g.items.map(i => [g.group, '', i.number, i.subject, i.day]) : [[g.group, g.count, g.numbers.join(', '), '', '']]));
}

/**
 * Dane zakończonego posiedzenia do widoku (`ArchiveInfo`, SPEC-4 2.1): przyjęcie i stan protokołu, chwila zmiany materiału
 * dla komunikacji, uwaga o wiadomościach sprzed rozpoczęcia starego głosowania między posiedzeniami (DB-15, biuro
 * i przewodniczący), stan udostępnienia (osoby z `canReleaseComms` i konto „Komunikacja”) i wiersze „Do sprawdzenia”
 * (biuro i przewodniczący). Serwer i wersja próbna liczą to z tej samej listy posiedzeń.
 */
export function archiveInfo(m: Meeting, all: Meeting[], actor: Actor, roster: Roster, today: string, o: {adoptions?: Map<string, Adoption>; closed?: ClosedRef[]} = {}): ArchiveInfo | undefined {
  if (m.status !== 'zakonczone') return undefined;
  const adoptions = o.adoptions ?? protocolAdoptions(all);
  const adoption = adoptions.get(m.id) ?? null;
  const out: ArchiveInfo = {adoption, protocol: protocolState(m, adoption, today), commsChangedAt: commsChangedAt(m, adoption)};
  const chairman = !!actor.personId && organRoster(roster, m).some(x => x.personId === actor.personId && x.func === 'przewodniczacy')
    || !!actor.personId && roster.memberships.some(x => x.organ === m.organ && x.personId === actor.personId && x.func === 'przewodniczacy');
  const office = isService(actor);
  if ((office || chairman) && m.kind === 'procedura' && !m.frozen?.v4 && m.messages.some(x => x.at < (m.openedAt ?? 0))) out.legacyPrepMessages = true;
  if (canReleaseComms(roster, m, actor) || isCommsAccount(actor)) out.commsRelease = commsRelease(m);
  if (office || chairman) {
    const checks = protocolChecks(m, o.closed ?? closedRefs(all, adoptions));
    if (checks.length) out.checks = checks;
  }
  return out;
}
