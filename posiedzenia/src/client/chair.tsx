import {useEffect, useState} from 'preact/hooks';
import {canChairOrgan} from '../shared/meeting.ts';
import {itemNumber, orderedAgenda, pendingVoters, presentMembers, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, BallotPurpose, Meeting, VoteMode} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting, type ViewBallot} from './context.ts';
import {useSession} from './session.ts';
import {Button, CardTitle, Chip, Confirm, Countdown, Fact, Field, Fold, fmtTime, Modal, Notice} from './ui.tsx';
import {AgendaList, beforeAdoption, itemStatus, Motions, ResultCard, VoteCard} from './meeting.tsx';
import {AgendaEditor} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';

type Tab = 'porzadek' | 'sprawa' | 'obrady';
const modeName = (mode: string) => mode === 'tajne' ? 'tajne' : mode === 'imienne' ? 'imienne' : 'jawne';

export function ChairPanel({readOnly}: {readOnly: boolean}) {
  const {m} = useMeeting();
  const s = useSession();
  const [selected, setSelected] = useState<string | null>(m.currentItemId ?? m.agenda[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('sprawa');
  useEffect(() => { if (!m.agenda.some(i => i.id === selected)) setSelected(m.currentItemId); }, [m.agenda.length]);
  useEffect(() => { if (m.currentItemId) setSelected(m.currentItemId); }, [m.currentItemId]);
  const open = m.ballots.find(b => b.status === 'otwarte');
  const lastClosed = [...m.ballots].reverse().find(b => b.status === 'zamkniete');
  const eligibleMe = open && s.personId && open.eligible.includes(s.personId);
  return <div class="chair">
    <nav class="oi-seg chair-tabs" aria-label="Część panelu">
      {([['porzadek', 'Porządek'], ['sprawa', 'Sprawa'], ['obrady', 'Obrady']] as [Tab, string][]).map(([id, label]) => <button type="button" class="oi-opt" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    <aside class={'chair-col chair-left' + (tab === 'porzadek' ? ' is-shown' : '')}>
      <section class="oi-card">
        <div class="panel-head"><CardTitle>Porządek obrad</CardTitle>{m.agendaAdopted ? <Chip>Przyjęty</Chip> : <Chip tone="otwarte">Do przyjęcia</Chip>}</div>
        <AgendaList selected={selected} onSelect={id => { setSelected(id); setTab('sprawa'); }}/>
        {readOnly && <p class="muted small">Widok biura obejmuje obecność i notatki. Czynności formalne wykonuje prowadzący.</p>}
        {!readOnly && !m.agendaAdopted && <AgendaFixes/>}
        {!readOnly && m.agendaAdopted && <AgendaChange/>}
      </section>
    </aside>
    <section class={'chair-col chair-main' + (tab === 'sprawa' ? ' is-shown' : '')}>
      {m.status === 'przerwa' && <Notice tone="warn">Trwa przerwa w obradach. Głosowania są wstrzymane.</Notice>}
      {open && <LiveBallot b={open} readOnly={readOnly}/>}
      {open && eligibleMe && <VoteCard b={open}/>}
      {!open && lastClosed && !lastClosed.announcedAt && <section class="oi-card is-accent">
        <ResultCard b={lastClosed}/>
        {!readOnly && <div class="actions"><AnnounceButton b={lastClosed}/><span class="muted small">Ogłoszenie pokaże wynik na telefonach i ekranie sali.</span></div>}
      </section>}
      {selected && <ItemWorkspace itemId={selected} readOnly={readOnly} skipBallot={!open && lastClosed && !lastClosed.announcedAt ? lastClosed.id : null}/>}
    </section>
    <aside class={'chair-col chair-right' + (tab === 'obrady' ? ' is-shown' : '')}>
      <MeetingControls readOnly={readOnly}/>
      <Attendance/>
      <Chairing readOnly={readOnly}/>
      <Motions/>
      {!readOnly && <ChairMotions/>}
      <Messages/>
      <Log/>
    </aside>
  </div>;
}

function AnnounceButton({b}: {b: ViewBallot}) {
  const {send, busy} = useMeeting();
  return <Button kind="primary" disabled={busy} onClick={() => send({type: 'announce', ballotId: b.id})}>Ogłoś wynik głosowania</Button>;
}

function LiveBallot({b, readOnly}: {b: ViewBallot; readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [closing, setClosing] = useState(false);
  const pending = pendingVoters(b);
  const cast = b.secret ? b.secret.cast : b.voted.length;
  const total = b.eligible.length - b.absentDuring.filter(id => !b.voted.includes(id)).length;
  const share = total ? Math.min(100, Math.round(cast / total * 100)) : 0;
  return <section class="oi-card live-ballot">
    <div class="oi-btns"><span class="oi-tag"><span>Trwa głosowanie nr {b.number}</span></span><span class="oi-tag oi-tag--ciemny"><span>{modeName(b.mode)}</span></span></div>
    <p class="vote-subject">{b.subject}</p>
    <dl class="facts facts--liczby">
      <Fact label="Pozostało"><Countdown endsAt={b.endsAt} label={false}/></Fact>
      <Fact label="Oddano głosów">{cast} <small>z {total}</small></Fact>
      {b.secret && <Fact label="Pobrano kart">{b.secret.issued.length}</Fact>}
    </dl>
    <div class="oi-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cast} aria-label="Oddane głosy"><span class="oi-progress__bar"><i style={{width: `${share}%`}}/></span><span class="oi-progress__txt">{share}%</span></div>
    <dl class="facts"><Fact label="Uprawnionych">{b.eligible.length}</Fact><Fact label="Kworum">{b.quorum}</Fact>{b.modeBasis && <Fact label="Podstawa trybu">{b.modeBasis}</Fact>}</dl>
    {b.secret && <div class="fingerprint"><span class="kicker">Odcisk klucza głosowania</span><code>{b.secret.fingerprint}</code><span class="muted small">Głosowanie tajne. Widać tylko, kto pobrał kartę.</span></div>}
    {pending.length > 0 && <div class="pending">
      <span class="kicker">{b.secret ? 'Jeszcze nie pobrali karty' : 'Jeszcze nie zagłosowali'}</span>
      <ul>{pending.map(id => <li><span>{s.personName(id)}</span>{!readOnly && <Button small kind="ghost" disabled={busy} quiet onClick={() => send({type: 'ballot_absent', ballotId: b.id, personId: id})} title="Osoba wyszła z sali. Głosowanie nie będzie na nią czekać.">Oznacz nieobecność</Button>}</li>)}</ul>
    </div>}
    {!readOnly && <div class="actions"><Button small onClick={() => setClosing(true)}>Zakończ głosowanie teraz</Button></div>}
    {closing && <Confirm title="Zakończyć głosowanie?" kind="danger" confirm="Zakończ głosowanie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'ballot_close', ballotId: b.id})}
      text={<p>{pending.length ? `Nie zagłosowały jeszcze osoby ${pending.map(id => s.personName(id)).join(', ')}. Ich głosy nie zostaną policzone.` : 'Wszyscy obecni oddali głos.'} Głosowanie zwykle kończy się samo, gdy zagłosują wszyscy uprawnieni albo upłynie czas.</p>}/>}
    {m.status === 'przerwa' && <Notice tone="warn">Przerwa.</Notice>}
  </section>;
}

function ItemWorkspace({itemId, readOnly, skipBallot}: {itemId: string; readOnly: boolean; skipBallot: string | null}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const it = m.agenda.find(i => i.id === itemId);
  const [note, setNote] = useState(it?.note ?? '');
  const [ending, setEnding] = useState<AgendaItem['status'] | null>(null);
  useEffect(() => setNote(it?.note ?? ''), [itemId]);
  if (!it) return null;
  const [label, tone] = itemStatus[it.status];
  const current = m.currentItemId === it.id;
  const locked = !m.agendaAdopted && !beforeAdoption(m, it);
  const open = m.ballots.some(b => b.status === 'otwarte');
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const others = m.materials.filter(x => !it.materialIds.includes(x.id));
  const ballots = m.ballots.filter(b => b.itemId === it.id);
  const organizer = s.isOrganizer(m.organ);
  const order = orderedAgenda(m.agenda);
  const next = current ? order.slice(order.indexOf(it) + 1).find(i => i.status === 'oczekuje' && (m.agendaAdopted || beforeAdoption(m, i)) && !(i.kind === 'uchwaly' && order.some(c => c.parentId === i.id))) : undefined;
  return <section class={'oi-card item-work' + (current ? ' is-current' : '')}>
    <div class="panel-head">
      <span class="oi-label">Punkt {itemNumber(m.agenda, it.id)}{current && ', teraz procedowany'}</span>
      <Chip tone={tone}>{label}</Chip>
    </div>
    <h2 class="item-title">{it.title}</h2>
    {locked && <Notice>Ten punkt można rozpocząć po przyjęciu porządku obrad.</Notice>}
    {!readOnly && <div class="actions">
      {!current && <Button kind="primary" disabled={busy || locked || open || it.status === 'wycofany'} onClick={() => send({type: 'item_start', itemId: it.id})}>Rozpocznij ten punkt</Button>}
      <Button small disabled={busy} onClick={() => send({type: 'present', kind: 'punkt', id: it.id})}>Pokaż uczestnikom</Button>
      {(current || it.status === 'w_toku') && <>
        <Button small disabled={busy || open || (it.kind === 'porzadek' && !m.agendaAdopted)} onClick={() => send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}>Zakończ punkt</Button>
        <Button kind="ghost" small disabled={busy || open} onClick={() => setEnding('odroczony')}>Odrocz</Button>
      </>}
      {it.status === 'oczekuje' && it.kind === 'sprawa' && <Button kind="ghost" small disabled={busy} onClick={() => setEnding('wycofany')}>Wycofaj</Button>}
    </div>}
    {it.kind === 'otwarcie' && !readOnly && <Quorum/>}
    {materials.length > 0 && <div class="material-row">
      <h4>Materiały</h4>
      {materials.map(x => <div class="stack-tight"><MaterialLink id={x.id} version={x.version} label={x.title} meta={`wersja ${x.version}`}/>
        {!readOnly && <div><Button small kind="ghost" disabled={busy} onClick={() => send({type: 'present', kind: 'material', id: x.id})}>Pokaż ten materiał uczestnikom</Button></div>}</div>)}
    </div>}
    {(organizer || !readOnly) && others.length > 0 && <Field label="Przypisz materiał do punktu">
      <select onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) send({type: 'item_material', itemId: it.id, materialId: v, on: true}); (e.target as HTMLSelectElement).value = ''; }}>
        <option value="">Wybierz materiał…</option>{others.map(x => <option value={x.id}>{x.title}</option>)}
      </select>
    </Field>}
    {!readOnly && <BallotForm it={it}/>}
    {ballots.some(b => b.status === 'zamkniete' && b.id !== skipBallot) && <div class="results"><h4>Głosowania w tym punkcie</h4>{ballots.filter(b => b.status === 'zamkniete' && b.id !== skipBallot).map(b => <div class="stack-tight"><ResultCard b={b}/>{!readOnly && !b.announcedAt && <div><AnnounceButton b={b}/></div>}</div>)}</div>}
    <Field label="Notatka do protokołu" hint="Przebieg dyskusji, wnioski i ustalenia. Notatka trafi do projektu protokołu.">
      <textarea rows={4} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} onBlur={() => note !== it.note && send({type: 'item_edit', itemId: it.id, note})}/>
    </Field>
    {!readOnly && next && <div class="next-step">
      <span class="kicker">Następny punkt</span>
      <div><Button kind="primary" disabled={busy || open} onClick={() => send({type: 'item_start', itemId: next.id})}>Przejdź do punktu {itemNumber(m.agenda, next.id)}</Button></div>
      <span class="small muted">{next.title}</span>
    </div>}
    {ending && <Confirm title={ending === 'odroczony' ? 'Odroczyć punkt?' : 'Wycofać punkt?'} confirm={ending === 'odroczony' ? 'Odrocz' : 'Wycofaj'} kind="danger" onClose={() => setEnding(null)}
      onConfirm={() => send({type: 'item_end', itemId: it.id, status: ending as 'odroczony' | 'wycofany'})}
      text={<p>{ending === 'odroczony' ? 'Punkt pozostanie w porządku obrad z oznaczeniem „odroczony”. Można go później podjąć ponownie.' : 'Punkt zostanie oznaczony jako wycofany i nie będzie procedowany.'}</p>}/>}
  </section>;
}

function Quorum() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length, required = quorumFor(total);
  const last = m.quorumChecks.at(-1);
  return <div class={'quorum ' + (present >= required ? 'is-ok' : 'is-low')}>
    <dl class="facts facts--liczby"><Fact label="Obecnych">{present} <small>z {total}</small></Fact><Fact label="Kworum (§ 8 ust. 2)">{required}</Fact></dl>
    <p class="strong">{present >= required ? 'Kworum jest.' : 'Brak kworum.'}</p>
    {last && <p class="muted small">Ostatnio stwierdzono o godz. {fmtTime(last.at)}, że {last.present >= last.required ? 'kworum jest' : 'brak kworum'}.</p>}
    <div><Button kind={present >= required ? 'primary' : 'secondary'} disabled={busy} onClick={() => send({type: 'quorum'})}>{present >= required ? 'Stwierdzam kworum' : 'Zapisz brak kworum'}</Button></div>
  </div>;
}

