import type {Actor, Ballot, Choice, Meeting, Roster} from './types.ts';
import {hideTally, itemNumber, unannounced} from './rules.ts';
import {cleanTitle} from './agenda.ts';
import {canAnnounce, canDownloadComms, canEditComms, canPrepare, canSeeWorkspace, isPresiding, procedureStarter, seesLog, seesPhotosLink} from './role.ts';
import {effectiveMeeting, type CascadeEnv, type MeetingEffective} from './cascade.ts';
import type {Adoption, ProtocolState} from './catalog.ts';
import type {PrepView} from './workspace.ts';

/**
 * Kto widzi wynik zamkniętego głosowania przed jego ogłoszeniem (Z5, DA-3): tylko osoba, która go ogłasza. Na posiedzeniu
 * osoba prowadząca obrady, a w głosowaniu między posiedzeniami osoba, która je rozpoczęła, i przewodniczący. Biuro
 * i administrator nie widzą wyniku przed ogłoszeniem. Bez składu (`roster`) w głosowaniu między posiedzeniami liczy się
 * tylko osoba, która je rozpoczęła.
 */
export function seesUnannounced(m: Meeting, actor: Actor, roster?: Roster) {
  if (roster) return canAnnounce(roster, m, actor);
  return m.kind === 'procedura' ? !!actor.personId && procedureStarter(m) === actor.personId : isPresiding(m, actor);
}

export type ViewBallotFields = {voted: string[]; myVote?: Choice; resultHidden?: boolean};
/**
 * Wersja 4 (SPEC-4 2.1): dane zakończonego posiedzenia liczone z listy posiedzeń (serwer i wersja próbna): przyjęcie
 * protokołu, stan protokołu, chwila zmiany materiału dla komunikacji, uwaga o starych wiadomościach (DB-15), stan
 * udostępnienia (DB-42) i wiersze „Do sprawdzenia” (G-38, K4-7).
 */
export interface ArchiveInfo {
  adoption: Adoption | null; protocol: ProtocolState;
  commsChangedAt: number | null; legacyPrepMessages?: true;
  commsRelease?: 'brak' | 'udostepniony' | 'zmieniony';
  checks?: string[];
}
/** Posiedzenie w widoku osoby: głosowania z polami widoku (lista głosujących, własny głos, ukryty wynik). */
export type MeetingView = Omit<Meeting, 'ballots'> & {ballots: (Ballot & ViewBallotFields)[]; effective?: MeetingEffective;
  /** Wersja 4: przestrzeń robocza tylko w przygotowaniu i tylko dla `canSeeWorkspace` (T-5, S-25). */
  prep?: PrepView | null;
  /** Wersja 4: tylko posiedzenie zakończone (DB-5). */
  archive?: ArchiveInfo};

// Widok dla osoby: w trakcie głosowania nikt nie widzi cudzych głosów; po zamknięciu nazwiska z wyborami są jawne
// tylko w głosowaniu imiennym. Do ogłoszenia wyniku (F2) wynik, wykaz imienny i liczby we wpisie dziennika widzi
// tylko osoba, która go ogłasza (seesUnannounced); pozostali dostają `resultHidden: true` bez `result`.
// Wersja 3: z `env` widok dołącza wartości skuteczne (`effective`); przegląd przed otwarciem tylko dla canPrepare.
// `effective` nie zawiera głosów ani wyników, więc nie ujawnia niczego przed ogłoszeniem.
export function viewFor(m: Meeting, actor: Actor, roster?: Roster, env?: CascadeEnv, extra?: {prep?: PrepView | null; archive?: ArchiveInfo}): MeetingView {
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
      entry.text = hideTally(entry, hidden, m.ballots);
    }
  }
  // DA-10 (macierz 4.3): jawny przebieg obrad widzą biuro i członkowie. Osoby z głosem doradczym i goście dostają tylko
  // wpisy o zmianach projektu porządku obrad, z których widok liczy „zmieniono o {godz.}” (projekt na żywo, D2).
  if (!seesLog(actor)) v.log = v.log.filter(l => l.tag === 'projekt');
  if (env) {
    v.effective = effectiveMeeting(env, m, {review: m.status === 'przygotowanie' && canPrepare(env.roster, m, actor)});
    if (!seesLog(actor)) v.effective.deviations = [];
  }
  // Wersja 4 (SPEC-4 2.1, tabela „Co viewFor usuwa”). Odnośnik do albumu: bez gości i osób z głosem doradczym (DB-38).
  const r = roster ?? env?.roster;
  if (v.photos && !(r && seesPhotosLink(r, m, actor))) delete v.photos;
  // Dokumenty protokołu (B1-04): bez osób z głosem doradczym i gości.
  if (actor.account.kind === 'doradczy' || actor.account.kind === 'gosc') { delete v.filed; delete v.minutesReady; }
  // Materiał dla komunikacji (B1-28, DB-41–DB-43): tylko osoby, które go edytują albo pobierają.
  if (!(r && (canEditComms(r, m, actor) || canDownloadComms(r, m, actor)))) {
    for (const it of v.agenda) delete it.comms;
    delete v.closedComms; delete v.commsNote; delete v.commsInputs; delete v.commsReleased;
  }
  // Przestrzeń robocza tylko w przygotowaniu (T-5: w „trwa” i „przerwa” odpowiedź bez niej), dane zamkniętego posiedzenia tylko po zamknięciu.
  if (extra?.prep !== undefined && m.status === 'przygotowanie' && r && canSeeWorkspace(r, m, actor)) v.prep = extra.prep;
  if (extra?.archive && m.status === 'zakonczone') v.archive = extra.archive;
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
    working: !!m.working, protocolNumber: m.protocolNumber ?? null,
  };
}
