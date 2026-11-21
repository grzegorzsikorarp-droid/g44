import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {TestSmtp, type Received} from './smtp-serwer.ts';
import {parse} from './mail-parse.ts';
import {startServer, people, type Client} from './serwer-v4.ts';
import {CANCELLED_ON_OPEN} from '../src/server/mail/outbox.ts';
import {closedMeeting} from './scenariusz-v4.ts';

// Poczta przez API (SPEC-4 5.2, 5.4, 4.3.2, G-19–G-21, G-32, G-37, K4-13, K4-36, B2-P07, B2-P13, B2-P14) z udawanym serwerem
// poczty (TLS, certyfikat testowy) i serwerem aplikacji z APP_URL https. Hasło tylko w opcjach serwera, nigdy w odpowiedzi.

const dir = join(import.meta.dirname, 'fixtures/smtp');
const key = readFileSync(join(dir, 'localhost.key'), 'utf8');
const cert = readFileSync(join(dir, 'localhost.crt'), 'utf8');
const PASSWORD = 'Haslo-Poczty-2026!';
const USER = 'posiedzenia@example.org';
const APP = 'https://posiedzenia.example.org';
const smtp = new TestSmtp({key, cert, users: {[USER]: PASSWORD}});
let smtpPort = 0;
before(async () => { smtpPort = await smtp.listen(0, true); });
after(() => smtp.close());

const bodies: string[] = [];
const tracked = (c: Client): Client => ({...c, async call(path: string, data?: unknown, method?: string) { const r = await c.call(path, data, method); bodies.push(JSON.stringify(r.body)); return r; },
  async ok(path: string, data?: unknown, method?: string) { const r = await c.call(path, data, method); bodies.push(JSON.stringify(r.body)); if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; }});
async function waitFor(pred: (r: Received) => boolean, ms = 4000): Promise<Received> {
  const end = Date.now() + ms;
  for (;;) {
    const hit = smtp.received.find(pred);
    if (hit) return hit;
    if (Date.now() > end) throw new Error('Wiadomość nie dotarła do serwera poczty.');
    await new Promise(r => setTimeout(r, 25));
  }
}

