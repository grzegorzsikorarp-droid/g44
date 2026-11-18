import type {ComponentChildren, VNode} from 'preact';
import {cloneElement, isValidElement} from 'preact';
import {useEffect, useId, useState} from 'preact/hooks';
import {useNow} from './api.ts';

// Elementy interfejsu na komponentach identyfikacji Izby (brand/components/oipip.css, klasy oi-*).

const zone = {timeZone: 'Europe/Warsaw'} as const;
const none = '–';
export const fmtTime = (ts?: number | null) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, hour: '2-digit', minute: '2-digit'}).format(ts) : none;
/** „19 listopada 2026 r., godz. 18:00” */
export const fmtDateTime = (ts?: number | null) => ts ? `${new Intl.DateTimeFormat('pl-PL', {...zone, day: 'numeric', month: 'long', year: 'numeric'}).format(ts)} r., godz. ${fmtTime(ts)}` : none;
/** „czwartek, 19 listopada 2026 r.” */
export const fmtDate = (iso: string) => iso ? `${new Intl.DateTimeFormat('pl-PL', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.` : none;
/** „19.11.2026” do kart i tabel */
export const fmtShort = (iso: string) => iso ? iso.split('-').reverse().join('.') : none;
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  return n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}
export function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

type Kind = 'primary' | 'secondary' | 'danger' | 'ghost';
/** Działanie główne to skośny czerwony przycisk, drugie ma czerwony obrys, poboczne jest odnośnikiem. */
export function Button(props: {children: ComponentChildren; onClick?: () => void; kind?: Kind; type?: 'button' | 'submit'; disabled?: boolean; small?: boolean; wide?: boolean; title?: string; label?: string; quiet?: boolean}) {
  const kind = props.kind ?? 'secondary';
  if (kind === 'ghost') return <button type={props.type ?? 'button'} class={'link' + (props.small ? ' small' : '') + (props.quiet ? ' quiet' : '')} onClick={props.onClick} disabled={props.disabled} title={props.title} aria-label={props.label}>{props.children}</button>;
  const cls = ['oi-btn', kind === 'primary' ? '' : 'oi-btn--obrys', props.small ? 'oi-btn--maly' : '', props.wide ? 'btn-wide' : ''].filter(Boolean).join(' ');
  return <button type={props.type ?? 'button'} class={cls} onClick={props.onClick} disabled={props.disabled} title={props.title} aria-label={props.label}><span>{props.children}</span></button>;
}

/** Odnośnik wyglądający jak przycisk (np. „Ekran sali”). */
export function LinkButton(props: {href: string; children: ComponentChildren; primary?: boolean; small?: boolean; target?: string}) {
  const cls = ['oi-btn', props.primary ? '' : 'oi-btn--obrys', props.small ? 'oi-btn--maly' : ''].filter(Boolean).join(' ');
  return <a class={cls} href={props.href} target={props.target} rel={props.target ? 'noopener noreferrer' : undefined}><span>{props.children}</span></a>;
}

