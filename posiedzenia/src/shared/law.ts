import type {Func, ItemKind, OrganCode} from './types.ts';

// Poziom 0 kaskady ustawień (specyfikacja wersji 3, rozdz. 2.2): profil prawny organu. Same liczby, zasady i paragrafy,
// bez nazw organów i regulaminów (te są w danych, Organ.forms, żeby wersja próbna mogła mieć nazwy fikcyjne).
// Wartości z regulaminu nie są ustawieniami: interfejs je pokazuje, ale nikt ich nie zmienia. Zmiana wymaga nowej wersji kodu.
// Skróty: RR – Regulamin Okręgowej Rady (do Prezydium przez § 14 ust. 4), RZ – Regulamin Okręgowego Zjazdu.

export interface Share { num: number; den: number }
export type HouseRuleId = 'K18' | 'F2' | 'F3' | 'F4' | 'F5' | 'F9' | 'D1' | 'D2';
export interface HouseRule { id: HouseRuleId; date: string; title: string; text: string }
export type AppRuleId = 'kanal_zdalny' | 'czas_procedury'
  | 'przestrzen_robocza' | 'obecnosc_przygotowanie' /* dodatek D-9 */ | 'kanal_od_otwarcia' | 'poczta'
  | 'pliki_bez_wynikow' | 'material_komunikacja' | 'material_udostepnienie' | 'pokaz_prowadzacy'
  | 'pokaz_glosowanie' | 'zdjecia' | 'obecnosc_czesciowa' | 'statystyki_glosy';
/**
 * Zasada aplikacji (poziom 0b). Z numerem pytania obowiązuje do odpowiedzi zleceniodawcy na to pytanie; bez numeru
 * (wersja 4, S-22) do decyzji o zmianie zasady.
 */
export interface AppRule { id: AppRuleId; title: string; text: string; question?: number }

/**
 * Odpowiedzi na pytania 10–13 SPEC-4 (rozdz. 9.1). Do czasu odpowiedzi zleceniodawcy obowiązuje kolumna „Do odpowiedzi”.
 * Inna odpowiedź to zmiana jednej wartości tutaj; funkcje w role.ts i teksty zasad poniżej czytają ją same.
 * 10: zawiadomienia e-mailem (a: nie, jak dziś; b, c: dodatek D-8). 11: „Statystyki składu” (a: wszyscy członkowie
 * Prezydium; b: biuro, przewodniczący, wiceprzewodniczący i sekretarz). 12: materiał dla komunikacji (a: od zamknięcia;
 * b: po udostępnieniu). 13: zdjęcia profilowe (a: biuro, administrator, przewodniczący i wiceprzewodniczący; b: także
 * członkowie Prezydium, dodatek D-19; c: każdy zalogowany).
 */
export const ANSWERS = {q10: 'a', q11: 'b', q12: 'b', q13: 'a'} as {q10: 'a' | 'b' | 'c'; q11: 'a' | 'b'; q12: 'a' | 'b'; q13: 'a' | 'b' | 'c'};
/** Krąg osób widzących cudze zdjęcia profilowe (pytanie 13) w zdaniu: „Widzą je {krąg}.” (DB-20). */
export const PHOTO_CIRCLES: Record<'a' | 'b' | 'c', string> = {
  a: 'biuro, administrator, przewodniczący i wiceprzewodniczący',
  b: 'biuro, administrator i członkowie Prezydium',
  c: 'wszystkie osoby zalogowane do aplikacji',
};
export type Allowed = {allowed: true; basis: string} | {allowed: false; reason: string};
/** Kto zaprasza gościa: przewodniczący danego organu albo sam organ. */
export interface GuestInviter { kind: 'przewodniczacy' | 'organ'; organ: OrganCode }

