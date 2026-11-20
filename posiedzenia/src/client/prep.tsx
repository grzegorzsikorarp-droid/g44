import type {ComponentChildren} from 'preact';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {parseAgendaText} from '../shared/agenda.ts';
import type {Command} from '../shared/meeting.ts';
import {canChairOrgan, isChairman, materialTypeLabel, noticeDays} from '../shared/meeting.ts';
import {sortedDocTypes} from '../shared/doctypes.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {organMembers} from '../shared/roster.ts';
import type {AgendaItem, Meeting, MeetingMode} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {announce, Button, CardTitle, Check, Chip, Confirm, ErrorNotice, Field, fmtShort, fmtTime, Fold, Modal, Notice, plural, SaveStatus, Segments, StateChip, useAction, useSaveStatus, type SaveState} from './ui.tsx';
import {ItemEditForm} from './item-form.tsx';
import {readinessChip, type Readiness} from './stany.ts';
import {MaterialLink} from './reader.tsx';
import {brand} from './brand.ts';
import {go} from './route.ts';
import {useDocTypes} from './doctypes.ts';
import {cleanPresenters, DocTypeSelect, PeopleFacts, PresentersEditor, samePresenters} from './people.tsx';

// Pozycja porządku to w posiedzeniu punkt, a w głosowaniu między posiedzeniami sprawa.
const nounOf = (m: Pick<Meeting, 'kind'>) => m.kind === 'procedura'
  ? {gen: 'sprawy', acc: 'sprawę', moved: 'Sprawa przesunięta', name: 'Nazwa sprawy', item: 'sprawa'}
  : {gen: 'punktu', acc: 'punkt', moved: 'Punkt przesunięty', name: 'Nazwa punktu', item: 'punkt'};

/**
 * Informacja o zapisie przy przycisku formularza, w jednym obszarze role="status": zapisywanie, błąd,
 * niezapisane zmiany albo zdanie po zapisie z godziną (T4.10).
 */
export function SaveLine(props: {status: SaveState; dirty: boolean; saved: (time: string) => string}) {
  const {state, at} = props.status;
  const error = state === 'error';
  const text = state === 'saving' ? 'Zapisywanie…' : error ? 'Nie zapisano. Sprawdź połączenie.'
    : props.dirty ? 'Masz niezapisane zmiany.' : state === 'saved' ? props.saved(fmtTime(at)) : '';
  return <p class={'save-status' + (error ? ' is-error' : '')} role="status">{text}</p>;
}

/** Ostrzeżenie przeglądarki przed zamknięciem karty z niezapisanymi zmianami (w wersji próbnej bez okien przeglądarki). */
export function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty || brand.demo) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
}

export function PrepEditor() {
  const {m} = useMeeting();
  return <div class="prep">
    <DuplicatedNotice/>
    <div class="prep-main">
      <section class="oi-card"><div class="panel-head"><CardTitle level={2}>Porządek obrad</CardTitle><span class="muted small">Projekt, który Prezydium przyjmuje w głosowaniu.</span></div><AgendaEditor/></section>
      <section class="oi-card"><CardTitle level={2}>{`Materiały (${m.materials.length})`}</CardTitle><MaterialsEditor/></section>
    </div>
    <aside class="prep-side">
      <ReadinessCard/>
      <OpenMeeting/>
      <Details/>
      <Deputy/>
      <Invites/>
    </aside>
    <div class="prep-end"><DuplicateButton/><DeleteMeeting/></div>
  </div>;
}

// Posiedzenie utworzone przez powielenie (F6): przygotowanie nowego posiedzenia pokazuje raz uwagę o dacie i zawiadomieniu.
let duplicated: string | null = null;

