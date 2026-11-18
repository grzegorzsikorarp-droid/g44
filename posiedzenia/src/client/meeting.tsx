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
import {Button, CardTitle, Chip, Confirm, Countdown, Fact, Field, fmtDate, fmtTime, Fold, LinkButton, Modal, Notice, plural, SectionHead, useAction} from './ui.tsx';
import {statusLabel} from './home.tsx';
import {ChairPanel} from './chair.tsx';
import {PrepEditor} from './prep.tsx';
import {ProcedureView} from './procedure.tsx';
import {MaterialLink, MaterialReader} from './reader.tsx';
import {Messages} from './messages.tsx';
import {brand} from './brand.ts';

const modeName = (mode: string) => mode === 'tajne' ? 'tajne' : mode === 'imienne' ? 'imienne' : 'jawne';

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
  if (!live.data) return <div class="page">{live.error ? <div class="stack"><Notice tone="error">{live.error}</Notice><a class="oi-link" href="#">Wróć do listy posiedzeń</a></div> : <p class="muted">Wczytywanie posiedzenia…</p>}</div>;
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
    <div class="page">
      {error && <div class="sticky-error"><Notice tone="error">{error} <Button kind="ghost" small onClick={() => setError('')}>Zamknij komunikat</Button></Notice></div>}
      {body}
    </div>
  </MeetingCtx.Provider>;
}

