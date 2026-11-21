import {Fragment, type ComponentChildren} from 'preact';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {announceFirst, awaitingVote, choiceLabel, docTypeFor, itemNumber, itemVoted, materialTypeOf, needsVote, orderedAgenda, pendingBefore, pendingPresence, presentMembers, quorumStated, resolutionSubject, resultLabel, unannounced, unhandledItems} from '../shared/rules.ts';
import {organOf} from '../shared/roster.ts';
import {canChairPerson, canDesignateDeputy, canKeepAttendance, chairRank, deputyOf, isChairmanOf, isOfficeAccount, organRoster} from '../shared/role.ts';
import {docTypeById} from '../shared/doctypes.ts';
import {lawOf} from '../shared/law.ts';
import {VOTE_MINUTES} from '../shared/settings.ts';
import {minutesText, timeOf} from '../shared/text.ts';
import {PapersCard} from './papers.tsx';
import type {Effective} from '../shared/cascade.ts';
import type {Actor, AgendaChange, AgendaItem, BallotPurpose, DocType, Meeting, Message, Motion, Presence, Roster, VoteMode} from '../shared/types.ts';
import {request, serverNow} from './api.ts';
import {useMeeting, type ViewBallot, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Confirm, Countdown, Fact, Field, Fold, fmtTime, Modal, Notice, plural, SaveStatus, Segments, StateChip, Tag, TitleLead, useMedia, useSaveStatus} from './ui.tsx';
import {agendaChip, itemChip, modeGenitive, modeName, presenceChip} from './stany.ts';
import {actorOf, AgendaList, BasisBlock, beforeAdoption, chairingText, DeputyFact, draftEditing, draftLive, emphasize, LOG_FILTERS, LogList, MeetingRules, personWithFunc, type LogFilter, proposerSentence, quorumNow, signaturesFor, VoteCard, workingSentence} from './meeting.tsx';
import {AgendaEditor} from './prep.tsx';
import {ItemEditForm, votedSource} from './item-form.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';
import {useDocTypes} from './doctypes.ts';
import {DocTypeSelect, PeopleFacts, usePeople} from './people.tsx';
import {DraftAgenda} from './draft.tsx';
import {DisplayList, ShowCard} from './show.tsx';
import {Avatar} from './avatar.tsx';
import type {MeetingData} from './api.ts';
import {canShowNow, shownDisplay} from '../shared/show.ts';
import {canShow} from '../shared/role.ts';

// Panel prowadzenia obrad. Środkowa kolumna to praca: „Czeka na Twoją decyzję”, trwające głosowanie i karta punktu.
// Na ekranie jest jedna karta z czerwonym paskiem (is-teraz) według pierwszeństwa: decyzja, głosowanie, bieżący punkt,
// a w kolumnie najwyżej jeden przycisk główny. Do 760 px kolumny są zakładkami „Porządek”, „Punkt” i „Obrady”.

type Tab = 'porzadek' | 'punkt' | 'obrady';
type Main = 'primary' | 'secondary';
const MESSAGES = 'chair-wiadomosci';
const READ_ALOUD = 'posiedzenia:do-odczytania';

// Stan zapamiętany w przeglądarce (zawsze w try/catch: strona działa także bez localStorage).
const remembered = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* bez zapisu */ } };

/** Tryb głosowania w miejscowniku: „w głosowaniu jawnym”. */
const modeLocative = (mode: string) => mode === 'tajne' ? 'tajnym' : mode === 'imienne' ? 'imiennym' : 'jawnym';
/** „Anna, Basia i Celina” */
const joinNames = (names: string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} i ${names[names.length - 1]}`;
const normalized = (text: string) => text.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim().toLowerCase();
/** Oddane głosy i uprawnieni bez osób, które wyszły przed oddaniem głosu. */
const castOf = (b: ViewBallot) => ({cast: b.secret ? b.secret.cast : b.voted.length, total: b.eligible.length - b.absentDuring.filter(id => !b.voted.includes(id)).length});
const organName = (m: Pick<Meeting, 'organ'>, roster: Roster) => organOf(roster, m.organ)?.name ?? 'Prezydium';
/** Odwołanie do regulaminu, które nie łamie się między wierszami: „(§ 8 ust. 2)”. */
const Ref = (props: {children: string}) => <span class="oi-nowrap">{props.children}</span>;
/** „10 listopada 2026 r.” z daty RRRR-MM-DD. */
const longDate = (iso: string) => `${new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.`;

/** Otwarte głosowanie w sprawie. Głosowanie próbne nie blokuje innych czynności poza otwarciem kolejnego głosowania (F1). */
const regularOpen = (m: ViewMeeting) => m.ballots.find(b => b.status === 'otwarte' && b.purpose !== 'proba');
/** „głosowania nr 4” albo „głosowania próbnego” w zdaniu „Dostępne po zakończeniu …”. */
const ballotOf = (b: ViewBallot) => b.purpose === 'proba' ? 'głosowania próbnego' : `głosowania nr ${b.number}`;
const workingRefusal = 'Na spotkaniu roboczym nie przeprowadza się głosowań.';
// O-13 (dodatek): czasy głosowań nad wnioskami z ustawień posiedzenia (effective.motionMinutes), a ponownego głosowania
// w sprawie z ustawień punktu. Bez wartości skutecznych (dane sprzed wersji 3) 2 minuty, jak dotąd.
const motionMinutesOf = (m: ViewMeeting) => m.effective?.meeting.motionMinutes.value ?? 2;
const itemMinutesOf = (m: ViewMeeting, itemId: string | null | undefined) => (itemId ? m.effective?.items[itemId]?.voteMinutes.value : undefined) ?? m.effective?.meeting.voteMinutes.value ?? 2;
const lastsText = (n: number) => `Głosowanie potrwa ${n} ${plural(n, 'minutę', 'minuty', 'minut')}.`;
/** Powód, dla którego nie można otworzyć głosowania w sprawie (F2, F5, przerwa), albo null. */
const voteBlock = (m: ViewMeeting) => announceFirst(m) ?? (m.working ? workingRefusal : m.status !== 'trwa' ? 'Głosowanie otworzysz po wznowieniu obrad.' : null);
const rootOf = (m: ViewMeeting, it: AgendaItem) => it.parentId ? m.agenda.find(i => i.id === it.parentId) ?? it : it;
/** F5: punkt po punkcie otwarcia wymaga pozytywnego stwierdzenia kworum albo spotkania roboczego. */
const needsWorking = (m: ViewMeeting, it: AgendaItem) => m.kind === 'posiedzenie' && !m.working && !quorumStated(m) && rootOf(m, it).kind !== 'otwarcie';
/** F4: punkty przyjętego porządku, które czekają przed danym punktem. Rozpoczęcie poza kolejnością wymaga powodu. */
const skippedBefore = (m: ViewMeeting, it: AgendaItem) => m.kind === 'posiedzenie' && m.agendaAdopted ? pendingBefore(m as Meeting, it) : [];
/** Powód spotkania roboczego: stwierdzony albo widoczny brak kworum, a inaczej przejście dalej bez stwierdzenia. */
function workingReason(m: ViewMeeting, roster: Roster): 'brak_kworum' | 'bez_stwierdzenia' {
  const last = m.quorumChecks.at(-1);
  const low = presentMembers(m as Meeting, roster).length < quorumNow(m, roster).required;
  return (last && last.present < last.required) || low ? 'brak_kworum' : 'bez_stwierdzenia';
}

/**
 * Formuła zamknięcia posiedzenia do odczytania (T3.46). „Wobec wyczerpania porządku obrad” tylko wtedy, gdy nie ma
 * punktów nierozpatrzonych. Inaczej samo zamknięcie, a punkty nierozpoczęte są wymienione z numerem.
 */
function closingSpeech(m: ViewMeeting, organ: string, types: DocType[]) {
  const unhandled = unhandledItems(m, types);
  const what = m.working ? 'spotkanie robocze' : 'posiedzenie';
  if (!unhandled.length) return `Wobec wyczerpania porządku obrad zamykam ${what} ${organ}.`;
  const skipped = unhandled.filter(it => it.status === 'oczekuje').map(it => itemNumber(m.agenda, it.id));
  const note = skipped.length === 1 ? ` Punkt ${skipped[0]} nie został rozpatrzony.`
    : skipped.length > 1 ? ` Punkty ${joinNames(skipped)} nie zostały rozpatrzone.` : '';
  return `Zamykam ${what} ${organ}.${note}`;
}

/**
 * Następny punkt do rozpoczęcia po bieżącym (punkt „Podjęcie uchwał” z podpunktami prowadzi do pierwszego podpunktu).
 * Na spotkaniu roboczym (F5) punkty rozpoczyna się także bez przyjętego porządku.
 */
function nextItem(m: ViewMeeting, it: AgendaItem) {
  const order = orderedAgenda(m.agenda);
  return order.slice(order.indexOf(it) + 1).find(i => i.status === 'oczekuje' && (m.agendaAdopted || m.working || beforeAdoption(m, i)) && !(i.kind === 'uchwaly' && order.some(c => c.parentId === i.id)));
}
/** Co pokazuje ekran sali (ta sama kolejność co w screen.tsx) i czy można wrócić do bieżącego punktu. */
function screenShows(m: ViewMeeting): {text: string; other: boolean; item?: string; material?: string; pokaz?: string} {
  const shown = m.presentation;
  const current = m.agenda.find(i => i.id === m.currentItemId);
  if (m.status === 'przerwa') return {text: 'przerwę w obradach', other: false};
  const open = m.ballots.find(b => b.status === 'otwarte');
  if (open) return {text: open.purpose === 'proba' ? 'trwające głosowanie próbne' : 'trwające głosowanie', other: false};
  // Wynik w sprawie ekran sali pokazuje dopiero po ogłoszeniu (F2), a wynik głosowania próbnego od razu (F1).
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : undefined;
  if (result) return {text: result.purpose === 'proba' ? 'wynik głosowania próbnego' : result.announcedAt ? `wynik głosowania nr ${result.number}, także na telefonach` : `zakończenie głosowania nr ${result.number}, bez wyniku do czasu ogłoszenia`, other: true};
  const ended = shown?.kind === 'glosowanie' ? m.ballots.find(b => b.id === shown.id && b.status === 'zamkniete' && (b.purpose === 'proba' || !b.announcedAt)) : undefined;
  if (ended) return {text: ended.purpose === 'proba' ? 'wynik głosowania próbnego' : `zakończenie głosowania nr ${ended.number}, bez wyniku do czasu ogłoszenia`, other: true};
  // Wersja 4 (B3-08, B3-19): pokaz plików na piątym miejscu kolejności, także na telefonach.
  if (shown?.kind === 'pokaz' && m.show) {
    const d = shownDisplay(m), mat = m.show.source === 'material' ? m.materials.find(x => x.id === m.show!.id) : undefined;
    const noun = d?.kind === 'obrazy' ? 'slajd' : 'stronę', nounNom = d?.kind === 'obrazy' ? 'slajd' : 'strona';
    const total = d ? (d.kind === 'obrazy' ? d.files.length : d.pages) : null;
    const what = d ? `plik „${d.title}”` : `materiał „${mat?.title ?? ''}”`;
    const pages = d && (d.kind === 'obraz' || d.kind === 'wideo') ? '' : ` ${m.show.page}${total ? ` z ${total}` : ''}`;
    return {text: `${what}${pages ? `, ${noun}${pages}` : ''}, także na telefonach`, other: false, pokaz: `${what.replace(/^./, c => c.toLocaleUpperCase('pl'))}${pages ? `, ${nounNom}${pages}` : ''}, także na telefonach`};
  }
  const material = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : undefined;
  if (material) return {text: `materiał „${material.title}”, także na telefonach`, other: true, material: material.id};
  const point = shown?.kind === 'punkt' ? m.agenda.find(i => i.id === shown.id) : undefined;
  if (point && point.id !== current?.id) return {text: `punkt ${itemNumber(m.agenda, point.id)}`, other: true, item: point.id};
  // F8, D2: przy przyjmowaniu porządku i w trybie zmian na spotkaniu roboczym sala widzi projekt ze zmianami na żywo.
  if (shown?.kind === 'projekt' && draftLive(m)) return {text: 'projekt porządku obrad ze zmianami na żywo', other: false};
  if (current?.kind === 'porzadek' && draftLive(m)) return {text: 'projekt porządku obrad ze zmianami na żywo', other: false, item: current.id};
  if (current) return {text: `bieżący punkt ${itemNumber(m.agenda, current.id)}`, other: false, item: current.id};
  return {text: 'tytuł posiedzenia', other: false};
}

// Sprawy w karcie „Czeka na Twoją decyzję”: kworum po przerwie, zgłoszenia obecności (F9), nieogłoszone wyniki (F2),
// wnioski o reasumpcję i nowe wiadomości. Biuro widzi tylko zgłoszenia obecności, bo tylko je może rozpatrzyć.
type Decision =
  | {kind: 'kworum'; key: string}
  | {kind: 'obecnosc'; key: string; who: string; guest: boolean; at: number}
  | {kind: 'obecnosc-wszystkie'; key: string; count: number}
  | {kind: 'wynik'; key: string; b: ViewBallot}
  | {kind: 'wniosek'; key: string; x: Motion; b?: ViewBallot}
  | {kind: 'wiadomosci'; key: string; unread: Message[]};
const actionable = (d: Decision) => d.kind === 'kworum' || d.kind === 'wynik' || d.kind === 'obecnosc' || (d.kind === 'wniosek' && d.x.status !== 'zbiera_podpisy');

function decisionsFor(m: ViewMeeting, unread: Message[], who: {chair: boolean; confirms: boolean; actor: Actor}): Decision[] {
  const rows: Decision[] = [];
  const lastBreak = [...m.log].reverse().find(l => l.text === 'Przerwa w obradach.');
  const lastQuorum = m.quorumChecks.at(-1);
  if (who.chair && !m.working && m.status === 'trwa' && lastBreak && (!lastQuorum || lastQuorum.at < lastBreak.at)) rows.push({kind: 'kworum', key: 'kworum'});
  if (who.confirms) {
    // DA-19: biuro nie rozpatruje zgłoszenia osoby prowadzącej obrady (canKeepAttendance z role.ts).
    const pending = pendingPresence(m).filter(p => canKeepAttendance(m as unknown as Meeting, who.actor, p.who, 'potwierdz'));
    if (pending.length > 1) rows.push({kind: 'obecnosc-wszystkie', key: 'obecnosc-wszystkie', count: pending.length});
    for (const p of pending) rows.push({kind: 'obecnosc', key: `obecnosc-${p.guest ? 'g' : 'c'}-${p.who}`, ...p});
  }
  if (!who.chair) return rows;
  for (const b of unannounced(m) as ViewBallot[]) rows.push({kind: 'wynik', key: b.id, b});
  for (const x of m.motions.filter(y => y.status === 'zlozony' || y.status === 'zbiera_podpisy' || (y.status === 'przyjety' && !y.repeatBallotId))) rows.push({kind: 'wniosek', key: x.id, x, b: m.ballots.find(y => y.id === x.ballotId)});
  if (unread.length) rows.push({kind: 'wiadomosci', key: 'wiadomosci', unread});
  return rows;
}

/** Imię i nazwisko osoby z listy obecności: członka ze składu albo zaproszonej osoby (konto z głosem doradczym, gość). */
function usePresenceName() {
  const s = useSession();
  const people = usePeople();
  return (who: string, guest: boolean) => guest ? people.find(x => x.id === who)?.displayName ?? 'Zaproszona osoba' : s.personName(who);
}

// Przeczytane wiadomości: liczba w localStorage dla posiedzenia. Rozwinięta sekcja „Wiadomości” oznacza je jako przeczytane.
function useUnread(m: ViewMeeting, accountId: string, reading: boolean) {
  const key = `posiedzenia:przeczytane:${m.id}`;
  const [read, setRead] = useState(() => Number(remembered(key)) || 0);
  useEffect(() => setRead(Number(remembered(key)) || 0), [m.id]);
  useEffect(() => {
    if (reading && read !== m.messages.length) { setRead(m.messages.length); remember(key, String(m.messages.length)); }
  }, [reading, m.messages.length, m.id]);
  return m.messages.slice(Math.min(read, m.messages.length)).filter(x => x.author !== accountId);
}

const tabHint = (tab: Tab, n: number) => tab === 'porzadek' ? `, ${n} ${plural(n, 'punkt', 'punkty', 'punktów')} do rozpatrzenia`
  : tab === 'punkt' ? `, ${n} ${plural(n, 'sprawa czeka', 'sprawy czekają', 'spraw czeka')} na Twoją decyzję`
  : `, ${n} ${plural(n, 'nowa wiadomość', 'nowe wiadomości', 'nowych wiadomości')}`;

export function ChairPanel({readOnly}: {readOnly: boolean}) {
  const {m, replace} = useMeeting();
  const s = useSession();
  const [selected, setSelected] = useState<string | null>(m.currentItemId ?? m.agenda[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('punkt');
  const [messagesOpen, setMessagesOpen] = useState(false);
  // Dodatek D-18: zwinięta sekcja „Dokumenty (stan na godz. {g})”; karta powstaje z widoku dopiero po rozwinięciu, bez zapytań (T-2).
  const [docsOpen, setDocsOpen] = useState(false);
  const [focusTitle, setFocusTitle] = useState(0);
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => { if (!m.agenda.some(i => i.id === selected)) setSelected(m.currentItemId); }, [m.agenda.length]);
  useEffect(() => { if (m.currentItemId) setSelected(m.currentItemId); }, [m.currentItemId]);
  // Wysokość zakładek trafia do --zakladki-panelu: przewijanie strony do fokusu zostawia miejsce na pasek i zakładki.
  useLayoutEffect(() => {
    const el = tabs.current, root = document.documentElement;
    if (!el) return;
    const set = () => { const h = Math.round(el.getBoundingClientRect().height); if (h) root.style.setProperty('--zakladki-panelu', `${h}px`); else root.style.removeProperty('--zakladki-panelu'); };
    set();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty('--zakladki-panelu'); };
  }, []);
  // Po wyborze punktu w układzie z zakładkami fokus przechodzi na tytuł punktu.
  useEffect(() => { if (focusTitle) document.querySelector<HTMLElement>('.chair-main .item-title')?.focus(); }, [focusTitle]);
  // Karta porządku przewija się (sama, bez przewijania strony) tak, żeby bieżący punkt stał w górnej jednej trzeciej
  // jej wysokości: po pierwszym wyświetleniu i przy każdej zmianie bieżącego punktu. Bez przewijanej karty nic się nie dzieje.
  const agendaCard = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = agendaCard.current;
    const row = card?.querySelector<HTMLElement>('.agenda-row[aria-current="step"]');
    if (!card || !row || card.scrollHeight <= card.clientHeight + 1) return;
    const top = row.getBoundingClientRect().top - card.getBoundingClientRect().top + card.scrollTop;
    card.scrollTop = Math.max(0, top - card.clientHeight / 3);
  }, [m.currentItemId]);
  const types = useDocTypes();
  const unread = useUnread(m, s.account.id, messagesOpen);
  // Zgłoszoną obecność (F9) potwierdza osoba prowadząca obrady albo konto biura (wersja 3: bez flagi administratora, DA-19).
  const actor = actorOf(s);
  const confirms = !readOnly || isOfficeAccount(actor);
  const decisions = decisionsFor(m, unread, {chair: !readOnly, confirms, actor});
  const open = m.ballots.find(b => b.status === 'otwarte');
  // Po otwarciu głosowania przycisk, który je otworzył, znika razem z rozwiniętą kartą punktu. Panel głosowania
  // przewija się wtedy pod pasek posiedzenia, a fokus przechodzi na jego nagłówek (chyba że fokus jest w innej kolumnie).
  const seen = useRef<string | undefined | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = open?.id;
    if (readOnly || before === null || !open || before === open.id) return;
    const active = document.activeElement;
    // Głosowanie próbne otwiera się z karty „Obrady”, a potem prowadzący też przechodzi do trwającego głosowania.
    const elsewhere = !!active && active !== document.body && active.isConnected && !active.closest('.chair-main, .controls-trial');
    if (elsewhere || document.querySelector('dialog[open]')) return;
    setTab('punkt');
    window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.live-ballot');
      panel?.scrollIntoView({block: 'start'});
      panel?.querySelector<HTMLElement>('.vote-subject')?.focus({preventScroll: true});
    });
  }, [open?.id]);
  const focus = decisions.length ? 'decyzja' : open ? 'glosowanie' : 'punkt';
  // D2 (O-04): tryb zmian na spotkaniu roboczym, w którym kafelki zastępują kartę punktu.
  const liveDraft = m.presentation?.kind === 'projekt' && draftEditing(m);
  // O-10 (dodatek): przy przyjmowaniu porządku lewa kolumna pokazuje porządek zwinięty do numerów i tytułów.
  const titlesOnly = !readOnly && draftEditing(m) && !liveDraft;
  const waiting = !open && decisions.some(actionable);
  const withTabs = () => !!tabs.current && getComputedStyle(tabs.current).display !== 'none';
  const choose = (id: string) => { setSelected(id); if (withTabs()) { setTab('punkt'); setFocusTitle(n => n + 1); } };
  const scrollMessages = () => document.querySelector(`#${MESSAGES} .message-list`)?.scrollTo({top: 1e6});
  const showMessages = () => {
    setTab('obrady');
    setMessagesOpen(true);
    window.setTimeout(() => {
      const fold = document.getElementById(MESSAGES);
      fold?.scrollIntoView({block: 'start'});
      fold?.querySelector<HTMLElement>('summary')?.focus({preventScroll: true});
      scrollMessages();
    }, 0);
  };
  const counts: Record<Tab, number> = {porzadek: unhandledItems(m, types).length, punkt: decisions.filter(actionable).length, obrady: readOnly ? 0 : unread.length};
  return <div class="chair">
    <nav class="oi-seg chair-tabs" aria-label="Część panelu" ref={tabs}>
      {([['porzadek', 'Porządek'], ['punkt', 'Punkt'], ['obrady', 'Obrady']] as [Tab, string][]).map(([id, label]) =>
        <button key={id} type="button" class="oi-opt" aria-pressed={tab === id} onClick={() => setTab(id)}>
          {label}{counts[id] > 0 && <> ({counts[id]})<span class="sr-only">{tabHint(id, counts[id])}</span></>}
        </button>)}
    </nav>
    <aside class={'chair-col chair-left' + (tab === 'porzadek' ? ' is-shown' : '')} aria-label="Porządek obrad">
      <section class="oi-card chair-agenda" ref={agendaCard}>
        {/* Na spotkaniu roboczym (F5) porządku się nie przyjmuje, więc nie ma znacznika „Do przyjęcia”. */}
        <div class="panel-head"><CardTitle level={2}>Porządek obrad</CardTitle><StateChip state={m.working && !m.agendaAdopted ? null : agendaChip(m.agendaAdopted)}/></div>
        <AgendaList selected={selected} onSelect={choose} titlesOnly={titlesOnly}/>
        {!readOnly && !m.agendaAdopted && <AgendaFixes/>}
        {!readOnly && m.agendaAdopted && <AgendaChange/>}
      </section>
    </aside>
    <section class={'chair-col chair-main' + (tab === 'punkt' ? ' is-shown' : '')} aria-label="Punkt">
      {m.status === 'przerwa' && <Notice tone="warn">Trwa przerwa w obradach. Głosowania są wstrzymane.</Notice>}
      {decisions.length > 0 && <DecisionCard rows={decisions} teraz={focus === 'decyzja'} onMessages={showMessages} readOnly={readOnly}/>}
      {open && <LiveBallot b={open} readOnly={readOnly} teraz={focus === 'glosowanie'}/>}
      {/* Wersja 4 (6.6, B3-18): karta „Pokaz na sali i telefonach” pod decyzjami i trwającym głosowaniem, bez is-teraz. */}
      <ShowCard meeting={m as unknown as MeetingData} onChange={next => replace({meeting: next as unknown as ViewMeeting})}/>
      {/* F8, D2: przy przyjmowaniu porządku i w trybie zmian na spotkaniu roboczym prowadzący układa projekt kafelkami,
          a członkowie i ekran sali widzą zmiany na żywo. Przy przyjmowaniu porządku kafelki stoją przed kartą punktu
          z kartą głosowania, a w trybie zmian zastępują kartę punktu (O-04). */}
      {!readOnly && liveDraft && <DraftAgenda live={{main: waiting || decisions.length ? 'secondary' : 'primary'}}/>}
      {selected && !(!readOnly && liveDraft) && <ItemCard key={selected} itemId={selected} readOnly={readOnly} main={waiting ? 'secondary' : 'primary'} teraz={focus === 'punkt'}/>}
      {/* O-10 (dodatek): przy przyjmowaniu porządku kolumna zaczyna się od karty głosowania nad porządkiem, a kafelki stoją pod nią. */}
      {!readOnly && draftEditing(m) && !liveDraft && <DraftAgenda/>}
    </section>
    <aside class={'chair-col chair-right' + (tab === 'obrady' ? ' is-shown' : '')} aria-label="Obrady">
      <MeetingControls readOnly={readOnly}/>
      <MeetingRules variant="panel"/>
      <Attendance/>
      <Chairing readOnly={readOnly}/>
      <Fold title="Wiadomości" count={m.messages.length || undefined} id={MESSAGES} open={messagesOpen}
        onToggle={on => { setMessagesOpen(on); if (on) window.setTimeout(scrollMessages, 0); }}><Messages bare/></Fold>
      <Log/>
      <div class="chair-papers"><Fold title={`Dokumenty (stan na godz. ${timeOf(Date.now())})`} open={docsOpen} onToggle={setDocsOpen}>{docsOpen && <PapersCard meeting={m as unknown as MeetingData} compact/>}</Fold></div>
    </aside>
  </div>;
}

