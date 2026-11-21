import {useEffect, useRef, useState} from 'preact/hooks';
import {download, request, upload, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {useGeneral} from './general.ts';
import {MailDialog} from './mail.tsx';
import {Button, CardTitle, Confirm, ErrorNotice, Fact, Field, fmtTime, Fold, Modal, Notice, Segments, StateChip, useAction} from './ui.tsx';
import {proposalChip} from './stany.ts';
import {canAcceptProposal, canPropose, canRejectProposal, canSeeWorkspace, canSendProgress, isReferent, organRoster} from '../shared/role.ts';
import {carriedText, PREP_LIMITS, PREP_REFUSALS, type Comment, type PrepCommand, type PrepView, type Proposal} from '../shared/workspace.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {personName} from '../shared/roster.ts';
import {dateDots, dateDotsOf} from '../shared/text.ts';
import {typo} from '../shared/typo.ts';
import type {Actor, Meeting, OrganCode, Roster} from '../shared/types.ts';
import {canEditComment, decisionText, itemThreads, waitingProposals, waitsForConvener} from './prep-rules.ts';
import './style/wspolpraca.css';

// Wspólne przygotowanie na ekranach (SPEC-4 6.5, B2 2.13 z poprawkami DB-14). Karta „Przygotowanie posiedzenia”
// (`PrepCard`), przestrzeń robocza punktu albo posiedzenia (`WorkspacePanel`: zgłoszenia z decyzją zwołującego albo uwagi
// przy punkcie), okno „Zgłoś sprawę” (`ProposalDialog`) i przestrzeń po zamknięciu do odczytu (`PrepArchive`). Dane
// przychodzą z widoku posiedzenia (`meeting.prep`), a każde polecenie zwraca nowy widok (`onChange`). W trakcie obrad
// przestrzeni nie ma w widoku (T-5), więc te komponenty nie wysyłają wtedy żadnych zapytań. Uprawnienia wyłącznie z role.ts.

const send = (meetingId: string, cmd: PrepCommand) => request<{meeting: MeetingData; prep: PrepView | null}>(`/api/meetings/${encodeURIComponent(meetingId)}/przygotowanie`, {body: {cmd}});
/** „3.12.2026” (dzień bez zera na początku, B2 2.13). */
const dShort = (iso: string) => { const [y, m, d] = iso.split('-'); return iso ? `${Number(d)}.${m}.${y}` : ''; };
const whenText = (at: number) => `${dateDotsOf(at)}, godz. ${fmtTime(at)}`;
const useActorOf = (): Actor => { const s = useSession(); return {account: s.account, personId: s.personId, name: s.name}; };
/** Przejście do części przygotowania (karta zgłoszeń, przegląd) przez układ przygotowania w prep.tsx. */
export function showPrep(target: string) {
  const e = new CustomEvent('posiedzenia:pokaz', {detail: target, cancelable: true});
  // Bez układu przygotowania (widok członka) przewinięcie do karty o identyfikatorze `ust-{cel}`.
  if (window.dispatchEvent(e)) { const el = document.getElementById(`ust-${target}`); el?.scrollIntoView({block: 'start'}); el?.focus({preventScroll: true}); }
}

/**
 * Okno „Zgłoś sprawę na posiedzenie {d.mm.rrrr}” (6.5, B2-W03). Bez posiedzenia (`organ`) zgłoszenie trafia do zbioru
 * „Zgłoszenia czekające na posiedzenie” (B2-W06); wtedy bez pliku, bo zbiór czekających nie ma trasy plików.
 * Z `edit` poprawa własnego zgłoszenia przed decyzją.
 */
export function ProposalDialog(props: {meeting?: Pick<MeetingData, 'id' | 'date' | 'noticeDate' | 'organ' | 'kind'>; organ?: OrganCode; edit?: Proposal; onClose: () => void; onDone: (r: {meeting?: MeetingData}) => void}) {
  const s = useSession();
  const bundle = useGeneral();
  const organ = props.meeting?.organ ?? props.organ ?? 'prezydium';
  const {busy, error, errorKind, run} = useAction();
  const [title, setTitle] = useState(props.edit?.title ?? '');
  const [why, setWhy] = useState(props.edit?.justification ?? '');
  const [caseType, setCaseType] = useState(props.edit?.caseType ?? '');
  const own = !!s.personId;
  const [who, setWho] = useState<'ja' | 'inna'>(!own || (props.edit?.presenterId && props.edit.presenterId !== s.personId) ? 'inna' : 'ja');
  const [other, setOther] = useState(props.edit?.presenterId && props.edit.presenterId !== s.personId ? props.edit.presenterId : '');
  const file = useRef<HTMLInputElement>(null);
  const caseTypes = (bundle?.general.caseTypes ?? []).filter(c => c.active && c.organs.includes(organ));
  const people = s.roster.memberships.filter(ms => ms.organ === organ && ms.personId !== s.personId).map(ms => [ms.personId, `${personName(s.roster, ms.personId)}, ${ms.label}`] as [string, string]);
  const heading = props.edit ? 'Popraw zgłoszenie' : props.meeting ? `Zgłoś sprawę na posiedzenie ${dShort(props.meeting.date)}` : 'Zgłoś sprawę na najbliższe posiedzenie';
  const submit = (e: Event) => {
    e.preventDefault();
    run(async () => {
      const presenterId = who === 'ja' ? s.personId ?? undefined : other || undefined;
      if (props.edit && props.meeting) {
        const r = await send(props.meeting.id, {type: 'proposal_edit', proposalId: props.edit.id, title, justification: why, caseType: caseType || null, presenterId: presenterId ?? null});
        props.onDone({meeting: r.meeting});
        return;
      }
      let attachmentId: string | undefined;
      const f = file.current?.files?.[0];
      if (f && props.meeting) {
        const form = new FormData();
        form.set('file', f);
        attachmentId = (await upload<{attachment: {id: string}}>(`/api/meetings/${encodeURIComponent(props.meeting.id)}/przygotowanie/pliki`, form)).attachment.id;
      }
      const cmd: PrepCommand = {type: 'proposal_add', title, justification: why, ...(caseType ? {caseType} : {}), ...(presenterId ? {presenterId} : {}), ...(attachmentId ? {attachmentId} : {})};
      if (props.meeting) props.onDone({meeting: (await send(props.meeting.id, cmd)).meeting});
      else { await request(`/api/organs/${organ}/czekajace`, {body: {cmd}}); props.onDone({}); }
    });
  };
  return <Modal title={heading} onClose={props.onClose}>
    <form class="stack" onSubmit={submit}>
      <Field label="Nazwa sprawy"><input value={title} required maxLength={PREP_LIMITS.title} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      <Field label="Uzasadnienie" hint="Dlaczego sprawa ma trafić na to posiedzenie."><textarea rows={4} value={why} required maxLength={PREP_LIMITS.justification} onInput={e => setWhy((e.target as HTMLTextAreaElement).value)}/></Field>
      {caseTypes.length > 0 && <Field label="Rodzaj sprawy" hint="Nieobowiązkowe.">
        <select value={caseType} onChange={e => setCaseType((e.target as HTMLSelectElement).value)}><option value="">Bez rodzaju sprawy</option>{caseTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </Field>}
      {own && <Segments label="Kto referuje" value={who} options={[['ja', 'Ja'], ['inna', 'Inna osoba']]} onChange={setWho}/>}
      {who === 'inna' && people.length > 0 && <Field label={own ? 'Osoba referująca' : 'Kto referuje'}>
        <select value={other} onChange={e => setOther((e.target as HTMLSelectElement).value)}><option value="">Nie wskazuję</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </Field>}
      {props.meeting && !props.edit && <Field label="Plik" hint="Nieobowiązkowy. DOCX, PDF, TXT albo Markdown, do 10 MB."><input ref={file} type="file" accept=".docx,.pdf,.txt,.md,.markdown"/></Field>}
      <p class="small">Zgłoszenie trafi do osób przygotowujących posiedzenie. O odrzuceniu albo odłożeniu decyduje zwołujący.</p>
      {props.meeting?.noticeDate && props.meeting.kind === 'posiedzenie' && <Notice tone="warn" label="Ważne">{`Zawiadomienie o tym posiedzeniu wysłano ${dateDots(props.meeting.noticeDate)}. Sprawa wpisana teraz będzie w protokole ze zdaniem, że nie było jej w zawiadomieniu (§ 7 ust. 1).`}</Notice>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>{props.edit ? 'Zapisz zgłoszenie' : 'Zgłoś sprawę'}</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/** Karta „Przygotowanie posiedzenia”: postęp, braki, zgłoszenia czekające i zdanie o zawiadomieniu (6.5). Bez `is-teraz` i bez przycisku głównego. */
export function PrepCard(props: {meeting: MeetingData; onChange?: (m: MeetingData) => void}) {
  const s = useSession();
  const actor = useActorOf();
  const [mail, setMail] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [saved, setSaved] = useState('');
  const prep = props.meeting.prep;
  if (!prep) return props.meeting.status === 'trwa' || props.meeting.status === 'przerwa' ? <p class="muted">{PREP_REFUSALS.later}</p> : null;
  const p = prep.progress;
  const proposer = !prep.readOnly && canPropose(s.roster, props.meeting, actor);
  const done = (r: {meeting?: MeetingData}) => { setProposing(false); setSaved(`Zapisano o godz. ${fmtTime(Date.now())}.`); if (r.meeting) props.onChange?.(r.meeting); };
  const sender = !prep.readOnly && canSendProgress(s.roster, props.meeting, actor) && !!s.mail?.enabled;
  if (prep.scope === 'wlasne') return <section class="oi-card stack prep-card" id="przygotowanie-posiedzenia">
    <CardTitle level={2}>Przygotowanie posiedzenia</CardTitle>
    <p class="small">Zgłoszenie trafi do osób przygotowujących posiedzenie. O odrzuceniu albo odłożeniu decyduje zwołujący.</p>
    {proposer && <div><Button haspopup onClick={() => setProposing(true)}>Zgłoś sprawę</Button></div>}
    <p role="status" class="save-status">{saved}</p>
    <WorkspacePanel meeting={props.meeting} onChange={m => props.onChange?.(m)}/>
    {proposing && <ProposalDialog meeting={props.meeting} onClose={() => setProposing(false)} onDone={done}/>}
  </section>;
  const waiting = waitingProposals(prep);
  // W-W4-04: fakt „Referujesz punkt {nr}.” dla osoby referującej (materiał dodaje w karcie „Twoje punkty”).
  const mineNo = orderedAgenda(props.meeting.agenda).filter(it => isReferent(s.roster, props.meeting, it.id, s.personId)).map(it => itemNumber(props.meeting.agenda, it.id));
  const one = props.meeting.kind === 'procedura' ? ['sprawę', 'sprawy'] : ['punkt', 'punkty'];
  const referring = !mineNo.length ? '' : mineNo.length === 1 ? `Referujesz ${one[0]} ${mineNo[0]}.` : `Referujesz ${one[1]} ${mineNo.slice(0, -1).join(', ')} i ${mineNo.at(-1)}.`;
  return <section class="oi-card stack prep-card" id="przygotowanie-posiedzenia">
    <CardTitle level={2}>Przygotowanie posiedzenia</CardTitle>
    {p.total > 0 && <p class="prep-progress">{p.text}</p>}
    {p.missing && <div class="prep-line"><p>{p.missing}</p>{canAcceptProposal(s.roster, props.meeting, actor) && <Button kind="ghost" small quiet label="Pokaż braki w przeglądzie przed otwarciem" onClick={() => showPrep('przeglad')}>Pokaż</Button>}</div>}
    <dl class="facts">
      <Fact label="Zgłoszenia czekające na decyzję zwołującego"><span class="prep-line">{String(waiting)}{waiting > 0 && <Button kind="ghost" small quiet label="Pokaż zgłoszenia" onClick={() => showPrep('zgloszenia')}>Pokaż</Button>}</span></Fact>
    </dl>
    {p.notice && <p class="small">{p.notice}</p>}
    {referring && <p class="small">{typo(referring)}</p>}
    {prep.readOnly && <Notice>{PREP_REFUSALS.opened}</Notice>}
    {(proposer || sender) && <div class="actions">
      {proposer && <Button haspopup onClick={() => setProposing(true)}>Zgłoś sprawę</Button>}
      {sender && <Button haspopup onClick={() => setMail(true)}>Wyślij informację o postępie</Button>}
    </div>}
    <p role="status" class="save-status">{saved}</p>
    {proposing && <ProposalDialog meeting={props.meeting} onClose={() => setProposing(false)} onDone={done}/>}
    {mail && <MailDialog meeting={props.meeting} kind="postep" onClose={() => setMail(false)}/>}
  </section>;
}

/** Karta „Zgłoszenia ({n})” pod „Materiały” (6.5): lista zgłoszeń z decyzjami według uprawnień. */
export function ProposalsCard(props: {meeting: MeetingData; onChange: (m: MeetingData) => void}) {
  const prep = props.meeting.prep;
  if (!prep || prep.scope !== 'pelny') return null;
  return <section class="oi-card stack" id="ust-zgloszenia" tabIndex={-1} aria-labelledby="zgloszenia-tytul">
    <h2 class="oi-card__title" id="zgloszenia-tytul"><span class="oi-mark" aria-hidden="true"/><span>{`Zgłoszenia (${waitingProposals(prep)})`}</span></h2>
    <WorkspacePanel meeting={props.meeting} onChange={props.onChange}/>
  </section>;
}

/** „Ewa Przykładowa, Członek Prezydium” (B2 2.13, W-W4-22): funkcja ze składu, osoba spoza składu zgłasza z głosem doradczym. */
function proposer(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, p: Proposal) {
  const person = roster.persons.find(x => x.name === p.byName);
  const func = person ? organRoster(roster, m).find(x => x.personId === person.id)?.label ?? '' : 'głos doradczy';
  return func ? `${p.byName}, ${func}` : p.byName;
}

function ProposalRow(props: {p: Proposal; meeting: MeetingData; onAsk: (type: 'proposal_accept' | 'proposal_reject' | 'proposal_defer') => void; onEdit: () => void; onWithdraw: () => void; busy: boolean}) {
  const s = useSession();
  const actor = useActorOf();
  const {p, meeting} = props;
  const prep = meeting.prep!;
  const open = !prep.readOnly && p.state === 'zgloszone';
  const preparer = prep.scope === 'pelny' && canAcceptProposal(s.roster, meeting, actor);
  const decides = canRejectProposal(s.roster, meeting, actor);
  const mine = p.accountId === s.account.id;
  const no = p.decision?.itemId ? itemNumber(meeting.agenda, p.decision.itemId) : '';
  const carried = carriedText(p);
  return <li class="proposal">
    <div class="proposal__head"><strong>{`„${p.title}”`}</strong><StateChip state={proposalChip(p.state, waitsForConvener(p, preparer, decides))}/></div>
    <p class="small">{`${proposer(s.roster, meeting as unknown as Meeting, p)}, ${dateDotsOf(p.at)}. ${p.justification}`}{p.attachment && <> <button type="button" class="link" onClick={() => download(`/api/meetings/${encodeURIComponent(meeting.id)}/przygotowanie/pliki/${p.attachment!.id}`)}>{`Plik „${p.attachment.name}”.`}</button></>}</p>
    {carried && <p class="small muted">{carried}</p>}
    {p.state === 'wpisane' && <p class="small">{`Wpisane do projektu${no ? ` jako punkt ${no}` : ''}. ${p.decision?.by ?? ''}, ${p.decision ? dateDotsOf(p.decision.at) : ''}.`}</p>}
    {(p.state === 'odrzucone' || p.state === 'odlozone' || p.state === 'wygasle') && p.decision && <p class="small">{`${decisionText(p)}, ${dateDotsOf(p.decision.at)}.`}</p>}
    {open && preparer && <div class="actions">
      <Button small haspopup busy={props.busy} onClick={() => props.onAsk('proposal_accept')}>Wpisz do projektu</Button>
      {decides && <Button small kind="ghost" quiet haspopup onClick={() => props.onAsk('proposal_defer')}>Odłóż</Button>}
      {decides && <Button small kind="ghost" quiet haspopup onClick={() => props.onAsk('proposal_reject')}>Odrzuć</Button>}
    </div>}
    {open && preparer && !decides && <p class="small">{PREP_REFUSALS.reject}</p>}
    {open && mine && <div class="actions">
      <Button small kind="ghost" quiet haspopup onClick={props.onEdit}>Popraw zgłoszenie</Button>
      <Button small kind="ghost" quiet haspopup onClick={props.onWithdraw}>Wycofaj zgłoszenie</Button>
    </div>}
  </li>;
}

/** Okno „Wpisać zgłoszenie „{nazwa}” do projektu porządku?” (B2 2.13, DB-14): nazwa punktu i miejsce, uwaga „Ważne” po zawiadomieniu. */
function AcceptDialog(props: {p: Proposal; meeting: MeetingData; decides: boolean; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [title, setTitle] = useState(props.p.title);
  const [place, setPlace] = useState<'przed_wolnymi_wnioskami' | 'w_uchwalach'>('przed_wolnymi_wnioskami');
  const sitting = props.meeting.kind === 'posiedzenie';
  const hasResolutions = props.meeting.agenda.some(i => i.kind === 'uchwaly' && !i.parentId);
  return <Modal title={`Wpisać zgłoszenie „${props.p.title}” do projektu porządku?`} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => { props.onDone((await send(props.meeting.id, {type: 'proposal_accept', proposalId: props.p.id, title, place})).meeting); }); }}>
      <p>Sprawa stanie się punktem projektu porządku obrad. Plik dołączy do materiałów punktu, a osoba zgłaszająca zobaczy stan „Wpisane do projektu”.</p>
      <Field label={sitting ? 'Nazwa punktu' : 'Nazwa sprawy'}><input value={title} required maxLength={PREP_LIMITS.title} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      {sitting && hasResolutions && <Segments column label="Miejsce" value={place} options={[['przed_wolnymi_wnioskami', 'Przed punktem „Informacje bieżące i wolne wnioski”'], ['w_uchwalach', 'Jako podpunkt punktu „Podjęcie uchwał”']]} onChange={setPlace}/>}
      {props.meeting.noticeDate && sitting && <Notice tone="warn" label="Ważne">{`Zawiadomienie wysłano ${dateDots(props.meeting.noticeDate)}. Punkt wpisany teraz nie był w zawiadomieniu i to zdanie trafi do protokołu (§ 7 ust. 1).${props.decides ? ' Możesz też odłożyć zgłoszenie na następne posiedzenie.' : ''}`}</Notice>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Wpisz do projektu</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

function Thread(props: {root: Comment; replies: Comment[]; meeting: MeetingData; all: Comment[]; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const actor = useActorOf();
  const {busy, error, errorKind, run} = useAction();
  const [reply, setReply] = useState<string | null>(null);
  const [editing, setEditing] = useState<{id: string; text: string} | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const prep = props.meeting.prep!;
  const writable = !prep.readOnly && prep.scope === 'pelny';
  const preparer = canAcceptProposal(s.roster, props.meeting, actor);
  const act = (cmd: PrepCommand, after?: () => void) => run(async () => { props.onChange((await send(props.meeting.id, cmd)).meeting); after?.(); });
  const one = (c: Comment) => <div class="comment" key={c.id}>
    <p class="comment__by small">{`${c.byName}, ${whenText(c.at)}`}{c.editedAt && !c.deleted ? ', Poprawiono' : ''}</p>
    {c.deleted ? <p class="muted">{`Uwagę usunięto. ${c.byName}, godz. ${fmtTime(c.deleted.at)}.`}</p>
      : editing?.id === c.id ? <form class="stack-tight" onSubmit={e => { e.preventDefault(); act({type: 'comment_edit', commentId: c.id, text: editing.text}, () => setEditing(null)); }}>
        <Field label="Poprawiona uwaga"><textarea rows={3} maxLength={PREP_LIMITS.comment} value={editing.text} onInput={e => setEditing({id: c.id, text: (e.target as HTMLTextAreaElement).value})}/></Field>
        <div class="actions"><Button small type="submit" busy={busy}>Zapisz uwagę</Button><Button small kind="ghost" onClick={() => setEditing(null)}>Anuluj</Button></div>
      </form>
      : <p class="comment__text">{c.text}</p>}
    {writable && !c.deleted && c.accountId === s.account.id && editing?.id !== c.id && <div class="actions">
      {canEditComment(c, props.all, s.account.id, Date.now()) && <Button small kind="ghost" quiet onClick={() => setEditing({id: c.id, text: c.text})}>Popraw</Button>}
      <Button small kind="ghost" quiet haspopup onClick={() => setRemoving(c.id)}>Usuń</Button>
    </div>}
  </div>;
  const {root} = props;
  return <li class={'thread' + (root.resolved ? ' is-resolved' : '')}>
    {one(root)}
    {props.replies.length > 0 && <div class="thread__replies">{props.replies.map(one)}</div>}
    {root.resolved && <p class="small muted">{`Wątek rozstrzygnięty. ${root.resolved.by}, ${whenText(root.resolved.at)}.`}</p>}
    {writable && <div class="actions">
      {reply === null && !root.deleted && <Button small kind="ghost" quiet onClick={() => setReply('')}>Odpowiedz</Button>}
      {(root.accountId === s.account.id || preparer) && <Button small kind="ghost" quiet busy={busy} onClick={() => act({type: 'thread_resolve', commentId: root.id, on: !root.resolved})}>{root.resolved ? 'Otwórz wątek ponownie' : 'Oznacz wątek jako rozstrzygnięty'}</Button>}
    </div>}
    {reply !== null && <form class="stack-tight" onSubmit={e => { e.preventDefault(); act({type: 'comment_add', target: root.target, parentId: root.id, text: reply}, () => setReply(null)); }}>
      <Field label="Twoja odpowiedź"><textarea rows={2} maxLength={PREP_LIMITS.comment} value={reply} onInput={e => setReply((e.target as HTMLTextAreaElement).value)}/></Field>
      <div class="actions"><Button small type="submit" busy={busy}>Odpowiedz</Button><Button small kind="ghost" onClick={() => setReply(null)}>Anuluj</Button></div>
    </form>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {removing && <Confirm title="Usunąć uwagę?" text={<p>Zamiast treści zostanie zdanie „Uwagę usunięto.” z Twoim imieniem i nazwiskiem oraz godziną.</p>} confirm="Usuń uwagę" kind="danger" focus="cancel"
      onClose={() => setRemoving(null)} onConfirm={() => { const id = removing; setRemoving(null); act({type: 'comment_delete', commentId: id}); }}/>}
  </li>;
}

function Comments(props: {meeting: MeetingData; itemId: string; onChange: (m: MeetingData) => void}) {
  const [text, setText] = useState('');
  const {busy, error, errorKind, run} = useAction();
  const prep = props.meeting.prep!;
  const threads = itemThreads(prep.comments, props.itemId);
  return <div class="stack prep-comments-box">
    {threads.length ? <ol class="prep-comments">{threads.map(t => <Thread key={t.root.id} root={t.root} replies={t.replies} meeting={props.meeting} all={prep.comments} onChange={props.onChange}/>)}</ol>
      : <p class="muted">Nie ma jeszcze uwag do tego punktu.</p>}
    {!prep.readOnly && prep.scope === 'pelny' && <form class="stack-tight" onSubmit={e => { e.preventDefault(); run(async () => { const r = await send(props.meeting.id, {type: 'comment_add', target: {kind: 'punkt', itemId: props.itemId}, text}); setText(''); props.onChange(r.meeting); }); }}>
      <Field label="Twoja uwaga" hint="Uwagi widzą członkowie Prezydium i biuro. Nie są materiałem posiedzenia i nie trafiają do protokołu."><textarea rows={3} maxLength={PREP_LIMITS.comment} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)}/></Field>
      <div><Button type="submit" busy={busy} disabled={!text.trim()} reason="Wpisz treść uwagi.">Dodaj uwagę</Button></div>
    </form>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/**
 * Przestrzeń robocza: bez `itemId` lista zgłoszeń z decyzjami według uprawnień (G-30), z `itemId` uwagi przy punkcie.
 * Odrzucenie i odłożenie tylko u zwołującego (`canRejectProposal`), u pozostałych osób przygotowujących stan
 * „Czeka na decyzję zwołującego” i zdanie z G-30 (K4-3).
 */
export function WorkspacePanel(props: {meeting: MeetingData; itemId?: string | null; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const actor = useActorOf();
  const {busy, error, errorKind, run} = useAction();
  const [ask, setAsk] = useState<{p: Proposal; type: 'proposal_accept' | 'proposal_reject' | 'proposal_defer' | 'proposal_withdraw' | 'edit'} | null>(null);
  const prep = props.meeting.prep;
  if (!prep) return null;
  if (props.itemId) return <Comments meeting={props.meeting} itemId={props.itemId} onChange={props.onChange}/>;
  const decides = canRejectProposal(s.roster, props.meeting, actor);
  const act = (cmd: PrepCommand) => run(async () => props.onChange((await send(props.meeting.id, cmd)).meeting));
  const list = [...prep.proposals].sort((a, b) => (a.state === 'zgloszone' ? 0 : 1) - (b.state === 'zgloszone' ? 0 : 1) || a.at - b.at);
  return <div class="stack prep-proposals">
    {list.length ? <ul class="proposal-list">{list.map(p => <ProposalRow key={p.id} p={p} meeting={props.meeting} busy={busy}
      onAsk={type => setAsk({p, type})} onEdit={() => setAsk({p, type: 'edit'})} onWithdraw={() => setAsk({p, type: 'proposal_withdraw'})}/>)}</ul>
      : <p class="muted">{prep.scope === 'wlasne' ? 'Nie masz jeszcze zgłoszeń przy tym posiedzeniu.' : 'Nikt jeszcze nie zgłosił sprawy na to posiedzenie.'}</p>}
    {ask?.type === 'proposal_accept' && <AcceptDialog p={ask.p} meeting={props.meeting} decides={decides} onClose={() => setAsk(null)} onDone={m => { setAsk(null); props.onChange(m); }}/>}
    {ask && (ask.type === 'proposal_reject' || ask.type === 'proposal_defer') && <Confirm title={ask.type === 'proposal_reject' ? 'Odrzucić zgłoszenie?' : 'Odłożyć zgłoszenie na następne posiedzenie?'} text={<p>{`„${ask.p.title}”`}</p>}
      confirm={ask.type === 'proposal_reject' ? 'Odrzuć' : 'Odłóż'} cancel="Anuluj" focus="field" field={{label: 'Powód', hint: 'Zobaczy go osoba zgłaszająca.', required: true, maxLength: PREP_LIMITS.reason}}
      onClose={() => setAsk(null)} onConfirm={reason => { const a = ask; setAsk(null); act({type: a.type as 'proposal_reject' | 'proposal_defer', proposalId: a.p.id, reason: reason ?? ''}); }}/>}
    {ask?.type === 'proposal_withdraw' && <Confirm title="Wycofać zgłoszenie?" text={<p>{`„${ask.p.title}” nie trafi do osób przygotowujących posiedzenie.`}</p>} confirm="Wycofaj zgłoszenie" cancel="Anuluj" focus="cancel"
      onClose={() => setAsk(null)} onConfirm={() => { const a = ask; setAsk(null); act({type: 'proposal_withdraw', proposalId: a.p.id}); }}/>}
    {ask?.type === 'edit' && <ProposalDialog meeting={props.meeting} edit={ask.p} onClose={() => setAsk(null)} onDone={r => { setAsk(null); if (r.meeting) props.onChange(r.meeting); }}/>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/**
 * „Przygotowanie (tylko do odczytu)” po zamknięciu (6.5, S-25): zwinięta sekcja, ładowana po rozwinięciu przez
 * `GET /api/meetings/:id/przygotowanie`, przez 90 dni od zamknięcia; potem zdanie o usunięciu.
 */
export function PrepArchive(props: {meeting: MeetingData}) {
  const s = useSession();
  const actor = useActorOf();
  if (!canSeeWorkspace(s.roster, props.meeting, actor)) return null;
  return <PrepArchiveFold meeting={props.meeting}/>;
}
function PrepArchiveFold(props: {meeting: MeetingData}) {
  const {roster} = useSession();
  const [prep, setPrep] = useState<PrepView | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const old = !!props.meeting.closedAt && Date.now() - props.meeting.closedAt > PREP_LIMITS.keepDays * 86400000;
  useEffect(() => {
    if (!open || prep !== undefined || old) return;
    request<{prep: PrepView | null}>(`/api/meetings/${encodeURIComponent(props.meeting.id)}/przygotowanie`).then(r => { setError(''); setPrep(r.prep); }).catch(e => setError((e as Error).message));
  }, [open]);
  if (old) return <p class="muted small">Uwagi z przygotowania usunięto po 90 dniach.</p>;
  const roots = prep ? prep.comments.filter(c => !c.parentId) : [];
  const noun = props.meeting.kind === 'procedura' ? 'sprawie' : 'punkcie';
  return <Fold title="Przygotowanie (tylko do odczytu)" onToggle={setOpen}>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {prep === undefined && !error && <p class="muted">Wczytywanie…</p>}
    {prep === null && <p class="muted">Uwagi z przygotowania usunięto po 90 dniach.</p>}
    {prep && <div class="stack">
      <p class="small">Uwagi i zgłoszenia z przygotowania nie są materiałem posiedzenia i nie trafiają do protokołu.</p>
      <h3 class="kicker">{`Zgłoszenia (${prep.proposals.length})`}</h3>
      {prep.proposals.length ? <ul class="proposal-list">{prep.proposals.map(p => <li key={p.id} class="proposal">
        <div class="proposal__head"><strong>{`„${p.title}”`}</strong><StateChip state={proposalChip(p.state)}/></div>
        <p class="small">{`${proposer(roster, props.meeting as unknown as Meeting, p)}, ${dateDotsOf(p.at)}. ${p.justification}`}</p>
        {p.decision && p.state !== 'wpisane' && <p class="small">{`${decisionText(p)}, ${dateDotsOf(p.decision.at)}.`}</p>}
      </li>)}</ul> : <p class="muted">Nikt nie zgłosił sprawy na to posiedzenie.</p>}
      <h3 class="kicker">{`Uwagi (${roots.length})`}</h3>
      {roots.length ? <ol class="prep-comments">{roots.map(c => {
        const it = c.target.kind === 'punkt' ? (c.target as {itemId: string}).itemId : null;
        return <li key={c.id} class="thread">
          <p class="comment__by small">{`${c.byName}, ${whenText(c.at)}${it && props.meeting.agenda.some(i => i.id === it) ? `, w ${noun} ${itemNumber(props.meeting.agenda, it)}` : ''}`}</p>
          <p class="comment__text">{c.deleted ? 'Uwagę usunięto.' : c.text}</p>
          {prep.comments.filter(r => r.parentId === c.id).map(r => <div class="thread__replies" key={r.id}><p class="comment__by small">{`${r.byName}, ${whenText(r.at)}`}</p><p class="comment__text">{r.deleted ? 'Uwagę usunięto.' : r.text}</p></div>)}
        </li>;
      })}</ol> : <p class="muted">Nie było uwag.</p>}
    </div>}
  </Fold>;
}

/** Liczba zgłoszeń na liście posiedzeń: „Zgłoszenia czekające na posiedzenie {n}” (B2-W06). */
export const waitingSentence = (n: number) => `Zgłoszenia czekające na posiedzenie ${n}`;
/** Okno z listą zgłoszeń czekających na posiedzenie organu (lista posiedzeń, osoby przygotowujące). */
export function WaitingDialog(props: {proposals: Proposal[]; onClose: () => void}) {
  const {roster} = useSession();
  return <Modal title={`Zgłoszenia czekające na posiedzenie (${props.proposals.length})`} onClose={props.onClose}>
    {props.proposals.length ? <ul class="proposal-list">{props.proposals.map(p => <li key={p.id} class="proposal">
      <div class="proposal__head"><strong>{`„${p.title}”`}</strong><StateChip state={proposalChip(p.state)}/></div>
      <p class="small">{`${proposer(roster, {organ: 'prezydium'}, p)}, ${dateDotsOf(p.at)}. ${p.justification}`}</p>
      {carriedText(p) && <p class="small muted">{carriedText(p)}</p>}
    </li>)}</ul> : <p class="muted">{`Nie ma zgłoszeń czekających na posiedzenie.`}</p>}
    <div class="actions"><Button onClick={props.onClose}>Zamknij</Button></div>
  </Modal>;
}

