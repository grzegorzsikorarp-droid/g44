import type {ComponentChildren} from 'preact';
import {itemNumber, materialTypeOf, orderedAgenda, presenterGroups, presentMembers, quorumFor, resultPendingText} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, Meeting} from '../shared/types.ts';
import {useLive, useNow} from './api.ts';
import type {ViewBallot, ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Chip, Countdown, Fact, fmtShort, fmtTime, Tag, TitleLead, usePageTitle} from './ui.tsx';
import {draftLive, ResultCard} from './meeting.tsx';
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
 * Projekt porządku obrad przy jego przyjmowaniu (F8): punkty i podpunkty dużym pismem. Lista odświeża się razem
 * z ekranem, więc sala widzi zmiany osoby prowadzącej obrady od razu.
 */
function DraftAgenda({m}: {m: ViewMeeting}) {
  const items = orderedAgenda(m.agenda);
  return <ol class={'screen-draft' + (items.length > 12 ? ' is-long' : '')} aria-label="Projekt porządku obrad">
    {items.map(it => <li key={it.id} class={it.parentId ? 'is-sub' : undefined}>
      <span class="screen-draft__no">{itemNumber(m.agenda, it.id)}.</span><span class="screen-draft__title">{it.title}</span>
    </li>)}
  </ol>;
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
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as unknown as Meeting, s.roster).length;
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation;
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
  } else if (result) body = visible(result) ? <ResultCard b={result} big kind={materialTypeOf(m, result)}/> : pending(result);
  else if (ended) body = ended.purpose === 'proba' ? <ResultCard b={ended} big/> : pending(ended);
  else if (material) body = <State label="Materiał" title={material.title} lead><p class="screen-sub">Pełna treść jest dostępna na telefonach uczestników.</p></State>;
  else if (current && current.kind === 'porzadek' && current.id === m.currentItemId && draftLive(m)) {
    body = <State label={`Punkt ${itemNumber(m.agenda, current.id)}`} title="Projekt porządku obrad" small>
      <People it={current}/>
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
      <dl class="facts"><Fact label="Obecnych">{present} z {total}</Fact><Fact label="Wymagane kworum">{quorumFor(total)}</Fact>{m.chair.current && <Fact label="Prowadzi">{s.personName(m.chair.current)}</Fact>}</dl>
      {m.working && <p class="screen-foot-note">Bez kworum Prezydium nie podejmuje uchwał.</p>}
    </footer>
  </main>;
}
