import {useEffect, useState} from 'preact/hooks';
import type {Command} from '../shared/meeting.ts';
import {canChairOrgan, isChairman, noticeDays} from '../shared/meeting.ts';
import {choiceCountLabel, choiceLabel, itemNumber, orderedAgenda, presentMembers, quorumFor, reasumptionSignaturesNeeded, resultLabel} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, Choice, Meeting} from '../shared/types.ts';
import {request, useLive} from './api.ts';
import {MeetingCtx, useMeeting, type ViewBallot, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {castSecret, secretCastHere, secretPending} from './secret.ts';
import {Button, Chip, Confirm, Countdown, Field, fmtDate, fmtTime, Modal, Notice, plural, useAction} from './ui.tsx';
import {statusLabel} from './home.tsx';
import {ChairPanel} from './chair.tsx';
import {PrepEditor} from './prep.tsx';
import {ProcedureView} from './procedure.tsx';
import {MaterialLink, MaterialReader} from './reader.tsx';
import {Messages} from './messages.tsx';
import {brand} from './brand.ts';

export function MeetingPage({id}: {id: string}) {
  const s = useSession();
  const live = useLive<{meeting: ViewMeeting}>(`/api/meetings/${id}`, 2000);
  const {busy, error, setError, run} = useAction();
  const [participantView, setParticipantView] = useState(false);
  const send = (cmd: Command) => run(async () => {
    const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${id}/command`, {body: cmd});
    live.replace(r);
    return r.meeting;
  });
  if (!live.data) return live.error ? <div class="stack"><Notice tone="error">{live.error}</Notice><a href="#">← Wróć do listy</a></div> : <p class="muted">Wczytywanie posiedzenia…</p>;
  const m = live.data.meeting;
  const chairNow = m.chair.current !== null && m.chair.current === s.personId;
  const office = s.account.kind === 'biuro' || (s.account.admin && !s.isMember(m.organ));
  const liveNow = m.status === 'trwa' || m.status === 'przerwa';
  let body;
  if (m.kind === 'procedura') body = <ProcedureView/>;
  else if (m.status === 'przygotowanie') body = s.isOrganizer(m.organ) ? <PrepEditor/> : <PrepPreview/>;
  else if (m.status === 'zakonczone') body = <Summary/>;
  else if ((chairNow && !participantView) || (office && !participantView)) body = <ChairPanel readOnly={!chairNow}/>;
  else body = <MemberView/>;
  return <MeetingCtx.Provider value={{m, send, busy, replace: live.replace, reload: live.reload}}>
    <MeetingHeader online={live.online} participantView={participantView} toggleView={liveNow && (chairNow || office) ? () => setParticipantView(v => !v) : undefined}/>
    {error && <div class="sticky-error"><Notice tone="error">{error} <button class="link" onClick={() => setError('')}>Zamknij</button></Notice></div>}
    {body}
  </MeetingCtx.Provider>;
}

function MeetingHeader(props: {online: boolean; participantView: boolean; toggleView?: () => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const [label, tone] = statusLabel[m.status];
  const chair = m.chair.current ? s.personName(m.chair.current) : null;
  return <section class="meeting-head">
    <a class="back" href="#">← Posiedzenia</a>
    <div class="meeting-head-main">
      <div>
        <div class="chips"><Chip tone={tone}>{label}</Chip>{m.kind === 'posiedzenie' && <Chip>{m.mode === 'zdalne' ? 'Zdalne' : 'Stacjonarne'}</Chip>}{!props.online && <Chip tone="warn">Brak połączenia — ponawiam…</Chip>}</div>
        <h1>{m.title}</h1>
        <p class="muted">{m.kind === 'posiedzenie' ? `${fmtDate(m.date)}, godz. ${m.time}${m.place ? ' · ' + m.place : ''}` : m.endsAt ? <>Głosowanie do <strong>{new Intl.DateTimeFormat('pl-PL', {dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Warsaw'}).format(m.endsAt)}</strong></> : 'Termin głosowania do ustalenia'}{chair && m.status !== 'przygotowanie' && m.kind === 'posiedzenie' ? ` · Prowadzi: ${chair}` : ''}</p>
      </div>
      <div class="actions">
        {m.link && m.status !== 'zakonczone' && <a class="btn btn-primary" href={m.link} target="_blank" rel="noopener noreferrer">Dołącz do połączenia</a>}
        {props.toggleView && <Button onClick={props.toggleView}>{props.participantView ? 'Panel prowadzącego' : 'Widok uczestnika'}</Button>}
        {m.kind === 'posiedzenie' && m.status !== 'przygotowanie' && m.status !== 'zakonczone' && s.isOrganizer(m.organ) && <a class="btn btn-secondary" href={`#ekran-${m.id}`} target={brand.demo ? undefined : '_blank'} rel="noopener">Ekran sali</a>}
        {m.status !== 'przygotowanie' && (s.isOrganizer(m.organ) || (m.status === 'zakonczone' && s.isMember(m.organ))) && <a class="btn btn-secondary" href={`/api/meetings/${m.id}/protokol`} target="_blank" rel="noopener">Projekt protokołu</a>}
      </div>
    </div>
  </section>;
}

export const itemStatus: Record<AgendaItem['status'], [string, string]> = {
  oczekuje: ['Oczekuje', 'plain'], w_toku: ['W toku', 'live'], zakonczony: ['Zakończony', 'done'], odroczony: ['Odroczony', 'warn'], wycofany: ['Wycofany', 'muted'],
};

export function AgendaList(props: {selected?: string | null; onSelect?: (id: string) => void; compact?: boolean}) {
  const {m} = useMeeting();
  return <ol class="agenda">
    {orderedAgenda(m.agenda).map(it => {
      const [label, tone] = itemStatus[it.status];
      const current = it.id === m.currentItemId;
      const locked = m.kind === 'posiedzenie' && !m.agendaAdopted && !beforeAdoption(m, it);
      const ballots = m.ballots.filter(b => b.itemId === it.id);
      const inner = <>
        <span class="agenda-no">{itemNumber(m.agenda, it.id)}</span>
        <span class="agenda-title">{it.title}{it.addedAfterAdoption && <em class="muted"> · dodany</em>}</span>
        <span class="agenda-meta">{current ? <Chip tone="live">Teraz</Chip>
          : it.status === 'odroczony' || it.status === 'wycofany' ? <Chip tone={tone}>{label}</Chip>
          : it.status === 'w_toku' ? <span class="live-dot" title="W toku">●</span>
          : ballots.some(b => b.status === 'zamkniete' && b.result?.adopted && !b.supersededBy) ? <span class="tick" title="Przyjęto">✓</span>
          : it.status === 'zakonczony' ? <span class="tick muted" title="Zakończony">✓</span> : null}
          {locked && !props.compact && <span class="lock" title="Po przyjęciu porządku obrad">🔒</span>}</span>
      </>;
      return <li class={['agenda-item', it.parentId ? 'is-sub' : '', current ? 'is-current' : '', props.selected === it.id ? 'is-selected' : '', `st-${it.status}`].join(' ')}>
        {props.onSelect ? <button class="agenda-row" onClick={() => props.onSelect!(it.id)}>{inner}</button> : <div class="agenda-row">{inner}</div>}
      </li>;
    })}
  </ol>;
}

export function beforeAdoption(m: Pick<Meeting, 'agenda'>, it: AgendaItem) {
  const top = m.agenda.filter(i => !i.parentId);
  const root = it.parentId ? m.agenda.find(i => i.id === it.parentId)! : it;
  return top.indexOf(root) <= top.findIndex(i => i.kind === 'porzadek');
}

export function ResultCard(props: {b: ViewBallot; big?: boolean}) {
  const {b} = props;
  const s = useSession();
  const r = b.result;
  if (!r) return null;
  const tone = !r.quorumMet ? 'warn' : r.adopted ? 'yes' : 'no';
  return <div class={`result result-${tone}` + (props.big ? ' result-big' : '')}>
    <p class="result-kicker">Głosowanie nr {b.number} · {b.mode}{b.reasumptionOf ? ' · reasumpcja' : ''}</p>
    <h3 class="result-subject">{b.subject}</h3>
    <p class="result-label">{resultLabel(b)}</p>
    <div class="result-counts">
      {(['za', 'przeciw', 'wstrzymuje'] as Choice[]).map(c => <div class={`count count-${c}`}><span>{choiceCountLabel[c]}</span><strong>{r[c]}</strong></div>)}
    </div>
    <p class="muted small">Uprawnionych {r.eligible} · uczestniczyło {r.participants} · kworum {r.quorum}{b.closeReason === 'wszyscy' ? ' · zagłosowali wszyscy uprawnieni' : b.closeReason === 'czas' ? ' · upłynął czas' : ''}</p>
    {b.mode === 'imienne' && Object.keys(b.votes).length > 0 && <details><summary>Wykaz imienny</summary><ul class="named">{b.eligible.map(id => <li><span>{s.personName(id)}</span><strong>{b.votes[id] ? choiceLabel[b.votes[id]] : '—'}</strong></li>)}</ul></details>}
    {b.supersededBy && <p class="muted small">Wynik zastąpiony przez reasumpcję.</p>}
  </div>;
}

export function VoteCard(props: {b: ViewBallot}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const {b} = props;
  const [choice, setChoice] = useState<Choice | null>(null);
  const secret = useAction();
  const [castHere, setCastHere] = useState(() => b.secret ? secretCastHere(b.id) : false);
  const me = s.personId;
  const eligible = !!me && b.eligible.includes(me);
  const voted = !!me && b.voted.includes(me);
  const present = b.remote || (me ? m.attendance[me] === 'obecny' : false);
  useEffect(() => {
    if (b.secret && b.status === 'otwarte' && secretPending(b.id) && !secret.busy) secret.run(async () => { await castSecret(m.id, b, 'za'); setCastHere(true); });
  }, [b.id]);
  const cast = b.secret ? b.secret.cast : b.voted.length;
  const total = b.eligible.length - b.absentDuring.filter(id => !b.voted.includes(id)).length;
  const header = <>
    <p class="vote-kicker">Głosowanie nr {b.number} · <strong>{b.mode === 'tajne' ? 'tajne' : b.mode === 'imienne' ? 'imienne' : 'jawne'}</strong>{b.reasumptionOf ? ' · reasumpcja' : ''}</p>
    <h2 class="vote-subject">{b.subject}</h2>
    {b.material && <MaterialLink id={b.material.id} version={b.material.version} label={`Przeczytaj treść (wersja ${b.material.version})`}/>}
    <div class="vote-meta"><Countdown endsAt={b.endsAt}/><span>Oddano {cast} z {total}</span></div>
  </>;
  if (b.status !== 'otwarte') return null;
  let action;
  if (!me || !s.isMember(m.organ)) action = <p class="muted">Głosują członkowie Prezydium.</p>;
  else if (!present) action = <Notice tone="warn">Potwierdź obecność, aby wziąć udział w głosowaniu.</Notice>;
  else if (!eligible) action = <Notice>To głosowanie rozpoczęło się bez Ciebie. Prowadzący widzi Twoją obecność.</Notice>;
  else if (b.secret && (castHere || (voted && !secretPending(b.id)))) action = <div class="voted"><span class="voted-mark">✓</span><div><strong>Głos tajny przyjęty</strong><p class="muted small">{castHere ? 'Nikt — także prowadzący — nie widzi, jak głosujesz.' : 'Kartę pobrano na innym urządzeniu.'}</p></div></div>;
  else if (!b.secret && b.myVote) action = <div class="voted"><span class="voted-mark">✓</span><div><strong>Twój głos: {choiceLabel[b.myVote]}</strong><p class="muted small">Głos zapisany na serwerze. Nie można go zmienić.</p></div></div>;
  else if (secret.busy) action = <p class="muted">Wysyłanie głosu tajnego…</p>;
  else action = <div class="vote-buttons">
    {(['za', 'przeciw', 'wstrzymuje'] as Choice[]).map(c => <Button kind={c} disabled={busy} onClick={() => setChoice(c)}>{choiceLabel[c]}</Button>)}
  </div>;
  return <section class="card vote-card" aria-live="polite">
    {header}
    {action}
    {secret.error && <Notice tone="error">{secret.error}</Notice>}
    {b.secret && <p class="fingerprint small muted">Odcisk klucza głosowania: <code>{b.secret.fingerprint}</code> — powinien być taki sam u wszystkich.</p>}
    {choice && <Confirm title="Potwierdź głos" confirm="Oddaję głos" onClose={() => setChoice(null)} onConfirm={() => {
      if (b.secret) secret.run(async () => { await castSecret(m.id, b, choice); setCastHere(true); });
      else send({type: 'vote', ballotId: b.id, choice});
    }} text={<>
      <p class={'confirm-choice choice-' + choice}>Twój głos: <strong>{choiceLabel[choice]}</strong></p>
      <p>{b.mode === 'tajne' ? 'Głosowanie tajne: serwer sprawdzi, że masz prawo głosu, ale nie zapisze, jak głosujesz.' : b.mode === 'imienne' ? 'Głosowanie imienne: Twoje nazwisko i głos znajdą się w protokole.' : 'Głosowanie jawne: w protokole znajdzie się liczba głosów.'} Głosu nie można później zmienić.</p>
    </>}/>}
  </section>;
}

function PresenceBar() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const me = s.personId;
  if (!me || !s.isMember(m.organ) || m.status === 'zakonczone') return null;
  const status = m.attendance[me] ?? 'nieobecny';
  const since = [...m.presenceLog].reverse().find(e => e.who === me && !e.guest);
  if (status === 'obecny') return <div class="presence presence-ok"><span>✓ Obecność potwierdzona {since ? `· ${fmtTime(since.at)}` : ''}</span><button class="link" disabled={busy} onClick={() => send({type: 'presence', who: me, present: false})}>Wychodzę z posiedzenia</button></div>;
  return <div class="presence"><div><strong>{status === 'wyszedl' ? 'Zapisano Twoje wyjście z posiedzenia.' : 'Nie potwierdzono obecności.'}</strong><p class="muted small">{m.mode === 'zdalne' ? 'Potwierdź, gdy połączysz się z posiedzeniem.' : 'Potwierdź, gdy jesteś na sali.'}</p></div>
    <Button kind="primary" disabled={busy} onClick={() => send({type: 'presence', who: me, present: true})}>{status === 'wyszedl' ? 'Wracam na posiedzenie' : 'Potwierdzam obecność'}</Button></div>;
}

function MemberView() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const open = m.ballots.find(b => b.status === 'otwarte');
  const shown = m.presentation;
  const result = shown?.kind === 'wynik' ? m.ballots.find(b => b.id === shown.id) : null;
  const current = m.agenda.find(i => i.id === m.currentItemId);
  const presented = shown?.kind === 'material' ? m.materials.find(x => x.id === shown.id) : null;
  const chairCapable = canChairOrgan(s.roster, m.organ, s.personId) && m.chair.current !== s.personId;
  const chairAway = !m.chair.current || m.attendance[m.chair.current] !== 'obecny';
  const takeAllowed = chairCapable && m.attendance[s.personId!] === 'obecny' && (isChairman(s.roster, m.organ, s.personId) || (chairAway && (m.chair.deputy === s.personId || !m.chair.deputy || m.attendance[m.chair.deputy] !== 'obecny')));
  const [agendaOpen, setAgendaOpen] = useState(false);
  return <div class="member">
    <PresenceBar/>
    {m.status === 'przerwa' && <Notice tone="warn">Przerwa w obradach.</Notice>}
    {open && <VoteCard b={open}/>}
    {!open && result && <ResultCard b={result} big/>}
    {current && <section class="card now">
      <p class="kicker">Teraz procedowany punkt</p>
      <h2><span class="agenda-no">{itemNumber(m.agenda, current.id)}</span> {current.title}</h2>
      {current.presenter && <p class="muted">Przedstawia: {current.presenter}</p>}
      {current.materialIds.length > 0 && <div class="material-list">{m.materials.filter(x => current.materialIds.includes(x.id)).map(x => <MaterialLink id={x.id} version={x.version} label={x.title}/>)}</div>}
    </section>}
    {presented && !open && <section class="card"><p class="kicker">Prowadzący pokazuje</p><MaterialReader id={presented.id} version={presented.version} inline/></section>}
    <Motions/>
    {(m.mode === 'zdalne' || m.messages.length > 0) && <Messages/>}
    <section class="card">
      <button class="section-toggle" onClick={() => setAgendaOpen(v => !v)} aria-expanded={agendaOpen}>Porządek obrad {m.agendaAdopted ? '(przyjęty)' : '(projekt)'} <span>{agendaOpen ? '▲' : '▼'}</span></button>
      {agendaOpen && <AgendaList compact/>}
    </section>
    {takeAllowed && <div class="actions"><Button disabled={busy} onClick={() => send({type: 'chair_take'})}>Przejmij prowadzenie obrad</Button></div>}
  </div>;
}

export function Motions() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [creating, setCreating] = useState(false);
  const me = s.personId;
  const present = presentMembers(m as Meeting, s.roster);
  const canAct = !!me && s.isMember(m.organ) && m.attendance[me] === 'obecny' && m.status !== 'zakonczone';
  const eligibleBallots = m.ballots.filter(b => b.status === 'zamkniete' && b.mode === 'jawne' && !['reasumpcja', 'tryb'].includes(b.purpose) && !b.reasumptionOf && !b.supersededBy && !m.motions.some(x => x.ballotId === b.id && !['odrzucony', 'wycofany'].includes(x.status)));
  const active = m.motions.filter(x => ['zbiera_podpisy', 'zlozony', 'glosowany', 'przyjety'].includes(x.status));
  if (!active.length && (!canAct || !eligibleBallots.length)) return null;
  return <section class="card motions">
    <h3>Wnioski o reasumpcję</h3>
    <p class="muted small">Reasumpcja jest możliwa przy uzasadnionych wątpliwościach co do wyniku głosowania jawnego, tylko na tym posiedzeniu i tylko raz (§ 12). Potrzebny jest pisemny wniosek co najmniej 1/3 obecnych — teraz {reasumptionSignaturesNeeded(present.length)} z {present.length}.</p>
    {active.map(x => {
      const b = m.ballots.find(y => y.id === x.ballotId);
      const signed = !!me && x.signatures.includes(me);
      return <div class="motion">
        <p><strong>Głosowanie nr {b?.number}:</strong> {b?.subject}</p>
        <p class="muted">„{x.justification}”</p>
        <p class="small">Podpisy: {x.signatures.map(id => s.personName(id)).join(', ')} · {x.status === 'zbiera_podpisy' ? 'zbiera podpisy' : x.status === 'zlozony' ? 'złożony — czeka na decyzję Prezydium' : x.status === 'glosowany' ? 'trwa głosowanie nad wnioskiem' : 'przyjęty — ponowne głosowanie'}</p>
        {canAct && x.status === 'zbiera_podpisy' && <Button small disabled={busy} onClick={() => send({type: 'motion_sign', motionId: x.id, on: !signed})}>{signed ? 'Wycofaj podpis' : 'Podpisuję wniosek'}</Button>}
      </div>;
    })}
    {canAct && eligibleBallots.length > 0 && <Button small onClick={() => setCreating(true)}>Złóż wniosek o reasumpcję</Button>}
    {creating && <Modal title="Wniosek o reasumpcję głosowania" onClose={() => setCreating(false)}>
      <form class="stack" onSubmit={async e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await send({type: 'motion_create', ballotId: String(f.get('ballot')), justification: String(f.get('why'))})) setCreating(false);
      }}>
        <Field label="Którego głosowania dotyczy?"><select name="ballot" required>{eligibleBallots.map(b => <option value={b.id}>Nr {b.number}: {b.subject}</option>)}</select></Field>
        <Field label="Uzasadnienie" hint="Dlaczego wynik budzi uzasadnione wątpliwości (§ 12 ust. 1)."><textarea name="why" required minLength={10} maxLength={2000} rows={4}/></Field>
        <div class="actions"><Button onClick={() => setCreating(false)}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Złóż wniosek</Button></div>
      </form>
    </Modal>}
  </section>;
}

