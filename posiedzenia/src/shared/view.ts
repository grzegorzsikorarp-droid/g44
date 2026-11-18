import type {Actor, Ballot, Choice, Meeting} from './types.ts';

// Widok dla osoby: w trakcie głosowania nikt nie widzi cudzych głosów; po zamknięciu
// nazwiska z wyborami są jawne tylko w głosowaniu imiennym.
export function viewFor(m: Meeting, actor: Actor) {
  const v = structuredClone(m) as Meeting & {ballots: (Ballot & {voted: string[]; myVote?: Choice})[]};
  for (const b of v.ballots) {
    b.voted = b.secret ? [...b.secret.issued] : Object.keys(b.votes);
    if (actor.personId && !b.secret && b.votes[actor.personId]) b.myVote = b.votes[actor.personId];
    if (b.status === 'otwarte' || b.mode !== 'imienne') b.votes = {};
  }
  return v;
}

export function summary(m: Meeting) {
  const open = m.ballots.filter(b => b.status === 'otwarte');
  return {
    id: m.id, organ: m.organ, kind: m.kind, title: m.title, date: m.date, time: m.time, place: m.place, mode: m.mode,
    status: m.status, endsAt: m.endsAt ?? null, openBallots: open.length, ballots: m.ballots.length,
    current: m.agenda.find(i => i.id === m.currentItemId)?.title ?? null, revision: m.revision,
  };
}
