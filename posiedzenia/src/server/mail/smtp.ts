// Klient SMTP na node:net i node:tls, bez zależności (SPEC-4 5.4, B2-P09; wzór proby-B2/smtp.ts).
// Tryby: „tls” (port 465, szyfrowanie od pierwszego bajtu, RFC 8314) i „starttls” (port 587, RFC 3207). Trybu bez
// szyfrowania nie ma. Logowanie AUTH PLAIN (RFC 4616) albo AUTH LOGIN, zawsze dopiero po zestawieniu szyfrowania
// i sprawdzeniu certyfikatu; przy pustym loginie bez AUTH (przekaźnik), nadal tylko po TLS. Hasło ani jego zapis base64
// nie trafiają do żadnego komunikatu ani dziennika. Druga linia obrony (K4-14): każdy argument polecenia (adres w MAIL
// FROM i RCPT TO, login) ze znakiem CR, LF albo NUL jest odrzucany przed wysłaniem, niezależnie od `validAddress`.
import {connect as netConnect, type Socket} from 'node:net';
import {connect as tlsConnect, type TLSSocket} from 'node:tls';

export type Security = 'tls' | 'starttls';
export interface SmtpOptions {
  host: string; port: number; security: Security;
  user?: string; password?: string;
  /** Nazwa w EHLO: domena z adresu aplikacji. */
  clientName: string;
  /** Własny urząd certyfikacji (np. serwer poczty w sieci Izby). Bez tego obowiązuje zaufanie systemowe. */
  ca?: string | Buffer;
  /** Wymuszony sposób logowania (do prób); domyślnie PLAIN, a gdy serwer go nie ma, LOGIN. */
  auth?: 'plain' | 'login';
  timeoutMs?: number;
}
export interface Envelope { from: string; to: string; raw: string }
export interface Step { step: string; ok: boolean; detail: string }

/** Błąd wysyłki: `temporary` mówi, czy warto ponowić; `stage` to etap rozmowy z serwerem. */
export class SmtpError extends Error {
  code: number | null; temporary: boolean; stage: string; reply: string;
  constructor(message: string, o: {code?: number | null; temporary: boolean; stage: string; reply?: string}) {
    super(message);
    this.code = o.code ?? null; this.temporary = o.temporary; this.stage = o.stage; this.reply = (o.reply ?? '').slice(0, 300);
  }
}
interface Reply { code: number; lines: string[] }
const replyText = (r: Reply) => `${r.code} ${r.lines.join(' ')}`.trim();

const certCodes = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_SIGNATURE_FAILURE', 'CERT_REVOKED']);

