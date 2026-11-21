import {zip, type ZipOptions} from './zip.ts';

// Prawdziwy plik Word (.docx) z HTML dokumentu (SPEC-4 5.5, B1-09, DB-27, K4-34). Wejście to HTML generowany przez
// aplikację (znaki zabezpieczone przez `esc`) albo HTML materiału po `cleanHtml` (src/server/documents.ts), więc wystarcza
// prosty tokenizer znaczników. Obsługiwane znaczniki: h1–h6, p (klasy draft, muted, footer), br, strong, b, em, i, u, s,
// strike, del, sup, sub, code, a (tekst z adresem w nawiasie), ul, ol (start), li (zagnieżdżone, numeracja Worda: cyfra
// z kropką albo półpauza, bez kółek), table z thead (wiersz nagłówka powtarzany), komórki scalone (colspan jako gridSpan,
// rowspan jako vMerge), blockquote, hr, dl (fakty jako tabela bez ramek), section.attachment (nowa strona), .signatures
// (tabela podpisów z cantSplit i keepNext). Znaczniki układu (div, section, header, article, main, span, time, abbr) są
// przezroczyste, a img, script, style, button i nav pomijane. Numeracja „Strona X z Y” z pól PAGE i NUMPAGES w stopce,
// nagłówek z „PROJEKT” w projektach (na pierwszej stronie sam znak, od drugiej z nazwą dokumentu).
// Wzór: /home/user/przeglad/v4-projekt/proby-B1/docx.mjs.

const ENT: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => e[0] === '#'
  ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
/** Tekst do XML 1.0: bez znaków sterujących; łącznik słów U+2060 znika (jak w dawnym pliku Word), twarda spacja zostaje. */
const x = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f⁠￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface HtmlNode { tag: string; cls: string; attrs: string; children: (HtmlNode | string)[] }
const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'col']);
/** Drzewo z HTML: węzły ze znacznikiem, klasą i atrybutami albo tekst (z rozkodowanymi encjami). */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = {tag: 'root', cls: '', attrs: '', children: []}, stack = [root];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<!doctype[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</gi)) {
    if (m[4] !== undefined) { stack[stack.length - 1].children.push(decode(m[4])); continue; }
    if (!m[2]) { if (m[0] === '<') stack[stack.length - 1].children.push('<'); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map(n => n.tag).lastIndexOf(tag); if (i > 0) stack.length = i; continue; }
    const cls = /\bclass="([^"]*)"/.exec(m[3])?.[1] ?? '';
    const node: HtmlNode = {tag, cls, attrs: m[3], children: []};
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !m[3].trim().endsWith('/')) stack.push(node);
  }
  return root;
}
const has = (n: HtmlNode, c: string) => (' ' + n.cls + ' ').includes(' ' + c + ' ');
const attr = (n: HtmlNode, name: string) => { const v = new RegExp(`\\b${name}="([^"]*)"`).exec(n.attrs)?.[1]; return v === undefined ? undefined : decode(v); };
const elements = (n: HtmlNode) => n.children.filter((c): c is HtmlNode => typeof c !== 'string');

interface Fmt { b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean; code?: boolean }
type Run = ({t: string} & Fmt) | {br: true};
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'sup', 'sub', 'code', 'br', 'span', 'a', 'time', 'abbr', 'small', 'mark', 'q', 'cite', 'kbd', 'samp', 'var', 'wbr']);
const SKIP = new Set(['img', 'script', 'style', 'button', 'nav', 'input', 'select', 'textarea', 'svg', 'iframe', 'object', 'video', 'audio', 'template']);

