export const escapeHtml = (s: string) => s.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);

// Zwykły tekst: akapity oddzielone pustym wierszem; wiersz „§ 1” albo „Rozdział I” staje się nagłówkiem.
export function textToHtml(text: string) {
  const heading = /^(§\s*\d+[a-z]?\.?|Rozdział\s+[IVXLC\d]+\.?)$/i;
  return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const head = heading.test(lines[0].trim()) ? `<h3>${escapeHtml(lines.shift()!.trim())}</h3>\n` : '';
    return head + (lines.length ? `<p>${lines.map(l => escapeHtml(l.trim())).join('<br>')}</p>` : '');
  }).join('\n');
}
