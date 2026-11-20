import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, envOf, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {effectiveMeeting} from '../src/shared/cascade.ts';
import {applyCompositionChange, compositionBasisText, defaultGeneral, type CompositionChange} from '../src/shared/settings.ts';
import {defaultDocTypes, docTypeInput} from '../src/shared/doctypes.ts';
import {memberIdsOf, presentMembers} from '../src/shared/rules.ts';
import {seedRoster, seedSite} from '../src/server/seed.ts';
import type {Meeting, Roster} from '../src/shared/types.ts';
import {actor, context, presidium} from './helpers.ts';

// Skład organu z podstawą (DA-13, G-5, K-3) i zamrożony skład przy otwarciu; blokada form aktów (G-1).

type Ctx = ReturnType<typeof context> & Context;
const chair = actor('si');
const office = actor(null, 'biuro', true);
const today = '2026-11-20';
function setup(roster: Roster = seedRoster): Ctx {
  const ctx = context() as Ctx;
  ctx.roster = roster;
  ctx.general = {general: defaultGeneral(seedSite), docTypes: defaultDocTypes, revision: 1};
  return ctx;
}
const change = (roster: Roster, c: Partial<CompositionChange>) =>
  applyCompositionChange(roster, defaultGeneral(seedSite).organs.prezydium!, {organ: 'prezydium', op: 'koniec', since: today, basis: {kind: 'rezygnacja', date: '2026-11-12', to: 'Przewodniczącemu Okręgowej Rady Pielęgniarek i Położnych w Słupsku'}, ...c} as CompositionChange,
    {actor: office, now: Date.parse('2026-11-20T10:00:00Z'), today, newId: () => 'nowy'});
function opened(ctx: Ctx, m: Meeting) {
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  return apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
}

