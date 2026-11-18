import {useEffect, useState} from 'preact/hooks';
import {canChairOrgan} from '../shared/meeting.ts';
import {itemNumber, orderedAgenda, pendingVoters, presentMembers, quorumFor} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, BallotPurpose, Meeting, VoteMode} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting, type ViewBallot} from './context.ts';
import {useSession} from './session.ts';
import {Button, Chip, Confirm, Countdown, Field, fmtTime, Modal, Notice} from './ui.tsx';
import {AgendaList, beforeAdoption, itemStatus, Motions, ResultCard, VoteCard} from './meeting.tsx';
import {AgendaEditor} from './prep.tsx';
import {MaterialLink} from './reader.tsx';
import {Messages} from './messages.tsx';

type Tab = 'porzadek' | 'sprawa' | 'obrady';

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
    <nav class="chair-tabs" role="tablist">
      {([['porzadek', 'Porządek'], ['sprawa', 'Sprawa'], ['obrady', 'Obrady']] as [Tab, string][]).map(([id, label]) => <button role="tab" aria-selected={tab === id} class={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    <aside class={'chair-col chair-left' + (tab === 'porzadek' ? ' is-shown' : '')}>
      <section class="card">
        <div class="card-head"><h3>Porządek obrad</h3>{m.agendaAdopted ? <Chip tone="done">Przyjęty</Chip> : <Chip tone="warn">Do przyjęcia</Chip>}</div>
        <AgendaList selected={selected} onSelect={id => { setSelected(id); setTab('sprawa'); }}/>
        {readOnly && <p class="muted small">Widok biura: obecność i notatki. Czynności formalne wykonuje prowadzący.</p>}
        {!readOnly && !m.agendaAdopted && <AgendaFixes/>}
        {!readOnly && m.agendaAdopted && <AgendaChange/>}
      </section>
    </aside>
    <section class={'chair-col chair-main' + (tab === 'sprawa' ? ' is-shown' : '')}>
      {m.status === 'przerwa' && <Notice tone="warn">Trwa przerwa w obradach. Głosowania są wstrzymane.</Notice>}
      {open && <LiveBallot b={open} readOnly={readOnly}/>}
      {open && eligibleMe && <VoteCard b={open}/>}
      {!open && lastClosed && !lastClosed.announcedAt && <section class="card">
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
  return <section class="card live-ballot">
    <div class="card-head"><h3>Trwa głosowanie nr {b.number}</h3><Countdown endsAt={b.endsAt}/></div>
    <p class="strong">{b.subject}</p>
    <p class="muted small">Tryb: {b.mode}{b.modeBasis ? ` (${b.modeBasis})` : ''} · uprawnionych {b.eligible.length} · kworum {b.quorum}</p>
    <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cast}><span style={{width: `${total ? Math.min(100, cast / total * 100) : 0}%`}}/></div>
    <p>Oddano <strong>{cast}</strong> z {total} {b.secret ? `· pobrano kart ${b.secret.issued.length}` : ''}</p>
    {b.secret && <p class="muted small">Głosowanie tajne — widać tylko, kto pobrał kartę. Odcisk klucza: <code>{b.secret.fingerprint}</code></p>}
    {pending.length > 0 && <div class="pending">
      <p class="small strong">Jeszcze nie {b.secret ? 'pobrali karty' : 'zagłosowali'}:</p>
      <ul>{pending.map(id => <li><span>{s.personName(id)}</span>{!readOnly && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'ballot_absent', ballotId: b.id, personId: id})} title="Osoba wyszła z sali — głosowanie nie będzie na nią czekać">Nieobecność</Button>}</li>)}</ul>
    </div>}
    {!readOnly && <div class="actions"><Button kind="ghost" onClick={() => setClosing(true)}>Zakończ głosowanie teraz</Button></div>}
    {closing && <Confirm title="Zakończyć głosowanie?" kind="danger" confirm="Zakończ głosowanie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'ballot_close', ballotId: b.id})}
      text={<p>{pending.length ? `Nie zagłosowało jeszcze: ${pending.map(id => s.personName(id)).join(', ')}. Ich głosy nie zostaną policzone.` : 'Wszyscy obecni oddali głos.'} Głosowanie zwykle kończy się samo, gdy zagłosują wszyscy uprawnieni albo upłynie czas.</p>}/>}
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
  return <section class={'card item-work' + (current ? ' is-current' : '')}>
    <div class="card-head">
      <div><p class="kicker">Punkt {itemNumber(m.agenda, it.id)} {current && '· teraz procedowany'}</p><h2>{it.title}</h2></div>
      <Chip tone={tone}>{label}</Chip>
    </div>
    {locked && <Notice>Ten punkt można rozpocząć po przyjęciu porządku obrad.</Notice>}
    {!readOnly && <div class="actions">
      {!current && <Button kind="primary" disabled={busy || locked || open || it.status === 'wycofany'} onClick={() => send({type: 'item_start', itemId: it.id})}>Rozpocznij ten punkt</Button>}
      <Button disabled={busy} onClick={() => send({type: 'present', kind: 'punkt', id: it.id})}>Pokaż uczestnikom</Button>
      {(current || it.status === 'w_toku') && <>
        <Button disabled={busy || open || (it.kind === 'porzadek' && !m.agendaAdopted)} onClick={() => send({type: 'item_end', itemId: it.id, status: 'zakonczony'})}>Zakończ punkt</Button>
        <Button kind="ghost" disabled={busy || open} onClick={() => setEnding('odroczony')}>Odrocz</Button>
      </>}
      {it.status === 'oczekuje' && it.kind === 'sprawa' && <Button kind="ghost" disabled={busy} onClick={() => setEnding('wycofany')}>Wycofaj</Button>}
      {next && <Button kind="primary" disabled={busy || open} onClick={() => send({type: 'item_start', itemId: next.id})}>Dalej: {itemNumber(m.agenda, next.id)}. {next.title.length > 48 ? next.title.slice(0, 46) + '…' : next.title}</Button>}
    </div>}
    {it.kind === 'otwarcie' && !readOnly && <Quorum/>}
    {materials.length > 0 && <div class="materials">
      <h4>Materiały</h4>
      {materials.map(x => <div class="material-row"><MaterialLink id={x.id} version={x.version} label={x.title}/><span class="muted small">wersja {x.version}</span>
        {!readOnly && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'present', kind: 'material', id: x.id})}>Pokaż uczestnikom</Button>}</div>)}
    </div>}
    {(organizer || !readOnly) && others.length > 0 && <div class="row">
      <select aria-label="Przypisz materiał" onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) send({type: 'item_material', itemId: it.id, materialId: v, on: true}); (e.target as HTMLSelectElement).value = ''; }}>
        <option value="">+ Przypisz materiał do punktu…</option>{others.map(x => <option value={x.id}>{x.title}</option>)}
      </select>
    </div>}
    {!readOnly && <BallotForm it={it}/>}
    {ballots.some(b => b.status === 'zamkniete' && b.id !== skipBallot) && <div class="results"><h4>Głosowania w tym punkcie</h4>{ballots.filter(b => b.status === 'zamkniete' && b.id !== skipBallot).map(b => <div><ResultCard b={b}/>{!readOnly && !b.announcedAt && <AnnounceButton b={b}/>}</div>)}</div>}
    <Field label="Notatka do protokołu" hint="Przebieg dyskusji, wnioski, ustalenia — trafi do projektu protokołu.">
      <textarea rows={4} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} onBlur={() => note !== it.note && send({type: 'item_edit', itemId: it.id, note})}/>
    </Field>
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
    <p><strong>Obecnych {present} z {total}</strong> · kworum {required} (§ 8 ust. 2)</p>
    {last && <p class="muted small">Ostatnio stwierdzono {fmtTime(last.at)}: {last.present >= last.required ? 'kworum jest' : 'brak kworum'}.</p>}
    <Button kind={present >= required ? 'primary' : 'secondary'} disabled={busy} onClick={() => send({type: 'quorum'})}>{present >= required ? 'Stwierdzam kworum' : 'Zapisz brak kworum'}</Button>
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
    if (it.kind === 'protokol') return mat ? `Przyjęcie protokołu: ${mat.title}` : 'Przyjęcie protokołu z poprzedniego posiedzenia';
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
  if (done && !extra) return <div class="ballot-form"><p class="small muted">{materials.length > 1 ? 'Głosowano już nad wszystkimi dokumentami w tym punkcie.' : 'W tym punkcie przeprowadzono już głosowanie.'}</p><Button small kind="ghost" onClick={() => setExtra(true)}>Dodatkowe głosowanie w tym punkcie</Button></div>;
  return <form class="ballot-form" onSubmit={e => { e.preventDefault(); send({type: 'ballot_open', itemId: it.id, purpose, subject, mode, minutes, materialId: materialId || null}); }}>
    <h4>{it.kind === 'porzadek' ? 'Głosowanie nad porządkiem obrad' : 'Głosowanie w tym punkcie'}</h4>
    {materials.length > 1 && <Field label="Nad którym dokumentem?"><select value={materialId} onChange={e => { const v = (e.target as HTMLSelectElement).value; setMaterialId(v); setSubject(defaults(v)); }}>{materials.map(x => <option value={x.id}>{votedOn.has(x.id) ? '✓ ' : ''}{x.title}</option>)}</select></Field>}
    <Field label="Przedmiot głosowania"><input value={subject} onInput={e => setSubject((e.target as HTMLInputElement).value)} required maxLength={400}/></Field>
    <div class="row">
      <Field label="Tryb">
        <select value={mode} onChange={e => setMode((e.target as HTMLSelectElement).value as VoteMode)}>
          <option value="jawne">Jawne</option>
          <option value="imienne" disabled={it.mode !== 'imienne'}>Imienne{it.mode !== 'imienne' ? ' — wymaga postanowienia' : ''}</option>
          <option value="tajne" disabled={it.mode !== 'tajne'}>Tajne{it.mode !== 'tajne' ? ' — wymaga postanowienia' : ''}</option>
        </select>
      </Field>
      <Field label="Czas"><select value={String(minutes)} onChange={e => setMinutes(Number((e.target as HTMLSelectElement).value))}>{[1, 2, 3, 5, 10, 15].map(n => <option value={String(n)}>{n} min</option>)}</select></Field>
    </div>
    {it.kind !== 'porzadek' && !it.mode && <p class="small muted">Głosowanie tajne lub imienne wymaga wcześniejszego postanowienia Prezydium (§ 11 ust. 2): <button type="button" class="link" onClick={() => setMotion('tajne')}>wniosek o głosowanie tajne</button> · <button type="button" class="link" onClick={() => setMotion('imienne')}>wniosek o głosowanie imienne</button></p>}
    {it.mode && <p class="small muted">Postanowiono o głosowaniu {it.mode === 'tajne' ? 'tajnym' : 'imiennym'}: {it.modeBasis}.</p>}
    <Button kind="primary" type="submit" disabled={busy || open || m.status !== 'trwa'}>Otwórz głosowanie</Button>
    {motion && <Confirm title={`Wniosek o głosowanie ${motion === 'tajne' ? 'tajne' : 'imienne'}`} confirm="Poddaj wniosek pod głosowanie" onClose={() => setMotion(null)} onConfirm={() => send({type: 'mode_motion', itemId: it.id, mode: motion, minutes: 2})}
      text={<p>Prezydium zdecyduje zwykłą większością głosów w głosowaniu jawnym, czy sprawę „{it.title}” głosować w trybie {motion === 'tajne' ? 'tajnym' : 'imiennym'} (§ 11 ust. 2).</p>}/>}
  </form>;
}

