// Udawany serwer poczty do testów (wzór proby-B2/serwer-testowy.ts): node:net i node:tls, port przydzielany przez system.
// Przyjmuje wiadomości, sprawdza logowanie, zapisuje surową treść i przebieg rozmowy. Zachowanie ustawia się przed
// każdą próbą (`behavior`), np. odrzucenie odbiorcy, brak STARTTLS albo dane wstrzyknięte po STARTTLS.
import {createServer as netServer, type Server, type Socket} from 'node:net';
import {createServer as tlsServer, createSecureContext, TLSSocket} from 'node:tls';

export interface Received { from: string; to: string[]; raw: string; secure: boolean; auth: string | null; mech: string | null }
export interface Behavior {
  starttls?: boolean;            // ogłaszać STARTTLS (domyślnie tak na porcie bez TLS)
  authMechs?: string[];          // domyślnie PLAIN LOGIN
  authBeforeTls?: boolean;       // ogłaszać AUTH przed szyfrowaniem (zły serwer)
  injectAfterStartTls?: boolean; // dopisać odpowiedź do 220 przed szyfrowaniem (próba wstrzyknięcia)
  rcpt?: (to: string, attempt: number) => [number, string] | null;
  data?: (n: number) => [number, string] | null;
}
export class TestSmtp {
  received: Received[] = [];
  transcript: string[] = [];
  behavior: Behavior = {};
  users: Record<string, string>;
  private servers: Server[] = [];
  private context;
  private keyCert: {key: string; cert: string};
  private rcptAttempts = new Map<string, number>();
  private dataCount = 0;
  constructor(o: {key: string; cert: string; users: Record<string, string>}) {
    this.users = o.users;
    this.keyCert = {key: o.key, cert: o.cert};
    this.context = createSecureContext(this.keyCert);
  }
  reset(b: Behavior = {}) { this.received = []; this.transcript = []; this.behavior = b; this.rcptAttempts.clear(); this.dataCount = 0; }

