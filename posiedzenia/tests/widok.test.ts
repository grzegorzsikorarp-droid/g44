import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/shared/meeting.ts';
import {awaitingVote, materialTypeOf, needsVote, resultLabel} from '../src/shared/rules.ts';
import {viewFor} from '../src/shared/view.ts';
import type {Ballot, MaterialRef, MaterialType, Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium} from './helpers.ts';

// Funkcje pomocnicze widoku (rules.ts): kto jeszcze nie głosował, gdzie trzeba głosować i jak brzmi wynik.

function adopted() {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, actor('si'), ctx);
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  // Wersja 2: potwierdzenie zgłoszonej obecności (F9), stwierdzenie kworum (F5) i ogłoszenie wyniku (F2).
  m = apply(m, {type: 'presence_confirm_all'}, actor('si'), ctx.tick());
  m = apply(m, {type: 'quorum'}, actor('si'), ctx.tick());
  const point = m.agenda.find(i => i.kind === 'porzadek')!;
  m = apply(m, {type: 'item_start', itemId: point.id}, actor('si'), ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: m.ballots.at(-1)!.id}, actor('si'), ctx.tick());
  return {ctx, m};
}
const voteAll = (m: Meeting, ctx: ReturnType<typeof context>, choice: 'za' | 'przeciw' = 'za') => {
  const id = m.ballots.at(-1)!.id;
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: id, choice}, actor(p), ctx.tick());
  return apply(m, {type: 'announce', ballotId: id}, actor('si'), ctx.tick());
};
// Materiał dopisuje do posiedzenia serwer, więc test dodaje go tak samo, z pominięciem poleceń domeny.
const withMaterial = (m: Meeting, type: MaterialType, title: string) => {
  const ref: MaterialRef = {id: 'mat-' + type, title, type, number: '', version: 1, hash: 'x', size: 1, fileId: null, fileName: null, createdAt: 0};
  return {...m, materials: [...m.materials, ref]};
};

test('w widoku osoby po 6 głosach z 7 na głos czeka jedna osoba', () => {
  const {ctx, m: start} = adopted();
  const it = start.agenda.find(i => i.kind === 'uchwaly')!;
  let m = apply(start, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 1', mode: 'jawne', minutes: 5}, actor('si'), ctx.tick());
  const id = m.ballots.at(-1)!.id;
  for (const p of presidium.slice(0, 6)) m = apply(m, {type: 'vote', ballotId: id, choice: 'za'}, actor(p), ctx.tick());
  // Widok w trakcie głosowania nie zawiera cudzych głosów, tylko listę osób, które już głosowały.
  const b = viewFor(m, actor('si')).ballots.at(-1) as Ballot & {voted: string[]};
  assert.equal(b.status, 'otwarte');
  assert.deepEqual(b.votes, {});
  assert.deepEqual(awaitingVote(b), ['ak']);
});

test('głosowania wymaga podpunkt w „Podjęciu uchwał”, a „Sprawy bieżące” bez materiału nie', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  const resolutions = m.agenda.find(i => i.kind === 'uchwaly')!;
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026 w sprawie patronatu nad konferencją', parentId: resolutions.id}, actor(null, 'biuro', true), ctx.tick());
  const sub = m.agenda.find(i => i.parentId === resolutions.id)!;
  const current = m.agenda.find(i => i.kind === 'sprawozdania')!;
  assert.equal(needsVote(m, sub), true);
  assert.equal(needsVote(m, current), false);
  assert.equal(needsVote(m, m.agenda.find(i => i.kind === 'porzadek')!), true);
  const report = withMaterial(m, 'sprawozdanie', 'Sprawozdanie z działalności Prezydium');
  assert.equal(needsVote(report, {...current, materialIds: ['mat-sprawozdanie']}), true);
});

test('formuły wyniku: „Uchwała podjęta”, „Sprawozdanie przyjęte”, „Wniosek o głosowanie tajne przyjęty”', () => {
  const {ctx, m: start} = adopted();
  const resolutions = start.agenda.find(i => i.kind === 'uchwaly')!;
  let m = apply(start, {type: 'ballot_open', itemId: resolutions.id, purpose: 'uchwala', subject: 'Uchwała nr 108/IX/2026 w sprawie patronatu nad konferencją', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  m = voteAll(m, ctx);
  let b = m.ballots.at(-1)!;
  assert.equal(materialTypeOf(m, b), null);
  assert.equal(resultLabel(b, materialTypeOf(m, b)), 'Uchwała podjęta');

  const reports = m.agenda.find(i => i.kind === 'sprawozdania')!;
  m = withMaterial(m, 'sprawozdanie', 'Sprawozdanie z działalności Prezydium');
  m = apply(m, {type: 'ballot_open', itemId: reports.id, purpose: 'uchwala', subject: 'Sprawozdanie z działalności Prezydium', mode: 'jawne', minutes: 2, materialId: 'mat-sprawozdanie'}, actor('si'), ctx.tick());
  m = voteAll(m, ctx);
  b = m.ballots.at(-1)!;
  assert.equal(materialTypeOf(m, b), 'sprawozdanie');
  assert.equal(resultLabel(b, materialTypeOf(m, b)), 'Sprawozdanie przyjęte');

  m = apply(m, {type: 'mode_motion', itemId: resolutions.id, mode: 'tajne', minutes: 2, proposedBy: 'ag'}, actor('si'), ctx.tick());
  m = voteAll(m, ctx);
  assert.equal(resultLabel(m.ballots.at(-1)!), 'Wniosek o głosowanie tajne przyjęty');

  // Wersja 2 (F3): po uchwaleniu tajności w punkcie „Podjęcie uchwał” głosowanie jawne odbywa się w innym punkcie.
  m = apply(m, {type: 'ballot_open', itemId: reports.id, purpose: 'uchwala', subject: 'Uchwała nr 109/IX/2026 w sprawie delegowania przedstawicieli', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  m = voteAll(m, ctx, 'przeciw');
  assert.equal(resultLabel(m.ballots.at(-1)!, null), 'Uchwała nie została podjęta');
});
