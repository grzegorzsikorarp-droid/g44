// Model danych aplikacji. Nazwy pojęć odpowiadają Regulaminowi Okręgowej Rady
// Pielęgniarek i Położnych w Słupsku (uchwała nr 9 OZPiP z 22.03.2025).

export type OrganCode = 'prezydium' | 'rada' | 'zjazd';
export type Func = 'przewodniczacy' | 'wiceprzewodniczacy' | 'sekretarz' | 'skarbnik' | 'czlonek';

export interface Person { id: string; name: string; sortName: string }
export interface Membership { organ: OrganCode; personId: string; func: Func; label: string; order: number; canChair: boolean }
export interface Organ { code: OrganCode; name: string; shortName: string; active: boolean }
export interface Roster { organs: Organ[]; persons: Person[]; memberships: Membership[] }

// członek organu, osoba z głosem doradczym (§ 7 ust. 2), zaproszony gość (§ 7 ust. 3), obsługa biura (§ 23)
export type AccountKind = 'czlonek' | 'doradczy' | 'gosc' | 'biuro';
export interface Account {
  id: string; username: string; kind: AccountKind; personId: string | null;
  displayName: string; label: string; admin: boolean; mustChange: boolean; disabled: boolean;
}

export type MeetingKind = 'posiedzenie' | 'procedura';
export type MeetingMode = 'stacjonarne' | 'zdalne';
export type MeetingStatus = 'przygotowanie' | 'trwa' | 'przerwa' | 'zakonczone';

export type ItemKind = 'otwarcie' | 'porzadek' | 'protokol' | 'sprawozdania' | 'uchwaly' | 'wolne_wnioski' | 'zamkniecie' | 'sprawa';
export type ItemStatus = 'oczekuje' | 'w_toku' | 'zakonczony' | 'odroczony' | 'wycofany';
/** Osoba przy punkcie porządku (F12): referuje sprawę albo prowadzi punkt. `role` to funkcja, np. „Sekretarz”. */
export interface Presenter { name: string; role: string; kind: 'referuje' | 'prowadzi' }
/** Kto i kiedy zapisał czynność z powodem (F4, F5, F7). `by` to imię i nazwisko albo nazwa konta. */
export interface Reasoned { reason: string; at: number; by: string }
export interface AgendaItem {
  id: string; parentId: string | null; title: string; kind: ItemKind; status: ItemStatus;
  materialIds: string[]; note: string; presenters: Presenter[];
  startedAt?: number; endedAt?: number; addedAfterAdoption?: boolean;
  mode?: VoteMode; modeBasis?: string;
  /** „Co jest głosowane w tym punkcie”: identyfikator rodzaju dokumentu ze słownika (F11). Brak oznacza rodzaj z materiału. */
  docType?: string;
  /** Punkt rozpoczęty poza kolejnością przyjętego porządku obrad (F4). */
  outOfOrder?: Reasoned;
  /** Powód odroczenia, wycofania albo nierozpatrzenia punktu do protokołu (F4). */
  statusReason?: string;
}

/** Rodzaj dokumentu ze słownika, który prowadzi administrator (F11). `adopted` i `rejected` to formuły wyniku. */
export interface DocType { id: string; name: string; adopted: string; rejected: string; voted: boolean; order: number; active: boolean }
/** Identyfikator rodzaju dokumentu ze słownika (`DocType.id`), np. „uchwala”, „stanowisko”. */
export type MaterialType = string;
export interface MaterialRef {
  id: string; title: string; type: MaterialType; number: string; version: number; hash: string;
  size: number; fileId: string | null; fileName: string | null; createdAt: number;
}

// „zgloszony”: osoba zgłosiła obecność w aplikacji na posiedzeniu stacjonarnym i czeka na potwierdzenie (F9).
export type Presence = 'nieobecny' | 'zgloszony' | 'obecny' | 'wyszedl';
/**
 * Zdarzenie listy obecności. `zgloszenie` zapisuje zgłoszenie przez osobę, `przybycie` potwierdzenie albo zapis obecności
 * (`by` to osoba, która potwierdziła albo zapisała; `reportedAt` to godzina zgłoszenia, gdy potwierdzono zgłoszenie),
 * `odrzucenie` odrzucenie albo wycofanie zgłoszenia, `wyjscie` wyjście z posiedzenia.
 */
export interface PresenceEvent { who: string; guest: boolean; type: 'przybycie' | 'wyjscie' | 'zgloszenie' | 'odrzucenie'; at: number; by: string; reportedAt?: number }

export interface ChairChange { at: number; from: string | null; to: string; by: string; reason: string }
export interface Chair { current: string | null; deputy: string | null; deputyBasis: string; changes: ChairChange[] }

