import {tokens} from '../../brand/tokens/tokens.ts';
import {sha256} from '../shared/sha256.ts';
import {bytesToHex} from '../shared/blind.ts';
import type {BuiltinKind} from './seed.ts';
import {SLIDE_SIZE} from './seed.ts';

// Pliki wbudowane wersji próbnej (SPEC-4 7.1–7.3): przykładowe slajdy rysowane przy starcie na `canvas` i przykładowe
// pliki PDF budowane w kodzie. Bez twarzy i bez danych prawdziwych osób, kolory z brand/tokens/tokens.ts. Bajty żyją
// w pamięci karty (nigdy w `localStorage`) i powstają przy każdym wczytaniu strony tak samo.

const k = tokens.kolory.jasny;
const rgb = (hex: string) => [1, 3, 5].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');

// --- PDF: Helvetica z kodowaniem WinAnsi i różnicami dla polskich liter (ą, ć, ę, ł, ń, ś, ź, ż; ó jest w WinAnsi).
const POLISH: [string, number, string][] = [
  ['ą', 0x80, 'aogonek'], ['ć', 0x81, 'cacute'], ['ę', 0x82, 'eogonek'], ['ł', 0x83, 'lslash'], ['ń', 0x84, 'nacute'], ['ś', 0x85, 'sacute'], ['ź', 0x86, 'zacute'], ['ż', 0x87, 'zdotaccent'],
  ['Ą', 0x88, 'Aogonek'], ['Ć', 0x89, 'Cacute'], ['Ę', 0x8a, 'Eogonek'], ['Ł', 0x8b, 'Lslash'], ['Ń', 0x8c, 'Nacute'], ['Ś', 0x8d, 'Sacute'], ['Ź', 0x8e, 'Zacute'], ['Ż', 0x8f, 'Zdotaccent'],
];
const winAnsi = (text: string) => [...text].map(ch => {
  const pl = POLISH.find(p => p[0] === ch);
  if (pl) return String.fromCharCode(pl[1]);
  if (ch === 'ó') return '\xf3';
  if (ch === 'Ó') return '\xd3';
  if (ch === '–') return '\x96';
  if (ch === '„' || ch === '”') return '"';
  return ch.charCodeAt(0) < 128 ? ch : '?';
}).join('').replace(/[()\\]/g, m => '\\' + m);
const latin1 = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0) & 0xff);

/** PDF ze stronami A4 poziomymi; każda strona to lista wierszy [rozmiar, tekst]. */
export function pdfDocument(pages: [number, string][][]): Uint8Array {
  const diff = POLISH.map(([, code, name]) => `${code} /${name}`).join(' ');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '', `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences [${diff}] >> >>`];
  const kids: string[] = [];
  for (const lines of pages) {
    let y = 470;
    const text = lines.map(([size, line]) => { const out = `BT /F1 ${size} Tf 90 ${y} Td (${winAnsi(line)}) Tj ET`; y -= size * 1.6; return out; }).join(' ');
    // Pasek 6 pt z lewej (czerwień) i tekst w kolorze tekstu z tokenów.
    const content = `${rgb(k.czerwien)} rg 60 60 6 475 re f ${rgb(k.tekst)} rg ${text}`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(`${objs.length - 1} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}

const samplePdf = () => pdfDocument([1, 2, 3].map(n => [[34, `Przykładowy dokument, strona ${n}`], [18, `Strona ${n} z 3. Dane fikcyjne wersji próbnej.`], [14, 'Ten plik powstał w kodzie wersji próbnej, bez danych prawdziwych osób.']]));
const minutesPdf = (day: string) => pdfDocument([[[30, 'Protokół posiedzenia Prezydium'], [20, `z dnia ${day} (dane fikcyjne)`], [14, 'Przykładowy plik protokołu w wersji próbnej. Treść protokołu jest w dokumentach posiedzenia.']]]);

/** Slajd 16:9 rysowany na `canvas` z kolorów tokenów (bez twarzy i zdjęć). */
function slide(n: number): Uint8Array {
  const c = document.createElement('canvas');
  c.width = SLIDE_SIZE.width; c.height = SLIDE_SIZE.height;
  const g = c.getContext('2d');
  if (!g) return new Uint8Array(0);
  g.fillStyle = k['powierzchnia-miekka']; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = k.czerwien; g.fillRect(0, 0, 24, c.height);
  // Wzór z pasów w kolorach z tokenów, w innym miejscu na każdym slajdzie.
  const colors = [k['grafit-700'], k.linia, k.czerwien];
  for (let i = 0; i < 6; i++) { g.fillStyle = colors[(i + n) % colors.length]; g.fillRect(760 + i * 70, 120 + ((i * 53 + n * 97) % 260), 46, 240); }
  g.fillStyle = k.tekst;
  g.font = 'italic 300 64px "Titillium Web", Arial, sans-serif';
  g.fillText('Przykładowa prezentacja', 96, 300);
  g.font = 'bold 44px "Titillium Web", Arial, sans-serif';
  g.fillText(`Slajd ${n} z 3`, 96, 380);
  g.font = '28px "Titillium Web", Arial, sans-serif';
  g.fillStyle = k['tekst-drugorzedny'];
  g.fillText('Dane fikcyjne wersji próbnej', 96, 460);
  const url = c.toDataURL('image/png');
  const bin = atob(url.slice(url.indexOf(',') + 1));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
}

export function builtinBytes(kind: BuiltinKind): Uint8Array {
  switch (kind) {
    case 'slajd-1': return slide(1);
    case 'slajd-2': return slide(2);
    case 'slajd-3': return slide(3);
    case 'pdf-pokaz': return samplePdf();
    case 'pdf-protokol-1': return minutesPdf('12.03.2026');
    case 'pdf-protokol-2': return minutesPdf('15.04.2026');
  }
}
export const sha256Hex = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

/** Kompresja ZIP i Worda w przeglądarce (`CompressionStream('deflate-raw')`, 7.3). */
export async function browserDeflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Rozpakowanie strumieni PDF do kontroli pliku (`DecompressionStream('deflate')`, 7.3). */
export async function browserInflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
