import {Fragment, type ComponentChildren} from 'preact';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {canChairOrgan, isChairman} from '../shared/meeting.ts';
import {awaitingVote, choiceLabel, itemNumber, itemVoted, materialTypeOf, needsVote, orderedAgenda, presentMembers, quorumFor, reasumptionSignaturesNeeded, resolutionSubject, resultLabel, unhandledItems} from '../shared/rules.ts';
import {organMembers, organOf} from '../shared/roster.ts';
import type {AgendaChange, AgendaItem, BallotPurpose, Meeting, Message, Motion, Presence, Roster, VoteMode} from '../shared/types.ts';
import {request, serverNow} from './api.ts';
import {useMeeting, type ViewBallot, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Confirm, Countdown, Fact, Field, Fold, fmtTime, Modal, Notice, plural, SaveStatus, StateChip, Tag, TitleLead, useSaveStatus} from './ui.tsx';
import {agendaChip, itemChip, modeGenitive, modeName, presenceChip} from './stany.ts';
import {AgendaList, beforeAdoption, emphasize, VoteCard} from './meeting.tsx';
import {AgendaEditor} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';

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

/**
 * Formuła zamknięcia posiedzenia do odczytania (T3.46). „Wobec wyczerpania porządku obrad” tylko wtedy, gdy nie ma
 * punktów nierozpatrzonych. Inaczej samo zamknięcie, a punkty nierozpoczęte są wymienione z numerem.
 */
function closingSpeech(m: ViewMeeting, organ: string) {
  const unhandled = unhandledItems(m);
  if (!unhandled.length) return `Wobec wyczerpania porządku obrad zamykam posiedzenie ${organ}.`;
  const skipped = unhandled.filter(it => it.status === 'oczekuje').map(it => itemNumber(m.agenda, it.id));
  const note = skipped.length === 1 ? ` Punkt ${skipped[0]} nie został rozpatrzony.`
    : skipped.length > 1 ? ` Punkty ${joinNames(skipped)} nie zostały rozpatrzone.` : '';
  return `Zamykam posiedzenie ${organ}.${note}`;
}

/** Następny punkt do rozpoczęcia po bieżącym (punkt „Podjęcie uchwał” z podpunktami prowadzi do pierwszego podpunktu). */
function nextItem(m: ViewMeeting, it: AgendaItem) {
  const order = orderedAgenda(m.agenda);
  return order.slice(order.indexOf(it) + 1).find(i => i.status === 'oczekuje' && (m.agendaAdopted || beforeAdoption(m, i)) && !(i.kind === 'uchwaly' && order.some(c => c.parentId === i.id)));
}
/** Pierwszy wcześniejszy punkt, którego jeszcze nie rozpoczęto (bez zamknięcia i punktów głównych z podpunktami). */
function missedBefore(m: ViewMeeting, target: AgendaItem) {
  const order = orderedAgenda(m.agenda);
  const at = order.indexOf(target);
  return unhandledItems(m).find(i => i.status === 'oczekuje' && i.id !== target.id && order.indexOf(i) < at);
}
/**
 * Zmiana kolejności, którą można poddać pod głosowanie (istniejące polecenie agenda_change z op „przesun”):
 * punkt przed pominięty punkt, gdy mają tego samego rodzica, a inaczej cały punkt główny przed punkt główny,
 * jeśli ten nie jest jeszcze rozpoczęty.
 */
function reorderFor(m: ViewMeeting, target: AgendaItem, missed: AgendaItem): AgendaChange | null {
  if (target.parentId === missed.parentId) return {op: 'przesun', itemId: target.id, beforeId: missed.id};
  const top = (it: AgendaItem) => it.parentId ? m.agenda.find(i => i.id === it.parentId) : it;
  const from = top(target), before = top(missed);
  if (!from || !before || from.id === before.id || before.status !== 'oczekuje') return null;
  return {op: 'przesun', itemId: from.id, beforeId: before.id};
}

/** Co pokazuje ekran sali (ta sama kolejność co w screen.tsx) i czy można wrócić do bieżącego punktu. */
function screenShows(m: ViewMeeting): {text: string; other: boolean; item?: string; material?: string} {
  const shown = m.presentation;
  const current = m.agenda.find(i => i.id === m.currentItemId);
  if (m.status === 'przerwa') return {text: 'przerwę w obradach', other: false};
  if (m.ballots.some(b => b.status === 'otwarte')) return {text: 'trwające głosowanie', other: false};
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : undefined;
  if (result) return {text: `wynik głosowania nr ${result.number}, także na telefonach`, other: true};
  const material = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : undefined;
  if (material) return {text: `materiał „${material.title}”, także na telefonach`, other: true, material: material.id};
  const point = shown?.kind === 'punkt' ? m.agenda.find(i => i.id === shown.id) : undefined;
  if (point && point.id !== current?.id) return {text: `punkt ${itemNumber(m.agenda, point.id)}`, other: true, item: point.id};
  if (current) return {text: `bieżący punkt ${itemNumber(m.agenda, current.id)}`, other: false, item: current.id};
  return {text: 'tytuł posiedzenia', other: false};
}

// Sprawy w karcie „Czeka na Twoją decyzję”: kworum po przerwie, nieogłoszone wyniki, wnioski o reasumpcję i nowe wiadomości.
type Decision =
  | {kind: 'kworum'; key: string}
  | {kind: 'wynik'; key: string; b: ViewBallot}
  | {kind: 'wniosek'; key: string; x: Motion; b?: ViewBallot}
  | {kind: 'wiadomosci'; key: string; unread: Message[]};
const actionable = (d: Decision) => d.kind === 'kworum' || d.kind === 'wynik' || (d.kind === 'wniosek' && d.x.status !== 'zbiera_podpisy');