/** Fragmenty tekstu z formatowaniem (każdy węzeł tekstowy to osobny fragment). */
function runs(nodes: (HtmlNode | string)[], fmt: Fmt = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes) {
    if (typeof n === 'string') { const t = n.replace(/\s+/g, ' '); if (t) out.push({t, ...fmt}); continue; }
    if (SKIP.has(n.tag)) continue;
    if (n.tag === 'br') { out.push({br: true}); continue; }
    const f: Fmt = {...fmt};
    if (n.tag === 'strong' || n.tag === 'b' || n.tag === 'th') f.b = true;
    if (n.tag === 'em' || n.tag === 'i' || n.tag === 'cite' || n.tag === 'var') f.i = true;
    if (n.tag === 'u' || n.tag === 'ins') f.u = true;
    if (n.tag === 's' || n.tag === 'strike' || n.tag === 'del') f.s = true;
    if (n.tag === 'sup') f.sup = true;
    if (n.tag === 'sub') f.sub = true;
    if (n.tag === 'code' || n.tag === 'kbd' || n.tag === 'samp') f.code = true;
    out.push(...runs(n.children, f));
    // Odnośnik jako tekst z adresem w nawiasie (K4-34), gdy adres różni się od tekstu.
    if (n.tag === 'a') {
      const href = attr(n, 'href');
      const text = textOf(n).trim();
      if (href && href !== text && !href.startsWith('#')) out.push({t: ` (${href})`, ...fmt});
    }
  }
  return out;
}
export const textOf = (n: HtmlNode | string): string => typeof n === 'string' ? n : n.children.map(textOf).join('');