export interface LegalProfile {
  organ: OrganCode;
  version: string;
  available: boolean;
  visible: boolean;
  regulation: 'rr' | 'rz';
  appliedVia?: string;
  quorum: {share: Share; basis: string; statedBy: 'prowadzacy' | 'komisja_mandatowa'; statedByBasis?: string; statedByRule?: HouseRuleId};
  majority: {basis: string};
  notice: {minDays: number; basis: string};
  reasumption: {share: Share; basis: string; condition: string};
  minutes: {deadlineDays: number; deadlineKind: 'sporzadzenie' | 'przekazanie'; deadlineBasis: string;
            adoption: 'nastepne_posiedzenie' | 'milczace'; adoptionBasis: string;
            preparedBy: Func | null; preparedByBasis: string; signaturesBasis: string};
  convener: {funcs: Func[]; organs: OrganCode[]; onRequest?: Share; deputyMay: boolean; basis: string; deputyBasis?: string};
  chair: {funcs: Func[]; basis: string; opening?: {func: Func; organ: OrganCode; basis: string}};
  deputy: {by: Func; from: Func[]; basis: string} | null;
  modes: {basis: string; electronic: 'dozwolone' | 'wymaga_decyzji'; electronicBasis: string};
  remote: Allowed;
  betweenMeetings: Allowed & {quorumBasis?: string};
  /**
   * Punkty porządku obrad. `mandatoryBasis` (dodane w wersji 3 do komunikatów strażnika) podaje punkt regulaminu
   * dla rodzajów obowiązkowych, np. „pkt 4” przy przyjęciu porządku obrad.
   */
  agenda: {mandatory: ItemKind[]; listed: Partial<Record<ItemKind, string>>; listedBasis: string;
           skipListed: boolean; reorderByChair: boolean; closeEarlyByChair: boolean;
           mandatoryBasis?: Partial<Record<ItemKind, string>>;
           variants?: {id: string; name: string; extra: string[]; basis: string}[];
           /** Wersja 4 (U-29): zgłoszenie sprawy przez członka jest wnioskiem do zwołującego; podstawa. */
           proposals?: {basis: string}};
  advisory: {basis: string};
  guests: {by: GuestInviter[]; basis: string; byAnalogy: boolean};
  /**
   * Identyfikator rodzaju dokumentu → podstawa; ten rodzaj zawsze wymaga głosowania i nie da się go wyłączyć (G-1).
   * Wersja 4: `signaturesBasis` to przepis o podpisach pod aktem (B1-06).
   */
  acts: {voted: Record<string, string>; signaturesBasis: string};
}

const presidiumActs: Record<string, string> = {
  uchwala: '§ 8 ust. 1 i 3',
  stanowisko: '§ 8 ust. 9 pkt 2',
  oswiadczenie: '§ 8 ust. 9 pkt 2',
  rezolucja: '§ 8 ust. 9 pkt 1',
  deklaracja: '§ 8 ust. 9 pkt 3',
  apel: '§ 8 ust. 9 pkt 4',
  sprawozdanie: '§ 9 ust. 2 pkt 6',
  protokol: '§ 9 ust. 2 pkt 5, § 13 ust. 3',
};
const rrListed: Partial<Record<ItemKind, string>> = {protokol: 'pkt 5', sprawozdania: 'pkt 6', uchwaly: 'pkt 7', wolne_wnioski: 'pkt 8'};
const rrMandatory: Partial<Record<ItemKind, string>> = {otwarcie: 'pkt 1 i 3', porzadek: 'pkt 4', zamkniecie: 'pkt 9'};
const onlyPresidium = 'Głosowanie między posiedzeniami przewiduje regulamin tylko dla Prezydium (§ 14 ust. 5).';
const reasumptionRR = {share: {num: 1, den: 3}, basis: '§ 12 ust. 5', condition: 'wynik głosowania budzi uzasadnione wątpliwości (§ 12 ust. 1)'};
const minutesRR: LegalProfile['minutes'] = {
  deadlineDays: 21, deadlineKind: 'sporzadzenie', deadlineBasis: '§ 13 ust. 2', adoption: 'nastepne_posiedzenie', adoptionBasis: '§ 13 ust. 3',
  preparedBy: 'sekretarz', preparedByBasis: '§ 17 ust. 2 pkt 1', signaturesBasis: '§ 13 ust. 1',
};