/**
 * Sekcja „Do odczytania”: domyślnie zwinięta, a stan rozwinięcia zapamiętuje przeglądarka. Formuła powstaje dopiero
 * po rozwinięciu, więc zwinięta sekcja nie powtarza w ukryciu brzmienia wyniku.
 */
function ReadAloud(props: {children: ComponentChildren}) {
  const [open, setOpen] = useState(() => remembered(READ_ALOUD) === '1');
  return <Fold title="Do odczytania" open={open} onToggle={on => { if (on !== open) { setOpen(on); remember(READ_ALOUD, on ? '1' : '0'); } }}>
    {open && <div class="read-aloud">{props.children}</div>}
  </Fold>;
}

/** Zdanie o wyniku do odczytania (T3.57). */
function resultSpeech(m: ViewMeeting, b: ViewBallot) {
  const r = b.result;
  if (!r) return '';
  return `Stwierdzam, że w głosowaniu ${modeLocative(b.mode)} oddano ${r.cast} ${plural(r.cast, 'głos', 'głosy', 'głosów')}. Za ${r.za}, przeciw ${r.przeciw}, wstrzymało się ${r.wstrzymuje}. ${resultLabel(b, materialTypeOf(m, b))}.`;
}

function DecisionCard(props: {rows: Decision[]; teraz: boolean; onMessages: () => void; readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const id = useId();
  const nameOf = usePresenceName();
  const open = m.ballots.find(b => b.status === 'otwarte');
  const present = presentMembers(m as Meeting, s.roster);
  const needed = signaturesFor(m, present.length);
  // O-03 pkt 5, DA-19: biuro widzi tylko zgłoszenia obecności, potwierdza je przyciskami z obrysem i ich nie odrzuca.
  const office = props.readOnly;
  // Osoba, która może prowadzić obrady (§ 9 ust. 1, DA-17), przejmuje prowadzenie bez potwierdzenia obecności (D1).
  const canTake = (who: string) => chairRank(s.roster, m as unknown as Meeting, who) !== null;
  const block = voteBlock(m);
  // Pierwszy przycisk w karcie jest główny, kolejne mają obrys. W trakcie głosowania przyciski czekają na jego koniec,
  // a działania, które otwierają głosowanie, pokazują powód blokady (nieogłoszony wynik, spotkanie robocze).
  let first = true;
  const kind = (): Main => { const k = first ? 'primary' : 'secondary'; first = false; return k; };
  const action = (label: string, run: () => void, reason?: string | null) => open ? null : <div><Button kind={kind()} busy={busy} disabled={!!reason} reason={reason ?? undefined} onClick={run}>{label}</Button></div>;
  return <section class={'oi-card decisions' + (props.teraz ? ' is-teraz' : '')} aria-labelledby={id}>
    <h2 class="oi-card__title" id={id}><span class="oi-mark" aria-hidden="true"/><span>{office ? 'Zgłoszenia obecności' : 'Czeka na Twoją decyzję'}</span></h2>
    {props.rows.map(row => {
      if (row.kind === 'kworum') return <div class="decision" key={row.key}>
        <p>Po przerwie stwierdź kworum.</p>
        {action('Stwierdzam kworum', () => send({type: 'quorum'}))}
      </div>;
      // Zgłoszenia obecności rozpatruje się także w trakcie głosowania: potwierdzona osoba dołącza do niego.
      if (row.kind === 'obecnosc-wszystkie') return <div class="decision" key={row.key}>
        <p>{`Obecność ${plural(row.count, 'zgłosiła', 'zgłosiły', 'zgłosiło')} ${row.count} ${plural(row.count, 'osoba', 'osoby', 'osób')}.`}</p>
        <div><Button kind={office ? 'secondary' : kind()} busy={busy} onClick={() => send({type: 'presence_confirm_all'})}>{`Potwierdź wszystkie zgłoszenia (${row.count})`}</Button></div>
      </div>;
      if (row.kind === 'obecnosc') {
        const name = nameOf(row.who, row.guest);
        // Przy kilku zgłoszeniach głównym działaniem jest „Potwierdź wszystkie zgłoszenia”, a wiersze mają szare odnośniki.
        const single = !props.rows.some(r => r.kind === 'obecnosc-wszystkie');
        const confirm = () => send({type: 'presence_confirm', who: row.who, guest: row.guest || undefined, accept: true});
        return <div class="decision decision--obecnosc" key={row.key}>
          <p>Obecność zgłasza <span class="oi-nowrap">{name}</span>, godz. {fmtTime(row.at)}
            {office && !row.guest && canTake(row.who) && <span class="decision-note">Ta osoba może przejąć prowadzenie bez potwierdzenia.</span>}</p>
          <div class="decision-act">
            {office
              ? <Button kind="secondary" small busy={busy} label={`Potwierdź obecność, ${name}`} onClick={confirm}>Potwierdź</Button>
              : single
                ? <Button kind={kind()} small busy={busy} label={`Potwierdź obecność, ${name}`} onClick={confirm}>Potwierdź obecność</Button>
                : <Button kind="ghost" quiet small busy={busy} label={`Potwierdź obecność, ${name}`} onClick={confirm}>Potwierdź obecność</Button>}
            {!office && <Button kind="ghost" quiet small busy={busy} label={`Odrzuć zgłoszenie, ${name}`} onClick={() => send({type: 'presence_confirm', who: row.who, guest: row.guest || undefined, accept: false})}>Odrzuć</Button>}
          </div>
        </div>;
      }
      if (row.kind === 'wynik') return <div class="decision" key={row.key}>
        <p>Wynik głosowania nr {row.b.number} nie został ogłoszony.</p>
        {/* O-08 (dodatek): przedmiot głosowania zwykłym pismem pod zdaniem. */}
        {row.b.subject && <p class="decision-subject">{row.b.subject}</p>}
        {!open && <div class="decision-act">
          <Button kind={kind()} busy={busy} onClick={() => send({type: 'announce', ballotId: row.b.id})}>Ogłoś wynik głosowania nr {row.b.number}</Button>
          <span class="muted small">Ogłoszenie pokaże wynik na telefonach i ekranie sali. Do tego czasu obrady nie idą dalej.</span>
        </div>}
        <ReadAloud><p>{resultSpeech(m, row.b)}</p></ReadAloud>
      </div>;
      if (row.kind === 'wniosek') {
        const no = row.b?.number;
        const subject = row.b?.subject ? <p class="decision-subject">{row.b.subject}</p> : null;
        if (row.x.status === 'zbiera_podpisy') {
          const valid = row.x.signatures.filter(p => present.includes(p)).length;
          return <div class="decision" key={row.key}><p>Wniosek o reasumpcję głosowania nr {no} zbiera podpisy, {valid} z {needed}.</p>{subject}</div>;
        }
        if (row.x.status === 'zlozony') return <div class="decision" key={row.key}>
          <p>Wniosek o reasumpcję głosowania nr {no} ma wymagane podpisy. O reasumpcji rozstrzyga Prezydium.</p>
          {subject}
          {action('Poddaj wniosek pod głosowanie Prezydium', () => send({type: 'motion_vote', motionId: row.x.id, minutes: motionMinutesOf(m)}), block)}
          {!open && <span class="muted small">{lastsText(motionMinutesOf(m))}</span>}
        </div>;
        return <div class="decision" key={row.key}>
          <p>Prezydium przyjęło wniosek o reasumpcję głosowania nr {no}.</p>
          {subject}
          {action('Przeprowadź ponowne głosowanie', () => send({type: 'reasumption_open', motionId: row.x.id, minutes: itemMinutesOf(m, row.b?.itemId)}), block)}
          {!open && <span class="muted small">{lastsText(itemMinutesOf(m, row.b?.itemId))}</span>}
        </div>;
      }
      const last = row.unread[row.unread.length - 1];
      return <div class="decision" key={row.key}>
        <dl class="facts"><Fact label={row.unread.length === 1 ? 'Nowa wiadomość' : `Nowe wiadomości (${row.unread.length})`}>{last.authorName}, godz. {fmtTime(last.at)}</Fact></dl>
        <div><Button kind="ghost" small onClick={props.onMessages}>Pokaż wiadomości</Button></div>
      </div>;
    })}
    {open && props.rows.some(r => actionable(r) && r.kind !== 'obecnosc') && <p class="muted small">Dostępne po zakończeniu {ballotOf(open)}.</p>}
  </section>;
}

// Trwające głosowanie: jeden panel z faktami, postępem, głosem prowadzącego i listą osób bez głosu.
function LiveBallot({b, readOnly, teraz}: {b: ViewBallot; readOnly: boolean; teraz: boolean}) {
  const {m, send} = useMeeting();
  const s = useSession();
  const id = useId();
  const [closing, setClosing] = useState(false);
  const [absent, setAbsent] = useState<{who: string; at: number} | null>(null);
  const awaiting = awaitingVote(b);
  const {cast, total} = castOf(b);
  const share = total ? Math.min(100, Math.round(cast / total * 100)) : 0;
  const issued = b.secret?.issued.length ?? 0;
  const inFlight = b.secret ? Math.max(0, issued - b.secret.cast) : 0;
  const mine = !readOnly && !!s.personId && b.eligible.includes(s.personId);
  const trial = b.purpose === 'proba';
  const proposer = proposerSentence(s.roster, m, b);
  // Oznaczenie ostatniej osoby bez głosu kończy głosowanie od razu, chyba że w drodze są jeszcze głosy z pobranych kart.
  const lastOne = awaiting.length === 1 && inFlight === 0;
  const names = awaiting.map(p => s.personName(p));
  const n = awaiting.length;
  // O-11: osoba prowadząca nie oznacza swojej nieobecności, a okno zakończenia mówi o jej głosie osobno.
  const chairId = m.chair.current;
  const ownMissing = !!chairId && awaiting.includes(chairId);
  const others = awaiting.filter(p => p !== chairId).map(p => s.personName(p));
  const k = others.length;
  const own = ownMissing ? (k ? ' Twój głos też nie został oddany.' : ' Twój głos nie został jeszcze oddany.') : '';
  const endText = n > 0 && k === 0 ? `${own.trim()} Jeśli zakończysz głosowanie teraz, ten głos nie zostanie policzony.`
    : k === 1 ? `Bez głosu jest jeszcze 1 osoba (${others[0]}).${own} Jeśli zakończysz głosowanie teraz, ${ownMissing ? 'te głosy nie zostaną policzone' : 'ten głos nie zostanie policzony'}.`
    : k > 1 ? `Bez głosu ${plural(k, 'jest', 'są', 'jest')} jeszcze ${k} ${plural(k, 'osoba', 'osoby', 'osób')} (${others.join(', ')}).${own} Jeśli zakończysz głosowanie teraz, te głosy nie zostaną policzone.`
    : inFlight > 0 ? `Pobrano kart ${issued}, a dotarło głosów ${b.secret!.cast}. ${inFlight === 1 ? 'Brakujący głos może być jeszcze w drodze. Zaczekaj kilka sekund. Jeśli zakończysz głosowanie teraz, ten głos nie zostanie policzony.' : 'Brakujące głosy mogą być jeszcze w drodze. Zaczekaj kilka sekund. Jeśli zakończysz głosowanie teraz, te głosy nie zostaną policzone.'}`
    : 'Zagłosowali wszyscy uprawnieni.';
  const lastNote = <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>To ostatnia osoba bez głosu. Głosowanie zakończy się od razu.</p></div>;
  return <section class={'oi-card live-ballot vote-card' + (teraz ? ' is-teraz' : '')} aria-labelledby={id}>
    <div class="oi-btns"><Tag>{trial ? 'Trwa głosowanie próbne' : `Trwa głosowanie nr ${b.number}`}</Tag><Tag dark>{modeName(b.mode)}{b.reasumptionOf ? ', reasumpcja' : ''}</Tag></div>
    <h2 class="vote-subject" id={id} tabIndex={-1}><TitleLead text={b.subject}/></h2>
    {trial && !mine && <p class="small">Głosowanie próbne nie ma żadnych skutków. Sprawdza, czy głosowanie działa na telefonach obecnych.</p>}
    {proposer && <p class="small">{proposer}</p>}
    <dl class="facts facts--liczby">
      <Fact label="Pozostało"><Countdown endsAt={b.endsAt} label={false}/></Fact>
      <Fact label="Oddano głosów">{cast} <small>z {total}</small></Fact>
      {b.secret && <Fact label="Pobrano kart">{issued}</Fact>}
    </dl>
    <div class="oi-progress" role="progressbar" aria-label="Oddane głosy" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cast} aria-valuetext={`Oddano ${cast} z ${total} głosów`}>
      <span class="oi-progress__bar"><i style={{width: `${share}%`}}/></span><span class="oi-progress__txt">{cast} z {total}</span>
    </div>
    {inFlight > 0 && n === 0 && <p class="small">W drodze są jeszcze głosy z pobranych kart ({inFlight}). Głosowanie zakończy się samo, gdy dotrą albo upłynie czas.</p>}
    {mine && <VoteCard b={b} embedded/>}
    <div class="pending">
      <h3 class="card-sub">{b.secret ? 'Jeszcze nie pobrali karty' : 'Jeszcze nie zagłosowali'}</h3>
      {n > 0 ? <>
        {!readOnly && <p class="muted small">Oznacz nieobecność, gdy osoba wyszła z sali. Głosowanie nie będzie na nią czekać.</p>}
        <ul>{awaiting.map((p, i) => <li key={p}><span>{names[i]}</span>
          {!readOnly && p !== chairId && <Button kind="ghost" quiet small haspopup label={`Oznacz nieobecność, ${names[i]}`} onClick={() => setAbsent({who: p, at: serverNow()})}>Oznacz nieobecność</Button>}</li>)}</ul>
      </> : <p>Zagłosowali wszyscy obecni.</p>}
    </div>
    <div class="live-foot">
      <dl class="facts"><Fact label="Uprawnionych">{b.eligible.length}</Fact>{!trial && <Fact label="Wymagane kworum">{b.quorum}</Fact>}{b.modeBasis && <Fact label="Podstawa trybu">{b.modeBasis}</Fact>}</dl>
      {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Głosowanie tajne. Widać tylko, kto pobrał kartę. Ten sam odcisk członkowie widzą na telefonach i na ekranie sali.</span></div>}
      {!readOnly && <div><Button small haspopup onClick={() => setClosing(true)}>Zakończ głosowanie teraz</Button></div>}
    </div>
    {closing && <Confirm title="Zakończyć głosowanie?" kind="danger" confirm="Zakończ głosowanie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'ballot_close', ballotId: b.id})}
      text={<p>{endText} Głosowanie zwykle kończy się samo, gdy zagłosują wszyscy uprawnieni albo upłynie czas.</p>}/>}
    {absent && <Confirm title="Oznaczyć nieobecność?" kind="danger" confirm="Oznacz nieobecność" onClose={() => setAbsent(null)}
      onConfirm={() => send({type: 'ballot_absent', ballotId: b.id, personId: absent.who})}
      text={<p>Wyjście z posiedzenia zostanie zapisane przy nazwisku {s.personName(absent.who)}, z godziną {fmtTime(absent.at)}. {trial ? 'Głosowanie próbne' : `Głosowanie nr ${b.number}`} nie będzie czekać na głos tej osoby.</p>}
      details={lastOne && awaiting[0] === absent.who ? lastNote : undefined}/>}
  </section>;
}

