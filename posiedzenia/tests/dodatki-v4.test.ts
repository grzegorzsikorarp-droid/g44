import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, people, client} from './serwer-v4.ts';
import {form, jpeg, plainPdf} from './pliki-testowe.ts';
import {closedMeeting} from './scenariusz-v4.ts';

// Dodatki wersji 4 przez API (SPEC-4 rozdz. 8.0, tabela D-1–D-19; zespół D). Każdy test dotyczy jednego dodatku.

test('D-3: „Wyloguj na innych urządzeniach” usuwa pozostałe sesje konta, a to urządzenie zostaje zalogowane', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const phone = client(origin), laptop = client(origin);
    await phone.ok('/api/login', {username: 'eo.test', password: 'Wlasne-haslo-eo.test-2026'});
    await laptop.ok('/api/login', {username: 'eo.test', password: 'Wlasne-haslo-eo.test-2026'});
    const other = p.members.get('ag')!;
    assert.equal((await phone.call('/api/session')).body.account?.username, 'eo.test');
    const r = await laptop.ok('/api/me/sessions/logout-others', {});
    assert.deepEqual(r, {ok: true, removed: 2}, 'sesja z people() i sesja telefonu');
    assert.equal((await laptop.call('/api/session')).body.account?.username, 'eo.test', 'to urządzenie zostaje zalogowane');
    assert.equal((await phone.call('/api/session')).body.account ?? null, null, 'telefon wylogowany');
    assert.equal((await p.members.get('eo')!.call('/api/me')).status, 401, 'pierwsza sesja wylogowana');
    assert.equal((await other.call('/api/me')).status, 200, 'sesje innych kont bez zmian');
    assert.equal((await client(origin).call('/api/me/sessions/logout-others', {})).status, 401, 'bez sesji 401');
    // Konto „Komunikacja” też ma tę czynność w „Moim koncie”.
    assert.equal((await p.comms.call('/api/me/sessions/logout-others', {})).status, 200);
  } finally { await stop(); }
});

