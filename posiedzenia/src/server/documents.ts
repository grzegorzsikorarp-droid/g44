import {createHash} from 'node:crypto';
import mammoth from 'mammoth';
import {marked} from 'marked';
import sanitizeHtml from 'sanitize-html';
import {parseDocument} from 'htmlparser2';
import {render} from 'dom-serializer';
import {textContent} from 'domutils';
import type {MaterialType} from '../shared/types.ts';

// Lekki HTML do czytania na telefonie: sama struktura dokumentu, bez czcionek, obrazów i stylów.
const options: sanitizeHtml.IOptions = {
  allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 'u', 's', 'sup', 'sub', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr', 'a'],
  allowedAttributes: {a: ['href'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start', 'type']},
  allowedSchemes: ['https', 'mailto'],
  transformTags: {b: 'strong', i: 'em', h1: 'h2'},
  exclusiveFilter: frame => ['p', 'li', 'strong', 'em'].includes(frame.tag) && !frame.text.trim(),
};
export const cleanHtml = (html: string) => sanitizeHtml(html, options).replace(/\n{3,}/g, '\n\n').trim();
export const htmlHash = (html: string) => createHash('sha256').update(html).digest('hex');
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);

// Akapit zawierający tylko „§ 1” (zwykle wyśrodkowany i pogrubiony w Wordzie) staje się nagłówkiem.
const paragraphHeadings = (html: string) => html.replace(/<p>(?:<strong>)?\s*(§\s*\d+[a-z]?\.?)\s*(?:<\/strong>)?<\/p>/g, '<h3>$1</h3>');

export async function docxToHtml(buffer: Buffer) {
  const result = await mammoth.convertToHtml({buffer}, {ignoreEmptyParagraphs: true});
  return paragraphHeadings(cleanHtml(result.value));
}
export const markdownToHtml = (text: string) => cleanHtml(marked.parse(text, {async: false}) as string);
// Zwykły tekst: akapity oddzielone pustym wierszem; wiersz „§ 1” albo „Rozdział I” staje się nagłówkiem.
export function textToHtml(text: string) {
  const heading = /^(§\s*\d+[a-z]?\.?|Rozdział\s+[IVXLC\d]+\.?)$/i;
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const head = heading.test(lines[0].trim()) ? `<h3>${escape(lines.shift()!.trim())}</h3>\n` : '';
    return head + (lines.length ? `<p>${lines.map(l => escape(l.trim())).join('<br>')}</p>` : '');
  }).join('\n');
}

const actPattern = /^(uchwała|stanowisko|apel|rezolucja|oświadczenie|deklaracja)\s+nr\.?\s*(\S+(?:\s+\S+)?)/iu;
const typeOf: Record<string, MaterialType> = {uchwała: 'uchwala', stanowisko: 'oswiadczenie', oświadczenie: 'oswiadczenie', apel: 'apel', rezolucja: 'rezolucja', deklaracja: 'deklaracja'};

// Plik z kilkoma aktami (np. 12 uchwał PWZ w jednym DOCX) dzieli się na osobne projekty
// w miejscach, gdzie akapit zaczyna się od „Uchwała nr …” (także stanowisko, apel itd.).
export function splitActs(html: string) {
  const doc = parseDocument(html);
  const blocks = doc.children.map(node => ({node, text: textContent(node).replace(/\s+/g, ' ').trim()}));
  const starts = blocks.map((b, i) => (b.text.length < 200 && actPattern.test(b.text) ? i : -1)).filter(i => i >= 0);
  if (starts.length < 2) return [];
  return starts.map((start, k) => {
    const segment = blocks.slice(start, starts[k + 1] ?? blocks.length);
    const head = segment[0].text.match(actPattern)!;
    const subject = segment.slice(1, 7).find(b => /^w sprawie\b/i.test(b.text))?.text;
    const heading = segment[0].text.replace(/\s+/g, ' ');
    const title = (subject ? `${heading} ${subject}` : heading).slice(0, 300);
    return {
      title, number: head[2].replace(/[,;:.]$/, ''), type: typeOf[head[1].toLowerCase()] ?? 'inny',
      html: cleanHtml(segment.map(b => render(b.node)).join('\n')),
    };
  });
}

export function guessType(title: string): MaterialType {
  const m = title.trim().toLowerCase().match(/^(uchwała|stanowisko|apel|rezolucja|oświadczenie|deklaracja|sprawozdanie|protokół|informacja)/u);
  if (!m) return 'inny';
  return ({sprawozdanie: 'sprawozdanie', protokół: 'protokol', informacja: 'informacja'} as Record<string, MaterialType>)[m[1]] ?? typeOf[m[1]] ?? 'inny';
}