test('4.3.2, G-19–G-21, B2-P13, B2-P07, G-32, K4-13: ustawienia, wiadomość próbna, adres z kodem, informacja o postępie, dziennik', async () => {
  smtp.reset();
  const {origin, stop, app} = await startServer({appUrl: APP, mail: {password: PASSWORD, hostAllowed: 'localhost', ca: cert}, workerMs: 30});
  try {
    const p = await people(origin, APP);
    const admin = tracked(p.admin), si = tracked(p.si), eo = tracked(p.members.get('eo')!), office = tracked(p.office);
    const set = (c: Client, key: string, value: unknown) => c.call('/api/settings', {change: {area: 'poczta', key, value}});
    assert.equal(app.mailStatus(), 'Poczta wyłączona.');
    // G-19: włączenie bez kompletu ustawień odmówione; zapis wyłączonej poczty przyjęty.
    const early = await set(admin, 'enabled', true);
    assert.equal(early.status, 400);
    assert.match(early.body.error, /^Poczty nie można włączyć\. Brakuje serwera poczty/);
    assert.equal((await set(si, 'host', 'localhost')).status, 403, 'ustawienia poczty zmienia biuro');
    for (const [k, v] of [['host', 'localhost'], ['port', smtpPort], ['security', 'tls'], ['user', USER], ['fromAddress', USER], ['fromName', 'Posiedzenia (próba)'], ['privacyUrl', 'https://example.org/dane']] as const) {
      assert.equal((await set(admin, k, v)).status, 200, k);
    }
    assert.equal((await set(admin, 'replyTo', 'biuro @example.org')).body.error, 'Wpisz poprawny adres e-mail, bez polskich znaków, spacji i nawiasów.');
    assert.equal((await set(admin, 'user', 'login\r\nRCPT TO:<x@example.org>')).status, 400, 'K4-14 w ustawieniach');
    assert.equal((await set(admin, 'enabled', true)).status, 200);
    assert.equal(app.mailStatus(), `Poczta gotowa, serwer localhost, port ${smtpPort}.`);
    const state = await admin.ok('/api/mail/state');
    assert.deepEqual([state.enabled, state.passwordSet, state.hostAllowed, state.problems], [true, true, 'localhost', []]);
    assert.equal((await si.call('/api/mail/state')).status, 200, 'przewodniczący ogląda');
    assert.equal((await eo.call('/api/mail/state')).status, 403);
    const history = await admin.ok('/api/settings/history?area=poczta');
    assert.ok(JSON.stringify(history).includes('serwer poczty'));

    // B2-P13: wiadomość próbna z przebiegiem; tylko biuro.
    assert.equal((await si.call('/api/mail/test', {to: 'test@example.org'})).status, 403);
    assert.equal((await admin.call('/api/mail/test', {to: 'test@example.org\r\nBcc: x@example.org'})).status, 400);
    const probe = await admin.ok('/api/mail/test', {to: 'test@example.org'});
    assert.equal(probe.ok, true, JSON.stringify(probe.steps));
    assert.deepEqual(probe.steps.map((s: {name: string; ok: boolean}) => [s.name, s.ok]), [['Połączenie', true], ['Szyfrowanie', true], ['Logowanie', true], ['Wysłanie', true]]);
    const test1 = parse((await waitFor(r => r.to[0] === 'test@example.org')).raw);
    assert.equal(test1.headers.get('subject'), 'Wiadomość próbna');
    assert.equal(test1.headers.get('from'), `Posiedzenia (próba) <${USER}>`);

    // B2-P07, G-21, G-37: adres z kodem; błędny kod liczy próby.
    assert.equal((await si.call('/api/me/email', {email: 'jan kowalski@example.org'})).body.error, 'Wpisz poprawny adres e-mail, bez polskich znaków, spacji i nawiasów.');
    assert.equal((await si.ok('/api/me/email', {email: 'si@example.org'})).codeSent, true);
    const codeMsg = parse((await waitFor(r => r.to[0] === 'si@example.org')).raw);
    const code = /Kod (\d{3}) (\d{3})\./.exec(codeMsg.text)!.slice(1).join('');
    assert.equal(codeMsg.headers.get('subject'), 'Kod potwierdzenia adresu e-mail');
    const wrong = await si.call('/api/me/email/confirm', {code: code === '000000' ? '111111' : '000000'});
    assert.deepEqual([wrong.status, wrong.body.error], [400, 'Kod jest nieprawidłowy. Zostały 4 próby.']);
    assert.equal((await si.ok('/api/me/email/confirm', {code})).emailState, 'potwierdzony');
    const me = await si.ok('/api/me');
    assert.deepEqual([me.email, me.emailState, me.mailEnabled], ['si@example.org', 'potwierdzony', true]);
    assert.equal((await si.call('/api/me/email/confirm', {code})).status, 409, 'kod jednorazowy');

    // Informacja o postępie (G-32): podgląd z odbiorcami, wysyłka, druga przed upływem 60 minut odmówiona.
    const m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    assert.equal((await eo.call(`/api/meetings/${m.id}/mail/preview`, {kind: 'postep'})).status, 403);
    const preview = await admin.ok(`/api/meetings/${m.id}/mail/preview`, {kind: 'postep', recipients: {group: 'wszyscy'}});
    assert.match(preview.subject, /^Przygotowanie posiedzenia 3\.12\.2026, gotowe \d+ z \d+ punkt(u|ów)$/);
    assert.ok(preview.text.includes('To nie jest zawiadomienie o posiedzeniu (§ 7 ust. 1).'));
    assert.deepEqual(preview.recipients.map((r: {name: string; state: string}) => r.state), ['wysle', 'brak_adresu', 'brak_adresu', 'brak_adresu', 'brak_adresu', 'brak_adresu', 'brak_adresu']);
    assert.ok(!JSON.stringify(preview.recipients).includes('@'), 'podgląd bez adresów');
    assert.equal((await admin.call(`/api/meetings/${m.id}/mail/send`, {kind: 'postep', intro: 'x'.repeat(1501)})).body.error, 'Wstęp może mieć najwyżej 1500 znaków.');
    assert.equal((await admin.call(`/api/meetings/${m.id}/mail/send`, {kind: 'postep', recipients: {group: 'wszyscy'}})).status, 201);
    const progress = parse((await waitFor(r => r.to[0] === 'si@example.org' && /Przygotowanie posiedzenia/.test(parse(r.raw).headers.get('subject') ?? ''))).raw);
    assert.ok(progress.text.includes('Wiadomość wysyła biuro Okręgowej Izby Pielęgniarek i Położnych w Słupsku.'));
    assert.ok(progress.text.includes(`${APP}/#p-${m.id}`));
    assert.equal(progress.headers.get('to'), `Sebastian Irzykowski <si@example.org>`);
    const again = await si.call(`/api/meetings/${m.id}/mail/send`, {kind: 'postep'});
    assert.equal(again.status, 409);
    assert.match(again.body.error, /^Informację o postępie wysłano o godz\. \d{2}:\d{2}\. Kolejną można wysłać po godz\. \d{2}:\d{2}\.$/);
    assert.equal((await eo.call(`/api/meetings/${m.id}/mail`)).status, 403, 'historia wysyłek dla przygotowujących i biura');
    const hist = await admin.ok(`/api/meetings/${m.id}/mail`);
    assert.equal(hist.batches.length, 1);
    assert.ok(!JSON.stringify(hist).includes('@example.org'), 'historia posiedzenia bez adresów');
    // B2-P14: dziennik biura bez adresów, administratora z adresami.
    const logOffice = await office.ok('/api/mail/log');
    assert.ok(logOffice.batches.length >= 3 && !JSON.stringify(logOffice).includes('si@example.org'));
    const logAdmin = await admin.ok('/api/mail/log');
    assert.ok(JSON.stringify(logAdmin).includes('si@example.org'));
    assert.equal((await eo.call('/api/mail/log')).status, 403);

    // K4-13, T-5: w trwającym posiedzeniu wysyłka odmówiona i nic nie trafia do kolejki; postęp czekający anulowany przy otwarciu.
    const m2 = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-10', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    app.outbox.pause(Date.now(), 'Wstrzymane w teście.');
    assert.equal((await admin.call(`/api/meetings/${m2.id}/mail/send`, {kind: 'postep'})).status, 201);
    const queued = app.store.db.prepare("SELECT o.status FROM mail_outbox o JOIN mail_batches b ON b.id=o.batch_id WHERE b.meeting_id=?").all(m2.id) as {status: string}[];
    assert.deepEqual(queued.map(x => x.status), ['czeka']);
    await si.ok(`/api/meetings/${m2.id}/command`, {type: 'open'});
    const cancelled = app.store.db.prepare("SELECT o.status, o.last_error FROM mail_outbox o JOIN mail_batches b ON b.id=o.batch_id WHERE b.meeting_id=?").all(m2.id) as {status: string; last_error: string}[];
    assert.deepEqual(cancelled.map(x => [x.status, x.last_error]), [['anulowana', CANCELLED_ON_OPEN]]);
    const count = () => Number((app.store.db.prepare('SELECT COUNT(*) AS n FROM mail_batches').get() as {n: number}).n);
    const n0 = count();
    for (const kind of ['postep', 'po_posiedzeniu', 'protokol']) {
      const r = await admin.call(`/api/meetings/${m2.id}/mail/send`, {kind});
      assert.deepEqual([r.status, r.body.error], [409, 'Posiedzenie trwa. Wiadomość wyślesz po zamknięciu.'], kind);
    }
    assert.equal((await admin.call(`/api/meetings/${m2.id}/mail/preview`, {kind: 'postep'})).status, 409);
    assert.equal(count(), n0, 'T-5: żadnej wysyłki w trakcie obrad');
    // Wznowienie wysyłki (biuro).
    assert.equal((await si.call('/api/mail/resume', {})).status, 403);
    assert.equal((await admin.ok('/api/mail/resume', {})).paused, null);
    // K4-36: hasło nie pojawia się w żadnej odpowiedzi ani w bazie.
    assert.ok(!bodies.some(b => b.includes(PASSWORD)));
    const dump = JSON.stringify(app.store.db.prepare("SELECT * FROM settings").all()) + JSON.stringify(app.store.db.prepare('SELECT * FROM meta').all());
    assert.ok(!dump.includes(PASSWORD));
  } finally { await stop(); }
});