test('D-4: wideo MP4 do 25 MB, zakresy bajtów, „Odtwórz”, „Zatrzymaj”, „Od początku” tylko u osoby prowadzącej, głosowanie zatrzymuje film', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const {admin, si} = p, eo = p.members.get('eo')!;
    let m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id;
    const film = new Uint8Array(4096);
    film.set([0, 0, 0, 0x18, ...Buffer.from('ftypmp42')]);
    const upload = (f: FormData) => admin.raw(`/api/meetings/${id}/pokaz`, {method: 'POST', body: f});
    const added = await upload(form([['film.mp4', film, 'video/mp4']], {title: 'Film o szkoleniu'}));
    assert.equal(added.status, 201);
    m = (await added.json()).meeting;
    const video = m.displays[0];
    assert.deepEqual([video.kind, video.pages, video.files[0].type], ['wideo', null, 'mp4']);
    const tooBig = await upload(form([['duzy.mp4', new Uint8Array(26 * 1024 * 1024), 'video/mp4']]));
    assert.deepEqual([tooBig.status, (await tooBig.json()).error], [413, 'Film jest za duży. Dodaj film MP4 do 25 MB.']);
    const pdfAdded = await upload(form([['budzet.pdf', plainPdf(2), 'application/pdf']], {title: 'Budżet'}));
    const pdf = (await pdfAdded.json()).meeting.displays[1];
    // Plik wideo z zakresami bajtów (Safari), CSP z sandbox jak obrazy (5.3).
    const fid = video.files[0].fileId;
    const head = await eo.raw(`/api/meetings/${id}/pokaz/${fid}`, {headers: {Range: 'bytes=0-15'}});
    assert.equal(head.status, 206);
    assert.equal(head.headers.get('content-type'), 'video/mp4');
    assert.equal(head.headers.get('content-range'), `bytes 0-15/${film.length}`);
    assert.equal(head.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'self'; sandbox");
    const cmd = (c: typeof admin, body: object) => c.call(`/api/meetings/${id}/command`, body);
    await si.ok(`/api/meetings/${id}/command`, {type: 'open'});
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show', source: 'plik', id: video.id})).meeting;
    assert.equal(m.show.playing ?? null, null, 'film czeka na „Odtwórz”');
    assert.deepEqual([(await cmd(admin, {type: 'show_play', on: true})).status, (await cmd(admin, {type: 'show_play', on: true})).body.error], [403, 'Pokazuje osoba prowadząca obrady.']);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show_play', on: true})).meeting;
    assert.equal(m.show.playing.from, 0);
    assert.ok(Math.abs(m.show.playing.since - Date.now()) < 5000);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show_play', on: false})).meeting;
    assert.equal(m.show.playing, null);
    assert.ok(m.show.pausedAt >= 0 && m.show.pausedAt < 5);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show_play', on: false, at: 0})).meeting;
    assert.equal(m.show.pausedAt, 0, '„Od początku” przy zatrzymanym filmie');
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'show_play', on: true, at: 12})).meeting;
    assert.equal(m.show.playing.from, 12);
    assert.equal((await cmd(si, {type: 'show_play', on: true, at: -1})).status, 400);
    const member = (await eo.ok(`/api/meetings/${id}`)).meeting;
    assert.equal(member.show.playing.from, 12, 'członek i ekran sali widzą stan odtwarzania');
    // Głosowanie wstrzymuje pokaz i zatrzymuje film; w trakcie głosowania „Odtwórz” daje 409 (G-24).
    for (const [pid, c] of p.members) if (pid !== 'si') await c.ok(`/api/meetings/${id}/command`, {type: 'presence', who: pid, present: true});
    await si.ok(`/api/meetings/${id}/command`, {type: 'presence_confirm_all'});
    await si.ok(`/api/meetings/${id}/command`, {type: 'quorum'});
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'ballot_open', itemId: m.agenda.find((i: {kind: string}) => i.kind === 'porzadek').id, purpose: 'proba', subject: 'Głosowanie próbne', mode: 'jawne', minutes: 2})).meeting;
    assert.equal(m.show.playing, null, 'film zatrzymany na czas głosowania');
    assert.ok(m.show.pausedAt >= 12);
    const during = await cmd(si, {type: 'show_play', on: true});
    assert.equal(during.status, 409);
    assert.match(during.body.error, /^Trwa głosowanie/);
    await si.ok(`/api/meetings/${id}/command`, {type: 'ballot_close', ballotId: m.ballots.at(-1).id});
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'present', kind: 'pokaz', id: video.id})).meeting;
    assert.equal(m.show.playing, null, 'po powrocie film czeka na „Odtwórz”');
    // Odtwarzać można tylko wideo.
    await si.ok(`/api/meetings/${id}/command`, {type: 'show', source: 'plik', id: pdf.id});
    assert.deepEqual([(await cmd(si, {type: 'show_play', on: true})).status], [409]);
  } finally { await stop(); }
});

