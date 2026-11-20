// Wersja próbna: ten sam przebieg posiedzenia co w aplikacji, ale „serwer” działa w przeglądarce.
// Przechwytuje zapytania /api/… i odpowiada na nie tymi samymi regułami z src/shared.
import {advance, advisoryIds, apply, canView, DomainError, duplicateMeeting, newMeetingFromSettings, secretCast, secretIssue, type Command, type Context} from '../shared/meeting.ts';
import {defaultDocTypes, docTypeInput, lockedDocTypeRefusal, sortedDocTypes} from '../shared/doctypes.ts';
import {migrateDocTypesV3, migrateMeeting, migrateMeetingV3, migrationNotesV3} from '../shared/migrate.ts';
import {applyCompositionChange, applySettingsChange, docTypeAudit, organSettingsOf, type AuditEntry, type GeneralBundle, type GeneralSettings, type SettingsArea, type SettingsChange} from '../shared/settings.ts';
import {canCreate, canPrepare, canReadMinutes, isOfficeAccount, isPresiding, minutesRefusal, settingsAccess} from '../shared/role.ts';
import {cascadeEnv, othersOf} from '../shared/cascade.ts';
import {isLockedDocType, LAW} from '../shared/law.ts';
import {isoDayOf} from '../shared/text.ts';
import {bytesToHex, fdhSync, hexToBytes, keyFingerprintSync, modPow, verifySignature} from '../shared/blind.ts';
import {sha256} from '../shared/sha256.ts';
import {seesUnannounced, summary, viewFor} from '../shared/view.ts';
import {textToHtml} from '../shared/text.ts';
import {personName} from '../shared/roster.ts';
import {minutesBody, minutesTitle} from '../server/minutes.ts';
import {brand} from '../client/brand.ts';
import type {Account, Actor, Choice, DocType, ItemKind, MaterialRef, MaterialType, Meeting, OrganCode, Roster} from '../shared/types.ts';
import {demoAccounts, demoGeneral, demoMeetings, demoRoster} from './seed.ts';

interface Key { n: string; e: string; p: string; q: string; dp: string; dq: string; qi: string }
interface State {
  version: 1; roster: Roster; accounts: Account[]; current: string | null;
  meetings: Record<string, Meeting>; materials: Record<string, {meetingId: string; versions: Record<number, string>}>;
  keys: Record<string, Key>; secretVotes: Record<string, {t: string; c: Choice}[]>;
  /** Słownik rodzajów dokumentów (F11); stan zapisany przed wersją 2 dostaje wartości domyślne przy wczytaniu. */
  docTypes: DocType[];
  /** Wersja 3: ustawienia ogólne, historia zmian, rewizja ustawień i znacznik jednorazowej migracji. */
  general: GeneralSettings; audit: AuditEntry[]; revision: number; v3?: true;
}
const STORE = 'posiedzenia-proba-v1';
const encoder = new TextEncoder();
const hashHtml = (html: string) => bytesToHex(sha256(encoder.encode(html)));
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(16).slice(2) + Date.now().toString(16));
const fail = (message: string, status = 400): never => { throw new DomainError(message, status); };
const b64hex = (s: string) => bytesToHex(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)));

export class DemoServer {
  state: State;
  private pool: Key[] = [];
  private filling = false;

  constructor() {
    this.state = this.load() ?? this.fresh();
    this.refill();
    setInterval(() => this.tick(), 1000);
  }

