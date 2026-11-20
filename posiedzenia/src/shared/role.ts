import type {Actor, ChairBasis, Func, Meeting, Membership, OrganCode, Roster} from './types.ts';
import {lawOf} from './law.ts';
import {membership, organMembers, personName} from './roster.ts';

// Role i uprawnienia wersji 3 (specyfikacja, rozdz. 4). Kompetencje wynikają z funkcji w składzie albo ze stanu
// posiedzenia, nie z rodzaju konta (Z3). Biuro obsługuje, nie działa za organ (Z1, decyzja D1). Administrator to rola
// techniczna bez uprawnień w posiedzeniach i w ustawieniach ogólnych (Z4, DA-2). Edytora uprawnień nie ma (Z7):
// odpowiedź zleceniodawcy inna niż rekomendacja zmienia tylko wskazaną funkcję w tym pliku (pytania 2, 4, 6 i 8).

type M = Pick<Meeting, 'organ' | 'kind' | 'status' | 'frozen' | 'chair' | 'attendance' | 'invited' | 'agendaAdopted' | 'convener' | 'ballots'>;

export const isAdmin = (a: Actor) => a.account.admin;
/** Konto biura (z flagą administratora albo bez). Biuro nie wynika z flagi administratora. */
export const isOfficeAccount = (a: Actor) => a.account.kind === 'biuro';

/** Skład organu posiedzenia: zapisany przy otwarciu (`frozen.members`), a bez zapisu bieżący. */
export function organRoster(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>): Membership[] {
  if (!m.frozen) return organMembers(roster, m.organ);
  const law = lawOf(m.organ);
  return [...m.frozen.members].sort((a, b) => a.order - b.order)
    .map(f => ({organ: m.organ, personId: f.personId, func: f.func, label: f.label, order: f.order, canChair: law.chair.funcs.includes(f.func)}));
}
export function funcOf(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, personId: string | null): Func | undefined {
  return personId ? organRoster(roster, m).find(x => x.personId === personId)?.func : undefined;
}
/** Funkcja pozwala prowadzić obrady (§ 9 ust. 1): przewodniczący albo wiceprzewodniczący. */
export function canChairPerson(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, personId: string | null): boolean {
  const func = funcOf(roster, m, personId);
  return !!func && lawOf(m.organ).chair.funcs.includes(func);
}
export const isChairmanOf = (roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, personId: string | null) => funcOf(roster, m, personId) === 'przewodniczacy';
/** Wyznaczony zastępca przewodniczącego, o ile nadal ma funkcję wiceprzewodniczącego. */
export function deputyOf(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'chair'>): string | null {
  const id = m.chair.deputy;
  return id && funcOf(roster, m, id) === 'wiceprzewodniczacy' ? id : null;
}
/** Kolejność do prowadzenia obrad (DA-17): 1 przewodniczący, 2 wyznaczony zastępca, 3 inny wiceprzewodniczący. */
export function chairRank(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'chair'>, personId: string | null): 1 | 2 | 3 | null {
  if (!personId || !canChairPerson(roster, m, personId)) return null;
  if (isChairmanOf(roster, m, personId)) return 1;
  return deputyOf(roster, m) === personId ? 2 : 3;
}

/** Członek organu według bieżącego składu. */
const currentFunc = (roster: Roster, organ: OrganCode, personId: string | null) => membership(roster, organ, personId)?.func;
/**
 * Kto tworzy, powiela i przygotowuje posiedzenia (pytanie 2, wariant b do czasu odpowiedzi): biuro, przewodniczący
 * i każdy wiceprzewodniczący. Wariant (a) albo (c) zmienia tylko tę funkcję.
 */
export function canCreate(roster: Roster, organ: OrganCode, a: Actor): boolean {
  if (isOfficeAccount(a)) return true;
  const func = currentFunc(roster, organ, a.personId);
  return !!func && lawOf(organ).chair.funcs.includes(func);
}
/** Przygotowanie posiedzenia (dane, projekt porządku, ustawienia, materiały): jak canCreate. */
export const canPrepare = (roster: Roster, m: Pick<Meeting, 'organ'>, a: Actor) => canCreate(roster, m.organ, a);
/**
 * Pominięcie punktu wymienionego w § 9 ust. 2 (DA-7, pytanie 8): w przygotowaniu przewodniczący albo zastępca, który
 * zwołuje to posiedzenie; po otwarciu osoba prowadząca obrady przed przyjęciem porządku. Bez `skipListed` nikt.
 */
export function canSkipListed(roster: Roster, m: M, a: Actor): boolean {
  if (!lawOf(m.organ).agenda.skipListed || !a.personId) return false;
  if (m.status === 'przygotowanie') return isChairmanOf(roster, m, a.personId) || (deputyOf(roster, m) === a.personId && m.convener === a.personId);
  return (m.status === 'trwa' || m.status === 'przerwa') && !m.agendaAdopted && isPresiding(m, a);
}
/**
 * Kto widzi posiedzenie (pytanie 4, wariant a): biuro, członek organu (także według składu zapisanego przy otwarciu)
 * i osoba zaproszona. Administrator bez innej roli nie widzi treści posiedzeń.
 */
