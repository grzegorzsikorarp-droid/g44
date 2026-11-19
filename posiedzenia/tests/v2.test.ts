import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance, apply, duplicateMeeting, secretCast, secretIssue} from '../src/shared/meeting.ts';
import {ballotTitle, needsVote, pendingPresence, presentMembers, resultLabel, unannounced, unhandledItems} from '../src/shared/rules.ts';
import {defaultDocTypes, docTypeInput} from '../src/shared/doctypes.ts';
import {migrateMeeting} from '../src/shared/migrate.ts';
import {viewFor} from '../src/shared/view.ts';
import {guessType} from '../src/server/documents.ts';
import type {Ballot, MaterialRef, Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium, roster} from './helpers.ts';

// Reguły wersji 2 (specyfikacja /home/user/przeglad/SPEC-2.md, funkcje F1–F14).

type Ctx = ReturnType<typeof context>;
const chair = actor('si');
const office = actor(null, 'biuro', true);
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
const last = (m: Meeting) => m.ballots.at(-1)!;

/** Posiedzenie otwarte, obecność zgłoszona przez członków i potwierdzona przez prowadzącego. */
function opened(present = presidium, quorum = true) {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, chair, ctx);
  for (const p of present.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  if (present.length > 1) m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  if (quorum) m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  return {ctx, m};
}
function voteAll(m: Meeting, ctx: Ctx, choice: 'za' | 'przeciw' = 'za') {
  const id = last(m).id;
  for (const p of last(m).eligible) m = apply(m, {type: 'vote', ballotId: id, choice}, actor(p), ctx.tick());
  return m;
}
const announce = (m: Meeting, ctx: Ctx, id = last(m).id) => apply(m, {type: 'announce', ballotId: id}, chair, ctx.tick());
function adopted() {
  const {ctx, m: start} = opened();
  let m = apply(start, {type: 'item_start', itemId: item(start, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  return {ctx, m: announce(voteAll(m, ctx), ctx)};
}
/** Posiedzenie z podpunktem „Uchwała nr 108” w punkcie „Podjęcie uchwał”. */
function withResolution() {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026 w sprawie patronatu', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  return {ctx, m};
}
const material = (m: Meeting, id: string, type: string, title: string): Meeting => {
  const ref: MaterialRef = {id, title, type, number: '', version: 1, hash: 'x', size: 1, fileId: null, fileName: null, createdAt: 0};
  return {...m, materials: [...m.materials, ref]};
};

test('F1: głosowanie próbne bez numeru, przed kworum i porządkiem, nie wymaga ogłoszenia i nie podlega reasumpcji', () => {
  let {ctx, m} = opened(presidium, false);
  m = apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode: 'jawne', minutes: 1}, chair, ctx.tick());
  const trial = last(m);
  assert.equal(trial.number, 0);
  assert.equal(trial.subject, 'Głosowanie próbne');
  assert.equal(ballotTitle(trial), 'Głosowanie próbne');
  assert.equal(trial.endsAt - trial.openedAt, 60000);
  assert.equal(trial.eligible.length, 7);
  m = voteAll(m, ctx);
  assert.equal(last(m).status, 'zamkniete');
  assert.equal(resultLabel(last(m)), 'Głosowanie próbne zakończone');
  assert.deepEqual(unannounced(m), []);
  assert.ok(viewFor(m, actor('kn')).ballots.at(-1)!.result, 'wynik próby widzą wszyscy od razu');
  assert.throws(() => apply(m, {type: 'motion_create', ballotId: trial.id, justification: 'Wątpliwość co do wyniku próby.'}, actor('ag'), ctx), /nie można poddać reasumpcji/);
  // Kolejne głosowanie w sprawie dostaje numer 1, bo próba się nie liczy.
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  assert.equal(last(m).number, 1);
});

test('F1: próbne głosowanie tajne idzie tą samą drogą kart i nie blokuje rozpoczęcia punktu', () => {
  let {ctx, m} = opened();
  m = apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: 'Głosowanie próbne', mode: 'tajne', minutes: 1}, chair, ctx.tick());
  const trial = last(m);
  assert.ok(trial.secret);
  assert.throws(() => apply(m, {type: 'vote', ballotId: trial.id, choice: 'za'}, actor('ag'), ctx), /kartą tajną/);
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  assert.equal(m.currentItemId, item(m, 'porzadek').id);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Porządek', mode: 'jawne', minutes: 2}, chair, ctx), /Trwa inne głosowanie/);
  for (const p of presidium) {
    m = secretIssue(m, trial.id, actor(p), ctx.tick());
    ctx.castSecret(trial.id, 'za');
    m = secretCast(m, trial.id, ctx.tick());
  }
  assert.equal(last(m).status, 'zamkniete');
  assert.deepEqual(last(m).votes, {});
  assert.equal(last(m).result!.za, 7);
});

test('F2: bez ogłoszenia wyniku domena wstrzymuje obrady, a członek nie widzi wyniku', () => {
  let {ctx, m} = adopted();
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_start', itemId: it.id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'protokol', subject: 'Przyjęcie protokołu', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  const b = last(m);
  assert.deepEqual(unannounced(m).map(x => x.number), [2]);
  const refused = /Najpierw ogłoś wynik głosowania nr 2\./;
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode: 'jawne', minutes: 1}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'wniosek', subject: 'Wniosek o poprawkę', mode: 'jawne', minutes: 1}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'item_start', itemId: item(m, 'sprawozdania').id}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'item_end', itemId: it.id, status: 'zakonczony'}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'break', on: true}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'close', reason: 'Koniec czasu.'}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'mode_motion', itemId: it.id, mode: 'tajne', minutes: 1, proposedBy: 'ag'}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'Patronat', parentId: null, afterId: null}, minutes: 1}, chair, ctx), refused);
  // Widok: wynik, wykaz i liczby w dzienniku widzi tylko prowadzący i biuro.
  const member = viewFor(m, actor('kn'), roster).ballots.find(x => x.id === b.id)!;
  assert.equal(member.result, undefined);
  assert.equal(member.resultHidden, true);
  assert.equal(resultLabel(member), 'Wynik ogłosi osoba prowadząca obrady');
  assert.doesNotMatch(viewFor(m, actor('kn'), roster).log.find(e => e.ballotId === b.id)!.text, /Za \d/);
  assert.ok(viewFor(m, chair, roster).ballots.find(x => x.id === b.id)!.result);
  assert.ok(viewFor(m, office, roster).ballots.find(x => x.id === b.id)!.result);
  m = announce(m, ctx, b.id);
  assert.equal(viewFor(m, actor('kn'), roster).ballots.find(x => x.id === b.id)!.result!.za, 7);
  m = apply(m, {type: 'item_end', itemId: it.id, status: 'zakonczony'}, chair, ctx.tick());
  assert.equal(m.agenda.find(i => i.id === it.id)!.status, 'zakonczony');
});

