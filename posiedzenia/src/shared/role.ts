import type {Actor, ChairBasis, DisplayRef, FiledKind, Func, Meeting, Membership, OrganCode, PaperId, Roster} from './types.ts';
import {ANSWERS, PHOTO_CIRCLES, lawOf} from './law.ts';
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
  // Wersja 4 (DB-9, 4.4): konto „Komunikacja” nie widzi żadnego posiedzenia, tylko wiersze katalogu przez osobne trasy.
  if (a.account.kind === 'komunikacja') return false;
  if (isOfficeAccount(a)) return true;
  if (a.personId && (membership(roster, m.organ, a.personId) || m.frozen?.members.some(f => f.personId === a.personId))) return true;
  return m.invited.includes(a.account.id);
}
export const isPresiding = (m: Pick<Meeting, 'chair'>, a: Actor) => !!a.personId && m.chair.current === a.personId;
/**
 * Projekt protokołu (macierz 4.3): przed zamknięciem biuro, przewodniczący, wyznaczony zastępca i osoba prowadząca obrady
 * (w głosowaniu między posiedzeniami osoba, która je rozpoczęła); po zamknięciu także członkowie organu. Osoby z głosem
 * doradczym, goście i administrator bez roli biura projektu nie widzą. Wyniki nieogłoszone i tak są w nim ukryte (F2).
 */
export function canReadMinutes(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'chair' | 'status'>, a: Actor): boolean {
  if (isOfficeAccount(a)) return true;
  if (!a.personId) return false;
  if (isChairmanOf(roster, m, a.personId) || deputyOf(roster, m) === a.personId || isPresiding(m, a)) return true;
  return m.status === 'zakonczone' && (!!membership(roster, m.organ, a.personId) || !!m.frozen?.members.some(f => f.personId === a.personId));
}
export const minutesRefusal = 'Projekt protokołu w trakcie obrad widzą biuro i osoby prowadzące obrady.';
/** Przebieg obrad (jawny dziennik, DA-10): bez osób z głosem doradczym i gości. */
export const seesLog = (a: Actor) => a.account.kind !== 'gosc' && a.account.kind !== 'doradczy' && a.account.kind !== 'komunikacja';

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
export const canMessage = (_m: Pick<Meeting, 'organ'>, a: Actor) => a.account.kind !== 'gosc' && a.account.kind !== 'komunikacja';

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

// ---------------------------------------------------------------------------------------------------------------------
// Wersja 4 (SPEC-4 rozdz. 4.2). Uprawnienia nowych funkcji wynikają z funkcji wersji 3 i z trzech nazwanych kręgów
// (DB-44): kierujący, sprawozdawczość, obsługa. Konto „Komunikacja” (DB-9) dostaje wyłącznie katalog, odnośniki do zdjęć
// i materiał dla komunikacji; każda inna funkcja zwraca dla niego `false`. Odpowiedzi na pytania 11–13 czyta z `ANSWERS`
// w law.ts, więc inna odpowiedź to zmiana jednej wartości.

type MV4 = M & Pick<Meeting, 'agenda' | 'log' | 'commsReleased' | 'commsInputs'>;

/** Konto „Komunikacja” (DB-9): bez osoby ze składu, widzi tylko odbyte posiedzenia i materiały dla komunikacji. */
export const isCommsAccount = (a: Actor) => a.account.kind === 'komunikacja';
/** Odmowa konta „Komunikacja” na trasach spoza jego zakresu (4.4, 4.5). */
export const COMMS_REFUSAL = 'To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.';
/** Trasy API konta „Komunikacja” (4.4): „Moje konto”, katalog, odnośniki do zdjęć, materiały dla komunikacji i zdjęcia; serwer i wersja próbna. */
export const commsPathAllowed = (path: string) => /^\/api\/(me(\/.*)?|katalog|katalog\/[\w-]+\/(komunikacja\.md|komunikacja\.json|zdjecia)|avatars\/[\w-]+)$/.test(path);
/** Funkcja w bieżącym składzie któregokolwiek działającego organu. */
const holds = (roster: Roster, a: Actor, funcs: Func[]) => !!a.personId
  && roster.memberships.some(ms => ms.personId === a.personId && lawOf(ms.organ).available && funcs.includes(ms.func));