/** „Powiel posiedzenie” albo „Powiel głosowanie” (F6): nowe posiedzenie w przygotowaniu i przejście do niego. */
export function DuplicateButton(props: {primary?: boolean}) {
  const {m} = useMeeting();
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  if (!s.isOrganizer(m.organ)) return null;
  const label = m.kind === 'procedura' ? 'Powiel głosowanie' : 'Powiel posiedzenie';
  return <div class="stack-tight duplicate">
    <div><Button kind={props.primary ? 'primary' : 'secondary'} small={!props.primary} busy={busy} onClick={() => run(async () => {
      const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${m.id}/duplicate`, {body: {}});
      duplicated = r.meeting.id;
      go(`#p-${r.meeting.id}`);
    })}>{label}</Button></div>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

export function DuplicatedNotice() {
  const {m} = useMeeting();
  const [shown] = useState(() => { const hit = duplicated === m.id; if (hit) duplicated = null; return hit; });
  if (!shown) return null;
  return <div class="prep-note"><Notice tone="ok">{m.kind === 'procedura'
    ? 'Powielono głosowanie między posiedzeniami. Ustaw koniec głosowania i powiadom członków.'
    : 'Powielono posiedzenie. Ustaw datę i wyślij zawiadomienie.'}</Notice></div>;
}

/**
 * Edytor porządku obrad albo spraw do głosowania. Narzędzia wiersza to szare odnośniki z numerem pozycji w nazwie
 * (na urządzeniach z kursorem widać je przy najechaniu i przy fokusie). `rowExtra` dodaje pod wierszem treść
 * (w głosowaniu między posiedzeniami sekcję „Ustaw tryb i materiał”).
 */
export function AgendaEditor(props: {rowExtra?: (it: AgendaItem) => ComponentChildren}) {
  const {m, send, busy} = useMeeting();
  const procedure = m.kind === 'procedura';
  const noun = nounOf(m);
  const [editing, setEditing] = useState<string | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [focusAfter, setFocusAfter] = useState<{id: string; tool: string} | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const items = orderedAgenda(m.agenda);
  // Po zapisie, anulowaniu albo przesunięciu fokus wraca na narzędzie tego samego wiersza.
  useEffect(() => {
    if (!focusAfter) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('li[data-pozycja]') ?? [])].find(li => li.dataset.pozycja === focusAfter.id);
    row?.querySelector<HTMLElement>('.' + focusAfter.tool)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);
  const add = async (e: Event, parentId: string | null) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement, title = new FormData(form).get('title') as string;
    if (title.trim() && await send({type: 'item_add', title, parentId})) {
      form.reset();
      if (parentId) { setSubFor(null); setFocusAfter({id: parentId, tool: 'tool-podpunkt'}); }
    }
  };
  const move = async (it: AgendaItem, direction: -1 | 1) => {
    const r = await send({type: 'item_move', itemId: it.id, direction});
    if (!r) return;
    announce(`${noun.moved} na pozycję ${itemNumber(r.agenda, it.id)}.`);
    setFocusAfter({id: it.id, tool: direction < 0 ? 'tool-wyzej' : 'tool-nizej'});
  };
  const removed = m.agenda.find(i => i.id === removing);
  return <div class="stack agenda-editor">
    {!items.length && <p class="muted">{procedure ? 'Nie ma jeszcze spraw do głosowania. Dodaj sprawy albo wczytaj je z tekstu.' : 'Porządek jest pusty. Dodaj punkty albo wczytaj gotowy porządek z tekstu.'}</p>}
    {items.length > 0 && <ol class="edit-list" ref={list}>
      {items.map(it => {
        const siblings = m.agenda.filter(i => i.parentId === it.parentId), index = siblings.indexOf(it);
        const no = itemNumber(m.agenda, it.id);
        const count = it.materialIds.length;
        const meta = count ? `${count} ${plural(count, 'materiał', 'materiały', 'materiałów')}` : '';
        return <li key={it.id} class={'edit-row' + (it.parentId ? ' is-sub' : '')} data-pozycja={it.id}>
          <span class="agenda-no">{no}</span>
          {editing === it.id
            ? <ItemEditForm it={it} onDone={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }} onCancel={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }}/>
            : <>
              <div class="edit-main"><span class="edit-title">{it.title}</span><PeopleFacts it={it} compact/>{meta && <span class="edit-meta">{meta}</span>}</div>
              <span class="edit-tools">
                <Button small quiet kind="ghost" class="tool-zmien" onClick={() => { setSubFor(null); setEditing(it.id); }} label={`Zmień ${noun.acc} ${no}`}>Zmień</Button>
                <Button small quiet kind="ghost" class="tool-wyzej" busy={busy} disabled={index === 0} onClick={() => move(it, -1)} label={`Przesuń ${noun.acc} ${no} wyżej`}>Wyżej</Button>
                <Button small quiet kind="ghost" class="tool-nizej" busy={busy} disabled={index === siblings.length - 1} onClick={() => move(it, 1)} label={`Przesuń ${noun.acc} ${no} niżej`}>Niżej</Button>
                {!procedure && !it.parentId && <Button small quiet kind="ghost" class="tool-podpunkt" onClick={() => setSubFor(subFor === it.id ? null : it.id)} label={`Dodaj podpunkt w punkcie ${no}`}>Dodaj podpunkt</Button>}
                {it.kind !== 'porzadek' && <Button small quiet kind="ghost" class="tool-usun" haspopup busy={busy} onClick={() => setRemoving(it.id)} label={`Usuń ${noun.acc} ${no}`}>Usuń</Button>}
              </span>
            </>}
          {subFor === it.id && editing !== it.id && <SubItemForm no={no} busy={busy} onSubmit={e => add(e, it.id)}/>}
          {props.rowExtra && !it.parentId && <div class="edit-extra">{props.rowExtra(it)}</div>}
        </li>;
      })}
    </ol>}
    {/* Pole ma widoczną etykietę nad sobą, a przykład stoi w podpowiedzi pod polem (bez znikającego placeholdera). */}
    <form class="add-form" onSubmit={e => add(e, null)}>
      <Field label={procedure ? 'Nowa sprawa' : 'Nowy punkt'} hint={procedure ? 'Sprawa do głosowania, np. Uchwała nr … w sprawie …' : undefined}>
        <input ref={addInput} name="title" maxLength={400} required/>
      </Field>
      <Button type="submit" busy={busy}>{procedure ? 'Dodaj sprawę' : 'Dodaj punkt'}</Button>
    </form>
    <div class="actions"><Button small haspopup onClick={() => setImporting(true)}>{procedure ? 'Wczytaj sprawy z tekstu' : 'Wczytaj porządek z tekstu'}</Button></div>
    {importing && <AgendaImport onClose={() => setImporting(false)}/>}
    {removed && <Confirm title={procedure ? 'Usunąć sprawę?' : 'Usunąć punkt?'} kind="danger" confirm={procedure ? 'Usuń sprawę' : 'Usuń punkt'} onClose={() => setRemoving(null)}
      onConfirm={() => send({type: 'item_remove', itemId: removed.id}).then(r => { if (r) addInput.current?.focus(); })}
      text={<p>{procedure ? `Sprawa „${removed.title}” zostanie usunięta.` : `„${removed.title}”${m.agenda.some(i => i.parentId === removed.id) ? ' zostanie usunięty razem z podpunktami.' : ' zostanie usunięty z porządku.'}`}</p>}/>}
  </div>;
}

