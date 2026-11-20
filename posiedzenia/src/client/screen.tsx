import type {ComponentChildren} from 'preact';
import {itemNumber, materialTypeOf, orderedAgenda, presenterGroups, presentMembers, resultPendingText} from '../shared/rules.ts';
import {organOfCode} from '../shared/roster.ts';
import {lawOf} from '../shared/law.ts';
import type {AgendaItem, Meeting, Roster} from '../shared/types.ts';
import {useLive, useNow} from './api.ts';
import type {ViewBallot, ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Chip, Countdown, Fact, fmtShort, fmtTime, Tag, TitleLead, usePageTitle} from './ui.tsx';
import {chairingText, draftChanges, draftLive, lastDraftChange, proposerSentence, quorumNow, ResultCard} from './meeting.tsx';
import {Plate} from './plate.tsx';
import {brand} from './brand.ts';
import {breakSince, meetingState, modeName} from './stany.ts';

/**
 * Jeden wzór wszystkich stanów ekranu sali: skośna etykieta nad tytułem, oba wyśrodkowane, a pod tytułem szczegóły.
 * Wynik głosowania ma ten sam układ w ResultCard (etykieta, przedmiot, rozstrzygnięcie). `lead` pogrubia początek
 * tytułu (TitleLead), a długi tytuł ma mniejsze pismo, żeby stan mieścił się na ekranie bez przewijania.
 * Etykieta jest czerwona, gdy pokazuje to, co dzieje się teraz (punkt, głosowanie, materiał). Przerwa, zamknięcie
 * i ekran bez bieżącego punktu mają etykietę ciemną (`still`), bo czerwień oznacza „teraz” (zasady 3.5 i 3.6).
 */
function State(props: {label: string; title: string; lead?: boolean; still?: boolean; small?: boolean; children?: ComponentChildren}) {
  const cls = [props.title.length > 90 ? 'is-long' : '', props.small ? 'is-small' : ''].filter(Boolean).join(' ');
  return <><Tag dark={props.still}>{props.label}</Tag><h1 class={cls || undefined}>{props.lead ? <TitleLead text={props.title}/> : props.title}</h1>{props.children}</>;
}

/** Osoby przy punkcie (F12): etykieta „Prowadzi punkt” albo „Referuje” nad listą „Imię Nazwisko, Funkcja”. */
function People({it}: {it: Pick<AgendaItem, 'presenters'>}) {
  const groups = presenterGroups(it);
  if (!groups.length) return null;
  return <dl class="facts screen-people">
    {groups.map(g => <Fact key={g.kind} label={g.label}>{g.people.map((p, i) => <span class="person-line" key={i}>{p}</span>)}</Fact>)}
  </dl>;
}

/**
 * Projekt porządku obrad przy jego przyjmowaniu i w trybie zmian na spotkaniu roboczym (F8, D2): punkty i podpunkty
 * dużym pismem. Lista odświeża się razem z ekranem, więc sala widzi zmiany osoby prowadzącej obrady od razu, a zmieniony
 * punkt ma pod tytułem słowa „zmieniono o {godz.}” (stan nie wynika z samego koloru).
 */
function DraftAgenda({m}: {m: ViewMeeting}) {
  const items = orderedAgenda(m.agenda);
  const changes = draftChanges(m);
  // Od 9 pozycji mniejsze pismo: projekt z punktami dodanymi na spotkaniu roboczym mieści się na ekranie bez przewijania.
  return <ol class={'screen-draft' + (items.length > 8 ? ' is-long' : '')} aria-label="Projekt porządku obrad">
    {items.map(it => <li key={it.id} class={it.parentId ? 'is-sub' : undefined}>
      <span class="screen-draft__no">{itemNumber(m.agenda, it.id)}.</span>
      <span class="screen-draft__title">{it.title}{changes.has(it.id) && <small class="screen-draft__changed">zmieniono o {fmtTime(changes.get(it.id))}</small>}</span>
    </li>)}
  </ol>;
}

