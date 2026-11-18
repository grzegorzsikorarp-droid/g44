import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {existsSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {accountView, Store, type UserRow} from './store.ts';
import {cookieToken, hashToken, newToken, passwordHash, passwordMatches, sessionCookie, SESSION_SECONDS, validPassword, validUsername} from './auth.ts';
import {SecretBallots} from './secret.ts';
import {cleanHtml, docxToHtml, guessType, htmlHash, markdownToHtml, splitActs, textToHtml} from './documents.ts';
import {minutesHtml} from './minutes.ts';
import {advance, apply, canView, createMeeting, DomainError, isOrganizer, secretCast, secretIssue, type Command, type Context} from '../shared/meeting.ts';
import {newItem} from '../shared/agenda.ts';
import {personName} from '../shared/roster.ts';
import {summary, viewFor} from '../shared/view.ts';
import type {Account, Actor, MaterialRef, MaterialType, Meeting} from '../shared/types.ts';

export const VERSION = '0.1.0';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const materialTypes: MaterialType[] = ['uchwala', 'rezolucja', 'oswiadczenie', 'deklaracja', 'apel', 'sprawozdanie', 'protokol', 'informacja', 'inny'];
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), {status}); };

async function body(req: IncomingMessage, max: number) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) fail('Plik lub żądanie przekracza dozwoloną wielkość.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req: IncomingMessage, max = 1_000_000): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('Wymagany format JSON.', 415);
  try { return JSON.parse((await body(req, max)).toString('utf8')); }
  catch (e) { if ((e as {status?: number}).status) throw e; fail('Nieprawidłowy format JSON.'); }
}

export interface AppOptions { dataDir?: string; appUrl?: string; setupToken?: string; clientDir?: string; now?: () => number; tickMs?: number }

