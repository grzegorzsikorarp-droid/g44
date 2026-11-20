import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {sendOne, SmtpSession, injected, type SmtpOptions} from '../src/server/mail/smtp.ts';
import {buildMessage} from '../src/server/mail/mime.ts';
import {TestSmtp} from './smtp-serwer.ts';
import {parse} from './mail-parse.ts';

// Klient SMTP (SPEC-4 5.4, B2-P09, K4-14, K4-36) wobec udawanego serwera z certyfikatem testowym (tests/fixtures/smtp):
// TLS od pierwszego bajtu i STARTTLS, logowanie dopiero po szyfrowaniu, odrzucenie złego certyfikatu bez wysłania hasła,
// brak STARTTLS, wstrzyknięcie po STARTTLS, znaki CR, LF i NUL w argumentach poleceń.

const dir = join(import.meta.dirname, 'fixtures/smtp');
const key = readFileSync(join(dir, 'localhost.key'), 'utf8');
const cert = readFileSync(join(dir, 'localhost.crt'), 'utf8');
const PASSWORD = 'Haslo-Testowe-2026!ąę';
const USER = 'posiedzenia@example.org';
const server = new TestSmtp({key, cert, users: {[USER]: PASSWORD}});
let tlsPort = 0, plainPort = 0;
before(async () => { tlsPort = await server.listen(0, true); plainPort = await server.listen(0, false); });
after(() => server.close());

const opts = (o: Partial<SmtpOptions> = {}): SmtpOptions => ({host: 'localhost', port: tlsPort, security: 'tls', user: USER, password: PASSWORD, clientName: 'posiedzenia.example.org', ca: cert, timeoutMs: 5000, ...o});
const mail = (to = 'jan@example.org') => buildMessage({from: {name: 'Posiedzenia (próba)', address: USER}, to: {name: 'Jan Przykładowy', address: to},
  subject: 'Przygotowanie posiedzenia 3.12.2026, gotowe 7 z 9 punktów', text: 'Treść.\n.kropka na początku wiersza\nKoniec.', html: '<p>Treść.</p>'});
const noAuthSent = () => !server.transcript.some(l => l.startsWith('C: AUTH'));
const secretInTranscript = () => { const t = server.transcript.join('\n'); return t.includes(PASSWORD) || t.includes(Buffer.from(PASSWORD).toString('base64')); };

test('B2-P09: port TLS, AUTH PLAIN po szyfrowaniu, treść odebrana bajt w bajt, hasło poza zapisem rozmowy', async () => {
  server.reset();
  const built = mail();
  const r = await sendOne(opts(), {from: USER, to: 'jan@example.org', raw: built.raw});
  assert.equal(r.error, undefined, r.error?.message);
  const got = server.received[0];
  assert.ok(got.secure && got.mech === 'PLAIN' && got.auth === USER);
  assert.equal(got.raw.replace(/\r\n$/, ''), built.raw.replace(/\r\n$/, ''), 'kropka na początku wiersza wraca po odczycie');
  assert.deepEqual(parse(got.raw).problems, []);
  assert.deepEqual(r.steps.map(s => [s.step, s.ok]), [['Połączenie', true], ['Szyfrowanie', true], ['Logowanie', true], ['Wysłanie', true]]);
  assert.ok(!JSON.stringify(r).includes(PASSWORD) && !secretInTranscript());
});

