import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/shared/meeting.ts';
import {canSendMail, defaultMailSettings, mailRecipients, mailSettingsOf, MAIL_LIMITS, skippedText, validAddress, validateMail, ADDRESS_REFUSAL, defaultPrefs, type AccountContact} from '../src/shared/mail.ts';
import {afterMail, codeMail, minutesMail, progressMail, testMail, type MailBase} from '../src/shared/mail-templates.ts';
import {progress} from '../src/shared/workspace.ts';
import {addressHeader, buildMessage, mailDate, quotedPrintable, textHeader} from '../src/server/mail/mime.ts';
import {seedOrgans} from '../src/server/seed.ts';
import {parse, decodeWords} from './mail-parse.ts';
import {actor, context, newMeeting, roster} from './helpers.ts';
import {envWith} from './scenariusz-v4.ts';

// Poczta: adresy (K4-14), ustawienia (G-19–G-21), kto i kiedy wysyła (G-32, K4-13), odbiorcy (DB-17), wzory wiadomości
// (6.7.2, DB-18, K4-7, K4-21) i budowa MIME (RFC 5322, 2045–2047), sprawdzana niezależnym odczytem (tests/mail-parse.ts).

const office = actor(null, 'biuro', true);
const reasonOf = (r: {allowed: boolean}) => 'reason' in r ? (r as {reason: string}).reason : null;
const chair = actor('si');
const member = actor('eo');
const env = envWith();
const base: MailBase = {appUrl: 'https://posiedzenia.example.org', settings: {controller: 'Administrator Przykładowy', privacyUrl: 'https://example.org/dane'}, organ: seedOrgans.find(o => o.code === 'prezydium')!};

test('K4-14: jedna reguła adresu e-mail (bez polskich znaków, spacji, nawiasów i znaków nowego wiersza)', () => {
  for (const ok of ['jan.kowalski@example.org', 'a+b@sub.example.org', 'x_y-z@example-1.org', `${'a'.repeat(64)}@example.org`]) assert.ok(validAddress(ok), ok);
  for (const bad of ['', 'jan', 'jan@', '@example.org', 'jan@example', 'jan kowalski@example.org', 'żaneta@example.org', 'jan@exąmple.org', 'jan@example.org\r\nBcc: x@example.org',
    'jan@example.org\n', 'jan\0@example.org', '<jan@example.org>', 'jan(x)@example.org', '"jan"@example.org', 'jan..k@example.org', '.jan@example.org', 'jan.@example.org',
    'jan@-example.org', 'jan@example-.org', 'a@b@example.org', `${'a'.repeat(65)}@example.org`, `a@${'b'.repeat(64)}.org`, 'jan,ewa@example.org', 'jan;x@example.org']) {
    assert.equal(validAddress(bad), false, JSON.stringify(bad));
  }
  assert.equal(ADDRESS_REFUSAL, 'Wpisz poprawny adres e-mail, bez polskich znaków, spacji i nawiasów.');
});

test('G-19–G-21: ustawienia poczty, włączenie tylko z kompletem warunków; zapis wyłączonej poczty bez serwera', () => {
  const envOk = {passwordSet: true, hostAllowed: 'smtp.example.org', appUrl: 'https://posiedzenia.example.org'};
  assert.deepEqual(validateMail(mailSettingsOf({}), envOk), [], 'wyłączona poczta bez serwera zapisuje się');
  const on = mailSettingsOf({enabled: true, host: 'smtp.example.org', port: 465, security: 'tls', user: 'posiedzenia@example.org', fromAddress: 'posiedzenia@example.org', privacyUrl: 'https://example.org/dane'});
  assert.deepEqual(validateMail(on, envOk), []);
  assert.deepEqual(validateMail({...on, host: 'inny.example.org'}, envOk), ['Poczty nie można włączyć. Brakuje zgody serwera aplikacji na ten serwer poczty.']);
  assert.deepEqual(validateMail(on, {...envOk, passwordSet: false, appUrl: 'http://localhost:3000'}), ['Poczty nie można włączyć. Brakuje adresu aplikacji z https na serwerze i hasła na serwerze aplikacji.']);
  assert.deepEqual(validateMail({...on, privacyUrl: 'http://example.org/dane'}, envOk), ['Poczty nie można włączyć. Brakuje adresu informacji o przetwarzaniu danych z https.']);
  assert.ok(validateMail({...on, port: 70000}, envOk).includes('Port musi być liczbą od 1 do 65535.'));
  assert.ok(validateMail({...on, replyTo: 'biuro @example.org'}, envOk).includes(ADDRESS_REFUSAL));
  assert.ok(validateMail({...on, user: 'login\r\nRCPT TO:<x@example.org>'}, envOk).includes('Login nie może zawierać znaku nowego wiersza.'));
  assert.ok(validateMail({...on, intros: {postep: 'x'.repeat(MAIL_LIMITS.introMax + 1), po_posiedzeniu: 'y'}}, envOk).includes('Wstęp może mieć najwyżej 1500 znaków.'));
  assert.ok(validateMail({...on, security: 'brak' as never}, envOk).includes('Wybierz szyfrowanie TLS albo STARTTLS.'), 'trybu bez szyfrowania nie ma');
  assert.equal(JSON.stringify(defaultMailSettings).includes('password'), false, 'hasła nie ma w ustawieniach (5.4)');
});

