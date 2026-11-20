import type {ComponentChildren} from 'preact';
import {createContext} from 'preact';
import {useContext, useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {itemKindLabel, parseAgendaText} from '../shared/agenda.ts';
import type {Command} from '../shared/meeting.ts';
import {materialTypeLabel} from '../shared/meeting.ts';
import {sortedDocTypes} from '../shared/doctypes.ts';
import {agendaBasis, lawOf} from '../shared/law.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {organOfCode} from '../shared/roster.ts';
import {canDesignateDeputy, canPrepare, canSkipListed, chairRank, deputyOf, isOfficeAccount, openOption, organRoster} from '../shared/role.ts';
import {guessText, type Deviation, type Difference, type ReviewRow} from '../shared/cascade.ts';
import {VOTE_MINUTES, MOTION_MINUTES, organSettingsOf, type GeneralBundle, type MeetingTemplate, type TemplateItem} from '../shared/settings.ts';
import {dateDots, dateDotsOf, minutesText, timeOf} from '../shared/text.ts';
import type {Actor, AgendaItem, Effective, ItemKind, Meeting, MeetingMode} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting, type ViewMeeting} from './context.ts';
import {useSession} from './session.ts';
import {announce, Button, CardTitle, Check, Confirm, ErrorNotice, Field, fmtDate, fmtTime, Fold, Modal, Notice, plural, Segments, StateChip, tabMemory, useAction, useMedia, useSaveStatus, type SaveState} from './ui.tsx';
import {ItemEditForm} from './item-form.tsx';
import {reviewChip} from './stany.ts';
import {MaterialLink} from './reader.tsx';
import {brand} from './brand.ts';
import {go} from './route.ts';
import {useDocTypes} from './doctypes.ts';
import {setGeneral, useGeneral} from './general.ts';
import {cleanPresenters, DocTypeSelect, PeopleFacts, PresentersEditor, samePresenters, usePeople} from './people.tsx';
import {dateHintText, DiffList, HistoryFold, MinutesRowEditor, RowEditor, SettingRow, SettingsList, sourceLineText, TextRowEditor, type DiffRow, type EditorCtl, type HistoryRow} from './cascade-ui.tsx';

// Przygotowanie posiedzenia (wersja 3, poziom 2 kaskady; specyfikacja rozdz. 5.4): projekt porządku obrad z ustawieniami
// punktów, ustawienia całego posiedzenia, przegląd przed otwarciem i otwarcie. Wartości skuteczne, przegląd, różnice
// i odstępstwa liczy domena (`m.effective`), a klient tylko je pokazuje.

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

/** Konto w roli wykonawcy czynności (do funkcji z role.ts). */
export function useActor(): Actor {
  const s = useSession();
  return {account: s.account, personId: s.personId, name: s.name};
}
/** Polecenie domeny z błędem rzucanym do miejsca wywołania (np. komunikat pod polami w otwartym wierszu). */
export function useCommand() {
  const {m, replace} = useMeeting();
  return async (cmd: Command) => {
    const r = await request<{meeting: ViewMeeting}>(`/api/meetings/${m.id}/command`, {body: cmd});
    replace(r);
    return r.meeting;
  };
}

/** Wspólne działania układu przygotowania: „Pokaż” z przeglądu, otwarty panel ustawień punktu, wiersz w edycji. */
interface PrepContext { show: (target: string) => void; openItem: string | null; setOpenItem: (id: string | null) => void; setSideEditing: (on: boolean) => void; sideEditing: boolean }
const PrepCtx = createContext<PrepContext | null>(null);
export const usePrep = () => useContext(PrepCtx);

type PrepTab = 'porzadek' | 'posiedzenie' | 'przeglad';
const TAB_KEY = 'posiedzenia:przygotowanie';
/**
 * Układ przygotowania (rozdz. 5.4 i 5.5): od 961 px główna kolumna i kolumna boczna 370 px; do 760 px zakładki „Porządek”,
 * „Posiedzenie” i „Przegląd ({n})”, zapamiętane w karcie przeglądarki. Ten sam układ ma głosowanie między posiedzeniami.
 */
export function PrepLayout(props: {main: ComponentChildren; review: ComponentChildren; settings: ComponentChildren; end: ComponentChildren}) {
  const {m} = useMeeting();
  useFreshSettings(m);
  const phone = useMedia('(max-width: 760px)');
  const [tab, setTabState] = useState<PrepTab>(() => (['porzadek', 'posiedzenie', 'przeglad'] as PrepTab[]).find(t => t === tabMemory.get(TAB_KEY)) ?? 'porzadek');
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [sideEditing, setSideEditing] = useState(false);
  const setTab = (t: PrepTab) => { setTabState(t); tabMemory.set(TAB_KEY, t); };
  const show = (target: string) => {
    const item = target.startsWith('punkt:') ? target.slice(6) : null;
    if (phone) setTab(item ? 'porzadek' : 'posiedzenie');
    if (item) setOpenItem(item);
    setTimeout(() => {
      const el = document.getElementById(item ? `ustawienia-punktu-${item}` : `ust-${target}`);
      if (!el) return;
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
      el.scrollIntoView({block: 'center'});
      (el.matches('h3') ? el : el.querySelector<HTMLElement>('h3[tabindex], button') ?? el).focus({preventScroll: true});
    }, 80);
  };
  const ctx: PrepContext = {show, openItem, setOpenItem, setSideEditing, sideEditing};
  const open = (m.effective?.review ?? []).filter(r => r.group !== 'gotowe').length;
  return <PrepCtx.Provider value={ctx}>
    <div class="prep">
      <DuplicatedNotice/>
      {phone ? <>
        <div class="oi-seg prep-tabs" role="group" aria-label="Części przygotowania">
          <button type="button" class="oi-opt" aria-pressed={tab === 'porzadek'} onClick={() => setTab('porzadek')}>Porządek</button>
          <button type="button" class="oi-opt" aria-pressed={tab === 'posiedzenie'} onClick={() => setTab('posiedzenie')}>{m.kind === 'procedura' ? 'Głosowanie' : 'Posiedzenie'}</button>
          <button type="button" class="oi-opt" aria-pressed={tab === 'przeglad'} aria-label={`Przegląd, ${open} do uzupełnienia albo sprawdzenia`} onClick={() => setTab('przeglad')}>{`Przegląd (${open})`}</button>
        </div>
        <div class="prep-main">
          {tab === 'porzadek' && props.main}
          {tab === 'posiedzenie' && <>{props.settings}<div class="prep-end">{props.end}</div></>}
          {tab === 'przeglad' && props.review}
        </div>
      </> : <>
        <div class="prep-main">{props.main}</div>
        <aside class="prep-side">{props.review}{props.settings}</aside>
        <div class="prep-end">{props.end}</div>
      </>}
    </div>
  </PrepCtx.Provider>;
}

/**
 * Rodzaje spraw i dokumentów przychodzą z sesją, a posiedzenie odświeża się samo. Gdy ustawienia ogólne zmieniono w innej
 * karcie albo na innym koncie, punkt może wskazywać rodzaj, którego karta jeszcze nie zna: wtedy sesja wczytuje się
 * ponownie, raz dla danego braku (posiedzenie w przygotowaniu, bez głosowań).
 */
let askedFor = '';
function useFreshSettings(m: ViewMeeting) {
  const bundle = useGeneral();
  const types = useDocTypes();
  const missing = !bundle ? [] : m.agenda.flatMap(it => [
    ...[it.caseType, it.caseTypeGuess].filter((id): id is string => !!id && !bundle.general.caseTypes.some(c => c.id === id)),
    ...(it.docType && !types.some(t => t.id === it.docType) ? [it.docType] : []),
  ]);
  const key = [...new Set(missing)].sort().join(',');
  useEffect(() => {
    if (!key || key === askedFor) return;
    askedFor = key;
    window.dispatchEvent(new Event('posiedzenia:sesja'));
  }, [key]);
}

export function PrepEditor() {
  const {m} = useMeeting();
  return <PrepLayout
    main={<>
      <section class="oi-card">
        <div class="panel-head"><CardTitle level={2}>Projekt porządku obrad</CardTitle></div>
        <p class="muted small">Projekt, który Prezydium przyjmuje w głosowaniu. Każdy punkt ma swoje ustawienia.</p>
        <AgendaEditor panel={(it, close) => <ItemSettings it={it} close={close}/>}/>
      </section>
      <section class="oi-card"><CardTitle level={2}>{`Materiały (${m.materials.length})`}</CardTitle><MaterialsEditor/></section>
      <MeetingHistory/>
    </>}
    review={<><ReviewCard/><OpenMeeting/></>}
    settings={<MeetingSettingsCard/>}
    end={<><DuplicateButton/><SaveAsTemplate/><DeleteMeeting/></>}/>;
}