function AgendaFixes() {
  const [open, setOpen] = useState(false);
  return <div class="stack-tight">
    <p class="muted small">Przed przyjęciem porządek można poprawiać. Po nieprzyjęciu popraw go i ponownie poddaj pod głosowanie.</p>
    <Button small onClick={() => setOpen(true)}>Popraw porządek obrad</Button>
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
    <div class="actions"><Button small onClick={() => setMode('dodaj')}>Wniosek: dodaj punkt</Button>{removable.length > 0 && <Button small kind="ghost" onClick={() => setMode('usun')}>Wniosek: usuń punkt</Button>}</div>
    {mode && <Modal title={mode === 'dodaj' ? 'Zmiana porządku: dodanie punktu' : 'Zmiana porządku: usunięcie punktu'} onClose={() => setMode(null)}>
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
        <Notice>Otworzy się głosowanie jawne (2 minuty). Zmiana wejdzie do porządku po przyjęciu zwykłą większością głosów.</Notice>
        <div class="actions"><Button onClick={() => setMode(null)}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Poddaj pod głosowanie</Button></div>
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
  const shownLabel = !shown ? 'nic (ekran pusty)' : shown.kind === 'punkt' ? `punkt ${itemNumber(m.agenda, shown.id)}` : shown.kind === 'material' ? `materiał: ${m.materials.find(x => x.id === shown.id)?.title ?? ''}` : shown.kind === 'glosowanie' ? 'głosowanie' : 'wynik głosowania';
  return <section class="card">
    <h3>Obrady</h3>
    <p class={present >= required ? 'ok-text' : 'warn-text'}><strong>Obecnych {present} z {total}</strong> · kworum {required}</p>
    <p class="small">Uczestnicy widzą: <strong>{shownLabel}</strong> {!readOnly && shown && <button class="link" onClick={() => send({type: 'present', kind: null})}>wyczyść</button>}</p>
    {!readOnly && <div class="actions">
      {m.status === 'trwa' ? <Button disabled={busy || open} onClick={() => send({type: 'break', on: true})}>Przerwa</Button> : <Button kind="primary" disabled={busy} onClick={() => send({type: 'break', on: false})}>Wznów obrady</Button>}
      <Button kind="danger" disabled={busy || open} onClick={() => setClosing(true)}>Zamknij posiedzenie</Button>
    </div>}
    {closing && <Confirm title="Zamknąć posiedzenie?" kind="danger" confirm="Zamknij posiedzenie" onClose={() => setClosing(false)} onConfirm={() => send({type: 'close'})}
      text={<p>{m.agenda.filter(i => i.status === 'oczekuje').length ? `W porządku są jeszcze nierozpoczęte punkty (${m.agenda.filter(i => i.status === 'oczekuje').length}). ` : ''}Po zamknięciu nie można już głosować ani zmieniać zapisu. Powstanie projekt protokołu.</p>}/>}
  </section>;
}

function Attendance() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [guests, setGuests] = useState<{id: string; displayName: string; label: string}[]>([]);
  useEffect(() => { if (m.invited.length) request<{accounts: typeof guests}>('/api/people').then(r => setGuests(r.accounts)).catch(() => {}); }, [m.invited.length]);
  const canMark = m.chair.current === s.personId || s.isOrganizer(m.organ);
  const lastEvent = (who: string) => [...m.presenceLog].reverse().find(e => e.who === who);
  return <section class="card">
    <h3>Lista obecności</h3>
    <ul class="attendance">
      {organMembers(s.roster, m.organ).map(ms => {
        const status = m.attendance[ms.personId] ?? 'nieobecny', ev = lastEvent(ms.personId);
        return <li class={'att-' + status}>
          <span class="att-dot" aria-hidden="true"/>
          <span class="att-name">{s.personName(ms.personId)}<small>{ms.label} · {status === 'obecny' ? 'obecność' : status === 'wyszedl' ? 'wyjście' : 'nieobecność'}{ev ? ` ${fmtTime(ev.at)}` : ''}</small></span>
          {canMark && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'presence', who: ms.personId, present: status !== 'obecny'})}>{status === 'obecny' ? 'Wyjście' : 'Obecność'}</Button>}
        </li>;
      })}
    </ul>
    {m.invited.length > 0 && <>
      <h4>Głos doradczy i goście</h4>
      <ul class="attendance">{m.invited.map(id => {
        const g = guests.find(x => x.id === id), status = m.guests[id] ?? 'nieobecny';
        return <li class={'att-' + status}><span class="att-dot"/><span class="att-name">{g?.displayName ?? 'Zaproszona osoba'}<small>{g?.label}</small></span>
          {canMark && <Button small kind="ghost" disabled={busy} onClick={() => send({type: 'presence', who: id, guest: true, present: status !== 'obecny'})}>{status === 'obecny' ? 'Wyjście' : 'Obecność'}</Button>}</li>;
      })}</ul>
    </>}
  </section>;
}