test('G-32, K4-13: kto i kiedy wysyła; w trwającym posiedzeniu nic, informacja o postępie najwyżej co 60 minut', () => {
  const ctx = context();
  const m = newMeeting(ctx);
  const t = Date.parse('2026-11-18T10:00:00Z');
  assert.equal(canSendMail('postep', roster, m, office, {now: t, lastProgressAt: null}).allowed, true);
  assert.equal(canSendMail('postep', roster, m, chair, {now: t, lastProgressAt: null}).allowed, true);
  const byMember = canSendMail('postep', roster, m, member, {now: t, lastProgressAt: null});
  assert.equal(byMember.allowed, false);
  assert.equal(byMember.status, 403);
  const tooSoon = canSendMail('postep', roster, m, office, {now: t, lastProgressAt: t - 20 * 60000});
  assert.equal(tooSoon.status, 409);
  assert.equal(reasonOf(tooSoon), 'Informację o postępie wysłano o godz. 10:40. Kolejną można wysłać po godz. 11:40.');
  assert.equal(reasonOf(canSendMail('postep', roster, m, office, {now: t, lastProgressAt: null, enabled: false})), 'Poczta jest wyłączona. Włącza ją biuro w ustawieniach ogólnych.');
  const opened = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const kind of ['postep', 'po_posiedzeniu', 'protokol'] as const) {
    const r = canSendMail(kind, roster, opened, office, {now: t, lastProgressAt: null});
    assert.deepEqual([r.allowed, r.status, reasonOf(r)], [false, 409, 'Posiedzenie trwa. Wiadomość wyślesz po zamknięciu.'], kind);
  }
  assert.equal(reasonOf(canSendMail('po_posiedzeniu', roster, m, office, {now: t, lastProgressAt: null})), 'Powiadomienie o dokumentach wysyła się po zamknięciu posiedzenia.');
  const closed = {...opened, status: 'zakonczone' as const, closedAt: ctx.now, closedBy: {accountId: chair.account.id, name: chair.name}};
  assert.equal(canSendMail('po_posiedzeniu', roster, closed, office, {now: t, lastProgressAt: null}).allowed, true);
  assert.equal(canSendMail('po_posiedzeniu', roster, closed, member, {now: t, lastProgressAt: null}).status, 403);
  assert.equal(reasonOf(canSendMail('protokol', roster, closed, office, {now: t, lastProgressAt: null})), 'Wiadomość „Protokół do wglądu” wychodzi po wpisaniu, kto i kiedy sporządził protokół.');
  assert.equal(reasonOf(canSendMail('postep', roster, closed, office, {now: t, lastProgressAt: null})), 'Informację o postępie wysyła się w przygotowaniu posiedzenia.');
});

