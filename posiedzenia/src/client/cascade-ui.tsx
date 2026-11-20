import type {ComponentChildren} from 'preact';
import {createContext} from 'preact';
import {useContext, useEffect, useId, useRef, useState} from 'preact/hooks';
import type {CompositionBasis, Effective, OrganCode} from '../shared/types.ts';
import {sourceText, stampText} from '../shared/cascade.ts';
import {basisProblem, type AuditEntry, type SettingsArea} from '../shared/settings.ts';
import {organOfCode} from '../shared/roster.ts';
import {request} from './api.ts';
import {brand} from './brand.ts';
import {useSession} from './session.ts';
import {Button, Fact, Field, Fold, fmtDate, fmtTime, Notice, Segments} from './ui.tsx';

// Wzorce kaskady ustawień K1–K7 (specyfikacja wersji 3, rozdz. 5.1), wspólne dla ustawień ogólnych, wzorów posiedzeń,
// ustawień posiedzenia i punktu. Pakiet wstępny A0: ostateczne API i prosta działająca wersja bez własnych stylów
// (style w src/client/style/ustawienia.css dodaje zespół B). Właściciel pliku po A0: zespół B; zespół C tylko używa.
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
  return own[at].includes(e.source) || (at === 'wzor' && e.source === 'szablon') ? 'zmieniona' : 'odziedziczona';
}
/** Wiersz zablokowany (bez pola i bez działania): regulamin, zasada, aplikacja, niedostępne. */
export const lockedState = (s: RowState) => s === 'regulamin' || s === 'zasada' || s === 'aplikacja' || s === 'niedostepne';

/**
 * Linia źródła wartości (K1). `id` łączy ją z przyciskiem działania przez aria-describedby. Przy wartości zmienionej
 * dopisuje ślad „Zmiana {data}, godz. {g}, konto {nazwa}.”.
 */
export function SourceLine(props: {id?: string; effective: Effective<unknown>; at: SourceAt; show?: (v: unknown) => string; stamp?: boolean; text?: string}) {
  const show = props.show ?? ((v: unknown) => String(v));
  const text = props.text ?? sourceText(props.effective, {at: props.at, show, houseBy: brand.houseBy});
  const stamp = props.stamp !== false && props.effective.stamp && !props.effective.frozen ? stampText(props.effective.stamp) : '';
  return <p class="setting-src small muted" id={props.id}>{text}{stamp && <><br/>{stamp}</>}</p>;
}

/** Zwinięte wyjaśnienie przy wartości zablokowanej: „Dlaczego tego nie można zmienić?”, „Kiedy to działa?”, „Kiedy to się zmieni?”. */
export function WhyLocked(props: {summary: string; children: ComponentChildren}) {
  return <details class="setting-why small"><summary>{props.summary}</summary><div>{props.children}</div></details>;
}
/** Pytanie zwinięte domyślnie dla stanu wiersza (K1, stany C, D i H). */
export const whySummary = (s: RowState) => s === 'zasada' ? 'Kiedy to działa?' : s === 'aplikacja' ? 'Kiedy to się zmieni?' : 'Dlaczego tego nie można zmienić?';

// K2: naraz otwarty jest jeden wiersz edycji w obrębie listy ustawień.
const OpenRow = createContext<{open: string | null; setOpen: (key: string | null) => void} | null>(null);

/** Lista opisowa `dl.settings` z wierszami ustawień (K1); pilnuje, żeby naraz był otwarty jeden wiersz (K2). */
export function SettingsList(props: {label?: string; children: ComponentChildren}) {
  const [open, setOpen] = useState<string | null>(null);
  return <OpenRow.Provider value={{open, setOpen}}><dl class="settings" aria-label={props.label}>{props.children}</dl></OpenRow.Provider>;
}

