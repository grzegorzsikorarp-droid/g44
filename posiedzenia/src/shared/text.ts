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

// Wersja 3: daty, godziny i liczebniki w tekstach domeny (dziennik, historia zmian, linie źródła). Strefa Europe/Warsaw.
const zone = 'Europe/Warsaw';
/** „03.12.2026” z daty RRRR-MM-DD; pusty napis bez daty. */
export const dateDots = (iso: string | null | undefined) => iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : '';
/** „03.12.2026” z chwili (milisekundy). */
export const dateDotsOf = (ts: number) => new Intl.DateTimeFormat('pl-PL', {timeZone: zone, day: '2-digit', month: '2-digit', year: 'numeric'}).format(ts);
/** Dzień RRRR-MM-DD z chwili (milisekundy). */
export const isoDayOf = (ts: number) => new Intl.DateTimeFormat('sv-SE', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(ts);
/** „11:15” z chwili (milisekundy). */
export const timeOf = (ts: number) => new Intl.DateTimeFormat('pl-PL', {timeZone: zone, hour: '2-digit', minute: '2-digit'}).format(ts);
/** „19 listopada 2026 r., godz. 18:00”. */
export function dateTimeText(ts: number) {
  const date = new Intl.DateTimeFormat('pl-PL', {timeZone: zone, day: 'numeric', month: 'long', year: 'numeric'}).format(ts);
  return `${date} r., godz. ${timeOf(ts)}`;
}
/** Liczba minut w przypadku: „2 minuty” (mianownik), „z 2 minut” (dopełniacz), „na 1 minutę” (biernik). */
export function minutesText(n: number, form: 'mianownik' | 'dopelniacz' | 'biernik' = 'mianownik') {
  if (form === 'dopelniacz') return `${n} ${n === 1 ? 'minuty' : 'minut'}`;
  return `${n} ${n === 1 ? (form === 'biernik' ? 'minutę' : 'minuta') : plural(n, 'minuta', 'minuty', 'minut')}`;
}
/** „24 godziny”, „1 godzina”, „36 godzin”. */
export const hoursText = (n: number) => `${n} ${plural(n, 'godzina', 'godziny', 'godzin')}`;