/** Zamiana błędu sieci albo TLS na komunikat po polsku z oceną, czy ponowienie ma sens. */
function networkError(e: NodeJS.ErrnoException, o: SmtpOptions, stage: string): SmtpError {
  const code = e.code ?? '';
  if (certCodes.has(code) || /certificate/i.test(e.message)) {
    return new SmtpError(`Certyfikat serwera poczty jest nieprawidłowy (${code || 'TLS'}). Aplikacja nie wysłała hasła.`, {temporary: false, stage});
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new SmtpError(`Nie znaleziono serwera poczty ${o.host}. Sprawdź nazwę serwera.`, {temporary: code === 'EAI_AGAIN', stage});
  if (code === 'ECONNREFUSED') return new SmtpError(`Serwer poczty ${o.host} nie przyjmuje połączeń na porcie ${o.port}.`, {temporary: true, stage});
  if (code === 'ETIMEDOUT' || code === 'TIMEOUT') return new SmtpError(`Serwer poczty nie odpowiedział w ciągu ${Math.round((o.timeoutMs ?? 20000) / 1000)} s.`, {temporary: true, stage});
  if (code === 'EPROTO' || /wrong version number|ssl/i.test(e.message)) {
    return new SmtpError(`Nie udało się zestawić szyfrowania. Sprawdź, czy port ${o.port} pasuje do trybu ${o.security === 'tls' ? 'TLS' : 'STARTTLS'}.`, {temporary: false, stage});
  }
  return new SmtpError(`Połączenie z serwerem poczty zostało przerwane (${code || 'błąd sieci'}).`, {temporary: true, stage});
}

/** Czytnik odpowiedzi: wiersze „250-…” są ciągiem dalszym, „250 …” kończy odpowiedź. */
class Wire {
  socket: Socket | TLSSocket;
  private buffer = '';
  private partial: string[] = [];
  private replies: Reply[] = [];
  private waiter: {resolve: (r: Reply) => void; reject: (e: Error) => void} | null = null;
  private failure: Error | null = null;
  private onData = (chunk: Buffer) => {
    this.buffer += chunk.toString('latin1');
    let at: number;
    while ((at = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      const m = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!m) { this.fail(new SmtpError('Serwer poczty odpowiedział w nieznany sposób.', {temporary: true, stage: 'protokol', reply: line})); return; }
      this.partial.push(m[3]);
      if (m[2] !== '-') { this.replies.push({code: Number(m[1]), lines: this.partial}); this.partial = []; }
    }
    this.flush();
  };
  private onError = (e: Error) => this.fail(e);
  private onClose = () => this.fail(new SmtpError('Serwer poczty zakończył połączenie.', {temporary: true, stage: 'polaczenie'}));

  constructor(socket: Socket | TLSSocket) { this.socket = socket; this.attach(); }
  private attach() { this.socket.on('data', this.onData); this.socket.on('error', this.onError); this.socket.on('close', this.onClose); }
  detach() { this.socket.off('data', this.onData); this.socket.off('error', this.onError); this.socket.off('close', this.onClose); }
  replace(socket: TLSSocket) { this.detach(); this.socket = socket; this.attach(); }
  /** Po STARTTLS bufor musi być pusty: dane wysłane przed szyfrowaniem odrzuca się (ochrona przed wstrzyknięciem). */
  get clean() { return this.buffer === '' && this.replies.length === 0 && this.partial.length === 0; }
  private fail(e: Error) { if (!this.failure) this.failure = e; this.flush(); }
  private flush() {
    if (!this.waiter) return;
    const w = this.waiter;
    if (this.replies.length) { this.waiter = null; w.resolve(this.replies.shift()!); }
    else if (this.failure) { this.waiter = null; w.reject(this.failure); }
  }
  read(timeoutMs: number): Promise<Reply> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiter = null; reject(Object.assign(new Error('timeout'), {code: 'TIMEOUT'})); }, timeoutMs);
      this.waiter = {resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); }};
      this.flush();
    });
  }
  write(text: string) { this.socket.write(text, 'latin1'); }
}

/**
 * Jedno połączenie z serwerem poczty. `open()` zestawia szyfrowanie i loguje, `send()` wysyła kolejne wiadomości
 * w tym samym połączeniu (MAIL, RCPT, DATA; po błędzie RSET), `close()` kończy rozmowę.
 */
export class SmtpSession {
  private wire: Wire | null = null;
  private caps = new Map<string, string>();
  readonly steps: Step[] = [];
  private o: SmtpOptions;
  private timeout: number;
  constructor(o: SmtpOptions) { this.o = o; this.timeout = o.timeoutMs ?? 20000; }