function BallotForm({it}: {it: AgendaItem}) {
  const {m, send, busy} = useMeeting();
  const materials = m.materials.filter(x => it.materialIds.includes(x.id));
  const votedOn = new Set(m.ballots.filter(b => b.status === 'zamkniete' && !b.supersededBy).map(b => b.material?.id));
  const firstOpen = materials.find(x => !votedOn.has(x.id)) ?? materials[0];
  const defaults = (materialId: string | undefined) => {
    const mat = materials.find(x => x.id === materialId);
    if (it.kind === 'porzadek') return 'Przyjęcie porządku obrad';
    if (it.kind === 'protokol') return mat ? `Przyjęcie protokołu ${mat.title}` : 'Przyjęcie protokołu z poprzedniego posiedzenia';
    return mat?.title ?? it.title;
  };
  const [materialId, setMaterialId] = useState(firstOpen?.id ?? '');
  const [subject, setSubject] = useState(defaults(firstOpen?.id));
  const [mode, setMode] = useState<VoteMode>('jawne');
  const [minutes, setMinutes] = useState(2);
  const [motion, setMotion] = useState<'tajne' | 'imienne' | null>(null);
  useEffect(() => { const f = materials.find(x => !votedOn.has(x.id)) ?? materials[0]; setMaterialId(f?.id ?? ''); setSubject(defaults(f?.id)); setMode(it.mode ?? 'jawne'); }, [it.id, m.ballots.length, it.materialIds.length, it.mode]);
  const [extra, setExtra] = useState(false);
  useEffect(() => setExtra(false), [it.id]);
  const purpose: BallotPurpose = it.kind === 'porzadek' ? 'porzadek' : it.kind === 'protokol' ? 'protokol' : 'uchwala';
  if (it.kind === 'porzadek' && m.agendaAdopted) return null;
  if (!m.agendaAdopted && it.kind !== 'porzadek') return null;
  if (['otwarcie', 'zamkniecie'].includes(it.kind)) return null;
  const open = m.ballots.some(b => b.status === 'otwarte');
  if (open) return null;
  const decided = m.ballots.filter(b => b.itemId === it.id && b.status === 'zamkniete' && !b.supersededBy && b.purpose !== 'tryb');
  const done = materials.length ? materials.every(x => votedOn.has(x.id)) : decided.length > 0;
  if (done && !extra) return <div class="ballot-form"><p class="small muted">{materials.length > 1 ? 'Głosowano już nad wszystkimi dokumentami w tym punkcie.' : 'W tym punkcie przeprowadzono już głosowanie.'}</p><div><Button small kind="ghost" onClick={() => setExtra(true)}>Dodatkowe głosowanie w tym punkcie</Button></div></div>;
  return <form class="ballot-form" onSubmit={e => { e.preventDefault(); send({type: 'ballot_open', itemId: it.id, purpose, subject, mode, minutes, materialId: materialId || null}); }}>
    <h4>{it.kind === 'porzadek' ? 'Głosowanie nad porządkiem obrad' : 'Głosowanie w tym punkcie'}</h4>
    {materials.length > 1 && <Field label="Nad którym dokumentem?"><select value={materialId} onChange={e => { const v = (e.target as HTMLSelectElement).value; setMaterialId(v); setSubject(defaults(v)); }}>{materials.map(x => <option value={x.id}>{x.title}{votedOn.has(x.id) ? ' (już głosowano)' : ''}</option>)}</select></Field>}
    <Field label="Przedmiot głosowania"><input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} required maxLength={400}/></Field>
    <div class="row">
      <Field label="Tryb">
        <select value={mode} onChange={e => setMode((e.target as HTMLSelectElement).value as VoteMode)}>
          <option value="jawne">Jawne</option>
          <option value="imienne" disabled={it.mode !== 'imienne'}>Imienne{it.mode !== 'imienne' ? ' (wymaga postanowienia)' : ''}</option>
          <option value="tajne" disabled={it.mode !== 'tajne'}>Tajne{it.mode !== 'tajne' ? ' (wymaga postanowienia)' : ''}</option>
        </select>
      </Field>
      <Field label="Czas"><select value={String(minutes)} onChange={e => setMinutes(Number((e.target as HTMLSelectElement).value))}>{[1, 2, 3, 5, 10, 15].map(n => <option value={String(n)}>{n} min</option>)}</select></Field>
    </div>
    {it.kind !== 'porzadek' && !it.mode && <p class="small muted">Głosowanie tajne lub imienne wymaga wcześniejszego postanowienia Prezydium (§ 11 ust. 2). Złóż <button type="button" class="link" onClick={() => setMotion('tajne')}>wniosek o głosowanie tajne</button> albo <button type="button" class="link" onClick={() => setMotion('imienne')}>wniosek o głosowanie imienne</button>.</p>}
    {it.mode && <p class="small muted">Postanowiono o głosowaniu {it.mode === 'tajne' ? 'tajnym' : 'imiennym'} ({it.modeBasis}).</p>}
    <div><Button kind="primary" type="submit" disabled={busy || open || m.status !== 'trwa'}>Otwórz głosowanie</Button></div>
    {motion && <Confirm title={`Wniosek o głosowanie ${motion === 'tajne' ? 'tajne' : 'imienne'}`} confirm="Poddaj wniosek pod głosowanie" onClose={() => setMotion(null)} onConfirm={() => send({type: 'mode_motion', itemId: it.id, mode: motion, minutes: 2})}
      text={<p>Prezydium zdecyduje zwykłą większością głosów w głosowaniu jawnym, czy sprawę „{it.title}” głosować w trybie {motion === 'tajne' ? 'tajnym' : 'imiennym'} (§ 11 ust. 2).</p>}/>}
  </form>;
}