function runXml(r: Run): string {
  if ('br' in r) return '<w:r><w:br/></w:r>';
  // Kolejność elementów jak w schemacie OOXML (rFonts, b, i, strike, sz, u, vertAlign).
  const pr = (r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '') + (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '')
    + (r.s ? '<w:strike/>' : '') + (r.code ? '<w:sz w:val="18"/>' : '') + (r.u ? '<w:u w:val="single"/>' : '')
    + (r.sup ? '<w:vertAlign w:val="superscript"/>' : r.sub ? '<w:vertAlign w:val="subscript"/>' : '');
  return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(r.t)}</w:t></w:r>`;
}
interface ParaProps { style?: string; keepNext?: boolean; pageBreak?: boolean; align?: 'center' | 'right' | 'left'; ind?: number; num?: {id: number; level: number}; border?: boolean; bold?: boolean }
function para(rs: Run[], p: ParaProps = {}): string {
  const list = rs.filter(r => 'br' in r || r.t);
  const first = list[0], last = list[list.length - 1];
  if (first && 't' in first) list[0] = {...first, t: first.t.replace(/^\s+/, '')};
  if (last && 't' in last) list[list.length - 1] = {...(list[list.length - 1] as {t: string} & Fmt), t: (list[list.length - 1] as {t: string}).t.replace(/\s+$/, '')};
  const pPr = (p.style ? `<w:pStyle w:val="${p.style}"/>` : '') + (p.keepNext ? '<w:keepNext/>' : '') + (p.pageBreak ? '<w:pageBreakBefore/>' : '')
    + (p.num ? `<w:numPr><w:ilvl w:val="${p.num.level}"/><w:numId w:val="${p.num.id}"/></w:numPr>` : '')
    + (p.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>' : '')
    + (p.ind ? `<w:ind w:left="${p.ind}"/>` : '') + (p.align ? `<w:jc w:val="${p.align}"/>` : '');
  const body = list.map(r => p.bold && 't' in r ? {...r, b: true} : r).map(runXml).join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
}

/** Dodaje właściwość akapitu po stylu akapitu (kolejność ze schematu: pStyle, keepNext, pageBreakBefore …). */
function withPPr(p: string, extra: string): string {
  if (p.startsWith('<w:p/>')) return `<w:p><w:pPr>${extra}</w:pPr></w:p>` + p.slice(6);
  if (!p.startsWith('<w:p><w:pPr>')) return p.replace(/^<w:p>/, `<w:p><w:pPr>${extra}</w:pPr>`);
  const m = /^<w:p><w:pPr>(<w:pStyle w:val="[^"]*"\/>)?/.exec(p)!;
  return p.slice(0, m[0].length) + extra + p.slice(m[0].length);
}

interface Ctx { depth: number; bold?: boolean; lists: {kind: 'ol' | 'ul'; start: number; level: number}[]; signatures?: boolean }
interface Cell { content: string[]; colspan: number; rowspan: number }
const TABLE_WIDTH = 9638;
/** Tabela z siatką kolumn: komórki scalone w poziomie (gridSpan) i w pionie (vMerge). */
function table(rows: {head: boolean; cells: Cell[]}[], o: {borders: boolean; keepRows?: boolean}): string {
  // Pierwsze przejście: liczba kolumn siatki z uwzględnieniem komórek scalonych w pionie z wierszy wyżej.
  // Przy okazji miara treści kolumn z komórek bez scalenia: najdłuższe słowo i długość tekstu (W-W4-15).
  const carry: number[] = [];
  const need: number[] = [];
  let cols = 0;
  for (const r of rows) {
    let col = 0;
    const take = () => { while ((carry[col] ?? 0) > 0) col++; };
    for (const c of r.cells) {
      take();
      if (c.colspan === 1) {
        const text = c.content.join('').replace(/<w:(tab|br)\/>/g, ' ').replace(/<[^>]+>/g, '').replace(/&(?:[a-z]+|#\d+);/g, 'x').trim();
        const longest = text.split(/\s+/).reduce((n, w) => Math.max(n, w.length), 0);
        need[col] = Math.max(need[col] ?? 0, longest, Math.min(text.length, 40) / 2);
      }
      for (let k = 0; k < c.colspan; k++) carry[col + k] = Math.max(carry[col + k] ?? 0, c.rowspan);
      col += c.colspan;
    }
    take();
    cols = Math.max(cols, col, carry.length);
    for (let k = 0; k < carry.length; k++) if (carry[k] > 0) carry[k]--;
  }
  cols = Math.max(cols, 1);
  // Szerokości kolumn według treści, żeby długie słowa („Wiceprzewodnicząca”) nie łamały się w środku (W-W4-15).
  const weights = Array.from({length: cols}, (_, i) => Math.max(4, need[i] ?? 4));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(w => Math.floor(TABLE_WIDTH * w / total));
  const spanWidth = (from: number, n: number) => widths.slice(from, from + n).reduce((a, b) => a + b, 0);
  const pending: ({rows: number; span: number} | undefined)[] = [];
  const tr = rows.map((r, i) => {
    const out: string[] = [];
    let col = 0;
    const flush = (until: number) => {
      while (col < until && pending[col]) {
        const p = pending[col]!;
        out.push(`<w:tc><w:tcPr><w:tcW w:w="${spanWidth(col, p.span)}" w:type="dxa"/>${p.span > 1 ? `<w:gridSpan w:val="${p.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`);
        p.rows--;
        if (p.rows <= 0) pending[col] = undefined;
        col += p.span;
      }
    };
    // Blok podpisów nie dzieli się między strony (B1-06): akapity poza ostatnim wierszem trzymają się następnego.
    const keep = o.keepRows && i < rows.length - 1;
    const content = (c: Cell) => (c.content.length ? c.content : ['<w:p/>']).map(p => keep && p.startsWith('<w:p') ? withPPr(p, '<w:keepNext/>') : p).join('');
    for (const c of r.cells) {
      flush(Infinity);
      const span = Math.min(c.colspan, Math.max(1, cols - col));
      out.push(`<w:tc><w:tcPr><w:tcW w:w="${spanWidth(col, span)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${c.rowspan > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>${content(c)}</w:tc>`);
      if (c.rowspan > 1) pending[col] = {rows: c.rowspan - 1, span};
      col += span;
    }
    flush(Infinity);
    while (col < cols) {
      // Wiersz krótszy od siatki: pusta komórka do końca, żeby Word nie przesuwał kolumn.
      out.push(`<w:tc><w:tcPr><w:tcW w:w="${widths[col]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`);
      col++;
    }
    const trPr = '<w:cantSplit/>' + (r.head ? '<w:tblHeader/>' : '');
    return `<w:tr><w:trPr>${trPr}</w:trPr>${out.join('')}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="${o.borders ? 'Tabela' : 'TabelaBezRamek'}"/><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/></w:tblPr>`
    + `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${tr}</w:tbl>`;
}

