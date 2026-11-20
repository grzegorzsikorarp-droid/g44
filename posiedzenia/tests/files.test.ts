import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync, inflate} from 'node:zlib';
import {promisify} from 'node:util';
import {acceptAvatar, acceptDisplayFile, acceptFiled, checkPdf, cleanJpeg, cleanPng, cleanWebp, displayName, imageSize, imageTooLarge,
  naturalOrder, refusalByName, refusalFor, REFUSALS, seriesProblem, sniff} from '../src/shared/files.ts';

// Przyjmowanie plików wersji 4 (SPEC-4 5.6, B3-26, K4-25, K4-26; etap D.1 pkt 4 i 8). Pliki budowane w teście, bez
// dekodowania obrazów: moduł czyta tylko nagłówki i segmenty.

const inflateAsync = async (b: Uint8Array) => new Uint8Array(await promisify(inflate)(b));
const enc = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(Buffer.concat(parts.map(p => Buffer.from(p as Uint8Array))));
const has = (b: Uint8Array, s: string) => Buffer.from(b).includes(Buffer.from(s, 'latin1'));
const seg = (marker: number, data: Uint8Array) => cat([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff], data);

function exifWithOrientation(o: number) {
  // TIFF big-endian: IFD z dwoma znacznikami, orientacja i opis „Telefon testowy” (ImageDescription 0x010e).
  const text = enc('Telefon testowy\0');
  const ifd = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 2,
    0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0,
    0x01, 0x0e, 0, 2, 0, 0, 0, text.length, 0, 0, 0, 38,
    0, 0, 0, 0];
  return cat(enc('Exif\0\0'), ifd, text, enc('GPS 54.46N 17.02E'));
}
/** JPEG ze strukturą segmentów (bez prawdziwej kompresji): EXIF z orientacją, XMP, IPTC, komentarz. */
function jpeg(w: number, h: number, o: {orientation?: number; eoi?: boolean} = {}) {
  const sof = [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0];
  return cat([0xff, 0xd8],
    seg(0xe0, enc('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    seg(0xe1, exifWithOrientation(o.orientation ?? 6)),
    seg(0xe1, enc('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:GPSLatitude="54,27N"/></x:xmpmeta>')),
    seg(0xed, enc('Photoshop 3.0\x008BIM IPTC Autor Jan Testowy')),
    seg(0xfe, enc('Komentarz z aparatu')),
    seg(0xdb, new Uint8Array(65)),
    seg(0xc0, Uint8Array.from(sof)),
    seg(0xc4, new Uint8Array(20)),
    seg(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])),
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78],
    o.eoi === false ? [] : [0xff, 0xd9]);
}
const chunk = (type: string, data: Uint8Array) => cat([data.length >>> 24, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], enc(type), data, [0, 0, 0, 0]);
function png(w: number, h: number, extra: string[] = ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']) {
  const ihdr = Uint8Array.from([w >>> 24, (w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff, h >>> 24, (h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff, 8, 2, 0, 0, 0]);
  return cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', ihdr), ...extra.map(t => chunk(t, enc(`${t} Autor Jan Testowy`))),
    chunk('pHYs', new Uint8Array(9)), chunk('IDAT', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])), chunk('IEND', new Uint8Array(0)));
}
const riffChunk = (type: string, data: Uint8Array) => cat(enc(type), [data.length & 0xff, (data.length >> 8) & 0xff, 0, 0], data, data.length & 1 ? [0] : []);
function webp(w: number, h: number, o: {animated?: boolean} = {}) {
  const vp8x = Uint8Array.from([0x08 | 0x04 | (o.animated ? 0x02 : 0), 0, 0, 0, (w - 1) & 0xff, ((w - 1) >> 8) & 0xff, 0, (h - 1) & 0xff, ((h - 1) >> 8) & 0xff, 0]);
  const body = cat(riffChunk('VP8X', vp8x), o.animated ? riffChunk('ANIM', new Uint8Array(6)) : [], riffChunk('VP8L', Uint8Array.from([0x2f, 0, 0, 0, 0])),
    riffChunk('EXIF', enc('Telefon testowy GPS')), riffChunk('XMP ', enc('<x:xmpmeta GPSLatitude="54"/>')));
  const size = body.length + 4;
  return cat(enc('RIFF'), [size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24], enc('WEBP'), body);
}

