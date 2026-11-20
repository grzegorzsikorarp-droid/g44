import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, envOf, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {effectiveMeeting} from '../src/shared/cascade.ts';
import {defaultGeneral} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {validateAgenda} from '../src/shared/agenda.ts';
import {LAW} from '../src/shared/law.ts';
import {seedSite} from '../src/server/seed.ts';
import type {MaterialRef, Meeting} from '../src/shared/types.ts';
import {actor, context, presidium} from './helpers.ts';

// Niezmiennik porządku obrad (G-6) i strażnik punktów (G-7–G-11) w domenie (specyfikacja wersji 3, rozdz. 2.7; I-3).

type Ctx = ReturnType<typeof context> & Context;
const chair = actor('si');
const office = actor(null, 'biuro', true);
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
const kinds = (m: Meeting) => m.agenda.filter(i => !i.parentId).map(i => i.kind);
function setup(): Ctx {
  const ctx = context() as Ctx;
  ctx.general = {general: defaultGeneral(seedSite), docTypes: defaultDocTypes, revision: 1};
  return ctx;
}
const prepared = (ctx: Ctx) => newMeetingFromSettings({id: 'm1', kind: 'posiedzenie', date: '2026-12-03', time: '10:00', actor: office}, ctx);
function opened(ctx: Ctx, m = prepared(ctx)) {
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  return apply(m, {type: 'quorum'}, chair, ctx.tick());
}
const material = (m: Meeting, type: string): Meeting => ({...m, materials: [...m.materials, {id: 'mat-' + type, title: 'Projekt uchwały nr 108/IX/2026', type, number: '', version: 1, hash: 'x', size: 1, fileId: null, fileName: null, createdAt: 0} as MaterialRef]});

