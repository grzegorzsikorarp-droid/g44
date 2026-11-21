import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carriedText, type Proposal} from '../src/shared/workspace.ts';

// Poprawki po kontroli końcowej wersji 4 (SPEC-4 10.3): czyste reguły bez serwera.

const proposal = (carriedFrom: Proposal['carriedFrom']): Proposal => ({
  id: 'z1', title: 'Sprawa kontrolna', justification: 'Uzasadnienie.', accountId: 'a1', byName: 'Anna Testowa', at: 0, state: 'zgloszone',
  ...(carriedFrom ? {carriedFrom} : {}),
} as Proposal);

test('D-5: zgłoszenie przeniesione przy otwarciu tego samego posiedzenia nie dostaje zdania z datą bieżącego posiedzenia', () => {
  const fromThis = proposal({meetingId: 'm-biezace', date: '2026-11-21'});
  assert.equal(carriedText(fromThis, 'm-biezace'), null);
  assert.equal(carriedText(fromThis), 'Z posiedzenia z dnia 21.11.2026.', 'bez bieżącego posiedzenia zdanie zostaje (przygotowanie, B2-W06)');
  assert.equal(carriedText(proposal({meetingId: 'm-wczesniejsze', date: '2026-10-15'}), 'm-biezace'), 'Z posiedzenia z dnia 15.10.2026.');
  assert.equal(carriedText(proposal({meetingId: null, date: null}), 'm-biezace'), 'Zgłoszone przed utworzeniem posiedzenia.');
  assert.equal(carriedText(proposal(undefined), 'm-biezace'), null);
});
