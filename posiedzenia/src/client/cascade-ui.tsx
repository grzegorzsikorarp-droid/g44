import type {ComponentChildren} from 'preact';
import {createContext} from 'preact';
import {useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import type {ActRef, CompositionBasis, Effective, OrganCode} from '../shared/types.ts';
import {minutesText} from '../shared/text.ts';
import {sourceText, stampText} from '../shared/cascade.ts';
import {basisProblem, type AuditEntry, type SettingsArea} from '../shared/settings.ts';
import {organOfCode} from '../shared/roster.ts';
import {ApiError, request, serverNow} from './api.ts';
import {brand} from './brand.ts';
import {useSession} from './session.ts';
import {Button, Confirm, Fact, Field, Fold, fmtDate, fmtTime, Notice, Segments} from './ui.tsx';

// Wzorce kaskady ustawień K1–K7 (specyfikacja wersji 3, rozdz. 5.1), wspólne dla ustawień ogólnych, wzorów posiedzeń,
// ustawień posiedzenia i punktu. Właściciel pliku: zespół B; zespół C tylko używa. Style są w src/client/style/ustawienia.css.
// Linie źródła biorą brzmienia wyłącznie z `sourceText` (src/shared/cascade.ts), bez własnych tekstów.

/** Gdzie wartość jest oglądana: strona ustawień ogólnych, wzór posiedzenia, posiedzenie, punkt albo obrady. */
export type SourceAt = 'ogolne' | 'wzor' | 'posiedzenie' | 'punkt' | 'obrady';
/**
 * Stan wiersza ustawienia (tabela K1): A odziedziczona, B zmieniona, C ustalona regulaminem, D zasada przyjęta przez
 * Izbę, E wymaga podstawy, F niedostępne, G wynikająca, H ustalona w aplikacji.
 */
export type RowState = 'odziedziczona' | 'zmieniona' | 'regulamin' | 'zasada' | 'podstawa' | 'niedostepne' | 'wynikajaca' | 'aplikacja';

/** Stan wiersza z wartości skutecznej i miejsca oglądania. Wartość zamrożona przy otwarciu jest zablokowana jak regulamin. */
export function rowState(e: Effective<unknown> | undefined, at: SourceAt): RowState {
  if (!e) return 'odziedziczona';
  if (e.source === 'prawo') return 'regulamin';
  if (e.source === 'zasada') return 'zasada';
  if (e.source === 'aplikacja') return 'aplikacja';
  if (e.frozen) return 'regulamin';
  if (e.via && e.via.kind !== 'wzor') return 'wynikajaca';
  const own: Record<SourceAt, string[]> = {ogolne: [], wzor: ['szablon'], posiedzenie: ['posiedzenie'], punkt: ['punkt'], obrady: ['obrady']};
  return own[at].includes(e.source) ? 'zmieniona' : 'odziedziczona';
}
/** Wiersz zablokowany (bez pola i bez działania): regulamin, zasada, aplikacja, niedostępne. */
export const lockedState = (s: RowState) => s === 'regulamin' || s === 'zasada' || s === 'aplikacja' || s === 'niedostepne';

/** Linia źródła słowami (do miejsc poza wierszem ustawienia, np. okna „Nowe posiedzenie”). */
export const sourceLineText = (e: Effective<unknown>, at: SourceAt, show: (v: unknown) => string = v => String(v)) => sourceText(e, {at, show, houseBy: brand.houseBy});

/**
 * Linia źródła wartości (K1). `id` łączy ją z przyciskiem działania przez aria-describedby. Przy wartości zmienionej
 * dopisuje ślad „Zmiana {data}, godz. {g}, konto {nazwa}.”.
 */
export function SourceLine(props: {id?: string; effective: Effective<unknown>; at: SourceAt; show?: (v: unknown) => string; stamp?: boolean; text?: string}) {
  const text = props.text ?? sourceLineText(props.effective, props.at, props.show);
  const stamp = props.stamp !== false && props.effective.stamp && !props.effective.frozen ? stampText(props.effective.stamp) : '';
  return <p class="setting-src" id={props.id}>{text}{stamp && <span class="setting-stamp">{stamp}</span>}</p>;
}

/** Zwinięte wyjaśnienie przy wartości zablokowanej: „Dlaczego tego nie można zmienić?”, „Kiedy to działa?”, „Kiedy to się zmieni?”. */
export function WhyLocked(props: {summary: string; children: ComponentChildren}) {
  return <details class="setting-why"><summary>{props.summary}</summary><div class="setting-why__a">{props.children}</div></details>;
}
/** Pytanie zwinięte domyślnie dla stanu wiersza (K1, stany C, D i H). */
export const whySummary = (s: RowState) => s === 'zasada' ? 'Kiedy to działa?' : s === 'aplikacja' ? 'Kiedy to się zmieni?' : 'Dlaczego tego nie można zmienić?';
/** Odpowiedź przy stanie H (zasada aplikacji do czasu decyzji zleceniodawcy). */
export const appRuleWhy = 'Gdy zapadnie decyzja w tej sprawie. Do tego czasu obowiązuje ta zasada.';

/** Sterowanie otwartym wierszem: zamknięcie z komunikatem o zapisie i zgłoszenie niezapisanej zmiany (K2). */
export interface EditorCtl { close: (status?: string) => void; setDirty: (dirty: boolean, save?: () => Promise<boolean>) => void }
interface RowGroup {
  open: string | null;
  request: (key: string, genitive: string) => void;
  close: () => void;
  dirty: {current: {key: string; save?: () => Promise<boolean>} | null};
}
// K2: naraz otwarty jest jeden wiersz edycji w obrębie listy ustawień.
const OpenRow = createContext<RowGroup | null>(null);

/**
 * Lista opisowa `dl.settings` z wierszami ustawień (K1); pilnuje, żeby naraz był otwarty jeden wiersz (K2). Próba
 * otwarcia drugiego wiersza przy niezapisanej zmianie pyta „Zapisać zmianę …?”. `onOpenChange` mówi otoczeniu, że
 * wiersz jest otwarty (np. przycisk główny w tej samej kolumnie staje się w tym czasie przyciskiem z obrysem).
 */
export function SettingsList(props: {label?: string; children: ComponentChildren; onOpenChange?: (open: boolean) => void}) {
  const [open, setOpen] = useState<string | null>(null);
  // Pytanie „Zapisać zmianę {…}?” dotyczy wiersza z niezapisaną zmianą, więc lista pamięta dopełniacz otwartego wiersza.
  const openGenitive = useRef('');
  const [asking, setAsking] = useState<{next: string; nextGenitive: string; genitive: string} | null>(null);
  const dirty = useRef<{key: string; save?: () => Promise<boolean>} | null>(null);
  const notify = useRef(props.onOpenChange);
  notify.current = props.onOpenChange;
  useEffect(() => { notify.current?.(open !== null); }, [open]);
  useEffect(() => () => notify.current?.(false), []);
  const group: RowGroup = {
    open,
    request: (key, genitive) => {
      if (open && open !== key && dirty.current?.key === open) { setAsking({next: key, nextGenitive: genitive, genitive: openGenitive.current}); return; }
      dirty.current = null;
      openGenitive.current = genitive;
      setOpen(key);
    },
    close: () => { dirty.current = null; setOpen(null); },
    dirty,
  };
  return <OpenRow.Provider value={group}>
    <dl class="settings" aria-label={props.label}>{props.children}</dl>
    {asking && <SaveQuestion genitive={asking.genitive} onClose={() => setAsking(null)}
      onSave={async () => { const ok = await dirty.current?.save?.(); if (ok !== false) { dirty.current = null; openGenitive.current = asking.nextGenitive; setOpen(asking.next); } }}
      onDiscard={() => { dirty.current = null; openGenitive.current = asking.nextGenitive; setOpen(asking.next); }}/>}
  </OpenRow.Provider>;
}

function SaveQuestion(props: {genitive: string; onSave: () => void; onDiscard: () => void; onClose: () => void}) {
  return <Confirm title={`Zapisać zmianę ${props.genitive}?`} confirm="Zapisz" cancel="Odrzuć zmianę" onClose={props.onClose}
    onConfirm={() => props.onSave()} text={<p>Zmiana w otwartym wierszu nie jest jeszcze zapisana. Naraz można zmieniać jedno ustawienie.</p>}
    onCancel={props.onDiscard}/>;
}

export interface SettingRowProps {
  /** Etykieta w mianowniku, np. „Czas głosowania w sprawie”. */
  label: string;
  value: ComponentChildren;
  effective?: Effective<unknown>;
  at: SourceAt;
  show?: (v: unknown) => string;
  /** Stan z tabeli K1; bez niego liczony z `effective` (rowState). */
  state?: RowState;
  /** Linia źródła zamiast `sourceText`, np. przy stanie F (powód z profilu) albo E. Pusty napis: bez linii źródła. */
  source?: string;
  hint?: ComponentChildren;
  /** Treść zwiniętego wyjaśnienia przy wierszu zablokowanym. */
  why?: ComponentChildren;
  /** Edycja w miejscu (K2): formularz z polami; `close` zamyka wiersz i oddaje fokus na „Zmień”. */
  editor?: (close: (status?: string) => void, ctl: EditorCtl) => ComponentChildren;
  /** „Przywróć ustawienie ogólne” (przy punkcie „Przywróć ustawienie posiedzenia”); zwraca komunikat o przywróceniu. */
  onReset?: () => Promise<string | undefined | void>;
  resetLabel?: string;
  /** Napis przycisku edycji, np. „Zmień termin i miejsce” przy bloku pól (domyślnie „Zmień”). */
  action?: string;
  /** Nazwa dostępna przycisku edycji w bierniku, np. „Zmień kadencję” (domyślnie „Zmień {etykieta}”). */
  actionLabel?: string;
  /** Etykieta w dopełniaczu do pytania „Zapisać zmianę {…}?”. */
  genitive?: string;
  /** Identyfikator wiersza, do którego przewija „Pokaż” z przeglądu i list różnic. */
  id?: string;
  /** Dodatkowa treść pod wartością (np. lista albo ostrzeżenie). */
  extra?: ComponentChildren;
}
/** Wiersz ustawienia (K1) z edycją w miejscu (K2). Wiersz zablokowany nie ma pola ani działania. */
export function SettingRow(props: SettingRowProps) {
  const id = useId();
  const group = useContext(OpenRow);
  const [ownOpen, setOwnOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const key = props.id ?? props.label;
  const isOpen = group ? group.open === key : ownOpen;
  const genitive = props.genitive ?? props.label.toLocaleLowerCase('pl');
  const change = useRef<HTMLDivElement>(null);
  const state = props.state ?? rowState(props.effective, props.at);
  const locked = lockedState(state);
  const focusChange = () => setTimeout(() => change.current?.querySelector<HTMLElement>('button')?.focus(), 0);
  const open = () => { setStatus(''); if (group) group.request(key, genitive); else setOwnOpen(true); };
  const close = (text?: string) => {
    if (group) { if (group.open === key) group.close(); } else setOwnOpen(false);
    setStatus(text ?? '');
    focusChange();
  };
  const ctl: EditorCtl = {
    close,
    setDirty: (dirty, save) => { if (group) group.dirty.current = dirty ? {key, save} : group.dirty.current?.key === key ? null : group.dirty.current; },
  };
  const reset = async () => {
    if (!props.onReset || busy) return;
    setBusy(true);
    try { setStatus((await props.onReset()) || ''); }
    catch (e) { setStatus(e instanceof ApiError && e.status === 0 ? 'Nie zapisano. Sprawdź połączenie.' : (e as Error).message); }
    finally { setBusy(false); focusChange(); }
  };
  const source = props.source !== undefined ? (props.source ? <p class="setting-src" id={id}>{props.source}</p> : null)
    : props.effective ? <SourceLine id={id} effective={props.effective} at={props.at} show={props.show}/> : null;
  const canAct = !locked && (props.editor || props.onReset);
  return <div class={`setting is-${state}${isOpen ? ' is-open' : ''}`} id={props.id} tabIndex={props.id ? -1 : undefined}>
    <dt class="setting-label">{props.label}</dt>
    <dd class="setting-value" onKeyDown={e => { if (e.key === 'Escape' && isOpen) { e.stopPropagation(); close(); } }}>
      <div class="setting-main">
        <div class="setting-text">{props.value}</div>
        {props.extra}
        {props.hint && <p class="oi-field__hint setting-hint">{props.hint}</p>}
        {source}
        {locked && props.why && <WhyLocked summary={whySummary(state)}>{props.why}</WhyLocked>}
      </div>
      {canAct && !isOpen && <div class="setting-actions" ref={change}>
        {props.editor && <Button kind="ghost" small quiet label={props.actionLabel ?? `Zmień ${props.label.toLocaleLowerCase('pl')}`} describedBy={source ? id : undefined} onClick={open}>{props.action ?? 'Zmień'}</Button>}
        {props.onReset && state === 'zmieniona' && <Button kind="ghost" small quiet busy={busy} onClick={reset}>{props.resetLabel ?? 'Przywróć ustawienie ogólne'}</Button>}
      </div>}
      {!locked && isOpen && props.editor && <div class="setting-editor">{props.editor(close, ctl)}</div>}
      <p class="save-status" role="status">{status}</p>
    </dd>
  </div>;
}

/**
 * Formularz w otwartym wierszu (K2): pola, przycisk główny „Zapisz” i cichy „Anuluj”. Zapis zamyka wiersz
 * z komunikatem „Zapisano o godz. {g}.”; przy braku połączenia „Nie zapisano. Sprawdź połączenie.”, przy odmowie domeny
 * jej komunikat pod polami. `onSave` rzuca błąd przy odmowie.
 */
export function RowEditor(props: {close: (status?: string) => void; ctl: EditorCtl; dirty: boolean; onSave: () => Promise<unknown>; children: ComponentChildren; saveLabel?: string; reason?: string}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLFormElement>(null);
  const save = async (): Promise<boolean> => {
    if (props.reason) { setError(props.reason); return false; }
    if (!props.dirty) { props.close(); return true; }
    setBusy(true); setError('');
    try {
      await props.onSave();
      props.close(`Zapisano o godz. ${fmtTime(serverNow())}.`);
      return true;
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? 'Nie zapisano. Sprawdź połączenie.' : (e as Error).message);
      return false;
    } finally { setBusy(false); }
  };
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => { props.ctl.setDirty(props.dirty, () => latest.current()); }, [props.dirty]);
  useEffect(() => () => props.ctl.setDirty(false), []);
  useLayoutEffect(() => { box.current?.querySelector<HTMLElement>('input, select, textarea, button.oi-opt')?.focus(); }, []);
  return <form class="row-editor" ref={box} onSubmit={e => { e.preventDefault(); save(); }}>
    {props.children}
    {error && <Notice tone="error">{error}</Notice>}
    <div class="actions"><Button kind="primary" small type="submit" busy={busy}>{props.saveLabel ?? 'Zapisz'}</Button><Button kind="ghost" quiet small onClick={() => props.close()}>Anuluj</Button></div>
  </form>;
}

