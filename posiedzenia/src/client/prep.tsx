import {useEffect, useState} from 'preact/hooks';
import {parseAgendaText} from '../shared/agenda.ts';
import {canChairOrgan, isChairman, materialTypeLabel, noticeDays} from '../shared/meeting.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {MaterialType, Meeting} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, Confirm, Field, Modal, Notice, useAction} from './ui.tsx';
import {MaterialLink} from './reader.tsx';
import {go} from './route.ts';

export const materialTypes: [MaterialType, string][] = [
  ['uchwala', 'Uchwała'], ['oswiadczenie', 'Stanowisko / oświadczenie'], ['apel', 'Apel'], ['rezolucja', 'Rezolucja'], ['deklaracja', 'Deklaracja'],
  ['sprawozdanie', 'Sprawozdanie'], ['protokol', 'Protokół'], ['informacja', 'Informacja'], ['inny', 'Inny materiał'],
];

export function PrepEditor() {
  const {m} = useMeeting();
  return <div class="prep">
    <div class="prep-main">
      <section class="card"><div class="card-head"><h3>Porządek obrad</h3><span class="muted small">projekt — przyjmuje go Prezydium w głosowaniu</span></div><AgendaEditor/></section>
      <section class="card"><h3>Materiały ({m.materials.length})</h3><MaterialsEditor/></section>
    </div>
    <aside class="prep-side">
      <OpenMeeting/>
      <Details/>
      <Deputy/>
      <Invites/>
      <DeleteMeeting/>
    </aside>
  </div>;
}

export function AgendaEditor() {
  const {m, send, busy} = useMeeting();
  const [editing, setEditing] = useState<string | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const items = orderedAgenda(m.agenda);
  const add = async (e: Event, parentId: string | null) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement, title = new FormData(form).get('title') as string;
    if (title.trim() && await send({type: 'item_add', title, parentId})) { form.reset(); setSubFor(null); }
  };
  return <div class="agenda-editor">
    {!items.length && <p class="muted">Porządek jest pusty. Dodaj punkty albo wczytaj gotowy porządek z tekstu.</p>}
    <ol class="edit-list">
      {items.map(it => {
        const siblings = m.agenda.filter(i => i.parentId === it.parentId), index = siblings.indexOf(it);
        return <li class={it.parentId ? 'is-sub' : ''}>
          <span class="agenda-no">{itemNumber(m.agenda, it.id)}</span>
          {editing === it.id
            ? <form class="inline-form" onSubmit={async e => { e.preventDefault(); const t = new FormData(e.currentTarget).get('title') as string; if (await send({type: 'item_edit', itemId: it.id, title: t})) setEditing(null); }}>
                <input name="title" defaultValue={it.title} maxLength={400} required autoFocus/><Button small type="submit" kind="primary" disabled={busy}>Zapisz</Button><Button small onClick={() => setEditing(null)}>Anuluj</Button>
              </form>
            : <button class="edit-title" onClick={() => setEditing(it.id)} title="Kliknij, aby zmienić nazwę">{it.title}{it.materialIds.length > 0 && <span class="badge">{it.materialIds.length} mat.</span>}</button>}
          <span class="edit-tools">
            <button class="icon-btn" disabled={busy || index === 0} onClick={() => send({type: 'item_move', itemId: it.id, direction: -1})} aria-label="W górę">↑</button>
            <button class="icon-btn" disabled={busy || index === siblings.length - 1} onClick={() => send({type: 'item_move', itemId: it.id, direction: 1})} aria-label="W dół">↓</button>
            {!it.parentId && <button class="icon-btn" onClick={() => setSubFor(subFor === it.id ? null : it.id)} aria-label="Dodaj podpunkt" title="Dodaj podpunkt">＋</button>}
            {it.kind !== 'porzadek' && <button class="icon-btn danger" disabled={busy} onClick={() => setRemoving(it.id)} aria-label="Usuń">×</button>}
          </span>
          {subFor === it.id && <form class="inline-form sub-form" onSubmit={e => add(e, it.id)}><input name="title" placeholder={`Podpunkt w punkcie ${itemNumber(m.agenda, it.id)}, np. Uchwała nr …`} maxLength={400} required autoFocus/><Button small type="submit" kind="primary" disabled={busy}>Dodaj</Button></form>}
        </li>;
      })}
    </ol>
    <form class="inline-form" onSubmit={e => add(e, null)}>
      <input name="title" placeholder={m.kind === 'procedura' ? 'Sprawa do głosowania, np. Uchwała nr … w sprawie …' : 'Nowy punkt porządku obrad'} maxLength={400} required/>
      <Button type="submit" kind="primary" disabled={busy}>Dodaj</Button>
    </form>
    <div class="actions"><Button small onClick={() => setImporting(true)}>Wczytaj porządek z tekstu</Button></div>
    {importing && <AgendaImport onClose={() => setImporting(false)}/>}
    {removing && <Confirm title="Usunąć punkt?" kind="danger" confirm="Usuń" onClose={() => setRemoving(null)} onConfirm={() => send({type: 'item_remove', itemId: removing})}
      text={<p>„{m.agenda.find(i => i.id === removing)?.title}”{m.agenda.some(i => i.parentId === removing) ? ' zostanie usunięty razem z podpunktami.' : ' zostanie usunięty z porządku.'}</p>}/>}
  </div>;
}

