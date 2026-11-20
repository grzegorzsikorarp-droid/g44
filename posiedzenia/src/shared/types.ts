// Model danych aplikacji. Nazwy pojęć odpowiadają Regulaminowi Okręgowej Rady
// Pielęgniarek i Położnych w Słupsku (uchwała nr 9 OZPiP z 22.03.2025).
import type {AppRuleId, HouseRuleId} from './law.ts';

export type OrganCode = 'prezydium' | 'rada' | 'zjazd';
export type Func = 'przewodniczacy' | 'wiceprzewodniczacy' | 'sekretarz' | 'skarbnik' | 'czlonek';

export interface Person { id: string; name: string; sortName: string }
/** Uchwała organu: numer i data RRRR-MM-DD (wersja 3). */
export interface ActRef { organ: OrganCode; number: string; date: string }
/**
 * Podstawa zmiany składu (DA-13): uchwała (wybór, odwołanie, liczba członków, stwierdzenie wygaśnięcia mandatu),
 * rezygnacja (data i to, komu ją złożono) albo wygaśnięcie mandatu przed uchwałą stwierdzającą.
 */
export type CompositionBasis =
  | {kind: 'uchwala'; act: ActRef}
  | {kind: 'rezygnacja'; date: string; to: string}
  | {kind: 'wygasniecie'; date: string; event: string; act?: ActRef};
/**
 * Członkostwo w organie. `canChair` zostaje w danych, ale wylicza się z funkcji i profilu prawnego przy każdym zapisie
 * składu; domena czyta `canChairPerson()` z role.ts. `since` i `basis` od wersji 3 (zmiana składu z podstawą).
 */
export interface Membership { organ: OrganCode; personId: string; func: Func; label: string; order: number; canChair: boolean; since?: string; basis?: CompositionBasis }
/** Pomocnicze nazwy organu (dane, nie prawo), także w wersji próbnej z nazwami fikcyjnymi. */
export interface OrganForms {
  genitive: string;        // 'Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku'
  dative: string;
  gender: 'm' | 'f' | 'n'; // do czasowników: „Prezydium … uchwaliło”, „Okręgowa Rada … uchwaliła”
  members: string;         // dopełniacz liczby mnogiej: 'członków Prezydium'
  member: string;          // 'członek Prezydium'
  chairman: string;        // pełna nazwa funkcji przewodniczącego
  regulation: string;      // pełna nazwa regulaminu w dopełniaczu
  regulationAct: string;   // akt, którego załącznikiem jest regulamin
}
/** `active` zostaje w danych, ale domena go nie czyta: o działaniu organu decyduje `law.available` (DA-15). */
export interface Organ { code: OrganCode; name: string; shortName: string; active: boolean; forms: OrganForms }
/**
 * Okres członkostwa `[from, to)` (B4-05). Dodatek D-14: typ istnieje od wersji 4, dane i polecenia dochodzą z dodatkiem;
 * rdzeń wersji 4 go nie czyta.
 */
export interface MembershipPeriod {
  id: number; organ: OrganCode; personId: string;
  from: string; to?: string;
  basis: CompositionBasis; endBasis?: CompositionBasis;
  approx?: true;
}
export interface Roster { organs: Organ[]; persons: Person[]; memberships: Membership[]; periods?: MembershipPeriod[] }
/**
 * Dokumenty posiedzenia (B1-01, B1-11, wersja 4): identyfikator, formaty i stan. Teczka ma własną trasę, ale stoi na liście
 * karty „Dokumenty posiedzenia” (SPEC-4 2.1). `wykaz-{nr}` to wykaz imienny głosowania, `akt-{id}` akt z treścią przyjętą.
 */
export type PaperId = 'protokol' | 'porzadek' | 'obecnosc' | 'obecnosc-podpis' | 'wyniki' | `wykaz-${string}` | `akt-${string}`
  | 'kanal' | 'dziennik' | 'komunikacja' | 'teczka';
export type PaperFormat = 'html' | 'docx' | 'md' | 'csv' | 'zip';
/** Stan dokumentu (B1-02): projekt, stan na chwilę (posiedzenie trwa) albo ustalony. */
export type PaperState = 'projekt' | 'stan_na' | 'ustalony';
/** Zamknięte posiedzenie albo głosowanie między posiedzeniami do „Dotyczy protokołu” (G-33). */
export interface ClosedRef { id: string; organ: OrganCode; kind: MeetingKind; day: string; working: boolean; adopted: boolean; title: string }