/** Pole tekstowe w otwartym wierszu (K2). */
export function TextRowEditor(props: {close: (s?: string) => void; ctl: EditorCtl; label: string; initial: string; max: number; hint?: string; required?: boolean; onSave: (value: string) => Promise<unknown>}) {
  const [value, setValue] = useState(props.initial);
  const clean = value.replace(/\s+/g, ' ').trim();
  return <RowEditor close={props.close} ctl={props.ctl} dirty={clean !== props.initial} onSave={() => props.onSave(clean)} reason={props.required && !clean ? `Wpisz ${props.label.toLocaleLowerCase('pl')}.` : undefined}>
    <Field label={props.label} hint={props.hint}><input value={value} maxLength={props.max} onInput={e => setValue((e.target as HTMLInputElement).value)}/></Field>
  </RowEditor>;
}
/** Wybór czasu głosowania (G-3: tylko wartości z listy). */
export function MinutesRowEditor(props: {close: (s?: string) => void; ctl: EditorCtl; label: string; initial: number; options: number[]; onSave: (value: number) => Promise<unknown>}) {
  const [value, setValue] = useState(String(props.initial));
  return <RowEditor close={props.close} ctl={props.ctl} dirty={Number(value) !== props.initial} onSave={() => props.onSave(Number(value))}>
    <Segments label={props.label} value={value} options={props.options.map(n => [String(n), minutesText(n)] as [string, string])} onChange={setValue}/>
  </RowEditor>;
}

