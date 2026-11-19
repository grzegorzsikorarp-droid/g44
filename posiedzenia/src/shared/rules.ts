import type {AgendaItem, Ballot, BallotResult, Choice, DocType, MaterialType, Meeting, Presence, Roster} from './types.ts';
import {organMembers} from './roster.ts';
import {defaultDocTypes, docTypeById} from './doctypes.ts';

// § 8 ust. 2: organ jest władny do podejmowania uchwał przy obecności co najmniej połowy członków.
export const quorumFor = (membersTotal: number) => Math.ceil(membersTotal / 2);

// § 12 ust. 5: pisemny wniosek co najmniej 1/3 członków biorących udział w posiedzeniu.
export const reasumptionSignaturesNeeded = (present: number) => Math.max(1, Math.ceil(present / 3));

export const choices: Choice[] = ['za', 'przeciw', 'wstrzymuje'];

export function memberIds(roster: Roster, organ: string) {
  return organMembers(roster, organ).map(m => m.personId);
}

export function presentMembers(meeting: Meeting, roster: Roster) {
  return memberIds(roster, meeting.organ).filter(id => meeting.attendance[id] === 'obecny');
}

export function hasVoted(b: Ballot, personId: string) {
  return b.secret ? b.secret.issued.includes(personId) : personId in b.votes;
}

// Uprawnieni, którzy jeszcze nie oddali głosu i nie zostali oznaczeni jako nieobecni.
export function pendingVoters(b: Ballot) {
  return b.eligible.filter(id => !hasVoted(b, id) && !b.absentDuring.includes(id));
}

// Głosowanie kończy się wcześniej, gdy zagłosują wszyscy uprawnieni.
// W tajnym: każdy pobrał kartę i wszystkie pobrane karty wróciły jako głosy.
export function everyoneVoted(b: Ballot) {
  if (pendingVoters(b).length) return false;
  return b.secret ? b.secret.cast >= b.secret.issued.length : true;
}

export function openTally(b: Ballot) {
  const counts = {za: 0, przeciw: 0, wstrzymuje: 0};
  for (const choice of Object.values(b.votes)) counts[choice]++;
  return counts;
}

// Uczestnicy głosowania na posiedzeniu: obecni przy otwarciu i dołączający, bez osób,
// które wyszły i nie oddały głosu. W procedurze między posiedzeniami: oddający głos.
export function participants(b: Ballot, cast: number) {
  if (b.remote) return cast;
  return b.eligible.filter(id => hasVoted(b, id) || !b.absentDuring.includes(id)).length;
}

// § 8 ust. 3: uchwały podejmuje się zwykłą większością głosów — więcej „za” niż „przeciw”.
export function computeResult(b: Ballot, counts: {za: number; przeciw: number; wstrzymuje: number}): BallotResult {
  const cast = counts.za + counts.przeciw + counts.wstrzymuje;
  const present = participants(b, cast);
  const quorumMet = present >= b.quorum;
  return {
    ...counts, cast, eligible: b.eligible.length, participants: present, quorum: b.quorum,
    quorumMet, adopted: quorumMet && counts.za > counts.przeciw,
  };
}

// Formuła rozstrzygnięcia według rodzaju sprawy. Głosowanie otwarte w wersji 2 ma formuły zapisane w chwili otwarcia
// (`formulas`, F11), więc późniejsza zmiana słownika nie zmienia historii. Starsze głosowania liczą formułę po dawnemu:
// rodzaj (`kind`) wynika z rodzaju materiału (materialTypeOf), a bez materiału z przedmiotu: przedmiot zaczynający się
// od „Uchwała”, „Projekt uchwały” albo „Podjęcie uchwały” dostaje formułę uchwały. Głosowania nad porządkiem, jego
// zmianą, reasumpcją i wnioskiem mają własne formuły, a głosowanie próbne i przerwane własne brzmienie.
const legacyDecisions: Record<string, [string, string]> = {
  uchwala: ['Uchwała podjęta', 'Uchwała nie została podjęta'],
  sprawozdanie: ['Sprawozdanie przyjęte', 'Sprawozdanie nie zostało przyjęte'],
  oswiadczenie: ['Stanowisko przyjęte', 'Stanowisko nie zostało przyjęte'],
  stanowisko: ['Stanowisko przyjęte', 'Stanowisko nie zostało przyjęte'],
  apel: ['Apel przyjęty', 'Apel nie został przyjęty'],
  rezolucja: ['Rezolucja przyjęta', 'Rezolucja nie została przyjęta'],
  deklaracja: ['Deklaracja przyjęta', 'Deklaracja nie została przyjęta'],
  protokol: ['Protokół przyjęty', 'Protokół nie został przyjęty'],
};
/** Przedmiot głosowania nad uchwałą bez dołączonego materiału. */
export const resolutionSubject = /^(uchwała|projekt uchwały|podjęcie uchwały)/i;
/** Wynik zamkniętego głosowania, którego osoba jeszcze nie widzi (F2). */
export const resultPendingText = 'Głosowanie zakończone. Wynik ogłosi osoba prowadząca obrady.';
/** To samo w głosowaniu między posiedzeniami, w którym nie ma obrad: wynik ogłasza przewodniczący albo wiceprzewodniczący. */
export const resultPendingProcedureText = 'Głosowanie zakończone. Wynik ogłosi przewodniczący albo wiceprzewodniczący.';
/** Formuła głosowania przerwanego bez rozstrzygnięcia (F7). */
export const abortedLabel = 'Głosowanie przerwane, rozstrzygnięcie nie zapadło';
/** Formuła wyniku głosowania próbnego (F1). */
export const trialLabel = 'Głosowanie próbne zakończone';