// członek organu, osoba z głosem doradczym (§ 7 ust. 2), zaproszony gość (§ 7 ust. 3), obsługa biura (§ 23),
// konto „Komunikacja” bez osoby ze składu (wersja 4, DB-9: widzi tylko odbyte posiedzenia i materiały dla komunikacji)
export type AccountKind = 'czlonek' | 'doradczy' | 'gosc' | 'biuro' | 'komunikacja';
/**
 * Konto. Wersja 4 (SPEC-4 2.1): `avatar` to wersja zdjęcia profilowego (brak albo 0 to brak zdjęcia), `avatarScreen`
 * zgoda na zdjęcie na ekranie sali (dodatek D-16), `avatarRemoved` usunięcie zdjęcia z przyczyną. Adresu e-mail w koncie
 * nie ma (DB-19): żyje tylko na serwerze i w wersji próbnej (`AccountContact` w mail.ts).
 */
export interface Account {
  id: string; username: string; kind: AccountKind; personId: string | null;
  displayName: string; label: string; admin: boolean; mustChange: boolean; disabled: boolean;
  avatar?: number; avatarScreen?: boolean;
  avatarRemoved?: {at: number; by: string; reason?: string; cause?: 'administrator' | 'koniec_czlonkostwa' | 'blokada'};
}

export type MeetingKind = 'posiedzenie' | 'procedura';
export type MeetingMode = 'stacjonarne' | 'zdalne';
export type MeetingStatus = 'przygotowanie' | 'trwa' | 'przerwa' | 'zakonczone';

export type ItemKind = 'otwarcie' | 'porzadek' | 'protokol' | 'sprawozdania' | 'uchwaly' | 'wolne_wnioski' | 'zamkniecie' | 'sprawa';
export type ItemStatus = 'oczekuje' | 'w_toku' | 'zakonczony' | 'odroczony' | 'wycofany';
/**
 * Osoba przy punkcie porządku (F12): referuje sprawę albo prowadzi punkt. `role` to funkcja, np. „Sekretarz”.
 * Wersja 4 (B2-W11): `personId` uzupełnia domena, gdy imię i nazwisko odpowiada dokładnie jednej osobie ze składu.
 */
export interface Presenter { name: string; role: string; kind: 'referuje' | 'prowadzi'; personId?: string }
/** Poziom w materiale dla komunikacji (B1-33): „Pełna treść”, „Tytuł”, „Tylko liczba”, „Nie trafia”. */
export type CommsLevel = 'pelna' | 'tytul' | 'liczba' | 'pomin';
/** Kto i kiedy zapisał czynność z powodem (F4, F5, F7). `by` to imię i nazwisko albo nazwa konta. */
export interface Reasoned { reason: string; at: number; by: string }
/** Ślad zmiany ustawienia (wersja 3): kto, kiedy, konto; `live` przy zmianie w trakcie obrad, `copiedFrom` przy powieleniu. */
export interface Stamp { at: number; by: string; accountId: string; live?: true; reason?: string; copiedFrom?: string }
/** Uchwalenie tajności albo głosowania imiennego w głosowaniu między posiedzeniami (G-13). */
export type ModeDecision = {kind: 'uchwala'; number: string; date: string} | {kind: 'glosowanie'; number: number; date: string};
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
  /** Wersja 3: potwierdzony rodzaj sprawy (CaseType.id) i propozycja z tytułu, która nie działa bez przyjęcia. */
  caseType?: string; caseTypeGuess?: string;
  /** Wersja 3: czas głosowania w tym punkcie (minuty), gdy inny niż w ustawieniach posiedzenia. */
  voteMinutes?: number;
  /** Wersja 3: dane uchwały albo głosowania, które ustaliło tryb w głosowaniu między posiedzeniami (G-13). */
  modeAct?: ModeDecision;
  stamps?: Partial<Record<'kind' | 'docType' | 'caseType' | 'voteMinutes', Stamp>>;
  /** Wersja 4: poziom i zdanie dla komunikacji przy punkcie (poziom 2, tylko zaostrza; U-26, U-27). */
  comms?: {level?: CommsLevel; sentence?: string; stamp: Stamp};
  /** Wersja 4: „Dotyczy protokołu” (identyfikator zamkniętego posiedzenia) i propozycja, która nie działa bez przyjęcia (U-28). */
  protocolOf?: string; protocolOfGuess?: string;
}

