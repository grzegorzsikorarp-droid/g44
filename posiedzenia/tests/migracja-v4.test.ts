import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/server/app.ts';
import type {Meeting} from '../src/shared/types.ts';

// Migracja wersji 4 (SPEC-4 2.3, DB-4, DB-37, DB-41, 6.2): jednorazowa, na kopiach danych wersji 2 (dane-wzor) i wersji 3
// (dane-wzor-3). Stare posiedzenia bez `frozen.v4`, z kadencją; zamknięte z utrwalonymi poziomami; rodzaje dokumentów
// z poziomem; poczta wyłączona; cztery wpisy w historii zmian dokładnie raz; drugie uruchomienie nic nie zmienia.

async function boot(dir: string) {
  const app = await createApplication({dataDir: dir, setupToken: 'kod-testowy', clientDir: dir, tickMs: 50, workerMs: 3600000, purgeMs: 3600000, pdfCheckMs: 20});
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  return app;
}
const shut = (app: Awaited<ReturnType<typeof boot>>) => new Promise<void>(r => { if (!app.server.listening) return r(); app.server.closeAllConnections(); app.server.close(() => r()); });

for (const fixture of ['dane-wzor', 'dane-wzor-3']) {
  test(`2.3, DB-4, DB-37, DB-41: migracja ${fixture} jednorazowa, stare posiedzenia bez v4, wpisy w historii raz`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-v4-mig-'));
    copyFileSync(join(import.meta.dirname, 'fixtures', fixture, 'posiedzenia.sqlite'), join(dir, 'posiedzenia.sqlite'));
    let app = await boot(dir);
    try {
      const db = () => app.store.db;
      const notes = () => db().prepare("SELECT area, after FROM audit WHERE key='wersja-4' ORDER BY id").all() as {area: string; after: string}[];
      assert.deepEqual(notes().map(n => n.after), [
        'Rodzaje dokumentów mają poziom w materiale dla komunikacji (wersja 4).',
        'Posiedzenia mają zapisaną kadencję (wersja 4).',
        'Zakończone posiedzenia mają utrwalone poziomy materiału dla komunikacji (wersja 4).',
        'Poczta e-mail jest wyłączona do czasu ustawienia przez biuro (wersja 4).',
      ]);
      const meetings = app.store.meetingIds().map(id => app.store.meeting(id)!) as Meeting[];
      assert.ok(meetings.length > 0);
      for (const m of meetings) {
        assert.equal(m.frozen?.v4, undefined, `${m.id}: stare posiedzenie bez v4 (DB-4)`);
        if (m.frozen) assert.ok(m.frozen.term?.name, `${m.id}: kadencja przy otwarciu (DB-37)`);
        if (m.status === 'zakonczone') assert.ok(m.closedComms, `${m.id}: poziomy utrwalone (DB-41)`);
      }
      assert.ok(app.store.docTypes().every(t => t.comms), 'rodzaje dokumentów z poziomem');
      const mail = app.store.general().general.mail!;
      assert.deepEqual([mail.enabled, mail.controller], [false, 'Okręgowa Izba Pielęgniarek i Położnych w Słupsku']);
      assert.equal(app.mailStatus(), 'Poczta wyłączona.');
      assert.ok(app.store.meta('wersja-4'));
      const archive = app.store.archiveRevision();
      assert.ok(archive >= 1);
      const revisions = meetings.map(m => [m.id, m.revision]);
      await shut(app);

      // Drugie uruchomienie: bez nowych wpisów i bez zmian rewizji.
      app = await boot(dir);
      assert.equal(notes().length, 4);
      assert.deepEqual(app.store.meetingIds().map(id => [id, app.store.meeting(id)!.revision]), revisions);
      assert.equal(app.store.archiveRevision(), archive);
      for (const t of ['prep_spaces', 'mail_batches', 'mail_outbox', 'email_codes']) assert.equal(Number((db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as {n: number}).n), 0, t);
      const columns = (db().prepare('PRAGMA table_info(users)').all() as {name: string}[]).map(c => c.name);
      for (const c of ['email', 'email_state', 'prefs', 'avatar', 'avatar_screen']) assert.ok(columns.includes(c), c);
    } finally { await shut(app); rmSync(dir, {recursive: true, force: true}); }
  });
}

test('2.3: nowa instalacja bez kont i posiedzeń nie dostaje wpisów o przejściu', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-v4-nowa-'));
  try {
    const app = await boot(dir);
    assert.equal(Number((app.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE key='wersja-4'").get() as {n: number}).n), 0);
    assert.ok(app.store.meta('wersja-4'));
    await shut(app);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