export function resultLabel(b: Ballot, kind?: MaterialType | null) {
  if (b.aborted) return abortedLabel;
  const r = b.result;
  if (!r) return b.status === 'zamkniete' ? 'Wynik ogłosi osoba prowadząca obrady' : 'Głosowanie trwa';
  if (b.purpose === 'proba') return trialLabel;
  if (!r.quorumMet) return 'Brak kworum, rozstrzygnięcie nie zapadło';
  const ok = r.adopted;
  const pick = (pair: [string, string]) => ok ? pair[0] : pair[1];
  switch (b.purpose) {
    case 'porzadek': return ok ? 'Porządek obrad przyjęty' : 'Porządek obrad nie został przyjęty';
    case 'zmiana_porzadku': return ok ? 'Zmiana porządku obrad przyjęta' : 'Zmiana porządku obrad odrzucona';
    case 'tryb': {
      const mode = b.target?.kind === 'tryb' ? b.target.mode : null;
      if (mode === 'tajne' || mode === 'imienne') return `Wniosek o głosowanie ${mode} ${ok ? 'przyjęty' : 'odrzucony'}`;
      return ok ? 'Wniosek o zmianę trybu głosowania przyjęty' : 'Wniosek o zmianę trybu głosowania odrzucony';
    }
    case 'reasumpcja': return ok ? 'Wniosek o reasumpcję przyjęty' : 'Wniosek o reasumpcję odrzucony';
    case 'wniosek': return ok ? 'Wniosek przyjęty' : 'Wniosek odrzucony';
  }
  if (b.formulas) return ok ? b.formulas.adopted : b.formulas.rejected;
  if (b.purpose === 'protokol') return pick(legacyDecisions.protokol);
  if (kind === 'oswiadczenie' && /^oświadczenie/i.test((b.material?.title ?? b.subject).trim())) return ok ? 'Oświadczenie przyjęte' : 'Oświadczenie nie zostało przyjęte';
  const formula = kind ? legacyDecisions[kind] : resolutionSubject.test(b.subject.trim()) ? legacyDecisions.uchwala : undefined;
  return formula ? pick(formula) : ok ? 'Przyjęto' : 'Nie przyjęto';
}

/** „Głosowanie próbne” albo „Głosowanie nr 4”. */
export const ballotTitle = (b: Pick<Ballot, 'purpose' | 'number'>) => b.purpose === 'proba' ? 'Głosowanie próbne' : `Głosowanie nr ${b.number}`;

/**
 * Zamknięte głosowania, których wynik nie został ogłoszony (F2), w kolejności numerów. Bez głosowań próbnych
 * i przerwanych. Dopóki lista nie jest pusta, domena odrzuca kolejne czynności prowadzenia obrad.
 */
export function unannounced(m: Pick<Meeting, 'ballots'>) {
  return m.ballots.filter(b => b.status === 'zamkniete' && b.purpose !== 'proba' && !b.aborted && !b.announcedAt).sort((a, b) => a.number - b.number);
}
/** Komunikat domeny przy nieogłoszonym wyniku albo null, gdy wszystkie wyniki są ogłoszone. */
export function announceFirst(m: Pick<Meeting, 'ballots'>) {
  const first = unannounced(m)[0];
  return first ? `Najpierw ogłoś wynik głosowania nr ${first.number}.` : null;
}

