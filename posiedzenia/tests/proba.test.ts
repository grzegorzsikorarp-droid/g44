import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {plainPdf, jpeg} from './pliki-testowe.ts';
import {checkPdf} from '../src/shared/files.ts';
import {memberStats} from '../src/shared/stats.ts';

// Wersja próbna wersji 4 (etap D.3, SPEC-4 7): dane fikcyjne z 7.2 i trasy z tabeli 5.2 w `DemoServer` (te same funkcje
// z src/shared co serwer). Przeglądarkę zastępują tu `localStorage` w pamięci i `document` bez rysowania (slajdy puste).
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }},
  document: {createElement: () => ({getContext: () => null})},
});
const {DemoServer} = await import('../src/demo/server.ts');
const {demoData} = await import('../src/demo/seed.ts');
const {pdfDocument} = await import('../src/demo/files.ts');

type Res = {status: number; type: string; data: any; headers: Headers};
function client(s: InstanceType<typeof DemoServer>) {
  const call = async (path: string, o: {method?: string; body?: unknown; form?: FormData; raw?: Blob} = {}): Promise<Res> => {
    const init: RequestInit = {method: o.method ?? (o.body !== undefined || o.form || o.raw ? 'POST' : 'GET'), body: o.form ?? o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined), headers: o.raw ? {'Content-Type': o.raw.type} : {}};
    const res = await s.handle(new URL(path, 'https://proba.local'), init);
    const type = res.headers.get('content-type') ?? '';
    return {status: res.status, type, data: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()), headers: res.headers};
  };
  const login = async (username: string) => assert.equal((await call('/api/login', {body: {username}})).status, 200);
  return {call, login};
}
const fresh = () => { store.clear(); return new DemoServer(); };
const closedOf = (s: InstanceType<typeof DemoServer>) => Object.values(s.state.meetings).filter(m => m.status === 'zakonczone').sort((a, b) => a.date.localeCompare(b.date));

test('7.2: dane fikcyjne (posiedzenia zakończone poleceniami domeny, skład w czasie, statystyki, bez danych prawdziwych osób)', async () => {
  let n = 0;
  const d = demoData(Date.parse('2026-11-20T09:00:00Z'), () => 'id' + (++n), h => String(h.length));
  const closed = d.meetings.filter(m => m.status === 'zakonczone').sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(closed.map(m => m.date), ['2026-01-15', '2026-03-12', '2026-04-15', '2026-06-02', '2026-09-10']);
  const [legacy, first, second, working, proc] = closed;
  assert.ok(legacy.frozen?.legacy && !legacy.frozen.v4 && legacy.ballots.some(b => b.status === 'zamkniete' && !b.announcedAt));
  assert.ok(first.frozen?.v4 && first.minutesReady?.author.personId === 'p4' && first.photos?.url === 'https://example.org/album-przykladowy' && first.commsReleased && first.commsNote);
  assert.deepEqual(new Set(first.ballots.map(b => b.mode)), new Set(['jawne', 'imienne', 'tajne']));
  assert.ok(second.mode === 'zdalne' && second.ballots.some(b => b.purpose === 'protokol' && b.protocolOf === first.id && b.announcedAt));
  assert.ok(second.filed?.length === 1 && !second.minutesReady && !second.commsReleased && second.log.filter(l => l.tag === 'pokaz').length >= 2);
  assert.ok(working.working && working.frozen!.members.some(x => x.personId === 'p7'));
  assert.ok(proc.kind === 'procedura' && proc.ballots[0].eligible.length - Object.keys(proc.ballots[0].votes).length === 1);
  assert.ok(!d.roster.memberships.some(ms => ms.personId === 'p7') && d.roster.memberships.some(ms => ms.personId === 'p8' && ms.since === '2026-04-01'));
  assert.deepEqual(Object.values(d.prep)[0].proposals.map(p => p.state), ['wpisane', 'odrzucone', 'zgloszone']);
  const stats = (p: string) => memberStats({meetings: d.meetings, roster: d.roster, range: {from: '2026-01-01', to: '2026-12-31'}, self: p, only: [p]});
  assert.equal(stats('p5').persons[0].rows[1].attendance?.lateMin, 25);
  assert.equal(stats('p6').persons[0].rows[1].attendance?.earlyMin, 40);
  assert.ok(stats('p3').persons[0].rows[2].attendance?.reasons.includes('przerwa'));
  assert.deepEqual(stats('p1').notes.map(x => x.kind), ['nieogloszone']);
  const text = JSON.stringify(d);
  for (const forbidden of ['Słupsk', 'Izba', 'Izby', 'Poniatowskiego']) assert.ok(!text.includes(forbidden), forbidden);
  assert.ok((text.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? []).every(a => a.endsWith('@example.org')));
});

test('7.3: pliki PDF wersji próbnej przechodzą kontrolę files.ts (polskie litery w kodowaniu Helvetica)', async () => {
  const r = await checkPdf(pdfDocument([[[30, 'Przykładowy dokument, strona 1 ąćęłńóśźż']]]), {inflate: async b => new Uint8Array(inflateSync(b))});
  assert.deepEqual(r, {ok: true, pages: 1});
});

