import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
import mammoth from 'mammoth';
import {docxFromHtml, parseHtml, textOf} from '../src/shared/docx.ts';
import {docxText, entryText, unzip} from './docx-text.ts';

// Prawdziwy .docx z HTML (SPEC-4 5.5, B1-09, K4-34; etap D.1 pkt 4 i 8, kryterium odbioru 7 zespołu D).

const deflate = async (b: Uint8Array) => new Uint8Array(await promisify(deflateRaw)(b));
const NOW = Date.parse('2026-11-20T12:00:00Z');
const sample = `<header><p class="draft">Projekt do uzupełnienia przez sekretarza</p><h1>Protokół nr 12/IX/2026 z posiedzenia <b>Prezydium</b></h1>
<dl class="facts"><div class="fact"><dt>Termin</dt><dd>20 listopada 2026 r., godz. 10:00–11:30</dd></div></dl></header>
<h2>I. Zwołanie</h2><p>Tekst z <strong>pogrubieniem</strong>, <em>kursywą</em>, <u>podkreśleniem</u>, <s>przekreśleniem</s>, m<sup>2</sup>, H<sub>2</sub>O i &amp; znakiem &lt;.</p>
<p>Odnośnik <a href="https://example.org/dokument">dokument</a> w tekście.</p><hr>
<ol class="attachments"><li>Lista obecności.</li><li>Porządek obrad.<ol><li>Podpunkt.</li></ol></li></ol><ul><li>Pierwszy</li><li>Drugi</li></ul>
<ol start="3"><li>Trzeci</li></ol>
<blockquote><p>Cytat z uchwały.</p></blockquote>
<table><thead><tr><th>Pozycja</th><th colspan="2">Kwota</th></tr></thead><tbody>
<tr><td rowspan="2">Szkolenia</td><td>2026</td><td>1 000 zł</td></tr>
<tr><td>2027</td><td>2 000 zł</td></tr>
<tr><td colspan="2" rowspan="2">Razem</td><td>3 000 zł</td></tr>
<tr><td>bez zmian</td></tr></tbody></table>
<section class="attachment"><p class="draft">Załącznik nr 1</p><h2>Lista obecności</h2></section>
<table class="signatures"><tr><td>..............................<br>Przewodniczący obrad<br><b>Anna Przykładowa</b></td><td>..............................<br>Sekretarz<br><b>Jan Próbny</b></td></tr></table>
<script>alert(1)</script><img src="x.png" alt="">`;

test('docx: pakiet OOXML z wymaganymi częściami, nagłówkiem „Projekt” i stopką „Strona X z Y”', async () => {
  const bytes = await docxFromHtml(sample, {title: 'Projekt protokołu – próba', header: 'Projekt protokołu, posiedzenie z dnia 20.11.2026', draft: true, footerLeft: 'Wygenerowano 20.11.2026, godz. 13:00', now: NOW, deflateRaw: deflate});
  const names = unzip(bytes).map(e => e.name);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) assert.ok(names.includes(part), part);
  const header = entryText(bytes, 'word/header1.xml'), first = entryText(bytes, 'word/header2.xml'), footer = entryText(bytes, 'word/footer1.xml');
  assert.match(header, /<w:caps\/><\/w:rPr><w:t xml:space="preserve">Projekt<\/w:t><\/w:r><w:r><w:t xml:space="preserve"> protokołu, posiedzenie z dnia 20\.11\.2026/, 'słowo „Projekt” z nagłówka jest znakiem, bez powtórzenia');
  const other = await docxFromHtml(sample, {title: 'x', header: 'Lista obecności, posiedzenie z dnia 20.11.2026', draft: true, now: NOW, deflateRaw: deflate});
  assert.match(entryText(other, 'word/header1.xml'), /Projekt {3}<\/w:t>.*Lista obecności, posiedzenie z dnia 20\.11\.2026/);
  assert.match(first, />Projekt<\/w:t>/);
  assert.ok(!first.includes('posiedzenie z dnia'), 'pierwsza strona bez nazwy dokumentu w nagłówku');
  assert.match(footer, /Wygenerowano 20\.11\.2026, godz\. 13:00.*Strona .*w:instr=" PAGE ".* z .*w:instr=" NUMPAGES "/);
  const doc = entryText(bytes, 'word/document.xml');
  assert.match(doc, /<w:titlePg\/>/);
  assert.ok(!doc.includes('alert(1)') && !doc.includes('x.png'), 'skrypty i obrazy pominięte');
  const plain = await docxFromHtml('<p>Bez projektu.</p>', {title: 'x', now: NOW});
  assert.ok(!entryText(plain, 'word/header1.xml').includes('Projekt'), 'dokument ustalony bez znaku „Projekt”');
});

