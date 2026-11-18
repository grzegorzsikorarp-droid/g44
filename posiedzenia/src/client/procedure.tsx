import {useState} from 'preact/hooks';
import {canChairOrgan} from '../shared/meeting.ts';
import {itemNumber, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, VoteMode} from '../shared/types.ts';
import {useMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, Confirm, Countdown, Field, Notice} from './ui.tsx';
import {ResultCard, VoteCard} from './meeting.tsx';
import {AgendaEditor, DeleteMeeting, MaterialsEditor} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';

// Głosowanie między posiedzeniami Prezydium (§ 14 ust. 5 Regulaminu ORPiP).
export function ProcedureView() {
  const {m} = useMeeting();
  const s = useSession();
  const total = organMembers(s.roster, m.organ).length;
  if (m.status === 'przygotowanie') {
    if (!s.isOrganizer(m.organ)) return <div class="stack"><Notice>Głosowanie jeszcze się nie rozpoczęło. Przygotowuje je biuro lub prowadzący.</Notice><Acts/></div>;
    return <div class="prep">
      <div class="prep-main">
        <section class="card"><h3>Sprawy do głosowania</h3><p class="muted small">Każda sprawa (np. uchwała) to osobne głosowanie. Dołącz do niej dokument, aby członkowie mogli go przeczytać przed oddaniem głosu.</p><AgendaEditor/></section>
        {m.agenda.length > 0 && <section class="card"><h3>Ustawienia głosowań</h3>{m.agenda.filter(i => !i.parentId).map(it => <ActSettings it={it}/>)}</section>}
        <section class="card"><h3>Dokumenty ({m.materials.length})</h3><MaterialsEditor/></section>
      </div>
      <aside class="prep-side"><Start/><Window/><Messages/><DeleteMeeting/></aside>
    </div>;
  }
  const conductor = canChairOrgan(s.roster, m.organ, s.personId);
  return <div class="procedure">
    <div class="procedure-main">
      {m.status === 'trwa' && m.endsAt && <section class="card window">
        <p class="kicker">Głosowanie trwa</p>
        <p class="window-time"><Countdown endsAt={m.endsAt}/></p>
        <p class="muted small">Głosuje {total} członków Prezydium. Rozstrzygnięcie zapada przy udziale co najmniej {quorumFor(total)} głosujących (§ 8 ust. 2) zwykłą większością głosów. Głosowanie kończy się wcześniej, gdy zagłosują wszyscy.</p>
      </section>}
      {m.status === 'zakonczone' && <Notice tone="ok">Głosowanie zakończone. Wyniki poniżej; zestawienie do protokołu — przycisk „Projekt protokołu”.</Notice>}
      <Acts/>
      {conductor && m.status === 'trwa' && <EndEarly/>}
    </div>
    <aside class="procedure-side"><Messages/></aside>
  </div>;
}

function Acts() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const conductor = canChairOrgan(s.roster, m.organ, s.personId) || s.isOrganizer(m.organ);
  return <div class="acts">{m.agenda.filter(i => !i.parentId).map(it => {
    const b = m.ballots.find(x => x.itemId === it.id);
    const mats = m.materials.filter(x => it.materialIds.includes(x.id));
    return <section class="card act">
      <p class="kicker">Sprawa {itemNumber(m.agenda, it.id)}{it.mode ? ` · głosowanie ${it.mode}` : ''}</p>
      <h2>{it.title}</h2>
      {mats.length > 0 ? <div class="material-list">{mats.map(x => <MaterialLink id={x.id} version={b?.material?.id === x.id ? b.material.version : x.version} label={x.title}/>)}</div> : <p class="muted small">Bez dołączonego dokumentu.</p>}
      {b?.status === 'otwarte' && <VoteCard b={b}/>}
      {b?.status === 'zamkniete' && <><ResultCard b={b}/>{conductor && !b.announcedAt && <Button kind="primary" disabled={busy} onClick={() => send({type: 'announce', ballotId: b.id})}>Ogłoś wynik</Button>}</>}
    </section>;
  })}</div>;
}

