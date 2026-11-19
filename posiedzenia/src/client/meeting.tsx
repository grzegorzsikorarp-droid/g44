import {useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import type {Command} from '../shared/meeting.ts';
import {canChairOrgan, isChairman, noticeDays} from '../shared/meeting.ts';
import {awaitingVote, choiceCountLabel, choiceLabel, choices, itemNumber, itemVoted, materialTypeOf, needsVote, orderedAgenda, presentMembers, quorumFor, reasumptionSignaturesNeeded, resolutionSubject, resultLabel} from '../shared/rules.ts';
import {membership, organMembers} from '../shared/roster.ts';
import type {AgendaItem, Choice, MaterialType, Meeting} from '../shared/types.ts';
import {request, serverNow, useLive} from './api.ts';
import {MeetingCtx, useMeeting, type ViewBallot, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {castSecret, forgetRejected, onSecretChange, resendSecret, secretCastHere, secretPending, secretRejected} from './secret.ts';
import {announce, Button, CardTitle, Chip, Confirm, Countdown, ErrorNotice, Fact, Field, fmtDateTime, fmtShort, fmtTime, Fold, LinkButton, Modal, Notice, plural, SectionHead, StateChip, Tag, TitleLead, useAction, usePageTitle} from './ui.tsx';
import {breakSince, meetingState, modeGenitive, modeName, votingChip} from './stany.ts';
import {ChairPanel} from './chair.tsx';
import {PrepEditor} from './prep.tsx';
import {ProcedureView} from './procedure.tsx';
import {MaterialLink, MaterialReader, showBallot} from './reader.tsx';
import {Messages} from './messages.tsx';
import {brand} from './brand.ts';
import {typo} from '../shared/typo.ts';

const APP = 'Posiedzenia Prezydium';
const day = (ts: number) => new Intl.DateTimeFormat('pl-PL', {day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw'}).format(ts);
/** Data posiedzenia albo termin głosowania między posiedzeniami: „19.11.2026”. */
const shortDate = (m: Pick<Meeting, 'kind' | 'date' | 'endsAt'>) => m.kind === 'procedura' && m.endsAt ? day(m.endsAt) : fmtShort(m.date);
const pageTitle = (m: ViewMeeting) => m.kind === 'procedura' ? `Głosowanie między posiedzeniami do ${shortDate(m)} – ${APP}` : `Posiedzenie ${shortDate(m)} – ${APP}`;
/** Oddane głosy i uprawnieni bez osób, które wyszły przed oddaniem głosu. */
const castOf = (b: ViewBallot) => ({cast: b.secret ? b.secret.cast : b.voted.length, total: b.eligible.length - b.absentDuring.filter(id => !b.voted.includes(id)).length});

export function MeetingPage({id}: {id: string}) {
  const s = useSession();
  const live = useLive<{meeting: ViewMeeting}>(`/api/meetings/${id}`, 2000);
  const {busy, error, errorKind, setError, run} = useAction();
  const [participantView, setParticipantView] = useState(false);
  useEffect(() => setParticipantView(false), [id]);
  const m = live.data?.meeting;
  usePageTitle(m ? pageTitle(m) : null);
  const send = (cmd: Command) => run(async () => {
    const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${id}/command`, {body: cmd});
    live.replace(r);
    return r.meeting;
  });
  if (!m) return <div class="page page--kolumna">{live.error ? <div class="stack"><ErrorNotice>{live.error}</ErrorNotice><a class="oi-link" href="#">Wróć do listy posiedzeń</a></div> : <p class="muted">Wczytywanie posiedzenia…</p>}</div>;
  const chairNow = m.chair.current !== null && m.chair.current === s.personId;
  const office = s.account.kind === 'biuro' || (s.account.admin && !s.isMember(m.organ));
  const liveNow = m.status === 'trwa' || m.status === 'przerwa';
  const sitting = m.kind === 'posiedzenie';
  const chairView = sitting && liveNow && !participantView && (chairNow || office);
  const memberView = sitting && liveNow && !chairView;
  let body;
  if (!sitting) body = <ProcedureView/>;
  else if (m.status === 'przygotowanie') body = s.isOrganizer(m.organ) ? <PrepEditor/> : <PrepPreview/>;
  else if (m.status === 'zakonczone') body = <Summary/>;
  else if (chairView) body = <ChairPanel readOnly={!chairNow}/>;
  else body = <MemberView online={live.online}/>;
  const open = memberView ? m.ballots.find(b => b.status === 'otwarte') : undefined;
  return <MeetingCtx.Provider value={{m, send, busy, replace: live.replace, reload: live.reload}}>
    <div class={'meeting' + (liveNow ? ' meeting--live' : '')}>
      {open && <a class="skip-link" href={`#glosowanie-${open.id}`} data-kotwica onClick={e => { e.preventDefault(); showBallot(open.id); }}>Przejdź do głosowania</a>}
      <MeetingTop online={live.online} sticky={liveNow} wide={chairView} participantView={participantView}
        toggleView={sitting && liveNow && (chairNow || office) ? () => setParticipantView(v => !v) : undefined}/>
      <div class={'page' + (chairView ? '' : ' page--kolumna')}>
        {error && <div class="sticky-error"><ErrorNotice kind={errorKind}>{error} <Button kind="ghost" small onClick={() => setError('')}>Zamknij komunikat</Button></ErrorNotice></div>}
        {body}
        <MeetingDetails participantView={participantView} toggleView={sitting && liveNow && (chairNow || office) ? () => setParticipantView(v => !v) : undefined}/>
      </div>
    </div>
  </MeetingCtx.Provider>;
}

// Pasek posiedzenia razem z uwagą o braku połączenia. W trakcie obrad przykleja się u góry, a jego wysokość
// trafia do zmiennej --pasek-posiedzenia (scroll-padding-top strony i przyklejone elementy pod paskiem).
function MeetingTop(props: {online: boolean; sticky: boolean; wide: boolean; participantView: boolean; toggleView?: () => void}) {
  const top = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = top.current;
    if (!props.sticky || !el) { root.style.removeProperty('--pasek-posiedzenia'); return; }
    const set = () => root.style.setProperty('--pasek-posiedzenia', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set);
    watch?.observe(el);
    return () => { watch?.disconnect(); root.style.removeProperty('--pasek-posiedzenia'); };
  }, [props.sticky]);
  return <div class={'meeting-top' + (props.sticky ? ' is-sticky' : '')} ref={top}>
    <MeetingBar wide={props.wide} participantView={props.participantView} toggleView={props.toggleView}/>
    {!props.online && <div class="meeting-offline"><div class={'meeting-bar__in' + (props.wide ? '' : ' is-kolumna')}>
      <Notice label="Brak połączenia">Trwa ponowne łączenie. Nie zamykaj tej strony.</Notice>
    </div></div>}
  </div>;
}

/** Fakty o posiedzeniu: data, miejsce i prowadzący albo termin i tryb głosowania między posiedzeniami. */
function useMeetingFacts() {
  const {m} = useMeeting();
  const s = useSession();
  if (m.kind === 'procedura') {
    const due = m.endsAt ? fmtDateTime(m.endsAt) : '–';
    return [
      <Fact key="termin" label="Termin">{m.status === 'zakonczone' && m.closedAt ? `Zakończone ${fmtDateTime(m.closedAt)} (termin do ${due})` : `do ${due}`}</Fact>,
      <Fact key="tryb" label="Tryb">Głosowanie zdalne między posiedzeniami (§ 14 ust. 5 {brand.regulation})</Fact>,
    ];
  }
  const chair = m.status !== 'przygotowanie' && m.chair.current ? m.chair.current : null;
  return [
    <Fact key="data" label="Data" class="fact--data">{fmtShort(m.date)}, godz. {m.time}</Fact>,
    m.place ? <Fact key="miejsce" label="Miejsce" class="fact--miejsce">{m.place}</Fact> : null,
    chair ? <Fact key="prowadzi" label="Prowadzi">{s.personName(chair)}{m.status !== 'zakonczone' && m.attendance[chair] !== 'obecny' ? ', poza posiedzeniem' : ''}</Fact> : null,
  ];
}

/**
 * Dopasowanie paska do szerokości, tak żeby nazwa organu nie była ucinana w środku słowa, a fakty stały w jednym wierszu.
 * Tytuł: pełny, gdy mieści się w wierszu, a inaczej krótki „Posiedzenie Prezydium, 19.11.2026” (pełny zostaje dla
 * czytnika ekranu i w podpowiedzi). Gdy i on się nie mieści, znika znacznik rodzaju posiedzenia, potem znacznik
 * trwającego głosowania (głosowanie widać w faktach), a na końcu tytuł zawija się w dwa wiersze.
 * Fakty: gdy nie mieszczą się w jednym wierszu, pasek pomija najpierw miejsce, a potem datę.
 */
function fitBar(bar: HTMLElement) {
  const title = bar.querySelector<HTMLElement>('.meeting-bar__title');
  if (title) {
    bar.classList.remove('is-krotki', 'bez-rodzaju', 'bez-znacznika', 'is-zawijany');
    for (const step of ['is-krotki', 'bez-rodzaju', 'bez-znacznika', 'is-zawijany']) {
      if (title.scrollWidth <= title.clientWidth + 1) break;
      bar.classList.add(step);
    }
  }
  const facts = bar.querySelector<HTMLElement>('.meeting-bar__facts');
  if (!facts) return;
  facts.classList.remove('bez-miejsca', 'bez-daty');
  const wraps = () => {
    const shown = [...facts.children].filter(el => (el as HTMLElement).offsetParent !== null) as HTMLElement[];
    return shown.length > 1 && shown[shown.length - 1].offsetTop > shown[0].offsetTop + 2;
  };
  if (wraps()) facts.classList.add('bez-miejsca');
  if (wraps()) facts.classList.add('bez-daty');
}

function MeetingBar(props: {wide: boolean; participantView: boolean; toggleView?: () => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const ref = useRef<HTMLElement>(null);
  // Dopasowanie po każdym odświeżeniu, przy zmianie szerokości okna i po wczytaniu krojów pisma.
  useLayoutEffect(() => { if (ref.current) fitBar(ref.current); });
  useEffect(() => {
    const fit = () => { if (ref.current) fitBar(ref.current); };
    window.addEventListener('resize', fit);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => window.removeEventListener('resize', fit);
  }, []);
  const facts = useMeetingFacts();
  const procedure = m.kind === 'procedura';
  const liveNow = m.status === 'trwa' || m.status === 'przerwa';
  const organizer = s.isOrganizer(m.organ);
  const open = !procedure && liveNow ? m.ballots.find(b => b.status === 'otwarte') : undefined;
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length;
  const kind = procedure ? 'Głosowanie między posiedzeniami' : m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne';
  const short = procedure ? `Głosowanie między posiedzeniami, do ${shortDate(m)}` : `Posiedzenie Prezydium, ${shortDate(m)}`;
  // Po zamknięciu posiedzenia „Projekt protokołu” jest przyciskiem głównym w podsumowaniu, więc pasek go nie powtarza.
  const protocol = m.status !== 'przygotowanie' && !(m.status === 'zakonczone' && !procedure) && (organizer || (m.status === 'zakonczone' && s.isMember(m.organ)));
  const votes = open ? castOf(open) : null;
  return <header class="meeting-bar" ref={ref}>
    <div class={'meeting-bar__in' + (props.wide ? '' : ' is-kolumna')}>
      <div class="meeting-bar__row">
        <div class="meeting-bar__chips">
          <StateChip state={meetingState(m.status, !organizer)}/>
          {open && <span class="bar-desk bar-voting"><StateChip state={votingChip()}/></span>}
          <span class="bar-desk bar-kind"><Chip>{kind}</Chip></span>
        </div>
        <h1 class="meeting-bar__title" title={m.title}><span class="bar-full">{m.title}</span><span class="bar-short" aria-hidden="true">{short}</span></h1>
        <div class="meeting-bar__actions">
          {/* W wersji próbnej (ramka bez nowych okien) nie ma przejścia do zewnętrznego połączenia. */}
          {m.link && m.status !== 'zakonczone' && !brand.demo && <LinkButton small href={m.link} newTab>Dołącz do<br class="bar-br"/> połączenia</LinkButton>}
          {props.toggleView && <Button small class="bar-toggle" onClick={props.toggleView}>{props.participantView ? <>Panel prowadzenia<br class="bar-br"/> obrad</> : <>Widok<br class="bar-br"/> uczestnika</>}</Button>}
          {!procedure && liveNow && organizer && <span class="bar-desk"><LinkButton small href={`#ekran-${m.id}`} newTab={!brand.demo}>Otwórz ekran sali</LinkButton></span>}
          {protocol && <span class="bar-desk"><LinkButton small href={`/api/meetings/${m.id}/protokol`} newTab={!brand.demo}>Projekt protokołu</LinkButton></span>}
        </div>
      </div>
      <dl class="facts meeting-bar__facts">
        {facts}
        {!procedure && liveNow && <><Fact label="Obecnych">{present} z {total}</Fact><Fact label="Wymagane kworum">{quorumFor(total)}</Fact></>}
        {/* Jeden fakt o głosowaniu: numer, pozostały czas i oddane głosy („trwa” mówi znacznik obok tytułu). */}
        {open && votes && <Fact label={`Głosowanie nr ${open.number}`}>zostało <Countdown endsAt={open.endsAt} label={false}/>, oddano {votes.cast} z {votes.total}</Fact>}
      </dl>
    </div>
  </header>;
}

// Na telefonie fakty z paska są w zwijanej sekcji na końcu widoku (na szerszym ekranie sekcja jest ukryta).
// Do 360 px jest w niej też przełącznik widoku, żeby pasek posiedzenia miał jeden wiersz.
function MeetingDetails(props: {participantView: boolean; toggleView?: () => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const facts = useMeetingFacts();
  const protocol = m.status !== 'przygotowanie' && (s.isOrganizer(m.organ) || (m.status === 'zakonczone' && s.isMember(m.organ)));
  return <div class="meeting-details">
    <Fold title={m.kind === 'procedura' ? 'Szczegóły głosowania' : 'Szczegóły posiedzenia'}>
      <dl class="facts">{facts}</dl>
      {props.toggleView && <div class="details-toggle"><Button small onClick={props.toggleView}>{props.participantView ? 'Panel prowadzenia obrad' : 'Widok uczestnika'}</Button></div>}
      <div class="actions meeting-details__links">
        {protocol && (brand.demo
          ? <a class="oi-link" href={`/api/meetings/${m.id}/protokol`}>Projekt protokołu</a>
          : <a class="oi-link" href={`/api/meetings/${m.id}/protokol`} target="_blank" rel="noopener noreferrer">Projekt protokołu<span class="sr-only"> (otwiera się w nowej karcie)</span></a>)}
        <a class="oi-link" href="#">Lista posiedzeń</a>
      </div>
    </Fold>
  </div>;
}

// Stan punktu słowem w prawej kolumnie porządku. Bieżący punkt ma zamiast niego znacznik „Teraz”.
function agendaState(m: ViewMeeting, it: AgendaItem, locked: boolean) {
  if (it.status === 'odroczony') return 'odroczony';
  if (it.status === 'wycofany') return 'wycofany';
  if (m.ballots.some(b => b.itemId === it.id && b.status === 'zamkniete' && b.result?.adopted && !b.supersededBy && b.purpose !== 'tryb' && b.purpose !== 'reasumpcja')) return 'przyjęto';
  if (it.status === 'zakonczony' || (it.kind === 'zamkniecie' && m.status === 'zakonczone')) return needsVote(m, it) && !itemVoted(m, it) ? 'bez głosowania' : 'zakończony';
  if (it.status === 'oczekuje') return m.status === 'zakonczone' ? 'nierozpatrzony' : locked ? 'po przyjęciu porządku' : null;
  return null;
}

export function AgendaList(props: {selected?: string | null; onSelect?: (id: string) => void; compact?: boolean}) {
  const {m} = useMeeting();
  const closed = m.status === 'zakonczone';
  const locked = (it: AgendaItem) => m.kind === 'posiedzenie' && !m.agendaAdopted && !beforeAdoption(m, it);
  const lockedTop = m.agenda.filter(it => !it.parentId && locked(it)).map(it => itemNumber(m.agenda, it.id));
  const lockedText = lockedTop.length === 1 ? `Punkt ${lockedTop[0]} można rozpocząć po przyjęciu porządku obrad.` : `Punkty ${lockedTop[0]}–${lockedTop[lockedTop.length - 1]} można rozpocząć po przyjęciu porządku obrad.`;
  return <>
    {lockedTop.length > 0 && !props.compact && <p class="muted small">{lockedText}</p>}
    <ol class="agenda">
      {orderedAgenda(m.agenda).map(it => {
        const current = !closed && it.id === m.currentItemId;
        const selected = props.selected === it.id;
        const state = current ? null : agendaState(m, it, locked(it));
        const inner = <>
          <span class="agenda-no">{itemNumber(m.agenda, it.id)}</span>
          <span class="agenda-title">{it.title}{it.addedAfterAdoption && <em class="muted">, dodany</em>}</span>
          <span class="agenda-meta">{current ? <Chip tone="trwa">Teraz</Chip> : state && <span class="agenda-state">{state}</span>}</span>
        </>;
        const cls = ['agenda-item', it.parentId ? 'is-sub' : '', current ? 'is-current' : '', selected && !current ? 'is-selected' : '', locked(it) ? 'is-locked' : '', `st-${it.status}`].filter(Boolean).join(' ');
        return <li key={it.id} class={cls}>
          {props.onSelect
            ? <button type="button" class="agenda-row" aria-pressed={selected} aria-current={current ? 'step' : undefined} onClick={() => props.onSelect!(it.id)}>{inner}</button>
            : <div class="agenda-row" aria-current={current ? 'step' : undefined}>{inner}</div>}
        </li>;
      })}
    </ol>
  </>;
}

export function beforeAdoption(m: Pick<Meeting, 'agenda'>, it: AgendaItem) {
  const top = m.agenda.filter(i => !i.parentId);
  const root = it.parentId ? m.agenda.find(i => i.id === it.parentId)! : it;
  return top.indexOf(root) <= top.findIndex(i => i.kind === 'porzadek');
}

// Słowo rozstrzygnięcia pogrubione, np. „Uchwała podjęta”, „Sprawozdanie nie zostało przyjęte”, „Nie przyjęto”.
// Twarde spacje wstawia typo() przed podziałem, bo tekst we fragmencie nie przechodzi przez podpięcie z typo.ts.
export function emphasize(text: string) {
  const label = typo(text);
  const match = label.match(/^(.*?)((?:nie (?:została|został|zostało) )?(?:przyjęt[aeoy]|podjęt[aey]|odrzucon[aey])|nie przyjęto|brak kworum.*)$/i);
  if (!match) return label;
  return <>{match[1]}<b>{match[2]}</b></>;
}

/**
 * Wynik głosowania. `kind` to rodzaj sprawy do formuły wyniku (resultLabel). Bez niego karta bierze
 * rodzaj materiału z posiedzenia, jeśli stoi w jego kontekście (ekran sali go nie ma).
 */
export function ResultCard(props: {b: ViewBallot; big?: boolean; kind?: MaterialType | null}) {
  const {b} = props;
  const ctx = useContext(MeetingCtx);
  const r = b.result;
  if (!r) return null;
  const kind = props.kind !== undefined ? props.kind : ctx ? materialTypeOf(ctx.m, b) : null;
  const label = `Wynik głosowania ${modeGenitive(b.mode)} nr ${b.number}${b.reasumptionOf ? ' po reasumpcji' : ''}`;
  const reason = b.closeReason === 'czas' ? ' Upłynął czas głosowania.' : b.closeReason === 'prowadzacy' ? ' Głosowanie zakończyła osoba prowadząca obrady.' : '';
  const meta = b.closeReason === 'wszyscy' && r.cast === r.eligible
    ? `Zagłosowali wszyscy uprawnieni (${r.eligible}). Wymagane kworum ${r.quorum}.`
    : `Głosowało ${r.cast} z ${r.eligible} uprawnionych. Wymagane kworum ${r.quorum}.${reason}`;
  const replaced = b.supersededBy && ctx ? ctx.m.ballots.find(x => x.id === b.supersededBy) : undefined;
  return <div class={'result' + (props.big ? ' result-big' : '')}>
    {props.big ? <Tag>{label}</Tag> : <span class="oi-label">{label}</span>}
    <p class="result-subject">{props.big ? <TitleLead text={b.subject}/> : b.subject}</p>
    <p class="result-label">{emphasize(resultLabel(b, kind))}</p>
    <div class="oi-stats result-counts">
      {choices.map(c => <div class="oi-stat" key={c}><b>{r[c]}</b><span>{choiceCountLabel[c]}</span></div>)}
    </div>
    <p class="result-meta">{meta}</p>
    {/* Ekran sali (big) nie ma elementów sterowania, więc bez rozwijanego wykazu imiennego. */}
    {!props.big && b.mode === 'imienne' && Object.keys(b.votes).length > 0 && <Fold title="Wykaz imienny"><NamedList b={b}/></Fold>}
    {replaced && <p class="muted small">Wynik zastąpiony wynikiem reasumpcji w głosowaniu nr {replaced.number}.</p>}
  </div>;
}

function NamedList({b}: {b: ViewBallot}) {
  const s = useSession();
  return <ul class="named">{b.eligible.map(id => <li key={id}><span>{s.personName(id)}</span><strong>{b.votes[id] ? choiceLabel[b.votes[id]] : 'brak głosu'}</strong></li>)}</ul>;
}

const confirmLabel: Record<Choice, string> = {za: 'Głosuję za', przeciw: 'Głosuję przeciw', wstrzymuje: 'Wstrzymuję się od głosu'};
const modeSentence = (mode: string) => mode === 'tajne' ? 'Głosowanie tajne. System sprawdzi, że masz prawo głosu, ale nie zapisze, jak głosujesz. Głosu nie można później zmienić.'
  : mode === 'imienne' ? 'Głosowanie imienne. Twoje nazwisko i głos znajdą się w protokole. Głosu nie można później zmienić.'
  : 'Głosowanie jawne. W protokole znajdzie się liczba głosów. Głosu nie można później zmienić.';

/**
 * Karta głosowania. Pełna karta stoi w widoku członka, a odmiana `embedded` (etykieta „Twój głos”, miejsce
 * na głos i okno potwierdzenia) w kartach innych ekranów. Karta nie ma aria-live: zdarzenia podaje announce().
 */
export function VoteCard(props: {b: ViewBallot; embedded?: boolean}) {
  const {m, send} = useMeeting();
  const s = useSession();
  const {b} = props;
  const ids = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const secret = useAction();
  const [castHere, setCastHere] = useState(() => b.secret ? secretCastHere(b.id) : false);
  const justVoted = useRef(false);
  const note = useRef<HTMLDivElement>(null);
  const me = s.personId;
  const eligible = !!me && b.eligible.includes(me);
  const voted = !!me && b.voted.includes(me);
  const present = b.remote || (me ? m.attendance[me] === 'obecny' : false);
  const pending = !!b.secret && secretPending(b.id);
  const rejected = !!b.secret && secretRejected(b.id);
  // Karta zapisana na tym urządzeniu (np. po zamknięciu strony w trakcie wysyłania) wysyła się sama po otwarciu.
  useEffect(() => {
    if (b.secret && b.status === 'otwarte' && secretPending(b.id) && !secret.busy) secret.run(async () => { if (await resendSecret(m.id, b.id)) setCastHere(true); });
  }, [b.id]);
  const hasNote = b.secret ? castHere : !!b.myVote;
  // Po potwierdzeniu fokus przechodzi na notatkę „Twój głos”, a czytnik ekranu słyszy, że głos zapisano.
  useEffect(() => {
    if (!justVoted.current || !hasNote || !note.current) return;
    justVoted.current = false;
    note.current.focus({preventScroll: true});
    note.current.scrollIntoView({block: 'nearest'});
    announce(b.secret ? 'Głos tajny przyjęty.' : `Twój głos „${choiceLabel[b.myVote!]}” został zapisany. Nie można go zmienić.`);
  }, [hasNote]);
  if (b.status !== 'otwarte') return null;
  const {cast, total} = castOf(b);
  const voteNote = (title: string, text: string) => <div class="oi-note oi-note--wazne voted" tabIndex={-1} ref={note}>
    {!props.embedded && <span class="oi-label">Twój głos</span>}<strong>{title}</strong><p class="muted small">{text}</p>
  </div>;
  const resend = () => secret.run(async () => { if (await resendSecret(m.id, b.id)) setCastHere(true); });
  let place;
  if (!me || !s.isMember(m.organ)) place = <p class="muted">Głosują członkowie Prezydium.</p>;
  else if (!present) place = <Notice tone="warn">Potwierdź obecność, aby wziąć udział w głosowaniu.</Notice>;
  else if (!eligible) place = <Notice>To głosowanie rozpoczęło się bez Ciebie. Osoba prowadząca obrady widzi Twoją obecność.</Notice>;
  else if (rejected) place = null;
  else if (secret.busy) place = <p class="muted">Wysyłanie głosu tajnego…</p>;
  else if (b.secret && castHere) place = voteNote('Głos tajny przyjęty', 'Nikt, także osoba prowadząca obrady, nie zobaczy Twojego wyboru.');
  else if (b.secret && pending) place = <div class="oi-note oi-note--wazne vote-pending">
    {!props.embedded && <span class="oi-label">Twój głos</span>}
    <strong>Głos tajny nie został jeszcze wysłany</strong>
    <p class="small">Potwierdzony wybór czeka na wysłanie. Sprawdź połączenie z internetem i wyślij głos ponownie. Wyboru nie można już zmienić.</p>
    <div><Button kind="primary" onClick={resend}>Wyślij głos ponownie</Button></div>
  </div>;
  else if (b.secret && voted) place = voteNote('Karta pobrana na innym urządzeniu', 'Jeśli głos nie został wysłany z tamtego urządzenia, otwórz na nim to posiedzenie. Zapisany tam głos zostanie wtedy wysłany.');
  else if (!b.secret && b.myVote) place = voteNote(choiceLabel[b.myVote], 'Twój głos został zapisany. Nie można go zmienić.');
  else place = <div class="vote-choose">
    <span class="kicker" id={`${ids}-q`}>Jak głosujesz?</span>
    <p class="small muted" id={`${ids}-p`}>Wybierz odpowiedź. Głos oddasz dopiero po potwierdzeniu.</p>
    <div class="vote-buttons" role="group" aria-labelledby={`${ids}-q`} aria-describedby={`${ids}-p`}>
      {choices.map(c => <button key={c} type="button" class="oi-opt" aria-haspopup="dialog" onClick={() => setChoice(c)}>{choiceLabel[c]}</button>)}
    </div>
  </div>;
  const failure = secret.error && !rejected
    ? <ErrorNotice kind={secret.errorKind}>{pending && secret.errorKind === 'polaczenie' ? 'Nie udało się wysłać głosu. Sprawdź połączenie z internetem i wyślij go ponownie przyciskiem poniżej.' : secret.error}</ErrorNotice>
    : null;
  const dialog = choice && <Confirm title="Potwierdź głos" confirm={confirmLabel[choice]} cancel="Wróć do wyboru" onClose={() => setChoice(null)} onConfirm={() => {
    justVoted.current = true;
    if (b.secret) secret.run(async () => { await castSecret(m.id, b, choice); setCastHere(true); });
    else send({type: 'vote', ballotId: b.id, choice}).then(r => { if (!r) justVoted.current = false; });
  }} text={<div class="vote-confirm">
    <dl class="facts"><Fact label="Głosuje">{s.name}</Fact></dl>
    <p class="confirm-choice"><strong>{choiceLabel[choice]}</strong></p>
    <p>{modeSentence(b.mode)}</p>
  </div>}/>;
  if (props.embedded) return <div class="vote-embedded" data-glosowanie={b.id}>
    <h3 class="card-sub" tabIndex={-1} data-naglowek-glosowania>Twój głos</h3>
    {failure}{place}{dialog}
  </div>;
  const origin = b.reasumptionOf ? m.ballots.find(x => x.id === b.reasumptionOf)
    : b.target?.kind === 'reasumpcja' ? m.ballots.find(x => x.id === (b.target as {ballotId: string}).ballotId) : undefined;
  const motion = origin ? m.motions.find(x => x.ballotId === origin.id && (x.voteBallotId === b.id || x.repeatBallotId === b.id)) : undefined;
  const bareResolution = !b.material && b.purpose === 'uchwala' && resolutionSubject.test(b.subject.trim());
  return <section class="oi-card vote-card is-teraz" id={`glosowanie-${b.id}`} aria-labelledby={`${ids}-t`}>
    <div class="oi-btns"><Tag>Głosowanie nr {b.number}</Tag><Tag dark>{modeName(b.mode)}{b.reasumptionOf ? ', reasumpcja' : ''}</Tag></div>
    <h2 class="vote-subject" id={`${ids}-t`} tabIndex={-1} data-naglowek-glosowania><TitleLead text={b.subject}/></h2>
    {b.material && <MaterialLink id={b.material.id} version={b.material.version} label="Treść poddana pod głosowanie" meta={`wersja ${b.material.version}`}/>}
    <dl class="facts facts--liczby vote-facts">
      <Fact label="Pozostało"><Countdown endsAt={b.endsAt} label={false} long={b.remote}/></Fact>
      <Fact label="Oddano głosów">{cast} <small>z {total}</small></Fact>
    </dl>
    {b.purpose === 'porzadek' && <div class="vote-agenda">
      <span class="kicker">Porządek obrad poddany pod głosowanie</span>
      <ol class="vote-agenda__list">{orderedAgenda(m.agenda).map(it => <li key={it.id} class={it.parentId ? 'is-sub' : ''}><span class="agenda-no">{itemNumber(m.agenda, it.id)}</span><span>{it.title}</span></li>)}</ol>
    </div>}
    {origin && <dl class="facts vote-context">
      {motion && <Fact label="Uzasadnienie wniosku">„{motion.justification}”</Fact>}
      {origin.result && <Fact label={`Wynik głosowania nr ${origin.number} przed reasumpcją`}>{resultLabel(origin, materialTypeOf(m, origin))}, za {origin.result.za}, przeciw {origin.result.przeciw}, wstrzymało się {origin.result.wstrzymuje}</Fact>}
    </dl>}
    {failure}
    {place}
    {/* Zdanie o braku projektu i podstawa trybu stoją pod miejscem na głos: nad przyciskami przesuwałyby je poza ekran telefonu. */}
    {bareResolution && <p class="small muted">Projekt uchwały nie został dołączony. Treść przedstawia osoba prowadząca obrady.</p>}
    {b.mode !== 'jawne' && b.modeBasis && <dl class="facts vote-context"><Fact label="Podstawa trybu">{b.modeBasis}</Fact></dl>}
    {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Ten sam kod widać na ekranie sali. Jeśli Twój kod jest inny, nie głosuj i powiedz o tym osobie prowadzącej obrady.</span></div>}
    {dialog}
  </section>;
}

/** Uwaga o głosie tajnym, który dotarł po zakończeniu głosowania (najnowsze takie głosowanie). */
export function RejectedVote(props: {ballots: ViewBallot[]}) {
  const [, refresh] = useState(0);
  useEffect(() => onSecretChange(() => refresh(n => n + 1)), []);
  const b = props.ballots.filter(x => x.secret && secretRejected(x.id)).sort((x, y) => y.number - x.number)[0];
  if (!b) return null;
  return <Notice tone="error" label="Głos nie został policzony">
    <p>Głosowanie nr {b.number} zakończyło się, zanim Twój głos dotarł. Twój głos nie został policzony. Zgłoś to osobie prowadzącej obrady.</p>
    <div><Button kind="ghost" onClick={() => forgetRejected(b.id)}>Rozumiem</Button></div>
  </Notice>;
}

function PresenceCard() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const me = s.personId!;
  const status = m.attendance[me] ?? 'nieobecny';
  return <div class="oi-note presence">
    <div><strong>{status === 'wyszedl' ? 'Zapisano Twoje wyjście z posiedzenia.' : 'Nie potwierdzono obecności.'}</strong><span class="muted small">{m.mode === 'zdalne' ? 'Potwierdź, gdy połączysz się z posiedzeniem.' : 'Potwierdź, gdy jesteś na sali.'}</span></div>
    <Button kind="primary" busy={busy} onClick={() => send({type: 'presence', who: me, present: true})}>{status === 'wyszedl' ? 'Wracam na posiedzenie' : 'Potwierdzam obecność'}</Button>
  </div>;
}

// Wiersz obecności na końcu widoku. Wyjście wymaga potwierdzenia, a w trakcie głosowania okno mówi, że głos przepadnie.
function PresenceRow() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const me = s.personId!;
  const [leaving, setLeaving] = useState(false);
  const since = [...m.presenceLog].reverse().find(e => e.who === me && !e.guest);
  const open = m.ballots.find(b => b.status === 'otwarte');
  const losesVote = open && awaitingVote(open).includes(me) ? open : undefined;
  return <div class="presence-row">
    <p>Obecność potwierdzona {since ? `od godz. ${fmtTime(since.at)}` : 'na tym posiedzeniu'}</p>
    <Button kind="ghost" haspopup busy={busy} onClick={() => setLeaving(true)}>Wychodzę z posiedzenia</Button>
    {leaving && <Confirm title="Wychodzisz z posiedzenia?" confirm="Wychodzę z posiedzenia" cancel="Zostaję" focus="cancel" onClose={() => setLeaving(false)}
      onConfirm={() => send({type: 'presence', who: me, present: false})}
      text={<p>Godzina wyjścia trafi do listy obecności i do protokołu. Do czasu powrotu nie weźmiesz udziału w głosowaniach.</p>}
      details={losesVote ? <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>Trwa głosowanie nr {losesVote.number}. Jeśli wyjdziesz teraz, nie oddasz w nim głosu.</p></div> : undefined}/>}
  </div>;
}

function CurrentItem(props: {it: AgendaItem; accent: boolean}) {
  const {m} = useMeeting();
  const {it} = props;
  const id = useId();
  const same = (a: string, b: string) => a.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase() === b.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase();
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  return <section class={'oi-card now' + (props.accent ? ' is-teraz' : '')} aria-labelledby={id}>
    <span class="oi-label">Bieżący punkt obrad</span>
    <h2 class="now-title" id={id}><span class="agenda-no">{itemNumber(m.agenda, it.id)}</span><span><TitleLead text={it.title}/></span></h2>
    {it.presenter && <dl class="facts"><Fact label="Przedstawia">{it.presenter}</Fact></dl>}
    {materials.length > 0 && <div class="material-list">{materials.map(x => <MaterialLink key={x.id} id={x.id} version={x.version}
      label={same(x.title, it.title) ? (x.type === 'uchwala' ? 'Treść uchwały' : 'Treść materiału') : x.title} meta={`wersja ${x.version}`}/>)}</div>}
  </section>;
}

// Komunikaty dla czytnika ekranu o zdarzeniach obrad: porównanie poprzedniego i bieżącego stanu.
function useMeetingAnnouncements(m: ViewMeeting, online: boolean) {
  const s = useSession();
  const previous = useRef<{open?: string; result?: string; status: string; chair: string | null; online: boolean} | null>(null);
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation?.kind === 'wynik' ? m.ballots.find(b => b.id === m.presentation!.id && b.result) : undefined;
  useEffect(() => {
    const now = {open: open?.id, result: shown?.id, status: m.status, chair: m.chair.current, online};
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const lines: string[] = [];
    if (open && now.open !== before.open) {
      const minutes = Math.max(1, Math.round((open.endsAt - serverNow()) / 60000));
      lines.push(`Rozpoczęło się głosowanie ${modeName(open.mode)} nr ${open.number}. ${open.subject.replace(/[.\s]+$/, '')}. Na oddanie głosu masz ${minutes} ${plural(minutes, 'minutę', 'minuty', 'minut')}.`);
    }
    if (shown?.result && now.result !== before.result) {
      const r = shown.result;
      lines.push(`Wynik głosowania nr ${shown.number}. ${resultLabel(shown, materialTypeOf(m, shown))}. Za ${r.za}, przeciw ${r.przeciw}, wstrzymało się ${r.wstrzymuje}.`);
    }
    if (now.status === 'przerwa' && before.status !== 'przerwa') lines.push('Przerwa w obradach. Głosowania są wstrzymane.');
    if (now.status === 'trwa' && before.status === 'przerwa') lines.push('Obrady zostały wznowione.');
    if (now.chair && now.chair !== before.chair) lines.push(`Obrady prowadzi teraz ${s.personName(now.chair)}.`);
    if (now.online !== before.online) lines.push(online ? 'Połączenie przywrócone.' : 'Brak połączenia. Trwa ponowne łączenie.');
    if (lines.length) announce(lines.join(' '));
  });
  // Osoba, która jeszcze nie głosowała, słyszy dwa przypomnienia: przed ostatnią minutą i przed ostatnimi 15 sekundami.
  const me = s.personId;
  const waiting = !!open && !!me && (open.remote || m.attendance[me] === 'obecny') && awaitingVote(open).includes(me);
  useEffect(() => {
    if (!open || !waiting) return;
    const timers: number[] = [];
    const remind = (before: number, text: string) => {
      const delay = open.endsAt - before - serverNow();
      if (delay > 1000) timers.push(window.setTimeout(() => announce(text), delay));
    };
    remind(60000, 'Do końca głosowania została minuta.');
    remind(15000, 'Do końca głosowania zostało 15 sekund.');
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [open?.id, open?.endsAt, waiting]);
}

function MemberView(props: {online: boolean}) {
  const {m, send} = useMeeting();
  const s = useSession();
  const me = s.personId;
  const [taking, setTaking] = useState(false);
  useMeetingAnnouncements(m, props.online);
  const open = m.ballots.find(b => b.status === 'otwarte');
  const waiting = !!open && !!me && m.attendance[me] === 'obecny' && awaitingVote(open).includes(me);
  // Przy nowym głosowaniu karta przewija się pod pasek posiedzenia, a fokus przechodzi na jej nagłówek
  // (chyba że osoba pisze w polu tekstowym albo ma otwarte okno). Gdy widok otwiera się w trakcie
  // głosowania, na które ta osoba jeszcze nie zagłosowała, karta też staje pod paskiem, ale bez fokusu.
  const seen = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (open && seen.current === null) { if (waiting) showBallot(open.id, false); }
    else if (open && open.id !== seen.current) {
      const busyElsewhere = !!document.activeElement?.matches('input, textarea, select') || !!document.querySelector('dialog[open]');
      showBallot(open.id, !busyElsewhere);
    }
    seen.current = open?.id;
  }, [open?.id]);
  const shown = m.presentation;
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id && b.result) : undefined;
  const lastClosed = m.ballots.filter(b => b.status === 'zamkniete').sort((x, y) => (y.closedAt ?? 0) - (x.closedAt ?? 0))[0];
  const awaitingResult = !open && lastClosed && !lastClosed.announcedAt ? lastClosed : undefined;
  const current = m.agenda.find(i => i.id === m.currentItemId);
  const presented = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : null;
  const member = !!me && s.isMember(m.organ);
  const status = me ? m.attendance[me] ?? 'nieobecny' : 'nieobecny';
  const since = breakSince(m);
  // Przejęcie prowadzenia: zastępca, gdy osoba prowadząca jest poza posiedzeniem, a przewodniczący zawsze.
  const chairCapable = canChairOrgan(s.roster, m.organ, me) && m.chair.current !== me;
  const chairAway = !m.chair.current || m.attendance[m.chair.current] !== 'obecny';
  const takeAllowed = chairCapable && status === 'obecny' && (isChairman(s.roster, m.organ, me) || (chairAway && (m.chair.deputy === me || !m.chair.deputy || m.attendance[m.chair.deputy] !== 'obecny')));
  const left = chairAway && m.chair.current ? [...m.presenceLog].reverse().find(e => e.who === m.chair.current && !e.guest && e.type === 'wyjscie') : undefined;
  const role = membership(s.roster, m.organ, me)?.label;
  const change = m.chair.changes[m.chair.changes.length - 1];
  const handedOver = me && change && change.from === me && m.chair.current !== me ? change : undefined;
  return <div class="member">
    {member && status !== 'obecny' && <PresenceCard/>}
    {m.status === 'przerwa' && <Notice tone="warn" label="Przerwa w obradach">{since ? `od godz. ${fmtTime(since)}. ` : ''}Głosowania są wstrzymane.</Notice>}
    {takeAllowed && chairAway && <Notice>
      <p>{left ? `Osoba prowadząca obrady wyszła z posiedzenia o godz. ${fmtTime(left.at)}. ` : ''}Możesz przejąć prowadzenie{role ? ` jako ${role}` : ''}.</p>
      <div><Button kind="primary" haspopup onClick={() => setTaking(true)}>Przejmij prowadzenie obrad</Button></div>
    </Notice>}
    {handedOver && <Notice tone="warn" label="">Prowadzenie obrad przekazano o godz. {fmtTime(handedOver.at)}. Prowadzi {s.personName(handedOver.to)}.</Notice>}
    {open ? <VoteCard b={open}/>
      : awaitingResult ? <section class="oi-card vote-closed" aria-labelledby={`zakonczone-${awaitingResult.id}`}>
        <span class="oi-label" id={`zakonczone-${awaitingResult.id}`}>Głosowanie nr {awaitingResult.number}</span>
        <p><strong>Głosowanie zakończone.</strong> Wynik ogłosi osoba prowadząca obrady.</p>
      </section>
      : result ? <ResultCard b={result} big/> : null}
    <RejectedVote ballots={m.ballots}/>
    {current && <CurrentItem it={current} accent={!open}/>}
    {presented && !open && <section class="oi-card"><span class="oi-label">Materiał pokazywany na sali</span><MaterialReader id={presented.id} version={presented.version} inline/></section>}
    <Motions/>
    {(m.mode === 'zdalne' || m.messages.length > 0) && <Messages/>}
    <Fold title={m.agendaAdopted ? 'Przyjęty porządek obrad' : 'Projekt porządku obrad'}><AgendaList compact/></Fold>
    {member && status === 'obecny' && <PresenceRow/>}
    {takeAllowed && !chairAway && <div class="actions"><Button haspopup onClick={() => setTaking(true)}>Przejmij prowadzenie obrad</Button></div>}
    {taking && <Confirm title="Przejąć prowadzenie obrad?" confirm="Przejmij prowadzenie" focus="cancel" onClose={() => setTaking(false)} onConfirm={() => send({type: 'chair_take'})}
      text={<p>Twój ekran przełączy się na panel prowadzenia obrad.</p>}/>}
  </div>;
}

const motionState = (m: ViewMeeting, x: ViewMeeting['motions'][number]) => {
  const number = (id?: string) => m.ballots.find(b => b.id === id)?.number;
  switch (x.status) {
    case 'zbiera_podpisy': return 'zbiera podpisy';
    case 'zlozony': return 'złożony, czeka na decyzję Prezydium';
    case 'glosowany': return 'trwa głosowanie nad wnioskiem';
    case 'przyjety': return x.repeatBallotId ? `reasumpcję przeprowadzono, głosowanie nr ${number(x.repeatBallotId)}` : 'przyjęty, czeka na ponowne głosowanie';
    case 'odrzucony': return x.voteBallotId ? `wniosek odrzucony w głosowaniu nr ${number(x.voteBallotId)}` : 'wniosek odrzucony';
    default: return 'wycofany';
  }
};

// Reasumpcja (§ 12): zwinięta sekcja, dopóki nie ma wniosków, a potem karta wniosku ze stanem i podpisami.
export function Motions() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const me = s.personId;
  const present = presentMembers(m as Meeting, s.roster);
  const canAct = !!me && s.isMember(m.organ) && m.attendance[me] === 'obecny' && m.status !== 'zakonczone';
  const eligibleBallots = m.ballots.filter(b => b.status === 'zamkniete' && b.mode === 'jawne' && !['reasumpcja', 'tryb'].includes(b.purpose) && !b.reasumptionOf && !b.supersededBy && !m.motions.some(x => x.ballotId === b.id && !['odrzucony', 'wycofany'].includes(x.status)));
  const shown = m.motions.filter(x => x.status !== 'wycofany');
  if (!shown.length && (!canAct || !eligibleBallots.length)) return null;
  const needed = reasumptionSignaturesNeeded(present.length);
  const intro = <p class="muted small">Jeśli wynik głosowania jawnego budzi uzasadnione wątpliwości, możesz złożyć wniosek o reasumpcję. Wniosek musi poprzeć co najmniej 1/3 obecnych członków, czyli teraz {needed} {plural(needed, 'podpis', 'podpisy', 'podpisów')} przy {present.length} obecnych. Reasumpcja jest możliwa tylko na tym posiedzeniu i tylko raz (§ 12).</p>;
  const file = canAct && eligibleBallots.length > 0 && <div class="actions"><Button small haspopup onClick={() => setCreating(true)}>Złóż wniosek o reasumpcję</Button></div>;
  const form = creating && <Modal title="Wniosek o reasumpcję głosowania" onClose={() => setCreating(false)}>
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      if (await send({type: 'motion_create', ballotId: String(f.get('ballot')), justification: String(f.get('why'))})) setCreating(false);
    }}>
      <Field label="Którego głosowania dotyczy?"><select name="ballot" required>{eligibleBallots.map(b => <option key={b.id} value={b.id}>Nr {b.number}, {b.subject}</option>)}</select></Field>
      <Field label="Uzasadnienie" hint="Dlaczego wynik budzi uzasadnione wątpliwości (§ 12)."><textarea name="why" required minLength={10} maxLength={2000} rows={4}/></Field>
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Złóż wniosek</Button><Button onClick={() => setCreating(false)}>Anuluj</Button></div>
    </form>
  </Modal>;
  if (!shown.length) return <><Fold title="Wniosek o reasumpcję głosowania">{intro}{file}</Fold>{form}</>;
  return <section class="oi-card motions">
    {shown.map(x => {
      const b = m.ballots.find(y => y.id === x.ballotId);
      const signed = !!me && x.signatures.includes(me);
      const valid = x.signatures.filter(id => present.includes(id)).length;
      return <div class="motion" key={x.id}>
        <CardTitle level={2}>Wniosek o reasumpcję głosowania nr {b?.number}{x.status === 'zbiera_podpisy' ? ` zbiera podpisy, ${valid} z ${needed}` : ''}</CardTitle>
        <p class="strong">{b?.subject}</p>
        <p class="muted">„{x.justification}”</p>
        <dl class="facts"><Fact label="Podpisy">{x.signatures.map(id => s.personName(id)).join(', ')}</Fact><Fact label="Stan wniosku">{motionState(m, x)}</Fact></dl>
        {canAct && x.status === 'zbiera_podpisy' && <div class="actions"><Button small busy={busy} onClick={() => send({type: 'motion_sign', motionId: x.id, on: !signed})}>{signed ? 'Wycofaj podpis' : 'Podpisuję wniosek'}</Button></div>}
      </div>;
    })}
    {file && <>{intro}{file}</>}
    {form}
  </section>;
}

