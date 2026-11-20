import {asciiSlug} from './text.ts';

// Zapis ZIP wspólny dla serwera i wersji próbnej (SPEC-4 5.5, B1-10, K4-15). Bez zależności: CRC-32 z tablicy w JS
// (serwer może podać `zlib.crc32`, wynik ten sam), kompresja wstrzykiwana (serwer asynchroniczny `zlib.deflateRaw`,
// przeglądarka `CompressionStream('deflate-raw')`). Nazwy w UTF-8 (flaga 0x0800), bez ZIP64 (teczka ma limit 100 MB).
// Ten sam moduł składa pliki .docx i teczkę posiedzenia. Wzór: /home/user/przeglad/v4-projekt/proby-B1/zip.mjs.

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const enc = new TextEncoder();
const u8 = (d: Uint8Array | string) => typeof d === 'string' ? enc.encode(d) : d;
/** Data i godzina w formacie DOS (ZIP nie zna stref; czas lokalny procesu). */
function dosTime(date: Date): [number, number] {
  const t = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [t & 0xffff, d & 0xffff];
}

export interface ZipEntry { name: string; data: Uint8Array | string; date?: Date }
export interface ZipOptions { deflateRaw?: (b: Uint8Array) => Uint8Array | Promise<Uint8Array>; crc?: (b: Uint8Array) => number; now?: Date }

/** Bezpieczna ścieżka wpisu: bez ścieżki bezwzględnej, `..`, `\` i `:` (K4-15). */
export function entryPathProblem(name: string): string | null {
  if (!name || name.startsWith('/') || name.includes('\\') || name.includes(':') || name.split('/').some(part => part === '..' || part === '.' || part === '')) return `Niedozwolona nazwa wpisu „${name}”.`;
  return null;
}

/** Archiwum ZIP. Plik zostaje bez kompresji, gdy kompresja nic nie daje albo nie podano funkcji kompresji. */
export async function zip(files: ZipEntry[], o: ZipOptions = {}): Promise<Uint8Array> {
  const crc = o.crc ?? crc32, now = o.now ?? new Date();
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const problem = entryPathProblem(f.name);
    if (problem) throw new Error(problem);
    const name = enc.encode(f.name), data = u8(f.data), sum = crc(data) >>> 0;
    let body = data, method = 0;
    if (o.deflateRaw && data.length > 64) {
      const packed = u8(await o.deflateRaw(data));
      if (packed.length < data.length) { body = packed; method = 8; }
    }
    const [time, date] = dosTime(f.date ?? now);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, method, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, sum, true); local.setUint32(18, body.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, method, true); c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, sum, true); c.setUint32(20, body.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const size = central.reduce((n, x) => n + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of all) { out.set(x, at); at += x.length; }
  return out;
}
/** Kompresja w przeglądarce (wersja próbna). */
export async function browserDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Rozszerzenia wpisów teczki: z rozpoznanego rodzaju pliku albo z formatu wygenerowanego, nigdy z nazwy wgranego pliku. */
export type EntryExt = 'pdf' | 'docx' | 'jpg' | 'png' | 'webp' | 'mp4' | 'txt' | 'md' | 'html' | 'csv';
/**
 * Nazwa wpisu teczki (K4-15): ta sama zamiana na ASCII co nazwy plików (B1-07), do 60 znaków, zawsze z numerem
 * porządkowym albo numerem punktu na początku (więc nazwy zastrzeżone w Windows, np. `con`, `nul`, `com1`, nie mogą
 * wystąpić), przy powtórzeniu z dopiskiem `-2`, `-3`, z rozszerzeniem z listy. `used` zbiera nazwy już użyte.
 */
export function safeEntryName(text: string, used: Set<string>, o: {prefix: string | number; ext: EntryExt; dir?: string}): string {
  const prefix = asciiSlug(String(o.prefix).replace(/\./g, '-'), 12) || '0';
  const dir = (o.dir ?? '').split('/').map(part => asciiSlug(part, 60)).filter(Boolean).join('/');
  const base = `${prefix}-${asciiSlug(text, 60) || 'plik'}`;
  const full = (suffix: string) => `${dir ? dir + '/' : ''}${base}${suffix}.${o.ext}`;
  let name = full(''), n = 1;
  while (used.has(name)) name = full(`-${++n}`);
  used.add(name);
  return name;
}
