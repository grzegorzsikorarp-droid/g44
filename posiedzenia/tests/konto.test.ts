import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startServer, people} from './serwer-v4.ts';
import {jpeg, png} from './pliki-testowe.ts';

// „Moje konto”, zdjęcia profilowe i konto „Komunikacja” przez API (SPEC-4 2.5, 4.3.5, 4.4, 5.2, DB-19, B3-30–B3-37, G-35,
// pytanie 13 wariant a).

test('2.5, DB-19: sesja wersji 4 (zdjęcia dla kręgu, strona startowa, poczta, nawigacja) bez adresów e-mail; preferencje', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const eo = p.members.get('eo')!;
    const s = (await p.si.ok('/api/session'));
    assert.equal(s.photoCircle, 'biuro, administrator, przewodniczący i wiceprzewodniczący');
    assert.deepEqual(s.avatars, {});
    assert.deepEqual(s.mail, {enabled: false});
    assert.deepEqual(Object.keys(s.can).sort(), ['catalog', 'ownStats', 'report', 'rosterStats']);
    assert.equal(s.home, undefined);
    const member = await eo.ok('/api/session');
    assert.equal(member.avatars, null, 'członek nie widzi cudzych zdjęć (pytanie 13 a)');
    assert.equal(member.mail, undefined, 'członek nie wysyła wiadomości z posiedzenia');
    assert.equal((await p.comms.ok('/api/session')).home, '#odbyte');
    assert.ok(!JSON.stringify(s).includes('@'), 'sesja bez adresów e-mail');
    const me = await eo.ok('/api/me');
    assert.deepEqual([me.email, me.emailState, me.prefs], [null, 'brak', {postep: true, po_posiedzeniu: true, showPresence: false}]);
    assert.deepEqual((await eo.ok('/api/me/prefs', {postep: false}, 'PUT')).prefs, {postep: false, po_posiedzeniu: true, showPresence: false});
    assert.equal((await eo.call('/api/me/prefs', {postep: 'nie'}, 'PUT')).status, 400);
    assert.equal((await eo.ok('/api/me')).prefs.postep, false);
  } finally { await stop(); }
});

test('4.3.5, G-35, B3-33: własne zdjęcie (JPEG bez metadanych), krąg oglądających, usunięcie cudzego przez administratora z powodem', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    const eo = p.members.get('eo')!, ag = p.members.get('ag')!;
    const put = (c: typeof eo, bytes: Uint8Array, type = 'image/jpeg') => c.raw('/api/me/avatar', {method: 'PUT', body: new Uint8Array(bytes), headers: {'Content-Type': type}});
    const asPng = await put(eo, png(300, 300), 'image/png');
    assert.deepEqual([asPng.status, (await asPng.json()).error], [415, 'Zdjęcie musi być plikiem JPG.']);
    assert.equal((await put(eo, jpeg(300, 200))).status, 400, 'zdjęcie musi być kwadratem');
    assert.equal((await put(eo, jpeg(100, 100))).status, 400, 'najmniej 256 px');
    const okPut = await put(eo, jpeg(300, 300));
    assert.equal(okPut.status, 200);
    assert.equal((await okPut.json()).account.avatar, 1);
    const own = await eo.raw('/api/avatars/eo');
    assert.equal(own.status, 200, 'własne zdjęcie widać zawsze');
    assert.equal(own.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(own.headers.get('content-type'), 'image/jpeg');
    const bytes = Buffer.from(await own.arrayBuffer());
    assert.ok(!bytes.includes(Buffer.from('GPS')) && !bytes.includes(Buffer.from('Komentarz z aparatu')), 'bez EXIF i komentarza');
    // Krąg z pytania 13 (a): biuro, administrator, przewodniczący i wiceprzewodniczący.
    for (const [who, c, code] of [['ag', ag, 200], ['si', p.si, 200], ['biuro', p.office, 200], ['kn', p.members.get('kn')!, 403], ['ak', p.members.get('ak')!, 403], ['gosc', p.guest, 403], ['doradczy', p.advisor, 403], ['komunikacja', p.comms, 403]] as const) {
      const r = await c.raw('/api/avatars/eo');
      assert.equal(r.status, code, who);
      if (code === 403) assert.equal((await r.json()).error, 'To zdjęcie widzą biuro, administrator, przewodniczący i wiceprzewodniczący.');
    }
    assert.deepEqual((await ag.ok('/api/session')).avatars, {eo: {v: 1}});
    // Zmiana zdjęcia podnosi wersję; usunięcie własnego.
    assert.equal((await (await put(eo, jpeg(512, 512))).json()).account.avatar, 2);
    // Cudze zdjęcie usuwa tylko administrator, z powodem w historii.
    const id = p.idOf('eo.test');
    assert.deepEqual([(await p.office.raw(`/api/accounts/${id}/avatar`, {method: 'DELETE'})).status], [403]);
    const removed = await p.admin.call(`/api/accounts/${id}/avatar`, {reason: 'Zdjęcie nie przedstawia osoby.'}, 'DELETE');
    assert.equal(removed.status, 200);
    assert.equal((await ag.raw('/api/avatars/eo')).status, 404);
    const me = await eo.ok('/api/me');
    assert.equal(me.avatar, 0);
    assert.equal(me.avatarRemoved.reason, 'Zdjęcie nie przedstawia osoby.');
    const history = JSON.stringify(await p.admin.ok('/api/settings/history?area=konta'));
    assert.ok(history.includes('Usunięto zdjęcie profilowe konta') && history.includes('Zdjęcie nie przedstawia osoby.'));
    // Własne usunięcie.
    await put(ag, jpeg(300, 300));
    assert.equal((await ag.ok('/api/me/avatar', undefined, 'DELETE')).account.avatar, undefined, 'bez zdjęcia pole znika (Account.avatar opcjonalne)');
    assert.equal((await ag.ok('/api/me')).avatar, 0);
  } finally { await stop(); }
});

