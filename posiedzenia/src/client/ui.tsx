import type {ComponentChildren, VNode} from 'preact';
import {cloneElement, isValidElement} from 'preact';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {plural} from '../shared/text.ts';
import {typo} from '../shared/typo.ts';
import {serverNow, useNow} from './api.ts';
import type {ChipState} from './stany.ts';

// Elementy interfejsu na komponentach identyfikacji Izby (brand/components/oipip.css, klasy oi-*).

export {plural};
const zone = {timeZone: 'Europe/Warsaw'} as const;
const none = '–';
export const fmtTime = (ts?: number | null) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, hour: '2-digit', minute: '2-digit'}).format(ts) : none;
/** „19 listopada 2026 r., godz. 18:00” */
export const fmtDateTime = (ts?: number | null) => ts ? `${new Intl.DateTimeFormat('pl-PL', {...zone, day: 'numeric', month: 'long', year: 'numeric'}).format(ts)} r., godz. ${fmtTime(ts)}` : none;
/** „czwartek, 19 listopada 2026 r.” */
export const fmtDate = (iso: string) => iso ? `${new Intl.DateTimeFormat('pl-PL', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.` : none;
/** „19.11.2026” do kart i tabel */
export const fmtShort = (iso: string) => iso ? iso.split('-').reverse().join('.') : none;
/** Pozostały czas „01:23”, a od godziny „1:02:03”. */
export function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}
/** Pozostały czas słowami, od godziny wzwyż: „3 godz. 58 min”. */
export function longClock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 3600)} godz. ${Math.floor(total % 3600 / 60)} min`;
}

type Kind = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface ButtonProps {
  children: ComponentChildren; onClick?: (e: MouseEvent) => void; kind?: Kind; type?: 'button' | 'submit';
  /** Czynność trwa: przycisk zostaje w kolejności fokusu, a kliknięcie nic nie robi. */
  busy?: boolean;
  /** Przycisk nieaktywny (aria-disabled), z powodem w `reason`. */
  disabled?: boolean; reason?: ComponentChildren;
  /** Przycisk otwiera okno dialogowe. */
  haspopup?: boolean;
  small?: boolean; wide?: boolean; quiet?: boolean; title?: string; label?: string; class?: string;
}
/**
 * Działanie główne to skośny czerwony przycisk (primary), drugie ma czerwony obrys (secondary),
 * potwierdzenie czynności nieodwracalnej jest ciemne (danger), a poboczne jest odnośnikiem (ghost, z quiet szarym).
 * Przycisk nieaktywny nie dostaje atrybutu disabled, tylko aria-disabled, więc fokus na nim zostaje.
 */
export function Button(props: ButtonProps) {
  const reasonId = useId();
  const kind = props.kind ?? 'secondary';
  const inactive = !!(props.busy || props.disabled);
  const showReason = !!props.disabled && props.reason !== undefined && props.reason !== '';
  const cls = (kind === 'ghost'
    ? ['link', 'link-cel', props.small && 'small', props.quiet && 'quiet']
    : ['oi-btn', kind === 'secondary' && 'oi-btn--obrys', kind === 'danger' && 'oi-btn--ciemny', props.small && 'oi-btn--maly', props.wide && 'btn-wide']
  ).concat(props.class).filter(Boolean).join(' ');
  const button = <button type={props.type ?? 'button'} class={cls} title={props.title} aria-label={props.label}
    aria-disabled={inactive ? 'true' : undefined} aria-busy={props.busy ? 'true' : undefined}
    aria-haspopup={props.haspopup ? 'dialog' : undefined} aria-describedby={showReason ? reasonId : undefined}
    onClick={e => { if (inactive) { e.preventDefault(); return; } props.onClick?.(e); }}>
    {kind === 'ghost' ? props.children : <span>{props.children}</span>}
  </button>;
  if (props.reason === undefined) return button;
  return <span class={'btn-wrap' + (props.wide ? ' btn-wrap--wide' : '')}>{button}{showReason && <span class="btn-reason" id={reasonId}>{props.reason}</span>}</span>;
}

/** Odnośnik wyglądający jak przycisk (np. „Ekran sali”). `newTab` otwiera nową kartę i mówi o tym czytnikowi ekranu. */
export function LinkButton(props: {href: string; children: ComponentChildren; primary?: boolean; small?: boolean; target?: string; newTab?: boolean}) {
  const cls = ['oi-btn', props.primary ? '' : 'oi-btn--obrys', props.small ? 'oi-btn--maly' : ''].filter(Boolean).join(' ');
  const target = props.newTab ? '_blank' : props.target;
  return <a class={cls} href={props.href} target={target} rel={target ? 'noopener noreferrer' : undefined}>
    <span>{props.children}{props.newTab && <span class="sr-only"> (otwiera się w nowej karcie)</span>}</span>
  </a>;
}

// Klawisz Tab krąży wewnątrz okna: z ostatniego elementu wraca na pierwszy, a Shift+Tab odwrotnie.
const tabbable = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';
function keepFocusInside(dialog: HTMLDialogElement, e: KeyboardEvent) {
  if (e.key !== 'Tab' || e.defaultPrevented || (e.target as Element).closest('dialog') !== dialog) return;
  const items = [...dialog.querySelectorAll<HTMLElement>(tabbable)].filter(el => !el.hasAttribute('disabled') && el.closest('dialog') === dialog && el.getClientRects().length > 0);
  if (!items.length) { e.preventDefault(); return; }
  const first = items[0], last = items[items.length - 1], active = document.activeElement as HTMLElement | null;
  const out = !active || !items.includes(active);
  if (e.shiftKey ? out || active === first : active === last) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
}

/**
 * Okno dialogowe na natywnym <dialog> otwieranym przez showModal(): reszta strony jest nieaktywna,
 * Escape zamyka tylko wierzchnie okno, a po zamknięciu fokus wraca na element, który okno otworzył.
 * Fokus startuje na tytule albo na elemencie wskazanym selektorem `initialFocus`.
 * `tools` stoi w nagłówku przed „Zamknij” (np. „A−” i „A+” czytnika materiałów).
 */
export function Modal(props: {title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; closeButton?: boolean; initialFocus?: string; confirm?: boolean; tools?: ComponentChildren}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;
  const state = useRef({asked: false, gone: false});
  useLayoutEffect(() => {
    const el = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.open) { try { el.showModal(); } catch { el.setAttribute('open', ''); } }
    document.body.classList.add('no-scroll');
    const start = (props.initialFocus ? el.querySelector<HTMLElement>(props.initialFocus) : null) ?? heading.current;
    start?.focus({preventScroll: true});
    return () => {
      state.current.gone = true;
      if (el.open) el.close();
      if (!document.querySelector('dialog.modal-backdrop[open]')) document.body.classList.remove('no-scroll');
      if (opener?.isConnected) opener.focus({preventScroll: true});
    };
  }, []);
  const close = () => { if (!state.current.gone) { state.current.asked = true; onClose.current(); } };
  return <dialog ref={dialog} class={'modal-backdrop' + (props.confirm ? ' modal-confirm' : '')} role="dialog" aria-labelledby={id}
    onCancel={e => { e.preventDefault(); close(); }}
    onClose={() => { if (!state.current.asked) close(); }}
    onKeyDown={e => keepFocusInside(dialog.current!, e)}>
    <div class="modal-shade" onClick={close}/>
    <section class={'modal' + (props.wide ? ' modal-wide' : '')}>
      <header class="modal-head"><span class="oi-mark" aria-hidden="true"/><h2 id={id} tabIndex={-1} ref={heading}>{props.title}</h2>{props.tools}{props.closeButton !== false && <Button small onClick={close}>Zamknij</Button>}</header>
      <div class="modal-body">{props.children}</div>
    </section>
  </dialog>;
}

/**
 * Uwaga z paskiem 6 px z lewej strony. Czerwony pasek: informacja, od której zależy działanie.
 * Czarny pasek z etykietą „Ważne”: zastrzeżenie albo warunek. Błąd ma etykietę „Do poprawienia”, chyba że podano inną.
 */
export function Notice(props: {tone?: 'info' | 'warn' | 'error' | 'ok'; label?: string; children: ComponentChildren}) {
  const tone = props.tone ?? 'info';
  const label = props.label ?? (tone === 'warn' ? 'Ważne' : tone === 'error' ? 'Do poprawienia' : null);
  return <div class={'oi-note notice' + (tone === 'warn' || tone === 'ok' ? ' oi-note--wazne' : '') + (tone === 'error' ? ' notice-error' : '')} role={tone === 'error' ? 'alert' : tone === 'ok' ? 'status' : undefined}>
    {label && <span class="oi-label">{label}</span>}
    <div class="notice-text">{props.children}</div>
  </div>;
}

/** Rodzaj błędu decyduje o etykiecie: brak połączenia, błąd w formularzu albo inny. */
export type ErrorKind = 'polaczenie' | 'formularz' | 'inne';
const errorLabel: Record<ErrorKind, string> = {polaczenie: 'Brak połączenia', formularz: 'Do poprawienia', inne: 'Nie udało się'};
export function errorKindOf(e: unknown): ErrorKind {
  const status = (e as {status?: unknown} | null)?.status;
  return status === 0 ? 'polaczenie' : status === 400 || status === 413 || status === 415 ? 'formularz' : 'inne';
}
export function ErrorNotice(props: {kind?: ErrorKind; children: ComponentChildren}) {
  return <Notice tone="error" label={errorLabel[props.kind ?? 'inne']}>{props.children}</Notice>;
}

/**
 * Pole z etykietą wersalikami nad polem (bez dwukropka), komunikatem błędu i podpowiedzią pod spodem.
 * Pole dostaje aria-invalid i aria-describedby. `error={true}` oznacza błąd bez własnego komunikatu,
 * a `describedBy` dołącza komunikat stojący przy innym polu.
 */
export function Field(props: {label: string; hint?: ComponentChildren; error?: ComponentChildren | true; errorId?: string; describedBy?: string; children: ComponentChildren}) {
  const id = useId();
  const invalid = props.error !== undefined && props.error !== null && props.error !== false && props.error !== '';
  const message = invalid && props.error !== true;
  const errorId = message ? props.errorId ?? id + '-b' : undefined;
  const hintId = props.hint ? id + '-p' : undefined;
  const describedBy = [errorId, props.describedBy, hintId].filter(Boolean).join(' ') || undefined;
  const child = props.children;
  const single = isValidElement(child) ? cloneElement(child as VNode<{class?: string}>, {id, 'aria-describedby': describedBy, 'aria-invalid': invalid ? 'true' : undefined, class: ['oi-input', (child as VNode<{class?: string}>).props.class].filter(Boolean).join(' ')} as never) : null;
  return <div class={'oi-field' + (invalid ? ' oi-field--blad' : '')}>
    {single ? <label class="oi-field__label" for={id}>{props.label}</label> : <span class="oi-field__label">{props.label}</span>}
    {single ?? child}
    {message && <span class="oi-field__error" id={errorId}>{props.error}</span>}
    {props.hint && <span class="oi-field__hint" id={hintId}>{props.hint}</span>}
  </div>;
}

/** Skośne pole wyboru Izby. Ptaszek występuje tylko tutaj. */
export function Check(props: {children: ComponentChildren; name?: string; checked?: boolean; defaultChecked?: boolean; disabled?: boolean; onChange?: (on: boolean) => void}) {
  return <label class="oi-check">
    <input type="checkbox" name={props.name} checked={props.checked} defaultChecked={props.defaultChecked} disabled={props.disabled} onChange={e => props.onChange?.((e.target as HTMLInputElement).checked)}/>
    <span class="oi-check__box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span>
    <span>{props.children}</span>
  </label>;
}

/** Znacznik stanu. „trwa” to wypełnienie, „otwarte” czerwony obrys (można działać), domyślnie szary obrys. */
export function Chip(props: {tone?: 'trwa' | 'otwarte' | 'zamkniete'; children: ComponentChildren}) {
  const tone = props.tone ?? 'zamkniete';
  return <span class={'oi-status' + (tone === 'trwa' ? ' oi-status--trwa' : tone === 'otwarte' ? ' oi-status--otwarte' : '')}><span>{props.children}</span></span>;
}
/** Znacznik z tabeli stanów (stany.ts). Stan normalny (null) nie ma znacznika. */
export function StateChip(props: {state: ChipState | null}) {
  return props.state ? <Chip tone={props.state.tone}>{props.state.label}</Chip> : null;
}

/** Skośna etykieta rodzaju treści. */
export function Tag(props: {dark?: boolean; children: ComponentChildren}) {
  return <span class={'oi-tag' + (props.dark ? ' oi-tag--ciemny' : '')}><span>{props.children}</span></span>;
}

/** Tytuł karty ze skośnym znaczkiem. */
export function CardTitle(props: {children: ComponentChildren; level?: 2 | 3}) {
  const inner = <><span class="oi-mark" aria-hidden="true"/><span>{props.children}</span></>;
  return props.level === 2 ? <h2 class="oi-card__title">{inner}</h2> : <h3 class="oi-card__title">{inner}</h3>;
}

/** Tytuł z pogrubionym początkiem do słów „w sprawie”: „<b>Uchwała nr 108/IX/2026</b> w sprawie patronatu…”. */
export function TitleLead(props: {text: string}) {
  const at = props.text.indexOf(' w sprawie ');
  if (at <= 0) return <>{typo(props.text)}</>;
  return <><b>{props.text.slice(0, at)}</b>{typo(props.text.slice(at))}</>;
}

/** Nagłówek sekcji: znaczek, cienka kursywa, linia 2 px. */
export function SectionHead(props: {children: ComponentChildren; count?: string}) {
  return <div class="oi-section-head"><span class="oi-mark" aria-hidden="true"/><h2>{props.children}</h2>{props.count && <span class="oi-count">{props.count}</span>}</div>;
}

/** Etykieta nad wartością (bez dwukropka). `class` pozwala ukryć fakt w ciasnym układzie (pasek posiedzenia). */
export function Fact(props: {label: string; class?: string; children: ComponentChildren}) {
  return <div class={props.class ? `fact ${props.class}` : 'fact'}><dt>{props.label}</dt><dd>{props.children}</dd></div>;
}

/** Rozwijana sekcja ze skośnym znacznikiem plus i minus (wzór pytań Izby). `count` dopisuje liczbę w nawiasie. */
export function Fold(props: {title: ComponentChildren; children: ComponentChildren; open?: boolean; count?: number; id?: string; onToggle?: (open: boolean) => void}) {
  const toggle = props.onToggle;
  return <div class="oi-faq fold"><details id={props.id} open={props.open} onToggle={toggle ? e => toggle((e.currentTarget as HTMLDetailsElement).open) : undefined}>
    <summary>{props.title}{props.count !== undefined ? ` (${props.count})` : null}<span class="oi-faq__pm" aria-hidden="true"/></summary>
    <div class="oi-faq__a">{props.children}</div>
  </details></div>;
}

/**
 * Licznik pozostałego czasu. Nie odzywa się w czytniku ekranu (role="timer"), ostatnie 30 s są wyróżnione.
 * Odmiana `long` pokazuje od godziny wzwyż „3 godz. 58 min”, a poniżej godziny „MM:SS”.
 */
export function Countdown(props: {endsAt: number; label?: boolean; long?: boolean}) {
  const now = useNow(500);
  const left = props.endsAt - now;
  const text = props.long && left >= 3600000 ? longClock(left) : clock(left);
  return <span class={'countdown' + (left < 30000 ? ' countdown-soon' : '')} role="timer">{props.label !== false && <span class="countdown-label">Pozostało </span>}<strong>{text}</strong></span>;
}

// Jeden w aplikacji obszar komunikatów dla czytnika ekranu. announce() czyści go i po 50 ms wpisuje zdanie.
let liveRegion: HTMLElement | null = null;
let liveTimer = 0;
export function announce(text: string) {
  const el = liveRegion;
  if (!el) return;
  el.textContent = '';
  window.clearTimeout(liveTimer);
  liveTimer = window.setTimeout(() => { el.textContent = text; }, 50);
}
export function LiveRegion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    liveRegion = ref.current;
    return () => { if (liveRegion === ref.current) liveRegion = null; };
  }, []);
  return <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" ref={ref}/>;
}

// Wykonanie czynności z obsługą stanu „trwa” i komunikatu o błędzie (z rodzajem błędu do etykiety).
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{text: string; kind: ErrorKind}>({text: '', kind: 'inne'});
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true);
    setFailure(f => f.text ? {text: '', kind: 'inne'} : f);
    try { return await fn(); }
    catch (e) { setFailure({text: (e as Error).message, kind: errorKindOf(e)}); return undefined; }
    finally { setBusy(false); }
  }
  const setError = (text: string, kind: ErrorKind = 'formularz') => setFailure({text, kind});
  return {busy, error: failure.text, errorKind: failure.kind, setError, run};
}

// Informacja o zapisie przy przycisku: „Zapisywanie…”, „Zapisano o godz. 10:42.” albo „Nie zapisano. Sprawdź połączenie.”
export type SaveState = {state: 'idle' | 'saving' | 'saved' | 'error'; at: number};
export function useSaveStatus() {
  const [status, setStatus] = useState<SaveState>({state: 'idle', at: 0});
  /** Wykonuje zapis. Wynik undefined (np. z send) albo wyjątek oznacza, że nie zapisano. */
  async function track<T>(save: () => Promise<T>): Promise<T | undefined> {
    setStatus({state: 'saving', at: 0});
    try {
      const result = await save();
      setStatus(result === undefined ? {state: 'error', at: 0} : {state: 'saved', at: serverNow()});
      return result;
    } catch {
      setStatus({state: 'error', at: 0});
      return undefined;
    }
  }
  const reset = () => setStatus({state: 'idle', at: 0});
  return {...status, track, reset};
}
export function SaveStatus(props: {status: SaveState; saved?: (time: string) => string}) {
  const {state, at} = props.status;
  const text = state === 'saving' ? 'Zapisywanie…'
    : state === 'saved' ? (props.saved ? props.saved(fmtTime(at)) : `Zapisano o godz. ${fmtTime(at)}.`)
    : state === 'error' ? 'Nie zapisano. Sprawdź połączenie.' : '';
  return <p class={'save-status' + (state === 'error' ? ' is-error' : '')} role="status">{text}</p>;
}

/** Tytuł karty przeglądarki. */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => { if (title) document.title = title; }, [title]);
}

/**
 * Potwierdzenie ze skutkiem: tytuł w formie pytania, opis skutku i przycisk, który mówi, co się stanie.
 * Przy czynności nieodwracalnej (kind="danger") przycisk jest ciemny, a fokus startuje na „Anuluj”.
 * `ack` dodaje pole wyboru, bez którego przycisk potwierdzenia jest nieaktywny.
 */
export function Confirm(props: {title: string; text: ComponentChildren; confirm: string; kind?: 'primary' | 'danger'; cancel?: string; focus?: 'cancel' | 'confirm' | 'title'; ack?: ComponentChildren; details?: ComponentChildren; onConfirm: () => void; onClose: () => void}) {
  const [acked, setAcked] = useState(false);
  const kind = props.kind ?? 'primary';
  const focus = props.focus ?? (kind === 'danger' ? 'cancel' : 'title');
  const needsAck = props.ack !== undefined && props.ack !== null;
  return <Modal title={props.title} onClose={props.onClose} closeButton={false} confirm initialFocus={focus === 'cancel' ? '.confirm-cancel' : focus === 'confirm' ? '.confirm-ok' : undefined}>
    <div class="confirm-text">{props.text}</div>
    {props.details !== undefined && props.details !== null && <div class="confirm-details">{props.details}</div>}
    {needsAck && <Check checked={acked} onChange={setAcked}>{props.ack}</Check>}
    <div class="actions confirm-actions">
      <Button kind={kind} class="confirm-ok" disabled={needsAck && !acked} reason={needsAck ? 'Zaznacz potwierdzenie powyżej.' : undefined} onClick={() => { props.onConfirm(); props.onClose(); }}>{props.confirm}</Button>
      <Button class="confirm-cancel" onClick={props.onClose}>{props.cancel ?? 'Anuluj'}</Button>
    </div>
  </Modal>;
}