export function canView(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'invited'>, a: Actor): boolean {
  if (isOfficeAccount(a)) return true;
  if (a.personId && (membership(roster, m.organ, a.personId) || m.frozen?.members.some(f => f.personId === a.personId))) return true;
  return m.invited.includes(a.account.id);
}
export const isPresiding = (m: Pick<Meeting, 'chair'>, a: Actor) => !!a.personId && m.chair.current === a.personId;

/** Osoba jest uprawniona do głosowania w otwartym głosowaniu (także próbnym). */
const votingNow = (m: Pick<Meeting, 'ballots'>, who: string) => m.ballots.some(b => b.status === 'otwarte' && b.eligible.includes(who));
/**
 * Lista obecności jako obsługa (DA-19). Osoba prowadząca obrady wykonuje wszystko. Biuro potwierdza zgłoszenia
 * i zapisuje przybycie i wyjście, ale nie odrzuca zgłoszeń, nie zmienia obecności osoby prowadzącej, a w trakcie
 * otwartego głosowania nie zapisuje wyjścia osoby uprawnionej do głosowania.
 */
export function canKeepAttendance(m: M, a: Actor, who: string, action: 'potwierdz' | 'odrzuc' | 'przybycie' | 'wyjscie'): boolean {
  if (isPresiding(m, a)) return true;
  if (!isOfficeAccount(a)) return false;
  if (who === m.chair.current) return false;
  if (action === 'odrzuc') return false;
  if (action === 'wyjscie' && votingNow(m, who)) return false;
  return true;
}
/** Powód odmowy zapisu cudzej obecności do komunikatu domeny (rozdz. 4.2). */
export function attendanceRefusal(m: M, a: Actor, who: string, action: 'potwierdz' | 'odrzuc' | 'przybycie' | 'wyjscie'): string {
  if (!isOfficeAccount(a)) return action === 'potwierdz' || action === 'odrzuc' ? 'Obecność potwierdza osoba prowadząca obrady albo biuro.' : 'Obecność innej osoby zapisuje osoba prowadząca obrady albo biuro.';
  if (who === m.chair.current) return 'Obecność osoby prowadzącej obrady zapisuje ta osoba.';
  if (action === 'odrzuc') return 'Zgłoszenie obecności odrzuca osoba prowadząca obrady.';
  return 'Wyjście w trakcie głosowania zapisuje osoba prowadząca obrady.';
}

/**
 * Rozpoczęcie głosowania między posiedzeniami (DA-12, pytanie 6): przewodniczący albo zastępca wyznaczony na to
 * głosowanie, o ile profil pozwala zastępcy zwoływać (`convener.deputyMay`).
 */
export function canStartProcedure(roster: Roster, m: M, a: Actor): boolean {
  if (m.kind !== 'procedura' || !a.personId) return false;
  return isChairmanOf(roster, m, a.personId) || (lawOf(m.organ).convener.deputyMay && deputyOf(roster, m) === a.personId);
}
/** Osoba, która rozpoczęła głosowanie między posiedzeniami. */
export const procedureStarter = (m: Pick<Meeting, 'chair'>) => m.chair.current;
/** Zarządzanie trwającym głosowaniem między posiedzeniami: osoba, która je rozpoczęła, albo przewodniczący. */
export function canManageProcedure(roster: Roster, m: M, a: Actor): boolean {
  if (m.kind !== 'procedura' || !a.personId) return false;
  return isChairmanOf(roster, m, a.personId) || procedureStarter(m) === a.personId;
}
/** Ogłoszenie wyniku: na posiedzeniu osoba prowadząca obrady, w głosowaniu między posiedzeniami zarządzający. */
export function canAnnounce(roster: Roster, m: M, a: Actor): boolean {
  return m.kind === 'posiedzenie' ? isPresiding(m, a) : canManageProcedure(roster, m, a);
}
/** Wynik przed ogłoszeniem widzi tylko ten, kto go ogłasza (Z5, DA-3). */
export const seesUnannounced = canAnnounce;
/** Wyznaczenie zastępcy: tylko przewodniczący; posiedzenie przed zamknięciem, głosowanie między posiedzeniami w przygotowaniu. */
export function canDesignateDeputy(roster: Roster, m: M, a: Actor): boolean {
  if (!isChairmanOf(roster, m, a.personId)) return false;
  return m.kind === 'posiedzenie' ? m.status !== 'zakonczone' : m.status === 'przygotowanie';
}
/** Wiadomości w kanale piszą członkowie, osoby z głosem doradczym i biuro; gość czyta (DA-20). */
export const canMessage = (_m: Pick<Meeting, 'organ'>, a: Actor) => a.account.kind !== 'gosc';