function PrepPreview() {
  const {m} = useMeeting();
  return <div class="member">
    <Notice>Posiedzenie jest w przygotowaniu. Otworzy je przewodniczący lub wiceprzewodniczący. Wtedy na tym ekranie pojawi się potwierdzenie obecności i głosowania.</Notice>
    <section class="oi-card"><CardTitle level={2}>Projekt porządku obrad</CardTitle><AgendaList compact/></section>
    {m.materials.length > 0 && <section class="oi-card"><CardTitle level={2}>Materiały</CardTitle><div class="material-list">{m.materials.map(x => <MaterialLink key={x.id} id={x.id} version={x.version} label={x.title}/>)}</div></section>}
  </div>;
}

// Podsumowanie zamkniętego posiedzenia: informacja o zamknięciu z projektem protokołu, porządek i tabela wyników.
function Summary() {
  const {m} = useMeeting();
  const s = useSession();
  const members = organMembers(s.roster, m.organ);
  const final = m.ballots.filter(b => b.result && !b.supersededBy);
  const named = final.filter(b => b.mode === 'imienne' && Object.keys(b.votes).length > 0);
  const days = noticeDays(m as Meeting);
  const protocol = s.isOrganizer(m.organ) || s.isMember(m.organ);
  return <div class="stack summary">
    <div class="oi-note oi-note--wazne summary-note">
      <span class="oi-label">Posiedzenie zamknięte</span>
      <p>Zamknięte o godz. {fmtTime(m.closedAt)}. Projekt protokołu jest gotowy do uzupełnienia.</p>
      {protocol && <div><LinkButton primary href={`/api/meetings/${m.id}/protokol`} newTab={!brand.demo}>Projekt protokołu</LinkButton></div>}
      <dl class="facts">
        <Fact label="Skład">{members.length} {plural(members.length, 'osoba', 'osoby', 'osób')}</Fact>
        <Fact label="Wymagane kworum">{quorumFor(members.length)}</Fact>
        <Fact label="Zawiadomienie">{days === null ? 'nie wpisano daty' : `${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem`}</Fact>
      </dl>
    </div>
    <section class="oi-card"><CardTitle level={2}>Porządek obrad</CardTitle><AgendaList compact/></section>
    <section>
      <SectionHead count={`${final.length} ${plural(final.length, 'głosowanie', 'głosowania', 'głosowań')}`}>Wyniki głosowań</SectionHead>
      {/* Role ARIA powtarzają znaczenie tabeli, bo do 560 px wiersze mają układ bloków (uczestnik.css). */}
      {final.length > 0 && <div class="oi-table-wrap"><table class="oi-table results-table" role="table" aria-label="Wyniki głosowań">
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader" class="oi-liczba">Nr</th><th scope="col" role="columnheader">Przedmiot</th><th scope="col" role="columnheader">Tryb</th><th scope="col" role="columnheader" class="oi-liczba">Za</th><th scope="col" role="columnheader" class="oi-liczba">Przeciw</th><th scope="col" role="columnheader" class="oi-liczba">Wstrzymało się</th><th scope="col" role="columnheader">Wynik</th></tr></thead>
        <tbody role="rowgroup">{final.map(b => <tr key={b.id} role="row">
          <td role="cell" class="oi-liczba">{b.number}</td>
          <th scope="row" role="rowheader">{b.subject}</th>
          <td role="cell" data-label="Tryb">{modeName(b.mode)}{b.reasumptionOf ? ', po reasumpcji' : ''}</td>
          <td role="cell" class="oi-liczba" data-label="Za">{b.result!.za}</td><td role="cell" class="oi-liczba" data-label="Przeciw">{b.result!.przeciw}</td><td role="cell" class="oi-liczba" data-label="Wstrzymało się">{b.result!.wstrzymuje}</td>
          <td role="cell">{emphasize(resultLabel(b, materialTypeOf(m, b)))}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
    {named.map(b => <section class="oi-card" key={b.id}><CardTitle level={2}>Wykaz imienny głosowania nr {b.number}</CardTitle><NamedList b={b}/></section>)}
  </div>;
}