test('F2: wynik głosowania między posiedzeniami członek widzi po ogłoszeniu', () => {
  const ctx = context();
  let m = newMeeting(ctx, 'procedura');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu'}, office, ctx.tick());
  m = apply(m, {type: 'details', endsAt: ctx.now + 3 * 3600000}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  m = voteAll(m, ctx);
  assert.equal(m.status, 'zakonczone');
  assert.equal(viewFor(m, actor('kn'), roster).ballots[0].result, undefined);
  assert.ok(viewFor(m, actor('ag'), roster).ballots[0].result, 'wiceprzewodnicząca może ogłosić wynik, więc go widzi');
  m = apply(m, {type: 'announce', ballotId: m.ballots[0].id}, actor('ag'), ctx.tick());
  assert.equal(viewFor(m, actor('kn'), roster).ballots[0].result!.adopted, true);
});

test('F3: po uchwaleniu tajności głosowanie jawne w tej sprawie jest odrzucane, wniosek o poprawkę nie', () => {
  let {ctx, m} = adopted();
  const it = item(m, 'uchwaly');
  m = apply(m, {type: 'item_start', itemId: it.id, reason: 'Kolejność ustalona na początku posiedzenia.'}, chair, ctx.tick());
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'tajne', minutes: 2, proposedBy: 'kn'}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 108', mode: 'jawne', minutes: 2}, chair, ctx),
    /Prezydium uchwaliło w tej sprawie głosowanie tajne \(§ 11\)\. Otwórz głosowanie w tym trybie\./);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 108', mode: 'imienne', minutes: 2}, chair, ctx), /uchwaliło w tej sprawie głosowanie tajne/);
  const amendment = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'wniosek', subject: 'Wniosek o poprawkę w § 1', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  assert.equal(last(amendment).mode, 'jawne');
  const secret = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 108', mode: 'tajne', minutes: 2}, chair, ctx.tick());
  assert.equal(last(secret).mode, 'tajne');
});

test('F4: rozpoczęcie poza kolejnością, odroczenie i wycofanie wymagają powodu do protokołu', () => {
  let {ctx, m} = adopted();
  const reports = item(m, 'sprawozdania');
  assert.throws(() => apply(m, {type: 'item_start', itemId: reports.id}, chair, ctx), /Podaj powód rozpoczęcia punktu poza kolejnością przyjętego porządku obrad\./);
  m = apply(m, {type: 'item_start', itemId: reports.id, reason: 'nieobecność osoby referującej punkt 3'}, chair, ctx.tick());
  const started = m.agenda.find(i => i.id === reports.id)!;
  assert.equal(started.outOfOrder!.reason, 'nieobecność osoby referującej punkt 3');
  assert.equal(started.outOfOrder!.by, 'Sebastian Irzykowski');
  assert.match(m.log.at(-1)!.text, /poza kolejnością przyjętego porządku obrad\. Powód „nieobecność osoby referującej punkt 3”\./);
  const protocol = item(m, 'protokol');
  assert.throws(() => apply(m, {type: 'item_end', itemId: protocol.id, status: 'odroczony'}, chair, ctx), /Podaj powód odroczenia punktu\./);
  assert.throws(() => apply(m, {type: 'item_end', itemId: protocol.id, status: 'wycofany', reason: '  '}, chair, ctx), /Podaj powód wycofania punktu\./);
  m = apply(m, {type: 'item_end', itemId: protocol.id, status: 'odroczony', reason: 'protokół nie jest gotowy'}, chair, ctx.tick());
  assert.equal(m.agenda.find(i => i.id === protocol.id)!.statusReason, 'protokół nie jest gotowy');
  // Zamknięcie z nierozpatrzonymi punktami: powód trafia do każdego z nich.
  const left = unhandledItems(m);
  assert.ok(left.length >= 2);
  assert.throws(() => apply(m, {type: 'close'}, chair, ctx), /Podaj powód zamknięcia posiedzenia przed rozpatrzeniem wszystkich punktów\./);
  m = apply(m, {type: 'close', reason: 'koniec czasu na sali'}, chair, ctx.tick());
  for (const it of left) assert.equal(m.agenda.find(i => i.id === it.id)!.statusReason, 'koniec czasu na sali');
  assert.match(m.log.at(-1)!.text, /^Zamknięcie posiedzenia\. Nie rozpatrzono punktów .+\. Powód „koniec czasu na sali”\.$/);
});

