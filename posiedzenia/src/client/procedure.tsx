import {useEffect, useId, useState} from 'preact/hooks';
import {canChairOrgan} from '../shared/meeting.ts';
import {awaitingVote, itemNumber, materialTypeOf, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, VoteMode} from '../shared/types.ts';
import {useNow} from './api.ts';
import {useMeeting, type ViewBallot} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Confirm, Countdown, Fact, Field, fmtDateTime, Fold, Notice, plural, TitleLead, useSaveStatus} from './ui.tsx';
import {modeName} from './stany.ts';
import {RejectedVote, ResultCard, VoteCard} from './meeting.tsx';
import {AgendaEditor, DeleteMeeting, MaterialsEditor, SaveLine, Segments, useLeaveWarning} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';

// Tryb w rodzaju męskim: „tryb jawny”.
const modeAdjective: Record<VoteMode, string> = {jawne: 'jawny', tajne: 'tajny', imienne: 'imienny'};
// Numery spraw w zdaniu: „1”, „1 i 3”, „1, 2 i 3”.
const joinNumbers = (list: string[]) => list.length > 1 ? `${list.slice(0, -1).join(', ')} i ${list[list.length - 1]}` : list[0] ?? '';
const sameTitle = (a: string, b: string) => {
  const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[.\s]+$/, '').toLowerCase();
  return norm(a) === norm(b);
};

// Głosowanie między posiedzeniami Prezydium (§ 14 ust. 5 Regulaminu Okręgowej Rady Pielęgniarek i Położnych w Słupsku).
export function ProcedureView() {
  const {m} = useMeeting();
  const s = useSession();
  if (m.status === 'przygotowanie') {
    if (!s.isOrganizer(m.organ)) return <div class="member"><Notice>Głosowanie jeszcze się nie rozpoczęło. Przygotowuje je biuro, przewodniczący albo wiceprzewodniczący.</Notice><Acts/></div>;
    return <div class="prep">
      <div class="prep-main">
        <section class="oi-card"><CardTitle level={2}>Sprawy do głosowania</CardTitle><p class="muted small">Każda sprawa (np. uchwała) to osobne głosowanie. Dołącz do niej materiał, aby członkowie mogli go przeczytać przed oddaniem głosu.</p><AgendaEditor rowExtra={it => <ActSettings it={it}/>}/></section>
        <section class="oi-card"><CardTitle level={2}>{`Materiały (${m.materials.length})`}</CardTitle><MaterialsEditor/></section>
      </div>
      <aside class="prep-side"><Start/><VotingData/><Messages/></aside>
      <div class="prep-end"><DeleteMeeting/></div>
    </div>;
  }
  return <div class="procedure">
    <div class="procedure-main">
      {m.status === 'trwa' && m.endsAt && <VotingWindow endsAt={m.endsAt}/>}
      {m.status === 'zakonczone' && <Notice tone="ok">Głosowanie zakończone. Wyniki są poniżej, a zestawienie do protokołu otwiera przycisk „Projekt protokołu”.</Notice>}
      <RejectedVote ballots={m.ballots}/>
      <Acts/>
    </div>
    <aside class="procedure-side"><Messages/></aside>
  </div>;
}

