import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Account, DocType, Meeting, Roster} from '../shared/types.ts';
import {defaultDocTypes} from '../shared/doctypes.ts';
import {migrateMeeting} from '../shared/migrate.ts';
import {councilMemberLabel, seedRoster} from './seed.ts';

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
`;

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

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, 'files'), {recursive: true});
    this.db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'));
    // secure_delete: usunięte dane (np. klucze tajnych głosowań) są nadpisywane zerami.
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(schema);
    if (!this.db.prepare('SELECT 1 FROM persons LIMIT 1').get()) this.seed(seedRoster);
    // Jednorazowa zamiana etykiety składu w bazie utworzonej przed zmianą: skrót „Członek ORPiP” na pełną nazwę organu.
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'etykieta-skladu'").get()) {
      this.db.prepare("UPDATE memberships SET label = ? WHERE label = 'Członek ORPiP'").run(councilMemberLabel);
      this.db.prepare("INSERT INTO meta(key, value) VALUES ('etykieta-skladu', '1')").run();
    }
    // Wersja 2 (F11): słownik rodzajów dokumentów z wartościami domyślnymi, wpisany raz przy pierwszym starcie.
    if (!this.db.prepare("SELECT 1 FROM meta WHERE key = 'rodzaje-dokumentow'").get()) {
      this.transaction(() => {
        for (const t of defaultDocTypes) this.db.prepare('INSERT OR IGNORE INTO doc_types VALUES (?,?,?,?,?,?,?)').run(t.id, t.name, t.adopted, t.rejected, t.voted ? 1 : 0, t.order, t.active ? 1 : 0);
        this.db.prepare("INSERT INTO meta(key, value) VALUES ('rodzaje-dokumentow', '1')").run();
      });
    }
  }

  private seed(roster: Roster) {
    this.transaction(() => {
      for (const o of roster.organs) this.db.prepare('INSERT INTO organs VALUES (?,?,?,?)').run(o.code, o.name, o.shortName, o.active ? 1 : 0);
      for (const p of roster.persons) this.db.prepare('INSERT INTO persons VALUES (?,?,?)').run(p.id, p.name, p.sortName);
      for (const m of roster.memberships) this.db.prepare('INSERT INTO memberships VALUES (?,?,?,?,?,?)').run(m.organ, m.personId, m.func, m.label, m.order, m.canChair ? 1 : 0);
    });
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); this.cache.clear(); this.docTypeCache = null; throw error; }
  }

  roster(): Roster {
    if (this.rosterCache) return this.rosterCache;
    const organs = (this.db.prepare('SELECT * FROM organs').all() as any[]).map(o => ({code: o.code, name: o.name, shortName: o.short_name, active: !!o.active}));
    const persons = (this.db.prepare('SELECT * FROM persons ORDER BY sort_name').all() as any[]).map(p => ({id: p.id, name: p.name, sortName: p.sort_name}));
    const memberships = (this.db.prepare('SELECT * FROM memberships ORDER BY organ, ord').all() as any[]).map(m => ({organ: m.organ, personId: m.person_id, func: m.func, label: m.label, order: m.ord, canChair: !!m.can_chair}));
    return this.rosterCache = {organs, persons, memberships};
  }

  docTypes(): DocType[] {
    if (this.docTypeCache) return this.docTypeCache;
    const rows = this.db.prepare('SELECT * FROM doc_types ORDER BY ord, name').all() as any[];
    return this.docTypeCache = rows.map(r => ({id: r.id, name: r.name, adopted: r.adopted, rejected: r.rejected, voted: !!r.voted, order: Number(r.ord), active: !!r.active}));
  }
  saveDocType(t: DocType) {
    this.db.prepare(`INSERT INTO doc_types VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, adopted=excluded.adopted,
      rejected=excluded.rejected, voted=excluded.voted, ord=excluded.ord, active=excluded.active`).run(t.id, t.name, t.adopted, t.rejected, t.voted ? 1 : 0, t.order, t.active ? 1 : 0);
    this.docTypeCache = null;
  }
  deleteDocType(id: string) {
    this.db.prepare('DELETE FROM doc_types WHERE id=?').run(id);
    this.docTypeCache = null;
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