export interface SettingRowProps {
  /** Etykieta w mianowniku, np. „Czas głosowania w sprawie”; nazwa dostępna przycisku to „Zmień {etykieta}”. */
  label: string;
  value: ComponentChildren;
  effective?: Effective<unknown>;
  at: SourceAt;
  show?: (v: unknown) => string;
  /** Stan z tabeli K1; bez niego liczony z `effective` (rowState). */
  state?: RowState;
  /** Linia źródła zamiast `sourceText`, np. przy stanie F (powód z profilu) albo E. */
  source?: string;
  hint?: ComponentChildren;
  /** Treść zwiniętego wyjaśnienia przy wierszu zablokowanym. */
  why?: ComponentChildren;
  /** Edycja w miejscu (K2): formularz z polami; `close` zamyka wiersz i oddaje fokus na „Zmień”. */
  editor?: (close: () => void) => ComponentChildren;
  /** „Przywróć ustawienie ogólne” (przy punkcie „Przywróć ustawienie posiedzenia”) dla wartości zmienionej. */
  onReset?: () => void;
  resetLabel?: string;
}
/** Wiersz ustawienia (K1) z edycją w miejscu (K2). Wiersz zablokowany nie ma pola ani działania. */
export function SettingRow(props: SettingRowProps) {
  const id = useId();
  const group = useContext(OpenRow);
  const [ownOpen, setOwnOpen] = useState(false);
  const key = props.label;
  const isOpen = group ? group.open === key : ownOpen;
  const setOpen = (on: boolean) => group ? group.setOpen(on ? key : null) : setOwnOpen(on);
  const change = useRef<HTMLDivElement>(null);
  const state = props.state ?? rowState(props.effective, props.at);
  const locked = lockedState(state);
  const close = () => { setOpen(false); setTimeout(() => change.current?.querySelector<HTMLElement>('button')?.focus(), 0); };
  return <>
    <dt class={`setting-label is-${state}`}>{props.label}</dt>
    <dd class={`setting-value is-${state}`} onKeyDown={e => { if (e.key === 'Escape' && isOpen) { e.stopPropagation(); close(); } }}>
      <div>{props.value}</div>
      {props.hint && <p class="oi-field__hint">{props.hint}</p>}
      {(props.source || props.effective) && (props.source !== undefined
        ? <p class="setting-src small muted" id={id}>{props.source}</p>
        : <SourceLine id={id} effective={props.effective!} at={props.at} show={props.show}/>)}
      {locked && props.why && <WhyLocked summary={whySummary(state)}>{props.why}</WhyLocked>}
      {!locked && isOpen && props.editor && <div class="setting-editor">{props.editor(close)}</div>}
      {!locked && !isOpen && (props.editor || props.onReset) && <div class="setting-actions" ref={change}>
        {props.editor && <Button kind="ghost" small label={`Zmień ${props.label.toLocaleLowerCase('pl')}`} describedBy={id} onClick={() => setOpen(true)}>Zmień</Button>}
        {props.onReset && state === 'zmieniona' && <Button kind="ghost" small quiet onClick={props.onReset}>{props.resetLabel ?? 'Przywróć ustawienie ogólne'}</Button>}
      </div>}
    </dd>
  </>;
}

/** Podpowiedź pod polem daty z datą słownie (K7): „Czwartek, 3 grudnia 2026 r.”. */
export function DateHint(props: {value: string; id?: string}) {
  if (!props.value) return null;
  const text = fmtDate(props.value);
  return <span class="oi-field__hint" id={props.id}>{text.charAt(0).toLocaleUpperCase('pl') + text.slice(1)}</span>;
}

const emptyBasis = (kind: CompositionBasis['kind'], organ: OrganCode): CompositionBasis =>
  kind === 'uchwala' ? {kind, act: {organ, number: '', date: ''}} : kind === 'rezygnacja' ? {kind, date: '', to: ''} : {kind, date: '', event: ''};
/**
 * Pola podstawy zmiany (K1, stan E): uchwała (organ, numer, data), rezygnacja (data, komu złożono) albo wygaśnięcie
 * mandatu (co się stało, data, nieobowiązkowa uchwała stwierdzająca). `problem` daje komunikat G-5 do nieaktywnego „Zapisz”.
 */