// Pole nowego podpunktu dostaje fokus od razu po otwarciu (atrybut autofocus działa tylko przy wczytaniu strony).
function SubItemForm(props: {no: string; busy: boolean; onSubmit: (e: Event) => void}) {
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => { input.current?.focus(); }, []);
  return <form class="add-form sub-form" onSubmit={props.onSubmit}>
    <Field label={`Nowy podpunkt w punkcie ${props.no}`} hint="Np. Uchwała nr … w sprawie …"><input ref={input} name="title" maxLength={400} required/></Field>
    <Button small type="submit" busy={props.busy}>Dodaj podpunkt</Button>
  </form>;
}

function AgendaImport(props: {onClose: () => void}) {
  const {m, send, busy} = useMeeting();
  const procedure = m.kind === 'procedura';
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(m.status === 'przygotowanie' && !procedure);
  const preview = text.trim() ? parseAgendaText(text, {flat: procedure}) : null;
  const example = procedure
    ? '1. Uchwała nr 130/IX/2026 w sprawie …\n2. Uchwała nr 131/IX/2026 w sprawie …'
    : '1. Otwarcie posiedzenia i stwierdzenie kworum.\n2. Przyjęcie porządku obrad.\n3. Przyjęcie protokołu z poprzedniego posiedzenia.\n4. Rozpatrzenie projektów uchwał w sprawie stwierdzenia prawa wykonywania zawodu\n   - Uchwała nr 117/IX/2026\n   - Uchwała nr 118/IX/2026\n5. Sprawy bieżące i wolne wnioski.\n6. Zamknięcie posiedzenia.';
  const count = preview?.items.length ?? 0;
  return <Modal title={procedure ? 'Wczytaj sprawy do głosowania z tekstu' : 'Wczytaj porządek obrad z tekstu'} wide onClose={props.onClose}>
    <div class="import">
      <div class="stack">
        <p class="small">{procedure ? 'Wklej sprawy z Worda albo z pliku tekstowego.' : 'Wklej porządek z Worda albo z pliku tekstowego. Punkty główne zacznij od numeru („1.”, „2.”). Podpunkty wcięte albo zaczynające się od myślnika.'}</p>
        <Field label={procedure ? 'Sprawy do głosowania' : 'Porządek obrad'}><textarea rows={14} value={text} onInput={e => setText((e.target as HTMLTextAreaElement).value)} placeholder={example}/></Field>
        <Field label="Albo wybierz plik TXT lub MD"><input type="file" accept=".txt,.md,text/plain" onChange={async e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) setText(await f.text()); }}/></Field>
        {m.status === 'przygotowanie' && <Check checked={replace} onChange={setReplace}>{procedure ? 'Zastąp obecne sprawy. Bez zaznaczenia sprawy zostaną dopisane.' : 'Zastąp obecny porządek. Bez zaznaczenia punkty zostaną dopisane.'}</Check>}
      </div>
      <div class="import-preview">
        <span class="kicker">Podgląd</span>
        {procedure && <p class="small">Każdy wiersz stanie się osobną sprawą do głosowania.</p>}
        {!preview && !procedure && <p class="muted small">Tu pojawi się rozpoznany porządek.</p>}
        {preview && <ol class="preview-list">{preview.items.map((i, n) => <li key={n} class={i.parent !== null ? 'is-sub' : ''}>{i.title}</li>)}</ol>}
        {preview?.warnings.map(w => <Notice key={w} tone="warn">{w}</Notice>)}
      </div>
    </div>
    <div class="actions import-actions"><Button kind="primary" busy={busy} disabled={!count} reason={procedure ? 'Wklej sprawy albo wybierz plik.' : 'Wklej porządek albo wybierz plik.'} onClick={async () => { if (await send({type: 'agenda_import', text, replace})) props.onClose(); }}>{`Wczytaj ${count} ${plural(count, 'pozycję', 'pozycje', 'pozycji')}`}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
  </Modal>;
}