/** PDF z obiektów (wzór proby-B3/pdf.mjs). */
function pdf(objects: string[], o: {eof?: boolean} = {}) {
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n` + (o.eof === false ? '' : '%%EOF\n');
  return enc(out);
}
function plainPdf(pages: number, extraCatalog = '', extraObjects: string[] = []) {
  const objs = [`<< /Type /Catalog /Pages 2 0 R ${extraCatalog}>>`, '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: string[] = [];
  for (let n = 1; n <= pages; n++) {
    const c = `BT /F1 48 Tf 100 300 Td (STRONA ${n}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    kids.push(`${objs.length - 1} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  return pdf([...objs, ...extraObjects]);
}
/** PDF 1.5 z drzewem stron i (opcjonalnie) akcją w skompresowanym strumieniu obiektów. */
function objStmPdf(pages: number, o: {hidden?: string; filter?: string; broken?: boolean} = {}) {
  const inStm: Record<number, string> = {2: `<< /Type /Pages /Kids [${Array.from({length: pages}, (_, i) => `${4 + i} 0 R`).join(' ')}] /Count ${pages} >>`, 3: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'};
  for (let n = 1; n <= pages; n++) inStm[3 + n] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] >>`;
  if (o.hidden) inStm[3 + pages + 1] = o.hidden;
  const ids = Object.keys(inStm).map(Number);
  let header = '', data = '';
  for (const id of ids) { header += `${id} ${data.length} `; data += inStm[id] + '\n'; }
  const raw = Buffer.from(header + data, 'latin1');
  const body = o.broken ? Buffer.from('to nie jest strumien deflate') : o.filter === '/ASCIIHexDecode' ? Buffer.from(raw.toString('hex') + '>') : deflateSync(raw);
  return pdf(['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /ObjStm /N ${ids.length} /First ${header.length} /Filter ${o.filter ?? '/FlateDecode'} /Length ${body.length} >>\nstream\n${body.toString('latin1')}\nendstream`]);
}

test('sniff rozpoznaje rodzaj z sygnatury, nie z nazwy (B3-26 pkt 1)', () => {
  assert.equal(sniff(jpeg(10, 10)), 'jpeg');
  assert.equal(sniff(png(10, 10)), 'png');
  assert.equal(sniff(webp(10, 10)), 'webp');
  assert.equal(sniff(plainPdf(1)), 'pdf');
  assert.equal(sniff(cat([0, 0, 0, 0x18], enc('ftypmp42'), new Uint8Array(16))), 'mp4');
  assert.equal(sniff(cat([0, 0, 0, 0x18], enc('ftypheic'), new Uint8Array(16))), 'heic');
  assert.equal(sniff(cat(enc('PK\x03\x04'), enc('....ppt/presentation.xml....'))), 'pptx');
  assert.equal(sniff(cat(enc('PK\x03\x04'), enc('....word/document.xml....'))), 'docx');
  assert.equal(sniff(enc('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>')), 'svg');
  assert.equal(sniff(enc('<!doctype html><html></html>')), 'html');
  assert.equal(sniff(enc('GIF89a....')), 'gif');
  assert.equal(sniff(new Uint8Array(0)), null);
  assert.equal(sniff(enc('Zwykły tekst materiału.\n')), 'text');
});

test('refusalFor i refusalByName dają brzmienia z B3-05 bez dwukropków', () => {
  assert.equal(refusalFor('pptx', 'prezentacja.pptx'), REFUSALS.powerpoint);
  assert.equal(refusalFor(null, 'slajdy.key'), REFUSALS.presentation);
  assert.equal(refusalFor('docx', 'projekt.docx'), REFUSALS.word);
  assert.equal(refusalFor('svg', 'wykres.svg'), REFUSALS.svg);
  assert.equal(refusalFor('gif', 'a.gif'), REFUSALS.animated);
  assert.equal(refusalFor('heic', 'IMG_0001.HEIC'), REFUSALS.heic);
  assert.equal(refusalFor('html', 'strona.html'), REFUSALS.other);
  assert.equal(refusalByName('slajd.PNG'), null);
  assert.equal(refusalByName('prezentacja.ppsx'), REFUSALS.powerpoint);
  for (const text of Object.values(REFUSALS)) assert.ok(!/:\s/.test(text) && !text.includes('—'), text);
});

test('imageSize czyta wymiary z IHDR, SOF i VP8X; obraz 30000 × 30000 px odrzucony przed dekodowaniem (K4-26)', async () => {
  assert.deepEqual(imageSize(png(1920, 1080)), {width: 1920, height: 1080});
  assert.deepEqual(imageSize(jpeg(800, 600)), {width: 800, height: 600});
  assert.deepEqual(imageSize(webp(640, 480)), {width: 640, height: 480});
  assert.equal(imageTooLarge({width: 8000, height: 5000}), null);
  assert.equal(imageTooLarge({width: 8001, height: 10}), REFUSALS.imageTooLarge);
  assert.equal(imageTooLarge({width: 7000, height: 7000}), REFUSALS.imageTooLarge, 'ponad 40 Mpx');
  for (const big of [png(30000, 30000, []), jpeg(30000, 30000), webp(9000, 100)]) {
    await assert.rejects(acceptDisplayFile(big, 'duzy', {inflate: inflateAsync}), (e: Error & {status?: number}) => e.message === REFUSALS.imageTooLarge && e.status === 400);
  }
});

test('cleanJpeg usuwa EXIF, XMP, IPTC i komentarz, zachowuje orientację; uszkodzony plik odrzucony', () => {
  const src = jpeg(1200, 800);
  assert.ok(has(src, 'Telefon testowy') && has(src, 'GPSLatitude') && has(src, 'Komentarz') && has(src, 'Jan Testowy'));
  const c = cleanJpeg(src);
  assert.deepEqual([c.width, c.height, c.orientation], [1200, 800, 6]);
  assert.deepEqual(c.removed.sort(), ['APP1', 'APP1', 'APP13', 'COM']);
  for (const s of ['Telefon testowy', 'GPS', 'GPSLatitude', 'Komentarz', 'Jan Testowy']) assert.ok(!has(c.bytes, s), s);
  assert.ok(has(c.bytes, 'JFIF'));
  assert.ok(has(c.bytes, 'Exif\0\0'), 'segment z samą orientacją');
  assert.equal(cleanJpeg(c.bytes).orientation, 6, 'oczyszczony plik ma orientację 6');
  assert.deepEqual(Array.from(c.bytes.slice(-2)), [0xff, 0xd9]);
  assert.throws(() => cleanJpeg(jpeg(10, 10, {eoi: false})), {message: REFUSALS.damaged});
  assert.throws(() => cleanJpeg(cat([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40], enc('JFIF'))), {message: REFUSALS.damaged});
  assert.equal(cleanJpeg(jpeg(10, 10, {orientation: 1})).orientation, 1);
  assert.ok(!has(cleanJpeg(jpeg(10, 10, {orientation: 1})).bytes, 'Exif'), 'bez obrotu nie ma segmentu EXIF');
});

test('cleanPng usuwa tEXt, iTXt, zTXt, eXIf, tIME; IDAT bez zmian bajt w bajt', () => {
  const src = png(300, 200);
  const c = cleanPng(src);
  assert.deepEqual(c.removed, ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);
  assert.ok(!has(c.bytes, 'Jan Testowy'));
  const idat = (b: Uint8Array) => { const i = Buffer.from(b).indexOf('IDAT'); return Buffer.from(b).subarray(i - 4, i + 4 + 9 + 4).toString('hex'); };
  assert.equal(idat(c.bytes), idat(src));
  assert.deepEqual([c.width, c.height], [300, 200]);
  assert.throws(() => cleanPng(src.subarray(0, src.length - 12)), {message: REFUSALS.damaged});
});

test('cleanWebp usuwa EXIF i XMP, czyści flagi VP8X, odrzuca animację', () => {
  const c = cleanWebp(webp(640, 480));
  assert.deepEqual(c.removed, ['EXIF', 'XMP']);
  assert.ok(!has(c.bytes, 'Telefon testowy') && !has(c.bytes, 'GPSLatitude'));
  const flags = c.bytes[20];
  assert.equal(flags & 0x0c, 0);
  assert.equal(c.bytes.length - 8, c.bytes[4] | (c.bytes[5] << 8) | (c.bytes[6] << 16) | (c.bytes[7] << 24), 'rozmiar RIFF po zmianie');
  assert.throws(() => cleanWebp(webp(10, 10, {animated: true})), {message: REFUSALS.animated});
});

test('checkPdf: czysty, strumień obiektów, skrypty, #xx, /Launch, /EmbeddedFile, /Encrypt, nietypowy filtr, brak %%EOF', async () => {
  const check = (b: Uint8Array) => checkPdf(b, {inflate: inflateAsync});
  assert.deepEqual(await check(plainPdf(12)), {ok: true, pages: 12});
  assert.deepEqual(await check(objStmPdf(3)), {ok: true, pages: 3}, 'liczba stron ze strumienia obiektów');
  const js = await check(plainPdf(1, '/OpenAction 6 0 R ', [`<< /S /JavaScript /JS (app.alert\\('x'\\)) >>`]));
  assert.deepEqual(js.ok ? null : [js.reason, js.found], [REFUSALS.pdfScript, ['JavaScript', 'JS']]);
  const response = await check(plainPdf(1, '/OpenAction 6 0 R ', [`<< /S /JavaScript /JS (app.response\\(\\)) >>`]));
  assert.equal(response.ok, false);
  const hex = await check(plainPdf(1, '/OpenAction 6 0 R ', ['<< /S /J#61vaScript /J#53 (x) >>']));
  assert.equal(hex.ok ? '' : hex.reason, REFUSALS.pdfScript, 'nazwa zapisana kodami #xx');
  const hidden = await check(objStmPdf(2, {hidden: '<< /S /JavaScript /JS (app.alert(1)) >>'}));
  assert.equal(hidden.ok ? '' : hidden.reason, REFUSALS.pdfScript, 'skrypt w skompresowanym strumieniu obiektów');
  for (const extra of ['<< /S /Launch /F (cmd.exe) >>', '<< /Type /EmbeddedFile /Length 0 >>', '<< /S /SubmitForm /F (http://x) >>', '<< /XFA 9 0 R >>', '<< /RichMedia 1 >>', '<< /S /ImportData >>']) {
    const r = await check(plainPdf(1, '', [extra]));
    assert.equal(r.ok ? '' : r.reason, REFUSALS.pdfScript, extra);
  }
  const encrypted = await check(enc(new TextDecoder('latin1').decode(plainPdf(1)).replace('/Root 1 0 R', '/Root 1 0 R /Encrypt 9 0 R')));
  assert.equal(encrypted.ok ? '' : encrypted.reason, REFUSALS.pdfEncrypted);
  const odd = await check(objStmPdf(2, {filter: '/ASCIIHexDecode'}));
  assert.equal(odd.ok ? '' : odd.reason, REFUSALS.pdfOdd);
  const broken = await check(objStmPdf(2, {broken: true}));
  assert.equal(broken.ok ? '' : broken.reason, REFUSALS.pdfOdd);
  const noEof = await check(plainPdf(1).subarray(0, -6));
  assert.equal(noEof.ok ? '' : noEof.reason, REFUSALS.pdfIncomplete);
  const notPdf = await check(png(10, 10));
  assert.equal(notPdf.ok ? '' : notPdf.reason, REFUSALS.notPdf);
});

test('acceptDisplayFile: limity, rodzaje, czyszczenie; MP4 i PPTX odrzucone w rdzeniu (B3-04–B3-06, G-34)', async () => {
  const o = {inflate: inflateAsync};
  const okPdf = await acceptDisplayFile(plainPdf(3), 'budzet.pdf', o);
  assert.deepEqual([okPdf.type, okPdf.pages], ['pdf', 3]);
  const img = await acceptDisplayFile(jpeg(1920, 1080), 'slajd1.jpg', o);
  assert.deepEqual([img.type, img.width, img.height], ['jpeg', 1920, 1080]);
  assert.ok(!has(img.bytes, 'GPS'));
  await assert.rejects(acceptDisplayFile(cat(enc('PK\x03\x04'), enc('ppt/presentation.xml')), 'a.pptx', o), (e: Error & {status?: number}) => e.message === REFUSALS.powerpoint && e.status === 415);
  await assert.rejects(acceptDisplayFile(cat([0, 0, 0, 0x18], enc('ftypmp42'), new Uint8Array(16)), 'film.mp4', o), {message: REFUSALS.other});
  await assert.rejects(acceptDisplayFile(plainPdf(1, '/OpenAction 6 0 R ', ['<< /S /JavaScript /JS (x) >>']), 'skrypt.pdf', o), {message: REFUSALS.pdfScript});
  const big = cat(plainPdf(1), new Uint8Array(10 * 1024 * 1024));
  await assert.rejects(acceptDisplayFile(big, 'duzy.pdf', o), (e: Error & {status?: number}) => e.message === REFUSALS.tooBig && e.status === 413);
  assert.equal(seriesProblem(Array.from({length: 61}, () => ({size: 1}))), REFUSALS.series);
  assert.equal(seriesProblem([{size: 31 * 1024 * 1024}]), REFUSALS.series);
  assert.equal(seriesProblem(Array.from({length: 60}, () => ({size: 500_000}))), null);
  assert.deepEqual(naturalOrder(['slajd10.png', 'slajd2.png', 'Slajd1.png']), ['Slajd1.png', 'slajd2.png', 'slajd10.png']);
});

test('dokument dołączony po posiedzeniu: tylko sygnatura i rozmiar, bez kontroli treści PDF (K4-25)', () => {
  // PDF z akcją (np. podpis kwalifikowany z formularzem) nie dostaje odmowy: plik wydaje się tylko jako załącznik.
  assert.equal(acceptFiled(plainPdf(1, '/OpenAction 6 0 R ', ['<< /S /JavaScript /JS (x) >>'])).mime, 'application/pdf');
  assert.equal(acceptFiled(cat(enc('PK\x03\x04'), enc('word/document.xml'))).ext, 'docx');
  assert.equal(acceptFiled(jpeg(10, 10)).mime, 'image/jpeg');
  assert.equal(acceptFiled(png(10, 10)).mime, 'image/png');
  assert.throws(() => acceptFiled(webp(10, 10)), {message: REFUSALS.filed});
  assert.throws(() => acceptFiled(enc('<html></html>')), {message: REFUSALS.filed});
  assert.throws(() => acceptFiled(cat(plainPdf(1), new Uint8Array(10 * 1024 * 1024))), (e: Error & {status?: number}) => e.status === 413);
});

test('zdjęcie profilowe: tylko JPEG, kwadrat 256–1024 px, do 400 KB, metadane usunięte (G-35)', () => {
  const ok = acceptAvatar(jpeg(512, 512));
  assert.deepEqual([ok.width, ok.height], [512, 512]);
  assert.ok(!has(ok.bytes, 'GPS') && !has(ok.bytes, 'Komentarz'));
  assert.throws(() => acceptAvatar(png(512, 512)), {message: REFUSALS.avatarType});
  assert.throws(() => acceptAvatar(jpeg(512, 400)), {message: REFUSALS.avatarSquare});
  assert.throws(() => acceptAvatar(jpeg(2000, 2000)), {message: REFUSALS.avatarBig});
  assert.throws(() => acceptAvatar(cat(jpeg(512, 512).subarray(0, -2), new Uint8Array(410 * 1024), [0xff, 0xd9])), {message: REFUSALS.avatarBig});
  assert.throws(() => acceptAvatar(jpeg(512, 512, {eoi: false})), {message: REFUSALS.damaged});
  assert.equal(displayName('../../dziwna\u0000/nazwa.pdf'), '....dziwnanazwa.pdf');
});