function MeetingHeader(props: {online: boolean; participantView: boolean; toggleView?: () => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const [label, tone] = statusLabel[m.status];
  const chair = m.chair.current ? s.personName(m.chair.current) : null;
  const when = m.kind === 'posiedzenie' ? `${fmtDate(m.date)}, godz. ${m.time}`
    : m.endsAt ? `do ${new Intl.DateTimeFormat('pl-PL', {dateStyle: 'long', timeZone: 'Europe/Warsaw'}).format(m.endsAt)} r., godz. ${fmtTime(m.endsAt)}` : '';
  return <header class="oi-hero page-head meeting-head">
    <div class="page oi-hero__in">
      <a class="oi-link back" href="#">Wróć do listy posiedzeń</a>
      <div class="oi-btns">
        <Chip tone={tone}>{label}</Chip>
        {m.kind === 'posiedzenie' && <Chip>{m.mode === 'zdalne' ? 'Posiedzenie zdalne' : 'Posiedzenie stacjonarne'}</Chip>}
        {!props.online && <Chip tone="otwarte">Brak połączenia, ponawiam</Chip>}
      </div>
      <h1>{m.title}{when && <b>{when}</b>}</h1>
      <dl class="facts">
        {m.kind === 'posiedzenie' && m.place && <Fact label="Miejsce">{m.place}</Fact>}
        {chair && m.status !== 'przygotowanie' && m.kind === 'posiedzenie' && <Fact label="Prowadzi">{chair}</Fact>}
        {m.kind === 'procedura' && <Fact label="Tryb">§ 14 ust. 5 Regulaminu, głosowanie zdalne</Fact>}
      </dl>
      <div class="actions">
        {m.link && m.status !== 'zakonczone' && <LinkButton primary href={m.link} target="_blank">Dołącz do połączenia</LinkButton>}
        {props.toggleView && <Button onClick={props.toggleView}>{props.participantView ? 'Panel prowadzącego' : 'Widok uczestnika'}</Button>}
        {m.kind === 'posiedzenie' && m.status !== 'przygotowanie' && m.status !== 'zakonczone' && s.isOrganizer(m.organ) && <LinkButton href={`#ekran-${m.id}`} target={brand.demo ? undefined : '_blank'}>Ekran sali</LinkButton>}
        {m.status !== 'przygotowanie' && (s.isOrganizer(m.organ) || (m.status === 'zakonczone' && s.isMember(m.organ))) && <LinkButton href={`/api/meetings/${m.id}/protokol`} target="_blank">Projekt protokołu</LinkButton>}
      </div>
    </div>
  </header>;
}

export const itemStatus: Record<AgendaItem['status'], [string, 'trwa' | 'otwarte' | 'zamkniete']> = {
  oczekuje: ['Oczekuje', 'zamkniete'], w_toku: ['W toku', 'trwa'], zakonczony: ['Zakończony', 'zamkniete'], odroczony: ['Odroczony', 'otwarte'], wycofany: ['Wycofany', 'zamkniete'],
};

export function AgendaList(props: {selected?: string | null; onSelect?: (id: string) => void; compact?: boolean}) {
  const {m} = useMeeting();
  const anyLocked = m.kind === 'posiedzenie' && !m.agendaAdopted && m.agenda.some(it => !beforeAdoption(m, it));
  return <>
    {anyLocked && !props.compact && <p class="muted small">Punkty wyszarzone można rozpocząć po przyjęciu porządku obrad.</p>}
    <ol class="agenda">
      {orderedAgenda(m.agenda).map(it => {
        const [label, tone] = itemStatus[it.status];
        const current = it.id === m.currentItemId;
        const locked = m.kind === 'posiedzenie' && !m.agendaAdopted && !beforeAdoption(m, it);
        const ballots = m.ballots.filter(b => b.itemId === it.id);
        const adopted = ballots.some(b => b.status === 'zamkniete' && b.result?.adopted && !b.supersededBy);
        const inner = <>
          <span class="agenda-no">{itemNumber(m.agenda, it.id)}</span>
          <span class="agenda-title">{it.title}{it.addedAfterAdoption && <em class="muted">, dodany</em>}</span>
          <span class="agenda-meta">{current ? <Chip tone="trwa">Teraz</Chip>
            : it.status === 'odroczony' || it.status === 'wycofany' ? <Chip tone={tone}>{label}</Chip>
            : it.status === 'w_toku' ? <Chip tone="trwa">W toku</Chip>
            : adopted ? <span class="agenda-state">przyjęto</span>
            : it.status === 'zakonczony' ? <span class="agenda-state">zakończony</span> : null}</span>
        </>;
        return <li class={['agenda-item', it.parentId ? 'is-sub' : '', current ? 'is-current' : '', props.selected === it.id ? 'is-selected' : '', locked ? 'is-locked' : '', `st-${it.status}`].join(' ')} aria-current={current ? 'step' : undefined}>
          {props.onSelect ? <button class="agenda-row" onClick={() => props.onSelect!(it.id)}>{inner}</button> : <div class="agenda-row">{inner}</div>}
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

// Słowo rozstrzygnięcia pogrubione, np. „Uchwała przyjęta”, „Porządek obrad nie został przyjęty”.
function emphasize(label: string) {
  const match = label.match(/^(.*?)((?:nie została |nie został )?(?:przyjęt[aey]|odrzucon[aey])|brak kworum.*)$/i);
  if (!match) return label;
  return <>{match[1]}<b>{match[2]}</b></>;
}

export function ResultCard(props: {b: ViewBallot; big?: boolean}) {
  const {b} = props;
  const s = useSession();
  const r = b.result;
  if (!r) return null;
  return <div class={'result' + (props.big ? ' result-big' : '')}>
    <span class="oi-label">Wynik głosowania nr {b.number}, głosowanie {modeName(b.mode)}{b.reasumptionOf ? ', reasumpcja' : ''}</span>
    <h3 class="result-subject">{b.subject}</h3>
    <p class="result-label">{emphasize(resultLabel(b))}</p>
    <div class="oi-stats result-counts">
      {(['za', 'przeciw', 'wstrzymuje'] as Choice[]).map(c => <div class="oi-stat"><b>{r[c]}</b><span>{choiceCountLabel[c]}</span></div>)}
    </div>
    <p class="result-meta">Uprawnionych {r.eligible}, uczestniczyło {r.participants}, kworum {r.quorum}{b.closeReason === 'wszyscy' ? '. Zagłosowali wszyscy uprawnieni.' : b.closeReason === 'czas' ? '. Upłynął czas głosowania.' : '.'}</p>
    {b.mode === 'imienne' && Object.keys(b.votes).length > 0 && <Fold title="Wykaz imienny"><ul class="named">{b.eligible.map(id => <li><span>{s.personName(id)}</span><strong>{b.votes[id] ? choiceLabel[b.votes[id]] : 'brak głosu'}</strong></li>)}</ul></Fold>}
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
  if (b.status !== 'otwarte') return null;
  const cast = b.secret ? b.secret.cast : b.voted.length;
  const total = b.eligible.length - b.absentDuring.filter(id => !b.voted.includes(id)).length;
  let action;
  if (!me || !s.isMember(m.organ)) action = <p class="muted">Głosują członkowie Prezydium.</p>;
  else if (!present) action = <Notice tone="warn">Potwierdź obecność, aby wziąć udział w głosowaniu.</Notice>;
  else if (!eligible) action = <Notice>To głosowanie rozpoczęło się bez Ciebie. Prowadzący widzi Twoją obecność.</Notice>;
  else if (b.secret && (castHere || (voted && !secretPending(b.id)))) action = <div class="oi-note oi-note--wazne voted"><span class="oi-label">Twój głos</span><strong>Głos tajny przyjęty</strong><p class="muted small">{castHere ? 'Nikt, także prowadzący, nie widzi, jak głosujesz.' : 'Kartę pobrano na innym urządzeniu.'}</p></div>;
  else if (!b.secret && b.myVote) action = <div class="oi-note oi-note--wazne voted"><span class="oi-label">Twój głos</span><strong>{choiceLabel[b.myVote]}</strong><p class="muted small">Głos zapisany na serwerze. Nie można go zmienić.</p></div>;
  else if (secret.busy) action = <p class="muted">Wysyłanie głosu tajnego…</p>;
  else action = <div class="vote-buttons" role="group" aria-label="Twój głos">
    {(['za', 'przeciw', 'wstrzymuje'] as Choice[]).map(c => <button type="button" class="oi-opt" aria-pressed={choice === c} disabled={busy} onClick={() => setChoice(c)}>{choiceLabel[c]}</button>)}
  </div>;
  return <section class="oi-card vote-card" aria-live="polite">
    <div class="oi-btns"><span class="oi-tag"><span>Głosowanie nr {b.number}</span></span><span class="oi-tag oi-tag--ciemny"><span>{modeName(b.mode)}{b.reasumptionOf ? ', reasumpcja' : ''}</span></span></div>
    <h2 class="vote-subject">{b.subject}</h2>
    {b.material && <MaterialLink id={b.material.id} version={b.material.version} label="Treść poddana pod głosowanie" meta={`wersja ${b.material.version}`}/>}
    <dl class="facts facts--liczby">
      <Fact label="Pozostało"><Countdown endsAt={b.endsAt} label={false}/></Fact>
      <Fact label="Oddano głosów">{cast} <small>z {total}</small></Fact>
    </dl>
    {action}
    {secret.error && <Notice tone="error">{secret.error}</Notice>}
    {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Powinien być taki sam u wszystkich uczestników.</span></div>}
    {choice && <Confirm title="Potwierdź głos" confirm="Oddaję głos" onClose={() => setChoice(null)} onConfirm={() => {
      if (b.secret) secret.run(async () => { await castSecret(m.id, b, choice); setCastHere(true); });
      else send({type: 'vote', ballotId: b.id, choice});
    }} text={<>
      <span class="kicker">Twój głos</span>
      <p class={'confirm-choice choice-' + choice}><strong>{choiceLabel[choice]}</strong></p>
      <p>{b.mode === 'tajne' ? 'Głosowanie tajne. Serwer sprawdzi, że masz prawo głosu, ale nie zapisze, jak głosujesz.' : b.mode === 'imienne' ? 'Głosowanie imienne. Twoje nazwisko i głos znajdą się w protokole.' : 'Głosowanie jawne. W protokole znajdzie się liczba głosów.'} Głosu nie można później zmienić.</p>
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
  if (status === 'obecny') return <div class="oi-note oi-note--wazne presence presence-ok">
    <div><span class="oi-label">Obecność potwierdzona</span><span>{since ? `od godz. ${fmtTime(since.at)}` : 'na tym posiedzeniu'}</span></div>
    <Button kind="ghost" disabled={busy} onClick={() => send({type: 'presence', who: me, present: false})}>Wychodzę z posiedzenia</Button>
  </div>;
  return <div class="oi-note presence">
    <div><strong>{status === 'wyszedl' ? 'Zapisano Twoje wyjście z posiedzenia.' : 'Nie potwierdzono obecności.'}</strong><span class="muted small">{m.mode === 'zdalne' ? 'Potwierdź, gdy połączysz się z posiedzeniem.' : 'Potwierdź, gdy jesteś na sali.'}</span></div>
    <Button kind="primary" disabled={busy} onClick={() => send({type: 'presence', who: me, present: true})}>{status === 'wyszedl' ? 'Wracam na posiedzenie' : 'Potwierdzam obecność'}</Button>
  </div>;
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
  return <div class="member">
    <PresenceBar/>
    {m.status === 'przerwa' && <Notice tone="warn">Przerwa w obradach.</Notice>}
    {open && <VoteCard b={open}/>}
    {!open && result && <ResultCard b={result} big/>}
    {current && <section class="oi-card now">
      <span class="oi-label">Teraz procedowany punkt</span>
      <h2 class="now-title"><span class="agenda-no">{itemNumber(m.agenda, current.id)}</span><span>{current.title}</span></h2>
      {current.presenter && <dl class="facts"><Fact label="Przedstawia">{current.presenter}</Fact></dl>}
      {current.materialIds.length > 0 && <div class="material-list">{m.materials.filter(x => current.materialIds.includes(x.id)).map(x => <MaterialLink id={x.id} version={x.version} label={x.title}/>)}</div>}
    </section>}
    {presented && !open && <section class="oi-card"><span class="oi-label">Prowadzący pokazuje</span><MaterialReader id={presented.id} version={presented.version} inline/></section>}
    <Motions/>
    {(m.mode === 'zdalne' || m.messages.length > 0) && <Messages/>}
    <Fold title={`Porządek obrad, ${m.agendaAdopted ? 'przyjęty' : 'projekt'}`}><AgendaList compact/></Fold>
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
  const needed = reasumptionSignaturesNeeded(present.length);
  return <section class="oi-card motions">
    <CardTitle>Wnioski o reasumpcję</CardTitle>
    <p class="muted small">Reasumpcja jest możliwa przy uzasadnionych wątpliwościach co do wyniku głosowania jawnego, tylko na tym posiedzeniu i tylko raz (§ 12). Potrzebny jest pisemny wniosek co najmniej 1/3 obecnych, czyli teraz {needed} {plural(needed, 'podpis', 'podpisy', 'podpisów')} przy {present.length} obecnych.</p>
    {active.map(x => {
      const b = m.ballots.find(y => y.id === x.ballotId);
      const signed = !!me && x.signatures.includes(me);
      return <div class="motion">
        <span class="kicker">Głosowanie nr {b?.number}</span>
        <p class="strong">{b?.subject}</p>
        <p class="muted">„{x.justification}”</p>
        <dl class="facts"><Fact label="Podpisy">{x.signatures.map(id => s.personName(id)).join(', ')}</Fact><Fact label="Stan wniosku">{x.status === 'zbiera_podpisy' ? 'zbiera podpisy' : x.status === 'zlozony' ? 'złożony, czeka na decyzję Prezydium' : x.status === 'glosowany' ? 'trwa głosowanie nad wnioskiem' : 'przyjęty, ponowne głosowanie'}</Fact></dl>
        {canAct && x.status === 'zbiera_podpisy' && <div class="actions"><Button small disabled={busy} onClick={() => send({type: 'motion_sign', motionId: x.id, on: !signed})}>{signed ? 'Wycofaj podpis' : 'Podpisuję wniosek'}</Button></div>}
      </div>;
    })}
    {canAct && eligibleBallots.length > 0 && <div class="actions"><Button small onClick={() => setCreating(true)}>Złóż wniosek o reasumpcję</Button></div>}
    {creating && <Modal title="Wniosek o reasumpcję głosowania" onClose={() => setCreating(false)}>
      <form class="stack" onSubmit={async e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (await send({type: 'motion_create', ballotId: String(f.get('ballot')), justification: String(f.get('why'))})) setCreating(false);
      }}>
        <Field label="Którego głosowania dotyczy?"><select name="ballot" required>{eligibleBallots.map(b => <option value={b.id}>Nr {b.number}, {b.subject}</option>)}</select></Field>
        <Field label="Uzasadnienie" hint="Dlaczego wynik budzi uzasadnione wątpliwości (§ 12 ust. 1)."><textarea name="why" required minLength={10} maxLength={2000} rows={4}/></Field>
        <div class="actions"><Button kind="primary" type="submit" disabled={busy}>Złóż wniosek</Button><Button onClick={() => setCreating(false)}>Anuluj</Button></div>
      </form>
    </Modal>}
  </section>;
}

function PrepPreview() {
  const {m} = useMeeting();
  return <div class="member">
    <Notice>Posiedzenie jest w przygotowaniu. Otworzy je przewodniczący lub wiceprzewodniczący. Wtedy na tym ekranie pojawi się potwierdzenie obecności i głosowania.</Notice>
    <section class="oi-card"><CardTitle>Projekt porządku obrad</CardTitle><AgendaList compact/></section>
    {m.materials.length > 0 && <section class="oi-card"><CardTitle>Materiały</CardTitle><div class="material-list">{m.materials.map(x => <MaterialLink id={x.id} version={x.version} label={x.title}/>)}</div></section>}
  </div>;
}

function Summary() {
  const {m} = useMeeting();
  const s = useSession();
  const members = organMembers(s.roster, m.organ);
  const final = m.ballots.filter(b => b.result && !b.supersededBy);
  const days = noticeDays(m as Meeting);
  return <div class="stack">
    <Notice tone="ok">Posiedzenie zamknięte o godz. {fmtTime(m.closedAt)}. Projekt protokołu jest gotowy do uzupełnienia, otwiera go przycisk „Projekt protokołu” u góry.</Notice>
    <section class="oi-card"><CardTitle>Porządek obrad</CardTitle><AgendaList compact/></section>
    <section><SectionHead count={`${final.length} ${plural(final.length, 'głosowanie', 'głosowania', 'głosowań')}`}>Wyniki głosowań</SectionHead><div class="results">{final.map(b => <ResultCard b={b}/>)}</div></section>
    <dl class="facts"><Fact label="Skład">{members.length} {plural(members.length, 'osoba', 'osoby', 'osób')}</Fact><Fact label="Kworum">{quorumFor(members.length)}</Fact><Fact label="Zawiadomienie">{days === null ? 'nie wpisano daty' : `${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem`}</Fact></dl>
  </div>;
}