export function BasisFields(props: {value: CompositionBasis | null; onChange: (value: CompositionBasis) => void; kinds?: CompositionBasis['kind'][]; organ?: OrganCode; hint?: ComponentChildren}) {
  const kinds = props.kinds ?? ['uchwala', 'rezygnacja', 'wygasniecie'];
  const organ = props.organ ?? 'rada';
  const {roster} = useSession();
  const value = props.value ?? emptyBasis(kinds[0], organ);
  const set = (next: CompositionBasis) => props.onChange(next);
  const names: Record<CompositionBasis['kind'], string> = {uchwala: 'Uchwała', rezygnacja: 'Rezygnacja', wygasniecie: 'Wygaśnięcie mandatu'};
  const act = value.kind === 'uchwala' ? value.act : value.kind === 'wygasniecie' ? value.act ?? {organ, number: '', date: ''} : null;
  const setAct = (patch: Partial<NonNullable<typeof act>>) => {
    if (value.kind === 'uchwala') set({...value, act: {...value.act, ...patch}});
    else if (value.kind === 'wygasniecie') set({...value, act: {...(value.act ?? {organ, number: '', date: ''}), ...patch}});
  };
  return <div class="basis-fields">
    <Notice tone="warn" label="Ważne">Ta zmiana wymaga podstawy. Wpisz, na czym się opiera. Zmiana trafi do historii zmian.</Notice>
    {kinds.length > 1 && <Segments label="Podstawa" value={value.kind} options={kinds.map(k => [k, names[k]] as [CompositionBasis['kind'], string])} onChange={kind => set(emptyBasis(kind, organ))} hint={props.hint}/>}
    {value.kind === 'rezygnacja' && <>
      <Field label="Data rezygnacji" hint={<DateHint value={value.date}/>}><input type="date" value={value.date} onInput={e => set({...value, date: (e.target as HTMLInputElement).value})}/></Field>
      <Field label="Komu złożono rezygnację"><input value={value.to} maxLength={200} onInput={e => set({...value, to: (e.target as HTMLInputElement).value})}/></Field>
    </>}
    {value.kind === 'wygasniecie' && <>
      <Field label="Co się stało"><input value={value.event} maxLength={200} onInput={e => set({...value, event: (e.target as HTMLInputElement).value})}/></Field>
      <Field label="Data" hint={<DateHint value={value.date}/>}><input type="date" value={value.date} onInput={e => set({...value, date: (e.target as HTMLInputElement).value})}/></Field>
    </>}
    {act && <>
      <Fact label="Organ, który podjął uchwałę">{organOfCode(roster, act.organ).name}</Fact>
      <Field label="Numer uchwały" hint="Np. 41/IX/2026."><input value={act.number} maxLength={60} onInput={e => setAct({number: (e.target as HTMLInputElement).value})}/></Field>
      <Field label="Data uchwały" hint={<DateHint value={act.date}/>}><input type="date" value={act.date} onInput={e => setAct({date: (e.target as HTMLInputElement).value})}/></Field>
    </>}
  </div>;
}
/** Komunikat G-5 dla podstawy (do powodu nieaktywnego przycisku „Zapisz”) albo null. */
export const basisReason = (value: CompositionBasis | null, onlyAct = false) => basisProblem(value, onlyAct);

/** Wiersz historii zmian (K5): wpis ustawień ogólnych albo wpis dziennika posiedzenia z oznaczeniem `ustawienia`. */
export interface HistoryRow { id: string | number; at: number; actor: string; label: string; before: string; after: string; basis?: string }
export const historyRowOf = (e: AuditEntry): HistoryRow => ({id: e.id, at: e.at, actor: e.actor, label: e.label, before: e.before, after: e.after, basis: e.basis});
/**
 * Historia zmian (K5): zwinięta sekcja z tabelą „Kiedy”, „Kto”, „Ustawienie”, „Było”, „Jest”, „Podstawa”, najnowsze na
 * górze, po 50 wierszy i „Pokaż starsze”. Z `area` wczytuje wpisy z GET /api/settings/history (tylko na stronach
 * ustawień i w przygotowaniu, nigdy w trakcie obrad); z `rows` pokazuje podane wiersze (np. dziennik posiedzenia).
 */