test('K-3: rezygnacja bez uchwały usuwa osobę z uprawnionych w nowym posiedzeniu i obniża mianownik kworum; trwające posiedzenie bez zmian', () => {
  const ctx = setup();
  const live = opened(ctx, newMeetingFromSettings({id: 'live', kind: 'posiedzenie', date: today, time: '10:00', actor: office}, ctx));
  const {roster, audit} = change(seedRoster, {personId: 'ak'});
  assert.ok(!roster.memberships.some(ms => ms.organ === 'prezydium' && ms.personId === 'ak'));
  assert.ok(roster.persons.some(p => p.id === 'ak'), 'osoba zostaje w danych, ślad jest w historii i w składzie zapisanym przy otwarciu');
  assert.deepEqual(audit.map(e => [e.area, e.label, e.before, e.after, e.basis]), [['sklad', 'Skład Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku', 'Anna Kryczka, Członek Prezydium', 'koniec członkostwa',
    'Rezygnacja złożona 12.11.2026 Przewodniczącemu Okręgowej Rady Pielęgniarek i Położnych w Słupsku']]);
  const after = setup(roster);
  const fresh = newMeetingFromSettings({id: 'nowe', kind: 'posiedzenie', date: '2026-12-03', time: '10:00', actor: office}, after);
  assert.deepEqual(effectiveMeeting(envOf(after, 'prezydium'), fresh).meeting.quorum.value, {required: 3, total: 6, seats: null});
  assert.ok(!memberIdsOf(fresh, roster).includes('ak'));
  // Trwające posiedzenie liczy dalej według składu zapisanego przy otwarciu.
  assert.deepEqual(effectiveMeeting(envOf(after, 'prezydium'), live).meeting.quorum.value, {required: 4, total: 7, seats: null});
  assert.ok(presentMembers(live, roster).includes('ak'));
  let m = apply(live, {type: 'quorum'}, chair, after.tick());
  assert.equal(m.log.at(-1)!.text, 'Stwierdzono kworum. Obecnych 7 z 7, wymagane 4.');
  m = apply(m, {type: 'item_start', itemId: m.agenda.find(i => i.kind === 'porzadek')!.id}, chair, after.tick());
  m = apply(m, {type: 'ballot_open', itemId: m.agenda.find(i => i.kind === 'porzadek')!.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, after.tick());
  assert.equal(m.ballots.at(-1)!.eligible.length, 7);
  assert.equal(m.ballots.at(-1)!.membersTotal, 7);
});

test('G-5: podstawa z kompletem pól i data nie później niż dziś; zmiana funkcji wylicza „prowadzi obrady”', () => {
  assert.throws(() => change(seedRoster, {personId: 'ak', since: '2026-11-21'}), /Zmianę składu wpisz w dniu, od którego obowiązuje, albo później\./);
  assert.throws(() => change(seedRoster, {personId: 'ak', basis: {kind: 'uchwala', act: {organ: 'rada', number: '', date: '2026-11-15'}}}), /Wpisz numer i datę uchwały\./);
  assert.throws(() => change(seedRoster, {personId: 'ak', basis: {kind: 'rezygnacja', date: '2026-11-12', to: ''}}), /Wpisz datę rezygnacji i to, komu ją złożono\./);
  assert.throws(() => change(seedRoster, {personId: 'ak', basis: {kind: 'wygasniecie', date: '', event: 'Śmierć członka'}}), /Wpisz, co się stało i kiedy\./);
  assert.throws(() => change(seedRoster, {op: 'liczba', count: 8, basis: {kind: 'rezygnacja', date: '2026-11-12', to: 'x'}}), /Wpisz numer i datę uchwały\./);
  const act = {kind: 'uchwala' as const, act: {organ: 'rada' as const, number: '41/IX/2026', date: '2026-11-15'}};
  const promoted = change(seedRoster, {op: 'funkcja', personId: 'eo', func: 'wiceprzewodniczacy', label: 'III Wiceprzewodnicząca', basis: act});
  const ms = promoted.roster.memberships.find(x => x.organ === 'prezydium' && x.personId === 'eo')!;
  assert.deepEqual([ms.func, ms.label, ms.canChair, ms.since], ['wiceprzewodniczacy', 'III Wiceprzewodnicząca', true, today]);
  assert.equal(promoted.audit[0].basis, 'Uchwała Okręgowej Rady Pielęgniarek i Położnych w Słupsku nr 41/IX/2026 z 15.11.2026');
  assert.throws(() => change(seedRoster, {op: 'funkcja', personId: 'eo', func: 'przewodniczacy', basis: act}), /W składzie jest już przewodniczący\./);
  const added = change(seedRoster, {op: 'dodaj', name: 'Maria Nowa', func: 'czlonek', basis: act});
  assert.ok(added.roster.memberships.some(x => x.organ === 'prezydium' && x.label === 'Członek Prezydium' && added.roster.persons.find(p => p.id === x.personId)!.name === 'Maria Nowa'));
  const seats = change(seedRoster, {op: 'liczba', count: 8, basis: act});
  assert.deepEqual(seats.settings.seats, {count: 8, act: act.act});
  assert.equal(compositionBasisText({kind: 'wygasniecie', date: '2026-11-10', event: 'utrata prawa wykonywania zawodu'}, seedRoster), 'Wygaśnięcie mandatu 10.11.2026, utrata prawa wykonywania zawodu, uchwała stwierdzająca do dopisania');
});

test('G-1: forma aktu z regulaminu zawsze wymaga głosowania i jest włączona; można zmienić nazwę, formuły i wykaz aktów', () => {
  const apel = defaultDocTypes.find(t => t.id === 'apel')!;
  const refusal = /Ten rodzaj zawsze wymaga głosowania \(§ 8 ust\. 9 pkt 4\)\. Możesz zmienić tylko nazwę i formuły wyniku\./;
  assert.throws(() => docTypeInput({voted: false}, defaultDocTypes, apel), refusal);
  assert.throws(() => docTypeInput({active: false}, defaultDocTypes, apel), refusal);
  assert.throws(() => docTypeInput({voted: false}, defaultDocTypes, defaultDocTypes.find(t => t.id === 'uchwala')), /\(§ 8 ust\. 1 i 3\)/);
  assert.throws(() => docTypeInput({voted: false}, defaultDocTypes, defaultDocTypes.find(t => t.id === 'sprawozdanie')), /\(§ 9 ust\. 2 pkt 6\)/);
  const renamed = docTypeInput({name: 'Apel Prezydium', adopted: 'Apel przyjęto', inActs: true}, defaultDocTypes, apel);
  assert.deepEqual([renamed.name, renamed.adopted, renamed.inActs, renamed.voted, renamed.active], ['Apel Prezydium', 'Apel przyjęto', true, true, true]);
  assert.deepEqual(defaultDocTypes.filter(t => t.inActs).map(t => t.id), ['uchwala'], 'w wykazie aktów domyślnie tylko uchwała');
  const info = docTypeInput({voted: true, active: false}, defaultDocTypes, defaultDocTypes.find(t => t.id === 'informacja'));
  assert.deepEqual([info.voted, info.active], [true, false], 'inne rodzaje zmienia się jak dotąd');
});