  private fresh(): State {
    const now = Date.now();
    const {meetings, materials} = demoMeetings(now, newId, hashHtml);
    const state: State = {version: 1, roster: structuredClone(demoRoster), accounts: structuredClone(demoAccounts), current: null, meetings: {}, materials: {}, keys: {}, secretVotes: {}, docTypes: structuredClone(defaultDocTypes),
      general: demoGeneral(), audit: [], revision: 1, v3: true};
    for (const m of meetings) state.meetings[m.id] = m;
    for (const x of materials) state.materials[x.ref.id] = {meetingId: x.meetingId, versions: {1: x.html}};
    return state;
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
  private bundle(): GeneralBundle { return {general: this.state.general, docTypes: this.state.docTypes, revision: this.state.revision}; }
  private record(entries: Omit<AuditEntry, 'id'>[]) {
    const out = entries.map((e, i) => ({...e, id: this.state.audit.length + i + 1}));
    this.state.audit.push(...out);
    if (this.state.audit.length > 2000) this.state.audit.splice(0, this.state.audit.length - 2000);
    return out;
  }
  reset() { this.state = this.fresh(); this.save(); }

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

  private context(): Context {
    return {
      roster: this.state.roster, now: Date.now(), newId, docTypes: this.state.docTypes,
      general: this.bundle(), law: LAW, accounts: this.state.accounts,
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
  private actor(): Actor | null {
    const account = this.state.accounts.find(a => a.id === this.state.current && !a.disabled);
    if (!account) return null;
    return {account, personId: account.personId, name: account.personId ? personName(this.state.roster, account.personId) : account.displayName};
  }
  private actorFor(personId: string): Actor {
    const account = this.state.accounts.find(a => a.personId === personId)!;
    return {account, personId, name: personName(this.state.roster, personId)};
  }
  private tick() {
    let changed = false;
    for (const m of Object.values(this.state.meetings)) {
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
  private put(m: Meeting) { this.state.meetings[m.id] = m; this.save(); return m; }
  private view(m: Meeting, a: Actor) {
    const others = othersOf(m, Object.values(this.state.meetings));
    const last = [...this.state.audit].reverse().find(e => e.area === 'sklad' && e.organ === m.organ);
    const env = cascadeEnv({roster: this.state.roster, bundle: this.bundle(), organ: m.organ, accounts: this.state.accounts, law: LAW,
      composition: last ? {at: last.at, text: (last.basis ?? '').split(' ')[0]?.toLocaleLowerCase('pl') || last.after} : null, ...others});
    return viewFor(m, a, this.state.roster, env);
  }
  // F11: rodzaj materiału ze słownika, włączony; bez rodzaju „inny”, jak dotąd w wersji próbnej.
  private materialType(raw: unknown): MaterialType {
    const wanted = typeof raw === 'string' ? raw.trim() : '';
    if (!wanted) return 'inny';
    const found = this.state.docTypes.find(t => t.id === wanted) ?? fail('Nieznany rodzaj dokumentu. Wybierz rodzaj z listy.');
    if (!found.active) fail('Ten rodzaj dokumentu jest wyłączony. Wybierz inny rodzaj.');
    return found.id;
  }

  minutes(id: string) {
    const actor = this.actor() ?? fail('Wybierz osobę.', 401);
    const m = this.meetingFor(id, actor);
    if (!canReadMinutes(this.state.roster, m, actor)) fail(minutesRefusal, 403);
    return minutesBody(m, this.state.roster, this.state.accounts, Date.now(), {office: brand.officeLower, regulation: brand.regulation},
      {docTypes: this.state.docTypes, hideUnannounced: !seesUnannounced(m, actor, this.state.roster)});
  }

  minutesTitle(id: string) {
    const actor = this.actor() ?? fail('Wybierz osobę.', 401);
    return minutesTitle(this.meetingFor(id, actor));
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
    let input: any = {};
    if (typeof init?.body === 'string') { try { input = JSON.parse(init.body); } catch { return json({error: 'Nieprawidłowy format JSON.'}, 400); } }
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
        return json({account: actor?.account ?? null, setupRequired: false, roster: this.state.roster, version: 'proba',
          docTypes: actor ? sortedDocTypes(this.state.docTypes) : null, general: access?.general ? this.bundle() : null});
      }
      if (path === '/api/login' && method === 'POST') {
        const account = this.state.accounts.find(a => a.username === input.username && !a.disabled) ?? fail('Nie ma takiej osoby w wersji próbnej.', 401);
        this.state.current = account.id; this.save();
        return json({account});
      }
      if (path === '/api/logout') { this.state.current = null; this.save(); return json({ok: true}); }
      if (!actor) fail('Wybierz osobę.', 401);
      const a = actor!;
      if (path === '/api/password') return json({account: a.account});
      if (path === '/api/people') {
        const presiding = !!a.personId && Object.values(this.state.meetings).some(m => (m.status === 'trwa' || m.status === 'przerwa') && m.chair.current === a.personId);
        const organizer = canCreate(this.state.roster, 'prezydium', a) || presiding;
        return json({accounts: organizer ? this.state.accounts.filter(x => !x.disabled).map(x => ({id: x.id, displayName: x.displayName, label: x.label, kind: x.kind, personId: x.personId})) : []});
      }
      if (path === '/api/accounts') {
        if (!a.account.admin) fail('Ta czynność wymaga uprawnień administratora.', 403);
        if (method === 'POST') {
          if (!/^[a-z0-9._-]{3,64}$/.test(input.username ?? '')) fail('Login musi mieć od 3 do 64 znaków. Użyj małych liter bez polskich znaków, cyfr, kropki, myślnika lub podkreślenia.');
          if (this.state.accounts.some(x => x.username === input.username)) fail('Ten login jest już zajęty. Wpisz inny login.', 409);
          if (input.kind === 'czlonek') fail('Członkowie mają już konta w wersji próbnej.');
          const account: Account = {id: 'a-' + newId(), username: input.username, kind: input.kind, personId: null, displayName: String(input.displayName || input.username), label: String(input.label ?? ''), admin: !!input.admin, mustChange: false, disabled: false};
          this.state.accounts.push(account);
          this.record([{at: Date.now(), accountId: a.account.id, actor: a.name, area: 'konta', key: `konto:${account.id}`, label: `Konto ${account.displayName}`, before: 'brak', after: `login ${account.username}`}]);
          // DA-5: osoba z głosem doradczym jest zaproszona na każde posiedzenie w przygotowaniu.
          if (account.kind === 'doradczy') {
            for (const m of Object.values(this.state.meetings)) {
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
          this.record(entries);
        }
        this.save();
        return json({accounts: this.state.accounts}, method === 'POST' ? 201 : 200);
      }
      if (path === '/api/meetings' && method === 'GET') {
        return json({meetings: Object.values(this.state.meetings).filter(m => canView(this.state.roster, m, a)).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time)).map(summary)});
      }
      if (path === '/api/meetings' && method === 'POST') {
        // Wersja 3: ta sama funkcja domeny co na serwerze (wzór posiedzenia, ustawienia ogólne, G-12, DA-5).
        const m = newMeetingFromSettings({
          id: newId(), kind: input.kind === 'procedura' ? 'procedura' : 'posiedzenie', organ: input.organ, template: input.template ? String(input.template) : undefined,
          title: input.title ? String(input.title) : undefined, date: input.date, time: input.time, place: input.place === undefined ? undefined : String(input.place),
          mode: input.mode, endsAt: Number(input.endsAt) || undefined, actor: a,
        }, this.context());
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
          const used = Object.values(this.state.meetings).some(m => m.materials.some(x => x.type === id) || m.ballots.some(b => b.docType === id) || m.agenda.some(i => i.docType === id));
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
        if (!isOfficeAccount(a)) fail('Ustawienia ogólne zmienia biuro.', 403);
        const {bundle, audit} = applySettingsChange(this.bundle(), input?.change as SettingsChange, {actor: a, now: Date.now(), roster: this.state.roster});
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
        const all: SettingsArea[] = ['siedziba', 'organ', 'wzory', 'rodzaje_dokumentow', 'rodzaje_spraw', 'sklad', 'konta', 'posiedzenia'];
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
        const m = this.meetingFor(id, a), etag = `"${m.revision}-${this.state.revision}-${a.account.id}"`;
        if (headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers: {ETag: etag, 'X-Server-Now': String(Date.now())}});
        return json({meeting: this.view(m, a)}, 200, {ETag: etag});
      }
      if (rest === '' && method === 'DELETE') {
        const m = this.meetingFor(id, a);
        if (!canCreate(this.state.roster, m.organ, a) || m.status !== 'przygotowanie') fail('Usunąć można tylko nierozpoczęte posiedzenie. Usuwa je biuro, przewodniczący albo wiceprzewodniczący.', 403);
        delete this.state.meetings[id];
        this.record([{at: Date.now(), accountId: a.account.id, actor: a.name, area: 'posiedzenia', organ: m.organ, key: `posiedzenie:${m.id}`, label: `Posiedzenie „${m.title}” z dnia ${m.date.split('-').reverse().join('.')}`, before: 'w przygotowaniu', after: 'usunięte'}]);
        this.save();
        return json({ok: true});
      }
      if (rest === '/command' && method === 'POST') {
        return json({meeting: this.view(this.put(apply(this.meetingFor(id, a), input as Command, a, this.context())), a)});
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
      if (rest === '/protokol') return new Response(this.minutes(id), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      if (rest === '/materials' && method === 'POST') {
        if (init?.body instanceof FormData) fail('W wersji próbnej dodaj materiał przyciskiem „Wklej tekst”. Pliki Word i PDF obsługuje pełna aplikacja.');
        const m = structuredClone(this.meetingFor(id, a));
        if (m.status === 'zakonczone') fail('Posiedzenie zostało zamknięte.');
        const editor = m.status === 'przygotowanie' ? canPrepare(this.state.roster, m, a) : isOfficeAccount(a) || isPresiding(m, a);
        if (!editor) fail('Materiały dodaje biuro albo osoba prowadząca obrady.', 403);
        const text = String(input.text ?? '');
        if (!text.trim()) fail('Wklej treść materiału.');
        const html = textToHtml(text), title = String(input.title ?? '').trim() || 'Materiał';
        const ref: MaterialRef = {id: newId(), title, type: this.materialType(input.type), number: String(input.number ?? ''), version: 1, hash: hashHtml(html), size: html.length, fileId: null, fileName: null, createdAt: Date.now()};
        m.materials.push(ref);
        this.state.materials[ref.id] = {meetingId: m.id, versions: {1: html}};
        const item = m.agenda.find(i => i.id === input.itemId);
        if (item) item.materialIds.push(ref.id);
        m.log.push({at: Date.now(), text: `Dodano materiał „${title}”.`, by: a.name});
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
          if (!(m.status === 'przygotowanie' ? canPrepare(this.state.roster, m, a) : isOfficeAccount(a) || isPresiding(m, a))) fail('Materiały dodaje biuro albo osoba prowadząca obrady.', 403);
          if (init?.body instanceof FormData) fail('W wersji próbnej nową wersję wklej jako tekst.');
          const next = structuredClone(m), target = next.materials.find(x => x.id === ref.id)!;
          const html = textToHtml(String(input.text ?? ''));
          target.version++; target.hash = hashHtml(html); target.size = html.length;
          store.versions[target.version] = html;
          next.revision++;
          return json({meeting: this.view(this.put(next), a)});
        }
      }
      return fail('Ta funkcja nie jest dostępna w wersji próbnej.', 404);
    } catch (error) {
      const status = error instanceof DomainError ? error.status : (error as {status?: number}).status ?? 500;
      if (status === 500) console.error(error);
      return json({error: status === 500 ? 'Nie udało się wykonać tej czynności. Odśwież stronę i spróbuj ponownie. Jeśli błąd się powtórzy, zgłoś go biuru.' : (error as Error).message}, status);
    }
  }
}