function AgendaImport(props: {onClose: () => void}) {
  const {m, send, busy} = useMeeting();
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(m.status === 'przygotowanie' && m.kind === 'posiedzenie');
  const preview = text.trim() ? parseAgendaText(text) : null;
  return <Modal title="Wczytaj porządek obrad z tekstu" wide onClose={props.onClose}>
    <div class="import">
      <div class="stack">
        <p class="small">Wklej porządek z Worda albo z pliku tekstowego. Punkty główne zacznij od numeru („1.”, „2.”). Podpunkty wcięte albo zaczynające się od myślnika.</p>
        <textarea rows={14} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} placeholder={'1. Otwarcie posiedzenia i stwierdzenie kworum.\n2. Przyjęcie porządku obrad.\n3. Przyjęcie protokołu z poprzedniego posiedzenia.\n4. Rozpatrzenie projektów uchwał PWZ\n   - Uchwała nr 117/IX/2026\n   - Uchwała nr 118/IX/2026\n5. Sprawy bieżące i wolne wnioski.\n6. Zamknięcie posiedzenia.'}/>
        <label class="check"><input type="file" accept=".txt,.md,text/plain" onChange={async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) setText(await f.text()); }}/> albo wybierz plik TXT/MD</label>
        {m.status === 'przygotowanie' && <label class="check"><input type="checkbox" checked={replace} onChange={e => setReplace((e.target as HTMLInputElement).checked)}/> Zastąp obecny porządek (w przeciwnym razie punkty zostaną dopisane)</label>}
      </div>
      <div class="import-preview">
        <h4>Podgląd</h4>
        {!preview && <p class="muted small">Tu pojawi się rozpoznany porządek.</p>}
        {preview && <ol class="preview-list">{preview.items.map(i => <li class={i.parent !== null ? 'is-sub' : ''}>{i.title}</li>)}</ol>}
        {preview?.warnings.map(w => <Notice tone="warn">{w}</Notice>)}
      </div>
    </div>
    <div class="actions"><Button onClick={props.onClose}>Anuluj</Button><Button kind="primary" disabled={busy || !preview?.items.length} onClick={async () => { if (await send({type: 'agenda_import', text, replace})) props.onClose(); }}>Wczytaj {preview?.items.length ?? 0} pozycji</Button></div>
  </Modal>;
}

