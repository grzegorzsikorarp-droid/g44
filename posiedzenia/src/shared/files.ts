// Przyjmowanie plików wersji 4 (SPEC-4 5.6, DB-26, B3-26, K4-25, K4-26). Jeden moduł na `Uint8Array`, więc serwer
// i wersja próbna sprawdzają to samo: rodzaj tylko z sygnatury, wymiary obrazu z nagłówka przed jakimkolwiek dekodowaniem,
// czyszczenie metadanych JPEG, PNG i WebP z zachowaniem orientacji, kontrola PDF z wstrzykiwanym asynchronicznym
// rozpakowaniem (serwer `zlib.inflate`, przeglądarka `DecompressionStream('deflate')`). Dotyczy plików do pokazania,
// nowych materiałów PDF, plików zgłoszeń i zdjęć profilowych. Dokumenty dołączone po posiedzeniu przechodzą tylko
// sygnaturę i rozmiar (`acceptFiled`), bo podpisany protokół z podpisem kwalifikowanym nie może dostać odmowy.
// Wzory: /home/user/przeglad/v4-projekt/proby-B3/obrazy.mjs i pdf-sprawdz.mjs.

/** Rodzaj z sygnatury. Rodzaje spoza listy dozwolonej rozpoznaje się, żeby odmowa mówiła, co zrobić (B3-05). */
export type Sniffed = 'jpeg' | 'png' | 'webp' | 'pdf' | 'mp4' | 'heic' | 'iso' | 'pptx' | 'docx' | 'zip' | 'svg' | 'html' | 'gif' | 'text';

/** Stałe techniczne (B3-06, rozdz. 3.3 SPEC-4), nie ustawienia. */
export const SHOW_LIMITS = {fileBytes: 10 * 1024 * 1024, seriesCount: 60, seriesBytes: 30 * 1024 * 1024, videoBytes: 25 * 1024 * 1024, descriptionChars: 2000} as const;
/** Granice obrazu przed dekodowaniem (K4-26): najwyżej 8000 px boku i 40 Mpx. */
export const IMAGE_LIMITS = {side: 8000, pixels: 40_000_000} as const;
/** Zdjęcie profilowe (B3-33, G-35): JPEG, kwadrat 256–1024 px, do 400 KB. */
export const AVATAR_LIMITS = {min: 256, max: 1024, bytes: 400 * 1024} as const;
/** Dokument dołączony po posiedzeniu i plik zgłoszenia: do 10 MB. */
export const FILED_BYTES = 10 * 1024 * 1024;

const fail = (message: string, status: number): never => { throw Object.assign(new Error(message), {status}); };

/** Tekst bajtów jako ISO-8859-1 (jeden znak na bajt), do szukania znaczników w plikach. */
export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  for (let i = start; i < end; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192)));
  return out;
}
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};

/** Rodzaj pliku z sygnatury (B3-26 pkt 1). Rozszerzenie i typ podany przez przeglądarkę nie decydują. */
export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'png';
  const head = latin1(b, 0, Math.min(b.length, 512));
  if (b.length >= 12 && head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if (head.startsWith('%PDF-')) return 'pdf';
  if (b.length >= 12 && head.slice(4, 8) === 'ftyp') {
    const brand = head.slice(8, 12);
    if (/^(isom|iso2|mp41|mp42|avc1|M4V )$/.test(brand)) return 'mp4';
    return /^(heic|heix|heim|heis|mif1|msf1|hevc)$/.test(brand) ? 'heic' : 'iso';
  }
  if (head.startsWith('PK\x03\x04')) {
    const all = latin1(b);
    return all.includes('ppt/presentation.xml') ? 'pptx' : all.includes('word/document.xml') ? 'docx' : 'zip';
  }
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif';
  if (/^\s*(<\?xml[\s\S]*)?<svg/i.test(head)) return 'svg';
  if (/^\s*(<\?xml|<!doctype|<html|<head|<body|<script)/i.test(head)) return 'html';
  if (b.length && !Array.from(b.subarray(0, 512)).some(x => x === 0 || (x < 9) || (x > 13 && x < 32 && x !== 27))) return 'text';
  return null;
}

/** Rozszerzenie z nazwy pliku (do szybkiej odmowy w przeglądarce i wyboru komunikatu), bez kropki, małymi literami. */
export const extOf = (name: string) => /\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1].toLowerCase() ?? '';

