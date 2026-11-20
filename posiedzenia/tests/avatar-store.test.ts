import test from 'node:test';
import assert from 'node:assert/strict';
import {AvatarStore, avatarPath, type AvatarDeps} from '../src/client/avatar-store.ts';

// T-4 (SPEC-4 0.3, B3-39): zdjęcia z pamięci przeglądarki, jedno pobranie po sesji, wyłącznie adresy `blob:`,
// bez zapytań przy kolejnych odczytach i po zmianie widoku (np. po oddaniu głosu).
function deps(o: {fail?: string[]; scheme?: string} = {}) {
  const calls: string[] = [];
  let n = 0;
  const revoked: string[] = [];
  const d: AvatarDeps = {
    fetch: async url => { calls.push(url); return o.fail?.some(k => url.includes(k)) ? new Response('', {status: 404}) : new Response(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {type: 'image/jpeg'})); },
    createObjectURL: () => `${o.scheme ?? 'blob:'}proba/${++n}`,
    revokeObjectURL: url => { revoked.push(url); },
  };
  return {d, calls, revoked};
}

test('T-4: jedno pobranie po sesji, odczyty i ponowne wczytanie tej samej mapy bez zapytań', async () => {
  const {d, calls} = deps();
  const store = new AvatarStore(d);
  const map = {p1: {v: 2}, p2: {v: 1}};
  await store.load(map, 'a-biuro');
  assert.deepEqual(calls.sort(), [avatarPath('p1', 2), avatarPath('p2', 1)].sort());
  assert.match(store.url('p1')!, /^blob:/);
  for (let i = 0; i < 50; i++) { store.url('p1'); store.url('p2'); store.url('p3'); }
  await store.load({...map}, 'a-biuro');
  await store.load(map, 'a-biuro');
  assert.equal(calls.length, 2, 'kolejne odczyty i ta sama mapa nie wysyłają zapytań');
  assert.equal(store.url('p3'), null);
  assert.equal(store.url(null), null);
});

test('T-4: tylko adresy blob:, nowa wersja pobiera tylko zmienione zdjęcie, osoba spoza kręgu bez zdjęć', async () => {
  const bad = deps({scheme: 'https://obcy.example.org/'});
  const strict = new AvatarStore(bad.d);
  await strict.load({p1: {v: 1}}, 's');
  assert.equal(strict.url('p1'), null, 'adres inny niż blob: nie wychodzi z pamięci');
  const {d, calls, revoked} = deps({fail: ['p9']});
  const store = new AvatarStore(d);
  await store.load({p1: {v: 1}, p2: {v: 1}, p9: {v: 1}}, 's');
  assert.equal(store.url('p9'), null, 'zdjęcie, którego nie udało się pobrać, daje inicjały');
  calls.length = 0;
  await store.load({p1: {v: 2}, p2: {v: 1}}, 's');
  assert.deepEqual(calls, [avatarPath('p1', 2)]);
  assert.ok(revoked.length >= 1);
  store.setOwn('p2', 2, new Blob([new Uint8Array([1])], {type: 'image/jpeg'}));
  assert.match(store.url('p2')!, /^blob:/);
  calls.length = 0;
  await store.load(null, 's');
  assert.equal(store.url('p1'), null);
  assert.equal(calls.length, 0, 'mapa null (pytanie 13 a: osoba spoza kręgu) niczego nie pobiera');
  let events = 0;
  const off = store.subscribe(() => { events++; });
  store.clear();
  off();
  assert.equal(events, 1);
});
