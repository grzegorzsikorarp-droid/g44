import {useState} from 'preact/hooks';
import {request, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {MailDialog} from './mail.tsx';
import {Button, CardTitle, Confirm, ErrorNotice, Fact, Field, Notice, StateChip, useAction} from './ui.tsx';
import {proposalChip} from './stany.ts';
import {canRejectProposal, canSendProgress} from '../shared/role.ts';
import {PREP_REFUSALS, type Comment, type PrepCommand, type PrepView} from '../shared/workspace.ts';
import {fmtTime} from './ui.tsx';
import type {Actor} from '../shared/types.ts';

// Wspólne przygotowanie na ekranach (SPEC-4 6.5). Pakiet D0: zamrożone API i prosta działająca wersja karty
// „Przygotowanie posiedzenia” (`PrepCard`) i przestrzeni roboczej punktu albo posiedzenia (`WorkspacePanel`: zgłoszenia
// i uwagi). Zespół E dopracowuje układ z B2 2.13 (zakładki, okna zgłoszenia i decyzji, `wspolpraca.css`) i montuje oba
// komponenty w prep.tsx, prep-preview.tsx i procedure.tsx. Dane przychodzą z widoku posiedzenia (`meeting.prep`), a każde
// polecenie zwraca nowy widok (`onChange`). W trakcie obrad przestrzeni nie ma w widoku (T-5).

const send = (meetingId: string, cmd: PrepCommand) => request<{meeting: MeetingData; prep: PrepView | null}>(`/api/meetings/${encodeURIComponent(meetingId)}/przygotowanie`, {body: {cmd}});

/** Karta „Przygotowanie posiedzenia”: postęp, braki, zgłoszenia czekające i zdanie o zawiadomieniu (6.5). */
export function PrepCard(props: {meeting: MeetingData; onChange?: (m: MeetingData) => void}) {
  const s = useSession();
  const [mail, setMail] = useState(false);
  const prep = props.meeting.prep;
  if (!prep) return props.meeting.status === 'trwa' || props.meeting.status === 'przerwa' ? <p class="muted">{PREP_REFUSALS.later}</p> : null;
  const actor: Actor = {account: s.account, personId: s.personId, name: s.name};
  const p = prep.progress;
  return <section class="oi-card stack prep-card">
    <CardTitle level={2}>Przygotowanie posiedzenia</CardTitle>
    <p>{p.text}</p>
    {p.missing && <p>{p.missing}</p>}
    <dl class="facts">{p.proposalsWaiting > 0 && <Fact label="Zgłoszenia czekające na decyzję zwołującego">{p.proposalsWaiting}</Fact>}</dl>
    {p.notice && <p class="small">{p.notice}</p>}
    {prep.readOnly && <Notice>{PREP_REFUSALS.opened}</Notice>}
    {canSendProgress(s.roster, props.meeting, actor) && s.mail?.enabled && <div><Button haspopup onClick={() => setMail(true)}>Wyślij informację o postępie</Button></div>}
    {mail && <MailDialog meeting={props.meeting} kind="postep" onClose={() => setMail(false)}/>}
  </section>;
}

function Comments(props: {meeting: MeetingData; list: Comment[]; itemId: string; onChange: (m: MeetingData) => void}) {
  const [text, setText] = useState('');
  const {busy, error, errorKind, run} = useAction();
  const roots = props.list.filter(c => !c.parentId);
  return <div class="stack">
    {roots.length ? <ol class="prep-comments">{roots.map(c => <li key={c.id}>
      <p>{c.deleted ? 'Uwagę usunięto.' : c.text}</p>
      <p class="small muted">{c.byName}, godz. {fmtTime(c.at)}{c.editedAt ? ', Poprawiono' : ''}{c.resolved ? ', wątek rozstrzygnięty' : ''}</p>
      {props.list.filter(r => r.parentId === c.id).map(r => <p class="small" key={r.id}>{r.byName}: {r.deleted ? 'Uwagę usunięto.' : r.text}</p>)}
    </li>)}</ol> : <p class="muted">Nie ma jeszcze uwag do tego punktu.</p>}
    {!props.meeting.prep?.readOnly && <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => { const r = await send(props.meeting.id, {type: 'comment_add', target: {kind: 'punkt', itemId: props.itemId}, text}); setText(''); props.onChange(r.meeting); }); }}>
      <Field label="Twoja uwaga" hint="Uwagi widzą członkowie Prezydium i biuro. Nie są materiałem posiedzenia i nie trafiają do protokołu."><textarea rows={3} maxLength={2000} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)}/></Field>
      <div><Button type="submit" busy={busy}>Dodaj uwagę</Button></div>
    </form>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/**
 * Przestrzeń robocza: bez `itemId` lista zgłoszeń z decyzjami według uprawnień (G-30), z `itemId` uwagi przy punkcie.
 * Odrzucenie i odłożenie tylko u zwołującego (`canRejectProposal`), u pozostałych osób przygotowujących stan
 * „Czeka na decyzję zwołującego” (K4-3).
 */
