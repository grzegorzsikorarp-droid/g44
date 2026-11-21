import type {Meeting, Organ} from './types.ts';
import {tokens} from '../../brand/tokens/tokens.ts';
import type {MailSettings} from './mail.ts';
import type {Progress} from './workspace.ts';
import {minutesDeadline} from './catalog.ts';
import {longDate, paperDay} from './papers.ts';
import {dateDots, dateDotsOf, timeOf} from './text.ts';
import {typo} from './typo.ts';

// Wzory wiadomości e-mail (SPEC-4 6.7.2, B2-P05, B2-P06, DB-18, DB-40; wzór proby-B2/wzory.ts). Temat, wersję tekstową
// i HTML buduje ta jedna funkcja dla serwera i wersji próbnej, więc podgląd jest tym, co wyjdzie. Treść: link do
// aplikacji i streszczenie z liczbami, bez nazw uchwał, załączników, obrazów, kodów logowania i odnośnika do połączenia.
// Kolory HTML z brand/tokens/tokens.ts (plik wygenerowany do miejsc, „gdzie CSS nie sięga”), bez wartości wpisanych ręcznie.

const k = tokens.kolory.jasny;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
/** Treść w HTML: polska typografia (twarde spacje), potem znaki HTML. */
const h = (s: string) => esc(typo(s));

export interface MailContent { subject: string; text: string; html: string }
/** Osoba albo biuro, które wysyła wiadomość („Wiadomość wysyła …”). */
export type MailSender = {name: string; func: string} | {office: string};
export interface MailBase {
  /** Adres aplikacji (`APP_URL`, w wersji próbnej https://example.org/posiedzenia). */
  appUrl: string;
  settings: Pick<MailSettings, 'controller' | 'privacyUrl'>;
  organ: Pick<Organ, 'name' | 'forms'>;
}
type Block = {p: string} | {label: string; items: string[]; plain?: boolean} | {lines: string[]} | {link: string; text: string; button: string} | {small: string};