export function MaterialsEditor() {
  const {m, replace} = useMeeting();
  const s = useSession();
  const {busy, error, run} = useAction();
  const [mode, setMode] = useState<'plik' | 'tekst' | null>(null);
  const [split, setSplit] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const resolutionsItem = m.agenda.find(i => i.kind === 'uchwaly') ?? m.agenda.find(i => !i.parentId && i.kind === 'sprawa');
  const top = m.agenda.filter(i => !i.parentId);
  const usage = (id: string) => m.agenda.filter(i => i.materialIds.includes(id)).map(i => itemNumber(m.agenda, i.id));
  const upload = (e: Event) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    if (split) { form.set('split', '1'); form.set('createItems', form.get('createItems') ? '1' : ''); }
    run(async () => { const r = await request<{meeting: ViewMeeting; created: string[]}>(`/api/meetings/${m.id}/materials`, {form}); replace(r); setMode(null); setSplit(false); });
  };
  const paste = (e: Event) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    run(async () => { const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${m.id}/materials`, {body: {title: f.get('title'), type: f.get('type'), number: f.get('number'), text: f.get('text'), format: f.get('format'), itemId: f.get('itemId') || null}}); replace(r); setMode(null); });
  };
  const itemSelect = (name: string, def?: string) => <select name={name} defaultValue={def ?? ''}><option value="">— nie przypisuj —</option>{orderedAgenda(m.agenda).map(i => <option value={i.id}>{itemNumber(m.agenda, i.id)}. {i.title.slice(0, 80)}</option>)}</select>;
  return <div class="materials-editor">
    <p class="muted small">Uczestnicy czytają materiały jako lekki tekst dopasowany do telefonu. Oryginał (DOCX/PDF) można pobrać osobno. Głosowanie zawsze dotyczy wersji utrwalonej w chwili jego otwarcia.</p>
    <div class="actions"><Button kind="primary" onClick={() => setMode('plik')}>Dodaj plik</Button><Button onClick={() => setMode('tekst')}>Wklej tekst</Button></div>
    {m.materials.length > 0 && <ul class="material-table">{m.materials.map(x => <li>
      <div><MaterialLink id={x.id} version={x.version} label={x.title}/><p class="muted small">{materialTypeLabel(x.type)}{x.number ? ` nr ${x.number}` : ''} · wersja {x.version} · {Math.max(1, Math.round(x.size / 1024))} KB{x.fileName ? ` · oryginał: ${x.fileName}` : ''}{usage(x.id).length ? ` · punkt ${usage(x.id).join(', ')}` : ' · nieprzypisany'}</p></div>
      {m.status === 'przygotowanie' && s.isOrganizer(m.organ) && <button class="icon-btn danger" onClick={() => setRemoving(x.id)} aria-label="Usuń materiał">×</button>}
    </li>)}</ul>}
    {mode === 'plik' && <Modal title="Dodaj materiał z pliku" onClose={() => setMode(null)}>
      <form class="stack" onSubmit={upload}>
        <Field label="Plik" hint="DOCX, PDF, TXT lub Markdown, do 10 MB. Treść DOCX zamieni się na lekki tekst; PDF będzie do pobrania."><input type="file" name="file" required accept=".docx,.pdf,.txt,.md,.markdown"/></Field>
        <label class="check"><input type="checkbox" checked={split} onChange={e => setSplit((e.target as HTMLInputElement).checked)}/> Plik zawiera kilka uchwał (np. uchwały PWZ) — podziel na osobne dokumenty</label>
        {split ? <>
          <p class="small muted">Podział następuje przy każdym akapicie zaczynającym się od „Uchwała nr …” (także stanowisko, apel). Każda uchwała stanie się osobnym dokumentem i podpunktem.</p>
          <Field label="Utwórz podpunkty w punkcie"><select name="itemId" defaultValue={resolutionsItem?.id ?? ''}>{top.map(i => <option value={i.id}>{itemNumber(m.agenda, i.id)}. {i.title.slice(0, 80)}</option>)}</select></Field>
          <label class="check"><input type="checkbox" name="createItems" defaultChecked/> Dodaj każdą uchwałę jako osobny podpunkt porządku</label>
        </> : <>
          <Field label="Tytuł" hint="Puste = nazwa pliku."><input name="title" maxLength={300}/></Field>
          <div class="row"><Field label="Rodzaj"><select name="type">{materialTypes.map(([v, l]) => <option value={v}>{l}</option>)}</select></Field><Field label="Numer"><input name="number" maxLength={60} placeholder="np. 108/IX/2026"/></Field></div>
          <Field label="Przypisz do punktu">{itemSelect('itemId')}</Field>
        </>}
        {error && <Notice tone="error">{error}</Notice>}
        <div class="actions"><Button onClick={() => setMode(null)}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>{busy ? 'Przetwarzanie…' : 'Dodaj'}</Button></div>
      </form>
    </Modal>}
    {mode === 'tekst' && <Modal title="Wklej treść materiału" wide onClose={() => setMode(null)}>
      <form class="stack" onSubmit={paste}>
        <Field label="Tytuł"><input name="title" required maxLength={300} placeholder="np. Uchwała nr 108/IX/2026 w sprawie …"/></Field>
        <div class="row"><Field label="Rodzaj"><select name="type">{materialTypes.map(([v, l]) => <option value={v}>{l}</option>)}</select></Field><Field label="Numer"><input name="number" maxLength={60}/></Field><Field label="Format"><select name="format"><option value="text">Zwykły tekst</option><option value="markdown">Markdown</option></select></Field></div>
        <Field label="Treść" hint="Akapity oddziel pustym wierszem. Wiersz „§ 1” stanie się nagłówkiem."><textarea name="text" rows={12} required/></Field>
        <Field label="Przypisz do punktu">{itemSelect('itemId')}</Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div class="actions"><Button onClick={() => setMode(null)}>Anuluj</Button><Button kind="primary" type="submit" disabled={busy}>Dodaj</Button></div>
      </form>
    </Modal>}
    {removing && <Confirm title="Usunąć materiał?" kind="danger" confirm="Usuń" onClose={() => setRemoving(null)} text={<p>„{m.materials.find(x => x.id === removing)?.title}” zostanie usunięty z posiedzenia.</p>}
      onConfirm={() => run(async () => { const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${m.id}/materials/${removing}`, {method: 'DELETE'}); replace(r); })}/>}
    {error && !mode && <Notice tone="error">{error}</Notice>}
  </div>;
}

