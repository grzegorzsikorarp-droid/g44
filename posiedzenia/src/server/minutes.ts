import type {Account, AgendaItem, Ballot, ChairBasis, ChairChange, DocType, Meeting, Membership, Motion, Roster} from '../shared/types.ts';
import {membership, organMembers, organOf, personName} from '../shared/roster.ts';
import {ballotDocType, choiceLabel, hasVoted, itemNumber, itemVoted, materialTypeOf, needsVote, orderedAgenda, presenceOf, presenterGroups, presentMembers, quorumFor, quorumOf, reasumptionSignaturesNeeded, resultLabel, resultPendingProcedureText, resultPendingText, signaturesNeeded, unannounced} from '../shared/rules.ts';
import {defaultDocTypes} from '../shared/doctypes.ts';
import {defaultSite, noticeDays} from '../shared/meeting.ts';
import {cascadeEnv, effectiveMeeting, type Deviation} from '../shared/cascade.ts';
import {defaultGeneral} from '../shared/settings.ts';
import {lawOf, type LegalProfile} from '../shared/law.ts';
import {deputyOf, organRoster} from '../shared/role.ts';
import {plural} from '../shared/text.ts';
import {typo} from '../shared/typo.ts';

// Projekt protokołu: dokument organu z nagłówkiem, rozdziałami I–VI, przebiegiem obrad z głosowaniami w punktach,
// podpisami i stopką. Ten sam tekst trafia na stronę do druku, do pliku do edycji w Wordzie i do okna wersji próbnej,
// dlatego nie zawiera nazw zależnych od wersji (podaje je wywołujący w `names` i `look`).
// Spotkanie robocze bez kworum (F5) ma zamiast protokołu notatkę: bez rozdziału „Podjęte uchwały”, z podpisem osoby
// prowadzącej i osoby sporządzającej notatkę. Głosowania próbne (F1) są tylko w zdaniu w rozdziale I.
// Wersja 3 (specyfikacja, rozdz. 5.8): posiedzenia z ustawieniami zapisanymi przy otwarciu (`frozen` bez `legacy`) mają
// nowe zdania: zastępstwo, otwarcie i zmiany prowadzenia z podstawą (DA-17), wyjście zapisane przez przejmującego,
// goście z informacją, kto zaprasza, sposób zapisu obecności, wymagana większość, odstępstwa w porządku i w punktach,
// podpis osoby, która zamknęła obrady (DA-18), oraz zarządzający, tryb i krótszy termin głosowania między posiedzeniami.
// Skład i liczby pochodzą z `frozen`. Odstępstwa liczy jedna funkcja domeny (effectiveMeeting(...).deviations).
// Posiedzenia zapisane przy przejściu na wersję 3 (`legacy`) mają projekt protokołu jak w wersji 2, słowo w słowo.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
/** Tekst dokumentu: polska typografia (twarde spacje jak w interfejsie), potem znaki HTML. */
const t = (s: unknown) => esc(typo(String(s ?? '')));
const zone = {timeZone: 'Europe/Warsaw'} as const;
const time = (ts?: number) => ts ? new Intl.DateTimeFormat('pl-PL', {...zone, hour: '2-digit', minute: '2-digit'}).format(ts) : '';
/** Dzień w strefie Europe/Warsaw w zapisie RRRR-MM-DD. */
const dayOf = (ts: number) => new Intl.DateTimeFormat('en-CA', {...zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(ts);
/** „19 listopada 2026 r.” */
const longDate = (iso: string) => iso ? `${new Intl.DateTimeFormat('pl-PL', {dateStyle: 'long', timeZone: 'UTC'}).format(Date.parse(iso + 'T12:00:00Z'))} r.` : '';
/** „19.11.2026” */
const shortDate = (iso: string) => iso ? iso.split('-').reverse().join('.') : '';
const longAt = (ts: number) => `${longDate(dayOf(ts))}, godz. ${time(ts)}`;
const shortAt = (ts: number) => `${shortDate(dayOf(ts))}, godz. ${time(ts)}`;
const addDays = (iso: string, days: number) => {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
};
// Tekst w cudzysłowie „…”, a cudzysłów wewnątrz zamienia się na »…« (brand/JEZYK.md).
const quoted = (text: string) => `„${text.replace(/„/g, '»').replace(/”/g, '«')}”`;
// Dane w nawiasie: nawias wewnątrz nawiasu staje się kwadratowy, np. „(wyznaczenie przez przewodniczącego [§ 16])”.
const inParens = (text: string) => `(${text.replace(/\(/g, '[').replace(/\)/g, ']')})`;
/** Powód do protokołu bez kropki na końcu (kropka stoi po cudzysłowie). */
const reasonText = (reason: string) => quoted(reason.trim().replace(/\.$/, ''));
const listing = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} i ${items[items.length - 1]}`;
const modeWord = (mode: Ballot['mode']) => mode === 'tajne' ? 'tajne' : mode === 'imienne' ? 'imienne' : 'jawne';
const DOTS = '……';

/** Dzień posiedzenia w dokumencie: z otwarcia, a przed otwarciem z daty posiedzenia (RRRR-MM-DD). */
export const minutesDay = (m: Meeting) => m.openedAt ? dayOf(m.openedAt) : m.date;
/** Spotkanie robocze (F5): dokumentem jest notatka zamiast protokołu. */
const isNote = (m: Pick<Meeting, 'kind' | 'working'>) => m.kind === 'posiedzenie' && !!m.working;
/** Nazwa dokumentu w oknie, na pasku i w tytule strony: „Projekt protokołu” albo „Projekt notatki”. */
export const minutesTitle = (m: Pick<Meeting, 'kind' | 'working'>) => isNote(m) ? 'Projekt notatki' : 'Projekt protokołu';
/** Nazwa pliku do edycji w Wordzie, np. „projekt-protokolu-prezydium-2026-11-19.doc”. */
export const minutesFileName = (m: Meeting) => `projekt-${isNote(m) ? 'notatki' : 'protokolu'}-${m.kind === 'procedura' ? 'glosowanie' : m.organ}-${minutesDay(m)}.doc`;
/** Nagłówek stron od drugiej przy wydruku. */
export const minutesPageHeader = (m: Meeting) => isNote(m)
  ? `Projekt notatki, spotkanie robocze z dnia ${shortDate(minutesDay(m))}`
  : `Projekt protokołu, ${m.kind === 'procedura' ? 'głosowanie między posiedzeniami' : 'posiedzenie'} z dnia ${shortDate(minutesDay(m))}`;

/** Nazwy zależne od wersji: biuro w bierniku („zapisane przez biuro Izby”) i regulamin w dopełniaczu. */
export interface MinutesNames { office?: string; regulation?: string }
/**
 * Dane zależne od osoby i słownika: rodzaje dokumentów (F11, wymóg głosowania w punktach; bez nich rodzaje domyślne)
 * i ukrycie wyników, których osoba jeszcze nie widzi (F2, `hideUnannounced` dla osób bez `seesUnannounced`).
 */
export interface MinutesOptions { docTypes?: DocType[]; hideUnannounced?: boolean }

interface Doc {
  m: Meeting; roster: Roster; accounts: Account[]; procedure: boolean; office: string; regulation: string;
  placed: Map<string, Ballot[]>; loose: Ballot[];
  /** Głosowania próbne (F1): tylko zdanie w rozdziale I, poza przebiegiem obrad i wykazem uchwał. */
  trials: Ballot[];
  /** Notatka ze spotkania roboczego (F5) zamiast protokołu. */
  note: boolean;
  /** Słownik rodzajów dokumentów (F11) i głosowania z wynikiem ukrytym przed tą osobą (F2). */
  types: DocType[]; hidden: Set<string>;
  /** Plik do edycji w Wordzie: fakty, porządek i podpisy w prostszym zapisie, który edytory tekstu odczytują wiernie. */
  word: boolean;
  /** Wersja 3: posiedzenie z ustawieniami zapisanymi przy otwarciu (bez `legacy`), profil prawny, skład i odstępstwa. */
  v3: boolean; law: LegalProfile; members: Membership[]; deviations: Deviation[];
}

const p = (text: string, cls = '') => `<p${cls ? ` class="${cls}"` : ''}>${t(text)}</p>`;
/**
 * Tabela w opakowaniu, które na wąskim ekranie przewija się w poziomie. Opakowanie jest obszarem z nazwą
 * i przyjmuje fokus, więc przewinie się też z klawiatury.
 */
function table(label: string, head: string[], rows: string[][], numeric: number[] = [], rowHeader = true, className = '') {
  const cls = (i: number) => numeric.includes(i) ? ' class="oi-liczba"' : '';
  // Tabela wyniku na wąskim ekranie układa komórki w siatce z etykietą nad liczbą (protokol.css),
  // dlatego ma jawne role tabeli i etykiety komórek.
  const grid = className === 'result-table';
  const role = (r: string) => grid ? ` role="${r}"` : '';
  return `<div class="table-wrap" role="region" tabindex="0" aria-label="${t(label)}"><table${className ? ` class="${className}"` : ''}${role('table')}><thead${role('rowgroup')}><tr${role('row')}>${head.map((h, i) => `<th scope="col"${cls(i)}${role('columnheader')}>${t(h)}</th>`).join('')}</tr></thead><tbody${role('rowgroup')}>`
    + rows.map(r => `<tr${role('row')}>${r.map((cell, i) => rowHeader && i === 0 ? `<th scope="row">${cell}</th>` : `<td${cls(i)}${role('cell')}${grid ? ` data-label="${t(head[i])}"` : ''}>${cell}</td>`).join('')}</tr>`).join('')
    + '</tbody></table></div>';
}

/** Imię i nazwisko z funkcją ze składu: „Sebastian Irzykowski, Przewodniczący” (wersja 3: ze składu zapisanego przy otwarciu). */
function who(d: Doc, personId: string) {
  const label = d.v3 ? d.members.find(x => x.personId === personId)?.label : membership(d.roster, d.m.organ, personId)?.label;
  return `${personName(d.roster, personId)}${label ? `, ${label}` : ''}`;
}
/** Skład organu w dokumencie: w wersji 3 zapisany przy otwarciu, w posiedzeniach sprzed wersji 3 bieżący (jak w wersji 2). */
const membersOf = (d: Doc) => d.v3 ? d.members : organMembers(d.roster, d.m.organ);
/** Odstępstwa danego rodzaju (wersja 3), w punkcie albo w całym posiedzeniu. */
const deviationsOf = (d: Doc, kinds: Deviation['kind'][], itemId?: string) => d.deviations.filter(x => kinds.includes(x.kind) && (itemId === undefined || x.itemId === itemId));
/** Dopisek w nawiasie przy zmianie prowadzenia (rozdz. 5.8, DA-17). */
function chairNote(c: ChairChange) {
  const basis: ChairBasis | undefined = c.basis;
  switch (basis) {
    case 'przewodniczacy': return 'przejęcie prowadzenia przez przewodniczącego';
    case 'zastepca': return 'zastępstwo wyznaczone przez przewodniczącego, § 16 ust. 2';
    case 'bez_wyznaczenia': return 'bez wyznaczenia zastępcy przez przewodniczącego, § 9 ust. 1';
    case 'zamiast_zastepcy': return `zamiast wyznaczonego zastępcy, powód ${reasonText(c.reasonGiven ?? '')}`;
    case 'przekazanie': return 'przekazanie prowadzenia';
    case 'powrot': return 'powrót do prowadzenia po wyjściu zapisanym przy przejęciu';
    default: return c.reason;
  }
}
/** Osoba prowadząca obrady w danej chwili (z historii zmian prowadzenia). */
function chairAt(m: Meeting, at: number) {
  let current: string | null = null;
  for (const c of m.chair.changes) if (c.at <= at) current = c.to;
  return current;
}
/**
 * Kto zapisał albo potwierdził obecność, w bierniku bez odmiany nazwiska: „osobę prowadzącą obrady (Anna Nowak)”,
 * „członka Prezydium (…)”, „inną osobę (…)” albo biuro z nazwą konta („biuro Izby (Biuro Drugie)”). Imię i nazwisko
 * albo nazwa konta stoi w nawiasie w mianowniku.
 */
function byWhom(d: Doc, name: string, at: number) {
  const {m, roster} = d;
  const chair = chairAt(m, at);
  if (chair && name === personName(roster, chair)) return `osobę prowadzącą obrady (${name})`;
  const person = roster.persons.find(x => x.name === name);
  if (person) return membership(roster, m.organ, person.id) ? `członka Prezydium (${name})` : `inną osobę (${name})`;
  // F9: przy kilku kontach biura nazwa konta mówi, kto potwierdził obecność.
  return name && name !== 'system' ? `${d.office} (${name})` : d.office;
}
/** Członkowie organu obecni w danej chwili według listy obecności (ostatnie przybycie albo wyjście przed tą chwilą). */
function presentAt(d: Doc, at: number) {
  return membersOf(d).filter(ms => {
    const last = [...d.m.presenceLog].reverse().find(e => e.who === ms.personId && !e.guest && e.at <= at && (e.type === 'przybycie' || e.type === 'wyjscie'));
    return last?.type === 'przybycie';
  }).length;
}
/** Najgłębszy punkt porządku, który trwał w danej chwili (rozpoczęty i niezakończony przed nią). */
function itemAt(m: Meeting, at: number) {
  let found: AgendaItem | undefined;
  for (const it of orderedAgenda(m.agenda)) {
    if (it.startedAt === undefined || it.startedAt > at || (it.endedAt !== undefined && it.endedAt < at)) continue;
    const depth = it.parentId ? 1 : 0, best = found ? (found.parentId ? 1 : 0) : -1;
    if (depth > best || (depth === best && it.startedAt >= found!.startedAt!)) found = it;
  }
  return found;
}
/**
 * Punkt, w którym stoi głosowanie: głosowania z punktem, wnioski o tryb w punkcie, którego dotyczą, zmiany porządku
 * w punkcie trwającym w chwili otwarcia, a głosowania nad reasumpcją przy głosowaniu, którego dotyczą.
 */
function homeOf(m: Meeting, b: Ballot, depth = 0): string | null {
  if (b.itemId) return b.itemId;
  if (b.target?.kind === 'tryb') return b.target.itemId;
  const original = b.target?.kind === 'reasumpcja' ? b.target.ballotId : b.reasumptionOf;
  if (original && depth < 3) {
    const o = m.ballots.find(x => x.id === original);
    if (o) return homeOf(m, o, depth + 1);
  }
  if (b.purpose === 'zmiana_porzadku') return itemAt(m, b.openedAt)?.id ?? null;
  return null;
}

const notVoted = new Set<Ballot['purpose']>(['porzadek', 'zmiana_porzadku', 'protokol', 'tryb', 'reasumpcja', 'wniosek', 'proba']);
/**
 * Głosowanie nad uchwałą: rodzaj sprawy zapisany przy otwarciu (F11), a w starszych głosowaniach materiał rodzaju
 * „uchwała”, a bez materiału przedmiot „Uchwała…”, „Projekt uchwały…”.
 */
function isResolution(m: Meeting, b: Ballot) {
  if (notVoted.has(b.purpose)) return false;
  return ballotDocType(m, b) === 'uchwala';
}

/** „Głosowało … osób” i podobne: czasownik zgodny z liczebnikiem, bez rodzaju gramatycznego osób. */
function persons(n: number, forms: [string, string, string]) {
  return `${plural(n, forms[0], forms[1], forms[2])} ${n} ${plural(n, 'osoba', 'osoby', 'osób')}`;
}

function ballotEnd(b: Ballot) {
  // Głosowanie kończy się samo także wtedy, gdy ostatnią osobę bez głosu oznaczono jako nieobecną: wtedy głosowali
  // wszyscy obecni, a nie wszyscy uprawnieni (osoby, które wyszły, wymienia zdanie absentText).
  if (b.closeReason === 'wszyscy') return b.result && b.result.cast < b.result.eligible ? 'zakończone, gdy zagłosowali wszyscy obecni' : 'zakończone, gdy zagłosowali wszyscy uprawnieni';
  if (b.closeReason === 'czas') return 'zakończone po upływie wyznaczonego czasu';
  if (b.closeReason === 'prowadzacy') return b.remote ? 'zakończone przed terminem z policzeniem głosów' : 'zakończone przez osobę prowadzącą obrady';
  return 'zakończone';
}
/** Osoby, które wyszły z posiedzenia w trakcie głosowania i nie oddały głosu (czasownik zgodny z „osoba”, bez rodzaju osób). */
function absentText(d: Doc, b: Ballot) {
  if (b.closeReason !== 'wszyscy' || !b.result || b.result.cast >= b.result.eligible) return '';
  const gone = b.absentDuring.filter(id => !hasVoted(b, id));
  if (!gone.length) return '';
  return ` Podczas głosowania z posiedzenia ${persons(gone.length, ['wyszła', 'wyszły', 'wyszło'])} (${listing(gone.map(id => personName(d.roster, id)))}).`;
}
function ballotSpan(b: Ballot) {
  const end = b.closedAt ?? b.endsAt;
  return dayOf(b.openedAt) === dayOf(end) ? `od godz. ${time(b.openedAt)} do godz. ${time(end)}` : `od ${shortAt(b.openedAt)} do ${shortAt(end)}`;
}

/** Głosowanie między posiedzeniami: kto oddał głos albo pobrał kartę (bez wyborów, poza wykazem imiennym). */
function remoteParticipation(d: Doc, b: Ballot) {
  const names = (ids: string[]) => ids.map(id => personName(d.roster, id)).join(', ');
  const eligible = b.eligible.length;
  let text = eligible === 1 ? 'Uprawniony 1 członek Prezydium.' : `Uprawnionych ${eligible} członków Prezydium.`;
  if (b.secret) {
    const took = b.eligible.filter(id => b.secret!.issued.includes(id));
    text += took.length ? ` ${persons(took.length, ['Kartę do głosowania pobrała', 'Kartę do głosowania pobrały', 'Kartę do głosowania pobrało'])} (${names(took)}).` : ' Nikt nie pobrał karty do głosowania.';
  } else {
    // F7: głosowanie przerwane nie zachowuje wyborów, tylko listę głosujących (`aborted.voters`).
    const cast = new Set(b.aborted?.voters ?? Object.keys(b.votes));
    const voted = b.eligible.filter(id => cast.has(id)), missing = b.eligible.filter(id => !cast.has(id));
    text += voted.length ? ` ${persons(voted.length, ['Głos oddała', 'Głos oddały', 'Głos oddało'])} (${names(voted)}).` : ' Nikt nie oddał głosu.';
    if (voted.length && missing.length) text += ` ${persons(missing.length, ['Głosu nie oddała', 'Głosu nie oddały', 'Głosu nie oddało'])} (${names(missing)}).`;
  }
  return p(text);
}

function ballotBlock(d: Doc, b: Ballot) {
  const {m, roster} = d;
  const r = b.result;
  const lines = [
    `<p class="ballot-head"><strong>${t(`Głosowanie nr ${b.number}`)}</strong> ${t(inParens(`${modeWord(b.mode)}${b.modeBasis ? `, ${b.modeBasis}` : ''}`))}</p>`,
    p(b.subject, 'ballot-subject'),
  ];
  // F14: kto zgłosił wniosek o głosowanie tajne albo imienne.
  if (b.target?.kind === 'tryb' && b.target.proposedBy) lines.push(p(`Wniosek zgłasza ${who(d, b.target.proposedBy)}.`));
  if (b.reasumptionOf) lines.push(p(`Reasumpcja głosowania nr ${m.ballots.find(x => x.id === b.reasumptionOf)?.number ?? DOTS} (§ 12).`, 'muted'));
  if (b.material) lines.push(p(`Treść poddana pod głosowanie ${quoted(b.material.title)}, wersja ${b.material.version} (skrót ${b.material.hash.slice(0, 12)}).`, 'muted'));
  else if (isResolution(m, b)) lines.push(p('Projekt uchwały nie był dołączony w aplikacji.', 'muted'));
  // F7: głosowanie między posiedzeniami przerwane bez rozstrzygnięcia, bez policzenia głosów.
  if (b.aborted) {
    lines.push(p(`Głosowanie trwało ${ballotSpan(b)} i zostało przerwane. Powód ${reasonText(b.aborted.reason)}. Głosów nie policzono, rozstrzygnięcie nie zapadło.`));
    if (b.remote) lines.push(remoteParticipation(d, b));
    return `<div class="ballot">${lines.join('')}</div>`;
  }
  // F2: wynik, którego ta osoba jeszcze nie widzi, zostaje w dokumencie ukryty tak jak w aplikacji.
  if (d.hidden.has(b.id)) {
    lines.push(p(d.procedure ? resultPendingProcedureText : resultPendingText, 'muted'));
    return `<div class="ballot">${lines.join('')}</div>`;
  }
  if (!r) {
    lines.push(p('Głosowanie nie zostało zakończone.', 'muted'));
    return `<div class="ballot">${lines.join('')}</div>`;
  }
  // Formuła wyniku zapisana w głosowaniu przy otwarciu (F11), a w starszych głosowaniach liczona po dawnemu.
  lines.push(table(`Wynik głosowania nr ${b.number}`, ['Za', 'Przeciw', 'Wstrzymało się', 'Wynik'], [[String(r.za), String(r.przeciw), String(r.wstrzymuje), t(resultLabel(b, materialTypeOf(m, b)))]], [0, 1, 2], false, 'result-table'));
  lines.push(p(`Głosowało ${r.cast} z ${r.eligible} ${r.eligible === 1 ? 'uprawnionego' : 'uprawnionych'}, wymagane kworum ${r.quorum}. Głosowanie ${ballotSpan(b)}, ${ballotEnd(b)}.${absentText(d, b)}`));
  if (b.secret) {
    lines.push(`<p class="muted">${t(`Głosowanie tajne przeprowadzono w systemie elektronicznym. Pobrano kart ${b.secret.issued.length}, oddano głosów ${b.secret.cast}. Odcisk klucza głosowania`)} <code>${esc(b.secret.fingerprint)}</code>. ${t('System nie zapisuje powiązania między osobą a głosem.')}</p>`);
  }
  if (b.mode === 'imienne') lines.push(table(`Wykaz imienny głosowania nr ${b.number}`, ['Imię i nazwisko', 'Głos'], b.eligible.map(id => [t(personName(roster, id)), t(b.votes[id] ? choiceLabel[b.votes[id]] : 'brak głosu')])));
  if (b.remote) lines.push(remoteParticipation(d, b));
  if (b.supersededBy && !d.hidden.has(b.supersededBy)) lines.push(p(`Wynik zastąpiono wynikiem reasumpcji w głosowaniu nr ${m.ballots.find(x => x.id === b.supersededBy)?.number ?? DOTS}.`, 'muted'));
  return `<div class="ballot">${lines.join('')}</div>`;
}

/**
 * Wniosek o reasumpcję: zgłoszenie, uzasadnienie, poparcie i rozstrzygnięcie. W trwającym posiedzeniu stan wniosku
 * jest opisany jako bieżący (zbiera podpisy, czeka na decyzję), a zdania o skutku dopiero po zamknięciu posiedzenia.
 */
function motionText(d: Doc, x: Motion) {
  const {m} = d;
  const number = (id?: string) => m.ballots.find(b => b.id === id)?.number ?? DOTS;
  const reason = x.justification.trim().replace(/\.$/, '');
  const closed = m.status === 'zakonczone';
  let text = `Wniosek o reasumpcję głosowania nr ${number(x.ballotId)} zgłoszono o godz. ${time(x.createdAt)}. Uzasadnienie ${quoted(reason)}.`;
  if (x.filedAt !== undefined) text += ` Poparło go ${x.signatures.length} z ${x.presentAtFiling ?? DOTS} obecnych członków Prezydium, wymagana co najmniej 1/3.`;
  // F2: rozstrzygnięcie wniosku zapada przy ogłoszeniu wyniku głosowania nad nim; do tego czasu wniosek jest „w głosowaniu”.
  const vote = m.ballots.find(b => b.id === x.voteBallotId);
  const status = vote && d.hidden.has(vote.id) ? 'glosowany' : x.status;
  switch (status) {
    case 'zbiera_podpisy': {
      if (closed) return text + ' Wniosek nie zebrał wymaganej liczby podpisów.';
      const present = presentMembers(m, d.roster);
      return text + ` Wniosek zbiera podpisy (${x.signatures.filter(id => present.includes(id)).length} z ${d.v3 ? signaturesNeeded(d.law, present.length) : reasumptionSignaturesNeeded(present.length)}).`;
    }
    case 'zlozony': return text + (closed ? ' Wniosku nie poddano pod głosowanie.' : ' Wniosek czeka na decyzję Prezydium.');
    case 'glosowany': return text + (vote?.status === 'zamkniete'
      ? ` Wynik głosowania nad wnioskiem (nr ${number(x.voteBallotId)}) czeka na ogłoszenie.`
      : ` Głosowanie nad wnioskiem (nr ${number(x.voteBallotId)}) nie zostało zakończone.`);
    case 'przyjety': return text + (x.repeatBallotId
      ? ` Prezydium przyjęło wniosek w głosowaniu nr ${number(x.voteBallotId)}, ponowne głosowanie nr ${number(x.repeatBallotId)}.`
      : ` Prezydium przyjęło wniosek w głosowaniu nr ${number(x.voteBallotId)}. ${closed ? 'Ponownego głosowania nie przeprowadzono.' : 'Ponowne głosowanie jeszcze się nie odbyło.'}`);
    case 'odrzucony': return text + ` Prezydium odrzuciło wniosek w głosowaniu nr ${number(x.voteBallotId)}.`;
    default: return text + ' Wniosek wycofano.';
  }
}
/** Każde głosowanie z wnioskami o jego reasumpcję jako osobny blok. */
function ballotBlocks(d: Doc, ballots: Ballot[]) {
  return ballots.map(b => ballotBlock(d, b) + d.m.motions.filter(x => x.ballotId === b.id).map(x => p(motionText(d, x), 'minutes-motion')).join(''));
}
function ballotsWithMotions(d: Doc, ballots: Ballot[]) {
  return ballotBlocks(d, ballots).join('');
}

/** Ad 1.: otwarcie, prowadzenie i pierwsze stwierdzenie kworum. */
function openingText(d: Doc) {
  const {m} = d;
  const opener = m.chair.changes[0]?.to ?? m.chair.current;
  const total = membersOf(d).length;
  const q = m.quorumChecks[0];
  let text = `Otwarcie posiedzenia o godz. ${time(m.openedAt)}.`;
  if (opener) text += ` Obrady prowadzi ${who(d, opener)}.`;
  text += q
    ? ` O godz. ${time(q.at)} stwierdzono ${q.present >= q.required ? 'kworum' : 'brak kworum'} (obecnych ${q.present} z ${total} członków Prezydium, wymagane co najmniej ${q.required}, § 8 ust. 2).`
    : ' Nie zapisano stwierdzenia kworum.';
  return text;
}

/**
 * Adnotacje przy punktach bez zapisu: odroczenie, wycofanie, punkt nierozpatrzony, bez głosowania, do uzupełnienia.
 * Powód odroczenia, wycofania albo nierozpatrzenia przy zamknięciu posiedzenia (F4) stoi w tym samym zdaniu.
 */
function itemNotes(d: Doc, it: AgendaItem, first: boolean) {
  const {m} = d;
  if (d.procedure) return [];
  const closed = m.status === 'zakonczone';
  const parent = it.parentId ? m.agenda.find(i => i.id === it.parentId) : undefined;
  // Punkt główny z podpunktami nie ma własnego powodu: bierze go od podpunktów, gdy wszystkie mają ten sam.
  const subs = m.agenda.filter(c => c.parentId === it.id);
  const reason = it.statusReason ?? (subs.length && subs.every(c => c.statusReason === subs[0].statusReason) ? subs[0].statusReason : undefined);
  const why = reason?.trim() ? ` Powód ${reasonText(reason)}.` : '';
  if (it.status === 'odroczony') return [`Punkt odroczono.${why}`];
  if (it.status === 'wycofany') return [`Punkt wycofano.${why}`];
  // Punkt „Zamknięcie posiedzenia” nie jest rozpoczynany: zamyka go zamknięcie posiedzenia.
  if (it.kind === 'zamkniecie') return closed && m.closedAt ? [`Zamknięcie ${d.note ? 'spotkania' : 'posiedzenia'} o godz. ${time(m.closedAt)}.`] : [];
  if (it.status === 'oczekuje') return closed && parent?.status !== 'odroczony' && parent?.status !== 'wycofany' ? [`Punkt nie był rozpatrywany.${why}`] : [];
  if (subs.length) return [];
  if (it.status === 'zakonczony' && needsVote(m, it, d.types) && !itemVoted(m, it)) return [`Punkt zakończono bez głosowania.${why}`];
  const recorded = first || !!it.note.trim() || (d.placed.get(it.id)?.length ?? 0) > 0;
  return recorded ? [] : ['Przebieg do uzupełnienia.'];
}

/**
 * Osoby przy punkcie (F12): fakty „Prowadzi punkt” i „Referuje” z etykietą nad wartością, każda osoba
 * w osobnym wierszu („Imię Nazwisko, Funkcja”). W pliku do Worda prosta tabela jak fakty pod tytułem.
 */
function peopleFacts(d: Doc, it: AgendaItem) {
  const groups = presenterGroups(it);
  if (!groups.length) return '';
  if (d.word) return `<table class="facts">${groups.map(g => `<tr><th scope="row">${t(g.label)}</th><td>${g.people.map(x => t(x)).join('<br>')}</td></tr>`).join('')}</table>`;
  return `<dl class="facts minutes-facts item-people">${groups.map(g => `<div class="fact"><dt>${t(g.label)}</dt><dd>${g.people.map(x => `<span class="person-line">${t(x)}</span>`).join('')}</dd></div>`).join('')}</dl>`;
}

// Nagłówek punktu stoi w jednym bloku z pierwszą częścią przebiegu, więc w druku nie zostaje sam na końcu strony.
function itemSection(d: Doc, it: AgendaItem, first: boolean) {
  const {m} = d;
  const head = `<h3>${t(`${d.procedure ? '' : 'Ad '}${itemNumber(m.agenda, it.id)}. ${it.title}`)}</h3>`;
  const parts: string[] = [];
  if (first && m.openedAt) parts.push(p(openingText(d)));
  const people = peopleFacts(d, it);
  if (people) parts.push(people);
  // F4: punkt rozpoczęty poza kolejnością przyjętego porządku obrad.
  if (it.outOfOrder) parts.push(p(`Punkt rozpatrzono poza kolejnością przyjętego porządku obrad. Powód ${reasonText(it.outOfOrder.reason)}.`));
  const mats = m.materials.filter(x => it.materialIds.includes(x.id));
  if (mats.length) parts.push(p(`${mats.length === 1 ? 'Materiał' : 'Materiały'} do ${d.procedure ? 'sprawy' : 'punktu'} ${listing(mats.map(x => quoted(x.title)))}.`, 'muted'));
  // Wersja 3 (rozdz. 5.8): zmiana rodzaju sprawy w trakcie obrad i sprawa niepoddana pod głosowanie (DA-8), a w głosowaniu
  // między posiedzeniami tryb tajny albo imienny z danymi uchwały albo głosowania (§ 11 ust. 2).
  for (const x of deviationsOf(d, ['rodzaj_sprawy', 'bez_glosowania', 'tryb_procedury'], it.id)) parts.push(p(x.text));
  if (it.note.trim()) parts.push(`<div class="note">${t(it.note.trim()).replace(/\n/g, '<br>')}</div>`);
  parts.push(...ballotBlocks(d, d.placed.get(it.id) ?? []));
  parts.push(...itemNotes(d, it, first).map(text => p(text, 'item-note')));
  return `<section class="item"><div class="item-start">${head}${parts[0] ?? ''}</div>${parts.slice(1).join('')}</section>`;
}

/**
 * Obecność z wpisów: „obecność od 10:02, wyjście 11:30, powrót 11:45” albo „nieobecność”. Zgłoszenia obecności (F9)
 * nie są obecnością: liczy się dopiero potwierdzenie (przybycie).
 */
function presenceText(m: Meeting, who: string, guest: boolean) {
  const events = m.presenceLog.filter(e => e.who === who && !!e.guest === guest && (e.type === 'przybycie' || e.type === 'wyjscie'));
  if (!events.length) return 'nieobecność';
  let arrived = false;
  return events.map(e => {
    if (e.type !== 'przybycie') return `wyjście ${time(e.at)}`;
    const text = arrived ? `powrót ${time(e.at)}` : `obecność od ${time(e.at)}`;
    arrived = true;
    return text;
  }).join(', ');
}
/**
 * Sposób potwierdzenia pierwszego przybycia: potwierdzenie przez samą osobę w aplikacji (posiedzenie zdalne),
 * zgłoszenie w aplikacji potwierdzone przez osobę prowadzącą obrady albo biuro (F9) albo zapis przez inną osobę.
 * Bez przybycia: zgłoszenie czekające na potwierdzenie, niepotwierdzone, odrzucone albo wycofane.
 */
function confirmedBy(d: Doc, who: string, guest: boolean, ownName: string) {
  const {m} = d;
  const own = m.presenceLog.filter(e => e.who === who && !!e.guest === guest);
  const first = own.find(e => e.type === 'przybycie');
  if (!first) {
    if (presenceOf(m, who, guest) === 'zgloszony') return m.status === 'zakonczone' ? 'zgłoszenie w aplikacji, niepotwierdzone' : 'zgłoszenie w aplikacji, czeka na potwierdzenie';
    const dropped = [...own].reverse().find(e => e.type === 'odrzucenie');
    if (!dropped) return '';
    return dropped.by === ownName ? 'zgłoszenie w aplikacji, wycofane' : `zgłoszenie w aplikacji, odrzucone przez ${byWhom(d, dropped.by, dropped.at)}`;
  }
  const exit = d.v3 && own.some(e => e.type === 'wyjscie' && e.via === 'przejmujacy') ? ', wyjście zapisane przez osobę, która przejęła prowadzenie' : '';
  // Wersja 3 (rozdz. 5.8): obecność zapisana razem z otwarciem posiedzenia albo z przejęciem prowadzenia obrad (D1).
  if (d.v3 && first.via === 'otwarcie') return 'obecność zapisana przy otwarciu posiedzenia' + exit;
  if (d.v3 && first.via === 'prowadzenie') return 'obecność zapisana przy przejęciu prowadzenia obrad' + exit;
  if (first.by === ownName) return 'potwierdzenie w aplikacji' + exit;
  return (first.reportedAt ? `zgłoszenie w aplikacji, potwierdzone przez ${byWhom(d, first.by, first.at)}` : `zapisane przez ${byWhom(d, first.by, first.at)}`) + exit;
}

/**
 * Sposób zakończenia głosowania między posiedzeniami (F7): przed terminem z policzeniem głosów albo przerwanie
 * z powodem bez rozstrzygnięcia. Starsze zapisy bez `ended` rozpoznaje się po wpisie dziennika i powodach zamknięcia.
 */
function procedureEnd(d: Doc) {
  const {m} = d;
  if (m.ended?.how === 'przerwij') return `przerwano, powód ${reasonText(m.ended.reason ?? '')}, rozstrzygnięcie nie zapadło (${m.ended.by})`;
  if (m.ended) return `przed terminem z policzeniem głosów (${m.ended.by})`;
  const early = [...m.log].reverse().find(l => l.text === 'Głosowanie między posiedzeniami zakończono przed czasem.');
  const reasons = m.ballots.map(b => b.closeReason);
  return early ? `przed terminem, ${early.by}` : reasons.length && reasons.every(r => r === 'wszyscy') ? 'zagłosowali wszyscy uprawnieni' : reasons.includes('czas') ? 'upłynął termin' : 'przed terminem';
}
/** Zmiany terminu głosowania między posiedzeniami (F7): przedłużenie albo skrócenie, z godzinami i osobą. */
function deadlineChanges(d: Doc) {
  const changes = d.m.deadlineChanges ?? [];
  if (!changes.length) return '';
  return `<h2>${t('Zmiany terminu głosowania')}</h2>` + table('Zmiany terminu głosowania', ['Zmiana', 'Dotychczasowy termin', 'Nowy termin', 'Zmienia'],
    changes.map(c => [t(shortAt(c.at)), t(shortAt(c.from)), t(`${shortAt(c.to)} (${c.to > c.from ? 'przedłużenie' : 'skrócenie'})`), t(c.by)]));
}

function invitedRows(d: Doc) {
  const kindName = (a: Account) => a.label || (a.kind === 'doradczy' ? 'głos doradczy' : a.kind === 'gosc' ? 'gość' : '');
  return d.m.invited.map(id => d.accounts.find(a => a.id === id)).filter((a): a is Account => !!a)
    .map(a => ({id: a.id, name: a.displayName, label: kindName(a)}));
}

function chapterOne(d: Doc) {
  const {m} = d;
  const out = [`<h2>${t('I. Zwołanie i prowadzenie obrad')}</h2>`];
  // Dni liczone do dnia z nagłówka protokołu (dzień otwarcia, a przed otwarciem planowany termin).
  const days = noticeDays({...m, date: minutesDay(m)});
  const sent = `Zawiadomienie o terminie, miejscu i porządku obrad wysłano ${longDate(m.noticeDate)}`;
  if (days === null) out.push(p('Nie wpisano daty wysłania zawiadomienia (§ 7 ust. 1).'));
  else if (days <= 0) out.push(p(`${sent}, czyli mniej niż wymagane 7 dni przed posiedzeniem (§ 7 ust. 1).`));
  else out.push(p(`${sent}, ${days} ${plural(days, 'dzień', 'dni', 'dni')} przed posiedzeniem${days < 7 ? ', czyli mniej niż wymagane 7 dni' : ''} (§ 7 ust. 1).`));
  if (m.openedAt) out.push(p(m.closedAt ? `Posiedzenie otwarto o godz. ${time(m.openedAt)}, a zamknięto o godz. ${time(m.closedAt)}.` : `Posiedzenie otwarto o godz. ${time(m.openedAt)}.`));
  else out.push(p('Posiedzenia jeszcze nie otwarto.'));
  if (d.v3) {
    // Wersja 3 (rozdz. 5.8): zastępstwo, otwarcie z podstawą, wyjście zapisane przez przejmującego i zmiany prowadzenia.
    for (const x of deviationsOf(d, ['zastepstwo'])) out.push(p(x.text));
    for (const c of m.chair.changes) {
      if (c.opening) {
        const note = c.basis === 'zastepca' || c.basis === 'bez_wyznaczenia' || c.basis === 'zamiast_zastepcy' ? ` ${inParens(chairNote(c))}` : '';
        out.push(p(`Posiedzenie otwiera ${who(d, c.to)}${note}.`));
        continue;
      }
      if (c.recordedExit) out.push(p(`O godz. ${time(c.at)} zapisano wyjście osoby prowadzącej obrady. Wyjście zapisała osoba, która przejęła prowadzenie.`));
      const note = chairNote(c);
      out.push(p(`Od godz. ${time(c.at)} obrady prowadzi ${who(d, c.to)}${note ? ` ${inParens(note)}` : ''}.`));
    }
    for (const x of deviationsOf(d, ['gosc'])) out.push(p(x.text));
  } else {
    for (const c of m.chair.changes) out.push(p(`Od godz. ${time(c.at)} obrady prowadzi ${who(d, c.to)}${c.reason ? ` ${inParens(c.reason)}` : ''}.`));
    if (m.chair.deputy) out.push(p(`Na czas nieobecności przewodniczącego zastępuje go ${who(d, m.chair.deputy)}${m.chair.deputyBasis ? ` ${inParens(m.chair.deputyBasis)}` : ''}.`));
  }
  if (m.working) out.push(p(workingText(d)));
  // Przerwy z par wpisów dziennika „Przerwa w obradach.” i „Wznowienie obrad.”.
  const breaks: {from: number; to?: number}[] = [];
  for (const l of m.log) {
    if (l.text === 'Przerwa w obradach.') breaks.push({from: l.at});
    else if (l.text === 'Wznowienie obrad.' && breaks.length && breaks[breaks.length - 1].to === undefined) breaks[breaks.length - 1].to = l.at;
  }
  for (const b of breaks) {
    const it = itemAt(m, b.from);
    const point = it ? ` (punkt ${itemNumber(m.agenda, it.id)})` : '';
    out.push(p(b.to ? `Obrady przerwano w godz. ${time(b.from)}–${time(b.to)}${point}.` : `Obrady przerwano o godz. ${time(b.from)}${point}.`));
  }
  // F1: głosowanie próbne jednym zdaniem, bez wyniku (nie ma skutków).
  for (const b of d.trials) out.push(p(`O godz. ${time(b.openedAt)} przeprowadzono głosowanie próbne (${modeWord(b.mode)}) w celu sprawdzenia działania systemu.`));
  if (m.mode === 'zdalne') {
    let host = '';
    try { host = m.link ? new URL(m.link).hostname : ''; } catch { host = ''; }
    out.push(p(`Posiedzenie odbyło się przy wykorzystaniu środków bezpośredniego porozumiewania się na odległość (§ 14 ust. 5 ${d.regulation}). `
      + (host ? `Uczestnicy łączyli się przez ${host}, a obecność potwierdzali i głosy oddawali w aplikacji, każdy na własnym koncie.` : 'Uczestnicy obecność potwierdzali i głosy oddawali w aplikacji, każdy na własnym koncie.')));
  }
  return out.join('');
}

/**
 * Spotkanie robocze (F5): brak kworum z liczbami (ostatnie stwierdzenie przed rozpoczęciem spotkania roboczego,
 * a bez niego obecni według listy obecności) i godzina, od której obrady szły jako spotkanie robocze.
 */
function workingText(d: Doc) {
  const {m} = d;
  const w = m.working!;
  const total = membersOf(d).length;
  const check = [...m.quorumChecks].reverse().find(q => q.at <= w.at);
  const first = check && check.present < check.required
    ? `O godz. ${time(check.at)} stwierdzono brak kworum (obecnych ${check.present} z ${total} członków Prezydium, wymagane co najmniej ${check.required}, § 8 ust. 2).`
    : `Nie stwierdzono kworum (obecnych ${presentAt(d, w.at)} z ${total} członków Prezydium, wymagane co najmniej ${d.v3 ? quorumOf(d.law, total) : quorumFor(total)}, § 8 ust. 2).`;
  return `${first} Od godz. ${time(w.at)} obrady kontynuowano jako spotkanie robocze. Bez kworum Prezydium nie podejmuje uchwał.`;
}

function chapterTwo(d: Doc) {
  const {m, roster} = d;
  const members = membersOf(d);
  const out = [`<h2>${t('II. Lista obecności')}</h2>`];
  const head = ['Imię i nazwisko', 'Funkcja', 'Obecność', 'Sposób potwierdzenia'];
  out.push(table('Lista obecności', head, members.map(ms => {
    const name = personName(roster, ms.personId);
    return [t(name), t(ms.label), t(presenceText(m, ms.personId, false)), t(confirmedBy(d, ms.personId, false, name))];
  }), [], true, 'attendance-table'));
  const invited = invitedRows(d);
  if (invited.length) {
    out.push(`<h3>${t('Osoby z głosem doradczym i goście')}</h3>`);
    out.push(table('Osoby z głosem doradczym i goście', head, invited.map(a => [t(a.name), t(a.label), t(presenceText(m, a.id, true)), t(confirmedBy(d, a.id, true, a.name))]), [], true, 'attendance-table'));
  }
  // Zdanie o składzie i lista stwierdzeń kworum w jednym bloku: w druku lista nie zaczyna sama następnej strony.
  const checks = m.quorumChecks.length ? '<ul class="quorum-checks">' + m.quorumChecks.map(q => `<li>${t(`O godz. ${time(q.at)} stwierdzono ${q.present >= q.required ? 'kworum' : 'brak kworum'}, obecnych ${q.present}, wymagane ${q.required}.`)}</li>`).join('') + '</ul>' : '';
  const required = d.v3 ? quorumOf(d.law, members.length) : quorumFor(members.length);
  // Wersja 3 (rozdz. 5.8): po zdaniu o kworum wymagana większość z profilu prawnego.
  const majority = d.v3 ? p(`Uchwały podejmuje się zwykłą większością głosów (${d.law.majority.basis}).`) : '';
  out.push(`<div class="quorum-summary">${p(`Skład Prezydium ${members.length} ${plural(members.length, 'osoba', 'osoby', 'osób')}, wymagane kworum ${required} (${d.v3 ? d.law.quorum.basis : '§ 8 ust. 2'}).`)}${majority}${checks}</div>`);
  return out.join('');
}

function chapterThree(d: Doc) {
  const {m} = d;
  const flags = (i: AgendaItem) => [i.addedAfterAdoption && 'dodany po przyjęciu porządku', i.status === 'odroczony' && 'odroczony', i.status === 'wycofany' && 'wycofany']
    .filter(Boolean).map(f => ` <em>${t(`(${f})`)}</em>`).join('');
  const line = (i: AgendaItem) => `<span class="minutes-no">${t(`${itemNumber(m.agenda, i.id)}.`)}</span> <span class="minutes-title">${t(i.title)}${flags(i)}</span>`;
  const list = d.word ? orderedAgenda(m.agenda).map(i => `<p class="agenda-line${i.parentId ? ' agenda-sub' : ''}">${line(i)}</p>`).join('') : '<ol class="minutes-agenda">' + m.agenda.filter(i => !i.parentId).map(top => {
    const subs = m.agenda.filter(i => i.parentId === top.id);
    return `<li>${line(top)}${subs.length ? '<ol>' + subs.map(s => `<li>${line(s)}</li>`).join('') + '</ol>' : ''}</li>`;
  }).join('') + '</ol>';
  const adoption = [...m.ballots].reverse().find(b => b.purpose === 'porzadek' && b.result?.adopted);
  // F2: porządek przyjmuje się przy ogłoszeniu wyniku. Osoba, która wyniku jeszcze nie widzi, nie dostaje zdania
  // o przyjęciu porządku; osoba prowadząca obrady widzi je od razu po zamknięciu głosowania.
  const hiddenAdoption = m.ballots.some(b => b.purpose === 'porzadek' && d.hidden.has(b.id));
  const adopted = !hiddenAdoption && (m.agendaAdopted || !!adoption?.outcomePending);
  const sentence = adopted ? (adoption ? `Porządek obrad przyjęto w głosowaniu nr ${adoption.number}.` : 'Porządek obrad przyjęto.')
    : hiddenAdoption ? '' : d.note ? 'Porządku obrad nie przyjęto. Na spotkaniu roboczym nie przeprowadza się głosowań.' : 'Porządek obrad nie został przyjęty.';
  // Wersja 3 (rozdz. 5.8): punkty dodane po wysłaniu zawiadomienia i punkty wymienione w § 9 ust. 2 pominięte z powodem.
  const deviations = deviationsOf(d, ['poza_zawiadomieniem', 'pominiety_punkt']).map(x => p(x.text)).join('');
  return `<h2>${t('III. Porządek obrad')}</h2>` + list + deviations + draftChanges(d, adopted ? adoption : undefined, adopted) + (sentence ? p(sentence) : '');
}

/**
 * Zmiany projektu porządku obrad na posiedzeniu (F8): wpisy dziennika z oznaczeniem `projekt` do chwili przyjęcia
 * porządku, z godziną, przed zdaniem o przyjęciu porządku.
 */
function draftChanges(d: Doc, adoption: Ballot | undefined, adopted: boolean) {
  const {m} = d;
  const until = adopted && adoption?.closedAt ? adoption.closedAt : Infinity;
  // Wersja 3: dziennik ma zmiany projektu także sprzed otwarcia; protokół wymienia tylko te od otwarcia (rozdz. 2.8 pkt 2).
  const entries = m.log.filter(l => l.tag === 'projekt' && l.at >= (m.openedAt ?? Infinity) && l.at <= until);
  if (!entries.length) return '';
  const text = (l: {at: number; text: string}) => {
    const change = l.text.replace(/^Zmieniono projekt porządku obrad\.\s*/, '').replace(' ma nową nazwę ', ' otrzymał nową nazwę ');
    return `O godz. ${time(l.at)} ${change.charAt(0).toLowerCase()}${change.slice(1)}`;
  };
  return p(adopted ? 'Przed przyjęciem porządku obrad osoba prowadząca obrady zmieniła jego projekt.' : `W trakcie ${d.note ? 'spotkania' : 'posiedzenia'} osoba prowadząca obrady zmieniła projekt porządku obrad.`)
    + '<ul class="draft-changes">' + entries.map(l => `<li>${t(text(l))}</li>`).join('') + '</ul>';
}

function chapterFour(d: Doc) {
  const {m} = d;
  const top = m.agenda.find(i => !i.parentId);
  const out = [`<h2>${t('IV. Przebieg obrad')}</h2>`];
  for (const it of orderedAgenda(m.agenda)) out.push(itemSection(d, it, it === top));
  if (d.loose.length) out.push(`<h3>${t('Głosowania poza punktami porządku obrad')}</h3>` + ballotsWithMotions(d, d.loose));
  return out.join('');
}

function chapterFive(d: Doc) {
  const {m} = d;
  // Wersja 3 (rozdz. 5.8): w wykazie także inne akty, których rodzaj stoi w wykazie aktów protokołu (`inActs`).
  const inActs = (b: Ballot) => d.v3 && !notVoted.has(b.purpose) && !!d.types.find(x => x.id === ballotDocType(m, b))?.inActs;
  const adopted = m.ballots.filter(b => b.result?.adopted && (!b.supersededBy || d.hidden.has(b.supersededBy)) && !d.hidden.has(b.id) && (isResolution(m, b) || inActs(b))).sort((x, y) => x.number - y.number);
  const others = adopted.some(b => !isResolution(m, b));
  const out = [`<h2>${t(others ? 'V. Podjęte uchwały i inne akty' : 'V. Podjęte uchwały')}</h2>`];
  if (!adopted.length) return out.concat(p('Nie podjęto uchwał.')).join('');
  out.push(table(others ? 'Podjęte uchwały i inne akty' : 'Podjęte uchwały', ['Numer', 'W sprawie', 'Za', 'Przeciw', 'Wstrzymało się'], adopted.map(b => {
    const ref = b.material ? m.materials.find(x => x.id === b.material!.id) : undefined;
    const title = (b.material?.title ?? b.subject).trim();
    const number = ref?.number.trim() || /\bnr\s+([^\s,]+)/i.exec(title)?.[1]?.replace(/[.,;:]$/, '') || DOTS;
    const at = title.indexOf(' w sprawie ');
    return [t(number), t(at >= 0 ? title.slice(at + ' w sprawie '.length) : title), String(b.result!.za), String(b.result!.przeciw), String(b.result!.wstrzymuje)];
  }), [2, 3, 4], true, 'resolutions-table'));
  return out.join('');
}

// Notatka ze spotkania roboczego (F5) nie ma rozdziału „Podjęte uchwały”, więc załączniki mają numer V.
function chapterSix(d: Doc) {
  const list = d.note ? ['Lista obecności.', 'Porządek obrad.', 'Materiały omówione na spotkaniu.'] : ['Lista obecności.', 'Porządek obrad.', 'Podjęte uchwały.', 'Materiały rozpatrzone na posiedzeniu.'];
  return `<h2>${t(`${d.note ? 'V' : 'VI'}. Załączniki`)}</h2>` + p('Wykaz załączników do uzupełnienia przez sekretarza.')
    + '<ol class="attachments">' + list.map(x => `<li>${t(x)}</li>`).join('') + '</ol>';
}

function signatures(d: Doc) {
  const {m, roster} = d;
  const secretary = membersOf(d).find(ms => ms.func === 'sekretarz');
  const chair = m.chair.current ? personName(roster, m.chair.current) : DOTS;
  // F10: protokolant z danych do protokołu. Notatkę (F5) podpisuje osoba prowadząca i osoba, która ją sporządza.
  const people: [string, string][] = d.note ? [
    ['Osoba prowadząca spotkanie', chair],
    ['Osoba sporządzająca notatkę', m.recorder || DOTS],
  ] : [
    [d.procedure ? 'Zarządzający głosowanie' : 'Przewodniczący obrad', chair],
    ['Sekretarz lub zastępujący go członek Prezydium', secretary ? personName(roster, secretary.personId) : DOTS],
    ['Protokolant (jeżeli został wyznaczony)', m.recorder || DOTS],
  ];
  // DA-18: pod protokołem podpisuje osoba, która zamknęła obrady; gdy prowadzenie się zmieniało, zdanie o pozostałych.
  const others = d.v3 && !d.procedure ? [...new Set(m.chair.changes.map(c => c.to))].filter(id => id !== m.chair.current) : [];
  const also = others.length ? p(`Obrady prowadzili także ${listing(others.map(id => who(d, id)))}.`, 'signatures-note') : '';
  if (d.word) return '<table class="signatures"><tr>' + people.map(([role, name]) => `<td>${'.'.repeat(30)}<br>${t(role)}<br><b>${t(name)}</b></td>`).join('') + '</tr></table>' + also;
  return '<div class="signatures">' + people.map(([role, name]) => `<div class="signature"><span class="signature-role">${t(role)}</span><span class="signature-name">${t(name)}</span></div>`).join('') + '</div>' + also;
}

function footer(d: Doc, generatedAt: number) {
  const {m} = d;
  if (d.note) return p(`Projekt notatki wygenerowany z zapisu aplikacji ${longAt(generatedAt)}. Uchwały w sprawach z porządku obrad podejmie Prezydium na posiedzeniu z kworum.`, 'muted footer');
  const what = d.procedure ? 'głosowania' : 'obrad';
  // Wersja 3: termin z profilu prawnego organu (law.minutes.deadlineDays, § 13 ust. 2), dla Prezydium 21 dni.
  const days = d.law.minutes.deadlineDays;
  const deadline = m.closedAt
    ? `Termin sporządzenia protokołu ${longDate(addDays(dayOf(m.closedAt), days))} (${days} dni od zakończenia ${what}).`
    : `Protokół sporządza się w terminie ${days} dni od zakończenia ${what}.`;
  return p(`Projekt wygenerowany z zapisu aplikacji ${longAt(generatedAt)}. ${deadline} Protokół przyjmuje Prezydium na następnym posiedzeniu.`, 'muted footer')
    + p(`Protokół przyjęto na posiedzeniu Prezydium w dniu ${DOTS}`, 'adoption');
}

/** Załącznik do podpisu przy posiedzeniu stacjonarnym (na osobnej stronie wydruku). */
function attendanceSheet(d: Doc, organName: string) {
  const {m, roster} = d;
  const rows = [
    ...membersOf(d).map(ms => [t(personName(roster, ms.personId)), t(ms.label), '']),
    ...invitedRows(d).map(a => [t(a.name), t(a.label), '']),
  ];
  return '<section class="attachment">' + p(`Załącznik nr 1 do ${d.note ? 'notatki' : 'protokołu'}`, 'draft') + `<h2>${t('Lista obecności')}</h2>`
    + p(`${d.note ? 'Spotkanie robocze' : 'Posiedzenie'} ${organName} z dnia ${longDate(minutesDay(m))}`)
    + table('Lista obecności do podpisu', ['Imię i nazwisko', 'Funkcja', 'Podpis'], rows, [], true, 'sign-sheet') + '</section>';
}

export function minutesBody(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number, names: MinutesNames = {}, options: MinutesOptions = {}) {
  return render(m, roster, accounts, generatedAt, names, options, false);
}

function render(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number, names: MinutesNames, options: MinutesOptions, word: boolean) {
  const organ = organOf(roster, m.organ);
  const council = (organOf(roster, 'rada')?.name ?? 'Okręgowa Rada').replace(/^Okręgowa Rada/, 'Okręgowej Rady');
  const procedure = m.kind === 'procedura';
  const note = isNote(m);
  const types = m.frozen?.docTypes ?? options.docTypes ?? defaultDocTypes;
  const v3 = !!m.frozen && !m.frozen.legacy;
  // Odstępstwa liczy domena; do nich wystarczą profil prawny, skład i konta (ustawienia ogólne ich nie zmieniają).
  const env = cascadeEnv({roster, bundle: {general: defaultGeneral(defaultSite), docTypes: types, revision: 0}, organ: m.organ, accounts});
  const d: Doc = {
    m, roster, accounts, procedure, office: names.office ?? 'biuro', regulation: names.regulation ?? `Regulaminu ${council}`, placed: new Map(), loose: [], trials: [],
    note, types: v3 ? types : options.docTypes ?? defaultDocTypes, hidden: new Set(options.hideUnannounced ? unannounced(m).map(b => b.id) : []), word,
    v3, law: lawOf(m.organ), members: organRoster(roster, m), deviations: v3 ? effectiveMeeting(env, m).deviations : [],
  };
  const known = new Set(m.agenda.map(i => i.id));
  for (const b of [...m.ballots].sort((x, y) => x.openedAt - y.openedAt || x.number - y.number)) {
    if (b.purpose === 'proba') { d.trials.push(b); continue; }
    const home = homeOf(m, b);
    if (home && known.has(home)) d.placed.set(home, [...(d.placed.get(home) ?? []), b]);
    else d.loose.push(b);
  }
  const organName = organ?.name ?? 'Prezydium';
  const number = m.protocolNumber?.trim() || DOTS;
  const facts: [string, string][] = [];
  if (procedure) {
    const end = m.closedAt ?? m.endsAt;
    facts.push(['Termin głosowania', m.openedAt ? `od ${shortAt(m.openedAt)}${end ? ` do ${shortAt(end)}` : ''}` : end ? `do ${shortAt(end)}` : DOTS]);
    // F10: data powiadomienia członków, zwołujący i protokolant z danych do protokołu.
    facts.push(['Powiadomienie członków', m.noticeDate ? longDate(m.noticeDate) : DOTS]);
    if (m.chair.current) facts.push(['Zarządzający', who(d, m.chair.current)]);
    if (m.convener) facts.push(['Zwołuje', who(d, m.convener)]);
    facts.push(['Protokołuje', m.recorder || DOTS]);
    if (m.status === 'zakonczone') facts.push(['Zakończenie', procedureEnd(d)]);
  } else {
    const hours = m.openedAt ? (m.closedAt ? `${time(m.openedAt)}–${time(m.closedAt)}` : time(m.openedAt)) : m.time;
    facts.push(['Termin', `${longDate(minutesDay(m))}, godz. ${hours}`]);
    if (m.place.trim()) facts.push(['Miejsce', m.place.trim()]);
    facts.push(['Tryb', m.mode === 'zdalne' ? `posiedzenie zdalne (§ 14 ust. 5 ${d.regulation})` : 'posiedzenie stacjonarne']);
    facts.push(['Zwołuje', m.convener ? who(d, m.convener) : DOTS]);
    if (m.chair.current) facts.push(['Prowadzi', who(d, m.chair.current)]);
    facts.push([note ? 'Notatkę sporządza' : 'Protokołuje', m.recorder || DOTS]);
  }
  const title = procedure
    ? `${t(`Protokół nr ${number} z głosowania między posiedzeniami`)} <b>${t(organName)}</b>`
    : note
      ? `${t('Notatka ze spotkania roboczego')} <b>${t(organName)}</b> ${t(`z dnia ${longDate(minutesDay(m))}`)}`
      : `${t(`Protokół nr ${number} z posiedzenia`)} <b>${t(organName)}</b> ${t(`z dnia ${longDate(minutesDay(m))}`)}`;
  const factList = word
    ? `<table class="facts">${facts.map(([label, value]) => `<tr><th scope="row">${t(label)}</th><td>${t(value)}</td></tr>`).join('')}</table>`
    : `<dl class="facts minutes-facts">${facts.map(([label, value]) => `<div class="fact"><dt>${t(label)}</dt><dd>${t(value)}</dd></div>`).join('')}</dl>`;
  const parts = [`<header><p class="draft">${t(note ? 'Projekt notatki do uzupełnienia' : 'Projekt do uzupełnienia przez sekretarza')}</p><h1>${title}</h1>${factList}</header>`];
  if (procedure) {
    if (v3 && m.chair.current) {
      // Wersja 3 (rozdz. 5.8, DA-12): kto zarządza głosowaniem, a przy zastępcy podstawa wyznaczenia.
      const deputy = deputyOf(roster, m) === m.chair.current;
      parts.push(p(`Głosowaniem zarządza ${who(d, m.chair.current)}${deputy ? ', zastępca wyznaczony przez przewodniczącego (§ 16 ust. 2)' : ''}.`));
    }
    for (const x of deviationsOf(d, ['termin_procedury'])) parts.push(p(x.text));
    parts.push(deadlineChanges(d));
    parts.push(`<h2>${t('Sprawy i wyniki')}</h2>`);
    for (const it of orderedAgenda(m.agenda)) {
      if (!d.placed.get(it.id)?.length && !it.note.trim() && !it.materialIds.length) continue;
      parts.push(itemSection(d, it, false));
    }
    if (d.loose.length) parts.push(`<h3>${t('Głosowania poza sprawami')}</h3>` + ballotsWithMotions(d, d.loose));
    if (m.messages.length) parts.push(`<h2>${t('Wiadomości uczestników w trakcie głosowania')}</h2><ul class="messages">`
      + m.messages.map(x => `<li><strong>${t(x.authorName)}</strong>, ${t(`${longAt(x.at)} ${quoted(x.text)}`)}</li>`).join('') + '</ul>');
    parts.push(signatures(d), footer(d, generatedAt));
  } else {
    parts.push(chapterOne(d), chapterTwo(d), chapterThree(d), chapterFour(d));
    if (!note) parts.push(chapterFive(d));
    parts.push(chapterSix(d), signatures(d), footer(d, generatedAt));
    if (m.mode === 'stacjonarne') parts.push(attendanceSheet(d, organName));
  }
  return parts.join('\n');
}

export interface MinutesLook { css?: string | null; logo?: string | null; nameplate?: [string, string] | null; org?: string; names?: MinutesNames; options?: MinutesOptions }

// Pełna strona do druku: ten sam arkusz stylów co aplikacja (krój, kolory i nagłówki Izby), znak Izby na górze.
// Blok stylu dodaje nagłówek stron od drugiej (numery stron są w protokol.css).
export function minutesHtml(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number, look: MinutesLook = {}) {
  const plate = look.logo && look.nameplate ? `<div class="oi-nameplate"><img src="${esc(look.logo)}" alt="Znak ${esc((look.org ?? '').replace(/^Okręgowa Izba/, 'Okręgowej Izby'))}"><p class="oi-nameplate__name">${t(look.nameplate[0])} <b>${t(look.nameplate[1])}</b></p></div>` : '';
  const style = look.css ? `<link rel="stylesheet" href="${esc(look.css)}">` : '<style>body{font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:24px}</style>';
  const header = minutesPageHeader(m).replace(/["\\]/g, '\\$&');
  const pages = `<style>@media print{@page{@top-left{content:"${header}"}}@page:first{@top-left{content:none}}}</style>`;
  const doc = `/api/meetings/${encodeURIComponent(m.id)}/protokol?format=doc`;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(minutesTitle(m))} – ${esc(m.title)}</title>${style}${pages}</head>
<body class="oi-root minutes-page"><div class="toolbar"><span class="kicker">${t(minutesTitle(m))}</span><div class="toolbar-actions"><a class="oi-btn oi-btn--obrys" href="${esc(doc)}"><span>${t('Pobierz do edycji w Wordzie')}</span></a><button type="button" class="oi-btn" data-print><span>${t('Drukuj lub zapisz jako PDF')}</span></button></div></div>
<main>${plate}<article class="minutes-view">${minutesBody(m, roster, accounts, generatedAt, look.names, look.options)}</article></main><script src="/druk.js"></script></body></html>`;
}

