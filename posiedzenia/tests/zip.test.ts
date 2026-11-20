import {test} from 'node:test';
import assert from 'node:assert/strict';
import {crc32 as nodeCrc, deflateRaw} from 'node:zlib';
import {promisify} from 'node:util';
import {crc32, entryPathProblem, safeEntryName, zip} from '../src/shared/zip.ts';
import {asciiSlug} from '../src/shared/text.ts';
import {unzip} from './docx-text.ts';

// ZIP wspólny dla serwera i wersji próbnej (SPEC-4 5.5, B1-10) i nazwy wpisów teczki (K4-15).

const deflate = async (b: Uint8Array) => new Uint8Array(await promisify(deflateRaw)(b));

test('crc32 z tablicy w JS daje ten sam wynik co zlib.crc32', () => {
  for (const s of ['', 'a', 'Zażółć gęślą jaźń', 'x'.repeat(10000)]) {
    const b = new TextEncoder().encode(s);
    assert.equal(crc32(b), nodeCrc(b) >>> 0, s.slice(0, 20));
  }
});

test('zip: nazwy UTF-8, kompresja tylko gdy pomaga, odczyt innym czytnikiem', async () => {
  const text = 'Porządek obrad. '.repeat(200);
  const bytes = await zip([
    {name: 'teczka/SPIS.txt', data: text},
    {name: 'teczka/01-mały.txt', data: 'abc'},
    {name: 'teczka/02-obraz.bin', data: new Uint8Array([1, 2, 3, 4])},
  ], {deflateRaw: deflate, now: new Date(2026, 10, 20, 12, 30)});
  const entries = unzip(bytes);
  assert.deepEqual(entries.map(e => e.name), ['teczka/SPIS.txt', 'teczka/01-mały.txt', 'teczka/02-obraz.bin']);
  assert.deepEqual(entries.map(e => e.method), [8, 0, 0], 'kompresja dużego tekstu, małe pliki bez kompresji');
  assert.equal(Buffer.from(entries[0].data).toString('utf8'), text);
  for (const e of entries) assert.equal(e.crc, crc32(e.data));
  // Flaga UTF-8 (0x0800) w nagłówku lokalnym.
  assert.equal(Buffer.from(bytes).readUInt16LE(6) & 0x0800, 0x0800);
  const plain = await zip([{name: 'a.txt', data: text}]);
  assert.equal(unzip(plain)[0].method, 0, 'bez funkcji kompresji pliki bez kompresji');
});

test('zip odrzuca niebezpieczne ścieżki wpisów (K4-15)', async () => {
  for (const bad of ['../x.txt', '/etc/passwd', 'a\\b.txt', 'C:x.txt', 'a//b.txt', 'a/./b.txt']) {
    assert.ok(entryPathProblem(bad), bad);
    await assert.rejects(zip([{name: bad, data: 'x'}]), bad);
  }
  assert.equal(entryPathProblem('06-materialy/4-1-projekt.pdf'), null);
});

test('safeEntryName: ASCII, numer na początku, bez nazw zastrzeżonych, dopiski przy powtórzeniu, rozszerzenie z rodzaju (K4-15)', () => {
  const used = new Set<string>();
  const a = safeEntryName('../../CON.html', used, {prefix: '4.1', ext: 'pdf', dir: '11-pokazane'});
  const b = safeEntryName('Projekt budżetu na 2027 rok', used, {prefix: 5, ext: 'docx', dir: '06-materialy'});
  const c = safeEntryName('Projekt budżetu na 2027 rok', used, {prefix: 5, ext: 'docx', dir: '06-materialy'});
  const d = safeEntryName('Projekt budżetu na 2027 rok', used, {prefix: 5, ext: 'docx', dir: '06-materialy'});
  const e = safeEntryName('nul', used, {prefix: 1, ext: 'txt'});
  const f = safeEntryName('???', used, {prefix: 2, ext: 'md'});
  assert.deepEqual([a, b, c, d, e, f], [
    '11-pokazane/4-1-con-html.pdf',
    '06-materialy/5-projekt-budzetu-na-2027-rok.docx',
    '06-materialy/5-projekt-budzetu-na-2027-rok-2.docx',
    '06-materialy/5-projekt-budzetu-na-2027-rok-3.docx',
    '1-nul.txt',
    '2-plik.md',
  ]);
  for (const name of [a, b, c, d, e, f]) {
    assert.equal(entryPathProblem(name), null, name);
    const file = name.split('/').pop()!.replace(/\.[a-z]+$/, '');
    assert.ok(!/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(file), name);
    assert.ok(/^[a-z0-9-]+(\/[a-z0-9-]+)*\.[a-z]+$/.test(name), name);
  }
  assert.ok(safeEntryName('x'.repeat(200), used, {prefix: 3, ext: 'pdf'}).length <= 3 + 1 + 60 + 4);
  assert.equal(asciiSlug('Uchwała nr 108/IX/2026 w sprawie Łodzi'), 'uchwala-nr-108-ix-2026-w-sprawie-lodzi');
});