test('D-5: zgłoszenia czekające na spotkaniu roboczym dodaje do projektu na żywo osoba prowadząca (U-44, B2-W16)', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const {admin, si} = p, eo = p.members.get('eo')!, ag = p.members.get('ag')!;
    let m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id;
    await eo.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'proposal_add', title: 'Dofinansowanie szkolenia', justification: 'Wniosek koła.'}});
    // Przed otwarciem trasy nie ma (w przygotowaniu zgłoszenia są w widoku).
    assert.equal((await si.call(`/api/meetings/${id}/czekajace`)).status, 403);
    await si.ok(`/api/meetings/${id}/command`, {type: 'open'});
    // Posiedzenie zwykłe: lista czekających jest tylko na spotkaniu roboczym.
    assert.deepEqual([(await si.call(`/api/meetings/${id}/czekajace`)).status, (await si.call(`/api/meetings/${id}/czekajace`)).body.error], [403, 'Zgłoszenia czekające dodaje do projektu osoba prowadząca spotkanie robocze, przed przyjęciem porządku obrad.']);
    m = (await si.ok(`/api/meetings/${id}/command`, {type: 'working_start', reason: 'brak_kworum'})).meeting;
    const list = (await si.ok(`/api/meetings/${id}/czekajace`)).proposals;
    assert.deepEqual(list.map((x: {title: string; carriedFrom?: {date: string}}) => [x.title, x.carriedFrom?.date]), [['Dofinansowanie szkolenia', '2026-12-03']], 'zgłoszenie przeniesione przy otwarciu');
    for (const c of [admin, ag, eo]) assert.equal((await c.call(`/api/meetings/${id}/czekajace`, {proposalId: list[0].id})).status, 403, 'tylko osoba prowadząca');
    const before = m.agenda.length;
    const r = await si.ok(`/api/meetings/${id}/czekajace`, {proposalId: list[0].id});
    assert.equal(r.meeting.agenda.length, before + 1);
    assert.deepEqual(r.proposals, []);
    const added = r.meeting.agenda.find((i: {title: string}) => i.title === 'Dofinansowanie szkolenia');
    const entry = r.meeting.log.find((l: {itemId?: string; tag?: string}) => l.itemId === added.id && l.tag === 'projekt');
    assert.equal(entry.text, 'Dodano punkt „Dofinansowanie szkolenia” ze zgłoszenia Edyta Ostrowska, Członek Prezydium.');
    assert.equal((await si.call(`/api/meetings/${id}/czekajace`, {proposalId: list[0].id})).status, 409, 'zgłoszenie ma już decyzję');
    // Członek widzi zmianę projektu przy zwykłym odświeżaniu; zgłoszenie u autora ma stan „Wpisane do projektu”.
    assert.ok((await eo.ok(`/api/meetings/${id}`)).meeting.agenda.some((i: {id: string}) => i.id === added.id));
    const own = (await eo.ok('/api/organs/prezydium/czekajace')).prep.proposals;
    assert.deepEqual(own.map((x: {state: string; decision?: {note?: string}}) => [x.state, x.decision?.note]), [['wpisane', 'spotkanie_robocze']]);
  } finally { await stop(); }
});

