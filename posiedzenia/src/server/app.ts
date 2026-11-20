import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {existsSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {readFile, unlink, writeFile} from 'node:fs/promises';
import {inflate as inflateCb} from 'node:zlib';
import {promisify} from 'node:util';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash, randomInt, randomUUID} from 'node:crypto';
import {accountView, Store, type UserRow} from './store.ts';
import {cookieToken, hashToken, newToken, passwordHash, passwordMatches, sessionCookie, SESSION_REFRESH_MS, SESSION_SECONDS, validPassword, validUsername} from './auth.ts';
import {SecretBallots} from './secret.ts';
import {cleanHtml, docxToHtml, guessType, htmlHash, markdownToHtml, splitActs, textToHtml} from './documents.ts';
import {minutesDocx, minutesDocxFileName, minutesHtml, type MinutesLook} from './minutes.ts';
import {advance, addDisplay, addFiled, advisoryIds, apply, canView, DomainError, duplicateMeeting, newMeetingFromSettings, removeFiled, secretCast, secretIssue, setPhotos, type Command, type Context, type DisplayInput} from '../shared/meeting.ts';
import {buildFolder, deflateRaw, disposition, paperFile, type ExportDeps} from './export.ts';
import {Outbox, type Outgoing, type Sender} from './mail/outbox.ts';
import {sendOne, type SmtpOptions} from './mail/smtp.ts';
import {buildMessage} from './mail/mime.ts';
import {ADDRESS_REFUSAL, MAIL_KINDS, MAIL_LIMITS, canSendMail, hostMatches, mailRecipients, mailSettingsOf, mayMail, prefsOf, validAddress, validateMail, type AccountContact, type MailEnv, type MailKind} from '../shared/mail.ts';
import {afterMail, addressChangedMail, codeMail, minutesMail, progressMail, testMail, type MailBase, type MailSender} from '../shared/mail-templates.ts';
import {applyPrep, applyWaiting, carryOver, deferredOnOpen, emptySpace, onOpen, prepView, progress, purgeOld, toWaiting, waitingId, PREP_REFUSALS, type PrepCommand, type PrepSpace} from '../shared/workspace.ts';
import {archiveInfo, catalogCsv, catalogRows, closedRefs, periodInput, periodReport, periodReportCsv, periodReportHtml, protocolAdoptions, type CatalogFilter} from '../shared/catalog.ts';
import {actBallots, meetingPapers, paperPage, type PaperEntry} from '../shared/papers.ts';
import {acceptAvatar, acceptDisplayFile, acceptFiled, checkPdf, naturalOrder, refusalByName, seriesProblem, SHOW_LIMITS} from '../shared/files.ts';
import {memberStats, statsCsv, statsRangeInput, statsSourceLines} from '../shared/stats.ts';
import {organOfCode} from '../shared/roster.ts';
import {mailController, mailOffice} from './seed.ts';
import {newItem} from '../shared/agenda.ts';
import {docTypeInput, lockedDocTypeRefusal, sortedDocTypes} from '../shared/doctypes.ts';
import {personName} from '../shared/roster.ts';
import {seesUnannounced, summary, viewFor} from '../shared/view.ts';
import {
  canAddDisplay, canCreate, canDownloadComms, canDownloadPaper, canPrepare, canPropose, canReadMinutes, canReport, canSeeCatalog, canSeeOwnStats, canSeeRosterStats, canSeeWorkspace,
  canSetPhotos, canSetStatsSince, canView as roleCanView, isCommsAccount, isOfficeAccount, isPresiding, isReferent, minutesRefusal, organRoster, photoCircleText, seesPhotos, settingsAccess,
} from '../shared/role.ts';
import {applyCompositionChange, applySettingsChange, docTypeAudit as docTypeAuditEntry, organSettingsOf, type AuditEntry, type SettingsArea, type SettingsChange} from '../shared/settings.ts';
import {cascadeEnv, othersOf} from '../shared/cascade.ts';
import {isLockedDocType, LAW} from '../shared/law.ts';
import {dateDots, isoDayOf, plural, timeOf} from '../shared/text.ts';
import {t as tx} from '../shared/papers.ts';
import type {StatsResult} from '../shared/stats.ts';
import type {Account, Actor, DisplayFile, DocType, ItemKind, MaterialRef, MaterialType, Meeting, OrganCode, PaperFormat, PaperId} from '../shared/types.ts';

export const VERSION = '0.4.0';
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json; charset=utf-8',
};
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), {status}); };

async function body(req: IncomingMessage, max: number) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) fail('Plik jest za duży. Dodaj plik do 10 MB.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req: IncomingMessage, max = 1_000_000): Promise<any> {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('Wymagany format JSON.', 415);
  try { return JSON.parse((await body(req, max)).toString('utf8')); }
  catch (e) { if ((e as {status?: number}).status) throw e; fail('Nieprawidłowy format JSON.'); }
}

/**
 * Wersja 4 (5.4): `mail` to środowisko poczty z `main.ts` (hasło z `SMTP_PASSWORD_FILE` albo `SMTP_PASSWORD`, jedyny
 * dozwolony serwer `SMTP_HOST_ALLOWED`, własny urząd `SMTP_CA_FILE`, `MAIL_OFF=1`). Hasło nie trafia do bazy ani odpowiedzi.
 * `workerMs` to odstęp pracownika poczty (15 s), a `purgeMs` usuwania po terminie (6 godzin).
 */
