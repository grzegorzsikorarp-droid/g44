import type {Actor, Ballot, Choice, Meeting, Roster} from './types.ts';
import {itemNumber, unannounced} from './rules.ts';
import {membership} from './roster.ts';
import {cleanTitle} from './agenda.ts';

/**
 * Kto widzi wynik zamkniętego głosowania przed jego ogłoszeniem (F2): na posiedzeniu osoba prowadząca obrady i konto
 * biura, a w głosowaniu między posiedzeniami osoby, które mogą ogłosić wynik (przewodniczący, wiceprzewodniczący, biuro,
 * administrator). Bez składu (`roster`) w głosowaniu między posiedzeniami liczy się osoba, która je rozpoczęła.
 */
export function seesUnannounced(m: Meeting, actor: Actor, roster?: Roster) {
  if (actor.account.kind === 'biuro') return true;
  if (m.kind === 'procedura') {
    if (actor.account.admin) return true;
    if (roster) return !!membership(roster, m.organ, actor.personId)?.canChair;
  }
  return !!actor.personId && m.chair.current === actor.personId;
}

export type ViewBallotFields = {voted: string[]; myVote?: Choice; resultHidden?: boolean};
/** Posiedzenie w widoku osoby: głosowania z polami widoku (lista głosujących, własny głos, ukryty wynik). */
export type MeetingView = Omit<Meeting, 'ballots'> & {ballots: (Ballot & ViewBallotFields)[]};

// Widok dla osoby: w trakcie głosowania nikt nie widzi cudzych głosów; po zamknięciu nazwiska z wyborami są jawne
// tylko w głosowaniu imiennym. Do ogłoszenia wyniku (F2) wynik, wykaz imienny i liczby we wpisie dziennika widzi
// tylko osoba prowadząca obrady i biuro (seesUnannounced); pozostali dostają `resultHidden: true` bez `result`.
export function viewFor(m: Meeting, actor: Actor, roster?: Roster): MeetingView {
  const v = structuredClone(m) as MeetingView;
  const hidden = seesUnannounced(m, actor, roster) ? new Set<string>() : new Set(unannounced(m).map(b => b.id));
  for (const b of v.ballots) {
    b.voted = b.secret ? [...b.secret.issued] : b.aborted?.voters ? [...b.aborted.voters] : Object.keys(b.votes);
    if (actor.personId && !b.secret && !b.aborted && b.votes[actor.personId]) b.myVote = b.votes[actor.personId];
    // F7: głosowanie przerwane bez rozstrzygnięcia nie ujawnia wyborów, także imienne.
    if (b.status === 'otwarte' || b.mode !== 'imienne' || b.aborted) b.votes = {};
    if (hidden.has(b.id)) {
      delete b.result; b.votes = {}; b.resultHidden = true;
      if (!b.outcomePending) hideOutcome(v, b);
    }
  }
  if (hidden.size) {
    for (const entry of v.log) {
      if (entry.ballotId && hidden.has(entry.ballotId)) entry.text = entry.text.replace(/ Za \d+, przeciw \d+, wstrzymało się \d+\.$/, '');
    }
  }
  return v;
}

/**
 * F2, dane sprzed poprawki: głosowanie zamknięte bez ogłoszenia wyniku ma już zapisany skutek rozstrzygnięcia (nowe
 * głosowania dostają go dopiero przy ogłoszeniu). Widok osoby, która nie widzi wyniku, cofa ten skutek: porządek
 * nieprzyjęty i punkt „Przyjęcie porządku obrad” w toku, punkt bez uchwalonego trybu, wniosek o reasumpcję
 * w głosowaniu, wynik pierwotnego głosowania niezastąpiony, a punkt dodany zmianą porządku niewidoczny.
 */
function hideOutcome(v: MeetingView, b: Ballot) {
  if (b.purpose === 'porzadek') {
    v.agendaAdopted = false;
    const point = v.agenda.find(i => i.kind === 'porzadek');
    if (point?.status === 'zakonczony') { point.status = 'w_toku'; delete point.endedAt; }
  }
  const target = b.target;
  if (target?.kind === 'tryb') {
    const it = v.agenda.find(i => i.id === target.itemId);
    if (it?.modeBasis?.endsWith(`w głosowaniu nr ${b.number}`)) { delete it.mode; delete it.modeBasis; }
  }
  if (target?.kind === 'reasumpcja') {
    const motion = v.motions.find(x => x.id === target.motionId);
    if (motion && (motion.status === 'przyjety' || motion.status === 'odrzucony')) motion.status = 'glosowany';
  }
  if (target?.kind === 'zmiana_porzadku' && target.change.op === 'dodaj') {
    const title = cleanTitle(target.change.title);
    const added = [...v.agenda].reverse().find(i => i.addedAfterAdoption && i.status === 'oczekuje' && i.title === title);
    if (added) v.agenda = v.agenda.filter(i => i.id !== added.id && i.parentId !== added.id);
  }
  if (b.reasumptionOf) {
    const original = v.ballots.find(x => x.id === b.reasumptionOf);
    if (original?.supersededBy === b.id) delete original.supersededBy;
  }
}

// Wiersz listy posiedzeń. `currentNumber` to numer bieżącego punktu (np. „4.1”). `ballots` nie liczy głosowań
// próbnych, `working` oznacza spotkanie robocze (F5).
export function summary(m: Meeting) {
  const open = m.ballots.filter(b => b.status === 'otwarte');
  const current = m.agenda.find(i => i.id === m.currentItemId);
  return {
    id: m.id, organ: m.organ, kind: m.kind, title: m.title, date: m.date, time: m.time, place: m.place, mode: m.mode,
    status: m.status, endsAt: m.endsAt ?? null, openBallots: open.length, ballots: m.ballots.filter(b => b.purpose !== 'proba').length,
    current: current?.title ?? null, currentNumber: current ? itemNumber(m.agenda, current.id) : null, revision: m.revision,
    working: !!m.working,
  };
}
