import type {Account, Actor, Meeting, PaperFormat, PaperId, Roster} from '../shared/types.ts';
import {agendaMarkdown, fileBase, generatedLine, meetingPapers, pageHeader, paperFormats, paperHtml, paperCsv, paperName, paperNameAccusative, paperPage, paperState, type PaperContext} from '../shared/papers.ts';
import {docxFromHtml} from '../shared/docx.ts';
import {commsMarkdown, type CommsOptions} from '../shared/comms.ts';
import {canDownloadComms, canDownloadPaper} from '../shared/role.ts';
import {seesUnannounced} from '../shared/view.ts';
import {safeEntryName, zip, type EntryExt, type ZipEntry} from '../shared/zip.ts';
import {shownDisplays} from '../shared/show.ts';
import {itemNumber} from '../shared/rules.ts';
import type {CascadeEnv} from '../shared/cascade.ts';
import {dateDots, isoDayOf, timeOf} from '../shared/text.ts';
import {minutesBody, minutesDocx, minutesHtml, minutesPageHeader, type MinutesLook} from './minutes.ts';

// Składanie plików dokumentów posiedzenia (SPEC-4 5.5, B1-08–B1-12, K4-15, K4-23, K4-25): strona do druku, prawdziwy
// Word, Markdown, CSV i teczka ZIP. Moduł bez zależności od Node: serwer (`export.ts`) podaje `zlib.deflateRaw`,
// `zlib.crc32` i SHA-256 z `node:crypto`, a wersja próbna `CompressionStream('deflate-raw')` i SHA-256 z `sha256.ts`
// (etap D.3). Treść dokumentów powstaje w src/shared, więc oba miejsca dają te same pliki.

/** Kompresja i skróty dla teczki i plików Word. */
export interface ExportCodec {
  deflateRaw: (b: Uint8Array) => Promise<Uint8Array>;
  crc32?: (b: Uint8Array) => number;
  sha256: (b: Uint8Array) => string;
}
const encoder = new TextEncoder();
const bytesOf = (x: Uint8Array | string) => typeof x === 'string' ? encoder.encode(x) : x;

export const CONTENT_TYPES: Record<PaperFormat, string> = {
  html: 'text/html; charset=utf-8', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/markdown; charset=utf-8', csv: 'text/csv; charset=utf-8', zip: 'application/zip',
};
export interface PaperFile { data: Uint8Array | string; type: string; name: string; inline: boolean }
export interface ExportDeps {
  roster: Roster; accounts: Account[]; env: CascadeEnv; at: number; look: MinutesLook;
  /** Nazwa biura w bierniku do zdań listy obecności („zapisane przez biuro Izby”). */
  office?: string;
  materialHtml: (materialId: string, version: number) => {html: string; hash: string} | null;
  fileBytes: (fileId: string) => Promise<Uint8Array | null>;
  fileMeta: (fileId: string) => {name: string; mime: string} | null;
  /** Wpisy historii ustawień posiedzenia do dziennika (B1-22). */
  audit?: {at: number; by: string; text: string}[];
  comms?: Pick<CommsOptions, 'adoption' | 'next'>;
  codec: ExportCodec;
}
const ctxOf = (d: ExportDeps, word = false): PaperContext => ({env: d.env, at: d.at, office: d.office, word, materialHtml: d.materialHtml, audit: d.audit});
const minutesOptions = (m: Meeting, a: Actor, d: ExportDeps) => ({...d.look, options: {...d.look.options, docTypes: d.env.docTypes, hideUnannounced: !seesUnannounced(m, a, d.roster)}});