test('4.4, DA-2: konto „Komunikacja” zakłada tylko administrator, bez uprawnień administratora; inne trasy dają 403', async () => {
  const {origin, stop} = await startServer();
  try {
    const p = await people(origin);
    assert.equal((await p.office.call('/api/accounts', {username: 'komunikacja2', kind: 'komunikacja', displayName: 'Dział komunikacji', password: 'Tymczasowe-2026'})).status, 403);
    assert.equal((await p.admin.call('/api/accounts', {username: 'komunikacja2', kind: 'komunikacja', displayName: 'Dział komunikacji', password: 'Tymczasowe-2026', admin: true})).body.error, 'Konto komunikacji nie ma uprawnień administratora.');
    const m = (await p.admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00', place: 'Sala posiedzeń'})).meeting;
    for (const path of ['/api/meetings', `/api/meetings/${m.id}`, `/api/meetings/${m.id}/protokol`, '/api/people', '/api/zestawienie', '/api/statystyki/moje', '/api/organs/prezydium/czekajace', '/api/doc-types']) {
      const r = await p.comms.call(path);
      assert.deepEqual([r.status, r.body.error], [403, 'To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.'], path);
    }
    // Zgłoszenia czekające organu (B2-W06): gość bez wglądu, głos doradczy tylko własne, członek zgłasza.
    assert.equal((await p.guest.call('/api/organs/prezydium/czekajace')).status, 403);
    await p.members.get('eo')!.ok('/api/organs/prezydium/czekajace', {cmd: {type: 'proposal_add', title: 'Sprawa między posiedzeniami', justification: 'Uzasadnienie.'}});
    assert.deepEqual((await p.advisor.ok('/api/organs/prezydium/czekajace')).prep.proposals, []);
    assert.equal((await p.admin.ok('/api/organs/prezydium/czekajace')).prep.proposals.length, 1);
    const catalog = await p.comms.ok('/api/katalog');
    assert.deepEqual(catalog.rows, [], 'posiedzenie w przygotowaniu nie trafia do wierszy konta komunikacji');
    assert.equal((await p.comms.ok('/api/me')).emailState, 'brak');
  } finally { await stop(); }
});