// Rozpoczęcie punktu krok po kroku (F4, F5): najpierw okno spotkania roboczego, gdy nie stwierdzono kworum, potem
// przejście dalej bez głosowania, a na końcu powód rozpoczęcia poza kolejnością przyjętego porządku obrad.
type Step = 'roboczy' | 'bez-glosowania' | 'kolejnosc';
type Flow = {target: AgendaItem; from?: AgendaItem; steps: Step[]; reason?: string};
function useStartFlow() {
  const {m, send} = useMeeting();
  const s = useSession();
  const [flow, setFlow] = useState<Flow | null>(null);
  const advancing = useRef(false);
  const run = (f: Flow) => {
    if (f.steps.length) { setFlow(f); return; }
    setFlow(null);
    send(f.reason ? {type: 'item_start', itemId: f.target.id, reason: f.reason} : {type: 'item_start', itemId: f.target.id});
  };
  const stepsFor = (target: AgendaItem, from?: AgendaItem): Step[] => [
    ...(needsWorking(m, target) ? ['roboczy' as const] : []),
    ...(from && !m.working ? ['bez-glosowania' as const] : []),
    ...(skippedBefore(m, target).length ? ['kolejnosc' as const] : []),
  ];
  /** `from`: bieżący punkt, w którym nie głosowano, choć sprawa wymaga głosowania. */
  const start = (target: AgendaItem, from?: AgendaItem) => run({target, from, steps: stepsFor(target, from)});
  const confirm = (value: string) => {
    if (!flow) return;
    advancing.current = true;
    const [step, ...rest] = flow.steps;
    if (step === 'roboczy') {
      // Na spotkaniu roboczym nie głosuje się, więc okno „bez głosowania” nie jest już potrzebne.
      const next = {...flow, steps: rest.filter(x => x !== 'bez-glosowania')};
      setFlow(null);
      send({type: 'working_start', reason: workingReason(m, s.roster)}).then(r => { if (r) run(next); });
    } else run({...flow, steps: rest, reason: step === 'kolejnosc' ? value : flow.reason});
  };
  const close = () => { if (advancing.current) { advancing.current = false; return; } setFlow(null); };
  const step = flow?.steps[0];
  const dialog = flow && step ? <StartStep key={step + flow.target.id} step={step} flow={flow} onConfirm={confirm} onClose={close}/> : null;
  return {start, dialog, asks: (target: AgendaItem, from?: AgendaItem) => stepsFor(target, from).length > 0};
}

/** Treść okna „Kontynuować jako spotkanie robocze?” (F5). */
function WorkingConfirm(props: {onConfirm: () => void; onClose: () => void}) {
  const {m} = useMeeting();
  const last = m.quorumChecks.at(-1);
  const state = !last ? 'Kworum nie zostało stwierdzone. ' : last.present < last.required ? 'Stwierdzono brak kworum. ' : '';
  return <Confirm title="Kontynuować jako spotkanie robocze?" kind="danger" confirm="Kontynuuj jako spotkanie robocze" onClose={props.onClose} onConfirm={props.onConfirm}
    text={<p>{state}Bez kworum Prezydium nie podejmuje uchwał <Ref>(§ 8 ust. 2).</Ref> Do końca będzie to spotkanie robocze bez głosowań (poza głosowaniem próbnym). Uchwały podejmie nowe posiedzenie, które możesz przygotować, powielając to.</p>}/>;
}

