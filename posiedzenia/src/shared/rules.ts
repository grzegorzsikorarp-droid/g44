import type {AgendaItem, Ballot, BallotResult, Choice, MaterialType, Meeting, Roster} from './types.ts';
import {organMembers} from './roster.ts';

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

// Formuła rozstrzygnięcia według rodzaju sprawy. Rodzaj (`kind`) wynika z rodzaju materiału (materialTypeOf),
// a bez materiału z przedmiotu: przedmiot zaczynający się od „Uchwała”, „Projekt uchwały” albo „Podjęcie uchwały”
// dostaje formułę uchwały. Głosowania nad porządkiem, jego zmianą, reasumpcją i wnioskiem mają własne formuły.
const decisions: Partial<Record<MaterialType, [string, string]>> = {
  uchwala: ['Uchwała podjęta', 'Uchwała nie została podjęta'],
  sprawozdanie: ['Sprawozdanie przyjęte', 'Sprawozdanie nie zostało przyjęte'],
  oswiadczenie: ['Stanowisko przyjęte', 'Stanowisko nie zostało przyjęte'],
  apel: ['Apel przyjęty', 'Apel nie został przyjęty'],
  rezolucja: ['Rezolucja przyjęta', 'Rezolucja nie została przyjęta'],
  deklaracja: ['Deklaracja przyjęta', 'Deklaracja nie została przyjęta'],
  protokol: ['Protokół przyjęty', 'Protokół nie został przyjęty'],
};
/** Przedmiot głosowania nad uchwałą bez dołączonego materiału. */
export const resolutionSubject = /^(uchwała|projekt uchwały|podjęcie uchwały)/i;

export function resultLabel(b: Ballot, kind?: MaterialType | null) {
  const r = b.result;
  if (!r) return 'Głosowanie trwa';
  if (!r.quorumMet) return 'Brak kworum, rozstrzygnięcie nie zapadło';
  const ok = r.adopted;
  const pick = (pair: [string, string]) => ok ? pair[0] : pair[1];
  switch (b.purpose) {
    case 'porzadek': return ok ? 'Porządek obrad przyjęty' : 'Porządek obrad nie został przyjęty';
    case 'zmiana_porzadku': return ok ? 'Zmiana porządku obrad przyjęta' : 'Zmiana porządku obrad odrzucona';
    case 'protokol': return pick(decisions.protokol!);
    case 'tryb': {
      const mode = b.target?.kind === 'tryb' ? b.target.mode : null;
      if (mode === 'tajne' || mode === 'imienne') return `Wniosek o głosowanie ${mode} ${ok ? 'przyjęty' : 'odrzucony'}`;
      return ok ? 'Wniosek o zmianę trybu głosowania przyjęty' : 'Wniosek o zmianę trybu głosowania odrzucony';
    }
    case 'reasumpcja': return ok ? 'Wniosek o reasumpcję przyjęty' : 'Wniosek o reasumpcję odrzucony';
    case 'wniosek': return ok ? 'Wniosek przyjęty' : 'Wniosek odrzucony';
  }
  if (kind === 'oswiadczenie' && /^oświadczenie/i.test((b.material?.title ?? b.subject).trim())) return ok ? 'Oświadczenie przyjęte' : 'Oświadczenie nie zostało przyjęte';
  const formula = kind ? decisions[kind] : resolutionSubject.test(b.subject.trim()) ? decisions.uchwala : undefined;
  return formula ? pick(formula) : ok ? 'Przyjęto' : 'Nie przyjęto';
}

/** Rodzaj materiału, nad którym głosowano, albo null, gdy głosowanie nie miało materiału. */
export function materialTypeOf(m: Pick<Meeting, 'materials'>, b: Pick<Ballot, 'material'>): MaterialType | null {
  const id = b.material?.id;
  return id ? m.materials.find(x => x.id === id)?.type ?? null : null;
}

// Uprawnieni, którzy jeszcze nie głosowali, liczeni z widoku osoby: w trakcie głosowania widok nie zawiera
// cudzych głosów, a tylko listę osób, które oddały głos albo pobrały kartę (voted). Bez oznaczonych jako nieobecni.
export function awaitingVote(b: Pick<Ballot, 'eligible' | 'absentDuring'> & {voted: string[]}) {
  return b.eligible.filter(id => !b.voted.includes(id) && !b.absentDuring.includes(id));
}

// Punkt, w którym Prezydium powinno głosować: porządek obrad przed przyjęciem, protokół, podpunkt w punkcie
// „Podjęcie uchwał” albo punkt z materiałem, który przyjmuje się w głosowaniu.
const votedMaterials = new Set<MaterialType>(['uchwala', 'oswiadczenie', 'apel', 'rezolucja', 'deklaracja', 'sprawozdanie', 'protokol']);
export function needsVote(m: Pick<Meeting, 'agenda' | 'agendaAdopted' | 'materials'>, it: AgendaItem) {
  if (it.kind === 'porzadek') return !m.agendaAdopted;
  if (it.kind === 'protokol') return true;
  if (it.parentId && m.agenda.find(i => i.id === it.parentId)?.kind === 'uchwaly') return true;
  return m.materials.some(x => it.materialIds.includes(x.id) && votedMaterials.has(x.type));
}

/** W punkcie zakończyło się głosowanie w sprawie (wnioski o tryb i o reasumpcję się nie liczą). */
export function itemVoted(m: Pick<Meeting, 'ballots'>, it: Pick<AgendaItem, 'id'>) {
  return m.ballots.some(b => b.itemId === it.id && b.status === 'zamkniete' && b.purpose !== 'tryb' && b.purpose !== 'reasumpcja');
}

// Punkty nierozpatrzone: nierozpoczęte albo wymagające głosowania, w których nie głosowano. Bez zamknięcia
// posiedzenia, punktów odroczonych i wycofanych oraz punktów głównych z podpunktami (liczą się podpunkty).
export function unhandledItems(m: Pick<Meeting, 'agenda' | 'agendaAdopted' | 'materials' | 'ballots'>) {
  const closed = (it: AgendaItem | undefined) => it?.status === 'odroczony' || it?.status === 'wycofany';
  return orderedAgenda(m.agenda).filter(it => {
    if (it.kind === 'zamkniecie' || closed(it) || closed(m.agenda.find(i => i.id === it.parentId))) return false;
    if (m.agenda.some(c => c.parentId === it.id)) return false;
    return it.status === 'oczekuje' || (needsVote(m, it) && !itemVoted(m, it));
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