export function WorkspacePanel(props: {meeting: MeetingData; itemId?: string | null; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [ask, setAsk] = useState<{id: string; title: string; type: 'proposal_accept' | 'proposal_reject' | 'proposal_defer'} | null>(null);
  const prep = props.meeting.prep;
  if (!prep) return null;
  if (props.itemId) return <Comments meeting={props.meeting} list={prep.comments.filter(c => c.target.kind === 'punkt' && c.target.itemId === props.itemId)} itemId={props.itemId} onChange={props.onChange}/>;
  const actor: Actor = {account: s.account, personId: s.personId, name: s.name};
  const decides = canRejectProposal(s.roster, props.meeting, actor);
  const full = prep.scope === 'pelny' && !prep.readOnly;
  const act = (cmd: PrepCommand) => run(async () => props.onChange((await send(props.meeting.id, cmd)).meeting));
  return <div class="stack prep-proposals">
    {prep.proposals.length ? <ul class="oi-list">{prep.proposals.map(p => <li key={p.id} class="stack">
      <p><strong>{p.title}</strong> <StateChip state={proposalChip(p.state, p.state === 'zgloszone' && full && !decides)}/></p>
      <p class="small">{p.justification}</p>
      <p class="small muted">{p.byName}{p.decision?.reason ? `. Powód „${p.decision.reason}”.` : ''}</p>
      {full && p.state === 'zgloszone' && <div class="actions">
        <Button small haspopup busy={busy} onClick={() => setAsk({id: p.id, title: p.title, type: 'proposal_accept'})}>Wpisz do projektu</Button>
        {decides && <Button small kind="ghost" haspopup onClick={() => setAsk({id: p.id, title: p.title, type: 'proposal_defer'})}>Odłóż</Button>}
        {decides && <Button small kind="ghost" haspopup onClick={() => setAsk({id: p.id, title: p.title, type: 'proposal_reject'})}>Odrzuć</Button>}
      </div>}
      {full && p.state === 'zgloszone' && !decides && <p class="small">{PREP_REFUSALS.reject}</p>}
    </li>)}</ul> : <p class="muted">Nikt jeszcze nie zgłosił sprawy na to posiedzenie.</p>}
    {ask?.type === 'proposal_accept' && <Confirm title={`Wpisać zgłoszenie „${ask.title}” do projektu porządku?`} text={<p>Punkt trafi do projektu porządku obrad przed punktem „Informacje bieżące i wolne wnioski”.</p>} confirm="Wpisz do projektu" cancel="Anuluj"
      onClose={() => setAsk(null)} onConfirm={() => { act({type: 'proposal_accept', proposalId: ask.id, place: 'przed_wolnymi_wnioskami'}); setAsk(null); }}/>}
    {ask && ask.type !== 'proposal_accept' && <Confirm title={ask.type === 'proposal_reject' ? 'Odrzucić zgłoszenie?' : 'Odłożyć zgłoszenie na następne posiedzenie?'} text={<p>{ask.title}</p>}
      confirm={ask.type === 'proposal_reject' ? 'Odrzuć' : 'Odłóż'} cancel="Anuluj" field={{label: 'Powód', hint: 'Zobaczy go osoba zgłaszająca.', required: true, maxLength: 500}}
      onClose={() => setAsk(null)} onConfirm={reason => { act({type: ask.type as 'proposal_reject' | 'proposal_defer', proposalId: ask.id, reason}); setAsk(null); }}/>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}
