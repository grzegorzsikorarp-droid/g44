import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/server/store.ts';
import {Outbox, CANCELLED_NOT_PREP, CANCELLED_ON_OPEN, MAX_ATTEMPTS, RETRY_MINUTES, type Outgoing, type Sender} from '../src/server/mail/outbox.ts';
import type {SmtpOptions} from '../src/server/mail/smtp.ts';
import {TestSmtp} from './smtp-serwer.ts';
import {context, newMeeting} from './helpers.ts';

// Skrzynka nadawcza (SPEC-4 5.4, B2-P04, B2-P14, DB-36, K4-13, K4-36): jedna wiadomość na odbiorcę, próby liczone przy
// przejściu do „wysylanie”, ponowienia po 1, 5, 15, 60 i 180 minutach, wstrzymanie po błędzie ustawień, wiadomości
// trwającego posiedzenia zostają w kolejce, informacje o postępie anulowane przy otwarciu, usuwanie treści i wpisów.

const dir = join(import.meta.dirname, 'fixtures/smtp');
const key = readFileSync(join(dir, 'localhost.key'), 'utf8');
const cert = readFileSync(join(dir, 'localhost.crt'), 'utf8');
const PASSWORD = 'Haslo-Testowe-2026';
const USER = 'posiedzenia@example.org';
const server = new TestSmtp({key, cert, users: {[USER]: PASSWORD}});
let port = 0;
before(async () => { port = await server.listen(0, true); });
after(() => server.close());

const t0 = Date.UTC(2026, 10, 18, 15, 0, 0);
const options = (o: Partial<SmtpOptions> = {}): SmtpOptions => ({host: 'localhost', port, security: 'tls', user: USER, password: PASSWORD, clientName: 'posiedzenia.example.org', ca: cert, timeoutMs: 3000, ...o});
const sender = (o: Partial<SmtpOptions> = {}): Sender => ({options: options(o), from: {name: 'Posiedzenia (próba)', address: USER}, replyTo: {address: 'biuro@example.org'}});
const out = (addresses: string[]): Outgoing[] => addresses.map((a, i) => ({accountId: 'u' + i, to: {name: 'Osoba ' + i, address: a}, subject: 'Przygotowanie posiedzenia 20.11.2026, gotowe 1 z 2 punktów', text: 'Treść', html: '<p>Treść</p>'}));
function fresh() {
  const d = mkdtempSync(join(tmpdir(), 'posiedzenia-skrzynka-'));
  const store = new Store(d);
  return {store, box: new Outbox(store.db), done: () => { store.db.close(); rmSync(d, {recursive: true, force: true}); }};
}
const batch = (meetingId: string | null, kind = 'postep') => ({kind, meetingId, createdBy: 'u-biuro', actor: 'Biuro', subject: 's', intro: ''});

test('B2-P04, K4-36: błąd przejściowy z ponowieniem po minucie, błąd trwały, każda wiadomość z własnym Message-ID', async () => {
  server.reset({rcpt: (to, n) => to.startsWith('tymczasowo') && n === 1 ? [451, '4.3.0 Try again later'] : to.startsWith('odrzucony') ? [550, '5.1.1 User unknown'] : null});
  const {box, done} = fresh();
  const id = box.enqueue(batch(null, 'proba'), out(['ok@example.org', 'tymczasowo@example.org', 'odrzucony@example.org']), t0, 'example.org');
  assert.deepEqual(await box.run(t0, sender()), {sent: 1, retry: 1, failed: 1});
  assert.deepEqual(await box.run(t0 + 30000, sender()), {sent: 0, retry: 0, failed: 0}, 'przed upływem odstępu nic nie wychodzi');
  assert.deepEqual(await box.run(t0 + 61000, sender()), {sent: 1, retry: 0, failed: 0});
  const rows = Object.fromEntries(box.rows(id).map(r => [r.to_address, r]));
  assert.deepEqual([rows['ok@example.org'].status, rows['ok@example.org'].attempts], ['wyslana', 1]);
  assert.deepEqual([rows['tymczasowo@example.org'].status, rows['tymczasowo@example.org'].attempts], ['wyslana', 2]);
  assert.equal(rows['odrzucony@example.org'].status, 'blad');
  assert.match(rows['odrzucony@example.org'].last_error, /550/);
  const ids = server.received.map(r => /Message-ID: (\S+)/.exec(r.raw)?.[1]);
  assert.equal(new Set(ids).size, 2);
  assert.ok(server.received.every(r => r.to.length === 1 && /X-Posiedzenia-Wysylka: /.test(r.raw)));
  // „Wyślij ponownie” i „Anuluj” (B2-P14).
  assert.throws(() => box.cancel(rows['odrzucony@example.org'].id), {message: 'Anuluje się tylko wiadomość, która czeka na wysłanie.'});
  assert.equal(box.retry(rows['odrzucony@example.org'].id, t0 + 70000).status, 'czeka');
  assert.equal(box.cancel(rows['odrzucony@example.org'].id).status, 'anulowana');
  assert.throws(() => box.retry(rows['ok@example.org'].id, t0), {message: 'Ponownie wysyła się tylko wiadomość, która nie wyszła.'});
  done();
});