test('F5: bez kworum punkt się nie rozpocznie; spotkanie robocze do końca bez głosowań poza próbnym', () => {
  let {ctx, m} = opened(['si', 'ag', 'jw'], false);
  const point = item(m, 'porzadek');
  assert.throws(() => apply(m, {type: 'item_start', itemId: point.id}, chair, ctx), /Nie stwierdzono kworum\. Stwierdź kworum albo kontynuuj jako spotkanie robocze\./);
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'item_start', itemId: point.id}, chair, ctx), /Nie stwierdzono kworum/);
  m = apply(m, {type: 'working_start', reason: 'brak_kworum'}, chair, ctx.tick());
  assert.deepEqual(m.working, {at: ctx.now, by: 'Sebastian Irzykowski', reason: 'brak_kworum'});
  assert.throws(() => apply(m, {type: 'working_start', reason: 'brak_kworum'}, chair, ctx), /już spotkaniem roboczym/);
  // Punkty można rozpoczynać bez przyjętego porządku.
  m = apply(m, {type: 'item_start', itemId: item(m, 'sprawozdania').id}, chair, ctx.tick());
  const refused = /Na spotkaniu roboczym nie przeprowadza się głosowań\./;
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Porządek', mode: 'jawne', minutes: 2}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'mode_motion', itemId: point.id, mode: 'tajne', minutes: 2, proposedBy: 'ag'}, chair, ctx), refused);
  assert.throws(() => apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'X', parentId: null, afterId: null}, minutes: 2}, chair, ctx), refused);
  m = apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode: 'jawne', minutes: 1}, chair, ctx.tick());
  assert.equal(last(m).purpose, 'proba');
  m = voteAll(m, ctx);
  // Stwierdzenie kworum później niczego nie zmienia.
  for (const p of ['kn', 'az']) m = apply(m, {type: 'presence', who: p, present: true}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  assert.ok(m.working);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Porządek', mode: 'jawne', minutes: 2}, chair, ctx), refused);
});

test('F6: powielenie kopiuje dane, porządek bez punktów wycofanych i materiały z nowymi identyfikatorami', () => {
  const ctx = context();
  let m = material(newMeeting(ctx), 'mat-1', 'uchwala', 'Uchwała nr 108/IX/2026');
  m = apply(m, {type: 'details', link: 'https://spotkanie.example/abc', noticeDate: '2026-11-10', protocolNumber: '12/IX/2026', recorder: 'Anna Nowak'}, office, ctx.tick());
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true}, office, ctx.tick());
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const reports = item(m, 'sprawozdania');
  m = apply(m, {type: 'item_material', itemId: reports.id, materialId: 'mat-1', on: true}, office, ctx.tick());
  m = apply(m, {type: 'item_edit', itemId: reports.id, note: 'Notatka', presenters: [{name: 'Anna Nowak', role: 'Sekretarz', kind: 'referuje'}], docType: 'sprawozdanie'}, office, ctx.tick());
  // Stany z przebiegu posiedzenia ustawione wprost w danych testowych.
  m = structuredClone(m);
  Object.assign(item(m, 'wolne_wnioski'), {status: 'wycofany', statusReason: 'brak spraw'});
  Object.assign(item(m, 'sprawozdania'), {status: 'zakonczony', startedAt: 1, endedAt: 2, mode: 'tajne', modeBasis: 'uchwalone', outOfOrder: {reason: 'r', at: 1, by: 'x'}});
  const {meeting: copy, materialMap} = duplicateMeeting(m, {id: 'm2', now: ctx.now, newId: ctx.newId, createdBy: 'Biuro Izby'});
  assert.equal(copy.status, 'przygotowanie');
  assert.deepEqual([copy.kind, copy.title, copy.date, copy.time, copy.place, copy.mode, copy.link], [m.kind, m.title, m.date, m.time, m.place, m.mode, m.link]);
  assert.deepEqual(copy.invited, ['u-gosc']);
  assert.deepEqual([copy.chair.deputy, copy.chair.deputyBasis], ['ag', 'wyznaczenie przez przewodniczącego (§ 16)']);
  assert.equal(copy.noticeDate, '');
  assert.equal(copy.protocolNumber, undefined);
  assert.equal(copy.recorder, undefined);
  assert.ok(!copy.agenda.some(i => i.kind === 'wolne_wnioski'), 'punkt wycofany nie przechodzi');
  assert.ok(copy.agenda.every(i => i.status === 'oczekuje' && !i.note && !i.startedAt && !i.endedAt && !i.mode && !i.modeBasis && !i.statusReason && !i.outOfOrder));
  assert.ok(!copy.agenda.some(i => m.agenda.some(o => o.id === i.id)), 'nowe identyfikatory punktów');
  const copiedReports = copy.agenda.find(i => i.kind === 'sprawozdania')!;
  assert.deepEqual(copiedReports.presenters, [{name: 'Anna Nowak', role: 'Sekretarz', kind: 'referuje'}]);
  assert.equal(copiedReports.docType, 'sprawozdanie');
  assert.equal(copiedReports.materialIds[0], materialMap.get('mat-1'));
  assert.deepEqual(copy.materials.map(x => [x.id, x.title, x.type, x.version]), [[materialMap.get('mat-1'), 'Uchwała nr 108/IX/2026', 'uchwala', 1]]);
  assert.notEqual(materialMap.get('mat-1'), 'mat-1');
  const resolutions = copy.agenda.find(x => x.kind === 'uchwaly')!;
  assert.deepEqual(copy.agenda.filter(i => i.parentId === resolutions.id).map(i => i.title), ['Uchwała nr 108/IX/2026']);
  assert.ok(copy.ballots.length === 0 && copy.messages.length === 0 && !copy.openedAt);
  assert.deepEqual(copy.log.map(e => e.text), ['Utworzono przez powielenie posiedzenia z dnia 20.11.2026.']);
  // Głosowanie między posiedzeniami powiela się bez terminu.
  const procedure = {...newMeeting(ctx, 'procedura'), endsAt: ctx.now + 3600000};
  const copied = duplicateMeeting(procedure, {id: 'm3', now: ctx.now, newId: ctx.newId, createdBy: 'Biuro'}).meeting;
  assert.equal(copied.endsAt, undefined);
  assert.equal(copied.log[0].text, 'Utworzono przez powielenie głosowania między posiedzeniami z dnia 20.11.2026.');
});