function StartStep(props: {step: Step; flow: Flow; onConfirm: (value: string) => void; onClose: () => void}) {
  const {m} = useMeeting();
  const {target, from} = props.flow;
  const no = itemNumber(m.agenda, target.id);
  if (props.step === 'roboczy') return <WorkingConfirm onConfirm={() => props.onConfirm('')} onClose={props.onClose}/>;
  if (props.step === 'bez-glosowania') return <Confirm title="Przejść dalej bez głosowania?" confirm="Przejdź bez głosowania" cancel="Wróć do punktu" focus="cancel" onClose={props.onClose}
    onConfirm={() => props.onConfirm('')}
    text={<p>W punkcie {from ? itemNumber(m.agenda, from.id) : ''} nie przeprowadzono głosowania. Punkt zostanie zapisany jako zakończony bez głosowania.</p>}/>;
  const skipped = skippedBefore(m, target).map(it => `${itemNumber(m.agenda, it.id)} „${it.title}”`);
  return <Confirm title="Rozpocząć punkt poza kolejnością?" confirm={`Rozpocznij punkt ${no}`} onClose={props.onClose} onConfirm={props.onConfirm}
    field={{label: 'Powód', hint: 'Np. nieobecność osoby referującej. Powód trafi do protokołu.', required: true}}
    text={<p>{skipped.length === 1 ? `Punkt ${skipped[0]} nie był jeszcze rozpatrywany.` : `Punkty ${joinNames(skipped)} nie były jeszcze rozpatrywane.`} Rozpoczęcie punktu {no} zmienia kolejność przyjętego porządku obrad.</p>}/>;
}

// Karta punktu: nagłówek, jedno działanie główne zależne od stanu, działania poboczne, wyniki i notatka.
function ItemCard({itemId, readOnly, main, teraz}: {itemId: string; readOnly: boolean; main: Main; teraz: boolean}) {
  const {m, send, busy, replace} = useMeeting();
  const s = useSession();
  const types = useDocTypes();
  const id = useId();
  const flow = useStartFlow();
  const [ending, setEnding] = useState<'odroczony' | 'wycofany' | null>(null);
  const it = m.agenda.find(i => i.id === itemId);
  if (!it) return null;
  const no = itemNumber(m.agenda, it.id);
  const open = regularOpen(m);
  // W trakcie głosowania w sprawie karta punktu zwija się do jednego wiersza, a niedostępne przyciski znikają.
  if (open && !readOnly) return <section class="oi-card item-work is-zwiniete" aria-labelledby={id}>
    <h2 class="item-title item-title--wiersz" id={id} tabIndex={-1}>Punkt {no}. {it.title}</h2>
    <p class="muted small">Dostępne po zakończeniu głosowania nr {open.number}.</p>
  </section>;
  const current = m.currentItemId === it.id;
  const locked = !m.agendaAdopted && !m.working && !beforeAdoption(m, it);
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const others = m.materials.filter(x => !it.materialIds.includes(x.id));
  const results = m.ballots.filter(b => b.status === 'zamkniete' && (b.itemId === it.id || (b.target?.kind === 'tryb' && b.target.itemId === it.id))).sort((x, y) => x.number - y.number);
  // Porządek obrad wymaga głosowania, dopóki nie zostanie przyjęty (także po nieprzyjęciu w głosowaniu).
  // Na spotkaniu roboczym (F5) się nie głosuje, więc nic nie czeka na głosowanie.
  const voteNeeded = current && !m.working && needsVote(m, it, types) && (it.kind === 'porzadek' || !itemVoted(m, it));
  const closing = it.kind === 'zamkniecie';
  const organizer = s.isOrganizer(m.organ);
  const blocked = announceFirst(m);
  const reasonNeeded = m.kind === 'posiedzenie' && m.agendaAdopted;
  const organ = organName(m, s.roster);
  const quorum = quorumNow(m, s.roster), members = quorum.total, present = presentMembers(m as Meeting, s.roster).length;
  const itemEff = m.effective?.items[it.id]?.voteMinutes;
  const ownMinutes = itemEff && (itemEff.source === 'punkt' || itemEff.source === 'obrady') && itemEff.value !== m.effective!.meeting.voteMinutes.value ? itemEff.value : null;
  // Pokaz (DB-11): tylko osoba prowadząca obrady i tylko poza głosowaniem (G-24).
  const showing = canShow(m as unknown as Meeting, actorOf(s)) && canShowNow(m as unknown as Meeting);
  const showLabel = m.mode === 'zdalne' ? 'Pokaż uczestnikom' : 'Pokaż na sali i telefonach';
  return <section class={'oi-card item-work' + (teraz && current ? ' is-teraz' : '')} aria-labelledby={id}>
    <div class="panel-head">
      {current ? <span class="oi-label">Punkt {no}</span> : <span class="kicker">Punkt {no}</span>}
      <StateChip state={itemChip(it, current)}/>
    </div>
    <h2 class="item-title" id={id} tabIndex={-1}><TitleLead text={it.title}/></h2>
    <PeopleFacts it={it}/>
    {/* O-09 (dodatek): jedna linia, gdy punkt różni się od ustawień posiedzenia. */}
    {ownMinutes !== null && <p class="small">{`Ten punkt ma własne ustawienia, czas głosowania ${minutesText(ownMinutes)}.`}</p>}
    {it.outOfOrder && <p class="muted small">{`Rozpoczęty poza kolejnością przyjętego porządku obrad. Powód „${it.outOfOrder.reason.replace(/\.$/, '')}”.`}</p>}
    {it.statusReason && (it.status === 'odroczony' || it.status === 'wycofany') && <p class="muted small">{`Powód „${it.statusReason}”.`}</p>}
    {locked && <Notice>Ten punkt można rozpocząć po przyjęciu porządku obrad.</Notice>}
    {!readOnly && !current && !locked && it.status !== 'wycofany' && <div><Button kind={it.status === 'zakonczony' ? 'secondary' : main} busy={busy} haspopup={flow.asks(it)}
      disabled={!!blocked} reason={blocked ?? undefined} onClick={() => flow.start(it)}>Rozpocznij ten punkt</Button></div>}
    {materials.length > 0 && <div class="material-row">
      <h3 class="card-sub">Materiały</h3>
      {materials.map(x => <div class="stack-tight" key={x.id}>
        <MaterialLink id={x.id} version={x.version} label={x.title} meta={`wersja ${x.version}`}/>
        {/* B3-19: materiał punktu pokazuje się tym samym przyciskiem co pliki do pokazania (zamiast odnośnika O-12). */}
        {showing && m.show?.id !== x.id && <div><Button kind="ghost" quiet small busy={busy} label={`${showLabel}, materiał „${x.title}”`} onClick={() => send({type: 'show', source: 'material', id: x.id})}>{showLabel}</Button></div>}
      </div>)}
    </div>}
    {/* Wersja 4 (6.6, B3-19): lista „Do pokazania” pod materiałami; pliki innych punktów w zwiniętej sekcji. */}
    <div class="material-row show-row">
      <h3 class="card-sub">Do pokazania</h3>
      <DisplayList meeting={m as unknown as MeetingData} itemId={it.id} mode="obrady" onChange={next => replace({meeting: next as unknown as ViewMeeting})}/>
    </div>
    {/* O-12 (dodatek): jedna nazwa dla ekranu sali. Fakt „Na ekranie sali” i jeden cichy odnośnik zależny od stanu. */}
    <ScreenFact it={it} materials={materials} readOnly={readOnly}/>
    {/* Działania poboczne tego punktu stoją przy jego treści, przed głosowaniem i blokiem „Następny punkt”.
        Odroczenie i wycofanie czekają na ogłoszenie wyniku (F2), a powód pokazuje główny przycisk karty. */}
    {!readOnly && <div class="item-side">
      {!blocked && (current || it.status === 'w_toku') && !['otwarcie', 'porzadek', 'zamkniecie'].includes(it.kind) && <Button kind="ghost" quiet small haspopup onClick={() => setEnding('odroczony')}>Odrocz</Button>}
      {!blocked && it.status === 'oczekuje' && it.kind === 'sprawa' && <Button kind="ghost" quiet small haspopup onClick={() => setEnding('wycofany')}>Wycofaj</Button>}
    </div>}
    {!readOnly && current && it.kind === 'otwarcie' && <Quorum main={main}/>}
    {!readOnly && current && <BallotForm it={it} main={voteNeeded ? main : 'secondary'}/>}
    {!readOnly && current && m.working && needsVote(m, it, types) && <p class="muted small">{workingRefusal} Uchwały w tej sprawie podejmie nowe posiedzenie.</p>}
    {results.length > 0 && <div class="results">
      <h3 class="card-sub">Głosowania w tym punkcie</h3>
      {results.map(b => <ResultLine key={b.id} b={b}/>)}
    </div>}
    {!readOnly && current && it.kind === 'otwarcie' && <ReadAloud><p>{present >= quorum.required
      ? `Otwieram posiedzenie ${organ}. Stwierdzam, że w posiedzeniu uczestniczy ${present} z ${members} członków Prezydium, co stanowi kworum wymagane do podejmowania uchwał.`
      : `Otwieram posiedzenie ${organ}. Stwierdzam, że w posiedzeniu uczestniczy ${present} z ${members} członków Prezydium. Wobec braku kworum Prezydium nie może podejmować uchwał.`}</p></ReadAloud>}
    {!readOnly && current && closing && <ReadAloud><p>{closingSpeech(m, organ, types)}</p></ReadAloud>}
    {!readOnly && current && <NextStep it={it} main={main} voteNeeded={voteNeeded}/>}
    {/* O-02: „Przypisz materiał do punktu” stoi w „Danych punktu”. */}
    {(organizer || !readOnly) && <Fold title="Dane punktu">
      <ItemEditForm it={it} titleEditable={false} autofocus={false} status/>
      {others.length > 0 && !closing && <AssignMaterial it={it} others={others}/>}
    </Fold>}
    <NoteEditor it={it} open={readOnly}/>
    {ending && <Confirm title={ending === 'odroczony' ? 'Odroczyć punkt?' : 'Wycofać punkt?'} confirm={ending === 'odroczony' ? 'Odrocz punkt' : 'Wycofaj punkt'}
      kind={ending === 'odroczony' ? 'primary' : 'danger'} onClose={() => setEnding(null)}
      field={{label: 'Powód', required: reasonNeeded, hint: reasonNeeded ? 'Np. nieobecność osoby referującej. Powód trafi do protokołu.' : 'Nieobowiązkowy przed przyjęciem porządku. Powód trafi do protokołu.'}}
      onConfirm={reason => send(reason ? {type: 'item_end', itemId: it.id, status: ending, reason} : {type: 'item_end', itemId: it.id, status: ending})}
      text={<p>{ending === 'odroczony' ? `Punkt ${no} pozostanie w porządku obrad z oznaczeniem „odroczony”. Można go później podjąć ponownie.` : `Punkt ${no} zostanie oznaczony jako wycofany i nie będzie rozpatrywany.`}</p>}/>}
    {flow.dialog}
  </section>;
}

/**
 * Fakt „Na ekranie sali” w karcie punktu (O-12): co sala widzi przy tym punkcie i jeden cichy odnośnik, który to zmienia
 * („Pokaż materiał na ekranie sali” albo „Pokaż tytuł punktu na ekranie sali”). Przy kilku materiałach odnośnik dla
 * każdego materiału, którego sala nie widzi, z tytułem w nazwie.
 */