/** Data słownie pod polem daty (K7): „Czwartek, 3 grudnia 2026 r.”; pusty napis bez daty. */
export function dateHintText(value: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const text = fmtDate(value);
  return text.charAt(0).toLocaleUpperCase('pl') + text.slice(1);
}
/** Podpowiedź pod polem daty z datą słownie (K7). */
export function DateHint(props: {value: string; id?: string}) {
  const text = dateHintText(props.value);
  return text ? <span class="oi-field__hint" id={props.id}>{text}</span> : null;
}

/** Uchwała: organ (fakt), numer i data (K1, stan E). */
export function ActFields(props: {value: ActRef; onChange: (value: ActRef) => void}) {
  const {roster} = useSession();
  const act = props.value;
  return <>
    <dl class="facts"><Fact label="Organ, który podjął uchwałę">{organOfCode(roster, act.organ).name}</Fact></dl>
    <div class="row row-top">
      <Field label="Numer uchwały" hint="Np. 41/IX/2026."><input value={act.number} maxLength={60} onInput={e => props.onChange({...act, number: (e.target as HTMLInputElement).value})}/></Field>
      <Field label="Data uchwały" hint={dateHintText(act.date) || undefined}><input type="date" value={act.date} onInput={e => props.onChange({...act, date: (e.target as HTMLInputElement).value})}/></Field>
    </div>
  </>;
}

