import test from 'node:test';
import assert from 'node:assert/strict';
import {pageBlocks, PAGE_CHARS} from '../src/client/show-pages.ts';

// B3-21: strony materiału tekstowego w pokazie (porcje do około 700 znaków, nagłówek zaczyna stronę, długi blok sam).
const p = (n: number, tag = 'p') => ({tag, html: `<${tag}>${'x'.repeat(n)}</${tag}>`, text: 'x'.repeat(n)});

test('B3-21: porcje do 700 znaków, nagłówek zaczyna nową stronę, blok dłuższy niż porcja stoi sam', () => {
  assert.equal(PAGE_CHARS, 700);
  assert.deepEqual(pageBlocks([]), ['']);
  assert.equal(pageBlocks([p(200), p(200), p(200)]).length, 1);
  assert.equal(pageBlocks([p(400), p(400)]).length, 2);
  const withHeading = pageBlocks([p(100), p(20, 'h2'), p(100)]);
  assert.equal(withHeading.length, 2);
  assert.ok(withHeading[1].startsWith('<h2>'));
  const long = pageBlocks([p(100), p(2000), p(100)]);
  assert.equal(long.length, 3);
  assert.equal(long[1], `<p>${'x'.repeat(2000)}</p>`);
  // Ta sama wersja materiału daje te same strony (synchronizacja niezależna od ekranu).
  assert.deepEqual(pageBlocks([p(300), p(500), p(30, 'h3'), p(10)]), pageBlocks([p(300), p(500), p(30, 'h3'), p(10)]));
});