/** Komunikaty odmowy z B3-05 (dosłownie). */
export const REFUSALS = {
  powerpoint: 'Prezentacji PowerPoint aplikacja nie wyświetli. W programie PowerPoint wybierz kolejno Plik, Eksportuj, Utwórz dokument PDF/XPS i dodaj plik PDF. Na telefonach najlepiej widać slajdy zapisane jako obrazy (Plik, Eksportuj, Zmień typ pliku, PNG). Dodaj wtedy wszystkie obrazy naraz.',
  presentation: 'Tej prezentacji aplikacja nie wyświetli. Zapisz ją jako PDF albo jako obrazy PNG i dodaj ponownie.',
  word: 'Dokument dodaj jako materiał (przycisk „Dodaj plik” w części Materiały). Materiał też można pokazać na sali.',
  svg: 'Rysunków SVG aplikacja nie przyjmuje. Zapisz rysunek jako PNG.',
  animated: 'Ruchomych obrazów aplikacja nie pokazuje. Zapisz obraz jako PNG albo JPG.',
  heic: 'To zdjęcie jest w formacie HEIC, którego nie wyświetli każda przeglądarka. Dodaj je z iPhone’a przez przeglądarkę (zapisze się jako JPG) albo zapisz jako JPG.',
  other: 'Dodaj plik PDF, obraz JPG, PNG albo WebP, a krótki film jako MP4.',
  tooBig: 'Plik jest za duży. Dodaj plik do 10 MB.',
  series: 'Seria może mieć najwyżej 60 obrazów i 30 MB. Dodaj pozostałe obrazy osobno.',
  imageTooLarge: 'Obraz jest za duży. Zapisz go w mniejszym rozmiarze, np. 1920 px szerokości.',
  pdfScript: 'Ten plik PDF zawiera skrypty albo osadzone elementy, które mogą się uruchomić same. Wydrukuj go do nowego pliku PDF (Drukuj, Zapisz jako PDF) i dodaj ten nowy plik.',
  pdfEncrypted: 'Plik PDF jest zabezpieczony. Zapisz go bez hasła i bez zabezpieczeń, a potem dodaj jeszcze raz.',
  pdfOdd: 'Ten plik PDF ma nietypową budowę. Zapisz go ponownie jako PDF i dodaj jeszcze raz.',
  pdfIncomplete: 'Plik PDF jest niekompletny. Zapisz go ponownie i dodaj jeszcze raz.',
  notPdf: 'To nie jest plik PDF.',
  damaged: 'Plik jest uszkodzony. Zapisz go ponownie i dodaj jeszcze raz.',
  filed: 'Dołącz plik PDF, DOCX, JPG albo PNG do 10 MB.',
  avatarType: 'Zdjęcie musi być plikiem JPG.',
  avatarSquare: 'Zdjęcie musi być kwadratem.',
  avatarBig: 'Zdjęcie jest za duże. Wybierz je jeszcze raz, a aplikacja je zmniejszy.',
  avatarSmall: 'Zdjęcie jest za małe. Wybierz je jeszcze raz.',
} as const;

/** Odmowa dla pliku, którego nie da się pokazać (B3-05): z rozpoznanego rodzaju, a przy jego braku z rozszerzenia. */
export function refusalFor(sniffed: Sniffed | null, name = ''): string {
  const ext = extOf(name);
  if (sniffed === 'pptx' || ['ppt', 'pptx', 'pps', 'ppsx'].includes(ext)) return REFUSALS.powerpoint;
  if (['key', 'odp'].includes(ext)) return REFUSALS.presentation;
  if (sniffed === 'docx' || ['doc', 'docx', 'odt'].includes(ext)) return REFUSALS.word;
  if (sniffed === 'svg' || ext === 'svg') return REFUSALS.svg;
  if (sniffed === 'gif' || ext === 'gif') return REFUSALS.animated;
  if (sniffed === 'heic' || ['heic', 'heif'].includes(ext)) return REFUSALS.heic;
  return REFUSALS.other;
}
/**
 * Szybka odmowa w przeglądarce po samym rozszerzeniu, zanim plik się wyśle (B3-05, okno „Dodaj plik do pokazania”):
 * `null`, gdy rozszerzenie jest dozwolone. Ostateczne słowo ma sygnatura.
 */