const emptyBasis = (kind: CompositionBasis['kind'], organ: OrganCode): CompositionBasis =>
  kind === 'uchwala' ? {kind, act: {organ, number: '', date: ''}} : kind === 'rezygnacja' ? {kind, date: '', to: ''} : {kind, date: '', event: ''};
/**
 * Pola podstawy zmiany (K1, stan E): uchwała (organ, numer, data), rezygnacja (data, komu złożono) albo wygaśnięcie
 * mandatu (co się stało, data, nieobowiązkowa uchwała stwierdzająca). `basisReason` daje komunikat G-5 do nieaktywnego „Zapisz”.
 */
export function BasisFields(props: {value: CompositionBasis | null; onChange: (value: CompositionBasis) => void; kinds?: CompositionBasis['kind'][]; organ?: OrganCode; hint?: ComponentChildren}) {
  const kinds = props.kinds ?? ['uchwala', 'rezygnacja', 'wygasniecie'];
  const organ = props.organ ?? 'rada';
  const {roster} = useSession();
  const value = props.value ?? emptyBasis(kinds[0], organ);
  const set = (next: CompositionBasis) => props.onChange(next);
  const names: Record<CompositionBasis['kind'], string> = {uchwala: 'Uchwała', rezygnacja: 'Rezygnacja', wygasniecie: 'Wygaśnięcie mandatu'};
  return <div class="basis-fields">
    <Notice tone="warn" label="Ważne">Ta zmiana wymaga podstawy. Wpisz, na czym się opiera. Zmiana trafi do historii zmian.</Notice>
    {kinds.length > 1
      ? <Segments label="Podstawa" value={value.kind} options={kinds.map(k => [k, names[k]] as [CompositionBasis['kind'], string])} onChange={kind => set(emptyBasis(kind, organ))} hint={props.hint}/>
      : <>{props.hint && <p class="small muted">{props.hint}</p>}</>}
    {value.kind === 'uchwala' && <ActFields value={value.act} onChange={act => set({...value, act})}/>}
    {value.kind === 'rezygnacja' && <div class="row row-top">
      <Field label="Data rezygnacji" hint={dateHintText(value.date) || undefined}><input type="date" value={value.date} onInput={e => set({...value, date: (e.target as HTMLInputElement).value})}/></Field>
      <Field label="Komu złożono rezygnację" hint={`Np. ${organOfCode(roster, 'rada').forms.dative}.`}><input value={value.to} maxLength={200} onInput={e => set({...value, to: (e.target as HTMLInputElement).value})}/></Field>
    </div>}
    {value.kind === 'wygasniecie' && <>
      <div class="row row-top">
        <Field label="Co się stało"><input value={value.event} maxLength={200} onInput={e => set({...value, event: (e.target as HTMLInputElement).value})}/></Field>
        <Field label="Data" hint={dateHintText(value.date) || undefined}><input type="date" value={value.date} onInput={e => set({...value, date: (e.target as HTMLInputElement).value})}/></Field>
      </div>
      <span class="kicker">Uchwała stwierdzająca wygaśnięcie (nieobowiązkowa)</span>
      <ActFields value={value.act ?? {organ, number: '', date: ''}} onChange={act => set(act.number || act.date ? {...value, act} : {kind: 'wygasniecie', date: value.date, event: value.event})}/>
    </>}
  </div>;
}
/** Komunikat G-5 dla podstawy (do powodu nieaktywnego przycisku „Zapisz”) albo null. */
export const basisReason = (value: CompositionBasis | null, onlyAct = false) => basisProblem(value, onlyAct);