  private async cmd(line: string, stage: string, expect: number[], shown = line): Promise<Reply> {
    this.wire!.write(line + '\r\n');
    const r = await this.read(stage);
    if (!expect.includes(r.code)) throw this.replyError(r, stage, shown);
    return r;
  }
  private async read(stage: string) {
    try { return await this.wire!.read(this.timeout); }
    catch (e) { throw e instanceof SmtpError ? e : networkError(e as NodeJS.ErrnoException, this.o, stage); }
  }
  private replyError(r: Reply, stage: string, _shown: string) {
    const temporary = r.code >= 400 && r.code < 500;
    const text = replyText(r);
    const what: Record<string, string> = {
      powitanie: 'Serwer poczty nie przyjął połączenia', ehlo: 'Serwer poczty nie przyjął przywitania', starttls: 'Serwer poczty nie włączył szyfrowania',
      logowanie: r.code === 535 ? 'Serwer poczty odrzucił login lub hasło' : 'Serwer poczty nie przyjął logowania',
      nadawca: 'Serwer poczty nie przyjął adresu nadawcy', odbiorca: 'Serwer poczty nie przyjął adresu odbiorcy', tresc: 'Serwer poczty nie przyjął treści wiadomości',
    };
    return new SmtpError(`${what[stage] ?? 'Serwer poczty odmówił'} (${r.code}).${temporary ? ' Spróbujemy ponownie.' : ''}`, {code: r.code, temporary, stage, reply: text});
  }
  private connectSocket(): Promise<Socket | TLSSocket> {
    const o = this.o;
    return new Promise((resolve, reject) => {
      const s = o.security === 'tls'
        ? tlsConnect({host: o.host, port: o.port, servername: isIp(o.host) ? undefined : o.host, ca: o.ca, minVersion: 'TLSv1.2'})
        : netConnect({host: o.host, port: o.port});
      const timer = setTimeout(() => { s.destroy(); reject(networkError(Object.assign(new Error('timeout'), {code: 'TIMEOUT'}), o, 'polaczenie')); }, this.timeout);
      s.once(o.security === 'tls' ? 'secureConnect' : 'connect', () => { clearTimeout(timer); s.removeAllListeners('error'); resolve(s); });
      s.once('error', e => { clearTimeout(timer); reject(networkError(e as NodeJS.ErrnoException, o, o.security === 'tls' ? 'szyfrowanie' : 'polaczenie')); });
    });
  }
  private async ehlo() {
    const r = await this.cmd(`EHLO ${this.o.clientName}`, 'ehlo', [250]);
    this.caps.clear();
    for (const line of r.lines.slice(1)) { const [k, ...rest] = line.split(' '); this.caps.set(k.toUpperCase(), rest.join(' ').toUpperCase()); }
  }
  private tlsDetail(s: TLSSocket) {
    const cert = s.getPeerCertificate();
    return `${s.getProtocol() ?? 'TLS'}, certyfikat ważny dla ${cert?.subject?.CN ?? this.o.host} do ${cert?.valid_to ?? '?'}`;
  }

  async open(): Promise<void> {
    const o = this.o;
    if (injected(o.user) || injected(o.host)) throw new SmtpError('Login albo serwer poczty zawiera znak nowego wiersza. Aplikacja nie łączy się z serwerem.', {temporary: false, stage: 'logowanie'});
    const socket = await this.connectSocket();
    this.wire = new Wire(socket);
    this.steps.push({step: 'Połączenie', ok: true, detail: `${o.host}:${o.port}`});
    if (o.security === 'tls') this.steps.push({step: 'Szyfrowanie', ok: true, detail: this.tlsDetail(socket as TLSSocket)});
    const hello = await this.read('powitanie');
    if (hello.code !== 220) throw this.replyError(hello, 'powitanie', '');
    await this.ehlo();
    if (o.security === 'starttls') {
      if (!this.caps.has('STARTTLS')) throw new SmtpError('Serwer poczty nie oferuje szyfrowania STARTTLS. Aplikacja nie wysyła hasła bez szyfrowania.', {temporary: false, stage: 'starttls'});
      await this.cmd('STARTTLS', 'starttls', [220]);
      if (!this.wire.clean) throw new SmtpError('Serwer poczty wysłał dane przed włączeniem szyfrowania. Połączenie przerwano.', {temporary: false, stage: 'starttls'});
      const plain = this.wire.socket as Socket;
      this.wire.detach();
      // Nieudane szyfrowanie zamyka połączenie od razu: QUIT bez szyfrowania nie ma sensu i czekałby do upływu czasu.
      const secure = await new Promise<TLSSocket>((resolve, reject) => {
        const s = tlsConnect({socket: plain, servername: isIp(o.host) ? undefined : o.host, ca: o.ca, minVersion: 'TLSv1.2'});
        s.once('secureConnect', () => { s.removeAllListeners('error'); resolve(s); });
        s.once('error', e => { s.destroy(); plain.destroy(); this.wire = null; reject(networkError(e as NodeJS.ErrnoException, o, 'szyfrowanie')); });
      });
      this.wire.replace(secure);
      this.steps.push({step: 'Szyfrowanie', ok: true, detail: `STARTTLS, ${this.tlsDetail(secure)}`});
      await this.ehlo();   // RFC 3207: po STARTTLS przywitanie od nowa, wcześniejsze możliwości serwera nie obowiązują
    }
    if (o.user) {
      const mechs = (this.caps.get('AUTH') ?? '').split(/\s+/);
      const mech = o.auth ?? (mechs.includes('PLAIN') ? 'plain' : mechs.includes('LOGIN') ? 'login' : null);
      if (!mech || !mechs.includes(mech.toUpperCase())) throw new SmtpError('Serwer poczty nie oferuje logowania PLAIN ani LOGIN.', {temporary: false, stage: 'logowanie'});
      const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
      if (mech === 'plain') {
        await this.cmd(`AUTH PLAIN ${b64(`\0${o.user}\0${o.password ?? ''}`)}`, 'logowanie', [235], 'AUTH PLAIN ***');
      } else {
        await this.cmd('AUTH LOGIN', 'logowanie', [334]);
        await this.cmd(b64(o.user), 'logowanie', [334], '***');
        await this.cmd(b64(o.password ?? ''), 'logowanie', [235], '***');
      }
      this.steps.push({step: 'Logowanie', ok: true, detail: `${mech.toUpperCase()}, konto ${o.user}`});
    }
  }