function decisionsFor(m: ViewMeeting, unread: Message[]): Decision[] {
  const rows: Decision[] = [];
  const lastBreak = [...m.log].reverse().find(l => l.text === 'Przerwa w obradach.');
  const lastQuorum = m.quorumChecks.at(-1);
  if (m.status === 'trwa' && lastBreak && (!lastQuorum || lastQuorum.at < lastBreak.at)) rows.push({kind: 'kworum', key: 'kworum'});
  for (const b of m.ballots.filter(x => x.status === 'zamkniete' && !x.announcedAt).sort((x, y) => x.number - y.number)) rows.push({kind: 'wynik', key: b.id, b});
  for (const x of m.motions.filter(y => y.status === 'zlozony' || y.status === 'zbiera_podpisy' || (y.status === 'przyjety' && !y.repeatBallotId))) rows.push({kind: 'wniosek', key: x.id, x, b: m.ballots.find(y => y.id === x.ballotId)});
  if (unread.length) rows.push({kind: 'wiadomosci', key: 'wiadomosci', unread});
  return rows;
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
  const {m} = useMeeting();
  const s = useSession();
  const [selected, setSelected] = useState<string | null>(m.currentItemId ?? m.agenda[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('punkt');
  const [messagesOpen, setMessagesOpen] = useState(false);
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
  const unread = useUnread(m, s.account.id, messagesOpen);
  const decisions = readOnly ? [] : decisionsFor(m, unread);
  const open = m.ballots.find(b => b.status === 'otwarte');
  // Po otwarciu głosowania przycisk, który je otworzył, znika razem z rozwiniętą kartą punktu. Panel głosowania
  // przewija się wtedy pod pasek posiedzenia, a fokus przechodzi na jego nagłówek (chyba że fokus jest w innej kolumnie).
  const seen = useRef<string | undefined | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = open?.id;
    if (readOnly || before === null || !open || before === open.id) return;
    const active = document.activeElement;
    const elsewhere = !!active && active !== document.body && active.isConnected && !active.closest('.chair-main');
    if (elsewhere || document.querySelector('dialog[open]')) return;
    setTab('punkt');
    window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('.live-ballot');
      panel?.scrollIntoView({block: 'start'});
      panel?.querySelector<HTMLElement>('.vote-subject')?.focus({preventScroll: true});
    });
  }, [open?.id]);
  const focus = decisions.length ? 'decyzja' : open ? 'glosowanie' : 'punkt';
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
  const counts: Record<Tab, number> = {porzadek: unhandledItems(m).length, punkt: decisions.filter(actionable).length, obrady: unread.length};
  return <div class="chair">
    <nav class="oi-seg chair-tabs" aria-label="Część panelu" ref={tabs}>
      {([['porzadek', 'Porządek'], ['punkt', 'Punkt'], ['obrady', 'Obrady']] as [Tab, string][]).map(([id, label]) =>
        <button key={id} type="button" class="oi-opt" aria-pressed={tab === id} onClick={() => setTab(id)}>
          {label}{counts[id] > 0 && <> ({counts[id]})<span class="sr-only">{tabHint(id, counts[id])}</span></>}
        </button>)}
    </nav>
    <aside class={'chair-col chair-left' + (tab === 'porzadek' ? ' is-shown' : '')} aria-label="Porządek obrad">
      <section class="oi-card chair-agenda" ref={agendaCard}>
        <div class="panel-head"><CardTitle level={2}>Porządek obrad</CardTitle><StateChip state={agendaChip(m.agendaAdopted)}/></div>
        <AgendaList selected={selected} onSelect={choose}/>
        {!readOnly && !m.agendaAdopted && <AgendaFixes/>}
        {!readOnly && m.agendaAdopted && <AgendaChange/>}
      </section>
    </aside>
    <section class={'chair-col chair-main' + (tab === 'punkt' ? ' is-shown' : '')} aria-label="Punkt">
      {m.status === 'przerwa' && <Notice tone="warn">Trwa przerwa w obradach. Głosowania są wstrzymane.</Notice>}
      {decisions.length > 0 && <DecisionCard rows={decisions} teraz={focus === 'decyzja'} onMessages={showMessages}/>}
      {open && <LiveBallot b={open} readOnly={readOnly} teraz={focus === 'glosowanie'}/>}
      {selected && <ItemCard key={selected} itemId={selected} readOnly={readOnly} main={waiting ? 'secondary' : 'primary'} teraz={focus === 'punkt'}/>}
    </section>
    <aside class={'chair-col chair-right' + (tab === 'obrady' ? ' is-shown' : '')} aria-label="Obrady">
      <MeetingControls readOnly={readOnly}/>
      <Attendance/>
      <Chairing readOnly={readOnly}/>
      <Fold title="Wiadomości" count={m.messages.length || undefined} id={MESSAGES} open={messagesOpen}
        onToggle={on => { setMessagesOpen(on); if (on) window.setTimeout(scrollMessages, 0); }}><Messages bare/></Fold>
      <Log/>
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

function DecisionCard(props: {rows: Decision[]; teraz: boolean; onMessages: () => void}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const id = useId();
  const open = m.ballots.find(b => b.status === 'otwarte');
  const present = presentMembers(m as Meeting, s.roster);
  const needed = reasumptionSignaturesNeeded(present.length);
  // Pierwszy przycisk w karcie jest główny, kolejne mają obrys. W trakcie głosowania przyciski czekają na jego koniec.
  let first = true;
  const kind = (): Main => { const k = first ? 'primary' : 'secondary'; first = false; return k; };
  const action = (label: string, run: () => void) => open ? null : <div><Button kind={kind()} busy={busy} onClick={run}>{label}</Button></div>;
  return <section class={'oi-card decisions' + (props.teraz ? ' is-teraz' : '')} aria-labelledby={id}>
    <h2 class="oi-card__title" id={id}><span class="oi-mark" aria-hidden="true"/><span>Czeka na Twoją decyzję</span></h2>
    {props.rows.map(row => {
      if (row.kind === 'kworum') return <div class="decision" key={row.key}>
        <p>Po przerwie stwierdź kworum.</p>
        {action('Stwierdzam kworum', () => send({type: 'quorum'}))}
      </div>;
      if (row.kind === 'wynik') return <div class="decision" key={row.key}>
        <p>Wynik głosowania nr {row.b.number} nie został ogłoszony.</p>
        {!open && <div class="decision-act">
          <Button kind={kind()} busy={busy} onClick={() => send({type: 'announce', ballotId: row.b.id})}>Ogłoś wynik głosowania nr {row.b.number}</Button>
          <span class="muted small">Ogłoszenie pokaże wynik na telefonach i ekranie sali.</span>
        </div>}
        <ReadAloud><p>{resultSpeech(m, row.b)}</p></ReadAloud>
      </div>;
      if (row.kind === 'wniosek') {
        const no = row.b?.number;
        if (row.x.status === 'zbiera_podpisy') {
          const valid = row.x.signatures.filter(p => present.includes(p)).length;
          return <div class="decision" key={row.key}><p>Wniosek o reasumpcję głosowania nr {no} zbiera podpisy, {valid} z {needed}.</p></div>;
        }
        if (row.x.status === 'zlozony') return <div class="decision" key={row.key}>
          <p>Wniosek o reasumpcję głosowania nr {no} ma wymagane podpisy. O reasumpcji rozstrzyga Prezydium.</p>
          {action('Poddaj wniosek pod głosowanie Prezydium', () => send({type: 'motion_vote', motionId: row.x.id, minutes: 2}))}
        </div>;
        return <div class="decision" key={row.key}>
          <p>Prezydium przyjęło wniosek o reasumpcję głosowania nr {no}.</p>
          {action('Przeprowadź ponowne głosowanie', () => send({type: 'reasumption_open', motionId: row.x.id, minutes: 2}))}
        </div>;
      }
      const last = row.unread[row.unread.length - 1];
      return <div class="decision" key={row.key}>
        <dl class="facts"><Fact label={row.unread.length === 1 ? 'Nowa wiadomość' : `Nowe wiadomości (${row.unread.length})`}>{last.authorName}, godz. {fmtTime(last.at)}</Fact></dl>
        <div><Button kind="ghost" small onClick={props.onMessages}>Pokaż wiadomości</Button></div>
      </div>;
    })}
    {open && props.rows.some(actionable) && <p class="muted small">Dostępne po zakończeniu głosowania nr {open.number}.</p>}
  </section>;
}

