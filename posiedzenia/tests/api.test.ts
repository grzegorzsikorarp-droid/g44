import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {createApplication} from '../src/server/app.ts';
import {bigIntToBytes, blindMessage, byteLength, bytesToBigInt, bytesToHex, fdh, gcd, unblindSignature, verifySignature} from '../src/shared/blind.ts';
import {presidium} from './helpers.ts';

const sha256 = async (d: Uint8Array) => new Uint8Array(createHash('sha256').update(d).digest());

async function start() {
  const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-'));
  const app = await createApplication({dataDir: dir, setupToken: 'kod-testowy', clientDir: dir, tickMs: 50});
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const port = (app.server.address() as {port: number}).port;
  const origin = `http://127.0.0.1:${port}`;
  const stop = () => new Promise<void>(r => app.server.close(() => { rmSync(dir, {recursive: true, force: true}); r(); }));
  return {origin, stop, app};
}

function client(origin: string) {
  let cookie = '';
  async function call(path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST', withCookie = true) {
    const headers: Record<string, string> = {Origin: origin, 'X-Posiedzenia': '1'};
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    if (withCookie && cookie) headers.Cookie = cookie;
    const res = await fetch(origin + path, {method, headers, body: data === undefined ? undefined : JSON.stringify(data)});
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    const body = text.startsWith('{') ? JSON.parse(text) : text;
    return {status: res.status, body};
  }
  return {
    call,
    async ok(path: string, data?: unknown, method?: string) {
      const r = await call(path, data, method);
      if (r.status >= 300) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
      return r.body;
    },
  };
}

test('pełny przebieg posiedzenia Prezydium przez API: konta, porządek, głosowania jawne i tajne, protokół', async () => {
  const {origin, stop} = await start();
  try {
    const admin = client(origin);
    assert.equal((await admin.call('/api/setup', {token: 'zły', username: 'biuro', password: 'BardzoTajne-2026'})).status, 403);
    await admin.ok('/api/setup', {token: 'kod-testowy', username: 'biuro', password: 'BardzoTajne-2026', displayName: 'Biuro Izby'});
    assert.equal((await client(origin).call('/api/meetings')).status, 401);

    const members = new Map<string, ReturnType<typeof client>>();
    for (const p of presidium) {
      await admin.ok('/api/accounts', {username: p + '.prezydium', kind: 'czlonek', personId: p, password: 'Tymczasowe-2026'});
      const c = client(origin);
      await c.ok('/api/login', {username: p + '.prezydium', password: 'Tymczasowe-2026'});
      assert.equal((await c.call('/api/meetings')).status, 403, 'hasło tymczasowe trzeba zmienić');
      await c.ok('/api/password', {currentPassword: 'Tymczasowe-2026', password: `Wlasne-haslo-${p}-2026`});
      members.set(p, c);
    }
    const si = members.get('si')!;
    const created = await admin.ok('/api/meetings', {kind: 'posiedzenie', date: '2026-11-20', time: '10:00', place: 'Słupsk'});
    const id = created.meeting.id;
    const cmd = (c: ReturnType<typeof client>, body: object) => c.ok(`/api/meetings/${id}/command`, body);
    await cmd(admin, {type: 'details', noticeDate: '2026-11-10'});

    // materiał z tekstu przypisany do punktu „Podjęcie uchwał”
    let state = (await admin.ok(`/api/meetings/${id}`)).meeting;
    const resolutions = state.agenda.find((i: {kind: string}) => i.kind === 'uchwaly');
    state = (await admin.ok(`/api/meetings/${id}/materials`, {title: 'Uchwała nr 108/IX/2026 w sprawie patronatu', text: '§ 1\nUdziela się patronatu.\n\n§ 2\nUchwała wchodzi w życie z dniem podjęcia.', itemId: resolutionItemId(state)})).meeting;
    const material = state.materials[0];
    assert.equal(material.type, 'uchwala');
    const read = (await members.get('eo')!.ok(`/api/meetings/${id}/materials/${material.id}`)).material;
    assert.match(read.html, /<h3>§ 1<\/h3>\n<p>Udziela się patronatu.<\/p>/);

    await cmd(si, {type: 'open'});
    for (const p of presidium.slice(1)) await cmd(members.get(p)!, {type: 'presence', who: p, present: true});
    state = (await cmd(si, {type: 'quorum'})).meeting;
    assert.match(state.log.at(-1).text, /Stwierdzono kworum: obecnych 7 z 7/);

    const agendaPoint = state.agenda.find((i: {kind: string}) => i.kind === 'porzadek');
    await cmd(si, {type: 'item_start', itemId: agendaPoint.id});
    state = (await cmd(si, {type: 'ballot_open', itemId: agendaPoint.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2})).meeting;
    let ballot = state.ballots.at(-1);
    await Promise.all(presidium.map(p => cmd(members.get(p)!, {type: 'vote', ballotId: ballot.id, choice: 'za'})));
    state = (await si.ok(`/api/meetings/${id}`)).meeting;
    assert.equal(state.agendaAdopted, true);
    assert.equal(state.ballots.at(-1).result.za, 7);
    assert.deepEqual(state.ballots.at(-1).votes, {}, 'w głosowaniu jawnym widoczne są tylko liczby');

    // postanowienie o tajności, potem głosowanie tajne ze ślepymi podpisami
    await cmd(si, {type: 'item_start', itemId: resolutions.id});
    state = (await cmd(si, {type: 'mode_motion', itemId: resolutions.id, mode: 'tajne', minutes: 2})).meeting;
    ballot = state.ballots.at(-1);
    await Promise.all(presidium.map(p => cmd(members.get(p)!, {type: 'vote', ballotId: ballot.id, choice: 'za'})));
    state = (await cmd(si, {type: 'ballot_open', itemId: resolutions.id, purpose: 'uchwala', subject: material.title, mode: 'tajne', minutes: 3, materialId: material.id})).meeting;
    ballot = state.ballots.at(-1);
    assert.equal(ballot.material.hash, material.hash);
    const n = BigInt('0x' + ballot.secret.n), e = BigInt('0x' + ballot.secret.e), k = byteLength(n);
    const choices = ['za', 'za', 'za', 'za', 'przeciw', 'wstrzymuje', 'za'];
    await Promise.all(presidium.map(async (p, i) => {
      const token = new Uint8Array(randomBytes(32));
      const m = await fdh(token, n, sha256);
      let r = 0n;
      while (r < 2n || gcd(r, n) !== 1n) r = bytesToBigInt(new Uint8Array(randomBytes(k))) % n;
      const {signature} = await members.get(p)!.ok(`/api/meetings/${id}/secret/issue`, {ballotId: ballot.id, blinded: bytesToHex(bigIntToBytes(blindMessage(m, r, n, e), k))});
      const s = unblindSignature(BigInt('0x' + signature), r, n);
      assert.ok(verifySignature(s, m, n, e));
      const anonymous = client(origin);
      const cast = {ballotId: ballot.id, token: bytesToHex(token), signature: s.toString(16), choice: choices[i]};
      await anonymous.ok(`/api/meetings/${id}/secret/cast`, cast);
      assert.equal((await anonymous.ok(`/api/meetings/${id}/secret/cast`, cast)).duplicate, true, 'ponowne wysłanie tej samej karty nie liczy się drugi raz');
    }));
    assert.equal((await members.get('ag')!.call(`/api/meetings/${id}/secret/issue`, {ballotId: ballot.id, blinded: 'ab'})).status, 409);
    const forged = await client(origin).call(`/api/meetings/${id}/secret/cast`, {ballotId: ballot.id, token: bytesToHex(new Uint8Array(randomBytes(32))), signature: '1234', choice: 'za'});
    assert.notEqual(forged.status, 200);
    state = (await si.ok(`/api/meetings/${id}`)).meeting;
    const secret = state.ballots.at(-1);
    assert.equal(secret.status, 'zamkniete');
    assert.deepEqual([secret.result.za, secret.result.przeciw, secret.result.wstrzymuje], [5, 1, 1]);
    assert.equal(secret.closeReason, 'wszyscy');
    await cmd(si, {type: 'announce', ballotId: secret.id});

    const minutes = await si.call(`/api/meetings/${id}/protokol`);
    assert.equal(minutes.status, 200);
    assert.match(minutes.body, /Głosowanie tajne w systemie elektronicznym: pobrano kart 7, oddano głosów 7/);
    assert.match(minutes.body, /Sebastian Irzykowski/);
    assert.doesNotMatch(minutes.body, /<script>(?!.*druk)/);
  } finally { await stop(); }
});