export type VoteMode = 'jawne' | 'imienne' | 'tajne';
export type Choice = 'za' | 'przeciw' | 'wstrzymuje';
// „proba”: głosowanie próbne bez skutków (F1), bez numeru (number 0).
export type BallotPurpose = 'uchwala' | 'porzadek' | 'zmiana_porzadku' | 'protokol' | 'tryb' | 'reasumpcja' | 'wniosek' | 'inna' | 'proba';

export type AgendaChange =
  | {op: 'dodaj'; title: string; parentId: string | null; afterId: string | null}
  | {op: 'usun'; itemId: string}
  | {op: 'przesun'; itemId: string; beforeId: string | null};

export type BallotTarget =
  | {kind: 'zmiana_porzadku'; change: AgendaChange}
  | {kind: 'tryb'; itemId: string; mode: VoteMode; proposedBy?: string}
  | {kind: 'reasumpcja'; ballotId: string; motionId: string};

export interface BallotResult {
  za: number; przeciw: number; wstrzymuje: number; cast: number; eligible: number;
  participants: number; quorum: number; quorumMet: boolean; adopted: boolean;
}

export interface Ballot {
  id: string; number: number; itemId: string | null; purpose: BallotPurpose; subject: string;
  material: {id: string; version: number; hash: string; title: string} | null;
  mode: VoteMode; modeBasis: string; status: 'otwarte' | 'zamkniete';
  openedAt: number; endsAt: number; closedAt?: number; closeReason?: 'wszyscy' | 'czas' | 'prowadzacy' | 'przerwane';
  openedBy: string; eligible: string[]; joined: string[]; absentDuring: string[];
  membersTotal: number; quorum: number; remote: boolean;
  votes: Record<string, Choice>;
  secret: {n: string; e: string; fingerprint: string; issued: string[]; cast: number} | null;
  result?: BallotResult; announcedAt?: number;
  reasumptionOf?: string; supersededBy?: string; target?: BallotTarget;
  /** Rodzaj dokumentu i formuły wyniku zapisane w chwili otwarcia (F11). Stare głosowania ich nie mają. */
  docType?: string; formulas?: {adopted: string; rejected: string};
  /** Głosowanie między posiedzeniami przerwane bez rozstrzygnięcia (F7): bez wyniku i bez ogłoszenia. */
  aborted?: Reasoned;
}

export interface Motion {
  id: string; type: 'reasumpcja'; ballotId: string; justification: string;
  createdBy: string; createdAt: number; signatures: string[];
  status: 'zbiera_podpisy' | 'zlozony' | 'glosowany' | 'przyjety' | 'odrzucony' | 'wycofany';
  filedAt?: number; presentAtFiling?: number; voteBallotId?: string; repeatBallotId?: string;
}

export interface Message { id: string; author: string; authorName: string; text: string; at: number }
/**
 * Wpis dziennika. `tag: 'projekt'` oznacza zmianę projektu porządku obrad po otwarciu posiedzenia (F8),
 * `ballotId` wiąże wpis o zakończeniu głosowania z głosowaniem (widok ukrywa w nim liczby do ogłoszenia wyniku, F2).
 */
export interface LogEntry { at: number; text: string; by: string; tag?: 'projekt'; ballotId?: string }
export type Presentation = {kind: 'punkt' | 'material' | 'glosowanie' | 'wynik'; id: string; at: number};

export interface Meeting {
  id: string; organ: OrganCode; kind: MeetingKind; title: string;
  date: string; time: string; place: string; mode: MeetingMode; link: string; noticeDate: string;
  status: MeetingStatus; openedAt?: number; closedAt?: number; endsAt?: number;
  invited: string[]; agenda: AgendaItem[]; agendaAdopted: boolean; currentItemId: string | null;
  presentation: Presentation | null; materials: MaterialRef[];
  attendance: Record<string, Presence>; guests: Record<string, Presence>; presenceLog: PresenceEvent[];
  chair: Chair; quorumChecks: {at: number; present: number; required: number; by: string}[];
  ballots: Ballot[]; motions: Motion[]; messages: Message[]; log: LogEntry[];
  revision: number; createdAt: number; createdBy: string;
  /** Spotkanie robocze bez kworum do końca (F5). */
  working?: {at: number; by: string; reason: 'brak_kworum' | 'bez_stwierdzenia'};
  /** Dane do protokołu, nieobowiązkowe (F10). `convener` to identyfikator osoby ze składu organu. */
  protocolNumber?: string; recorder?: string; convener?: string;
  /** Głosowanie między posiedzeniami: zmiany terminu i sposób zakończenia przed terminem (F7). */
  deadlineChanges?: {at: number; from: number; to: number; by: string}[];
  ended?: {how: 'policz' | 'przerwij'; reason?: string; at: number; by: string};
}

// Kto wykonuje działanie: konto, a dla członka organu także osoba ze składu.
export interface Actor { account: Account; personId: string | null; name: string }