export const LAW: Record<OrganCode, LegalProfile> = {
  prezydium: {
    organ: 'prezydium', version: '2025-03-23', available: true, visible: true, regulation: 'rr', appliedVia: '§ 14 ust. 4',
    quorum: {share: {num: 1, den: 2}, basis: '§ 8 ust. 2', statedBy: 'prowadzacy', statedByRule: 'K18'},
    majority: {basis: '§ 8 ust. 3'},
    notice: {minDays: 7, basis: '§ 7 ust. 1'},
    reasumption: reasumptionRR,
    minutes: minutesRR,
    convener: {funcs: ['przewodniczacy'], organs: [], deputyMay: true, basis: '§ 14 ust. 3', deputyBasis: '§ 16 ust. 1–2'},
    chair: {funcs: ['przewodniczacy', 'wiceprzewodniczacy'], basis: '§ 9 ust. 1'},
    deputy: {by: 'przewodniczacy', from: ['wiceprzewodniczacy'], basis: '§ 16 ust. 2'},
    modes: {basis: '§ 11 ust. 1–2', electronic: 'dozwolone', electronicBasis: '§ 11 ust. 3'},
    remote: {allowed: true, basis: '§ 14 ust. 5 zd. 1'},
    betweenMeetings: {allowed: true, basis: '§ 14 ust. 5 zd. 2', quorumBasis: '§ 14 ust. 5 w zw. z § 8 ust. 2'},
    agenda: {mandatory: ['otwarcie', 'porzadek', 'zamkniecie'], listed: rrListed, listedBasis: '§ 9 ust. 2', mandatoryBasis: rrMandatory,
      skipListed: true, reorderByChair: true, closeEarlyByChair: true, proposals: {basis: '§ 7 ust. 1, § 14 ust. 3, § 16 ust. 2'}},
    advisory: {basis: '§ 7 ust. 2'},
    guests: {by: [{kind: 'przewodniczacy', organ: 'rada'}, {kind: 'organ', organ: 'prezydium'}], basis: '§ 7 ust. 3', byAnalogy: true},
    acts: {voted: presidiumActs, signaturesBasis: '§ 8 ust. 7'},
  },
  // Profile Okręgowej Rady i Okręgowego Zjazdu: w kodzie, ukryte i bez ustawień (DA-15). Przed etapem 2 sprawdza je
  // ponownie zespół tego etapu.
  rada: {
    organ: 'rada', version: '2025-03-23', available: false, visible: false, regulation: 'rr',
    quorum: {share: {num: 1, den: 2}, basis: '§ 8 ust. 2', statedBy: 'komisja_mandatowa', statedByBasis: '§ 9 ust. 2 pkt 3'},
    majority: {basis: '§ 8 ust. 3'},
    notice: {minDays: 7, basis: '§ 7 ust. 1'},
    reasumption: reasumptionRR,
    minutes: minutesRR,
    convener: {funcs: ['przewodniczacy'], organs: ['prezydium'], onRequest: {num: 1, den: 3}, deputyMay: true, basis: '§ 6 ust. 2', deputyBasis: '§ 16 ust. 1–2'},
    chair: {funcs: ['przewodniczacy', 'wiceprzewodniczacy'], basis: '§ 9 ust. 1'},
    deputy: {by: 'przewodniczacy', from: ['wiceprzewodniczacy'], basis: '§ 16 ust. 2'},
    modes: {basis: '§ 11 ust. 1–2', electronic: 'dozwolone', electronicBasis: '§ 11 ust. 3'},
    remote: {allowed: true, basis: '§ 6 ust. 3'},
    betweenMeetings: {allowed: false, reason: onlyPresidium},
    // Rodzaje dla § 9 ust. 2 pkt 2–3 (osoby liczące głosy, komisja mandatowa) dochodzą w etapie 2.
    agenda: {mandatory: ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie'], listed: rrListed,
      listedBasis: '§ 9 ust. 2', mandatoryBasis: {...rrMandatory, ...rrListed}, skipListed: false, reorderByChair: true, closeEarlyByChair: true},
    advisory: {basis: '§ 7 ust. 2'},
    guests: {by: [{kind: 'przewodniczacy', organ: 'rada'}, {kind: 'organ', organ: 'prezydium'}], basis: '§ 7 ust. 3', byAnalogy: false},
    acts: {voted: presidiumActs, signaturesBasis: '§ 8 ust. 7'},
  },
  zjazd: {
    organ: 'zjazd', version: '2025-03-23', available: false, visible: false, regulation: 'rz',
    quorum: {share: {num: 1, den: 2}, basis: '§ 5 ust. 2', statedBy: 'komisja_mandatowa', statedByBasis: '§ 9 ust. 1 pkt 1'},
    majority: {basis: '§ 5 ust. 4'},
    notice: {minDays: 14, basis: '§ 3 ust. 2'},
    reasumption: {share: {num: 1, den: 5}, basis: '§ 14 ust. 5', condition: 'wynik głosowania budzi uzasadnione wątpliwości (§ 14 ust. 1)'},
    minutes: {deadlineDays: 30, deadlineKind: 'przekazanie', deadlineBasis: '§ 17 ust. 2', adoption: 'milczace', adoptionBasis: '§ 17 ust. 4–6',
      preparedBy: null, preparedByBasis: '–', signaturesBasis: '§ 17 ust. 6'},
    convener: {funcs: [], organs: ['rada'], deputyMay: false, basis: '§ 2 ust. 1, § 19 ust. 1'},
    chair: {funcs: [], basis: '§ 7 ust. 1', opening: {func: 'przewodniczacy', organ: 'rada', basis: '§ 6'}},
    deputy: null,
    modes: {basis: '§ 13 ust. 1–2', electronic: 'wymaga_decyzji', electronicBasis: '§ 8 ust. 3'},
    remote: {allowed: false, reason: 'Regulamin Okręgowego Zjazdu nie przewiduje obrad zdalnych.'},
    betweenMeetings: {allowed: false, reason: onlyPresidium},
    // Punkty wspólne dla każdego zjazdu z § 8 ust. 2 pkt 1–7 i 11–14 dostaną własne rodzaje w etapie 3.
    agenda: {mandatory: ['otwarcie', 'porzadek', 'zamkniecie'], listed: {}, listedBasis: '§ 8 ust. 2', skipListed: false, reorderByChair: false, closeEarlyByChair: false,
      variants: [
        {id: 'zwyczajny', name: 'Zjazd zwyczajny', extra: [], basis: '§ 8 ust. 2'},
        {id: 'sprawozdawczo-wyborczy', name: 'Zjazd sprawozdawczo-wyborczy', extra: ['pkt 8', 'pkt 9', 'pkt 10'], basis: '§ 8 ust. 2'},
        {id: 'nadzwyczajny', name: 'Nadzwyczajny zjazd', extra: ['sprawy z uchwały o zwołaniu'], basis: '§ 18–21'},
      ]},
    advisory: {basis: '§ 3 ust. 4–6'},
    guests: {by: [{kind: 'organ', organ: 'rada'}, {kind: 'organ', organ: 'prezydium'}], basis: '§ 3 ust. 7', byAnalogy: false},
    acts: {voted: {
      uchwala: '§ 5 ust. 1 i 4', stanowisko: '§ 5 ust. 9 pkt 2', oswiadczenie: '§ 5 ust. 9 pkt 2', rezolucja: '§ 5 ust. 9 pkt 1',
      deklaracja: '§ 5 ust. 9 pkt 3', apel: '§ 5 ust. 9 pkt 4', sprawozdanie: '§ 8 ust. 2', protokol: '§ 17 ust. 4–6',
    }, signaturesBasis: '§ 5 ust. 7'},
  },
};

