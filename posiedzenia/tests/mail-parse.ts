// Niezależny odczyt wiadomości do testów (wzór proby-B2/parse.ts), inny kod niż src/server/mail/mime.ts.

export interface Parsed { headers: Map<string, string>; rawHeaders: string[]; text: string; html: string; problems: string[] }

/** Słowa zakodowane RFC 2047 (B i Q); odstępy między sąsiednimi słowami znikają, bajty sąsiednich słów łączą się. */
export function decodeWords(value: string): string {
  const re = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  const pieces: (string | Buffer)[] = [];
  let last = 0, m: RegExpExecArray | null, prevWord = false;
  while ((m = re.exec(value))) {
    const between = value.slice(last, m.index);
    if (!(prevWord && /^\s*$/.test(between))) pieces.push(between);
    const bytes = m[2].toUpperCase() === 'B' ? Buffer.from(m[3], 'base64')
      : Buffer.from(m[3].replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
    if (m[1].toLowerCase() !== 'utf-8') throw new Error('Nieoczekiwany zestaw znaków ' + m[1]);
    pieces.push(bytes);
    last = re.lastIndex; prevWord = true;
  }
  pieces.push(value.slice(last));
  // Sąsiednie bufory łączymy przed odczytem UTF-8.
  const out: string[] = [];
  let acc: Buffer[] = [];
  for (const p of pieces) {
    if (typeof p === 'string') { if (acc.length) { out.push(Buffer.concat(acc).toString('utf8')); acc = []; } out.push(p); }
    else acc.push(p);
  }
  if (acc.length) out.push(Buffer.concat(acc).toString('utf8'));
  return out.join('');
}

function splitHead(block: string) {
  const at = block.indexOf('\r\n\r\n');
  const head = block.slice(0, at), body = block.slice(at + 4);
  const rawHeaders = head.split('\r\n');
  const unfolded = head.replace(/\r\n([ \t])/g, '$1').split('\r\n');
  const headers = new Map<string, string>();
  for (const line of unfolded) { const i = line.indexOf(':'); headers.set(line.slice(0, i).toLowerCase(), line.slice(i + 1).trim()); }
  return {headers, rawHeaders, body};
}
const qpDecode = (s: string) => {
  const soft = s.replace(/=\r\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i++) {
    if (soft[i] === '=' ) { bytes.push(parseInt(soft.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(soft.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
};

export function parse(raw: string): Parsed {
  const problems: string[] = [];
  if (/[^\x00-\x7f]/.test(raw)) problems.push('wiadomość ma bajty spoza ASCII');
  if (/(^|[^\r])\n/.test(raw) || /\r(?!\n)/.test(raw)) problems.push('samotny znak LF albo CR');
  raw.split('\r\n').forEach((l, i) => { if (l.length > 998) problems.push(`wiersz ${i + 1} dłuższy niż 998 znaków`); });
  const top = splitHead(raw);
  top.rawHeaders.forEach(l => { if (l.length > 78) problems.push(`wiersz nagłówka dłuższy niż 78 znaków: ${l.slice(0, 30)}…`); });
  const boundary = /boundary="([^"]+)"/.exec(top.headers.get('content-type') ?? '')?.[1];
  if (!boundary) throw new Error('Brak granicy części');
  const parts = top.body.split(`--${boundary}`).slice(1, -1).map(p => splitHead(p.replace(/^\r\n/, '')));
  let text = '', html = '';
  for (const p of parts) {
    const type = p.headers.get('content-type') ?? '', cte = (p.headers.get('content-transfer-encoding') ?? '').toLowerCase();
    const content = p.body.replace(/\r\n$/, '');
    const decoded = cte === 'quoted-printable' ? qpDecode(content) : cte === 'base64' ? Buffer.from(content.replace(/\r\n/g, ''), 'base64').toString('utf8') : content;
    if (type.startsWith('text/plain')) text = decoded; else if (type.startsWith('text/html')) html = decoded;
    if (!/charset=utf-8/i.test(type)) problems.push('część bez charset=utf-8');
  }
  const headers = new Map([...top.headers].map(([k, v]) => [k, decodeWords(v)]));
  return {headers, rawHeaders: top.rawHeaders, text, html, problems};
}