// Trwające głosowanie: jeden panel z faktami, postępem, głosem prowadzącego i listą osób bez głosu.
function LiveBallot({b, readOnly, teraz}: {b: ViewBallot; readOnly: boolean; teraz: boolean}) {
  const {send} = useMeeting();
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
  // Oznaczenie ostatniej osoby bez głosu kończy głosowanie od razu, chyba że w drodze są jeszcze głosy z pobranych kart.
  const lastOne = awaiting.length === 1 && inFlight === 0;
  const names = awaiting.map(p => s.personName(p));
  const n = awaiting.length;
  const endText = n === 1 ? `Bez głosu jest jeszcze 1 osoba (${names[0]}). Jeśli zakończysz głosowanie teraz, ten głos nie zostanie policzony.`
    : n > 1 ? `Bez głosu ${plural(n, 'jest', 'są', 'jest')} jeszcze ${n} ${plural(n, 'osoba', 'osoby', 'osób')} (${names.join(', ')}). Jeśli zakończysz głosowanie teraz, te głosy nie zostaną policzone.`
    : inFlight > 0 ? `Pobrano kart ${issued}, a dotarło głosów ${b.secret!.cast}. ${inFlight === 1 ? 'Brakujący głos może być jeszcze w drodze. Zaczekaj kilka sekund. Jeśli zakończysz głosowanie teraz, ten głos nie zostanie policzony.' : 'Brakujące głosy mogą być jeszcze w drodze. Zaczekaj kilka sekund. Jeśli zakończysz głosowanie teraz, te głosy nie zostaną policzone.'}`
    : 'Zagłosowali wszyscy uprawnieni.';
  const lastNote = <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>To ostatnia osoba bez głosu. Głosowanie zakończy się od razu.</p></div>;
  return <section class={'oi-card live-ballot vote-card' + (teraz ? ' is-teraz' : '')} aria-labelledby={id}>
    <div class="oi-btns"><Tag>Trwa głosowanie nr {b.number}</Tag><Tag dark>{modeName(b.mode)}{b.reasumptionOf ? ', reasumpcja' : ''}</Tag></div>
    <h2 class="vote-subject" id={id} tabIndex={-1}><TitleLead text={b.subject}/></h2>
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
          {!readOnly && <Button kind="ghost" quiet small haspopup label={`Oznacz nieobecność, ${names[i]}`} onClick={() => setAbsent({who: p, at: serverNow()})}>Oznacz nieobecność</Button>}</li>)}</ul>
      </> : <p>Zagłosowali wszyscy obecni.</p>}
    </div>
    <div class="live-foot">
      <dl class="facts"><Fact label="Uprawnionych">{b.eligible.length}</Fact><Fact label="Wymagane kworum">{b.quorum}</Fact>{b.modeBasis && <Fact label="Podstawa trybu">{b.modeBasis}</Fact>}</dl>
      {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Głosowanie tajne. Widać tylko, kto pobrał kartę. Ten sam odcisk członkowie widzą na telefonach i na ekranie sali.</span></div>}
      {!readOnly && <div><Button small haspopup onClick={() => setClosing(true)}>Zakończ głosowanie teraz</Button></div>}
    </div>
    {closing && <Confirm title="Zakończyć głosowanie?" kind="danger" confirm="Zakończ głosowanie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'ballot_close', ballotId: b.id})}
      text={<p>{endText} Głosowanie zwykle kończy się samo, gdy zagłosują wszyscy uprawnieni albo upłynie czas.</p>}/>}
    {absent && <Confirm title="Oznaczyć nieobecność?" kind="danger" confirm="Oznacz nieobecność" onClose={() => setAbsent(null)}
      onConfirm={() => send({type: 'ballot_absent', ballotId: b.id, personId: absent.who})}
      text={<p>Wyjście z posiedzenia zostanie zapisane przy nazwisku {s.personName(absent.who)}, z godziną {fmtTime(absent.at)}. Głosowanie nr {b.number} nie będzie czekać na głos tej osoby.</p>}
      details={lastOne && awaiting[0] === absent.who ? lastNote : undefined}/>}
  </section>;
}