/** Krąg „kierujący” (DB-44): przewodniczący i wiceprzewodniczący. */
export function isLeading(roster: Roster, a: Actor): boolean {
  return !isCommsAccount(a) && holds(roster, a, ['przewodniczacy', 'wiceprzewodniczacy']);
}
/** Krąg „sprawozdawczość” (DB-44): kierujący i sekretarz (§ 15 pkt 3–4, § 17 ust. 2 pkt 2 RR). */
export function isReporting(roster: Roster, a: Actor): boolean {
  return isLeading(roster, a) || (!isCommsAccount(a) && holds(roster, a, ['sekretarz']));
}
/** Krąg „obsługa” (DB-44): biuro. */
export const isService = isOfficeAccount;
/** Sekretarz: funkcja „sekretarz” w bieżącym składzie albo w składzie zapisanym przy otwarciu posiedzenia. */
export function isSecretary(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'> | null, personId: string | null): boolean {
  if (!personId) return false;
  if (currentFunc(roster, m?.organ ?? 'prezydium', personId) === 'sekretarz') return true;
  return !!m?.frozen?.members.some(f => f.personId === personId && f.func === 'sekretarz');
}
/**
 * Przewodniczący organu: według składu posiedzenia (zapisanego przy otwarciu) albo według bieżącego składu. Po zamknięciu
 * czynności wykonuje też osoba, która pełni funkcję dziś (np. po wyborze nowego przewodniczącego).
 */
const isChairman = (roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, personId: string | null) =>
  !!personId && (isChairmanOf(roster, m, personId) || currentFunc(roster, m.organ, personId) === 'przewodniczacy');
/** Osoba, która zamknęła obrady (S-18): osoba prowadząca w chwili zamknięcia; przed zamknięciem `null`. */
export const closedBy = (m: Pick<Meeting, 'status' | 'chair'>): string | null => m.status === 'zakonczone' ? m.chair.current : null;
const isClosedBy = (m: Pick<Meeting, 'status' | 'chair'>, a: Actor) => !!a.personId && closedBy(m) === a.personId;
/**
 * Zwołujący (U-19, DA-23 SPEC-3, wzór `canSkipListed`): przewodniczący albo zastępca, którego przewodniczący wyznaczył
 * na to posiedzenie i wpisano go w polu „Zwołuje”.
 */
export function isConvener(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'chair' | 'convener'>, a: Actor): boolean {
  if (!a.personId || isCommsAccount(a)) return false;
  return isChairmanOf(roster, m, a.personId) || (deputyOf(roster, m) === a.personId && m.convener === a.personId);
}
/** Członek organu posiedzenia według bieżącego składu albo składu zapisanego przy otwarciu. */
const organMember = (roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, a: Actor) => !!a.personId
  && (!!membership(roster, m.organ, a.personId) || !!m.frozen?.members.some(f => f.personId === a.personId));

// Dokumenty, katalog, komunikacja (B1, tabela 4.3.3)

/** Wiersz katalogu: osoby z `canView` widzą pełny wiersz, konto „Komunikacja” tylko wiersz posiedzenia zakończonego. */
export function canSeeCatalog(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen' | 'invited' | 'status'>, a: Actor): 'pelny' | 'wiersz' | null {
  if (canView(roster, m, a)) return 'pelny';
  return isCommsAccount(a) && m.status === 'zakonczone' ? 'wiersz' : null;
}
/**
 * Udostępnienie materiału dla komunikacji jest ważne (DB-42, pytanie 12): udostępniono po zamknięciu i od tej chwili
 * nie zmieniła się treść wpisywana przez ludzi. Przy odpowiedzi (a) na pytanie 12 warunek znika.
 */
