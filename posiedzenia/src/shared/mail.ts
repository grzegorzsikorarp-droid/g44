import type {AccountKind, Actor, Meeting, Roster} from './types.ts';
import type {Allowed} from './law.ts';
import {canSendAfter, canSendProgress, canFile, isCommsAccount, isService, organRoster} from './role.ts';
import {personName} from './roster.ts';
import {timeOf} from './text.ts';

// Poczta e-mail wersji 4 (SPEC-4 2.1, 3.4 G-19–G-21 i G-32, 5.4; B2-P01–P18). Reguły w jednym miejscu: serwer
// (src/server/mail/*) i wersja próbna wołają te same funkcje, więc podgląd, adresaci i odmowy są takie same.

export type MailKind = 'postep' | 'po_posiedzeniu' | 'komunikacja' | 'protokol' | 'zawiadomienie' | 'kod' | 'zmiana_adresu' | 'proba';
/** Rodzaje z wstępem ustawianym przez biuro (U-37); pozostałe mają stałą treść. */
export type MailIntroKind = 'postep' | 'po_posiedzeniu';
/** Ustawienia „Poczta e-mail” (B2-P12, U-36). Hasło nigdy tutaj: tylko w środowisku serwera (DB-17). */
export interface MailSettings {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls'; user: string;
  fromAddress: string; fromName: string; replyTo: string; privacyUrl: string; controller: string;
  intros: Partial<Record<MailIntroKind, string>>;
}
/** Preferencje osoby (U-46): domyślnie obie wiadomości włączone, „Pokazuj innym, że oglądam …” (dodatek D-9) wyłączone. */
export interface MailPrefs { postep: boolean; po_posiedzeniu: boolean; showPresence: boolean }
export type EmailState = 'brak' | 'niepotwierdzony' | 'potwierdzony';
/** Kontakt konta: tylko serwer i wersja próbna, nigdy sesja innych osób ani widok posiedzenia (DB-19). */
export interface AccountContact { accountId: string; personId: string | null; name: string; kind: AccountKind; email: string | null; emailState: EmailState; prefs: MailPrefs; disabled?: boolean }
export interface MailRecipientRow { accountId: string; name: string; state: 'wysle' | 'brak_adresu' | 'niepotwierdzony' | 'wylaczone' }

/** Rodzaje wiadomości (B2-P02); `service`: wiadomość służbowa, bez rezygnacji (preferencje jej nie wyłączają). */
export const MAIL_KINDS: Record<MailKind, {label: string; service: boolean}> = {
  postep: {label: 'Informacja o postępie', service: false},
  po_posiedzeniu: {label: 'Dokumenty po posiedzeniu', service: false},
  komunikacja: {label: 'Materiał dla komunikacji gotowy', service: false},
  protokol: {label: 'Protokół do wglądu', service: true},
  zawiadomienie: {label: 'Zawiadomienie', service: true},
  kod: {label: 'Kod potwierdzenia', service: true},
  zmiana_adresu: {label: 'Zmiana adresu', service: true},
  proba: {label: 'Wiadomość próbna', service: true},
};
/** Wstępy domyślne (U-37, rozdz. 6.7.2). */
export const DEFAULT_INTROS: Record<MailIntroKind, string> = {
  postep: 'Przesyłam informację o stanie przygotowań posiedzenia.',
  po_posiedzeniu: 'Dokumenty z posiedzenia są dostępne w aplikacji.',
};
export const defaultMailSettings: MailSettings = {
  enabled: false, host: '', port: 465, security: 'tls', user: '', fromAddress: '', fromName: '', replyTo: '', privacyUrl: '', controller: '',
  intros: {...DEFAULT_INTROS},
};
export const defaultPrefs: MailPrefs = {postep: true, po_posiedzeniu: true, showPresence: false};
/** Preferencje z zapisu (`users.prefs`): brak pola wiadomości to `true`, brak `showPresence` to `false` (2.2, K4-30). */
export function prefsOf(raw: unknown): MailPrefs {
  let v: Partial<MailPrefs> = {};
  if (typeof raw === 'string') { try { v = JSON.parse(raw || '{}') ?? {}; } catch { v = {}; } }
  else if (raw && typeof raw === 'object') v = raw as Partial<MailPrefs>;
  return {postep: v.postep !== false, po_posiedzeniu: v.po_posiedzeniu !== false, showPresence: v.showPresence === true};
}
/** Ustawienia poczty z wartościami domyślnymi dla brakujących pól (dane sprzed wersji 4 i zapisy częściowe). */
export const mailSettingsOf = (s: Partial<MailSettings> | undefined): MailSettings => ({...defaultMailSettings, ...(s ?? {}), intros: {...DEFAULT_INTROS, ...(s?.intros ?? {})}});

