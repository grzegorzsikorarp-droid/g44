// Strony materiału tekstowego w pokazie (SPEC-4 B3-21, B3-25): porcje kolejnych bloków najwyższego poziomu (`p`, `h1`–`h6`,
// `ul`, `ol`, `table`, `blockquote`) do około 700 znaków; nagłówek zawsze zaczyna nową porcję; blok dłuższy niż porcja
// stoi sam. Jedna funkcja w kliencie, więc ta sama wersja materiału daje te same strony na sali, w panelu i na telefonach.
// `pageBlocks` jest czystą funkcją (test tests/show-pages.test.ts), a `htmlPages` czyta HTML przez `DOMParser`.

/** Około tylu znaków tekstu ma jedna strona materiału tekstowego (B3-21). */
export const PAGE_CHARS = 700;
export interface PageBlock { tag: string; html: string; text: string }
const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote']);
const heading = (tag: string) => /^h[1-6]$/.test(tag);

/** Podział bloków na strony; zwraca HTML kolejnych stron (co najmniej jedną, także dla pustego materiału). */
export function pageBlocks(blocks: PageBlock[], max = PAGE_CHARS): string[] {
  const pages: string[] = [];
  let html = '', size = 0;
  const flush = () => { if (html) pages.push(html); html = ''; size = 0; };
  for (const b of blocks) {
    const len = b.text.replace(/\s+/g, ' ').trim().length;
    if (heading(b.tag) || (size > 0 && size + len > max)) flush();
    html += b.html;
    size += len;
    if (size >= max) flush();
  }
  flush();
  return pages.length ? pages : [''];
}

/** Strony materiału tekstowego z jego HTML (bloki najwyższego poziomu; inne elementy trafiają do bieżącej strony). */
export function htmlPages(html: string, max = PAGE_CHARS): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: PageBlock[] = [];
  for (const node of [...doc.body.childNodes]) {
    if (node.nodeType === 3) { const text = node.textContent ?? ''; if (text.trim()) blocks.push({tag: 'p', html: `<p>${text.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'})[c]!)}</p>`, text}); continue; }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    blocks.push({tag: BLOCKS.has(tag) ? tag : 'p', html: el.outerHTML, text: el.textContent ?? ''});
  }
  return pageBlocks(blocks, max);
}