test('I-3: wczytanie tekstu bez otwarcia, zamknięcia i „Przyjęcia protokołu” uzupełnia te punkty z wpisem w dzienniku', () => {
  const ctx = setup();
  const m = apply(prepared(ctx), {type: 'agenda_import', replace: true, text: '1. Sprawy bieżące\n2. Podjęcie uchwał\n   - Uchwała nr 108/IX/2026\n3. Wolne wnioski'}, office, ctx.tick());
  assert.deepEqual(kinds(m), ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie']);
  const notes = m.log.filter(e => e.text.startsWith('Uzupełniono')).map(e => e.text);
  assert.deepEqual(notes, [
    'Uzupełniono projekt porządku obrad o punkt „Przyjęcie porządku obrad” wymagany regulaminem (§ 9 ust. 2 pkt 4).',
    'Uzupełniono projekt porządku obrad o punkt „Otwarcie posiedzenia i stwierdzenie kworum” wymagany regulaminem (§ 9 ust. 2 pkt 1 i 3).',
    'Uzupełniono projekt porządku obrad o punkt „Przyjęcie protokołu z poprzedniego posiedzenia” wymagany regulaminem (§ 9 ust. 2 pkt 5).',
    'Uzupełniono projekt porządku obrad o punkt „Zamknięcie posiedzenia” wymagany regulaminem (§ 9 ust. 2 pkt 9).',
  ]);
  assert.ok(m.log.filter(e => e.text.startsWith('Uzupełniono')).every(e => e.tag === 'projekt' && e.itemId));
  assert.equal(validateAgenda(LAW.prezydium, m), null);
  const review = effectiveMeeting(envOf(ctx, 'prezydium'), m, {review: true}).review!;
  assert.ok(review.some(r => r.group === 'sprawdzic' && r.text === 'Uzupełniono projekt porządku obrad o punkt „Zamknięcie posiedzenia” wymagany regulaminem.'));
  // Dopisywanie: punkt obowiązkowy, który już jest, zostaje zwykłą sprawą; przyjęcie porządku dodane przez rozpoznawanie się nie powtarza.
  const appended = apply(m, {type: 'agenda_import', replace: false, text: '1. Otwarcie posiedzenia\n2. Patronat nad konferencją'}, office, ctx.tick());
  assert.equal(appended.agenda.filter(i => i.kind === 'otwarcie').length, 1);
  assert.equal(appended.agenda.filter(i => i.kind === 'porzadek').length, 1);
  assert.deepEqual(appended.agenda.slice(-2).map(i => [i.title, i.kind]), [['Otwarcie posiedzenia', 'sprawa'], ['Patronat nad konferencją', 'sprawa']]);
});

test('G-6: punktu obowiązkowego nie da się usunąć żadną drogą', () => {
  const ctx = setup();
  const m = prepared(ctx);
  for (const kind of ['otwarcie', 'porzadek', 'zamkniecie']) {
    const it = item(m, kind);
    assert.throws(() => apply(m, {type: 'item_remove', itemId: it.id, reason: 'Nie potrzeba.'}, chair, ctx), new RegExp(`Punktu „${it.title}” nie można usunąć\\. To punkt obowiązkowy \\(§ 9 ust\\. 2 pkt`));
    assert.throws(() => apply(m, {type: 'item_edit', itemId: it.id, kind: 'sprawa', reason: 'Nie potrzeba.'}, chair, ctx), /nie można usunąć\. To punkt obowiązkowy/);
  }
  assert.throws(() => apply(m, {type: 'item_edit', itemId: item(m, 'uchwaly').id, kind: 'zamkniecie', reason: 'x'}, chair, ctx), /Punkt „Zamknięcie posiedzenia” może wystąpić w porządku tylko raz\./);
  assert.throws(() => apply(m, {type: 'item_place', itemId: item(m, 'zamkniecie').id, parentId: item(m, 'uchwaly').id, beforeId: null}, office, ctx), /Ten punkt nie może stać się podpunktem\./);
  // Po przyjęciu porządku punktu obowiązkowego nie usuwa też głosowanie nad zmianą porządku.
  let live = opened(ctx);
  live = apply(live, {type: 'item_start', itemId: item(live, 'porzadek').id}, chair, ctx.tick());
  live = apply(live, {type: 'ballot_open', itemId: item(live, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  for (const p of presidium) live = apply(live, {type: 'vote', ballotId: live.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  live = apply(live, {type: 'announce', ballotId: live.ballots.at(-1)!.id}, chair, ctx.tick());
  assert.throws(() => apply(live, {type: 'agenda_change', change: {op: 'usun', itemId: item(live, 'zamkniecie').id}, minutes: 2}, chair, ctx), /Punktu „Zamknięcie posiedzenia” nie można usunąć\. To punkt obowiązkowy \(§ 9 ust\. 2 pkt 9\)\./);
});

test('G-7: zmiana rodzaju punktu z regulaminu bez powodu jest odrzucana, z powodem przez przewodniczącego daje pominięcie, przez biuro 403', () => {
  const ctx = setup();
  let m = prepared(ctx);
  const protocol = item(m, 'protokol');
  assert.throws(() => apply(m, {type: 'item_edit', itemId: protocol.id, kind: 'sprawa'}, office, ctx),
    (e: Error & {status?: number}) => e.message === 'Pominięcie punktu wymienionego w regulaminie zatwierdza przewodniczący (§ 14 ust. 3).' && e.status === 403);
  assert.throws(() => apply(m, {type: 'item_remove', itemId: protocol.id, reason: 'Protokół nie jest gotowy.'}, actor('jw'), ctx), /zatwierdza przewodniczący \(§ 14 ust\. 3\)/);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: protocol.id, kind: 'sprawa'}, chair, ctx), /Podaj powód pominięcia punktu „Przyjęcie protokołu z poprzedniego posiedzenia”\. Trafi do protokołu \(§ 9 ust\. 2 pkt 5\)\./);
  m = apply(m, {type: 'item_edit', itemId: protocol.id, kind: 'sprawa', reason: 'Protokół nie jest gotowy.'}, chair, ctx.tick());
  assert.deepEqual(m.skipped!.map(s => [s.kind, s.title, s.reason, s.by, s.accountId]), [['protokol', 'Przyjęcie protokołu z poprzedniego posiedzenia', 'Protokół nie jest gotowy.', 'Sebastian Irzykowski', 'u-si']]);
  assert.equal(validateAgenda(LAW.prezydium, m), null);
  const review = effectiveMeeting(envOf(ctx, 'prezydium'), m, {review: true}).review!;
  assert.ok(review.some(r => r.text === 'Pominięto punkt „Przyjęcie protokołu z poprzedniego posiedzenia”. Protokół poprzedniego posiedzenia przyjmuje się na następnym posiedzeniu (§ 13 ust. 3).'));
  // Przywrócenie rodzaju w przygotowaniu znosi pominięcie.
  const restored = apply(m, {type: 'item_edit', itemId: protocol.id, kind: 'protokol'}, office, ctx.tick());
  assert.equal(restored.skipped, undefined);
  // Zastępca, który zwołuje posiedzenie, też może pominąć punkt (DA-7).
  let deputy = apply(prepared(setup()), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  deputy = apply(deputy, {type: 'details', convener: 'ag'}, office, ctx.tick());
  deputy = apply(deputy, {type: 'item_remove', itemId: item(deputy, 'wolne_wnioski').id, reason: 'Brak spraw.'}, actor('ag'), ctx.tick());
  assert.equal(deputy.skipped![0].kind, 'wolne_wnioski');
  // Po otwarciu, przed przyjęciem porządku, pomija osoba prowadząca obrady.
  let live = opened(ctx);
  live = apply(live, {type: 'item_remove', itemId: item(live, 'sprawozdania').id, reason: 'Brak sprawozdań.'}, chair, ctx.tick());
  assert.equal(live.skipped![0].kind, 'sprawozdania');
  assert.equal(live.log.at(-2)!.text, 'Pominięto punkt „Sprawy bieżące, w tym przyjęcie sprawozdań” wymieniony w § 9 ust. 2 pkt 6. Powód „Brak sprawozdań”.');
});

test('G-8, G-9: rodzaj punktu tylko w przygotowaniu; „Co jest głosowane” bez głosowania przy materiale głosowanym odrzucane', () => {
  const ctx = setup();
  let m = material(prepared(ctx), 'uchwala');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const sub = m.agenda.find(i => i.parentId)!;
  m = apply(m, {type: 'item_material', itemId: sub.id, materialId: 'mat-uchwala', on: true}, office, ctx.tick());
  assert.equal(m.log.at(-1)!.text, 'Dołączono materiał „Projekt uchwały nr 108/IX/2026” do punktu 5.1.');
  assert.throws(() => apply(m, {type: 'item_edit', itemId: sub.id, docType: 'informacja'}, office, ctx),
    /Ten punkt ma materiał »Projekt uchwały nr 108\/IX\/2026«, który wymaga głosowania \(§ 8 ust\. 1 i 3\)\. Wybierz rodzaj, który się głosuje, albo zmień materiał\./);
  m = apply(m, {type: 'item_edit', itemId: sub.id, docType: 'stanowisko'}, office, ctx.tick());
  assert.equal(m.log.at(-1)!.text, 'Zmieniono co jest głosowane w punkcie 5.1 z „Uchwała” na „Stanowisko”.');
  const live = opened(ctx, m);
  assert.throws(() => apply(live, {type: 'item_edit', itemId: sub.id, kind: 'uchwaly'}, chair, ctx), /Rodzaj punktu zmienia się w przygotowaniu posiedzenia\./);
});

test('G-10, G-11: „Co jest głosowane” w trakcie obrad i materiał w trakcie głosowania nad nim', () => {
  const ctx = setup();
  let m = material(prepared(ctx), 'uchwala');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const sub = m.agenda.find(i => i.parentId)!;
  m = apply(m, {type: 'item_material', itemId: sub.id, materialId: 'mat-uchwala', on: true}, office, ctx.tick());
  m = opened(ctx, m);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: sub.id, docType: 'stanowisko', reason: 'x'}, actor('jw'), ctx), /W trakcie obrad rodzaj sprawy zmienia osoba prowadząca obrady\./);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: sub.id, docType: 'stanowisko'}, chair, ctx), /Podaj powód zmiany rodzaju sprawy\. Trafi do protokołu\./);
  const changed = apply(m, {type: 'item_edit', itemId: sub.id, docType: 'stanowisko', reason: 'Projekt zawiera stanowisko.'}, chair, ctx.tick());
  assert.deepEqual([changed.log.at(-1)!.tag, changed.log.at(-1)!.text], ['odstepstwo', 'W punkcie 5.1 zmieniono rodzaj sprawy z „Uchwała” na „Stanowisko”. Powód „Projekt zawiera stanowisko”.']);
  assert.equal(changed.agenda.find(i => i.id === sub.id)!.stamps!.docType!.live, true);
  // Głosowanie nad materiałem: przypisania nie zmienia nikt.
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: m.ballots.at(-1)!.id}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: sub.id, reason: 'Kolejność ustalona na początku.'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: sub.id, purpose: 'uchwala', subject: 'Uchwała nr 108/IX/2026', mode: 'jawne', minutes: 2, materialId: 'mat-uchwala'}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'item_material', itemId: sub.id, materialId: 'mat-uchwala', on: false}, office, ctx), /Trwa głosowanie nad tym materiałem\./);
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: m.ballots.at(-1)!.id}, chair, ctx.tick());
  m = apply(m, {type: 'close', reason: 'Koniec czasu.'}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'item_edit', itemId: sub.id, docType: 'apel', reason: 'x'}, chair, ctx), /Posiedzenie zostało zamknięte\./);
  assert.throws(() => apply(m, {type: 'item_material', itemId: sub.id, materialId: 'mat-uchwala', on: false}, office, ctx), /Posiedzenie zostało zamknięte\./);
});

test('zmiany projektu porządku trafiają do dziennika także w przygotowaniu, z identyfikatorem punktu (D2)', () => {
  const ctx = setup();
  let m = prepared(ctx);
  m = apply(m, {type: 'item_add', title: 'Patronat nad konferencją'}, office, ctx.tick());
  const added = m.agenda.find(i => i.title === 'Patronat nad konferencją')!;
  assert.deepEqual([m.log.at(-1)!.tag, m.log.at(-1)!.itemId, m.log.at(-1)!.accountId], ['projekt', added.id, 'u-biuro']);
  m = opened(ctx, m);
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'present', kind: 'projekt', id: m.id}, chair, ctx.tick());
  assert.deepEqual(m.presentation, {kind: 'projekt', id: 'm1', at: ctx.now});
  assert.throws(() => apply(m, {type: 'present', kind: 'projekt', id: 'inne'}, chair, ctx), /Nieprawidłowa prezentacja\./);
});