function AgendaFixes() {
  const [open, setOpen] = useState(false);
  return <div class="stack-tight">
    <p class="muted small">Przed przyjęciem porządek można poprawiać. Po nieprzyjęciu popraw go i ponownie poddaj pod głosowanie.</p>
    <div><Button small onClick={() => setOpen(true)}>Popraw porządek obrad</Button></div>
    {open && <Modal title="Popraw porządek obrad" wide onClose={() => setOpen(false)}><AgendaEditor/></Modal>}
  </div>;
}

function AgendaChange() {
  const {m, send, busy} = useMeeting();
  const [mode, setMode] = useState<'dodaj' | 'usun' | null>(null);
  const top = m.agenda.filter(i => !i.parentId);
  const removable = m.agenda.filter(i => i.status === 'oczekuje' && !m.ballots.some(b => b.itemId === i.id) && i.kind === 'sprawa');
  return <div class="stack-tight">
    <p class="muted small">Przyjęty porządek zmienia się w głosowaniu.</p>
    <div class="actions"><Button small onClick={() => setMode('dodaj')}>Wniosek o dodanie punktu</Button>{removable.length > 0 && <Button small kind="ghost" onClick={() => setMode('usun')}>Wniosek o usunięcie punktu</Button>}</div>
    {mode && <Modal title={mode === 'dodaj' ? 'Zmiana porządku, dodanie punktu' : 'Zmiana porządku, usunięcie punktu'} onClose={() => setMode(null)}>
      <form class="stack" onSubmit={async e => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const where = String(f.get('where') ?? '');
        const change = mode === 'dodaj'
          ? where.startsWith('pod:') ? {op: 'dodaj' as const, title: String(f.get('title')), parentId: where.slice(4), afterId: null} : {op: 'dodaj' as const, title: String(f.get('title')), parentId: null, afterId: where || null}
          : {op: 'usun' as const, itemId: String(f.get('item'))};
        if (await send({type: 'agenda_change', change, minutes: 2})) setMode(null);
      }}>
        {mode === 'dodaj' ? <>
          <Field label="Nazwa punktu"><input name="title" required maxLength={400}/></Field>
          <Field label="Miejsce w porządku"><select name="where">
            {top.map(t => <option value={t.id}>po punkcie {itemNumber(m.agenda, t.id)}. {t.title}</option>)}
            {top.map(t => <option value={'pod:' + t.id}>jako podpunkt w {itemNumber(m.agenda, t.id)}. {t.title}</option>)}
          </select></Field>
        </> : <Field label="Punkt do usunięcia"><select name="item">{removable.map(i => <option value={i.id}>{itemNumber(m.agenda, i.id)}. {i.title}</option>)}</select></Field>}
        <Notice>Otworzy się głosowanie jawne na 2 minuty. Zmiana wejdzie do porządku po przyjęciu zwykłą większością głosów.</Notice>
        <div class="actions"><Button kind="primary" type="submit" disabled={busy}>Poddaj pod głosowanie</Button><Button onClick={() => setMode(null)}>Anuluj</Button></div>
      </form>
    </Modal>}
  </div>;
}