/**
 * Rodzaj dokumentu ze słownika, który prowadzi biuro (F11, wersja 3). `adopted` i `rejected` to formuły wyniku,
 * `inActs` to „w wykazie aktów protokołu”. Blokada formy aktu nie jest polem: liczy ją `isLockedDocType` (law.ts).
 */
export interface DocType {
  id: string; name: string; adopted: string; rejected: string; voted: boolean; order: number; active: boolean; inActs: boolean;
  /** Wersja 4: poziom w materiale dla komunikacji (U-24). Brak przy odczycie starszych danych: wartość z `defaultCommsLevel`. */
  comms?: CommsLevel;
}
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
/**
 * Wersja 3: `via` mówi, z jaką czynnością zapisała się obecność ('otwarcie', 'prowadzenie') albo wyjście osoby
 * prowadzącej zapisane przez osobę, która przejęła prowadzenie ('przejmujacy'); `accountId` to konto, które zapisało.
 */
export interface PresenceEvent { who: string; guest: boolean; type: 'przybycie' | 'wyjscie' | 'zgloszenie' | 'odrzucenie'; at: number; by: string; reportedAt?: number; via?: 'otwarcie' | 'prowadzenie' | 'przejmujacy'; accountId?: string }

/** Podstawa otwarcia albo zmiany prowadzenia (DA-17). */
export type ChairBasis = 'przewodniczacy' | 'zastepca' | 'bez_wyznaczenia' | 'zamiast_zastepcy' | 'przekazanie' | 'powrot';
/**
 * Zmiana prowadzenia. `reason` jak w wersji 2 (opis zmiany). Wersja 3: `basis`, `opening` przy otwarciu,
 * `recordedExit` gdy osoba przejmująca zapisała wyjście poprzedniej osoby prowadzącej, `reasonGiven` to powód podany
 * przy otwarciu albo przejęciu zamiast wyznaczonego zastępcy.
 */
export interface ChairChange { at: number; from: string | null; to: string; by: string; reason: string; basis?: ChairBasis; opening?: true; recordedExit?: true; accountId?: string; reasonGiven?: string }
export interface Chair { current: string | null; deputy: string | null; deputyBasis: string; changes: ChairChange[]; deputySet?: {at: number; by: string; accountId: string} }

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
  /**
   * Głosowanie między posiedzeniami przerwane bez rozstrzygnięcia (F7): bez wyniku i bez ogłoszenia. Wybory nie zostają
   * w danych; `voters` to lista osób, które oddały głos w głosowaniu jawnym (w tajnym lista pobranych kart jest w `secret`).
   */
  aborted?: Reasoned & {voters?: string[]};
  /**
   * Skutek rozstrzygnięcia czeka na ogłoszenie wyniku (F2): przyjęcie porządku, zmiana porządku, tryb głosowania,
   * rozstrzygnięcie wniosku o reasumpcję i zastąpienie wyniku. Głosowania zamknięte przed tą zmianą mają skutek już zapisany.
   */
  outcomePending?: true;
  /** Wersja 4: „Dotyczy protokołu” utrwalone przy otwarciu głosowania o celu `protokol` (DB-5) i poprawka po zamknięciu (G-38). */
  protocolOf?: string;
  protocolOfFix?: {from: string | null; to: string; reason: string; at: number; by: string; accountId: string};
}

export interface Motion {
  id: string; type: 'reasumpcja'; ballotId: string; justification: string;
  createdBy: string; createdAt: number; signatures: string[];
  status: 'zbiera_podpisy' | 'zlozony' | 'glosowany' | 'przyjety' | 'odrzucony' | 'wycofany';
  filedAt?: number; presentAtFiling?: number; voteBallotId?: string; repeatBallotId?: string;
}

export interface Message { id: string; author: string; authorName: string; text: string; at: number }
/**
 * Wpis dziennika. `tag: 'projekt'` oznacza zmianę projektu porządku obrad (F8; od wersji 3 także przed otwarciem),
 * `ustawienia` zmianę danych albo ustawień posiedzenia, `odstepstwo` odstępstwo do protokołu (wersja 3).
 * `ballotId` wiąże wpis o zakończeniu głosowania z głosowaniem (widok ukrywa w nim liczby do ogłoszenia wyniku, F2),
 * `itemId` wiąże wpis z punktem porządku, `accountId` to konto, które wykonało czynność.
 */
