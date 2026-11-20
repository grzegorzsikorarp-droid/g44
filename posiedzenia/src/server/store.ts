import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Account, DocType, Meeting, Membership, Organ, OrganCode, Roster} from '../shared/types.ts';
import {defaultDocTypes} from '../shared/doctypes.ts';
import {migrateDocTypesV3, migrateMeeting, migrateMeetingV3, migrationNotesV3} from '../shared/migrate.ts';
import {defaultGeneral, defaultOrganSettings, type AuditEntry, type CaseType, type GeneralBundle, type GeneralSettings, type OrganSettings, type SettingsArea, type SiteSettings} from '../shared/settings.ts';
import {LAW} from '../shared/law.ts';
import {cascadeEnv} from '../shared/cascade.ts';
import {councilMemberLabel, presidiumBasis, presidiumSince, seedOrganForms, seedRoster, seedSite} from './seed.ts';

const schema = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organs(code TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS persons(id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memberships(
  organ TEXT NOT NULL, person_id TEXT NOT NULL REFERENCES persons(id), func TEXT NOT NULL,
  label TEXT NOT NULL, ord INTEGER NOT NULL, can_chair INTEGER NOT NULL, PRIMARY KEY(organ, person_id));
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, kind TEXT NOT NULL,
  person_id TEXT UNIQUE REFERENCES persons(id), display_name TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  admin INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meetings(
  id TEXT PRIMARY KEY, organ TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, date TEXT NOT NULL,
  data TEXT NOT NULL, revision INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS material_versions(
  material_id TEXT NOT NULL, version INTEGER NOT NULL, meeting_id TEXT NOT NULL, html TEXT NOT NULL,
  hash TEXT NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL, created_by TEXT NOT NULL,
  PRIMARY KEY(material_id, version));
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS secret_keys(ballot_id TEXT PRIMARY KEY, private_pem TEXT NOT NULL, n TEXT NOT NULL, e TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS secret_votes(ballot_id TEXT NOT NULL, token_hash TEXT NOT NULL, choice TEXT NOT NULL, PRIMARY KEY(ballot_id, token_hash)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS doc_types(id TEXT PRIMARY KEY, name TEXT NOT NULL, adopted TEXT NOT NULL, rejected TEXT NOT NULL, voted INTEGER NOT NULL, ord INTEGER NOT NULL, active INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(scope TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, account_id TEXT NOT NULL, actor TEXT NOT NULL,
  area TEXT NOT NULL, organ TEXT, key TEXT NOT NULL, label TEXT NOT NULL, before TEXT NOT NULL, after TEXT NOT NULL, basis TEXT);
`;
// Wersja 3: kolumny dodawane do tabel ze starszych wersji tylko wtedy, gdy ich brak (PRAGMA table_info).
const columnsV3: [string, string, string][] = [
  ['doc_types', 'in_acts', 'INTEGER NOT NULL DEFAULT 0'],
  ['memberships', 'since', "TEXT NOT NULL DEFAULT ''"],
  ['memberships', 'basis', "TEXT NOT NULL DEFAULT ''"],
  ['organs', 'forms', "TEXT NOT NULL DEFAULT '{}'"],
];
/** Filtr historii zmian ustawień: obszar albo lista obszarów, konto, kursor (identyfikator) i liczba wpisów. */
export interface HistoryFilter { areas?: SettingsArea[]; area?: SettingsArea; accountId?: string; before?: number; limit?: number }
const organCodes: OrganCode[] = ['prezydium', 'rada', 'zjazd'];

export interface UserRow {
  id: string; username: string; password: string; kind: Account['kind']; person_id: string | null;
  display_name: string; label: string; admin: number; must_change: number; disabled: number; created: number;
}

export const accountView = (row: UserRow): Account => ({
  id: row.id, username: row.username, kind: row.kind, personId: row.person_id, displayName: row.display_name,
  label: row.label, admin: !!row.admin, mustChange: !!row.must_change, disabled: !!row.disabled,
});

export class Store {
  db: DatabaseSync;
  dir: string;
  private cache = new Map<string, Meeting>();
  private rosterCache: Roster | null = null;
  private docTypeCache: DocType[] | null = null;
  private generalCache: GeneralBundle | null = null;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, 'files'), {recursive: true});
    this.db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'));
    // secure_delete: usunięte dane (np. klucze tajnych głosowań) są nadpisywane zerami.
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(schema);
    for (const [table, column, type] of columnsV3) {
      const columns = (this.db.prepare(`PRAGMA table_info(${table})`).all() as {name: string}[]).map(c => c.name);
      if (!columns.includes(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
    if (!this.db.prepare('SELECT 1 FROM persons LIMIT 1').get()) this.seed(seedRoster);
    // Jednorazowa zamiana etykiety składu w bazie utworzonej przed zmianą: skrót „Członek ORPiP” na pełną nazwę organu.
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'etykieta-skladu'").get()) {
      this.db.prepare("UPDATE memberships SET label = ? WHERE label = 'Członek ORPiP'").run(councilMemberLabel);
      this.db.prepare("INSERT INTO meta(key, value) VALUES ('etykieta-skladu', '1')").run();
    }
    // Wersja 2 (F11): słownik rodzajów dokumentów z wartościami domyślnymi, wpisany raz przy pierwszym starcie.
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'rodzaje-dokumentow'").get()) {
      this.transaction(() => {
        for (const t of defaultDocTypes) this.db.prepare('INSERT OR IGNORE INTO doc_types(id,name,adopted,rejected,voted,ord,active,in_acts) VALUES (?,?,?,?,?,?,?,?)').run(t.id, t.name, t.adopted, t.rejected, t.voted ? 1 : 0, t.order, t.active ? 1 : 0, t.inActs ? 1 : 0);
        this.db.prepare("INSERT INTO meta(key, value) VALUES ('rodzaje-dokumentow', '1')").run();
      });
    }
  }

  private seed(roster: Roster) {
    this.transaction(() => {
      for (const o of roster.organs) this.db.prepare('INSERT INTO organs(code,name,short_name,active,forms) VALUES (?,?,?,?,?)').run(o.code, o.name, o.shortName, o.active ? 1 : 0, JSON.stringify(o.forms));
      for (const p of roster.persons) this.db.prepare('INSERT INTO persons VALUES (?,?,?)').run(p.id, p.name, p.sortName);
      for (const m of roster.memberships) this.insertMembership(m);
    });
  }
  private insertMembership(m: Membership) {
    this.db.prepare('INSERT INTO memberships(organ,person_id,func,label,ord,can_chair,since,basis) VALUES (?,?,?,?,?,?,?,?)')
      .run(m.organ, m.personId, m.func, m.label, m.order, m.canChair ? 1 : 0, m.since ?? '', m.basis ? JSON.stringify(m.basis) : '');
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); this.cache.clear(); this.docTypeCache = null; this.rosterCache = null; this.generalCache = null; throw error; }
  }

  roster(): Roster {
    if (this.rosterCache) return this.rosterCache;
    const forms = (code: OrganCode, raw: string) => {
      try { const f = JSON.parse(raw || '{}'); if (f && f.genitive) return f; } catch { /* nazwy z danych wzorcowych */ }
      return seedOrganForms[code];
    };
    const organs: Organ[] = (this.db.prepare('SELECT * FROM organs').all() as any[]).map(o => ({code: o.code, name: o.name, shortName: o.short_name, active: !!o.active, forms: forms(o.code, o.forms)}));
    const persons = (this.db.prepare('SELECT * FROM persons ORDER BY sort_name').all() as any[]).map(p => ({id: p.id, name: p.name, sortName: p.sort_name}));
    const memberships: Membership[] = (this.db.prepare('SELECT * FROM memberships ORDER BY organ, ord').all() as any[]).map(m => {
      const out: Membership = {organ: m.organ, personId: m.person_id, func: m.func, label: m.label, order: m.ord, canChair: !!m.can_chair};
      if (m.since) out.since = m.since;
      if (m.basis) { try { out.basis = JSON.parse(m.basis); } catch { /* pusta podstawa */ } }
      return out;
    });
    return this.rosterCache = {organs, persons, memberships};
  }

  docTypes(): DocType[] {
    if (this.docTypeCache) return this.docTypeCache;
    const rows = this.db.prepare('SELECT * FROM doc_types ORDER BY ord, name').all() as any[];
    return this.docTypeCache = rows.map(r => ({id: r.id, name: r.name, adopted: r.adopted, rejected: r.rejected, voted: !!r.voted, order: Number(r.ord), active: !!r.active, inActs: !!r.in_acts}));
  }
  saveDocType(t: DocType) {
    this.db.prepare(`INSERT INTO doc_types(id,name,adopted,rejected,voted,ord,active,in_acts) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, adopted=excluded.adopted,
      rejected=excluded.rejected, voted=excluded.voted, ord=excluded.ord, active=excluded.active, in_acts=excluded.in_acts`).run(t.id, t.name, t.adopted, t.rejected, t.voted ? 1 : 0, t.order, t.active ? 1 : 0, t.inActs ? 1 : 0);
    this.docTypeCache = null;
    this.generalCache = null;
  }
  deleteDocType(id: string) {
    this.db.prepare('DELETE FROM doc_types WHERE id=?').run(id);
    this.docTypeCache = null;
    this.generalCache = null;
  }

  // Wersja 3: ustawienia ogólne (zakresy 'siedziba', 'organ:{kod}', 'rodzaje-spraw'), rewizja i historia zmian.
  private setting<T>(scope: string): T | undefined {
    const row = this.db.prepare('SELECT data FROM settings WHERE scope=?').get(scope) as {data: string} | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.data) as T; } catch { return undefined; }
  }
  /** Pakiet ustawień ogólnych: ustawienia, słownik rodzajów dokumentów i rewizja wszystkiego, co zmienia biuro. */
  general(): GeneralBundle {
    if (this.generalCache) return this.generalCache;
    const base = defaultGeneral(this.setting<SiteSettings>('siedziba') ?? seedSite);
    const organs: GeneralSettings['organs'] = {};
    for (const code of organCodes) {
      const saved = this.setting<OrganSettings>(`organ:${code}`);
      if (saved) organs[code] = saved; else if (base.organs[code]) organs[code] = base.organs[code];
    }
    const general: GeneralSettings = {site: base.site, organs, caseTypes: this.setting<CaseType[]>('rodzaje-spraw') ?? []};
    return this.generalCache = {general, docTypes: this.docTypes(), revision: this.revision()};
  }
  saveSettings(scope: string, data: unknown) {
    this.db.prepare('INSERT INTO settings(scope,data,updated) VALUES (?,?,?) ON CONFLICT(scope) DO UPDATE SET data=excluded.data, updated=excluded.updated')
      .run(scope, JSON.stringify(data), Date.now());
    this.generalCache = null;
  }
  /** Zapisuje cały pakiet ustawień ogólnych (bez słownika rodzajów, który ma własną tabelę). */
  saveGeneral(general: GeneralSettings) {
    this.saveSettings('siedziba', general.site);
    for (const code of organCodes) if (general.organs[code]) this.saveSettings(`organ:${code}`, general.organs[code]);
    this.saveSettings('rodzaje-spraw', general.caseTypes);
  }
  revision(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key='settings-revision'").get() as {value: string} | undefined;
    return row ? Number(row.value) || 0 : 0;
  }
  bumpRevision() {
    const next = this.revision() + 1;
    this.db.prepare("INSERT INTO meta(key, value) VALUES ('settings-revision', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(next));
    this.generalCache = null;
    return next;
  }
  audit(entries: Omit<AuditEntry, 'id'>[]): AuditEntry[] {
    return entries.map(e => {
      const result = this.db.prepare('INSERT INTO audit(at,account_id,actor,area,organ,key,label,before,after,basis) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(e.at, e.accountId, e.actor, e.area, e.organ ?? null, e.key, e.label, e.before, e.after, e.basis ?? null);
      return {...e, id: Number(result.lastInsertRowid)};
    });
  }
  history(filter: HistoryFilter = {}): {entries: AuditEntry[]; next: number | null} {
    const where: string[] = [], args: (string | number)[] = [];
    const areas = filter.area ? [filter.area] : filter.areas;
    if (areas) { where.push(`area IN (${areas.map(() => '?').join(',') || "''"})`); args.push(...areas); }
    if (filter.accountId) { where.push('account_id=?'); args.push(filter.accountId); }
    if (filter.before) { where.push('id<?'); args.push(filter.before); }
    const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 200);
    const rows = this.db.prepare(`SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1) as any[];
    const entries: AuditEntry[] = rows.slice(0, limit).map(r => ({
      id: Number(r.id), at: Number(r.at), accountId: r.account_id, actor: r.actor, area: r.area, ...(r.organ ? {organ: r.organ} : {}),
      key: r.key, label: r.label, before: r.before, after: r.after, ...(r.basis ? {basis: r.basis} : {}),
    }));
    return {entries, next: rows.length > limit ? entries.at(-1)!.id : null};
  }
  /** Ostatnia zmiana składu organu z historii (do przeglądu przed otwarciem, D-14). */
  lastComposition(organ: OrganCode): {at: number; text: string} | null {
    const row = this.db.prepare("SELECT at, basis, after FROM audit WHERE area='sklad' AND organ=? ORDER BY id DESC LIMIT 1").get(organ) as {at: number; basis: string | null; after: string} | undefined;
    if (!row) return null;
    const basis = (row.basis ?? '').split(' ')[0]?.toLocaleLowerCase('pl') ?? '';
    return {at: Number(row.at), text: basis || row.after};
  }
  /** Zapisuje skład organu (osoby, członkostwa) i jego ustawienia po zmianie składu (wersja 3). */
  saveComposition(roster: Roster, organ: OrganCode, settings: OrganSettings) {
    for (const p of roster.persons) this.db.prepare('INSERT OR IGNORE INTO persons VALUES (?,?,?)').run(p.id, p.name, p.sortName);
    this.db.prepare('DELETE FROM memberships WHERE organ=?').run(organ);
    for (const m of roster.memberships.filter(x => x.organ === organ)) this.insertMembership(m);
    this.saveSettings(`organ:${organ}`, settings);
    this.rosterCache = null;
  }

  /**
   * Jednorazowa migracja do wersji 3 (rozdz. 2.10) pod kluczem meta 'ustawienia-v3': ustawienia ogólne z wartościami
   * z danych startowych, nazwy organów, podstawa składu Prezydium, rodzaje dokumentów (wykaz aktów, formy aktów),
   * wpisy historii o rolach i posiedzenia (zamrożenie `legacy`, zastępstwo wpisane przez biuro, osoby z głosem
   * doradczym, brakujące punkty porządku). Każde zmienione posiedzenie zapisuje się od razu. Zwraca true przy migracji.
   */
  migrateV3(now: number): boolean {
    if (this.db.prepare("SELECT 1 FROM meta WHERE key='ustawienia-v3'").get()) return false;
    this.transaction(() => {
      if (!this.setting('siedziba')) this.saveSettings('siedziba', seedSite);
      if (!this.setting('organ:prezydium')) this.saveSettings('organ:prezydium', defaultOrganSettings);
      if (!this.setting('rodzaje-spraw')) this.saveSettings('rodzaje-spraw', []);
      for (const code of organCodes) this.db.prepare("UPDATE organs SET forms=? WHERE code=? AND (forms='' OR forms='{}')").run(JSON.stringify(seedOrganForms[code]), code);
      this.db.prepare("UPDATE memberships SET since=?, basis=? WHERE organ='prezydium' AND since=''").run(presidiumSince, JSON.stringify(presidiumBasis));
      this.rosterCache = null;
      const {docTypes, audit} = migrateDocTypesV3(this.docTypes(), LAW.prezydium, now);
      for (const t of docTypes) this.saveDocType(t);
      const accounts = this.users().map(accountView);
      // Przy pierwszym uruchomieniu nowej instalacji (bez kont i posiedzeń) wpisy o zmianie ról nie mają znaczenia.
      const existing = accounts.length > 0 || this.meetingIds().length > 0;
      this.audit([...(existing ? migrationNotesV3(accounts, this.roster(), now) : []), ...audit]);
      this.db.prepare("INSERT INTO meta(key, value) VALUES ('settings-revision', '1') ON CONFLICT(key) DO NOTHING").run();
      this.generalCache = null;
      const bundle = this.general();
      const advisory = accounts.filter(a => a.kind === 'doradczy' && !a.disabled).map(a => a.id);
      let seq = 0;
      const newId = () => `v3-${now.toString(36)}-${++seq}`;
      for (const id of this.meetingIds()) {
        const m = structuredClone(this.meeting(id)!);
        const env = cascadeEnv({roster: this.roster(), bundle, organ: m.organ, accounts});
        if (migrateMeetingV3(m, {now, env, advisory, newId})) { m.revision++; this.saveMeeting(m, now); }
      }
      this.db.prepare("INSERT INTO meta(key, value) VALUES ('ustawienia-v3', ?)").run(String(now));
    });
    return true;
  }
  /** Rodzaj użyty w materiale, w głosowaniu albo jako „Co jest głosowane” w punkcie któregoś posiedzenia. */
  docTypeUsed(id: string) {
    return this.meetingIds().some(mid => {
      const m = this.meeting(mid);
      return !!m && (m.materials.some(x => x.type === id) || m.ballots.some(b => b.docType === id) || m.agenda.some(i => i.docType === id));
    });
  }

  meeting(id: string): Meeting | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.db.prepare('SELECT data FROM meetings WHERE id=?').get(id) as {data: string} | undefined;
    if (!row) return null;
    // Dane zapisane przed wersją 2 dostają nowe pola przy odczycie (migrateMeeting), a zapisują się przy następnej zmianie.
    const meeting = migrateMeeting(JSON.parse(row.data) as Meeting);
    this.cache.set(id, meeting);
    return meeting;
  }

  saveMeeting(m: Meeting, now: number) {
    this.db.prepare(`INSERT INTO meetings(id,organ,kind,status,date,data,revision,updated) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, date=excluded.date, data=excluded.data, revision=excluded.revision, updated=excluded.updated`)
      .run(m.id, m.organ, m.kind, m.status, m.date, JSON.stringify(m), m.revision, now);
    this.cache.set(m.id, m);
  }

  deleteMeeting(id: string) {
    this.db.prepare('DELETE FROM meetings WHERE id=?').run(id);
    this.db.prepare('DELETE FROM material_versions WHERE meeting_id=?').run(id);
    this.cache.delete(id);
  }

  meetingIds(): string[] {
    return (this.db.prepare('SELECT id FROM meetings ORDER BY date DESC, updated DESC').all() as {id: string}[]).map(r => r.id);
  }

  liveMeetingIds(): string[] {
    return (this.db.prepare("SELECT id FROM meetings WHERE status IN ('trwa','przerwa')").all() as {id: string}[]).map(r => r.id);
  }

  user(id: string) { return this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined; }
  userByName(username: string) { return this.db.prepare('SELECT * FROM users WHERE username=?').get(username) as UserRow | undefined; }
  users() { return this.db.prepare('SELECT * FROM users ORDER BY display_name').all() as unknown as UserRow[]; }
  hasUsers() { return !!this.db.prepare('SELECT 1 FROM users LIMIT 1').get(); }

  close() { this.db.close(); }

  /**
   * F7, dane sprzed poprawki: głosowanie przerwane bez rozstrzygnięcia nie zachowuje wyborów. Usuwa karty tajnych
   * głosowań przerwanych (tabela secret_votes) i zapisuje posiedzenia, w których migracja usunęła wybory z jawnych.
   * Zwraca true, gdy coś usunięto (wtedy trzeba usunąć ślady w pliku bazy, scrubSecretTraces).
   */
  purgeAbortedVotes() {
    let removed = false;
    for (const {id, data} of this.db.prepare('SELECT id, data FROM meetings').all() as {id: string; data: string}[]) {
      const raw = JSON.parse(data) as Meeting;
      const aborted = raw.ballots.filter(b => b.aborted);
      if (!aborted.length) continue;
      for (const b of aborted) {
        if (b.secret && Number(this.db.prepare('DELETE FROM secret_votes WHERE ballot_id=?').run(b.id).changes) > 0) removed = true;
      }
      if (aborted.some(b => Object.keys(b.votes ?? {}).length)) {
        const m = this.meeting(id)!;
        this.db.prepare('UPDATE meetings SET data=? WHERE id=?').run(JSON.stringify(m), id);
        removed = true;
      }
    }
    return removed;
  }

  // Po zamknięciu tajnego głosowania: przebudowa pliku bazy (VACUUM) usuwa ślad kolejności
  // zapisu głosów, a punkt kontrolny WAL — kopię zmian z dziennika.
  scrubSecretTraces() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ponowi się przy następnym zamknięciu */ }
  }
}
