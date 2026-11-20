// Budowa wiadomości e-mail bez zależności (SPEC-4 5.4, B2-P10; wzór proby-B2/mime.ts).
// RFC 5322 (nagłówki, Date, Message-ID), RFC 2045–2047 (MIME, quoted-printable, base64, słowa zakodowane),
// RFC 2046 (multipart/alternative: najpierw tekst, na końcu HTML), RFC 3834 (Auto-Submitted).
// Cała wiadomość jest 7-bitowa (same znaki ASCII), więc serwer nie musi obsługiwać 8BITMIME ani SMTPUTF8.
import {randomBytes} from 'node:crypto';
import {validAddress} from '../../shared/mail.ts';

export interface Address { name?: string; address: string }
export interface Mail {
  from: Address; to: Address; replyTo?: Address;
  subject: string; text: string; html: string;
  /** Dodatkowe nagłówki (np. X-Posiedzenia-Wysylka). Wartości tylko ASCII. */
  headers?: [string, string][];
}
export interface Built { raw: string; messageId: string; date: string }

const CRLF = '\r\n';
/** Najdłuższy wiersz nagłówka ze słowem zakodowanym (RFC 2047 rozdz. 2). */
const MAX_LINE = 76;
const ASCII_TEXT = /^[\x20-\x7e]*$/;
const SPECIALS = /[()<>\[\]:;@\\,."]/;

/** Adres e-mail według K4-14 (jedna reguła dla domeny, serwera i wersji próbnej). */
export {validAddress};

/** Usuwa znaki sterujące (ochrona przed wstrzyknięciem nagłówka) i zbędne spacje. */
const clean = (s: string) => s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Słowa zakodowane =?UTF-8?B?…?= podzielone na granicach znaków. `first` to miejsce w pierwszym wierszu (po nazwie
 * nagłówka), kolejne wiersze zaczynają się spacją. Każdy wiersz ma najwyżej 76 znaków.
 */
function encodedWords(text: string, first: number): string[] {
  const words: string[] = [];
  let room = first;
  let chunk: number[] = [];
  const limit = () => Math.floor((room - 12) / 4) * 3;   // 12 znaków narzutu „=?UTF-8?B?” i „?=”, base64 w czwórkach
  for (const ch of text) {
    const bytes = [...Buffer.from(ch, 'utf8')];
    if (chunk.length + bytes.length > limit()) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
      chunk = [];
      room = MAX_LINE - 1;
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`);
  return words;
}

/** Nagłówek z tekstem (Subject): ASCII bez zawijania, inaczej słowa zakodowane w wierszach do 76 znaków. */
export function textHeader(name: string, value: string): string {
  const v = clean(value);
  if (ASCII_TEXT.test(v) && name.length + 2 + v.length <= MAX_LINE) return `${name}: ${v}`;
  return `${name}: ` + encodedWords(v, MAX_LINE - name.length - 2).join(CRLF + ' ');
}

/** Nagłówek z adresem (From, To, Reply-To): nazwa w cudzysłowie albo w słowach zakodowanych, adres w <…>. */
export function addressHeader(name: string, a: Address): string {
  if (!validAddress(a.address)) throw new Error(`Nieprawidłowy adres e-mail w nagłówku ${name}.`);
  const display = a.name ? clean(a.name) : '';
  const angle = `<${a.address}>`;
  if (!display) return `${name}: ${angle}`;
  if (ASCII_TEXT.test(display)) {
    const quoted = SPECIALS.test(display) ? `"${display.replace(/["\\]/g, '\\$&')}"` : display;
    const line = `${name}: ${quoted} ${angle}`;
    if (line.length <= MAX_LINE) return line;
  }
  const words = encodedWords(display, MAX_LINE - name.length - 2);
  const lines = [`${name}: ${words[0]}`, ...words.slice(1).map(w => ' ' + w)];
  const last = lines.length - 1;
  if (lines[last].length + 1 + angle.length <= MAX_LINE) lines[last] += ' ' + angle;
  else lines.push(' ' + angle);
  return lines.join(CRLF);
}

const hex = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

/** Quoted-printable (RFC 2045 rozdz. 6.7): wiersze do 76 znaków z miękkim złamaniem „=”, spacja na końcu jako =20. */
export function quotedPrintable(text: string): string {
  return text.replace(/\r\n|\r|\n/g, '\n').split('\n').map(line => {
    const bytes = Buffer.from(line, 'utf8');
    const tokens: string[] = [];
    bytes.forEach((b, i) => {
      const last = i === bytes.length - 1;
      if ((b === 0x20 || b === 0x09) && !last) tokens.push(String.fromCharCode(b));
      else if (b >= 33 && b <= 126 && b !== 61) tokens.push(String.fromCharCode(b));
      else tokens.push('=' + hex(b));
    });
    const out: string[] = [];
    let current = '';
    for (const t of tokens) {
      if (current.length + t.length > MAX_LINE - 1) { out.push(current + '='); current = ''; }
      current += t;
    }
    out.push(current);
    return out.join(CRLF);
  }).join(CRLF);
}

/** Base64 w wierszach po 76 znaków (RFC 2045 rozdz. 6.8). */
export function base64Lines(text: string): string {
  const b = Buffer.from(text.replace(/\r\n|\r|\n/g, CRLF), 'utf8').toString('base64');
  return b.match(/.{1,76}/g)?.join(CRLF) ?? '';
}

/** Data w formacie RFC 5322 w strefie Europe/Warsaw, np. „Fri, 20 Nov 2026 16:05:07 +0100”. */
export function mailDate(d: Date, timeZone = 'Europe/Warsaw'): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
  }).formatToParts(d).map(p => [p.type, p.value]));
  const zone = parts.timeZoneName === 'GMT' ? '+0000' : parts.timeZoneName.replace('GMT', '').replace(':', '');
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${zone}`;
}

/** Message-ID z domeną nadawcy: <czas.losowe@domena>. */
export const newMessageId = (domain: string) => `<${Date.now().toString(36)}.${randomBytes(12).toString('base64url')}@${domain}>`;

/**
 * Pełna wiadomość: nagłówki, multipart/alternative z wersją tekstową (quoted-printable) i HTML (base64).
 * Jedna wiadomość ma jednego odbiorcę: adresy innych osób nie trafiają do nagłówków (minimalizacja danych).
 */
export function buildMessage(mail: Mail, now = new Date(), messageId?: string): Built {
  const domain = mail.from.address.split('@')[1];
  const id = messageId ?? newMessageId(domain);
  const date = mailDate(now);
  const boundary = '=_' + randomBytes(12).toString('hex');   // „=_” nie występuje w quoted-printable ani w base64
  const headers = [
    addressHeader('From', mail.from),
    addressHeader('To', mail.to),
    ...(mail.replyTo ? [addressHeader('Reply-To', mail.replyTo)] : []),
    textHeader('Subject', mail.subject),
    `Date: ${date}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    'Content-Language: pl',
    'Auto-Submitted: auto-generated',
    'X-Auto-Response-Suppress: All',
    ...(mail.headers ?? []).map(([k, v]) => { if (!/^[A-Za-z0-9-]+$/.test(k) || !ASCII_TEXT.test(v)) throw new Error('Nieprawidłowy nagłówek.'); return `${k}: ${v}`; }),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    'This is a multi-part message in MIME format.',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    quotedPrintable(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(mail.html),
    `--${boundary}--`,
    '',
  ];
  return {raw: headers.join(CRLF) + CRLF + CRLF + body.join(CRLF), messageId: id, date};
}