export interface LogEntry { at: number; text: string; by: string; tag?: 'projekt' | 'ustawienia' | 'odstepstwo' | 'pokaz'; ballotId?: string; accountId?: string; itemId?: string; displayId?: string }
/**
 * `kind: 'projekt'` (wersja 3): projekt porządku obrad w trybie zmian; `id` to identyfikator posiedzenia.
 * `kind: 'pokaz'` (wersja 4, B3-11): trwający pokaz pliku albo materiału; `id` to `ShowState.id`.
 */
export type Presentation = {kind: 'punkt' | 'material' | 'glosowanie' | 'wynik' | 'projekt' | 'pokaz'; id: string; at: number};

/** Dokument dołączony po posiedzeniu (B1-14, wersja 4). */
export type FiledKind = 'protokol_sporzadzony' | 'protokol_podpisany' | 'zawiadomienie' | 'akt_podpisany' | 'inny';
export interface FiledDocument {
  id: string; kind: FiledKind; title: string;
  fileId: string; fileName: string; mime: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'image/jpeg' | 'image/png';
  size: number; sha256: string;
  /** Przy akcie podpisanym: głosowanie, którego akt dotyczy. */
  ballotId?: string;
  at: number; by: string; accountId: string;
  /** Nowy plik tego samego rodzaju (poza „inny” i aktem podpisanym tego samego głosowania) zastępuje poprzedni. */
  replacedAt?: number;
}
/** Fakt „Protokół sporządzony” z osobą sporządzającą i datą wpisaną ręcznie (DB-6, K4-7). */
export interface MinutesReady {
  date: string;
  author: {personId: string; name: string; func: string};
  at: number; by: string; accountId: string;
}
/** Plik do pokazania (B3-03): nie materiał, bez rodzaju dokumentu, numeru i wersji. */
export type DisplayKind = 'pdf' | 'obraz' | 'obrazy' | 'wideo';
export interface DisplayFile { fileId: string; name: string; type: 'pdf' | 'jpeg' | 'png' | 'webp' | 'mp4'; size: number; width?: number; height?: number }
export interface DisplayRef {
  id: string; title: string; kind: DisplayKind; files: DisplayFile[];
  /** PDF z checkPdf (null: nie wiadomo); obrazy files.length; obraz 1; wideo null. */
  pages: number | null;
  itemId: string | null;
  /** Opis dla osób, które nie widzą obrazu, do 2000 znaków. */
  description?: string;
  /** Przy serii obrazów: nieobowiązkowy PDF tej prezentacji do pobrania (K4-28). */
  pdf?: DisplayFile;
  addedAt: number; addedBy: string; accountId: string;
  /** Dodany w trakcie obrad (B3-17). */
  live?: true;
}
/** Trwający pokaz (B3-11); zostaje w trakcie głosowania, a `presentation` wraca do niego przyciskiem. */
export interface ShowState {
  source: 'plik' | 'material'; id: string; version?: number;
  page: number; itemId: string | null;
  startedAt: number; by: string; accountId: string;
  /** Wideo (dodatek D-4). */
  playing?: {since: number; from: number} | null; pausedAt?: number;
}

/** Ustawienia posiedzenia (poziom 2). `messagesFromStart` to dodatek (D). */
export interface MeetingSettings { voteMinutes?: number; motionMinutes?: number; messagesFromStart?: boolean }
export type MeetingSettingKey = keyof MeetingSettings;
/** Warstwa kaskady, z której pochodzi wartość skuteczna (rozdz. 2.6 specyfikacji wersji 3). */
export type SettingSource = 'prawo' | 'zasada' | 'aplikacja' | 'ogolne' | 'szablon' | 'posiedzenie' | 'punkt' | 'obrady';
/** Wartość skuteczna z jej źródłem. `inheritedSource` (dodane w wersji 3) mówi, skąd pochodzi `inherited`. */
export interface Effective<T> {
  value: T; source: SettingSource; level: 0 | 1 | 2 | 3;
  basis?: string;
  rule?: HouseRuleId;
  appRule?: AppRuleId;
  via?: {kind: 'rodzaj_sprawy' | 'rodzaj_dokumentu' | 'material' | 'wzor'; name: string; basis?: string};
  inherited?: T; inheritedSource?: SettingSource;
  stamp?: Stamp;
  frozen?: true; legacy?: true;
}
export interface FrozenMember { personId: string; func: Func; label: string; order: number }
/**
 * Ustawienia, skład i słownik zapisane przy otwarciu (albo przy przejściu na wersję 3, `legacy`). Wersja 4: `v4` przy
 * otwarciu w wersji 4 (DB-4: tylko takie posiedzenia dostają nowe zdania projektu protokołu), `term` kadencja z chwili
 * otwarcia (DB-37).
 */