function Chairing({readOnly}: {readOnly: boolean}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const candidates = organMembers(s.roster, m.organ).filter(ms => ms.canChair && ms.personId !== m.chair.current && m.attendance[ms.personId] === 'obecny');
  return <section class="card">
    <h3>Prowadzenie</h3>
    <p>Prowadzi: <strong>{s.personName(m.chair.current)}</strong></p>
    {m.chair.deputy && <p class="muted small">Zastępstwo przewodniczącego: {s.personName(m.chair.deputy)} — {m.chair.deputyBasis}</p>}
    {!readOnly && candidates.length > 0 && <div class="row">
      <select aria-label="Przekaż prowadzenie" onChange={e => { const v = (e.target as HTMLSelectElement).value; if (v) send({type: 'chair_handover', personId: v}); (e.target as HTMLSelectElement).value = ''; }} disabled={busy}>
        <option value="">Przekaż prowadzenie…</option>{candidates.map(c => <option value={c.personId}>{s.personName(c.personId)} — {c.label}</option>)}
      </select>
    </div>}
    {!readOnly && !candidates.length && <p class="muted small">Prowadzenie można przekazać obecnej wiceprzewodniczącej lub obecnemu wiceprzewodniczącemu.</p>}
    {canChairOrgan(s.roster, m.organ, s.personId) && m.chair.current !== s.personId && <p class="muted small">Prowadzenie przejmiesz w widoku uczestnika.</p>}
  </section>;
}

