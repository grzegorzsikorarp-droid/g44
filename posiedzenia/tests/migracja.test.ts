import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/server/store.ts';
import {minutesBody} from '../src/server/minutes.ts';
import {apply, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {cascadeEnv, effectiveMeeting, sourceText} from '../src/shared/cascade.ts';
import {migrateMeeting, migrateMeetingV3} from '../src/shared/migrate.ts';
import {applyCompositionChange} from '../src/shared/settings.ts';
import {LAW} from '../src/shared/law.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor} from './helpers.ts';

// Jednorazowa migracja do wersji 3 na kopii danych wzorcowych (specyfikacja, rozdz. 2.10; K-1, I-8; kontrola f).
// Dane: tests/fixtures/dane-wzor (kopia /home/user/przeglad/dane-wzor), jedno trwające posiedzenie sprzed wersji 3.

const LIVE = '131cd279-a48f-41b5-b039-2d1a44a99ae9';
const NOW = Date.parse('2026-11-20T12:00:00Z');
const office = actor(null, 'biuro', true);
const chair = actor('si');

function copy() {
  const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-v3-'));
  copyFileSync(new URL('./fixtures/dane-wzor/posiedzenia.sqlite', import.meta.url), join(dir, 'posiedzenia.sqlite'));
  return {dir, done: () => rmSync(dir, {recursive: true, force: true})};
}
/** Surowe dane posiedzeń sprzed migracji (bez zapisu), z migracją przy odczycie z wersji 2. */
function rawMeetings(dir: string) {
  const db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'), {readOnly: true});
  const rows = db.prepare('SELECT id, data FROM meetings').all() as {id: string; data: string}[];
  db.close();
  return new Map(rows.map(r => [r.id, migrateMeeting(JSON.parse(r.data) as Meeting)]));
}
const minutes = (store: Store, m: Meeting, hide: boolean) =>
  minutesBody(m, store.roster(), store.users().map(u => ({id: u.id, username: u.username, kind: u.kind, personId: u.person_id, displayName: u.display_name, label: u.label, admin: !!u.admin, mustChange: false, disabled: false})),
    NOW, {office: 'biuro Izby'}, {docTypes: store.docTypes(), hideUnannounced: hide});
const storedJson = (dir: string) => {
  const db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'), {readOnly: true});
  const rows = db.prepare('SELECT id, data, revision FROM meetings ORDER BY id').all();
  db.close();
  return JSON.stringify(rows);
};
const contextOf = (store: Store): Context => ({roster: store.roster(), now: NOW, newId: (() => { let i = 0; return () => `t${++i}`; })(), general: store.general(), docTypes: store.docTypes(), law: LAW, accounts: []});

test('migracja danych wzorcowych: zamrożenie „legacy”, kworum 4 z 7, czasy 2 i 2 minuty, projekt protokołu bez zmian', () => {
  const {dir, done} = copy();
  try {
    const before = rawMeetings(dir).get(LIVE)!;
    assert.equal(before.frozen, undefined);
    let store = new Store(dir);
    // Wersja 2 pozwalała wyłączyć głosowanie przy formie aktu z regulaminu; migracja to przywraca (G-1).
    store.db.prepare("UPDATE doc_types SET voted=0 WHERE id='apel'").run();
    const textBefore = [minutes(store, before, false), minutes(store, before, true)];
    assert.equal(store.migrateV3(NOW), true);
    const m = store.meeting(LIVE)!;
    assert.ok(m.frozen?.legacy, 'trwające posiedzenie ma `frozen` z `legacy`');
    assert.equal(m.frozen.at, NOW);
    assert.equal(m.frozen.members.length, 7);
    const env = cascadeEnv({roster: store.roster(), bundle: store.general(), organ: 'prezydium'});
    const e = effectiveMeeting(env, m);
    assert.deepEqual(e.meeting.quorum.value, {required: 4, total: 7, seats: null});
    assert.deepEqual([e.meeting.voteMinutes.value, e.meeting.motionMinutes.value], [2, 2]);
    assert.equal(sourceText(e.meeting.voteMinutes, {at: 'posiedzenie', show: String, houseBy: ''}), 'Zapisane przy przejściu na wersję 3.');
    assert.deepEqual(e.deviations, [], 'posiedzenie sprzed wersji 3 nie dostaje nowych zdań do protokołu');
    // Projekt protokołu identyczny przed migracją i po niej (osoba z wglądem w wynik i bez niego).
    assert.deepEqual([minutes(store, m, false), minutes(store, m, true)], textBefore);
    // Ustawienia ogólne, nazwy organów, podstawa składu, rodzaje dokumentów, historia.
    const bundle = store.general();
    assert.equal(bundle.general.site.place, 'Siedziba Izby, ul. Poniatowskiego 4, Słupsk');
    assert.deepEqual([bundle.general.organs.prezydium!.voteMinutes, bundle.general.organs.prezydium!.motionMinutes, bundle.general.organs.prezydium!.procedureHours], [2, 2, 24]);
    assert.equal(store.roster().organs.find(o => o.code === 'rada')!.forms.genitive, 'Okręgowej Rady Pielęgniarek i Położnych w Słupsku');
    const si = store.roster().memberships.find(x => x.organ === 'prezydium' && x.personId === 'si')!;
    assert.deepEqual([si.since, si.basis], ['2024-04-18', {kind: 'uchwala', act: {organ: 'rada', number: '40/IX/2024', date: '2024-04-18'}}]);
    assert.deepEqual(store.docTypes().filter(t => t.inActs).map(t => t.id), ['uchwala']);
    assert.equal(store.docTypes().find(t => t.id === 'apel')!.voted, true);
    const history = store.history().entries.map(e => e.after);
    assert.ok(history.includes('Konta biura mają dostęp do ustawień ogólnych (wersja 3).'));
    assert.ok(history.includes('Przywrócono wymóg głosowania (§ 8 ust. 9 pkt 4).'));
    const count = store.history().entries.length;
    store.close();
    // Drugi start i ponowny odczyt niczego nie zmieniają.
    const snapshot = storedJson(dir);
    store = new Store(dir);
    assert.equal(store.migrateV3(NOW + 60000), false);
    assert.equal(store.history().entries.length, count, 'wpisy migracji tylko raz');
    assert.deepEqual(store.meeting(LIVE), m);
    store.close();
    assert.equal(storedJson(dir), snapshot);
  } finally { done(); }
});

test('K-1: zastępca wyznaczony przez przewodniczącego zostaje po dwóch migracjach i ponownym wczytaniu; zastępca wpisany przez biuro znika', () => {
  const {dir, done} = copy();
  try {
    let store = new Store(dir);
    store.migrateV3(NOW);
    const ctx = contextOf(store);
    // Posiedzenie w przygotowaniu z zastępstwem z wersji 3 (deputySet).
    let v3 = newMeetingFromSettings({id: 'v3', kind: 'posiedzenie', date: '2026-12-03', time: '10:00', actor: office}, ctx);
    v3 = apply(v3, {type: 'deputy', personId: 'ag'}, chair, ctx);
    store.saveMeeting(v3, NOW);
    // Posiedzenia w przygotowaniu z wersji 2: zastępca wpisany przez przewodniczącego i wpisany przez biuro.
    const byChairman: Meeting = {...structuredClone(v3), id: 'v2-przew', chair: {current: null, deputy: 'jw', deputyBasis: 'wyznaczenie przez przewodniczącego (§ 16)', changes: []}};
    const byOffice: Meeting = {...structuredClone(v3), id: 'v2-biuro', chair: {current: null, deputy: 'jw', deputyBasis: 'ustne polecenie przewodniczącego', changes: []}};
    for (const x of [byChairman, byOffice]) store.saveMeeting(x, NOW);
    // Druga migracja tych danych (wymuszona) i migracja posiedzenia jeszcze raz wprost.
    store.db.prepare("DELETE FROM meta WHERE key='ustawienia-v3'").run();
    store.migrateV3(NOW + 1000);
    const env = cascadeEnv({roster: store.roster(), bundle: store.general(), organ: 'prezydium'});
    const again = structuredClone(store.meeting('v3')!);
    assert.equal(migrateMeetingV3(again, {now: NOW + 2000, env, advisory: [], newId: () => 'x'}), false);
    store.close();
    store = new Store(dir);
    const kept = store.meeting('v3')!;
    assert.deepEqual([kept.chair.deputy, kept.chair.deputySet?.by], ['ag', 'Sebastian Irzykowski']);
    assert.ok(!kept.log.some(e => e.text.startsWith('Usunięto zastępstwo')), 'w dzienniku nie ma wpisu o usunięciu');
    assert.equal(store.meeting('v2-przew')!.chair.deputy, 'jw');
    const removed = store.meeting('v2-biuro')!;
    assert.deepEqual([removed.chair.deputy, removed.chair.deputyBasis], [null, '']);
    assert.equal(removed.log.filter(e => e.text === 'Usunięto zastępstwo wpisane przez biuro. Zastępcę wyznacza przewodniczący (§ 16 ust. 2).').length, 1);
    store.close();
  } finally { done(); }
});

test('I-8: zmiana składu po migracji nie zmienia zapisanego składu posiedzeń zamkniętych ani trwających', () => {
  const {dir, done} = copy();
  try {
    // Posiedzenie zakończone sprzed wersji 3 dopisane do danych wzorcowych przed migracją.
    const db = new DatabaseSync(join(dir, 'posiedzenia.sqlite'));
    const live = JSON.parse((db.prepare('SELECT data FROM meetings WHERE id=?').get(LIVE) as {data: string}).data) as Meeting;
    const closedMeeting = {...live, id: 'zamkniete', status: 'zakonczone', closedAt: live.openedAt! + 3600000};
    db.prepare('INSERT INTO meetings(id,organ,kind,status,date,data,revision,updated) VALUES (?,?,?,?,?,?,?,?)').run('zamkniete', 'prezydium', 'posiedzenie', 'zakonczone', live.date, JSON.stringify(closedMeeting), 1, 0);
    db.close();
    const store = new Store(dir);
    store.migrateV3(NOW);
    const frozenBefore = structuredClone(store.meeting('zamkniete')!.frozen);
    assert.ok(frozenBefore?.legacy);
    const result = applyCompositionChange(store.roster(), store.general().general.organs.prezydium!, {organ: 'prezydium', op: 'koniec', personId: 'ak', since: '2026-11-20', basis: {kind: 'rezygnacja', date: '2026-11-19', to: 'Przewodniczącemu Okręgowej Rady Pielęgniarek i Położnych w Słupsku'}},
      {actor: office, now: NOW, today: '2026-11-20', newId: () => 'x'});
    store.saveComposition(result.roster, 'prezydium', result.settings);
    assert.equal(store.roster().memberships.filter(x => x.organ === 'prezydium').length, 6);
    for (const id of ['zamkniete', LIVE]) {
      const m = store.meeting(id)!;
      assert.deepEqual(m.frozen?.members, frozenBefore!.members);
      assert.deepEqual(effectiveMeeting(cascadeEnv({roster: store.roster(), bundle: store.general(), organ: 'prezydium'}), m).meeting.quorum.value, {required: 4, total: 7, seats: null});
    }
    store.close();
  } finally { done(); }
});