export function HistoryFold(props: {title?: string; area?: SettingsArea; rows?: HistoryRow[]; emptyText?: string}) {
  const [rows, setRows] = useState<HistoryRow[] | null>(props.rows ?? null);
  const [next, setNext] = useState<number | null>(null);
  const [shown, setShown] = useState(50);
  const [error, setError] = useState('');
  const load = (before?: number) => {
    if (!props.area) return;
    request<{entries: AuditEntry[]; next: number | null}>(`/api/settings/history?area=${props.area}${before ? `&before=${before}` : ''}`)
      .then(r => { setRows(old => [...(before ? old ?? [] : []), ...r.entries.map(historyRowOf)]); setNext(r.next); })
      .catch(e => setError((e as Error).message));
  };
  useEffect(() => { if (props.rows) setRows(props.rows); else load(); }, [props.area, props.rows]);
  const list = [...(rows ?? [])].sort((a, b) => b.at - a.at);
  const visible = props.area ? list : list.slice(0, shown);
  const more = props.area ? next !== null : list.length > shown;
  return <Fold title={`${props.title ?? 'Historia zmian w tej sekcji'} (${list.length}${props.area && next !== null ? '+' : ''})`}>
    {error && <Notice tone="error">{error}</Notice>}
    {!error && !list.length && <p class="muted small">{props.emptyText ?? 'Nikt jeszcze nie zmieniał ustawień w tej sekcji.'}</p>}
    {list.length > 0 && <div class="oi-table-wrap"><table class="oi-table history-table" role="table" aria-label={props.title ?? 'Historia zmian w tej sekcji'}>
      <thead><tr><th scope="col">Kiedy</th><th scope="col">Kto</th><th scope="col">Ustawienie</th><th scope="col">Było</th><th scope="col">Jest</th><th scope="col">Podstawa</th></tr></thead>
      <tbody>{visible.map(r => <tr key={r.id}>
        <td data-label="Kiedy">{`${new Date(r.at).toLocaleDateString('pl-PL', {timeZone: 'Europe/Warsaw'})}, godz. ${fmtTime(r.at)}`}</td>
        <td data-label="Kto">{r.actor}</td><td data-label="Ustawienie">{r.label}</td><td data-label="Było">{r.before}</td><td data-label="Jest">{r.after}</td>
        <td data-label="Podstawa">{r.basis ?? ''}</td>
      </tr>)}</tbody>
    </table></div>}
    {more && <Button small onClick={() => props.area ? load(next ?? undefined) : setShown(n => n + 50)}>Pokaż starsze</Button>}
  </Fold>;
}

/** Wiersz listy różnic albo odstępstw (K4) z działaniem „Pokaż”, które przewija do ustawienia i przenosi na nie fokus. */
export interface DiffRow { text: string; itemId?: string; target?: string }
/**
 * Lista różnic (`effective.differences`) albo „Trafi do protokołu” (`effective.deviations`) (K4). Bez wierszy pokazuje
 * `empty` (np. „To posiedzenie ma ustawienia ogólne i wzór posiedzenia bez zmian.”) albo nic.
 */
export function DiffList(props: {title: string; rows: DiffRow[]; onShow?: (row: DiffRow) => void; empty?: string}) {
  if (!props.rows.length) return props.empty ? <p class="muted small">{props.empty}</p> : null;
  return <div class="diff-list">
    <h3 class="kicker">{`${props.title} (${props.rows.length})`}</h3>
    <ul>{props.rows.map((r, i) => <li key={i}>{r.text}{props.onShow && (r.target || r.itemId) && <> <Button kind="ghost" small quiet onClick={() => props.onShow!(r)}>Pokaż</Button></>}</li>)}</ul>
  </div>;
}

/** Organ jako fakt (K6): w wersji 3 działa tylko Prezydium, więc zamiast przełącznika stoi pełna nazwa z danych. */
export function OrganFact(props: {organ: OrganCode; label?: string}) {
  const {roster} = useSession();
  return <Fact label={props.label ?? 'Organ'}>{organOfCode(roster, props.organ).name}</Fact>;
}