  /** Wysyła jedną wiadomość; po błędzie odbiorcy albo treści czyści stan rozmowy (RSET), żeby połączenie służyło dalej. */
  async send(e: Envelope): Promise<string> {
    if (injected(e.from)) throw new SmtpError('Adres nadawcy zawiera znak nowego wiersza. Wiadomości nie wysłano.', {temporary: false, stage: 'nadawca'});
    if (injected(e.to)) throw new SmtpError('Adres odbiorcy zawiera znak nowego wiersza. Wiadomości nie wysłano.', {temporary: false, stage: 'odbiorca'});
    const size = this.caps.has('SIZE') ? ` SIZE=${Buffer.byteLength(e.raw, 'latin1')}` : '';
    try {
      await this.cmd(`MAIL FROM:<${e.from}>${size}`, 'nadawca', [250]);
      await this.cmd(`RCPT TO:<${e.to}>`, 'odbiorca', [250, 251]);
      await this.cmd('DATA', 'tresc', [354]);
      // Kropka na początku wiersza dostaje drugą kropkę (RFC 5321 rozdz. 4.5.2); koniec to wiersz z samą kropką.
      const body = e.raw.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      this.wire!.write(body + (body.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
      const r = await this.read('tresc');
      if (r.code !== 250) throw this.replyError(r, 'tresc', '');
      return replyText(r);
    } catch (err) {
      if (err instanceof SmtpError && err.code !== null) { try { await this.cmd('RSET', 'rset', [250]); } catch { /* połączenie i tak się zamknie */ } }
      throw err;
    }
  }
  async close() {
    if (!this.wire) return;
    try { await this.cmd('QUIT', 'zakonczenie', [221]); } catch { /* bez znaczenia */ }
    this.wire.socket.end();
    this.wire.detach();
    this.wire = null;
  }
}

const isIp = (h: string) => /^[\d.]+$/.test(h) || h.includes(':');
/** Argument polecenia SMTP ze znakiem nowego wiersza albo NUL (K4-14): wstrzyknięcie polecenia. */
export const injected = (v: string | undefined) => !!v && /[\r\n\0]/.test(v);

/** Wysłanie jednej wiadomości z pełnym przebiegiem (do „Wyślij wiadomość próbną”). */
export async function sendOne(o: SmtpOptions, e: Envelope): Promise<{steps: Step[]; reply?: string; error?: SmtpError}> {
  const s = new SmtpSession(o);
  try {
    await s.open();
    const reply = await s.send(e);
    s.steps.push({step: 'Wysłanie', ok: true, detail: reply});
    return {steps: s.steps, reply};
  } catch (err) {
    const error = err instanceof SmtpError ? err : networkError(err as NodeJS.ErrnoException, o, 'polaczenie');
    s.steps.push({step: stageName[error.stage] ?? 'Wysłanie', ok: false, detail: error.message});
    return {steps: s.steps, error};
  } finally { await s.close(); }
}
const stageName: Record<string, string> = {polaczenie: 'Połączenie', szyfrowanie: 'Szyfrowanie', starttls: 'Szyfrowanie', powitanie: 'Połączenie', ehlo: 'Połączenie', logowanie: 'Logowanie', nadawca: 'Wysłanie', odbiorca: 'Wysłanie', tresc: 'Wysłanie'};