export function refusalByName(name: string): string | null {
  const ext = extOf(name);
  return ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext) ? null : refusalFor(null, name);
}

/** Kolejność slajdów według nazw z liczbami naturalnymi („slajd2” przed „slajd10”, B3-04). */
export function naturalOrder<T>(items: T[], name: (x: T) => string = x => String(x)): T[] {
  const collator = new Intl.Collator('pl', {numeric: true, sensitivity: 'base'});
  return [...items].sort((a, b) => collator.compare(name(a), name(b)));
}

/** Wymiary obrazu z nagłówka (PNG IHDR, JPEG SOF, WebP VP8X, VP8, VP8L), bez dekodowania (K4-26). */
export function imageSize(b: Uint8Array): {width: number; height: number} | null {
  const kind = sniff(b);
  if (kind === 'png') {
    if (b.length < 24 || latin1(b, 12, 16) !== 'IHDR') return null;
    return {width: u32be(b, 16), height: u32be(b, 20)};
  }
  if (kind === 'jpeg') {
    let p = 2;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xff) return null;
      const marker = b[p + 1];
      if (marker === 0xff) { p++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      if (marker === 0xd9 || marker === 0xda) return null;
      const len = u16be(b, p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        if (p + 9 > b.length) return null;
        return {height: u16be(b, p + 5), width: u16be(b, p + 7)};
      }
      p += 2 + len;
    }
    return null;
  }
  if (kind === 'webp') {
    const type = latin1(b, 12, 16);
    if (type === 'VP8X' && b.length >= 30) return {width: u24le(b, 24) + 1, height: u24le(b, 27) + 1};
    if (type === 'VP8 ' && b.length >= 30) return {width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff};
    if (type === 'VP8L' && b.length >= 25) {
      const bits = u32le(b, 21);
      return {width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1};
    }
  }
  return null;
}
/** Odmowa obrazu ponad granice (K4-26) albo `null`. Wołana przed czyszczeniem i przed jakimkolwiek dekodowaniem. */
export function imageTooLarge(size: {width: number; height: number} | null): string | null {
  if (!size) return REFUSALS.damaged;
  return size.width > IMAGE_LIMITS.side || size.height > IMAGE_LIMITS.side || size.width * size.height > IMAGE_LIMITS.pixels ? REFUSALS.imageTooLarge : null;
}

/** Orientacja z segmentu EXIF (znacznik 0x0112) albo 1. */
function exifOrientation(seg: Uint8Array): number {
  if (latin1(seg, 0, 6) !== 'Exif\0\0') return 1;
  const t = seg.subarray(6);
  if (t.length < 8) return 1;
  const le = latin1(t, 0, 2) === 'II';
  const r16 = (o: number) => le ? u16le(t, o) : u16be(t, o);
  const r32 = (o: number) => le ? u32le(t, o) : u32be(t, o);
  try {
    const ifd = r32(4);
    if (ifd + 2 > t.length) return 1;
    const n = r16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 10 > t.length) break;
      if (r16(e) === 0x0112) return r16(e + 8);
    }
  } catch { /* uszkodzony EXIF: orientacja zwykła */ }
  return 1;
}
/** Najmniejszy segment EXIF z jednym znacznikiem orientacji (B3-26 pkt 2). */
function orientationSegment(o: number): Uint8Array {
  const tiff = [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0, 0, 0];
  const data = [...'Exif\0\0'].map(c => c.charCodeAt(0)).concat(tiff);
  const len = data.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, ...data]);
}

export interface Cleaned { bytes: Uint8Array; width: number; height: number; removed: string[]; orientation?: number }

/**
 * JPEG bez metadanych (B3-26 pkt 2): zostają segmenty obrazu, APP0 (JFIF), APP2 (profil barw) i APP14 (Adobe); znikają
 * APP1 (EXIF, XMP), APP13 (IPTC), COM i pozostałe APPn. Orientacja wraca jako najmniejszy segment EXIF. Plik bez EOI albo
 * z uszkodzoną strukturą jest odrzucany.
 */