test('K4-36: brak serwera to próba policzona i odstęp z listy; po wyczerpaniu prób stan „blad”', async () => {
  const {box, done} = fresh();
  const closed = new TestSmtp({key, cert, users: {}});
  const dead = await closed.listen(0, true);
  await closed.close();
  const id = box.enqueue(batch(null, 'proba'), out(['a@example.org']), t0, 'example.org');
  let now = t0;
  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    const r = await box.run(now, sender({port: dead}));
    const row = box.rows(id)[0];
    assert.equal(row.attempts, i);
    if (i < MAX_ATTEMPTS) {
      assert.deepEqual([r.retry, row.status, row.next_at], [1, 'czeka', now + RETRY_MINUTES[i - 1] * 60000]);
      now = row.next_at;
    } else assert.deepEqual([r.failed, row.status], [1, 'blad']);
  }
  done();
});

test('L1, G-21: złe hasło wstrzymuje wysyłkę bez liczenia prób; po „Wznów wysyłkę” wiadomości wychodzą', async () => {
  server.reset();
  const {box, done} = fresh();
  const id = box.enqueue(batch(null, 'proba'), out(['a1@example.org', 'a2@example.org']), t0, 'example.org');
  const r = await box.run(t0, sender({password: 'zle-haslo-123456'}));
  assert.equal(r.failed, 0);
  assert.ok(box.paused && /odrzucił login lub hasło/.test(box.paused.reason));
  assert.ok(box.rows(id).every(x => x.status === 'czeka' && x.attempts === 0));
  assert.ok(!JSON.stringify(box.paused).includes('zle-haslo'));
  assert.deepEqual(await box.run(t0 + 1000, sender()), {sent: 0, retry: 0, failed: 0}, 'wstrzymana wysyłka nic nie wysyła');
  box.resume();
  assert.equal((await box.run(t0 + 2000, sender())).sent, 2);
  done();
});

test('T-5, K4-13: wiadomości posiedzenia w toku zostają w kolejce; postęp anulowany przy otwarciu i po wyjściu z przygotowania', async () => {
  server.reset();
  const {store, box, done} = fresh();
  const ctx = context();
  const m = newMeeting(ctx);
  store.saveMeeting(m, t0);
  const progress = box.enqueue(batch(m.id), out(['p@example.org']), t0, 'example.org');
  const after = box.enqueue(batch(m.id, 'po_posiedzeniu'), out(['q@example.org']), t0, 'example.org');
  store.saveMeeting({...m, status: 'trwa'}, t0);
  assert.equal(box.cancelProgress(m.id), 1);
  assert.deepEqual([box.rows(progress)[0].status, box.rows(progress)[0].last_error], ['anulowana', CANCELLED_ON_OPEN]);
  assert.deepEqual(await box.run(t0, sender()), {sent: 0, retry: 0, failed: 0}, 'w trwającym posiedzeniu nic nie wychodzi');
  assert.equal(server.received.length, 0);
  assert.equal(box.rows(after)[0].status, 'czeka');
  // Postęp, który ominął anulowanie przy otwarciu (np. zapisany później), anuluje pracownik przed przejściem.
  const late = box.enqueue(batch(m.id), out(['r@example.org']), t0, 'example.org');
  store.saveMeeting({...m, status: 'zakonczone', closedAt: t0}, t0);
  const r = await box.run(t0 + 1000, sender());
  assert.deepEqual(r, {sent: 1, retry: 0, failed: 0});
  assert.deepEqual([box.rows(late)[0].status, box.rows(late)[0].last_error], ['anulowana', CANCELLED_NOT_PREP]);
  assert.equal(box.rows(after)[0].status, 'wyslana');
  assert.equal(box.lastProgressAt(m.id), t0);
  done();
});

test('DB-36: treść znika po 30 dniach (temat zostaje), wpis po 365 dniach; „Wyślij ponownie” bez treści odmówione', async () => {
  server.reset({rcpt: to => to.startsWith('odrzucony') ? [550, '5.1.1 User unknown'] : null});
  const {box, done} = fresh();
  const id = box.enqueue(batch(null, 'proba'), out(['ok@example.org', 'odrzucony@example.org']), t0, 'example.org');
  await box.run(t0, sender());
  assert.deepEqual(box.purge(t0 + 29 * 86400000), {bodies: 0, rows: 0});
  assert.deepEqual(box.purge(t0 + 31 * 86400000), {bodies: 2, rows: 0});
  const rows = box.rows(id);
  assert.ok(rows.every(r => r.body_text === '' && r.body_html === '' && r.subject !== ''));
  assert.throws(() => box.retry(rows.find(r => r.status === 'blad')!.id, t0 + 31 * 86400000), {message: 'Treść tej wiadomości usunięto po 30 dniach.'});
  assert.deepEqual(box.purge(t0 + 366 * 86400000), {bodies: 0, rows: 2});
  assert.equal(box.batches().length, 0);
  done();
});

test('5.4: bez nadawcy (poczta wyłączona, MAIL_OFF) pracownik nic nie wysyła i nie liczy prób', async () => {
  const {box, done} = fresh();
  const id = box.enqueue(batch(null, 'proba'), out(['a@example.org']), t0, 'example.org');
  assert.deepEqual(await box.run(t0, null), {sent: 0, retry: 0, failed: 0});
  assert.deepEqual([box.rows(id)[0].status, box.rows(id)[0].attempts], ['czeka', 0]);
  done();
});