function procedure() {
  const ctx = context();
  let m = newMeeting(ctx, 'procedura');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 121/IX/2026 w sprawie delegacji'}, office, ctx.tick());
  m = apply(m, {type: 'details', endsAt: ctx.now + 3 * 3600000}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  return {ctx, m};
}

test('F7: przerwanie głosowania między posiedzeniami bez rozstrzygnięcia, z powodem i bez wyniku', () => {
  let {ctx, m} = procedure();
  m = apply(m, {type: 'vote', ballotId: m.ballots[0].id, choice: 'za'}, actor('ag'), ctx.tick());
  assert.throws(() => apply(m, {type: 'procedure_end', how: 'przerwij'}, chair, ctx), /Podaj powód przerwania głosowania\./);
  assert.throws(() => apply(m, {type: 'procedure_end', how: 'przerwij', reason: 'błąd w projekcie'}, actor('kn'), ctx), /przewodniczący albo wiceprzewodniczący/);
  m = apply(m, {type: 'procedure_end', how: 'przerwij', reason: 'błąd w projekcie uchwały'}, actor('jw'), ctx.tick());
  assert.equal(m.status, 'zakonczone');
  assert.deepEqual(m.ended, {how: 'przerwij', reason: 'błąd w projekcie uchwały', at: ctx.now, by: 'Jolanta Woźniak'});
  for (const b of m.ballots) {
    assert.equal(b.status, 'zamkniete');
    assert.equal(b.result, undefined);
    assert.equal(b.aborted!.reason, 'błąd w projekcie uchwały');
    assert.equal(resultLabel(b), 'Głosowanie przerwane, rozstrzygnięcie nie zapadło');
  }
  assert.deepEqual(unannounced(m), [], 'przerwane nie wymaga ogłoszenia');
  // „Zakończ i policz głosy” liczy głosy jak dotychczasowe zakończenie przed terminem.
  let other = procedure();
  other.m = apply(other.m, {type: 'vote', ballotId: other.m.ballots[0].id, choice: 'za'}, actor('ag'), other.ctx.tick());
  other.m = apply(other.m, {type: 'procedure_end', how: 'policz'}, chair, other.ctx.tick());
  assert.equal(other.m.ballots[0].result!.za, 1);
  assert.equal(other.m.ballots[0].closeReason, 'prowadzacy');
  assert.equal(other.m.ended!.how, 'policz');
});

test('F7: zmiana terminu głosowania między posiedzeniami co najmniej 5 minut od teraz, z wiadomością w kanale', () => {
  let {ctx, m} = procedure();
  assert.throws(() => apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 4 * 60000}, chair, ctx), /Ustaw nowy termin co najmniej 5 minut od teraz\./);
  const before = m.endsAt!;
  const later = Date.parse('2026-11-21T17:00:00Z');
  m = apply(m, {type: 'procedure_deadline', endsAt: later}, chair, ctx.tick());
  assert.equal(m.endsAt, later);
  assert.ok(m.ballots.every(b => b.endsAt === later));
  assert.deepEqual(m.deadlineChanges, [{at: ctx.now, from: before, to: later, by: 'Sebastian Irzykowski'}]);
  assert.equal(m.messages.at(-1)!.text, 'Termin głosowania zmieniono na 21 listopada 2026 r., godz. 18:00.');
  // Skrócenie terminu: po jego upływie głosowania się zamykają.
  m = apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 10 * 60000}, chair, ctx.tick());
  m = structuredClone(m);
  advance(m, ctx.tick(11 * 60000));
  assert.equal(m.status, 'zakonczone');
  assert.equal(m.deadlineChanges!.length, 2);
});

test('F8: projekt porządku układany kafelkami przed przyjęciem, zmiany w dzienniku', () => {
  let {ctx, m} = opened();
  const reports = item(m, 'sprawozdania'), resolutions = item(m, 'uchwaly'), protocol = item(m, 'protokol');
  m = apply(m, {type: 'item_place', itemId: reports.id, parentId: null, beforeId: protocol.id}, chair, ctx.tick());
  assert.deepEqual(m.agenda.filter(i => !i.parentId).map(i => i.kind).slice(0, 4), ['otwarcie', 'porzadek', 'sprawozdania', 'protokol']);
  assert.equal(m.log.at(-1)!.tag, 'projekt');
  assert.equal(m.log.at(-1)!.text, 'Zmieniono projekt porządku obrad. Punkt „Sprawy bieżące, w tym przyjęcie sprawozdań” przeniesiono z pozycji 4 na pozycję 3.');
  m = apply(m, {type: 'item_place', itemId: protocol.id, parentId: resolutions.id, beforeId: null}, chair, ctx.tick());
  assert.equal(m.agenda.find(i => i.id === protocol.id)!.parentId, resolutions.id);
  m = apply(m, {type: 'item_add', title: 'Patronat nad konferencją', parentId: null}, chair, ctx.tick());
  assert.match(m.log.at(-1)!.text, /^Zmieniono projekt porządku obrad\. Dodano punkt \d „Patronat nad konferencją”\.$/);
  assert.throws(() => apply(m, {type: 'item_place', itemId: reports.id, parentId: null, beforeId: item(m, 'otwarcie').id}, chair, ctx), /za punkt „Przyjęcie porządku obrad”/);
  assert.throws(() => apply(m, {type: 'item_place', itemId: resolutions.id, parentId: reports.id, beforeId: null}, chair, ctx), /Punkt z podpunktami nie może stać się podpunktem/);
  assert.throws(() => apply(m, {type: 'item_place', itemId: reports.id, parentId: null, beforeId: null}, actor('ag'), ctx), /osoba prowadząca obrady/);
  // Po przyjęciu porządku zmiana idzie przez głosowanie.
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  assert.throws(() => apply(m, {type: 'item_place', itemId: reports.id, parentId: null, beforeId: null}, chair, ctx), /Przyjęty porządek obrad zmienia się w głosowaniu/);
  assert.equal(m.log.filter(e => e.tag === 'projekt').length, 3);
  // W przygotowaniu zmiany projektu nie trafiają do dziennika.
  const fresh = newMeeting(context());
  const prep = apply(fresh, {type: 'item_place', itemId: item(fresh, 'sprawozdania').id, parentId: null, beforeId: null}, office, context());
  assert.equal(prep.agenda.at(-1)!.kind, 'sprawozdania');
  assert.ok(!prep.log.some(e => e.tag === 'projekt'));
});