test('7.3, 5.2: trasy wersji 4 w wersji próbnej (dokumenty, teczka, katalog, skrzynka, pokaz, konto komunikacji, migracja)', async () => {
  const s = fresh();
  const {call, login} = client(s);
  const [, first, second] = closedOf(s);
  const today = Object.values(s.state.meetings).find(m => m.title === 'Posiedzenie Prezydium (próbne)')!;
  await login('biuro');
  let r = await call('/api/session');
  assert.ok(r.data.can.report && r.data.mail.enabled && r.data.avatars);
  r = await call(`/api/meetings/${first.id}/dokumenty/protokol?format=docx`);
  assert.equal(r.status, 200); assert.deepEqual([...r.data.slice(0, 2)], [0x50, 0x4b]);
  r = await call(`/api/meetings/${second.id}/teczka.zip`);
  assert.equal(r.status, 200); assert.match(new TextDecoder('latin1').decode(r.data), /11-pokazane\//);
  r = await call(`/api/meetings/${today.id}/mail/send`, {body: {kind: 'postep'}});
  assert.equal(r.status, 201);
  r = await call('/api/proba/skrzynka');
  assert.ok(r.data.messages.length >= 4 && r.data.messages.every((m: {status: string; text: string}) => m.status === 'proba' && m.text.includes('https://example.org/posiedzenia')));
  r = await call('/api/mail/test', {body: {to: 'biuro@example.org'}});
  assert.deepEqual(r.data.steps.map((x: {text: string}) => x.text), ['Pominięto', 'Pominięto', 'Pominięto', 'Pominięto']);
  const pdf = new FormData(); pdf.append('file', new File([plainPdf(4) as BlobPart], 'plan.pdf', {type: 'application/pdf'}));
  r = await call(`/api/meetings/${today.id}/pokaz`, {form: pdf});
  assert.equal(r.status, 201);
  const video = new FormData(); video.append('file', new File([new Uint8Array(8)], 'film.mp4'));
  assert.equal((await call(`/api/meetings/${today.id}/pokaz`, {form: video})).data.error, 'Wideo pokazuje pełna aplikacja.');
  r = await call(`/api/meetings/${second.id}/zlozone`, {form: pdf});
  assert.equal(r.data.error, 'W wersji próbnej pliki po posiedzeniu są tylko przykładowe.');
  r = await call('/api/me/avatar', {method: 'PUT', raw: new Blob([jpeg(300, 300) as BlobPart], {type: 'image/jpeg'})});
  assert.equal(r.data.account.avatar, 1);
  assert.ok(!store.get('posiedzenia-proba-v1')!.includes('avatar":1'), 'zdjęcie tylko w pamięci karty');
  await login('ewa.dabrowska');
  const waiting = s.state.prep[today.id].proposals.find(p => p.state === 'zgloszone')!;
  r = await call(`/api/meetings/${today.id}/przygotowanie`, {body: {cmd: {type: 'proposal_reject', proposalId: waiting.id, reason: 'Próba.'}}});
  assert.equal(r.status, 403);
  await login('komunikacja');
  assert.equal((await call('/api/meetings')).status, 403);
  assert.equal((await call(`/api/katalog/${first.id}/komunikacja.md`)).status, 200);
  assert.equal((await call(`/api/katalog/${second.id}/komunikacja.md`)).status, 409);
  await login('barbara.wisniewska');
  r = await call(`/api/meetings/${today.id}/command`, {body: {type: 'open'}});
  assert.equal(r.data.meeting.status, 'trwa');
  assert.ok(s.state.messages.filter(x => x.status === 'anulowana').length >= 4, 'informacje o postępie anulowane przy otwarciu');
  assert.equal((await call(`/api/meetings/${today.id}/przygotowanie`)).status, 409);
  // Stan sprzed wersji 4 przechodzi migrateV4 raz; drugi odczyt niczego nie zmienia (7.3).
  const old = JSON.parse(store.get('posiedzenia-proba-v1')!);
  for (const k of ['v4', 'prep', 'visits', 'contacts', 'batches', 'messages', 'files', 'archiveRevision']) delete old[k];
  for (const m of Object.values(old.meetings) as {closedComms?: unknown; frozen?: {term?: unknown}}[]) { delete m.closedComms; if (m.frozen) delete m.frozen.term; }
  store.set('posiedzenia-proba-v1', JSON.stringify(old));
  const migrated = new DemoServer();
  assert.ok(migrated.state.v4 && migrated.state.audit.filter(e => e.key === 'wersja-4').length === 4);
  assert.ok(Object.values(migrated.state.meetings).filter(m => m.status === 'zakonczone').every(m => m.closedComms));
  const again = new DemoServer();
  assert.equal(again.state.audit.filter(e => e.key === 'wersja-4').length, 4);
  assert.deepEqual(again.state.meetings, migrated.state.meetings);
});
