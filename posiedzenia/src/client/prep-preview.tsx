import {useMeeting} from './context.ts';
import {CardTitle, ErrorNotice, Field, Fold, Notice, Button, useAction} from './ui.tsx';
import {AgendaList} from './meeting.tsx';
import {MaterialLink} from './reader.tsx';
import {request, type MeetingData} from './api.ts';
import {useSession} from './session.ts';
import {PrepCard, ProposalsCard, WorkspacePanel} from './workspace.tsx';
import {isReferent} from '../shared/role.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {itemCommentCount} from './prep-rules.ts';
import type {AgendaItem} from '../shared/types.ts';
import type {ViewMeeting} from './context.ts';

// Widok członka w przygotowaniu (SPEC-4 6.5). API zamrożone: `<PrepPreview/>` bez właściwości, posiedzenie z `useMeeting()`
// (MeetingCtx z meeting.tsx). Na górze karta „Przygotowanie posiedzenia” (`PrepCard`), pod projektem porządku i materiałami
// zgłoszenia i uwagi przy punktach (`PrepWorkspace`). Osoba referująca dodaje materiał i nową wersję materiału do swojego
// punktu (B2-W11). Osoba z głosem doradczym widzi tylko „Zgłoś sprawę” i własne zgłoszenia (karta w trybie `wlasne`).
export function PrepPreview() {
  const {m, replace} = useMeeting();
  const md = m as MeetingData;
  return <div class="member">
    <PrepCard meeting={md} onChange={next => replace({meeting: next})}/>
    <Notice>Posiedzenie jest w przygotowaniu. Otworzy je przewodniczący lub wiceprzewodniczący. Wtedy na tym ekranie pojawi się potwierdzenie obecności i głosowania.</Notice>
    <section class="oi-card"><CardTitle level={2}>Projekt porządku obrad</CardTitle><AgendaList compact/></section>
    {m.materials.length > 0 && <section class="oi-card"><CardTitle level={2}>Materiały</CardTitle><div class="material-list">{m.materials.map(x => <MaterialLink key={x.id} id={x.id} version={x.version} label={x.title}/>)}</div></section>}
    <PrepWorkspace/>
  </div>;
}

/** Materiał od osoby referującej (B2-W11): nowy materiał do własnego punktu i nowa wersja własnego materiału. */
function ReferentMaterials(props: {it: AgendaItem; no: string}) {
  const {m, replace} = useMeeting();
  const {busy, error, errorKind, run} = useAction();
  const own = m.materials.filter(x => props.it.materialIds.includes(x.id));
  const sendFile = (path: string, form: FormData) => run(async () => replace(await request<{meeting: ViewMeeting}>(path, {form})));
  return <div class="stack-tight">
    {own.length > 0 && <ul class="plain-list">{own.map(x => <li key={x.id} class="stack-tight">
      <MaterialLink id={x.id} version={x.version} label={x.title}/>
      <form class="attach-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement); sendFile(`/api/meetings/${m.id}/materials/${x.id}/version`, f); (e.currentTarget as HTMLFormElement).reset(); }}>
        <Field label={`Nowa wersja materiału „${x.title}”`} hint="DOCX, PDF, TXT albo Markdown, do 10 MB."><input type="file" name="file" required accept=".docx,.pdf,.txt,.md,.markdown"/></Field>
        <Button small type="submit" busy={busy}>Wczytaj nową wersję</Button>
      </form>
    </li>)}</ul>}
    <form class="attach-row" onSubmit={e => { e.preventDefault(); const form = e.currentTarget as HTMLFormElement, f = new FormData(form); f.set('itemId', props.it.id); sendFile(`/api/meetings/${m.id}/materials`, f); form.reset(); }}>
      <Field label={`Materiał do punktu ${props.no}`} hint="DOCX, PDF, TXT albo Markdown, do 10 MB."><input type="file" name="file" required accept=".docx,.pdf,.txt,.md,.markdown"/></Field>
      <Button small type="submit" busy={busy}>Dodaj materiał</Button>
    </form>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/**
 * Zgłoszenia i uwagi przy punktach dla osób, które widzą przestrzeń roboczą, ale nie przygotowują posiedzenia (widok członka
 * i głosowania między posiedzeniami przed rozpoczęciem). Każdy punkt ma zwiniętą część „Uwagi do punktu {nr} ({n})”.
 */
export function PrepWorkspace() {
  const {m, replace} = useMeeting();
  const s = useSession();
  const md = m as MeetingData;
  const prep = md.prep;
  if (!prep || prep.scope !== 'pelny') return null;
  const onChange = (next: MeetingData) => replace({meeting: next});
  const noun = m.kind === 'procedura' ? 'sprawy' : 'punktu';
  return <>
    <ProposalsCard meeting={md} onChange={onChange}/>
    <section class="oi-card stack preview-comments" aria-labelledby="uwagi-punktow">
      <h2 class="oi-card__title" id="uwagi-punktow"><span class="oi-mark" aria-hidden="true"/><span>Uwagi do punktów</span></h2>
      <p class="small">Uwagi widzą członkowie Prezydium i biuro. Nie są materiałem posiedzenia i nie trafiają do protokołu.</p>
      {orderedAgenda(m.agenda).map(it => {
        const no = itemNumber(m.agenda, it.id);
        const referent = !prep.readOnly && isReferent(s.roster, m, it.id, s.personId);
        return <Fold key={it.id} title={`Uwagi do ${noun} ${no} (${itemCommentCount(prep.comments, it.id)})`}>
          <p class="small muted">{it.title}</p>
          {referent && <ReferentMaterials it={it} no={no}/>}
          <WorkspacePanel meeting={md} itemId={it.id} onChange={onChange}/>
        </Fold>;
      })}
    </section>
  </>;
}