// Karta „Głosowanie trwa”: termin, pozostały czas, zasady rozstrzygnięcia i za kreską zakończenie przed czasem.
function VotingWindow({endsAt}: {endsAt: number}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const id = useId();
  const [ending, setEnding] = useState(false);
  const total = organMembers(s.roster, m.organ).length;
  const conductor = canChairOrgan(s.roster, m.organ, s.personId);
  const open = m.ballots.filter(b => b.status === 'otwarte');
  const eligible = [...new Set(open.flatMap(b => b.eligible))];
  const missing = eligible.filter(p => open.some(b => awaitingVote(b).includes(p))).length;
  const endText = missing === 0 ? 'Zagłosowali wszyscy uprawnieni. Wszystkie trwające głosowania zostaną zamknięte.'
    : `Bez głosu ${plural(missing, 'jest', 'są', 'jest')} jeszcze ${missing} ${plural(missing, 'osoba', 'osoby', 'osób')} z ${eligible.length} uprawnionych. Wszystkie trwające głosowania zostaną zamknięte, a ${missing === 1 ? 'ta osoba nie będzie już mogła' : 'te osoby nie będą już mogły'} oddać głosu.`;
  return <section class="oi-card is-teraz window" aria-labelledby={id}>
    <span class="oi-label" id={id}>Głosowanie trwa</span>
    <p class="window-due">{`do ${fmtDateTime(endsAt)}`}</p>
    <p class="window-left">zostało <Countdown endsAt={endsAt} label={false} long/></p>
    <p class="muted small">{`Uprawnionych do głosowania ${total}. Rozstrzygnięcie zapada przy udziale co najmniej ${quorumFor(total)} głosujących `}<span class="oi-nowrap">(§ 8 ust. 2)</span>{' zwykłą większością głosów. Głosowanie kończy się wcześniej, gdy zagłosują wszyscy.'}</p>
    {conductor && <div class="window-end"><Button small haspopup busy={busy} onClick={() => setEnding(true)}>Zakończ głosowanie przed czasem</Button></div>}
    {ending && <Confirm title="Zakończyć głosowanie przed czasem?" kind="danger" confirm="Zakończ głosowanie" onClose={() => setEnding(false)} onConfirm={() => send({type: 'close'})} text={<p>{endText}</p>}/>}
  </section>;
}

// Karta sprawy: etykieta z trybem, jeden tytuł, jeden odnośnik do materiału, głos, lista osób bez głosu i wynik.
function Acts() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const staff = canChairOrgan(s.roster, m.organ, s.personId) || s.isOrganizer(m.organ);
  const member = s.isMember(m.organ);
  const acts = m.agenda.filter(i => !i.parentId);
  const unannounced = m.ballots.find(b => b.status === 'zamkniete' && !b.announcedAt && acts.some(it => it.id === b.itemId));
  return <div class="acts">{acts.map(it => {
    const b = m.ballots.find(x => x.itemId === it.id);
    const mode = b?.mode ?? it.mode ?? 'jawne';
    const mats = b ? m.materials.filter(x => x.id === b.material?.id) : m.materials.filter(x => it.materialIds.includes(x.id));
    return <section key={it.id} class="oi-card act" aria-labelledby={`sprawa-${it.id}`}>
      <span class="oi-label">Głosowanie {modeName(mode)} w sprawie {itemNumber(m.agenda, it.id)}</span>
      <h2 class="item-title" id={`sprawa-${it.id}`}><TitleLead text={it.title}/></h2>
      {mats.length > 0
        ? <div class="material-list">{mats.map(x => {
          const version = b?.material?.id === x.id ? b.material.version : x.version;
          return <MaterialLink key={x.id} id={x.id} version={version} meta={`wersja ${version}`}
            label={sameTitle(x.title, it.title) ? (x.type === 'uchwala' ? 'Treść uchwały' : 'Treść materiału') : x.title}/>;
        })}</div>
        : <p class="muted small">Bez dołączonego materiału.</p>}
      {b?.status === 'otwarte' && member && <VoteCard b={b} embedded/>}
      {b?.status === 'otwarte' && staff && <Pending b={b}/>}
      {b?.status === 'otwarte' && b.mode !== 'jawne' && <div class="act-foot">
        {b.modeBasis && <dl class="facts vote-context"><Fact label="Podstawa trybu">{b.modeBasis}</Fact></dl>}
        {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Głosowanie tajne. Widać tylko, kto pobrał kartę. Ten sam odcisk członkowie widzą na telefonach.</span></div>}
      </div>}
      {b?.status === 'zamkniete' && <>
        <ResultCard b={b} kind={materialTypeOf(m, b)}/>
        {staff && !b.announcedAt && <div><Button kind={unannounced?.id === b.id ? 'primary' : 'secondary'} busy={busy} onClick={() => send({type: 'announce', ballotId: b.id})}>Ogłoś wynik głosowania</Button></div>}
      </>}
    </section>;
  })}</div>;
}