/** Stan numeracji list: każda lista numerowana ma własny numer (od `start`), wypunktowania jedną definicję. */
class Numbering {
  nums: {id: number; abstract: 0 | 1; level: number; start: number}[] = [];
  next(kind: 'ol' | 'ul', level: number, start: number) {
    const id = this.nums.length + 1;
    this.nums.push({id, abstract: kind === 'ol' ? 0 : 1, level, start});
    return id;
  }
  xml() {
    const lvl = (i: number, kind: 'ol' | 'ul') => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${kind === 'ol' ? 'decimal' : 'bullet'}"/>`
      + `<w:lvlText w:val="${kind === 'ol' ? `%${i + 1}.` : '–'}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 * (i + 1) + 0}" w:hanging="360"/></w:pPr></w:lvl>`;
    const abstract = (id: 0 | 1, kind: 'ol' | 'ul') => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({length: 9}, (_, i) => lvl(i, kind)).join('')}</w:abstractNum>`;
    const nums = this.nums.map(n => `<w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.abstract}"/>${n.abstract === 0 ? `<w:lvlOverride w:ilvl="${n.level}"><w:startOverride w:val="${n.start}"/></w:lvlOverride>` : ''}</w:num>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${abstract(0, 'ol')}${abstract(1, 'ul')}${nums}</w:numbering>`;
  }
}