// Plik do edycji w Wordzie: ten sam tekst z prostym stylem wewnętrznym (Titillium Web albo Arial, bez kolorów), bez skryptów.
const docStyle = '@page Section1{size:21cm 29.7cm;margin:2cm}div.Section1{page:Section1}'
  + 'body,h1,h2,h3,p,li,th,td,dt,dd{font-family:"Titillium Web",Arial,sans-serif}body{font-size:11pt;line-height:1.4}'
  + 'h1{font-size:16pt;font-weight:normal;margin:6pt 0 12pt}h1 b{font-weight:bold}'
  + 'h2{font-size:13pt;font-weight:bold;margin:18pt 0 6pt;page-break-after:avoid}h3{font-size:11pt;font-weight:bold;margin:12pt 0 4pt;page-break-after:avoid}'
  + 'p,li{margin:0 0 6pt}dl{margin:0 0 12pt}dt{font-size:9pt;font-weight:bold;text-transform:uppercase;margin:4pt 0 0}dd{margin:0 0 4pt}'
  + 'table{border-collapse:collapse;width:100%;margin:4pt 0 10pt}th,td{border:1px solid;padding:3pt 5pt;text-align:left;vertical-align:top;font-size:10pt}'
  + '.oi-liczba{text-align:right}.draft{font-size:9pt;font-weight:bold;text-transform:uppercase}.ballot{margin:8pt 0}.ballot-head{margin-bottom:2pt}'
  + 'table.facts{width:auto;margin:0 0 6pt}table.facts th,table.facts td{border:0;padding:1pt 12pt 1pt 0}table.facts th{font-size:9pt;text-transform:uppercase}'
  + '.agenda-line{margin:0 0 3pt}.agenda-sub{margin-left:24pt}.note{margin:4pt 0 8pt}'
  + 'table.signatures{margin-top:36pt}table.signatures td{border:0;width:33%;text-align:center;font-size:9pt}'
  + '.attachment{page-break-before:always}.sign-sheet td{height:28pt}';
export function minutesDoc(m: Meeting, roster: Roster, accounts: Account[], generatedAt: number, look: MinutesLook = {}) {
  const org = look.org ? `<p class="org">${t(look.org)}</p>` : '';
  // Łącznik słów (U+2060) wokół półpauzy w przedziałach nie jest potrzebny w edytorze i bywa w nim widoczny.
  const body = render(m, roster, accounts, generatedAt, look.names ?? {}, look.options ?? {}, true).replace(/\u2060/g, '');
  return `<!doctype html><html lang="pl" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="ProgId" content="Word.Document"><title>${t(`${minutesTitle(m)} – ${m.title}`)}</title>`
    + `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]--><style>${docStyle}</style></head>`
    + `<body><div class="Section1">${org}<article class="minutes-view">${body}</article></div></body></html>`;
}