test('F9: zgłoszona obecność na posiedzeniu stacjonarnym czeka na potwierdzenie i nie liczy się do kworum', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  m = {...m, invited: ['u-gosc']};
  m = apply(m, {type: 'open'}, chair, ctx);
  m = apply(m, {type: 'presence', who: 'ag', present: true}, actor('ag'), ctx.tick());
  const reported = ctx.now;
  m = apply(m, {type: 'presence', who: 'kn', present: true}, actor('kn'), ctx.tick());
  m = apply(m, {type: 'presence', who: 'u-gosc', guest: true, present: true}, actor(null, 'gosc'), ctx.tick());
  assert.equal(m.attendance.ag, 'zgloszony');
  assert.equal(m.guests['u-gosc'], 'zgloszony');
  assert.deepEqual(presentMembers(m, roster), ['si']);
  assert.deepEqual(pendingPresence(m).map(p => p.who), ['ag', 'kn', 'u-gosc']);
  assert.equal(m.presenceLog.filter(e => e.type === 'zgloszenie').length, 3);
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  assert.equal(m.quorumChecks.at(-1)!.present, 1);
  assert.throws(() => apply(m, {type: 'presence_confirm', who: 'ag', accept: true}, actor('jw'), ctx), /osoba prowadząca obrady albo biuro/);
  m = apply(m, {type: 'presence_confirm', who: 'ag', accept: true}, chair, ctx.tick());
  assert.equal(m.attendance.ag, 'obecny');
  assert.deepEqual(m.presenceLog.at(-1), {who: 'ag', guest: false, type: 'przybycie', at: ctx.now, by: 'Sebastian Irzykowski', reportedAt: reported});
  m = apply(m, {type: 'presence_confirm', who: 'kn', accept: false}, office, ctx.tick());
  assert.equal(m.attendance.kn, 'nieobecny');
  assert.equal(m.presenceLog.at(-1)!.type, 'odrzucenie');
  m = apply(m, {type: 'presence_confirm_all'}, office, ctx.tick());
  assert.equal(m.guests['u-gosc'], 'obecny');
  assert.throws(() => apply(m, {type: 'presence_confirm_all'}, chair, ctx), /Nie ma zgłoszeń obecności do potwierdzenia/);
  // Zapis obecności przez prowadzącego to od razu obecność.
  m = apply(m, {type: 'presence', who: 'jw', present: true}, chair, ctx.tick());
  assert.equal(m.attendance.jw, 'obecny');
  // Na posiedzeniu zdalnym obecność potwierdza sama osoba.
  let remote = apply({...newMeeting(ctx), mode: 'zdalne'}, {type: 'open'}, chair, ctx.tick());
  remote = apply(remote, {type: 'presence', who: 'eo', present: true}, actor('eo'), ctx.tick());
  assert.equal(remote.attendance.eo, 'obecny');
});

test('F10: numer protokołu, protokolant i zwołujący są nieobowiązkowe i można je wpisać także po otwarciu', () => {
  let {ctx, m} = opened();
  m = apply(m, {type: 'details', protocolNumber: ' 12/IX/2026 ', recorder: 'Anna Nowak', convener: 'si'}, office, ctx.tick());
  assert.deepEqual([m.protocolNumber, m.recorder, m.convener], ['12/IX/2026', 'Anna Nowak', 'si']);
  assert.throws(() => apply(m, {type: 'details', convener: 'kz'}, office, ctx), /Zwołującego wybierz ze składu organu/);
  assert.throws(() => apply(m, {type: 'details', title: 'Nowy tytuł', recorder: 'X'}, office, ctx), /Po otwarciu można zmienić tylko odnośnik do połączenia i dane do protokołu/);
  m = apply(m, {type: 'details', protocolNumber: '', convener: ''}, office, ctx.tick());
  assert.equal(m.protocolNumber, undefined);
  assert.equal(m.convener, undefined);
});

test('F11: rodzaj „Co jest głosowane” i formuły zapisane w głosowaniu', () => {
  let {ctx, m} = adopted();
  const reports = item(m, 'sprawozdania');
  assert.equal(needsVote(m, reports), false);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: reports.id, docType: 'opinia'}, chair, ctx), /Nieznany rodzaj dokumentu/);
  m = apply(m, {type: 'item_edit', itemId: reports.id, docType: 'stanowisko'}, chair, ctx.tick());
  assert.equal(needsVote(m, m.agenda.find(i => i.id === reports.id)!), true);
  m = apply(m, {type: 'item_start', itemId: reports.id, reason: 'Kolejność ustalona przed posiedzeniem.'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: reports.id, purpose: 'inna', subject: 'Stanowisko w sprawie wynagrodzeń', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  assert.equal(last(m).docType, 'stanowisko');
  assert.deepEqual(last(m).formulas, {adopted: 'Stanowisko przyjęte', rejected: 'Stanowisko nie zostało przyjęte'});
  m = announce(voteAll(m, ctx), ctx);
  // Późniejsza zmiana słownika nie zmienia wyniku w historii.
  const renamed = defaultDocTypes.map(t => t.id === 'stanowisko' ? {...t, adopted: 'Przyjęto stanowisko'} : t);
  assert.equal(resultLabel(last(m)), 'Stanowisko przyjęte');
  const ctx2 = Object.assign(ctx, {docTypes: renamed});
  m = apply(m, {type: 'ballot_open', itemId: reports.id, purpose: 'inna', subject: 'Drugie stanowisko', mode: 'jawne', minutes: 2, docType: 'oswiadczenie'}, chair, ctx2.tick());
  assert.equal(last(m).docType, 'oswiadczenie');
  assert.equal(last(m).formulas!.adopted, 'Oświadczenie przyjęte');
  // Rodzaj bez głosowania w słowniku: punkt z materiałem „informacja” nie wymaga głosowania.
  const info = material(m, 'mat-info', 'informacja', 'Informacja o szkoleniach');
  assert.equal(needsVote(info, {...item(info, 'wolne_wnioski'), materialIds: ['mat-info']}), false);
  const voted = defaultDocTypes.map(t => t.id === 'informacja' ? {...t, voted: true} : t);
  assert.equal(needsVote(info, {...item(info, 'wolne_wnioski'), materialIds: ['mat-info']}, voted), true);
});