// Osoby, które jeszcze nie głosowały albo nie pobrały karty (widok prowadzącej i biura).
function Pending({b}: {b: ViewBallot}) {
  const s = useSession();
  const awaiting = awaitingVote(b);
  return <div class="act-pending">
    <h3 class="card-sub">{b.secret ? 'Jeszcze nie pobrali karty' : 'Jeszcze nie głosowali'}</h3>
    {awaiting.length > 0 ? <ul>{awaiting.map(p => <li key={p}>{s.personName(p)}</li>)}</ul> : <p class="small">Zagłosowali wszyscy uprawnieni.</p>}
  </div>;
}

// Sekcja „Ustaw tryb i materiał” przy sprawie w edytorze. Jej tytuł pokazuje zapisany tryb i dołączony materiał.
function ActSettings({it}: {it: AgendaItem}) {
  const {m, send, busy} = useMeeting();
  const saved = it.mode ?? 'jawne';
  const [mode, setMode] = useState<VoteMode>(saved);
  const [basis, setBasis] = useState(it.modeBasis ?? '');
  const [pick, setPick] = useState('');
  const [savedMode, setSavedMode] = useState<VoteMode>(saved);
  const save = useSaveStatus();
  useEffect(() => { setMode(it.mode ?? 'jawne'); setBasis(it.modeBasis ?? ''); }, [it.mode, it.modeBasis]);
  const attached = m.materials.filter(x => it.materialIds.includes(x.id));
  const others = m.materials.filter(x => !it.materialIds.includes(x.id));
  const dirty = mode !== saved || (mode !== 'jawne' && basis !== (it.modeBasis ?? ''));
  const material = !attached.length ? 'bez materiału' : attached.length === 1 ? `materiał „${attached[0].title}”` : `materiały ${attached.map(x => `„${x.title}”`).join(', ')}`;
  return <Fold title={`Ustaw tryb i materiał, tryb ${modeAdjective[saved]}, ${material}`}>
    <div class="act-settings">
      <Segments label="Tryb głosowania" value={mode} options={[['jawne', 'Jawne'], ['imienne', 'Imienne'], ['tajne', 'Tajne']]} onChange={v => { save.reset(); setMode(v); }}/>
      {mode !== 'jawne' && <Field label="Podstawa" hint="Kiedy Prezydium uchwaliło tajność głosowania albo głosowanie imienne.">
        <input value={basis} onInput={e => { save.reset(); setBasis((e.target as HTMLInputElement).value); }} maxLength={300} placeholder="np. uchwalone na posiedzeniu 22.10.2026, głosowanie nr 2"/>
      </Field>}
      <div class="form-save">
        <Button small busy={busy} disabled={!dirty} reason="Brak zmian do zapisania." onClick={async () => { const r = await save.track(() => send({type: 'item_mode', itemId: it.id, mode, basis})); if (r) setSavedMode(mode); }}>Zapisz tryb</Button>
        <SaveLine status={save} dirty={false} saved={() => `Zapisano tryb ${modeAdjective[savedMode]}.`}/>
      </div>
      {others.length > 0 && <div class="actions">
        <Field label="Dołącz materiał"><select value={pick} onChange={e => setPick((e.target as HTMLSelectElement).value)}><option value="">Wybierz materiał…</option>{others.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
        <Button small busy={busy} disabled={!pick} reason="Wybierz materiał z listy." onClick={async () => { if (await send({type: 'item_material', itemId: it.id, materialId: pick, on: true})) setPick(''); }}>Dołącz materiał</Button>
      </div>}
    </div>
  </Fold>;
}

// Dane głosowania: tytuł i koniec głosowania, z informacją o zapisie i niezapisanych zmianach.
function VotingData() {
  const {m, send, busy} = useMeeting();
  const local = (ts?: number) => ts ? new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const saved = {title: m.title, endsAt: local(m.endsAt)};
  const [draft, setDraft] = useState(saved);
  const [touched, setTouched] = useState(false);
  const save = useSaveStatus();
  const key = (d: typeof saved) => JSON.stringify([d.title.trim(), d.endsAt]);
  useEffect(() => { if (!touched) setDraft(saved); }, [key(saved)]);
  const dirty = key(draft) !== key(saved);
  useLeaveWarning(dirty);
  const set = (field: keyof typeof saved) => (e: Event) => { setTouched(true); save.reset(); const v = (e.target as HTMLInputElement).value; setDraft(d => ({...d, [field]: v})); };
  return <section class="oi-card">
    <CardTitle level={2}>Dane głosowania</CardTitle>
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      if (!dirty) return;
      const r = await save.track(() => send({type: 'details', title: draft.title, endsAt: new Date(draft.endsAt).getTime()}));
      if (r) setTouched(false);
    }}>
      <Field label="Tytuł"><input name="title" value={draft.title} onInput={set('title')} required maxLength={200}/></Field>
      <Field label="Koniec głosowania" hint="Zwykle kilka godzin. Członkowie widzą licznik pozostałego czasu."><input name="endsAt" type="datetime-local" value={draft.endsAt} onInput={set('endsAt')} required/></Field>
      <div class="form-save">
        <Button type="submit" busy={busy} disabled={!dirty} reason="Brak zmian do zapisania.">Zapisz dane głosowania</Button>
        <SaveLine status={save} dirty={dirty} saved={t => `Zapisano dane głosowania o godz. ${t}.`}/>
      </div>
    </form>
  </section>;
}

