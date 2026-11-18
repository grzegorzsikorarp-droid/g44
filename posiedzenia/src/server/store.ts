import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import type {Account, Meeting, Roster} from '../shared/types.ts';
import {seedRoster} from './seed.ts';

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

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(join(dir, 'files'), {recursive: true});
    this.db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'));
    // secure_delete: usunięte dane (np. klucze tajnych głosowań) są nadpisywane zerami.
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;');
    this.db.exec(schema);
    if (!this.db.prepare('SELECT 1 FROM persons LIMIT 1').get()) this.seed(seedRoster);
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
    catch (error) { this.db.exec('ROLLBACK'); this.cache.clear(); throw error; }
  }

  roster(): Roster {
    if (this.rosterCache) return this.rosterCache;
    const organs = (this.db.prepare('SELECT * FROM organs').all() as any[]).map(o => ({code: o.code, name: o.name, shortName: o.short_name, active: !!o.active}));
    const persons = (this.db.prepare('SELECT * FROM persons ORDER BY sort_name').all() as any[]).map(p => ({id: p.id, name: p.name, sortName: p.sort_name}));
    const memberships = (this.db.prepare('SELECT * FROM memberships ORDER BY organ, ord').all() as any[]).map(m => ({organ: m.organ, personId: m.person_id, func: m.func, label: m.label, order: m.ord, canChair: !!m.can_chair}));
    return this.rosterCache = {organs, persons, memberships};
  }

  meeting(id: string): Meeting | null {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const row = this.db.prepare('SELECT data FROM meetings WHERE id=?').get(id) as {data: string} | undefined;
    if (!row) return null;
    const meeting = JSON.parse(row.data) as Meeting;
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

  // Po zamknięciu tajnego głosowania: przebudowa pliku bazy (VACUUM) usuwa ślad kolejności
  // zapisu głosów, a punkt kontrolny WAL — kopię zmian z dziennika.
  scrubSecretTraces() {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* ponowi się przy następnym zamknięciu */ }
  }
}