/** Posiedzenie kontynuowane jako spotkanie robocze bez kworum (F5). */
export const isWorking = (m: Pick<Meeting, 'working'>) => !!m.working;
/** Ostatnie stwierdzenie kworum było pozytywne (F5). */
export function quorumStated(m: Pick<Meeting, 'quorumChecks'>) {
  const last = m.quorumChecks.at(-1);
  return !!last && last.present >= last.required;
}

/** Stan obecności osoby (członka albo gościa po identyfikatorze konta). */
export const presenceOf = (m: Pick<Meeting, 'attendance' | 'guests'>, who: string, guest = false): Presence => (guest ? m.guests : m.attendance)[who] ?? 'nieobecny';
/** Zgłoszenia obecności czekające na potwierdzenie (F9), z godziną ostatniego zgłoszenia. */
export function pendingPresence(m: Pick<Meeting, 'attendance' | 'guests' | 'presenceLog'>) {
  const out: {who: string; guest: boolean; at: number}[] = [];
  for (const guest of [false, true]) {
    for (const [who, state] of Object.entries(guest ? m.guests : m.attendance)) {
      if (state !== 'zgloszony') continue;
      const event = [...m.presenceLog].reverse().find(e => e.who === who && !!e.guest === guest && e.type === 'zgloszenie');
      out.push({who, guest, at: event?.at ?? 0});
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Rodzaj materiału, nad którym głosowano, albo null, gdy głosowanie nie miało materiału. */
export function materialTypeOf(m: Pick<Meeting, 'materials'>, b: Pick<Ballot, 'material'>): MaterialType | null {
  const id = b.material?.id;
  return id ? m.materials.find(x => x.id === id)?.type ?? null : null;
}

/**
 * Rodzaj sprawy dla nowego głosowania (F11): wskazany przy otwarciu, potem „Co jest głosowane” w punkcie, rodzaj
 * materiału, przy głosowaniu nad protokołem „protokol”, a przy przedmiocie „Uchwała…” „uchwala”. Bez rodzaju null.
 */
export function docTypeFor(m: Pick<Meeting, 'materials'>, input: {explicit?: string | null; item?: Pick<AgendaItem, 'docType'>; materialId?: string | null; purpose: string; subject: string}) {
  if (input.explicit) return input.explicit;
  if (input.item?.docType) return input.item.docType;
  const material = input.materialId ? m.materials.find(x => x.id === input.materialId) : undefined;
  if (material) return material.type;
  if (input.purpose === 'protokol') return 'protokol';
  return resolutionSubject.test(input.subject.trim()) ? 'uchwala' : null;
}
/** Rodzaj sprawy zamkniętego głosowania: zapisany w głosowaniu, a w starszych z materiału albo przedmiotu. */
export function ballotDocType(m: Pick<Meeting, 'materials'>, b: Ballot) {
  if (b.docType) return b.docType;
  return materialTypeOf(m, b) ?? (b.purpose === 'protokol' ? 'protokol' : resolutionSubject.test(b.subject.trim()) ? 'uchwala' : null);
}

/** Osoby przy punkcie pogrupowane do wyświetlenia (F12): „Prowadzi punkt” i „Referuje” z listą „Imię Nazwisko, Funkcja”. */
export function presenterGroups(it: Pick<AgendaItem, 'presenters'>) {
  const line = (p: {name: string; role: string}) => p.role.trim() ? `${p.name}, ${p.role.trim()}` : p.name;
  const groups: {kind: 'prowadzi' | 'referuje'; label: string; people: string[]}[] = [];
  for (const [kind, label] of [['prowadzi', 'Prowadzi punkt'], ['referuje', 'Referuje']] as const) {
    const people = (it.presenters ?? []).filter(p => p.kind === kind).map(line);
    if (people.length) groups.push({kind, label, people});
  }
  return groups;
}

/** Osoby przy punkcie w jednym wierszu, np. „Referuje Anna Nowak, Sekretarz; Jan Kowalski”. Pusty napis bez osób. */
export const presentersText = (it: Pick<AgendaItem, 'presenters'>) => presenterGroups(it).map(g => `${g.label} ${g.people.join('; ')}`).join('. ');

/**
 * Punkty przyjętego porządku, które czekają przed danym punktem (F4): status „oczekuje”, bez „Zamknięcia posiedzenia”,
 * punktu nadrzędnego danego punktu, punktów głównych z podpunktami (liczą się podpunkty) i podpunktów punktu odroczonego
 * albo wycofanego. Niepusta lista oznacza rozpoczęcie poza kolejnością, które wymaga powodu.
 */
export function pendingBefore(m: Pick<Meeting, 'agenda'>, it: AgendaItem) {
  if (it.kind === 'zamkniecie') return [];
  const order = orderedAgenda(m.agenda);
  const closed = (x: AgendaItem | undefined) => x?.status === 'odroczony' || x?.status === 'wycofany';
  return order.slice(0, order.findIndex(x => x.id === it.id)).filter(x => x.status === 'oczekuje' && x.kind !== 'zamkniecie'
    && x.id !== it.parentId && !m.agenda.some(c => c.parentId === x.id) && !closed(m.agenda.find(p => p.id === x.parentId)));
}

// Uprawnieni, którzy jeszcze nie głosowali, liczeni z widoku osoby: w trakcie głosowania widok nie zawiera
// cudzych głosów, a tylko listę osób, które oddały głos albo pobrały kartę (voted). Bez oznaczonych jako nieobecni.
export function awaitingVote(b: Pick<Ballot, 'eligible' | 'absentDuring'> & {voted: string[]}) {
  return b.eligible.filter(id => !b.voted.includes(id) && !b.absentDuring.includes(id));
}

// Punkt, w którym Prezydium powinno głosować: porządek obrad przed przyjęciem, protokół, punkt z rodzajem
// „Co jest głosowane” wymagającym głosowania, podpunkt w punkcie „Podjęcie uchwał” albo punkt z materiałem,
// którego rodzaj wymaga głosowania. Wymóg głosowania bierze się ze słownika rodzajów (`voted`, F11).
export function needsVote(m: Pick<Meeting, 'agenda' | 'agendaAdopted' | 'materials'>, it: AgendaItem, types: DocType[] = defaultDocTypes) {
  if (it.kind === 'porzadek') return !m.agendaAdopted;
  if (it.kind === 'protokol') return true;
  const chosen = docTypeById(types, it.docType);
  if (chosen) return chosen.voted;
  if (it.parentId && m.agenda.find(i => i.id === it.parentId)?.kind === 'uchwaly') return true;
  return m.materials.some(x => it.materialIds.includes(x.id) && !!docTypeById(types, x.type)?.voted);
}

/** W punkcie zakończyło się głosowanie w sprawie (wnioski o tryb, reasumpcję, głosowania próbne i przerwane się nie liczą). */
export function itemVoted(m: Pick<Meeting, 'ballots'>, it: Pick<AgendaItem, 'id'>) {
  return m.ballots.some(b => b.itemId === it.id && b.status === 'zamkniete' && !b.aborted && b.purpose !== 'tryb' && b.purpose !== 'reasumpcja' && b.purpose !== 'proba');
}

// Punkty nierozpatrzone: nierozpoczęte albo wymagające głosowania, w których nie głosowano. Bez zamknięcia
// posiedzenia, punktów odroczonych i wycofanych oraz punktów głównych z podpunktami (liczą się podpunkty).
export function unhandledItems(m: Pick<Meeting, 'agenda' | 'agendaAdopted' | 'materials' | 'ballots'>, types: DocType[] = defaultDocTypes) {
  const closed = (it: AgendaItem | undefined) => it?.status === 'odroczony' || it?.status === 'wycofany';
  return orderedAgenda(m.agenda).filter(it => {
    if (it.kind === 'zamkniecie' || closed(it) || closed(m.agenda.find(i => i.id === it.parentId))) return false;
    if (m.agenda.some(c => c.parentId === it.id)) return false;
    return it.status === 'oczekuje' || (needsVote(m, it, types) && !itemVoted(m, it));
  });
}

export const modeLabel = {jawne: 'jawne', imienne: 'imienne', tajne: 'tajne'} as const;
export const choiceLabel = {za: 'Za', przeciw: 'Przeciw', wstrzymuje: 'Wstrzymuję się'} as const;
export const choiceCountLabel = {za: 'Za', przeciw: 'Przeciw', wstrzymuje: 'Wstrzymało się'} as const;

export function itemNumber(agenda: AgendaItem[], itemId: string | null) {
  const item = agenda.find(i => i.id === itemId);
  if (!item) return '';
  const top = agenda.filter(i => !i.parentId);
  if (!item.parentId) return String(top.indexOf(item) + 1);
  const parent = agenda.find(i => i.id === item.parentId)!;
  const siblings = agenda.filter(i => i.parentId === item.parentId);
  return `${top.indexOf(parent) + 1}.${siblings.indexOf(item) + 1}`;
}

export function orderedAgenda(agenda: AgendaItem[]) {
  const out: AgendaItem[] = [];
  for (const top of agenda.filter(i => !i.parentId)) {
    out.push(top, ...agenda.filter(i => i.parentId === top.id));
  }
  return out;
}