/**
 * Podstawa rozstrzygnięcia na sali jednym zdaniem pod liczbami (O-06): „Zwykła większość głosów (§ 8 ust. 3). Tajność
 * uchwalona przez Prezydium w głosowaniu nr 2.”
 */
function basisLine(roster: Roster, m: ViewMeeting, b: ViewBallot) {
  if (!b.result || b.purpose === 'proba' || b.aborted) return null;
  let text = `Zwykła większość głosów (${lawOf(m.organ).majority.basis}).`;
  const motion = b.mode === 'jawne' ? undefined : m.ballots.find(x => x.target?.kind === 'tryb' && x.target.itemId === b.itemId && x.target.mode === b.mode && x.result?.adopted && x.announcedAt);
  if (motion) text += ` ${b.mode === 'tajne' ? 'Tajność uchwalona' : 'Głosowanie imienne uchwalone'} przez ${m.organ === 'prezydium' ? 'Prezydium' : organOfCode(roster, m.organ).name} w głosowaniu nr ${motion.number}.`;
  return text;
}

// Ekran sali, czyli projektor: duże, czytelne informacje bez elementów sterowania.
// Kolejność stanów jest ta sama co w podglądzie „Ekran sali pokazuje” w panelu prowadzenia obrad (chair.tsx).
// Wynik głosowania w sprawie ekran pokazuje dopiero po ogłoszeniu (F2), a wynik głosowania próbnego od razu (F1).
export function RoomScreen({id}: {id: string}) {
  const s = useSession();
  const {data, error} = useLive<{meeting: ViewMeeting}>(`/api/meetings/${id}`, 1500);
  const now = useNow(1000);
  usePageTitle(data ? `Ekran sali – Posiedzenie ${fmtShort(data.meeting.date)}` : null);
  if (!data) return <main class="screen"><div class="screen-body"><p class="screen-sub">{error || 'Wczytywanie…'}</p></div></main>;
  const m = data.meeting;
  const quorum = quorumNow(m, s.roster), present = presentMembers(m as unknown as Meeting, s.roster).length;
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation;
  // D2 (O-04): tryb zmian projektu porządku wybrany przez osobę prowadzącą (`present {kind: 'projekt'}`).
  const editing = shown?.kind === 'projekt' && draftLive(m);
  const latest = lastDraftChange(m);
  const visible = (b: ViewBallot) => b.purpose === 'proba' || !!b.announcedAt;
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : null;
  // Zakończone głosowanie, które sala jeszcze ogląda: próbne z wynikiem, w sprawie do czasu ogłoszenia bez wyniku.
  const ended = shown?.kind === 'glosowanie' ? m.ballots.find(b => b.id === shown.id && b.status === 'zamkniete' && (b.purpose === 'proba' || !b.announcedAt)) : null;
  const current = m.agenda.find(i => i.id === (shown?.kind === 'punkt' ? shown.id : m.currentItemId));
  const material = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : null;
  const pending = (b: ViewBallot) => <State label={`Głosowanie ${modeName(b.mode)} nr ${b.number}`} title={b.subject} lead>
    <p class="screen-sub">{resultPendingText}</p>
  </State>;
  let body;
  if (m.status === 'przerwa') {
    const since = breakSince(m);
    body = <State label={meetingState(m.status).label} title="Przerwa w obradach" still>{since && <p class="screen-sub">od godz. {fmtTime(since)}</p>}</State>;
  } else if (m.status === 'zakonczone') {
    body = <State label={meetingState(m.status).label} title={m.working ? 'Spotkanie robocze zamknięte' : 'Posiedzenie zamknięte'} still>{m.closedAt && <p class="screen-sub">o godz. {fmtTime(m.closedAt)}</p>}</State>;
  } else if (open) {
    const trial = open.purpose === 'proba';
    const cast = open.secret ? open.secret.cast : open.voted.length;
    const eligible = open.eligible.length - open.absentDuring.filter(x => !open.voted.includes(x)).length;
    const counted = `Oddano ${cast} z ${eligible} ${eligible === 1 ? 'głosu' : 'głosów'}`;
    body = <State label={trial ? `Głosowanie próbne ${modeName(open.mode)}` : `Głosowanie ${modeName(open.mode)} nr ${open.number}`} title={trial ? 'Sprawdzamy, czy głosowanie działa' : open.subject} lead={!trial}>
      {trial && <p class="screen-sub">Ten głos nie ma żadnych skutków.</p>}
      <p class="screen-big"><Countdown endsAt={open.endsAt} label={false}/></p>
      <p class="screen-sub">{counted}</p>
      <div class="oi-progress screen-progress" role="progressbar" aria-label="Oddane głosy" aria-valuemin={0} aria-valuemax={eligible} aria-valuenow={Math.min(cast, eligible)} aria-valuetext={counted}>
        <span class="oi-progress__bar"><i style={{width: `${eligible ? Math.min(100, Math.round(cast / eligible * 100)) : 0}%`}}/></span>
      </div>
      {open.secret && <p class="screen-key"><span class="kicker">Odcisk klucza głosowania</span><code>{open.secret.fingerprint}</code></p>}
    </State>;
  } else if (result) body = visible(result) ? <ResultCard b={result} big kind={materialTypeOf(m, result)} proposer={proposerSentence(s.roster, m, result)} basisLine={basisLine(s.roster, m, result)}/> : pending(result);
  else if (ended) body = ended.purpose === 'proba' ? <ResultCard b={ended} big basisLine={null}/> : pending(ended);
  else if (material) body = <State label="Materiał" title={material.title} lead><p class="screen-sub">Pełna treść jest dostępna na telefonach uczestników.</p></State>;
  else if (editing || (current && current.kind === 'porzadek' && current.id === m.currentItemId && draftLive(m))) {
    // Na spotkaniu roboczym zawsze „Projekt porządku obrad”, nigdy „Porządek obrad” (§ 8 ust. 2).
    body = <State label={current ? `Punkt ${itemNumber(m.agenda, current.id)}` : 'Projekt porządku obrad'} title="Projekt porządku obrad" small>
      {current?.kind === 'porzadek' && <People it={current}/>}
      <DraftAgenda m={m}/>
    </State>;
  } else if (current) body = <State label={`Punkt ${itemNumber(m.agenda, current.id)}`} title={current.title} lead><People it={current}/></State>;
  else body = <State label={meetingState(m.status, true).label} title={m.title} still/>;
  return <main class="screen">
    <header class="screen-head">
      <Plate/>
      {/* Powrót do posiedzenia: zawsze w wersji próbnej, a w aplikacji na oknie węższym niż 760 px (ekran sali otwiera się w nowej karcie). */}
      <div class="screen-head-title"><a class={'oi-link screen-back' + (brand.demo ? '' : ' screen-back--waski')} href={`#p-${m.id}`}>Wróć do posiedzenia</a><strong>{m.title}</strong>
        {m.working && <span class="screen-working"><Chip>Spotkanie robocze</Chip></span>}</div>
      <span class="screen-clock">{fmtTime(now)}</span>
    </header>
    <section class="screen-body">{body}</section>
    <footer class="screen-foot">
      <dl class="facts"><Fact label="Obecnych">{present} z {quorum.total}</Fact><Fact label="Wymagane kworum">{quorum.required}</Fact>{m.chair.current && <Fact label="Prowadzi">{chairingText(s.roster, m)}</Fact>}</dl>
      {m.working && <p class="screen-foot-note">Bez kworum Prezydium nie podejmuje uchwał.</p>}
      {m.working && !editing && latest && m.status !== 'zakonczone' && <p class="screen-foot-note">Projekt porządku obrad zmieniono o {fmtTime(latest.at)}.</p>}
    </footer>
  </main>;
}