function MeetingControls({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [closing, setClosing] = useState(false);
  const total = organMembers(s.roster, m.organ).length, present = presentMembers(m as Meeting, s.roster).length, required = quorumFor(total);
  const open = m.ballots.some(b => b.status === 'otwarte');
  const shown = m.presentation;
  const shownLabel = !shown ? 'nic, ekran jest pusty' : shown.kind === 'punkt' ? `punkt ${itemNumber(m.agenda, shown.id)}` : shown.kind === 'material' ? `materiał „${m.materials.find(x => x.id === shown.id)?.title ?? ''}”` : shown.kind === 'glosowanie' ? 'głosowanie' : 'wynik głosowania';
  return <section class="oi-card">
    <CardTitle>Obrady</CardTitle>
    <dl class="facts facts--liczby"><Fact label="Obecnych">{present} <small>z {total}</small></Fact><Fact label="Kworum">{required}</Fact></dl>
    <p class="strong">{present >= required ? 'Kworum jest.' : 'Brak kworum.'}</p>
    <dl class="facts"><Fact label="Uczestnicy widzą">{shownLabel}</Fact></dl>
    {!readOnly && shown && <div><Button kind="ghost" small onClick={() => send({type: 'present', kind: null})}>Wyczyść ekran uczestników</Button></div>}
    {!readOnly && <div class="actions">
      {m.status === 'trwa' ? <Button small disabled={busy || open} onClick={() => send({type: 'break', on: true})}>Przerwa</Button> : <Button kind="primary" small disabled={busy} onClick={() => send({type: 'break', on: false})}>Wznów obrady</Button>}
      <Button small kind="danger" disabled={busy || open} onClick={() => setClosing(true)}>Zamknij posiedzenie</Button>
    </div>}
    {closing && <Confirm title="Zamknąć posiedzenie?" kind="danger" confirm="Zamknij posiedzenie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'close'})}
      text={<p>{m.agenda.filter(i => i.status === 'oczekuje').length ? `W porządku są jeszcze nierozpoczęte punkty (${m.agenda.filter(i => i.status === 'oczekuje').length}). ` : ''}Po zamknięciu nie można już głosować ani zmieniać zapisu. Powstanie projekt protokołu.</p>}/>}
  </section>;
}

const presenceChip = (status: string) => status === 'obecny' ? <Chip tone="trwa">Obecność</Chip> : status === 'wyszedl' ? <Chip tone="otwarte">Wyjście</Chip> : <Chip>Nieobecność</Chip>;

function Attendance() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [guests, setGuests] = useState<{id: string; displayName: string; label: string}[]>([]);
  useEffect(() => { if (m.invited.length) request<{accounts: typeof guests}>('/api/people').then(r => setGuests(r.accounts)).catch(() => {}); }, [m.invited.length]);
  const canMark = m.chair.current === s.personId || s.isOrganizer(m.organ);
  const lastEvent = (who: string) => [...m.presenceLog].reverse().find(e => e.who === who);
  return <section class="oi-card">
    <CardTitle>Lista obecności</CardTitle>
    <ul class="attendance">
      {organMembers(s.roster, m.organ).map(ms => {
        const status = m.attendance[ms.personId] ?? 'nieobecny', ev = lastEvent(ms.personId);
        return <li class={'att-' + status}>
          <span class="att-name"><strong>{s.personName(ms.personId)}</strong><small>{ms.label}{ev ? `, ${status === 'obecny' ? 'od' : status === 'wyszedl' ? 'wyjście' : ''} godz. ${fmtTime(ev.at)}` : ''}</small></span>
          <span class="att-side">{presenceChip(status)}
            {canMark && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'presence', who: ms.personId, present: status !== 'obecny'})}>{status === 'obecny' ? 'Zapisz wyjście' : 'Zapisz obecność'}</Button>}</span>
        </li>;
      })}
    </ul>
    {m.invited.length > 0 && <>
      <h4>Głos doradczy i goście</h4>
      <ul class="attendance">{m.invited.map(id => {
        const g = guests.find(x => x.id === id), status = m.guests[id] ?? 'nieobecny';
        return <li class={'att-' + status}><span class="att-name"><strong>{g?.displayName ?? 'Zaproszona osoba'}</strong><small>{g?.label}</small></span>
          <span class="att-side">{presenceChip(status)}
            {canMark && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'presence', who: id, guest: true, present: status !== 'obecny'})}>{status === 'obecny' ? 'Zapisz wyjście' : 'Zapisz obecność'}</Button>}</span></li>;
      })}</ul>
    </>}
  </section>;
}