export function MaterialsEditor() {
  const {m, replace} = useMeeting();
  const s = useSession();
  const types = useDocTypes();
  const typeOptions = sortedDocTypes(types, true).map(t => <option key={t.id} value={t.id}>{t.name}</option>);
  const {busy, error, errorKind, run} = useAction();
  const procedure = m.kind === 'procedura';
  const noun = nounOf(m);
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
  const itemSelect = (name: string) => <select name={name} defaultValue=""><option value="">Nie przypisuj</option>{orderedAgenda(m.agenda).map(i => <option key={i.id} value={i.id}>{itemNumber(m.agenda, i.id)}. {i.title.slice(0, 80)}</option>)}</select>;
  const assignLabel = procedure ? 'Przypisz do sprawy' : 'Przypisz do punktu';
  const removed = m.materials.find(x => x.id === removing);
  return <div class="stack materials-editor">
    <p class="muted small">Uczestnicy czytają materiały jako lekki tekst dopasowany do telefonu. Oryginał (DOCX, PDF) można pobrać osobno. Głosowanie zawsze dotyczy wersji utrwalonej w chwili jego otwarcia.</p>
    <div class="actions"><Button haspopup onClick={() => setMode('plik')}>Dodaj plik</Button><Button haspopup onClick={() => setMode('tekst')}>Wklej tekst</Button></div>
    {m.materials.length > 0 && <ul class="material-table">{m.materials.map(x => {
      const used = usage(x.id);
      return <li key={x.id}>
        <div><MaterialLink id={x.id} version={x.version} label={x.title}/><p class="muted small">{materialTypeLabel(x.type, types)}{x.number ? ` nr ${x.number}` : ''}, wersja {x.version}, {Math.max(1, Math.round(x.size / 1024))} KB{x.fileName ? `, oryginał ${x.fileName}` : ''}{used.length ? `, ${noun.item} ${used.join(', ')}` : ', nieprzypisany'}</p></div>
        {m.status === 'przygotowanie' && s.isOrganizer(m.organ) && <Button small quiet kind="ghost" haspopup onClick={() => setRemoving(x.id)} label={`Usuń materiał ${x.title}`}>Usuń</Button>}
      </li>;
    })}</ul>}
    {mode === 'plik' && <Modal title="Dodaj materiał z pliku" onClose={() => setMode(null)}>
      <form class="stack" onSubmit={upload}>
        <Field label="Plik" hint="DOCX, PDF, TXT lub Markdown, do 10 MB. Treść DOCX zamieni się na lekki tekst, a PDF będzie do pobrania."><input type="file" name="file" required accept=".docx,.pdf,.txt,.md,.markdown"/></Field>
        <Check checked={split} onChange={setSplit}>Plik zawiera kilka uchwał (np. uchwały w sprawie stwierdzenia prawa wykonywania zawodu). Podziel go na osobne materiały.</Check>
        {split ? <>
          {/* W głosowaniu między posiedzeniami podział nie tworzy podpunktów, bo podpunkt nie zostałby poddany pod głosowanie. */}
          <p class="small muted">{procedure ? 'Podział następuje przy każdym akapicie zaczynającym się od „Uchwała nr …” (także stanowisko i apel). Każda uchwała stanie się osobnym materiałem.' : 'Podział następuje przy każdym akapicie zaczynającym się od „Uchwała nr …” (także stanowisko i apel). Każda uchwała stanie się osobnym materiałem i podpunktem.'}</p>
          {!procedure && <>
            <Field label="Utwórz podpunkty w punkcie"><select name="itemId" defaultValue={resolutionsItem?.id ?? ''}>{top.map(i => <option key={i.id} value={i.id}>{itemNumber(m.agenda, i.id)}. {i.title.slice(0, 80)}</option>)}</select></Field>
            <Check name="createItems" defaultChecked>Dodaj każdą uchwałę jako osobny podpunkt porządku</Check>
          </>}
        </> : <>
          <Field label="Tytuł" hint="Bez tytułu materiał dostanie nazwę pliku."><input name="title" maxLength={300}/></Field>
          <div class="row"><Field label="Rodzaj"><select name="type">{typeOptions}</select></Field><Field label="Numer"><input name="number" maxLength={60} placeholder="np. 108/IX/2026"/></Field></div>
          <Field label={assignLabel}>{itemSelect('itemId')}</Field>
        </>}
        {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
        <div class="actions"><Button kind="primary" type="submit" busy={busy}>{busy ? 'Przetwarzanie…' : 'Dodaj materiał'}</Button><Button onClick={() => setMode(null)}>Anuluj</Button></div>
      </form>
    </Modal>}
    {mode === 'tekst' && <Modal title="Wklej treść materiału" wide onClose={() => setMode(null)}>
      <form class="stack" onSubmit={paste}>
        <Field label="Tytuł"><input name="title" required maxLength={300} placeholder="np. Uchwała nr 108/IX/2026 w sprawie …"/></Field>
        <div class="row"><Field label="Rodzaj"><select name="type">{typeOptions}</select></Field><Field label="Numer"><input name="number" maxLength={60}/></Field><Field label="Format"><select name="format"><option value="text">Zwykły tekst</option><option value="markdown">Markdown</option></select></Field></div>
        <Field label="Treść" hint="Akapity oddziel pustym wierszem. Wiersz „§ 1” stanie się nagłówkiem."><textarea name="text" rows={12} required/></Field>
        <Field label={assignLabel}>{itemSelect('itemId')}</Field>
        {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
        <div class="actions"><Button kind="primary" type="submit" busy={busy}>Dodaj materiał</Button><Button onClick={() => setMode(null)}>Anuluj</Button></div>
      </form>
    </Modal>}
    {removed && <Confirm title="Usunąć materiał?" kind="danger" confirm="Usuń materiał" onClose={() => setRemoving(null)} text={<p>„{removed.title}” zostanie usunięty z posiedzenia.</p>}
      onConfirm={() => run(async () => { const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${m.id}/materials/${removed.id}`, {method: 'DELETE'}); replace(r); })}/>}
    {error && !mode && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

// Gotowość posiedzenia: wiersze ze znacznikiem słownym (Gotowe, Do uzupełnienia, Do sprawdzenia).
function ReadinessCard() {
  const {m} = useMeeting();
  const rows: {key: string; text: string; state: Readiness}[] = [];
  const days = noticeDays(m as Meeting);
  if (days === null) rows.push({key: 'zawiadomienie', text: 'Nie wpisano daty wysłania zawiadomienia', state: 'uzupelnic'});
  else rows.push({key: 'zawiadomienie', state: days >= 7 ? 'gotowe' : 'sprawdzic',
    text: `Zawiadomienie wysłane ${fmtShort(m.noticeDate)}, ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem${days >= 7 ? '' : ', regulamin wymaga 7 dni (§ 7 ust. 1)'}`});
  const points = m.agenda.length;
  rows.push({key: 'porzadek', text: `Porządek obrad, ${points} ${plural(points, 'punkt', 'punkty', 'punktów')}`, state: points >= 2 ? 'gotowe' : 'uzupelnic'});
  // Materiał jest potrzebny w punkcie przyjęcia protokołu i w podpunktach punktu „Podjęcie uchwał”.
  const missing = orderedAgenda(m.agenda).filter(it => !it.materialIds.length && (it.kind === 'protokol' || (!!it.parentId && m.agenda.find(p => p.id === it.parentId)?.kind === 'uchwaly')));
  for (const it of missing.slice(0, 5)) rows.push({key: 'material-' + it.id, text: `Punkt ${itemNumber(m.agenda, it.id)} bez materiału`, state: 'uzupelnic'});
  if (missing.length > 5) {
    const rest = missing.length - 5;
    rows.push({key: 'material-reszta', text: `Jeszcze ${rest} ${plural(rest, 'punkt', 'punkty', 'punktów')} bez materiału`, state: 'uzupelnic'});
  }
  if (m.mode === 'zdalne') rows.push({key: 'polaczenie', text: m.link ? 'Odnośnik do połączenia wideo' : 'Brak odnośnika do połączenia wideo', state: m.link ? 'gotowe' : 'uzupelnic'});
  const invited = m.invited.length;
  rows.push({key: 'zaproszenia', state: invited ? 'gotowe' : 'sprawdzic',
    text: invited ? `Głos doradczy i goście, ${plural(invited, 'zaproszona', 'zaproszone', 'zaproszonych')} ${invited} ${plural(invited, 'osoba', 'osoby', 'osób')}` : 'Głos doradczy i goście, nikt nie jest zaproszony'});
  return <section class="oi-card readiness">
    <CardTitle level={2}>Gotowość posiedzenia</CardTitle>
    <ul class="readiness-list">{rows.map(r => <li key={r.key}><span>{r.text}</span><StateChip state={readinessChip(r.state)}/></li>)}</ul>
  </section>;
}

function OpenMeeting() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const [confirm, setConfirm] = useState(false);
  const days = noticeDays(m as Meeting);
  const warnings = [
    days === null ? 'Wpisz w danych posiedzenia datę wysłania zawiadomienia. Trafi ona do protokołu (§ 7 ust. 1).'
      : days < 7 ? `Zawiadomienie wysłano ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, a regulamin wymaga co najmniej 7 dni (§ 7 ust. 1).` : '',
    m.agenda.length < 2 ? 'Porządek obrad ma mniej niż dwa punkty. Dodaj punkty albo wczytaj porządek z tekstu.' : '',
    m.mode === 'zdalne' && !m.link ? 'Wpisz w danych posiedzenia odnośnik do połączenia wideo. Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5).' : '',
  ].filter(Boolean);
  // Jedna uwaga na sekcję (brand/components/KOMPONENTY.md), w niej każde ostrzeżenie osobnym zdaniem.
  const note = warnings.length > 0 && <Notice tone="warn">{warnings.map(w => <p key={w}>{w}</p>)}</Notice>;
  if (!canChairOrgan(s.roster, m.organ, s.personId)) return <section class="oi-card"><CardTitle level={2}>Otwarcie posiedzenia</CardTitle><p class="muted small">Posiedzenie otworzy przewodniczący lub wiceprzewodniczący (§ 9 ust. 1). Wtedy uczestnicy potwierdzają obecność na swoich telefonach.</p></section>;
  return <section class="oi-card is-teraz">
    <CardTitle level={2}>Otwarcie posiedzenia</CardTitle>
    <p class="small">Po otwarciu prowadzisz obrady. Członkowie potwierdzają obecność na telefonach.</p>
    {note}
    <Button kind="primary" wide haspopup busy={busy} onClick={() => setConfirm(true)}>Otwórz posiedzenie</Button>
    {confirm && <Confirm title="Otworzyć posiedzenie?" confirm="Otwórz i prowadź" onClose={() => setConfirm(false)} onConfirm={() => send({type: 'open'})}
      text={<><p>Rozpoczniesz prowadzenie obrad, a Twoja obecność zostanie zapisana automatycznie.</p>{note}</>}/>}
  </section>;
}

type ProtocolDraft = {protocolNumber: string; recorder: string; convener: string};
type DetailsDraft = {title: string; date: string; time: string; place: string; mode: MeetingMode; link: string; noticeDate: string} & ProtocolDraft;
const protocolKey = (d: ProtocolDraft) => [d.protocolNumber.replace(/\s+/g, ' ').trim(), d.recorder.replace(/\s+/g, ' ').trim(), d.convener];
const detailsKey = (d: DetailsDraft) => JSON.stringify([d.title.trim(), d.date, d.time, d.place.trim(), d.mode, d.mode === 'zdalne' ? d.link.trim() : '', d.noticeDate, ...protocolKey(d)]);
/** Dane do protokołu zapisane w posiedzeniu (F10), puste pola jako pusty napis. */
export const protocolOf = (m: Pick<Meeting, 'protocolNumber' | 'recorder' | 'convener'>): ProtocolDraft => ({protocolNumber: m.protocolNumber ?? '', recorder: m.recorder ?? '', convener: m.convener ?? ''});

/**
 * Sekcja „Dane do protokołu (nieobowiązkowe)” (F10): numer protokołu, protokolant i zwołujący ze składu organu.
 * Puste pola protokół zastępuje kropkami do uzupełnienia.
 */
export function ProtocolFields(props: {draft: ProtocolDraft; set: <K extends keyof ProtocolDraft>(field: K, value: ProtocolDraft[K]) => void}) {
  const {m} = useMeeting();
  const s = useSession();
  // Sekcja jest rozwinięta od początku, gdy coś w niej wpisano. Potem rozwija ją i zwija tylko użytkownik.
  const [open] = useState(() => [props.draft.protocolNumber, props.draft.recorder, props.draft.convener].some(v => v.trim()));
  return <Fold title="Dane do protokołu (nieobowiązkowe)" open={open}>
    <div class="stack">
      <p class="muted small">Wypełnione dane trafią do projektu protokołu. Puste pola protokół zostawi do uzupełnienia.</p>
      <Field label="Numer protokołu" hint="Np. 12/IX/2026."><input value={props.draft.protocolNumber} maxLength={60} onInput={e => props.set('protocolNumber', (e.target as HTMLInputElement).value)}/></Field>
      <Field label="Protokolant" hint="Imię i nazwisko osoby, która sporządza protokół."><input value={props.draft.recorder} maxLength={120} onInput={e => props.set('recorder', (e.target as HTMLInputElement).value)}/></Field>
      <Field label="Zwołuje"><select value={props.draft.convener} onChange={e => props.set('convener', (e.target as HTMLSelectElement).value)}>
        <option value="">Bez wskazania</option>
        {organMembers(s.roster, m.organ).map(ms => <option key={ms.personId} value={ms.personId}>{s.personName(ms.personId)}, {ms.label}</option>)}
      </select></Field>
    </div>
  </Fold>;
}

function Details() {
  const {m, send, busy} = useMeeting();
  const saved: DetailsDraft = {title: m.title, date: m.date, time: m.time, place: m.place, mode: m.mode, link: m.link, noticeDate: m.noticeDate, ...protocolOf(m)};
  const [draft, setDraft] = useState(saved);
  const [touched, setTouched] = useState(false);
  const save = useSaveStatus();
  const savedKey = detailsKey(saved);
  // Bez własnych zmian formularz pokazuje dane zapisane na serwerze (także zmienione na innym urządzeniu).
  useEffect(() => { if (!touched) setDraft(saved); }, [savedKey]);
  const dirty = detailsKey(draft) !== savedKey;
  useLeaveWarning(dirty);
  const set = <K extends keyof DetailsDraft>(field: K, value: DetailsDraft[K]) => { setTouched(true); save.reset(); setDraft(d => ({...d, [field]: value})); };
  const value = (field: keyof DetailsDraft) => (e: Event) => set(field, (e.target as HTMLInputElement).value);
  const days = noticeDays({date: draft.date, noticeDate: draft.noticeDate} as Meeting);
  return <section class="oi-card">
    <CardTitle level={2}>Dane posiedzenia</CardTitle>
    <form class="stack" onSubmit={async e => {
      e.preventDefault();
      if (!dirty) return;
      const r = await save.track(() => send({type: 'details', title: draft.title, date: draft.date, time: draft.time, place: draft.place, mode: draft.mode, link: draft.mode === 'zdalne' ? draft.link : '', noticeDate: draft.noticeDate,
        protocolNumber: draft.protocolNumber, recorder: draft.recorder, convener: draft.convener}));
      if (r) setTouched(false);
    }}>
      <Field label="Tytuł"><input name="title" value={draft.title} onInput={value('title')} maxLength={200} required/></Field>
      <div class="row"><Field label="Data"><input type="date" name="date" value={draft.date} onInput={value('date')} required/></Field><Field label="Godzina"><input type="time" name="time" value={draft.time} onInput={value('time')} required/></Field></div>
      <Field label="Miejsce"><input name="place" value={draft.place} onInput={value('place')} maxLength={200}/></Field>
      <Segments label="Tryb" value={draft.mode} options={[['stacjonarne', 'Stacjonarne'], ['zdalne', 'Zdalne']]} onChange={mode => set('mode', mode)}/>
      {draft.mode === 'zdalne' && <Field label="Odnośnik do połączenia wideo lub audio" hint="Dwustronna komunikacja w czasie rzeczywistym (§ 14 ust. 5), np. Teams, Zoom, Meet."><input name="link" type="url" value={draft.link} onInput={value('link')} placeholder="https://…" pattern="https://.*"/></Field>}
      <Field label="Data wysłania zawiadomienia" hint={days === null ? 'Zawiadomienie wysyła się co najmniej 7 dni przed posiedzeniem (§ 7 ust. 1).' : days >= 7 ? `${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, termin zachowany.` : `${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, mniej niż wymagane 7 dni (§ 7 ust. 1).`}>
        <input type="date" name="noticeDate" value={draft.noticeDate} onInput={value('noticeDate')}/>
      </Field>
      <ProtocolFields draft={draft} set={set}/>
      <div class="form-save">
        <Button type="submit" busy={busy} disabled={!dirty} reason="Brak zmian do zapisania.">Zapisz dane</Button>
        <SaveLine status={save} dirty={dirty} saved={t => `Zapisano dane posiedzenia o godz. ${t}.`}/>
      </div>
    </form>
  </section>;
}

function Deputy() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const vices = organMembers(s.roster, m.organ).filter(ms => ms.func === 'wiceprzewodniczacy');
  const chairman = isChairman(s.roster, m.organ, s.personId);
  const editor = chairman || s.account.admin || s.account.kind === 'biuro';
  const [person, setPerson] = useState(m.chair.deputy ?? '');
  const [basis, setBasis] = useState(chairman ? '' : m.chair.deputyBasis);
  const [touched, setTouched] = useState(false);
  const save = useSaveStatus();
  useEffect(() => { if (!touched) { setPerson(m.chair.deputy ?? ''); setBasis(chairman ? '' : m.chair.deputyBasis); } }, [m.chair.deputy, m.chair.deputyBasis]);
  const dirty = editor && (person !== (m.chair.deputy ?? '') || (!chairman && !!person && basis !== m.chair.deputyBasis));
  useLeaveWarning(dirty);
  if (!editor) return m.chair.deputy ? <section class="oi-card"><CardTitle level={2}>Zastępstwo</CardTitle><p class="small">{s.personName(m.chair.deputy)}, {m.chair.deputyBasis}</p></section> : null;
  const edit = () => { setTouched(true); save.reset(); };
  return <section class="oi-card">
    <CardTitle level={2}>Zastępstwo przewodniczącego</CardTitle>
    <p class="muted small">Na czas nieobecności przewodniczący wyznacza, który z wiceprzewodniczących go zastępuje. Gdy nie jest to możliwe, wyznacza Prezydium (§ 16).</p>
    <Field label="Zastępca"><select value={person} onChange={e => { edit(); setPerson((e.target as HTMLSelectElement).value); }}><option value="">Bez wyznaczenia</option>{vices.map(v => <option key={v.personId} value={v.personId}>{s.personName(v.personId)}, {v.label}</option>)}</select></Field>
    {!chairman && person && <Field label="Podstawa wyznaczenia" hint="Np. uchwała Prezydium nr … z dnia …"><input value={basis} onInput={e => { edit(); setBasis((e.target as HTMLInputElement).value); }} maxLength={200}/></Field>}
    <div class="form-save">
      <Button busy={busy} disabled={!dirty} reason="Brak zmian do zapisania." onClick={async () => { const r = await save.track(() => send({type: 'deputy', personId: person || null, basis})); if (r) setTouched(false); }}>Zapisz zastępstwo</Button>
      <SaveLine status={save} dirty={dirty} saved={t => `Zapisano zastępstwo o godz. ${t}.`}/>
    </div>
  </section>;
}

const kindName = {doradczy: 'Głos doradczy', gosc: 'Gość'} as const;

function Invites() {
  const {m, send, busy} = useMeeting();
  const [people, setPeople] = useState<{id: string; displayName: string; label: string; kind: string}[] | null>(null);
  useEffect(() => { request<{accounts: NonNullable<typeof people>}>('/api/people').then(r => setPeople(r.accounts.filter(a => a.kind === 'doradczy' || a.kind === 'gosc'))).catch(() => setPeople([])); }, []);
  return <section class="oi-card">
    <CardTitle level={2}>Głos doradczy i goście</CardTitle>
    <p class="muted small">O posiedzeniu zawiadamia się przewodniczącego Okręgowej Komisji Rewizyjnej, przewodniczącego Okręgowego Sądu Pielęgniarek i Położnych oraz Okręgowego Rzecznika Odpowiedzialności Zawodowej. Mogą uczestniczyć z głosem doradczym (§ 7 ust. 2). Goście uczestniczą wyłącznie na zaproszenie (§ 7 ust. 3). Zaznaczone osoby zobaczą posiedzenie i materiały w aplikacji. Aplikacja nie wysyła zawiadomień.</p>
    {people === null ? <p class="muted small">Wczytywanie…</p> : !people.length ? <p class="muted small">Brak kont z głosem doradczym i kont gości. Administrator może je dodać w części „Konta”.</p> :
      <ul class="checks">{people.map(p => {
        const kind = kindName[p.kind as keyof typeof kindName];
        // Rodzaj konta pokazuje znacznik, więc z funkcji znika dopisek „(głos doradczy)” i powtórzona nazwa rodzaju.
        const label = p.label.replace(/\s*\(głos doradczy\)/i, '').trim();
        return <li key={p.id}><Check checked={m.invited.includes(p.id)} disabled={busy} onChange={on => send({type: 'invite', accountId: p.id, on})}>
          <span class="invite"><span><strong>{p.displayName}</strong>{label && label.toLowerCase() !== kind.toLowerCase() ? `, ${label}` : ''}</span> <Chip>{kind}</Chip></span>
        </Check></li>;
      })}</ul>}
  </section>;
}

export function DeleteMeeting() {
  const {m} = useMeeting();
  const {busy, error, errorKind, run} = useAction();
  const [confirm, setConfirm] = useState(false);
  const what = m.kind === 'posiedzenie' ? 'posiedzenie' : 'głosowanie';
  return <section class="stack-tight delete-meeting">
    <div><Button kind="ghost" small haspopup busy={busy} onClick={() => setConfirm(true)}>Usuń to {what}</Button></div>
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {confirm && <Confirm title={`Usunąć ${what}?`} kind="danger" confirm={`Usuń ${what}`} onClose={() => setConfirm(false)} text={<p>„{m.title}” zostanie trwale usunięte razem z materiałami. Można to zrobić tylko przed otwarciem.</p>}
      onConfirm={() => run(async () => { await request(`/api/meetings/${m.id}`, {method: 'DELETE'}); go(''); })}/>}
    {busy && <span class="muted small">Usuwanie…</span>}
  </section>;
}
