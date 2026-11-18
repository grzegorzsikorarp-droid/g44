export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);

/** Odmiana rzeczownika po liczebniku: plural(5, 'głos', 'głosy', 'głosów') daje „głosów”. */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10, mod100 = n % 100;
  return n === 1 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

// Zwykły tekst: akapity oddzielone pustym wierszem; wiersz „§ 1” albo „Rozdział I” staje się nagłówkiem.
export function textToHtml(text: string) {
  const heading = /^(§\s*\d+[a-z]?\.?|Rozdział\s+[IVXLC\d]+\.?)$/i;
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const head = heading.test(lines[0].trim()) ? `<h3>${escapeHtml(lines.shift()!.trim())}</h3>\n` : '';
    return head + (lines.length ? `<p>${lines.map(l => escapeHtml(l.trim())).join('<br>')}</p>` : '');
  }).join('\n');
}