export interface FrozenSettings {
  at: number; lawVersion: string; generalRevision: number;
  legacy?: true;
  v4?: true;
  term?: {name: string; number: string};
  members: FrozenMember[];
  docTypes: DocType[];
  meeting: Record<MeetingSettingKey, Effective<unknown>>;
}

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
  // Wersja 3 (kaskada ustawień). Wszystkie pola nieobowiązkowe: dane sprzed wersji 3 wczytują się bez zmian.
  settings?: MeetingSettings;
  settingStamps?: Partial<Record<MeetingSettingKey, Stamp>>;
  /** Wzór posiedzenia, z którego powstało. */
  template?: {id: string; name: string};
  /** Identyfikatory punktów w chwili pierwszego wpisania daty zawiadomienia. */
  noticeItems?: string[];
  /** Pominięte punkty wymienione w § 9 ust. 2 (DA-7). `personId` dodane w wersji 3 do zdania w protokole. */
  skipped?: (Reasoned & {title: string; kind: ItemKind; accountId: string; personId?: string | null})[];
  /** Zaproszenia gości: kto zaprasza, a przy zaproszeniu przez organ kiedy organ to postanowił (DA-6). */
  guestInvites?: Record<string, {by: 'przewodniczacy' | 'organ'; decision?: string; at: number; recordedBy: string; accountId: string;
    /** Dodatek D-6: zgoda gościa na wymienienie w materiałach dla komunikacji (B1-34). */
    comms?: {at: number; by: string; accountId: string}}>;
  /** Głosowanie między posiedzeniami krótsze niż 24 godziny (DA-21). */
  shortTerm?: Reasoned & {accountId: string};
  /**
   * Głosowanie między posiedzeniami: termin wpisany ręcznie w przygotowaniu (DA-21). Bez tego śladu koniec głosowania
   * liczy się przy rozpoczęciu z ustawień ogólnych (`procedureEndAt` w cascade.ts).
   */
  endsAtSet?: {at: number; by: string; accountId: string};
  /**
   * Posiedzenie, z którego powielono (rozdz. 4.5 pkt 6, tabela powielenia): zastępca i goście nie przechodzą do kopii,
   * ale przygotowanie podpowiada „Wyznacz ponownie” i „Zaproś ponownie”. Nie wchodzi do wartości skutecznych ani do protokołu.
   */
  duplicatedFrom?: {id: string; date: string; deputy: string | null; invited: string[]};
  /** Dodatek (D), tylko przy wariancie (b) pytania 3. */
  agendaApproved?: {at: number; by: string; accountId: string};
  frozen?: FrozenSettings;
  // Wersja 4 (SPEC-4 2.1). Wszystkie pola nieobowiązkowe: dane wersji 3 wczytują się bez zmian.
  /** Odnośnik do albumu zdjęć z posiedzenia (DB-38): fakt bez dziedziczenia, tylko https. */
  photos?: {url: string; at: number; by: string; accountId: string};
  /** Dokumenty dołączone po posiedzeniu (B1-14). */
  filed?: FiledDocument[];
  /** „Protokół sporządzony” (DB-6). */
  minutesReady?: MinutesReady;
  /** Poziomy materiału dla komunikacji utrwalone przy zamknięciu (DB-41): identyfikator punktu → poziom skuteczny. */
  closedComms?: Record<string, CommsLevel>;
  /** „Opis dla komunikacji” (DB-43). */
  commsNote?: {text: string; at: number; by: string; accountId: string};
  /** Licznik zmian treści wpisywanej przez ludzi po zamknięciu (DB-42). */
  commsInputs?: number;
  /** Udostępnienie materiału kontu „Komunikacja” (DB-42); `inputs` to stan licznika `commsInputs` w chwili udostępnienia. */
  commsReleased?: {at: number; by: string; accountId: string; inputs: number} | null;
  /** Pliki do pokazania i trwający pokaz (B3). */
  displays?: DisplayRef[]; show?: ShowState | null;
  /** Dodatek D-8 (pytanie 10, wariant b albo c): zatwierdzenie treści zawiadomienia i sposób wysłania. */
  noticeApproval?: {at: number; by: string; accountId: string; digest: string};
  noticeSentVia?: 'aplikacja';
}

// Kto wykonuje działanie: konto, a dla członka organu także osoba ze składu.
export interface Actor { account: Account; personId: string | null; name: string }