  /** Nasłuch na porcie (0: przydziela system); zwraca numer portu. */
  listen(port: number, implicitTls: boolean): Promise<number> {
    const server = implicitTls
      ? tlsServer(this.keyCert, s => this.session(s, true))
      : netServer(s => this.session(s, false));
    this.servers.push(server);
    return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve((server.address() as {port: number}).port)));
  }
  close() { return Promise.all(this.servers.map(s => new Promise(r => s.close(() => r(null))))); }

  private session(socket: Socket, secureFromStart: boolean) {
    let sock: Socket = socket;
    let secure = secureFromStart;
    let buffer = '';
    let auth: string | null = null, mech: string | null = null;
    let mailFrom = '', rcpt: string[] = [];
    let mode: 'cmd' | 'data' | 'login-user' | 'login-pass' | 'plain' = 'cmd';
    let loginUser = '';
    let dataLines: string[] = [];
    const b = () => this.behavior;
    const say = (text: string) => { this.transcript.push('S: ' + text.split('\r\n')[0]); sock.write(text + '\r\n'); };
    const check = (user: string, pass: string) => {
      if (this.users[user] === pass) { auth = user; say('235 2.7.0 Authentication successful'); }
      else say('535 5.7.8 Authentication credentials invalid');
    };
    const onLine = (line: string) => {
      if (mode === 'data') {
        if (line === '.') {
          mode = 'cmd';
          const raw = dataLines.map(l => l.startsWith('..') ? l.slice(1) : l).join('\r\n') + '\r\n';
          const forced = b().data?.(++this.dataCount);
          if (forced) { say(`${forced[0]} ${forced[1]}`); return; }
          this.received.push({from: mailFrom, to: rcpt, raw, secure, auth, mech});
          say(`250 2.0.0 Ok: queued as T${this.received.length}`);
          mailFrom = ''; rcpt = [];
          return;
        }
        dataLines.push(line);
        return;
      }
      this.transcript.push('C: ' + (/^AUTH /i.test(line) ? line.split(' ').slice(0, 2).join(' ') + ' ***' : mode !== 'cmd' ? '***' : line));
      if (mode === 'login-user') { loginUser = Buffer.from(line, 'base64').toString('utf8'); mode = 'login-pass'; say('334 UGFzc3dvcmQ6'); return; }
      if (mode === 'login-pass') { mode = 'cmd'; check(loginUser, Buffer.from(line, 'base64').toString('utf8')); return; }
      if (mode === 'plain') { mode = 'cmd'; const [, u, p] = Buffer.from(line, 'base64').toString('utf8').split('\0'); check(u, p); return; }
      const [verb, ...rest] = line.split(' ');
      const arg = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO': {
          const caps = ['250-test.localhost witaj ' + arg, '250-SIZE 10485760', '250-8BITMIME'];
          if (!secure && !secureFromStart && b().starttls !== false) caps.push('250-STARTTLS');
          if (secure || b().authBeforeTls) caps.push('250-AUTH ' + (b().authMechs ?? ['PLAIN', 'LOGIN']).join(' '));
          caps.push('250 ENHANCEDSTATUSCODES');
          this.transcript.push('S: 250 (możliwości: ' + caps.map(c => c.slice(4).split(' ')[0]).join(', ') + ')');
          sock.write(caps.join('\r\n') + '\r\n');
          return;
        }
        case 'STARTTLS': {
          if (secure) { say('503 5.5.1 Already in TLS'); return; }
          sock.off('data', onData);
          const extra = b().injectAfterStartTls ? '250 2.0.0 wstrzyknięte\r\n' : '';
          this.transcript.push('S: 220 Ready to start TLS' + (extra ? ' + wstrzyknięta odpowiedź' : ''));
          sock.write('220 2.0.0 Ready to start TLS\r\n' + extra);
          const tlsSock = new TLSSocket(sock, {isServer: true, secureContext: this.context});
          tlsSock.on('secure', () => { secure = true; });
          tlsSock.on('error', () => tlsSock.destroy());
          sock = tlsSock;
          buffer = '';
          sock.on('data', onData);
          return;
        }
        case 'AUTH': {
          const [m, initial] = arg.split(' ');
          mech = m.toUpperCase();
          if (!(b().authMechs ?? ['PLAIN', 'LOGIN']).includes(mech)) { say('504 5.5.4 Unrecognized authentication type'); return; }
          if (mech === 'PLAIN') { if (initial) { const [, u, p] = Buffer.from(initial, 'base64').toString('utf8').split('\0'); check(u, p); } else { mode = 'plain'; say('334 '); } return; }
          mode = 'login-user'; say('334 VXNlcm5hbWU6'); return;
        }
        case 'MAIL': {
          if (!auth) { say('530 5.7.0 Authentication required'); return; }
          mailFrom = /<([^>]*)>/.exec(arg)?.[1] ?? ''; rcpt = []; say('250 2.1.0 Ok'); return;
        }
        case 'RCPT': {
          const to = /<([^>]*)>/.exec(arg)?.[1] ?? '';
          const n = (this.rcptAttempts.get(to) ?? 0) + 1;
          this.rcptAttempts.set(to, n);
          const forced = b().rcpt?.(to, n);
          if (forced) { say(`${forced[0]} ${forced[1]}`); return; }
          rcpt.push(to); say('250 2.1.5 Ok'); return;
        }
        case 'DATA': if (!rcpt.length) { say('554 5.5.1 No valid recipients'); return; } mode = 'data'; dataLines = []; say('354 End data with <CR><LF>.<CR><LF>'); return;
        case 'RSET': mailFrom = ''; rcpt = []; say('250 2.0.0 Ok'); return;
        case 'NOOP': say('250 2.0.0 Ok'); return;
        case 'QUIT': say('221 2.0.0 Bye'); sock.end(); return;
        default: say('502 5.5.2 Command not recognized');
      }
    };
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        onLine(line);
        if (sock !== socket && !secure && buffer) buffer = '';   // dane w buforze po STARTTLS odrzuca też serwer
      }
    };
    sock.on('data', onData);
    sock.on('error', () => sock.destroy());
    say('220 test.localhost ESMTP serwer testowy B2');
  }
}