test('G-37, 5.4: poczta wyłączona albo MAIL_OFF; adres zapisany bez kodu, wysyłka odmówiona, przegląd działa', async () => {
  const {origin, stop, app} = await startServer({mail: {password: '', hostAllowed: null, off: true}});
  try {
    const p = await people(origin);
    const r = await p.si.ok('/api/me/email', {email: 'si@example.org'});
    assert.deepEqual([r.emailState, r.codeSent, r.message], ['niepotwierdzony', false, 'Poczta jest wyłączona, więc kodu nie da się wysłać. Adres może potwierdzić administrator.']);
    const m = (await p.admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    assert.equal((await p.admin.call(`/api/meetings/${m.id}/mail/preview`, {kind: 'postep'})).status, 200, 'podgląd także przy wyłączonej poczcie');
    const send = await p.admin.call(`/api/meetings/${m.id}/mail/send`, {kind: 'postep'});
    assert.deepEqual([send.status, send.body.error], [409, 'Poczta jest wyłączona. Włącza ją biuro w ustawieniach ogólnych.']);
    assert.equal(app.mailStatus(), 'Poczta wyłączona.');
    // Administrator potwierdza adres (B2-P07, „Potwierdzony przez administratora”).
    const id = p.idOf('si.test');
    assert.equal((await p.office.call('/api/accounts', {id, emailConfirmed: true}, 'PATCH')).status, 403);
    const accounts = (await p.admin.ok('/api/accounts', {id, emailConfirmed: true}, 'PATCH')).accounts;
    assert.equal(accounts.find((a: {id: string}) => a.id === id).emailState, 'potwierdzony');
    assert.equal((await p.si.ok('/api/me')).emailConfirmedBy, 'administrator');
  } finally { await stop(); }
});

test('5.4, K4-36: main.ts czyta hasło z pliku, usuwa je ze środowiska i drukuje linię stanu bez hasła', async () => {
  const work = mkdtempSync(join(tmpdir(), 'posiedzenia-main-'));
  const secretFile = join(work, 'haslo');
  writeFileSync(secretFile, 'Sekret-z-pliku-2026\n');
  const child = spawn(process.execPath, [join(import.meta.dirname, '../src/server/main.ts')], {
    env: {...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: join(work, 'dane'), SMTP_PASSWORD_FILE: secretFile, SMTP_PASSWORD: 'Sekret-ze-zmiennej', SMTP_HOST_ALLOWED: 'smtp.example.org'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const end = Date.now() + 8000;
  while (!out.includes('Zatrzymanie') && Date.now() < end) await new Promise(r => setTimeout(r, 50));
  child.kill('SIGTERM');
  await new Promise(r => child.once('exit', r));
  rmSync(work, {recursive: true, force: true});
  assert.ok(out.includes('Poczta wyłączona.'), out);
  assert.ok(!out.includes('Sekret-z-pliku') && !out.includes('Sekret-ze-zmiennej'));
});

test('W-W4-02, 0.2 pkt 4: podgląd „Protokół do wglądu” ze szkicu okna, bez zapisu faktu; wysyłka nadal wymaga faktu', async () => {
  const {origin, stop, app} = await startServer();
  try {
    const p = await people(origin);
    const {m} = closedMeeting({v4: true});
    app.store.saveMeeting(m, Date.now());
    const kn = p.members.get('kn')!;
    const preview = (c: Client, body: object) => c.call(`/api/meetings/${m.id}/mail/preview`, {kind: 'protokol', recipients: {group: 'wszyscy'}, ...body});
    const without = await preview(kn, {});
    assert.deepEqual([without.status, without.body.error], [409, 'Wiadomość „Protokół do wglądu” wychodzi po wpisaniu, kto i kiedy sporządził protokół.']);
    const today = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Warsaw'}).format(Date.now());
    const [y, mo, d] = today.split('-');
    const draft = await preview(kn, {draft: {date: today, authorPersonId: 'kn'}});
    assert.equal(draft.status, 200);
    assert.ok(draft.body.text.includes(`sporządzono ${d}.${mo}.${y}. Sporządza Krystyna Naczk, Sekretarz.`), draft.body.text);
    assert.ok(!/r\.\./.test(draft.body.text), 'bez podwójnej kropki po dacie słownie (W-W4-08)');
    assert.equal((await preview(kn, {draft: {date: today, authorPersonId: 'obcy'}})).status, 409, 'osoba spoza składu nie daje szkicu');
    assert.equal(app.store.meeting(m.id)!.minutesReady, undefined, 'podgląd niczego nie zapisuje');
    assert.equal((await kn.call(`/api/meetings/${m.id}/mail/send`, {kind: 'protokol', draft: {date: today, authorPersonId: 'kn'}})).status, 409, 'wysyłka bez zapisanego faktu odmówiona');
    assert.equal((await preview(p.members.get('eo')!, {draft: {date: today, authorPersonId: 'kn'}})).status, 403, 'członek bez prawa');
  } finally { await stop(); }
});

test('D-KDZ4-03, G-21: znak nowego wiersza w adresie daje komunikat o adresie, w innym polu o jednym wierszu', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const set = (key: string, value: unknown) => p.admin.call('/api/settings', {change: {area: 'poczta', key, value}});
    for (const key of ['fromAddress', 'replyTo']) {
      const r = await set(key, 'x\r\ny@example.org');
      assert.deepEqual([r.status, r.body.error], [400, 'Wpisz poprawny adres e-mail, bez polskich znaków, spacji i nawiasów.'], key);
    }
    for (const key of ['host', 'user', 'fromName']) {
      const r = await set(key, 'a\nb');
      assert.deepEqual([r.status, r.body.error], [400, 'Wpisz tę wartość w jednym wierszu.'], key);
    }
  } finally { await stop(); }
});
