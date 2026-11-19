import {createContext} from 'preact';
import {useContext} from 'preact/hooks';
import type {Account, Roster} from '../shared/types.ts';
import {membership, personName} from '../shared/roster.ts';

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
    isOrganizer: (organ: string) => account.admin || account.kind === 'biuro' || !!ms(organ)?.canChair,
    personName: (id: string | null | undefined) => personName(roster, id),
  };
}
