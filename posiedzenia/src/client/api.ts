import {useCallback, useEffect, useRef, useState} from 'preact/hooks';
import {brand} from './brand.ts';
import type {ViewMeeting} from './context.ts';
import type {MeetingView} from '../shared/view.ts';

let offset = 0;
export const serverNow = () => Date.now() + offset;
function noteServerTime(res: Response) {
  const value = Number(res.headers.get('x-server-now'));
  if (value) offset = Math.round(offset * 0.5 + (value - Date.now()) * 0.5);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function request<T = any>(path: string, options: {method?: string; body?: unknown; form?: FormData; blob?: Blob; anonymous?: boolean} = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.form || options.blob ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Posiedzenia'] = '1';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.blob) headers['Content-Type'] = options.blob.type || 'application/octet-stream';
  let res: Response;
  try {
    res = await fetch(path, {
      method, headers, credentials: options.anonymous ? 'omit' : 'same-origin',
      body: options.form ?? options.blob ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    });
  } catch {
    throw new ApiError('Brak połączenia. Sprawdź internet i spróbuj ponownie.', 0);
  }
  noteServerTime(res);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('posiedzenia:wyloguj'));
  if (!res.ok) throw new ApiError(data?.error ?? `Nie udało się wykonać tej czynności. Odśwież stronę i spróbuj ponownie. Jeśli błąd się powtórzy, zgłoś go ${brand.officeTo}.`, res.status);
  return data as T;
}

/**
 * Dodatek D-9 (B2-W14, 5.2): miejsce w przygotowaniu posiedzenia dołączane do zwykłego odświeżania widoku posiedzenia
 * w nagłówku `X-Przygotowanie` (`punkt:{id}`, `ustawienia`, `zgloszenie` albo pusto). Nie wysyła osobnego zapytania;
 * serwer zapisuje obecność tylko w przygotowaniu i tylko za zgodą osoby (T-5).
 */
let prepPlace = '';
export function setPrepPlace(place: '' | `punkt:${string}` | 'ustawienia' | 'zgloszenie') { prepPlace = place; }
const meetingPath = /^\/api\/meetings\/[\w-]+$/;

// Odświeżanie stanu co kilka sekund; serwer odpowiada 304, gdy nic się nie zmieniło.
export function useLive<T>(path: string | null, interval = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(true);
  const etag = useRef('');
  const latest = useRef(path);
  latest.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const headers: Record<string, string> = etag.current ? {'If-None-Match': etag.current} : {};
      if (prepPlace && meetingPath.test(path)) headers['X-Przygotowanie'] = prepPlace;
      const res = await fetch(path, {headers, credentials: 'same-origin'});
      noteServerTime(res);
      if (latest.current !== path) return;
      setOnline(true);
      if (res.status === 304) return;
      const body = await res.json();
      if (res.status === 401) { window.dispatchEvent(new Event('posiedzenia:wyloguj')); return; }
      if (!res.ok) { setError(body?.error ?? 'Nie udało się wczytać danych. Odśwież stronę.'); return; }
      etag.current = res.headers.get('etag') ?? '';
      setError('');
      setData(body);
    } catch {
      setOnline(false);
    }
  }, [path]);

  useEffect(() => {
    etag.current = '';
    setData(null);
    if (!path) return;
    let timer = 0, stopped = false;
    const loop = async () => {
      await load();
      if (!stopped) timer = window.setTimeout(loop, document.hidden ? Math.max(interval, 8000) : interval);
    };
    loop();
    const wake = () => { if (!document.hidden) { window.clearTimeout(timer); loop(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
  }, [path, interval, load]);

  const replace = useCallback((value: T) => { etag.current = ''; setData(value); }, []);
  return {data, error, online, reload: load, replace};
}

export function useNow(step = 1000) {
  const [now, setNow] = useState(serverNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), step);
    return () => window.clearInterval(timer);
  }, [step]);
  return now;
}

// ---------------------------------------------------------------------------------------------------------------
// Wersja 4 (SPEC-4 8.2 D.3, pakiet D0).

/** Posiedzenie w widoku osoby z polami wersji 4 (`prep` w przygotowaniu, `archive` po zamknięciu, 2.1). */
export type MeetingData = ViewMeeting & Pick<MeetingView, 'prep' | 'archive'>;

/**
 * Wysłanie pliku (6.2, 6.6, 6.8): `FormData` (multipart, domyślnie POST) albo `Blob` z własnym typem (np. zdjęcie JPEG,
 * domyślnie PUT). Odpowiedź i błędy jak w `request`. W wersji próbnej zapytanie obsługuje src/demo/server.ts.
 */
export function upload<T = any>(path: string, body: FormData | Blob, method?: 'POST' | 'PUT'): Promise<T> {
  return body instanceof FormData ? request<T>(path, {method: method ?? 'POST', form: body}) : request<T>(path, {method: method ?? 'PUT', blob: body});
}

/**
 * Pobranie pliku z serwera (dokumenty, teczka, CSV, pliki): odnośnik z atrybutem `download` w bieżącej stronie, bez nowej
 * karty. W wersji próbnej taki odnośnik przechwytuje src/demo/papers-window.tsx (`Blob`, komunikat w ramce sandbox).
 */
export function download(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.setAttribute('download', '');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Adres pliku do `<img>`, `<iframe>` albo `<video>` (pokaz, B3-22, B3-25). W aplikacji to adres trasy (pamięć podręczna
 * przeglądarki, CSP `frame-src 'self'`). W wersji próbnej plik przychodzi z przechwyconego `fetch` jako adres `blob:`
 * (7.3), zwalniany przy zmianie adresu. `null` nie pobiera niczego (np. w trakcie głosowania, T-2).
 */
export function useFileUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(brand.demo ? null : path);
  useEffect(() => {
    if (!brand.demo) { setUrl(path); return; }
    setUrl(null);
    if (!path) return;
    let alive = true, made = '';
    fetch(path, {credentials: 'same-origin'}).then(r => r.ok ? r.blob() : null).then(b => {
      if (!alive || !b) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return url;
}