test('docx: formatowanie, odnośnik z adresem, listy z numeracją Worda bez znaków w tekście (K4-27, K4-34)', async () => {
  const bytes = await docxFromHtml(sample, {title: 'x', now: NOW});
  const doc = entryText(bytes, 'word/document.xml');
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">pogrubieniem/);
  assert.match(doc, /<w:i\/><\/w:rPr><w:t xml:space="preserve">kursywą/);
  assert.match(doc, /<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">podkreśleniem/);
  assert.match(doc, /<w:strike\/><\/w:rPr><w:t xml:space="preserve">przekreśleniem/);
  assert.match(doc, /<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t xml:space="preserve">2/);
  assert.match(doc, /<w:vertAlign w:val="subscript"\/><\/w:rPr><w:t xml:space="preserve">2/);
  assert.match(doc, /<w:pBdr><w:bottom /, 'linia pozioma');
  assert.match(doc, /<w:pStyle w:val="Cytat"\/>/);
  const text = docxText(bytes);
  assert.ok(text.includes('dokument (https://example.org/dokument) w tekście'), text);
  assert.ok(text.includes('i & znakiem <.'));
  assert.ok(text.includes('Lista obecności. Porządek obrad. Podpunkt. Pierwszy Drugi Trzeci'), 'znaczniki list nie są tekstem');
  const numbering = entryText(bytes, 'word/numbering.xml');
  assert.match(numbering, /w:numFmt w:val="decimal"\/><w:lvlText w:val="%1\."/);
  assert.match(numbering, /w:numFmt w:val="bullet"\/><w:lvlText w:val="–"/, 'półpauza zamiast kropki-kółka');
  assert.match(numbering, /<w:startOverride w:val="3"\/>/, 'atrybut start listy');
  assert.match(doc, /<w:numPr><w:ilvl w:val="1"\/>/, 'lista zagnieżdżona na drugim poziomie');
  assert.match(doc, /<w:pageBreakBefore\/>/, 'załącznik od nowej strony');
});

test('docx: tabela z colspan i rowspan jako gridSpan i vMerge, podpisy bez dzielenia (K4-34, B1-06)', async () => {
  const bytes = await docxFromHtml(sample, {title: 'x', now: NOW});
  const doc = entryText(bytes, 'word/document.xml');
  const budget = doc.slice(doc.indexOf('Pozycja') - 400, doc.indexOf('bez zmian') + 200);
  assert.equal((budget.match(/<w:gridCol /g) ?? []).length, 3, 'siatka trzech kolumn');
  assert.match(budget, /<w:gridSpan w:val="2"\/><\/w:tcPr>.*Kwota/);
  assert.equal((budget.match(/<w:vMerge w:val="restart"\/>/g) ?? []).length, 2, 'dwie komórki scalone w pionie');
  assert.equal((budget.match(/<w:vMerge\/>/g) ?? []).length, 2, 'dwie komórki kontynuacji');
  assert.match(budget, /<w:gridSpan w:val="2"\/><w:vMerge\/>/, 'kontynuacja komórki scalonej w obu kierunkach');
  const rows = budget.split('<w:tr>').slice(1);
  for (const r of rows) {
    const span = [...r.matchAll(/<w:tc>.*?<\/w:tc>/g)].reduce((n, c) => n + Number(/w:gridSpan w:val="(\d+)"/.exec(c[0])?.[1] ?? 1), 0);
    assert.equal(span, 3, 'każdy wiersz zajmuje całą siatkę');
  }
  assert.match(doc, /<w:tblHeader\/>/, 'wiersz nagłówka powtarzany na stronach');
  const signatures = doc.slice(doc.lastIndexOf('<w:tbl>'));
  assert.match(signatures, /<w:cantSplit\/>/);
  assert.match(signatures, /TabelaBezRamek/);
});

test('docx: mammoth czyta plik bez błędów, unzip -t i zipfile Pythona bez błędów (kryterium 7)', async () => {
  const bytes = await docxFromHtml(sample, {title: 'Projekt protokołu', header: 'Projekt protokołu', draft: true, footerLeft: 'Wygenerowano', now: NOW, deflateRaw: deflate});
  const result = await mammoth.convertToHtml({buffer: Buffer.from(bytes)});
  assert.deepEqual(result.messages.filter(m => m.type === 'error'), []);
  assert.ok(result.value.includes('<table>') && result.value.includes('Szkolenia'));
  assert.ok(result.value.includes('<ol>'), 'listy numerowane czytane jako listy');
  const dir = mkdtempSync(join(tmpdir(), 'docx-'));
  try {
    const file = join(dir, 'proba.docx');
    writeFileSync(file, bytes);
    const unzipped = spawnSync('unzip', ['-t', file]);
    if (!unzipped.error) assert.equal(unzipped.status, 0, unzipped.stdout.toString());
    const py = spawnSync('python3', ['-I', '-m', 'zipfile', '-t', file]);
    if (!py.error) assert.equal(py.status, 0, py.stderr.toString());
    // Każda część XML jest poprawnym dokumentem (parser Pythona).
    const xmlCheck = spawnSync('python3', ['-I', '-c', 'import zipfile,sys,xml.dom.minidom as m; z=zipfile.ZipFile(sys.argv[1]); [m.parseString(z.read(n)) for n in z.namelist()]', file]);
    if (!xmlCheck.error) assert.equal(xmlCheck.status, 0, xmlCheck.stderr.toString());
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('parseHtml: encje, atrybuty z cudzysłowem i niedomknięte znaczniki', () => {
  const tree = parseHtml('<p class="a b" title="x > y">A&nbsp;&amp;&#8211;B<br>C</p><div>D');
  assert.equal(textOf(tree), 'A &–BCD');
});
