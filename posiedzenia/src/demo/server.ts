// Wersja próbna: ten sam przebieg posiedzenia co w aplikacji, ale „serwer” działa w przeglądarce.
// Przechwytuje zapytania /api/… i odpowiada na nie tymi samymi regułami z src/shared.
// Wersja 4 (SPEC-4 7, etap D.3): trasy z tabeli 5.2 (przygotowanie, poczta do „Skrzynki (próba)”, pokaz, dokumenty,
// teczka z `CompressionStream`, katalog, zdjęcia, „Moje konto”, statystyki) z tymi samymi funkcjami domeny co serwer.
// Pliki i zdjęcia żyją jako bajty w pamięci karty (nigdy w `localStorage`); wiadomości nie wychodzą poza stronę.
import {addDisplay, addFiled, advance, advisoryIds, apply, canView, DomainError, duplicateMeeting, newMeetingFromSettings, removeFiled, secretCast, secretIssue, setPhotos, type Command, type Context, type DisplayInput} from '../shared/meeting.ts';
import {defaultDocTypes, docTypeInput, lockedDocTypeRefusal, sortedDocTypes} from '../shared/doctypes.ts';
import {migrateDocTypesV3, migrateDocTypesV4, migrateMeeting, migrateMeetingV3, migrateMeetingV4, migrationNotesV3, migrationNotesV4} from '../shared/migrate.ts';
import {applyCompositionChange, applySettingsChange, docTypeAudit, organSettingsOf, type AuditEntry, type GeneralBundle, type GeneralSettings, type SettingsArea, type SettingsChange} from '../shared/settings.ts';
import {
  canAddDisplay, canCreate, canDownloadComms, canDownloadPaper, canPrepare, canPropose, canReadMinutes, canReport, canSeeCatalog, canSeeOwnStats, canSeeWorkspace, canSetStatsSince,
  COMMS_REFUSAL, commsPathAllowed, isCommsAccount, isOfficeAccount, isPresiding, isReferent, minutesRefusal, organRoster, photoCircleText, seesPhotos, settingsAccess,
} from '../shared/role.ts';
import {cascadeEnv, othersOf} from '../shared/cascade.ts';
import {isLockedDocType, LAW} from '../shared/law.ts';
import {dateDots, isoDayOf, plural, textToHtml} from '../shared/text.ts';
import {bytesToHex, fdhSync, hexToBytes, keyFingerprintSync, modPow, verifySignature} from '../shared/blind.ts';
import {sha256} from '../shared/sha256.ts';
import {seesUnannounced, summary, viewFor} from '../shared/view.ts';
import {organOfCode, personName} from '../shared/roster.ts';
import {applyPrep, applyWaiting, carryOver, deferredOnOpen, emptySpace, onOpen, prepView, progress, toWaiting, waitingId, PREP_REFUSALS, type PrepCommand, type PrepSpace} from '../shared/workspace.ts';
import {archiveInfo, catalogCsv, catalogRows, closedRefs, periodInput, periodReport, periodReportCsv, periodReportHtml, protocolAdoptions, type CatalogFilter} from '../shared/catalog.ts';
import {actBallots, meetingPapers, paperPage, paperRefusalOf, type PaperEntry} from '../shared/papers.ts';
import {acceptAvatar, acceptDisplayFile, naturalOrder, refusalByName, seriesProblem, sniff, SHOW_LIMITS} from '../shared/files.ts';
import {memberStats, statsCsv, statsRangeInput, statsSourceLines} from '../shared/stats.ts';
import {statsPageBody} from '../shared/stats-page.ts';
import {ADDRESS_REFUSAL, MAIL_KINDS, MAIL_LIMITS, canSendMail, minutesDraft, defaultMailSettings, mailRecipients, mailSettingsOf, mayMail, prefsOf, validAddress, validateMail, type AccountContact, type MailEnv, type MailKind} from '../shared/mail.ts';
import {afterMail, addressChangedMail, codeMail, minutesMail, progressMail, testMail, type MailBase, type MailSender} from '../shared/mail-templates.ts';
import {minutesBody, minutesDocx, minutesDocxFileName, minutesHtml, minutesTitle, type MinutesLook} from '../server/minutes.ts';
import {buildFolder, disposition, paperFile, type ExportCodec, type ExportDeps} from '../server/export-core.ts';
import {brand} from '../client/brand.ts';
import type {Account, Actor, Choice, DisplayFile, DocType, ItemKind, MaterialRef, MaterialType, Meeting, OrganCode, PaperFormat, PaperId, Roster} from '../shared/types.ts';
import {DEMO_APP_URL, demoAccounts, demoData, demoGeneral, demoMail, demoRoster, type DemoContact, type DemoFileRow} from './seed.ts';
import {browserDeflateRaw, browserInflate, builtinBytes, sha256Hex} from './files.ts';

interface Key { n: string; e: string; p: string; q: string; dp: string; dq: string; qi: string }
/** Wiadomość w „Skrzynce (próba)” (6.7.5): treść jak w aplikacji, stan „Nie wysłano, wersja próbna” (`proba`). */
export interface DemoMessage {
  id: string; batchId: string; accountId: string | null; name: string; address: string;
  subject: string; text: string; html: string; status: 'proba' | 'anulowana'; error: string; at: number;
}
export interface DemoBatch { id: string; kind: MailKind; meetingId: string | null; created: number; createdBy: string; actor: string; subject: string; intro: string; recipients: number }
interface State {
  version: 1; roster: Roster; accounts: Account[]; current: string | null;
  meetings: Record<string, Meeting>; materials: Record<string, {meetingId: string; versions: Record<number, string>}>;
  keys: Record<string, Key>; secretVotes: Record<string, {t: string; c: Choice}[]>;
  /** Słownik rodzajów dokumentów (F11); stan zapisany przed wersją 2 dostaje wartości domyślne przy wczytaniu. */
  docTypes: DocType[];
  /** Wersja 3: ustawienia ogólne, historia zmian, rewizja ustawień i znacznik jednorazowej migracji. */
  general: GeneralSettings; audit: AuditEntry[]; revision: number; v3?: true;
  /**
   * Wersja 4 (7.1): przestrzenie robocze, wizyty (dodatek D-10), adresy i preferencje kont, skrzynka z treścią
   * wiadomości, opisy plików (bajty tylko w pamięci karty), licznik katalogu i znacznik jednorazowej migracji `v4`.
   * Okresy członkostwa (dodatek D-14) są w `roster.periods`, ustawienia poczty w `general.mail`.
   */
  v4?: true;
  prep: Record<string, PrepSpace>; visits: Record<string, Record<string, number>>;
  contacts: Record<string, DemoContact>; batches: DemoBatch[]; messages: DemoMessage[];
  files: Record<string, DemoFileRow>; archiveRevision: number;
}
const STORE = 'posiedzenia-proba-v1';
const encoder = new TextEncoder();
const hashHtml = (html: string) => bytesToHex(sha256(encoder.encode(html)));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16));
const fail = (message: string, status = 400): never => { throw new DomainError(message, status); };
const b64hex = (s: string) => bytesToHex(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)));
/** Wersja 4 (7.1): komunikat przy pliku dodanym w tej karcie i utraconym po odświeżeniu. */
export const LOST_FILE = 'Pliki dodane w wersji próbnej znikają po odświeżeniu strony.';
/** Anulowanie informacji o postępie przy otwarciu (to samo brzmienie co `CANCELLED_ON_OPEN` w src/server/mail/outbox.ts). */
const CANCELLED_ON_OPEN = 'Anulowano przy otwarciu posiedzenia.';
/** Serwer poczty wersji próbnej: przypięty jak `SMTP_HOST_ALLOWED`, hasło „na serwerze” jest, połączenia nie ma (kontrola p). */
const MAIL_ENV: MailEnv = {passwordSet: true, hostAllowed: demoMail.host, appUrl: DEMO_APP_URL};
const DEMO_NO_SMTP = 'Wersja próbna nie łączy się z serwerem poczty.';
const codec: ExportCodec = {deflateRaw: browserDeflateRaw, sha256: sha256Hex};
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const safeName = (name: string) => name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 255);
type Body = BodyInit | Uint8Array;

export class DemoServer {
  state: State;
  private pool: Key[] = [];
  private filling = false;
  /** Bajty plików (wbudowanych i dodanych w tej karcie) oraz zdjęcia profilowe: tylko pamięć karty (7.1, 7.3). */
  private blobs = new Map<string, Uint8Array>();
  private avatars = new Map<string, {v: number; bytes: Uint8Array}>();
  private folderBusy = false;

  constructor() {
    this.state = this.load() ?? this.fresh();
    this.builtins();
    this.refill();
    // `unref` tylko w Node (test wersji próbnej w tests/proba.test.ts); w przeglądarce identyfikator jest liczbą.
    (setInterval(() => this.tick(), 1000) as unknown as {unref?: () => void}).unref?.();
  }