function ScreenFact({it, materials, readOnly}: {it: AgendaItem; materials: ViewMeeting['materials']; readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const screen = screenShows(m);
  const shownMaterial = materials.find(x => x.id === screen.material);
  const value = screen.pokaz ? screen.pokaz : shownMaterial ? `Materiał »${shownMaterial.title}«, także na telefonach`
    : screen.item === it.id && !screen.text.startsWith('projekt') ? 'Tytuł punktu i osoby'
    : screen.text.charAt(0).toLocaleUpperCase('pl') + screen.text.slice(1);
  // W trakcie głosowania, przerwy i przy projekcie porządku na żywo ekran pokazuje to, co wynika z obrad.
  const locked = !!m.ballots.find(b => b.status === 'otwarte') || m.status === 'przerwa';
  // Wersja 4 (6.6): w trakcie pokazu ekran sali zmienia karta „Pokaz”; materiał pokazuje przycisk przy materiale (B3-19).
  const showTitle = (shownMaterial || screen.item !== it.id) && !locked && !screen.pokaz;
  return <div class="screen-fact">
    <dl class="facts"><Fact label="Na ekranie sali">{value}</Fact></dl>
    {!readOnly && showTitle && <div class="item-screen">
      <Button kind="ghost" quiet small busy={busy} onClick={() => send({type: 'present', kind: 'punkt', id: it.id})}>Pokaż tytuł punktu na ekranie sali</Button>
    </div>}
  </div>;
}

/**
 * Pierwszy nierozpatrzony punkt przyjętego porządku przed danym punktem (O-01; te same reguły co pendingBefore):
 * punkt, który czeka, bo rozpoczęto inny poza kolejnością. Z godziną i powodem tego rozpoczęcia, gdy są w danych.
 */
function waitingBefore(m: ViewMeeting, target: AgendaItem, current: AgendaItem) {
  if (m.kind !== 'posiedzenie' || !m.agendaAdopted || m.working) return undefined;
  const order = orderedAgenda(m.agenda);
  // Przed „Zamknięciem posiedzenia” liczą się te same punkty co przed każdym innym (pendingBefore pomija zamknięcie).
  const probe = target.kind === 'zamkniecie' ? {...target, kind: 'sprawa' as const} : target;
  const it = pendingBefore(m as unknown as Meeting, probe).find(x => x.id !== current.id && x.id !== current.parentId);
  if (!it) return undefined;
  const skipper = order.slice(order.indexOf(it) + 1).filter(x => x.outOfOrder).sort((a, b) => a.outOfOrder!.at - b.outOfOrder!.at)[0];
  return {it, since: skipper?.outOfOrder?.at, reason: skipper?.outOfOrder?.reason};
}

// Następny krok w bieżącym punkcie (O-01): „Następny punkt” to pierwszy nierozpatrzony punkt przyjętego porządku. Gdy
// wcześniejszy punkt czeka, karta pokazuje od razu oba wyjścia: powrót do niego i przejście dalej poza kolejnością (okno
// z polem „Powód”). Dopóki wynik zamkniętego głosowania nie jest ogłoszony (F2), przyciski są nieaktywne z powodem.
function NextStep({it, main, voteNeeded}: {it: AgendaItem; main: Main; voteNeeded: boolean}) {
  const {m, send, busy} = useMeeting();
  const flow = useStartFlow();
  const [ask, setAsk] = useState<'koniec' | 'zamkniecie' | null>(null);
  const blocked = announceFirst(m);
  if (it.kind === 'zamkniecie') return <div class="next-step">
    <div><Button kind={main} haspopup disabled={!!blocked} reason={blocked ?? undefined} onClick={() => setAsk('zamkniecie')}>Zamknij posiedzenie</Button></div>
    {ask === 'zamkniecie' && <CloseDialog onClose={() => setAsk(null)}/>}
  </div>;
  const next = nextItem(m, it);
  const subject = m.materials.find(x => it.materialIds.includes(x.id))?.title ?? it.title;
  if (!next) {
    if (it.status !== 'w_toku' || (it.kind === 'porzadek' && !m.agendaAdopted)) return null;
    return <div class="next-step">
      <div><Button haspopup={voteNeeded} busy={busy} disabled={!!blocked} reason={blocked ?? undefined} onClick={() => voteNeeded ? setAsk('koniec') : send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}>Zakończ punkt</Button></div>
      {ask === 'koniec' && <Confirm title="Zakończyć punkt bez głosowania?" confirm="Zakończ punkt" focus="cancel" onClose={() => setAsk(null)}
        onConfirm={() => send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}
        text={<p>W tym punkcie nie głosowano nad „{subject}”. Punkt zostanie zapisany jako zakończony bez głosowania.</p>}/>}
    </div>;
  }
  const nextNo = itemNumber(m.agenda, next.id);
  const noQuorum = needsWorking(m, next);
  const waiting = waitingBefore(m, next, it);
  const from = voteNeeded ? it : undefined;
  const waitNo = waiting ? itemNumber(m.agenda, waiting.it.id) : '';
  return <div class="next-step">
    <span class="kicker">Następny punkt</span>
    {voteNeeded && <p class="small">W tym punkcie nie przeprowadzono jeszcze głosowania.</p>}
    {noQuorum && <p class="small">{m.quorumChecks.length ? 'Ostatnio stwierdzono brak kworum.' : 'Kworum nie zostało jeszcze stwierdzone.'}</p>}
    {waiting ? <>
      <p class="small">{`Punkt ${waitNo} „${waiting.it.title}” ${waiting.since ? `czeka od godz. ${fmtTime(waiting.since)}.` : 'nie był jeszcze rozpatrywany.'}`}</p>
      {waiting.reason && <p class="small">{`Pominięto go z powodu „${waiting.reason.replace(/\.$/, '')}”.`}</p>}
      <div><Button kind={voteNeeded || noQuorum ? 'secondary' : main} busy={busy} haspopup={flow.asks(waiting.it, from)} disabled={!!blocked} reason={blocked ?? undefined} onClick={() => flow.start(waiting.it, from)}>Wróć do punktu {waitNo}</Button></div>
      <div><Button kind="ghost" quiet small busy={busy} haspopup disabled={!!blocked} reason={blocked ?? undefined} onClick={() => flow.start(next, from)}>Przejdź do punktu {nextNo} poza kolejnością</Button></div>
    </> : <>
      <div><Button kind={voteNeeded || noQuorum ? 'secondary' : main} busy={busy} haspopup={flow.asks(next, voteNeeded ? it : undefined)} disabled={!!blocked} reason={blocked ?? undefined}
        onClick={() => flow.start(next, voteNeeded ? it : undefined)}>Przejdź do punktu {nextNo}</Button></div>
      <span class="small muted">{next.title}</span>
    </>}
    {flow.dialog}
  </div>;
}

/** Zwięzły wynik głosowania w karcie punktu (także głosowania próbnego w karcie „Obrady”). */
function ResultLine({b}: {b: ViewBallot}) {
  const {m} = useMeeting();
  const s = useSession();
  const r = b.result;
  if (!r) return null;
  const replaced = b.supersededBy ? m.ballots.find(x => x.id === b.supersededBy) : undefined;
  const proposer = proposerSentence(s.roster, m, b);
  return <div class="result-line">
    <span class="kicker">{b.purpose === 'proba' ? `Wynik próbnego głosowania ${modeGenitive(b.mode)}` : `Wynik głosowania ${modeGenitive(b.mode)} nr ${b.number}${b.reasumptionOf ? ' po reasumpcji' : ''}`}</span>
    {b.purpose !== 'proba' && <p class="result-line__subject">{b.subject}</p>}
    <p class="result-line__verdict">{emphasize(resultLabel(b, materialTypeOf(m, b)))}</p>
    <p class="result-line__counts">Za {r.za}, przeciw {r.przeciw}, wstrzymało się {r.wstrzymuje}.</p>
    {proposer && <p class="result-line__subject">{proposer}</p>}
    {b.mode === 'imienne' && Object.keys(b.votes).length > 0 && <Fold title="Wykaz imienny">
      <ul class="named">{b.eligible.map(p => <li key={p}><span>{s.personName(p)}</span><strong>{b.votes[p] ? choiceLabel[b.votes[p]] : 'brak głosu'}</strong></li>)}</ul>
    </Fold>}
    {replaced && <p class="muted small">Wynik zastąpiony wynikiem reasumpcji w głosowaniu nr {replaced.number}.</p>}
    {/* O-06: ta sama podstawa rozstrzygnięcia co u członków, w zwiniętej sekcji. */}
    <BasisBlock b={b} fold/>
  </div>;
}

function Quorum({main}: {main: Main}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [asking, setAsking] = useState(false);
  const q = quorumNow(m, s.roster);
  const total = q.total, present = presentMembers(m as Meeting, s.roster).length, required = q.required;
  const last = m.quorumChecks.at(-1);
  const ok = present >= required;
  const blocked = announceFirst(m);
  // Dopóki kworum nie zostało stwierdzone, to jest działanie główne punktu otwarcia.
  const kind: Main = m.quorumChecks.length ? 'secondary' : main;
  // Na spotkaniu roboczym (F5) zostają liczby i jedno zdanie, a „Stwierdzam kworum” tylko wtedy, gdy kworum jest.
  if (m.working) return <div class={'quorum ' + (ok ? 'is-ok' : 'is-low')}>
    <dl class="facts facts--liczby"><Fact label="Obecnych">{present} <small>z {total}</small></Fact><Fact label={`Wymagane kworum (${q.basis})`}>{required}</Fact></dl>
    <p class="small">Stwierdzenie kworum niczego już nie zmienia.</p>
    {ok && <div class="actions"><Button busy={busy} onClick={() => send({type: 'quorum'})}>Stwierdzam kworum</Button></div>}
  </div>;
  return <div class={'quorum ' + (ok ? 'is-ok' : 'is-low')}>
    <dl class="facts facts--liczby"><Fact label="Obecnych">{present} <small>z {total}</small></Fact><Fact label={`Wymagane kworum (${q.basis})`}>{required}</Fact></dl>
    <p class="strong">{ok ? 'Jest kworum. Prezydium może podejmować uchwały.' : <>Brak kworum. Prezydium nie może podejmować uchwał <Ref>(§ 8 ust. 2).</Ref></>}</p>
    {last && <p class="muted small">{last.present >= last.required ? `Ostatnio stwierdzono o godz. ${fmtTime(last.at)}, że jest kworum.` : `Ostatnio stwierdzono o godz. ${fmtTime(last.at)} brak kworum.`}</p>}
    <div class="actions">
      {ok ? <Button kind={kind} busy={busy} onClick={() => send({type: 'quorum'})}>Stwierdzam kworum</Button>
        : <><Button kind={kind} busy={busy} onClick={() => send({type: 'quorum'})}>Zapisz brak kworum</Button>
          {m.status === 'trwa' && <Button busy={busy} disabled={!!blocked} reason={blocked ?? undefined} onClick={() => send({type: 'break', on: true})}>Zarządź przerwę</Button>}
          <Button haspopup busy={busy} onClick={() => setAsking(true)}>Kontynuuj jako spotkanie robocze</Button></>}
    </div>
    {asking && <WorkingConfirm onClose={() => setAsking(false)} onConfirm={() => send({type: 'working_start', reason: workingReason(m, s.roster)})}/>}
  </div>;
}

type Target = 'projekt' | 'wniosek' | 'inna';
type Warning = 'ponownie' | 'bez-projektu';

/** Przedmiot domyślny: „Podjęcie uchwały nr …” dla uchwały, „Przyjęcie protokołu …” dla protokołu. */
function defaultSubject(it: AgendaItem, materials: ViewMeeting['materials'], materialId: string | undefined) {
  const mat = materials.find(x => x.id === materialId);
  if (it.kind === 'porzadek') return 'Przyjęcie porządku obrad';
  if (it.kind === 'protokol') return mat ? `Przyjęcie protokołu ${mat.title.replace(/^Protokół\s+/i, '')}` : 'Przyjęcie protokołu z poprzedniego posiedzenia';
  if (mat && /^Uchwała nr\s/i.test(mat.title)) return mat.title.replace(/^Uchwała nr/i, 'Podjęcie uchwały nr');
  return mat?.title ?? it.title;
}

/** Wartość z paragrafem tylko wtedy, gdy pochodzi z regulaminu (O-02): „Jawne (§ 11 ust. 1)”. */
const withBasis = (text: string, e: Pick<Effective<unknown>, 'source' | 'basis'> | undefined) => e?.source === 'prawo' && e.basis ? <>{text} <Ref>{`(${e.basis})`}</Ref></> : text;
/** Linia źródła przy wartości, tylko gdy różni się od ustawień ogólnych i wzoru posiedzenia (O-02). */
function differenceLine(e: Effective<unknown> | undefined): string | null {
  if (!e || e.legacy) return null;
  if (e.source === 'obrady') return `Zmienione w trakcie obrad${e.stamp ? ` o godz. ${fmtTime(e.stamp.at)}` : ''}.`;
  if (e.source === 'punkt' && e.inherited !== undefined && e.inherited !== e.value) return 'Zmienione dla tego punktu.';
  if (e.source === 'posiedzenie' && e.inherited !== undefined && e.inherited !== e.value) return 'Zmienione dla tego posiedzenia.';
  return null;
}
const sourceNote = (text: string | null) => text ? <span class="fact-src">{text}</span> : null;

/**
 * Karta „Głosowanie w tym punkcie” (O-02): przedmiot, „Co jest głosowane”, tryb, wymagana większość, czas i wymagane
 * kworum z wartości skutecznych punktu, paragraf tylko przy wartościach z regulaminu, linia źródła tylko przy różnicy.
 * „Zmień ustawienia tego głosowania” rozwija przedmiot, „Co jest głosowane” (z powodem do protokołu, G-9, G-10, DA-8)
 * i czas. Wybór rodzaju bez głosowania w punkcie, który wymaga głosowania, otwiera okno „Zamknąć punkt bez głosowania?”.
 */
function BallotForm({it, main}: {it: AgendaItem; main: Main}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const types = useDocTypes();
  const ids = useId();
  const phone = useMedia('(max-width: 760px)');
  const eff = m.effective?.items[it.id];
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const closed = m.ballots.filter(b => b.status === 'zamkniete' && b.purpose !== 'proba' && !b.aborted);
  const votedOn = new Set(closed.filter(b => !b.supersededBy).map(b => b.material?.id));
  const decided = closed.filter(b => b.itemId === it.id && !b.supersededBy && b.purpose !== 'tryb' && b.purpose !== 'reasumpcja');
  const firstOpen = () => materials.find(x => !votedOn.has(x.id)) ?? materials[0];
  const planned = eff?.voteMinutes.value ?? 2;
  const [extra, setExtra] = useState(false);
  const [editing, setEditing] = useState(false);
  const [target, setTarget] = useState<Target>('projekt');
  const [materialId, setMaterialId] = useState(firstOpen()?.id ?? '');
  const [subject, setSubject] = useState(defaultSubject(it, materials, firstOpen()?.id));
  const [minutes, setMinutes] = useState(planned);
  // „Co jest głosowane” (F11): null to wartość z punktu, materiału albo przedmiotu (docTypeFor). Zmiana w trakcie obrad
  // wymaga powodu, który trafia do protokołu (G-10).
  const [docType, setDocType] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [skip, setSkip] = useState<string | null>(null);
  // Wniosek (np. poprawka) w sprawie z uchwalonym trybem może być jawny albo w uchwalonym trybie (F3).
  const [motionMode, setMotionMode] = useState<VoteMode>('jawne');
  const [motion, setMotion] = useState<'tajne' | 'imienne' | null>(null);
  const [steps, setSteps] = useState<{mode: VoteMode; list: Warning[]} | null>(null);
  const advancing = useRef(false);
  useEffect(() => { const f = firstOpen(); setMaterialId(f?.id ?? ''); setSubject(defaultSubject(it, materials, f?.id)); setTarget('projekt'); setDocType(null); setReason(''); }, [it.id, m.ballots.length, it.materialIds.length, it.mode]);
  useEffect(() => { setExtra(false); setEditing(false); }, [it.id]);
  useEffect(() => setMinutes(planned), [it.id, planned]);
  if (it.kind === 'porzadek' && m.agendaAdopted) return null;
  if (!m.agendaAdopted && it.kind !== 'porzadek') return null;
  if (it.kind === 'otwarcie' || it.kind === 'zamkniecie') return null;
  // Jedno głosowanie naraz, także gdy trwa głosowanie próbne. Na spotkaniu roboczym (F5) głosowań w sprawach nie ma.
  if (m.ballots.some(b => b.status === 'otwarte') || m.working) return null;
  // Nieprzyjęty porządek obrad poprawia się i ponownie poddaje pod głosowanie, więc formularz zostaje bez ostrzeżeń.
  const agendaVote = it.kind === 'porzadek';
  const done = !agendaVote && (materials.length ? materials.every(x => votedOn.has(x.id)) : decided.length > 0);
  if (done && !extra) {
    const last = [...closed].reverse().find(b => b.purpose !== 'tryb' && b.purpose !== 'reasumpcja' && (b.itemId === it.id || materials.some(x => x.id === b.material?.id)));
    return <div class="ballot-form ballot-done">
      <p class="small">{materials.length > 1 ? 'Głosowano już nad wszystkimi materiałami w tym punkcie.'
        : !last ? 'W tym punkcie przeprowadzono już głosowanie.'
        : last.mode === 'jawne' ? `W tym punkcie głosowano nad „${last.subject}” (głosowanie nr ${last.number}). Ponowne głosowanie w tej sprawie jest możliwe tylko w trybie reasumpcji (§ 12).`
        : `W tym punkcie głosowano nad „${last.subject}” (głosowanie nr ${last.number}). Wyniku głosowania ${modeGenitive(last.mode)} nie poddaje się reasumpcji.`}</p>
      <div><Button kind="ghost" quiet small onClick={() => { setExtra(true); setEditing(true); }}>Inne głosowanie w tym punkcie</Button></div>
    </div>;
  }
  // B1-19, DB-5: podpunkt z „Dotyczy protokołu” (albo w punkcie przyjęcia protokołu) głosuje się w celu `protokol`.
  const protocolVote = it.kind === 'protokol' || !!it.protocolOf || rootOf(m, it).kind === 'protokol';
  const basePurpose: BallotPurpose = it.kind === 'porzadek' ? 'porzadek' : protocolVote ? 'protokol' : 'uchwala';
  const project = !extra || target === 'projekt';
  const purpose: BallotPurpose = project ? basePurpose : target;
  const chosenMaterial = project ? materialId : '';
  const fixed = it.mode;
  // F3: uchwalony tryb wiąże głosowanie w sprawie. Wniosek (np. poprawka) zostaje bez tej blokady.
  const bound = !!fixed && purpose !== 'wniosek';
  const mode: VoteMode = bound ? fixed! : fixed && purpose === 'wniosek' ? motionMode : 'jawne';
  const withDoc = purpose === 'uchwala' || purpose === 'protokol' || purpose === 'inna';
  const suggested = docTypeFor(m, {item: it, materialId: chosenMaterial || null, purpose, subject}) ?? '';
  const chosenDoc = docType ?? suggested;
  const docChanged = project && docType !== null && docType !== suggested;
  const block = voteBlock(m) ?? (docChanged && !reason.trim() ? 'Wpisz powód zmiany rodzaju sprawy.' : null);
  const bare = purpose === 'uchwala' && !chosenMaterial && resolutionSubject.test(subject.trim());
  const repeat = agendaVote ? undefined : [...closed].reverse().find(b => b.purpose !== 'tryb' && b.purpose !== 'reasumpcja' && ((chosenMaterial && b.material?.id === chosenMaterial) || normalized(b.subject) === normalized(subject)));
  const quorum = quorumNow(m, s.roster);
  const present = presentMembers(m as Meeting, s.roster).length;
  const majority = m.effective?.meeting.majority;
  const modeEff = m.effective?.meeting.mode;
  const docName = chosenDoc ? docTypeById(types, chosenDoc)?.name ?? chosenDoc : 'Bez rodzaju';
  const pick = (value: Target) => {
    setTarget(value);
    setDocType(null);
    setReason('');
    if (value === 'projekt') { const f = firstOpen(); setMaterialId(f?.id ?? ''); setSubject(defaultSubject(it, materials, f?.id)); }
    else setSubject('');
  };
  // DA-8: rodzaj bez głosowania w punkcie, który wymaga głosowania, zamyka punkt bez głosowania (okno z powodem).
  const chooseDoc = (value: string) => {
    const type = docTypeById(types, value);
    if (project && value && type && !type.voted && votedSource(m, it, types)) { setSkip(value); return; }
    setDocType(value);
  };
  const openNow = async (chosen: VoteMode) => {
    if (docChanged && !await send({type: 'item_edit', itemId: it.id, docType: chosenDoc || null, reason: reason.trim()})) return;
    send({type: 'ballot_open', itemId: it.id, purpose, subject, mode: chosen, minutes, materialId: chosenMaterial || null, ...(withDoc ? {docType: chosenDoc || null} : {})});
  };
  const begin = (chosen: VoteMode) => {
    const list: Warning[] = [];
    if (repeat) list.push('ponownie');
    if (bare) list.push('bez-projektu');
    if (list.length) setSteps({mode: chosen, list});
    else openNow(chosen);
  };
  // Okna ostrzeżeń idą po kolei. Potwierdzenie przechodzi do następnego, a „Anuluj” przerywa całość.
  const confirmStep = () => {
    if (!steps) return;
    advancing.current = true;
    const rest = steps.list.slice(1);
    if (rest.length) setSteps({...steps, list: rest});
    else { setSteps(null); openNow(steps.mode); }
  };
  const closeStep = () => { if (advancing.current) { advancing.current = false; return; } setSteps(null); };
  const step = steps?.list[0];
  const said = subject.trim().replace(/[.\s]+$/, '');
  const speech = `Zarządzam głosowanie ${modeName(mode)}. Przedmiot głosowania „${said}”. Proszę o oddanie głosu na telefonach. Głosowanie potrwa ${minutes} ${plural(minutes, 'minutę', 'minuty', 'minut')}.`;
  const modeText = bound ? `${modeName(fixed!).replace(/^./, c => c.toUpperCase())}, ${it.modeBasis ?? 'uchwalone przez Prezydium'}` : mode === 'jawne' ? 'Jawne' : modeName(mode).replace(/^./, c => c.toUpperCase());
  const timeLine = minutes !== planned ? 'Zmienione w trakcie obrad.' : differenceLine(eff?.voteMinutes);
  const docLine = docChanged ? 'Zmienione w trakcie obrad.' : project ? differenceLine(eff?.docType) : null;
  const draftChangeCount = it.kind === 'porzadek' ? m.log.filter(l => l.tag === 'projekt' && l.at >= (m.openedAt ?? Infinity)).length : 0;
  const majorityFact = <Fact label="Wymagana większość">{withBasis('Zwykła, więcej głosów za niż przeciw', majority ?? {source: 'prawo', basis: lawOf(m.organ).majority.basis})}</Fact>;
  const quorumFact = <Fact label="Wymagane kworum">{quorum.required} z {quorum.total} <Ref>{`(${quorum.basis})`}</Ref>, obecnych {present}</Fact>;
  // Enter w polu przedmiotu wysyła formularz także wtedy, gdy przycisk jest nieaktywny (przerwa, trwa czynność).
  // Okno wniosku o tryb ma własny formularz, więc stoi poza tym formularzem.
  return <><form class="ballot-form" onSubmit={e => { e.preventDefault(); if (e.target === e.currentTarget && !block && !busy) begin(mode); }}>
    <h3 class="card-sub">{it.kind === 'porzadek' ? 'Głosowanie nad porządkiem obrad' : 'Głosowanie w tym punkcie'}</h3>
    {extra && <div class="oi-field">
      <span class="oi-field__label" id={`${ids}-cel`}>Czego dotyczy głosowanie?</span>
      <div class="oi-seg seg-cel" role="group" aria-labelledby={`${ids}-cel`}>
        {([['projekt', 'Projekt w tym punkcie'], ['wniosek', 'Wniosek, np. poprawka'], ['inna', 'Inna sprawa']] as [Target, string][]).map(([value, label]) =>
          <button key={value} type="button" class="oi-opt" aria-pressed={target === value} onClick={() => pick(value)}>{label}</button>)}
      </div>
    </div>}
    <dl class="facts vote-rules">
      {!editing && <Fact label="Przedmiot">{subject || 'Wpisz przedmiot głosowania.'}</Fact>}
      {withDoc && !editing && <Fact label="Co jest głosowane">{docName}{sourceNote(docLine)}</Fact>}
      <Fact label="Tryb">{bound ? <>{modeText} <Ref>(§ 11 ust. 2)</Ref></> : withBasis(modeText, mode === 'jawne' ? modeEff ?? {source: 'prawo', basis: '§ 11 ust. 1'} : undefined)}</Fact>
      {!phone && majorityFact}
      {!editing && <Fact label="Czas">{minutesText(minutes)}{sourceNote(timeLine)}</Fact>}
      {!phone && quorumFact}
      {/* O-10 (dodatek): zmiany projektu porządku od otwarcia posiedzenia, które trafią do protokołu. */}
      {it.kind === 'porzadek' && <Fact label="Zmiany projektu na tym posiedzeniu">{draftChangeCount ? `${draftChangeCount}, trafią do protokołu` : 'Bez zmian'}</Fact>}
    </dl>
    {phone && <Fold title="Na jakiej podstawie?"><dl class="facts">{majorityFact}{quorumFact}</dl></Fold>}
    {editing && <div class="vote-edit stack">
      {project && materials.length > 1 && <Field label="Nad którym materiałem?"><select value={materialId} onChange={e => { const v = (e.target as HTMLSelectElement).value; setMaterialId(v); setDocType(null); setSubject(defaultSubject(it, materials, v)); }}>
        {materials.map(x => <option key={x.id} value={x.id}>{x.title}{votedOn.has(x.id) ? ' (już głosowano)' : ''}</option>)}
      </select></Field>}
      <Field label="Przedmiot głosowania"><input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} required maxLength={400}/></Field>
      {withDoc && <DocTypeSelect types={types} value={chosenDoc} onChange={chooseDoc} label="Co jest głosowane" empty="Bez rodzaju (wynik „Przyjęto” albo „Nie przyjęto”)"
        hint="Rodzaj decyduje o formule wyniku. Wartość domyślna pochodzi z punktu albo z materiału."/>}
      {docChanged && <Field label="Powód" hint="Np. projekt zawiera stanowisko, a nie uchwałę. Powód trafi do protokołu."><input value={reason} maxLength={500} required onInput={e => setReason((e.target as HTMLInputElement).value)}/></Field>}
      {fixed && purpose === 'wniosek' && <Segments label="Tryb wniosku" value={motionMode} options={[['jawne', 'Jawne'], [fixed, fixed === 'tajne' ? 'Tajne' : 'Imienne']]} onChange={setMotionMode}
        hint="Wniosek w tej sprawie może być jawny albo w trybie uchwalonym przez Prezydium."/>}
      <div class="oi-field">
        <span class="oi-field__label" id={`${ids}-czas`}>Czas</span>
        <div class="oi-seg seg-czas" role="group" aria-labelledby={`${ids}-czas`}>
          {VOTE_MINUTES.map(n => <button key={n} type="button" class="oi-opt" aria-pressed={minutes === n} onClick={() => setMinutes(n)}>{n} min</button>)}
        </div>
        <span class="oi-field__hint">{`W ustawieniach punktu ${minutesText(planned)}.`}</span>
      </div>
    </div>}
    {!fixed && it.kind !== 'porzadek' && <div class="vote-motions">
      <p class="small muted">Prezydium może uchwalić tajność głosowania albo głosowanie imienne.</p>
      <div class="actions"><Button kind="ghost" quiet small haspopup onClick={() => setMotion('tajne')}>Wniosek o głosowanie tajne</Button><Button kind="ghost" quiet small haspopup onClick={() => setMotion('imienne')}>Wniosek o głosowanie imienne</Button></div>
    </div>}
    {bare && <Notice tone="warn">Do tego punktu nie dołączono projektu uchwały. Członkowie nie zobaczą treści, nad którą głosują.</Notice>}
    <div><Button kind={main} type="submit" busy={busy} haspopup={!!repeat || bare} disabled={!!block} reason={block ?? undefined}>Otwórz głosowanie</Button></div>
    {!extra && <div><button type="button" class="link link-cel small quiet" aria-expanded={editing} onClick={() => setEditing(v => !v)}>Zmień ustawienia tego głosowania</button></div>}
    <ReadAloud>
      {/* Zdanie o zawiadomieniu tylko przy wpisanej dacie wysłania. Aplikacja nie wie, czy członkowie je otrzymali. */}
      {it.kind === 'porzadek' && <p>{m.noticeDate ? `Zawiadomienie z projektem porządku obrad wysłano ${longDate(m.noticeDate)} ` : ''}Czy są uwagi lub wnioski o zmianę projektu porządku obrad? Zarządzam głosowanie nad przyjęciem porządku obrad.</p>}
      <p>{speech}</p>
    </ReadAloud>
    {step === 'ponownie' && repeat && <Confirm key="ponownie" title="Ponownie głosować w tej samej sprawie?" kind="danger" confirm="Otwórz ponowne głosowanie" onConfirm={confirmStep} onClose={closeStep}
      text={<p>{chosenMaterial && repeat.material?.id === chosenMaterial ? 'Nad tym materiałem już głosowano' : 'W tej sprawie już głosowano'} (głosowanie nr {repeat.number}). Regulamin przewiduje ponowne głosowanie w tej samej sprawie tylko w trybie reasumpcji (§ 12).</p>}/>}
    {step === 'bez-projektu' && <Confirm key="bez-projektu" title="Otworzyć głosowanie bez projektu?" confirm="Otwórz głosowanie" focus="cancel" onConfirm={confirmStep} onClose={closeStep}
      text={<p>Do tego punktu nie dołączono projektu uchwały. Członkowie nie zobaczą treści, nad którą głosują.</p>}/>}
  </form>
  {motion && <ModeMotion it={it} mode={motion} onClose={() => setMotion(null)}/>}
  {skip !== null && <Confirm title="Zamknąć punkt bez głosowania?" kind="danger" confirm="Bez głosowania" onClose={() => setSkip(null)}
    field={{label: 'Powód', required: true, hint: 'Np. projekt wymaga uzupełnienia. Powód trafi do protokołu.'}}
    onConfirm={async why => { if (await send({type: 'item_edit', itemId: it.id, docType: skip, reason: why}) && it.status === 'w_toku') send({type: 'item_end', itemId: it.id, status: 'zakonczony'}); }}
    text={<p>W tym punkcie nie zapadnie uchwała. Powód trafi do protokołu.</p>}/>}
  </>;
}