// Karta punktu: nagłówek, jedno działanie główne zależne od stanu, działania poboczne, wyniki i notatka.
function ItemCard({itemId, readOnly, main, teraz}: {itemId: string; readOnly: boolean; main: Main; teraz: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const id = useId();
  const [ending, setEnding] = useState<'odroczony' | 'wycofany' | null>(null);
  const [reorder, setReorder] = useState<AgendaItem | null>(null);
  const it = m.agenda.find(i => i.id === itemId);
  if (!it) return null;
  const no = itemNumber(m.agenda, it.id);
  const open = m.ballots.find(b => b.status === 'otwarte');
  // W trakcie głosowania karta punktu zwija się do jednego wiersza, a niedostępne przyciski znikają.
  if (open && !readOnly) return <section class="oi-card item-work is-zwiniete" aria-labelledby={id}>
    <h2 class="item-title item-title--wiersz" id={id} tabIndex={-1}>Punkt {no}. {it.title}</h2>
    <p class="muted small">Dostępne po zakończeniu głosowania nr {open.number}.</p>
  </section>;
  const current = m.currentItemId === it.id;
  const locked = !m.agendaAdopted && !beforeAdoption(m, it);
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const others = m.materials.filter(x => !it.materialIds.includes(x.id));
  const results = m.ballots.filter(b => b.status === 'zamkniete' && (b.itemId === it.id || (b.target?.kind === 'tryb' && b.target.itemId === it.id))).sort((x, y) => x.number - y.number);
  const screen = screenShows(m);
  // Porządek obrad wymaga głosowania, dopóki nie zostanie przyjęty (także po nieprzyjęciu w głosowaniu).
  const voteNeeded = current && needsVote(m, it) && (it.kind === 'porzadek' || !itemVoted(m, it));
  const closing = it.kind === 'zamkniecie';
  const organizer = s.isOrganizer(m.organ);
  const start = () => {
    const missed = m.agendaAdopted && it.status === 'oczekuje' && !closing ? missedBefore(m, it) : undefined;
    if (missed) setReorder(missed);
    else send({type: 'item_start', itemId: it.id});
  };
  const change = reorder ? reorderFor(m, it, reorder) : null;
  const organ = organName(m, s.roster);
  const members = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length;
  return <section class={'oi-card item-work' + (teraz && current ? ' is-teraz' : '')} aria-labelledby={id}>
    <div class="panel-head">
      {current ? <span class="oi-label">Punkt {no}</span> : <span class="kicker">Punkt {no}</span>}
      <StateChip state={itemChip(it, current)}/>
    </div>
    <h2 class="item-title" id={id} tabIndex={-1}><TitleLead text={it.title}/></h2>
    {locked && <Notice>Ten punkt można rozpocząć po przyjęciu porządku obrad.</Notice>}
    {!readOnly && !current && !locked && it.status !== 'wycofany' && <div><Button kind={it.status === 'zakonczony' ? 'secondary' : main} busy={busy} haspopup={m.agendaAdopted && it.status === 'oczekuje' && !closing && !!missedBefore(m, it)} onClick={start}>Rozpocznij ten punkt</Button></div>}
    {materials.length > 0 && <div class="material-row">
      <h3 class="card-sub">Materiały</h3>
      {materials.map(x => <div class="stack-tight" key={x.id}>
        <MaterialLink id={x.id} version={x.version} label={x.title} meta={`wersja ${x.version}`}/>
        {!readOnly && screen.material !== x.id && <div><Button kind="ghost" quiet small busy={busy} label={`Pokaż materiał na sali i telefonach, ${x.title}`} onClick={() => send({type: 'present', kind: 'material', id: x.id})}>Pokaż materiał na sali i telefonach</Button></div>}
      </div>)}
    </div>}
    {/* Działania poboczne tego punktu stoją przy jego treści, przed głosowaniem i blokiem „Następny punkt”. */}
    {!readOnly && <div class="item-side">
      {screen.item !== it.id && <Button small busy={busy} onClick={() => send({type: 'present', kind: 'punkt', id: it.id})}>Pokaż na ekranie sali</Button>}
      {(current || it.status === 'w_toku') && !['otwarcie', 'porzadek', 'zamkniecie'].includes(it.kind) && <Button kind="ghost" quiet small haspopup onClick={() => setEnding('odroczony')}>Odrocz</Button>}
      {it.status === 'oczekuje' && it.kind === 'sprawa' && <Button kind="ghost" quiet small haspopup onClick={() => setEnding('wycofany')}>Wycofaj</Button>}
    </div>}
    {!readOnly && current && it.kind === 'otwarcie' && <Quorum main={main}/>}
    {!readOnly && current && <BallotForm it={it} main={voteNeeded ? main : 'secondary'}/>}
    {results.length > 0 && <div class="results">
      <h3 class="card-sub">Głosowania w tym punkcie</h3>
      {results.map(b => <ResultLine key={b.id} b={b}/>)}
    </div>}
    {!readOnly && current && it.kind === 'otwarcie' && <ReadAloud><p>{present >= quorumFor(members)
      ? `Otwieram posiedzenie ${organ}. Stwierdzam, że w posiedzeniu uczestniczy ${present} z ${members} członków Prezydium, co stanowi kworum wymagane do podejmowania uchwał.`
      : `Otwieram posiedzenie ${organ}. Stwierdzam, że w posiedzeniu uczestniczy ${present} z ${members} członków Prezydium. Wobec braku kworum Prezydium nie może podejmować uchwał.`}</p></ReadAloud>}
    {!readOnly && current && closing && <ReadAloud><p>{closingSpeech(m, organ)}</p></ReadAloud>}
    {(organizer || !readOnly) && others.length > 0 && !closing && <AssignMaterial it={it} others={others}/>}
    {!readOnly && current && <NextStep it={it} main={main} voteNeeded={voteNeeded}/>}
    <NoteEditor it={it} open={readOnly}/>
    {ending && <Confirm title={ending === 'odroczony' ? 'Odroczyć punkt?' : 'Wycofać punkt?'} confirm={ending === 'odroczony' ? 'Odrocz punkt' : 'Wycofaj punkt'}
      kind={ending === 'odroczony' ? 'primary' : 'danger'} focus="cancel" onClose={() => setEnding(null)}
      onConfirm={() => send({type: 'item_end', itemId: it.id, status: ending})}
      text={<p>{ending === 'odroczony' ? 'Punkt pozostanie w porządku obrad z oznaczeniem „odroczony”. Można go później podjąć ponownie.' : 'Punkt zostanie oznaczony jako wycofany i nie będzie rozpatrywany.'}</p>}/>}
    {reorder && <Modal title="Zmienić kolejność rozpatrywania?" onClose={() => setReorder(null)} closeButton={false} confirm initialFocus=".confirm-cancel">
      <div class="confirm-text"><p>Punkt {itemNumber(m.agenda, reorder.id)} „{reorder.title}” nie był jeszcze rozpatrywany. Rozpoczęcie punktu {no} zmienia kolejność przyjętego porządku obrad.{change ? ' Zmianę kolejności można poddać pod głosowanie.' : ''}</p></div>
      <div class="actions confirm-actions">
        {change && <Button kind="primary" class="confirm-ok" onClick={() => { setReorder(null); send({type: 'agenda_change', change, minutes: 2}); }}>Poddaj zmianę kolejności pod głosowanie</Button>}
        <Button class={change ? undefined : 'confirm-ok'} onClick={() => { setReorder(null); send({type: 'item_start', itemId: it.id}); }}>Rozpocznij bez głosowania</Button>
        <Button class="confirm-cancel" onClick={() => setReorder(null)}>Anuluj</Button>
      </div>
    </Modal>}
  </section>;
}

// Następny krok w bieżącym punkcie: przejście dalej, powrót do pominiętego punktu, zakończenie albo zamknięcie posiedzenia.
function NextStep({it, main, voteNeeded}: {it: AgendaItem; main: Main; voteNeeded: boolean}) {
  const {m, send, busy} = useMeeting();
  const [ask, setAsk] = useState<'kworum' | 'bez-glosowania' | 'koniec' | 'zamkniecie' | null>(null);
  const no = itemNumber(m.agenda, it.id);
  if (it.kind === 'zamkniecie') return <div class="next-step">
    <div><Button kind={main} haspopup onClick={() => setAsk('zamkniecie')}>Zamknij posiedzenie</Button></div>
    {ask === 'zamkniecie' && <CloseDialog onClose={() => setAsk(null)}/>}
  </div>;
  const next = nextItem(m, it);
  const subject = m.materials.find(x => it.materialIds.includes(x.id))?.title ?? it.title;
  if (!next) {
    if (it.status !== 'w_toku' || (it.kind === 'porzadek' && !m.agendaAdopted)) return null;
    return <div class="next-step">
      <div><Button haspopup={voteNeeded} busy={busy} onClick={() => voteNeeded ? setAsk('koniec') : send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}>Zakończ punkt</Button></div>
      {ask === 'koniec' && <Confirm title="Zakończyć punkt bez głosowania?" confirm="Zakończ punkt" focus="cancel" onClose={() => setAsk(null)}
        onConfirm={() => send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}
        text={<p>W tym punkcie nie głosowano nad „{subject}”. Punkt zostanie zapisany jako zakończony bez głosowania.</p>}/>}
    </div>;
  }
  const nextNo = itemNumber(m.agenda, next.id);
  const noQuorum = it.kind === 'otwarcie' && !m.quorumChecks.length;
  const missed = !voteNeeded && next.kind === 'zamkniecie' ? missedBefore(m, next) : undefined;
  const go = () => noQuorum ? setAsk('kworum') : voteNeeded ? setAsk('bez-glosowania') : send({type: 'item_start', itemId: next.id});
  return <div class="next-step">
    <span class="kicker">Następny punkt</span>
    {voteNeeded && <p class="small">W tym punkcie nie przeprowadzono jeszcze głosowania.</p>}
    {missed && <>
      <p class="small">Punkt {itemNumber(m.agenda, missed.id)} nie był rozpatrywany.</p>
      <div><Button kind={main} busy={busy} onClick={() => send({type: 'item_start', itemId: missed.id})}>Wróć do punktu {itemNumber(m.agenda, missed.id)}</Button></div>
    </>}
    <div><Button kind={voteNeeded || noQuorum || missed ? 'secondary' : main} busy={busy} haspopup={noQuorum || voteNeeded} onClick={go}>Przejdź do punktu {nextNo}</Button></div>
    <span class="small muted">{next.title}</span>
    {ask === 'kworum' && <Confirm title="Przejść dalej bez stwierdzenia kworum?" confirm="Przejdź bez stwierdzenia kworum" focus="cancel" onClose={() => setAsk(null)}
      onConfirm={() => send({type: 'item_start', itemId: next.id})}
      text={<p>Kworum nie zostało stwierdzone. Projekt protokołu nie będzie zawierał stwierdzenia kworum.</p>}/>}
    {ask === 'bez-glosowania' && <Confirm title="Przejść dalej bez głosowania?" confirm="Przejdź bez głosowania" cancel="Wróć do punktu" focus="cancel" onClose={() => setAsk(null)}
      onConfirm={() => send({type: 'item_start', itemId: next.id})}
      text={<p>W punkcie {no} nie przeprowadzono głosowania. Punkt zostanie zapisany jako zakończony bez głosowania.</p>}/>}
  </div>;
}

/** Zwięzły wynik głosowania w karcie punktu. */
function ResultLine({b}: {b: ViewBallot}) {
  const {m} = useMeeting();
  const s = useSession();
  const r = b.result;
  if (!r) return null;
  const replaced = b.supersededBy ? m.ballots.find(x => x.id === b.supersededBy) : undefined;
  return <div class="result-line">
    <span class="kicker">Wynik głosowania {modeGenitive(b.mode)} nr {b.number}{b.reasumptionOf ? ' po reasumpcji' : ''}</span>
    <p class="result-line__subject">{b.subject}</p>
    <p class="result-line__verdict">{emphasize(resultLabel(b, materialTypeOf(m, b)))}</p>
    <p class="result-line__counts">Za {r.za}, przeciw {r.przeciw}, wstrzymało się {r.wstrzymuje}.</p>
    {b.mode === 'imienne' && Object.keys(b.votes).length > 0 && <Fold title="Wykaz imienny">
      <ul class="named">{b.eligible.map(p => <li key={p}><span>{s.personName(p)}</span><strong>{b.votes[p] ? choiceLabel[b.votes[p]] : 'brak głosu'}</strong></li>)}</ul>
    </Fold>}
    {replaced && <p class="muted small">Wynik zastąpiony wynikiem reasumpcji w głosowaniu nr {replaced.number}.</p>}
  </div>;
}

function Quorum({main}: {main: Main}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length, required = quorumFor(total);
  const last = m.quorumChecks.at(-1);
  const ok = present >= required;
  // Dopóki kworum nie zostało stwierdzone, to jest działanie główne punktu otwarcia.
  const kind: Main = m.quorumChecks.length ? 'secondary' : main;
  return <div class={'quorum ' + (ok ? 'is-ok' : 'is-low')}>
    <dl class="facts facts--liczby"><Fact label="Obecnych">{present} <small>z {total}</small></Fact><Fact label="Wymagane kworum (§ 8 ust. 2)">{required}</Fact></dl>
    <p class="strong">{ok ? 'Jest kworum. Prezydium może podejmować uchwały.' : <>Brak kworum. Prezydium nie może podejmować uchwał <Ref>(§ 8 ust. 2).</Ref></>}</p>
    {last && <p class="muted small">{last.present >= last.required ? `Ostatnio stwierdzono o godz. ${fmtTime(last.at)}, że jest kworum.` : `Ostatnio stwierdzono o godz. ${fmtTime(last.at)} brak kworum.`}</p>}
    <div class="actions">
      {ok ? <Button kind={kind} busy={busy} onClick={() => send({type: 'quorum'})}>Stwierdzam kworum</Button>
        : <><Button kind={kind} busy={busy} onClick={() => send({type: 'quorum'})}>Zapisz brak kworum</Button>
          {m.status === 'trwa' && <Button busy={busy} onClick={() => send({type: 'break', on: true})}>Zarządź przerwę</Button>}</>}
    </div>
  </div>;
}

type Target = 'projekt' | 'wniosek' | 'inna';
type Warning = 'tryb' | 'ponownie' | 'bez-projektu';

/** Przedmiot domyślny: „Podjęcie uchwały nr …” dla uchwały, „Przyjęcie protokołu …” dla protokołu. */
function defaultSubject(it: AgendaItem, materials: ViewMeeting['materials'], materialId: string | undefined) {
  const mat = materials.find(x => x.id === materialId);
  if (it.kind === 'porzadek') return 'Przyjęcie porządku obrad';
  if (it.kind === 'protokol') return mat ? `Przyjęcie protokołu ${mat.title.replace(/^Protokół\s+/i, '')}` : 'Przyjęcie protokołu z poprzedniego posiedzenia';
  if (mat && /^Uchwała nr\s/i.test(mat.title)) return mat.title.replace(/^Uchwała nr/i, 'Podjęcie uchwały nr');
  return mat?.title ?? it.title;
}

function BallotForm({it, main}: {it: AgendaItem; main: Main}) {
  const {m, send, busy} = useMeeting();
  const ids = useId();
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const closed = m.ballots.filter(b => b.status === 'zamkniete');
  const votedOn = new Set(closed.filter(b => !b.supersededBy).map(b => b.material?.id));
  const decided = closed.filter(b => b.itemId === it.id && !b.supersededBy && b.purpose !== 'tryb' && b.purpose !== 'reasumpcja');
  const firstOpen = () => materials.find(x => !votedOn.has(x.id)) ?? materials[0];
  const [extra, setExtra] = useState(false);
  const [target, setTarget] = useState<Target>('projekt');
  const [materialId, setMaterialId] = useState(firstOpen()?.id ?? '');
  const [subject, setSubject] = useState(defaultSubject(it, materials, firstOpen()?.id));
  const [minutes, setMinutes] = useState(2);
  const [motion, setMotion] = useState<'tajne' | 'imienne' | null>(null);
  const [steps, setSteps] = useState<{mode: VoteMode; list: Warning[]} | null>(null);
  const advancing = useRef(false);
  useEffect(() => { const f = firstOpen(); setMaterialId(f?.id ?? ''); setSubject(defaultSubject(it, materials, f?.id)); setTarget('projekt'); }, [it.id, m.ballots.length, it.materialIds.length, it.mode]);
  useEffect(() => setExtra(false), [it.id]);
  if (it.kind === 'porzadek' && m.agendaAdopted) return null;
  if (!m.agendaAdopted && it.kind !== 'porzadek') return null;
  if (it.kind === 'otwarcie' || it.kind === 'zamkniecie') return null;
  if (m.ballots.some(b => b.status === 'otwarte')) return null;
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
      <div><Button kind="ghost" quiet small onClick={() => setExtra(true)}>Inne głosowanie w tym punkcie</Button></div>
    </div>;
  }
  const basePurpose: BallotPurpose = it.kind === 'porzadek' ? 'porzadek' : it.kind === 'protokol' ? 'protokol' : 'uchwala';
  const project = !extra || target === 'projekt';
  const purpose: BallotPurpose = project ? basePurpose : target;
  const chosenMaterial = project ? materialId : '';
  const fixed = it.mode;
  const unannounced = closed.filter(b => !b.announcedAt);
  const bare = purpose === 'uchwala' && !chosenMaterial && resolutionSubject.test(subject.trim());
  const repeat = agendaVote ? undefined : [...closed].reverse().find(b => b.purpose !== 'tryb' && b.purpose !== 'reasumpcja' && ((chosenMaterial && b.material?.id === chosenMaterial) || normalized(b.subject) === normalized(subject)));
  const pick = (value: Target) => {
    setTarget(value);
    if (value === 'projekt') { const f = firstOpen(); setMaterialId(f?.id ?? ''); setSubject(defaultSubject(it, materials, f?.id)); }
    else setSubject('');
  };
  const openNow = (mode: VoteMode) => send({type: 'ballot_open', itemId: it.id, purpose, subject, mode, minutes, materialId: chosenMaterial || null});
  const begin = (mode: VoteMode, first?: Warning) => {
    const list: Warning[] = first ? [first] : [];
    if (repeat) list.push('ponownie');
    if (bare) list.push('bez-projektu');
    if (list.length) setSteps({mode, list});
    else openNow(mode);
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
  const speech = `Zarządzam głosowanie ${modeName(fixed ?? 'jawne')}. Przedmiot głosowania „${said}”. Proszę o oddanie głosu na telefonach. Głosowanie potrwa ${minutes} ${plural(minutes, 'minutę', 'minuty', 'minut')}.`;
  // Enter w polu przedmiotu wysyła formularz także wtedy, gdy przycisk jest nieaktywny (przerwa, trwa czynność).
  return <form class="ballot-form" onSubmit={e => { e.preventDefault(); if (m.status === 'trwa' && !busy) begin(fixed ?? 'jawne'); }}>
    <h3 class="card-sub">{it.kind === 'porzadek' ? 'Głosowanie nad porządkiem obrad' : 'Głosowanie w tym punkcie'}</h3>
    {unannounced.length > 0 && <Notice>{unannounced.length === 1
      ? `Wynik głosowania nr ${unannounced[0].number} nie został ogłoszony. Ogłoś go przed otwarciem kolejnego głosowania.`
      : `Wyniki głosowań nr ${joinNames(unannounced.map(b => String(b.number)))} nie zostały ogłoszone. Ogłoś je przed otwarciem kolejnego głosowania.`}</Notice>}
    {extra && <div class="oi-field">
      <span class="oi-field__label" id={`${ids}-cel`}>Czego dotyczy głosowanie?</span>
      <div class="oi-seg seg-cel" role="group" aria-labelledby={`${ids}-cel`}>
        {([['projekt', 'Projekt w tym punkcie'], ['wniosek', 'Wniosek, np. poprawka'], ['inna', 'Inna sprawa']] as [Target, string][]).map(([value, label]) =>
          <button key={value} type="button" class="oi-opt" aria-pressed={target === value} onClick={() => pick(value)}>{label}</button>)}
      </div>
    </div>}
    {project && materials.length > 1 && <Field label="Nad którym materiałem?"><select value={materialId} onChange={e => { const v = (e.target as HTMLSelectElement).value; setMaterialId(v); setSubject(defaultSubject(it, materials, v)); }}>
      {materials.map(x => <option key={x.id} value={x.id}>{x.title}{votedOn.has(x.id) ? ' (już głosowano)' : ''}</option>)}
    </select></Field>}
    <Field label="Przedmiot głosowania"><input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} required maxLength={400}/></Field>
    {fixed ? <div class="mode-fixed">
      <dl class="facts"><Fact label="Tryb głosowania">{modeName(fixed)}</Fact><Fact label="Podstawa trybu">{it.modeBasis}</Fact></dl>
      <div><Button kind="ghost" quiet small haspopup onClick={() => begin('jawne', 'tryb')}>Zmień tryb</Button></div>
    </div> : <div class="oi-field">
      <span class="oi-field__label" id={`${ids}-tryb`}>Tryb</span>
      <div class="oi-seg seg-tryb" role="group" aria-labelledby={`${ids}-tryb`}>
        {(['jawne', 'imienne', 'tajne'] as VoteMode[]).map(x => x === 'jawne'
          ? <button key={x} type="button" class="oi-opt" aria-pressed="true">Jawne</button>
          : <button key={x} type="button" class="oi-opt" aria-pressed="false" aria-disabled="true" aria-describedby={`${ids}-tryb-p`}>{x === 'tajne' ? 'Tajne' : 'Imienne'}</button>)}
      </div>
      <span class="oi-field__hint" id={`${ids}-tryb-p`}>Głosowanie imienne i tajne wymaga uchwalenia przez Prezydium.</span>
    </div>}
    {!fixed && it.kind !== 'porzadek' && <p class="small muted">Prezydium może uchwalić tajność głosowania albo głosowanie imienne. Poddaj pod głosowanie <button type="button" class="link quiet" aria-haspopup="dialog" onClick={() => setMotion('tajne')}>wniosek o głosowanie tajne</button> albo <button type="button" class="link quiet" aria-haspopup="dialog" onClick={() => setMotion('imienne')}>wniosek o głosowanie imienne</button>.</p>}
    <div class="oi-field">
      <span class="oi-field__label" id={`${ids}-czas`}>Czas</span>
      <div class="oi-seg seg-czas" role="group" aria-labelledby={`${ids}-czas`}>
        {[1, 2, 3, 5, 10, 15].map(n => <button key={n} type="button" class="oi-opt" aria-pressed={minutes === n} onClick={() => setMinutes(n)}>{n} min</button>)}
      </div>
    </div>
    {bare && <Notice tone="warn">Do tego punktu nie dołączono projektu uchwały. Członkowie nie zobaczą treści, nad którą głosują.</Notice>}
    <ReadAloud>
      {/* Zdanie o zawiadomieniu tylko przy wpisanej dacie wysłania. Aplikacja nie wie, czy członkowie je otrzymali. */}
      {it.kind === 'porzadek' && <p>{m.noticeDate ? `Zawiadomienie z projektem porządku obrad wysłano ${longDate(m.noticeDate)} ` : ''}Czy są uwagi lub wnioski o zmianę projektu porządku obrad? Zarządzam głosowanie nad przyjęciem porządku obrad.</p>}
      <p>{speech}</p>
    </ReadAloud>
    <div><Button kind={main} type="submit" busy={busy} haspopup={!!repeat || bare} disabled={m.status !== 'trwa'} reason={m.status !== 'trwa' ? 'Głosowanie otworzysz po wznowieniu obrad.' : undefined}>Otwórz głosowanie</Button></div>
    {step === 'tryb' && <Confirm key="tryb" title="Zmienić uchwalony tryb głosowania?" kind="danger" confirm={`Otwórz głosowanie ${modeName(steps!.mode)}`} onConfirm={confirmStep} onClose={closeStep}
      text={<p>W tej sprawie obowiązuje głosowanie {modeName(fixed ?? '')} ({it.modeBasis}). Regulamin wymaga zachowania tego trybu.</p>}/>}
    {step === 'ponownie' && repeat && <Confirm key="ponownie" title="Ponownie głosować w tej samej sprawie?" kind="danger" confirm="Otwórz ponowne głosowanie" onConfirm={confirmStep} onClose={closeStep}
      text={<p>{chosenMaterial && repeat.material?.id === chosenMaterial ? 'Nad tym materiałem już głosowano' : 'W tej sprawie już głosowano'} (głosowanie nr {repeat.number}). Regulamin przewiduje ponowne głosowanie w tej samej sprawie tylko w trybie reasumpcji (§ 12).</p>}/>}
    {step === 'bez-projektu' && <Confirm key="bez-projektu" title="Otworzyć głosowanie bez projektu?" confirm="Otwórz głosowanie" focus="cancel" onConfirm={confirmStep} onClose={closeStep}
      text={<p>Do tego punktu nie dołączono projektu uchwały. Członkowie nie zobaczą treści, nad którą głosują.</p>}/>}
    {motion && <Confirm title={`Wniosek o głosowanie ${motion}`} confirm="Poddaj wniosek pod głosowanie" onClose={() => setMotion(null)} onConfirm={() => send({type: 'mode_motion', itemId: it.id, mode: motion, minutes: 2})}
      text={<p>Prezydium w głosowaniu jawnym, zwykłą większością głosów, zdecyduje, czy uchwalić {motion === 'tajne' ? 'tajność głosowania' : 'głosowanie imienne'} w sprawie „{it.title}”. Głosowanie potrwa 2 minuty.</p>}/>}
  </form>;
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
  return <Fold title="Notatka do protokołu" open={open}>
    <div class="note-editor">
      {conflict !== null && <Notice tone="warn">
        <p>Notatka została zmieniona na innym urządzeniu o godz. {fmtTime(conflict)}.</p>
        <div class="actions"><Button small onClick={load}>Wczytaj nową wersję</Button><Button small onClick={keep}>Zostaw moją</Button></div>
      </Notice>}
      <Field label="Treść notatki" hint="Przebieg dyskusji, wnioski i ustalenia. Notatka trafi do projektu protokołu.">
        <textarea rows={4} value={text} onInput={e => type((e.target as HTMLTextAreaElement).value)} onBlur={save}/>
      </Field>
      <SaveStatus status={saved}/>
    </div>
  </Fold>;
}