function resolutionItemId(state: {agenda: {id: string; kind: string}[]}) {
  return state.agenda.find(i => i.kind === 'uchwaly')!.id;
}

test('ochrona: bez nagłówka aplikacji i z obcego adresu żądania zmieniające dane są odrzucane', async () => {
  const {origin, stop} = await start();
  try {
    const res = await fetch(origin + '/api/setup', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://obca.example'}, body: '{}'});
    assert.equal(res.status, 403);
    const res2 = await fetch(origin + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin}, body: '{}'});
    assert.equal(res2.status, 403);
  } finally { await stop(); }
});

test('procedura między posiedzeniami zamyka się sama, gdy zagłosują wszyscy', async () => {
  const {origin, stop} = await start();
  try {
    const admin = client(origin);
    await admin.ok('/api/setup', {token: 'kod-testowy', username: 'biuro', password: 'BardzoTajne-2026'});
    const members = new Map<string, ReturnType<typeof client>>();
    for (const p of presidium) {
      await admin.ok('/api/accounts', {username: p + '.prezydium', kind: 'czlonek', personId: p, password: 'Tymczasowe-2026'});
      const c = client(origin);
      await c.ok('/api/login', {username: p + '.prezydium', password: 'Tymczasowe-2026'});
      await c.ok('/api/password', {currentPassword: 'Tymczasowe-2026', password: `Wlasne-haslo-${p}-2026`});
      members.set(p, c);
    }
    const {meeting} = await admin.ok('/api/meetings', {kind: 'procedura', endsAt: Date.now() + 3 * 3600000});
    const cmd = (c: ReturnType<typeof client>, body: object) => c.ok(`/api/meetings/${meeting.id}/command`, body);
    await cmd(admin, {type: 'item_add', title: 'Uchwała nr 130/IX/2026 w sprawie delegowania przedstawicieli'});
    let state = (await cmd(members.get('si')!, {type: 'open'})).meeting;
    const ballot = state.ballots[0];
    assert.equal(ballot.remote, true);
    await cmd(members.get('kn')!, {type: 'message', text: 'Czy delegacja obejmuje dwie osoby?'});
    await Promise.all(presidium.map(p => cmd(members.get(p)!, {type: 'vote', ballotId: ballot.id, choice: 'za'})));
    state = (await members.get('ak')!.ok(`/api/meetings/${meeting.id}`)).meeting;
    assert.equal(state.status, 'zakonczone');
    assert.equal(state.ballots[0].result.adopted, true);
    assert.equal(state.messages.length, 1);
  } finally { await stop(); }
});