/** Wiersz historii zmian (K5): wpis ustawień ogólnych albo wpis dziennika posiedzenia (`text` zamiast było i jest). */
export interface HistoryRow { id: string | number; at: number; actor: string; label: string; before: string; after: string; basis?: string; key?: string; text?: string }
export const historyRowOf = (e: AuditEntry): HistoryRow => ({id: e.id, at: e.at, actor: e.actor, label: e.label, before: e.before, after: e.after, basis: e.basis, key: e.key});

/** Wpisy historii zmian: z `area` (albo `all`) z GET /api/settings/history po 50, z `rows` podane wiersze. */
function useHistory(props: {area?: SettingsArea; all?: boolean; rows?: HistoryRow[]; keys?: (key: string) => boolean; version?: number}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(props.rows ?? null);
  const [next, setNext] = useState<number | null>(null);
  const [shown, setShown] = useState(50);
  const [error, setError] = useState('');
  const remote = !!(props.area || props.all);
  const load = (before?: number) => {
    if (!remote) return;
    const query = [props.area ? `area=${props.area}` : '', before ? `before=${before}` : ''].filter(Boolean).join('&');
    request<{entries: AuditEntry[]; next: number | null}>(`/api/settings/history${query ? '?' + query : ''}`)
      .then(r => { setError(''); setRows(old => [...(before ? old ?? [] : []), ...r.entries.map(historyRowOf)]); setNext(r.next); })
      .catch(e => setError((e as Error).message));
  };
  useEffect(() => { if (props.rows) setRows(props.rows); else load(); }, [props.area, props.all, props.rows, props.version]);
  const list = [...(rows ?? [])].filter(r => !props.keys || !r.key || props.keys(r.key)).sort((a, b) => b.at - a.at);
  const visible = remote ? list : list.slice(0, shown);
  const more = remote ? next !== null : list.length > shown;
  return {list, visible, more, error, loaded: rows !== null, loadMore: () => remote ? load(next ?? undefined) : setShown(n => n + 50)};
}