export function commsReleasedOk(m: Pick<Meeting, 'status' | 'commsReleased' | 'commsInputs'>): boolean {
  if (m.status !== 'zakonczone') return false;
  if (ANSWERS.q12 === 'a') return true;
  return !!m.commsReleased && m.commsReleased.inputs === (m.commsInputs ?? 0);
}
/**
 * Materiał dla komunikacji (DB-42, 4.3.3): po zamknięciu biuro, przewodniczący, wiceprzewodniczący i osoba, która zamknęła
 * obrady; konto „Komunikacja” tylko przy ważnym udostępnieniu.
 */
export function canDownloadComms(roster: Roster, m: MV4, a: Actor): boolean {
  if (m.status !== 'zakonczone') return false;
  if (isCommsAccount(a)) return commsReleasedOk(m);
  return isService(a) || (isLeading(roster, a) && organMember(roster, m, a)) || isClosedBy(m, a);
}
/**
 * Prawo do dokumentu posiedzenia (tabela 4.3.3, B1-04). Porządek, wyniki, wykazy imienne, akty i kanał: każdy z `canView`.
 * Projekt protokołu i lista obecności: jak projekt protokołu w wersji 3 (`canReadMinutes`). Dziennik: biuro i członkowie,
 * także w trakcie (DA-10). Teczka: po zamknięciu, jak projekt protokołu (K4-23: składa się z plików, do których ta funkcja
 * daje prawo). Materiał dla komunikacji: `canDownloadComms`.
 */
export function canDownloadPaper(roster: Roster, m: MV4, a: Actor, id: PaperId): boolean {
  if (id === 'komunikacja') return canDownloadComms(roster, m, a);
  if (isCommsAccount(a) || !canView(roster, m, a)) return false;
  if (id === 'protokol' || id === 'obecnosc' || id === 'obecnosc-podpis') return canReadMinutes(roster, m, a);
  if (id === 'teczka') return m.status === 'zakonczone' && canReadMinutes(roster, m, a);
  if (id === 'dziennik') return seesLog(a);
  return true;
}
/** „Udostępnij komunikacji” (U-48): po zamknięciu biuro (P), przewodniczący i osoba, która zamknęła obrady (W). */
export function canReleaseComms(roster: Roster, m: M, a: Actor): boolean {
  if (m.status !== 'zakonczone' || isCommsAccount(a)) return false;
  return isService(a) || isChairman(roster, m, a.personId) || isClosedBy(m, a);
}
/**
 * Dokumenty dołączone po posiedzeniu i „Protokół sporządzony” (U-33, U-34, S-19): biuro, przewodniczący, sekretarz; po
 * zamknięciu, a „Zawiadomienie” także wcześniej.
 */
export function canFile(roster: Roster, m: M, a: Actor, kind?: FiledKind): boolean {
  if (isCommsAccount(a)) return false;
  if (m.status !== 'zakonczone' && kind !== 'zawiadomienie') return false;
  return isService(a) || isChairman(roster, m, a.personId) || isSecretary(roster, m, a.personId);
}
/**
 * Odnośnik do zdjęć (U-32): od otwarcia biuro, przewodniczący i osoba prowadząca; po zamknięciu także osoba, która zamknęła
 * obrady, i konto „Komunikacja”.
 */
export function canSetPhotos(roster: Roster, m: M, a: Actor): boolean {
  if (m.status === 'przygotowanie') return false;
  if (m.status === 'zakonczone' && (isCommsAccount(a) || isClosedBy(m, a))) return true;
  if (isCommsAccount(a)) return false;
  return isService(a) || isChairman(roster, m, a.personId) || isPresiding(m, a);
}
/** Kto widzi adres albumu (DB-38, K4-31): członkowie Prezydium, biuro i konto „Komunikacja”; bez głosu doradczego i gości. */
export function seesPhotosLink(roster: Roster, m: Pick<Meeting, 'organ' | 'frozen'>, a: Actor): boolean {
  return isService(a) || isCommsAccount(a) || organMember(roster, m, a);
}
/**
 * Poziom i zdanie dla komunikacji, „Opis dla komunikacji” (U-26, U-27, U-49): w przygotowaniu osoby przygotowujące, po
 * zamknięciu biuro (P), przewodniczący i osoba, która zamknęła obrady (W); w trakcie obrad nikt.
 */