function ActSettings({it}: {it: AgendaItem}) {
  const {m, send, busy} = useMeeting();
  const [mode, setMode] = useState<VoteMode>(it.mode ?? 'jawne');
  const [basis, setBasis] = useState(it.modeBasis ?? '');
  const others = m.materials.filter(x => !it.materialIds.includes(x.id));
  return <div class="act-settings">
    <p class="strong">{itemNumber(m.agenda, it.id)}. {it.title}</p>
    <div class="row">
      <Field label="Tryb głosowania"><select value={mode} onChange={e => setMode((e.target as HTMLSelectElement).value as VoteMode)}><option value="jawne">Jawne</option><option value="imienne">Imienne</option><option value="tajne">Tajne</option></select></Field>
      {mode !== 'jawne' && <Field label="Podstawa (§ 11 ust. 2)" hint="Postanowienie Prezydium o głosowaniu tajnym/imiennym."><input value={basis} onInput={e => setBasis((e.target as HTMLInputElement).value)} maxLength={300} placeholder="np. postanowienie z posiedzenia 22.10.2026"/></Field>}
    </div>
    <div class="actions">
      <Button small disabled={busy || (mode === (it.mode ?? 'jawne') && basis === (it.modeBasis ?? ''))} onClick={() => send({type: 'item_mode', itemId: it.id, mode, basis})}>Zapisz tryb</Button>
      {others.length > 0 && <select aria-label="Dołącz dokument" onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) send({type: 'item_material', itemId: it.id, materialId: v, on: true}); (e.target as HTMLSelectElement).value = ''; }}><option value="">+ Dołącz dokument…</option>{others.map(x => <option value={x.id}>{x.title}</option>)}</select>}
    </div>
  </div>;
}

function Window() {
  const {m, send, busy} = useMeeting();
  const local = (ts?: number) => ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return <section class="card">
    <h3>Czas głosowania</h3>
    <form class="stack" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); send({type: 'details', title: String(f.get('title')), endsAt: new Date(String(f.get('endsAt'))).getTime()}); }}>
      <Field label="Tytuł"><input name="title" defaultValue={m.title} required maxLength={200}/></Field>
      <Field label="Koniec głosowania" hint="Zwykle kilka godzin. Członkowie widzą licznik pozostałego czasu."><input name="endsAt" type="datetime-local" defaultValue={local(m.endsAt)} required/></Field>
      <Button type="submit" disabled={busy}>Zapisz</Button>
    </form>
  </section>;
}

function Start() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [confirm, setConfirm] = useState(false);
  const acts = m.agenda.filter(i => !i.parentId);
  const withoutDoc = acts.filter(i => !i.materialIds.length);
  if (!canChairOrgan(s.roster, m.organ, s.personId)) return <section class="card"><h3>Rozpoczęcie</h3><p class="muted small">Głosowanie rozpocznie przewodniczący lub wiceprzewodniczący. Wtedy członkowie dostaną dostęp do kart.</p></section>;
  return <section class="card highlight">
    <h3>Rozpoczęcie głosowania</h3>
    <p class="small">Wszystkie sprawy ({acts.length}) zostaną otwarte jednocześnie do {m.endsAt ? new Intl.DateTimeFormat('pl-PL', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Warsaw'}).format(m.endsAt) : '—'}.</p>
    {withoutDoc.length > 0 && <Notice tone="warn">Bez dokumentu: {withoutDoc.map(i => itemNumber(m.agenda, i.id)).join(', ')}.</Notice>}
    <Button kind="primary" wide disabled={busy || !acts.length} onClick={() => setConfirm(true)}>Rozpocznij głosowanie</Button>
    {confirm && <Confirm title="Rozpocząć głosowanie?" confirm="Rozpocznij" onClose={() => setConfirm(false)} onConfirm={() => send({type: 'open'})} text={<p>Po rozpoczęciu nie można zmieniać spraw ani dokumentów, nad którymi się głosuje. Członkowie zagłosują na swoich telefonach.</p>}/>}
  </section>;
}

function EndEarly() {
  const {send, busy} = useMeeting();
  const [confirm, setConfirm] = useState(false);
  return <div class="actions"><Button kind="ghost" disabled={busy} onClick={() => setConfirm(true)}>Zakończ głosowanie przed czasem</Button>
    {confirm && <Confirm title="Zakończyć przed czasem?" kind="danger" confirm="Zakończ" onClose={() => setConfirm(false)} onConfirm={() => send({type: 'close'})} text={<p>Wszystkie trwające głosowania zostaną zamknięte. Osoby, które jeszcze nie głosowały, nie będą już mogły tego zrobić.</p>}/>}
  </div>;
}
