import type {Roster} from './types.ts';

// Pomocnicze funkcje składu. Dane IX kadencji są w src/server/seed.ts (tylko serwer).
export const organMembers = (roster: Roster, organ: string) =>
  roster.memberships.filter(m => m.organ === organ).sort((a, b) => a.order - b.order);
export const membership = (roster: Roster, organ: string, personId: string | null) =>
  personId ? roster.memberships.find(m => m.organ === organ && m.personId === personId) : undefined;
export const personName = (roster: Roster, personId: string | null | undefined) =>
  roster.persons.find(p => p.id === personId)?.name ?? (personId || '—');
export const organOf = (roster: Roster, code: string) => roster.organs.find(o => o.code === code);
