import type {AgendaItem, Ballot, BallotResult, Choice, Meeting, Roster} from './types.ts';
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

export function resultLabel(b: Ballot) {
  const r = b.result;
  if (!r) return 'Głosowanie trwa';
  if (!r.quorumMet) return 'Brak kworum — rozstrzygnięcie nie zapadło';
  const ok = r.adopted;
  switch (b.purpose) {
    case 'uchwala': return ok ? 'Uchwała przyjęta' : 'Uchwała nie została przyjęta';
    case 'porzadek': return ok ? 'Porządek obrad przyjęty' : 'Porządek obrad nie został przyjęty';
    case 'zmiana_porzadku': return ok ? 'Zmiana porządku obrad przyjęta' : 'Zmiana porządku obrad odrzucona';
    case 'protokol': return ok ? 'Protokół przyjęty' : 'Protokół nie został przyjęty';
    case 'tryb': return ok ? 'Wniosek o zmianę trybu głosowania przyjęty' : 'Wniosek o zmianę trybu głosowania odrzucony';
    case 'reasumpcja': return ok ? 'Wniosek o reasumpcję przyjęty' : 'Wniosek o reasumpcję odrzucony';
    case 'wniosek': return ok ? 'Wniosek przyjęty' : 'Wniosek odrzucony';
    default: return ok ? 'Przyjęto' : 'Nie przyjęto';
  }
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