test('F11: słownik, rozpoznawanie rodzaju z tytułu i migracja „Stanowisko lub oświadczenie”', () => {
  assert.deepEqual(defaultDocTypes.map(t => t.id), ['uchwala', 'stanowisko', 'oswiadczenie', 'apel', 'rezolucja', 'deklaracja', 'sprawozdanie', 'protokol', 'informacja', 'inny']);
  assert.equal(guessType('Stanowisko nr 3/IX/2026 w sprawie wynagrodzeń'), 'stanowisko');
  assert.equal(guessType('Oświadczenie Prezydium w sprawie szczepień'), 'oswiadczenie');
  const added = docTypeInput({name: 'Opinia prawna', adopted: 'Opinia przyjęta', rejected: 'Opinia nie została przyjęta', voted: true}, defaultDocTypes);
  assert.deepEqual(added, {id: 'opinia_prawna', name: 'Opinia prawna', adopted: 'Opinia przyjęta', rejected: 'Opinia nie została przyjęta', voted: true, order: 110, active: true});
  assert.throws(() => docTypeInput({name: 'Uchwała', adopted: 'a', rejected: 'b'}, defaultDocTypes), /Rodzaj o tej nazwie już istnieje/);
  assert.throws(() => docTypeInput({name: 'Opinia'}, defaultDocTypes), /Wpisz formułę wyniku, gdy sprawę przyjęto/);
  const off = docTypeInput({active: false}, defaultDocTypes, defaultDocTypes[3]);
  assert.deepEqual({...off, active: true}, defaultDocTypes[3]);
  // Stare dane: materiał „oswiadczenie” z tytułem „Stanowisko…” dostaje rodzaj „stanowisko”; stary wynik brzmi jak dawniej.
  const {m: start} = adopted();
  let m = material(start, 'mat-s', 'oswiadczenie', 'Stanowisko Prezydium w sprawie wynagrodzeń');
  m = material(m, 'mat-o', 'oswiadczenie', 'Oświadczenie Prezydium');
  migrateMeeting(m);
  assert.deepEqual(m.materials.filter(x => x.id.startsWith('mat-')).map(x => x.type), ['stanowisko', 'oswiadczenie']);
  const old: Ballot = {...structuredClone(last(m)), purpose: 'uchwala', subject: 'Projekt', material: {id: 'mat-s', version: 1, hash: 'x', title: 'Stanowisko Prezydium w sprawie wynagrodzeń'}};
  delete old.formulas; delete old.docType;
  assert.equal(resultLabel(old, 'stanowisko'), 'Stanowisko przyjęte');
});

test('F12: osoby prowadzące i referujące punkt, najwyżej 6, z migracją starego pola „presenter”', () => {
  let {ctx, m} = withResolution();
  const it = m.agenda.find(i => i.parentId)!;
  m = apply(m, {type: 'item_edit', itemId: it.id, presenters: [
    {name: ' Anna  Nowak ', role: 'Sekretarz', kind: 'referuje'}, {name: '', role: '', kind: 'referuje'}, {name: 'Jan Kowalski', role: '', kind: 'prowadzi'},
  ]}, office, ctx.tick());
  assert.deepEqual(m.agenda.find(i => i.id === it.id)!.presenters, [{name: 'Anna Nowak', role: 'Sekretarz', kind: 'referuje'}, {name: 'Jan Kowalski', role: '', kind: 'prowadzi'}]);
  const seven = Array.from({length: 7}, (_, i) => ({name: `Osoba ${i + 1}`, role: '', kind: 'referuje' as const}));
  assert.throws(() => apply(m, {type: 'item_edit', itemId: it.id, presenters: seven}, office, ctx), /najwyżej 6 osób/);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: it.id, presenters: [{name: '', role: 'Skarbnik', kind: 'referuje'}]}, office, ctx), /Wpisz imię i nazwisko osoby albo usuń ten wiersz/);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: it.id, presenters: [{name: 'X', role: '', kind: 'mowi' as never}]}, office, ctx), /referuje, czy prowadzi/);
  // Po przyjęciu porządku osoby przy punkcie nadal można zmieniać.
  const {ctx: c2, m: live} = adopted();
  const changed = apply(live, {type: 'item_edit', itemId: item(live, 'protokol').id, presenters: [{name: 'Anna Nowak', role: '', kind: 'referuje'}]}, chair, c2.tick());
  assert.equal(item(changed, 'protokol').presenters.length, 1);
  // Migracja: niepusty „presenter” to jedna osoba referująca, pusty to pusta lista.
  const legacy = structuredClone(m) as Meeting;
  const rows = legacy.agenda as unknown as Record<string, unknown>[];
  rows[0].presenter = 'Krystyna Naczk'; delete rows[0].presenters;
  rows[1].presenter = ''; delete rows[1].presenters;
  migrateMeeting(legacy);
  assert.deepEqual(legacy.agenda[0].presenters, [{name: 'Krystyna Naczk', role: '', kind: 'referuje'}]);
  assert.deepEqual(legacy.agenda[1].presenters, []);
  assert.ok(!('presenter' in legacy.agenda[0]));
});