function Chairing({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const candidates = organMembers(s.roster, m.organ).filter(ms => ms.canChair && ms.personId !== m.chair.current && m.attendance[ms.personId] === 'obecny');
  return <section class="oi-card">
    <CardTitle>Prowadzenie</CardTitle>
    <dl class="facts"><Fact label="Prowadzi">{s.personName(m.chair.current)}</Fact>{m.chair.deputy && <Fact label="Zastępstwo przewodniczącego">{s.personName(m.chair.deputy)}, {m.chair.deputyBasis}</Fact>}</dl>
    {!readOnly && candidates.length > 0 && <Field label="Przekaż prowadzenie">
      <select onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) send({type: 'chair_handover', personId: v}); (e.target as HTMLSelectElement).value = ''; }} disabled={busy}>
        <option value="">Wybierz osobę…</option>{candidates.map(c => <option value={c.personId}>{s.personName(c.personId)}, {c.label}</option>)}
      </select>
    </Field>}
    {!readOnly && !candidates.length && <p class="muted small">Prowadzenie można przekazać obecnej wiceprzewodniczącej lub obecnemu wiceprzewodniczącemu.</p>}
    {canChairOrgan(s.roster, m.organ, s.personId) && m.chair.current !== s.personId && <p class="muted small">Prowadzenie przejmiesz w widoku uczestnika.</p>}
  </section>;
}