/** Zasady przyjęte przez Izbę (poziom 0a). Teksty bez słowa „Izba”, bo trafiają też do wersji próbnej. */
export const HOUSE_RULES: HouseRule[] = [
  {id: 'K18', date: '2026-11-18', title: 'Uproszczony porządek obrad Prezydium', text: 'Porządek obrad Prezydium nie obejmuje wyboru osób liczących głosy ani komisji mandatowej. Kworum stwierdza osoba prowadząca obrady na podstawie listy obecności.'},
  {id: 'F2', date: '2026-11-19', title: 'Obowiązkowe ogłoszenie wyniku', text: 'Wynik głosowania ogłasza osoba prowadząca obrady. Do ogłoszenia obrady nie idą dalej.'},
  {id: 'F3', date: '2026-11-19', title: 'Uchwalony tryb wiąże', text: 'Głosowanie w sprawie odbywa się w trybie, który uchwalił organ.'},
  {id: 'F4', date: '2026-11-19', title: 'Kolejność z powodem', text: 'Rozpoczęcie punktu poza kolejnością, odroczenie, wycofanie i zamknięcie przed rozpatrzeniem wszystkich punktów wymagają powodu, który trafia do protokołu.'},
  {id: 'F5', date: '2026-11-19', title: 'Spotkanie robocze', text: 'Bez kworum posiedzenie trwa do końca jako spotkanie robocze bez głosowań.'},
  {id: 'F9', date: '2026-11-19', title: 'Potwierdzanie obecności', text: 'Obecność zgłoszoną na posiedzeniu stacjonarnym potwierdza osoba prowadząca obrady albo biuro.'},
  {id: 'D1', date: '2026-11-20', title: 'Zastępstwo bez udziału biura', text: 'Zastępcę wyznacza przewodniczący. Zastępca otwiera posiedzenie albo przejmuje prowadzenie bez potwierdzenia przez biuro. Biuro nie wykonuje czynności organu.'},
  {id: 'D2', date: '2026-11-20', title: 'Projekt porządku na żywo', text: 'Zmiany projektu porządku obrad widzą od razu członkowie i ekran sali. Dotyczy to punktu „Przyjęcie porządku obrad” i całego spotkania roboczego.'},
];