function OpenMeeting() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [confirm, setConfirm] = useState(false);
  const days = noticeDays(m as Meeting);
  const warnings = [
    days === null ? 'Nie wpisano daty wysłania zawiadomienia (§ 7 ust. 1).' : days < 7 ? `Zawiadomienie wysłano ${days} dni przed posiedzeniem — regulamin wymaga co najmniej 7 dni (§ 7 ust. 1).` : '',
    m.agenda.length < 2 ? 'Porządek obrad jest prawie pusty.' : '',
    m.mode === 'zdalne' && !m.link ? 'Posiedzenie zdalne bez odnośnika do połączenia — uczestnicy muszą mieć dwustronną komunikację na żywo (§ 14 ust. 5).' : '',
  ].filter(Boolean);
  if (!canChairOrgan(s.roster, m.organ, s.personId)) return <section class="card"><h3>Otwarcie posiedzenia</h3><p class="muted small">Posiedzenie otworzy przewodniczący lub wiceprzewodniczący (§ 9 ust. 1). Wtedy uczestnicy potwierdzają obecność na swoich telefonach.</p></section>;
  return <section class="card highlight">
    <h3>Otwarcie posiedzenia</h3>
    <p class="small">Po otwarciu prowadzisz obrady. Członkowie potwierdzają obecność na telefonach.</p>
    {warnings.map(w => <Notice tone="warn">{w}</Notice>)}
    <Button kind="primary" wide disabled={busy} onClick={() => setConfirm(true)}>Otwórz posiedzenie</Button>
    {confirm && <Confirm title="Otworzyć posiedzenie?" confirm="Otwórz i prowadź" onClose={() => setConfirm(false)} onConfirm={() => send({type: 'open'})}
      text={<><p>Rozpoczniesz prowadzenie obrad, a Twoja obecność zostanie zapisana automatycznie.</p>{warnings.length > 0 && <p class="warn-text">Uwagi: {warnings.join(' ')}</p>}</>}/>}
  </section>;
}

function Details() {
  const {m, send, busy} = useMeeting();
  const days = noticeDays(m as Meeting);
  const [mode, setMode] = useState(m.mode);
  return <section class="card">
    <h3>Dane posiedzenia</h3>
    <form class="stack" onSubmit={e => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      send({type: 'details', title: String(f.get('title')), date: String(f.get('date')), time: String(f.get('time')), place: String(f.get('place')), mode, link: String(f.get('link') ?? ''), noticeDate: String(f.get('noticeDate') ?? '')});
    }}>
      <Field label="Tytuł"><input name="title" defaultValue={m.title} maxLength={200} required/></Field>
      <div class="row"><Field label="Data"><input type="date" name="date" defaultValue={m.date} required/></Field><Field label="Godzina"><input type="time" name="time" defaultValue={m.time} required/></Field></div>
      <Field label="Miejsce"><input name="place" defaultValue={m.place} maxLength={200}/></Field>
      <Field label="Tryb"><select value={mode} onChange={e => setMode((e.target as HTMLSelectElement).value as Meeting['mode'])}><option value="stacjonarne">Stacjonarne</option><option value="zdalne">Zdalne</option></select></Field>
      {mode === 'zdalne' && <Field label="Odnośnik do połączenia (wideo/audio)" hint="Dwustronna komunikacja w czasie rzeczywistym (§ 14 ust. 5), np. Teams, Zoom, Meet."><input name="link" type="url" defaultValue={m.link} placeholder="https://…" pattern="https://.*"/></Field>}
      <Field label="Data wysłania zawiadomienia" hint={days === null ? 'Wymagane co najmniej 7 dni przed posiedzeniem (§ 7 ust. 1).' : days >= 7 ? `${days} dni przed posiedzeniem — termin zachowany.` : `${days} dni — mniej niż wymagane 7 dni (§ 7 ust. 1).`}>
        <input type="date" name="noticeDate" defaultValue={m.noticeDate}/>
      </Field>
      <Button type="submit" disabled={busy}>Zapisz dane</Button>
    </form>
  </section>;
}

