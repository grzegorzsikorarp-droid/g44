import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, people} from './serwer-v4.ts';
import {closedMeeting} from './scenariusz-v4.ts';
import {unzip} from './docx-text.ts';
import {form, plainPdf} from './pliki-testowe.ts';
import {PAGE_CSP} from '../src/server/app.ts';

// Trasy wersji 4 (SPEC-4 5.2, 5.3, 2.4, 4.3.3, K4-23, K4-25, G-26, G-27, G-38): nagłówki, dokumenty i teczka według uprawnień
// ze spisem, ETag po zamknięciu z dniem, poprawka „Dotyczy protokołu”, fakt „Protokół sporządzony” i dokumenty dołączone.

const isoToday = () => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Warsaw'}).format(Date.now());

test('5.3: CSP stron wersji 4 (blob: w img-src, frame-src, media-src) i nagłówki JSON poza pokazem', async () => {
  const {origin, stop} = await startServer();
  try {
    assert.equal(PAGE_CSP, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    const r = await fetch(origin + '/api/health');
    assert.equal(r.headers.get('content-security-policy'), PAGE_CSP);
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    const p = await people(origin);
    for (const path of ['/api/me', '/api/statystyki/moje']) assert.equal((await p.si.raw(path)).headers.get('cache-control'), 'private, no-store', path);
    assert.equal((await p.admin.raw('/api/mail/state')).headers.get('cache-control'), 'private, no-store');
  } finally { await stop(); }
});

test('4.3.3, K4-23, 5.3: dokumenty i teczka zamkniętego posiedzenia według uprawnień, spis z pominiętymi, ETag z dniem', async () => {
  const {origin, stop, app} = await startServer();
  try {
    const p = await people(origin);
    const {m} = closedMeeting({v4: true});
    app.store.saveMeeting(m, Date.now());
    const eo = p.members.get('eo')!;
    // Dokumenty: strona do druku inline, pliki attachment z nazwą ASCII i UTF-8.
    const print = await eo.raw(`/api/meetings/${m.id}/dokumenty/porzadek`);
    assert.equal(print.status, 200);
    assert.equal(print.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(print.headers.get('content-disposition')!, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    assert.equal(print.headers.get('cache-control'), 'private, no-store');
    const csv = await eo.raw(`/api/meetings/${m.id}/dokumenty/wyniki?format=csv`);
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(csv.headers.get('content-disposition')!, /^attachment; filename="/);
    const docx = await eo.raw(`/api/meetings/${m.id}/dokumenty/protokol?format=docx`);
    assert.equal(docx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal((await p.guest.raw(`/api/meetings/${m.id}/dokumenty/protokol`)).status, 403);
    assert.equal((await p.comms.raw(`/api/meetings/${m.id}/dokumenty/porzadek`)).status, 403);
    assert.equal((await eo.raw(`/api/meetings/${m.id}/dokumenty/nieistniejacy`)).status, 404);
    // Teczka (K4-23): ZIP z plikami, do których osoba ma prawo, i SPIS.txt z sumami; pliki HTML z CSP w <head> (K4-15).
    const zip = await eo.raw(`/api/meetings/${m.id}/teczka.zip`);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    const entries = unzip(new Uint8Array(await zip.arrayBuffer()));
    const names = entries.map(e => e.name);
    assert.ok(names.some(n => /SPIS\.txt$/.test(n)), names.join(', '));
    const spis = Buffer.from(entries.find(e => /SPIS\.txt$/.test(e.name))!.data).toString('utf8');
    assert.match(spis, /[0-9a-f]{64}/, 'sumy SHA-256 w spisie');
    for (const e of entries.filter(x => x.name.endsWith('.html'))) {
      assert.ok(Buffer.from(e.data).toString('utf8').includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`), e.name);
    }
    assert.ok(names.every(n => !n.includes('..') && !n.startsWith('/')));
    assert.equal((await p.guest.raw(`/api/meetings/${m.id}/teczka.zip`)).status, 403, 'gość bez teczki');
    assert.equal((await p.advisor.raw(`/api/meetings/${m.id}/teczka.zip`)).status, 403);
    const history = JSON.stringify(await p.admin.ok('/api/settings/history?area=posiedzenia'));
    assert.ok(history.includes('Pobrano teczkę posiedzenia z dnia'));
    // ETag zamkniętego posiedzenia (2.4): licznik katalogu i dzień.
    const r = await eo.raw(`/api/meetings/${m.id}`);
    const etag = r.headers.get('etag')!;
    assert.equal(etag, `"0.4.0-${m.revision}-${app.store.revision()}-${app.store.archiveRevision()}-${isoToday()}-${p.idOf('eo.test')}"`);
    assert.equal((await eo.raw(`/api/meetings/${m.id}`, {headers: {'If-None-Match': etag}})).status, 304);
    const view = (await r.json()).meeting;
    assert.ok(view.archive, 'widok zakończonego posiedzenia ma dane archiwum');
    assert.equal(view.prep, undefined);
    // G-26, B1-26: plik protokołu bez faktu „Protokół sporządzony” daje wiersz „Do sprawdzenia” biuru i przewodniczącemu.
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(plainPdf(1))], 'protokol.pdf', {type: 'application/pdf'}));
    fd.append('kind', 'protokol_sporzadzony');
    assert.equal((await p.members.get('kn')!.raw(`/api/meetings/${m.id}/zlozone`, {method: 'POST', body: fd})).status, 201);
    const check = 'Dołączono plik protokołu. Wpisz datę sporządzenia i osobę, która sporządziła protokół.';
    assert.deepEqual((await p.admin.ok(`/api/meetings/${m.id}`)).meeting.archive.checks, [check]);
    assert.deepEqual((await p.si.ok(`/api/meetings/${m.id}`)).meeting.archive.checks, [check]);
    assert.equal((await eo.ok(`/api/meetings/${m.id}`)).meeting.archive.checks, undefined, 'członek bez wierszy do sprawdzenia');
  } finally { await stop(); }
});

test('G-27, G-38, G-26, K4-7: „Protokół sporządzony” z osobą, poprawka „Dotyczy protokołu” z powodem, dokument dołączony', async () => {
  const {origin, stop, app} = await startServer();
  try {
    const p = await people(origin);
    const {m} = closedMeeting({v4: true});
    app.store.saveMeeting(m, Date.now());
    const cmd = (c: typeof p.admin, body: object) => c.call(`/api/meetings/${m.id}/command`, body);
    const kn = p.members.get('kn')!, eo = p.members.get('eo')!;
    // G-27: bez osoby sporządzającej odmowa; członek bez prawa.
    assert.equal((await cmd(p.admin, {type: 'minutes_ready', date: isoToday()})).body.error, 'Wybierz osobę, która sporządziła protokół.');
    assert.equal((await cmd(eo, {type: 'minutes_ready', date: isoToday(), authorPersonId: 'kn'})).status, 403);
    assert.equal((await cmd(p.admin, {type: 'minutes_ready', date: '2099-01-01', authorPersonId: 'kn'})).body.error, 'Data sporządzenia nie może być późniejsza niż dziś.');
    const ready = (await kn.ok(`/api/meetings/${m.id}/command`, {type: 'minutes_ready', date: isoToday(), authorPersonId: 'kn'})).meeting;
    assert.equal(ready.minutesReady.author.name, 'Krystyna Naczk');
    assert.ok(ready.log.some((l: {text: string}) => l.text.endsWith('Sporządza Krystyna Naczk, Sekretarz.')));
    const advisorView = (await p.advisor.call(`/api/meetings/${m.id}`));
    if (advisorView.status === 200) assert.equal(advisorView.body.meeting.minutesReady, undefined, 'głos doradczy bez faktów po posiedzeniu');
    // G-38: poprawka „Dotyczy protokołu” tylko przewodniczący, tylko przy pustym polu, z powodem do dziennika.
    const earlier = {...closedMeeting({v4: true}).m, id: 'm-wczesniej', date: '2026-10-15'};
    app.store.saveMeeting(earlier, Date.now());
    const withAdoption = structuredClone(ready);
    const adoption = withAdoption.ballots.find((b: {purpose: string}) => b.purpose === 'porzadek');
    const resolution = withAdoption.ballots.find((b: {purpose: string}) => b.purpose === 'uchwala');
    adoption.purpose = 'protokol';
    delete adoption.protocolOf;
    app.store.saveMeeting({...m, ballots: withAdoption.ballots, minutesReady: ready.minutesReady, revision: ready.revision + 1}, Date.now());
    const fixBody = {type: 'ballot_protocol_fix', ballotId: adoption.id, protocolOf: earlier.id, reason: 'Pole „Dotyczy protokołu” było puste.'};
    assert.deepEqual([(await cmd(p.admin, fixBody)).status, (await cmd(p.admin, fixBody)).body.error], [403, 'Poprawkę wpisuje przewodniczący (§ 13 ust. 3, § 15 pkt 3).']);
    assert.equal((await cmd(p.si, {...fixBody, reason: ' '})).body.error, 'Podaj powód poprawki. Trafi do dziennika.');
    assert.equal((await cmd(p.si, {...fixBody, ballotId: resolution.id})).status, 409, 'głosowanie w sprawie uchwały bez poprawki');
    const fixed = (await p.si.ok(`/api/meetings/${m.id}/command`, fixBody)).meeting;
    const fb = fixed.ballots.find((b: {id: string}) => b.id === adoption.id);
    assert.equal(fb.protocolOf, earlier.id);
    assert.equal(fb.protocolOfFix.reason, 'Pole „Dotyczy protokołu” było puste.');
    assert.ok(fixed.log.at(-1).text.startsWith(`Poprawiono, którego protokołu dotyczy głosowanie nr ${fb.number}, z „brak” na „`));
    // G-26: dokument dołączony (PDF) po zamknięciu; członek nie dołącza; plik pobiera ten, kto widzi projekt protokołu.
    const send = (c: typeof p.admin, f: FormData) => c.raw(`/api/meetings/${m.id}/zlozone`, {method: 'POST', body: f});
    assert.equal((await send(eo, form([['podpisany.pdf', plainPdf(1), 'application/pdf']], {kind: 'protokol_podpisany'}))).status, 403);
    const filed = await send(kn, form([['podpisany.pdf', plainPdf(1), 'application/pdf']], {kind: 'protokol_podpisany', title: 'Protokół podpisany'}));
    assert.equal(filed.status, 201);
    const fm = (await filed.json()).meeting;
    const doc = fm.filed.at(-1);
    assert.deepEqual([doc.kind, doc.fileName], ['protokol_podpisany', 'podpisany.pdf']);
    assert.match(doc.sha256, /^[0-9a-f]{64}$/);
    const file = await eo.raw(`/api/meetings/${m.id}/files/${doc.fileId}`);
    assert.equal(file.status, 200);
    assert.match(file.headers.get('content-disposition')!, /^attachment; filename\*=UTF-8''podpisany\.pdf$/);
    assert.equal((await p.guest.raw(`/api/meetings/${m.id}/files/${doc.fileId}`)).status, 403);
    const bad = await send(kn, form([['strona.html', new TextEncoder().encode('<html><script>x</script></html>'), 'text/html']], {kind: 'inny'}));
    assert.ok(bad.status >= 400 && bad.status < 500);
    assert.equal((await kn.ok(`/api/meetings/${m.id}/zlozone/${doc.id}`, undefined, 'DELETE')).meeting.filed.length, fm.filed.length - 1);
  } finally { await stop(); }
});