function AgendaFixes() {
  const {m} = useMeeting();
  const [open, setOpen] = useState(false);
  const voting = m.ballots.find(b => b.status === 'otwarte');
  return <div class="stack-tight">
    <p class="muted small">Przed przyjęciem porządek można poprawiać. Po nieprzyjęciu popraw go i ponownie poddaj pod głosowanie.</p>
    {voting ? <p class="muted small">Dostępne po zakończeniu głosowania nr {voting.number}.</p>
      : <div><Button small haspopup onClick={() => setOpen(true)}>Popraw porządek obrad</Button></div>}
    {open && <Modal title="Popraw porządek obrad" wide onClose={() => setOpen(false)}><AgendaEditor/></Modal>}
  </div>;
}

// Wnioski o zmianę przyjętego porządku: dodanie, przeniesienie i usunięcie punktu. Każdy otwiera głosowanie
// jawne (polecenie agenda_change), a domena wprowadza zmianę po przyjęciu wniosku.
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
  const label = (it: AgendaItem) => `${itemNumber(m.agenda, it.id)}. ${it.title}`;
  const titles = {dodaj: 'Wniosek o dodanie punktu', usun: 'Wniosek o usunięcie punktu', przesun: 'Wniosek o przeniesienie punktu'};
  return <div class="stack-tight">
    <p class="muted small">Przyjęty porządek zmienia się w głosowaniu.</p>
    {voting ? <p class="muted small">Dostępne po zakończeniu głosowania nr {voting.number}.</p> : <div class="actions agenda-change">
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
        if (await send({type: 'agenda_change', change, minutes: 2})) setMode(null);
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
        <Notice>Otworzy się głosowanie jawne na 2 minuty. Zmiana wejdzie do porządku po przyjęciu zwykłą większością głosów.</Notice>
        <div class="actions"><Button kind="primary" type="submit" busy={busy}>Poddaj pod głosowanie</Button><Button onClick={() => setMode(null)}>Anuluj</Button></div>
      </form>
    </Modal>}
  </div>;
}