/** Strona HTML dokumentu (B1-08) albo plik HTML w teczce (`standalone`, CSP w nagłówku, bez skryptu, K4-15). */
function paperPageHtml(id: PaperId, m: Meeting, d: ExportDeps, standalone: boolean) {
  const name = paperName(m, id, d.env);
  const state = paperState(m, id);
  const base = `/api/meetings/${encodeURIComponent(m.id)}/dokumenty/${encodeURIComponent(id)}`;
  const label: Record<PaperFormat, string> = {html: 'Drukuj', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
  const fullName: Record<PaperFormat, string> = {html: '', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
  const links = standalone ? [] : paperFormats(id).filter(f => f !== 'html').map(f => ({href: `${base}?format=${f}`, label: label[f], name: `Pobierz ${paperNameAccusative(m, id)} w formacie ${fullName[f]}`}));
  return paperPage(paperHtml(id, m, ctxOf(d)), {
    title: `${name} – ${m.title}`, header: pageHeader(m, name), draft: state === 'projekt', generatedAt: d.at,
    stateMark: state === 'stan_na' ? `Stan na godz. ${timeOf(d.at)}` : undefined, css: standalone ? null : d.look.css ?? null, links, standalone,
  });
}
async function paperDocx(id: PaperId, m: Meeting, d: ExportDeps) {
  const name = paperName(m, id, d.env);
  return docxFromHtml(paperHtml(id, m, ctxOf(d, true)), {title: `${name} – ${m.title}`, header: pageHeader(m, name), draft: paperState(m, id) === 'projekt',
    firstHeader: d.look.org, footerLeft: generatedLine(d.at), now: d.at, deflateRaw: d.codec.deflateRaw});
}

/**
 * Dokument w wybranym formacie dla osoby (5.2, B1-11): `canDownloadPaper` sprawdza trasa. Format spoza tabeli B1-11 daje
 * 400 „Ten dokument nie ma takiego formatu.”
 */
export async function paperFile(id: PaperId, format: PaperFormat, m: Meeting, a: Actor, d: ExportDeps): Promise<PaperFile> {
  if (!paperFormats(id).includes(format) || format === 'zip') throw Object.assign(new Error('Ten dokument nie ma takiego formatu.'), {status: 400});
  const base = fileBase(m, id, d.at);
  if (id === 'protokol') {
    const look = minutesOptions(m, a, d);
    if (format === 'docx') return {data: await minutesDocx(m, d.roster, d.accounts, d.at, look, {deflateRaw: d.codec.deflateRaw}), type: CONTENT_TYPES.docx, name: `${base}.docx`, inline: false};
    return {data: minutesHtml(m, d.roster, d.accounts, d.at, look), type: CONTENT_TYPES.html, name: `${base}.html`, inline: true};
  }
  if (id === 'komunikacja') return {data: commsMarkdown(m, d.env, {at: d.at, materialHtml: (mid, v) => d.materialHtml(mid, v)?.html ?? null, ...d.comms}), type: CONTENT_TYPES.md, name: `${base}.md`, inline: false};
  if (format === 'html') return {data: paperPageHtml(id, m, d, false), type: CONTENT_TYPES.html, name: `${base}.html`, inline: true};
  if (format === 'docx') return {data: await paperDocx(id, m, d), type: CONTENT_TYPES.docx, name: `${base}.docx`, inline: false};
  if (format === 'md') return {data: agendaMarkdown(m, ctxOf(d)), type: CONTENT_TYPES.md, name: `${base}.md`, inline: false};
  return {data: paperCsv(id, m, ctxOf(d)), type: CONTENT_TYPES.csv, name: `${base}.csv`, inline: false};
}

/** Nagłówek `Content-Disposition` z nazwą ASCII i `filename*` (5.3); nazwy z `fileBase` są już w ASCII. */
export function disposition(name: string, inline = false) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\/]/g, '_').replace(/[\r\n]/g, '').slice(0, 255);
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name.replace(/[\r\n\\/]/g, '_').slice(0, 255))}`;
}

/** Limit teczki (B1-12, S-13): przy przekroczeniu najpierw odpadają pliki pokazane, potem oryginały materiałów. */
export const FOLDER_LIMIT = 100 * 1024 * 1024;
const EXT_BY_MIME: Record<string, EntryExt> = {
  'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'video/mp4': 'mp4', 'text/plain': 'txt', 'text/markdown': 'md',
};
const FILED_SLUG: Record<string, string> = {protokol_sporzadzony: 'protokol-sporzadzony', protokol_podpisany: 'protokol-podpisany', zawiadomienie: 'zawiadomienie', akt_podpisany: 'akt-podpisany', inny: 'dokument'};

/**
 * Teczka posiedzenia (B1-12, DB-32, K4-15, K4-23): skład według uprawnień osoby pobierającej (każdy plik przez
 * `canDownloadPaper`, materiał dla komunikacji przez `canDownloadComms`, dziennik w wariancie tej osoby), nazwy wpisów
 * z `safeEntryName`, `SPIS.txt` ze skrótami SHA-256 i listą pominiętych plików z powodem, limit 100 MB.
 */
export async function buildFolder(m: Meeting, a: Actor, d: ExportDeps, limit = FOLDER_LIMIT): Promise<{data: Uint8Array; name: string}> {
  const root = fileBase(m, 'teczka', d.at);
  const used = new Set<string>();
  type Item = {name: string; data: Uint8Array | string; kind: 'dokument' | 'material' | 'pokazany'; title: string};
  const items: Item[] = [];
  const skipped: {title: string; reason: string}[] = [];
  const allowed = (id: PaperId) => canDownloadPaper(d.roster, m, a, id);
  const add = (kind: Item['kind'], title: string, prefix: string | number, ext: EntryExt, data: Uint8Array | string, dir?: string) => {
    items.push({name: `${root}/${safeEntryName(title, used, {prefix, ext, dir})}`, data, kind, title});
  };
  const doc = async (n: number, id: PaperId, formats: PaperFormat[]) => {
    if (!allowed(id)) { skipped.push({title: paperName(m, id, d.env), reason: 'bez prawa dostępu'}); return; }
    const title = paperName(m, id, d.env);
    for (const f of formats) {
      if (!paperFormats(id).includes(f)) continue;
      if (f === 'html') {
        const html = id === 'protokol' ? paperPage(minutesBody(m, d.roster, d.accounts, d.at, d.look.names, minutesOptions(m, a, d).options), {title: `${title} – ${m.title}`, header: minutesPageHeader(m), draft: true, generatedAt: d.at, standalone: true})
          : paperPageHtml(id, m, d, true);
        add('dokument', title, n, 'html', html);
      } else {
        const file = await paperFile(id, f, m, a, d);
        add('dokument', title, n, f as EntryExt, file.data);
      }
    }
  };
  const papers = meetingPapers(m, d.env, {...a}, d.at).map(p => p.id);
  await doc(1, 'protokol', ['docx', 'html']);
  await doc(2, 'porzadek', ['docx', 'md', 'html']);
  if (m.kind === 'posiedzenie') {
    await doc(3, 'obecnosc', ['docx', 'csv']);
    if (m.mode === 'stacjonarne') await doc(3, 'obecnosc-podpis', ['html']);
  }
  if (m.ballots.some(b => b.purpose !== 'proba')) await doc(4, 'wyniki', ['docx', 'csv']);
  for (const id of papers.filter(x => x.startsWith('wykaz-'))) await doc(4, id, ['csv']);
  for (const id of papers.filter(x => x.startsWith('akt-'))) {
    if (!allowed(id)) continue;
    const title = paperName(m, id, d.env);
    add('dokument', title, 5, 'docx', (await paperFile(id, 'docx', m, a, d)).data, '05-akty');
    add('dokument', title, 5, 'html', paperPageHtml(id, m, d, true), '05-akty');
  }
  // Materiały: oryginał i tekst wersji bieżącej (oraz głosowanej, gdy różna).
  if (allowed('porzadek')) {
    for (const ref of m.materials) {
      const it = m.agenda.find(i => i.materialIds.includes(ref.id));
      const prefix = it ? itemNumber(m.agenda, it.id) : 0;
      const versions = new Set([ref.version, ...m.ballots.filter(b => b.material?.id === ref.id).map(b => b.material!.version)]);
      for (const v of versions) {
        const row = d.materialHtml(ref.id, v);
        if (row?.html) add('material', ref.title, prefix, 'html', paperPage(row.html, {title: ref.title, header: ref.title, draft: false, generatedAt: d.at, standalone: true}), '06-materialy');
      }
      if (ref.fileId) {
        const meta = d.fileMeta(ref.fileId), bytes = await d.fileBytes(ref.fileId);
        const ext = meta ? EXT_BY_MIME[meta.mime] : undefined;
        if (bytes && ext) add('material', ref.title, prefix, ext, bytes, '06-materialy');
      }
    }
  }
  await doc(7, 'kanal', ['docx', 'csv']);
  await doc(8, 'dziennik', ['csv']);
  if (allowed('protokol')) {
    for (const f of (m.filed ?? []).filter(x => !x.replacedAt)) {
      const bytes = await d.fileBytes(f.fileId);
      const ext = EXT_BY_MIME[f.mime];
      if (bytes && ext) add('dokument', `${FILED_SLUG[f.kind]} ${f.kind === 'inny' ? f.title : ''}`.trim(), 9, ext, bytes, '09-dokumenty-dolaczone');
    }
  }
  if (canDownloadComms(d.roster, m, a)) add('dokument', 'Materiał dla komunikacji', 10, 'md', (await paperFile('komunikacja', 'md', m, a, d)).data);
  else skipped.push({title: 'Materiał dla komunikacji', reason: 'bez prawa dostępu'});
  // DB-32: pliki faktycznie pokazane, z numerem punktu.
  for (const disp of shownDisplays(m)) {
    const prefix = disp.itemId ? itemNumber(m.agenda, disp.itemId) : 0;
    for (const [i, f] of disp.files.entries()) {
      const bytes = await d.fileBytes(f.fileId);
      const ext = ({pdf: 'pdf', jpeg: 'jpg', png: 'png', webp: 'webp', mp4: 'mp4'} as const)[f.type];
      if (bytes) add('pokazany', disp.files.length > 1 ? `${disp.title} ${i + 1}` : disp.title, prefix, ext, bytes, '11-pokazane');
    }
  }
  // Limit: najpierw odpadają pliki pokazane, potem oryginały materiałów.
  const size = () => items.reduce((n, x) => n + bytesOf(x.data).length, 0);
  for (const kind of ['pokazany', 'material'] as const) {
    if (size() + 4096 <= limit) break;
    for (const x of items.filter(i => i.kind === kind)) skipped.push({title: x.name.slice(root.length + 1), reason: 'przekroczony rozmiar teczki'});
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === kind) items.splice(i, 1);
  }
  const lines = [
    `Teczka posiedzenia ${m.title}`, `Stan na ${dateDots(isoDayOf(d.at))}, godz. ${timeOf(d.at)}.`, `Pobrało konto ${a.account.displayName || a.account.username}.`, '',
    'Pliki i skróty SHA-256', ...items.map(x => `${d.codec.sha256(bytesOf(x.data))}  ${x.name.slice(root.length + 1)}`),
  ];
  if (skipped.length) lines.push('', 'Pominięte pliki', ...skipped.map(s => `${s.title}, ${s.reason}`));
  const entries: ZipEntry[] = [{name: `${root}/SPIS.txt`, data: lines.join('\r\n') + '\r\n'}, ...items.map(x => ({name: x.name, data: x.data}))];
  return {data: await zip(entries, {deflateRaw: d.codec.deflateRaw, ...(d.codec.crc32 ? {crc: d.codec.crc32} : {}), now: new Date(d.at)}), name: `${root}.zip`};
}