/** Bloki dokumentu z drzewa HTML. */
function blocks(node: HtmlNode, ctx: Ctx, numbering: Numbering): string[] {
  const out: string[] = [];
  const inline: (HtmlNode | string)[] = [];
  const flush = () => {
    if (inline.some(n => typeof n !== 'string' || n.trim())) out.push(para(runs(inline, ctx.bold ? {b: true} : {})));
    inline.length = 0;
  };
  for (const n of node.children) {
    if (typeof n === 'string' || INLINE.has(n.tag)) { inline.push(n); continue; }
    if (SKIP.has(n.tag) || has(n, 'toolbar')) continue;
    flush();
    const t = n.tag;
    const fmt: Fmt = ctx.bold ? {b: true} : {};
    if (t === 'h1') out.push(para(runs(n.children, fmt), {style: 'Tytul', keepNext: true}));
    else if (t === 'h2') out.push(para(runs(n.children, fmt), {style: 'Naglowek1', keepNext: true}));
    else if (/^h[3-6]$/.test(t)) out.push(para(runs(n.children, fmt), {style: 'Naglowek2', keepNext: true}));
    else if (t === 'p') out.push(para(runs(n.children, fmt), {style: has(n, 'draft') ? 'Znacznik' : has(n, 'muted') || has(n, 'footer') ? 'Uwaga' : undefined}));
    else if (t === 'hr') out.push(para([], {border: true}));
    else if (t === 'blockquote') out.push(...blocks(n, ctx, numbering).map(b => b.startsWith('<w:p>') && !b.startsWith('<w:p><w:pPr><w:pStyle') ? withPPr(b, '<w:pStyle w:val="Cytat"/>') : b));
    else if (t === 'ul' || t === 'ol') out.push(...list(n, ctx, numbering));
    else if (t === 'table') {
      const rows: {head: boolean; cells: Cell[]}[] = [];
      const walk = (k: HtmlNode, head: boolean) => {
        for (const c of elements(k)) {
          if (c.tag === 'tr') rows.push({head, cells: elements(c).filter(d => d.tag === 'td' || d.tag === 'th').map(d => ({
            content: blocks(d, {...ctx, bold: ctx.bold || d.tag === 'th'}, numbering),
            colspan: Math.max(1, Math.min(63, Number(attr(d, 'colspan')) || 1)), rowspan: Math.max(1, Math.min(1000, Number(attr(d, 'rowspan')) || 1)),
          }))});
          else if (c.tag !== 'caption') walk(c, head || c.tag === 'thead');
        }
      };
      walk(n, false);
      const plain = has(n, 'facts') || has(n, 'signatures');
      if (rows.length) out.push(table(rows, {borders: !plain, keepRows: has(n, 'signatures')}));
    } else if (t === 'dl') {
      const rows: {head: boolean; cells: Cell[]}[] = [];
      const items = elements(n).flatMap(c => c.tag === 'div' ? elements(c) : [c]);
      for (let i = 0; i < items.length; i++) {
        if (items[i].tag !== 'dt') continue;
        const dd = items[i + 1]?.tag === 'dd' ? items[i + 1] : {tag: 'dd', cls: '', attrs: '', children: []};
        rows.push({head: false, cells: [{content: [para(runs(items[i].children), {style: 'Etykieta'})], colspan: 1, rowspan: 1}, {content: blocks(dd, ctx, numbering), colspan: 1, rowspan: 1}]});
      }
      if (rows.length) out.push(table(rows, {borders: false}));
    } else if (has(n, 'signatures') && t !== 'table') {
      const cells = elements(n).map(s => ({content: [para([{t: '.'.repeat(30)}], {align: 'center'}), ...elements(s).map(c => para(runs(c.children), {align: 'center', style: has(c, 'signature-role') ? 'Uwaga' : undefined}))], colspan: 1, rowspan: 1}));
      if (cells.length) out.push(table([{head: false, cells}], {borders: false}));
    } else if (t === 'section' && has(n, 'attachment')) {
      const inner = blocks(n, ctx, numbering);
      if (inner.length) inner[0] = inner[0].startsWith('<w:p>') ? withPPr(inner[0], '<w:pageBreakBefore/>') : `<w:p><w:pPr><w:pageBreakBefore/></w:pPr></w:p>${inner[0]}`;
      out.push(...inner);
    } else out.push(...blocks(n, ctx, numbering));
  }
  flush();
  return out;
}
/** Lista z numeracją Worda; zagnieżdżone listy na kolejnym poziomie. */
function list(n: HtmlNode, ctx: Ctx, numbering: Numbering): string[] {
  const kind = n.tag as 'ol' | 'ul';
  const level = Math.min(8, ctx.depth);
  const id = numbering.next(kind, level, Math.max(1, Number(attr(n, 'start')) || 1));
  const out: string[] = [];
  for (const li of elements(n).filter(c => c.tag === 'li')) {
    const own: (HtmlNode | string)[] = [];
    let numbered = false;
    const push = (rs: Run[]) => { out.push(para(rs, numbered ? {ind: 360 * (level + 1)} : {num: {id, level}})); numbered = true; };
    for (const c of li.children) {
      if (typeof c === 'string' || INLINE.has(c.tag)) { own.push(c); continue; }
      if (own.some(o => typeof o !== 'string' || o.trim())) { push(runs(own, ctx.bold ? {b: true} : {})); }
      own.length = 0;
      if (c.tag === 'ul' || c.tag === 'ol') { if (!numbered) push([]); out.push(...list(c, {...ctx, depth: ctx.depth + 1}, numbering)); }
      else if (c.tag === 'p' && !numbered) push(runs(c.children, ctx.bold ? {b: true} : {}));
      else out.push(...blocks({tag: 'div', cls: '', attrs: '', children: [c]}, ctx, numbering));
    }
    if (own.some(o => typeof o !== 'string' || o.trim()) || !numbered) push(runs(own, ctx.bold ? {b: true} : {}));
  }
  return out;
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Titillium Web" w:hAnsi="Titillium Web" w:cs="Titillium Web" w:eastAsia="Titillium Web"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Tytul"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="240"/></w:pPr><w:rPr><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Naglowek1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Naglowek2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Znacznik"><w:name w:val="Znacznik dokumentu"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:caps/><w:spacing w:val="20"/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Etykieta"><w:name w:val="Etykieta"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Uwaga"><w:name w:val="Uwaga"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Cytat"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Stopka"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="Tabela"><w:name w:val="Tabela"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders><w:tblCellMar><w:left w:w="85" w:type="dxa"/><w:right w:w="85" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="TabelaBezRamek"><w:name w:val="Tabela bez ramek"/><w:tblPr><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="170" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

export interface DocxOptions {
  /** Tytuł dokumentu we właściwościach pliku. */
  title: string;
  /** Napis w nagłówku od drugiej strony, np. „Projekt protokołu, posiedzenie z dnia 19.11.2026” (B1-05). */
  header?: string;
  /** Projekt: „PROJEKT” w nagłówku każdej strony (B1-02). */
  draft?: boolean;
  /** Napis w nagłówku pierwszej strony obok znaku „Projekt”, np. nazwa Izby (B1-05); w wersji próbnej brak. */
  firstHeader?: string;
  /** Lewa część stopki, np. „Wygenerowano 19.11.2026, godz. 18:00” (B1-05). */
  footerLeft?: string;
  /** Chwila utworzenia (właściwości pliku i daty wpisów ZIP). */
  now: number;
  deflateRaw?: ZipOptions['deflateRaw'];
}

/** Pakiet OOXML z HTML dokumentu. */
export async function docxFromHtml(html: string, o: DocxOptions): Promise<Uint8Array> {
  const numbering = new Numbering();
  const body = blocks(parseHtml(html), {depth: 0, lists: []}, numbering).join('') || '<w:p/>';
  const mark = (text: string) => `<w:r><w:rPr><w:b/><w:caps/></w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r>`;
  // Nagłówek zaczynający się od słowa „Projekt” ma to słowo jako znak, bez powtórzenia („PROJEKT protokołu, …”).
  const merged = !!(o.draft && o.header && /^projekt\s/i.test(o.header));
  const named = merged ? o.header!.slice('Projekt'.length) : o.header;
  const headerXml = (withName: boolean) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Stopka"/></w:pPr>`
    + (o.draft ? mark(withName && o.header ? (merged ? 'Projekt' : 'Projekt   ') : !withName && o.firstHeader ? 'Projekt   ' : 'Projekt') : '')
    + (withName && named ? `<w:r><w:t xml:space="preserve">${x(named)}</w:t></w:r>` : '')
    + (!withName && o.firstHeader ? `<w:r><w:t xml:space="preserve">${x(o.firstHeader)}</w:t></w:r>` : '') + '</w:p></w:hdr>';
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Stopka"/></w:pPr>`
    + (o.footerLeft ? `<w:r><w:t xml:space="preserve">${x(o.footerLeft)}</w:t></w:r>` : '')
    + '<w:r><w:tab/><w:t xml:space="preserve">Strona </w:t></w:r><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> z </w:t></w:r><w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>';
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:headerReference w:type="first" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF"/><w:footerReference w:type="first" r:id="rIdF"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/><w:titlePg/></w:sectPr>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const iso = new Date(o.now).toISOString().replace(/\.\d+Z$/, 'Z');
  const part = (name: string, type: string) => `<Override PartName="/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;
  const files = [
    {name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + part('word/document.xml', 'document.main') + part('word/styles.xml', 'styles') + part('word/numbering.xml', 'numbering') + part('word/header1.xml', 'header') + part('word/header2.xml', 'header') + part('word/footer1.xml', 'footer')
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'},
    {name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'},
    {name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(o.title)}</dc:title><dc:language>pl-PL</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created></cp:coreProperties>`},
    {name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdH1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'},
    {name: 'word/document.xml', data: document},
    {name: 'word/styles.xml', data: STYLES},
    {name: 'word/numbering.xml', data: numbering.xml()},
    {name: 'word/header1.xml', data: headerXml(true)},
    {name: 'word/header2.xml', data: headerXml(false)},
    {name: 'word/footer1.xml', data: footer},
  ];
  return zip(files, {deflateRaw: o.deflateRaw, now: new Date(o.now)});
}