const senderLine = (s: MailSender) => 'office' in s ? `Wiadomość wysyła ${s.office}.` : `Wiadomość wysyła ${s.name}${s.func ? `, ${s.func}` : ''}.`;
/** Stopka (B2 3.3): aplikacja, administrator danych i adres informacji o przetwarzaniu danych. */
function footerLines(o: MailBase): string[] {
  const out = [`Wiadomość wysyła aplikacja do posiedzeń ${o.organ.forms.genitive}.`];
  if (o.settings.controller.trim()) out.push(`Administratorem danych jest ${o.settings.controller.trim()}.`);
  if (o.settings.privacyUrl.trim()) out.push(`Informacje o przetwarzaniu danych osobowych ${o.settings.privacyUrl.trim()}`);
  return out;
}
/** Wiadomość z bloków: wersja tekstowa (listy z łącznikiem) i HTML (pasek 6 px, etykiety wersalikami, bez kółek). */
function render(subject: string, blocks: Block[], tail: string, o: MailBase): MailContent {
  const footer = footerLines(o);
  const text: string[] = [];
  for (const b of blocks) {
    if ('p' in b) text.push(b.p, '');
    else if ('label' in b) text.push(...(b.label ? [b.label] : []), ...b.items.map(i => `- ${i}`), '');
    else if ('lines' in b) text.push(...b.lines, '');
    else if ('link' in b) text.push(b.text, b.link, '');
    else text.push(b.small);
  }
  text.push('-- ', tail, ...footer);
  const label = (t: string) => `<p style="margin:16px 0 4px;font-style:italic;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;font-size:12px;color:${k['tekst-drugorzedny']}">${h(t)}</p>`;
  const list = (items: string[]) => `<ul style="margin:0;padding:0;list-style:none">${items.map(i => `<li style="margin:4px 0">${h(i)}</li>`).join('')}</ul>`;
  const body = blocks.map(b => 'p' in b ? `<p style="margin:0 0 16px;white-space:pre-line">${h(b.p)}</p>`
    : 'label' in b ? (b.plain ? `<p style="margin:0 0 4px">${h(b.label)}</p>` : b.label ? label(b.label) : '') + list(b.items)
    : 'lines' in b ? `<p style="margin:0 0 16px">${b.lines.map((l, i) => i === 0 ? `<strong>${h(l)}</strong>` : h(l)).join('<br>')}</p>`
    : 'link' in b ? `<p style="margin:24px 0"><a href="${esc(b.link)}" style="display:inline-block;background:${k['akcent-tekst']};color:${k['na-akcencie']};padding:12px 20px;text-decoration:none;font-weight:700">${h(b.button)}</a></p>`
    : `<p style="margin:0 0 8px;color:${k['tekst-drugorzedny']};font-size:14px">${h(b.small)}</p>`).join('\n');
  const privacy = o.settings.privacyUrl.trim();
  const foot = footer.map(l => privacy && l.endsWith(privacy) ? `<a href="${esc(privacy)}" style="color:${k['akcent-tekst']}">${h('Informacje o przetwarzaniu danych osobowych')}</a>.` : h(l)).join(' ');
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${h(subject)}</title></head>
<body style="margin:0;background:${k.tlo};color:${k.tekst};font-family:'Titillium Web',Arial,sans-serif;font-size:16px;line-height:1.5">
<div style="max-width:600px;margin:0 auto;background:${k.powierzchnia};border-left:6px solid ${k.czerwien};padding:24px">
${body}
<hr style="border:0;border-top:1px solid ${k.linia};margin:24px 0 12px">
<p style="margin:0;color:${k['tekst-drugorzedny']};font-size:13px">${h(tail)} ${foot}</p>
</div></body></html>`;
  return {subject, text: text.join('\n').replace(/\n{3,}/g, '\n\n'), html};
}
/** „3.12.2026” (d.mm.rrrr, rozdz. 6.7.2) z daty RRRR-MM-DD. */
export const shortDate = (iso: string) => iso ? iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, mo, d) => `${Number(d)}.${mo}.${y}`) : '';
const link = (o: MailBase, m: Pick<Meeting, 'id'>, path = '') => `${o.appUrl.replace(/\/$/, '')}/#p-${m.id}${path}`;

/**
 * „Informacja o postępie” (B2 3.3 z poprawkami 6.7.2): stan przygotowań z jednej funkcji postępu (workspace.ts),
 * zdanie „To nie jest zawiadomienie o posiedzeniu (§ 7 ust. 1).” nad stopką (K4-21). Część „Twoje zadania” należy do
 * dodatku D-11.
 */
export function progressMail(m: Meeting, p: Progress, o: MailBase & {intro: string; sender: MailSender; now: number;
  /** Dodatek D-11 (B2 3.3): „Twoje zadania” tylko u osoby, która ma zadania; treść inna dla każdej osoby. */
  tasks?: string[]}): MailContent {
  const subject = `Przygotowanie posiedzenia ${shortDate(m.date)}, gotowe ${p.ready} z ${p.total} ${p.total === 1 ? 'punktu' : 'punktów'}`;
  const where = m.kind === 'procedura' ? 'głosowanie między posiedzeniami' : m.mode === 'zdalne' ? 'posiedzenie zdalne' : m.place.trim();
  const facts = [p.text, ...(p.missing ? [p.missing] : []), ...(p.proposalsWaiting ? [`Zgłoszenia czekające na decyzję zwołującego ${p.proposalsWaiting}.`] : []), ...(p.notice ? [p.notice] : [])];
  return render(subject, [
    {p: o.intro.trim()},
    {lines: [o.organ.name, [longDate(m.date), m.time && m.kind !== 'procedura' ? `godz. ${m.time}` : '', where].filter(Boolean).join(', ')]},
    {label: `Stan przygotowań ${dateDotsOf(o.now)}, godz. ${timeOf(o.now)}`, items: facts},
    ...(o.tasks?.length ? [{label: 'Twoje zadania', items: o.tasks}] : []),
    {link: link(o, m), text: 'Szczegóły i materiały znajdziesz w aplikacji', button: 'Otwórz przygotowanie posiedzenia'},
    {small: senderLine(o.sender)},
    {small: 'To nie jest zawiadomienie o posiedzeniu (§ 7 ust. 1).'},
  ], 'To wiadomość o przygotowaniu posiedzenia. Możesz z niej zrezygnować w aplikacji, w części Moje konto, Powiadomienia.', o);
}

const announcedB = (b: Meeting['ballots'][number]) => b.status === 'zamkniete' && !!b.announcedAt && !b.aborted && !!b.result;
/**
 * „Dokumenty po posiedzeniu” (DB-18, 6.7.2): liczby tylko z głosowań ogłoszonych, bez podziału na osoby, bez nazw uchwał,
 * oraz nazwy dokumentów z karty „Dokumenty posiedzenia”. `adoptedDay` to dzień posiedzenia, którego protokół przyjęto.
 */
export function afterMail(m: Meeting, o: MailBase & {intro: string; sender: MailSender; acts: number; adoptedDay?: string | null}): MailContent {
  const day = paperDay(m);
  const working = m.kind === 'posiedzenie' && !!m.working;
  const subject = m.kind === 'procedura' ? `Dokumenty po głosowaniu między posiedzeniami ${shortDate(day)}`
    : working ? `Dokumenty po spotkaniu roboczym ${shortDate(day)}` : `Dokumenty po posiedzeniu ${shortDate(day)}`;
  const resolutions = m.ballots.filter(b => b.purpose === 'uchwala' && announcedB(b) && !(b.supersededBy && m.ballots.some(x => x.id === b.supersededBy && announcedB(x))));
  const adopted = resolutions.filter(b => b.result!.adopted).length, rejected = resolutions.length - adopted;
  const deferred = m.agenda.filter(i => i.status === 'odroczony').length;
  const facts: string[] = [];
  if (adopted) facts.push(adopted === 1 ? 'Podjęta uchwała 1.' : `Podjęte uchwały ${adopted}.`);
  if (rejected) facts.push(rejected === 1 ? 'Niepodjęta uchwała 1.' : `Niepodjęte uchwały ${rejected}.`);
  if (deferred) facts.push(deferred === 1 ? 'Sprawa odroczona 1.' : `Sprawy odroczone ${deferred}.`);
  if (o.adoptedDay) facts.push(`Przyjęto protokół posiedzenia z dnia ${dateDots(o.adoptedDay)}.`);
  const papers = [working ? 'Projekt notatki' : 'Projekt protokołu', 'Porządek obrad', ...(m.kind === 'posiedzenie' ? ['Lista obecności'] : []),
    ...(m.ballots.some(b => b.purpose !== 'proba') ? ['Wyniki głosowań'] : []), ...(o.acts > 0 ? [`Podjęte akty, ${o.acts}`] : []),
    ...(m.messages.some(x => !m.frozen?.v4 || x.at >= (m.openedAt ?? 0)) ? ['Kanał wiadomości'] : [])];
  const what = m.kind === 'procedura' ? 'głosowanie między posiedzeniami' : working ? 'spotkanie robocze' : 'posiedzenie';
  const closed = m.closedAt ? `, ${m.kind === 'procedura' ? 'zakończone' : 'zamknięte'} o godz. ${timeOf(m.closedAt)}` : '';
  const deadline = !working ? minutesDeadline(m) : null;
  const blocks: Block[] = [
    {p: o.intro.trim()},
    // Data słownie kończy się skrótem „r.”, który zamyka zdanie bez godziny zamknięcia (W-W4-08).
    {label: `${o.organ.name}, ${what} z dnia ${longDate(day)}${closed ? `${closed}.` : ''}`, items: facts, plain: true},
  ];
  blocks.push({label: 'Dokumenty w aplikacji', items: papers});
  if (deadline) blocks.push({p: `Protokół sporządza się w ciągu 21 dni, do ${dateDots(deadline)} (§ 13 ust. 2).`});
  blocks.push({link: link(o, m, '/dokumenty'), text: 'Dokumenty znajdziesz w aplikacji', button: 'Otwórz dokumenty posiedzenia'}, {small: senderLine(o.sender)});
  return render(subject, blocks, 'To wiadomość o dokumentach posiedzenia. Możesz z niej zrezygnować w aplikacji, w części Moje konto, Powiadomienia.', o);
}

/**
 * „Protokół do wglądu” (B2 3.3, K4-7): wiadomość służbowa, wychodzi dopiero po zapisie faktu „Protokół sporządzony”
 * z osobą sporządzającą i zawiera zdania „Protokół posiedzenia … z dnia … sporządzono {data}. Sporządza {imię i nazwisko}, {funkcja}.”
 */
export function minutesMail(m: Meeting, o: MailBase): MailContent {
  const r = m.minutesReady;
  if (!r) throw new Error('Brak faktu „Protokół sporządzony”.');
  const day = paperDay(m);
  return render(`Protokół posiedzenia ${shortDate(day)} do wglądu`, [
    // Brzmienie B2 3.3; data słownie kończy się skrótem „r.”, więc bez drugiej kropki (W-W4-08).
    {p: `Protokół posiedzenia ${o.organ.forms.genitive} z dnia ${longDate(day)} sporządzono ${dateDots(r.date)}. Sporządza ${r.author.name}, ${r.author.func}.`},
    {p: 'Jest do wglądu w biurze (§ 13 ust. 2) i w aplikacji. Prezydium przyjmie go na najbliższym posiedzeniu (§ 13 ust. 3).'},
    {link: link(o, m, '/dokumenty'), text: 'Dokumenty znajdziesz w aplikacji', button: 'Otwórz dokumenty posiedzenia'},
  ], 'To wiadomość służbowa. Przychodzi do osób, które pełnią funkcję w organie.', o);
}

/**
 * Dodatek D-15 (DB-9, DB-18, 6.7.2): „Materiał dla komunikacji gotowy” do konta komunikacji przy udostępnieniu materiału;
 * nieobowiązkowa, z rezygnacją przez preferencję „Dokumenty po posiedzeniu”. Link do wiersza katalogu.
 */
export function commsReadyMail(m: Meeting, o: MailBase): MailContent {
  const day = paperDay(m);
  return render(`Materiał dla komunikacji z posiedzenia ${shortDate(day)}`, [
    {p: `Materiał dla komunikacji z posiedzenia ${o.organ.forms.genitive} z dnia ${longDate(day)} jest gotowy w aplikacji.`},
    {p: m.photos?.url ? 'Odnośnik do zdjęć jest już wpisany.' : 'Odnośnika do zdjęć jeszcze nie wpisano.'},
    {link: `${o.appUrl.replace(/\/$/, '')}/#odbyte?p=${m.id}`, text: 'Materiał znajdziesz w aplikacji', button: 'Otwórz odbyte posiedzenia'},
  ], 'To wiadomość o materiale dla komunikacji. Możesz z niej zrezygnować w aplikacji, w części Moje konto, Powiadomienia.', o);
}

/** „Kod potwierdzenia adresu e-mail” (B2 3.3): kod bez linku. */
export function codeMail(code: string, o: MailBase): MailContent {
  const shown = code.replace(/^(\d{3})(\d{3})$/, '$1 $2');
  return render('Kod potwierdzenia adresu e-mail', [
    {p: `Kod ${shown}. Wpisz go w aplikacji, w części Moje konto. Kod jest ważny 30 minut. Jeśli nie zmieniasz adresu, pomiń tę wiadomość.`},
  ], 'To wiadomość służbowa. Przychodzi na adres wpisany w aplikacji.', o);
}
/** Informacja na poprzedni adres po potwierdzeniu nowego (B2-P07). */
export function addressChangedMail(at: number, o: MailBase): MailContent {
  return render('Adres e-mail konta zmieniono', [
    {p: `Adres e-mail do powiadomień Twojego konta w aplikacji zmieniono ${dateDotsOf(at)}, godz. ${timeOf(at)}. Na ten adres aplikacja nie wyśle już wiadomości.`},
    {p: 'Jeśli to nie Ty, zgłoś to administratorowi aplikacji.'},
  ], 'To wiadomość służbowa. Przychodzi na adres wpisany w aplikacji.', o);
}
/** Wiadomość próbna z ustawień „Poczta e-mail” (B2-P13). */
export function testMail(o: MailBase & {at: number}): MailContent {
  return render('Wiadomość próbna', [
    {p: `To wiadomość próbna z aplikacji do posiedzeń, wysłana ${dateDotsOf(o.at)}, godz. ${timeOf(o.at)}. Ustawienia poczty działają.`},
  ], 'To wiadomość techniczna. Wysyła ją biuro z ustawień poczty.', o);
}
