import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, type Context} from '../src/shared/meeting.ts';
import {applyPrep, applyWaiting, carryOver, deferredOnOpen, emptySpace, itemReadiness, onOpen, prepView, progress, progressText, purgeOld, readiness, toWaiting, waitingId, PREP_REFUSALS, type PrepContext, type PrepSpace} from '../src/shared/workspace.ts';
import {effectiveMeeting} from '../src/shared/cascade.ts';
import {canRejectProposal, canSeeWorkspace} from '../src/shared/role.ts';
import {minutesBody} from '../src/server/minutes.ts';
import {viewFor} from '../src/shared/view.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium, roster} from './helpers.ts';
import {envWith} from './scenariusz-v4.ts';

// Wspólne przygotowanie (SPEC-4 DB-13, DB-14, 4.3.1, 5.1, G-29–G-31; B2 T-W1–T-W14 w zakresie rdzenia).

const office = actor(null, 'biuro', true);
const chair = actor('si');
const deputy = actor('ag');          // I Wiceprzewodnicząca
const vice = actor('jw');            // II Wiceprzewodnicząca
const member = actor('eo');
const advisor = actor(null, 'doradczy');
const guest = actor(null, 'gosc');
const adminOnly = {...actor(null, 'czlonek', true), account: {...actor(null, 'czlonek', true).account, kind: 'czlonek' as const, id: 'u-admin', personId: null}};
const env = envWith();
const ctxOf = (ctx: Context): PrepContext => Object.assign(ctx, {general: {general: env.general, docTypes: env.docTypes, revision: 1}, accounts: [
  {id: 'u-eo', username: 'eo', kind: 'czlonek' as const, personId: 'eo', displayName: 'Edyta Ostrowska', label: '', admin: false, mustChange: false, disabled: false},
  {id: 'u-doradczy', username: 'doradczy', kind: 'doradczy' as const, personId: null, displayName: 'Ewa Doradcza', label: 'Okręgowy Rzecznik', admin: false, mustChange: false, disabled: false},
]});
function prepared() {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  return {ctx, m, ws: emptySpace(m.id, m.organ)};
}
const add = (ws: PrepSpace, m: Meeting, a = member, ctx: Context = context(), title = 'Wsparcie dla pielęgniarek środowiskowych') =>
  applyPrep(ws, m, {type: 'proposal_add', title, justification: 'Prośba z okręgu, potrzebna decyzja Prezydium.'}, a, ctxOf(ctx)).ws;