export function Modal(props: {title: string; onClose: () => void; children: ComponentChildren; wide?: boolean}) {
  const id = useId();
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', key);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('no-scroll'); };
  }, []);
  return <div class="modal-backdrop">
    <div class="modal-shade" onClick={props.onClose}/>
    <section class={'modal' + (props.wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header class="modal-head"><span class="oi-mark" aria-hidden="true"/><h2 id={id}>{props.title}</h2><Button small onClick={props.onClose}>Zamknij</Button></header>
      <div class="modal-body">{props.children}</div>
    </section>
  </div>;
}

/**
 * Uwaga z paskiem 6 px z lewej strony. Czerwony pasek: informacja, od której zależy działanie.
 * Czarny pasek z etykietą „Ważne”: zastrzeżenie albo warunek. Błąd ma etykietę „Do poprawienia”.
 */
export function Notice(props: {tone?: 'info' | 'warn' | 'error' | 'ok'; children: ComponentChildren}) {
  const tone = props.tone ?? 'info';
  const label = tone === 'warn' ? 'Ważne' : tone === 'error' ? 'Do poprawienia' : null;
  return <div class={'oi-note notice' + (tone === 'warn' || tone === 'ok' ? ' oi-note--wazne' : '') + (tone === 'error' ? ' notice-error' : '')} role={tone === 'error' ? 'alert' : undefined}>
    {label && <span class="oi-label">{label}</span>}
    <div class="notice-text">{props.children}</div>
  </div>;
}

/** Pole z etykietą wersalikami nad polem (bez dwukropka) i podpowiedzią pod spodem. */
export function Field(props: {label: string; hint?: string; children: ComponentChildren}) {
  const id = useId();
  const hint = props.hint ? id + '-p' : undefined;
  const child = props.children;
  const single = isValidElement(child) ? cloneElement(child as VNode<{class?: string}>, {id, 'aria-describedby': hint, class: ['oi-input', (child as VNode<{class?: string}>).props.class].filter(Boolean).join(' ')} as never) : null;
  return <div class="oi-field">
    {single ? <label class="oi-field__label" for={id}>{props.label}</label> : <span class="oi-field__label">{props.label}</span>}
    {single ?? child}
    {props.hint && <span class="oi-field__hint" id={hint}>{props.hint}</span>}
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

/** Skośna etykieta rodzaju treści. */
export function Tag(props: {dark?: boolean; children: ComponentChildren}) {
  return <span class={'oi-tag' + (props.dark ? ' oi-tag--ciemny' : '')}><span>{props.children}</span></span>;
}

/** Tytuł karty ze skośnym znaczkiem. */
export function CardTitle(props: {children: ComponentChildren; level?: 2 | 3}) {
  const inner = <><span class="oi-mark" aria-hidden="true"/><span>{props.children}</span></>;
  return props.level === 2 ? <h2 class="oi-card__title">{inner}</h2> : <h3 class="oi-card__title">{inner}</h3>;
}

/** Nagłówek sekcji: znaczek, cienka kursywa, linia 2 px. */
export function SectionHead(props: {children: ComponentChildren; count?: string}) {
  return <div class="oi-section-head"><span class="oi-mark" aria-hidden="true"/><h2>{props.children}</h2>{props.count && <span class="oi-count">{props.count}</span>}</div>;
}

/** Etykieta nad wartością (bez dwukropka). */
export function Fact(props: {label: string; children: ComponentChildren}) {
  return <div class="fact"><dt>{props.label}</dt><dd>{props.children}</dd></div>;
}

/** Rozwijana sekcja ze skośnym znacznikiem plus i minus (wzór pytań Izby). */
export function Fold(props: {title: ComponentChildren; children: ComponentChildren; open?: boolean}) {
  return <div class="oi-faq fold"><details open={props.open}><summary>{props.title}<span class="oi-faq__pm" aria-hidden="true"/></summary><div class="oi-faq__a">{props.children}</div></details></div>;
}

export function Countdown(props: {endsAt: number; label?: boolean}) {
  const now = useNow(500);
  const left = props.endsAt - now;
  return <span class={'countdown' + (left < 30000 ? ' countdown-soon' : '')} aria-label={`Pozostało ${clock(left)}`}>{props.label !== false && <span class="countdown-label">Pozostało </span>}<strong>{clock(left)}</strong></span>;
}

// Wykonanie czynności z obsługą stanu „trwa” i komunikatu o błędzie.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run<T>(fn: () => Promise<T>) {
    setBusy(true); setError('');
    try { return await fn(); }
    catch (e) { setError((e as Error).message); return undefined; }
    finally { setBusy(false); }
  }
  return {busy, error, setError, run};
}

export function Confirm(props: {title: string; text: ComponentChildren; confirm: string; kind?: 'primary' | 'danger'; onConfirm: () => void; onClose: () => void}) {
  return <Modal title={props.title} onClose={props.onClose}>
    <div class="confirm-text">{props.text}</div>
    <div class="actions"><Button kind="primary" onClick={() => { props.onConfirm(); props.onClose(); }}>{props.confirm}</Button><Button onClick={props.onClose}>Anuluj</Button></div>
  </Modal>;
}
