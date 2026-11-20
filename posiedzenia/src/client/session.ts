import {createContext} from 'preact';
import {useContext} from 'preact/hooks';
import type {Account, OrganCode, Roster} from '../shared/types.ts';
import {membership, personName} from '../shared/roster.ts';
import {canCreate} from '../shared/role.ts';

export interface Session { account: Account; roster: Roster }
export const SessionContext = createContext<Session | null>(null);
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
  };
}
