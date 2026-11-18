import {createMeeting, type Context, type SecretHooks} from '../src/shared/meeting.ts';
import {seedRoster} from '../src/shared/roster.ts';
import type {Account, Actor, Choice} from '../src/shared/types.ts';

export const roster = seedRoster;
export const presidium = ['si', 'ag', 'jw', 'kn', 'az', 'eo', 'ak'];

export function actor(personId: string | null, kind: Account['kind'] = 'czlonek', admin = false): Actor {
  const name = roster.persons.find(p => p.id === personId)?.name ?? 'Biuro Izby';
  return {account: {id: 'u-' + (personId ?? kind), username: personId ?? kind, kind, personId, displayName: name, label: '', admin, mustChange: false, disabled: false}, personId, name};
}

export function context(start = Date.parse('2026-11-20T10:00:00Z')) {
  let now = start, seq = 0;
  const secretVotes = new Map<string, Choice[]>();
  const secret: SecretHooks = {
    openKey: () => ({n: 'ab'.repeat(128), e: '010001', fingerprint: 'TEST-TEST-TEST-TEST'}),
    tally: id => {
      const list = secretVotes.get(id) ?? [];
      return {za: list.filter(c => c === 'za').length, przeciw: list.filter(c => c === 'przeciw').length, wstrzymuje: list.filter(c => c === 'wstrzymuje').length};
    },
    closeKey: () => {},
  };
  const ctx: Context & {tick: (ms?: number) => Context; castSecret: (ballotId: string, c: Choice) => void} = {
    roster, get now() { return now; }, newId: () => 'id' + (++seq), secret,
    tick(ms = 1000) { now += ms; return ctx; },
    castSecret(ballotId, c) { secretVotes.set(ballotId, [...(secretVotes.get(ballotId) ?? []), c]); },
  };
  return ctx;
}

export function newMeeting(ctx: ReturnType<typeof context>, kind: 'posiedzenie' | 'procedura' = 'posiedzenie') {
  return createMeeting({id: 'm1', organ: 'prezydium', kind, title: kind === 'posiedzenie' ? 'Posiedzenie Prezydium ORPiP' : 'Głosowanie między posiedzeniami', date: '2026-11-20', time: '10:00', place: 'Słupsk, ul. Poniatowskiego 4', mode: 'stacjonarne', createdBy: 'Biuro', now: ctx.now, newId: ctx.newId});
}