// Wniosek o głosowanie tajne albo imienne (§ 11) z polem „Kto zgłasza wniosek?” (F14): lista obecnych członków.
function ModeMotion(props: {it: AgendaItem; mode: 'tajne' | 'imienne'; onClose: () => void}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [who, setWho] = useState('');
  const present = presentMembers(m as Meeting, s.roster);
  const block = voteBlock(m);
  const reason = block ?? (who ? null : 'Wskaż, kto zgłasza wniosek.');
  return <Modal title={`Wniosek o głosowanie ${props.mode}`} onClose={props.onClose} closeButton={false} confirm initialFocus=".motion-who select">
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      if (reason) return;
      if (await send({type: 'mode_motion', itemId: props.it.id, mode: props.mode, minutes: motionMinutesOf(m), proposedBy: who})) props.onClose();
    }}>
      <p>Prezydium w głosowaniu jawnym, zwykłą większością głosów, zdecyduje, czy uchwalić {props.mode === 'tajne' ? 'tajność głosowania' : 'głosowanie imienne'} w sprawie „{props.it.title}”. {lastsText(motionMinutesOf(m))}</p>
      <div class="motion-who"><Field label="Kto zgłasza wniosek?" hint="Wniosek zgłasza członek Prezydium obecny na posiedzeniu. Nazwisko trafi do protokołu.">
        <select value={who} required onChange={e => setWho((e.target as HTMLSelectElement).value)}>
          <option value="">Wybierz osobę…</option>
          {present.map(id => <option key={id} value={id}>{personWithFunc(s.roster, m, id)}</option>)}
        </select>
      </Field></div>
      <div class="actions confirm-actions">
        <Button kind="primary" type="submit" class="confirm-ok" busy={busy} disabled={!!reason} reason={reason ?? ''}>Poddaj wniosek pod głosowanie</Button>
        <Button class="confirm-cancel" onClick={props.onClose}>Anuluj</Button>
      </div>
    </form>
  </Modal>;
}