function PrepPreview() {
  const {m} = useMeeting();
  return <div class="stack">
    <Notice>Posiedzenie jest w przygotowaniu. Otworzy je przewodniczący lub wiceprzewodniczący — wtedy na tym ekranie pojawi się potwierdzenie obecności i głosowania.</Notice>
    <section class="card"><h3>Projekt porządku obrad</h3><AgendaList compact/></section>
    {m.materials.length > 0 && <section class="card"><h3>Materiały</h3><div class="material-list">{m.materials.map(x => <MaterialLink id={x.id} version={x.version} label={x.title}/>)}</div></section>}
  </div>;
}

function Summary() {
  const {m} = useMeeting();
  const s = useSession();
  const members = organMembers(s.roster, m.organ);
  const final = m.ballots.filter(b => b.result && !b.supersededBy);
  return <div class="stack">
    <Notice tone="ok">Posiedzenie zamknięte {fmtTime(m.closedAt)}. Projekt protokołu jest gotowy do uzupełnienia — przycisk „Projekt protokołu” u góry.</Notice>
    <section class="card"><h3>Porządek obrad</h3><AgendaList compact/></section>
    <section class="card"><h3>Wyniki głosowań ({final.length})</h3><div class="results">{final.map(b => <ResultCard b={b}/>)}</div></section>
    <p class="muted small">Skład: {members.length} {plural(members.length, 'osoba', 'osoby', 'osób')}, kworum {quorumFor(members.length)}. Zawiadomienie: {noticeDays(m as Meeting) ?? '—'} dni przed posiedzeniem.</p>
  </div>;
}