export function cleanJpeg(b: Uint8Array): Cleaned {
  if (sniff(b) !== 'jpeg') fail(REFUSALS.avatarType, 415);
  const keep: Uint8Array[] = [b.subarray(0, 2)], removed: string[] = [];
  let p = 2, width = 0, height = 0, orientation = 1, done = false;
  while (p < b.length) {
    if (b[p] !== 0xff) fail(REFUSALS.damaged, 400);
    const marker = b[p + 1];
    if (marker === 0xff) { p++; continue; }
    if (marker === 0xd9) { keep.push(b.subarray(p, p + 2)); done = true; break; }
    if (p + 4 > b.length) fail(REFUSALS.damaged, 400);
    const len = u16be(b, p + 2);
    if (len < 2 || p + 2 + len > b.length) fail(REFUSALS.damaged, 400);
    const seg = b.subarray(p, p + 2 + len), data = b.subarray(p + 4, p + 2 + len);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && data.length >= 5) { height = u16be(data, 1); width = u16be(data, 3); }
    const app = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1 && latin1(data, 0, 6) === 'Exif\0\0') orientation = exifOrientation(data);
    if ((app && ![0xe0, 0xe2, 0xee].includes(marker)) || marker === 0xfe) removed.push(marker === 0xfe ? 'COM' : `APP${marker - 0xe0}`);
    else keep.push(seg);
    p += 2 + len;
    if (marker === 0xda) {
      // Dane skompresowane do następnego znacznika (pomija 0xFF00 i znaczniki RSTn).
      let q = p;
      while (q < b.length - 1 && !(b[q] === 0xff && b[q + 1] !== 0x00 && !(b[q + 1] >= 0xd0 && b[q + 1] <= 0xd7))) q++;
      keep.push(b.subarray(p, q));
      p = q;
    }
  }
  if (!done || !width || !height) fail(REFUSALS.damaged, 400);
  if (orientation > 1 && orientation <= 8) keep.splice(keep[1]?.[1] === 0xe0 ? 2 : 1, 0, orientationSegment(orientation));
  return {bytes: concat(keep), width, height, removed, orientation};
}

/**
 * PNG bez metadanych (B3-26 pkt 3): zostają IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, pHYs, bKGD;
 * znikają tEXt, zTXt, iTXt, eXIf, tIME i fragmenty animacji. IDAT bez zmian bajt w bajt.
 */
export function cleanPng(b: Uint8Array): Cleaned {
  if (sniff(b) !== 'png') fail(REFUSALS.other, 415);
  const allowed = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD']);
  const keep: Uint8Array[] = [b.subarray(0, 8)], removed: string[] = [];
  let p = 8, width = 0, height = 0, end = false;
  while (p + 12 <= b.length) {
    const len = u32be(b, p), type = latin1(b, p + 4, p + 8);
    if (p + 12 + len > b.length) fail(REFUSALS.damaged, 400);
    if (type === 'acTL') fail(REFUSALS.animated, 415);
    if (type === 'IHDR') { width = u32be(b, p + 8); height = u32be(b, p + 12); }
    if (allowed.has(type)) keep.push(b.subarray(p, p + 12 + len)); else removed.push(type);
    p += 12 + len;
    if (type === 'IEND') { end = true; break; }
  }
  if (!end || !width || !height) fail(REFUSALS.damaged, 400);
  return {bytes: concat(keep), width, height, removed};
}

/** WebP bez EXIF i XMP, z wyczyszczonymi flagami w VP8X (B3-26 pkt 4); animowany WebP odrzucony. */
export function cleanWebp(b: Uint8Array): Cleaned {
  if (sniff(b) !== 'webp') fail(REFUSALS.other, 415);
  const size0 = imageSize(b);
  const chunks: Uint8Array[] = [], removed: string[] = [];
  let p = 12, vp8x = -1;
  while (p + 8 <= b.length) {
    const type = latin1(b, p, p + 4), len = u32le(b, p + 4), size = 8 + len + (len & 1);
    if (p + 8 + len > b.length) fail(REFUSALS.damaged, 400);
    if (type === 'ANIM' || type === 'ANMF') fail(REFUSALS.animated, 415);
    if (type === 'EXIF' || type === 'XMP ') removed.push(type.trim());
    else { if (type === 'VP8X') vp8x = chunks.length; chunks.push(new Uint8Array(b.subarray(p, Math.min(b.length, p + size)))); }
    p += size;
  }
  if (vp8x >= 0) chunks[vp8x][8] &= ~(0x08 | 0x04 | 0x02);
  const body = concat(chunks);
  const head = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const total = body.length + 4;
  head[4] = total & 0xff; head[5] = (total >> 8) & 0xff; head[6] = (total >> 16) & 0xff; head[7] = (total >>> 24) & 0xff;
  if (!size0) fail(REFUSALS.damaged, 400);
  return {bytes: concat([head, body]), width: size0!.width, height: size0!.height, removed};
}