// Posiedzenie utworzone przez powielenie (F6): przygotowanie nowego posiedzenia pokazuje raz uwagę o dacie i zawiadomieniu.
let duplicated: string | null = null;
/**
 * Dane posiedzenia, z którego powielono (goście i zastępca nie przechodzą do kopii, rozdz. 2.9 i 4.5 pkt 6). Domena ich
 * nie zapisuje w kopii, więc karta przeglądarki pamięta je dla podpowiedzi „Zaproś ponownie” i „Wyznacz ponownie”.
 */
interface DuplicateSource { invited: string[]; deputy: string | null; date: string }
const SOURCE_KEY = (id: string) => `posiedzenia:powielone:${id}`;
function duplicateSource(id: string): DuplicateSource | null {
  try { const raw = tabMemory.get(SOURCE_KEY(id)); return raw ? JSON.parse(raw) as DuplicateSource : null; } catch { return null; }
}

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
      tabMemory.set(SOURCE_KEY(r.meeting.id), JSON.stringify({invited: m.invited, deputy: m.chair.deputy, date: m.date} satisfies DuplicateSource));
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

/** Punkt wymieniony w regulaminie i jedyny tego rodzaju (jego usunięcie albo zmiana rodzaju to pominięcie, G-7). */
const soleOf = (m: Pick<Meeting, 'agenda'>, it: AgendaItem) => !it.parentId && m.agenda.filter(i => i.kind === it.kind && !i.parentId).length === 1;
const isMandatory = (m: Meeting, it: AgendaItem) => lawOf(m.organ).agenda.mandatory.includes(it.kind) && soleOf(m, it);
const isListed = (m: Meeting, it: AgendaItem) => it.kind in lawOf(m.organ).agenda.listed && !lawOf(m.organ).agenda.mandatory.includes(it.kind) && soleOf(m, it);
const noDocType = new Set<ItemKind>(['otwarcie', 'porzadek', 'zamkniecie']);

/** Zdanie faktów pod tytułem punktu w przygotowaniu (rozdz. 5.4, wiersz punktu). */
function itemFacts(m: ViewMeeting, it: AgendaItem, bundle: GeneralBundle | null, types: {id: string; name: string}[]) {
  const e = m.effective?.items[it.id];
  const caseName = bundle?.general.caseTypes.find(c => c.id === it.caseType)?.name;
  const docName = e?.docType.value ? types.find(t => t.id === e.docType.value)?.name : undefined;
  const meetingMinutes = m.effective?.meeting.voteMinutes.value;
  const count = it.materialIds.length;
  const parts = [
    caseName ? `Rodzaj sprawy »${caseName}«` : docName ? `Głosuje się ${docName.toLocaleLowerCase('pl')}` : '',
    it.voteMinutes !== undefined && it.voteMinutes !== meetingMinutes ? `czas głosowania ${minutesText(it.voteMinutes)}` : '',
    count ? `${count} ${plural(count, 'materiał', 'materiały', 'materiałów')}` : '',
  ].filter(Boolean);
  const first = parts.length ? parts.join(', ').replace(/^./, c => c.toLocaleUpperCase('pl')) + '.' : '';
  const own = it.voteMinutes !== undefined || !!it.stamps?.kind || (!!it.docType && !!it.stamps?.docType);
  const guess = !it.caseType && it.caseTypeGuess ? bundle?.general.caseTypes.find(c => c.id === it.caseTypeGuess)?.name : undefined;
  return [first, own ? 'Zmienione dla tego punktu.' : '', guess ? `Propozycja rodzaju sprawy »${guess}«.` : '',
    m.noticeItems && !m.noticeItems.includes(it.id) ? 'Punkt nie był w zawiadomieniu.' : ''].filter(Boolean).join(' ');
}

/**
 * Edytor porządku obrad albo spraw do głosowania. Narzędzia wiersza to szare odnośniki z numerem pozycji w nazwie
 * (na urządzeniach z kursorem widać je przy najechaniu i przy fokusie). Z `panel` (przygotowanie) każdy wiersz ma
 * przycisk „Ustawienia”, który rozwija pod nim ustawienia punktu; bez niego (poprawki porządku w trakcie obrad) „Zmień”.
 */