export function canEditComms(roster: Roster, m: M, a: Actor): boolean {
  if (isCommsAccount(a)) return false;
  if (m.status === 'przygotowanie') return canPrepare(roster, m, a);
  if (m.status === 'zakonczone') return isService(a) || isChairman(roster, m, a.personId) || isClosedBy(m, a);
  return false;
}
/**
 * „Dotyczy protokołu” przy punkcie (U-28, G-33): w przygotowaniu osoby przygotowujące, w trakcie obrad osoba prowadząca
 * przed otwarciem głosowania w tym punkcie, po zamknięciu nikt (zostaje poprawka w głosowaniu, G-38).
 */
export function canEditProtocolOf(roster: Roster, m: M, a: Actor, itemId: string): boolean {
  if (isCommsAccount(a)) return false;
  if (m.status === 'przygotowanie') return canPrepare(roster, m, a);
  if (m.status === 'trwa' || m.status === 'przerwa') return isPresiding(m, a) && !m.ballots.some(b => b.itemId === itemId && b.purpose !== 'proba');
  return false;
}
/** Poprawka „Dotyczy protokołu” w głosowaniu po zamknięciu (G-38, K4-4): tylko przewodniczący. */
export function canFixProtocolOf(roster: Roster, m: M, a: Actor): boolean {
  return m.status === 'zakonczone' && !isCommsAccount(a) && isChairman(roster, m, a.personId);
}
/** Zestawienie za okres (DB-25, S-20): biuro, przewodniczący, wiceprzewodniczący i sekretarz. */
export function canReport(roster: Roster, a: Actor): boolean {
  return isService(a) || isReporting(roster, a);
}

// Wspólne przygotowanie (B2 2.2 z poprawką DB-14, tabela 4.3.1)

/**
 * Przestrzeń robocza (B2-W02, Z10): członkowie organu według bieżącego składu i biuro widzą całość, osoba z głosem
 * doradczym tylko własne zgłoszenia, gość, administrator bez roli biura i konto „Komunikacja” nic. Stan posiedzenia
 * (w trakcie obrad przestrzeni nie widać, S-25) sprawdza widok i trasa.
 */
export function canSeeWorkspace(roster: Roster, m: Pick<Meeting, 'organ'>, a: Actor): 'pelny' | 'wlasne' | null {
  if (isService(a)) return 'pelny';
  if (isCommsAccount(a)) return null;
  if (a.personId && membership(roster, m.organ, a.personId)) return 'pelny';
  return a.account.kind === 'doradczy' ? 'wlasne' : null;
}
/** Zgłoszenie sprawy (G-30): członkowie organu i osoby z głosem doradczym, tylko w przygotowaniu; biuro wpisuje punkty samo. */
export function canPropose(roster: Roster, m: Pick<Meeting, 'organ' | 'status'>, a: Actor): boolean {
  if (m.status !== 'przygotowanie' || isService(a) || isCommsAccount(a)) return false;
  return (!!a.personId && !!membership(roster, m.organ, a.personId)) || a.account.kind === 'doradczy';
}
/** Wpisanie zgłoszenia do projektu porządku („Wpisane do projektu”): osoby przygotowujące, biuro jako obsługa (DB-14). */
export function canAcceptProposal(roster: Roster, m: Pick<Meeting, 'organ' | 'status'>, a: Actor): boolean {
  return m.status === 'przygotowanie' && !isCommsAccount(a) && canPrepare(roster, m, a);
}
/** Odrzucenie i odłożenie zgłoszenia (DB-14, K4-3, G-30): tylko zwołujący. Biuro i inni wiceprzewodniczący nie. */
export function canRejectProposal(roster: Roster, m: M, a: Actor): boolean {
  return m.status === 'przygotowanie' && isConvener(roster, m, a);
}
/**
 * Dodatek D-11: zadanie dla biura dodaje każdy, kto widzi całą przestrzeń; zadanie dla członka przydziela zwołujący
 * (Z13), a inni członkowie tylko sobie.
 */
