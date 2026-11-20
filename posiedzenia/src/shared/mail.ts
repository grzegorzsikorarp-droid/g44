import type {AccountKind} from './types.ts';

// Poczta e-mail wersji 4 (SPEC-4 2.1, B2-P01–P18). Etap D.1: same typy, żeby ustawienia ogólne (`GeneralSettings.mail`)
// i sekcja „Poczta e-mail” miały jeden model. Funkcje (`validateMail`, `validAddress`, `canSendMail`, `mailRecipients`,
// `MAIL_KINDS`, `defaultMailSettings`) dochodzą w etapie D.2 razem ze skrzynką nadawczą.

export type MailKind = 'postep' | 'po_posiedzeniu' | 'komunikacja' | 'protokol' | 'zawiadomienie' | 'kod' | 'zmiana_adresu' | 'proba';
/** Rodzaje z wstępem ustawianym przez biuro (U-37); pozostałe mają stałą treść. */
export type MailIntroKind = 'postep' | 'po_posiedzeniu';
/** Ustawienia „Poczta e-mail” (B2-P12, U-36). Hasło nigdy tutaj: tylko w środowisku serwera (DB-17). */
export interface MailSettings {
  enabled: boolean; host: string; port: number; security: 'tls' | 'starttls'; user: string;
  fromAddress: string; fromName: string; replyTo: string; privacyUrl: string; controller: string;
  intros: Partial<Record<MailIntroKind, string>>;
}
/** Preferencje osoby (U-46): domyślnie obie wiadomości włączone, „Pokazuj innym, że oglądam …” (dodatek D-9) wyłączone. */
export interface MailPrefs { postep: boolean; po_posiedzeniu: boolean; showPresence: boolean }
export type EmailState = 'brak' | 'niepotwierdzony' | 'potwierdzony';
/** Kontakt konta: tylko serwer i wersja próbna, nigdy sesja innych osób ani widok posiedzenia (DB-19). */
export interface AccountContact { accountId: string; personId: string | null; name: string; kind: AccountKind; email: string | null; emailState: EmailState; prefs: MailPrefs }
export interface MailRecipientRow { accountId: string; name: string; state: 'wysle' | 'brak_adresu' | 'niepotwierdzony' | 'wylaczone' }