test('D-9, D-10, T-5: „Teraz oglądają” za zgodą, wizyty i „Co nowego” tylko w przygotowaniu; od otwarcia nic się nie zapisuje', async () => {
  const t0 = Date.parse('2026-11-25T08:00:00Z');
  let clock = t0;
  const {origin, stop, app} = await startServer({now: () => clock});
  try {
    const p = await people(origin);
    const {admin, si} = p, eo = p.members.get('eo')!, ag = p.members.get('ag')!;
    const m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id, item = m.agenda.find((i: {kind: string}) => i.kind === 'sprawozdania');
    const get = (c: typeof admin, where = '', etag = '') => c.raw(`/api/meetings/${id}`, {headers: {...(where ? {'X-Przygotowanie': where} : {}), ...(etag ? {'If-None-Match': etag} : {})}});
    // Bez zgody nikt nie jest na liście (preferencja domyślnie wyłączona, K4-30).
    await get(eo, `punkt:${item.id}`);
    assert.equal(app.presence.size(id), 0);
    await eo.ok('/api/me/prefs', {showPresence: true}, 'PUT');
    await ag.ok('/api/me/prefs', {showPresence: true}, 'PUT');
    await p.advisor.ok('/api/me/prefs', {showPresence: true}, 'PUT');
    await get(eo, `punkt:${item.id}`);
    await get(ag, 'ustawienia');
    await get(p.advisor);
    assert.equal(app.presence.size(id), 2, 'głos doradczy nie jest na liście');
    const seen = (await (await get(si)).json()).meeting.prep.presence;
    assert.deepEqual(seen.map((r: {name: string; where: string | null; itemId?: string}) => [r.name, r.where, r.itemId ?? null]),
      [['Anna Grzegorczyk', 'w ustawieniach posiedzenia', null], ['Edyta Ostrowska', 'przy punkcie 4', item.id]]);
    const own = (await (await get(eo)).json()).meeting.prep.presence;
    assert.ok(!own.some((r: {name: string}) => r.name === 'Edyta Ostrowska'), 'bez siebie');
    assert.equal((await (await get(p.advisor)).json()).meeting.prep.presence.length, 0, 'głos doradczy nie widzi listy');
    assert.equal((await get(eo, 'punkt:<script>')).status, 200, 'nagłówek spoza wzorca ignorowany');
    // W ciszy ETag stały (304), a wejście innej osoby go zmienia.
    const first = await get(si);
    const etag = first.headers.get('etag')!;
    assert.equal((await get(si, '', etag)).status, 304);
    clock += 25000;
    assert.equal((await get(si, '', etag)).status, 200, 'wpisy innych osób wygasły po 20 s');

    // D-10: pierwsza wizyta bez „Co nowego”, nowa wizyta po 30 minutach przerwy z listą zmian bez własnych działań.
    const feed0 = (await (await get(eo)).json()).meeting.prep.feed;
    assert.equal(feed0.since, null);
    const visitAt = t0;   // ostatni zapis poprzedniej wizyty (zapis najwyżej raz na minutę)
    clock += 60000;
    await si.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'comment_add', target: {kind: 'punkt', itemId: item.id}, text: 'Proszę o sprawozdanie skarbnika.'}});
    clock += 40 * 60000;
    const feed1 = (await (await get(eo)).json()).meeting.prep.feed;
    assert.equal(feed1.since, visitAt);
    assert.ok(feed1.other.some((r: {text: string}) => r.text === 'Nowa uwaga przy punkcie 4.'));
    const tag1 = (await get(eo)).headers.get('etag')!;
    assert.ok(tag1.endsWith(`-${visitAt}"`), 'ETag z poprzednią wizytą');
    const after = await eo.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'seen'}});
    assert.deepEqual([after.prep.feed.other, after.prep.feed.since], [[], clock]);
    assert.equal((await get(eo, '', tag1)).status, 200, '„Oznacz jako przeczytane” zmienia ETag');

    // T-5: po otwarciu obecność pusta i nie rośnie, wizyty się nie zapisują, ETag w formacie wersji 3.
    const visitsBefore = app.store.visitCount(id);
    await get(eo, `punkt:${item.id}`);
    assert.ok(app.presence.size(id) > 0);
    await si.ok(`/api/meetings/${id}/command`, {type: 'open'});
    assert.equal(app.presence.size(id), 0, 'otwarcie czyści obecność');
    clock += 31 * 60000;
    for (const c of [eo, ag, si, p.advisor]) {
      const r = await get(c, `punkt:${item.id}`);
      assert.match(r.headers.get('etag')!, /^"[^-]+-\d+-\d+-[\w-]+"$/, 'ETag w „trwa” bez obecności, wizyty, dnia i katalogu');
      const body = await r.json();
      assert.equal(body.meeting.prep, undefined, 'w „trwa” bez przestrzeni roboczej');
    }
    assert.equal(app.presence.size(id), 0, 'od otwarcia mapa nie rośnie');
    assert.equal(app.store.visitCount(id), visitsBefore, 'od otwarcia wizyty się nie zapisują');
    assert.deepEqual([(await eo.call(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'seen'}})).status], [409]);
  } finally { await stop(); }
});