export function canAssignTask(roster: Roster, m: M, a: Actor, to: {personId: string} | {office: true}): boolean {
  if (m.status !== 'przygotowanie' || canSeeWorkspace(roster, m, a) !== 'pelny') return false;
  if ('office' in to) return true;
  return isConvener(roster, m, a) || (!!a.personId && to.personId === a.personId);
}
/** Osoba referująca punkt (B2-W11): `Presenter.personId`, a bez niego to samo imię i nazwisko co w składzie. */
export function isReferent(roster: Roster, m: Pick<Meeting, 'agenda'>, itemId: string, personId: string | null): boolean {
  if (!personId) return false;
  const item = m.agenda.find(i => i.id === itemId);
  const name = personName(roster, personId);
  return !!item?.presenters.some(p => p.kind === 'referuje' && (p.personId ? p.personId === personId : !!name && p.name.trim() === name));
}
/** Dodatek D-12: stan uwagi do materiału zmieniają osoby przygotowujące (biuro jako obsługa) i osoba referująca w swoim punkcie. */
export function canSetRemarkState(roster: Roster, m: Pick<Meeting, 'organ' | 'status' | 'agenda'>, a: Actor, itemId: string | null): boolean {
  if (m.status !== 'przygotowanie' || isCommsAccount(a)) return false;
  return canPrepare(roster, m, a) || (!!itemId && isReferent(roster, m, itemId, a.personId));
}

// Poczta (B2-P03, tabela 4.3.2)

/** Informacja o postępie: osoby przygotowujące, tylko w przygotowaniu. */
export function canSendProgress(roster: Roster, m: Pick<Meeting, 'organ' | 'status'>, a: Actor): boolean {
  return m.status === 'przygotowanie' && !isCommsAccount(a) && canPrepare(roster, m, a);
}
/** Powiadomienie o dokumentach: po zamknięciu biuro, przewodniczący i osoba, która zamknęła obrady (S-18). */
export function canSendAfter(roster: Roster, m: M, a: Actor): boolean {
  if (m.status !== 'zakonczone' || isCommsAccount(a)) return false;
  return isService(a) || isChairman(roster, m, a.personId) || isClosedBy(m, a);
}
/** Dodatek D-8 (pytanie 10, wariant b albo c): zatwierdzenie treści zawiadomienia przez zwołującego. */
export function canApproveNotice(roster: Roster, m: M, a: Actor): boolean {
  return ANSWERS.q10 !== 'a' && m.status === 'przygotowanie' && isConvener(roster, m, a);
}

// Pokaz i zdjęcia (B3 7.2, tabela 4.3.4–4.3.5)

/** Pokaz rozpoczyna, przewija, wznawia i kończy wyłącznie osoba prowadząca obrady (DB-11, `pokaz_prowadzacy`). */
export const canShow = isPresiding;
/** Pliki do pokazania: w przygotowaniu osoby przygotowujące, w trakcie obrad biuro i osoba prowadząca, po zamknięciu nikt. */
export function canAddDisplay(roster: Roster, m: Pick<Meeting, 'organ' | 'status' | 'chair'>, a: Actor): boolean {
  if (isCommsAccount(a)) return false;
  if (m.status === 'przygotowanie') return canPrepare(roster, m, a);
  if (m.status === 'trwa' || m.status === 'przerwa') return isService(a) || isPresiding(m, a);
  return false;
}
/** Plik pokazany na posiedzeniu (wpis dziennika `tag: 'pokaz'` z tym plikiem) zostaje w dokumentacji (G-25). */
export const wasShown = (m: Pick<Meeting, 'log'>, displayId: string) => m.log.some(l => l.tag === 'pokaz' && l.displayId === displayId);
/** Usunięcie pliku do pokazania: jak dodanie, a w trakcie obrad tylko pliku niepokazanego. */
export function canRemoveDisplay(roster: Roster, m: Pick<Meeting, 'organ' | 'status' | 'chair' | 'log'>, a: Actor, d: Pick<DisplayRef, 'id'>): boolean {
  if (!canAddDisplay(roster, m, a)) return false;
  return m.status === 'przygotowanie' || !wasShown(m, d.id);
}
/**
 * Kto widzi cudze zdjęcia profilowe (pytanie 13, DB-20): (a) biuro, administrator, przewodniczący i wiceprzewodniczący;
 * (b) także członkowie Prezydium; (c) każdy zalogowany. Własne zdjęcie widzi każdy.
 */
