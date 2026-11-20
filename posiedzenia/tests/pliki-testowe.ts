// Pliki budowane w testach API wersji 4 (wzór tests/files.test.ts): JPEG i PNG ze strukturą segmentów bez prawdziwej
// kompresji oraz prosty PDF z drzewem stron. Moduły aplikacji czytają tylko nagłówki i segmenty, więc to wystarcza.

const enc = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(Buffer.concat(parts.map(p => Buffer.from(p as Uint8Array))));
const seg = (marker: number, data: Uint8Array) => cat([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff], data);

/** JPEG z komentarzem i EXIF (metadane do usunięcia). */
export function jpeg(w: number, h: number) {
  const sof = [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 1, 1, 0x11, 0];
  return cat([0xff, 0xd8], seg(0xe0, enc('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, enc('Exif\0\0MM\0\x2a\0\0\0\x08\0\0GPS 54.46N')),
    seg(0xfe, enc('Komentarz z aparatu')), seg(0xdb, new Uint8Array(65)), seg(0xc0, Uint8Array.from(sof)), seg(0xc4, new Uint8Array(20)),
    seg(0xda, Uint8Array.from([1, 1, 0, 0, 0x3f, 0])), [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78], [0xff, 0xd9]);
}
const chunk = (type: string, data: Uint8Array) => cat([data.length >>> 24, (data.length >> 16) & 0xff, (data.length >> 8) & 0xff, data.length & 0xff], enc(type), data, [0, 0, 0, 0]);
export function png(w: number, h: number) {
  const ihdr = Uint8Array.from([w >>> 24, (w >> 16) & 0xff, (w >> 8) & 0xff, w & 0xff, h >>> 24, (h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff, 8, 2, 0, 0, 0]);
  return cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], chunk('IHDR', ihdr), chunk('tEXt', enc('Author Jan Testowy')), chunk('IDAT', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])), chunk('IEND', new Uint8Array(0)));
}
/** PDF z `pages` stronami; `extraCatalog` pozwala dopisać np. akcję /OpenAction (plik do odrzucenia). */
export function plainPdf(pages: number, extraCatalog = '') {
  const objs = [`<< /Type /Catalog /Pages 2 0 R ${extraCatalog}>>`, '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids: string[] = [];
  for (let n = 1; n <= pages; n++) {
    const c = `BT /F1 48 Tf 100 300 Td (STRONA ${n}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objs.length + 2} 0 R >>`);
    objs.push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`);
    kids.push(`${objs.length - 1} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(x => String(x).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(out);
}
/** Formularz z plikami (multipart) do tras z przesyłaniem. */
export function form(files: [string, Uint8Array, string][], fields: Record<string, string> = {}) {
  const f = new FormData();
  for (const [name, bytes, type] of files) f.append('file', new File([new Uint8Array(bytes)], name, {type}));
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