test('T-W1, DB-14, K4-3: kto widzi przestrzeń, kto zgłasza, kto wpisuje do projektu i kto odrzuca', () => {
  const {ctx, m} = prepared();
  assert.equal(canSeeWorkspace(roster, m, office), 'pelny');
  assert.equal(canSeeWorkspace(roster, m, member), 'pelny');
  assert.equal(canSeeWorkspace(roster, m, advisor), 'wlasne');
  assert.equal(canSeeWorkspace(roster, m, guest), null);
  assert.equal(canSeeWorkspace(roster, m, adminOnly), null, 'administrator bez roli biura nic nie widzi');
  let ws = add(emptySpace(m.id, m.organ), m, member, ctx);
  ws = add(ws, m, advisor, ctx.tick(), 'Opinia Okręgowego Rzecznika');
  assert.throws(() => add(ws, m, office), {message: 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.'}, 'biuro nie zgłasza spraw');
  assert.throws(() => add(ws, m, guest), {message: PREP_REFUSALS.see});
  const p = ws.proposals[0];
  // Biuro i wiceprzewodnicząca bez zwołania nie odrzucają; przewodniczący i zastępczyni zwołująca tak.
  for (const who of [office, vice, member]) {
    assert.throws(() => applyPrep(ws, m, {type: 'proposal_reject', proposalId: p.id, reason: 'Nie teraz.'}, who, ctxOf(ctx)), (e: Error & {status?: number}) => e.message === PREP_REFUSALS.reject && e.status === 403);
  }
  assert.equal(canRejectProposal(roster, m, deputy), false, 'zastępczyni, która nie zwołuje, ma uprawnienia wiceprzewodniczącej');
  const convened = apply(m, {type: 'details', convener: 'ag'}, office, ctx.tick());
  assert.equal(canRejectProposal(roster, convened, deputy), true, 'zastępczyni zwołująca odrzuca');
  assert.equal(canRejectProposal(roster, convened, chair), true);
  assert.throws(() => applyPrep(ws, convened, {type: 'proposal_defer', proposalId: p.id, reason: ' '}, deputy, ctxOf(ctx)), {message: 'Podaj powód. Zobaczy go osoba zgłaszająca.'});
  // Osoba z głosem doradczym widzi tylko własne zgłoszenia; gość i administrator bez roli biura nic.
  const own = prepView(ws, m, advisor, roster, {env});
  assert.deepEqual(own!.proposals.map(x => x.title), ['Opinia Okręgowego Rzecznika']);
  assert.equal(own!.comments.length, 0);
  assert.equal(prepView(ws, m, guest, roster, {env}), null);
  assert.equal(prepView(ws, m, adminOnly, roster, {env}), null);
  assert.equal(prepView(ws, m, office, roster, {env})!.proposals.length, 2);
});

test('T-W2: wpisanie do projektu (punkt przed wolnymi wnioskami, osoba referująca, wpis „projekt”), odrzucenie z powodem, wycofanie', () => {
  const {ctx, m} = prepared();
  let ws = add(emptySpace(m.id, m.organ), m, member, ctx);
  const p = ws.proposals[0];
  assert.throws(() => applyPrep(ws, m, {type: 'proposal_withdraw', proposalId: p.id}, vice, ctxOf(ctx)), {message: 'Zgłoszenie wycofuje osoba, która je złożyła.'});
  const r = applyPrep(ws, m, {type: 'proposal_accept', proposalId: p.id, place: 'przed_wolnymi_wnioskami'}, office, ctxOf(ctx.tick()));
  const mm = r.meeting!;
  const tops = mm.agenda.filter(i => !i.parentId);
  const at = tops.findIndex(i => i.title === p.title);
  assert.equal(tops[at + 1].kind, 'wolne_wnioski', 'punkt przed „Informacje bieżące i wolne wnioski”');
  const added = tops[at];
  assert.deepEqual(added.presenters.map(x => [x.name, x.kind]), [['Edyta Ostrowska', 'referuje']]);
  const entry = mm.log.find(l => l.itemId === added.id && l.tag === 'projekt')!;
  assert.equal(entry.text, `Dodano punkt „${p.title}” ze zgłoszenia Edyta Ostrowska, Członek Prezydium.`);
  ws = r.ws;
  assert.equal(ws.proposals[0].state, 'wpisane');
  assert.equal(ws.proposals[0].decision!.by, office.name, 'wpis z podpisem konta biura, bez słowa „decyzja”');
  assert.throws(() => applyPrep(ws, mm, {type: 'proposal_withdraw', proposalId: p.id}, member, ctxOf(ctx)), {message: 'Zgłoszenie ma już decyzję. Nie można go wycofać.'});
  // Odrzucenie przez przewodniczącego: powód widoczny u zgłaszającego.
  ws = add(ws, mm, member, ctx.tick(), 'Druga sprawa');
  const second = ws.proposals.at(-1)!;
  ws = applyPrep(ws, mm, {type: 'proposal_reject', proposalId: second.id, reason: 'Sprawa należy do Okręgowej Rady.'}, chair, ctxOf(ctx.tick())).ws;
  const seen = prepView(ws, mm, member, roster, {env})!.proposals.find(x => x.id === second.id)!;
  assert.equal(seen.state, 'odrzucone');
  assert.equal(seen.decision!.reason, 'Sprawa należy do Okręgowej Rady.');
  // Odłożenie trafia do zbioru czekających organu.
  ws = add(ws, mm, member, ctx.tick(), 'Trzecia sprawa');
  const third = ws.proposals.at(-1)!;
  const deferred = applyPrep(ws, mm, {type: 'proposal_defer', proposalId: third.id, reason: 'Na następne posiedzenie.'}, chair, ctxOf(ctx.tick()));
  assert.equal(deferred.waiting![0].state, 'zgloszone');
  assert.equal(deferred.waiting![0].carriedFrom!.meetingId, mm.id);
});

test('T-W3: wpisanie po dacie zawiadomienia daje odstępstwo „poza zawiadomieniem” z brzmieniem wersji 3', () => {
  const {ctx, m: m0} = prepared();
  const m = apply(m0, {type: 'details', noticeDate: '2026-11-12'}, office, ctx.tick());
  const ws = add(emptySpace(m.id, m.organ), m, member, ctx);
  const r = applyPrep(ws, m, {type: 'proposal_accept', proposalId: ws.proposals[0].id, place: 'przed_wolnymi_wnioskami'}, chair, ctxOf(ctx.tick()));
  const dev = effectiveMeeting(env, r.meeting!).deviations.find(d => d.kind === 'poza_zawiadomieniem');
  assert.ok(dev && dev.text.includes('dodano do projektu porządku obrad po wysłaniu zawiadomienia'), dev?.text);
});

test('T-W4, G-29, G-30: po otwarciu przestrzeń tylko do odczytu, zgłoszenia bez decyzji wracają do czekających', () => {
  const {ctx, m} = prepared();
  const ws = add(emptySpace(m.id, m.organ), m, member, ctx);
  const opened = apply(m, {type: 'open'}, chair, ctx.tick());
  assert.throws(() => applyPrep(ws, opened, {type: 'comment_add', target: {kind: 'posiedzenie'}, text: 'Uwaga'}, member, ctxOf(ctx)), (e: Error & {status?: number}) => e.message === PREP_REFUSALS.opened && e.status === 409);
  assert.throws(() => add(ws, opened, member, ctx), {message: PREP_REFUSALS.proposeLive});
  const after = onOpen(ws, ctx.now, m);
  assert.equal(after.proposals[0].state, 'odlozone');
  assert.equal(after.proposals[0].decision!.reason, 'Posiedzenie otwarto przed decyzją w sprawie zgłoszenia.');
  const back = deferredOnOpen(ws, after, m);
  assert.equal(back.length, 1);
  const waiting = toWaiting(emptySpace(waitingId('prezydium'), 'prezydium'), back);
  assert.equal(waiting.proposals[0].state, 'zgloszone');
  // T-5: w trwającym posiedzeniu widok nie dostaje przestrzeni roboczej.
  const live = viewFor(opened, member, roster, env, {prep: prepView(after, opened, member, roster, {env})});
  assert.equal(live.prep, undefined);
});

test('T-W5, B2-W06: nowe posiedzenie przejmuje zgłoszenia czekające, uwagi zostają przy starym posiedzeniu', () => {
  const ctx = context();
  let waiting = emptySpace(waitingId('prezydium'), 'prezydium');
  waiting = applyWaiting(waiting, {type: 'proposal_add', title: 'Sprawa zgłoszona między posiedzeniami', justification: 'Uzasadnienie.'}, member, ctxOf(ctx));
  assert.throws(() => applyWaiting(waiting, {type: 'proposal_add', title: 'x', justification: 'y'}, office, ctxOf(ctx)), {message: 'Sprawę zgłasza członek Prezydium albo osoba z głosem doradczym.'});
  const m = newMeeting(ctx);
  const moved = carryOver(waiting, null, m);
  assert.equal(moved.ws.proposals.length, 1);
  assert.deepEqual(moved.ws.proposals[0].carriedFrom, {meetingId: null, date: null});
  assert.equal(moved.waiting.proposals.length, 0);
});

test('T-W6, B2-W12: gotowość punktu, postęp i przegląd przed otwarciem z tymi samymi brakami', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  const resolutions = m.agenda.find(i => i.kind === 'uchwaly')!;
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu', parentId: resolutions.id}, office, ctx.tick());
  const it = m.agenda.at(-1)!.title.startsWith('Uchwała') ? m.agenda.at(-1)! : m.agenda.find(i => i.title.startsWith('Uchwała nr 120'))!;
  m = apply(m, {type: 'item_edit', itemId: it.id, docType: 'uchwala'}, office, ctx.tick());
  const checks = itemReadiness(env, m, m.agenda.find(i => i.id === it.id)!);
  assert.deepEqual(checks.map(c => [c.key, c.ok]), [['material', false], ['projekt_aktu', false], ['referent', false]]);
  assert.match(checks[1].text, /^Brak projektu uchwały\. Projekt przygotowuje sekretarz, a w sprawach finansowych skarbnik \(§ 17 ust\. 2 pkt 3, § 18 ust\. 2 pkt 1\)\.$/);
  // Punkt porządkowy nie ma sprawdzeń.
  assert.equal(itemReadiness(env, m, m.agenda.find(i => i.kind === 'otwarcie')!).length, 0);
  const p = progress(env, m, null, office, ctx.now);
  assert.equal(p.text, progressText(p.ready, p.total));
  assert.equal(progressText(1, 1), 'Gotowe 1 z 1 punktu.');
  assert.equal(progressText(7, 9), 'Gotowe 7 z 9 punktów.');
  assert.match(p.missing!, /^Brakuje /);
  assert.ok(p.missing!.includes('projektu uchwały w punkcie 5.1'), p.missing!);
  const review = effectiveMeeting(env, m, {review: true, now: ctx.now}).review!;
  for (const [id, list] of Object.entries(readiness(env, m))) for (const c of list.filter(x => !x.ok && x.key !== 'rodzaj_sprawy')) {
    assert.ok(review.some(r => r.itemId === id && r.group === 'uzupelnic'), `przegląd zawiera brak ${c.key} z punktu`);
  }
  assert.ok(review.some(r => r.text === 'Podpunkt 5.1 bez projektu uchwały.'));
  assert.ok(review.some(r => r.text === 'W materiale dla komunikacji 1 sprawa bez rodzaju sprawy będzie tylko w liczbie.'));
});

test('T-W9, G-28, B2-W20: wiadomość w przygotowaniu odrzucona; po otwarciu kanał działa', () => {
  const ctx = context();
  const m = newMeeting(ctx);
  assert.throws(() => apply(m, {type: 'message', text: 'Pytanie przed posiedzeniem'}, member, ctx), (e: Error & {status?: number}) => e.status === 409 && e.message === 'Przed rozpoczęciem pisz w uwagach przygotowania. Kanał wiadomości działa od otwarcia posiedzenia.');
});

test('T-W11, DB-36: przestrzeń znika 90 dni po zamknięciu, zgłoszenie czekające wygasa po 365 dniach', () => {
  const day = 86400000, now = Date.parse('2027-12-01T10:00:00Z');
  const closed = {id: 'm-old', status: 'zakonczone' as const, closedAt: now - 91 * day};
  const fresh = {id: 'm-new', status: 'zakonczone' as const, closedAt: now - 10 * day};
  const waiting: PrepSpace = {...emptySpace(waitingId('prezydium'), 'prezydium'), proposals: [
    {id: 'p1', title: 'Stare', justification: 'x', accountId: 'u-eo', byName: 'Edyta Ostrowska', at: now - 366 * day, state: 'zgloszone'},
    {id: 'p2', title: 'Nowe', justification: 'x', accountId: 'u-eo', byName: 'Edyta Ostrowska', at: now - 10 * day, state: 'zgloszone'},
  ]};
  const r = purgeOld([emptySpace('m-old', 'prezydium'), emptySpace('m-new', 'prezydium'), waiting], [closed, fresh], now);
  assert.deepEqual(r.remove, ['m-old']);
  assert.deepEqual(r.update[0].proposals.map(p => [p.id, p.state]), [['p1', 'wygasle'], ['p2', 'zgloszone']]);
  assert.ok(r.update[0].events.some(e => e.text.includes('wygasło po 365 dniach') && e.forAccounts?.includes('u-eo')));
});

test('T-W12: projekt protokołu nie zależy od przestrzeni roboczej (nic z niej nie trafia do protokołu)', () => {
  const {ctx, m} = prepared();
  let ws = add(emptySpace(m.id, m.organ), m, member, ctx);
  ws = applyPrep(ws, m, {type: 'comment_add', target: {kind: 'posiedzenie'}, text: 'Uwaga Jana Prywatnego do przygotowania.'}, member, ctxOf(ctx.tick())).ws;
  const opened = apply(m, {type: 'open'}, chair, ctx.tick());
  const body = minutesBody(opened, roster, [], ctx.now);
  assert.ok(!body.includes('Jana Prywatnego') && !body.includes(ws.proposals[0].title));
  assert.equal(minutesBody(opened, roster, [], ctx.now), body);
});

test('T-W13, G-31: zmiana nazwy z `expect` i poprawka uwagi przez 15 minut przed odpowiedzią', () => {
  const {ctx, m} = prepared();
  const it = m.agenda.find(i => i.kind === 'sprawozdania')!;
  assert.throws(() => apply(m, {type: 'item_edit', itemId: it.id, title: 'Nowa nazwa', expect: {title: 'Inna nazwa'}}, office, ctx), (e: Error & {status?: number}) => e.status === 409 && e.message === 'Ktoś zmienił nazwę punktu w międzyczasie. Sprawdź nową nazwę i zapisz ponownie.');
  assert.equal(apply(m, {type: 'item_edit', itemId: it.id, title: 'Nowa nazwa', expect: {title: it.title}}, office, ctx).agenda.find(i => i.id === it.id)!.title, 'Nowa nazwa');
  let ws = applyPrep(emptySpace(m.id, m.organ), m, {type: 'comment_add', target: {kind: 'punkt', itemId: it.id}, text: 'Pierwsza uwaga'}, member, ctxOf(ctx)).ws;
  const c = ws.comments[0];
  assert.throws(() => applyPrep(ws, m, {type: 'comment_add', target: {kind: 'punkt', itemId: it.id}, text: ''}, member, ctxOf(ctx)), {message: 'Uwaga może mieć od 1 do 2000 znaków.'});
  assert.throws(() => applyPrep(ws, m, {type: 'comment_add', target: {kind: 'punkt', itemId: it.id}, text: 'x'}, advisor, ctxOf(ctx)), {message: PREP_REFUSALS.see}, 'głos doradczy nie pisze uwag');
  ws = applyPrep(ws, m, {type: 'comment_edit', commentId: c.id, text: 'Poprawiona uwaga'}, member, ctxOf(ctx.tick(60000))).ws;
  assert.ok(ws.comments[0].editedAt);
  ws = applyPrep(ws, m, {type: 'comment_add', target: {kind: 'punkt', itemId: it.id}, text: 'Odpowiedź', parentId: c.id}, office, ctxOf(ctx.tick())).ws;
  assert.throws(() => applyPrep(ws, m, {type: 'comment_edit', commentId: c.id, text: 'Jeszcze raz'}, member, ctxOf(ctx)), {message: PREP_REFUSALS.edit});
  ws = applyPrep(ws, m, {type: 'thread_resolve', commentId: c.id, on: true}, office, ctxOf(ctx.tick())).ws;
  assert.ok(ws.comments[0].resolved);
  ws = applyPrep(ws, m, {type: 'comment_delete', commentId: ws.comments[1].id}, office, ctxOf(ctx.tick())).ws;
  assert.ok(ws.comments[1].deleted && ws.comments[1].text === '');
  // Polecenia dodatków D-11 i D-12 doszły w fazie dodatków (tests/dodatki-v4-domena.test.ts); nieznane polecenie nadal odmowa.
  assert.throws(() => applyPrep(ws, m, {type: 'zadanie_nieznane'} as never, office, ctxOf(ctx)), {message: 'Nieznana czynność.'});
  void presidium;
});