const when = (at: number) => `${new Date(at).toLocaleDateString('pl-PL', {timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric'})}, godz. ${fmtTime(at)}`;
function HistoryBody(props: {h: ReturnType<typeof useHistory>; label: string; emptyText?: string; simple?: boolean}) {
  const {h} = props;
  return <div class="history">
    {h.error && <Notice tone="error">{h.error}</Notice>}
    {!h.error && h.loaded && !h.list.length && <p class="muted small">{props.emptyText ?? 'Nikt jeszcze nie zmieniał ustawień w tej sekcji.'}</p>}
    {!h.loaded && !h.error && <p class="muted small">Wczytywanie…</p>}
    {h.visible.length > 0 && <div class="oi-table-wrap"><table class="oi-table history-table" role="table" aria-label={props.label}>
      <thead role="rowgroup"><tr role="row">
        <th scope="col" role="columnheader">Kiedy</th><th scope="col" role="columnheader">Kto</th>
        {props.simple ? <th scope="col" role="columnheader">Zmiana</th> : <><th scope="col" role="columnheader">Ustawienie</th><th scope="col" role="columnheader">Było</th><th scope="col" role="columnheader">Jest</th><th scope="col" role="columnheader">Podstawa</th></>}
      </tr></thead>
      <tbody role="rowgroup">{h.visible.map(r => <tr role="row" key={r.id}>
        <td role="cell" data-label="Kiedy" class="oi-nowrap">{when(r.at)}</td>
        <td role="cell" data-label="Kto">{r.actor}</td>
        {props.simple ? <td role="cell" data-label="Zmiana">{r.text ?? r.label}</td> : <>
          <td role="cell" data-label="Ustawienie">{r.label}</td><td role="cell" data-label="Było">{r.before || '–'}</td><td role="cell" data-label="Jest">{r.after || '–'}</td>
          <td role="cell" data-label="Podstawa">{r.basis || '–'}</td>
        </>}
      </tr>)}</tbody>
    </table></div>}
    {h.more && <div><Button small onClick={h.loadMore}>Pokaż starsze</Button></div>}
  </div>;
}

