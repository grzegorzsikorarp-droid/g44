import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {blockingBallot, canShowNow, displayFacts, pageNoun, shownDisplays, shownFileText, shownInItem, showLabel, showVisible} from '../src/shared/show.ts';
import type {DisplayRef, Meeting} from '../src/shared/types.ts';
import {openedMeeting} from './scenariusz-v4.ts';

// Czyste funkcje pokazu (SPEC-4 6.6, T-3, B3-08–B3-25; etap D.1 pkt 7 i 8). Polecenia pokazu sprawdza etap D.2.

const pdf: DisplayRef = {id: 'd1', title: 'Projekt budżetu na 2027 rok', kind: 'pdf', files: [{fileId: 'f1', name: 'b.pdf', type: 'pdf', size: 2_516_582}], pages: 12, itemId: null, addedAt: 1, addedBy: 'Biuro', accountId: 'u'};
const slides: DisplayRef = {...pdf, id: 'd2', title: 'Zdjęcia z konferencji', kind: 'obrazy', pages: 8, files: Array.from({length: 8}, (_, i) => ({fileId: `s${i}`, name: `slajd${i + 1}.png`, type: 'png' as const, size: 400_000}))};

function showing(): Meeting {
  const {m} = openedMeeting({v4: true});
  return {...m, displays: [pdf, slides], show: {source: 'plik', id: 'd1', page: 4, itemId: null, startedAt: 1, by: 'x', accountId: 'u'}, presentation: {kind: 'pokaz', id: 'd1', at: 1}};
}

test('T-3: showVisible zależy wyłącznie od stanu wspólnego, nigdy od głosu danej osoby', () => {
  const m = showing();
  assert.equal(showVisible(m), true);
  // Te same dane z polami widoku osoby, która głosowała i która nie głosowała: ten sam wynik.
  const withVote = {...m, ballots: m.ballots.map(b => ({...b, voted: ['si'], myVote: 'za' as const, secretCastHere: true}))};
  const without = {...m, ballots: m.ballots.map(b => ({...b, voted: [], myVote: undefined}))};
  assert.equal(showVisible(withVote), showVisible(without));
  const voting = {...m, ballots: [...m.ballots, {...m.ballots[0], id: 'open', status: 'otwarte' as const}]};
  assert.equal(showVisible(voting), false, 'w trakcie głosowania pokazu nie widać (B3-11)');
  assert.equal(showVisible({...m, presentation: {kind: 'glosowanie', id: 'x', at: 1}}), false, 'pokaz nie wraca sam po głosowaniu');
  assert.equal(showVisible({...m, status: 'przerwa'}), false);
  assert.equal(canShowNow(m), true);
  assert.equal(canShowNow(voting), false);
  assert.equal(blockingBallot(voting)?.id, 'open');
  // Funkcja nie czyta pól widoku zależnych od osoby (grep źródła, kontrola k pkt 7).
  const src = readFileSync(new URL('../src/shared/show.ts', import.meta.url), 'utf8').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
  assert.ok(!/secretCastHere|myVote|\.voted/.test(src));
});

test('showLabel, displayFacts, pageNoun: opisy pokazu i plików (B3-08, B3-15)', () => {
  const m = showing();
  assert.equal(showLabel(m), 'plik „Projekt budżetu na 2027 rok”, strona 4 z 12');
  assert.equal(showLabel({...m, show: {...m.show!, id: 'd2', page: 3}}), 'plik „Zdjęcia z konferencji”, slajd 3 z 8');
  assert.equal(showLabel({...m, displays: [{...pdf, pages: null}]}), 'plik „Projekt budżetu na 2027 rok”, strona 4');
  assert.equal(showLabel({...m, show: null}), null);
  assert.equal(displayFacts(pdf), 'PDF, 12 stron, 2,4 MB');
  assert.equal(displayFacts({...pdf, pages: 1}), 'PDF, 1 strona, 2,4 MB');
  assert.equal(displayFacts(slides), 'obrazy, 8 slajdów, 3,1 MB');
  assert.deepEqual([pageNoun('pdf'), pageNoun('obrazy'), pageNoun('material')], ['strona', 'slajd', 'strona']);
});

test('B3-14: pliki pokazane w punkcie w kolejności pierwszego pokazu i opis do protokołu', () => {
  const m = showing();
  const it = m.agenda[3].id;
  const logged: Meeting = {...m, log: [...m.log,
    {at: 2, text: 'Pokazano plik.', by: 'x', tag: 'pokaz', itemId: it, displayId: 'd2'},
    {at: 3, text: 'Pokazano plik.', by: 'x', tag: 'pokaz', itemId: it, displayId: 'd1'},
    {at: 4, text: 'Pokazano plik.', by: 'x', tag: 'pokaz', itemId: it, displayId: 'd2'},
    {at: 5, text: 'Pokazano plik.', by: 'x', tag: 'pokaz', itemId: 'inny', displayId: 'd1'}]};
  assert.deepEqual(shownInItem(logged, it).map(d => d.id), ['d2', 'd1']);
  assert.deepEqual(shownDisplays(logged).map(d => d.id), ['d2', 'd1']);
  assert.equal(shownFileText(pdf), '„Projekt budżetu na 2027 rok” (PDF, 12 stron)');
  assert.equal(shownFileText(slides), '„Zdjęcia z konferencji” (obrazy, 8)');
  assert.equal(shownFileText({...pdf, kind: 'obraz'}), '„Projekt budżetu na 2027 rok” (obraz)');
});
