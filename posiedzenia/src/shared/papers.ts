import type {Account, Actor, AgendaItem, Ballot, Meeting, PaperFormat, PaperId, PaperState, Roster} from './types.ts';
import {membership, organOf, personName} from './roster.ts';
import {ballotDocType, choiceLabel, itemNumber, materialTypeOf, orderedAgenda, presenceOf, presenterGroups, quorumOf, resultLabel, resultPendingProcedureText, resultPendingText, unannounced} from './rules.ts';
import {canDownloadPaper, organRoster} from './role.ts';
import {lawOf} from './law.ts';
import {noticeDays} from './meeting.ts';
import type {CascadeEnv} from './cascade.ts';
import {asciiSlug, dateDots, isoDayOf, plural, timeOf} from './text.ts';
import {typo} from './typo.ts';
import {csv} from './csv.ts';

// Dokumenty posiedzenia wersji 4 (SPEC-4 5.5, B1-01–B1-23, DB-4, T-7). Jeden rejestr (`meetingPapers`), z którego
// korzystają karta „Dokumenty posiedzenia” (klient liczy listę z widoku, bez zapytania), katalog, teczka, serwer i wersja
// próbna, oraz renderery nowych dokumentów (porządek obrad, lista obecności, wyniki głosowań, wykaz imienny, akt, kanał
// wiadomości, dziennik) w wariancie do druku i do pliku Word, CSV i Markdown. Projekt protokołu powstaje w
// src/server/minutes.ts, który bierze stąd wspólne części listy obecności (`presenceText`, `confirmedBy`), żeby protokół
// i lista obecności miały jedno brzmienie.
// Zasada B1-03 i T-7: nowe dokumenty nigdy nie podają wyniku przed ogłoszeniem (także u osoby prowadzącej), głosowanie
// otwarte podają tylko zdaniem „Głosowanie nr {n} trwa.”, listy osób są w kolejności składu i bez godzin pobrania karty
// albo oddania głosu, z głosowania tajnego tylko liczby z protokołu.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
/** Tekst do HTML dokumentu: polska typografia (twarde spacje), potem znaki HTML. */
export const t = (s: unknown) => esc(typo(String(s ?? '')));
export const escHtml = esc;
const p = (text: string, cls = '') => `<p${cls ? ` class="${cls}"` : ''}>${t(text)}</p>`;
/** „19 listopada 2026 r.” z daty RRRR-MM-DD. */
export const longDate = (iso: string) => iso ? `${new Intl.DateTimeFormat('pl-PL', {dateStyle: 'long', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.` : '';
/** Dzień dokumentu: dzień otwarcia, a przed otwarciem data posiedzenia (jak `minutesDay`). */
export const paperDay = (m: Pick<Meeting, 'openedAt' | 'date'>) => m.openedAt ? isoDayOf(m.openedAt) : m.date;
const quoted = (text: string) => `„${text.replace(/„/g, '»').replace(/”/g, '«')}”`;
const listing = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} i ${items[items.length - 1]}`;
const DOTS = '……';
const isNote = (m: Pick<Meeting, 'kind' | 'working'>) => m.kind === 'posiedzenie' && !!m.working;
/** Zdanie o głosowaniu otwartym w każdym pliku (T-7, K4-29). */
export const openBallotText = (n: number) => `Głosowanie nr ${n} trwa.`;

/** Głosowania, których wynik ten plik ukrywa (B1-03): każde zamknięte bez ogłoszenia, niezależnie od osoby. */
export const hiddenForFiles = (m: Pick<Meeting, 'ballots'>) => new Set(unannounced(m).map(b => b.id));
/**
 * Projekt protokołu ukrywa nieogłoszone wyniki u osoby, która ich nie widzi (wersja 3), a przy posiedzeniu otwartym
 * w wersji 4 u każdego (DB-4, B1-03). Stare posiedzenia zachowują widoczność wersji 3 (odstępstwo D.1-1 w raporcie).
 */
export const minutesHideUnannounced = (m: Pick<Meeting, 'frozen'>, seesUnannounced: boolean) => !seesUnannounced || !!m.frozen?.v4;

// Lista obecności: brzmienie wspólne z projektem protokołu (B1-16).

/** Osoba prowadząca obrady w danej chwili (z historii zmian prowadzenia). */
export function chairAt(m: Pick<Meeting, 'chair'>, at: number) {
  let current: string | null = null;
  for (const c of m.chair.changes) if (c.at <= at) current = c.to;
  return current;
}
/**
 * Obecność z wpisów: „obecność od 10:02, wyjście 11:30, powrót 11:45” albo „nieobecność”. Zgłoszenia obecności (F9)
 * nie są obecnością: liczy się dopiero potwierdzenie (przybycie).
 */
export function presenceText(m: Pick<Meeting, 'presenceLog'>, who: string, guest: boolean) {
  const events = m.presenceLog.filter(e => e.who === who && !!e.guest === guest && (e.type === 'przybycie' || e.type === 'wyjscie'));
  if (!events.length) return 'nieobecność';
  let arrived = false;
  return events.map(e => {
    if (e.type !== 'przybycie') return `wyjście ${timeOf(e.at)}`;
    const text = arrived ? `powrót ${timeOf(e.at)}` : `obecność od ${timeOf(e.at)}`;
    arrived = true;
    return text;
  }).join(', ');
}
export interface ConfirmContext { m: Meeting; roster: Roster; office: string; v3: boolean }
/**
 * Kto zapisał albo potwierdził obecność, w bierniku bez odmiany nazwiska: „osobę prowadzącą obrady (Anna Nowak)”,
 * „członka Prezydium (…)”, „inną osobę (…)” albo biuro z nazwą konta.
 */
export function byWhom(c: ConfirmContext, name: string, at: number) {
  const chair = chairAt(c.m, at);
  if (chair && name === personName(c.roster, chair)) return `osobę prowadzącą obrady (${name})`;
  const person = c.roster.persons.find(x => x.name === name);
  if (person) return membership(c.roster, c.m.organ, person.id) ? `członka Prezydium (${name})` : `inną osobę (${name})`;
  return name && name !== 'system' ? `${c.office} (${name})` : c.office;
}
/**
 * Sposób potwierdzenia pierwszego przybycia: potwierdzenie przez samą osobę, zgłoszenie potwierdzone przez osobę
 * prowadzącą albo biuro (F9), zapis przez inną osobę, a w wersji 3 obecność zapisana przy otwarciu albo przy przejęciu
 * prowadzenia. Bez przybycia: zgłoszenie czekające, niepotwierdzone, odrzucone albo wycofane.
 */
export function confirmedBy(c: ConfirmContext, who: string, guest: boolean, ownName: string) {
  const {m} = c;
  const own = m.presenceLog.filter(e => e.who === who && !!e.guest === guest);
  const first = own.find(e => e.type === 'przybycie');
  if (!first) {
    if (presenceOf(m, who, guest) === 'zgloszony') return m.status === 'zakonczone' ? 'zgłoszenie w aplikacji, niepotwierdzone' : 'zgłoszenie w aplikacji, czeka na potwierdzenie';
    const dropped = [...own].reverse().find(e => e.type === 'odrzucenie');
    if (!dropped) return '';
    return dropped.by === ownName ? 'zgłoszenie w aplikacji, wycofane' : `zgłoszenie w aplikacji, odrzucone przez ${byWhom(c, dropped.by, dropped.at)}`;
  }
  const exit = c.v3 && own.some(e => e.type === 'wyjscie' && e.via === 'przejmujacy') ? ', wyjście zapisane przez osobę, która przejęła prowadzenie' : '';
  if (c.v3 && first.via === 'otwarcie') return 'obecność zapisana przy otwarciu posiedzenia' + exit;
  if (c.v3 && first.via === 'prowadzenie') return 'obecność zapisana przy przejęciu prowadzenia obrad' + exit;
  if (first.by === ownName) return 'potwierdzenie w aplikacji' + exit;
  return (first.reportedAt ? `zgłoszenie w aplikacji, potwierdzone przez ${byWhom(c, first.by, first.at)}` : `zapisane przez ${byWhom(c, first.by, first.at)}`) + exit;
}

// Rejestr dokumentów (B1-01, B1-02, B1-07, B1-11).

export interface PaperEntry {
  id: PaperId; name: string; state: PaperState; formats: PaperFormat[]; fileBase: string;
  /** Akt z treścią i wykaz imienny: głosowanie, którego dotyczy. */
  ballotId?: string;
  /** Dokument bez treści (np. kanał bez wiadomości): zdanie zamiast przycisków formatów. */
  note?: string;
}
const NOT_ACT = new Set<Ballot['purpose']>(['porzadek', 'zmiana_porzadku', 'protokol', 'tryb', 'reasumpcja', 'wniosek', 'proba']);
/** Głosowanie zakończone, ogłoszone i nieprzerwane (B1-03). */
const announced = (b: Ballot) => b.status === 'zamkniete' && !!b.announcedAt && !b.aborted && !!b.result;
/**
 * Akty z treścią przyjętą (B1-18): ogłoszone, przyjęte, niezastąpione reasumpcją głosowania o rodzaju dokumentu, który
 * jest aktem (formy z `law.acts.voted` poza protokołem i sprawozdaniem albo rodzaje „w wykazie aktów”).
 */
export function actBallots(m: Meeting, env: Pick<CascadeEnv, 'docTypes'>): Ballot[] {
  const law = lawOf(m.organ);
  const types = m.frozen?.docTypes ?? env.docTypes;
  return m.ballots.filter(b => announced(b) && b.result!.adopted && !NOT_ACT.has(b.purpose)
    && !(b.supersededBy && m.ballots.some(x => x.id === b.supersededBy && announced(x))))
    .filter(b => {
      const d = ballotDocType(m, b);
      return !!d && ((d in law.acts.voted && d !== 'protokol' && d !== 'sprawozdanie') || !!types.find(x => x.id === d)?.inActs);
    }).sort((a, b) => a.number - b.number);
}
/** Numer aktu: z materiału, a bez niego z tytułu („nr 108/IX/2026”). */
export function actNumber(m: Pick<Meeting, 'materials'>, b: Ballot) {
  const ref = b.material ? m.materials.find(x => x.id === b.material!.id) : undefined;
  return ref?.number.trim() || /\bnr\s+([^\s,]+)/i.exec((b.material?.title ?? b.subject).trim())?.[1]?.replace(/[.,;:]$/, '') || '';
}
const actTitle = (b: Ballot) => (b.material?.title ?? b.subject).trim();

/** Nazwa dokumentu w mianowniku (karta, tytuł strony). */
export function paperName(m: Meeting, id: PaperId, env?: Pick<CascadeEnv, 'docTypes'>): string {
  if (id === 'protokol') return isNote(m) ? 'Projekt notatki' : 'Projekt protokołu';
  if (id === 'porzadek') return paperState(m, 'porzadek') === 'projekt' ? 'Projekt porządku obrad' : 'Porządek obrad';
  if (id === 'obecnosc') return 'Lista obecności';
  if (id === 'obecnosc-podpis') return 'Lista obecności do podpisu';
  if (id === 'wyniki') return 'Wyniki głosowań';
  if (id.startsWith('wykaz-')) return `Wykaz imienny głosowania nr ${id.slice(6)}`;
  if (id.startsWith('akt-')) { const b = m.ballots.find(x => x.id === id.slice(4)); return b ? actTitle(b) : 'Akt'; }
  if (id === 'kanal') return 'Kanał wiadomości';
  if (id === 'dziennik') return 'Dziennik';
  if (id === 'komunikacja') return 'Materiał dla komunikacji';
  return env ? 'Teczka posiedzenia' : 'Teczka posiedzenia';
}
/** Nazwa w bierniku do nazw dostępnych przycisków („Pobierz listę obecności w formacie CSV”, rozdz. 6.0). */
export function paperNameAccusative(m: Meeting, id: PaperId): string {
  const name = paperName(m, id);
  const map: Record<string, string> = {'Lista obecności': 'listę obecności', 'Lista obecności do podpisu': 'listę obecności do podpisu', 'Teczka posiedzenia': 'teczkę posiedzenia'};
  return map[name] ?? (id.startsWith('akt-') ? name : name.charAt(0).toLowerCase() + name.slice(1));
}
/** Stan dokumentu (B1-02). Projekt protokołu zostaje projektem także po zamknięciu i po przyjęciu protokołu. */
export function paperState(m: Meeting, id: PaperId): PaperState {
  const live = m.status === 'trwa' || m.status === 'przerwa';
  if (id === 'protokol') return 'projekt';
  if (id === 'porzadek') {
    if (m.status === 'przygotowanie' || (m.kind === 'posiedzenie' && (isNote(m) || !m.agendaAdopted))) return 'projekt';
    return live ? 'stan_na' : 'ustalony';
  }
  if (id.startsWith('akt-') || id === 'teczka' || id === 'komunikacja') return 'ustalony';
  return live || m.status === 'przygotowanie' ? 'stan_na' : 'ustalony';
}
/** Rodzaj dokumentu w nazwie pliku (B1-07). */
function fileKind(m: Meeting, id: PaperId): string {
  if (id === 'protokol') return isNote(m) ? 'projekt-notatki' : 'projekt-protokolu';
  if (id === 'porzadek') return paperState(m, 'porzadek') === 'projekt' ? 'projekt-porzadku-obrad' : 'porzadek-obrad';
  if (id === 'obecnosc') return 'lista-obecnosci';
  if (id === 'obecnosc-podpis') return 'lista-obecnosci-do-podpisu';
  if (id === 'wyniki') return 'wyniki-glosowan';
  if (id.startsWith('wykaz-')) return `wykaz-imienny-${id.slice(6)}`;
  if (id.startsWith('akt-')) {
    const b = m.ballots.find(x => x.id === id.slice(4));
    const kind = b ? (ballotDocType(m, b) ?? 'akt') : 'akt';
    const number = b ? actNumber(m, b) : '';
    return `${kind}${number ? `-${number}` : ''}`;
  }
  if (id === 'kanal') return 'kanal-wiadomosci';
  if (id === 'dziennik') return 'dziennik';
  if (id === 'komunikacja') return 'material-dla-komunikacji';
  return 'teczka-posiedzenia';
}
/**
 * Nazwa pliku bez rozszerzenia (B1-07): `{RRRR-MM-DD}-{organ}-{rodzaj}[-{numer}][-projekt|-stan-na-{RRRRMMDD-GGMM}]`,
 * małe litery ASCII, łączniki, najwyżej 80 znaków. Rodzaj zaczynający się od „projekt-” nie dostaje drugiego dopisku.
 */
export function fileBase(m: Meeting, id: PaperId, at: number): string {
  const organ = m.kind === 'procedura' ? `${m.organ}-glosowanie-miedzy-posiedzeniami` : m.organ;
  const kind = fileKind(m, id), state = paperState(m, id);
  const stamp = (ts: number) => `${isoDayOf(ts).replace(/-/g, '')}-${timeOf(ts).replace(':', '')}`;
  const suffix = state === 'projekt' && !kind.startsWith('projekt-') ? '-projekt' : state === 'stan_na' ? `-stan-na-${stamp(at)}` : '';
  return `${paperDay(m)}-${asciiSlug(`${organ}-${kind}`, 80)}${suffix}`.slice(0, 80).replace(/-+$/, '');
}
const PAPER_FORMATS: Record<string, PaperFormat[]> = {
  protokol: ['html', 'docx'], porzadek: ['html', 'docx', 'md'], obecnosc: ['html', 'docx', 'csv'], 'obecnosc-podpis': ['html', 'docx'],
  wyniki: ['html', 'docx', 'csv'], wykaz: ['csv'], akt: ['html', 'docx'], kanal: ['html', 'docx', 'csv'], dziennik: ['html', 'csv'],
  komunikacja: ['md'], teczka: ['zip'],
};
/** Formaty dokumentu (B1-11). */
export const paperFormats = (id: PaperId): PaperFormat[] => PAPER_FORMATS[id.startsWith('wykaz-') ? 'wykaz' : id.startsWith('akt-') ? 'akt' : id] ?? [];
/** Wiadomości kanału w dokumencie: przy posiedzeniu otwartym w wersji 4 tylko od otwarcia albo rozpoczęcia (B2-W20, DB-15). */
export const channelMessages = (m: Pick<Meeting, 'messages' | 'frozen' | 'openedAt'>) => m.frozen?.v4 ? m.messages.filter(x => m.openedAt !== undefined && x.at >= m.openedAt) : m.messages;

/**
 * Lista dokumentów posiedzenia dla osoby (B1-01): tylko dokumenty, do których ma prawo (`canDownloadPaper`, tabela
 * 4.3.3), w kolejności karty „Dokumenty posiedzenia”. W przygotowaniu tylko projekt porządku obrad. Przyjmuje widok
 * posiedzenia, więc klient liczy listę bez zapytania.
 */
export function meetingPapers(m: Meeting, env: Pick<CascadeEnv, 'roster' | 'docTypes'>, actor: Actor, at = Date.now()): PaperEntry[] {
  const ids: {id: PaperId; ballotId?: string; note?: string}[] = [];
  if (m.status === 'przygotowanie') ids.push({id: 'porzadek'});
  else {
    const hidden = hiddenForFiles(m);
    ids.push({id: 'protokol'}, {id: 'porzadek'}, {id: 'obecnosc'});
    if (m.kind === 'posiedzenie' && m.mode === 'stacjonarne') ids.push({id: 'obecnosc-podpis'});
    if (m.ballots.some(b => b.purpose !== 'proba')) ids.push({id: 'wyniki'});
    for (const b of m.ballots) if (b.mode === 'imienne' && announced(b) && !hidden.has(b.id)) ids.push({id: `wykaz-${b.number}`, ballotId: b.id});
    for (const b of actBallots(m, env)) ids.push({id: `akt-${b.id}`, ballotId: b.id});
    ids.push(channelMessages(m).length ? {id: 'kanal'} : {id: 'kanal', note: 'Nie było wiadomości.'});
    ids.push({id: 'dziennik'});
    if (m.status === 'zakonczone') ids.push({id: 'komunikacja'}, {id: 'teczka'});
  }
  return ids.filter(x => canDownloadPaper(env.roster, m, actor, x.id)).map(x => ({
    id: x.id, name: paperName(m, x.id), state: paperState(m, x.id), formats: x.note ? [] : paperFormats(x.id), fileBase: fileBase(m, x.id, at),
    ...(x.ballotId ? {ballotId: x.ballotId} : {}), ...(x.note ? {note: x.note} : {}),
  }));
}

// Renderery nowych dokumentów (B1-15–B1-22).

export interface PaperContext {
  env: CascadeEnv;
  /** Chwila wygenerowania („Stan na …”, stopka). */
  at: number;
  /** Nazwa biura w bierniku do zdań listy obecności („zapisane przez biuro Izby”); w wersji próbnej bez nazwy Izby. */
  office?: string;
  /** Plik Word: fakty, porządek i podpisy w prostszym zapisie, który edytory tekstu odczytują wiernie. */
  word?: boolean;
  /** Treść wersji materiału i jej skrót (akt z treścią przyjętą, B1-18). */
  materialHtml?: (materialId: string, version: number) => {html: string; hash: string} | null;
  /** Wpisy historii ustawień dotyczące posiedzenia (dziennik u biura i przewodniczącego, B1-22). */
  audit?: {at: number; by: string; text: string}[];
}
const organName = (m: Meeting, roster: Roster) => organOf(roster, m.organ)?.name ?? 'Prezydium';
const genitive = (m: Meeting, roster: Roster) => organOf(roster, m.organ)?.forms?.genitive ?? organName(m, roster);
const accountsOf = (ctx: PaperContext) => (ctx.env.accounts ?? []) as Pick<Account, 'id' | 'kind' | 'displayName' | 'label'>[];
const kindName = (a: Pick<Account, 'kind' | 'label'>) => a.label || (a.kind === 'doradczy' ? 'głos doradczy' : a.kind === 'gosc' ? 'gość' : '');
function table(label: string, head: string[], rows: string[][], numeric: number[] = [], className = '') {
  const cls = (i: number) => numeric.includes(i) ? ' class="oi-liczba"' : '';
  return `<div class="table-wrap" role="region" tabindex="0" aria-label="${t(label)}"><table${className ? ` class="${className}"` : ''}><thead><tr>${head.map((h, i) => `<th scope="col"${cls(i)}>${t(h)}</th>`).join('')}</tr></thead><tbody>`
    + rows.map(r => `<tr>${r.map((c, i) => i === 0 ? `<th scope="row">${c}</th>` : `<td${cls(i)}>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
}
function facts(ctx: PaperContext, list: [string, string][]) {
  return ctx.word
    ? `<table class="facts">${list.map(([l, v]) => `<tr><th scope="row">${t(l)}</th><td>${t(v)}</td></tr>`).join('')}</table>`
    : `<dl class="facts minutes-facts">${list.map(([l, v]) => `<div class="fact"><dt>${t(l)}</dt><dd>${t(v)}</dd></div>`).join('')}</dl>`;
}
/** Etykieta stanu na górze pierwszej strony (B1-02). */
export function stateLine(m: Meeting, id: PaperId, at: number): string {
  const state = paperState(m, id);
  if (state === 'projekt') return 'Projekt';
  if (state === 'stan_na') return `Stan na ${dateDots(isoDayOf(at))}, godz. ${timeOf(at)}. ${m.status === 'przygotowanie' ? 'Posiedzenie w przygotowaniu.' : m.kind === 'procedura' ? 'Głosowanie trwa.' : 'Posiedzenie trwa.'}`;
  return '';
}
function head(m: Meeting, id: PaperId, ctx: PaperContext) {
  const {roster} = ctx.env;
  const day = paperDay(m);
  const what = m.kind === 'procedura' ? 'głosowania między posiedzeniami' : isNote(m) ? 'spotkania roboczego' : 'posiedzenia';
  const line = stateLine(m, id, ctx.at);
  const title = `${t(`${paperName(m, id)} ${what}`)} <b>${t(organName(m, roster))}</b> ${t(`z dnia ${longDate(day)}`)}`;
  const list: [string, string][] = [];
  if (m.kind === 'procedura') list.push(['Termin głosowania', m.openedAt ? `od ${dateDots(isoDayOf(m.openedAt))}, godz. ${timeOf(m.openedAt)}` : DOTS]);
  else {
    list.push(['Termin', `${longDate(day)}, godz. ${m.openedAt ? (m.closedAt ? `${timeOf(m.openedAt)}–${timeOf(m.closedAt)}` : timeOf(m.openedAt)) : m.time}`]);
    if (m.place.trim()) list.push(['Miejsce', m.place.trim()]);
    list.push(['Tryb', m.mode === 'zdalne' ? 'posiedzenie zdalne' : 'posiedzenie stacjonarne']);
    if (m.chair.current) list.push(['Prowadzi', `${personName(roster, m.chair.current)}`]);
  }
  return `<header>${line ? `<p class="draft">${t(line)}</p>` : ''}<h1>${title}</h1>${facts(ctx, list)}</header>`;
}

/** Porządek obrad z informacją o zawiadomieniu (B1-15). */
function agendaHtml(m: Meeting, ctx: PaperContext) {
  const out = [head(m, 'porzadek', ctx)];
  const noticed = new Set(m.noticeItems ?? []);
  const line = (i: AgendaItem) => {
    const people = presenterGroups(i).map(g => `${g.label === 'Referuje' ? 'Według porządku obrad referuje' : g.label === 'Referują' ? 'Według porządku obrad referują' : g.label} ${g.people.join('; ')}`);
    const flags = [i.addedAfterAdoption && 'dodany po przyjęciu porządku', i.status === 'odroczony' && 'odroczony', i.status === 'wycofany' && 'wycofany', m.noticeItems && !noticed.has(i.id) && 'Punkt nie był w zawiadomieniu.'].filter(Boolean) as string[];
    return `${t(`${itemNumber(m.agenda, i.id)}. ${i.title}`)}${flags.length ? ` <em>${t(`(${flags.join(', ').replace(/\.$/, '')})`)}</em>` : ''}${people.length ? `<br>${t(people.join('. ') + '.')}` : ''}`;
  };
  out.push(ctx.word
    ? orderedAgenda(m.agenda).map(i => `<p class="agenda-line${i.parentId ? ' agenda-sub' : ''}">${line(i)}</p>`).join('')
    : '<ol class="minutes-agenda paper-list">' + m.agenda.filter(i => !i.parentId).map(top => {
      const subs = m.agenda.filter(i => i.parentId === top.id);
      return `<li>${line(top)}${subs.length ? '<ol>' + subs.map(s => `<li>${line(s)}</li>`).join('') + '</ol>' : ''}</li>`;
    }).join('') + '</ol>');
  for (const s of m.skipped ?? []) out.push(p(`Pominięto punkt ${quoted(s.title)}. Powód ${quoted(s.reason.trim().replace(/\.$/, ''))}.`));
  const changes = m.log.filter(l => l.tag === 'projekt' && m.openedAt !== undefined && l.at >= m.openedAt);
  if (changes.length) out.push(p('Zmiany projektu porządku obrad na posiedzeniu.') + '<ul class="draft-changes paper-list">' + changes.map(l => `<li>${t(`Godz. ${timeOf(l.at)}. ${l.text}`)}</li>`).join('') + '</ul>');
  const hidden = hiddenForFiles(m);
  const after = m.ballots.filter(b => b.purpose === 'zmiana_porzadku' && announced(b) && !hidden.has(b.id));
  for (const b of after) out.push(p(`Zmiana porządku obrad w głosowaniu nr ${b.number}. ${b.subject.trim().replace(/\.$/, '')}. ${resultLabel(b, materialTypeOf(m, b))}.`));
  const adoption = [...m.ballots].reverse().find(b => b.purpose === 'porzadek' && announced(b) && b.result!.adopted);
  if (m.kind === 'posiedzenie') {
    if (isNote(m)) out.push(p('Na spotkaniu roboczym nie przeprowadza się głosowań, więc porządek obrad pozostaje projektem.'));
    else if (adoption && m.agendaAdopted) out.push(p(`Porządek obrad przyjęty w głosowaniu nr ${adoption.number}.`));
  }
  const days = noticeDays({...m, date: paperDay(m)});
  const sent = `Zawiadomienie o terminie, miejscu i porządku obrad wysłano ${longDate(m.noticeDate)}`;
  if (m.kind === 'posiedzenie') {
    if (days === null) out.push(p('Nie wpisano daty wysłania zawiadomienia (§ 7 ust. 1).'));
    else if (days <= 0) out.push(p(`${sent}, czyli mniej niż wymagane 7 dni przed posiedzeniem (§ 7 ust. 1).`));
    else out.push(p(`${sent}, ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem${days < 7 ? ', czyli mniej niż wymagane 7 dni' : ''} (§ 7 ust. 1).`));
  }
  return out.join('');
}
/** Porządek obrad w Markdown do wklejenia w wiadomość (B1-11); zwykłe spacje. */
export function agendaMarkdown(m: Meeting, ctx: PaperContext): string {
  const {roster} = ctx.env;
  const line = stateLine(m, 'porzadek', ctx.at);
  const out = [`# ${paperName(m, 'porzadek')} ${m.kind === 'procedura' ? 'głosowania między posiedzeniami' : 'posiedzenia'} ${organName(m, roster)} z dnia ${longDate(paperDay(m))}`, ''];
  if (line) out.push(line, '');
  const md = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/([\\`*_[\]<>|#])/g, '\\$1');
  for (const top of m.agenda.filter(i => !i.parentId)) {
    out.push(`${itemNumber(m.agenda, top.id)}. ${md(top.title)}`);
    for (const s of m.agenda.filter(i => i.parentId === top.id)) out.push(`   - ${itemNumber(m.agenda, s.id)}. ${md(s.title)}`);
  }
  return out.join('\n') + '\n';
}

/** Lista obecności (B1-16): członkowie ze składu zapisanego przy otwarciu, głos doradczy i goście, stwierdzenia kworum. */
function attendanceHtml(m: Meeting, ctx: PaperContext) {
  const {roster} = ctx.env;
  const members = organRoster(roster, m);
  const c: ConfirmContext = {m, roster, office: ctx.office ?? 'biuro', v3: !!m.frozen && !m.frozen.legacy};
  const head4 = ['Imię i nazwisko', 'Funkcja', 'Obecność', 'Sposób potwierdzenia'];
  const out = [head(m, 'obecnosc', ctx)];
  out.push(table('Lista obecności', head4, members.map(ms => {
    const name = personName(roster, ms.personId);
    return [t(name), t(ms.label), t(presenceText(m, ms.personId, false)), t(confirmedBy(c, ms.personId, false, name))];
  }), [], 'attendance-table'));
  const invited = m.invited.map(id => accountsOf(ctx).find(a => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a);
  if (invited.length) {
    out.push(`<h2>${t('Osoby z głosem doradczym i goście')}</h2>`);
    out.push(table('Osoby z głosem doradczym i goście', [...head4, 'Kto zaprasza'], invited.map(a => {
      const invite = m.guestInvites?.[a.id];
      const by = a.kind === 'gosc' ? (invite?.by === 'organ' ? `Prezydium${invite.decision ? `, ${invite.decision}` : ''}` : invite?.by === 'przewodniczacy' ? 'przewodniczący' : '') : '';
      return [t(a.displayName), t(kindName(a)), t(presenceText(m, a.id, true)), t(confirmedBy(c, a.id, true, a.displayName)), t(by)];
    }), [], 'attendance-table'));
  }
  const required = quorumOf(lawOf(m.organ), members.length);
  out.push(p(`Skład ${members.length} ${plural(members.length, 'osoba', 'osoby', 'osób')}, wymagane kworum ${required} (${lawOf(m.organ).quorum.basis}).`));
  if (m.quorumChecks.length) out.push('<ul class="quorum-checks paper-list">' + m.quorumChecks.map(q => `<li>${t(`O godz. ${timeOf(q.at)} stwierdzono ${q.present >= q.required ? 'kworum' : 'brak kworum'}, obecnych ${q.present}, wymagane ${q.required}.`)}</li>`).join('') + '</ul>');
  return out.join('');
}
/** Lista obecności do podpisu (posiedzenie stacjonarne). */
function signSheetHtml(m: Meeting, ctx: PaperContext) {
  const {roster} = ctx.env;
  const rows = [
    ...organRoster(roster, m).map(ms => [t(personName(roster, ms.personId)), t(ms.label), '']),
    ...m.invited.map(id => accountsOf(ctx).find(a => a.id === id)).filter((a): a is NonNullable<typeof a> => !!a).map(a => [t(a.displayName), t(kindName(a)), '']),
  ];
  return head(m, 'obecnosc-podpis', ctx) + table('Lista obecności do podpisu', ['Imię i nazwisko', 'Funkcja', 'Podpis'], rows, [], 'sign-sheet');
}
export function attendanceCsv(m: Meeting, ctx: PaperContext): string {
  const {roster} = ctx.env;
  const c: ConfirmContext = {m, roster, office: ctx.office ?? 'biuro', v3: !!m.frozen && !m.frozen.legacy};
  const first = (who: string, guest: boolean) => { const e = m.presenceLog.find(x => x.who === who && !!x.guest === guest && x.type === 'przybycie'); return e ? timeOf(e.at) : ''; };
  const exits = (who: string, guest: boolean) => m.presenceLog.filter(x => x.who === who && !!x.guest === guest && x.type === 'wyjscie').map(x => timeOf(x.at)).join(', ');
  const rows = organRoster(roster, m).map(ms => {
    const name = personName(roster, ms.personId);
    return [name, ms.label, 'członek', presenceText(m, ms.personId, false), confirmedBy(c, ms.personId, false, name), first(ms.personId, false), exits(ms.personId, false)];
  });
  for (const a of m.invited.map(id => accountsOf(ctx).find(x => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x)) {
    rows.push([a.displayName, a.label, a.kind === 'doradczy' ? 'głos doradczy' : 'gość', presenceText(m, a.id, true), confirmedBy(c, a.id, true, a.displayName), first(a.id, true), exits(a.id, true)]);
  }
  return csv(['Imię i nazwisko', 'Funkcja', 'Rodzaj', 'Obecność', 'Sposób potwierdzenia', 'Pierwsze przybycie', 'Wyjścia'], rows);
}

/** Wynik głosowania słowami do pliku albo `null`, gdy wynik nie może trafić do pliku (B1-03, T-7). */
function ballotOutcome(m: Meeting, b: Ballot, hidden: Set<string>): string | null {
  if (b.status === 'otwarte') return openBallotText(b.number);
  if (b.aborted) return 'Głosowanie przerwane, rozstrzygnięcie nie zapadło.';
  if (hidden.has(b.id) || !b.result) return m.kind === 'procedura' ? resultPendingProcedureText : resultPendingText;
  return null;
}
/** Osoby, które oddały głos albo pobrały kartę (głosowanie między posiedzeniami), w kolejności składu, bez godzin. */
function participation(m: Meeting, roster: Roster, b: Ballot) {
  const order = organRoster(roster, m).map(x => x.personId);
  const ranked = (ids: string[]) => [...ids].sort((x, y) => (order.indexOf(x) + 1 || 999) - (order.indexOf(y) + 1 || 999));
  const names = (ids: string[]) => ranked(ids).map(id => personName(roster, id)).join(', ');
  if (b.secret) {
    const took = b.eligible.filter(id => b.secret!.issued.includes(id));
    return took.length ? `Kartę do głosowania pobrały osoby ${names(took)}.` : 'Nikt nie pobrał karty do głosowania.';
  }
  const cast = new Set(b.aborted?.voters ?? Object.keys(b.votes));
  const voted = b.eligible.filter(id => cast.has(id));
  return voted.length ? `Głos oddały osoby ${names(voted)}.` : 'Nikt nie oddał głosu.';
}
/** Wyniki głosowań (B1-17): tabela bez próbnych, tajne tylko liczby, imienne z wykazem, udział w kolejności składu. */
function resultsHtml(m: Meeting, ctx: PaperContext) {
  const {roster} = ctx.env;
  const hidden = hiddenForFiles(m);
  const list = m.ballots.filter(b => b.purpose !== 'proba').sort((a, b) => a.number - b.number);
  const out = [head(m, 'wyniki', ctx)];
  if (!list.length) return out.concat(p('Nie przeprowadzono głosowań.')).join('');
  for (const b of list) {
    const blocks = [`<p class="ballot-head"><strong>${t(`Głosowanie nr ${b.number}`)}</strong></p>`];
    const outcome = ballotOutcome(m, b, hidden);
    if (b.status === 'otwarte') { out.push(`<div class="ballot">${blocks.join('')}${p(outcome!)}</div>`); continue; }
    blocks.push(p(`${b.subject} (${b.mode}${b.modeBasis ? `, ${b.modeBasis}` : ''})`, 'ballot-subject'));
    if (outcome) { out.push(`<div class="ballot">${blocks.join('')}${p(outcome, 'muted')}</div>`); continue; }
    const r = b.result!;
    blocks.push(table(`Wynik głosowania nr ${b.number}`, ['Za', 'Przeciw', 'Wstrzymało się', 'Głosowało', 'Wymagane kworum', 'Wynik'],
      [[String(r.za), String(r.przeciw), String(r.wstrzymuje), t(`${r.cast} z ${r.eligible}`), String(r.quorum), t(resultLabel(b, materialTypeOf(m, b)))]], [0, 1, 2, 4], 'result-table'));
    if (b.secret) blocks.push(`<p class="muted">${t(`Głosowanie tajne. Pobrano kart ${b.secret.issued.length}, oddano głosów ${b.secret.cast}. Odcisk klucza głosowania`)} <code>${esc(b.secret.fingerprint)}</code>. ${t('System nie zapisuje powiązania między osobą a głosem.')}</p>`);
    if (b.mode === 'imienne') {
      const order = organRoster(roster, m).map(x => x.personId);
      const ids = [...b.eligible].sort((x, y) => (order.indexOf(x) + 1 || 999) - (order.indexOf(y) + 1 || 999));
      blocks.push(table(`Wykaz imienny głosowania nr ${b.number}`, ['Imię i nazwisko', 'Głos'], ids.map(id => [t(personName(roster, id)), t(b.votes[id] ? choiceLabel[b.votes[id]] : 'brak głosu')])));
    }
    if (b.remote) blocks.push(p(participation(m, roster, b)));
    if (b.reasumptionOf) blocks.push(p(`Reasumpcja głosowania nr ${m.ballots.find(x => x.id === b.reasumptionOf)?.number ?? DOTS} (§ 12).`, 'muted'));
    if (b.supersededBy && !hidden.has(b.supersededBy) && m.ballots.find(x => x.id === b.supersededBy)?.status === 'zamkniete') blocks.push(p(`Wynik zastąpiono wynikiem reasumpcji w głosowaniu nr ${m.ballots.find(x => x.id === b.supersededBy)?.number ?? DOTS}.`, 'muted'));
    out.push(`<div class="ballot">${blocks.join('')}</div>`);
  }
  const trials = m.ballots.filter(b => b.purpose === 'proba');
  for (const b of trials) out.push(p(`O godz. ${timeOf(b.openedAt)} przeprowadzono głosowanie próbne (${b.mode}) w celu sprawdzenia działania systemu.`, 'muted'));
  return out.join('');
}
export function resultsCsv(m: Meeting, ctx: PaperContext): string {
  const hidden = hiddenForFiles(m);
  const rows = m.ballots.filter(b => b.purpose !== 'proba').sort((a, b) => a.number - b.number).map(b => {
    const outcome = ballotOutcome(m, b, hidden);
    const r = outcome ? null : b.result!;
    if (b.status === 'otwarte') return [b.number, '', '', '', '', '', '', '', '', outcome!];
    return [b.number, b.subject, `${b.mode}${b.modeBasis ? `, ${b.modeBasis}` : ''}`, r?.za ?? '', r?.przeciw ?? '', r?.wstrzymuje ?? '', r ? `${r.cast} z ${r.eligible}` : '', r?.quorum ?? '',
      b.reasumptionOf ? `reasumpcja głosowania nr ${m.ballots.find(x => x.id === b.reasumptionOf)?.number ?? ''}` : '', outcome ?? resultLabel(b, materialTypeOf(m, b))];
  });
  return csv(['Numer', 'Przedmiot', 'Tryb', 'Za', 'Przeciw', 'Wstrzymało się', 'Głosowało', 'Wymagane kworum', 'Reasumpcja', 'Wynik'], rows);
}
/** Wykaz imienny jednego głosowania (CSV), w kolejności składu; tylko ogłoszone głosowanie imienne. */
export function rollCallCsv(m: Meeting, ctx: PaperContext, number: number): string {
  const b = m.ballots.find(x => x.number === number && x.mode === 'imienne');
  if (!b || !announced(b) || hiddenForFiles(m).has(b.id)) throw Object.assign(new Error('Ten dokument nie istnieje.'), {status: 404});
  const order = organRoster(ctx.env.roster, m).map(x => x.personId);
  const ids = [...b.eligible].sort((x, y) => (order.indexOf(x) + 1 || 999) - (order.indexOf(y) + 1 || 999));
  return csv(['Imię i nazwisko', 'Głos'], ids.map(id => [personName(ctx.env.roster, id), b.votes[id] ? choiceLabel[b.votes[id]] : 'brak głosu']));
}

/** Akt z treścią przyjętą (B1-18) z miejscami na podpisy (B1-06). Niezgodny skrót treści: błąd z komunikatem B1-18. */
function actHtml(m: Meeting, ctx: PaperContext, ballotId: string) {
  const {roster} = ctx.env;
  const b = actBallots(m, ctx.env).find(x => x.id === ballotId);
  if (!b) throw Object.assign(new Error('Ten dokument nie istnieje.'), {status: 404});
  const out = [`<header><p class="draft">${t(organName(m, roster))}</p><h1>${t(actTitle(b))}</h1></header>`];
  if (b.material) {
    const content = ctx.materialHtml?.(b.material.id, b.material.version) ?? null;
    if (!content || content.hash !== b.material.hash) throw Object.assign(new Error('Treść w aplikacji różni się od wersji głosowanej. Zgłoś to biuru.'), {status: 409});
    out.push(`<div class="act-text">${content.html}</div>`);
  } else out.push(p('Treści aktu nie dołączono w aplikacji.'));
  const r = b.result!;
  const formula = b.formulas?.adopted ?? resultLabel(b, materialTypeOf(m, b));
  out.push(p(`Treść przyjęta w głosowaniu nr ${b.number} (${b.mode}) na ${m.kind === 'procedura' ? 'głosowaniu między posiedzeniami' : 'posiedzeniu'} z dnia ${longDate(paperDay(m))}. ${formula}. Za ${r.za}, przeciw ${r.przeciw}, wstrzymało się ${r.wstrzymuje}. Dokument z aplikacji, bez podpisów.`, 'muted'));
  // Podpisy (B1-06, § 8 ust. 7 RR): przewodniczący lub wiceprzewodniczący oraz członek Okręgowej Rady, a w sprawach
  // finansowych skarbnik.
  const item = m.agenda.find(i => i.id === b.itemId);
  const financial = !!ctx.env.general.caseTypes.find(c => c.id === item?.caseType)?.financial;
  const council = organOf(roster, 'rada')?.forms?.genitive ?? 'Okręgowej Rady';
  const second = financial ? `Skarbnik ${council}` : `Członek ${council}`;
  const people: [string, string][] = [[`Przewodniczący lub Wiceprzewodniczący ${council}`, DOTS], [second, DOTS]];
  out.push(ctx.word
    ? '<table class="signatures"><tr>' + people.map(([role]) => `<td>${'.'.repeat(30)}<br>${t(role)}</td>`).join('') + '</tr></table>'
    : '<div class="signatures">' + people.map(([role]) => `<div class="signature"><span class="signature-role">${t(role)}</span><span class="signature-name">${t(DOTS)}</span></div>`).join('') + '</div>');
  if (financial) out.push(p('Gdy podpis skarbnika jest niemożliwy, podpisuje inny członek Prezydium.', 'muted'));
  out.push(p(`Podpisy według ${lawOf(m.organ).acts.signaturesBasis} ${organOf(roster, m.organ)?.forms?.regulation ?? ''}.`.replace(/ \.$/, '.'), 'muted'));
  return out.join('');
}
/** Kanał wiadomości (B1-21): autor, data, godzina, treść, w kolejności czasu. */
function channelHtml(m: Meeting, ctx: PaperContext) {
  const list = channelMessages(m);
  const out = [head(m, 'kanal', ctx)];
  if (!list.length) return out.concat(p('Nie było wiadomości.')).join('');
  out.push('<ul class="messages paper-list">' + list.map(x => `<li><strong>${t(x.authorName)}</strong>, ${t(`${dateDots(isoDayOf(x.at))}, godz. ${timeOf(x.at)}. ${quoted(x.text)}`)}</li>`).join('') + '</ul>');
  return out.join('');
}
export function channelCsv(m: Meeting): string {
  return csv(['Autor', 'Data', 'Godzina', 'Treść'], channelMessages(m).map(x => [x.authorName, isoDayOf(x.at), timeOf(x.at), x.text]));
}
const TAG_LABEL: Record<string, string> = {projekt: 'Porządek', ustawienia: 'Ustawienia', odstepstwo: 'Odstępstwo', pokaz: 'Pokaz'};
const seconds = (ts: number) => new Intl.DateTimeFormat('pl-PL', {timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(ts);
/** Wpisy dziennika z liczbami nieogłoszonych wyników ukrytymi jak w widoku (B1-22) i zdarzeniami listy obecności. */
function logRows(m: Meeting, ctx: PaperContext) {
  const hidden = hiddenForFiles(m);
  const rows = m.log.map(l => ({at: l.at, by: l.by, tag: l.tag ? TAG_LABEL[l.tag] ?? '' : '',
    text: l.ballotId && hidden.has(l.ballotId) ? l.text.replace(/ Za \d+, przeciw \d+, wstrzymało się \d+\.$/, '') : l.text}));
  const name = (who: string, guest: boolean) => guest ? accountsOf(ctx).find(a => a.id === who)?.displayName ?? '' : personName(ctx.env.roster, who);
  const what = {przybycie: 'Zapisano obecność', wyjscie: 'Zapisano wyjście', zgloszenie: 'Zgłoszono obecność', odrzucenie: 'Odrzucono albo wycofano zgłoszenie obecności'} as const;
  for (const e of m.presenceLog) rows.push({at: e.at, by: e.by, tag: 'Obecność', text: `${what[e.type]}, ${name(e.who, e.guest)}.`});
  for (const a of ctx.audit ?? []) rows.push({at: a.at, by: a.by, tag: 'Historia zmian', text: a.text});
  return rows.sort((x, y) => x.at - y.at);
}
function logHtml(m: Meeting, ctx: PaperContext) {
  const rows = logRows(m, ctx);
  return head(m, 'dziennik', ctx) + (rows.length ? table('Dziennik', ['Godzina', 'Wpis', 'Rodzaj', 'Osoba'], rows.map(r => [t(`${dateDots(isoDayOf(r.at))}, ${timeOf(r.at)}`), t(r.text), t(r.tag), t(r.by)])) : p('Dziennik nie ma wpisów.'));
}
export function logCsv(m: Meeting, ctx: PaperContext): string {
  return csv(['Data', 'Godzina', 'Wpis', 'Rodzaj', 'Osoba'], logRows(m, ctx).map(r => [isoDayOf(r.at), seconds(r.at), r.text, r.tag, r.by]));
}

/**
 * Treść dokumentu w HTML (zawartość strony do druku albo wariant do pliku Word). Projekt protokołu i materiał dla
 * komunikacji mają własne generatory (src/server/minutes.ts, comms.ts), a teczka własną trasę.
 */
export function paperHtml(id: PaperId, m: Meeting, ctx: PaperContext): string {
  if (id === 'porzadek') return agendaHtml(m, ctx);
  if (id === 'obecnosc') return attendanceHtml(m, ctx);
  if (id === 'obecnosc-podpis') return signSheetHtml(m, ctx);
  if (id === 'wyniki') return resultsHtml(m, ctx);
  if (id.startsWith('akt-')) return actHtml(m, ctx, id.slice(4));
  if (id === 'kanal') return channelHtml(m, ctx);
  if (id === 'dziennik') return logHtml(m, ctx);
  throw Object.assign(new Error('Ten dokument nie ma takiego formatu.'), {status: 400});
}
/** Plik CSV dokumentu (B1-11). */
export function paperCsv(id: PaperId, m: Meeting, ctx: PaperContext): string {
  if (id === 'obecnosc') return attendanceCsv(m, ctx);
  if (id === 'wyniki') return resultsCsv(m, ctx);
  if (id.startsWith('wykaz-')) return rollCallCsv(m, ctx, Number(id.slice(6)));
  if (id === 'kanal') return channelCsv(m);
  if (id === 'dziennik') return logCsv(m, ctx);
  throw Object.assign(new Error('Ten dokument nie ma takiego formatu.'), {status: 400});
}

/** Nagłówek stron od drugiej (B1-05): „{PROJEKT |STAN NA …}{nazwa dokumentu}, {posiedzenie|…} z dnia {dd.mm.rrrr}”. */
export function pageHeader(m: Meeting, name: string): string {
  const what = m.kind === 'procedura' ? 'głosowanie między posiedzeniami' : isNote(m) ? 'spotkanie robocze' : 'posiedzenie';
  return `${name}, ${what} z dnia ${dateDots(paperDay(m))}`;
}
/** Lewa część stopki (B1-05): „Wygenerowano {dd.mm.rrrr}, godz. {g}”. */
export const generatedLine = (at: number) => `Wygenerowano ${dateDots(isoDayOf(at))}, godz. ${timeOf(at)}`;

export interface PageOptions {
  title: string; header: string; draft: boolean; generatedAt: number;
  /** Napis stanu „STAN NA …” w nagłówku stron (dokument „stan na”). */
  stateMark?: string;
  /** Arkusz stylów aplikacji (adres) albo `null` w teczce i wersji próbnej (styl wewnętrzny). */
  css?: string | null;
  /** Wizytówka z pierwszej strony (znak i nazwa) w aplikacji; w wersji próbnej i teczce brak. */
  plate?: string;
  /** Odnośniki do innych formatów na pasku druku. */
  links?: {href: string; label: string; name: string}[];
  /** Plik HTML w teczce: CSP w nagłówku dokumentu, bez skryptu druku (K4-15). */
  standalone?: boolean;
}
const css = (s: string) => s.replace(/["\\]/g, '\\$&').replace(/[\n\r]/g, ' ');
/**
 * Strona do druku i zapisu jako PDF (B1-05, B1-08, K4-9): treść w tabeli układu, której wiersz `thead` z napisem
 * „Projekt” powtarza się na każdej drukowanej stronie w każdej przeglądarce, która drukuje tabele; pola `@page` dla
 * nagłówka od drugiej strony, stopki „Wygenerowano …” i „Strona X z Y” (Chrome i Edge).
 */
export function paperPage(body: string, o: PageOptions): string {
  const mark = o.draft ? 'Projekt' : o.stateMark ?? '';
  // Słowo stanu przed nagłówkiem, chyba że nagłówek już się nim zaczyna („Projekt protokołu…” bez „PROJEKT Projekt”).
  const lead = mark && !o.header.toLocaleLowerCase('pl').startsWith(mark.toLocaleLowerCase('pl')) ? `${mark.toLocaleUpperCase('pl')} ` : '';
  const header = css(`${lead}${o.header}`);
  const pages = `<style>@media print{@page{@top-left{content:"${header}"}@bottom-left{content:"${css(generatedLine(o.generatedAt))}"}}@page:first{@top-left{content:none}}}</style>`;
  const style = o.standalone
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${STANDALONE_CSS}</style>`
    : o.css ? `<link rel="stylesheet" href="${esc(o.css)}">` : `<style>${STANDALONE_CSS}</style>`;
  const links = (o.links ?? []).map(l => `<a class="oi-btn oi-btn--obrys" href="${esc(l.href)}" aria-label="${t(l.name)}"><span>${t(l.label)}</span></a>`).join('');
  const toolbar = o.standalone ? '' : `<div class="toolbar paper-toolbar"><span class="kicker">${t(o.title)}</span><div class="toolbar-actions">${links}<button type="button" class="oi-btn" data-print><span>${t('Drukuj albo zapisz jako PDF')}</span></button></div><p class="toolbar-note">${t('Numery stron drukują Chrome i Edge. W innej przeglądarce pobierz wersję Word.')}</p></div>`;
  const layout = `<table class="paper-layout" role="presentation"><thead><tr><td>${mark ? `<p class="paper-mark">${t(mark)}</p>` : ''}</td></tr></thead><tbody><tr><td>${o.plate ?? ''}<article class="minutes-view">${body}</article></td></tr></tbody></table>`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.title)}</title>${style}${pages}</head>
<body class="oi-root minutes-page paper-page">${toolbar}<main>${layout}</main>${o.standalone ? '' : '<script src="/druk.js"></script>'}</body></html>`;
}
/** Styl wewnętrzny stron w teczce i bez arkusza aplikacji (bez zewnętrznych arkuszy i skryptów, K4-15). */
export const STANDALONE_CSS = 'body{font-family:"Titillium Web",Arial,sans-serif;max-width:52rem;margin:0 auto;padding:24px;line-height:1.45}'
  + 'table{border-collapse:collapse}th,td{border:1px solid currentColor;padding:3pt 5pt;text-align:left;vertical-align:top}'
  + 'table.paper-layout{table-layout:fixed}.table-wrap{overflow-x:auto}table.paper-layout,table.paper-layout>*>tr>td{border:0;padding:0;width:100%}.paper-mark{font-weight:700;text-transform:uppercase;letter-spacing:.1em;font-size:9pt}'
  + 'table.facts th,table.facts td,.signatures td{border:0}.draft{font-weight:700;text-transform:uppercase;font-size:9pt}.muted{font-style:italic}'
  + 'ul.paper-list{list-style:none;padding-left:1.2em}ul.paper-list>li::before{content:"– ";margin-left:-1.2em}'
  + '@media print{body{max-width:none;padding:0}@page{size:A4;margin:16mm 15mm;@bottom-right{content:"Strona " counter(page) " z " counter(pages)}}.ballot,tr,.signatures{break-inside:avoid}}';
