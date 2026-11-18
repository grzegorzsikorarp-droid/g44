import {useCallback, useEffect, useRef, useState} from 'preact/hooks';
import {brand} from './brand.ts';

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

export async function request<T = any>(path: string, options: {method?: string; body?: unknown; form?: FormData; anonymous?: boolean} = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Posiedzenia'] = '1';
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, {
      method, headers, credentials: options.anonymous ? 'omit' : 'same-origin',
      body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
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
      const res = await fetch(path, {headers: etag.current ? {'If-None-Match': etag.current} : {}, credentials: 'same-origin'});
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