test('D-12 przez API: uwaga do materiału, stan u osoby referującej i przeniesienie do materiałów jako zwykły materiał punktu', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const {admin} = p, eo = p.members.get('eo')!, kn = p.members.get('kn')!;
    let m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id, item = m.agenda.find((i: {kind: string}) => i.kind === 'sprawozdania');
    m = (await admin.ok(`/api/meetings/${id}/command`, {type: 'item_edit', itemId: item.id, presenters: [{name: 'Krystyna Naczk', role: 'Sekretarz', kind: 'referuje'}]})).meeting;
    const f = new FormData();
    f.append('file', new File(['Sprawozdanie z działalności.'], 'sprawozdanie.txt', {type: 'text/plain'}));
    f.append('title', 'Sprawozdanie'); f.append('itemId', item.id);
    const up = await admin.raw(`/api/meetings/${id}/materials`, {method: 'POST', body: f});
    assert.equal(up.status < 300, true);
    m = (await admin.ok(`/api/meetings/${id}`)).meeting;
    const mat = m.materials[0];
    let r = await eo.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'comment_add', target: {kind: 'material', materialId: mat.id, version: 1, quote: 'działalności'}, text: 'Proszę dopisać liczby.'}});
    const c = r.prep.comments[0];
    assert.equal(c.remark.state, 'otwarta');
    assert.equal(r.prep.progress.openRemarks, 1);
    assert.equal((await p.members.get('ak')!.call(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'remark_state', commentId: c.id, state: 'uwzgledniona'}})).status, 403);
    r = await kn.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'remark_state', commentId: c.id, state: 'uwzgledniona'}});
    assert.deepEqual([r.prep.comments[0].remark.state, r.prep.comments[0].remark.version], ['uwzgledniona', 1]);
    r = await eo.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'comment_to_material', commentId: c.id}});
    const moved = r.meeting.materials.find((x: {title: string}) => x.title === 'Uwagi Edyta Ostrowska do punktu 4');
    assert.ok(moved, 'materiał z uwagi');
    assert.equal(moved.type, 'inny');
    assert.ok(r.meeting.agenda.find((i: {id: string}) => i.id === item.id).materialIds.includes(moved.id));
    assert.equal(r.prep.comments[0].movedTo.materialId, moved.id);
    // Zwykły materiał: widzi go gość zaproszony i każdy z canView; treść z cytatem.
    const html = await eo.ok(`/api/meetings/${id}/materials/${moved.id}`);
    assert.match(JSON.stringify(html), /Cytowany fragment „działalności”/);
  } finally { await stop(); }
});

test('D-13 przez API: „Statystyki składu” dla kręgu z pytania 11, nawigacja w sesji, wydruk w dwóch wariantach i CSV', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const eo = p.members.get('eo')!, kn = p.members.get('kn')!, ag = p.members.get('ag')!;
    for (const [c, can] of [[p.si, true], [ag, true], [kn, true], [p.office, true], [eo, false], [p.comms, false], [p.advisor, false]] as const) {
      assert.equal((await c.ok('/api/session')).can.rosterStats, can);
      const r = await c.call('/api/statystyki/sklad');
      assert.equal(r.status, can ? 200 : 403);
      if (!can && c !== p.comms) assert.equal(r.body.error, 'Statystyki składu widzą biuro, przewodniczący, wiceprzewodniczący i sekretarz.');
    }
    const r = await p.si.ok('/api/statystyki/sklad?rok=2026');
    assert.ok(r.stats.persons.every((x: {rows: unknown[]}) => x.rows.length === 0));
    assert.ok(Array.isArray(r.source));
    const one = await ag.ok('/api/statystyki/sklad/eo?rok=2026');
    assert.deepEqual(one.stats.notes, [], 'uwagi tylko biuro i przewodniczący');
    const csv = await kn.raw('/api/statystyki/sklad?rok=2026&format=csv');
    assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.match(csv.headers.get('content-disposition')!, /2026-01-01_2026-12-31-prezydium-statystyki-skladu\.csv/);
    const html = await (await p.office.raw('/api/statystyki/sklad?rok=2026&format=html&wariant=sprawozdanie')).text();
    assert.ok(html.includes('Statystyki') && !html.includes('Imienne za'));
    assert.equal((await eo.call('/api/statystyki/sklad/eo')).status, 403, 'członek nie widzi „Posiedzeń po kolei” składu');
    assert.equal((await p.si.call('/api/statystyki/sklad?od=2026-05-01&do=2026-01-01')).status, 400);
  } finally { await stop(); }
});