// Karta „Obrady”: co pokazuje ekran sali, przerwa i zamknięcie posiedzenia (fakty o kworum są w pasku posiedzenia).
function MeetingControls({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [closing, setClosing] = useState(false);
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length;
  const voting = m.ballots.find(b => b.status === 'otwarte');
  const screen = screenShows(m);
  return <section class="oi-card controls">
    <CardTitle level={2}>Obrady</CardTitle>
    {present < quorumFor(total) && <Notice tone="warn">Brak kworum. Prezydium nie może podejmować uchwał <Ref>(§ 8 ust. 2).</Ref></Notice>}
    <dl class="facts"><Fact label="Ekran sali pokazuje">{screen.text}</Fact></dl>
    {!readOnly && screen.other && <div><Button kind="ghost" quiet small busy={busy} onClick={() => send({type: 'present', kind: null})}>Pokaż bieżący punkt</Button></div>}
    {!readOnly && voting && <p class="muted small">Dostępne po zakończeniu głosowania nr {voting.number}.</p>}
    {!readOnly && !voting && <>
      <div class="actions">{m.status === 'trwa'
        ? <Button small busy={busy} onClick={() => send({type: 'break', on: true})}>Zarządź przerwę</Button>
        : <Button kind="primary" small busy={busy} onClick={() => send({type: 'break', on: false})}>Wznów obrady</Button>}</div>
      {m.status === 'trwa' && <ReadAloud><p>Ogłaszam przerwę w obradach.</p></ReadAloud>}
      <div class="controls-end">
        <span class="kicker">Zakończenie obrad</span>
        <div><Button small haspopup onClick={() => setClosing(true)}>Zamknij posiedzenie</Button></div>
        <p class="muted small">Kończy obrady i tworzy projekt protokołu.</p>
      </div>
    </>}
    {closing && <CloseDialog onClose={() => setClosing(false)}/>}
  </section>;
}

// Zamknięcie posiedzenia: lista kontrolna, uwaga o skutku i pole potwierdzenia. Fokus startuje na „Anuluj”.
function CloseDialog({onClose}: {onClose: () => void}) {
  const {m, send} = useMeeting();
  const unhandled = unhandledItems(m);
  const number = (id: string) => m.ballots.find(b => b.id === id)?.number;
  const lines = [
    ...unhandled.map(it => it.status === 'oczekuje'
      ? `Punkt ${itemNumber(m.agenda, it.id)} „${it.title}” nie był rozpatrywany.`
      : `W punkcie ${itemNumber(m.agenda, it.id)} „${it.title}” nie przeprowadzono głosowania.`),
    ...m.motions.filter(x => x.status === 'zlozony').map(x => `Wniosek o reasumpcję głosowania nr ${number(x.ballotId)} czeka na decyzję Prezydium.`),
    ...m.motions.filter(x => x.status === 'przyjety' && !x.repeatBallotId).map(x => `Prezydium przyjęło wniosek o reasumpcję głosowania nr ${number(x.ballotId)}, a ponownego głosowania nie przeprowadzono.`),
    ...m.ballots.filter(b => b.status === 'zamkniete' && !b.announcedAt).sort((x, y) => x.number - y.number).map(b => `Wynik głosowania nr ${b.number} nie został ogłoszony.`),
  ];
  return <Confirm title="Zamknąć posiedzenie?" kind="danger" confirm="Zamknij posiedzenie" onClose={onClose} onConfirm={() => send({type: 'close'})}
    ack="Rozumiem, że zamknięcia posiedzenia nie można cofnąć."
    text={<div class="close-check">
      <span class="kicker">Przed zamknięciem sprawdź</span>
      {!unhandled.length && <p>Wszystkie punkty porządku obrad zostały rozpatrzone.</p>}
      {lines.length > 0 && <ul>{lines.map(line => <li key={line}>{line}</li>)}</ul>}
    </div>}
    details={<div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>Po zamknięciu nie można już głosować ani zmieniać zapisu. Powstanie projekt protokołu.</p></div>}/>;
}

// Lista obecności: zdanie z liczbą obecnych, znaczniki tylko przy wyjątkach i szare odnośniki z nazwiskiem.
function Attendance() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [guests, setGuests] = useState<{id: string; displayName: string; label: string}[]>([]);
  const [leaving, setLeaving] = useState<{who: string; at: number} | null>(null);
  useEffect(() => { if (m.invited.length) request<{accounts: typeof guests}>('/api/people').then(r => setGuests(r.accounts)).catch(() => {}); }, [m.invited.length]);
  const canMark = m.chair.current === s.personId || s.isOrganizer(m.organ);
  const members = organMembers(s.roster, m.organ);
  const away = members.filter(ms => m.attendance[ms.personId] !== 'obecny');
  const voting = m.ballots.find(b => b.status === 'otwarte');
  const waitingFor = voting ? awaitingVote(voting) : [];
  const lastEvent = (who: string, guest: boolean) => [...m.presenceLog].reverse().find(e => e.who === who && e.guest === guest);
  const line = (label: string, status: Presence | undefined, who: string, guest: boolean) => {
    const ev = lastEvent(who, guest);
    if (status === 'obecny') return ev ? `${label}, na posiedzeniu od godz. ${fmtTime(ev.at)}` : label;
    if (status === 'wyszedl') return ev ? `${label}, wyjście o godz. ${fmtTime(ev.at)}` : label;
    return `${label}, bez potwierdzenia obecności`;
  };
  const row = (who: string, name: string, label: string, status: Presence | undefined, guest: boolean) => {
    const present = status === 'obecny';
    const action = present ? 'Zapisz wyjście' : 'Zapisz obecność';
    // W trakcie głosowania wyjście osoby bez głosu wymaga potwierdzenia: głosowanie przestaje na nią czekać.
    const ask = present && !guest && waitingFor.includes(who);
    return <li key={who} class={'att-' + (status ?? 'nieobecny')}>
      <span class="att-name"><strong>{name}</strong><small>{line(label, status, who, guest)}</small></span>
      <span class="att-side"><StateChip state={presenceChip(status)}/>
        {canMark && <Button kind="ghost" quiet small busy={busy} haspopup={ask} label={`${action}, ${name}`}
          onClick={() => ask ? setLeaving({who, at: serverNow()}) : send({type: 'presence', who, guest: guest || undefined, present: !present})}>{action}</Button>}</span>
    </li>;
  };
  const lastOne = !!voting && waitingFor.length === 1 && (!voting.secret || voting.secret.cast >= voting.secret.issued.length);
  return <section class="oi-card attendance-card">
    <CardTitle level={2}>Lista obecności</CardTitle>
    {/* Imię i nazwisko nie łamie się między wierszami. */}
    <p class="attendance-summary">Obecnych {members.length - away.length} z {members.length}.{away.length > 0 && <> Poza posiedzeniem {away.map((ms, i) => <Fragment key={ms.personId}>{i === 0 ? '' : i === away.length - 1 ? ' i ' : ', '}<span class="oi-nowrap">{s.personName(ms.personId)}</span></Fragment>)}.</>}</p>
    <ul class="attendance">{members.map(ms => row(ms.personId, s.personName(ms.personId), ms.label, m.attendance[ms.personId], false))}</ul>
    {m.invited.length > 0 && <>
      <h3 class="card-sub">Głos doradczy i goście</h3>
      <ul class="attendance">{m.invited.map(gid => { const g = guests.find(x => x.id === gid); return row(gid, g?.displayName ?? 'Zaproszona osoba', g?.label ?? '', m.guests[gid], true); })}</ul>
    </>}
    {leaving && voting && <Confirm title="Zapisać wyjście?" kind="danger" confirm="Zapisz wyjście" onClose={() => setLeaving(null)}
      onConfirm={() => send({type: 'presence', who: leaving.who, present: false})}
      text={<p>Wyjście z posiedzenia zostanie zapisane przy nazwisku {s.personName(leaving.who)}, z godziną {fmtTime(leaving.at)}. Trwa głosowanie nr {voting.number} i nie będzie ono czekać na głos tej osoby.</p>}
      details={lastOne && waitingFor[0] === leaving.who ? <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>To ostatnia osoba bez głosu. Głosowanie zakończy się od razu.</p></div> : undefined}/>}
  </section>;
}