test('F14: wniosek o tryb zapisuje, kto go zgłosił; zgłasza członek obecny na posiedzeniu', () => {
  let {ctx, m} = adopted();
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_start', itemId: it.id}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'mode_motion', itemId: it.id, mode: 'imienne', minutes: 2}, chair, ctx), /Wskaż, kto zgłasza wniosek\./);
  m = apply(m, {type: 'presence', who: 'ak', present: false}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'mode_motion', itemId: it.id, mode: 'imienne', minutes: 2, proposedBy: 'ak'}, chair, ctx), /Wniosek zgłasza członek Prezydium obecny na posiedzeniu/);
  assert.throws(() => apply(m, {type: 'mode_motion', itemId: it.id, mode: 'imienne', minutes: 2, proposedBy: 'kz'}, chair, ctx), /członek Prezydium obecny/);
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'imienne', minutes: 2, proposedBy: 'eo'}, chair, ctx.tick());
  assert.deepEqual(last(m).target, {kind: 'tryb', itemId: it.id, mode: 'imienne', proposedBy: 'eo'});
  assert.ok(m.log.some(e => e.text === 'Wniosek o przeprowadzenie głosowania imiennego w punkcie 3 „Przyjęcie protokołu z poprzedniego posiedzenia”, zgłasza Edyta Ostrowska.'));
});