test('D-15: „Materiał dla komunikacji gotowy” tylko do kont komunikacji, po udostępnieniu, przez osoby udostępniające', async () => {
  const {origin, stop, app} = await startServer();
  try {
    const p = await people(origin);
    const {m} = closedMeeting({v4: true});
    app.store.saveMeeting(m, Date.now());
    const preview = (c: typeof p.admin, body: object = {}) => c.call(`/api/meetings/${m.id}/mail/preview`, {kind: 'komunikacja', recipients: {group: 'wszyscy', office: true}, ...body});
    const early = await preview(p.si);
    assert.deepEqual([early.status, early.body.error], [409, 'Najpierw udostępnij materiał komunikacji.']);
    await p.si.ok(`/api/meetings/${m.id}/command`, {type: 'comms_release'});
    const denied = await preview(p.members.get('eo')!);
    assert.deepEqual([denied.status, denied.body.error], [403, 'Materiał udostępnia biuro, przewodniczący albo osoba, która zamknęła obrady.']);
    const ok = (await preview(p.office)).body;
    assert.equal(ok.subject, 'Materiał dla komunikacji z posiedzenia 20.11.2026');
    assert.deepEqual(ok.recipients.map((r: {accountId: string}) => r.accountId), [p.idOf('komunikacja')], 'tylko konto komunikacji, niezależnie od wyboru grupy');
    assert.match(ok.text, /Materiał dla komunikacji z posiedzenia .* z dnia 20 listopada 2026 r\. jest gotowy w aplikacji\./);
    assert.match(ok.text, /Odnośnika do zdjęć jeszcze nie wpisano\./);
    assert.match(ok.text, new RegExp(`#odbyte\\?p=${m.id}`));
    assert.match(ok.text, /Możesz z niej zrezygnować w aplikacji, w części Moje konto, Powiadomienia\./);
    // Wysyłka przy wyłączonej poczcie odmówiona (G-32).
    assert.equal((await p.office.call(`/api/meetings/${m.id}/mail/send`, {kind: 'komunikacja', recipients: {group: 'wybrani', ids: []}})).status, 409);
  } finally { await stop(); }
});

test('D-11 przez API: zadania w przestrzeni roboczej, grupa „Osoby z otwartymi zadaniami” i „Twoje zadania” w podglądzie dla tej osoby', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const {admin, si} = p, eo = p.members.get('eo')!, kn = p.members.get('kn')!;
    const m = (await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    const id = m.id;
    assert.equal((await eo.call(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'task_add', title: 'Projekt uchwały', assignee: {personId: 'kn'}}})).body.error, 'Zadanie dla członka Prezydium przydziela przewodniczący albo zastępca, który zwołuje to posiedzenie (§ 15 pkt 3, § 16 ust. 2).');
    let r = await si.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'task_add', title: 'Projekt uchwały', assignee: {personId: 'kn'}, due: '2026-11-28'}});
    assert.equal(r.prep.tasks.length, 1);
    r = await eo.ok(`/api/meetings/${id}/przygotowanie`, {cmd: {type: 'task_add', title: 'Rezerwacja sali', assignee: {office: true}}});
    assert.equal((await kn.ok(`/api/meetings/${id}`)).meeting.prep.progress.myTasks, 1);
    assert.equal((await p.office.ok(`/api/meetings/${id}`)).meeting.prep.progress.myTasks, 1, 'zadanie dla biura u konta biura');
    const pv = await si.ok(`/api/meetings/${id}/mail/preview`, {kind: 'postep', recipients: {group: 'zadania'}, for: p.idOf('kn.test')});
    assert.deepEqual(pv.recipients.map((x: {accountId: string}) => x.accountId), [p.idOf('kn.test')]);
    assert.match(pv.text, /Twoje zadania\n- Projekt uchwały, termin 28\.11\.2026\./);
    const other = await si.ok(`/api/meetings/${id}/mail/preview`, {kind: 'postep', recipients: {group: 'wszyscy'}, for: p.idOf('eo.test')});
    assert.ok(!other.text.includes('Twoje zadania'), '„Twoje zadania” tylko u osoby, która ma zadania');
  } finally { await stop(); }
});

