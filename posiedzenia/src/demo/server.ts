// Wersja próbna: ten sam przebieg posiedzenia co w aplikacji, ale „serwer” działa w przeglądarce.
// Przechwytuje zapytania /api/… i odpowiada na nie tymi samymi regułami z src/shared.
import {advance, apply, canView, createMeeting, DomainError, isOrganizer, secretCast, secretIssue, type Command, type Context} from '../shared/meeting.ts';
import {bytesToHex, fdhSync, hexToBytes, keyFingerprintSync, modPow, verifySignature} from '../shared/blind.ts';
import {sha256} from '../shared/sha256.ts';
import {summary, viewFor} from '../shared/view.ts';
import {textToHtml} from '../shared/text.ts';
import {personName} from '../shared/roster.ts';
import {minutesBody} from '../server/minutes.ts';
import type {Account, Actor, Choice, MaterialRef, MaterialType, Meeting, Roster} from '../shared/types.ts';
import {demoAccounts, demoMeetings, demoRoster} from './seed.ts';

interface Key { n: string; e: string; p: string; q: string; dp: string; dq: string; qi: string }
interface State {
  version: 1; roster: Roster; accounts: Account[]; current: string | null;
  meetings: Record<string, Meeting>; materials: Record<string, {meetingId: string; versions: Record<number, string>}>;
  keys: Record<string, Key>; secretVotes: Record<string, {t: string; c: Choice}[]>;
}
const STORE = 'posiedzenia-proba-v1';
const types: MaterialType[] = ['uchwala', 'rezolucja', 'oswiadczenie', 'deklaracja', 'apel', 'sprawozdanie', 'protokol', 'informacja', 'inny'];
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
    const state: State = {version: 1, roster: demoRoster, accounts: structuredClone(demoAccounts), current: null, meetings: {}, materials: {}, keys: {}, secretVotes: {}};
    for (const m of meetings) state.meetings[m.id] = m;
    for (const x of materials) state.materials[x.ref.id] = {meetingId: x.meetingId, versions: {1: x.html}};
    return state;
  }
  private load(): State | null {
    try { const raw = localStorage.getItem(STORE); const s = raw ? JSON.parse(raw) as State : null; return s?.version === 1 ? s : null; } catch { return null; }
  }
  private save() { try { localStorage.setItem(STORE, JSON.stringify(this.state)); } catch { /* bez zapisu — próba działa do zamknięcia strony */ } }
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
      roster: this.state.roster, now: Date.now(), newId,
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

  minutes(id: string) {
    const actor = this.actor() ?? fail('Wybierz osobę.', 401);
    return minutesBody(this.meetingFor(id, actor), this.state.roster, this.state.accounts, Date.now());
  }

  // Skróty próby: obecność wszystkich i głosy pozostałych osób.
  everyonePresent(meetingId: string) {
    let m = this.state.meetings[meetingId];
    if (!m || m.kind !== 'posiedzenie' || (m.status !== 'trwa' && m.status !== 'przerwa')) return 'Najpierw otwórz posiedzenie.';
    for (const ms of this.state.roster.memberships.filter(x => x.organ === m.organ)) {
      if (m.attendance[ms.personId] !== 'obecny') m = apply(m, {type: 'presence', who: ms.personId, present: true}, this.actorFor(ms.personId), this.context());
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
        if (b!.status !== 'otwarte') fail('Głosowanie zostało zakończone przed przyjęciem głosu.', 409);
        list.push({t, c: input.choice});
        try { this.put(secretCast(m, b!.id, this.context())); } catch (error) { list.pop(); throw error; }
        return json({ok: true});
      }
      const actor = this.actor();
      if (path === '/api/session') return json({account: actor?.account ?? null, setupRequired: false, roster: this.state.roster, version: 'proba'});
      if (path === '/api/login' && method === 'POST') {
        const account = this.state.accounts.find(a => a.username === input.username && !a.disabled) ?? fail('Nie ma takiej osoby w wersji próbnej.', 401);
        this.state.current = account.id; this.save();
        return json({account});
      }
      if (path === '/api/logout') { this.state.current = null; this.save(); return json({ok: true}); }
      if (!actor) fail('Wybierz osobę.', 401);
      const a = actor!;
      if (path === '/api/password') return json({account: a.account});
      if (path === '/api/people') return json({accounts: this.state.accounts.filter(x => !x.disabled).map(x => ({id: x.id, displayName: x.displayName, label: x.label, kind: x.kind, personId: x.personId}))});
      if (path === '/api/accounts') {
        if (!a.account.admin) fail('Ta czynność wymaga uprawnień administratora.', 403);
        if (method === 'POST') {
          if (!/^[a-z0-9._-]{3,64}$/.test(input.username ?? '')) fail('Login musi mieć od 3 do 64 znaków. Użyj małych liter bez polskich znaków, cyfr, kropki, myślnika lub podkreślenia.');
          if (this.state.accounts.some(x => x.username === input.username)) fail('Ten login jest już zajęty.', 409);
          if (input.kind === 'czlonek') fail('Członkowie mają już konta w wersji próbnej.');
          this.state.accounts.push({id: 'a-' + newId(), username: input.username, kind: input.kind, personId: null, displayName: String(input.displayName || input.username), label: String(input.label ?? ''), admin: !!input.admin, mustChange: false, disabled: false});
        }
        if (method === 'PATCH') {
          const target = this.state.accounts.find(x => x.id === input.id) ?? fail('Nie znaleziono konta.', 404);
          if (target.id === a.account.id && (input.disabled !== undefined || input.admin !== undefined)) fail('Nie można zablokować własnego konta ani odebrać sobie uprawnień.');
          if (typeof input.disabled === 'boolean') target.disabled = input.disabled;
          if (typeof input.admin === 'boolean') target.admin = input.admin;
        }
        this.save();
        return json({accounts: this.state.accounts}, method === 'POST' ? 201 : 200);
      }
      if (path === '/api/meetings' && method === 'GET') {
        return json({meetings: Object.values(this.state.meetings).filter(m => canView(this.state.roster, m, a)).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time)).map(summary)});
      }
      if (path === '/api/meetings' && method === 'POST') {
        const kind = input.kind === 'procedura' ? 'procedura' : 'posiedzenie';
        const m = createMeeting({id: newId(), organ: 'prezydium', kind, title: String(input.title || (kind === 'posiedzenie' ? 'Posiedzenie Prezydium (próbne)' : 'Głosowanie między posiedzeniami (próbne)')),
          date: /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10), time: /^\d{2}:\d{2}$/.test(input.time) ? input.time : '10:00',
          place: String(input.place ?? ''), mode: kind === 'procedura' ? 'zdalne' : input.mode === 'zdalne' ? 'zdalne' : 'stacjonarne', createdBy: a.name, now: Date.now(), newId, endsAt: Number(input.endsAt) || undefined});
        if (!isOrganizer(this.state.roster, m, a)) fail('Posiedzenie przygotowuje biuro, przewodniczący lub wiceprzewodniczący.', 403);
        return json({meeting: viewFor(this.put(m), a)}, 201);
      }
      const mm = path.match(/^\/api\/meetings\/([\w-]+)(\/.*)?$/);
      if (!mm) fail('Nie znaleziono tej funkcji.', 404);
      const id = mm![1], rest = mm![2] ?? '';
      if (rest === '' && method === 'GET') {
        const m = this.meetingFor(id, a), etag = `"${m.revision}-${a.account.id}"`;
        if (headers.get('If-None-Match') === etag) return new Response(null, {status: 304, headers: {ETag: etag, 'X-Server-Now': String(Date.now())}});
        return json({meeting: viewFor(m, a)}, 200, {ETag: etag});
      }
      if (rest === '' && method === 'DELETE') {
        const m = this.meetingFor(id, a);
        if (!isOrganizer(this.state.roster, m, a) || m.status !== 'przygotowanie') fail('Usunąć można tylko nierozpoczęte posiedzenie. Robi to organizator.', 403);
        delete this.state.meetings[id]; this.save();
        return json({ok: true});
      }
      if (rest === '/command' && method === 'POST') {
        return json({meeting: viewFor(this.put(apply(this.meetingFor(id, a), input as Command, a, this.context())), a)});
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
        if (!isOrganizer(this.state.roster, m, a) && m.chair.current !== a.personId) fail('Materiały dodaje organizator lub prowadzący.', 403);
        const text = String(input.text ?? '');
        if (!text.trim()) fail('Wklej treść materiału.');
        const html = textToHtml(text), title = String(input.title ?? '').trim() || 'Materiał';
        const ref: MaterialRef = {id: newId(), title, type: types.includes(input.type) ? input.type : 'inny', number: String(input.number ?? ''), version: 1, hash: hashHtml(html), size: html.length, fileId: null, fileName: null, createdAt: Date.now()};
        m.materials.push(ref);
        this.state.materials[ref.id] = {meetingId: m.id, versions: {1: html}};
        const item = m.agenda.find(i => i.id === input.itemId);
        if (item) item.materialIds.push(ref.id);
        m.log.push({at: Date.now(), text: `Dodano materiał „${title}”.`, by: a.name});
        m.revision++;
        return json({meeting: viewFor(this.put(m), a), created: [ref.id]}, 201);
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
          if (!isOrganizer(this.state.roster, m, a) || m.status !== 'przygotowanie') fail('Materiał usuwa organizator przed otwarciem posiedzenia.', 403);
          const next = structuredClone(m);
          next.materials = next.materials.filter(x => x.id !== ref.id);
          for (const it of next.agenda) it.materialIds = it.materialIds.filter(x => x !== ref.id);
          next.revision++;
          return json({meeting: viewFor(this.put(next), a)});
        }
        if (mat[2] && method === 'POST') {
          if (init?.body instanceof FormData) fail('W wersji próbnej nową wersję wklej jako tekst.');
          const next = structuredClone(m), target = next.materials.find(x => x.id === ref.id)!;
          const html = textToHtml(String(input.text ?? ''));
          target.version++; target.hash = hashHtml(html); target.size = html.length;
          store.versions[target.version] = html;
          next.revision++;
          return json({meeting: viewFor(this.put(next), a)});
        }
      }
      return fail('Ta funkcja nie jest dostępna w wersji próbnej.', 404);
    } catch (error) {
      const status = error instanceof DomainError ? error.status : (error as {status?: number}).status ?? 500;
      if (status === 500) console.error(error);
      return json({error: status === 500 ? 'Nie udało się wykonać działania.' : (error as Error).message}, status);
    }
  }
}
