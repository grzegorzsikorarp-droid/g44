import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication, type AppOptions} from '../src/server/app.ts';
import {presidium} from './helpers.ts';

// Pomocnik testów API wersji 4 (zespół D, etap D.2): serwer na porcie przydzielanym przez system, klient z ciasteczkiem
// i nagłówkami wymaganymi przy zmianach, konta biura, administratora, członków Prezydium i pozostałych ról.

export async function startServer(extra: Partial<AppOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-v4-'));
  const app = await createApplication({dataDir: dir, setupToken: 'kod-testowy', clientDir: dir, tickMs: 50, workerMs: 3600000, purgeMs: 3600000, pdfCheckMs: 20, ...extra});
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const port = (app.server.address() as {port: number}).port;
  const origin = `http://127.0.0.1:${port}`;
  const stop = () => new Promise<void>(r => { app.server.closeAllConnections(); app.server.close(() => { rmSync(dir, {recursive: true, force: true}); r(); }); });
  return {origin, stop, app, dir};
}

export type Client = ReturnType<typeof client>;
/** `as`: nagłówek Origin, gdy serwer ma APP_URL (np. https://posiedzenia.example.org przy włączonej poczcie). */
export function client(origin: string, as = origin) {
  let cookie = '';
  async function raw(path: string, init: {method?: string; body?: BodyInit; headers?: Record<string, string>} = {}) {
    const headers: Record<string, string> = {Origin: as, 'X-Posiedzenia': '1', ...(init.headers ?? {})};
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(origin + path, {method: init.method ?? 'GET', headers, body: init.body});
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  }
  async function call(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') {
    const res = await raw(path, {method, body: data === undefined ? undefined : JSON.stringify(data), headers: data === undefined ? {} : {'Content-Type': 'application/json'}});
    const text = await res.text();
    const body = text.startsWith('{') ? JSON.parse(text) : text;
    return {status: res.status, body, headers: res.headers};
  }
  return {
    raw, call,
    async ok(path: string, data?: unknown, method?: string) {
      const r = await call(path, data, method);
      if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
  };
}

/** Biuro z uprawnieniami administratora, drugie konto biura bez nich (`office`), członkowie Prezydium z własnymi hasłami oraz konta głosu doradczego, gościa i komunikacji. */
export async function people(origin: string, as = origin) {
  const admin = client(origin, as);
  await admin.ok('/api/setup', {token: 'kod-testowy', username: 'biuro', password: 'BardzoTajne-2026', displayName: 'Biuro Izby'});
  const members = new Map<string, Client>();
  const login = async (username: string) => {
    const c = client(origin, as);
    await c.ok('/api/login', {username, password: 'Tymczasowe-2026'});
    await c.ok('/api/password', {currentPassword: 'Tymczasowe-2026', password: `Wlasne-haslo-${username}-2026`});
    return c;
  };
  for (const p of presidium) {
    await admin.ok('/api/accounts', {username: `${p}.test`, kind: 'czlonek', personId: p, password: 'Tymczasowe-2026'});
    members.set(p, await login(`${p}.test`));
  }
  await admin.ok('/api/accounts', {username: 'doradczy', kind: 'doradczy', displayName: 'Ewa Doradcza', label: 'Okręgowy Rzecznik', password: 'Tymczasowe-2026'});
  await admin.ok('/api/accounts', {username: 'gosc', kind: 'gosc', displayName: 'Jan Gościnny', label: 'radca prawny', password: 'Tymczasowe-2026'});
  await admin.ok('/api/accounts', {username: 'komunikacja', kind: 'komunikacja', displayName: 'Dział komunikacji', password: 'Tymczasowe-2026'});
  const advisor = await login('doradczy'), guest = await login('gosc'), comms = await login('komunikacja');
  await admin.ok('/api/accounts', {username: 'sekretariat', kind: 'biuro', displayName: 'Sekretariat biura', password: 'Tymczasowe-2026'});
  const office = await login('sekretariat');
  const accounts = (await admin.ok('/api/accounts')).accounts as {id: string; username: string}[];
  const idOf = (username: string) => accounts.find(a => a.username === username)!.id;
  return {admin, office, members, advisor, guest, comms, idOf, si: members.get('si')!, login};
}