export interface MailOptions { password?: string; hostAllowed?: string | null; ca?: string | Buffer; off?: boolean }
export interface AppOptions { dataDir?: string; appUrl?: string; setupToken?: string; clientDir?: string; now?: () => number; tickMs?: number; mail?: MailOptions; workerMs?: number; purgeMs?: number; pdfCheckMs?: number }
/** CSP stron aplikacji (5.3, B3-27): `blob:` w `img-src`, jawne `frame-src` i `media-src`; `script-src` bez zmian. */
export const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const COMMS_REFUSAL = 'To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.';
const inflate = promisify(inflateCb);
const inflateAsync = async (b: Uint8Array) => new Uint8Array(await inflate(b));
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export async function createApplication(options: AppOptions = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? 'data');
  const appUrl = options.appUrl ?? process.env.APP_URL ?? '';
  const clientDir = options.clientDir ?? resolve(fileURLToPath(new URL('./client/', import.meta.url)));
  // Wygląd projektu protokołu: arkusz stylów zbudowanej aplikacji i znak Izby (brand/logo kopiuje build).
  let cssHref: string | null | undefined;
  const minutesLook = (): MinutesLook => {
    if (cssHref === undefined) {
      try { cssHref = /<link[^>]+rel="stylesheet"[^>]+href="(\/assets\/[^"]+\.css)"/.exec(readFileSync(join(clientDir, 'index.html'), 'utf8'))?.[1] ?? null; } catch { cssHref = null; }
    }
    return {css: cssHref, logo: '/brand/logo/znak-oipip-slupsk.svg', nameplate: ['Okręgowa Izba Pielęgniarek i Położnych', 'w Słupsku'], org: 'Okręgowa Izba Pielęgniarek i Położnych w Słupsku', names: {office: 'biuro Izby'}};
  };
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
  if (store.purgeAbortedVotes()) store.scrubSecretTraces();
  // Wersja 3: jednorazowa migracja danych (ustawienia ogólne, zamrożenie posiedzeń sprzed wersji 3, role).
  store.migrateV3(now());
  // Wersja 4 (2.3): jednorazowa migracja pod kluczem meta 'wersja-4'; żadne istniejące posiedzenie nie dostaje `v4`.
  store.migrateV4(now());

  const tokenPath = join(dataDir, 'pierwsze-uruchomienie.txt');
  let setupKey = '';
  if (!store.hasUsers()) {
    setupKey = options.setupToken ?? (existsSync(tokenPath) ? readFileSync(tokenPath, 'utf8').trim() : newToken());
    if (!options.setupToken) writeFileSync(tokenPath, setupKey, {mode: 0o600});
  }
  const dummyHash = await passwordHash(newToken());
  const attempts = new Map<string, {count: number; until: number}>();
  const assets = new Map<string, {bytes: Buffer; gzip: Buffer}>();

  const allMeetings = () => store.meetingIds().map(id => store.meeting(id)).filter((x): x is Meeting => !!x);
  const context = (): Context => ({
    roster: store.roster(), now: now(), newId: randomUUID, docTypes: store.docTypes(),
    general: store.general(), law: LAW, accounts: accounts(),
    // Wersja 4 (5.1, G-33, G-38): zamknięte posiedzenia z rozpoznanym przyjęciem protokołu do „Dotyczy protokołu”.
    closedMeetings: closedRefs(allMeetings()),
    secret: {
      openKey: id => secret.openKey(id), tally: id => secret.tally(id), closeKey: id => secret.closeKey(id),
      // F7: karty głosowania przerwanego bez rozstrzygnięcia nie zostają w bazie (ślady w WAL usuwa scrubSecretTraces).
      discard: id => { db.prepare('DELETE FROM secret_votes WHERE ballot_id=?').run(id); },
    },
  });
  // Wersja 3: widok posiedzenia z wartościami skutecznymi (`effective`), bez dodatkowych zapytań klienta.
  const envFor = (m: Meeting) => {
    const all = allMeetings();
    const others = othersOf(m, all);
    const waiting = m.status === 'przygotowanie' ? (store.prepSpace(m.id)?.proposals ?? []).filter(p => p.state === 'zgloszone').length : 0;
    return cascadeEnv({roster: store.roster(), bundle: store.general(), organ: m.organ, accounts: accounts(), law: LAW,
      composition: store.lastComposition(m.organ), ...others, closedMeetings: closedRefs(all), proposalsWaiting: waiting});
  };
  // Wersja 4: przestrzeń robocza (tylko przygotowanie) i dane zakończonego posiedzenia (`archive`) w widoku (2.1).
  const prepFor = (m: Pick<Meeting, 'id' | 'organ'>): PrepSpace => store.prepSpace(m.id) ?? emptySpace(m.id, m.organ);
  const waitingFor = (organ: Meeting['organ']): PrepSpace => store.prepSpace(waitingId(organ)) ?? emptySpace(waitingId(organ), organ);
  const view = (m: Meeting, a: Actor) => {
    const env = envFor(m);
    const extra: Parameters<typeof viewFor>[4] = {};
    if (m.status === 'przygotowanie') extra.prep = prepView(prepFor(m), m, a, store.roster(), {env, waiting: waitingFor(m.organ), now: now()});
    if (m.status === 'zakonczone') extra.archive = archiveInfo(m, allMeetings(), a, store.roster(), isoDayOf(now()));
    return viewFor(m, a, store.roster(), env, extra);
  };
  const write = <T>(fn: () => T) => { try { return store.transaction(fn); } finally { afterWrite(); } };

  // F13: zapytanie z ważną sesją, gdy od ostatniego przedłużenia minęło co najmniej 15 minut, przesuwa jej wygaśnięcie
  // na teraz + 12 godzin i zwraca ciasteczko z nowym Max-Age (`refresh`). Ostatnie przedłużenie to wygaśnięcie − 12 godzin.
  function sessionOf(req: IncomingMessage): {actor: Actor; refresh: string | null} | null {
    const token = cookieToken(req);
    if (!token) return null;
    const hash = hashToken(token), t = now();
    const row = db.prepare('SELECT u.*, s.expires AS session_expires FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.disabled=0').get(hash, t) as (UserRow & {session_expires: number}) | undefined;
    if (!row) return null;
    const account = accountView(row);
    let refresh: string | null = null;
    if (t - (Number(row.session_expires) - SESSION_SECONDS * 1000) >= SESSION_REFRESH_MS) {
      db.prepare('UPDATE sessions SET expires=? WHERE token=?').run(t + SESSION_SECONDS * 1000, hash);
      refresh = sessionCookie(token, secure);
    }
    return {actor: {account, personId: account.personId, name: account.personId ? personName(store.roster(), account.personId) : account.displayName}, refresh};
  }
  function loginCookie(userId: string) {
    const token = newToken();
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hashToken(token), userId, now() + SESSION_SECONDS * 1000);
    return sessionCookie(token, secure);
  }
  const accounts = () => store.users().map(accountView);
  const userName = (row: UserRow) => row.person_id ? personName(store.roster(), row.person_id) : row.display_name;
  const contacts = (): AccountContact[] => store.contacts(userName);

  // Poczta (5.4, DB-16, DB-17): hasło tylko z opcji serwera, serwer poczty przypięty przez `SMTP_HOST_ALLOWED`.
  const mailCfg = {password: options.mail?.password ?? '', hostAllowed: options.mail?.hostAllowed ?? null, ca: options.mail?.ca, off: !!options.mail?.off};
  const outbox = new Outbox(db);
  const mailSettings = () => mailSettingsOf(store.general().general.mail ?? {controller: mailController});
  const mailEnv = (): MailEnv => ({passwordSet: !!mailCfg.password, hostAllowed: mailCfg.hostAllowed, appUrl});
  /** Wysyłka działa: włączona w ustawieniach, bez `MAIL_OFF`, z kompletem ustawień i zgodą serwera aplikacji (G-19). */
  const mailEnabled = () => { const s = mailSettings(); return s.enabled && !mailCfg.off && !validateMail(s, mailEnv()).length; };
  const smtpOptions = (): SmtpOptions => {
    const s = mailSettings();
    return {host: s.host, port: s.port, security: s.security, user: s.user || undefined, password: s.user ? mailCfg.password : undefined,
      clientName: configured?.hostname ?? 'localhost', ca: mailCfg.ca, timeoutMs: 20000};
  };
  const sender = (): Sender | null => {
    if (!mailEnabled()) return null;
    const s = mailSettings();
    return {options: smtpOptions(), from: {name: s.fromName, address: s.fromAddress}, ...(s.replyTo ? {replyTo: {address: s.replyTo}} : {})};
  };
  const mailBase = (organ: Meeting['organ']): MailBase => ({appUrl: appUrl || 'http://localhost', settings: mailSettings(), organ: organOfCode(store.roster(), organ)});
  const senderOf = (a: Actor, m: Meeting): MailSender => isOfficeAccount(a) ? {office: mailOffice}
    : {name: a.name, func: organRoster(store.roster(), m).find(x => x.personId === a.personId)?.label ?? ''};
  const domainOf = () => (mailSettings().fromAddress.split('@')[1] || configured?.hostname || 'localhost');
  /** Wiadomości do kolejki: jedna na odbiorcę, tylko wiersze „wysle” z adresem (B2-P04). */
  function enqueueMail(kind: MailKind, m: Meeting | null, a: Actor, content: {subject: string; text: string; html: string}, intro: string, rows: {accountId: string; state: string}[]) {
    const byId = new Map(contacts().map(c => [c.accountId, c]));
    const list: Outgoing[] = rows.filter(r => r.state === 'wysle').map(r => byId.get(r.accountId)!).filter(c => c?.email)
      .map(c => ({accountId: c.accountId, to: {name: c.name, address: c.email!}, subject: content.subject, text: content.text, html: content.html}));
    const id = outbox.enqueue({kind, meetingId: m?.id ?? null, createdBy: a.account.id, actor: a.name, subject: content.subject, intro}, list, now(), domainOf());
    return {id, recipients: list.length};
  }
  /** Treść wiadomości o posiedzeniu (6.7.2) z jednej funkcji domeny dla podglądu i wysyłki. */
  function mailContent(kind: MailKind, m: Meeting, a: Actor, intro: string) {
    const base = mailBase(m.organ);
    if (kind === 'postep') return progressMail(m, progress(envFor(m), m, prepFor(m), a, now()), {...base, intro, sender: senderOf(a, m), now: now()});
    if (kind === 'po_posiedzeniu') {
      const env = envFor(m);
      const adopted = m.ballots.find(b => b.purpose === 'protokol' && b.protocolOf && b.announcedAt && b.result?.adopted && !b.aborted);
      const adoptedDay = adopted ? env.closedMeetings?.find(c => c.id === adopted.protocolOf)?.day ?? null : null;
      return afterMail(m, {...base, intro, sender: senderOf(a, m), acts: actBallots(m, env).length, adoptedDay});
    }
    if (kind === 'protokol') return minutesMail(m, base);
    return fail('Tej wiadomości nie wysyła się z posiedzenia.');
  }
  const codeHash = (salt: string, code: string) => createHash('sha256').update(`${salt}:${code}`).digest('hex');

  function meetingFor(id: string, actor: Actor) {
    const m = store.meeting(id);
    if (!m) fail('Nie znaleziono posiedzenia.', 404);
    if (!canView(store.roster(), m!, actor)) fail('Brak dostępu do tego posiedzenia.', 403);
    return m!;
  }
  // Wersja 3: w przygotowaniu materiały dodaje biuro, przewodniczący i wiceprzewodniczący (canPrepare), w trakcie obrad
  // biuro albo osoba prowadząca obrady; po zamknięciu nikt.
  function requireEditor(m: Meeting, actor: Actor, itemId?: string | null): 'pelny' | 'referent' {
    if (m.status === 'zakonczone') fail('Posiedzenie zostało zamknięte.');
    const allowed = m.status === 'przygotowanie' ? canPrepare(store.roster(), m, actor) : isOfficeAccount(actor) || isPresiding(m, actor);
    if (allowed) return 'pelny';
    // Wersja 4 (B2-W11): w przygotowaniu osoba referująca dodaje materiał i nową wersję do swojego punktu.
    if (m.status === 'przygotowanie' && itemId && isReferent(store.roster(), m, itemId, actor.personId)) return 'referent';
    return fail('Materiały dodaje biuro Izby albo osoba prowadząca obrady.', 403);
  }
  /** Wpisy historii zmian ustawień z kontem i osobą (rozdz. 2.8 pkt 1). */
  const auditEntry = (a: Actor, e: Pick<AuditEntry, 'area' | 'key' | 'label' | 'before' | 'after'> & {organ?: OrganCode; basis?: string}): Omit<AuditEntry, 'id'> =>
    ({at: now(), accountId: a.account.id, actor: a.name, ...e});
  const kindName: Record<Account['kind'], string> = {czlonek: 'Członek organu', doradczy: 'Głos doradczy', gosc: 'Gość', biuro: 'Biuro', komunikacja: 'Komunikacja'};
  const accountLabel = (row: UserRow) => row.person_id ? personName(store.roster(), row.person_id) : row.display_name;

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

  // F11: rodzaj materiału musi istnieć w słowniku i być włączony. Bez rodzaju aplikacja rozpoznaje go z tytułu.
  function materialType(raw: unknown, title: string): MaterialType {
    const types = store.docTypes(), wanted = typeof raw === 'string' ? raw.trim() : '';
    if (!wanted) {
      const guess = guessType(title);
      return types.some(t => t.id === guess && t.active) ? guess : types.some(t => t.id === 'inny') ? 'inny' : guess;
    }
    const found = types.find(t => t.id === wanted) ?? fail('Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
    if (!found.active) fail('Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.');
    return found.id;
  }
  /** Rodzaj rozpoznany z pliku: gdy nie ma go w słowniku, „inny”. */
  const knownType = (type: MaterialType) => store.docTypes().some(t => t.id === type) ? type : 'inny';

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
    return fail('Dodaj plik DOCX, PDF, TXT albo Markdown.');
  }
  // Wersja 4 (2.2, 5.6): `purpose` ('material', 'pokaz', 'zlozone', 'zgloszenie'), skrót SHA-256 i wynik kontroli PDF.
  async function saveFile(meetingId: string, upload: {buffer: Buffer | Uint8Array; name: string; mime: string}, purpose = 'material', checked = '') {
    const id = 'plik_' + randomUUID();
    await writeFile(join(dataDir, 'files', id), upload.buffer, {mode: 0o600, flag: 'wx'});
    db.prepare('INSERT INTO files(id,meeting_id,name,size,mime,created,purpose,checked,sha256) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, meetingId, upload.name.slice(0, 255), upload.buffer.length, upload.mime, now(), purpose, checked, sha256(upload.buffer));
    return id;
  }
  const pdfChecked = async (bytes: Uint8Array) => { const c = await checkPdf(bytes, {inflate: inflateAsync}); return c.ok ? `ok:${c.pages ?? ''}` : 'odmowa'; };

  // Pracownik poczty (5.4) co 15 s; usuwanie po terminie (DB-36) przy starcie i co 6 godzin; kontrola starych PDF w tle (K4-25).
  // Po zamknięciu serwera (i bazy) zaplanowane zadania w tle nic już nie robią.
  let stopped = false;
  const worker = setInterval(() => { if (!stopped) outbox.run(now(), sender()).catch(e => console.error('Błąd pracownika poczty:', (e as Error).message)); }, options.workerMs ?? 15000);
  worker.unref();
  function purge() {
    if (stopped) return;
    try {
      const t = now();
      write(() => {
        outbox.purge(t);
        db.prepare('DELETE FROM email_codes WHERE expires < ?').run(t);
        const {remove, update} = purgeOld(store.prepSpaces(), allMeetings(), t);
        for (const id of remove) store.deletePrep(id);
        for (const ws of update) store.savePrep(ws, t);
      });
      purgeAvatars(t);
    } catch (e) { console.error('Błąd usuwania danych po terminie:', (e as Error).message); }
  }
  const purger = setInterval(purge, options.purgeMs ?? 6 * 3600000);
  purger.unref();
  setImmediate(purge);
  let pdfTimer: ReturnType<typeof setTimeout> | null = null;
  const checkOldPdf = async () => {
    pdfTimer = null;
    if (stopped) return;
    const row = db.prepare("SELECT id FROM files WHERE purpose='material' AND mime='application/pdf' AND checked='' LIMIT 1").get() as {id: string} | undefined;
    if (!row) return;
    let result = 'odmowa';
    try { result = await pdfChecked(new Uint8Array(await readFile(join(dataDir, 'files', row.id)))); } catch { result = 'odmowa'; }
    if (stopped) return;
    try { db.prepare('UPDATE files SET checked=? WHERE id=?').run(result, row.id); } catch { return; }
    pdfTimer = setTimeout(checkOldPdf, options.pdfCheckMs ?? 200);
    pdfTimer.unref();
  };
  pdfTimer = setTimeout(checkOldPdf, options.pdfCheckMs ?? 1000);
  pdfTimer.unref();
  // Zdjęcia profilowe (DB-20, K4-30): od razu po blokadzie konta i 30 dni po wpisie zakończenia członkostwa w składzie.
  const avatarFile = (key: string, v: number) => join(dataDir, 'avatars', `${key.replace(/[^\w-]/g, '_')}-${v}.jpg`);
  const avatarKey = (row: Pick<UserRow, 'id' | 'person_id'>) => row.person_id ?? row.id;
  function dropAvatar(row: UserRow, removed: NonNullable<Account['avatarRemoved']> | null) {
    if (row.avatar) { try { unlinkSync(avatarFile(avatarKey(row), Number(row.avatar))); } catch { /* plik już usunięty */ } }
    store.setAvatar(row.id, 0, removed);
  }
  function purgeAvatars(t: number) {
    for (const row of store.users()) {
      if (!row.avatar) continue;
      if (row.disabled) { dropAvatar(row, {at: t, by: 'Aplikacja', cause: 'blokada'}); continue; }
      if (!row.person_id || store.roster().memberships.some(ms => ms.personId === row.person_id && LAW[ms.organ].available)) continue;
      const last = db.prepare("SELECT MAX(at) AS at FROM audit WHERE area='sklad' AND key=?").get(`osoba:${row.person_id}`) as {at: number | null} | undefined;
      if (last?.at && t - last.at > 30 * 86400000) dropAvatar(row, {at: t, by: 'Aplikacja', cause: 'koniec_czlonkostwa'});
    }
  }

  // Wersja 4: konta z adresem dla administratora (B2-P07), zależności eksportu dokumentów, pliki zgłoszeń, wydruk statystyk.
  const accountsForAdmin = () => store.users().map(u => ({...accountView(u), email: u.email || null, emailState: u.email ? u.email_state ?? 'niepotwierdzony' : 'brak',
    emailConfirmedAt: u.email_confirmed_at ?? null, emailConfirmedBy: u.email_confirmed_by || null}));
  const isChairmanNow = (a: Actor, m: Meeting) => !!a.personId && organRoster(store.roster(), m).some(x => x.personId === a.personId && x.func === 'przewodniczacy');
  function exportDeps(m: Meeting, a?: Actor): ExportDeps {
    const all = allMeetings();
    const adoptions = protocolAdoptions(all);
    const next = all.filter(x => x.organ === m.organ && x.kind === 'posiedzenie' && x.status === 'przygotowanie').sort((x, y) => x.date.localeCompare(y.date))[0] ?? null;
    // B1-22: wpisy historii ustawień o posiedzeniu (np. pobranie teczki) w dzienniku tylko u biura i przewodniczącego.
    const audit = a && (isOfficeAccount(a) || isChairmanNow(a, m))
      ? store.history({areas: ['posiedzenia'], limit: 200}).entries.filter(e => e.key.startsWith(`posiedzenie:${m.id}`)).map(e => ({at: e.at, by: e.actor, text: e.after}))
      : undefined;
    return {
      roster: store.roster(), accounts: accounts(), env: envFor(m), at: now(), look: minutesLook(), office: 'biuro Izby', audit,
      materialHtml: (id, v) => (db.prepare('SELECT html, hash FROM material_versions WHERE material_id=? AND version=?').get(id, v) as {html: string; hash: string} | undefined) ?? null,
      fileBytes: async fid => { if (!store.fileRow(fid, m.id)) return null; try { return new Uint8Array(await readFile(join(dataDir, 'files', fid))); } catch { return null; } },
      fileMeta: fid => { const row = store.fileRow(fid, m.id); return row ? {name: row.name, mime: row.mime} : null; },
      comms: {adoption: adoptions.get(m.id) ?? null, next},
    };
  }
  const attachmentOf = (meetingId: string, id: string) => {
    const row = store.fileRow(id, meetingId);
    return row && row.purpose === 'zgloszenie' ? {id: row.id, name: row.name, size: row.size} : null;
  };
  /** Wydruk „Moich statystyk” (6.3): linia źródła, liczby i posiedzenia po kolei z tych samych danych co ekran. */
  function statsBody(r: StatsResult): string {
    const p = r.persons[0];
    const lines = statsSourceLines(r, now()).map(l => `<p class="muted">${tx(l)}</p>`).join('');
    if (!p) return `<h1>${tx('Moje')} <b>${tx('statystyki')}</b></h1><p>${tx('W tym okresie nie zakończyło się żadne posiedzenie Prezydium.')}</p>${lines}`;
    const row = (label: string, value: string | number) => `<tr><th scope="row">${tx(label)}</th><td>${tx(String(value))}</td></tr>`;
    const facts = `<table class="facts">${row('Okres', `${dateDots(r.range.from)}–${dateDots(r.range.to)}`)}${row('Posiedzenia', p.meetings.held)}${row('Obecność przez całe obrady', p.meetings.cala)}${row('Obecność częściowa', p.meetings.czesciowa)}${row('Nieobecność', p.meetings.nieobecnosc)}${row('Głosowania na posiedzeniach, prawo głosu', p.sessionVotes.eligible)}${row('Głos oddany albo karta pobrana', p.sessionVotes.cast)}</table>`;
    const list = p.rows.map(x => `<tr><th scope="row">${tx(dateDots(x.day))}</th><td>${tx(x.title)}</td><td>${tx(x.attendance ? ({cala: 'obecność przez całe obrady', czesciowa: 'obecność częściowa', nieobecnosc: 'nieobecność'} as const)[x.attendance.kind] : '')}</td><td>${tx(String(x.ballots.filter(b => b.cast).length))} ${tx('z')} ${tx(String(x.ballots.filter(b => b.eligible).length))}</td></tr>`).join('');
    return `<h1>${tx('Moje')} <b>${tx('statystyki')}</b></h1><p>${tx(p.name)}</p>${facts}<div class="table-wrap" role="region" tabindex="0" aria-label="${tx('Posiedzenia po kolei')}"><table><thead><tr><th scope="col">${tx('Dzień')}</th><th scope="col">${tx('Posiedzenie')}</th><th scope="col">${tx('Obecność')}</th><th scope="col">${tx('Udział w głosowaniach')}</th></tr></thead><tbody>${list}</tbody></table></div>${lines}`;
  }
  let folderBusy = false;
  /** Odmowy dokumentów (4.5) dla osoby bez prawa do dokumentu. */
  function paperRefusal(m: Meeting, a: Actor, id: PaperId): never {
    if (id === 'komunikacja') return fail(m.status !== 'zakonczone' ? 'Materiał dla komunikacji powstaje po zamknięciu posiedzenia.' : 'Materiał dla komunikacji pobierają biuro, przewodniczący, wiceprzewodniczący, osoba, która zamknęła obrady, i konto komunikacji.', m.status !== 'zakonczone' ? 409 : 403);
    if (id === 'teczka' && m.status !== 'zakonczone') return fail('Teczkę posiedzenia można pobrać po zamknięciu posiedzenia.', 409);
    if (a.account.kind === 'doradczy' || a.account.kind === 'gosc') return fail('Ten dokument mają członkowie Prezydium i biuro.', 403);
    return fail(minutesRefusal, 403);
  }
  const roleCanAddDisplay = (m: Meeting, a: Actor) => canAddDisplay(store.roster(), m, a);
  /** Plik do pobrania (5.3): typ z białej listy według zapisanego rodzaju, `attachment` z `filename*`, bez pamięci podręcznej. */
  async function sendFile(res: ServerResponse, row: {id: string; name: string; mime: string}, how: 'attachment' | 'inline' = 'attachment') {
    const bytes = await readFile(join(dataDir, 'files', row.id));
    const safe = row.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 255);
    res.writeHead(200, {'Content-Type': FILE_TYPES.has(row.mime) ? row.mime : 'application/octet-stream', 'Content-Disposition': `${how}; filename*=UTF-8''${encodeURIComponent(safe)}`,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'});
    return res.end(bytes);
  }
  /** Plik wpisanego zgłoszenia trafia do materiałów punktu (B2-W04 pkt 3); treść przekonwertowana przed transakcją. */
  function attachProposalFile(m: Meeting, created: {attachmentId: string; itemId: string; title: string}, a: Actor, converted: {html: string; source: string; name: string; fileId: string} | null): Meeting {
    if (!converted || converted.fileId !== created.attachmentId) return m;
    const next = structuredClone(m);
    const ref = addMaterial(next, a, {title: created.title, type: materialType('', created.title), number: '', html: converted.html, source: converted.source, fileId: converted.fileId, fileName: converted.name});
    const it = next.agenda.find(i => i.id === created.itemId);
    if (it) it.materialIds = [...new Set([...it.materialIds, ref.id])];
    db.prepare("UPDATE files SET purpose='material' WHERE id=?").run(converted.fileId);
    return next;
  }
  const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

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
    res.setHeader('Content-Security-Policy', PAGE_CSP);
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
          if (b!.status !== 'otwarte') fail('Głosowanie zakończyło się, zanim głos dotarł. Głos nie został policzony.', 409);
          secret.record(b!.id, check.tokenHash, input.choice);
          store.saveMeeting(secretCast(m, b!.id, context()), now());
          return {ok: true};
        });
        return json(res, result);
      }

      const session = path.startsWith('/api/') ? sessionOf(req) : null;
      const actor = session?.actor ?? null;
      if (session?.refresh) res.setHeader('Set-Cookie', session.refresh);
      if (path === '/api/session' && method === 'GET') {
        const setupRequired = !store.hasUsers();
        // Wersja 3 (I-9): słownik rodzajów dla każdego zalogowanego; ustawienia ogólne dla biura, przewodniczącego
        // i wiceprzewodniczących (DA-4), dla pozostałych, także administratora bez roli biura, null.
        const access = actor ? settingsAccess(store.roster(), actor) : null;
        const base = {account: actor?.account ?? null, setupRequired, roster: actor || setupRequired ? store.roster() : null, version: VERSION,
          docTypes: actor ? sortedDocTypes(store.docTypes()) : null, general: access?.general ? store.general() : null};
        if (!actor) return json(res, base);
        // Wersja 4 (2.5): mapa zdjęć tylko dla kręgu z pytania 13 (bez adresów obrazów), tekst kręgu, strona startowa konta
        // „Komunikacja”, poczta dla osób, które wysyłają wiadomości, i pozycje nawigacji z role.ts. Bez adresów e-mail (DB-19).
        const roster = store.roster();
        const avatars = seesPhotos(roster, actor) ? Object.fromEntries(store.users().filter(u => u.avatar && !u.disabled).map(u => [avatarKey(u), {v: Number(u.avatar)}])) : null;
        const closed = allMeetings().filter(m => m.status === 'zakonczone');
        const prepares = canCreate(roster, 'prezydium', actor);
        return json(res, {...base, avatars, photoCircle: photoCircleText(roster), ...(isCommsAccount(actor) ? {home: '#odbyte'} : {}),
          ...(mayMail(roster, actor, prepares) ? {mail: {enabled: mailEnabled()}} : {}),
          can: {ownStats: canSeeOwnStats(roster, actor, closed), rosterStats: false, report: canReport(roster, actor), catalog: isCommsAccount(actor) || isOfficeAccount(actor) || !!actor.personId || actor.account.kind === 'doradczy' || actor.account.kind === 'gosc'}});
      }
      if (path === '/api/setup' && method === 'POST') {
        const input = await jsonBody(req, 10000);
        if (store.hasUsers()) fail('Administrator został już utworzony.', 409);
        if (!setupKey || hashToken(String(input.token ?? '').trim()) !== hashToken(setupKey)) fail('Kod pierwszego uruchomienia jest nieprawidłowy. Skopiuj go z pliku data/pierwsze-uruchomienie.txt.', 403);
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
        if (!row || row.disabled || !ok) { bucket.count++; attempts.set(key, bucket); fail('Login lub hasło są nieprawidłowe. Sprawdź oba pola. W haśle liczy się wielkość liter.', 401); }
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
        // Wersja 4 (4.4): konto „Komunikacja” ma tylko katalog, odnośniki do zdjęć, materiały dla komunikacji i „Moje konto”.
        if (isCommsAccount(a) && !/^\/api\/(me(\/.*)?|katalog|katalog\/[\w-]+\/(komunikacja\.md|komunikacja\.json|zdjecia)|avatars\/[\w-]+)$/.test(path)) fail(COMMS_REFUSAL, 403);

        // ---------------------------------------------------------------------------------------------------------------
        // Wersja 4 (SPEC-4 5.2): „Moje konto” (DB-19), poczta (5.4), katalog i zestawienie (B1), statystyki (B4), zdjęcia (B3).
        const noStore = {'Cache-Control': 'private, no-store'};
        if (path === '/api/me' && method === 'GET') {
          const row = store.user(a.account.id)!;
          const code = store.emailCode(a.account.id);
          return json(res, {email: row.email || null, emailState: row.email ? row.email_state : 'brak', emailConfirmedAt: row.email_confirmed_at ?? null,
            emailConfirmedBy: row.email_confirmed_by || null, pendingEmail: code && code.expires > now() ? code.address : null, prefs: prefsOf(row.prefs),
            avatar: Number(row.avatar) || 0, avatarScreen: !!row.avatar_screen, avatarRemoved: accountView(row).avatarRemoved ?? null, mailEnabled: mailEnabled()}, 200, noStore);
        }
        if (path === '/api/me/prefs' && method === 'PUT') {
          const input = await jsonBody(req, 10000);
          const prefs = prefsOf(store.user(a.account.id)!.prefs);
          for (const k of ['postep', 'po_posiedzeniu', 'showPresence'] as const) if (input?.[k] !== undefined) {
            if (typeof input[k] !== 'boolean') fail('Nieprawidłowe preferencje.');
            prefs[k] = input[k];
          }
          write(() => store.setPrefs(a.account.id, prefs));
          return json(res, {prefs}, 200, noStore);
        }
        if (path === '/api/me/email' && method === 'POST') {
          // G-21, G-37: kod 6 cyfr, ważny 30 minut, 5 prób, najwyżej 3 kody na godzinę; kod tylko przy włączonej poczcie.
          const input = await jsonBody(req, 10000);
          const email = String(input?.email ?? '').trim();
          const row = store.user(a.account.id)!;
          if (!email) {
            write(() => { store.setEmail(a.account.id, '', 'brak'); store.deleteEmailCode(a.account.id); });
            return json(res, {emailState: 'brak'}, 200, noStore);
          }
          if (!validAddress(email)) fail(ADDRESS_REFUSAL);
          const confirmed = row.email && row.email_state === 'potwierdzony';
          if (confirmed && row.email === email) return json(res, {emailState: 'potwierdzony'}, 200, noStore);
          const t = now();
          const previous = store.emailCode(a.account.id);
          const log = (() => { try { return (JSON.parse(previous?.sent_log ?? '[]') as number[]).filter(x => t - x < 3600000); } catch { return []; } })();
          if (!mailEnabled()) {
            // Adres można wpisać już teraz; potwierdzi go administrator albo kod, gdy poczta zacznie działać (6.2).
            if (!confirmed) write(() => store.setEmail(a.account.id, email, 'niepotwierdzony'));
            return json(res, {emailState: confirmed ? 'potwierdzony' : 'niepotwierdzony', codeSent: false, message: 'Poczta jest wyłączona, więc kodu nie da się wysłać. Adres może potwierdzić administrator.'}, 200, noStore);
          }
          if (log.length >= MAIL_LIMITS.codesPerHour) fail('Wysłano już 3 kody w ciągu godziny. Spróbuj później.', 429);
          const code = String(randomInt(0, 1000000)).padStart(6, '0'), salt = randomUUID();
          write(() => {
            if (!confirmed) store.setEmail(a.account.id, email, 'niepotwierdzony');
            store.saveEmailCode({accountId: a.account.id, address: email, hash: codeHash(salt, code), salt, expires: t + MAIL_LIMITS.codeMinutes * 60000, attempts: 0, sentLog: [...log, t]});
            const content = codeMail(code, mailBase('prezydium'));
            outbox.enqueue({kind: 'kod', meetingId: null, createdBy: a.account.id, actor: a.name, subject: content.subject, intro: ''},
              [{accountId: a.account.id, to: {name: a.name, address: email}, ...content}], t, domainOf());
          });
          return json(res, {emailState: confirmed ? 'potwierdzony' : 'niepotwierdzony', codeSent: true}, 200, noStore);
        }
        if (path === '/api/me/email/confirm' && method === 'POST') {
          const input = await jsonBody(req, 10000);
          const code = String(input?.code ?? '').replace(/\s+/g, '');
          const row = store.user(a.account.id)!;
          const c = store.emailCode(a.account.id);
          const t = now();
          if (!c || c.expires < t || c.attempts >= MAIL_LIMITS.codeAttempts) fail('Kod wygasł. Wyślij nowy kod.', 409);
          if (!/^\d{6}$/.test(code) || codeHash(c!.salt, code) !== c!.code_hash) {
            const left = MAIL_LIMITS.codeAttempts - c!.attempts - 1;
            write(() => db.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE account_id=?').run(a.account.id));
            if (left <= 0) fail('Kod wygasł. Wyślij nowy kod.', 409);
            fail(`Kod jest nieprawidłowy. ${plural(left, 'Została', 'Zostały', 'Zostało')} ${left} ${plural(left, 'próba', 'próby', 'prób')}.`);
          }
          const old = row.email && row.email_state === 'potwierdzony' && row.email !== c!.address ? row.email : null;
          write(() => {
            store.setEmail(a.account.id, c!.address, 'potwierdzony', {at: t, by: 'kod'});
            store.deleteEmailCode(a.account.id);
            if (old) {
              const content = addressChangedMail(t, mailBase('prezydium'));
              outbox.enqueue({kind: 'zmiana_adresu', meetingId: null, createdBy: a.account.id, actor: a.name, subject: content.subject, intro: ''},
                [{accountId: a.account.id, to: {name: a.name, address: old}, ...content}], t, domainOf());
            }
          });
          return json(res, {emailState: 'potwierdzony'}, 200, noStore);
        }
        if (path === '/api/me/avatar' && (method === 'PUT' || method === 'DELETE')) {
          const row = store.user(a.account.id)!;
          if (method === 'DELETE') {
            write(() => dropAvatar(row, null));
            return json(res, {account: accountView(store.user(a.account.id)!)}, 200, noStore);
          }
          // G-35, B3-33: tylko JPEG, kwadrat 256–1024 px, do 400 KB, pełna struktura, bez metadanych.
          if (!(req.headers['content-type'] || '').startsWith('image/jpeg')) fail('Zdjęcie musi być plikiem JPG.', 415);
          const bytes = new Uint8Array(await body(req, 400 * 1024 + 1));
          if (bytes.length > 400 * 1024) fail('Zdjęcie jest za duże. Wybierz je jeszcze raz, a aplikacja je zmniejszy.', 413);
          const cleaned = acceptAvatar(bytes);
          const version = (Number(row.avatar) || 0) + 1;
          await writeFile(avatarFile(avatarKey(row), version), cleaned.bytes, {mode: 0o600, flag: 'wx'});
          write(() => {
            if (row.avatar) { try { unlinkSync(avatarFile(avatarKey(row), Number(row.avatar))); } catch { /* brak pliku */ } }
            store.setAvatar(row.id, version);
          });
          return json(res, {account: accountView(store.user(a.account.id)!)}, 200, noStore);
        }
        const avatarMatch = path.match(/^\/api\/avatars\/([\w-]+)$/);
        if (avatarMatch && method === 'GET') {
          const key = avatarMatch[1];
          const own = (a.personId ?? a.account.id) === key;
          if (!own && !seesPhotos(store.roster(), a)) fail(`To zdjęcie widzą ${photoCircleText(store.roster())}.`, 403);
          const row = store.users().find(u => avatarKey(u) === key && u.avatar && !u.disabled);
          if (!row) fail('Nie znaleziono zdjęcia.', 404);
          const bytes = await readFile(avatarFile(key, Number(row!.avatar)));
          res.writeHead(200, {'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'private, max-age=604800, immutable', 'Content-Length': String(bytes.length)});
          return res.end(bytes);
        }
        const accountAvatar = path.match(/^\/api\/accounts\/([\w-]+)\/avatar$/);
        if (accountAvatar && method === 'DELETE') {
          if (!a.account.admin) fail('Cudze zdjęcie usuwa administrator.', 403);
          const target = store.user(accountAvatar[1]) ?? fail('Nie znaleziono konta.', 404);
          const input = (req.headers['content-type'] || '').startsWith('application/json') ? await jsonBody(req, 10000) : {};
          const reason = String(input?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
          write(() => {
            dropAvatar(target, {at: now(), by: a.name, ...(reason ? {reason} : {}), cause: 'administrator'});
            store.audit([auditEntry(a, {area: 'konta', key: `konto:${target.id}:zdjecie`, label: `Konto ${accountLabel(target)}`, before: 'zdjęcie', after: `Usunięto zdjęcie profilowe konta ${accountLabel(target)}.`, ...(reason ? {basis: reason} : {})})]);
          });
          return json(res, {accounts: accountsForAdmin()});
        }

        if (path.startsWith('/api/mail/')) {
          const access = settingsAccess(store.roster(), a);
          if (path === '/api/mail/state' && method === 'GET') {
            if (!access.general) fail('Ustawienia poczty widzą biuro, przewodniczący i wiceprzewodniczący.', 403);
            const s = mailSettings();
            return json(res, {enabled: s.enabled && !mailCfg.off, off: mailCfg.off, passwordSet: !!mailCfg.password, hostAllowed: mailCfg.hostAllowed, appUrl, paused: outbox.paused, lastSentAt: outbox.lastSentAt(),
              problems: validateMail({...s, enabled: true}, mailEnv())}, 200, noStore);
          }
          if (path === '/api/mail/log' && method === 'GET') {
            if (!isOfficeAccount(a) && !a.account.admin) fail('Dziennik wysyłek widzi biuro.', 403);
            const before = Number(url.searchParams.get('before')) || undefined;
            const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
            const list = outbox.batches({before, limit});
            const withAddress = !!a.account.admin;
            const batches = list.slice(0, limit).map(b => ({...b, messages: outbox.rows(b.id).map(r => ({id: r.id, accountId: r.account_id, name: r.to_name, status: r.status, attempts: r.attempts,
              nextAt: r.next_at, sentAt: r.sent_at, error: r.last_error, purged: !!r.purged, ...(withAddress ? {address: r.to_address} : {})}))}));
            return json(res, {batches, next: list.length > limit ? batches.at(-1)!.created : null}, 200, noStore);
          }
          if (!isOfficeAccount(a)) fail('Ustawienia poczty zmienia biuro.', 403);
          if (path === '/api/mail/resume' && method === 'POST') { write(() => outbox.resume()); return json(res, {paused: null}, 200, noStore); }
          const msg = path.match(/^\/api\/mail\/messages\/([\w-]+)\/(retry|cancel)$/);
          if (msg && method === 'POST') {
            const row = write(() => msg[2] === 'retry' ? outbox.retry(msg[1], now()) : outbox.cancel(msg[1]));
            return json(res, {message: {id: row.id, status: row.status, attempts: row.attempts, nextAt: row.next_at, error: row.last_error}}, 200, noStore);
          }
          if (path === '/api/mail/test' && method === 'POST') {
            // B2-P13: wiadomość próbna bez kolejki, także przy wyłączonej wysyłce; 10 na godzinę na konto; serwer z SMTP_HOST_ALLOWED.
            const input = await jsonBody(req, 10000);
            const to = String(input?.to ?? '').trim();
            if (!validAddress(to)) fail(ADDRESS_REFUSAL);
            const t = now();
            const recent = Number((db.prepare("SELECT COUNT(*) AS n FROM mail_batches WHERE kind='proba' AND created_by=? AND created>?").get(a.account.id, t - 3600000) as {n: number}).n);
            if (recent >= MAIL_LIMITS.testsPerHour) fail('Wysłano już 10 wiadomości próbnych w ciągu godziny. Spróbuj później.', 429);
            const s = mailSettings();
            const problems: string[] = [];
            if (!hostMatches(s.host, mailCfg.hostAllowed)) problems.push('Serwer poczty nie jest zgodny z ustawieniem serwera aplikacji (SMTP_HOST_ALLOWED). Aplikacja nie łączy się z innym serwerem.');
            if (!s.fromAddress || !validAddress(s.fromAddress)) problems.push(ADDRESS_REFUSAL);
            if (s.user && !mailCfg.password) problems.push('Brakuje hasła na serwerze aplikacji.');
            const content = testMail({...mailBase('prezydium'), at: t});
            let steps: {name: string; ok: boolean; text: string}[];
            let ok = false;
            if (problems.length) steps = [{name: 'Połączenie', ok: false, text: problems[0]}, {name: 'Szyfrowanie', ok: false, text: 'Pominięto'}, {name: 'Logowanie', ok: false, text: 'Pominięto'}, {name: 'Wysłanie', ok: false, text: 'Pominięto'}];
            else {
              const {raw} = buildMessage({from: {name: s.fromName, address: s.fromAddress}, to: {address: to}, ...(s.replyTo ? {replyTo: {address: s.replyTo}} : {}), ...content, headers: [['X-Posiedzenia-Wysylka', 'proba']]}, new Date(t));
              const result = await sendOne(smtpOptions(), {from: s.fromAddress, to, raw});
              steps = ['Połączenie', 'Szyfrowanie', 'Logowanie', 'Wysłanie'].map(name => {
                const st = result.steps.find(x => x.step === name);
                return st ? {name, ok: st.ok, text: st.detail} : {name, ok: false, text: name === 'Logowanie' && !s.user && !result.error ? 'Bez logowania (przekaźnik).' : 'Pominięto'};
              });
              ok = !result.error;
            }
            write(() => outbox.enqueue({kind: 'proba', meetingId: null, createdBy: a.account.id, actor: a.name, subject: content.subject, intro: ''},
              [{accountId: a.account.id, to: {address: to}, ...content}], t, domainOf(), ok ? 'wyslana' : 'blad', ok ? '' : steps.find(x => !x.ok)?.text ?? ''));
            return json(res, {steps, ok}, 200, noStore);
          }
        }

        // Katalog odbytych posiedzeń, materiał dla komunikacji i odnośnik do zdjęć (B1-24–B1-29, 5.2).
        const catalogFilter = (): CatalogFilter => ({
          rok: url.searchParams.get('rok') || undefined, kadencja: url.searchParams.get('kadencja') || undefined,
          rodzaj: (url.searchParams.get('rodzaj') || undefined) as CatalogFilter['rodzaj'], stan: (url.searchParams.get('stan') || undefined) as CatalogFilter['stan'],
          brak: url.searchParams.get('brak') === '1', q: (url.searchParams.get('q') || '').slice(0, 100),
        });
        if ((path === '/api/katalog' || path === '/api/katalog.csv') && method === 'GET') {
          const all = allMeetings();
          const env = {roster: store.roster(), docTypes: store.docTypes()};
          const rows = catalogRows(all, env, a, catalogFilter(), {today: isoDayOf(now()), adoptions: protocolAdoptions(all)});
          if (path === '/api/katalog.csv') {
            const name = `${isoDayOf(now())}-katalog-posiedzen.csv`;
            res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(name), ...noStore});
            return res.end(catalogCsv(rows, a));
          }
          const etag = `"${VERSION}-${store.archiveRevision()}-${store.revision()}-${isoDayOf(now())}-${a.account.id}"`;
          if (req.headers['if-none-match'] === etag) { res.writeHead(304, {'ETag': etag, 'Cache-Control': 'private, no-cache'}); return res.end(); }
          return json(res, {rows}, 200, {'ETag': etag, 'Cache-Control': 'private, no-cache'});
        }
        const cat = path.match(/^\/api\/katalog\/([\w-]+)\/(komunikacja\.md|komunikacja\.json|zdjecia)$/);
        if (cat) {
          const m = store.meeting(cat[1]) ?? fail('Nie znaleziono posiedzenia.', 404);
          if (!canSeeCatalog(store.roster(), m, a)) fail(isCommsAccount(a) ? COMMS_REFUSAL : 'Brak dostępu do tego posiedzenia.', 403);
          if (cat[2] === 'zdjecia' && method === 'POST') {
            const input = await jsonBody(req, 10000);
            const next = write(() => {
              const cur = store.meeting(m.id)!;
              const updated = isCommsAccount(a) ? setPhotos(cur, String(input?.url ?? ''), a, context(), !!input?.confirm) : apply(cur, {type: 'photos_set', url: String(input?.url ?? ''), confirm: !!input?.confirm}, a, context());
              if (updated.revision !== cur.revision) store.saveMeeting(updated, now());
              return updated;
            });
            const all = allMeetings();
            const row = catalogRows(all, {roster: store.roster(), docTypes: store.docTypes()}, a, {}, {today: isoDayOf(now())}).find(r => r.id === next.id) ?? null;
            return json(res, {row});
          }
          if (method !== 'GET') fail('Niedozwolona metoda.', 405);
          if (m.status !== 'zakonczone') fail('Materiał dla komunikacji powstaje po zamknięciu posiedzenia.', 409);
          if (!canDownloadComms(store.roster(), m, a)) {
            if (isCommsAccount(a)) fail('Materiał dla komunikacji czeka na udostępnienie przez biuro albo przewodniczącego.', 409);
            fail('Materiał dla komunikacji pobierają biuro, przewodniczący, wiceprzewodniczący, osoba, która zamknęła obrady, i konto komunikacji.', 403);
          }
          const file = await paperFile('komunikacja', 'md', m, a, exportDeps(m));
          if (cat[2] === 'komunikacja.json') {
            const info = archiveInfo(m, allMeetings(), a, store.roster(), isoDayOf(now()));
            return json(res, {text: file.data, changedAt: info?.commsChangedAt ?? null, release: info?.commsRelease ?? null}, 200, noStore);
          }
          res.writeHead(200, {'Content-Type': file.type, 'Content-Disposition': disposition(file.name), 'X-Content-Type-Options': 'nosniff', ...noStore});
          return res.end(file.data);
        }
        if (path === '/api/zestawienie' && method === 'GET') {
          if (!canReport(store.roster(), a)) fail('Zestawienie przygotowują biuro, przewodniczący, wiceprzewodniczący i sekretarz.', 403);
          const period = periodInput(url.searchParams.get('od'), url.searchParams.get('do'));
          if ('error' in period) fail(period.error);
          const organ: OrganCode = 'prezydium';
          const env = cascadeEnv({roster: store.roster(), bundle: store.general(), organ, accounts: accounts(), law: LAW});
          const r = periodReport(allMeetings(), env, period as {from: string; to: string}, {at: now(), today: isoDayOf(now())});
          const format = url.searchParams.get('format') || 'html';
          const base = `${isoDayOf(now())}-zestawienie-${(period as {from: string}).from}-${(period as {to: string}).to}`;
          if (format === 'csv') {
            const part = url.searchParams.get('czesc') === 'akty' ? 'akty' : 'posiedzenia';
            res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(`${base}-${part}.csv`), 'X-Content-Type-Options': 'nosniff', ...noStore});
            return res.end(periodReportCsv(r, part));
          }
          if (format !== 'html') fail('Ten dokument nie ma takiego formatu.');
          const html = paperPage(periodReportHtml(r, store.roster()), {title: 'Zestawienie za okres', header: 'Zestawienie za okres', draft: false, generatedAt: now(), css: minutesLook().css ?? null,
            links: [{href: `/api/zestawienie?od=${(period as {from: string}).from}&do=${(period as {to: string}).to}&format=csv&czesc=posiedzenia`, label: 'CSV', name: 'Pobierz posiedzenia w formacie CSV'},
              {href: `/api/zestawienie?od=${(period as {from: string}).from}&do=${(period as {to: string}).to}&format=csv&czesc=akty`, label: 'CSV akty', name: 'Pobierz akty w formacie CSV'}]});
          res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disposition(`${base}.html`, true), ...noStore});
          return res.end(html);
        }
        if (path === '/api/statystyki/moje' && method === 'GET') {
          // B4, DB-22, T-6: tylko osoba sesji (parametr osoby jest ignorowany), z posiedzeń zakończonych.
          const roster = store.roster();
          const all = allMeetings();
          if (!canSeeOwnStats(roster, a, all)) fail('Statystyki mają członkowie Prezydium.', 403);
          const q = statsRangeInput({od: url.searchParams.get('od'), do: url.searchParams.get('do'), kadencja: url.searchParams.get('kadencja'), rok: url.searchParams.get('rok')}, isoDayOf(now()));
          if ('error' in q) fail(q.error);
          const since = organSettingsOf(store.general().general, 'prezydium').statsSince;
          const r = memberStats({meetings: all, roster, range: (q as {range: {from: string; to: string}}).range, self: a.personId, only: [a.personId!], ...(since ? {since} : {}), ...((q as {term?: string}).term ? {term: (q as {term?: string}).term} : {})});
          const format = url.searchParams.get('format') || 'json';
          if (format === 'csv') {
            res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': disposition(`${isoDayOf(now())}-moje-statystyki.csv`), 'X-Content-Type-Options': 'nosniff', ...noStore});
            return res.end(statsCsv(r, 'moje', now()));
          }
          if (format === 'html') {
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': disposition(`${isoDayOf(now())}-moje-statystyki.html`, true), ...noStore});
            return res.end(paperPage(statsBody(r), {title: 'Moje statystyki', header: 'Moje statystyki', draft: false, generatedAt: now(), css: minutesLook().css ?? null}));
          }
          return json(res, {stats: r, source: statsSourceLines(r, now()), generatedAt: now()}, 200, noStore);
        }
        if (path.startsWith('/api/statystyki/')) fail('Statystyki składu dochodzą z dodatkiem.', 404);
        const organWaiting = path.match(/^\/api\/organs\/(prezydium|rada|zjazd)\/czekajace$/);
        if (organWaiting) {
          // B2-W06: zgłoszenia czekające na posiedzenie organu; zgłasza członek albo głos doradczy, całość widzą osoby przygotowujące.
          const organ = organWaiting[1] as OrganCode;
          if (!canSeeWorkspace(store.roster(), {organ}, a)) fail(PREP_REFUSALS.see, 403);
          const full = canCreate(store.roster(), organ, a);
          if (method === 'POST') {
            const input = await jsonBody(req, 20000);
            const ws = write(() => {
              const next = applyWaiting(waitingFor(organ), input?.cmd as PrepCommand, a, {...context(), attachment: id => attachmentOf(waitingId(organ), id)});
              store.savePrep(next, now());
              return next;
            });
            return json(res, {prep: full ? ws : {...ws, proposals: ws.proposals.filter(p => p.accountId === a.account.id), comments: [], events: []}});
          }
          if (method === 'GET') {
            const ws = waitingFor(organ);
            return json(res, {prep: full ? ws : {...ws, proposals: ws.proposals.filter(p => p.accountId === a.account.id), comments: [], events: []}}, 200, noStore);
          }
        }

        if (path === '/api/accounts') {
          if (!a.account.admin) fail('Ta czynność wymaga uprawnień administratora.', 403);
          if (method === 'GET') return json(res, {accounts: accountsForAdmin()});
          const input = await jsonBody(req, 10000);
          if (method === 'POST') {
            const username = validUsername(input.username), password = await passwordHash(validPassword(input.password));
            const kind = input.kind as Account['kind'];
            if (!['czlonek', 'doradczy', 'gosc', 'biuro', 'komunikacja'].includes(kind)) fail('Wybierz rodzaj konta.');
            if (kind === 'komunikacja' && input.admin) fail('Konto komunikacji nie ma uprawnień administratora.');
            let personId: string | null = null, displayName = String(input.displayName ?? '').trim().slice(0, 100);
            if (kind === 'czlonek') {
              personId = String(input.personId ?? '');
              if (!store.roster().persons.some(p => p.id === personId)) fail('Wybierz osobę ze składu.');
              displayName = personName(store.roster(), personId);
            } else if (displayName.length < 3) fail('Podaj imię i nazwisko albo nazwę konta.');
            if (store.userByName(username)) fail('Ten login jest już zajęty. Wpisz inny login.', 409);
            if (personId && db.prepare('SELECT 1 FROM users WHERE person_id=?').get(personId)) fail('Ta osoba ma już konto.', 409);
            const newId = randomUUID();
            write(() => {
              db.prepare('INSERT INTO users(id,username,password,kind,person_id,display_name,label,admin,must_change,created) VALUES (?,?,?,?,?,?,?,?,1,?)')
                .run(newId, username, password, kind, personId, displayName, String(input.label ?? '').slice(0, 120), input.admin ? 1 : 0, now());
              store.audit([auditEntry(a, {area: 'konta', key: `konto:${newId}`, label: `Konto ${displayName}`, before: 'brak', after: `${kindName[kind]}${input.admin ? ', administrator' : ''}, login ${username}`})]);
              // DA-5: osoba z głosem doradczym jest zaproszona na każde posiedzenie w przygotowaniu.
              if (kind === 'doradczy') {
                for (const mid of store.meetingIds()) {
                  const m = store.meeting(mid);
                  if (!m || m.status !== 'przygotowanie' || m.invited.includes(newId)) continue;
                  const next = structuredClone(m);
                  next.invited.push(newId);
                  next.log.push({at: now(), text: 'Dodano osoby z głosem doradczym zawiadamiane o każdym posiedzeniu (§ 7 ust. 2).', by: a.name, accountId: a.account.id, tag: 'ustawienia'});
                  next.revision++;
                  store.saveMeeting(next, now());
                }
              }
            });
            return json(res, {accounts: accountsForAdmin()}, 201);
          }
          if (method === 'PATCH') {
            const target = store.user(String(input.id)) ?? fail('Nie znaleziono konta.', 404);
            if (target.id === a.account.id && (input.disabled !== undefined || input.admin !== undefined)) fail('Nie można zablokować własnego konta ani odebrać sobie uprawnień.');
            const password = input.password ? await passwordHash(validPassword(input.password)) : null;
            write(() => {
              const label = `Konto ${accountLabel(target)}`;
              const entries: Omit<AuditEntry, 'id'>[] = [];
              if (typeof input.disabled === 'boolean' && !!target.disabled !== input.disabled) {
                db.prepare('UPDATE users SET disabled=? WHERE id=?').run(input.disabled ? 1 : 0, target.id);
                entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:blokada`, label, before: target.disabled ? 'zablokowane' : 'aktywne', after: input.disabled ? 'zablokowane' : 'aktywne'}));
              }
              if (typeof input.admin === 'boolean' && !!target.admin !== input.admin) {
                db.prepare('UPDATE users SET admin=? WHERE id=?').run(input.admin ? 1 : 0, target.id);
                entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:administrator`, label, before: target.admin ? 'administrator' : 'bez uprawnień administratora', after: input.admin ? 'administrator' : 'bez uprawnień administratora'}));
              }
              if (typeof input.label === 'string' && input.label.slice(0, 120) !== target.label) {
                db.prepare('UPDATE users SET label=? WHERE id=?').run(input.label.slice(0, 120), target.id);
                entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:opis`, label, before: target.label || 'brak', after: input.label.slice(0, 120) || 'brak'}));
              }
              if (password) {
                db.prepare('UPDATE users SET password=?, must_change=1 WHERE id=?').run(password, target.id);
                // Hasło nie trafia do historii, tylko fakt nadania (rozdz. 2.8 pkt 1).
                entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:haslo`, label, before: '–', after: 'Nadano nowe hasło tymczasowe.'}));
                // DA-14: nowe hasło tymczasowe członka w trakcie posiedzenia jego organu trafia do dziennika tego posiedzenia.
                if (target.person_id) {
                  for (const mid of store.liveMeetingIds()) {
                    const m = store.meeting(mid);
                    if (!m || !store.roster().memberships.some(ms => ms.organ === m.organ && ms.personId === target.person_id) && !m.frozen?.members.some(f => f.personId === target.person_id)) continue;
                    const next = structuredClone(m);
                    next.log.push({at: now(), text: `O godz. ${timeOf(now())} administrator nadał nowe hasło tymczasowe kontu ${accountLabel(target)}.`, by: a.name, accountId: a.account.id});
                    next.revision++;
                    store.saveMeeting(next, now());
                  }
                }
              }
              // Wersja 4 (B2-P07, G-21): adres konta wpisuje też administrator; „Potwierdzony przez administratora” z wpisem w historii.
              if (input.email !== undefined) {
                const email = String(input.email ?? '').trim();
                if (email && !validAddress(email)) fail(ADDRESS_REFUSAL);
                if (email !== (target.email ?? '')) {
                  store.setEmail(target.id, email, 'niepotwierdzony');
                  entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:email`, label, before: target.email ? 'adres wpisany' : 'brak adresu', after: email ? 'adres zmieniony przez administratora' : 'brak adresu'}));
                }
              }
              if (typeof input.emailConfirmed === 'boolean') {
                const row = store.user(target.id)!;
                if (input.emailConfirmed && !row.email) fail('Najpierw wpisz adres e-mail.');
                if (row.email && input.emailConfirmed !== (row.email_state === 'potwierdzony')) {
                  store.setEmail(target.id, row.email, input.emailConfirmed ? 'potwierdzony' : 'niepotwierdzony', input.emailConfirmed ? {at: now(), by: 'administrator'} : undefined);
                  entries.push(auditEntry(a, {area: 'konta', key: `konto:${target.id}:email`, label, before: row.email_state === 'potwierdzony' ? 'adres potwierdzony' : 'adres niepotwierdzony', after: input.emailConfirmed ? 'Adres potwierdzony przez administratora.' : 'adres niepotwierdzony'}));
                }
              }
              // DB-20, K4-30: blokada konta usuwa zdjęcie profilowe od razu.
              if (input.disabled === true && target.avatar) dropAvatar(store.user(target.id)!, {at: now(), by: a.name, cause: 'blokada'});
              if (password || input.disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
              if (entries.length) store.audit(entries);
            });
            return json(res, {accounts: accountsForAdmin()});
          }
        }

        // F11, wersja 3: słownik rodzajów dokumentów. Czyta każdy zalogowany, zmienia biuro (dawniej administrator).
        // Formy aktów z regulaminu zawsze wymagają głosowania (G-1). Każda zmiana trafia do historii i podnosi rewizję.
        const docTypeAudit = (a: Actor, before: DocType | undefined, after: DocType | undefined) => docTypeAuditEntry(a, now(), before, after);
        const docTypesResult = () => ({docTypes: sortedDocTypes(store.docTypes()), general: store.general()});
        if (path === '/api/doc-types') {
          if (method === 'GET') return json(res, {docTypes: sortedDocTypes(store.docTypes())});
          if (method === 'POST') {
            if (!isOfficeAccount(a)) fail('Rodzaje dokumentów zmienia biuro.', 403);
            const input = await jsonBody(req, 10000);
            write(() => {
              const t = docTypeInput(input ?? {}, store.docTypes(), undefined, LAW.prezydium);
              store.saveDocType(t);
              store.audit([docTypeAudit(a, undefined, t)]);
              store.bumpRevision();
            });
            return json(res, docTypesResult(), 201);
          }
        }
        const dt = path.match(/^\/api\/doc-types\/([a-z0-9_]{1,40})$/);
        if (dt && (method === 'PUT' || method === 'DELETE')) {
          if (!isOfficeAccount(a)) fail('Rodzaje dokumentów zmienia biuro.', 403);
          const current = store.docTypes().find(t => t.id === dt[1]) ?? fail('Nie znaleziono rodzaju dokumentu.', 404);
          if (method === 'PUT') {
            const input = await jsonBody(req, 10000);
            write(() => {
              const t = docTypeInput(input ?? {}, store.docTypes(), current, LAW.prezydium);
              if (JSON.stringify(t) === JSON.stringify(current)) return;
              store.saveDocType(t);
              store.audit([docTypeAudit(a, current, t)]);
              store.bumpRevision();
            });
          } else {
            if (isLockedDocType(current.id, LAW.prezydium)) fail(lockedDocTypeRefusal(current.id, LAW.prezydium));
            if (store.docTypeUsed(current.id)) fail('Ten rodzaj jest już użyty w materiale, punkcie albo głosowaniu. Możesz go tylko wyłączyć.', 409);
            write(() => { store.deleteDocType(current.id); store.audit([docTypeAudit(a, current, undefined)]); store.bumpRevision(); });
          }
          return json(res, docTypesResult());
        }

        // Wersja 3: ustawienia ogólne (biuro), skład z podstawą (biuro) i historia zmian (DA-4, DA-2).
        if (path === '/api/settings' && method === 'POST') {
          const input = await jsonBody(req, 200000);
          // Wersja 4 (G-40): dzień startu statystyk późniejszy niż najwcześniejsze policzone posiedzenie wpisuje przewodniczący.
          const statsChange = input?.change?.area === 'organ' && input?.change?.key === 'statsSince';
          if (!isOfficeAccount(a) && !(statsChange && settingsAccess(store.roster(), a).general)) fail('Ustawienia ogólne zmienia biuro.', 403);
          const firstCounted = (organ: OrganCode, since: string | null) => allMeetings().filter(m => m.organ === organ && m.status === 'zakonczone')
            .map(m => m.openedAt ? isoDayOf(m.openedAt) : m.date).filter(d => !since || d >= since).sort()[0] ?? null;
          const result = write(() => {
            const organ = (input?.change?.organ ?? 'prezydium') as OrganCode;
            const {bundle, audit} = applySettingsChange(store.general(), input?.change as SettingsChange, {actor: a, now: now(), roster: store.roster(), mail: mailEnv(),
              statsSince: (from, to) => canSetStatsSince(store.roster(), a, from, to, firstCounted(organ, from))});
            if (!audit.length) return {general: store.general(), entries: [] as AuditEntry[]};
            store.saveGeneral(bundle.general);
            const entries = store.audit(audit);
            store.bumpRevision();
            return {general: store.general(), entries};
          });
          return json(res, result);
        }
        if (path === '/api/composition' && method === 'POST') {
          if (!isOfficeAccount(a)) fail('Skład organu wpisuje biuro.', 403);
          const input = await jsonBody(req, 20000);
          const result = write(() => {
            const organ = (input?.organ ?? 'prezydium') as OrganCode;
            const settings = organSettingsOf(store.general().general, organ);
            const change = applyCompositionChange(store.roster(), settings, input, {actor: a, now: now(), today: isoDayOf(now()), newId: randomUUID});
            store.saveComposition(change.roster, organ, change.settings);
            const entries = store.audit(change.audit);
            store.bumpRevision();
            return {roster: store.roster(), general: store.general(), entries};
          });
          return json(res, result);
        }
        if (path === '/api/settings/history' && method === 'GET') {
          const access = settingsAccess(store.roster(), a);
          const area = (url.searchParams.get('area') || undefined) as SettingsArea | undefined;
          const all: SettingsArea[] = ['siedziba', 'organ', 'wzory', 'rodzaje_dokumentow', 'rodzaje_spraw', 'sklad', 'konta', 'posiedzenia', 'poczta'];
          // Biuro, przewodniczący i wiceprzewodniczący widzą historię bez kont; administrator tylko konta.
          const allowed = all.filter(x => x === 'konta' ? access.accounts : !!access.general);
          if (!allowed.length || (area && !allowed.includes(area))) fail('Brak dostępu do tej historii zmian.', 403);
          const before = Number(url.searchParams.get('before')) || undefined;
          const limit = Number(url.searchParams.get('limit')) || 50;
          return json(res, store.history({areas: area ? [area] : allowed, accountId: url.searchParams.get('accountId') || undefined, before, limit}));
        }

        if (path === '/api/people' && method === 'GET') {
          // Lista kont potrzebna organizatorowi do zaproszeń (głos doradczy, goście).
          // Wersja 3: biuro, przewodniczący i wiceprzewodniczący (przygotowanie) oraz osoba prowadząca obrady; administrator sam nie.
          const presiding = !!a.personId && store.liveMeetingIds().some(id => store.meeting(id)?.chair.current === a.personId);
          const organizer = canCreate(store.roster(), 'prezydium', a) || presiding;
          return json(res, {accounts: organizer ? accounts().filter(x => !x.disabled).map(x => ({id: x.id, displayName: x.displayName, label: x.label, kind: x.kind, personId: x.personId})) : []});
        }

        if (path === '/api/meetings' && method === 'GET') {
          const roster = store.roster();
          const list = store.meetingIds().map(id => store.meeting(id)!).filter(m => m && canView(roster, m, a)).map(summary);
          return json(res, {meetings: list});
        }
        if (path === '/api/meetings' && method === 'POST') {
          const input = await jsonBody(req, 10000);
          // Wersja 3: posiedzenie ze wzoru posiedzenia i ustawień ogólnych (wspólna funkcja domeny, także w wersji próbnej).
          const draft = newMeetingFromSettings({
            id: randomUUID(), kind: input.kind === 'procedura' ? 'procedura' : 'posiedzenie', organ: input.organ, template: input.template ? String(input.template) : undefined,
            title: input.title ? String(input.title) : undefined, date: input.date, time: input.time, place: input.place === undefined ? undefined : String(input.place),
            mode: input.mode, endsAt: Number(input.endsAt) || undefined, actor: a,
          }, context());
          write(() => {
            store.saveMeeting(draft, now());
            // B2-W06: nowe posiedzenie przejmuje zgłoszenia czekające organu.
            const moved = carryOver(waitingFor(draft.organ), null, draft);
            if (moved.ws.proposals.length) { store.savePrep(moved.ws, now()); store.savePrep(moved.waiting, now()); }
          });
          return json(res, {meeting: view(draft, a)}, 201);
        }

        const mm = path.match(/^\/api\/meetings\/([\w-]+)(\/.*)?$/);
        if (mm) {
          const id = mm[1], rest = mm[2] ?? '';
          if (rest === '' && method === 'GET') {
            const m = meetingFor(id, a);
            // ETag (2.4): w statusach „trwa” i „przerwa” format wersji 3 (T-5); w przygotowaniu dochodzą licznik katalogu,
            // rewizja przestrzeni roboczej i dzień, po zamknięciu licznik katalogu i dzień (DB-5, K4-24).
            const day = isoDayOf(now());
            const etag = m.status === 'trwa' || m.status === 'przerwa' ? `"${VERSION}-${m.revision}-${store.revision()}-${a.account.id}"`
              : m.status === 'przygotowanie' ? `"${VERSION}-${m.revision}-${store.revision()}-${store.archiveRevision()}-${prepFor(m).revision}-${day}-${a.account.id}"`
              : `"${VERSION}-${m.revision}-${store.revision()}-${store.archiveRevision()}-${day}-${a.account.id}"`;
            if (req.headers['if-none-match'] === etag) { res.writeHead(304, {'ETag': etag, 'X-Server-Now': String(now()), 'Cache-Control': 'private, no-cache'}); return res.end(); }
            return json(res, {meeting: view(m, a)}, 200, {'ETag': etag, 'Cache-Control': 'private, no-cache'});
          }
          if (rest === '' && method === 'DELETE') {
            const m = meetingFor(id, a);
            if (!canCreate(store.roster(), m.organ, a) || m.status !== 'przygotowanie') fail('Usunąć można tylko nierozpoczęte posiedzenie. Usuwa je biuro Izby, przewodniczący albo wiceprzewodniczący.', 403);
            write(() => {
              store.deleteMeeting(id);
              store.deletePrep(id);
              store.audit([auditEntry(a, {area: 'posiedzenia', organ: m.organ, key: `posiedzenie:${m.id}`, label: `${m.kind === 'procedura' ? 'Głosowanie między posiedzeniami' : 'Posiedzenie'} „${m.title}” z dnia ${m.date.split('-').reverse().join('.')}`, before: 'w przygotowaniu', after: 'usunięte'})]);
            });
            return json(res, {ok: true});
          }
          if (rest === '/command' && method === 'POST') {
            const cmd = await jsonBody(req) as Command;
            if (!cmd || typeof cmd.type !== 'string') fail('Nieprawidłowa czynność.');
            const next = write(() => {
              const m = meetingFor(id, a);
              const updated = apply(m, cmd, a, context());
              store.saveMeeting(updated, now());
              // Wersja 4 (5.1, B2-W05, K4-13): po otwarciu zgłoszenia bez decyzji wracają do czekających organu, a czekające
              // informacje o postępie tego posiedzenia dostają stan „anulowana”, zanim ktokolwiek zagłosuje.
              if (m.status === 'przygotowanie' && updated.status !== 'przygotowanie') {
                const before = prepFor(m), after = onOpen(before, now(), m);
                if (after.revision !== before.revision) store.savePrep(after, now());
                const deferred = deferredOnOpen(before, after, m);
                if (deferred.length) store.savePrep(toWaiting(waitingFor(m.organ), deferred), now());
                outbox.cancelProgress(m.id);
              }
              return updated;
            });
            return json(res, {meeting: view(next, a)});
          }
          // F6: powielenie posiedzenia z kopią treści materiałów i plików (nowe posiedzenie nie zależy od starego).
          if (rest === '/duplicate' && method === 'POST') {
            const src = meetingFor(id, a);
            if (!canCreate(store.roster(), src.organ, a)) fail('Posiedzenie powiela biuro, przewodniczący albo wiceprzewodniczący.', 403);
            const templates = organSettingsOf(store.general().general, src.organ).templates;
            const titles: Partial<Record<ItemKind, string>> = {};
            for (const t of (templates.find(x => x.id === src.template?.id) ?? templates[0])?.items ?? []) if (t.kind !== 'sprawa') titles[t.kind] ??= t.title;
            const {meeting: copy, materialMap} = duplicateMeeting(src, {id: randomUUID(), now: now(), newId: randomUUID, createdBy: a.name, docTypes: store.docTypes(),
              accountId: a.account.id, advisory: advisoryIds(accounts()), law: LAW[src.organ], titles});
            const files = new Map<string, string | null>();
            for (const ref of src.materials) {
              if (!ref.fileId || !materialMap.has(ref.id) || files.has(ref.fileId)) continue;
              const row = db.prepare('SELECT * FROM files WHERE id=? AND meeting_id=?').get(ref.fileId, src.id) as {name: string; mime: string} | undefined;
              let bytes: Buffer | null = null;
              try { if (row) bytes = await readFile(join(dataDir, 'files', ref.fileId)); } catch { bytes = null; }
              files.set(ref.fileId, row && bytes ? await saveFile(copy.id, {buffer: bytes, name: row.name, mime: row.mime}) : null);
            }
            const displayFiles = new Map<string, string>();
            for (const d of copy.displays ?? []) for (const f of [...d.files, ...(d.pdf ? [d.pdf] : [])]) {
              if (displayFiles.has(f.fileId)) continue;
              const row = store.fileRow(f.fileId, src.id);
              let bytes: Buffer | null = null;
              try { if (row) bytes = await readFile(join(dataDir, 'files', f.fileId)); } catch { bytes = null; }
              if (row && bytes) displayFiles.set(f.fileId, await saveFile(copy.id, {buffer: bytes, name: row.name, mime: row.mime}, 'pokaz', row.checked));
            }
            write(() => {
              for (const ref of copy.materials) {
                const oldId = [...materialMap].find(([, v]) => v === ref.id)![0];
                const old = src.materials.find(x => x.id === oldId)!;
                const row = db.prepare('SELECT html, hash, source FROM material_versions WHERE material_id=? AND version=?').get(old.id, old.version) as {html: string; hash: string; source: string} | undefined;
                const html = row?.html ?? '';
                ref.hash = htmlHash(html); ref.size = Buffer.byteLength(html);
                db.prepare('INSERT INTO material_versions VALUES (?,?,?,?,?,?,?,?)').run(ref.id, 1, copy.id, html, ref.hash, row?.source ?? 'text', now(), a.name);
                if (old.fileId) { ref.fileId = files.get(old.fileId) ?? null; if (!ref.fileId) ref.fileName = null; }
              }
              // Wersja 4 (5.1): pliki do pokazania przechodzą z kopią plików (identyfikatory plików nowego posiedzenia).
              for (const d of copy.displays ?? []) for (const f of [...d.files, ...(d.pdf ? [d.pdf] : [])]) { const nf = displayFiles.get(f.fileId); if (nf) f.fileId = nf; }
              if (copy.displays) copy.displays = copy.displays.filter(d => d.files.every(f => [...displayFiles.values()].includes(f.fileId)));
              store.saveMeeting(copy, now());
              const moved = carryOver(waitingFor(copy.organ), null, copy);
              if (moved.ws.proposals.length) { store.savePrep(moved.ws, now()); store.savePrep(moved.waiting, now()); }
            });
            return json(res, {meeting: view(copy, a)}, 201);
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
            // Macierz 4.3: w trakcie obrad projekt protokołu widzą biuro i osoby prowadzące obrady, po zamknięciu także członkowie.
            if (!canReadMinutes(store.roster(), m, a)) fail(minutesRefusal, 403);
            // Plik do edycji w Wordzie: ten sam tekst projektu protokołu jako dokument HTML pobierany z rozszerzeniem .doc.
            // Słownik rodzajów (F11) i wyniki, których ta osoba jeszcze nie widzi (F2), jak w widoku posiedzenia.
            const look = {...minutesLook(), options: {docTypes: store.docTypes(), hideUnannounced: !seesUnannounced(m, a, store.roster())}};
            // DB-27: `?format=doc` (i `docx`) zwraca prawdziwy plik .docx, ten sam co `dokumenty/protokol?format=docx`.
            if (url.searchParams.get('format') === 'doc' || url.searchParams.get('format') === 'docx') {
              const data = await minutesDocx(m, store.roster(), accounts(), now(), look, {deflateRaw});
              res.writeHead(200, {'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': disposition(minutesDocxFileName(m, now())), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
              return res.end(data);
            }
            res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
            return res.end(minutesHtml(m, store.roster(), accounts(), now(), look));
          }
          // ---------------------------------------------------------------------------------------------------------
          // Wersja 4: dokumenty, teczka, dokumenty dołączone, przygotowanie, poczta posiedzenia i pokaz (5.2).
          const docMatch = rest.match(/^\/dokumenty\/([\w-]+)$/);
          if (docMatch && method === 'GET') {
            const m = meetingFor(id, a);
            const doc = docMatch[1] as PaperId;
            if (!canDownloadPaper(store.roster(), m, a, doc)) paperRefusal(m, a, doc);
            if (doc !== 'protokol' && doc !== 'teczka' && !meetingPapers(m, envFor(m), a, now()).some((p: PaperEntry) => p.id === doc)) fail('Nie znaleziono dokumentu.', 404);
            const format = (url.searchParams.get('format') || (doc === 'komunikacja' ? 'md' : 'html')) as PaperFormat;
            const file = await paperFile(doc, format, m, a, exportDeps(m, a));
            res.writeHead(200, {'Content-Type': file.type, 'Content-Disposition': disposition(file.name, file.inline), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
            return res.end(file.data);
          }
          if (rest === '/teczka.zip' && method === 'GET') {
            const m = meetingFor(id, a);
            if (!canDownloadPaper(store.roster(), m, a, 'teczka')) paperRefusal(m, a, 'teczka');
            // K4-25: najwyżej jedna teczka budowana naraz.
            if (folderBusy) { res.setHeader('Retry-After', '30'); fail('Teczka jest właśnie przygotowywana dla innej osoby. Spróbuj za pół minuty.', 503); }
            folderBusy = true;
            try {
              const folder = await buildFolder(m, a, exportDeps(m, a));
              write(() => store.audit([auditEntry(a, {area: 'posiedzenia', organ: m.organ, key: `posiedzenie:${m.id}:teczka`, label: `Teczka posiedzenia „${m.title}”`, before: '–', after: `Pobrano teczkę posiedzenia z dnia ${dateDots(m.openedAt ? isoDayOf(m.openedAt) : m.date)}.`})]));
              res.writeHead(200, {'Content-Type': 'application/zip', 'Content-Disposition': disposition(folder.name), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'});
              return res.end(folder.data);
            } finally { folderBusy = false; }
          }
          if (rest === '/zlozone' && method === 'POST') {
            // U-33, G-26, G-34, DB-26: dokument dołączony tylko sygnatura i rozmiar (bez kontroli treści PDF).
            const form = await readUpload(req, origin);
            const file = form.get('file');
            if (!(file instanceof File)) fail('Wybierz plik.');
            const bytes = new Uint8Array(await (file as File).arrayBuffer());
            const kind = String(form.get('kind') ?? '') as import('../shared/types.ts').FiledKind;
            const before = meetingFor(id, a);
            addFiled(before, {kind, fileId: 'sprawdzenie', fileName: (file as File).name || 'plik', mime: 'application/pdf', size: 0, sha256: '', ballotId: String(form.get('ballotId') ?? '') || undefined, title: String(form.get('title') ?? '')}, a, context());
            const accepted = acceptFiled(bytes);
            const name = ((file as File).name || `dokument.${accepted.ext}`).replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255);
            const fileId = await saveFile(id, {buffer: bytes, name, mime: accepted.mime}, 'zlozone');
            const next = write(() => {
              const updated = addFiled(meetingFor(id, a), {kind, fileId, fileName: name, mime: accepted.mime, size: bytes.length, sha256: sha256(bytes), ballotId: String(form.get('ballotId') ?? '') || undefined, title: String(form.get('title') ?? '')}, a, context());
              store.saveMeeting(updated, now());
              return updated;
            });
            return json(res, {meeting: view(next, a)}, 201);
          }
          const filedMatch = rest.match(/^\/zlozone\/([\w-]+)$/);
          if (filedMatch && method === 'DELETE') {
            const next = write(() => {
              const updated = removeFiled(meetingFor(id, a), filedMatch[1], a, context());
              store.saveMeeting(updated, now());
              return updated;
            });
            return json(res, {meeting: view(next, a)});
          }
          if (rest === '/przygotowanie' && method === 'POST') {
            // Tabela 4.3.1, G-29–G-31: jedna transakcja na posiedzenie i przestrzeń roboczą.
            const input = await jsonBody(req, 50000);
            let converted: {html: string; source: string; name: string; fileId: string} | null = null;
            if (input?.cmd?.type === 'proposal_accept') {
              const p = prepFor(meetingFor(id, a)).proposals.find(x => x.id === input.cmd.proposalId);
              const row = p?.attachment ? store.fileRow(p.attachment.id, id) : undefined;
              if (row) {
                const up = await convert(new File([await readFile(join(dataDir, 'files', row.id))], row.name));
                converted = {html: up.html, source: up.source, name: row.name, fileId: row.id};
              }
            }
            const result = write(() => {
              const m = meetingFor(id, a);
              const own = (store.prepSpaces().filter(x => x.organ === m.organ && x.meetingId !== m.id).flatMap(x => x.proposals)).filter(p => p.accountId === a.account.id && p.state === 'zgloszone').length;
              const r = applyPrep(prepFor(m), m, input?.cmd as PrepCommand, a, {...context(), attachment: aid => attachmentOf(m.id, aid), waitingElsewhere: own});
              let meeting = r.meeting ?? m;
              if (r.created) meeting = attachProposalFile(meeting, r.created, a, converted);
              if (r.meeting) store.saveMeeting(meeting, now());
              store.savePrep(r.ws, now());
              if (r.waiting?.length) store.savePrep(toWaiting(waitingFor(m.organ), r.waiting), now());
              return meeting;
            });
            const v = view(result, a);
            return json(res, {meeting: v, prep: v.prep ?? null});
          }
          if (rest === '/przygotowanie' && method === 'GET') {
            const m = meetingFor(id, a);
            if (!canSeeWorkspace(store.roster(), m, a)) fail(PREP_REFUSALS.see, 403);
            if (m.status === 'trwa' || m.status === 'przerwa') fail(PREP_REFUSALS.later, 409);
            const ws = store.prepSpace(m.id);
            return json(res, {prep: ws ? prepView(ws, m, a, store.roster(), {env: envFor(m), now: now()}) : null}, 200, {'Cache-Control': 'private, no-store'});
          }
          if (rest === '/przygotowanie/pliki' && method === 'POST') {
            const m = meetingFor(id, a);
            if (!canPropose(store.roster(), m, a)) fail(m.status !== 'przygotowanie' ? PREP_REFUSALS.proposeLive : 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.', m.status !== 'przygotowanie' ? 409 : 403);
            const form = await readUpload(req, origin);
            const file = form.get('file');
            if (!(file instanceof File)) fail('Wybierz plik.');
            const upload = await convert(file as File);
            const checked = upload.source === 'pdf' ? await pdfChecked(new Uint8Array(upload.buffer)) : '';
            const fileId = await saveFile(m.id, upload, 'zgloszenie', checked);
            return json(res, {attachment: {id: fileId, name: upload.name, size: upload.buffer.length}}, 201);
          }
          const prepFile = rest.match(/^\/przygotowanie\/pliki\/(plik_[\w-]+)$/);
          if (prepFile && method === 'GET') {
            const m = meetingFor(id, a);
            const scope = canSeeWorkspace(store.roster(), m, a);
            if (!scope) fail(PREP_REFUSALS.see, 403);
            const row = store.fileRow(prepFile[1], m.id);
            if (!row || row.purpose !== 'zgloszenie') fail('Nie znaleziono pliku.', 404);
            if (scope === 'wlasne' && !prepFor(m).proposals.some(p => p.accountId === a.account.id && p.attachment?.id === row!.id)) fail(PREP_REFUSALS.see, 403);
            return sendFile(res, row!, 'attachment');
          }
          const mailMatch = rest.match(/^\/mail(\/preview|\/send)?$/);
          if (mailMatch) {
            if (!mailMatch[1] && method === 'GET') {
              const m = meetingFor(id, a);
              if (!canPrepare(store.roster(), m, a) && !isOfficeAccount(a) && !isChairmanNow(a, m)) fail('Historię wysyłek widzą osoby, które przygotowują posiedzenie, i biuro.', 403);
              const batches = outbox.batches({meetingId: m.id, limit: 200}).map(b => ({id: b.id, kind: b.kind, created: b.created, actor: b.actor, subject: b.subject, recipients: b.recipients,
                messages: outbox.rows(b.id).map(r => ({name: r.to_name, status: r.status, nextAt: r.next_at, sentAt: r.sent_at, error: r.last_error}))}));
              return json(res, {batches}, 200, {'Cache-Control': 'private, no-store'});
            }
            if (method !== 'POST') fail('Niedozwolona metoda.', 405);
            const input = await jsonBody(req, 20000);
            const kind = String(input?.kind ?? '') as MailKind;
            if (!(kind in MAIL_KINDS)) fail('Nieznany rodzaj wiadomości.');
            const m = meetingFor(id, a);
            const sending = mailMatch[1] === '/send';
            const lastProgressAt = outbox.lastProgressAt(m.id);
            const allowed = canSendMail(kind, store.roster(), m, a, {now: now(), lastProgressAt, ...(sending ? {enabled: mailEnabled()} : {})});
            if (!allowed.allowed) fail(allowed.reason, allowed.status ?? 403);
            const settings = mailSettings();
            const intro = String(input?.intro ?? (kind === 'postep' || kind === 'po_posiedzeniu' ? settings.intros[kind] : '') ?? '').replace(/\r\n?/g, '\n').trim();
            if (kind === 'postep' || kind === 'po_posiedzeniu') {
              if (intro.length > MAIL_LIMITS.introMax) fail('Wstęp może mieć najwyżej 1500 znaków.');
              if (!intro) fail('Wpisz wstęp tej wiadomości.');
            }
            const choice = input?.recipients && typeof input.recipients === 'object' ? input.recipients : {group: 'wszyscy'};
            const rows = mailRecipients(kind, store.roster(), m, contacts(), {group: ['wszyscy', 'zadania', 'wybrani'].includes(choice.group) ? choice.group : 'wszyscy', ids: Array.isArray(choice.ids) ? choice.ids.map(String) : [], office: !!choice.office});
            const content = mailContent(kind, m, a, intro);
            if (!sending) return json(res, {...content, recipients: rows, lastProgressAt}, 200, {'Cache-Control': 'private, no-store'});
            const batch = write(() => enqueueMail(kind, m, a, content, intro, rows));
            return json(res, {batch}, 201);
          }
          if (rest === '/pokaz' && method === 'POST') {
            // B3-16, B3-17, G-25, G-34: plik albo seria obrazów do pokazania; ciało do 31 MB tylko na tej trasie.
            const m0 = meetingFor(id, a);
            if (!roleCanAddDisplay(m0, a)) fail(m0.status === 'zakonczone' ? 'Posiedzenie zostało zamknięte.' : m0.status === 'przygotowanie' ? 'Pliki do pokazania dodaje biuro, przewodniczący albo wiceprzewodniczący.' : 'W trakcie obrad plik do pokazania dodaje osoba prowadząca obrady albo biuro.', m0.status === 'zakonczone' ? 409 : 403);
            const bytes = await body(req, 31 * 1024 * 1024);
            const form = await new Request(origin + '/upload', {method: 'POST', headers: {'Content-Type': req.headers['content-type'] || ''}, body: bytes}).formData();
            const files = form.getAll('file').filter((f): f is File => f instanceof File);
            if (!files.length) fail('Wybierz plik.');
            for (const f of files) { const r = refusalByName(f.name); if (r) fail(r, 415); }
            const accepted = [];
            for (const f of files) {
              if (f.size > SHOW_LIMITS.fileBytes) fail('Plik jest za duży. Dodaj plik do 10 MB.', 413);
              accepted.push({file: f, ...(await acceptDisplayFile(new Uint8Array(await f.arrayBuffer()), f.name, {inflate: inflateAsync}))});
            }
            const series = form.get('series') === '1' && accepted.length > 1;
            if (accepted.length > 1) { const problem = seriesProblem(accepted); if (problem) fail(problem, 413); }
            if (series && accepted.some(x => x.type === 'pdf' || x.type === 'mp4')) fail('Prezentacja ze slajdów składa się z obrazów JPG, PNG albo WebP.');
            const mimeOf = {pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4'} as const;
            const saved: (DisplayFile & {pages?: number | null})[] = [];
            for (const x of accepted) {
              const fileId = await saveFile(id, {buffer: x.bytes, name: x.file.name, mime: mimeOf[x.type]}, 'pokaz', x.type === 'pdf' ? `ok:${x.pages ?? ''}` : '');
              saved.push({fileId, name: x.file.name.slice(0, 255), type: x.type, size: x.bytes.length, ...(x.width ? {width: x.width, height: x.height} : {}), pages: x.pages});
            }
            let pdf: DisplayFile | undefined;
            const pdfFile = form.get('pdf');
            if (series && pdfFile instanceof File && pdfFile.size) {
              const x = await acceptDisplayFile(new Uint8Array(await pdfFile.arrayBuffer()), pdfFile.name, {inflate: inflateAsync});
              if (x.type !== 'pdf') fail('Plik PDF tej prezentacji musi być plikiem PDF.');
              pdf = {fileId: await saveFile(id, {buffer: x.bytes, name: pdfFile.name, mime: 'application/pdf'}, 'pokaz', `ok:${x.pages ?? ''}`), name: pdfFile.name.slice(0, 255), type: 'pdf', size: x.bytes.length};
            }
            const title = String(form.get('title') ?? '').trim();
            const itemId = String(form.get('itemId') ?? '') || (m0.status === 'przygotowanie' ? null : m0.currentItemId);
            const description = String(form.get('description') ?? '');
            const order = String(form.get('order') ?? '').split(',').filter(Boolean);
            const inputs: DisplayInput[] = series
              ? [{title, itemId, kind: 'obrazy', files: order.length ? naturalOrder(saved).sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name)) : naturalOrder(saved, f => f.name), pages: saved.length, description, ...(pdf ? {pdf} : {})}]
              : saved.map(f => ({title: saved.length > 1 ? '' : title, itemId, kind: f.type === 'pdf' ? 'pdf' : f.type === 'mp4' ? 'wideo' : 'obraz', files: [{...f, pages: undefined}].map(({pages: _p, ...rest}) => rest), pages: f.type === 'pdf' ? f.pages ?? null : f.type === 'mp4' ? null : 1, description}));
            const next = write(() => {
              let m = meetingFor(id, a);
              for (const input of inputs) m = addDisplay(m, input, a, context()).meeting;
              store.saveMeeting(m, now());
              return m;
            });
            return json(res, {meeting: view(next, a)}, 201);
          }
          const showFile = rest.match(/^\/pokaz\/(plik_[\w-]+)$/);
          if (showFile && method === 'GET') {
            // B3-22, B3-27, 5.3: plik pokazu tego posiedzenia albo materiał PDF po kontroli; zakresy bajtów (K4-26).
            const m = meetingFor(id, a);
            const row = store.fileRow(showFile[1], m.id);
            const okMaterial = row && row.purpose === 'material' && row.mime === 'application/pdf' && row.checked.startsWith('ok:');
            if (!row || !(row.purpose === 'pokaz' || okMaterial)) fail('Nie znaleziono pliku.', 404);
            if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(row!.mime)) fail('Nie znaleziono pliku.', 404);
            const bytes = await readFile(join(dataDir, 'files', row!.id));
            const image = row!.mime !== 'application/pdf';
            const headers: Record<string, string> = {
              'Content-Type': row!.mime, 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row!.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 255))}`,
              'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': `default-src 'none'; frame-ancestors 'self'${image ? '; sandbox' : ''}`,
              'Cross-Origin-Resource-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'private, max-age=86400, immutable', 'Accept-Ranges': 'bytes',
            };
            const range = String(req.headers.range ?? '');
            const one = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (range && one && !range.includes(',') && (one[1] || one[2])) {
              const size = bytes.length;
              let start = one[1] ? Number(one[1]) : size - Number(one[2]);
              let end = one[1] ? (one[2] ? Number(one[2]) : size - 1) : size - 1;
              if (start < 0) start = 0;
              if (end >= size) end = size - 1;
              if (start >= size || start > end) { res.writeHead(416, {...headers, 'Content-Range': `bytes */${size}`}); return res.end(); }
              res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1)});
              return res.end(bytes.subarray(start, end + 1));
            }
            res.writeHead(200, {...headers, 'Content-Length': String(bytes.length)});
            return res.end(bytes);
          }
          if (rest === '/materials' && method === 'POST') {
            let created: MaterialRef[];
            if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) {
              const input = await jsonBody(req, 400000);
              requireEditor(meetingFor(id, a), a, input.itemId ? String(input.itemId) : null);
              const text = String(input.text ?? '');
              if (!text.trim()) fail('Wklej treść materiału.');
              const html = input.format === 'markdown' ? markdownToHtml(text) : textToHtml(text);
              const title = String(input.title ?? '').trim() || 'Materiał';
              created = write(() => {
                const m = structuredClone(meetingFor(id, a));
                const who = requireEditor(m, a, input.itemId ? String(input.itemId) : null);
                const refs = [addMaterial(m, a, {title, type: materialType(input.type, title), number: String(input.number ?? ''), html, source: input.format === 'markdown' ? 'markdown' : 'text', fileId: null, fileName: null})];
                attachCreated(m, refs, input.itemId ? String(input.itemId) : null, false, a, who === 'referent');
                store.saveMeeting(m, now());
                return refs;
              });
            } else {
              const form = await readUpload(req, origin);
              const file = form.get('file');
              if (!(file instanceof File)) fail('Wybierz plik.');
              requireEditor(meetingFor(id, a), a, String(form.get('itemId') ?? '') || null);
              materialType(form.get('type'), '');  // zły rodzaj odrzuca się przed zapisaniem pliku
              const upload = await convert(file as File);
              // Wersja 4 (5.6, K4-25): nowy materiał PDF przechodzi kontrolę, wynik decyduje o pokazie na sali.
              const fileId = await saveFile(id, upload, 'material', upload.source === 'pdf' ? await pdfChecked(new Uint8Array(upload.buffer)) : '');
              const parts = form.get('split') === '1' && upload.source === 'docx' ? splitActs(upload.html) : [];
              const parentId = String(form.get('itemId') ?? '') || null;
              const createItems = form.get('createItems') === '1';
              created = write(() => {
                const m = structuredClone(meetingFor(id, a));
                const who = requireEditor(m, a, parentId);
                if (who === 'referent' && createItems) fail('Materiały dodaje biuro Izby albo osoba prowadząca obrady.', 403);
                const title = String(form.get('title') ?? '').trim() || upload.name.replace(/\.[^.]+$/, '');
                const refs = parts.length
                  ? parts.map(part => addMaterial(m, a, {title: part.title, type: knownType(part.type), number: part.number, html: part.html, source: 'docx', fileId, fileName: upload.name}))
                  : [addMaterial(m, a, {title, type: materialType(form.get('type'), title), number: String(form.get('number') ?? ''), html: upload.html, source: upload.source, fileId, fileName: upload.name})];
                attachCreated(m, refs, parentId, createItems && parts.length > 0, a, who === 'referent');
                store.saveMeeting(m, now());
                return refs;
              });
            }
            return json(res, {meeting: view(store.meeting(id)!, a), created: created.map(r => r.id)}, 201);
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
              if (!canPrepare(store.roster(), m, a) || m.status !== 'przygotowanie') fail('Materiał można usunąć tylko przed otwarciem posiedzenia.', 403);
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
              return json(res, {meeting: view(next, a)});
            }
            if (mat[2] && method === 'POST') {
              requireEditor(m, a, m.agenda.find(i => i.materialIds.includes(ref.id))?.id ?? null);
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
              return json(res, {meeting: view(next, a)});
            }
          }
          const fileMatch = rest.match(/^\/files\/(plik_[\w-]+)$/);
          if (fileMatch && method === 'GET') {
            // 5.2: dostęp według `files.purpose`: materiał i plik pokazu `canView`, dokument dołączony jak projekt protokołu,
            // plik zgłoszenia `canSeeWorkspace` (głos doradczy tylko własne).
            const m = meetingFor(id, a);
            const row = store.fileRow(fileMatch[1], m.id);
            if (!row) fail('Nie znaleziono pliku.', 404);
            if (row!.purpose === 'zlozone' && !canDownloadPaper(store.roster(), m, a, 'protokol')) paperRefusal(m, a, 'protokol');
            if (row!.purpose === 'zgloszenie') {
              const scope = canSeeWorkspace(store.roster(), m, a);
              if (!scope || (scope === 'wlasne' && !prepFor(m).proposals.some(p => p.accountId === a.account.id && p.attachment?.id === row!.id))) fail(PREP_REFUSALS.see, 403);
            }
            return sendFile(res, row!);
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
      if (!res.headersSent) json(res, {error: status === 500 ? 'Nie udało się wykonać tej czynności. Odśwież stronę i spróbuj ponownie. Jeśli błąd się powtórzy, zgłoś go biuru Izby.' : (error as Error).message}, status);
      else res.end();
    }
  });

  function attachCreated(m: Meeting, refs: MaterialRef[], parentId: string | null, createItems: boolean, a: Actor, referent = false) {
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
    m.log.push({at: now(), text: refs.length > 1 ? `Dodano ${refs.length} materiałów z jednego pliku.` : `Dodano materiał „${refs[0]?.title}”${referent ? ' (osoba referująca)' : ''}.`, by: a.name, ...(referent ? {accountId: a.account.id} : {})});
    m.revision++;
  }

  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  server.on('close', () => { stopped = true; clearInterval(ticker); clearInterval(worker); clearInterval(purger); if (pdfTimer) clearTimeout(pdfTimer); store.close(); });
  /** Linia stanu poczty przy starcie (5.4), bez hasła. */
  const mailStatus = () => {
    const s = mailSettings();
    if (mailCfg.off || !s.enabled) return 'Poczta wyłączona.';
    if (s.user && !mailCfg.password) return 'Poczta bez hasła na serwerze aplikacji.';
    return `Poczta gotowa, serwer ${s.host}, port ${s.port}.`;
  };
  return {server, store, setupKey, outbox, mailStatus};
}