  private fresh(): State {
    const now = Date.now();
    const d = demoData(now, newId, hashHtml);
    const state: State = {version: 1, roster: d.roster, accounts: structuredClone(demoAccounts), current: null, meetings: {}, materials: {}, keys: {}, secretVotes: {}, docTypes: d.docTypes,
      general: d.general, audit: [], revision: 1, v3: true, v4: true, prep: d.prep, visits: {}, contacts: d.contacts, batches: [], messages: [], files: {}, archiveRevision: 1};
    for (const m of d.meetings) state.meetings[m.id] = m;
    for (const x of d.materials) state.materials[x.ref.id] = {meetingId: x.meetingId, versions: {1: x.html}};
    for (const f of d.files) state.files[f.id] = f;
    state.audit = d.audit.map((e, i) => ({...e, id: i + 1}));
    return state;
  }
  /** Pliki wbudowane: bajty przy każdym wczytaniu; przy pierwszym rozmiar i skrót trafiają do opisów plików i posiedzeń. */
  private builtins() {
    for (const f of Object.values(this.state.files)) {
      if (!f.builtin) continue;
      let bytes: Uint8Array;
      try { bytes = builtinBytes(f.builtin); } catch { continue; }
      this.blobs.set(f.id, bytes);
      if (f.size) continue;
      f.size = bytes.length; f.sha256 = sha256Hex(bytes);
      const m = this.state.meetings[f.meetingId];
      for (const d of m?.displays ?? []) for (const x of [...d.files, ...(d.pdf ? [d.pdf] : [])]) if (x.fileId === f.id) x.size = f.size;
      for (const x of m?.filed ?? []) if (x.fileId === f.id) { x.size = f.size; x.sha256 = f.sha256; }
    }
    this.save();
  }
  private load(): State | null {
    try {
      const raw = localStorage.getItem(STORE);
      const s = raw ? JSON.parse(raw) as State : null;
      if (s?.version !== 1) return null;
      // Stan zapisany przed wersją 2: słownik rodzajów i nowe pola posiedzeń (migrateMeeting).
      s.docTypes ??= structuredClone(defaultDocTypes);
      for (const m of Object.values(s.meetings)) migrateMeeting(m);
      if (!s.v3) this.migrateV3(s);
      if (!s.v4) this.migrateV4(s);
      return s;
    } catch { return null; }
  }
  private save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch { /* bez zapisu — próba działa do zamknięcia strony */ } }
  /** Wersja 3, jednorazowo przy wczytaniu stanu bez znacznika `v3` (jak migrateV3 na serwerze, rozdz. 2.10). */
  private migrateV3(s: State) {
    const now = Date.now();
    s.general ??= demoGeneral();
    s.audit ??= [];
    s.revision ??= 1;
    for (const o of s.roster.organs) o.forms ??= demoRoster.organs.find(x => x.code === o.code)?.forms ?? demoRoster.organs[0].forms;
    for (const ms of s.roster.memberships) if (!ms.since) { const seed = demoRoster.memberships.find(x => x.personId === ms.personId && x.organ === ms.organ); if (seed) { ms.since = seed.since; ms.basis = seed.basis; } }
    const {docTypes, audit} = migrateDocTypesV3(s.docTypes, LAW.prezydium, now);
    s.docTypes = docTypes;
    const notes = [...migrationNotesV3(s.accounts, s.roster, now), ...audit];
    s.audit.push(...notes.map((e, i) => ({...e, id: s.audit.length + i + 1})));
    const bundle: GeneralBundle = {general: s.general, docTypes: s.docTypes, revision: s.revision};
    for (const m of Object.values(s.meetings)) {
      const env = cascadeEnv({roster: s.roster, bundle, organ: m.organ, accounts: s.accounts});
      if (migrateMeetingV3(m, {now, env, advisory: advisoryIds(s.accounts), newId})) m.revision++;
    }
    s.v3 = true;
  }
  /**
   * Wersja 4 (2.3, 7.1), jednorazowo przy wczytaniu stanu bez znacznika `v4`: rodzaje dokumentów z poziomem w materiale
   * dla komunikacji, ustawienia poczty (wyłączonej), kadencja i poziomy utrwalone posiedzeń (`migrateMeetingV4`), cztery
   * wpisy w historii zmian i puste pola wersji 4. Żadne posiedzenie nie dostaje `v4`; drugi odczyt niczego nie zmienia.
   */
  private migrateV4(s: State) {
    const now = Date.now();
    s.docTypes = migrateDocTypesV4(s.docTypes).docTypes;
    s.general.mail ??= {...defaultMailSettings, controller: demoMail.controller};
    for (const m of Object.values(s.meetings)) if (migrateMeetingV4(m, {general: s.general, docTypes: s.docTypes})) m.revision++;
    s.audit.push(...migrationNotesV4(now).map((e, i) => ({...e, id: s.audit.length + i + 1})));
    s.prep ??= {}; s.visits ??= {}; s.contacts ??= {}; s.batches ??= []; s.messages ??= []; s.files ??= {}; s.archiveRevision ??= 1;
    s.v4 = true;
  }
  private bundle(): GeneralBundle { return {general: this.state.general, docTypes: this.state.docTypes, revision: this.state.revision}; }
  private record(entries: Omit<AuditEntry, 'id'>[]) {
    const out = entries.map((e, i) => ({...e, id: this.state.audit.length + i + 1}));
    this.state.audit.push(...out);
    if (this.state.audit.length > 2000) this.state.audit.splice(0, this.state.audit.length - 2000);
    return out;
  }
  reset() { this.state = this.fresh(); this.blobs.clear(); this.avatars.clear(); this.builtins(); this.save(); }

  // Klucze RSA do tajnych głosowań generuje przeglądarka z wyprzedzeniem (WebCrypto).
  private async refill() {
    if (this.filling || !crypto.subtle) return;
    this.filling = true;
    try {
      while (this.pool.length < 2) {
        const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']) as CryptoKeyPair;
        const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
        this.pool.push({n: b64hex(jwk.n!), e: b64hex(jwk.e!), p: b64hex(jwk.p!), q: b64hex(jwk.q!), dp: b64hex(jwk.dp!), dq: b64hex(jwk.dq!), qi: b64hex(jwk.qi!)});
      }
    } finally { this.filling = false; }
  }
  private sign(key: Key, blindedHex: string) {
    const big = (h: string) => BigInt('0x' + h);
    const c = big(blindedHex), p = big(key.p), q = big(key.q);
    const m1 = modPow(c % p, big(key.dp), p), m2 = modPow(c % q, big(key.dq), q);
    const h = (big(key.qi) * (((m1 - m2) % p) + p)) % p;
    return (m2 + h * q).toString(16);
  }

  private allMeetings() { return Object.values(this.state.meetings); }
  private context(): Context {
    return {
      roster: this.state.roster, now: Date.now(), newId, docTypes: this.state.docTypes,
      general: this.bundle(), law: LAW, accounts: this.accounts(),
      // Wersja 4 (5.1, G-33, G-38): zamknięte posiedzenia z rozpoznanym przyjęciem protokołu do „Dotyczy protokołu”.
      closedMeetings: closedRefs(this.allMeetings()),
      secret: {
        openKey: id => {
          const key = this.pool.shift() ?? fail('Przeglądarka przygotowuje klucz głosowania tajnego. Spróbuj ponownie za kilka sekund.', 409);
          this.state.keys[id] = key;
          this.refill();
          return {n: key.n, e: key.e, fingerprint: keyFingerprintSync(key.n, sha256)};
        },
        tally: id => {
          const counts = {za: 0, przeciw: 0, wstrzymuje: 0};
          for (const v of this.state.secretVotes[id] ?? []) counts[v.c]++;
          return counts;
        },
        closeKey: id => { delete this.state.keys[id]; },
        discard: id => { delete this.state.secretVotes[id]; },
      },
    };
  }
  /** Konta z wersją zdjęcia z pamięci karty (zdjęcia nie trafiają do `localStorage`, B3 7.3). */
  private accounts(): Account[] { return this.state.accounts.map(a => this.withAvatar(a)); }
  private avatarKey(a: Pick<Account, 'id' | 'personId'>) { return a.personId ?? a.id; }
  /** Jak `dropAvatar` na serwerze: usunięcie z przyczyną ma jeden wpis w historii kont (5.4, K4-30). */
  private dropAvatar(target: Account, removed: NonNullable<Account['avatarRemoved']>, accountId: string) {
    if (!this.avatars.delete(this.avatarKey(target))) return;
    target.avatarRemoved = removed;
    const label = target.personId ? personName(this.state.roster, target.personId) : target.displayName;
    const basis = removed.cause === 'blokada' ? 'blokada konta' : removed.cause === 'koniec_czlonkostwa' ? '30 dni po zakończeniu członkostwa' : removed.reason;
    this.record([{at: removed.at, accountId, actor: removed.by, area: 'konta', key: `konto:${target.id}:zdjecie`, label: `Konto ${label}`,
      before: 'zdjęcie', after: `Usunięto zdjęcie profilowe konta ${label}.`, ...(basis ? {basis} : {})}]);
  }
  private withAvatar(a: Account): Account {
    const v = this.avatars.get(this.avatarKey(a))?.v;
    const out = {...a};
    if (v) out.avatar = v; else delete out.avatar;
    return out;
  }
  private actor(): Actor | null {
    const raw = this.state.accounts.find(a => a.id === this.state.current && !a.disabled);
    if (!raw) return null;
    const account = this.withAvatar(raw);
    return {account, personId: account.personId, name: account.personId ? personName(this.state.roster, account.personId) : account.displayName};
  }
  private actorFor(personId: string): Actor {
    const account = this.state.accounts.find(a => a.personId === personId)!;
    return {account, personId, name: personName(this.state.roster, personId)};
  }
  private tick() {
    let changed = false;
    for (const m of this.allMeetings()) {
      if (!m.ballots.some(b => b.status === 'otwarte')) continue;
      const copy = structuredClone(m);
      if (advance(copy, this.context())) { copy.revision++; this.state.meetings[m.id] = copy; changed = true; }
    }
    if (changed) this.save();
  }
  private meetingFor(id: string, actor: Actor) {
    const m = this.state.meetings[id] ?? fail('Nie znaleziono posiedzenia.', 404);
    if (!canView(this.state.roster, m, actor)) fail('Brak dostępu do tego posiedzenia.', 403);
    return m;
  }
  /** Zapis posiedzenia; licznik katalogu rośnie przy zapisie posiedzenia zakończonego (2.4, DB-5, T-8). */
  private put(m: Meeting) {
    this.state.meetings[m.id] = m;
    if (m.status === 'zakonczone') this.state.archiveRevision++;
    this.save();
    return m;
  }
  private envFor(m: Meeting) {
    const all = this.allMeetings();
    const others = othersOf(m, all);
    const last = [...this.state.audit].reverse().find(e => e.area === 'sklad' && e.organ === m.organ);
    const waiting = m.status === 'przygotowanie' ? (this.state.prep[m.id]?.proposals ?? []).filter(p => p.state === 'zgloszone').length : 0;
    return cascadeEnv({roster: this.state.roster, bundle: this.bundle(), organ: m.organ, accounts: this.accounts(), law: LAW,
      composition: last ? {at: last.at, text: (last.basis ?? '').split(' ')[0]?.toLocaleLowerCase('pl') || last.after} : null, ...others,
      closedMeetings: closedRefs(all), proposalsWaiting: waiting});
  }
  private prepFor(m: Pick<Meeting, 'id' | 'organ'>): PrepSpace { return this.state.prep[m.id] ?? emptySpace(m.id, m.organ); }
  private waitingFor(organ: OrganCode): PrepSpace { return this.state.prep[waitingId(organ)] ?? emptySpace(waitingId(organ), organ); }
  private savePrep(ws: PrepSpace) { this.state.prep[ws.meetingId] = ws; }
  private view(m: Meeting, a: Actor) {
    const env = this.envFor(m);
    const extra: Parameters<typeof viewFor>[4] = {};
    if (m.status === 'przygotowanie') extra.prep = prepView(this.prepFor(m), m, a, this.state.roster, {env, waiting: this.waitingFor(m.organ), now: Date.now()});
    if (m.status === 'zakonczone') extra.archive = archiveInfo(m, this.allMeetings(), a, this.state.roster, isoDayOf(Date.now()));
    return viewFor(m, a, this.state.roster, env, extra);
  }
  // F11: rodzaj materiału ze słownika, włączony; bez rodzaju „inny”, jak dotąd w wersji próbnej.
  private materialType(raw: unknown): MaterialType {
    const wanted = typeof raw === 'string' ? raw.trim() : '';
    if (!wanted) return 'inny';
    const found = this.state.docTypes.find(t => t.id === wanted) ?? fail('Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
    if (!found.active) fail('Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.');
    return found.id;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Wersja 4: pliki, poczta, dokumenty.
  private look(): MinutesLook { return {css: null, logo: null, nameplate: null, org: '', names: {office: brand.officeLower, regulation: brand.regulation}}; }
  private saveFile(meetingId: string, bytes: Uint8Array, name: string, mime: string, purpose: DemoFileRow['purpose'], checked = '') {
    const id = 'plik_' + newId();
    this.blobs.set(id, bytes);
    this.state.files[id] = {id, meetingId, name: safeName(name), mime, size: bytes.length, purpose, checked, sha256: sha256Hex(bytes), created: Date.now()};
    return id;
  }
  private fileRow(id: string, meetingId: string) { const f = this.state.files[id]; return f && f.meetingId === meetingId ? f : null; }
  private bytesOf(row: DemoFileRow): Uint8Array { return this.blobs.get(row.id) ?? fail(LOST_FILE, 404); }
  private contacts(): AccountContact[] {
    return this.state.accounts.map(a => {
      const c = this.state.contacts[a.id];
      return {accountId: a.id, personId: a.personId, name: a.personId ? personName(this.state.roster, a.personId) : a.displayName, kind: a.kind,
        email: c?.email ?? null, emailState: c?.email ? c.state : 'brak', prefs: prefsOf(c?.prefs), disabled: a.disabled};
    });
  }
  private contactOf(id: string): DemoContact { return this.state.contacts[id] ??= {email: null, state: 'brak', confirmedAt: null, confirmedBy: null, prefs: prefsOf(null)}; }
  private mailSettings() { return mailSettingsOf(this.state.general.mail ?? {controller: demoMail.controller}); }
  private mailEnabled() { const s = this.mailSettings(); return s.enabled && !validateMail(s, MAIL_ENV).length; }
  private mailBase(organ: OrganCode): MailBase { return {appUrl: DEMO_APP_URL, settings: this.mailSettings(), organ: organOfCode(this.state.roster, organ)}; }
  private senderOf(a: Actor, m: Meeting): MailSender {
    return isOfficeAccount(a) ? {office: brand.officeLower} : {name: a.name, func: organRoster(this.state.roster, m).find(x => x.personId === a.personId)?.label ?? ''};
  }
  /** Wiadomości do „Skrzynki (próba)”: jedna na odbiorcę ze stanem „Nie wysłano, wersja próbna” (B2-P18). */
  private enqueue(kind: MailKind, meetingId: string | null, a: Actor, content: {subject: string; text: string; html: string}, intro: string, list: {accountId: string | null; name: string; address: string}[], error = '') {
    const batch: DemoBatch = {id: newId(), kind, meetingId, created: Date.now(), createdBy: a.account.id, actor: a.name, subject: content.subject, intro, recipients: list.length};
    this.state.batches.push(batch);
    for (const r of list) this.state.messages.push({id: newId(), batchId: batch.id, accountId: r.accountId, name: r.name, address: r.address, subject: content.subject, text: content.text, html: content.html, status: 'proba', error, at: batch.created});
    if (this.state.messages.length > 300) this.state.messages.splice(0, this.state.messages.length - 300);
    return batch;
  }
  private mailContent(kind: MailKind, m: Meeting, a: Actor, intro: string) {
    const base = this.mailBase(m.organ);
    if (kind === 'postep') return progressMail(m, progress(this.envFor(m), m, this.prepFor(m), a, Date.now()), {...base, intro, sender: this.senderOf(a, m), now: Date.now()});
    if (kind === 'po_posiedzeniu') {
      const env = this.envFor(m);
      const adopted = m.ballots.find(b => b.purpose === 'protokol' && b.protocolOf && b.announcedAt && b.result?.adopted && !b.aborted);
      const adoptedDay = adopted ? env.closedMeetings?.find(c => c.id === adopted.protocolOf)?.day ?? null : null;
      return afterMail(m, {...base, intro, sender: this.senderOf(a, m), acts: actBallots(m, env).length, adoptedDay});
    }
    if (kind === 'protokol') return minutesMail(m, base);
    return fail('Tej wiadomości nie wysyła się z posiedzenia.');
  }
  private exportDeps(m: Meeting, a?: Actor): ExportDeps {
    const all = this.allMeetings();
    const adoptions = protocolAdoptions(all);
    const next = all.filter(x => x.organ === m.organ && x.kind === 'posiedzenie' && x.status === 'przygotowanie').sort((x, y) => x.date.localeCompare(y.date))[0] ?? null;
    const chairman = !!a?.personId && organRoster(this.state.roster, m).some(x => x.personId === a.personId && x.func === 'przewodniczacy');
    const audit = a && (isOfficeAccount(a) || chairman)
      ? [...this.state.audit].reverse().filter(e => e.area === 'posiedzenia' && e.key.startsWith(`posiedzenie:${m.id}`)).slice(0, 200).map(e => ({at: e.at, by: e.actor, text: e.after}))
      : undefined;
    return {
      roster: this.state.roster, accounts: this.accounts(), env: this.envFor(m), at: Date.now(), look: this.look(), office: brand.officeLower, audit,
      materialHtml: (id, v) => { const html = this.state.materials[id]?.versions[v]; return html === undefined ? null : {html, hash: hashHtml(html)}; },
      fileBytes: async fid => { const row = this.fileRow(fid, m.id); return row ? this.blobs.get(row.id) ?? null : null; },
      fileMeta: fid => { const row = this.fileRow(fid, m.id); return row ? {name: row.name, mime: row.mime} : null; },
      comms: {adoption: adoptions.get(m.id) ?? null, next}, codec,
    };
  }
  private paperRefusal(m: Meeting, a: Actor, id: PaperId): never { const r = paperRefusalOf(m, a, id); return fail(r.message, r.status); }

  minutes(id: string) {
    const actor = this.actor() ?? fail('Wybierz osobę.', 401);
    const m = this.meetingFor(id, actor);
    if (!canReadMinutes(this.state.roster, m, actor)) fail(minutesRefusal, 403);
    return minutesBody(m, this.state.roster, this.accounts(), Date.now(), {office: brand.officeLower, regulation: brand.regulation},
      {docTypes: this.state.docTypes, hideUnannounced: !seesUnannounced(m, actor, this.state.roster)});
  }

  minutesTitle(id: string) {
    const actor = this.actor() ?? fail('Wybierz osobę.', 401);
    return minutesTitle(this.meetingFor(id, actor));
  }

  /** „Skrzynka (próba)” (6.7.5): wybrana osoba widzi swoje wiadomości, biuro i ekran wyboru osoby wszystkie. */
  inbox(): DemoMessage[] {
    const a = this.actor();
    const all = [...this.state.messages].reverse();
    return !a || isOfficeAccount(a) ? all : all.filter(x => x.accountId === a.account.id);
  }

  // Skróty próby: obecność wszystkich i głosy pozostałych osób. Obecność jest potwierdzona (F9): każda osoba zgłasza ją
  // sama, a potwierdza osoba prowadząca obrady, a gdy nikt nie prowadzi, biuro.
  everyonePresent(meetingId: string) {
    let m = this.state.meetings[meetingId];
    if (!m || m.kind !== 'posiedzenie' || (m.status !== 'trwa' && m.status !== 'przerwa')) return 'Najpierw otwórz posiedzenie.';
    for (const ms of this.state.roster.memberships.filter(x => x.organ === m.organ)) {
      if (m.attendance[ms.personId] !== 'obecny' && m.attendance[ms.personId] !== 'zgloszony') m = apply(m, {type: 'presence', who: ms.personId, present: true}, this.actorFor(ms.personId), this.context());
    }
    if (Object.values(m.attendance).includes('zgloszony')) {
      const office = this.state.accounts.find(a => a.kind === 'biuro' && !a.disabled)!;
      const confirmer = m.chair.current ? this.actorFor(m.chair.current) : {account: office, personId: null, name: office.displayName};
      m = apply(m, {type: 'presence_confirm_all'}, confirmer, this.context());
    }
    this.put(m);
    return '';
  }
  othersVote(meetingId: string, choice: Choice, except: string | null) {
    let m = this.state.meetings[meetingId];
    const b = m?.ballots.find(x => x.status === 'otwarte');
    if (!b) return 'Żadne głosowanie nie trwa.';
    for (const personId of b.eligible.filter(id => id !== except && !b.absentDuring.includes(id))) {
      const actor = this.actorFor(personId);
      if (!b.remote && m.attendance[personId] !== 'obecny') continue;
      if (b.secret) {
        if (b.secret.issued.includes(personId)) continue;
        m = secretIssue(m, b.id, actor, this.context());
        (this.state.secretVotes[b.id] ??= []).push({t: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), c: choice});
        m = secretCast(m, b.id, this.context());
      } else if (!(personId in (m.ballots.find(x => x.id === b.id)!.votes))) {
        m = apply(m, {type: 'vote', ballotId: b.id, choice}, actor, this.context());
      }
      if (m.ballots.find(x => x.id === b.id)!.status !== 'otwarte') break;
    }
    this.put(m);
    return '';
  }

  async handle(url: URL, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase(), path = url.pathname;
    const headers = new Headers(init?.headers);
    const json = (value: unknown, status = 200, extra: Record<string, string> = {}) =>
      new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'X-Server-Now': String(Date.now()), ...extra}});
    const file = (data: Body, type: string, extra: Record<string, string> = {}) =>
      new Response(data as BodyInit, {status: 200, headers: {'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', ...extra}});
    let input: any = {};
    if (typeof init?.body === 'string') { try { input = JSON.parse(init.body); } catch { return json({error: 'Nieprawidłowy format JSON.'}, 400); } }
    const form = init?.body instanceof FormData ? init.body : null;
    const rawBody = init?.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : init?.body instanceof Uint8Array ? init.body : null;
    const noStore = {'Cache-Control': 'private, no-store'};
    try {
      if (path === '/api/health') return json({ok: true, version: 'proba'});
      const cast = path.match(/^\/api\/meetings\/([\w-]+)\/secret\/cast$/);
      if (cast && method === 'POST') {
        const m = this.state.meetings[cast[1]] ?? fail('Nie znaleziono posiedzenia.', 404);
        const b = m.ballots.find(x => x.id === input.ballotId);
        if (!b?.secret) fail('Nie znaleziono głosowania tajnego.', 404);
        if (!['za', 'przeciw', 'wstrzymuje'].includes(input.choice)) fail('Nieprawidłowy wybór.');
        const token = hexToBytes(String(input.token ?? ''));
        const n = BigInt('0x' + b!.secret!.n), e = BigInt('0x' + b!.secret!.e);
        if (token.length !== 32 || !verifySignature(BigInt('0x' + String(input.signature)), fdhSync(token, n, sha256), n, e)) fail('Karta do głosowania nie ma ważnego podpisu.', 403);
        const t = bytesToHex(sha256(token)), list = (this.state.secretVotes[b!.id] ??= []);
        if (list.some(v => v.t === t)) return json({ok: true, duplicate: true});
        if (b!.status !== 'otwarte') fail('Głosowanie zakończyło się, zanim głos dotarł. Głos nie został policzony.', 409);
        list.push({t, c: input.choice});
        try { this.put(secretCast(m, b!.id, this.context())); } catch (error) { list.pop(); throw error; }
        return json({ok: true});
      }
      const actor = this.actor();
      if (path === '/api/session') {
        const access = actor ? settingsAccess(this.state.roster, actor) : null;
        const base = {account: actor?.account ?? null, setupRequired: false, roster: this.state.roster, version: 'proba',
          docTypes: actor ? sortedDocTypes(this.state.docTypes) : null, general: access?.general ? this.bundle() : null};
        if (!actor) return json(base);
        // Wersja 4 (2.5): jak na serwerze; zdjęcia tylko z pamięci karty, bez adresów e-mail.
        const roster = this.state.roster;
        // Poza kręgiem z pytania 13 mapa ma tylko własne zdjęcie (W-2), jak na serwerze.
        const ownV = this.avatars.get(this.avatarKey(actor.account))?.v;
        const avatars = seesPhotos(roster, actor) ? Object.fromEntries(this.state.accounts.filter(u => !u.disabled && this.avatars.has(this.avatarKey(u))).map(u => [this.avatarKey(u), {v: this.avatars.get(this.avatarKey(u))!.v}]))
          : ownV ? {[this.avatarKey(actor.account)]: {v: ownV}} : null;
        const closed = this.allMeetings().filter(m => m.status === 'zakonczone');
        const prepares = canCreate(roster, 'prezydium', actor);
        return json({...base, avatars, photoCircle: photoCircleText(roster), ...(isCommsAccount(actor) ? {home: '#odbyte'} : {}),
          ...(mayMail(roster, actor, prepares) ? {mail: {enabled: this.mailEnabled()}} : {}),
          can: {ownStats: canSeeOwnStats(roster, actor, closed), rosterStats: false, report: canReport(roster, actor), catalog: isCommsAccount(actor) || isOfficeAccount(actor) || !!actor.personId || actor.account.kind === 'doradczy' || actor.account.kind === 'gosc'}});
      }
      if (path === '/api/login' && method === 'POST') {
        const account = this.state.accounts.find(a => a.username === input.username && !a.disabled) ?? fail('Nie ma takiej osoby w wersji próbnej.', 401);
        this.state.current = account.id; this.save();
        return json({account: this.withAvatar(account)});
      }
      if (path === '/api/logout') { this.state.current = null; this.save(); return json({ok: true}); }
      // „Skrzynka (próba)” (6.7.5), tylko wersja próbna; działa także na ekranie wyboru osoby.
      if (path === '/api/proba/skrzynka' && method === 'GET') return json({messages: this.inbox()});
      if (!actor) fail('Wybierz osobę.', 401);
      const a = actor!;
      if (path === '/api/password') return json({account: a.account});
      // Wersja 4 (4.4): konto „Komunikacja” ma tylko katalog, odnośniki do zdjęć, materiały dla komunikacji i „Moje konto”.
      if (isCommsAccount(a) && !commsPathAllowed(path)) fail(COMMS_REFUSAL, 403);

      // --- „Moje konto” (6.2, DB-19) i zdjęcia (B3).
      if (path === '/api/me' && method === 'GET') {
        const c = this.contactOf(a.account.id);
        return json({email: c.email || null, emailState: c.email ? c.state : 'brak', emailConfirmedAt: c.confirmedAt, emailConfirmedBy: c.confirmedBy, pendingEmail: c.code && c.code.expires > Date.now() ? c.code.address : null,
          prefs: prefsOf(c.prefs), avatar: a.account.avatar ?? 0, avatarScreen: !!a.account.avatarScreen, avatarRemoved: a.account.avatarRemoved ?? null, mailEnabled: this.mailEnabled(),
          privacyUrl: /^https:\/\/\S+$/.test(this.mailSettings().privacyUrl) ? this.mailSettings().privacyUrl : null}, 200, noStore);
      }
      if (path === '/api/me/prefs' && method === 'PUT') {
        const c = this.contactOf(a.account.id);
        const prefs = prefsOf(c.prefs);
        for (const k of ['postep', 'po_posiedzeniu', 'showPresence'] as const) if (input?.[k] !== undefined) {
          if (typeof input[k] !== 'boolean') fail('Nieprawidłowe preferencje.');
          prefs[k] = input[k];
        }
        c.prefs = prefs; this.save();
        return json({prefs}, 200, noStore);
      }
      if (path === '/api/me/email' && method === 'POST') {
        const email = String(input?.email ?? '').trim();
        const c = this.contactOf(a.account.id);
        if (!email) { Object.assign(c, {email: null, state: 'brak', confirmedAt: null, confirmedBy: null, code: null}); this.save(); return json({emailState: 'brak'}, 200, noStore); }
        if (!validAddress(email)) fail(ADDRESS_REFUSAL);
        const confirmed = c.email && c.state === 'potwierdzony';
        if (confirmed && c.email === email) return json({emailState: 'potwierdzony'}, 200, noStore);
        const t = Date.now();
        const log = (c.code?.sentLog ?? []).filter(x => t - x < 3600000);
        if (!this.mailEnabled()) {
          if (!confirmed) Object.assign(c, {email, state: 'niepotwierdzony'});
          this.save();
          return json({emailState: confirmed ? 'potwierdzony' : 'niepotwierdzony', codeSent: false, message: 'Poczta jest wyłączona, więc kodu nie da się wysłać. Adres może potwierdzić administrator.'}, 200, noStore);
        }
        if (log.length >= MAIL_LIMITS.codesPerHour) fail('Wysłano już 3 kody w ciągu godziny. Spróbuj później.', 429);
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
        if (!confirmed) Object.assign(c, {email, state: 'niepotwierdzony'});
        c.code = {address: email, code, expires: t + MAIL_LIMITS.codeMinutes * 60000, attempts: 0, sentLog: [...log, t]};
        const content = codeMail(code, this.mailBase('prezydium'));
        this.enqueue('kod', null, a, content, '', [{accountId: a.account.id, name: a.name, address: email}]);
        this.save();
        return json({emailState: confirmed ? 'potwierdzony' : 'niepotwierdzony', codeSent: true}, 200, noStore);
      }
      if (path === '/api/me/email/confirm' && method === 'POST') {
        const code = String(input?.code ?? '').replace(/\s+/g, '');
        const c = this.contactOf(a.account.id);
        const pending = c.code, t = Date.now();
        if (!pending || pending.expires < t || pending.attempts >= MAIL_LIMITS.codeAttempts) fail('Kod wygasł. Wyślij nowy kod.', 409);
        if (!/^\d{6}$/.test(code) || code !== pending!.code) {
          pending!.attempts++;
          this.save();
          const left = MAIL_LIMITS.codeAttempts - pending!.attempts;
          if (left <= 0) fail('Kod wygasł. Wyślij nowy kod.', 409);
          fail(`Kod jest nieprawidłowy. ${plural(left, 'Została', 'Zostały', 'Zostało')} ${left} ${plural(left, 'próba', 'próby', 'prób')}.`);
        }
        const old = c.email && c.state === 'potwierdzony' && c.email !== pending!.address ? c.email : null;
        Object.assign(c, {email: pending!.address, state: 'potwierdzony', confirmedAt: t, confirmedBy: 'kod', code: null});
        if (old) this.enqueue('zmiana_adresu', null, a, addressChangedMail(t, this.mailBase('prezydium')), '', [{accountId: a.account.id, name: a.name, address: old}]);
        this.save();
        return json({emailState: 'potwierdzony'}, 200, noStore);
      }
      if (path === '/api/me/avatar' && (method === 'PUT' || method === 'DELETE')) {
        const key = this.avatarKey(a.account);
        if (method === 'DELETE') { this.avatars.delete(key); return json({account: this.withAvatar(this.state.accounts.find(x => x.id === a.account.id)!)}, 200, noStore); }
        if (!headers.get('Content-Type')?.startsWith('image/jpeg') && !(init?.body instanceof Blob && init.body.type === 'image/jpeg')) fail('Zdjęcie musi być plikiem JPG.', 415);
        const bytes = rawBody ?? new Uint8Array(0);
        if (bytes.length > 400 * 1024) fail('Zdjęcie jest za duże. Wybierz je jeszcze raz, a aplikacja je zmniejszy.', 413);
        const cleaned = acceptAvatar(bytes);
        this.avatars.set(key, {v: (this.avatars.get(key)?.v ?? 0) + 1, bytes: cleaned.bytes});
        return json({account: this.withAvatar(this.state.accounts.find(x => x.id === a.account.id)!)}, 200, noStore);
      }
      const avatarMatch = path.match(/^\/api\/avatars\/([\w-]+)$/);
      if (avatarMatch && method === 'GET') {
        const key = avatarMatch[1];
        const own = this.avatarKey(a.account) === key;
        if (!own && !seesPhotos(this.state.roster, a)) fail(`To zdjęcie widzą ${photoCircleText(this.state.roster)}.`, 403);
        const found = this.avatars.get(key) ?? fail('Nie znaleziono zdjęcia.', 404);
        return file(new Blob([found.bytes as BlobPart], {type: 'image/jpeg'}), 'image/jpeg', {'Content-Disposition': 'inline', 'Cache-Control': 'private, max-age=604800, immutable'});
      }
      const accountAvatar = path.match(/^\/api\/accounts\/([\w-]+)\/avatar$/);
      if (accountAvatar && method === 'DELETE') {
        if (!a.account.admin) fail('Cudze zdjęcie usuwa administrator.', 403);
        const target = this.state.accounts.find(x => x.id === accountAvatar[1]) ?? fail('Nie znaleziono konta.', 404);
        const reason = String(input?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
        this.dropAvatar(target, {at: Date.now(), by: a.name, ...(reason ? {reason} : {}), cause: 'administrator'}, a.account.id);
        this.save();
        return json({accounts: this.accountsForAdmin()});
      }

      // --- Poczta (5.4, 6.7.4): ustawienia, dziennik i wiadomość próbna bez połączenia z serwerem poczty.
      if (path.startsWith('/api/mail/')) {
        const access = settingsAccess(this.state.roster, a);
        if (path === '/api/mail/state' && method === 'GET') {
          if (!access.general) fail('Ustawienia poczty widzą biuro, przewodniczący i wiceprzewodniczący.', 403);
          const s = this.mailSettings();
          return json({enabled: s.enabled, off: false, passwordSet: true, hostAllowed: MAIL_ENV.hostAllowed, appUrl: DEMO_APP_URL, paused: null, lastSentAt: null,
            problems: validateMail({...s, enabled: true}, MAIL_ENV), demo: DEMO_NO_SMTP}, 200, noStore);
        }
        if (path === '/api/mail/log' && method === 'GET') {
          if (!isOfficeAccount(a) && !a.account.admin) fail('Dziennik wysyłek widzi biuro.', 403);
          const before = Number(url.searchParams.get('before')) || Infinity;
          const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
          const list = [...this.state.batches].reverse().filter(b => b.created < before);
          const withAddress = !!a.account.admin;
          const batches = list.slice(0, limit).map(b => ({...b, messages: this.state.messages.filter(x => x.batchId === b.id).map(x => ({id: x.id, accountId: x.accountId, name: x.name, status: x.status, attempts: 0,
            nextAt: x.at, sentAt: null, error: x.error, purged: false, ...(withAddress ? {address: x.address} : {})}))}));
          return json({batches, next: list.length > limit ? batches.at(-1)!.created : null}, 200, noStore);
        }
        if (!isOfficeAccount(a)) fail('Ustawienia poczty zmienia biuro.', 403);
        if (path === '/api/mail/resume' && method === 'POST') return json({paused: null}, 200, noStore);
        const msg = path.match(/^\/api\/mail\/messages\/([\w-]+)\/(retry|cancel)$/);
        if (msg && method === 'POST') {
          const row = this.state.messages.find(x => x.id === msg[1]) ?? fail('Nie znaleziono wiadomości.', 404);
          if (msg[2] === 'retry') fail('Ponownie wysyła się tylko wiadomość, która nie wyszła.', 409);
          fail('Anuluje się tylko wiadomość, która czeka na wysłanie.', 409);
          return json({message: row});
        }
        if (path === '/api/mail/test' && method === 'POST') {
          // B2-P13, 7.3: kroki „Pominięto” i zdanie o braku połączenia; treść wiadomości trafia do „Skrzynki (próba)”.
          const to = String(input?.to ?? '').trim();
          if (!validAddress(to)) fail(ADDRESS_REFUSAL);
          const t = Date.now();
          if (this.state.batches.filter(b => b.kind === 'proba' && b.createdBy === a.account.id && b.created > t - 3600000).length >= MAIL_LIMITS.testsPerHour) fail('Wysłano już 10 wiadomości próbnych w ciągu godziny. Spróbuj później.', 429);
          const content = testMail({...this.mailBase('prezydium'), at: t});
          this.enqueue('proba', null, a, content, '', [{accountId: null, name: '', address: to}], DEMO_NO_SMTP);
          this.save();
          const steps = ['Połączenie', 'Szyfrowanie', 'Logowanie', 'Wysłanie'].map(name => ({name, ok: false, skipped: true, text: 'Pominięto'}));
          return json({steps, ok: false, demo: DEMO_NO_SMTP}, 200, noStore);
        }
      }

      // --- Katalog, materiał dla komunikacji, odnośnik do zdjęć, zestawienie i statystyki (B1, B4, 5.2).
      const catalogFilter = (): CatalogFilter => ({
        rok: url.searchParams.get('rok') || undefined, kadencja: url.searchParams.get('kadencja') || undefined,
        rodzaj: (url.searchParams.get('rodzaj') || undefined) as CatalogFilter['rodzaj'], stan: (url.searchParams.get('stan') || undefined) as CatalogFilter['stan'],
        brak: url.searchParams.get('brak') === '1', q: (url.searchParams.get('q') || '').slice(0, 100),
      });
      if ((path === '/api/katalog' || path === '/api/katalog.csv') && method === 'GET') {
        const all = this.allMeetings();
        const rows = catalogRows(all, {roster: this.state.roster, docTypes: this.state.docTypes}, a, catalogFilter(), {today: isoDayOf(Date.now()), adoptions: protocolAdoptions(all)});
        if (path === '/api/katalog.csv') return file(catalogCsv(rows, a), 'text/csv; charset=utf-8', {'Content-Disposition': disposition(`${isoDayOf(Date.now())}-katalog-posiedzen.csv`)});
        const etag = `"${this.state.archiveRevision}-${this.state.revision}-${isoDayOf(Date.now())}-${a.account.id}"`;
        if (headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers: {ETag: etag, 'X-Server-Now': String(Date.now())}});
        return json({rows}, 200, {ETag: etag, 'Cache-Control': 'private, no-cache'});
      }
      const cat = path.match(/^\/api\/katalog\/([\w-]+)\/(komunikacja\.md|komunikacja\.json|zdjecia)$/);
      if (cat) {
        const m = this.state.meetings[cat[1]] ?? fail('Nie znaleziono posiedzenia.', 404);
        if (!canSeeCatalog(this.state.roster, m, a)) fail(isCommsAccount(a) ? COMMS_REFUSAL : 'Brak dostępu do tego posiedzenia.', 403);
        if (cat[2] === 'zdjecia' && method === 'POST') {
          const updated = isCommsAccount(a) ? setPhotos(m, String(input?.url ?? ''), a, this.context(), !!input?.confirm) : apply(m, {type: 'photos_set', url: String(input?.url ?? ''), confirm: !!input?.confirm}, a, this.context());
          if (updated.revision !== m.revision) this.put(updated);
          const row = catalogRows(this.allMeetings(), {roster: this.state.roster, docTypes: this.state.docTypes}, a, {}, {today: isoDayOf(Date.now())}).find(r => r.id === m.id) ?? null;
          return json({row});
        }
        if (method !== 'GET') fail('Niedozwolona metoda.', 405);
        if (m.status !== 'zakonczone') fail('Materiał dla komunikacji powstaje po zamknięciu posiedzenia.', 409);
        if (!canDownloadComms(this.state.roster, m, a)) {
          if (isCommsAccount(a)) fail('Materiał dla komunikacji czeka na udostępnienie przez biuro albo przewodniczącego.', 409);
          fail('Materiał dla komunikacji pobierają biuro, przewodniczący, wiceprzewodniczący, osoba, która zamknęła obrady, i konto komunikacji.', 403);
        }
        const out = await paperFile('komunikacja', 'md', m, a, this.exportDeps(m));
        if (cat[2] === 'komunikacja.json') {
          const info = archiveInfo(m, this.allMeetings(), a, this.state.roster, isoDayOf(Date.now()));
          return json({text: out.data, changedAt: info?.commsChangedAt ?? null, release: info?.commsRelease ?? null}, 200, noStore);
        }
        return file(out.data as string, out.type, {'Content-Disposition': disposition(out.name)});
      }
      if (path === '/api/zestawienie' && method === 'GET') {
        if (!canReport(this.state.roster, a)) fail('Zestawienie przygotowują biuro, przewodniczący, wiceprzewodniczący i sekretarz.', 403);
        const period = periodInput(url.searchParams.get('od'), url.searchParams.get('do'));
        if ('error' in period) fail(period.error);
        const range = period as {from: string; to: string};
        const env = cascadeEnv({roster: this.state.roster, bundle: this.bundle(), organ: 'prezydium', accounts: this.accounts(), law: LAW});
        const r = periodReport(this.allMeetings(), env, range, {at: Date.now(), today: isoDayOf(Date.now())});
        const format = url.searchParams.get('format') || 'html';
        const base = `${isoDayOf(Date.now())}-zestawienie-${range.from}-${range.to}`;
        if (format === 'csv') {
          const part = url.searchParams.get('czesc') === 'akty' ? 'akty' : 'posiedzenia';
          return file(periodReportCsv(r, part), 'text/csv; charset=utf-8', {'Content-Disposition': disposition(`${base}-${part}.csv`)});
        }
        if (format !== 'html') fail('Ten dokument nie ma takiego formatu.');
        const html = paperPage(periodReportHtml(r, this.state.roster), {title: 'Zestawienie za okres', header: 'Zestawienie za okres', draft: false, generatedAt: Date.now(), css: null,
          links: [{href: `/api/zestawienie?od=${range.from}&do=${range.to}&format=csv&czesc=posiedzenia`, label: 'CSV', name: 'Pobierz posiedzenia w formacie CSV'},
            {href: `/api/zestawienie?od=${range.from}&do=${range.to}&format=csv&czesc=akty`, label: 'CSV akty', name: 'Pobierz akty w formacie CSV'}]});
        return file(html, 'text/html; charset=utf-8', {'Content-Disposition': disposition(`${base}.html`, true)});
      }
      if (path === '/api/statystyki/moje' && method === 'GET') {
        // B4, DB-22, T-6: tylko osoba sesji, z posiedzeń zakończonych.
        const roster = this.state.roster, all = this.allMeetings();
        if (!canSeeOwnStats(roster, a, all)) fail('Statystyki mają członkowie Prezydium.', 403);
        const q = statsRangeInput({od: url.searchParams.get('od'), do: url.searchParams.get('do'), kadencja: url.searchParams.get('kadencja'), rok: url.searchParams.get('rok')}, isoDayOf(Date.now()));
        if ('error' in q) fail(q.error);
        const since = organSettingsOf(this.state.general, 'prezydium').statsSince;
        const r = memberStats({meetings: all, roster, range: (q as {range: {from: string; to: string}}).range, self: a.personId, only: [a.personId!], ...(since ? {since} : {}), ...((q as {term?: string}).term ? {term: (q as {term?: string}).term} : {})});
        const format = url.searchParams.get('format') || 'json';
        if (format === 'csv') return file(statsCsv(r, 'moje', Date.now()), 'text/csv; charset=utf-8', {'Content-Disposition': disposition(`${isoDayOf(Date.now())}-moje-statystyki.csv`)});
        if (format === 'html') return file(paperPage(statsPageBody(r, Date.now()), {title: 'Moje statystyki', header: 'Moje statystyki', draft: false, generatedAt: Date.now(), css: null}), 'text/html; charset=utf-8', {'Content-Disposition': disposition(`${isoDayOf(Date.now())}-moje-statystyki.html`, true)});
        return json({stats: r, source: statsSourceLines(r, Date.now()), generatedAt: Date.now()}, 200, noStore);
      }
      if (path.startsWith('/api/statystyki/')) fail('Statystyki składu dochodzą z dodatkiem.', 404);
      const organWaiting = path.match(/^\/api\/organs\/(prezydium|rada|zjazd)\/czekajace$/);
      if (organWaiting) {
        const organ = organWaiting[1] as OrganCode;
        if (!canSeeWorkspace(this.state.roster, {organ}, a)) fail(PREP_REFUSALS.see, 403);
        const full = canCreate(this.state.roster, organ, a);
        const shown = (ws: PrepSpace) => full ? ws : {...ws, proposals: ws.proposals.filter(p => p.accountId === a.account.id), comments: [], events: []};
        if (method === 'POST') {
          const next = applyWaiting(this.waitingFor(organ), input?.cmd as PrepCommand, a, {...this.context(), attachment: id => this.attachmentOf(waitingId(organ), id)});
          this.savePrep(next); this.save();
          return json({prep: shown(next)});
        }
        if (method === 'GET') return json({prep: shown(this.waitingFor(organ))}, 200, noStore);
      }

      if (path === '/api/people') {
        const presiding = !!a.personId && this.allMeetings().some(m => (m.status === 'trwa' || m.status === 'przerwa') && m.chair.current === a.personId);
        const organizer = canCreate(this.state.roster, 'prezydium', a) || presiding;
        return json({accounts: organizer ? this.state.accounts.filter(x => !x.disabled).map(x => ({id: x.id, displayName: x.displayName, label: x.label, kind: x.kind, personId: x.personId})) : []});
      }
      if (path === '/api/accounts') {
        if (!a.account.admin) fail('Ta czynność wymaga uprawnień administratora.', 403);
        if (method === 'POST') {
          if (!/^[a-z0-9._-]{3,64}$/.test(input.username ?? '')) fail('Login musi mieć od 3 do 64 znaków. Użyj małych liter bez polskich znaków, cyfr, kropki, myślnika lub podkreślenia.');
          if (this.state.accounts.some(x => x.username === input.username)) fail('Ten login jest już zajęty. Wpisz inny login.', 409);
          if (input.kind === 'czlonek') fail('Członkowie mają już konta w wersji próbnej.');
          if (!['doradczy', 'gosc', 'biuro', 'komunikacja'].includes(input.kind)) fail('Wybierz rodzaj konta.');
          if (input.kind === 'komunikacja' && input.admin) fail('Konto komunikacji nie ma uprawnień administratora.');
          const account: Account = {id: 'a-' + newId(), username: input.username, kind: input.kind, personId: null, displayName: String(input.displayName || input.username), label: String(input.label ?? ''), admin: !!input.admin, mustChange: false, disabled: false};
          this.state.accounts.push(account);
          this.record([{at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${account.id}`, label: `Konto ${account.displayName}`, before: 'brak', after: `login ${account.username}`}]);
          // DA-5: osoba z głosem doradczym jest zaproszona na każde posiedzenie w przygotowaniu.
          if (account.kind === 'doradczy') {
            for (const m of this.allMeetings()) {
              if (m.status !== 'przygotowanie' || m.invited.includes(account.id)) continue;
              m.invited.push(account.id);
              m.log.push({at: Date.now(), text: 'Dodano osoby z głosem doradczym zawiadamiane o każdym posiedzeniu (§ 7 ust. 2).', by: a.name, accountId: a.account.id, tag: 'ustawienia'});
              m.revision++;
            }
          }
        }
        if (method === 'PATCH') {
          const target = this.state.accounts.find(x => x.id === input.id) ?? fail('Nie znaleziono konta.', 404);
          if (target.id === a.account.id && (input.disabled !== undefined || input.admin !== undefined)) fail('Nie można zablokować własnego konta ani odebrać sobie uprawnień.');
          const label = `Konto ${target.displayName}`;
          const entries: Omit<AuditEntry, 'id'>[] = [];
          if (typeof input.disabled === 'boolean' && target.disabled !== input.disabled) {
            entries.push({at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${target.id}:blokada`, label, before: target.disabled ? 'zablokowane' : 'aktywne', after: input.disabled ? 'zablokowane' : 'aktywne'});
            target.disabled = input.disabled;
          }
          if (typeof input.admin === 'boolean' && target.admin !== input.admin) {
            entries.push({at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${target.id}:administrator`, label, before: target.admin ? 'administrator' : 'bez uprawnień administratora', after: input.admin ? 'administrator' : 'bez uprawnień administratora'});
            target.admin = input.admin;
          }
          if (typeof input.label === 'string' && input.label.slice(0, 120) !== target.label) {
            entries.push({at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${target.id}:opis`, label, before: target.label || 'brak', after: input.label.slice(0, 120) || 'brak'});
            target.label = input.label.slice(0, 120);
          }
          // Wersja 4 (B2-P07, G-21): adres konta wpisuje też administrator; „Potwierdzony przez administratora” z wpisem w historii.
          const c = this.contactOf(target.id);
          if (input.email !== undefined) {
            const email = String(input.email ?? '').trim();
            if (email && !validAddress(email)) fail(ADDRESS_REFUSAL);
            if (email !== (c.email ?? '')) {
              entries.push({at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${target.id}:email`, label, before: c.email ? 'adres wpisany' : 'brak adresu', after: email ? 'adres zmieniony przez administratora' : 'brak adresu'});
              Object.assign(c, {email: email || null, state: email ? 'niepotwierdzony' : 'brak', confirmedAt: null, confirmedBy: null});
            }
          }
          if (typeof input.emailConfirmed === 'boolean') {
            if (input.emailConfirmed && !c.email) fail('Najpierw wpisz adres e-mail.');
            if (c.email && input.emailConfirmed !== (c.state === 'potwierdzony')) {
              entries.push({at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${target.id}:email`, label, before: c.state === 'potwierdzony' ? 'adres potwierdzony' : 'adres niepotwierdzony', after: input.emailConfirmed ? 'Adres potwierdzony przez administratora.' : 'adres niepotwierdzony'});
              Object.assign(c, input.emailConfirmed ? {state: 'potwierdzony', confirmedAt: Date.now(), confirmedBy: 'administrator'} : {state: 'niepotwierdzony', confirmedAt: null, confirmedBy: null});
            }
          }
          this.record(entries);
          // DB-20, K4-30: blokada konta usuwa zdjęcie profilowe od razu (wpis w historii po wpisie o blokadzie).
          if (input.disabled === true) this.dropAvatar(target, {at: Date.now(), by: a.name, cause: 'blokada'}, a.account.id);
        }
        this.save();
        return json({accounts: this.accountsForAdmin()}, method === 'POST' ? 201 : 200);
      }
      if (path === '/api/meetings' && method === 'GET') {
        return json({meetings: this.allMeetings().filter(m => canView(this.state.roster, m, a)).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time)).map(summary)});
      }
      if (path === '/api/meetings' && method === 'POST') {
        // Wersja 3: ta sama funkcja domeny co na serwerze (wzór posiedzenia, ustawienia ogólne, G-12, DA-5).
        const m = newMeetingFromSettings({
          id: newId(), kind: input.kind === 'procedura' ? 'procedura' : 'posiedzenie', organ: input.organ, template: input.template ? String(input.template) : undefined,
          title: input.title ? String(input.title) : undefined, date: input.date, time: input.time, place: input.place === undefined ? undefined : String(input.place),
          mode: input.mode, endsAt: Number(input.endsAt) || undefined, actor: a,
        }, this.context());
        // B2-W06: nowe posiedzenie przejmuje zgłoszenia czekające organu.
        const moved = carryOver(this.waitingFor(m.organ), null, m);
        if (moved.ws.proposals.length) { this.savePrep(moved.ws); this.savePrep(moved.waiting); }
        return json({meeting: this.view(this.put(m), a)}, 201);
      }
      const docTypesResult = () => ({docTypes: sortedDocTypes(this.state.docTypes), general: this.bundle()});
      if (path === '/api/doc-types') {
        if (method === 'GET') return json({docTypes: sortedDocTypes(this.state.docTypes)});
        if (method === 'POST') {
          if (!isOfficeAccount(a)) fail('Rodzaje dokumentów zmienia biuro.', 403);
          const t = docTypeInput(input ?? {}, this.state.docTypes, undefined, LAW.prezydium);
          this.state.docTypes.push(t);
          this.record([docTypeAudit(a, Date.now(), undefined, t)]);
          this.state.revision++;
          this.save();
          return json(docTypesResult(), 201);
        }
      }
      const dt = path.match(/^\/api\/doc-types\/([a-z0-9_]{1,40})$/);
      if (dt && (method === 'PUT' || method === 'DELETE')) {
        if (!isOfficeAccount(a)) fail('Rodzaje dokumentów zmienia biuro.', 403);
        const at = this.state.docTypes.findIndex(t => t.id === dt[1]);
        if (at < 0) fail('Nie znaleziono rodzaju dokumentu.', 404);
        const current = this.state.docTypes[at];
        if (method === 'PUT') {
          const t = docTypeInput(input ?? {}, this.state.docTypes, current, LAW.prezydium);
          if (JSON.stringify(t) !== JSON.stringify(current)) { this.state.docTypes[at] = t; this.record([docTypeAudit(a, Date.now(), current, t)]); this.state.revision++; }
        } else {
          const id = dt[1];
          if (isLockedDocType(id, LAW.prezydium)) fail(lockedDocTypeRefusal(id, LAW.prezydium));
          const used = this.allMeetings().some(m => m.materials.some(x => x.type === id) || m.ballots.some(b => b.docType === id) || m.agenda.some(i => i.docType === id));
          if (used) fail('Ten rodzaj jest już użyty w materiale, punkcie albo głosowaniu. Możesz go tylko wyłączyć.', 409);
          this.state.docTypes.splice(at, 1);
          this.record([docTypeAudit(a, Date.now(), current, undefined)]);
          this.state.revision++;
        }
        this.save();
        return json(docTypesResult());
      }
      // Wersja 3: ustawienia ogólne, skład z podstawą i historia zmian (te same funkcje co na serwerze).
      if (path === '/api/settings' && method === 'POST') {
        // Wersja 4 (G-40): dzień startu statystyk późniejszy niż najwcześniejsze policzone posiedzenie wpisuje przewodniczący.
        const statsChange = input?.change?.area === 'organ' && input?.change?.key === 'statsSince';
        if (!isOfficeAccount(a) && !(statsChange && settingsAccess(this.state.roster, a).general)) fail('Ustawienia ogólne zmienia biuro.', 403);
        const organ = (input?.change?.organ ?? 'prezydium') as OrganCode;
        const firstCounted = (since: string | null) => this.allMeetings().filter(m => m.organ === organ && m.status === 'zakonczone')
          .map(m => m.openedAt ? isoDayOf(m.openedAt) : m.date).filter(d => !since || d >= since).sort()[0] ?? null;
        const {bundle, audit} = applySettingsChange(this.bundle(), input?.change as SettingsChange, {actor: a, now: Date.now(), roster: this.state.roster, mail: MAIL_ENV,
          statsSince: (from, to) => canSetStatsSince(this.state.roster, a, from, to, firstCounted(from))});
        if (!audit.length) return json({general: this.bundle(), entries: []});
        this.state.general = bundle.general;
        const entries = this.record(audit);
        this.state.revision++;
        this.save();
        return json({general: this.bundle(), entries});
      }
      if (path === '/api/composition' && method === 'POST') {
        if (!isOfficeAccount(a)) fail('Skład organu wpisuje biuro.', 403);
        const organ = (input?.organ ?? 'prezydium') as OrganCode;
        const change = applyCompositionChange(this.state.roster, organSettingsOf(this.state.general, organ), input, {actor: a, now: Date.now(), today: isoDayOf(Date.now()), newId});
        this.state.roster = change.roster;
        this.state.general.organs[organ] = change.settings;
        const entries = this.record(change.audit);
        this.state.revision++;
        this.save();
        return json({roster: this.state.roster, general: this.bundle(), entries});
      }
      if (path === '/api/settings/history' && method === 'GET') {
        const access = settingsAccess(this.state.roster, a);
        const area = (url.searchParams.get('area') || undefined) as SettingsArea | undefined;
        const all: SettingsArea[] = ['siedziba', 'organ', 'wzory', 'rodzaje_dokumentow', 'rodzaje_spraw', 'sklad', 'konta', 'posiedzenia', 'poczta'];
        const allowed = all.filter(x => x === 'konta' ? access.accounts : !!access.general);
        if (!allowed.length || (area && !allowed.includes(area))) fail('Brak dostępu do tej historii zmian.', 403);
        const accountId = url.searchParams.get('accountId'), before = Number(url.searchParams.get('before')) || Infinity;
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 200);
        const list = [...this.state.audit].reverse().filter(e => (area ? e.area === area : allowed.includes(e.area)) && (!accountId || e.accountId === accountId) && e.id < before);
        const entries = list.slice(0, limit);
        return json({entries, next: list.length > limit ? entries.at(-1)!.id : null});
      }
      const mm = path.match(/^\/api\/meetings\/([\w-]+)(\/.*)?$/);
      if (!mm) fail('Nie znaleziono tej funkcji.', 404);
      const id = mm![1], rest = mm![2] ?? '';
      if (rest === '' && method === 'GET') {
        // ETag (2.4): w „trwa” i „przerwa” format wersji 3 (T-5); w przygotowaniu dochodzą licznik katalogu, rewizja
        // przestrzeni roboczej i dzień, po zamknięciu licznik katalogu i dzień.
        const m = this.meetingFor(id, a), day = isoDayOf(Date.now());
        const etag = m.status === 'trwa' || m.status === 'przerwa' ? `"${m.revision}-${this.state.revision}-${a.account.id}"`
          : m.status === 'przygotowanie' ? `"${m.revision}-${this.state.revision}-${this.state.archiveRevision}-${this.prepFor(m).revision}-${day}-${a.account.id}"`
          : `"${m.revision}-${this.state.revision}-${this.state.archiveRevision}-${day}-${a.account.id}"`;
        if (headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers: {ETag: etag, 'X-Server-Now': String(Date.now())}});
        return json({meeting: this.view(m, a)}, 200, {ETag: etag});
      }
      if (rest === '' && method === 'DELETE') {
        const m = this.meetingFor(id, a);
        if (!canCreate(this.state.roster, m.organ, a) || m.status !== 'przygotowanie') fail('Usunąć można tylko nierozpoczęte posiedzenie. Usuwa je biuro, przewodniczący albo wiceprzewodniczący.', 403);
        delete this.state.meetings[id];
        delete this.state.prep[id];
        this.record([{at: Date.now(), accountId: a.account.id, actor: a.name, area: 'posiedzenia', organ: m.organ, key: `posiedzenie:${m.id}`, label: `Posiedzenie „${m.title}” z dnia ${m.date.split('-').reverse().join('.')}`, before: 'w przygotowaniu', after: 'usunięte'}]);
        this.save();
        return json({ok: true});
      }
      if (rest === '/command' && method === 'POST') {
        const m = this.meetingFor(id, a);
        const updated = apply(m, input as Command, a, this.context());
        // Wersja 4 (5.1, B2-W05, K4-13): po otwarciu zgłoszenia bez decyzji wracają do czekających organu, a czekające
        // informacje o postępie tego posiedzenia dostają stan „anulowana”.
        if (m.status === 'przygotowanie' && updated.status !== 'przygotowanie') {
          const before = this.prepFor(m), after = onOpen(before, Date.now(), m);
          if (after.revision !== before.revision) this.savePrep(after);
          const deferred = deferredOnOpen(before, after, m);
          if (deferred.length) this.savePrep(toWaiting(this.waitingFor(m.organ), deferred));
          const batches = new Set(this.state.batches.filter(b => b.kind === 'postep' && b.meetingId === m.id).map(b => b.id));
          for (const x of this.state.messages) if (batches.has(x.batchId) && x.status === 'proba') { x.status = 'anulowana'; x.error = CANCELLED_ON_OPEN; }
        }
        return json({meeting: this.view(this.put(updated), a)});
      }
      if (rest === '/duplicate' && method === 'POST') {
        const src = this.meetingFor(id, a);
        if (!canCreate(this.state.roster, src.organ, a)) fail('Posiedzenie powiela biuro, przewodniczący albo wiceprzewodniczący.', 403);
        const templates = organSettingsOf(this.state.general, src.organ).templates;
        const titles: Partial<Record<ItemKind, string>> = {};
        for (const t of (templates.find(x => x.id === src.template?.id) ?? templates[0])?.items ?? []) if (t.kind !== 'sprawa') titles[t.kind] ??= t.title;
        const {meeting: copy, materialMap} = duplicateMeeting(src, {id: newId(), now: Date.now(), newId, createdBy: a.name, docTypes: this.state.docTypes,
          accountId: a.account.id, advisory: advisoryIds(this.state.accounts), law: LAW[src.organ], titles});
        for (const [oldId, newRef] of materialMap) {
          const old = src.materials.find(x => x.id === oldId)!, html = this.state.materials[oldId]?.versions[old.version] ?? '';
          this.state.materials[newRef] = {meetingId: copy.id, versions: {1: html}};
          const ref = copy.materials.find(x => x.id === newRef)!;
          ref.hash = hashHtml(html); ref.size = html.length; ref.fileId = null; ref.fileName = null;
        }
        // Wersja 4 (5.1): pliki do pokazania przechodzą z kopią plików (opisy i bajty w pamięci karty).
        const map = new Map<string, string>();
        for (const d of copy.displays ?? []) for (const f of [...d.files, ...(d.pdf ? [d.pdf] : [])]) {
          if (map.has(f.fileId)) continue;
          const row = this.fileRow(f.fileId, src.id), bytes = row ? this.blobs.get(row.id) : undefined;
          if (row && bytes) map.set(f.fileId, this.saveFile(copy.id, bytes, row.name, row.mime, 'pokaz', row.checked));
        }
        for (const d of copy.displays ?? []) for (const f of [...d.files, ...(d.pdf ? [d.pdf] : [])]) { const nf = map.get(f.fileId); if (nf) f.fileId = nf; }
        if (copy.displays) copy.displays = copy.displays.filter(d => d.files.every(f => [...map.values()].includes(f.fileId)));
        const moved = carryOver(this.waitingFor(copy.organ), null, copy);
        if (moved.ws.proposals.length) { this.savePrep(moved.ws); this.savePrep(moved.waiting); }
        return json({meeting: this.view(this.put(copy), a)}, 201);
      }
      if (rest === '/secret/issue' && method === 'POST') {
        const next = secretIssue(this.meetingFor(id, a), String(input.ballotId), a, this.context());
        const key = this.state.keys[String(input.ballotId)] ?? fail('To głosowanie tajne zostało zakończone.', 409);
        if (!/^[0-9a-f]{1,1024}$/i.test(String(input.blinded))) fail('Nieprawidłowa karta do głosowania.');
        const signature = this.sign(key, String(input.blinded));
        this.put(next);
        return json({signature});
      }
      if (rest === '/protokol' && method === 'GET') {
        const m = this.meetingFor(id, a);
        if (!canReadMinutes(this.state.roster, m, a)) fail(minutesRefusal, 403);
        const look = {...this.look(), options: {docTypes: this.state.docTypes, hideUnannounced: !seesUnannounced(m, a, this.state.roster)}};
        // DB-27: `?format=doc` (i `docx`) zwraca prawdziwy plik .docx z tego samego `docx.ts` co serwer.
        if (url.searchParams.get('format') === 'doc' || url.searchParams.get('format') === 'docx') {
          const data = await minutesDocx(m, this.state.roster, this.accounts(), Date.now(), look, {deflateRaw: browserDeflateRaw});
          return file(new Blob([data as BlobPart]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', {'Content-Disposition': disposition(minutesDocxFileName(m, Date.now()))});
        }
        return file(minutesHtml(m, this.state.roster, this.accounts(), Date.now(), look), 'text/html; charset=utf-8');
      }
      // ---------------------------------------------------------------------------------------------------------
      // Wersja 4: dokumenty, teczka, dokumenty dołączone, przygotowanie, poczta posiedzenia i pokaz (5.2).
      const docMatch = rest.match(/^\/dokumenty\/([\w-]+)$/);
      if (docMatch && method === 'GET') {
        const m = this.meetingFor(id, a);
        const doc = docMatch[1] as PaperId;
        if (!canDownloadPaper(this.state.roster, m, a, doc)) this.paperRefusal(m, a, doc);
        if (doc !== 'protokol' && doc !== 'teczka' && !meetingPapers(m, this.envFor(m), a, Date.now()).some((p: PaperEntry) => p.id === doc)) fail('Nie znaleziono dokumentu.', 404);
        const format = (url.searchParams.get('format') || (doc === 'komunikacja' ? 'md' : 'html')) as PaperFormat;
        const out = await paperFile(doc, format, m, a, this.exportDeps(m, a));
        return file(typeof out.data === 'string' ? out.data : new Blob([out.data as BlobPart]), out.type, {'Content-Disposition': disposition(out.name, out.inline)});
      }
      if (rest === '/teczka.zip' && method === 'GET') {
        const m = this.meetingFor(id, a);
        if (!canDownloadPaper(this.state.roster, m, a, 'teczka')) this.paperRefusal(m, a, 'teczka');
        if (this.folderBusy) fail('Teczka jest właśnie przygotowywana dla innej osoby. Spróbuj za pół minuty.', 503);
        this.folderBusy = true;
        try {
          const folder = await buildFolder(m, a, this.exportDeps(m, a));
          this.record([{at: Date.now(), accountId: a.account.id, actor: a.name, area: 'posiedzenia', organ: m.organ, key: `posiedzenie:${m.id}:teczka`, label: `Teczka posiedzenia „${m.title}”`, before: '–', after: `Pobrano teczkę posiedzenia z dnia ${dateDots(m.openedAt ? isoDayOf(m.openedAt) : m.date)}.`}]);
          this.save();
          return file(new Blob([folder.data as BlobPart]), 'application/zip', {'Content-Disposition': disposition(folder.name)});
        } finally { this.folderBusy = false; }
      }
      if (rest === '/zlozone' && method === 'POST') {
        // 7.3: dokumentów dołączonych w wersji próbnej się nie dodaje; dane fikcyjne je mają.
        this.meetingFor(id, a);
        fail('W wersji próbnej pliki po posiedzeniu są tylko przykładowe.');
      }
      const filedMatch = rest.match(/^\/zlozone\/([\w-]+)$/);
      if (filedMatch && method === 'DELETE') {
        return json({meeting: this.view(this.put(removeFiled(this.meetingFor(id, a), filedMatch[1], a, this.context())), a)});
      }
      if (rest === '/przygotowanie' && method === 'POST') {
        const m = this.meetingFor(id, a);
        const own = Object.values(this.state.prep).filter(x => x.organ === m.organ && x.meetingId !== m.id).flatMap(x => x.proposals).filter(p => p.accountId === a.account.id && p.state === 'zgloszone').length;
        const r = applyPrep(this.prepFor(m), m, input?.cmd as PrepCommand, a, {...this.context(), attachment: aid => this.attachmentOf(m.id, aid), waitingElsewhere: own});
        let meeting = r.meeting ?? m;
        if (r.created) meeting = this.attachProposalFile(meeting, r.created, a);
        this.savePrep(r.ws);
        if (r.waiting?.length) this.savePrep(toWaiting(this.waitingFor(m.organ), r.waiting));
        if (r.meeting) this.put(meeting); else this.save();
        const v = this.view(meeting, a);
        return json({meeting: v, prep: v.prep ?? null});
      }
      if (rest === '/przygotowanie' && method === 'GET') {
        const m = this.meetingFor(id, a);
        if (!canSeeWorkspace(this.state.roster, m, a)) fail(PREP_REFUSALS.see, 403);
        if (m.status === 'trwa' || m.status === 'przerwa') fail(PREP_REFUSALS.later, 409);
        const ws = this.state.prep[m.id];
        return json({prep: ws ? prepView(ws, m, a, this.state.roster, {env: this.envFor(m), now: Date.now()}) : null}, 200, noStore);
      }
      if (rest === '/przygotowanie/pliki' && method === 'POST') {
        const m = this.meetingFor(id, a);
        if (!canPropose(this.state.roster, m, a)) fail(m.status !== 'przygotowanie' ? PREP_REFUSALS.proposeLive : 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.', m.status !== 'przygotowanie' ? 409 : 403);
        const f = form?.get('file');
        if (!(f instanceof File)) fail('Wybierz plik.');
        const upload = f as File;
        if (upload.size > 10 * 1024 * 1024) fail('Plik może mieć najwyżej 10 MB.');
        const bytes = new Uint8Array(await upload.arrayBuffer());
        const ext = upload.name.toLowerCase().split('.').pop();
        if (ext !== 'pdf' && ext !== 'txt') fail('W wersji próbnej do zgłoszenia dodaj plik PDF albo TXT. Pliki Word i Markdown obsługuje pełna aplikacja.');
        const fileId = this.saveFile(m.id, bytes, upload.name, ext === 'pdf' ? 'application/pdf' : 'text/plain', 'zgloszenie');
        this.save();
        return json({attachment: {id: fileId, name: safeName(upload.name), size: bytes.length}}, 201);
      }
      const prepFile = rest.match(/^\/przygotowanie\/pliki\/(plik_[\w-]+)$/);
      if (prepFile && method === 'GET') {
        const m = this.meetingFor(id, a);
        const scope = canSeeWorkspace(this.state.roster, m, a);
        if (!scope) fail(PREP_REFUSALS.see, 403);
        const row = this.fileRow(prepFile[1], m.id);
        if (!row || row.purpose !== 'zgloszenie') fail('Nie znaleziono pliku.', 404);
        if (scope === 'wlasne' && !this.prepFor(m).proposals.some(p => p.accountId === a.account.id && p.attachment?.id === row!.id)) fail(PREP_REFUSALS.see, 403);
        return this.sendFile(row!);
      }
      const mailMatch = rest.match(/^\/mail(\/preview|\/send)?$/);
      if (mailMatch) {
        if (!mailMatch[1] && method === 'GET') {
          const m = this.meetingFor(id, a);
          const chairman = !!a.personId && organRoster(this.state.roster, m).some(x => x.personId === a.personId && x.func === 'przewodniczacy');
          if (!canPrepare(this.state.roster, m, a) && !isOfficeAccount(a) && !chairman) fail('Historię wysyłek widzą osoby, które przygotowują posiedzenie, i biuro.', 403);
          const batches = [...this.state.batches].reverse().filter(b => b.meetingId === m.id).map(b => ({id: b.id, kind: b.kind, created: b.created, actor: b.actor, subject: b.subject, recipients: b.recipients,
            messages: this.state.messages.filter(x => x.batchId === b.id).map(x => ({name: x.name, status: x.status, nextAt: x.at, sentAt: null, error: x.error}))}));
          return json({batches}, 200, noStore);
        }
        if (method !== 'POST') fail('Niedozwolona metoda.', 405);
        const kind = String(input?.kind ?? '') as MailKind;
        if (!(kind in MAIL_KINDS)) fail('Nieznany rodzaj wiadomości.');
        const saved = this.meetingFor(id, a);
        const sending = mailMatch[1] === '/send';
        // W-5: podgląd „Protokół do wglądu” ze szkicu okna „Protokół sporządzony”, bez zapisu; wysyłka z zapisanym faktem.
        const m = !sending && kind === 'protokol' ? minutesDraft(saved, this.state.roster, input?.draft) ?? saved : saved;
        const lastProgressAt = this.state.batches.filter(b => b.kind === 'postep' && b.meetingId === m.id).reduce<number | null>((x, b) => Math.max(x ?? 0, b.created), null);
        const allowed = canSendMail(kind, this.state.roster, m, a, {now: Date.now(), lastProgressAt, ...(sending ? {enabled: this.mailEnabled()} : {})});
        if (!allowed.allowed) fail(allowed.reason, allowed.status ?? 403);
        const settings = this.mailSettings();
        const intro = String(input?.intro ?? (kind === 'postep' || kind === 'po_posiedzeniu' ? settings.intros[kind] : '') ?? '').replace(/\r\n?/g, '\n').trim();
        if (kind === 'postep' || kind === 'po_posiedzeniu') {
          if (intro.length > MAIL_LIMITS.introMax) fail('Wstęp może mieć najwyżej 1500 znaków.');
          if (!intro) fail('Wpisz wstęp tej wiadomości.');
        }
        const choice = input?.recipients && typeof input.recipients === 'object' ? input.recipients : {group: 'wszyscy'};
        const contacts = this.contacts();
        const rows = mailRecipients(kind, this.state.roster, m, contacts, {group: ['wszyscy', 'zadania', 'wybrani'].includes(choice.group) ? choice.group : 'wszyscy', ids: Array.isArray(choice.ids) ? choice.ids.map(String) : [], office: !!choice.office});
        const content = this.mailContent(kind, m, a, intro);
        if (!sending) return json({...content, recipients: rows, lastProgressAt}, 200, noStore);
        const byId = new Map(contacts.map(c => [c.accountId, c]));
        const list = rows.filter(r => r.state === 'wysle').map(r => byId.get(r.accountId)!).filter(c => c?.email).map(c => ({accountId: c.accountId, name: c.name, address: c.email!}));
        const batch = this.enqueue(kind, m.id, a, content, intro, list);
        this.save();
        return json({batch: {id: batch.id, recipients: list.length}}, 201);
      }
      if (rest === '/pokaz' && method === 'POST') {
        // B3-16, B3-17, 7.3: te same kontrole z files.ts; wideo pokazuje pełna aplikacja.
        const m0 = this.meetingFor(id, a);
        if (!canAddDisplay(this.state.roster, m0, a)) fail(m0.status === 'zakonczone' ? 'Posiedzenie zostało zamknięte.' : m0.status === 'przygotowanie' ? 'Pliki do pokazania dodaje biuro, przewodniczący albo wiceprzewodniczący.' : 'W trakcie obrad plik do pokazania dodaje osoba prowadząca obrady albo biuro.', m0.status === 'zakonczone' ? 409 : 403);
        const files = (form?.getAll('file') ?? []).filter((f): f is File => f instanceof File);
        if (!files.length) fail('Wybierz plik.');
        for (const f of files) {
          if (/\.(mp4|m4v|mov|webm)$/i.test(f.name) || f.type.startsWith('video/')) fail('Wideo pokazuje pełna aplikacja.', 415);
          const r = refusalByName(f.name); if (r) fail(r, 415);
        }
        const accepted = [];
        for (const f of files) {
          if (f.size > SHOW_LIMITS.fileBytes) fail('Plik jest za duży. Dodaj plik do 10 MB.', 413);
          const bytes = new Uint8Array(await f.arrayBuffer());
          if (sniff(bytes) === 'mp4') fail('Wideo pokazuje pełna aplikacja.', 415);
          accepted.push({file: f, ...(await acceptDisplayFile(bytes, f.name, {inflate: browserInflate}))});
        }
        const series = form?.get('series') === '1' && accepted.length > 1;
        if (accepted.length > 1) { const problem = seriesProblem(accepted); if (problem) fail(problem, 413); }
        if (series && accepted.some(x => x.type === 'pdf' || x.type === 'mp4')) fail('Prezentacja ze slajdów składa się z obrazów JPG, PNG albo WebP.');
        const mimeOf = {pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4'} as const;
        const saved: (DisplayFile & {pages?: number | null})[] = [];
        for (const x of accepted) {
          const fileId = this.saveFile(id, x.bytes, x.file.name, mimeOf[x.type], 'pokaz', x.type === 'pdf' ? `ok:${x.pages ?? ''}` : '');
          saved.push({fileId, name: safeName(x.file.name), type: x.type, size: x.bytes.length, ...(x.width ? {width: x.width, height: x.height} : {}), pages: x.pages});
        }
        let pdf: DisplayFile | undefined;
        const pdfFile = form?.get('pdf');
        if (series && pdfFile instanceof File && pdfFile.size) {
          const x = await acceptDisplayFile(new Uint8Array(await pdfFile.arrayBuffer()), pdfFile.name, {inflate: browserInflate});
          if (x.type !== 'pdf') fail('Plik PDF tej prezentacji musi być plikiem PDF.');
          pdf = {fileId: this.saveFile(id, x.bytes, pdfFile.name, 'application/pdf', 'pokaz', `ok:${x.pages ?? ''}`), name: safeName(pdfFile.name), type: 'pdf', size: x.bytes.length};
        }
        const title = String(form?.get('title') ?? '').trim();
        const itemId = String(form?.get('itemId') ?? '') || (m0.status === 'przygotowanie' ? null : m0.currentItemId);
        const description = String(form?.get('description') ?? '');
        const order = String(form?.get('order') ?? '').split(',').filter(Boolean);
        const inputs: DisplayInput[] = series
          ? [{title, itemId, kind: 'obrazy', files: order.length ? naturalOrder(saved).sort((x, y) => order.indexOf(x.name) - order.indexOf(y.name)) : naturalOrder(saved, f => f.name), pages: saved.length, description, ...(pdf ? {pdf} : {})}]
          : saved.map(f => ({title: saved.length > 1 ? '' : title, itemId, kind: f.type === 'pdf' ? 'pdf' : f.type === 'mp4' ? 'wideo' : 'obraz', files: [{...f, pages: undefined}].map(({pages: _p, ...rest}) => rest), pages: f.type === 'pdf' ? f.pages ?? null : f.type === 'mp4' ? null : 1, description}));
        let m = this.meetingFor(id, a);
        for (const x of inputs) m = addDisplay(m, x, a, this.context()).meeting;
        return json({meeting: this.view(this.put(m), a)}, 201);
      }
      const showFile = rest.match(/^\/pokaz\/(plik_[\w-]+)$/);
      if (showFile && method === 'GET') {
        const m = this.meetingFor(id, a);
        const row = this.fileRow(showFile[1], m.id);
        const okMaterial = row && row.purpose === 'material' && row.mime === 'application/pdf' && row.checked.startsWith('ok:');
        if (!row || !(row.purpose === 'pokaz' || okMaterial)) fail('Nie znaleziono pliku.', 404);
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4'].includes(row!.mime)) fail('Nie znaleziono pliku.', 404);
        const bytes = this.bytesOf(row!);
        return file(new Blob([bytes as BlobPart], {type: row!.mime}), row!.mime, {'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row!.name)}`, 'Cache-Control': 'private, max-age=86400, immutable', 'Accept-Ranges': 'bytes'});
      }
      if (rest === '/materials' && method === 'POST') {
        if (form) fail('W wersji próbnej dodaj materiał przyciskiem „Wklej tekst”. Pliki Word i PDF obsługuje pełna aplikacja.');
        const m = structuredClone(this.meetingFor(id, a));
        if (m.status === 'zakonczone') fail('Posiedzenie zostało zamknięte.');
        // Wersja 4 (B2-W11): w przygotowaniu osoba referująca dodaje materiał do swojego punktu.
        const editor = m.status === 'przygotowanie' ? canPrepare(this.state.roster, m, a) : isOfficeAccount(a) || isPresiding(m, a);
        const referent = !editor && m.status === 'przygotowanie' && !!input.itemId && isReferent(this.state.roster, m, String(input.itemId), a.personId);
        if (!editor && !referent) fail('Materiały dodaje biuro albo osoba prowadząca obrady.', 403);
        const text = String(input.text ?? '');
        if (!text.trim()) fail('Wklej treść materiału.');
        const html = textToHtml(text), title = String(input.title ?? '').trim() || 'Materiał';
        const ref: MaterialRef = {id: newId(), title, type: this.materialType(input.type), number: String(input.number ?? ''), version: 1, hash: hashHtml(html), size: html.length, fileId: null, fileName: null, createdAt: Date.now()};
        m.materials.push(ref);
        this.state.materials[ref.id] = {meetingId: m.id, versions: {1: html}};
        const item = m.agenda.find(i => i.id === input.itemId);
        if (item) item.materialIds.push(ref.id);
        m.log.push({at: Date.now(), text: `Dodano materiał „${title}”${referent ? ' (osoba referująca)' : ''}.`, by: a.name, ...(referent ? {accountId: a.account.id} : {})});
        m.revision++;
        return json({meeting: this.view(this.put(m), a), created: [ref.id]}, 201);
      }
      const mat = rest.match(/^\/materials\/([\w-]+)(\/version)?$/);
      if (mat) {
        const m = this.meetingFor(id, a);
        const ref = m.materials.find(x => x.id === mat[1]) ?? fail('Nie znaleziono materiału.', 404);
        const store = this.state.materials[ref.id] ?? fail('Nie znaleziono materiału.', 404);
        if (!mat[2] && method === 'GET') {
          const version = Number(url.searchParams.get('v')) || ref.version;
          const html = store.versions[version] ?? fail('Nie znaleziono tej wersji materiału.', 404);
          return json({material: {...ref, version, hash: hashHtml(html), html}});
        }
        if (!mat[2] && method === 'DELETE') {
          if (!canPrepare(this.state.roster, m, a) || m.status !== 'przygotowanie') fail('Materiał można usunąć tylko przed otwarciem posiedzenia.', 403);
          const next = structuredClone(m);
          next.materials = next.materials.filter(x => x.id !== ref.id);
          for (const it of next.agenda) it.materialIds = it.materialIds.filter(x => x !== ref.id);
          next.revision++;
          return json({meeting: this.view(this.put(next), a)});
        }
        if (mat[2] && method === 'POST') {
          if (m.status === 'zakonczone') fail('Posiedzenie zostało zamknięte.');
          const itemId = m.agenda.find(i => i.materialIds.includes(ref.id))?.id ?? null;
          const editor = m.status === 'przygotowanie' ? canPrepare(this.state.roster, m, a) : isOfficeAccount(a) || isPresiding(m, a);
          if (!editor && !(m.status === 'przygotowanie' && itemId && isReferent(this.state.roster, m, itemId, a.personId))) fail('Materiały dodaje biuro albo osoba prowadząca obrady.', 403);
          if (form) fail('W wersji próbnej nową wersję wklej jako tekst.');
          const next = structuredClone(m), target = next.materials.find(x => x.id === ref.id)!;
          const html = textToHtml(String(input.text ?? ''));
          target.version++; target.hash = hashHtml(html); target.size = html.length;
          store.versions[target.version] = html;
          next.log.push({at: Date.now(), text: `Nowa wersja materiału „${target.title}”: wersja ${target.version}.`, by: a.name});
          next.revision++;
          return json({meeting: this.view(this.put(next), a)});
        }
      }
      const fileMatch = rest.match(/^\/files\/(plik_[\w-]+)$/);
      if (fileMatch && method === 'GET') {
        // 5.2: dostęp według przeznaczenia pliku, jak na serwerze.
        const m = this.meetingFor(id, a);
        const row = this.fileRow(fileMatch[1], m.id) ?? fail('Nie znaleziono pliku.', 404);
        if (row.purpose === 'zlozone' && !canDownloadPaper(this.state.roster, m, a, 'protokol')) this.paperRefusal(m, a, 'protokol');
        if (row.purpose === 'zgloszenie') {
          const scope = canSeeWorkspace(this.state.roster, m, a);
          if (!scope || (scope === 'wlasne' && !this.prepFor(m).proposals.some(p => p.accountId === a.account.id && p.attachment?.id === row.id))) fail(PREP_REFUSALS.see, 403);
        }
        return this.sendFile(row);
      }
      return fail('Ta funkcja nie jest dostępna w wersji próbnej.', 404);
    } catch (error) {
      const status = error instanceof DomainError ? error.status : (error as {status?: number}).status ?? 500;
      if (status === 500) console.error(error);
      return json({error: status === 500 ? 'Nie udało się wykonać tej czynności. Odśwież stronę i spróbuj ponownie. Jeśli błąd się powtórzy, zgłoś go biuru.' : (error as Error).message}, status);
    }
  }

  private accountsForAdmin() {
    return this.accounts().map(u => {
      const c = this.state.contacts[u.id];
      return {...u, email: c?.email ?? null, emailState: c?.email ? c.state : 'brak', emailConfirmedAt: c?.confirmedAt ?? null, emailConfirmedBy: c?.confirmedBy ?? null};
    });
  }
  private attachmentOf(meetingId: string, id: string) {
    const row = this.state.files[id];
    return row && row.meetingId === meetingId && row.purpose === 'zgloszenie' ? {id: row.id, name: row.name, size: row.size} : null;
  }
  /** Plik wpisanego zgłoszenia trafia do materiałów punktu (B2-W04 pkt 3): w wersji próbnej tekst z TXT, PDF jako plik. */
  private attachProposalFile(m: Meeting, created: {attachmentId: string; itemId: string; title: string}, a: Actor): Meeting {
    const row = this.state.files[created.attachmentId], bytes = row ? this.blobs.get(row.id) : undefined;
    if (!row || !bytes) return m;
    const next = structuredClone(m);
    const html = row.mime === 'text/plain' ? textToHtml(new TextDecoder().decode(bytes)) : '';
    const ref: MaterialRef = {id: newId(), title: created.title, type: 'inny', number: '', version: 1, hash: hashHtml(html), size: html.length, fileId: row.mime === 'application/pdf' ? row.id : null, fileName: row.mime === 'application/pdf' ? row.name : null, createdAt: Date.now()};
    next.materials.push(ref);
    this.state.materials[ref.id] = {meetingId: m.id, versions: {1: html}};
    const it = next.agenda.find(i => i.id === created.itemId);
    if (it) it.materialIds = [...new Set([...it.materialIds, ref.id])];
    row.purpose = 'material';
    next.log.push({at: Date.now(), text: `Dodano materiał „${ref.title}”.`, by: a.name});
    return next;
  }
  private sendFile(row: DemoFileRow) {
    const bytes = this.bytesOf(row);
    const type = FILE_TYPES.has(row.mime) ? row.mime : 'application/octet-stream';
    return new Response(new Blob([bytes as BlobPart], {type}), {status: 200, headers: {'Content-Type': type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'}});
  }
}