test('DB-17: odbiorcy wysyłki z powodem pominięcia (brak adresu, niepotwierdzony, rezygnacja); wiadomość służbowa bez rezygnacji', () => {
  const ctx = context();
  const m = newMeeting(ctx);
  const c = (accountId: string, personId: string | null, kind: AccountContact['kind'], email: string | null, state: AccountContact['emailState'], prefs = defaultPrefs, disabled = false): AccountContact =>
    ({accountId, personId, name: accountId, kind, email, emailState: state, prefs, disabled});
  const contacts = [
    c('u-si', 'si', 'czlonek', 'si@example.org', 'potwierdzony'),
    c('u-ag', 'ag', 'czlonek', null, 'brak'),
    c('u-jw', 'jw', 'czlonek', 'jw@example.org', 'niepotwierdzony'),
    c('u-kn', 'kn', 'czlonek', 'kn@example.org', 'potwierdzony', {...defaultPrefs, postep: false}),
    c('u-az', 'az', 'czlonek', 'az@example.org', 'potwierdzony', defaultPrefs, true),
    c('u-biuro', null, 'biuro', 'biuro@example.org', 'potwierdzony'),
    c('u-gosc', null, 'gosc', 'gosc@example.org', 'potwierdzony'),
  ];
  const rows = mailRecipients('postep', roster, m, contacts, {group: 'wszyscy', office: true});
  assert.deepEqual(rows.map(r => [r.accountId, r.state]), [['u-si', 'wysle'], ['u-ag', 'brak_adresu'], ['u-jw', 'niepotwierdzony'], ['u-kn', 'wylaczone'], ['u-biuro', 'wysle']]);
  assert.equal(skippedText(rows[1]), 'u-ag nie ma potwierdzonego adresu e-mail.');
  assert.equal(skippedText(rows[3]), 'u-kn ma wyłączone te wiadomości.');
  assert.equal(skippedText(rows[0]), null);
  assert.ok(!rows.some(r => r.accountId === 'u-gosc' || r.accountId === 'u-az'), 'gość i konto zablokowane poza listą');
  const service = mailRecipients('protokol', roster, m, contacts, {group: 'wszyscy'});
  assert.equal(service.find(r => r.accountId === 'u-kn')!.state, 'wysle', '„Protokół do wglądu” jest służbowy');
  const chosen = mailRecipients('postep', roster, m, contacts, {group: 'wybrani', ids: ['u-si', 'u-gosc']});
  assert.deepEqual(chosen.map(r => r.accountId), ['u-si'], 'wybór tylko spośród składu i biura');
});