/** Zasady aplikacji (poziom 0b). Linia źródła mówi „Ustalone w aplikacji.” i podaje tekst zasady, nigdy paragraf jako źródło. */
export const APP_RULES: AppRule[] = [
  {id: 'kanal_zdalny', title: 'Kanał wiadomości przy obradach na odległość', question: 9,
    text: 'Na posiedzeniu zdalnym i w głosowaniu między posiedzeniami kanał wiadomości działa zawsze. Regulamin wymaga dwustronnej komunikacji (§ 14 ust. 5), a kanał jest jej częścią w aplikacji.'},
  {id: 'czas_procedury', title: 'Najkrótszy czas głosowania między posiedzeniami', question: 7,
    text: 'Głosowanie między posiedzeniami trwa co najmniej 24 godziny, chyba że osoba, która je rozpoczyna albo zmienia termin, poda powód krótszego terminu.'},
  // Wersja 4 (SPEC-4 rozdz. 3.2): odczytanie prośby z 20.11.2026 i nowe ustalenia jako zasady aplikacji, nie zasady
  // przyjęte przez Izbę (DB-33, K4-12). Zasady i zdania dodatków doszły razem z dodatkami (D-9 obecnosc_przygotowanie,
  // D-11 zadania w `przestrzen_robocza`, D-16 zdanie o ekranie sali w `zdjecia`).
  {id: 'przestrzen_robocza', title: 'Przygotowanie posiedzenia',
    text: 'Uwagi, zgłoszenia i zadania z przygotowania nie są materiałem posiedzenia i nie trafiają do protokołu. Od otwarcia posiedzenia nie można ich zmieniać, a po zamknięciu można je czytać przez 90 dni. Zgłoszenie czekające na posiedzenie wygasa po 365 dniach. O odrzuceniu i odłożeniu zgłoszenia decyduje zwołujący.'},
  {id: 'obecnosc_przygotowanie', title: 'Kto ogląda przygotowanie',
    text: 'Aplikacja pokazuje, kto ogląda przygotowanie posiedzenia, tylko przed otwarciem posiedzenia, tylko u osób, które na to pozwoliły, i bez zapisu historii.'},
  {id: 'kanal_od_otwarcia', title: 'Kanał wiadomości od otwarcia',
    text: 'Kanał wiadomości posiedzenia działa od otwarcia posiedzenia albo rozpoczęcia głosowania między posiedzeniami. Wcześniej pisze się w uwagach przygotowania.'},
  {id: 'poczta', title: 'Wiadomości e-mail',
    text: 'Każdą wiadomość o posiedzeniu wysyła człowiek po obejrzeniu podglądu. Od otwarcia do zamknięcia posiedzenia aplikacja nie wysyła wiadomości o tym posiedzeniu, a informacja o postępie, która nie wyszła przed otwarciem, zostaje anulowana. Połączenie z serwerem poczty jest zawsze szyfrowane. Informację o postępie przygotowań można wysłać najwyżej raz na 60 minut. Treść wysłanej wiadomości znika po 30 dniach, a wpis o wysyłce po 365 dniach.'},
  {id: 'pliki_bez_wynikow', title: 'Pliki i wydruki',
    text: 'Pliki i wydruki nie zawierają wyników głosowań przed ogłoszeniem, także u osoby prowadzącej obrady. Głosowanie w toku podają tylko zdaniem, że trwa.'},
  {id: 'material_komunikacja', title: 'Materiał dla komunikacji',
    text: 'Z danych aplikacji materiał dla komunikacji podaje z imienia i nazwiska tylko osoby, które pełnią funkcję w organie albo mają głos doradczy. Tytuły spraw trafiają do niego tylko przy rodzajach spraw, które na to pozwalają; sprawa bez rodzaju sprawy ma w nim tylko liczbę. Poziomy ustala się przy zamknięciu posiedzenia, a później można je tylko zaostrzyć. Z głosowań tajnych materiał podaje tylko wynik. Zdania i opis wpisane dla komunikacji przechodzą bez zmian, więc piszący dba, żeby nie zawierały danych innych osób.'},
  {id: 'material_udostepnienie', title: 'Udostępnienie materiału dla komunikacji', question: 12,
    text: ANSWERS.q12 === 'a'
      ? 'Konto komunikacji dostaje materiał od zamknięcia posiedzenia.'
      : 'Konto komunikacji dostaje materiał po udostępnieniu przez biuro, przewodniczącego albo osobę, która zamknęła obrady. Zmiana zdań, poziomów albo opisu po udostępnieniu wymaga ponownego udostępnienia.'},
  {id: 'pokaz_prowadzacy', title: 'Pokaz plików na posiedzeniu',
    text: 'Dodatkowe pliki i prezentacje na posiedzeniu pokazuje osoba prowadząca obrady, czyli przewodniczący albo wiceprzewodniczący, który prowadzi obrady. Biuro przygotowuje pliki do pokazania.'},
  {id: 'pokaz_glosowanie', title: 'Pokaz a głosowanie',
    text: 'W trakcie głosowania pokazu nie można zmienić. Ekran sali i telefony pokazują głosowanie, a pokaz wraca przyciskiem osoby prowadzącej obrady.'},
  {id: 'zdjecia', title: 'Zdjęcie profilowe', question: 13,
    text: `Zdjęcie jest dobrowolne. Widzą je ${PHOTO_CIRCLES[ANSWERS.q13]}. Nie trafia do dokumentów. Znika przy blokadzie konta i 30 dni po zakończeniu członkostwa. Na ekranie sali pojawia się tylko za zgodą tej osoby.`},
  {id: 'obecnosc_czesciowa', title: 'Obecność w statystykach',
    text: 'Obecność częściowa to spóźnienie, wcześniejsze wyjście albo przerwa w obecności dłuższe niż 15 minut albo nieobecność przy głosowaniu. Godziną przybycia jest godzina zgłoszenia obecności w aplikacji.'},
  {id: 'statystyki_glosy', title: 'Głosy w statystykach',
    text: 'Statystyki pokazują głosy innych osób tylko z głosowań imiennych. Własne głosy jawne widzi wyłącznie ta osoba. Z głosowań tajnych statystyki znają tylko pobranie karty.'},
];
/** Linia „Kiedy to się zmieni?” przy zasadzie aplikacji bez numeru pytania (S-22). */
export const APP_RULE_NO_QUESTION = 'Gdy zapadnie decyzja o zmianie tej zasady. Do tego czasu obowiązuje.';

/** Najkrótszy czas głosowania między posiedzeniami bez podania powodu (APP_RULES 'czas_procedury', pytanie 7). */
export const PROCEDURE_MIN_HOURS = 24;

export function lawOf(organ: OrganCode): LegalProfile { return LAW[organ] ?? LAW.prezydium; }
export const isLockedDocType = (id: string, law: LegalProfile) => id in law.acts.voted;
export const shareOf = (share: Share, n: number) => Math.ceil(n * share.num / share.den);
export const shareText = (share: Share) => `${share.num}/${share.den}`;
export const houseRule = (id: HouseRuleId) => HOUSE_RULES.find(r => r.id === id)!;
export const appRule = (id: AppRuleId) => APP_RULES.find(r => r.id === id)!;

/** Punkt regulaminu, który wymienia rodzaj punktu porządku, np. „§ 9 ust. 2 pkt 5”; null, gdy regulamin go nie wymienia. */
export function agendaBasis(law: LegalProfile, kind: ItemKind): string | null {
  const point = law.agenda.listed[kind] ?? law.agenda.mandatoryBasis?.[kind];
  return point ? `${law.agenda.listedBasis} ${point}` : null;
}
