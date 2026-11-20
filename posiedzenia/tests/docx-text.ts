import {inflateRawSync} from 'node:zlib';

// Pomocnik testów (wersja 4): odczyt archiwum ZIP i tekstu treści pliku .docx. Tekst liczy się tak samo jak tekst HTML
// we wzorcach starych protokołów (tests/wzorce.ts, `htmlText`): granica fragmentu, akapitu, komórki i podziału wiersza
// to odstęp, a białe znaki są ujednolicone do jednej spacji.

export interface UnzippedEntry { name: string; data: Uint8Array; method: number; crc: number }
/** Wpisy archiwum z katalogu centralnego (bez ZIP64, metody 0 i 8). */
export function unzip(bytes: Uint8Array): UnzippedEntry[] {
  const b = Buffer.from(bytes);
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('To nie jest archiwum ZIP.');
  const count = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  const out: UnzippedEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('Uszkodzony katalog centralny.');
    const method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), size = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + size);
    out.push({name, method, crc, data: new Uint8Array(method === 8 ? inflateRawSync(raw) : raw)});
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
export const entryText = (bytes: Uint8Array, name: string) => {
  const e = unzip(bytes).find(x => x.name === name);
  if (!e) throw new Error(`Brak wpisu ${name}.`);
  return Buffer.from(e.data).toString('utf8');
};
const decodeXml = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_m, e: string) => ({lt: '<', gt: '>', quot: '"', apos: "'", amp: '&'})[e]!);
/** Tekst treści z word/document.xml (bez nagłówka i stopki). */
export function docxText(bytes: Uint8Array, part = 'word/document.xml'): string {
  const xml = entryText(bytes, part);
  let out = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<\/w:r>|<\/w:p>|<w:br\/>|<w:tab\/>/g)) out += m[1] !== undefined ? decodeXml(m[1]) : ' ';
  return out.replace(/\s+/g, ' ').trim();
}