const FORBIDDEN_PDF = ['JavaScript', 'JS', 'Launch', 'SubmitForm', 'ImportData', 'RichMedia', 'EmbeddedFile', 'EmbeddedFiles', 'XFA'];
const decodeNames = (s: string) => s.replace(/\/([^\s/<>\[\]()%{}]+)/g, (_m, name: string) => '/' + name.replace(/#([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))));
export type PdfCheck = {ok: true; pages: number | null} | {ok: false; reason: string; found?: string[]};
/**
 * Kontrola PDF przed przyjęciem do pokazu (B3-26 pkt 5, K4-25). Odmowa przy `/JavaScript`, `/JS`, `/Launch`,
 * `/SubmitForm`, `/ImportData`, `/RichMedia`, `/EmbeddedFile(s)`, `/XFA`, `/Encrypt` (także w strumieniach obiektów
 * i w nazwach z kodami `#xx`) oraz przy strumieniu obiektów z filtrem innym niż FlateDecode albo nierozpakowującym się.
 * Liczba stron to największe `/Count` w węzłach `/Type /Pages`. `inflate` podaje wywołujący (asynchronicznie).
 */
export async function checkPdf(b: Uint8Array, o: {inflate: (bytes: Uint8Array) => Promise<Uint8Array>}): Promise<PdfCheck> {
  if (b.length < 64 || latin1(b, 0, 5) !== '%PDF-') return {ok: false, reason: REFUSALS.notPdf};
  if (!latin1(b, Math.max(0, b.length - 1024)).includes('%%EOF')) return {ok: false, reason: REFUSALS.pdfIncomplete};
  const raw = latin1(b);
  const parts = [raw];
  const objStm = /<<((?:(?!>>)[\s\S])*?\/Type\s*\/ObjStm[\s\S]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = objStm.exec(raw))) {
    const dict = decodeNames(m[1]);
    const length = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    const start = m.index + m[0].length;
    const end = length ? start + Number(length[1]) : raw.indexOf('endstream', start);
    if (end < start || end > b.length) return {ok: false, reason: REFUSALS.pdfOdd};
    const filters = (/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? '').match(/\/\w+/g) ?? [];
    if (filters.some(f => f !== '/FlateDecode') || filters.length > 1) return {ok: false, reason: REFUSALS.pdfOdd};
    try { parts.push(filters.length ? latin1(await o.inflate(b.subarray(start, end))) : raw.slice(start, end)); }
    catch { return {ok: false, reason: REFUSALS.pdfOdd}; }
  }
  const text = decodeNames(parts.join('\n'));
  if (/\/Encrypt(?![A-Za-z0-9])/.test(text)) return {ok: false, reason: REFUSALS.pdfEncrypted};
  const found = FORBIDDEN_PDF.filter(n => new RegExp(`/${n}(?![A-Za-z0-9])`).test(text));
  if (found.length) return {ok: false, found, reason: REFUSALS.pdfScript};
  let pages: number | null = null;
  for (const d of text.matchAll(/<<((?:(?!<<|>>)[\s\S])*?\/Type\s*\/Pages(?![A-Za-z])(?:(?!<<|>>)[\s\S])*?)>>/g)) {
    const c = /\/Count\s+(\d+)/.exec(d[1]);
    if (c) pages = Math.max(pages ?? 0, Number(c[1]));
  }
  const lin = /\/Linearized\s+[\d.]+[\s\S]{0,200}?\/N\s+(\d+)/.exec(text);
  if (pages === null && lin) pages = Number(lin[1]);
  return {ok: true, pages};
}

export type DisplayType = 'pdf' | 'jpeg' | 'png' | 'webp' | 'mp4';
export interface AcceptedFile { bytes: Uint8Array; type: DisplayType; size: number; width?: number; height?: number; pages?: number | null; removed?: string[] }

/**
 * Plik do pokazania (B3-04–B3-06, B3-26, G-34): rodzaj z sygnatury, limit 10 MB, obraz sprawdzony wymiarami przed
 * czyszczeniem i oczyszczony z metadanych, PDF po kontroli. Wideo MP4 (limit `SHOW_LIMITS.videoBytes`) dochodzi
 * z dodatkiem D-4; w rdzeniu MP4 dostaje odmowę jak inny plik. Odmowa to błąd z `status` 413 (rozmiar), 415 (rodzaj)
 * albo 400 (treść).
 */
export async function acceptDisplayFile(b: Uint8Array, name: string, o: {inflate: (bytes: Uint8Array) => Promise<Uint8Array>}): Promise<AcceptedFile> {
  const kind = sniff(b);
  if (kind !== 'pdf' && kind !== 'jpeg' && kind !== 'png' && kind !== 'webp') return fail(refusalFor(kind, name), 415);
  if (b.length > SHOW_LIMITS.fileBytes) fail(REFUSALS.tooBig, 413);
  if (kind === 'pdf') {
    const check = await checkPdf(b, o);
    if (!check.ok) return fail(check.reason, 400);
    return {bytes: b, type: 'pdf', size: b.length, pages: check.pages};
  }
  const tooLarge = imageTooLarge(imageSize(b));
  if (tooLarge) fail(tooLarge, 400);
  const cleaned = kind === 'jpeg' ? cleanJpeg(b) : kind === 'png' ? cleanPng(b) : cleanWebp(b);
  return {bytes: cleaned.bytes, type: kind, size: cleaned.bytes.length, width: cleaned.width, height: cleaned.height, removed: cleaned.removed};
}
/** Seria obrazów (B3-06): najwyżej 60 obrazów i 30 MB w jednym dodaniu. */
export function seriesProblem(files: {size: number}[]): string | null {
  return files.length > SHOW_LIMITS.seriesCount || files.reduce((n, f) => n + f.size, 0) > SHOW_LIMITS.seriesBytes ? REFUSALS.series : null;
}

export type FiledMime = 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'image/jpeg' | 'image/png';
/**
 * Dokument dołączony po posiedzeniu (DB-26, K4-25, G-34): tylko sygnatura i rozmiar (PDF, DOCX, JPG, PNG do 10 MB),
 * bez kontroli treści PDF, bo plik wydaje się wyłącznie jako załącznik.
 */
export function acceptFiled(b: Uint8Array): {mime: FiledMime; ext: 'pdf' | 'docx' | 'jpg' | 'png'} {
  const kind = sniff(b);
  if (b.length === 0 || b.length > FILED_BYTES) return fail(REFUSALS.filed, b.length > FILED_BYTES ? 413 : 415);
  if (kind === 'pdf') return {mime: 'application/pdf', ext: 'pdf'};
  if (kind === 'docx') return {mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx'};
  if (kind === 'jpeg') return {mime: 'image/jpeg', ext: 'jpg'};
  if (kind === 'png') return {mime: 'image/png', ext: 'png'};
  return fail(REFUSALS.filed, 415);
}

/**
 * Zdjęcie profilowe (B3-33, G-35): tylko JPEG, pełna struktura od SOI do EOI, kwadrat 256–1024 px, do 400 KB; metadane
 * usunięte jak w B3-26 pkt 2 (obrona w głąb, gdyby plik przyszedł z pominięciem kadru w przeglądarce).
 */
export function acceptAvatar(b: Uint8Array): Cleaned {
  if (sniff(b) !== 'jpeg') fail(REFUSALS.avatarType, 415);
  if (b.length > AVATAR_LIMITS.bytes) fail(REFUSALS.avatarBig, 413);
  const size = imageSize(b);
  if (!size) fail(REFUSALS.avatarType, 400);
  if (size!.width !== size!.height) fail(REFUSALS.avatarSquare, 400);
  if (size!.width > AVATAR_LIMITS.max) fail(REFUSALS.avatarBig, 400);
  if (size!.width < AVATAR_LIMITS.min) fail(REFUSALS.avatarSmall, 400);
  const cleaned = cleanJpeg(b);
  // Orientacja w kadrze z przeglądarki jest już zastosowana, a obraz kwadratowy; segment orientacji zostaje jak w pliku.
  return cleaned;
}

/**
 * Nazwa pliku do wyświetlenia i do `Content-Disposition` (B3-26 pkt 7): bez ukośników i znaków sterujących, do 255
 * znaków; na dysku plik ma nazwę `plik_{uuid}`.
 */
export function displayName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').replace(/\s+/g, ' ').trim();
  return (clean || 'plik').slice(0, 255);
}
