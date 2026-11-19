import {createContext} from 'preact';
import {useContext} from 'preact/hooks';
import type {Command} from '../shared/meeting.ts';
import type {Ballot, Choice, Meeting} from '../shared/types.ts';

/** Głosowanie w widoku osoby. `resultHidden`: wynik zamkniętego głosowania jeszcze nieogłoszony (F2), bez `result`. */
export type ViewBallot = Ballot & {voted: string[]; myVote?: Choice; resultHidden?: boolean};
export type ViewMeeting = Omit<Meeting, 'ballots'> & {ballots: ViewBallot[]};

export interface MeetingContext {
  m: ViewMeeting;
  send: (cmd: Command) => Promise<ViewMeeting | undefined>;
  busy: boolean;
  replace: (data: {meeting: ViewMeeting}) => void;
  reload: () => void;
}
export const MeetingCtx = createContext<MeetingContext | null>(null);
export function useMeeting() {
  const ctx = useContext(MeetingCtx);
  if (!ctx) throw new Error('Brak posiedzenia.');
  return ctx;
}