// Lista zaczyna się od pustej pozycji: materiał trzeba wybrać, a do tego czasu przycisk jest nieaktywny z powodem.
function AssignMaterial({it, others}: {it: AgendaItem; others: ViewMeeting['materials']}) {
  const {send, busy} = useMeeting();
  const [pick, setPick] = useState('');
  useEffect(() => { if (pick && !others.some(x => x.id === pick)) setPick(''); }, [others.map(x => x.id).join()]);
  return <div class="assign-material">
    <Field label="Przypisz materiał do punktu"><select value={pick} onChange={e => setPick((e.target as HTMLSelectElement).value)}>
      <option value="">Wybierz materiał…</option>
      {others.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}
    </select></Field>
    <div><Button small busy={busy} disabled={!pick} reason={pick ? undefined : 'Wybierz materiał z listy.'} onClick={() => { if (pick) send({type: 'item_material', itemId: it.id, materialId: pick, on: true}).then(r => { if (r) setPick(''); }); }}>Przypisz materiał</Button></div>
  </div>;
}

// Notatka do protokołu zapisuje się sama 1,5 s po przerwie w pisaniu i przy wyjściu z pola. Gdy w trakcie
// edycji zmieni się na innym urządzeniu, zapis czeka na wybór wersji.
function NoteEditor({it, open}: {it: AgendaItem; open: boolean}) {
  const {m, replace} = useMeeting();
  const saved = useSaveStatus();
  const [text, setText] = useState(it.note);
  const [conflict, setConflict] = useState<number | null>(null);
  const base = useRef(it.note);
  const latest = useRef(it.note);
  const held = useRef(false);
  const timer = useRef(0);
  const path = `/api/meetings/${m.id}/command`;
  // Zmiana zapisana na serwerze w trakcie edycji: bez własnych zmian wczytuje się sama, a z nimi czeka na wybór.
  useEffect(() => {
    if (it.note === base.current) return;
    if (it.note === latest.current) { base.current = it.note; held.current = false; setConflict(null); return; }
    if (latest.current === base.current) { base.current = it.note; latest.current = it.note; setText(it.note); return; }
    held.current = true;
    setConflict(serverNow());
  }, [it.note]);
  // Przy przejściu do innego punktu niezapisana zmiana wysyła się od razu.
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (!held.current && latest.current !== base.current) request(path, {body: {type: 'item_edit', itemId: it.id, note: latest.current}}).catch(() => {});
  }, []);
  const save = async () => {
    window.clearTimeout(timer.current);
    const value = latest.current;
    if (value === base.current || held.current) return;
    await saved.track(async () => {
      const r = await request<{meeting: ViewMeeting}>(path, {body: {type: 'item_edit', itemId: it.id, note: value}});
      base.current = value;
      replace(r);
      return r.meeting;
    });
  };
  const type = (value: string) => {
    setText(value);
    latest.current = value;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(save, 1500);
  };
  const load = () => { base.current = it.note; latest.current = it.note; held.current = false; setText(it.note); setConflict(null); };
  const keep = () => { base.current = it.note; held.current = false; setConflict(null); save(); };
  // Na spotkaniu roboczym (F5) dokumentem jest projekt notatki, a nie protokół.
  return <Fold title={m.working ? 'Notatka do punktu' : 'Notatka do protokołu'} open={open}>
    <div class="note-editor">
      {conflict !== null && <Notice tone="warn">
        <p>Notatka została zmieniona na innym urządzeniu o godz. {fmtTime(conflict)}.</p>
        <div class="actions"><Button small onClick={load}>Wczytaj nową wersję</Button><Button small onClick={keep}>Zostaw moją</Button></div>
      </Notice>}
      <Field label="Treść notatki" hint={`Przebieg dyskusji, wnioski i ustalenia. Notatka trafi do projektu ${m.working ? 'notatki ze spotkania' : 'protokołu'}.`}>
        <textarea rows={4} value={text} onInput={e => type((e.target as HTMLTextAreaElement).value)} onBlur={save}/>
      </Field>
      <SaveStatus status={saved}/>
    </div>
  </Fold>;
}

function AgendaFixes() {
  const {m, send, busy} = useMeeting();
  const [open, setOpen] = useState(false);
  const voting = m.ballots.find(b => b.status === 'otwarte');
  // D2 (O-04): na spotkaniu roboczym poza punktem „Przyjęcie porządku obrad” projekt zmienia się w trybie zmian, który
  // widzą członkowie i ekran sali, zamiast w oknie „Popraw porządek obrad”.
  if (m.working && draftLive(m)) {
    if (draftEditing(m)) return null;
    return <div class="stack-tight">
      <p class="muted small">Na spotkaniu roboczym punkty rozpoczyna się bez przyjmowania porządku. Zmiany projektu porządku członkowie i ekran sali widzą od razu.</p>
      <div><Button kind="ghost" quiet small busy={busy} onClick={() => send({type: 'present', kind: 'projekt', id: m.id})}>Zmień projekt porządku</Button></div>
    </div>;
  }
  return <div class="stack-tight">
    <p class="muted small">{m.working ? 'Przed przyjęciem porządek można poprawiać. Na spotkaniu roboczym punkty rozpoczyna się bez przyjmowania porządku.' : 'Przed przyjęciem porządek można poprawiać. Po nieprzyjęciu popraw go i ponownie poddaj pod głosowanie.'}</p>
    {voting ? <p class="muted small">Dostępne po zakończeniu {ballotOf(voting)}.</p>
      : <div><Button small haspopup onClick={() => setOpen(true)}>Popraw porządek obrad</Button></div>}
    {open && <Modal title="Popraw porządek obrad" wide onClose={() => setOpen(false)}><AgendaEditor/></Modal>}
  </div>;
}

// Wnioski o zmianę przyjętego porządku: dodanie, przeniesienie i usunięcie punktu. Każdy otwiera głosowanie
// jawne (polecenie agenda_change), a domena wprowadza zmianę po przyjęciu wniosku. Na spotkaniu roboczym (F5)
// wniosków nie ma, a przy nieogłoszonym wyniku (F2) czekają na jego ogłoszenie.
function AgendaChange() {
  const {m, send, busy} = useMeeting();
  const [mode, setMode] = useState<'dodaj' | 'usun' | 'przesun' | null>(null);
  const [moving, setMoving] = useState('');
  const top = m.agenda.filter(i => !i.parentId);
  const removable = m.agenda.filter(i => i.status === 'oczekuje' && !m.ballots.some(b => b.itemId === i.id) && i.kind === 'sprawa');
  // Punkt przenosi się przed inny nierozpoczęty punkt na tym samym poziomie (punkt główny albo podpunkt tego samego punktu).
  const targets = (it: AgendaItem | undefined) => {
    if (!it) return [];
    const siblings = m.agenda.filter(i => i.parentId === it.parentId);
    const at = siblings.indexOf(it);
    return siblings.filter((t, j) => j !== at && j !== at + 1 && t.status === 'oczekuje');
  };
  const movable = orderedAgenda(m.agenda).filter(i => i.status === 'oczekuje' && !['otwarcie', 'porzadek', 'zamkniecie'].includes(i.kind) && targets(i).length > 0);
  const moved = movable.find(i => i.id === moving) ?? movable[0];
  const voting = m.ballots.find(b => b.status === 'otwarte');
  const blocked = announceFirst(m);
  const label = (it: AgendaItem) => `${itemNumber(m.agenda, it.id)}. ${it.title}`;
  const titles = {dodaj: 'Wniosek o dodanie punktu', usun: 'Wniosek o usunięcie punktu', przesun: 'Wniosek o przeniesienie punktu'};
  if (m.working) return <p class="muted small">{workingRefusal} Przyjęty porządek zmienia się w głosowaniu, więc na tym spotkaniu zostaje bez zmian.</p>;
  return <div class="stack-tight">
    <p class="muted small">Przyjęty porządek zmienia się w głosowaniu.</p>
    {voting ? <p class="muted small">Dostępne po zakończeniu {ballotOf(voting)}.</p> : blocked ? <p class="muted small">{blocked}</p> : <div class="actions agenda-change">
      <Button kind="ghost" quiet small haspopup onClick={() => setMode('dodaj')}>Wniosek o dodanie punktu</Button>
      {movable.length > 0 && <Button kind="ghost" quiet small haspopup onClick={() => { setMoving(movable[0].id); setMode('przesun'); }}>Wniosek o przeniesienie punktu</Button>}
      {removable.length > 0 && <Button kind="ghost" quiet small haspopup onClick={() => setMode('usun')}>Wniosek o usunięcie punktu</Button>}
    </div>}
    {mode && <Modal title={titles[mode]} onClose={() => setMode(null)}>
      <form class="stack" onSubmit={async e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const where = String(f.get('where') ?? '');
        const change: AgendaChange = mode === 'dodaj'
          ? where.startsWith('pod:') ? {op: 'dodaj', title: String(f.get('title')), parentId: where.slice(4), afterId: null} : {op: 'dodaj', title: String(f.get('title')), parentId: null, afterId: where || null}
          : mode === 'przesun' ? {op: 'przesun', itemId: String(f.get('item')), beforeId: String(f.get('before'))}
          : {op: 'usun', itemId: String(f.get('item'))};
        if (await send({type: 'agenda_change', change, minutes: motionMinutesOf(m)})) setMode(null);
      }}>
        {mode === 'dodaj' && <>
          <Field label="Nazwa punktu"><input name="title" required maxLength={400}/></Field>
          <Field label="Miejsce w porządku"><select name="where">
            {top.map(t => <option key={t.id} value={t.id}>po punkcie {label(t)}</option>)}
            {top.map(t => <option key={'pod:' + t.id} value={'pod:' + t.id}>jako podpunkt w {label(t)}</option>)}
          </select></Field>
        </>}
        {mode === 'przesun' && moved && <>
          <Field label="Punkt do przeniesienia"><select name="item" value={moved.id} onChange={e => setMoving((e.target as HTMLSelectElement).value)}>
            {movable.map(i => <option key={i.id} value={i.id}>{label(i)}</option>)}
          </select></Field>
          <Field label="Przed punktem"><select name="before" key={moved.id}>
            {targets(moved).map(t => <option key={t.id} value={t.id}>{label(t)}</option>)}
          </select></Field>
        </>}
        {mode === 'usun' && <Field label="Punkt do usunięcia"><select name="item">{removable.map(i => <option key={i.id} value={i.id}>{label(i)}</option>)}</select></Field>}
        <Notice>{`Otworzy się głosowanie jawne. ${lastsText(motionMinutesOf(m))} Zmiana wejdzie do porządku po przyjęciu zwykłą większością głosów.`}</Notice>
        <div class="actions"><Button kind="primary" type="submit" busy={busy}>Poddaj pod głosowanie</Button><Button onClick={() => setMode(null)}>Anuluj</Button></div>
      </form>
    </Modal>}
  </div>;
}

// Karta „Obrady”: co pokazuje ekran sali, przerwa, głosowanie próbne (F1) i zamknięcie posiedzenia (fakty o kworum są
// w pasku posiedzenia). Głosowanie próbne nie blokuje przerwy ani zamknięcia, a przy nieogłoszonym wyniku (F2) przyciski
// czekają na jego ogłoszenie.
function MeetingControls({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [closing, setClosing] = useState(false);
  const quorum = quorumNow(m, s.roster), present = presentMembers(m as Meeting, s.roster).length;
  const voting = regularOpen(m);
  const screen = screenShows(m);
  const blocked = announceFirst(m);
  const blockedId = useId();
  return <section class="oi-card controls">
    <CardTitle level={2}>Obrady</CardTitle>
    {m.working ? <Notice tone="warn" label="Spotkanie robocze">{workingSentence}</Notice>
      : present < quorum.required && <Notice tone="warn">Brak kworum. Prezydium nie może podejmować uchwał <Ref>{`(${quorum.basis}).`}</Ref></Notice>}
    <dl class="facts"><Fact label="Ekran sali pokazuje">{screen.text}</Fact></dl>
    {!readOnly && screen.other && <div><Button kind="ghost" quiet small busy={busy} onClick={() => send({type: 'present', kind: null})}>Pokaż bieżący punkt</Button></div>}
    {!readOnly && voting && <p class="muted small">Dostępne po zakończeniu głosowania nr {voting.number}.</p>}
    {/* Przy nieogłoszonym wyniku (F2) jeden wiersz z powodem zamiast powodu pod każdym nieaktywnym przyciskiem. */}
    {!readOnly && !voting && blocked && <p class="small strong" id={blockedId}>{blocked} Do tego czasu przerwa, głosowanie próbne i zamknięcie posiedzenia są niedostępne.</p>}
    {!readOnly && !voting && <>
      <div class="actions">{m.status === 'trwa'
        ? <Button small busy={busy} disabled={!!blocked} describedBy={blockedId} onClick={() => send({type: 'break', on: true})}>Zarządź przerwę</Button>
        : <Button kind="primary" small busy={busy} onClick={() => send({type: 'break', on: false})}>Wznów obrady</Button>}</div>
      {m.status === 'trwa' && <ReadAloud><p>Ogłaszam przerwę w obradach.</p></ReadAloud>}
      <TrialBallot blockedId={blocked ? blockedId : undefined}/>
      <div class="controls-end">
        <span class="kicker">Zakończenie obrad</span>
        <div><Button small haspopup disabled={!!blocked} describedBy={blockedId} onClick={() => setClosing(true)}>{m.working ? 'Zamknij spotkanie robocze' : 'Zamknij posiedzenie'}</Button></div>
        <p class="muted small">{m.working ? 'Kończy spotkanie i tworzy projekt notatki.' : 'Kończy obrady i tworzy projekt protokołu.'}</p>
      </div>
    </>}
    {closing && <CloseDialog onClose={() => setClosing(false)}/>}
  </section>;
}

/** Ostatnie głosowanie próbne, gdy jest ostatnim zamkniętym głosowaniem posiedzenia (jego wynik widać w karcie „Obrady”). */
function lastTrialResult(m: ViewMeeting) {
  const last = m.ballots.filter(b => b.status === 'zamkniete').sort((x, y) => (y.closedAt ?? 0) - (x.closedAt ?? 0))[0];
  return last?.purpose === 'proba' ? last : undefined;
}

// Głosowanie próbne (F1): sprawdza, czy głosowanie działa u wszystkich, także tajne. Bez skutków, kworum i uchwalania trybu.
function TrialBallot(props: {blockedId?: string}) {
  const {m} = useMeeting();
  const [asking, setAsking] = useState(false);
  const open = m.ballots.find(b => b.status === 'otwarte');
  const unannouncedReason = announceFirst(m);
  const blocked = unannouncedReason ?? (m.status !== 'trwa' ? 'Głosowanie otworzysz po wznowieniu obrad.' : null);
  const last = lastTrialResult(m);
  return <div class="controls-trial">
    <span class="kicker">Głosowanie próbne</span>
    <p class="muted small">Sprawdza, czy głosowanie działa na telefonach obecnych. Nie ma żadnych skutków.</p>
    {open ? <p class="muted small">Dostępne po zakończeniu {ballotOf(open)}.</p>
      : <div><Button small haspopup disabled={!!blocked} reason={unannouncedReason && props.blockedId ? undefined : blocked ?? undefined} describedBy={props.blockedId} onClick={() => setAsking(true)}>Głosowanie próbne</Button></div>}
    {last && !open && <ResultLine b={last}/>}
    {asking && <TrialDialog onClose={() => setAsking(false)}/>}
  </div>;
}

function TrialDialog(props: {onClose: () => void}) {
  const {send, busy} = useMeeting();
  const [mode, setMode] = useState<'jawne' | 'tajne'>('jawne');
  const [minutes, setMinutes] = useState('1');
  return <Modal title="Otworzyć głosowanie próbne?" onClose={props.onClose} closeButton={false} confirm initialFocus=".confirm-cancel">
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      // Okno zamyka się od razu, żeby panel mógł przejść do trwającego głosowania (błąd pokazuje komunikat pod paskiem).
      props.onClose();
      send({type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode, minutes: Number(minutes)});
    }}>
      <p>Obecni członkowie zagłosują na telefonach tak jak w zwykłym głosowaniu. Głos nie ma żadnych skutków, a wynik zobaczą wszyscy od razu po zakończeniu. Głosowanie próbne nie trafia do wykazu uchwał.</p>
      <Segments label="Tryb" value={mode} options={[['jawne', 'Jawne'], ['tajne', 'Tajne']]} onChange={setMode}
        hint="Tajne sprawdza też wydawanie kart do głosowania tajnego."/>
      <Segments label="Czas" value={minutes} options={[['1', '1 min'], ['2', '2 min'], ['3', '3 min']]} onChange={setMinutes}/>
      <div class="actions confirm-actions"><Button kind="primary" type="submit" class="confirm-ok" busy={busy}>Otwórz głosowanie próbne</Button><Button class="confirm-cancel" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