/**
 * Historia zmian (K5): zwinięta sekcja z tabelą „Kiedy”, „Kto”, „Ustawienie”, „Było”, „Jest”, „Podstawa”, najnowsze na
 * górze, po 50 wierszy i „Pokaż starsze”. Z `area` wczytuje wpisy z GET /api/settings/history (tylko na stronach
 * ustawień i w przygotowaniu, nigdy w trakcie obrad); z `rows` pokazuje podane wiersze (np. dziennik posiedzenia,
 * wtedy `simple`: kolumny „Kiedy”, „Kto”, „Zmiana”). `keys` zawęża wpisy obszaru do kluczy jednej sekcji, a zmiana
 * `version` (rewizja ustawień ogólnych) wczytuje historię ponownie.
 */
export function HistoryFold(props: {title?: string; area?: SettingsArea; rows?: HistoryRow[]; emptyText?: string; keys?: (key: string) => boolean; simple?: boolean; id?: string; version?: number}) {
  const h = useHistory(props);
  const title = props.title ?? 'Historia zmian w tej sekcji';
  // Liczba wpisów dopiero po wczytaniu historii, żeby w czasie wczytywania nie stało „(0)”.
  return <Fold id={props.id} title={h.loaded ? `${title} (${h.list.length}${h.more ? '+' : ''})` : title}>
    <HistoryBody h={h} label={title} emptyText={props.emptyText} simple={props.simple}/>
  </Fold>;
}
/** Historia zmian bez zwijania (sekcja „Historia zmian” ustawień ogólnych): wszystkie obszary, do których konto ma dostęp. */
export function HistoryTable(props: {label: string; area?: SettingsArea; emptyText?: string; version?: number}) {
  const h = useHistory({area: props.area, all: !props.area, version: props.version});
  return <HistoryBody h={h} label={props.label} emptyText={props.emptyText}/>;
}

/** Wiersz listy różnic albo odstępstw (K4) z działaniem „Pokaż”, które przewija do ustawienia i przenosi na nie fokus. */
export interface DiffRow { text: string; itemId?: string; target?: string }
/**
 * Lista różnic (`effective.differences`) albo „Trafi do protokołu” (`effective.deviations`) (K4). Bez wierszy pokazuje
 * `empty` (np. „To posiedzenie ma ustawienia ogólne i wzór posiedzenia bez zmian.”) albo nic.
 */
export function DiffList(props: {title: string; rows: DiffRow[]; onShow?: (row: DiffRow) => void; empty?: string}) {
  if (!props.rows.length) return props.empty ? <div class="diff-list"><h3 class="kicker">{props.title}</h3><p class="muted small">{props.empty}</p></div> : null;
  return <div class="diff-list">
    <h3 class="kicker">{`${props.title} (${props.rows.length})`}</h3>
    <ul>{props.rows.map((r, i) => <li key={i}><span>{r.text}</span>{props.onShow && (r.target || r.itemId) && <Button kind="ghost" small quiet onClick={() => props.onShow!(r)}>Pokaż</Button>}</li>)}</ul>
  </div>;
}

/** Organ jako fakt (K6): w wersji 3 działa tylko Prezydium, więc zamiast przełącznika stoi pełna nazwa z danych. */
export function OrganFact(props: {organ: OrganCode; label?: string}) {
  const {roster} = useSession();
  return <dl class="facts organ-fact"><Fact label={props.label ?? 'Organ'}>{organOfCode(roster, props.organ).name}</Fact></dl>;
}