function Deputy() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const vices = organMembers(s.roster, m.organ).filter(ms => ms.func === 'wiceprzewodniczacy');
  const chairman = isChairman(s.roster, m.organ, s.personId);
  const [person, setPerson] = useState(m.chair.deputy ?? '');
  const [basis, setBasis] = useState(chairman ? '' : m.chair.deputyBasis);
  useEffect(() => setPerson(m.chair.deputy ?? ''), [m.chair.deputy]);
  if (!chairman && !s.account.admin && s.account.kind !== 'biuro') return m.chair.deputy ? <section class="card"><h3>Zastępstwo</h3><p class="small">{s.personName(m.chair.deputy)} — {m.chair.deputyBasis}</p></section> : null;
  return <section class="card">
    <h3>Zastępstwo przewodniczącego</h3>
    <p class="muted small">Na czas nieobecności przewodniczący wyznacza, który z wiceprzewodniczących go zastępuje (§ 16 ust. 2). Gdy nie jest to możliwe — wyznacza Prezydium (§ 16 ust. 3).</p>
    <Field label="Zastępca"><select value={person} onChange={e => setPerson((e.target as HTMLSelectElement).value)}><option value="">— brak wyznaczenia —</option>{vices.map(v => <option value={v.personId}>{s.personName(v.personId)} — {v.label}</option>)}</select></Field>
    {!chairman && person && <Field label="Podstawa wyznaczenia" hint="Np. uchwała Prezydium nr … z dnia …"><input value={basis} onInput={e => setBasis((e.target as HTMLInputElement).value)} maxLength={200}/></Field>}
    <Button disabled={busy || person === (m.chair.deputy ?? '')} onClick={() => send({type: 'deputy', personId: person || null, basis})}>Zapisz</Button>
  </section>;
}

function Invites() {
  const {m, send, busy} = useMeeting();
  const [people, setPeople] = useState<{id: string; displayName: string; label: string; kind: string}[] | null>(null);
  useEffect(() => { request<{accounts: NonNullable<typeof people>}>('/api/people').then(r => setPeople(r.accounts.filter(a => a.kind === 'doradczy' || a.kind === 'gosc'))).catch(() => setPeople([])); }, []);
  return <section class="card">
    <h3>Głos doradczy i goście</h3>
    <p class="muted small">Zawiadamia się przewodniczących okręgowej komisji rewizyjnej i okręgowego sądu oraz okręgowego rzecznika — mogą uczestniczyć z głosem doradczym (§ 7 ust. 2). Goście — wyłącznie na zaproszenie.</p>
    {people === null ? <p class="muted small">Wczytywanie…</p> : !people.length ? <p class="muted small">Brak kont z głosem doradczym ani gości. Administrator może je dodać w „Konta”.</p> :
      <ul class="checks">{people.map(p => <li><label class="check"><input type="checkbox" checked={m.invited.includes(p.id)} disabled={busy} onChange={e => send({type: 'invite', accountId: p.id, on: (e.target as HTMLInputElement).checked})}/> {p.displayName}{p.label ? <span class="muted"> — {p.label}</span> : ''} <span class="muted small">({p.kind === 'doradczy' ? 'głos doradczy' : 'gość'})</span></label></li>)}</ul>}
  </section>;
}

export function DeleteMeeting() {
  const {m} = useMeeting();
  const {busy, error, run} = useAction();
  const [confirm, setConfirm] = useState(false);
  return <section class="card subtle">
    <Button kind="ghost" small onClick={() => setConfirm(true)}>Usuń to {m.kind === 'posiedzenie' ? 'posiedzenie' : 'głosowanie'}</Button>
    {error && <Notice tone="error">{error}</Notice>}
    {confirm && <Confirm title="Usunąć?" kind="danger" confirm="Usuń" onClose={() => setConfirm(false)} text={<p>„{m.title}” zostanie trwale usunięte razem z materiałami. Można to zrobić tylko przed otwarciem.</p>}
      onConfirm={() => run(async () => { await request(`/api/meetings/${m.id}`, {method: 'DELETE'}); go(''); })}/>}
    {busy && <span class="muted small">Usuwanie…</span>}
  </section>;
}