test('B2-P09: STARTTLS, EHLO ponowione po szyfrowaniu, AUTH LOGIN dopiero po STARTTLS', async () => {
  server.reset({authMechs: ['LOGIN']});
  const r = await sendOne(opts({port: plainPort, security: 'starttls'}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.equal(r.error, undefined, r.error?.message);
  const order = server.transcript.join('\n');
  assert.ok(order.indexOf('C: STARTTLS') < order.indexOf('C: AUTH'));
  assert.equal((order.match(/C: EHLO/g) ?? []).length, 2);
  assert.equal(server.received[0].mech, 'LOGIN');
  assert.ok(!secretInTranscript());
});

test('B2-P09: złe hasło to błąd trwały 535 bez hasła w komunikacie', async () => {
  server.reset();
  const r = await sendOne(opts({password: 'zle-haslo-123456'}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r.error);
  assert.deepEqual([r.error!.code, r.error!.temporary, r.error!.stage], [535, false, 'logowanie']);
  assert.equal(r.error!.message, 'Serwer poczty odrzucił login lub hasło (535).');
  assert.ok(!JSON.stringify(r).includes('zle-haslo') && !JSON.stringify(r).includes(Buffer.from('zle-haslo-123456').toString('base64')));
});

test('B2-P09: certyfikat bez zaufania (bez `ca`) przerywa przed logowaniem, w TLS i w STARTTLS', async () => {
  server.reset();
  const r = await sendOne(opts({ca: undefined}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r.error && !r.error.temporary && /Certyfikat serwera poczty jest nieprawidłowy .*Aplikacja nie wysłała hasła\./.test(r.error.message), r.error?.message);
  assert.ok(noAuthSent());
  server.reset();
  const r2 = await sendOne(opts({ca: undefined, port: plainPort, security: 'starttls'}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r2.error && !r2.error.temporary);
  assert.ok(noAuthSent());
});

test('B2-P09: brak STARTTLS i dane dopisane po 220 STARTTLS przerywają rozmowę bez logowania; trybu bez szyfrowania nie ma', async () => {
  server.reset({starttls: false, authBeforeTls: true});
  const r = await sendOne(opts({port: plainPort, security: 'starttls'}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r.error && r.error.stage === 'starttls', r.error?.message);
  assert.ok(noAuthSent());
  server.reset({injectAfterStartTls: true});
  const r2 = await sendOne(opts({port: plainPort, security: 'starttls'}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r2.error && r2.error.stage === 'starttls', r2.error?.message);
  assert.ok(noAuthSent());
  server.reset();
  const r3 = await sendOne(opts({port: plainPort, security: 'brak' as never}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r3.error, 'tryb spoza TLS i STARTTLS nie wysyła');
  assert.equal(server.received.length, 0);
});

test('K4-14: argument polecenia ze znakiem CR, LF albo NUL odrzucony przed wysłaniem (adres i login)', async () => {
  assert.equal(injected('a@example.org'), false);
  for (const bad of ['a@example.org\r\nRCPT TO:<x@example.org>', 'a@example.org\n', 'a\0@example.org']) assert.equal(injected(bad), true);
  server.reset();
  const r = await sendOne(opts(), {from: USER, to: 'jan@example.org>\r\nRCPT TO:<obcy@example.org', raw: mail().raw});
  assert.ok(r.error && !r.error.temporary);
  assert.equal(server.received.length, 0);
  assert.ok(!server.transcript.some(l => l.includes('obcy@example.org')));
  server.reset();
  const r2 = await sendOne(opts({user: `${USER}\r\nNOOP`}), {from: USER, to: 'jan@example.org', raw: mail().raw});
  assert.ok(r2.error && !r2.error.temporary);
  assert.ok(noAuthSent() && !server.transcript.includes('C: NOOP'));
});

test('B2-P04: dziesięć wiadomości w jednym połączeniu, jedno logowanie, jeden odbiorca na wiadomość; odrzucony odbiorca nie psuje kolejnych', async () => {
  server.reset({rcpt: to => to === 'odrzucony@example.org' ? [550, '5.1.1 User unknown'] : null});
  const s = new SmtpSession(opts());
  await s.open();
  const errors: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const to = i === 5 ? 'odrzucony@example.org' : `osoba${i}@example.org`;
    try { await s.send({from: USER, to, raw: mail(to).raw}); } catch (e) { errors.push((e as {code: number}).code); }
  }
  await s.close();
  assert.equal(server.received.length, 9);
  assert.ok(server.received.every(r => r.to.length === 1));
  assert.equal(server.transcript.filter(l => l.startsWith('C: AUTH')).length, 1);
  assert.deepEqual(errors, [550]);
});

test('B2-P09: brak serwera na porcie to błąd przejściowy (ponowienie ma sens)', async () => {
  const closed = new TestSmtp({key, cert, users: {}});
  const port = await closed.listen(0, true);
  await closed.close();
  const r = await sendOne(opts({port}), {from: USER, to: 'x@example.org', raw: mail().raw});
  assert.ok(r.error && r.error.temporary, r.error?.message);
});