test('D-16 (B3-40): zgoda na zdjęcie na ekranie sali tylko u osób, które mogą prowadzić obrady; znacznik w mapie zdjęć', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const ag = p.members.get('ag')!, eo = p.members.get('eo')!;
    await ag.raw('/api/me/avatar', {method: 'PUT', body: new Uint8Array(jpeg(300, 300)), headers: {'Content-Type': 'image/jpeg'}});
    assert.deepEqual((await p.office.ok('/api/session')).avatars, {ag: {v: 1}}, 'bez zgody bez znacznika');
    const denied = await eo.call('/api/me/avatar-screen', {on: true}, 'PUT');
    assert.deepEqual([denied.status, denied.body.error], [403, 'Zgodę na zdjęcie na ekranie sali zaznacza osoba, która może prowadzić obrady.']);
    assert.equal((await ag.call('/api/me/avatar-screen', {on: 'tak'}, 'PUT')).status, 400);
    assert.equal((await ag.ok('/api/me/avatar-screen', {on: true}, 'PUT')).account.avatarScreen, true);
    assert.equal((await ag.ok('/api/me')).avatarScreen, true);
    assert.deepEqual((await p.office.ok('/api/session')).avatars, {ag: {v: 1, screen: true}});
    assert.equal((await eo.ok('/api/session')).avatars, null, 'członek nadal nie widzi cudzych zdjęć (pytanie 13 a)');
    assert.equal((await ag.ok('/api/me/avatar-screen', {on: false}, 'PUT')).account.avatarScreen, undefined);
  } finally { await stop(); }
});

test('D-17: zestawienie za okres w formacie Word i Markdown dla osób z canReport, z odnośnikami na stronie wydruku', async () => {
  const {origin, stop, app} = await startServer();
  try {
    const p = await people(origin);
    const {m} = closedMeeting({v4: true});
    app.store.saveMeeting({...m, photos: {url: 'https://photos.app.goo.gl/abc', at: 1, by: 'Biuro', accountId: 'x'}}, Date.now());
    const q = '/api/zestawienie?od=2026-01-01&do=2026-12-31';
    const docx = await p.si.raw(`${q}&format=docx`);
    assert.equal(docx.status, 200);
    assert.equal(docx.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.match(docx.headers.get('content-disposition')!, /zestawienie-2026-01-01-2026-12-31\.docx/);
    const bytes = Buffer.from(await docx.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    const md = await p.members.get('kn')!.raw(`${q}&format=md`);
    assert.equal(md.headers.get('content-type'), 'text/markdown; charset=utf-8');
    const text = await md.text();
    assert.match(text, /^# Zestawienie posiedzeń .* za okres 01\.01\.2026–31\.12\.2026/);
    assert.match(text, /\| 20\.11\.2026 \| posiedzenie \|/);
    assert.ok(!text.includes(' '), 'zwykłe spacje w .md');
    assert.ok(text.includes('<https://photos.app.goo.gl/abc>'));
    const html = await (await p.office.raw(q)).text();
    assert.ok(html.includes('format=docx') && html.includes('format=md'));
    assert.equal((await p.members.get('eo')!.raw(`${q}&format=docx`)).status, 403);
    assert.equal((await p.si.raw(`${q}&format=pdf`)).status, 400);
  } finally { await stop(); }
});