/** Stałe techniczne poczty (rozdz. 3.3: nie są ustawieniami). */
export const MAIL_LIMITS = {progressMinutes: 60, codeMinutes: 30, codeAttempts: 5, codesPerHour: 3, testsPerHour: 10, introMax: 1500, fromNameMax: 80} as const;

/** Znak nowego wiersza albo NUL w argumencie polecenia SMTP (K4-14, druga linia obrony w smtp.ts). */
export const hasLineBreak = (text: string) => /[\r\n\0]/.test(text);
/**
 * Adres e-mail (K4-14): tylko znaki 0x21–0x7E bez < > ( ) [ ] \ , ; : " i spacji, dokładnie jedna „@”, część lokalna
 * 1–64 znaków bez kropki na początku, na końcu i dwóch obok siebie, domena z co najmniej jedną kropką, etykiety 1–63 znaków
 * z liter ASCII, cyfr i łączników, bez łącznika na brzegu, całość do 254 znaków.
 */
export function validAddress(text: string): boolean {
  if (typeof text !== 'string' || !text || text.length > 254) return false;
  if (!/^[\x21-\x7e]+$/.test(text) || /[<>()[\]\\,;:"]/.test(text)) return false;
  const parts = text.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length < 1 || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;
  return labels.every(l => l.length >= 1 && l.length <= 63 && /^[A-Za-z0-9-]+$/.test(l) && !l.startsWith('-') && !l.endsWith('-'));
}
export const ADDRESS_REFUSAL = 'Wpisz poprawny adres e-mail, bez polskich znaków, spacji i nawiasów.';

/** Środowisko serwera dla G-19: hasło ustawione, jedyny dozwolony serwer poczty, adres aplikacji. */
export interface MailEnv { passwordSet: boolean; hostAllowed: string | null; appUrl: string }
const listing = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} i ${items[items.length - 1]}`;
/** Ten sam serwer poczty co w `SMTP_HOST_ALLOWED` (bez wielkości liter i kropki na końcu). */
export const hostMatches = (host: string, allowed: string | null) => !!allowed && host.trim().toLowerCase().replace(/\.$/, '') === allowed.trim().toLowerCase().replace(/\.$/, '');
/**
 * Strażnik ustawień poczty (G-19–G-21). Zwraca listę komunikatów; pusta lista to poprawne ustawienia. Brakujące pozycje
 * przy włączonej poczcie składają się w jeden komunikat G-19.
 */
export function validateMail(s: MailSettings, env: MailEnv): string[] {
  const out: string[] = [];
  if (s.security !== 'tls' && s.security !== 'starttls') out.push('Wybierz szyfrowanie TLS albo STARTTLS.');
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) out.push('Port musi być liczbą od 1 do 65535.');
  for (const a of [s.fromAddress, s.replyTo]) if (a && !validAddress(a)) { out.push(ADDRESS_REFUSAL); break; }
  if (s.user && hasLineBreak(s.user)) out.push('Login nie może zawierać znaku nowego wiersza.');
  if ((s.fromName ?? '').length > MAIL_LIMITS.fromNameMax) out.push('Nazwa nadawcy może mieć najwyżej 80 znaków.');
  for (const kind of ['postep', 'po_posiedzeniu'] as MailIntroKind[]) {
    const text = s.intros[kind] ?? DEFAULT_INTROS[kind];
    if (text.length > MAIL_LIMITS.introMax) { out.push('Wstęp może mieć najwyżej 1500 znaków.'); break; }
    if (!text.trim()) { out.push('Wpisz wstęp tej wiadomości.'); break; }
  }
  if (s.enabled) {
    const missing: string[] = [];
    if (!s.host.trim()) missing.push('serwera poczty');
    if (!s.port) missing.push('portu');
    if (!s.fromAddress || !validAddress(s.fromAddress)) missing.push('adresu nadawcy');
    if (!/^https:\/\/\S+$/.test(s.privacyUrl)) missing.push('adresu informacji o przetwarzaniu danych z https');
    if (!/^https:\/\//.test(env.appUrl)) missing.push('adresu aplikacji z https na serwerze');
    if (!hostMatches(s.host, env.hostAllowed)) missing.push('zgody serwera aplikacji na ten serwer poczty');
    if (s.user && !env.passwordSet) missing.push('hasła na serwerze aplikacji');
    if (missing.length) out.push(`Poczty nie można włączyć. Brakuje ${listing(missing)}.`);
  }
  return out;
}

/** Posiedzenie w obradach: od otwarcia do zamknięcia (od rozpoczęcia do zakończenia głosowania między posiedzeniami). */
export const inSession = (m: Pick<Meeting, 'status'>) => m.status === 'trwa' || m.status === 'przerwa';
/**
 * Kto i kiedy wysyła wiadomość o posiedzeniu (G-32, B2-P03, B2-P17). Kolejność: poczta włączona, nic w trakcie obrad,
 * nadawca według rodzaju, informacja o postępie tylko w przygotowaniu i najwyżej co 60 minut na posiedzenie.
 * `enabled` to włączona poczta (ustawienia i `MAIL_OFF`); bez niego odmowa z pierwszego komunikatu.
 */
export function canSendMail(kind: MailKind, roster: Roster, m: Meeting, a: Actor, o: {now: number; lastProgressAt: number | null; enabled?: boolean}): Allowed & {status?: number} {
  if (o.enabled === false) return {allowed: false, reason: 'Poczta jest wyłączona. Włącza ją biuro w ustawieniach ogólnych.', status: 409};
  if (inSession(m)) return {allowed: false, reason: 'Posiedzenie trwa. Wiadomość wyślesz po zamknięciu.', status: 409};
  if (kind === 'postep') {
    if (m.status !== 'przygotowanie') return {allowed: false, reason: 'Informację o postępie wysyła się w przygotowaniu posiedzenia.', status: 409};
    if (!canSendProgress(roster, m, a)) return {allowed: false, reason: 'Informację o postępie wysyła osoba, która przygotowuje posiedzenie.', status: 403};
    const every = MAIL_LIMITS.progressMinutes * 60000;
    if (o.lastProgressAt !== null && o.now - o.lastProgressAt < every) {
      return {allowed: false, reason: `Informację o postępie wysłano o godz. ${timeOf(o.lastProgressAt)}. Kolejną można wysłać po godz. ${timeOf(o.lastProgressAt + every)}.`, status: 409};
    }
    return {allowed: true, basis: '§ 23'};
  }
  if (kind === 'po_posiedzeniu') {
    if (m.status !== 'zakonczone') return {allowed: false, reason: 'Powiadomienie o dokumentach wysyła się po zamknięciu posiedzenia.', status: 409};
    if (!canSendAfter(roster, m, a)) return {allowed: false, reason: 'Powiadomienie o dokumentach wysyła biuro, przewodniczący albo osoba, która zamknęła obrady.', status: 403};
    return {allowed: true, basis: '§ 13'};
  }
  if (kind === 'protokol') {
    if (!canFile(roster, m, a)) return {allowed: false, reason: 'Dokumenty po posiedzeniu dołącza biuro, przewodniczący albo sekretarz.', status: 403};
    if (!m.minutesReady) return {allowed: false, reason: 'Wiadomość „Protokół do wglądu” wychodzi po wpisaniu, kto i kiedy sporządził protokół.', status: 409};
    return {allowed: true, basis: '§ 13 ust. 2'};
  }
  return {allowed: false, reason: 'Tej wiadomości nie wysyła się z posiedzenia.', status: 400};
}

/**
 * Podgląd „Protokół do wglądu” przed zapisem faktu (W-5, zasada 0.2 pkt 4): okno „Protokół sporządzony” przysyła szkic
 * `{date, authorPersonId}`, z którego powstaje kopia posiedzenia z faktem tylko do zbudowania treści. Nic się nie zapisuje,
 * a wysyłka nadal wymaga zapisanego faktu (`canSendMail`). Szkic niepełny albo z osobą spoza składu daje `null`.
 */
export function minutesDraft(m: Meeting, roster: Roster, draft: unknown): Meeting | null {
  if (!draft || typeof draft !== 'object' || m.status !== 'zakonczone') return null;
  const d = draft as {date?: unknown; authorPersonId?: unknown};
  const date = typeof d.date === 'string' ? d.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = organRoster(roster, m).find(x => x.personId === d.authorPersonId);
  if (!ms) return null;
  return {...m, minutesReady: {date, author: {personId: ms.personId, name: personName(roster, ms.personId), func: ms.label}, at: 0, by: '', accountId: ''}};
}

/**
 * Adresaci wysyłki (B2-P02, B2-P04, 6.7.1): członkowie organu według bieżącego składu (wszyscy albo wybrani), do tego
 * nieobowiązkowo konta biura. Wiadomość informacyjna idzie tylko na adres potwierdzony i tylko do osób, które z niej nie
 * zrezygnowały; służbowa na każdy adres potwierdzony. Wiersz mówi, dlaczego osoba nie dostanie wiadomości, bez adresu.
 * Grupa „Osoby z otwartymi zadaniami” należy do dodatku D-11 (w rdzeniu daje pustą listę).
 */
export function mailRecipients(kind: MailKind, roster: Roster, m: Meeting | null, contacts: AccountContact[],
  choice: {group: 'wszyscy' | 'zadania' | 'wybrani'; ids?: string[]; office?: boolean; comms?: boolean}, _ws?: unknown): MailRecipientRow[] {
  const organ = m?.organ ?? 'prezydium';
  const members = organRoster(roster, m ?? {organ}).map(ms => ms.personId);
  const active = contacts.filter(c => !c.disabled);
  let list: AccountContact[] = [];
  if (choice.group === 'wszyscy') list = members.map(pid => active.find(c => c.personId === pid)).filter((c): c is AccountContact => !!c);
  else if (choice.group === 'wybrani') {
    const ids = new Set(choice.ids ?? []);
    list = active.filter(c => ids.has(c.accountId) && (c.kind === 'biuro' || (!!c.personId && members.includes(c.personId))));
  }
  if (choice.office) for (const c of active) if (c.kind === 'biuro' && !list.includes(c)) list.push(c);
  if (choice.comms && kind === 'komunikacja') for (const c of active) if (c.kind === 'komunikacja' && !list.includes(c)) list.push(c);
  const service = MAIL_KINDS[kind].service;
  const pref = kind === 'postep' ? 'postep' : kind === 'po_posiedzeniu' || kind === 'komunikacja' ? 'po_posiedzeniu' : null;
  return list.map(c => ({
    accountId: c.accountId, name: c.name,
    state: !c.email || c.emailState === 'brak' ? 'brak_adresu' : c.emailState !== 'potwierdzony' ? 'niepotwierdzony'
      : !service && pref && !c.prefs[pref] ? 'wylaczone' : 'wysle',
  }));
}
/** Zdanie o osobie pominiętej (6.7.1), bez adresu. */
export function skippedText(r: MailRecipientRow): string | null {
  if (r.state === 'wysle') return null;
  return r.state === 'wylaczone' ? `${r.name} ma wyłączone te wiadomości.` : `${r.name} nie ma potwierdzonego adresu e-mail.`;
}
/** Kto może wysłać jakąkolwiek wiadomość o posiedzeniu (sesja `mail`, rozdz. 2.5): przygotowujący, biuro, przewodniczący, sekretarz. */
export function mayMail(roster: Roster, a: Actor, prepares: boolean): boolean {
  if (isCommsAccount(a)) return false;
  if (isService(a) || prepares) return true;
  return !!a.personId && roster.memberships.some(ms => ms.personId === a.personId && (ms.func === 'przewodniczacy' || ms.func === 'sekretarz'));
}