function ChairMotions() {
  const {m, send, busy} = useMeeting();
  const ready = m.motions.filter(x => x.status === 'zlozony' || (x.status === 'przyjety' && !x.repeatBallotId));
  if (!ready.length) return null;
  const open = m.ballots.some(b => b.status === 'otwarte');
  return <section class="card highlight">
    <h3>Reasumpcja — decyzja prowadzącego</h3>
    {ready.map(x => {
      const b = m.ballots.find(y => y.id === x.ballotId);
      return <div class="motion"><p>Głosowanie nr {b?.number}: {b?.subject}</p>
        {x.status === 'zlozony'
          ? <Button kind="primary" disabled={busy || open} onClick={() => send({type: 'motion_vote', motionId: x.id, minutes: 2})}>Poddaj wniosek pod głosowanie</Button>
          : <Button kind="primary" disabled={busy || open} onClick={() => send({type: 'reasumption_open', motionId: x.id, minutes: 2})}>Przeprowadź ponowne głosowanie</Button>}
      </div>;
    })}
  </section>;
}

function Log() {
  const {m} = useMeeting();
  const [open, setOpen] = useState(false);
  return <section class="card">
    <button class="section-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>Przebieg (dziennik) <span>{open ? '▲' : '▼'}</span></button>
    {open && <ol class="log">{[...m.log].reverse().map(l => <li><time>{fmtTime(l.at)}</time> {l.text}</li>)}</ol>}
  </section>;
}