test('F2: skutek rozstrzygnięcia zapada przy ogłoszeniu, a widok członka przed ogłoszeniem go nie pokazuje', () => {
  let {ctx, m} = opened();
  const point = item(m, 'porzadek');
  m = apply(m, {type: 'item_start', itemId: point.id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  assert.equal(m.agendaAdopted, false, 'porządek przyjmuje się przy ogłoszeniu');
  assert.equal(viewFor(m, actor('kn'), roster).agendaAdopted, false);
  assert.equal(viewFor(m, actor('kn'), roster).agenda.find(i => i.id === point.id)!.status, 'w_toku');
  // Projekt porządku nie zmienia się między zamknięciem głosowania a ogłoszeniem wyniku.
  assert.throws(() => apply(m, {type: 'item_place', itemId: item(m, 'sprawozdania').id, parentId: null, beforeId: null}, chair, ctx), /Najpierw ogłoś wynik głosowania nr 1\./);
  assert.throws(() => apply(m, {type: 'item_add', title: 'Patronat', parentId: null}, chair, ctx), /Najpierw ogłoś wynik/);
  m = announce(m, ctx);
  assert.equal(m.agendaAdopted, true);
  assert.equal(item(m, 'porzadek').status, 'zakonczony');
  // Wniosek o tryb: punkt bez trybu do ogłoszenia.
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_start', itemId: it.id}, chair, ctx.tick());
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'tajne', minutes: 2, proposedBy: 'ag'}, chair, ctx.tick());
  m = voteAll(m, ctx);
  for (const view of [m, viewFor(m, actor('kn'), roster)]) {
    const point = view.agenda.find(i => i.id === it.id)!;
    assert.equal(point.mode, undefined);
    assert.equal(point.modeBasis, undefined);
  }
  m = announce(m, ctx);
  assert.equal(item(m, 'protokol').mode, 'tajne');
  assert.equal(item(m, 'protokol').modeBasis, 'uchwalone przez Prezydium w głosowaniu nr 2');
  // Wniosek o reasumpcję: w stanie „glosowany” do ogłoszenia wyniku głosowania nad nim.
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'wniosek', subject: 'Wniosek o poprawkę', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = announce(voteAll(m, ctx, 'przeciw'), ctx);
  const original = last(m).id;
  m = apply(m, {type: 'motion_create', ballotId: original, justification: 'Pomyłka przy oddawaniu głosu.'}, actor('ag'), ctx.tick());
  for (const p of ['jw', 'kn']) m = apply(m, {type: 'motion_sign', motionId: m.motions[0].id, on: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'motion_vote', motionId: m.motions[0].id, minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  assert.equal(m.motions[0].status, 'glosowany');
  assert.equal(viewFor(m, actor('kn'), roster).motions[0].status, 'glosowany');
  m = announce(m, ctx);
  assert.equal(m.motions[0].status, 'przyjety');
  // Ponowne głosowanie zastępuje wynik dopiero po ogłoszeniu.
  m = apply(m, {type: 'reasumption_open', motionId: m.motions[0].id, minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  assert.equal(m.ballots.find(b => b.id === original)!.supersededBy, undefined);
  m = announce(m, ctx);
  assert.equal(m.ballots.find(b => b.id === original)!.supersededBy, last(m).id);
});

test('F2: dane sprzed zmiany ze skutkiem zapisanym przy zamknięciu: widok członka go ukrywa, a ogłoszenie nie powtarza', () => {
  let {ctx, m} = adopted();
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_start', itemId: it.id}, chair, ctx.tick());
  m = apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'Patronat nad konferencją', parentId: null, afterId: it.id}, minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  // Stary zapis: skutek wykonany przy zamknięciu, bez znacznika `outcomePending`.
  const legacy = structuredClone(m);
  delete last(legacy).outcomePending;
  legacy.agenda.splice(legacy.agenda.findIndex(i => i.id === it.id) + 1, 0, {...structuredClone(it), id: 'dodany', title: 'Patronat nad konferencją', status: 'oczekuje', addedAfterAdoption: true});
  const member = viewFor(legacy, actor('kn'), roster);
  assert.ok(!member.agenda.some(i => i.id === 'dodany'), 'członek nie widzi punktu dodanego przed ogłoszeniem');
  assert.ok(viewFor(legacy, chair, roster).agenda.some(i => i.id === 'dodany'));
  const announced = announce(legacy, ctx);
  assert.equal(announced.agenda.filter(i => i.title === 'Patronat nad konferencją').length, 1, 'skutek nie powtarza się przy ogłoszeniu');
  // Stary zapis z przyjętym porządkiem przed ogłoszeniem.
  const fresh = opened();
  let old = apply(fresh.m, {type: 'item_start', itemId: item(fresh.m, 'porzadek').id}, chair, fresh.ctx.tick());
  old = apply(old, {type: 'ballot_open', itemId: item(old, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, fresh.ctx.tick());
  old = structuredClone(voteAll(old, fresh.ctx));
  delete last(old).outcomePending;
  old.agendaAdopted = true;
  Object.assign(item(old, 'porzadek'), {status: 'zakonczony', endedAt: fresh.ctx.now});
  const view = viewFor(old, actor('kn'), roster);
  assert.equal(view.agendaAdopted, false);
  assert.equal(view.agenda.find(i => i.kind === 'porzadek')!.status, 'w_toku');
  assert.equal(viewFor(old, chair, roster).agendaAdopted, true);
});

test('F7: przerwane głosowanie nie ujawnia ani nie zachowuje wyborów, zostaje lista głosujących', () => {
  const ctx = context();
  let m = newMeeting(ctx, 'procedura');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 121/IX/2026 w sprawie delegacji'}, office, ctx.tick());
  m = apply(m, {type: 'item_mode', itemId: m.agenda[0].id, mode: 'imienne', basis: 'uchwała Prezydium nr 99/IX/2026'}, office, ctx.tick());
  m = apply(m, {type: 'item_mode', itemId: m.agenda[1].id, mode: 'tajne', basis: 'uchwała Prezydium nr 99/IX/2026'}, office, ctx.tick());
  m = apply(m, {type: 'details', endsAt: ctx.now + 3 * 3600000}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  const [named, secret] = m.ballots;
  for (const [p, c] of [['ag', 'za'], ['jw', 'przeciw'], ['kn', 'za']] as const) m = apply(m, {type: 'vote', ballotId: named.id, choice: c}, actor(p), ctx.tick());
  for (const p of ['ag', 'jw']) {
    m = secretIssue(m, secret.id, actor(p), ctx.tick());
    ctx.castSecret(secret.id, 'za');
    m = secretCast(m, secret.id, ctx.tick());
  }
  assert.equal(ctx.secret!.tally(secret.id).za, 2);
  m = apply(m, {type: 'procedure_end', how: 'przerwij', reason: 'błąd w projekcie uchwały'}, chair, ctx.tick());
  const stored = m.ballots.find(b => b.id === named.id)!;
  assert.deepEqual(stored.votes, {}, 'wyborów nie ma w danych');
  assert.deepEqual(stored.aborted!.voters, ['ag', 'jw', 'kn']);
  assert.deepEqual(ctx.secret!.tally(secret.id), {za: 0, przeciw: 0, wstrzymuje: 0}, 'karty tajnego głosowania przerwanego są usunięte');
  for (const who of [actor('kn'), chair, office]) {
    const view = viewFor(m, who, roster).ballots.find(b => b.id === named.id)!;
    assert.deepEqual(view.votes, {});
    assert.equal(view.result, undefined);
    assert.deepEqual(view.voted, ['ag', 'jw', 'kn']);
  }
  // Stary zapis przerwanego głosowania imiennego z wyborami: widok ich nie wysyła, a migracja usuwa.
  const legacy = structuredClone(m);
  const old = legacy.ballots.find(b => b.id === named.id)!;
  old.votes = {ag: 'za', jw: 'przeciw', kn: 'za'};
  delete old.aborted!.voters;
  assert.deepEqual(viewFor(legacy, actor('kn'), roster).ballots.find(b => b.id === named.id)!.votes, {});
  assert.deepEqual(viewFor(legacy, actor('kn'), roster).ballots.find(b => b.id === named.id)!.voted, ['ag', 'jw', 'kn']);
  migrateMeeting(legacy);
  assert.deepEqual(old.votes, {});
  assert.deepEqual(old.aborted!.voters, ['ag', 'jw', 'kn']);
});

test('F11: rodzaju wyłączonego nie można wybrać w punkcie ani przy otwarciu głosowania, a powielenie go pomija', () => {
  let {ctx, m} = adopted();
  const types = defaultDocTypes.map(t => t.id === 'apel' ? {...t, active: false} : t);
  const c = Object.assign(ctx, {docTypes: types});
  const reports = item(m, 'sprawozdania');
  const off = /Ten rodzaj dokumentu jest wyłączony\. Wybierz inny rodzaj\./;
  assert.throws(() => apply(m, {type: 'item_edit', itemId: reports.id, docType: 'apel'}, chair, c), off);
  m = apply(m, {type: 'item_start', itemId: reports.id, reason: 'Kolejność ustalona przed posiedzeniem.'}, chair, c.tick());
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: reports.id, purpose: 'inna', subject: 'Apel', mode: 'jawne', minutes: 2, docType: 'apel'}, chair, c), off);
  // Rodzaj wybrany, zanim go wyłączono, zostaje w punkcie i przechodzi do głosowania.
  const before = structuredClone(m);
  before.agenda.find(i => i.id === reports.id)!.docType = 'apel';
  const kept = apply(before, {type: 'item_edit', itemId: reports.id, docType: 'apel', note: 'Bez zmian'}, chair, c.tick());
  assert.equal(kept.agenda.find(i => i.id === reports.id)!.docType, 'apel');
  const voted = apply(kept, {type: 'ballot_open', itemId: reports.id, purpose: 'inna', subject: 'Apel', mode: 'jawne', minutes: 2}, chair, c.tick());
  assert.equal(last(voted).docType, 'apel');
  const copy = duplicateMeeting(before, {id: 'm9', now: c.now, newId: c.newId, createdBy: 'Biuro', docTypes: types}).meeting;
  assert.equal(copy.agenda.find(i => i.kind === 'sprawozdania')!.docType, undefined);
  assert.equal(duplicateMeeting(before, {id: 'm9', now: c.now, newId: c.newId, createdBy: 'Biuro'}).meeting.agenda.find(i => i.kind === 'sprawozdania')!.docType, 'apel');
});
