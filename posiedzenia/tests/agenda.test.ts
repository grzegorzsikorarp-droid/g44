import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/shared/meeting.ts';
import {parseAgendaText} from '../src/shared/agenda.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium} from './helpers.ts';

// Sprawy w głosowaniu między posiedzeniami (parametr flat) i przedmiot głosowania nad dodaniem punktu do porządku.

const text = '1. A\n   - B\n2. C';
const office = actor(null, 'biuro', true);

// Posiedzenie otwarte, wszyscy obecni, porządek przyjęty: można głosować nad zmianą porządku.
function adopted() {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, actor('si'), ctx);
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  const point = m.agenda.find(i => i.kind === 'porzadek')!;
  m = apply(m, {type: 'item_start', itemId: point.id}, actor('si'), ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  return {ctx, m};
}
const byTitle = (m: Meeting, title: string) => m.agenda.find(i => i.title === title)!;

test('parseAgendaText z flat: każdy wiersz staje się pozycją główną, bez „Przyjęcie porządku obrad”', () => {
  const {items, warnings} = parseAgendaText(text, {flat: true});
  assert.deepEqual(items.map(i => [i.title, i.parent]), [['A', null], ['B', null], ['C', null]]);
  assert.ok(!items.some(i => i.kind === 'porzadek'));
  assert.equal(warnings.length, 0);
});

test('wczytanie spraw w głosowaniu między posiedzeniami tworzy trzy sprawy główne', () => {
  const ctx = context();
  const m = apply(newMeeting(ctx, 'procedura'), {type: 'agenda_import', text, replace: true}, office, ctx);
  assert.deepEqual(m.agenda.map(i => [i.title, i.parentId, i.kind]), [['A', null, 'sprawa'], ['B', null, 'sprawa'], ['C', null, 'sprawa']]);
});

test('wczytanie porządku posiedzenia bez zmian: podpunkt i dodane „Przyjęcie porządku obrad”', () => {
  const ctx = context();
  const m = apply(newMeeting(ctx), {type: 'agenda_import', text, replace: true}, office, ctx);
  assert.deepEqual(m.agenda.map(i => i.title), ['Przyjęcie porządku obrad', 'A', 'B', 'C']);
  assert.equal(byTitle(m, 'B').parentId, byTitle(m, 'A').id);
  assert.equal(byTitle(m, 'Przyjęcie porządku obrad').kind, 'porzadek');
});

test('przedmiot głosowania nad dodaniem punktu podaje numer i miejsce w porządku', () => {
  let {ctx, m} = adopted();
  const protocol = m.agenda.find(i => i.kind === 'protokol')!;
  m = apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'Patronat', parentId: null, afterId: protocol.id}, minutes: 2}, actor('si'), ctx.tick());
  assert.equal(m.ballots.at(-1)!.subject, 'Wniosek o dodanie punktu „Patronat” do porządku obrad, jako punktu 4, po punkcie 3 „Przyjęcie protokołu z poprzedniego posiedzenia”');
  ({ctx, m} = adopted());
  const resolutions = m.agenda.find(i => i.kind === 'uchwaly')!;
  m = apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'Uchwała nr 110/IX/2026', parentId: resolutions.id, afterId: null}, minutes: 2}, actor('si'), ctx.tick());
  assert.equal(m.ballots.at(-1)!.subject, 'Wniosek o dodanie punktu „Uchwała nr 110/IX/2026” do porządku obrad, jako podpunktu 5.1 w punkcie 5 „Podjęcie uchwał”');
});