test('6.7.2, K4-21: informacja o postępie z jednej funkcji postępu; zdanie o zawiadomieniu; stopka z administratorem danych', () => {
  const ctx = context();
  const m = newMeeting(ctx);
  const p = progress(env, m, null, office, Date.parse('2026-11-18T15:10:00Z'));
  const mail = progressMail(m, p, {...base, intro: 'Przesyłam informację o stanie przygotowań posiedzenia.', sender: {name: 'Anna Grzegorczyk', func: 'I Wiceprzewodnicząca'}, now: Date.parse('2026-11-18T15:10:00Z')});
  assert.equal(mail.subject, `Przygotowanie posiedzenia 20.11.2026, gotowe ${p.ready} z ${p.total} ${p.total === 1 ? 'punktu' : 'punktów'}`);
  assert.ok(mail.text.includes(p.text));
  assert.ok(mail.text.includes('To nie jest zawiadomienie o posiedzeniu (§ 7 ust. 1).'));
  assert.ok(mail.text.includes('Stan przygotowań 18.11.2026, godz. 16:10'));
  assert.ok(mail.text.includes('Wiadomość wysyła Anna Grzegorczyk, I Wiceprzewodnicząca.'));
  assert.ok(mail.text.includes('Administratorem danych jest Administrator Przykładowy.'));
  assert.ok(mail.text.includes('https://posiedzenia.example.org/#p-m1'));
  for (const t of [mail.subject, mail.text]) {
    assert.ok(!/—/.test(t), 'bez pauzy');
    assert.ok(!/(^|\n)[^\n]*\b[A-ZŁŚŻ][a-ząćęłńóśźż ]+: /.test(t.replace(/https?:\/\/\S+/g, '')), 'bez dwukropków w zdaniach');
  }
  assert.ok(!/border-radius/.test(mail.html) && /border-left:6px solid/.test(mail.html), 'pasek 6 px, bez zaokrągleń');
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(mail.html.replace(/(background|color|border-left|border-top):[^;"]+/g, '')), 'kolory tylko z tokenów');
});

test('DB-18, K4-7: dokumenty po posiedzeniu bez nazw uchwał i bez imion przy głosach; „Protokół do wglądu” tylko z faktem sporządzenia', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  const closed = {...m, status: 'zakonczone' as const, closedAt: ctx.now, minutesReady: undefined};
  const after = afterMail(closed, {...base, intro: 'Dokumenty z posiedzenia są dostępne w aplikacji.', sender: {office: 'biuro'}, acts: 0});
  assert.equal(after.subject, 'Dokumenty po posiedzeniu 20.11.2026');
  assert.ok(after.text.includes('Protokół sporządza się w ciągu 21 dni, do 11.12.2026 (§ 13 ust. 2).'), after.text);
  assert.ok(!after.text.includes('Irzykowski') && !after.text.includes('Ostrowska'), 'bez nazwisk');
  assert.throws(() => minutesMail(closed, base), {message: 'Brak faktu „Protokół sporządzony”.'});
  const ready = {...closed, minutesReady: {date: '2026-11-25', author: {personId: 'kn', name: 'Krystyna Naczk', func: 'Sekretarz'}, by: 'Biuro', at: ctx.now}};
  const mm = minutesMail(ready as never, base);
  assert.ok(mm.text.includes('Protokół sporządzono 25.11.2026. Sporządza Krystyna Naczk, Sekretarz.'));
  const code = codeMail('123456', base);
  assert.ok(code.text.includes('Kod 123 456.') && !code.text.includes('http://') && !code.text.includes('#p-'), 'kod bez linku');
  assert.equal(testMail({...base, at: ctx.now}).subject, 'Wiadomość próbna');
});

test('RFC 5322 i 2045–2047: wiadomość 7-bitowa, CRLF, wiersze do 78 znaków, polskie nagłówki, tekst przed HTML', () => {
  const ctx = context();
  const m = newMeeting(ctx);
  const p = progress(env, m, null, office, ctx.now);
  const content = progressMail(m, p, {...base, intro: 'Zażółć gęślą jaźń. Bardzo długi wiersz wstępu, który na pewno przekroczy siedemdziesiąt sześć znaków i wymusi miękkie złamanie.\n.Wiersz z kropką na początku i spacją na końcu ', sender: {office: 'biuro'}, now: ctx.now});
  const mail = {from: {name: 'Posiedzenia – biuro (próba)', address: 'posiedzenia@example.org'}, replyTo: {name: 'Biuro', address: 'biuro@example.org'},
    to: {name: 'Jan Przykładowy-Żółkiewski z bardzo długim nazwiskiem do zawinięcia', address: 'jan@example.org'}, ...content, headers: [['X-Posiedzenia-Wysylka', 'b-1']] as [string, string][]};
  const built = buildMessage(mail, new Date('2026-11-20T15:10:07Z'), '<id.1@example.org>');
  const parsed = parse(built.raw);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.headers.get('subject'), content.subject);
  assert.equal(parsed.headers.get('from'), 'Posiedzenia – biuro (próba) <posiedzenia@example.org>');
  assert.equal(parsed.headers.get('to'), `${mail.to.name} <jan@example.org>`);
  assert.equal(parsed.headers.get('date'), 'Fri, 20 Nov 2026 16:10:07 +0100');
  assert.equal(parsed.headers.get('message-id'), '<id.1@example.org>');
  assert.equal(parsed.headers.get('auto-submitted'), 'auto-generated');
  assert.equal(parsed.headers.get('x-posiedzenia-wysylka'), 'b-1');
  assert.equal(parsed.text.replace(/\r\n/g, '\n'), content.text);
  assert.equal(parsed.html.replace(/\r\n/g, '\n'), content.html);
  assert.ok(built.raw.indexOf('text/plain') < built.raw.indexOf('text/html'));
  assert.ok(!/^Bcc:|^Cc:/m.test(built.raw), 'jedna wiadomość, jeden odbiorca');
  assert.equal(mailDate(new Date('2026-07-01T10:00:00Z')), 'Wed, 01 Jul 2026 12:00:00 +0200');
});

test('K4-14: wstrzyknięcie nagłówka niemożliwe (adres odrzucony, znaki sterujące w temacie i nazwie zamienione na spację)', () => {
  assert.throws(() => addressHeader('To', {address: 'jan@example.org\r\nBcc: x@example.org'}), {message: 'Nieprawidłowy adres e-mail w nagłówku To.'});
  const subject = textHeader('Subject', 'Temat\r\nBcc: x@example.org');
  assert.ok(!subject.includes('\r\nBcc') && decodeWords(subject.slice(9)).includes('Temat Bcc'), subject);
  const named = addressHeader('From', {name: 'Biuro\r\nBcc: x@example.org', address: 'biuro@example.org'});
  assert.ok(!/\r\nBcc/.test(named));
  assert.throws(() => buildMessage({from: {address: 'a@example.org'}, to: {address: 'b@example.org'}, subject: 's', text: 't', html: 'h', headers: [['X-Test', 'a\r\nBcc: x@example.org']]}), {message: 'Nieprawidłowy nagłówek.'});
  const long = textHeader('Subject', 'Przygotowanie posiedzenia 3.12.2026, gotowe 7 z 9 punktów, ze szczegółami zażółć gęślą jaźń');
  assert.ok(long.split('\r\n').every(l => l.length <= 76) && long.split('\r\n').length > 1);
  assert.ok(quotedPrintable('ą'.repeat(100) + ' ').split('\r\n').every(l => l.length <= 76));
  assert.ok(quotedPrintable('koniec ').endsWith('=20'));
});
