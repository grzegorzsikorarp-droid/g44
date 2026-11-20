import {useContext, useEffect, useState} from 'preact/hooks';
import {AvatarStore} from './avatar-store.ts';
import {SessionContext} from './session.ts';
import './style/awatar.css';

// Zdjęcie profilowe albo kwadrat z inicjałami (SPEC-4 6.0, B3-39, B3-41, B3-42, T-4). `Avatar` czyta wyłącznie adresy
// `blob:` z pamięci `avatar-store.ts`; pamięć ładuje się raz po sesji (przy pierwszym `Avatar` na ekranie), więc zmiana
// widoku ani oddanie głosu nie wysyła zapytań. Zdjęcie i kwadrat stoją prosto, bez zaokrągleń i bez skosu.

/** Pamięć zdjęć tej karty przeglądarki (jedna na stronę). */
export const avatars = new AvatarStore({
  fetch: (url, init) => fetch(url, init),
  createObjectURL: blob => URL.createObjectURL(blob),
  revokeObjectURL: url => URL.revokeObjectURL(url),
});

/** Inicjały do kwadratu bez zdjęcia: pierwsze litery imienia i nazwiska („Barbara Wiśniewska” → „BW”). */
export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, ' ').trim().split(/[\s-]+/).filter(w => /\p{L}/u.test(w));
  if (!words.length) return '';
  const first = words[0][0], last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toLocaleUpperCase('pl');
}

export type AvatarSize = 32 | 40 | 48 | 64 | 160;
/**
 * `personKey`: klucz zdjęcia (identyfikator osoby ze składu albo konta, jak w `session.avatars`).
 * `alone`: zdjęcie stoi samo (podgląd w „Moje konto”, okno usuwania): `alt="{imię i nazwisko}"`, a kwadrat ma `role="img"`
 * i nazwę „{imię i nazwisko}, bez zdjęcia”. Bez `alone` imię stoi obok: `alt=""` i kwadrat `aria-hidden` (B3-42).
 */
export function Avatar(props: {personKey: string | null; name: string; size?: AvatarSize; alone?: boolean; class?: string}) {
  const session = useContext(SessionContext);
  const [, setTick] = useState(0);
  useEffect(() => avatars.subscribe(() => setTick(t => t + 1)), []);
  useEffect(() => { if (session) avatars.load(session.avatars ?? null, session.account.id); }, [session?.account.id, JSON.stringify(session?.avatars ?? null)]);
  const size = props.size ?? 40;
  const url = avatars.url(props.personKey);
  const cls = `avatar avatar--${size}${props.class ? ' ' + props.class : ''}`;
  if (url) return <img class={cls} src={url} alt={props.alone ? props.name : ''} width={size} height={size} decoding="async"/>;
  return props.alone
    ? <span class={`${cls} avatar--inicjaly`} role="img" aria-label={`${props.name}, bez zdjęcia`}><span aria-hidden="true">{initials(props.name)}</span></span>
    : <span class={`${cls} avatar--inicjaly`} aria-hidden="true">{initials(props.name)}</span>;
}
