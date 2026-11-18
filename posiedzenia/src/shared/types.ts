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
export interface AgendaItem {
  id: string; parentId: string | null; title: string; kind: ItemKind; status: ItemStatus;
  materialIds: string[]; note: string; presenter: string;
  startedAt?: number; endedAt?: number; addedAfterAdoption?: boolean;
  mode?: VoteMode; modeBasis?: string;
}

export type MaterialType = 'uchwala' | 'rezolucja' | 'oswiadczenie' | 'deklaracja' | 'apel' | 'sprawozdanie' | 'protokol' | 'informacja' | 'inny';
export interface MaterialRef {
  id: string; title: string; type: MaterialType; number: string; version: number; hash: string;
  size: number; fileId: string | null; fileName: string | null; createdAt: number;
}

export type Presence = 'nieobecny' | 'obecny' | 'wyszedl';
export interface PresenceEvent { who: string; guest: boolean; type: 'przybycie' | 'wyjscie'; at: number; by: string }

export interface ChairChange { at: number; from: string | null; to: string; by: string; reason: string }
export interface Chair { current: string | null; deputy: string | null; deputyBasis: string; changes: ChairChange[] }

export type VoteMode = 'jawne' | 'imienne' | 'tajne';
export type Choice = 'za' | 'przeciw' | 'wstrzymuje';
export type BallotPurpose = 'uchwala' | 'porzadek' | 'zmiana_porzadku' | 'protokol' | 'tryb' | 'reasumpcja' | 'wniosek' | 'inna';

export type AgendaChange =
  | {op: 'dodaj'; title: string; parentId: string | null; afterId: string | null}
  | {op: 'usun'; itemId: string}
  | {op: 'przesun'; itemId: string; beforeId: string | null};

export type BallotTarget =
  | {kind: 'zmiana_porzadku'; change: AgendaChange}
  | {kind: 'tryb'; itemId: string; mode: VoteMode}
  | {kind: 'reasumpcja'; ballotId: string; motionId: string};

export interface BallotResult {
  za: number; przeciw: number; wstrzymuje: number; cast: number; eligible: number;
  participants: number; quorum: number; quorumMet: boolean; adopted: boolean;
}

export interface Ballot {
  id: string; number: number; itemId: string | null; purpose: BallotPurpose; subject: string;
  material: {id: string; version: number; hash: string; title: string} | null;
  mode: VoteMode; modeBasis: string; status: 'otwarte' | 'zamkniete';
  openedAt: number; endsAt: number; closedAt?: number; closeReason?: 'wszyscy' | 'czas' | 'prowadzacy';
  openedBy: string; eligible: string[]; joined: string[]; absentDuring: string[];
  membersTotal: number; quorum: number; remote: boolean;
  votes: Record<string, Choice>;
  secret: {n: string; e: string; fingerprint: string; issued: string[]; cast: number} | null;
  result?: BallotResult; announcedAt?: number;
  reasumptionOf?: string; supersededBy?: string; target?: BallotTarget;
}

export interface Motion {
  id: string; type: 'reasumpcja'; ballotId: string; justification: string;
  createdBy: string; createdAt: number; signatures: string[];
  status: 'zbiera_podpisy' | 'zlozony' | 'glosowany' | 'przyjety' | 'odrzucony' | 'wycofany';
  filedAt?: number; presentAtFiling?: number; voteBallotId?: string; repeatBallotId?: string;
}

export interface Message { id: string; author: string; authorName: string; text: string; at: number }
export interface LogEntry { at: number; text: string; by: string }
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
}

// Kto wykonuje działanie: konto, a dla członka organu także osoba ze składu.
export interface Actor { account: Account; personId: string | null; name: string }