export async function createApplication(options: AppOptions = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? 'data');
  const appUrl = options.appUrl ?? process.env.APP_URL ?? '';
  const clientDir = options.clientDir ?? resolve(fileURLToPath(new URL('./client/', import.meta.url)));
  const now = options.now ?? Date.now;
  const local = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host);
  if (appUrl && !['http:', 'https:'].includes(new URL(appUrl).protocol)) throw new Error('APP_URL musi być adresem HTTP lub HTTPS.');
  const configured = appUrl ? new URL(appUrl) : null;
  if (configured && configured.protocol !== 'https:' && !local(configured.hostname) && process.env.ALLOW_HTTP !== '1') {
    throw new Error('Adres APP_URL w sieci musi używać HTTPS. Dla zamkniętej sieci testowej ustaw ALLOW_HTTP=1.');
  }
  const secure = configured?.protocol === 'https:';
  const store = new Store(dataDir);
  const db = store.db;
  let scrub = false;
  const secret = new SecretBallots(store, () => { scrub = true; });
  const afterWrite = () => { if (scrub) { scrub = false; setImmediate(() => store.scrubSecretTraces()); } };

  const tokenPath = join(dataDir, 'pierwsze-uruchomienie.txt');
  let setupKey = '';
  if (!store.hasUsers()) {
    setupKey = options.setupToken ?? (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : newToken());
    if (!options.setupToken) writeFileSync(tokenPath, setupKey, {mode: 0o600});
  }
  const dummyHash = await passwordHash(newToken());
  const attempts = new Map<string, {count: number; until: number}>();
  const assets = new Map<string, {bytes: Buffer; gzip: Buffer}>();

  const context = (): Context => ({
    roster: store.roster(), now: now(), newId: randomUUID,
    secret: {openKey: id => secret.openKey(id), tally: id => secret.tally(id), closeKey: id => secret.closeKey(id)},
  });
  const write = <T>(fn: () => T) => { try { return store.transaction(fn); } finally { afterWrite(); } };

  function actorOf(req: IncomingMessage): Actor | null {
    const token = cookieToken(req);
    if (!token) return null;
    const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(hashToken(token), now()) as UserRow | undefined;
    if (!row) return null;
    const account = accountView(row);
    return {account, personId: account.personId, name: account.personId ? personName(store.roster(), account.personId) : account.displayName};
  }
  function loginCookie(userId: string) {
    const token = newToken();
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), userId, now() + SESSION_SECONDS * 1000);
    return sessionCookie(token, secure);
  }
  const accounts = () => store.users().map(accountView);

  function meetingFor(id: string, actor: Actor) {
    const m = store.meeting(id);
    if (!m) fail('Nie znaleziono posiedzenia.', 404);
    if (!canView(store.roster(), m!, actor)) fail('Brak dostępu do tego posiedzenia.', 403);
    return m!;
  }
  function requireEditor(m: Meeting, actor: Actor) {
    if (m.status === 'zakonczone') fail('Posiedzenie zostało zamknięte.');
    if (!isOrganizer(store.roster(), m, actor) && m.chair.current !== actor.personId) fail('Materiały dodaje organizator lub prowadzący.', 403);
  }

  // Zamykanie głosowań po upływie czasu także wtedy, gdy nikt akurat nie odświeża strony.
  const ticker = setInterval(() => {
    for (const id of store.liveMeetingIds()) {
      const m = store.meeting(id);
      if (!m || !m.ballots.some(b => b.status === 'otwarte')) continue;
      try {
        write(() => {
          const copy = structuredClone(m);
          if (advance(copy, context())) { copy.revision++; store.saveMeeting(copy, now()); }
        });
      } catch (error) { console.error('Błąd automatycznego zamykania głosowania:', error); }
    }
  }, options.tickMs ?? 1000);
  ticker.unref();

  function addMaterial(m: Meeting, actor: Actor, input: {title: string; type: MaterialType; number: string; html: string; source: string; fileId: string | null; fileName: string | null}) {
    const ref: MaterialRef = {
      id: randomUUID(), title: input.title.trim().slice(0, 300) || 'Materiał', type: input.type, number: input.number.trim().slice(0, 60),
      version: 1, hash: htmlHash(input.html), size: Buffer.byteLength(input.html), fileId: input.fileId, fileName: input.fileName, createdAt: now(),
    };
    db.prepare('INSERT INTO material_versions VALUES (?,?,?,?,?,?,?,?)').run(ref.id, 1, m.id, input.html, ref.hash, input.source, now(), actor.name);
    m.materials.push(ref);
    return ref;
  }

  async function readUpload(req: IncomingMessage, origin: string) {
    const bytes = await body(req, 11 * 1024 * 1024);
    const form = await new Request(origin + '/upload', {method: 'POST', headers: {'Content-Type': req.headers['content-type'] || ''}, body: bytes}).formData();
    return form;
  }
  async function convert(file: File) {
    const name = file.name.slice(0, 255), ext = extname(name).toLowerCase();
    if (file.size > 10 * 1024 * 1024) fail('Plik może mieć najwyżej 10 MB.');
    const buffer = Buffer.from(await file.arrayBuffer());
    if (ext === '.docx') return {html: await docxToHtml(buffer), source: 'docx', buffer, name, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
    if (ext === '.md' || ext === '.markdown') return {html: markdownToHtml(buffer.toString('utf8')), source: 'markdown', buffer, name, mime: 'text/markdown'};
    if (ext === '.txt') return {html: textToHtml(buffer.toString('utf8')), source: 'text', buffer, name, mime: 'text/plain'};
    if (ext === '.pdf') return {html: '', source: 'pdf', buffer, name, mime: 'application/pdf'};
    return fail('Dozwolone pliki: DOCX, PDF, TXT, Markdown.');
  }
  async function saveFile(meetingId: string, upload: {buffer: Buffer; name: string; mime: string}) {
    const id = 'plik_' + randomUUID();
    await writeFile(join(dataDir, 'files', id), upload.buffer, {mode: 0o600, flag: 'wx'});
    db.prepare('INSERT INTO files VALUES (?,?,?,?,?,?)').run(id, meetingId, upload.name, upload.buffer.length, upload.mime, now());
    return id;
  }

  const json = (res: ServerResponse, value: unknown, status = 200, extra: Record<string, string> = {}) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Server-Now': String(now()), ...extra});
    res.end(JSON.stringify(value));
  };
  function originFor(req: IncomingMessage) {
    if (configured) return configured.origin;
    let url: URL;
    try { url = new URL('http://' + (req.headers.host || '')); } catch { return fail('Nieprawidłowy adres aplikacji.'); }
    if (!local(url.hostname)) fail('Ustaw APP_URL, aby korzystać z aplikacji pod tym adresem.', 403);
    return url.origin;
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    try {
      const origin = originFor(req), url = new URL(req.url || '/', origin), path = url.pathname, method = req.method || 'GET';
      if (method !== 'GET' && method !== 'HEAD' && (req.headers.origin !== origin || req.headers['x-posiedzenia'] !== '1')) fail('Niedozwolone pochodzenie żądania.', 403);
      if (path === '/api/health') return json(res, {ok: true, version: VERSION});

      // Głos tajny przychodzi celowo bez sesji — serwer nie wie, kto go wysłał.
      const castMatch = path.match(/^\/api\/meetings\/([\w-]+)\/secret\/cast$/);
      if (castMatch && method === 'POST') {
        const input = await jsonBody(req, 10000);
        if (!['za', 'przeciw', 'wstrzymuje'].includes(input.choice)) fail('Nieprawidłowy wybór.');
        const result = write(() => {
          const m = store.meeting(castMatch[1]) ?? fail('Nie znaleziono posiedzenia.', 404);
          const b = m.ballots.find(x => x.id === input.ballotId);
          if (!b?.secret) fail('Nie znaleziono głosowania tajnego.', 404);
          const check = secret.check(b!.id, b!.secret!, input.token, input.signature);
          if (check.used) return {ok: true, duplicate: true};
          if (b!.status !== 'otwarte') fail('Głosowanie zostało zakończone przed przyjęciem głosu.', 409);
          secret.record(b!.id, check.tokenHash, input.choice);
          store.saveMeeting(secretCast(m, b!.id, context()), now());
          return {ok: true};
        });
        return json(res, result);
      }

      const actor = actorOf(req);
      if (path === '/api/session' && method === 'GET') {
        const setupRequired = !store.hasUsers();
        return json(res, {account: actor?.account ?? null, setupRequired, roster: actor || setupRequired ? store.roster() : null, version: VERSION});
      }
      if (path === '/api/setup' && method === 'POST') {
        const input = await jsonBody(req, 10000);
        if (store.hasUsers()) fail('Administrator został już utworzony.', 409);
        if (!setupKey || hashToken(String(input.token ?? '').trim()) !== hashToken(setupKey)) fail('Nieprawidłowy kod pierwszego uruchomienia.', 403);
        const username = validUsername(input.username), password = await passwordHash(validPassword(input.password));
        const personId = input.personId ? String(input.personId) : null;
        if (personId && !store.roster().persons.some(p => p.id === personId)) fail('Wybierz osobę ze składu.');
        const id = randomUUID();
        write(() => {
          if (store.hasUsers()) fail('Administrator został już utworzony.', 409);
          db.prepare('INSERT INTO users(id,username,password,kind,person_id,display_name,label,admin,must_change,created) VALUES (?,?,?,?,?,?,?,1,0,?)')
            .run(id, username, password, personId ? 'czlonek' : 'biuro', personId, personId ? personName(store.roster(), personId) : String(input.displayName || 'Administrator').slice(0, 100), personId ? '' : 'Biuro Izby', now());
        });
        setupKey = '';
        if (existsSync(tokenPath)) unlinkSync(tokenPath);
        return json(res, {account: accountView(store.user(id)!)}, 201, {'Set-Cookie': loginCookie(id)});
      }
      if (path === '/api/login' && method === 'POST') {
        const input = await jsonBody(req, 10000);
        const username = String(input.username ?? '').toLowerCase().slice(0, 64), key = req.socket.remoteAddress + '|' + username, t = now();
        const bucket = attempts.get(key) ?? {count: 0, until: t + 300000};
        if (bucket.until < t) { bucket.count = 0; bucket.until = t + 300000; }
        if (bucket.count >= 8) fail('Zbyt wiele prób logowania. Spróbuj ponownie za kilka minut.', 429);
        if (attempts.size > 5000) for (const [k, v] of attempts) if (v.until < t) attempts.delete(k);
        const row = store.userByName(username);
        const ok = await passwordMatches(input.password, row?.password ?? dummyHash);
        if (!row || row.disabled || !ok) { bucket.count++; attempts.set(key, bucket); fail('Nieprawidłowy login lub hasło.', 401); }
        attempts.delete(key);
        return json(res, {account: accountView(row!)}, 200, {'Set-Cookie': loginCookie(row!.id)});
      }
      if (path === '/api/logout' && method === 'POST') {
        const token = cookieToken(req);
        if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token));
        return json(res, {ok: true}, 200, {'Set-Cookie': sessionCookie('', secure, 0)});
      }

      if (path.startsWith('/api/')) {
        if (!actor) fail('Zaloguj się.', 401);
        const a = actor!;
        if (path === '/api/password' && method === 'POST') {
          const input = await jsonBody(req, 10000);
          const row = store.user(a.account.id)!;
          if (!await passwordMatches(input.currentPassword, row.password)) fail('Obecne hasło jest nieprawidłowe.', 403);
          if (await passwordMatches(input.password, row.password)) fail('Nowe hasło musi różnić się od dotychczasowego.');
          const password = await passwordHash(validPassword(input.password));
          write(() => {
            db.prepare('UPDATE users SET password=?, must_change=0 WHERE id=?').run(password, a.account.id);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(a.account.id);
          });
          return json(res, {account: accountView(store.user(a.account.id)!)}, 200, {'Set-Cookie': loginCookie(a.account.id)});
        }
        if (a.account.mustChange) fail('Przed rozpoczęciem pracy ustaw własne hasło.', 403);

        if (path === '/api/accounts') {
          if (!a.account.admin) fail('Ta czynność wymaga uprawnień administratora.', 403);
          if (method === 'GET') return json(res, {accounts: accounts()});
          const input = await jsonBody(req, 10000);
          if (method === 'POST') {
            const username = validUsername(input.username), password = await passwordHash(validPassword(input.password));
            const kind = input.kind as Account['kind'];
            if (!['czlonek', 'doradczy', 'gosc', 'biuro'].includes(kind)) fail('Wybierz rodzaj konta.');
            let personId: string | null = null, displayName = String(input.displayName ?? '').trim().slice(0, 100);
            if (kind === 'czlonek') {
              personId = String(input.personId ?? '');
              if (!store.roster().persons.some(p => p.id === personId)) fail('Wybierz osobę ze składu.');
              displayName = personName(store.roster(), personId);
            } else if (displayName.length < 3) fail('Podaj imię i nazwisko albo nazwę konta.');
            if (store.userByName(username)) fail('Ten login jest już zajęty.', 409);
            if (personId && db.prepare('SELECT 1 FROM users WHERE person_id=?').get(personId)) fail('Ta osoba ma już konto.', 409);
            db.prepare('INSERT INTO users(id,username,password,kind,person_id,display_name,label,admin,must_change,created) VALUES (?,?,?,?,?,?,?,?,1,?)')
              .run(randomUUID(), username, password, kind, personId, displayName, String(input.label ?? '').slice(0, 120), input.admin ? 1 : 0, now());
            return json(res, {accounts: accounts()}, 201);
          }
          if (method === 'PATCH') {
            const target = store.user(String(input.id)) ?? fail('Nie znaleziono konta.', 404);
            if (target.id === a.account.id && (input.disabled !== undefined || input.admin !== undefined)) fail('Nie można zablokować własnego konta ani odebrać sobie uprawnień.');
            const password = input.password ? await passwordHash(validPassword(input.password)) : null;
            write(() => {
              if (typeof input.disabled === 'boolean') db.prepare('UPDATE users SET disabled=? WHERE id=?').run(input.disabled ? 1 : 0, target.id);
              if (typeof input.admin === 'boolean') db.prepare('UPDATE users SET admin=? WHERE id=?').run(input.admin ? 1 : 0, target.id);
              if (typeof input.label === 'string') db.prepare('UPDATE users SET label=? WHERE id=?').run(input.label.slice(0, 120), target.id);
              if (password) db.prepare('UPDATE users SET password=?, must_change=1 WHERE id=?').run(password, target.id);
              if (password || input.disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
            });
            return json(res, {accounts: accounts()});
          }
        }

        if (path === '/api/people' && method === 'GET') {
          // Lista kont potrzebna organizatorowi do zaproszeń (głos doradczy, goście).
          const roster = store.roster();
          const organizer = a.account.admin || a.account.kind === 'biuro' || roster.memberships.some(ms => ms.personId === a.personId && ms.canChair);
          return json(res, {accounts: organizer ? accounts().filter(x => !x.disabled).map(x => ({id: x.id, displayName: x.displayName, label: x.label, kind: x.kind, personId: x.personId})) : []});
        }

        if (path === '/api/meetings' && method === 'GET') {
          const roster = store.roster();
          const list = store.meetingIds().map(id => store.meeting(id)!).filter(m => m && canView(roster, m, a)).map(summary);
          return json(res, {meetings: list});
        }
        if (path === '/api/meetings' && method === 'POST') {
          const input = await jsonBody(req, 10000);
          const kind = input.kind === 'procedura' ? 'procedura' : 'posiedzenie';
          const draft = createMeeting({
            id: randomUUID(), organ: 'prezydium', kind,
            title: String(input.title || (kind === 'posiedzenie' ? 'Posiedzenie Prezydium ORPiP' : 'Głosowanie między posiedzeniami Prezydium ORPiP')),
            date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date(now()).toISOString().slice(0, 10),
            time: /^\d{2}:\d{2}$/.test(input.time) ? input.time : '10:00', place: String(input.place ?? ''),
            mode: kind === 'procedura' ? 'zdalne' : input.mode === 'zdalne' ? 'zdalne' : 'stacjonarne',
            createdBy: a.name, now: now(), newId: randomUUID, endsAt: Number(input.endsAt) || undefined,
          });
          if (!isOrganizer(store.roster(), draft, a)) fail('Posiedzenie przygotowuje biuro, przewodniczący lub wiceprzewodniczący.', 403);
          write(() => store.saveMeeting(draft, now()));
          return json(res, {meeting: viewFor(draft, a)}, 201);
        }

        const mm = path.match(/^\/api\/meetings\/([\w-]+)(\/.*)?$/);
        if (mm) {
          const id = mm[1], rest = mm[2] ?? '';
          if (rest === '' && method === 'GET') {
            const m = meetingFor(id, a);
            const etag = `"${VERSION}-${m.revision}-${a.account.id}"`;
            if (req.headers['if-none-match'] === etag) { res.writeHead(304, {'ETag': etag, 'X-Server-Now': String(now()), 'Cache-Control': 'private, no-cache'}); return res.end(); }
            return json(res, {meeting: viewFor(m, a)}, 200, {'ETag': etag, 'Cache-Control': 'private, no-cache'});
          }
          if (rest === '' && method === 'DELETE') {
            const m = meetingFor(id, a);
            if (!isOrganizer(store.roster(), m, a) || m.status !== 'przygotowanie') fail('Usunąć można tylko nierozpoczęte posiedzenie — robi to organizator.', 403);
            write(() => store.deleteMeeting(id));
            return json(res, {ok: true});
          }
          if (rest === '/command' && method === 'POST') {
            const cmd = await jsonBody(req) as Command;
            if (!cmd || typeof cmd.type !== 'string') fail('Nieprawidłowa czynność.');
            const next = write(() => {
              const m = meetingFor(id, a);
              const updated = apply(m, cmd, a, context());
              store.saveMeeting(updated, now());
              return updated;
            });
            return json(res, {meeting: viewFor(next, a)});
          }
          if (rest === '/secret/issue' && method === 'POST') {
            const input = await jsonBody(req, 10000);
            const signature = write(() => {
              const m = meetingFor(id, a);
              const updated = secretIssue(m, String(input.ballotId), a, context());
              const s = secret.sign(String(input.ballotId), input.blinded);
              store.saveMeeting(updated, now());
              return s;
            });
            return json(res, {signature});
          }
          if (rest === '/protokol' && method === 'GET') {
            const m = meetingFor(id, a);
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store'});
            return res.end(minutesHtml(m, store.roster(), accounts(), now()));
          }
          if (rest === '/materials' && method === 'POST') {
            requireEditor(meetingFor(id, a), a);
            let created: MaterialRef[];
            if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) {
              const input = await jsonBody(req, 400000);
              const text = String(input.text ?? '');
              if (!text.trim()) fail('Wklej treść materiału.');
              const html = input.format === 'markdown' ? markdownToHtml(text) : textToHtml(text);
              const title = String(input.title ?? '').trim() || 'Materiał';
              created = write(() => {
                const m = structuredClone(meetingFor(id, a));
                requireEditor(m, a);
                const refs = [addMaterial(m, a, {title, type: materialTypes.includes(input.type) ? input.type : guessType(title), number: String(input.number ?? ''), html, source: input.format === 'markdown' ? 'markdown' : 'text', fileId: null, fileName: null})];
                attachCreated(m, refs, input.itemId ? String(input.itemId) : null, false, a);
                store.saveMeeting(m, now());
                return refs;
              });
            } else {
              const form = await readUpload(req, origin);
              const file = form.get('file');
              if (!(file instanceof File)) fail('Wybierz plik.');
              const upload = await convert(file as File);
              const fileId = await saveFile(id, upload);
              const parts = form.get('split') === '1' && upload.source === 'docx' ? splitActs(upload.html) : [];
              const parentId = String(form.get('itemId') ?? '') || null;
              const createItems = form.get('createItems') === '1';
              created = write(() => {
                const m = structuredClone(meetingFor(id, a));
                requireEditor(m, a);
                const title = String(form.get('title') ?? '').trim() || upload.name.replace(/\.[^.]+$/, '');
                const t = String(form.get('type') ?? '') as MaterialType;
                const refs = parts.length
                  ? parts.map(part => addMaterial(m, a, {title: part.title, type: part.type, number: part.number, html: part.html, source: 'docx', fileId, fileName: upload.name}))
                  : [addMaterial(m, a, {title, type: materialTypes.includes(t) ? t : guessType(title), number: String(form.get('number') ?? ''), html: upload.html, source: upload.source, fileId, fileName: upload.name})];
                attachCreated(m, refs, parentId, createItems && parts.length > 0, a);
                store.saveMeeting(m, now());
                return refs;
              });
            }
            return json(res, {meeting: viewFor(store.meeting(id)!, a), created: created.map(r => r.id)}, 201);
          }
          const mat = rest.match(/^\/materials\/([\w-]+)(\/version)?$/);
          if (mat) {
            const m = meetingFor(id, a);
            const ref = m.materials.find(x => x.id === mat[1]) ?? fail('Nie znaleziono materiału.', 404);
            if (!mat[2] && method === 'GET') {
              const version = Number(url.searchParams.get('v')) || ref.version;
              const row = db.prepare('SELECT html, hash FROM material_versions WHERE material_id=? AND version=?').get(ref.id, version) as {html: string; hash: string} | undefined;
              if (!row) fail('Nie znaleziono tej wersji materiału.', 404);
              const etag = `"${row!.hash}"`;
              if (req.headers['if-none-match'] === etag) { res.writeHead(304, {ETag: etag}); return res.end(); }
              return json(res, {material: {...ref, version, hash: row!.hash, html: row!.html}}, 200, {ETag: etag, 'Cache-Control': 'private, no-cache'});
            }
            if (!mat[2] && method === 'DELETE') {
              if (!isOrganizer(store.roster(), m, a) || m.status !== 'przygotowanie') fail('Materiał usuwa organizator przed otwarciem posiedzenia.', 403);
              if (m.ballots.some(b => b.material?.id === ref.id)) fail('Nad tym materiałem już głosowano.');
              const next = write(() => {
                const next = structuredClone(meetingFor(id, a));
                next.materials = next.materials.filter(x => x.id !== ref.id);
                for (const it of next.agenda) it.materialIds = it.materialIds.filter(x => x !== ref.id);
                if (next.presentation?.id === ref.id) next.presentation = null;
                next.log.push({at: now(), text: `Usunięto materiał „${ref.title}”.`, by: a.name});
                next.revision++;
                store.saveMeeting(next, now());
                return next;
              });
              return json(res, {meeting: viewFor(next, a)});
            }
            if (mat[2] && method === 'POST') {
              requireEditor(m, a);
              let html: string, source: string;
              if ((req.headers['content-type'] || '').startsWith('multipart/form-data')) {
                const form = await readUpload(req, origin), file = form.get('file');
                if (!(file instanceof File)) fail('Wybierz plik.');
                const upload = await convert(file as File);
                html = upload.html; source = upload.source;
              } else {
                const input = await jsonBody(req, 400000);
                if (!String(input.text ?? '').trim()) fail('Wklej treść materiału.');
                html = input.format === 'markdown' ? markdownToHtml(String(input.text)) : input.format === 'html' ? cleanHtml(String(input.text)) : textToHtml(String(input.text));
                source = input.format ?? 'text';
              }
              const next = write(() => {
                const next = structuredClone(meetingFor(id, a));
                const target = next.materials.find(x => x.id === ref.id) ?? fail('Nie znaleziono materiału.', 404);
                target.version++;
                target.hash = htmlHash(html);
                target.size = Buffer.byteLength(html);
                db.prepare('INSERT INTO material_versions VALUES (?,?,?,?,?,?,?,?)').run(target.id, target.version, id, html, target.hash, source, now(), a.name);
                next.log.push({at: now(), text: `Nowa wersja materiału „${target.title}”: wersja ${target.version}.`, by: a.name});
                next.revision++;
                store.saveMeeting(next, now());
                return next;
              });
              return json(res, {meeting: viewFor(next, a)});
            }
          }
          const fileMatch = rest.match(/^\/files\/(plik_[\w-]+)$/);
          if (fileMatch && method === 'GET') {
            const m = meetingFor(id, a);
            const row = db.prepare('SELECT * FROM files WHERE id=? AND meeting_id=?').get(fileMatch[1], m.id) as {id: string; name: string; mime: string} | undefined;
            if (!row) fail('Nie znaleziono pliku.', 404);
            const bytes = await readFile(join(dataDir, 'files', row!.id));
            res.writeHead(200, {'Content-Type': row!.mime || 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row!.name)}`, 'Cache-Control': 'private, no-store'});
            return res.end(bytes);
          }
        }
        fail('Nie znaleziono tej funkcji.', 404);
      }

      if (method !== 'GET' && method !== 'HEAD') fail('Niedozwolona metoda.', 405);
      const requested = path === '/' ? '/index.html' : decodeURIComponent(path);
      const file = resolve(clientDir, '.' + requested);
      if (!file.startsWith(resolve(clientDir) + sep) || !existsSync(file) || !statSync(file).isFile()) fail('Nie znaleziono pliku.', 404);
      let asset = assets.get(file);
      if (!asset) { const bytes = readFileSync(file); asset = {bytes, gzip: gzipSync(bytes)}; assets.set(file, asset); }
      const gzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Vary': 'Accept-Encoding',
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        ...(gzip ? {'Content-Encoding': 'gzip'} : {}),
      });
      return res.end(method === 'HEAD' ? undefined : gzip ? asset.gzip : asset.bytes);
    } catch (error) {
      const status = error instanceof DomainError ? error.status : (error as {status?: number}).status ?? 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) json(res, {error: status === 500 ? 'Nie udało się wykonać działania.' : (error as Error).message}, status);
      else res.end();
    }
  });

  function attachCreated(m: Meeting, refs: MaterialRef[], parentId: string | null, createItems: boolean, a: Actor) {
    const parent = parentId ? m.agenda.find(i => i.id === parentId) : undefined;
    if (createItems && parent && !parent.parentId) {
      const canAdd = m.status === 'przygotowanie' || (!m.agendaAdopted && m.chair.current === a.personId);
      if (!canAdd) fail('Po przyjęciu porządku podpunkty dodaje się przez zmianę porządku obrad.');
      let at = m.agenda.indexOf(parent) + 1;
      while (at < m.agenda.length && m.agenda[at].parentId === parent.id) at++;
      for (const ref of refs) {
        const sub = newItem(randomUUID(), ref.title, 'sprawa', parent.id);
        sub.materialIds = [ref.id];
        m.agenda.splice(at++, 0, sub);
      }
    } else if (parent) {
      parent.materialIds = [...new Set([...parent.materialIds, ...refs.map(r => r.id)])];
    }
    m.log.push({at: now(), text: refs.length > 1 ? `Dodano ${refs.length} materiałów z jednego pliku.` : `Dodano materiał „${refs[0]?.title}”.`, by: a.name});
    m.revision++;
  }

  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.on('close', () => { clearInterval(ticker); store.close(); });
  return {server, store, setupKey};
}
