import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, people} from './serwer-v4.ts';
import {form, plainPdf, png} from './pliki-testowe.ts';

// Pokaz plików przez API (SPEC-4 4.3.4, 5.2, 5.3, G-24, G-25, B3-15–B3-27, K4-26): kto dodaje, kto pokazuje, nagłówki pliku,
// zakresy bajtów, pokaz zamknięty przez głosowanie, pliki pokazane zostają w dokumentacji.

test('4.3.4, G-24, G-25, 5.3: dodanie, pokaz osoby prowadzącej, plik z zakresami bajtów i nagłówkami, pokazany plik zostaje', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const {admin, si} = p, eo = p.members.get('eo')!, jw = p.members.get('jw')!;
    let m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id;
    const upload = (c: typeof admin, f: FormData) => c.raw(`/api/meetings/${id}/pokaz`, {method: 'POST', body: f});
    // W przygotowaniu: biuro, przewodniczący, wiceprzewodniczący; członek nie.
    const denied = await upload(eo, form([['wykres.png', png(800, 600), 'image/png']]));
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, 'Pliki do pokazania dodaje biuro, przewodniczący albo wiceprzewodniczący.');
    const pptx = await upload(admin, form([['slajdy.pptx', png(10, 10), 'application/octet-stream']]));
    assert.equal(pptx.status, 415, 'prezentacja PowerPoint odrzucona po nazwie');
    const added = await upload(jw, form([['wykres.png', png(800, 600), 'image/png']], {title: 'Wykres wydatków'}));
    assert.equal(added.status, 201);
    m = (await added.json()).meeting;
    assert.deepEqual(m.displays.map((d: {title: string; kind: string}) => [d.title, d.kind]), [['Wykres wydatków', 'obraz']]);
    const pdfAdded = await upload(admin, form([['budzet.pdf', plainPdf(3), 'application/pdf']], {title: 'Projekt budżetu'}));
    assert.equal(pdfAdded.status, 201);
    m = (await pdfAdded.json()).meeting;
    const [image, pdf] = m.displays;
    assert.equal(pdf.pages, 3);
    // Plik pokazu: nagłówki 5.3, zakresy bajtów (K4-26); członek z canView też pobiera.
    const fileId = image.files[0].fileId;
    const full = await eo.raw(`/api/meetings/${id}/pokaz/${fileId}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'image/png');
    assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(full.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'self'; sandbox");
    assert.equal(full.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.match(full.headers.get('content-disposition')!, /^inline; filename\*=UTF-8''wykres\.png$/);
    const bytes = new Uint8Array(await full.arrayBuffer());
    assert.ok(!Buffer.from(bytes).includes(Buffer.from('Jan Testowy')), 'metadane PNG usunięte');
    const part = await eo.raw(`/api/meetings/${id}/pokaz/${fileId}`, {headers: {Range: 'bytes=0-7'}});
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes 0-7/${bytes.length}`);
    assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [...bytes.slice(0, 8)]);
    assert.equal((await eo.raw(`/api/meetings/${id}/pokaz/${fileId}`, {headers: {Range: `bytes=${bytes.length + 5}-`}})).status, 416);
    const pdfHead = await eo.raw(`/api/meetings/${id}/pokaz/${pdf.files[0].fileId}`);
    assert.equal(pdfHead.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'self'", 'PDF bez sandbox (przeglądarka PDF.js w aplikacji)');
    assert.equal((await p.guest.raw(`/api/meetings/${id}/pokaz/${fileId}`)).status, 403, 'gość niezaproszony nie widzi posiedzenia');
    assert.equal((await p.comms.raw(`/api/meetings/${id}/pokaz/${fileId}`)).status, 403);
    assert.equal((await eo.raw(`/api/meetings/${id}/pokaz/plik_nieistniejacy`)).status, 404);

    // Trwa: pokazuje tylko osoba prowadząca; głosowanie zamyka pokaz (G-24).
    const cmd = (c: typeof admin, body: object) => c.call(`/api/meetings/${id}/command`, body);
    await si.ok(`/api/meetings/${id}/command`, {type: 'open'});
    const byOffice = await cmd(admin, {type: 'show', source: 'plik', id: pdf.id});
    assert.deepEqual([byOffice.status, byOffice.body.error], [403, 'Pokazuje osoba prowadząca obrady.']);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show', source: 'plik', id: pdf.id, page: 2})).meeting;
    assert.deepEqual([m.show.id, m.show.page, m.presentation.kind], [pdf.id, 2, 'pokaz']);
    assert.equal((await cmd(si, {type: 'show_page', page: 9})).body.error, 'Tej strony nie ma w pliku.');
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show_page', page: 3})).meeting;
    assert.equal(m.show.page, 3);
    const member = (await eo.ok(`/api/meetings/${id}`)).meeting;
    assert.deepEqual([member.show.id, member.show.page], [pdf.id, 3], 'członek widzi pokaz na żywo');
    assert.ok(m.log.some((l: {tag?: string; displayId?: string}) => l.tag === 'pokaz' && l.displayId === pdf.id));
    // Pokazany plik nie znika z dokumentacji (G-25); niepokazany można usunąć.
    assert.equal((await cmd(admin, {type: 'display_remove', id: pdf.id})).body.error, 'Ten plik pokazano na posiedzeniu, więc zostaje w dokumentacji.');
    for (const [pid, c] of p.members) if (pid !== 'si') await c.ok(`/api/meetings/${id}/command`, {type: 'presence', who: pid, present: true});
    await si.ok(`/api/meetings/${id}/command`, {type: 'presence_confirm_all'});
    await si.ok(`/api/meetings/${id}/command`, {type: 'quorum'});
    const item = m.agenda.find((i: {kind: string}) => i.kind === 'porzadek');
    await si.ok(`/api/meetings/${id}/command`, {type: 'item_start', itemId: item.id});
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'ballot_open', itemId: item.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2})).meeting;
    assert.equal(m.presentation.kind, 'glosowanie', 'głosowanie przejmuje ekran');
    const blocked = await cmd(si, {type: 'show', source: 'plik', id: image.id});
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /^Trwa głosowanie nr \d+\. Pokaz wróci po jego zakończeniu\.$/);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'ballot_close', ballotId: m.ballots.at(-1).id})).meeting;
    assert.equal(m.show, null, 'pokaz nie wraca sam po głosowaniu');
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'display_remove', id: image.id})).meeting;
    assert.deepEqual(m.displays.map((d: {id: string}) => d.id), [pdf.id]);
  } finally { await stop(); }
});

test('B3-17, G-34: limit ciała na trasie pokazu i odmowa plików aktywnych (PDF z akcją)', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const m = (await p.admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const active = await p.admin.raw(`/api/meetings/${m.id}/pokaz`, {method: 'POST', body: form([['akcja.pdf', plainPdf(1, '/OpenAction << /S /JavaScript /JS (app.alert(1)) >> '), 'application/pdf']])});
    assert.ok(active.status >= 400 && active.status < 500, String(active.status));
    assert.match((await active.json()).error, /PDF/);
    const big = await p.admin.raw(`/api/meetings/${m.id}/pokaz`, {method: 'POST', body: form([['duzy.png', new Uint8Array(11 * 1024 * 1024), 'image/png']])});
    assert.equal(big.status, 413);
  } finally { await stop(); }
});