// Prowadzenie obrad: lista tylko wybiera osobę, a przekazanie wymaga potwierdzenia.
function Chairing({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const candidates = organMembers(s.roster, m.organ).filter(ms => ms.canChair && ms.personId !== m.chair.current && m.attendance[ms.personId] === 'obecny');
  const [to, setTo] = useState(candidates[0]?.personId ?? '');
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!candidates.some(c => c.personId === to)) setTo(candidates[0]?.personId ?? ''); }, [candidates.map(c => c.personId).join()]);
  const target = candidates.find(c => c.personId === to);
  const chairman = isChairman(s.roster, m.organ, s.personId);
  return <Fold title="Prowadzenie obrad">
    <div class="stack">
      <dl class="facts"><Fact label="Prowadzi">{s.personName(m.chair.current)}</Fact>{m.chair.deputy && <Fact label="Zastępstwo przewodniczącego">{s.personName(m.chair.deputy)}, {m.chair.deputyBasis}</Fact>}</dl>
      {!readOnly && candidates.length > 0 && <>
        <Field label="Komu przekazać prowadzenie?"><select value={to} onChange={e => setTo((e.target as HTMLSelectElement).value)}>
          {candidates.map(c => <option key={c.personId} value={c.personId}>{s.personName(c.personId)}, {c.label}</option>)}
        </select></Field>
        <div><Button small haspopup busy={busy} onClick={() => setAsking(true)}>Przekaż prowadzenie</Button></div>
      </>}
      {!readOnly && !candidates.length && <p class="muted small">Teraz nie ma obecnej osoby, której można przekazać prowadzenie <Ref>(§ 9 ust. 1).</Ref></p>}
      {readOnly && <p class="muted small">Widok biura obejmuje obecność i notatki. Czynności formalne wykonuje osoba prowadząca obrady.</p>}
      {canChairOrgan(s.roster, m.organ, s.personId) && m.chair.current !== s.personId && <p class="muted small">Prowadzenie przejmiesz w widoku uczestnika.</p>}
    </div>
    {asking && target && <Confirm title="Przekazać prowadzenie obrad?" confirm="Przekaż prowadzenie" focus="cancel" onClose={() => setAsking(false)}
      onConfirm={() => send({type: 'chair_handover', personId: target.personId})}
      text={<p>Obrady poprowadzi {s.personName(target.personId)}, {target.label}. Panel prowadzenia obrad przejdzie do tej osoby, a Ty zobaczysz widok uczestnika.{chairman ? ' Prowadzenie możesz przejąć z powrotem w widoku uczestnika.' : ''}</p>}/>}
  </Fold>;
}

function Log() {
  const {m} = useMeeting();
  return <Fold title="Przebieg obrad">
    <ol class="log">{[...m.log].reverse().map((l, i) => <li key={m.log.length - i}><time>{fmtTime(l.at)}</time><span>{l.text}</span></li>)}</ol>
  </Fold>;
}
