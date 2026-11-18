import type {ComponentChildren} from 'preact';
import {useEffect, useState} from 'preact/hooks';
import {useNow} from './api.ts';

const zone = {timeZone: 'Europe/Warsaw'} as const;
export const fmtTime = (ts?: number | null) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, hour: '2-digit', minute: '2-digit'}).format(ts) : '—';
export const fmtDateTime = (ts?: number | null) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'}).format(ts) : '—';
export const fmtDate = (iso: string) => iso ? new Intl.DateTimeFormat('pl-PL', {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z')) : '—';
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  return n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}
export function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  const two = (x: number) => String(x).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
}

export function Button(props: {children: ComponentChildren; onClick?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'za' | 'przeciw' | 'wstrzymuje'; type?: 'button' | 'submit'; disabled?: boolean; small?: boolean; wide?: boolean; title?: string}) {
  const cls = ['btn', `btn-${props.kind ?? 'secondary'}`, props.small ? 'btn-small' : '', props.wide ? 'btn-wide' : ''].join(' ');
  return <button type={props.type ?? 'button'} class={cls} onClick={props.onClick} disabled={props.disabled} title={props.title}>{props.children}</button>;
}

export function Modal(props: {title: string; onClose: () => void; children: ComponentChildren; wide?: boolean}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', key);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('no-scroll'); };
  }, []);
  return <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onClose(); }}>
    <section class={'modal' + (props.wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={props.title}>
      <header class="modal-head"><h2>{props.title}</h2><button class="icon-btn" onClick={props.onClose} aria-label="Zamknij">×</button></header>
      <div class="modal-body">{props.children}</div>
    </section>
  </div>;
}

export function Notice(props: {tone?: 'info' | 'warn' | 'error' | 'ok'; children: ComponentChildren}) {
  return <div class={`notice notice-${props.tone ?? 'info'}`} role={props.tone === 'error' ? 'alert' : undefined}>{props.children}</div>;
}

export function Field(props: {label: string; hint?: string; children: ComponentChildren}) {
  return <label class="field"><span class="field-label">{props.label}</span>{props.children}{props.hint && <small class="field-hint">{props.hint}</small>}</label>;
}

export function Chip(props: {tone?: string; children: ComponentChildren}) {
  return <span class={`chip chip-${props.tone ?? 'plain'}`}>{props.children}</span>;
}

export function Countdown(props: {endsAt: number; label?: boolean}) {
  const now = useNow(500);
  const left = props.endsAt - now;
  return <span class={'countdown' + (left < 30000 ? ' countdown-soon' : '')} aria-label={`Pozostało ${clock(left)}`}>{props.label !== false && 'Pozostało '}<strong>{clock(left)}</strong></span>;
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
    <div class="actions"><Button onClick={props.onClose}>Anuluj</Button><Button kind={props.kind ?? 'primary'} onClick={() => { props.onConfirm(); props.onClose(); }}>{props.confirm}</Button></div>
  </Modal>;
}
