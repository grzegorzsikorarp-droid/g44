import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanHtml, docxToHtml, splitActs, textToHtml} from '../src/server/documents.ts';

test('DOCX z trzema uchwałami PWZ dzieli się na trzy lekkie dokumenty', async () => {
  const file = readFileSync(new URL('./fixtures/uchwaly-pwz-przyklad.docx', import.meta.url));
  const html = await docxToHtml(file);
  assert.ok(html.length < file.length / 10, 'lekki HTML jest wielokrotnie mniejszy niż DOCX');
  const parts = splitActs(html);
  assert.deepEqual(parts.map(p => p.number), ['117/IX/2026 PWZ', '118/IX/2026 PWZ', '119/IX/2026 PWZ']);
  assert.equal(parts[0].title, 'Uchwała nr 117/IX/2026 PWZ w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki');
  assert.equal(parts[0].type, 'uchwala');
  assert.match(parts[0].html, /<h3>§ 1<\/h3>/);
  assert.match(parts[0].html, /<table>/);
  assert.doesNotMatch(parts[0].html, /118\/IX\/2026/);
});

test('czyszczenie HTML usuwa skrypty, style i atrybuty zdarzeń', () => {
  const html = cleanHtml('<p onclick="x()">Tekst<script>alert(1)</script></p><img src=x onerror=alert(1)><a href="javascript:alert(1)">link</a><style>p{}</style>');
  assert.equal(html, '<p>Tekst</p><a>link</a>');
});

test('zwykły tekst: akapity i nagłówki paragrafów', () => {
  assert.equal(textToHtml('§ 1\nTreść <b>pierwsza</b>.\n\nDruga linia\ni dalej'), '<h3>§ 1</h3>\n<p>Treść &lt;b&gt;pierwsza&lt;/b&gt;.</p>\n<p>Druga linia<br>i dalej</p>');
});