// Rozpoczęcie: ostrzeżenia o sprawach bez materiału i krótkim terminie, a przy podpunktach przycisk nieaktywny z powodem.
function Start() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const now = useNow(30000);
  const [confirm, setConfirm] = useState(false);
  const acts = m.agenda.filter(i => !i.parentId);
  const subs = m.agenda.filter(i => i.parentId).map(i => itemNumber(m.agenda, i.id));
  const bare = acts.filter(i => !i.materialIds.length).map(i => itemNumber(m.agenda, i.id));
  if (!canChairOrgan(s.roster, m.organ, s.personId)) return <section class="oi-card"><CardTitle level={2}>Rozpoczęcie głosowania</CardTitle><p class="muted small">Głosowanie rozpocznie przewodniczący lub wiceprzewodniczący. Wtedy członkowie dostaną dostęp do kart.</p></section>;
  const warnings = [
    bare.length === 1 ? `Sprawa ${bare[0]} nie ma dołączonego materiału. Członkowie nie przeczytają jej treści przed głosowaniem.`
      : bare.length > 1 ? `Sprawy ${joinNumbers(bare)} nie mają dołączonego materiału. Członkowie nie przeczytają ich treści przed głosowaniem.` : '',
    m.endsAt && m.endsAt - now < 3600000 ? 'Krótki czas głosowania. Upewnij się, że wszyscy członkowie wiedzą o głosowaniu i zdążą przeczytać materiały.' : '',
  ].filter(Boolean);
  // Podpunkt nie zostałby poddany pod głosowanie (głosowania otwierają się tylko dla spraw głównych).
  const blocked = !acts.length ? 'Dodaj co najmniej jedną sprawę do głosowania.'
    : subs.length === 1 ? `Sprawa ${subs[0]} jest podpunktem i nie zostałaby poddana pod głosowanie. Usuń ją i dodaj jako osobną sprawę.`
    : subs.length > 1 ? `Sprawy ${joinNumbers(subs)} są podpunktami i nie zostałyby poddane pod głosowanie. Usuń je i dodaj jako osobne sprawy.` : '';
  const note = warnings.length > 0 && <Notice tone="warn">{warnings.map(w => <p key={w}>{w}</p>)}</Notice>;
  return <section class="oi-card is-teraz">
    <CardTitle level={2}>Rozpoczęcie głosowania</CardTitle>
    <p class="small">{`Wszystkie sprawy (${acts.length}) zostaną otwarte jednocześnie do ${m.endsAt ? fmtDateTime(m.endsAt) : 'ustalonego terminu'}.`}</p>
    {note}
    <Button kind="primary" wide haspopup busy={busy} disabled={!!blocked} reason={blocked} onClick={() => setConfirm(true)}>Rozpocznij głosowanie</Button>
    {confirm && <Confirm title="Rozpocząć głosowanie?" confirm="Rozpocznij głosowanie" onClose={() => setConfirm(false)} onConfirm={() => send({type: 'open'})}
      text={<><p>Po rozpoczęciu nie można zmieniać spraw ani materiałów, nad którymi się głosuje. Członkowie zagłosują na swoich telefonach.</p>{note}</>}/>}
  </section>;
}
