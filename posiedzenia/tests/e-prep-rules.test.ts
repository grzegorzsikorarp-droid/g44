import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actor, roster} from './helpers.ts';
import {canEditComment, commentsSentence, decisionText, itemCommentCount, itemThreads, mayProposeWaiting, proposalsTab, readinessSentence, waitingProposals, waitsForConvener} from '../src/client/prep-rules.ts';
import type {Comment, Proposal, ReadinessCheck} from '../src/shared/workspace.ts';

// Zespół E (SPEC-4 8.1, 8.3 pkt 7): czyste reguły ekranów wspólnego przygotowania z src/client/prep-rules.ts.

const proposal = (over: Partial<Proposal> = {}): Proposal => ({id: 'z1', title: 'Sprawa', justification: 'Bo tak.', accountId: 'a-1', byName: 'Anna Testowa', at: 0, state: 'zgloszone', ...over});
const comment = (over: Partial<Comment>): Comment => ({id: 'c', target: {kind: 'punkt', itemId: 'p1'}, parentId: null, text: 'Uwaga', accountId: 'a-1', byName: 'Anna Testowa', at: 0, ...over});

test('E: „Zgłoś sprawę na najbliższe posiedzenie” mają członkowie organu i głos doradczy, bez biura, komunikacji i gości (B2-W06)', () => {
  assert.equal(mayProposeWaiting(roster, 'prezydium', actor('jw')), true);
  assert.equal(mayProposeWaiting(roster, 'prezydium', actor(null, 'doradczy')), true);
  assert.equal(mayProposeWaiting(roster, 'prezydium', actor(null, 'biuro')), false);
  assert.equal(mayProposeWaiting(roster, 'prezydium', actor(null, 'komunikacja')), false);
  assert.equal(mayProposeWaiting(roster, 'prezydium', actor(null, 'gosc')), false);
});

test('E: zakładka „Zgłoszenia ({n})” liczy tylko zgłoszenia czekające na decyzję i ma nazwę dostępną z liczebnikiem (6.5)', () => {
  const prep = (n: number) => ({proposals: [...Array.from({length: n}, (_, i) => proposal({id: 'z' + i})), proposal({id: 'w', state: 'wpisane'}), proposal({id: 'o', state: 'odrzucone'})]});
  assert.equal(waitingProposals(prep(2)), 2);
  assert.deepEqual(proposalsTab(prep(1)), {label: 'Zgłoszenia (1)', name: 'Zgłoszenia, 1 czeka na decyzję'});
  assert.deepEqual(proposalsTab(prep(3)), {label: 'Zgłoszenia (3)', name: 'Zgłoszenia, 3 czekają na decyzję'});
  assert.deepEqual(proposalsTab(prep(5)), {label: 'Zgłoszenia (5)', name: 'Zgłoszenia, 5 czeka na decyzję'});
  assert.deepEqual(proposalsTab(null), {label: 'Zgłoszenia (0)', name: 'Zgłoszenia, 0 czeka na decyzję'});
});

test('E: zdanie o gotowości w wierszu punktu z tych samych sprawdzeń co przegląd (B2-W12, kryterium 3)', () => {
  const ok: ReadinessCheck = {key: 'material', ok: true, text: 'Materiał dodano.'};
  const act: ReadinessCheck = {key: 'projekt_aktu', ok: false, text: 'Brak projektu uchwały. Projekt przygotowuje sekretarz, a w sprawach finansowych skarbnik (§ 17 ust. 2 pkt 3, § 18 ust. 2 pkt 1).'};
  const ref: ReadinessCheck = {key: 'referent', ok: false, text: 'Brak osoby referującej.'};
  assert.equal(readinessSentence(undefined), '');
  assert.equal(readinessSentence([]), '');
  assert.equal(readinessSentence([ok]), 'Gotowe.');
  assert.equal(readinessSentence([ok, act]), 'Brakuje projektu uchwały.');
  assert.equal(readinessSentence([act, ref, {key: 'material', ok: false, text: 'Brak materiału.'}]), 'Brakuje projektu uchwały, osoby referującej i materiału.');
});

test('E: uwagi przy punkcie: wątki z odpowiedziami w kolejności czasu, liczba bez usuniętych (6.5)', () => {
  const list = [
    comment({id: 'b', at: 20}), comment({id: 'a', at: 10}), comment({id: 'r1', parentId: 'a', at: 30}), comment({id: 'r0', parentId: 'a', at: 15}),
    comment({id: 'x', at: 5, deleted: {at: 6}, text: ''}), comment({id: 'inny', target: {kind: 'punkt', itemId: 'p2'}}),
  ];
  const threads = itemThreads(list, 'p1');
  assert.deepEqual(threads.map(t => t.root.id), ['x', 'a', 'b']);
  assert.deepEqual(threads[1].replies.map(r => r.id), ['r0', 'r1']);
  assert.equal(itemCommentCount(list, 'p1'), 4);
  assert.equal(commentsSentence(4), 'Uwagi 4.');
  assert.equal(commentsSentence(0), '');
});

test('E: poprawka uwagi tylko przez autora, przez 15 minut i przed pierwszą odpowiedzią (G-31)', () => {
  const c = comment({id: 'c1', at: 0});
  assert.equal(canEditComment(c, [c], 'a-1', 14 * 60000), true);
  assert.equal(canEditComment(c, [c], 'a-1', 16 * 60000), false);
  assert.equal(canEditComment(c, [c], 'a-2', 60000), false);
  assert.equal(canEditComment(c, [c, comment({id: 'r', parentId: 'c1'})], 'a-1', 60000), false);
  assert.equal(canEditComment({...c, deleted: {at: 1}}, [c], 'a-1', 60000), false);
});

test('E: „Czeka na decyzję zwołującego” tylko u osób przygotowujących, które nie rozstrzygają (DB-14, K4-3)', () => {
  assert.equal(waitsForConvener(proposal(), true, false), true);    // biuro, wiceprzewodniczący bez zwołania
  assert.equal(waitsForConvener(proposal(), true, true), false);    // zwołujący
  assert.equal(waitsForConvener(proposal(), false, false), false);  // osoba zgłaszająca
  assert.equal(waitsForConvener(proposal({state: 'odrzucone'}), true, false), false);
  assert.equal(decisionText(proposal({state: 'odrzucone', decision: {at: 0, accountId: 'a-p1', by: 'Barbara Wiśniewska', reason: 'Sprawa wróci później.'}})), 'Powód „Sprawa wróci później”. Barbara Wiśniewska');
  assert.equal(decisionText(proposal()), '');
});
