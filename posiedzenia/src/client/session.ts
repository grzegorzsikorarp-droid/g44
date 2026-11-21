import {createContext} from 'preact';
import {useCallback, useContext, useEffect, useState} from 'preact/hooks';
import type {Account, OrganCode, Roster} from '../shared/types.ts';
import type {EmailState, MailPrefs} from '../shared/mail.ts';
import type {AvatarMap} from './avatar-store.ts';
import {membership, personName} from '../shared/roster.ts';
import {canCreate} from '../shared/role.ts';
import {request} from './api.ts';

/**
 * Sesja w kliencie. Wersja 4 (SPEC-4 2.5): `avatars` (mapa zdjęć tylko dla kręgu z pytania 13, inaczej `null`),
 * `photoCircle` (tekst kręgu do karty „Zdjęcie”), `can` (pozycje nawigacji z role.ts), `mail` (tylko osoby, które wysyłają
 * wiadomości), `home` (strona startowa konta „Komunikacja”). Pola są nieobowiązkowe, bo sesja wersji 3 ich nie ma.
 * Adresu e-mail i preferencji w sesji nie ma; zwraca je tylko `GET /api/me` (`useMe`).
 */
export interface SessionCan { ownStats: boolean; rosterStats: boolean; report: boolean; catalog: boolean }
export interface Session {
  account: Account; roster: Roster;
  avatars?: AvatarMap | null; photoCircle?: string; can?: SessionCan; mail?: {enabled: boolean}; home?: string;
}
export const SessionContext = createContext<Session | null>(null);
const NO_CAN: SessionCan = {ownStats: false, rosterStats: false, report: false, catalog: false};
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('Brak sesji.');
  const {account, roster} = session;
  const personId = account.personId;
  const ms = (organ: string) => membership(roster, organ, personId);
  return {
    account, roster, personId,
    name: personId ? personName(roster, personId) : account.displayName,
    membership: ms,
    canChair: (organ: string) => !!ms(organ)?.canChair,
    isMember: (organ: string) => !!ms(organ),
    /** Wersja 3: tworzy i przygotowuje posiedzenia (canCreate z role.ts): biuro, przewodniczący, wiceprzewodniczący; bez flagi administratora. */
    isOrganizer: (organ: string) => canCreate(roster, organ as OrganCode, {account, personId, name: personId ? personName(roster, personId) : account.displayName}),
    personName: (id: string | null | undefined) => personName(roster, id),
    // Wersja 4 (2.5).
    avatars: session.avatars ?? null,
    photoCircle: session.photoCircle ?? '',
    can: session.can ?? NO_CAN,
    mail: session.mail ?? null,
    home: session.home ?? null,
    /** Klucz zdjęcia tej osoby: identyfikator osoby ze składu, a bez osoby identyfikator konta (2.5). */
    avatarKey: personId ?? account.id,
  };
}

/** Odpowiedź `GET /api/me` (6.2, DB-19). */
export interface Me {
  email: string | null; emailState: EmailState; emailConfirmedAt: number | null; emailConfirmedBy: 'kod' | 'administrator' | null; pendingEmail: string | null;
  prefs: MailPrefs; avatar: number; avatarScreen: boolean; avatarRemoved: Account['avatarRemoved'] | null; mailEnabled: boolean;
  /** Adres informacji o przetwarzaniu danych z ustawień poczty (E-1, K4-30); brak przy pustym albo bez https. */
  privacyUrl?: string | null;
}
/**
 * „Moje konto” (K4-22): `GET /api/me` raz przy wejściu na stronę `#konto` i ponownie tylko po zapisie (`reload`),
 * bez odpytywania. Inne ekrany go nie wołają, więc w trakcie głosowania nie ma takich zapytań (T-2).
 */
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => request<Me>('/api/me').then(value => { setError(''); setMe(value); return value; }).catch(e => { setError((e as Error).message); return null; }), []);
  useEffect(() => { reload(); }, [reload]);
  return {me, error, reload, replace: setMe};
}