// Zamknięcie posiedzenia: lista kontrolna, uwaga o skutku i pole potwierdzenia. Gdy zostały nierozpatrzone punkty (F4),
// okno wymaga powodu, który trafi do protokołu przy każdym z nich. Fokus startuje na polu powodu albo na „Anuluj”.
function CloseDialog({onClose}: {onClose: () => void}) {
  const {m, send} = useMeeting();
  const types = useDocTypes();
  const unhandled = unhandledItems(m, types);
  const number = (id: string) => m.ballots.find(b => b.id === id)?.number;
  const lines = [
    ...unhandled.map(it => it.status === 'oczekuje'
      ? `Punkt ${itemNumber(m.agenda, it.id)} „${it.title}” nie był rozpatrywany.`
      : `W punkcie ${itemNumber(m.agenda, it.id)} „${it.title}” nie przeprowadzono głosowania.`),
    ...m.motions.filter(x => x.status === 'zlozony').map(x => `Wniosek o reasumpcję głosowania nr ${number(x.ballotId)} czeka na decyzję Prezydium.`),
    ...m.motions.filter(x => x.status === 'przyjety' && !x.repeatBallotId).map(x => `Prezydium przyjęło wniosek o reasumpcję głosowania nr ${number(x.ballotId)}, a ponownego głosowania nie przeprowadzono.`),
    ...unannounced(m).map(b => `Wynik głosowania nr ${b.number} nie został ogłoszony.`),
  ];
  return <Confirm title={m.working ? 'Zamknąć spotkanie robocze?' : 'Zamknąć posiedzenie?'} kind="danger" confirm={m.working ? 'Zamknij spotkanie robocze' : 'Zamknij posiedzenie'} onClose={onClose}
    onConfirm={reason => send(unhandled.length ? {type: 'close', reason} : {type: 'close'})}
    ack={`Rozumiem, że zamknięcia ${m.working ? 'spotkania' : 'posiedzenia'} nie można cofnąć.`}
    focus={unhandled.length ? 'field' : 'cancel'}
    field={unhandled.length ? {label: 'Powód', required: true, hint: m.working
      ? 'Np. brak kworum, spotkanie robocze bez głosowań. Powód trafi do protokołu przy każdym nierozpatrzonym punkcie.'
      : 'Np. brak czasu, nieobecność osoby referującej. Powód trafi do protokołu przy każdym nierozpatrzonym punkcie.'} : undefined}
    text={<div class="close-check">
      <span class="kicker">Przed zamknięciem sprawdź</span>
      {!unhandled.length && <p>Wszystkie punkty porządku obrad zostały rozpatrzone.</p>}
      {lines.length > 0 && <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>}
    </div>}
    details={<div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>{`Po zamknięciu nie można już głosować ani zmieniać zapisu. Powstanie projekt ${m.working ? 'notatki' : 'protokołu'}.`}</p></div>}/>;
}

// Lista obecności: zdanie z liczbą obecnych, znaczniki tylko przy wyjątkach i szare odnośniki z nazwiskiem.
// Zgłoszoną obecność (F9) potwierdza osoba prowadząca obrady albo biuro, także wszystkie zgłoszenia naraz. Wersja 3
// (DA-19, O-11): czynności z listy pokazuje się tylko wtedy, gdy domena je przyjmie (canKeepAttendance z role.ts).
// Biuro nie odrzuca zgłoszeń i nie zmienia obecności osoby prowadzącej, a w trakcie głosowania wyjście osób
// uprawnionych zapisuje tylko osoba prowadząca, w karcie głosowania („Oznacz nieobecność”).
function Attendance() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const people = usePeople();
  const actor = actorOf(s);
  const mm = m as unknown as Meeting;
  const presiding = m.chair.current === s.personId;
  const office = isOfficeAccount(actor) && !presiding;
  const members = organRoster(s.roster, m);
  const reported = members.filter(ms => m.attendance[ms.personId] === 'zgloszony');
  const away = members.filter(ms => m.attendance[ms.personId] !== 'obecny' && m.attendance[ms.personId] !== 'zgloszony');
  const pending = pendingPresence(m).filter(p => canKeepAttendance(mm, actor, p.who, 'potwierdz'));
  const voting = regularOpen(m);
  const lastEvent = (who: string, guest: boolean) => [...m.presenceLog].reverse().find(e => e.who === who && e.guest === guest);
  const line = (label: string, status: Presence | undefined, who: string, guest: boolean) => {
    const ev = lastEvent(who, guest);
    const lead = label ? `${label}, ` : '';
    if (status === 'obecny') return ev ? `${lead}na posiedzeniu od godz. ${fmtTime(ev.at)}` : label;
    if (status === 'wyszedl') return ev ? `${lead}wyjście o godz. ${fmtTime(ev.at)}` : label;
    if (status === 'zgloszony') return `${lead}obecność zgłoszona${ev ? ` o godz. ${fmtTime(ev.at)}` : ''}, czeka na potwierdzenie`;
    return `${lead}bez potwierdzenia obecności`;
  };
  const row = (who: string, name: string, label: string, status: Presence | undefined, guest: boolean) => {
    const present = status === 'obecny';
    const action = present ? 'Zapisz wyjście' : 'Zapisz obecność';
    const allowed = (a: 'potwierdz' | 'odrzuc' | 'przybycie' | 'wyjscie') => canKeepAttendance(mm, actor, who, a);
    // O-11: w trakcie głosowania wyjście członka zapisuje osoba prowadząca w karcie głosowania, a nie na liście.
    const markable = present ? allowed('wyjscie') && !(voting && !guest) : allowed('przybycie');
    const tools = status === 'zgloszony' && allowed('potwierdz')
      ? <>
        <Button kind="ghost" quiet small busy={busy} label={`Potwierdź obecność, ${name}`} onClick={() => send({type: 'presence_confirm', who, guest: guest || undefined, accept: true})}>Potwierdź obecność</Button>
        {allowed('odrzuc') && <Button kind="ghost" quiet small busy={busy} label={`Odrzuć zgłoszenie, ${name}`} onClick={() => send({type: 'presence_confirm', who, guest: guest || undefined, accept: false})}>Odrzuć zgłoszenie</Button>}
      </>
      : markable && <Button kind="ghost" quiet small busy={busy} label={`${action}, ${name}`}
        onClick={() => send({type: 'presence', who, guest: guest || undefined, present: !present})}>{action}</Button>;
    return <li key={who} class={'att-' + (status ?? 'nieobecny')}>
      {/* Wersja 4 (B3-38): zdjęcie 40 px z pamięci przeglądarki, imię obok (alt=""). */}
      <Avatar personKey={who} name={name} size={40} class="att-avatar"/>
      <span class="att-name"><strong>{name}</strong><small>{line(label, status, who, guest)}</small></span>
      <span class="att-side"><StateChip state={presenceChip(status)}/>{tools}</span>
    </li>;
  };
  // Twarda spacja po „i” łączy spójnik z następnym imieniem i nazwiskiem.
  const names = (list: typeof members) => list.map((ms, i) => <Fragment key={ms.personId}>{i === 0 ? '' : i === list.length - 1 ? ' i\u00a0' : ', '}<span class="oi-nowrap">{s.personName(ms.personId)}</span></Fragment>);
  return <section class="oi-card attendance-card">
    <CardTitle level={2}>Lista obecności</CardTitle>
    {/* Imię i nazwisko nie łamie się między wierszami. */}
    <p class="attendance-summary">Obecnych {members.filter(ms => m.attendance[ms.personId] === 'obecny').length} z {members.length}.
      {reported.length > 0 && <> Na potwierdzenie {plural(reported.length, 'czeka', 'czekają', 'czeka')} {names(reported)}.</>}
      {away.length > 0 && <> Poza posiedzeniem {names(away)}.</>}</p>
    {voting && (presiding || office) && <p class="muted small">{office ? 'Wyjście w trakcie głosowania zapisuje osoba prowadząca obrady.' : 'Wyjście osoby bez głosu zapiszesz w karcie głosowania przyciskiem „Oznacz nieobecność”.'}</p>}
    {/* Powyżej 760 px ten sam przycisk stoi obok w karcie „Czeka na Twoją decyzję”, więc tu go nie ma (att-confirm-all). */}
    {(presiding || office) && pending.length > 0 && <div class="att-confirm-all"><Button small busy={busy} onClick={() => send({type: 'presence_confirm_all'})}>{`Potwierdź wszystkie zgłoszenia (${pending.length})`}</Button></div>}
    <ul class="attendance">{members.map(ms => row(ms.personId, s.personName(ms.personId), ms.label, m.attendance[ms.personId], false))}</ul>
    {m.invited.length > 0 && <>
      <h3 class="card-sub">Głos doradczy i goście</h3>
      <ul class="attendance">{m.invited.map(gid => { const g = people.find(x => x.id === gid); return row(gid, g?.displayName ?? 'Zaproszona osoba', g?.label ?? '', m.guests[gid], true); })}</ul>
    </>}
  </section>;
}

// Prowadzenie obrad: lista tylko wybiera osobę, a przekazanie wymaga potwierdzenia. Fakt „Zastępstwo przewodniczącego”
// z linią wyznaczenia (O-03 pkt 4); przewodniczący, który prowadzi, zmienia zastępstwo w tej sekcji.
function Chairing({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const mm = m as unknown as Meeting;
  // Przekazanie przyjmuje osobę obecną albo ze zgłoszoną obecnością (przekazanie potwierdza jej obecność, rozdz. 4.5).
  const candidates = organRoster(s.roster, m).filter(ms => canChairPerson(s.roster, mm, ms.personId) && ms.personId !== m.chair.current && (m.attendance[ms.personId] === 'obecny' || m.attendance[ms.personId] === 'zgloszony'));
  const [to, setTo] = useState(candidates[0]?.personId ?? '');
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!candidates.some(c => c.personId === to)) setTo(candidates[0]?.personId ?? ''); }, [candidates.map(c => c.personId).join()]);
  const target = candidates.find(c => c.personId === to);
  const chairman = isChairmanOf(s.roster, mm, s.personId);
  const changes = !readOnly && canDesignateDeputy(s.roster, mm, actorOf(s));
  const deputy = deputyOf(s.roster, mm);
  return <Fold title="Prowadzenie obrad">
    <div class="stack">
      {/* Wersja 4 (B3-38): zdjęcie osoby prowadzącej i zastępcy 48 px. */}
      <div class="chairing-who">{m.chair.current && <Avatar personKey={m.chair.current} name={s.personName(m.chair.current)} size={48}/>}
        <dl class="facts"><Fact label="Prowadzi">{chairingText(s.roster, m) || s.personName(m.chair.current)}</Fact></dl></div>
      <div class="chairing-who">{deputy && deputy !== m.chair.current && <Avatar personKey={deputy} name={s.personName(deputy)} size={48}/>}<DeputyFact change={changes}/></div>
      {!readOnly && candidates.length > 0 && <>
        <Field label="Komu przekazać prowadzenie?"><select value={to} onChange={e => setTo((e.target as HTMLSelectElement).value)}>
          {candidates.map(c => <option key={c.personId} value={c.personId}>{s.personName(c.personId)}, {c.label}{m.attendance[c.personId] === 'zgloszony' ? ', obecność zgłoszona' : ''}</option>)}
        </select></Field>
        <div><Button small haspopup busy={busy} onClick={() => setAsking(true)}>Przekaż prowadzenie</Button></div>
      </>}
      {!readOnly && !candidates.length && <p class="muted small">Teraz nie ma obecnej osoby, której można przekazać prowadzenie <Ref>(§ 9 ust. 1).</Ref></p>}
      {readOnly && <p class="muted small">Widok biura obejmuje obecność i notatki. Czynności formalne wykonuje osoba prowadząca obrady.</p>}
      {chairRank(s.roster, mm, s.personId) !== null && m.chair.current !== s.personId && <p class="muted small">Prowadzenie przejmiesz w widoku uczestnika.</p>}
    </div>
    {asking && target && <Confirm title="Przekazać prowadzenie obrad?" confirm="Przekaż prowadzenie" focus="cancel" onClose={() => setAsking(false)}
      onConfirm={() => send({type: 'chair_handover', personId: target.personId})}
      text={<p>Obrady poprowadzi {s.personName(target.personId)}, {target.label}.{m.attendance[target.personId] === 'zgloszony' ? ' Obecność tej osoby zostanie zapisana razem z przekazaniem.' : ''} Panel prowadzenia obrad przejdzie do tej osoby, a Ty zobaczysz widok uczestnika.{chairman ? ' Prowadzenie możesz przejąć z powrotem w widoku uczestnika.' : ''}</p>}/>}
  </Fold>;
}

// Przebieg obrad w panelu z filtrami (O-07, dodatek): „Wszystko”, „Głosowania”, „Porządek”, „Obecność”, „Odstępstwa”.
function Log() {
  const [filter, setFilter] = useState<LogFilter>('wszystko');
  const nameOf = usePresenceName();
  return <Fold title="Przebieg obrad">
    <div class="log-filters"><Segments label="Pokaż wpisy" value={filter} options={LOG_FILTERS} onChange={setFilter}/></div>
    <LogList filter={filter} presenceName={nameOf}/>
  </Fold>;
}