export function seesPhotos(roster: Roster, a: Actor): boolean {
  if (ANSWERS.q13 === 'c') return true;
  if (isCommsAccount(a)) return false;
  if (isService(a) || isAdmin(a) || isLeading(roster, a)) return true;
  return ANSWERS.q13 === 'b' && !!a.personId && roster.memberships.some(ms => ms.personId === a.personId && ms.organ === 'prezydium');
}
/** Krąg z `seesPhotos` w zdaniu karty „Zdjęcie” i zasady `zdjecia` (DB-20). */
export function photoCircleText(_roster?: Roster): string {
  return PHOTO_CIRCLES[ANSWERS.q13];
}

// Statystyki (B4 7.3, DB-22, DB-23, tabela 4.3.6)

/**
 * „Moje statystyki” (DB-22): konto z osobą w bieżącym składzie albo w składzie zapisanym przy otwarciu któregokolwiek
 * zakończonego posiedzenia (listę zakończonych posiedzeń podaje wywołujący).
 */
export function canSeeOwnStats(roster: Roster, a: Actor, closed: Pick<Meeting, 'status' | 'frozen'>[] = []): boolean {
  if (!a.personId || isService(a) || isCommsAccount(a)) return false;
  if (roster.memberships.some(ms => ms.personId === a.personId && lawOf(ms.organ).available)) return true;
  return closed.some(m => m.status === 'zakonczone' && !!m.frozen?.members.some(f => f.personId === a.personId));
}
/**
 * Dodatek D-13 „Statystyki składu” (pytanie 11, DB-23): (b) biuro, przewodniczący, wiceprzewodniczący i sekretarz;
 * (a) biuro i wszyscy członkowie Prezydium. Pozycja w nawigacji i trasa dochodzą z dodatkiem.
 */
export function canSeeRosterStats(roster: Roster, a: Actor): boolean {
  if (isService(a)) return true;
  if (isCommsAccount(a)) return false;
  if (ANSWERS.q11 === 'a') return !!a.personId && roster.memberships.some(ms => ms.personId === a.personId && ms.organ === 'prezydium');
  return isReporting(roster, a);
}
/** Komunikat odmowy „Statystyk składu” zgodny z odpowiedzią na pytanie 11 (rozdz. 4.5). */
export const rosterStatsRefusal = () => ANSWERS.q11 === 'a' ? 'Statystyki składu widzą biuro i członkowie Prezydium.' : 'Statystyki składu widzą biuro, przewodniczący, wiceprzewodniczący i sekretarz.';
/** Dodatek D-13: uwagi „Do sprawdzenia” w statystykach widzą biuro i przewodniczący. */
export function seesStatsNotes(roster: Roster, a: Actor): boolean {
  return isService(a) || (!isCommsAccount(a) && holds(roster, a, ['przewodniczacy']));
}
/**
 * Dzień startu statystyk (U-41, G-40, K4-37). `from` to dzień dziś ustawiony, `to` nowy dzień (null: wszystkie
 * posiedzenia), `firstCounted` dzień najwcześniejszego zakończonego posiedzenia, które dziś się liczy. Biuro ustawia dzień,
 * który nie wyłącza policzonych posiedzeń, albo przesuwa go wstecz; dzień, który wyłącza policzone posiedzenia, wpisuje
 * tylko przewodniczący z powodem. Pozostali tylko czytają.
 */
export function canSetStatsSince(roster: Roster, a: Actor, from: string | null, to: string | null, firstCounted: string | null): 'tak' | 'z_powodem' | 'nie' {
  const excludes = to !== null && firstCounted !== null && to > firstCounted && !(from !== null && to <= from);
  if (isService(a)) return excludes ? 'nie' : 'tak';
  if (!isCommsAccount(a) && holds(roster, a, ['przewodniczacy'])) return excludes ? 'z_powodem' : 'nie';
  return 'nie';
}