function ChairMotions() {
  const {m, send, busy} = useMeeting();
  const ready = m.motions.filter(x => x.status === 'zlozony' || (x.status === 'przyjety' && !x.repeatBallotId));
  if (!ready.length) return null;
  const open = m.ballots.some(b => b.status === 'otwarte');
  return <section class="oi-card is-accent">
    <CardTitle>Reasumpcja, decyzja prowadzącego</CardTitle>
    {ready.map(x => {
      const b = m.ballots.find(y => y.id === x.ballotId);
      return <div class="motion"><span class="kicker">Głosowanie nr {b?.number}</span><p class="strong">{b?.subject}</p>
        <div>{x.status === 'zlozony'
          ? <Button kind="primary" disabled={busy || open} onClick={() => send({type: 'motion_vote', motionId: x.id, minutes: 2})}>Poddaj wniosek pod głosowanie</Button>
          : <Button kind="primary" disabled={busy || open} onClick={() => send({type: 'reasumption_open', motionId: x.id, minutes: 2})}>Przeprowadź ponowne głosowanie</Button>}</div>
      </div>;
    })}
  </section>;
}

function Log() {
  const {m} = useMeeting();
  return <Fold title="Przebieg obrad">
    <ol class="log">{[...m.log].reverse().map(l => <li><time>{fmtTime(l.at)}</time><span>{l.text}</span></li>)}</ol>
  </Fold>;
}
