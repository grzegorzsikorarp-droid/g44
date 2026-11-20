import type {Meeting, OrganCode, Roster} from './types.ts';
import {organRoster} from './role.ts';
import {isoDayOf} from './text.ts';

// Frekwencja dla katalogu odbytych posiedzeń i zestawienia za okres (SPEC-4 DB-24, B4-07, T-6). Osobny moduł bez importu
// `stats.ts`, żeby katalog i karty dokumentów nie wnosiły modułu statystyk (kontrola k pkt 7). Jedna definicja: obecni
// w którejkolwiek chwili obrad (potwierdzona obecność, B4-06) wobec składu zapisanego przy otwarciu; w głosowaniu między
// posiedzeniami osoby, które oddały głos albo pobrały kartę, wobec uprawnionych. Z głosowania tajnego czyta tylko
// `secret.issued` jako zbiór.

export interface Turnout { present: number; members: number }
/** Frekwencja jednego zakończonego posiedzenia albo głosowania między posiedzeniami („Obecnych 6 z 7”). */
export function meetingTurnout(m: Meeting, roster: Roster): Turnout {
  if (m.kind === 'procedura') {
    const eligible = new Set<string>(), took = new Set<string>();
    for (const b of m.ballots) {
      if (b.purpose === 'proba' || b.aborted) continue;
      for (const id of b.eligible) eligible.add(id);
      for (const id of b.mode === 'tajne' ? b.secret?.issued ?? [] : Object.keys(b.votes)) took.add(id);
    }
    return {present: [...took].filter(id => eligible.has(id)).length, members: eligible.size};
  }
  const members = organRoster(roster, m);
  const arrived = new Set(m.presenceLog.filter(e => !e.guest && e.type === 'przybycie').map(e => e.who));
  return {present: members.filter(ms => arrived.has(ms.personId)).length, members: members.length};
}
/** Procent zaokrąglony do całości; bez mianownika `null` (w interfejsie „–”). */
export const turnoutPercent = (t: Turnout) => t.members ? Math.round(100 * t.present / t.members) : null;
/**
 * Frekwencja składu w okresie (B4-07, B1-30): suma obecnych wobec sumy miejsc w składach zakończonych posiedzeń (bez
 * głosowań między posiedzeniami), dni RRRR-MM-DD włącznie według dnia otwarcia.
 */
export function periodTurnout(meetings: Meeting[], roster: Roster, range: {from: string; to: string}, organ: OrganCode = 'prezydium'): {present: number; seats: number; meetings: number} {
  let present = 0, seats = 0, count = 0;
  for (const m of meetings) {
    if (m.organ !== organ || m.kind !== 'posiedzenie' || m.status !== 'zakonczone' || !m.openedAt) continue;
    const day = isoDayOf(m.openedAt);
    if (day < range.from || day > range.to) continue;
    const t = meetingTurnout(m, roster);
    present += t.present; seats += t.members; count++;
  }
  return {present, seats, meetings: count};
}