export function AgendaEditor(props: {panel?: (it: AgendaItem, close: () => void) => ComponentChildren}) {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const prep = usePrep();
  const bundle = useGeneral();
  const types = useDocTypes();
  const procedure = m.kind === 'procedura';
  const noun = nounOf(m);
  const [editing, setEditing] = useState<string | null>(null);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [focusAfter, setFocusAfter] = useState<{id: string; tool: string} | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const items = orderedAgenda(m.agenda);
  const openItem = prep ? prep.openItem : localOpen;
  const setOpenItem = prep ? prep.setOpenItem : setLocalOpen;
  const skipper = canSkipListed(s.roster, m as Meeting, actor);
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
  const inPrep = m.status === 'przygotowanie' && !!props.panel;
  return <div class="stack agenda-editor">
    {!items.length && <p class="muted">{procedure ? 'Nie ma jeszcze spraw do głosowania. Dodaj sprawy albo wczytaj je z tekstu.' : 'Porządek jest pusty. Dodaj punkty albo wczytaj gotowy porządek z tekstu.'}</p>}
    {items.length > 0 && <ol class="edit-list" ref={list}>
      {items.map(it => {
        const siblings = m.agenda.filter(i => i.parentId === it.parentId), index = siblings.indexOf(it);
        const no = itemNumber(m.agenda, it.id);
        const count = it.materialIds.length;
        const meta = inPrep ? itemFacts(m, it, bundle, types) : count ? `${count} ${plural(count, 'materiał', 'materiały', 'materiałów')}` : '';
        const mandatory = !procedure && isMandatory(m as Meeting, it);
        const listed = !procedure && isListed(m as Meeting, it);
        const removable = procedure || (!mandatory && it.kind !== 'porzadek' && (!listed || skipper || !inPrep));
        const panelOpen = inPrep && openItem === it.id;
        return <li key={it.id} class={'edit-row' + (it.parentId ? ' is-sub' : '') + (panelOpen ? ' is-open' : '')} data-pozycja={it.id}>
          <span class="agenda-no">{no}</span>
          {editing === it.id
            ? <ItemEditForm it={it} onDone={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }} onCancel={() => { setEditing(null); setFocusAfter({id: it.id, tool: 'tool-zmien'}); }}/>
            : <>
              <div class="edit-main"><span class="edit-title">{it.title}</span><PeopleFacts it={it} compact/>{meta && <span class="edit-meta">{meta}</span>}</div>
              <span class="edit-tools">
                {!inPrep && <Button small quiet kind="ghost" class="tool-zmien" onClick={() => { setSubFor(null); setEditing(it.id); }} label={`Zmień ${noun.acc} ${no}`}>Zmień</Button>}
                <Button small quiet kind="ghost" class="tool-wyzej" busy={busy} disabled={index === 0} onClick={() => move(it, -1)} label={`Przesuń ${noun.acc} ${no} wyżej`}>Wyżej</Button>
                <Button small quiet kind="ghost" class="tool-nizej" busy={busy} disabled={index === siblings.length - 1} onClick={() => move(it, 1)} label={`Przesuń ${noun.acc} ${no} niżej`}>Niżej</Button>
                {!procedure && !it.parentId && <Button small quiet kind="ghost" class="tool-podpunkt" onClick={() => setSubFor(subFor === it.id ? null : it.id)} label={`Dodaj podpunkt w punkcie ${no}`}>Dodaj podpunkt</Button>}
                {removable && <Button small quiet kind="ghost" class="tool-usun" haspopup busy={busy} onClick={() => setRemoving(it.id)} label={`Usuń ${noun.acc} ${no}`}>Usuń</Button>}
              </span>
              {inPrep && <span class="edit-settings"><Button small quiet kind="ghost" class="tool-ustawienia" label={`Ustawienia ${noun.gen} ${no}`} onClick={() => setOpenItem(panelOpen ? null : it.id)}>Ustawienia</Button></span>}
            </>}
          {subFor === it.id && editing !== it.id && <SubItemForm no={no} busy={busy} onSubmit={e => add(e, it.id)}/>}
          {panelOpen && <div class="edit-extra">{props.panel!(it, () => { setOpenItem(null); setFocusAfter({id: it.id, tool: 'tool-ustawienia'}); })}</div>}
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
    {removed && (!procedure && isListed(m as Meeting, removed) && inPrep
      ? <SkipDialog it={removed} onClose={() => setRemoving(null)} onDone={() => addInput.current?.focus()}/>
      : <Confirm title={procedure ? 'Usunąć sprawę?' : 'Usunąć punkt?'} kind="danger" confirm={procedure ? 'Usuń sprawę' : 'Usuń punkt'} onClose={() => setRemoving(null)}
        onConfirm={() => send({type: 'item_remove', itemId: removed.id}).then(r => { if (r) addInput.current?.focus(); })}
        text={<p>{procedure ? `Sprawa „${removed.title}” zostanie usunięta.` : `„${removed.title}”${m.agenda.some(i => i.parentId === removed.id) ? ' zostanie usunięty razem z podpunktami.' : ' zostanie usunięty z porządku.'}`}</p>}/>)}
  </div>;
}

// Pominięcie punktu wymienionego w regulaminie (DA-7, G-7): powód wymagany, trafia do protokołu.
function SkipDialog(props: {it: AgendaItem; onClose: () => void; onDone: () => void}) {
  const {m, send} = useMeeting();
  const basis = agendaBasis(lawOf(m.organ), props.it.kind) ?? '§ 9 ust. 2';
  return <Confirm title={`Pominąć punkt „${props.it.title}”?`} kind="danger" confirm="Pomiń punkt" onClose={props.onClose}
    field={{label: 'Powód', required: true, hint: 'Np. protokół poprzedniego posiedzenia nie jest jeszcze gotowy.'}}
    text={<p>{`Punkt zniknie z projektu. Powód trafi do protokołu, bo regulamin wymienia ten punkt w porządku obrad (${basis}).`}</p>}
    details={props.it.kind === 'protokol' ? <Notice tone="warn">{`Protokół przyjmuje się na następnym posiedzeniu (${lawOf(m.organ).minutes.adoptionBasis}). Jeśli pomijasz ten punkt, protokół poprzedniego posiedzenia poczeka na przyjęcie do kolejnego posiedzenia.`}</Notice> : undefined}
    onConfirm={reason => { send({type: 'item_remove', itemId: props.it.id, reason}).then(r => { if (r) props.onDone(); }); }}/>;
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
        <p class="small">{procedure ? 'Wklej sprawy z Worda albo z pliku tekstowego.' : 'Wklej porządek z Worda albo z pliku tekstowego. Punkty główne zacznij od numeru („1.”, „2.”). Podpunkty wcięte albo zaczynające się od myślnika. Brakujące punkty wymagane regulaminem aplikacja uzupełni, a rodzaje spraw zaproponuje w przeglądzie przed otwarciem.'}</p>
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

const kindOptions: ItemKind[] = ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie', 'sprawa'];

/**
 * Ustawienia punktu (rozdz. 5.4): wiersze stałe zawsze, warunkowe tylko przy spełnionym warunku (D-3). Wartości i ich
 * źródła z `m.effective.items`, a zmiana to polecenie `item_edit` (rodzaj, rodzaj sprawy, co jest głosowane, czas, osoby).
 */
function ItemSettings(props: {it: AgendaItem; close: () => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const cmd = useCommand();
  const bundle = useGeneral();
  const types = useDocTypes();
  const heading = useRef<HTMLHeadingElement>(null);
  const {it} = props;
  const law = lawOf(m.organ);
  const e = m.effective?.items[it.id];
  const no = itemNumber(m.agenda, it.id);
  const rada = organOfCode(s.roster, 'rada');
  useLayoutEffect(() => { heading.current?.focus({preventScroll: false}); }, []);
  if (!e) return null;
  const mandatory = isMandatory(m as Meeting, it), listed = isListed(m as Meeting, it);
  const skipper = canSkipListed(s.roster, m as Meeting, actor);
  const basis = agendaBasis(law, it.kind) ?? '';
  const caseTypes = (bundle?.general.caseTypes ?? []).filter(c => c.active && c.organs.includes(m.organ));
  const caseType = bundle?.general.caseTypes.find(c => c.id === it.caseType);
  const typeName = (id: string | null) => id ? types.find(t => t.id === id)?.name ?? id : '';
  const quorum = m.effective!.meeting.quorum.value;
  const meetingMinutes = m.effective!.meeting.voteMinutes.value;
  const guess = bundle && !it.caseType ? guessText({general: bundle.general}, m.organ, it) : null;
  const docValue = e.docType.value;
  const ownKindStamp = !!it.stamps?.kind;
  const presenterFromCase = !!caseType?.presenterFunc && it.presenters.length === 1 && organRoster(s.roster, m).some(ms => ms.func === caseType.presenterFunc && s.personName(ms.personId) === it.presenters[0].name);
  const addedAt = m.log.find(l => l.itemId === it.id && l.tag === 'projekt')?.at;
  const notInNotice = !!m.noticeItems && !m.noticeItems.includes(it.id);
  const resolution = docValue === 'uchwala';
  const sign = caseType?.financial
    ? 'Przewodniczący lub wiceprzewodniczący oraz skarbnik (§ 8 ust. 7). Gdy podpis skarbnika jest niemożliwy, podpisuje inny członek Prezydium.'
    : `Przewodniczący lub wiceprzewodniczący oraz ${rada.forms.member} (§ 8 ust. 7).`;
  const signSource: Effective<unknown> = caseType?.financial
    ? {value: null, source: 'ogolne', level: 1, via: {kind: 'rodzaj_sprawy', name: caseType.name}}
    : {value: null, source: 'prawo', level: 0, basis: '§ 8 ust. 7', via: {kind: 'rodzaj_dokumentu', name: typeName('uchwala'), basis: '§ 8 ust. 7'}};
  const needsMaterial = e.voted.value && it.kind === 'sprawa' && !it.materialIds.length;
  return <section class="item-settings" aria-labelledby={`ustawienia-punktu-${it.id}`}>
    <div class="item-settings__head">
      <h3 id={`ustawienia-punktu-${it.id}`} tabIndex={-1} ref={heading}>{`Ustawienia punktu ${no}`}</h3>
      <Button kind="ghost" quiet small onClick={props.close}>Zamknij ustawienia punktu</Button>
    </div>
    <SettingsList label={`Ustawienia punktu ${no}`}>
      <SettingRow label="Nazwa punktu" value={it.title} at="punkt" source="" genitive="nazwy punktu" actionLabel={`Zmień nazwę punktu ${no}`}
        editor={(close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Nazwa punktu" initial={it.title} max={400} required onSave={title => cmd({type: 'item_edit', itemId: it.id, title})}/>}/>
      {mandatory
        ? <SettingRow label="Rodzaj punktu" value={itemKindLabel[it.kind]} at="punkt" state="regulamin" source={`Punkt obowiązkowy, ${basis}.`}/>
        : <SettingRow label="Rodzaj punktu" value={itemKindLabel[it.kind]} at={ownKindStamp ? 'punkt' : 'posiedzenie'} genitive="rodzaju punktu" actionLabel={`Zmień rodzaj punktu ${no}`}
          {...(ownKindStamp || e.kind.via ? {effective: e.kind} : {source: ''})}
          editor={listed && !skipper ? undefined : (close, ctl) => <KindEditor close={close} ctl={ctl} it={it} listed={listed} basis={basis} onSave={(kind, reason) => cmd({type: 'item_edit', itemId: it.id, kind, ...(reason ? {reason} : {})})}/>}/>}
      {!noDocType.has(it.kind) && <SettingRow label="Rodzaj sprawy" value={caseType?.name ?? 'Bez rodzaju sprawy'} at="punkt" genitive="rodzaju sprawy" actionLabel={`Zmień rodzaj sprawy w punkcie ${no}`}
        {...(it.caseType ? {effective: e.caseType} : {source: ''})}
        extra={guess && <div class="guess-line"><p class="setting-src">{guess}</p><span class="actions">
          <Button kind="ghost" small quiet label={`Przyjmij propozycję rodzaju sprawy w punkcie ${no}`} onClick={() => cmd({type: 'item_edit', itemId: it.id, caseType: it.caseTypeGuess!}).catch(() => {})}>Przyjmij</Button>
          <Button kind="ghost" small quiet label={`Odrzuć propozycję rodzaju sprawy w punkcie ${no}`} onClick={() => cmd({type: 'item_edit', itemId: it.id, caseTypeGuess: null}).catch(() => {})}>Odrzuć</Button>
        </span></div>}
        editor={(close, ctl) => <CaseTypeEditor close={close} ctl={ctl} initial={it.caseType ?? ''} options={caseTypes.map(c => [c.id, c.name] as [string, string])} onSave={v => cmd({type: 'item_edit', itemId: it.id, caseType: v || null})}/>}/>}
      {!noDocType.has(it.kind) && <SettingRow label="Co jest głosowane" value={docValue ? typeName(docValue) : 'Wynika z materiału'} at="punkt" genitive="tego, co jest głosowane" actionLabel={`Zmień, co jest głosowane w punkcie ${no}`}
        {...(it.docType || e.docType.via ? {effective: e.docType} : {source: ''})}
        editor={(close, ctl) => <DocTypeEditor close={close} ctl={ctl} initial={it.docType ?? ''} empty={caseType ? 'Wynika z rodzaju sprawy' : 'Wynika z materiału'} onSave={v => cmd({type: 'item_edit', itemId: it.id, docType: v || null})}/>}/>}
      <SettingRow label="Czas głosowania" value={minutesText(e.voteMinutes.value)} effective={e.voteMinutes} at="punkt" show={v => minutesText(Number(v))} genitive="czasu głosowania" actionLabel={`Zmień czas głosowania w punkcie ${no}`}
        editor={(close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowania" initial={e.voteMinutes.value} options={VOTE_MINUTES} onSave={v => cmd({type: 'item_edit', itemId: it.id, voteMinutes: v})}/>}
        resetLabel="Przywróć ustawienie posiedzenia"
        onReset={async () => { await cmd({type: 'item_edit', itemId: it.id, voteMinutes: null}); return `Przywrócono ${minutesText(meetingMinutes, 'biernik')} z ustawień posiedzenia.`; }}/>
      <SettingRow label="Prowadzą i referują" value={it.presenters.length ? <PeopleFacts it={it}/> : 'Nikogo nie wpisano.'} at="punkt" source={presenterFromCase ? 'Z rodzaju sprawy.' : ''}
        genitive="osób przy punkcie" actionLabel={`Zmień osoby przy punkcie ${no}`}
        editor={(close, ctl) => <PresentersRowEditor close={close} ctl={ctl} it={it} no={no} onSave={presenters => cmd({type: 'item_edit', itemId: it.id, presenters})}/>}/>
      <SettingRow label="Materiały" at="punkt" source="" value={<ItemMaterials it={it} missing={needsMaterial ? (resolution || !docValue ? 'Brak. Punkt z uchwałą potrzebuje materiału.' : 'Brak. Ten punkt potrzebuje materiału.') : null}/>}/>
      <SettingRow label="Zasady głosowania" at="punkt" source="" value={e.voted.value
        ? `Głosowanie jawne, zwykła większość, wymagane kworum ${quorum.required} z ${quorum.total} (§ 8 ust. 2–3, § 11 ust. 1).`
        : 'W tym punkcie nie ma głosowania.'}/>
      {resolution && <SettingRow label="Podpisują uchwałę" at="punkt" state="wynikajaca" effective={signSource} value={sign}/>}
      {notInNotice && <SettingRow label="W zawiadomieniu" at="punkt" state="regulamin" source=""
        value={`Nie. Punkt dodano${addedAt ? ` ${dateDotsOf(addedAt)}` : ''}, po wysłaniu zawiadomienia. To zdanie trafi do protokołu (${law.notice.basis}).`}/>}
      {listed && !skipper && <SettingRow label="Pominięcie" at="punkt" state="regulamin" source=""
        value={`Ten punkt wymienia regulamin (${basis}). Pominąć go może przewodniczący, podając powód.`}/>}
    </SettingsList>
  </section>;
}

function KindEditor(props: {close: (s?: string) => void; ctl: EditorCtl; it: AgendaItem; listed: boolean; basis: string; onSave: (kind: ItemKind, reason?: string) => Promise<unknown>}) {
  const [kind, setKind] = useState<ItemKind>(props.it.kind);
  const [reason, setReason] = useState('');
  const skip = props.listed && kind !== props.it.kind;
  return <RowEditor close={props.close} ctl={props.ctl} dirty={kind !== props.it.kind} onSave={() => props.onSave(kind, skip ? reason.trim() : undefined)}
    reason={skip && !reason.trim() ? `Podaj powód pominięcia punktu „${props.it.title}”. Trafi do protokołu (${props.basis}).` : undefined}>
    <Field label="Rodzaj punktu" hint="Rodzaj decyduje o tym, co aplikacja sprawdza przed otwarciem i w trakcie obrad, np. czy punkt potrzebuje materiału.">
      <select value={kind} onChange={e => setKind((e.target as HTMLSelectElement).value as ItemKind)}>{kindOptions.map(k => <option key={k} value={k}>{itemKindLabel[k]}</option>)}</select>
    </Field>
    {skip && <Field label="Powód" hint={`Regulamin wymienia ten punkt (${props.basis}). Zmiana rodzaju to pominięcie punktu, a powód trafi do protokołu.`}>
      <input value={reason} maxLength={500} onInput={e => setReason((e.target as HTMLInputElement).value)}/>
    </Field>}
  </RowEditor>;
}
function CaseTypeEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: string; options: [string, string][]; onSave: (v: string) => Promise<unknown>}) {
  const [value, setValue] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)}>
    <Field label="Rodzaj sprawy" hint={value ? 'Uzupełnia co jest głosowane i osobę referującą, gdy są puste. Wypełnione pola zostają.' : undefined}>
      <select value={value} onChange={e => setValue((e.target as HTMLSelectElement).value)}><option value="">Bez rodzaju sprawy</option>{props.options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
    </Field>
  </RowEditor>;
}
export function DocTypeEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: string; empty: string; onSave: (v: string) => Promise<unknown>}) {
  const types = useDocTypes();
  const [value, setValue] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)}>
    <DocTypeSelect types={types} value={value} onChange={setValue} empty={props.empty} label="Co jest głosowane"
      hint="Rodzaj decyduje o formule wyniku, np. „Uchwała podjęta”, i o tym, czy w punkcie trzeba głosować."/>
  </RowEditor>;
}
export function PresentersRowEditor(props: {close: (s?: string) => void; ctl: EditorCtl; it: AgendaItem; no: string; onSave: (p: AgendaItem['presenters']) => Promise<unknown>}) {
  const {m} = useMeeting();
  const [value, setValue] = useState(props.it.presenters);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={!samePresenters(value, props.it.presenters)} onSave={() => props.onSave(cleanPresenters(value))}>
    <PresentersEditor value={value} onChange={setValue} organ={m.organ} no={props.no}/>
  </RowEditor>;
}

/** Materiały punktu i „Dołącz materiał” (item_material). */
export function ItemMaterials(props: {it: AgendaItem; missing: string | null}) {
  const {m} = useMeeting();
  const cmd = useCommand();
  const {busy, error, errorKind, run} = useAction();
  const [pick, setPick] = useState('');
  const attached = m.materials.filter(x => props.it.materialIds.includes(x.id));
  const others = m.materials.filter(x => !props.it.materialIds.includes(x.id));
  return <div class="stack-tight">
    {attached.length ? <div class="material-list">{attached.map(x => <MaterialLink key={x.id} id={x.id} version={x.version} label={x.title}/>)}</div>
      : <span class={props.missing ? 'strong' : ''}>{props.missing ?? 'Brak.'}</span>}
    {others.length > 0 && <div class="attach-row">
      <Field label="Dołącz materiał"><select value={pick} onChange={e => setPick((e.target as HTMLSelectElement).value)}><option value="">Wybierz materiał…</option>{others.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
      <Button small busy={busy} disabled={!pick} reason="Wybierz materiał z listy." onClick={() => run(async () => { await cmd({type: 'item_material', itemId: props.it.id, materialId: pick, on: true}); setPick(''); })}>Dołącz materiał</Button>
    </div>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
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

/** Cel „Pokaż” dla odstępstwa albo różnicy (przegląd, okno otwarcia). */
export const deviationTarget = (d: Deviation): DiffRow => ({text: d.text, itemId: d.itemId,
  target: d.kind === 'zawiadomienie' ? 'zawiadomienie' : d.kind === 'gosc' ? 'goscie' : d.kind === 'zastepstwo' ? 'zastepstwo' : d.kind === 'termin_procedury' ? 'termin' : d.itemId ? `punkt:${d.itemId}` : undefined});
export const differenceTarget = (d: Difference): DiffRow => ({text: d.text, itemId: d.itemId, target: d.itemId ? `punkt:${d.itemId}` : 'glosowania'});

/**
 * Przegląd przed otwarciem (rozdz. 5.4): „Do uzupełnienia”, „Do sprawdzenia” z propozycjami rodzajów spraw do przyjęcia,
 * „Gotowe”, „Trafi do protokołu” i różnice wobec ustawień ogólnych i wzoru posiedzenia. Dane z `m.effective`.
 */
export function ReviewCard() {
  const {m} = useMeeting();
  const prep = usePrep();
  const cmd = useCommand();
  const {busy, error, errorKind, run} = useAction();
  const review = m.effective?.review ?? [];
  const groups: [ReviewRow['group'], string][] = [['uzupelnic', 'Do uzupełnienia'], ['sprawdzic', 'Do sprawdzenia'], ['gotowe', 'Gotowe']];
  const proposals = review.filter(r => r.actions?.length && r.itemId);
  const label = (r: ReviewRow) => r.itemId ? itemNumber(m.agenda, r.itemId) : '';
  const accept = (r: ReviewRow) => run(async () => { const it = m.agenda.find(i => i.id === r.itemId); if (it?.caseTypeGuess) await cmd({type: 'item_edit', itemId: it.id, caseType: it.caseTypeGuess}); });
  const reject = (r: ReviewRow) => run(async () => { await cmd({type: 'item_edit', itemId: r.itemId!, caseTypeGuess: null}); });
  const acceptAll = () => run(async () => {
    for (const r of proposals) { const it = m.agenda.find(i => i.id === r.itemId); if (it?.caseTypeGuess) await cmd({type: 'item_edit', itemId: it.id, caseType: it.caseTypeGuess}); }
    announce('Przyjęto propozycje rodzajów spraw.');
  });
  return <section class="oi-card review" id="ust-przeglad" aria-labelledby="przeglad-tytul">
    <h2 class="oi-card__title" id="przeglad-tytul"><span class="oi-mark" aria-hidden="true"/><span>Przegląd przed otwarciem</span></h2>
    {!m.effective && <p class="muted small">Przegląd pojawi się po wczytaniu ustawień posiedzenia.</p>}
    {groups.map(([group, title]) => {
      const rows = review.filter(r => r.group === group);
      if (!rows.length) return null;
      return <div class="review-group" key={group}>
        <h3 class="kicker">{`${title} (${rows.length})`}</h3>
        <ul class="review-list">{rows.map((r, i) => <li key={i}>
          <span class="review-text">{r.text}</span>
          <span class="review-side"><StateChip state={reviewChip(r.group)}/>
            {r.actions?.length && r.itemId
              ? <span class="actions">
                <Button kind="ghost" small quiet busy={busy} label={`Przyjmij propozycję rodzaju sprawy w punkcie ${label(r)}`} onClick={() => accept(r)}>Przyjmij</Button>
                <Button kind="ghost" small quiet busy={busy} label={`Odrzuć propozycję rodzaju sprawy w punkcie ${label(r)}`} onClick={() => reject(r)}>Odrzuć</Button>
              </span>
              : r.target && prep && <Button kind="ghost" small quiet onClick={() => prep.show(r.target!)}>Pokaż</Button>}
          </span>
        </li>)}</ul>
        {group === 'sprawdzic' && proposals.length > 0 && <div><Button small busy={busy} onClick={acceptAll}>{`Przyjmij wszystkie propozycje (${proposals.length})`}</Button></div>}
      </div>;
    })}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    {m.effective && <>
      <DiffList title="Trafi do protokołu" rows={m.effective.deviations.map(deviationTarget)} onShow={prep ? r => prep.show(r.target!) : undefined}/>
      <DiffList title="Różnice wobec ustawień ogólnych i wzoru posiedzenia" rows={m.effective.differences.map(differenceTarget)} onShow={prep ? r => prep.show(r.target!) : undefined}
        empty="To posiedzenie ma ustawienia ogólne i wzór posiedzenia bez zmian."/>
    </>}
  </section>;
}

/**
 * Otwarcie posiedzenia według kolejności do prowadzenia (DA-17): karta z czerwonym paskiem tylko u osoby, która może
 * otworzyć, a przy wyznaczonym zastępcy tylko u przewodniczącego i zastępcy. Inny wiceprzewodniczący otwiera zamiast
 * zastępcy z powodem do protokołu. Okno otwarcia pokazuje odstępstwa i różnice z przeglądu.
 */
function OpenMeeting() {
  const {m, send, busy} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const prep = usePrep();
  const [confirm, setConfirm] = useState(false);
  const option = openOption(s.roster, m as Meeting, actor);
  const deputy = deputyOf(s.roster, m as Meeting);
  const rank = chairRank(s.roster, m as Meeting, s.personId);
  if (!option.allowed) return <section class="oi-card"><CardTitle level={2}>Otwarcie posiedzenia</CardTitle>
    <p class="muted small">{deputy
      ? `Posiedzenie otworzy przewodniczący albo zastępca przewodniczącego, ${s.personName(deputy)} (§ 9 ust. 1, § 16 ust. 2). Wtedy uczestnicy potwierdzają obecność na swoich telefonach.`
      : 'Posiedzenie otworzy przewodniczący lub wiceprzewodniczący (§ 9 ust. 1). Wtedy uczestnicy potwierdzają obecność na swoich telefonach.'}</p></section>;
  const focus = !deputy || (rank !== null && rank <= 2);
  const deviations = m.effective?.deviations ?? [], differences = m.effective?.differences ?? [];
  const link = m.mode === 'zdalne' && !m.link ? 'Wpisz w ustawieniach posiedzenia odnośnik do połączenia wideo. Posiedzenie zdalne wymaga dwustronnej komunikacji w czasie rzeczywistym (§ 14 ust. 5).' : '';
  const lists = (deviations.length > 0 || differences.length > 0 || link) && <Notice tone="warn">
    {link && <p>{link}</p>}
    {deviations.length > 0 && <><p class="strong">Do protokołu trafi</p><ul class="dash-list">{deviations.map((d, i) => <li key={i}>{d.text}</li>)}</ul></>}
    {differences.length > 0 && <><p class="strong">Różnice wobec ustawień ogólnych i wzoru posiedzenia</p><ul class="dash-list">{differences.map((d, i) => <li key={i}>{d.text}</li>)}</ul></>}
  </Notice>;
  const primary = focus && !prep?.sideEditing;
  return <section class={'oi-card' + (focus ? ' is-teraz' : '')}>
    <CardTitle level={2}>Otwarcie posiedzenia</CardTitle>
    <p class="small">{option.needsReason
      ? `Zastępcą przewodniczącego na tym posiedzeniu jest ${s.personName(deputy)}. Jeśli otwierasz posiedzenie zamiast tej osoby, podasz powód.`
      : 'Po otwarciu prowadzisz obrady. Członkowie potwierdzają obecność na telefonach.'}</p>
    {link && <Notice tone="warn"><p>{link}</p></Notice>}
    <Button kind={primary ? 'primary' : 'secondary'} wide={primary} haspopup busy={busy} onClick={() => setConfirm(true)}>{option.needsReason ? 'Otwórz posiedzenie zamiast zastępcy' : 'Otwórz posiedzenie'}</Button>
    {confirm && <Confirm title="Otworzyć posiedzenie?" confirm="Otwórz i prowadź" onClose={() => setConfirm(false)} onConfirm={reason => send({type: 'open', ...(option.needsReason ? {reason} : {})})}
      field={option.needsReason ? {label: 'Powód', required: true, hint: 'Np. wyznaczony zastępca jest nieobecny.'} : undefined}
      text={<>
        <p>Rozpoczniesz prowadzenie obrad, a Twoja obecność zostanie zapisana razem z otwarciem.</p>
        {lists}
        <p>Ustawienia posiedzenia zapiszą się przy otwarciu. Późniejsza zmiana ustawień ogólnych nie wpłynie na to posiedzenie.</p>
        {option.needsReason && <p>{`Zastępcą przewodniczącego na tym posiedzeniu jest ${s.personName(deputy)} (§ 16 ust. 2). Jeśli otwierasz posiedzenie zamiast tej osoby, podaj powód. Trafi on do protokołu.`}</p>}
      </>}/>}
  </section>;
}

/**
 * Ustawienia całego posiedzenia (rozdz. 5.4): sześć grup. Przed otwarciem wiersze K1 z edycją w miejscu; po otwarciu
 * (`m.frozen`) karta „Ustawienia posiedzenia zapisane przy otwarciu” bez „Zmień” poza odnośnikiem i danymi do protokołu.
 * Zespół C może pokazać tę kartę w trakcie obrad i po zamknięciu.
 */
export function MeetingSettingsCard() {
  const {m} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const prep = usePrep();
  const cmd = useCommand();
  const bundle = useGeneral();
  const law = lawOf(m.organ);
  const eff = m.effective;
  const frozen = !!m.frozen;
  const editable = !frozen && m.status === 'przygotowanie' && canPrepare(s.roster, m, actor);
  const lateEdit = frozen && m.status !== 'przygotowanie' && (isOfficeAccount(actor) || m.chair.current === s.personId || chairRank(s.roster, m as Meeting, s.personId) === 1);
  const members = organRoster(s.roster, m);
  const chairman = members.find(x => x.func === 'przewodniczacy');
  const deputy = deputyOf(s.roster, m as Meeting);
  const who = (id: string | null | undefined) => { const ms = members.find(x => x.personId === id); return ms ? `${s.personName(id)}, ${ms.label}` : s.personName(id); };
  const rada = organOfCode(s.roster, 'rada');
  const onEditing = (on: boolean) => prep?.setSideEditing(on);
  const details = (patch: Omit<Extract<Command, {type: 'details'}>, 'type'>) => cmd({type: 'details', ...patch});
  const changes = eff ? [eff.meeting.voteMinutes, eff.meeting.motionMinutes].filter(e => e.source === 'posiedzenie').length : 0;
  const quorum = eff?.meeting.quorum.value;
  const days = eff?.meeting.notice.value.days ?? null;
  const notice = eff?.meeting.notice.value;
  const restored = (e: Effective<number>) => `Przywrócono ${minutesText(Number(e.inherited), 'biernik')} z ${e.inheritedSource === 'szablon' ? 'wzoru posiedzenia' : 'ustawień ogólnych'}.`;
  const templateGone = m.template && bundle && !organSettingsOf(bundle.general, m.organ).templates.some(t => t.id === m.template!.id);
  const convener = eff?.meeting.convener.value ?? m.convener ?? chairman?.personId ?? null;
  return <section class="oi-card meeting-settings" aria-labelledby="ustawienia-posiedzenia">
    <h2 class="oi-card__title" id="ustawienia-posiedzenia"><span class="oi-mark" aria-hidden="true"/><span>{frozen ? 'Ustawienia posiedzenia zapisane przy otwarciu' : 'Ustawienia całego posiedzenia'}</span></h2>
    {frozen && <p class="small">{m.frozen!.legacy ? 'Zapisano przy przejściu na wersję 3.' : `Zapisano ${dateDotsOf(m.frozen!.at)} o godz. ${timeOf(m.frozen!.at)}. Zmiana ustawień ogólnych nie wpływa na to posiedzenie.`}</p>}
    {m.template && <dl class="facts" id="ust-wzor" tabIndex={-1}><div class="fact"><dt>Wzór posiedzenia</dt><dd>{m.template.name}{templateGone ? '. Wzoru już nie ma, obowiązują ustawienia ogólne.' : ''}</dd></div></dl>}
    <Fold title="Termin, miejsce i tryb">
      <SettingsList label="Termin, miejsce i tryb" onOpenChange={onEditing}>
        <SettingRow label="Termin i miejsce" at="posiedzenie" source="" action="Zmień termin i miejsce" actionLabel="Zmień termin i miejsce" genitive="terminu i miejsca"
          value={<>{`${fmtDate(m.date)}, godz. ${m.time}`}<br/>{m.place || 'Miejsce nie jest wpisane'}</>}
          editor={editable ? (close, ctl) => <TermPlaceEditor close={close} ctl={ctl} m={m} onSave={details}/> : undefined}/>
        <SettingRow label="Tryb i połączenie" at="posiedzenie" source="" action="Zmień tryb i połączenie" actionLabel="Zmień tryb i połączenie" genitive="trybu i połączenia"
          value={<>{m.mode === 'zdalne' ? 'Zdalne' : 'Stacjonarne'}{m.mode === 'zdalne' && <><br/>{m.link || 'Brak odnośnika do połączenia'}</>}</>}
          editor={editable || lateEdit ? (close, ctl) => <ModeLinkEditor close={close} ctl={ctl} m={m} modeEditable={editable} remote={law.remote.allowed} onSave={details}/> : undefined}/>
      </SettingsList>
    </Fold>
    <Fold title="Zwołanie i zawiadomienie" id="ust-zwolanie-grupa">
      <SettingsList label="Zwołanie i zawiadomienie" onOpenChange={onEditing}>
        <SettingRow id="ust-zwolanie" label="Zwołuje" at="posiedzenie" value={convener ? who(convener) : 'Nie wskazano'} genitive="zwołującego"
          state={deputy ? 'odziedziczona' : 'regulamin'}
          source={deputy && convener === deputy ? `Zakres zastępstwa ustala ${rada.name} (§ 16 ust. 1). Przegląd przed otwarciem pokaże to do sprawdzenia.` : sourceLineText({value: null, source: 'prawo', level: 0, basis: law.convener.basis}, 'posiedzenie')}
          editor={editable && deputy && chairman ? (close, ctl) => <ConvenerEditor close={close} ctl={ctl} initial={convener ?? chairman.personId} options={[[chairman.personId, who(chairman.personId)], [deputy, who(deputy)]]} onSave={v => details({convener: v})}/> : undefined}/>
        <SettingRow id="ust-zawiadomienie" label="Data wysłania zawiadomienia" at="posiedzenie" source="" genitive="daty wysłania zawiadomienia" actionLabel="Zmień datę wysłania zawiadomienia"
          state={days !== null && days < law.notice.minDays ? 'podstawa' : 'odziedziczona'}
          value={m.noticeDate ? `${fmtDate(m.noticeDate)}${days !== null ? `, ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem` : ''}` : 'Nie wpisano'}
          hint={!m.noticeDate && notice?.deadline ? `Zawiadomienie wysyła się co najmniej ${law.notice.minDays} dni przed posiedzeniem, najpóźniej ${dateDots(notice.deadline)} (${law.notice.basis}).` : undefined}
          extra={days !== null && days < law.notice.minDays && <p class="setting-src strong">{`Zawiadomienie wysłano ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem, a regulamin wymaga co najmniej ${law.notice.minDays} dni (${law.notice.basis}). To zdanie trafi do protokołu.`}</p>}
          editor={editable ? (close, ctl) => <DateRowEditor close={close} ctl={ctl} label="Data wysłania zawiadomienia" initial={m.noticeDate} onSave={v => details({noticeDate: v})}/> : undefined}/>
      </SettingsList>
    </Fold>
    <Fold title="Prowadzenie obrad" open={!frozen && chairRank(s.roster, m as Meeting, s.personId) === 1}>
      <SettingsList label="Prowadzenie obrad">
        <SettingRow label="Otwiera i prowadzi" at="posiedzenie" state="regulamin" source={`${sourceLineText({value: null, source: 'prawo', level: 0, basis: '§ 9 ust. 1 i § 16 ust. 2'}, 'posiedzenie').replace(/\.$/, '')}; ${sourceLineText({value: null, source: 'zasada', level: 0, rule: 'D1'}, 'posiedzenie').replace(/^Z/, 'z')}`}
          value="Przewodniczący lub wiceprzewodniczący (§ 9 ust. 1). Pierwszeństwo ma przewodniczący, potem zastępca, którego przewodniczący wyznaczył."/>
      </SettingsList>
      <DeputyCard/>
    </Fold>
    <Fold title="Uczestnicy">
      <Participants editable={editable || (m.status !== 'przygotowanie' && m.status !== 'zakonczone' && m.chair.current === s.personId)}/>
    </Fold>
    <Fold id="ust-glosowania" title={changes ? `Głosowania (${changes} ${plural(changes, 'zmiana', 'zmiany', 'zmian')})` : 'Głosowania'}>
      {eff && <SettingsList label="Głosowania" onOpenChange={onEditing}>
        <SettingRow label="Czas głosowania w sprawie" value={minutesText(eff.meeting.voteMinutes.value)} effective={eff.meeting.voteMinutes} at="posiedzenie" show={v => minutesText(Number(v))} genitive="czasu głosowania w sprawie"
          editor={editable ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowania w sprawie" initial={eff.meeting.voteMinutes.value} options={VOTE_MINUTES} onSave={v => cmd({type: 'settings_set', key: 'voteMinutes', value: v})}/> : undefined}
          resetLabel={eff.meeting.voteMinutes.inheritedSource === 'szablon' ? 'Przywróć ustawienie wzoru posiedzenia' : 'Przywróć ustawienie ogólne'}
          onReset={editable ? async () => { const e = eff.meeting.voteMinutes; await cmd({type: 'settings_reset', key: 'voteMinutes'}); return restored(e); } : undefined}/>
        <SettingRow label="Czas głosowań nad wnioskami" value={minutesText(eff.meeting.motionMinutes.value)} effective={eff.meeting.motionMinutes} at="posiedzenie" show={v => minutesText(Number(v))} genitive="czasu głosowań nad wnioskami"
          editor={editable ? (close, ctl) => <MinutesRowEditor close={close} ctl={ctl} label="Czas głosowań nad wnioskami" initial={eff.meeting.motionMinutes.value} options={MOTION_MINUTES} onSave={v => cmd({type: 'settings_set', key: 'motionMinutes', value: v})}/> : undefined}
          resetLabel={eff.meeting.motionMinutes.inheritedSource === 'szablon' ? 'Przywróć ustawienie wzoru posiedzenia' : 'Przywróć ustawienie ogólne'}
          onReset={editable ? async () => { const e = eff.meeting.motionMinutes; await cmd({type: 'settings_reset', key: 'motionMinutes'}); return restored(e); } : undefined}/>
        <SettingRow label="Zasady głosowania" at="posiedzenie" source="" value={quorum ? `Głosowanie jawne, zwykła większość, wymagane kworum ${quorum.required} z ${quorum.total} (§ 8 ust. 2–3, § 11 ust. 1).` : ''}/>
      </SettingsList>}
    </Fold>
    <Fold title="Dane do protokołu">
      <SettingsList label="Dane do protokołu" onOpenChange={onEditing}>
        <SettingRow label="Numer protokołu" at="posiedzenie" source="" value={m.protocolNumber || 'Nie wpisano'} genitive="numeru protokołu" actionLabel="Zmień numer protokołu"
          editor={editable || lateEdit ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Numer protokołu" hint="Np. 12/IX/2026." initial={m.protocolNumber ?? ''} max={60} onSave={v => details({protocolNumber: v})}/> : undefined}/>
        <SettingRow label="Protokolant" at="posiedzenie" source="" value={m.recorder || 'Nie wpisano'} genitive="protokolanta" actionLabel="Zmień protokolanta"
          editor={editable || lateEdit ? (close, ctl) => <TextRowEditor close={close} ctl={ctl} label="Protokolant" hint="Imię i nazwisko osoby, która sporządza protokół." initial={m.recorder ?? ''} max={120} onSave={v => details({recorder: v})}/> : undefined}/>
      </SettingsList>
    </Fold>
  </section>;
}

function TermPlaceEditor(props: {close: (s?: string) => void; ctl: EditorCtl; m: ViewMeeting; onSave: (p: {date?: string; time?: string; place?: string}) => Promise<unknown>}) {
  const [date, setDate] = useState(props.m.date);
  const [time, setTime] = useState(props.m.time);
  const [place, setPlace] = useState(props.m.place);
  const dirty = date !== props.m.date || time !== props.m.time || place.trim() !== props.m.place;
  return <RowEditor close={props.close} ctl={props.ctl} dirty={dirty} reason={!date || !time ? 'Wpisz datę i godzinę.' : undefined} onSave={() => props.onSave({date, time, place: place.trim()})}>
    <div class="row">
      <Field label="Data" hint={dateHintText(date) || undefined}><input type="date" value={date} onInput={e => setDate((e.target as HTMLInputElement).value)}/></Field>
      <Field label="Godzina"><input type="time" value={time} onInput={e => setTime((e.target as HTMLInputElement).value)}/></Field>
    </div>
    <Field label="Miejsce"><input value={place} maxLength={200} onInput={e => setPlace((e.target as HTMLInputElement).value)}/></Field>
  </RowEditor>;
}
function ModeLinkEditor(props: {close: (s?: string) => void; ctl: EditorCtl; m: ViewMeeting; modeEditable: boolean; remote: boolean; onSave: (p: {mode?: MeetingMode; link?: string}) => Promise<unknown>}) {
  const [mode, setMode] = useState<MeetingMode>(props.m.mode);
  const [link, setLink] = useState(props.m.link);
  const dirty = mode !== props.m.mode || (mode === 'zdalne' && link.trim() !== props.m.link);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={dirty} onSave={() => props.onSave(props.modeEditable ? {mode, link: mode === 'zdalne' ? link.trim() : ''} : {link: link.trim()})}>
    {props.modeEditable && <Segments label="Tryb" value={mode} options={props.remote ? [['stacjonarne', 'Stacjonarne'], ['zdalne', 'Zdalne']] : [['stacjonarne', 'Stacjonarne']]} onChange={setMode}/>}
    {mode === 'zdalne' && <Field label="Odnośnik do połączenia wideo lub audio" hint="Dwustronna komunikacja w czasie rzeczywistym (§ 14 ust. 5), np. Teams, Zoom, Meet."><input type="url" value={link} placeholder="https://…" onInput={e => setLink((e.target as HTMLInputElement).value)}/></Field>}
  </RowEditor>;
}
function ConvenerEditor(props: {close: (s?: string) => void; ctl: EditorCtl; initial: string; options: [string, string][]; onSave: (v: string) => Promise<unknown>}) {
  const [value, setValue] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)}>
    <Segments column label="Zwołuje" value={value} options={props.options} onChange={setValue}/>
  </RowEditor>;
}
export function DateRowEditor(props: {close: (s?: string) => void; ctl: EditorCtl; label: string; initial: string; onSave: (v: string) => Promise<unknown>}) {
  const [value, setValue] = useState(props.initial);
  return <RowEditor close={props.close} ctl={props.ctl} dirty={value !== props.initial} onSave={() => props.onSave(value)}>
    <Field label={props.label} hint={dateHintText(value) || 'Puste pole usuwa datę.'}><input type="date" value={value} onInput={e => setValue((e.target as HTMLInputElement).value)}/></Field>
  </RowEditor>;
}

/**
 * Karta zastępstwa (rozdz. 4.5 i 5.4; ta sama w głosowaniu między posiedzeniami). Zastępcę wyznacza tylko przewodniczący
 * (D1); pozostali widzą fakt z datą wyznaczenia, a zastępca zdanie o swoim zastępstwie. Pola „Podstawa” nie ma.
 */
export function DeputyCard() {
  const {m} = useMeeting();
  const s = useSession();
  const actor = useActor();
  const cmd = useCommand();
  const save = useSaveStatus();
  const procedure = m.kind === 'procedura';
  const canEdit = canDesignateDeputy(s.roster, m as Meeting, actor);
  const members = organRoster(s.roster, m);
  const vices = members.filter(ms => ms.func === 'wiceprzewodniczacy');
  const deputy = deputyOf(s.roster, m as Meeting);
  const [person, setPerson] = useState(deputy ?? '');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setPerson(deputy ?? ''); }, [deputy]);
  const source = m.status === 'przygotowanie' ? duplicateSource(m.id) : null;
  const last = source?.deputy && !deputy && vices.some(v => v.personId === source.deputy) ? source.deputy : null;
  const who = (id: string) => `${s.personName(id)}, ${members.find(x => x.personId === id)?.label ?? ''}`;
  const store = (id: string) => save.track(() => cmd({type: 'deputy', personId: id || null})).then(r => { if (r) setTouched(false); });
  const set = m.chair.deputySet;
  let body: ComponentChildren;
  if (canEdit) {
    const dirty = person !== (deputy ?? '');
    body = <>
      <p class="small">{`Jeśli nie możesz być na ${procedure ? 'tym głosowaniu' : 'posiedzeniu'}, wskaż osobę, która Cię zastąpi (§ 16 ust. 2). ${procedure ? 'Zastępca rozpocznie to głosowanie i będzie nim zarządzać.' : 'Zastępca otworzy posiedzenie albo przejmie prowadzenie bez dodatkowych potwierdzeń i ma pierwszeństwo przed innym wiceprzewodniczącym.'}`}</p>
      {last && <p class="small deputy-last">{`Ostatnie zastępstwo ${s.personName(last)}, posiedzenie z dnia ${dateDots(source!.date)}.`} <Button kind="ghost" small quiet onClick={() => { setPerson(last); store(last); }}>Wyznacz ponownie</Button></p>}
      <Field label="Zastępca"><select value={person} onChange={e => { setTouched(true); save.reset(); setPerson((e.target as HTMLSelectElement).value); }}>
        <option value="">Bez wyznaczenia</option>{vices.map(v => <option key={v.personId} value={v.personId}>{s.personName(v.personId)}, {v.label}</option>)}
      </select></Field>
      <div class="form-save">
        <Button small disabled={!dirty} reason="Brak zmian do zapisania." onClick={() => store(person)}>Zapisz zastępstwo</Button>
        <SaveLine status={save} dirty={dirty} saved={t => `Zapisano zastępstwo o godz. ${t}.`}/>
      </div>
    </>;
  } else if (deputy && deputy === s.personId) {
    body = <p class="small">{procedure ? 'W tym głosowaniu zastępujesz przewodniczącego (§ 16 ust. 2). Możesz rozpocząć głosowanie i nim zarządzać.' : 'Na tym posiedzeniu zastępujesz przewodniczącego (§ 16 ust. 2). Możesz otworzyć posiedzenie i prowadzić obrady.'}</p>;
  } else if (deputy) {
    body = <p class="small">{`${who(deputy)}. Wyznaczenie przez przewodniczącego${set ? ` ${dateDotsOf(set.at)}, godz. ${timeOf(set.at)}` : ''} (§ 16 ust. 2).`}</p>;
  } else {
    body = <p class="small">{procedure
      ? 'Bez wyznaczonego zastępcy. Zastępcę wyznacza przewodniczący (§ 16 ust. 2). Bez wyznaczenia głosowanie rozpoczyna przewodniczący.'
      : 'Bez wyznaczonego zastępcy. Zastępcę wyznacza przewodniczący (§ 16 ust. 2). Bez wyznaczenia posiedzenie może otworzyć i prowadzić każdy z wiceprzewodniczących (§ 9 ust. 1).'}</p>;
  }
  return <div class="deputy-card" id="ust-zastepstwo" tabIndex={-1}>
    <h3 class="card-sub">Zastępstwo przewodniczącego</h3>
    {body}
  </div>;
}

/** Uczestnicy: skład, głos doradczy (z urzędu, § 7 ust. 2) i goście z informacją, kto zaprasza (§ 7 ust. 3, G-14). */
function Participants(props: {editable: boolean}) {
  const {m} = useMeeting();
  const s = useSession();
  const people = usePeople();
  const [showMembers, setShowMembers] = useState(false);
  const members = organRoster(s.roster, m);
  const advisory = people.filter(a => a.kind === 'doradczy' && m.invited.includes(a.id));
  const n = members.length;
  return <>
    <SettingsList label="Uczestnicy">
      <SettingRow id="ust-sklad" label="Członkowie Prezydium" at="posiedzenie" source=""
        value={m.frozen ? `${n} ${plural(n, 'osoba', 'osoby', 'osób')}. Skład zapisano przy otwarciu posiedzenia.` : `${n} ${plural(n, 'osoba', 'osoby', 'osób')}. Skład zapisze się przy otwarciu posiedzenia.`}
        extra={<>
          <div><Button kind="ghost" small quiet onClick={() => setShowMembers(v => !v)}>{showMembers ? 'Ukryj skład' : 'Pokaż skład'}</Button></div>
          {showMembers && <ul class="setting-list">{members.map(ms => <li key={ms.personId}>{s.personName(ms.personId)}, {ms.label}</li>)}</ul>}
        </>}/>
      <SettingRow label="Głos doradczy" at="posiedzenie" state="regulamin" source="Zawiadamiane o każdym posiedzeniu, § 7 ust. 2."
        value={advisory.length ? <ul class="setting-list">{advisory.map(a => <li key={a.id}>{a.displayName}{a.label ? `, ${a.label.replace(/\s*\(głos doradczy\)/i, '')}` : ''}</li>)}</ul> : 'Brak kont z głosem doradczym.'}/>
    </SettingsList>
    <Guests editable={props.editable}/>
  </>;
}

function Guests(props: {editable: boolean}) {
  const {m} = useMeeting();
  const cmd = useCommand();
  const people = usePeople();
  const {busy, error, errorKind, run} = useAction();
  const [asking, setAsking] = useState<string | null>(null);
  const [by, setBy] = useState<'przewodniczacy' | 'organ'>('przewodniczacy');
  const [decision, setDecision] = useState('');
  const guests = people.filter(a => a.kind === 'gosc');
  const source = m.status === 'przygotowanie' ? duplicateSource(m.id) : null;
  const previous = guests.filter(g => source?.invited.includes(g.id) && !m.invited.includes(g.id));
  const name = (g: {displayName: string; label: string}) => `${g.displayName}${g.label && g.label.toLowerCase() !== 'gość' ? `, ${g.label}` : ''}`;
  const ask = (id: string) => { setAsking(id); setBy('przewodniczacy'); setDecision(''); };
  const invite = (id: string) => run(async () => { await cmd({type: 'invite', accountId: id, on: true, invitedBy: by, ...(by === 'organ' ? {decision: decision.trim()} : {})}); setAsking(null); });
  const missing = by === 'organ' && !decision.trim() ? 'Wpisz, kiedy Prezydium zaprosiło gościa, np. datę posiedzenia albo numer uchwały.' : '';
  return <div class="guests" id="ust-goscie" tabIndex={-1}>
    <h3 class="card-sub">Goście</h3>
    <p class="small muted">Goście uczestniczą wyłącznie na zaproszenie przewodniczącego albo Prezydium (§ 7 ust. 3). Biuro zapisuje zaproszenie. Goście czytają kanał wiadomości, ale w nim nie piszą.</p>
    {!guests.length && <p class="muted small">Brak kont gości. Administrator może je dodać w sekcji „Konta i role” ustawień ogólnych.</p>}
    {guests.length > 0 && <ul class="checks guest-list">{guests.map(g => {
      const invited = m.invited.includes(g.id);
      const info = m.guestInvites?.[g.id];
      return <li key={g.id}>
        <Check checked={invited || asking === g.id} disabled={!props.editable || busy} onChange={on => { if (on) ask(g.id); else if (asking === g.id) setAsking(null); else run(async () => { await cmd({type: 'invite', accountId: g.id, on: false}); }); }}>
          <span><strong>{g.displayName}</strong>{g.label && g.label.toLowerCase() !== 'gość' ? `, ${g.label}` : ''}</span>
        </Check>
        {invited && info && <p class="small muted guest-info">{info.by === 'organ' ? `Na zaproszenie Prezydium, ${info.decision}.` : 'Na zaproszenie przewodniczącego.'}</p>}
        {asking === g.id && <div class="invite-form">
          <Segments label="Kto zaprasza" value={by} options={[['przewodniczacy', 'Przewodniczący'], ['organ', 'Prezydium']]} onChange={setBy}/>
          {by === 'organ' && <Field label="Kiedy Prezydium zaprosiło" hint="Np. posiedzenie z dnia 12.11.2026 albo uchwała nr 98/IX/2026."><input value={decision} maxLength={200} onInput={e => setDecision((e.target as HTMLInputElement).value)}/></Field>}
          <div class="actions"><Button small kind="primary" busy={busy} disabled={!!missing} reason={missing} onClick={() => invite(g.id)}>Zapisz zaproszenie</Button><Button small kind="ghost" quiet onClick={() => setAsking(null)}>Anuluj</Button></div>
        </div>}
      </li>;
    })}</ul>}
    {props.editable && previous.length > 0 && <div class="previous-guests">
      <h4 class="kicker">Goście poprzedniego posiedzenia</h4>
      <ul class="setting-list">{previous.map(g => <li key={g.id}><span>{name(g)}</span> <Button kind="ghost" small quiet label={`Zaproś ponownie, ${g.displayName}`} onClick={() => ask(g.id)}>Zaproś ponownie</Button></li>)}</ul>
    </div>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

/** Historia zmian posiedzenia (K5): wpisy dziennika z oznaczeniem `ustawienia` i `projekt`. */
export function MeetingHistory() {
  const {m} = useMeeting();
  const rows: HistoryRow[] = m.log.map((l, i) => ({l, i})).filter(({l}) => l.tag === 'ustawienia' || l.tag === 'projekt')
    .map(({l, i}) => ({id: i, at: l.at, actor: l.by, label: l.text, text: l.text, before: '', after: ''}));
  return <HistoryFold title={m.kind === 'procedura' ? 'Historia zmian głosowania' : 'Historia zmian posiedzenia'} rows={rows} simple emptyText="Nikt jeszcze nie zmieniał ustawień tego posiedzenia."/>;
}

/** „Zapisz jako wzór posiedzenia” (biuro): punkty i ustawienia posiedzenia stają się nowym wzorem; wpis w historii. */
function SaveAsTemplate() {
  const {m} = useMeeting();
  const actor = useActor();
  const {busy, error, errorKind, run} = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [done, setDone] = useState('');
  if (!isOfficeAccount(actor) || m.kind !== 'posiedzenie') return null;
  const save = () => run(async () => {
    const item = (it: AgendaItem): TemplateItem => ({title: it.title, kind: it.parentId ? 'sprawa' : it.kind, ...(it.docType ? {docType: it.docType} : {}), ...(it.caseType ? {caseType: it.caseType} : {})});
    const items = m.agenda.filter(i => !i.parentId).map(top => {
      const children = m.agenda.filter(i => i.parentId === top.id).map(item);
      return {...item(top), ...(children.length ? {children} : {})};
    });
    const template: Partial<MeetingTemplate> = {name: name.replace(/\s+/g, ' ').trim(), items,
      ...(m.settings && (m.settings.voteMinutes || m.settings.motionMinutes) ? {settings: {...(m.settings.voteMinutes ? {voteMinutes: m.settings.voteMinutes} : {}), ...(m.settings.motionMinutes ? {motionMinutes: m.settings.motionMinutes} : {})}} : {}),
      defaults: {time: m.time, mode: m.mode, ...(m.recorder ? {recorder: m.recorder} : {})}};
    const r = await request<{general: GeneralBundle}>('/api/settings', {body: {change: {area: 'wzory', organ: m.organ, template}}});
    setGeneral(r.general);
    setOpen(false);
    setDone(`Zapisano wzór posiedzenia „${template.name}” o godz. ${fmtTime(Date.now())}.`);
  });
  return <div class="stack-tight duplicate">
    <div><Button small haspopup onClick={() => { setName(''); setOpen(true); }}>Zapisz jako wzór posiedzenia</Button></div>
    <p class="save-status" role="status">{done}</p>
    {open && <Modal title="Zapisać jako wzór posiedzenia?" onClose={() => setOpen(false)}>
      <form class="stack" onSubmit={e => { e.preventDefault(); save(); }}>
        <p class="small">Punkty porządku, czasy głosowań, godzina, tryb i protokolant tego posiedzenia staną się nowym wzorem w ustawieniach ogólnych.</p>
        <Field label="Nazwa wzoru"><input value={name} maxLength={80} required onInput={e => setName((e.target as HTMLInputElement).value)}/></Field>
        {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
        <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz wzór</Button><Button onClick={() => setOpen(false)}>Anuluj</Button></div>
      </form>
    </Modal>}
  </div>;
}

/** Dane do protokołu zapisane w posiedzeniu (F10), puste pola jako pusty napis. */
export const protocolOf = (m: Pick<Meeting, 'protocolNumber' | 'recorder' | 'convener'>) => ({protocolNumber: m.protocolNumber ?? '', recorder: m.recorder ?? '', convener: m.convener ?? ''});

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