const designatedName = (roster: Roster, m: M) => personName(roster, deputyOf(roster, m));
/** Otwarcie posiedzenia według kolejności do prowadzenia (DA-17, rozdz. 4.5 pkt 3). */
export function openOption(roster: Roster, m: M, a: Actor): {allowed: true; basis: ChairBasis; needsReason: boolean} | {allowed: false; reason: string} {
  const rank = chairRank(roster, m, a.personId);
  if (!rank) return {allowed: false, reason: 'Posiedzenie otwiera przewodniczący albo wiceprzewodniczący (§ 9 ust. 1).'};
  if (rank === 1) return {allowed: true, basis: 'przewodniczacy', needsReason: false};
  if (rank === 2) return {allowed: true, basis: 'zastepca', needsReason: false};
  return deputyOf(roster, m) ? {allowed: true, basis: 'zamiast_zastepcy', needsReason: true} : {allowed: true, basis: 'bez_wyznaczenia', needsReason: false};
}
/** Komunikat, gdy inny wiceprzewodniczący otwiera albo przejmuje prowadzenie bez powodu przy wyznaczonym zastępcy. */
export function insteadOfDeputyText(roster: Roster, m: M, action: 'otwarcie' | 'przejecie') {
  return `Zastępcą przewodniczącego na tym posiedzeniu jest ${designatedName(roster, m)}. Podaj powód, dla którego ${action === 'otwarcie' ? 'otwierasz posiedzenie' : 'przejmujesz prowadzenie'} zamiast tej osoby.`;
}

/**
 * Przejęcie prowadzenia (rozdz. 4.5 pkt 4). Osoba wyżej w kolejności przejmuje od osoby niżej bez powodu. Gdy osoby
 * prowadzącej nie ma na sali (stan inny niż „obecny” albo `chairLeft`), przejmuje każdy wiceprzewodniczący, a inny
 * niż wyznaczony zastępca podaje powód. Powrót przysługuje raz po każdym zapisie wyjścia przez osobę przejmującą,
 * gdy prowadzi inny wiceprzewodniczący. Zgłoszenie obecności nikogo nie blokuje, a biuro nie jest potrzebne.
 */
export function takeChairOption(roster: Roster, m: M, a: Actor, o: {chairLeft?: boolean} = {}):
  {allowed: true; basis: ChairBasis; needsReason: boolean; recordsExit: boolean} | {allowed: false; reason: string} {
  const me = a.personId;
  const rank = chairRank(roster, m, me);
  if (!me || !rank) return {allowed: false, reason: 'Prowadzić może przewodniczący lub wiceprzewodniczący (§ 9 ust. 1).'};
  if (m.chair.current === me) return {allowed: false, reason: 'Prowadzisz już posiedzenie.'};
  const current = m.chair.current;
  const currentPresent = !!current && m.attendance[current] === 'obecny';
  const currentRank = chairRank(roster, m, current) ?? 4;
  if (currentPresent && !o.chairLeft) {
    if (rank < currentRank) return {allowed: true, basis: rank === 1 ? 'przewodniczacy' : 'zastepca', needsReason: false, recordsExit: false};
    if (canReturn(roster, m, me)) return {allowed: true, basis: 'powrot', needsReason: false, recordsExit: false};
    return {allowed: false, reason: 'Prowadzenie może przekazać osoba prowadząca. Przejąć je od niej może przewodniczący albo zastępca, którego przewodniczący wyznaczył (§ 16 ust. 2).'};
  }
  const recordsExit = currentPresent && !!o.chairLeft;
  if (recordsExit && m.chair.changes.some(c => c.recordedExit && c.from === current && c.to === me)) {
    return {allowed: false, reason: 'Wyjście tej osoby zapisano już raz. Poproś ją o przekazanie prowadzenia.'};
  }
  if (rank === 1) return {allowed: true, basis: 'przewodniczacy', needsReason: false, recordsExit};
  if (rank === 2) return {allowed: true, basis: 'zastepca', needsReason: false, recordsExit};
  return deputyOf(roster, m)
    ? {allowed: true, basis: 'zamiast_zastepcy', needsReason: true, recordsExit}
    : {allowed: true, basis: 'bez_wyznaczenia', needsReason: false, recordsExit};
}
/**
 * Powrót do prowadzenia (I-6): osoba, której wyjście zapisała osoba przejmująca, gdy prowadzi nadal ta osoba i jest
 * innym wiceprzewodniczącym (nie przewodniczącym ani wyznaczonym zastępcą). Jeden raz po każdym takim zapisie.
 */
export function canReturn(roster: Roster, m: M, personId: string): boolean {
  const changes = m.chair.changes;
  const index = changes.map(c => !!c.recordedExit && c.from === personId && c.to === m.chair.current).lastIndexOf(true);
  if (index < 0) return false;
  if (chairRank(roster, m, m.chair.current) !== 3) return false;
  return !changes.slice(index + 1).some(c => c.basis === 'powrot' && c.to === personId);
}

/** Dostęp do ustawień ogólnych (DA-4) i kont (DA-2). */
export function settingsAccess(roster: Roster, a: Actor): {general: 'zmienia' | 'czyta' | null; accounts: boolean} {
  const reads = roster.memberships.some(ms => ms.personId === a.personId && a.personId && lawOf(ms.organ).available && lawOf(ms.organ).chair.funcs.includes(ms.func));
  return {general: isOfficeAccount(a) ? 'zmienia' : reads ? 'czyta' : null, accounts: isAdmin(a)};
}
