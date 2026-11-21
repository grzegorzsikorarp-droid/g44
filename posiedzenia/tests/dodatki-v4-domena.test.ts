import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, type Context} from '../src/shared/meeting.ts';
import {commsMarkdown} from '../src/shared/comms.ts';
import {accounts, chair, closedMeeting, envWith, NOW, office} from './scenariusz-v4.ts';
import {applyPrep, attachCommentMaterial, carryOver, emptySpace, feed, mailTasks, nextVisit, prepView, presenceAllowed, presencePlace, presenceRows, progress, readiness, remarkLabel, seenVisit, waitingId, PREP_REFUSALS, type PrepCommand, type PrepContext} from '../src/shared/workspace.ts';
import {mailRecipients} from '../src/shared/mail.ts';
import {itemNumber} from '../src/shared/rules.ts';
import {rosterFileName, rosterPersonStats, rosterStats, rosterTurnout} from '../src/shared/stats.ts';
import {rosterPageBody} from '../src/shared/stats-page.ts';
import {canSeeRosterStats, seesStatsNotes} from '../src/shared/role.ts';
import {actor, context, newMeeting, roster} from './helpers.ts';

// Dodatki wersji 4 w domenie (SPEC-4 rozdz. 8.0; zespół D): czyste funkcje i polecenia bez serwera.

test('D-6 (U-43, B1-34): zgoda gościa zapisana przy zaproszeniu; materiał dla komunikacji podaje tylko gościa ze zgodą', () => {
  const ctx = {...context(), accounts};
  let m = newMeeting(ctx);
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy', comms: true}, office, ctx);
  assert.deepEqual(m.guestInvites!['u-gosc'].comms, {at: ctx.now, by: 'Biuro Izby', accountId: 'u-biuro'});
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, comms: false}, office, ctx);
  assert.equal(m.guestInvites!['u-gosc'].comms, undefined, 'zgodę można cofnąć');
  assert.equal(m.log.at(-1)!.text, 'Usunięto zgodę gościa Jan Gościnny na wymienienie w materiale dla komunikacji.');
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, comms: true}, office, ctx);
  assert.equal(m.log.at(-1)!.text, 'Zapisano zgodę gościa Jan Gościnny na wymienienie w materiale dla komunikacji.');
  assert.throws(() => apply(m, {type: 'invite', accountId: 'u-inny', on: true, comms: true}, office, ctx), {message: 'Najpierw dodaj zaproszenie gościa.'});

  // Materiał: gość obecny bez zgody tylko liczbą (jak w rdzeniu), ze zgodą z imienia, nazwiska i funkcji.
  const {m: closed, env} = closedMeeting({v4: true});
  const arrived = {...closed, invited: [...closed.invited, 'u-gosc'], presenceLog: [...closed.presenceLog, {who: 'u-gosc', guest: true, type: 'przybycie' as const, at: closed.openedAt! + 1000, by: 'Biuro'}]};
  const without = commsMarkdown({...arrived, guestInvites: {'u-gosc': {by: 'przewodniczacy', at: 1, recordedBy: 'Biuro', accountId: 'u-biuro'}}}, env, {at: NOW});
  assert.ok(without.includes('- Goście na zaproszenie 1.') && !without.includes('Gościnny'));
  assert.ok(without.includes('Materiał nie podaje imion i nazwisk gości. Jeśli wizyta ma trafić do relacji, ustal to z biurem.'));
  const consent = commsMarkdown({...arrived, guestInvites: {'u-gosc': {by: 'przewodniczacy', at: 1, recordedBy: 'Biuro', accountId: 'u-biuro', comms: {at: 1, by: 'Biuro', accountId: 'u-biuro'}}}}, env, {at: NOW});
  assert.ok(consent.includes('- Goście na zaproszenie Jan Gościnny, radca prawny.'));
  assert.ok(!consent.includes('Materiał nie podaje imion i nazwisk gości'));
  void chair;
});

test('D-7 (B2 2.7): gotowość „Przyjęcie protokołu” z faktu „Protokół sporządzony” wskazanego posiedzenia', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  const item = m.agenda.find(i => i.kind === 'protokol')!;
  const ref = {id: 'm0', organ: 'prezydium' as const, kind: 'posiedzenie' as const, day: '2026-11-12', working: false, adopted: false, title: 'Posiedzenie'};
  const env0 = envWith();
  // Bez wskazania protokołu sprawdzenie nie ma zastosowania (rdzeń bez zmian).
  assert.equal(readiness({...env0, closedMeetings: [{...ref, minutes: {ready: null, deadline: '2026-12-03'}}]}, m)[item.id], undefined);
  m = {...m, agenda: m.agenda.map(i => i.id === item.id ? {...i, protocolOfGuess: 'm0'} : i)};
  const notReady = readiness({...env0, closedMeetings: [{...ref, minutes: {ready: null, deadline: '2026-12-03'}}]}, m)[item.id];
  assert.deepEqual(notReady, [{key: 'protokol', ok: false, text: 'Protokół posiedzenia z dnia 12.11.2026 nie jest jeszcze sporządzony. Termin 03.12.2026 (§ 13 ust. 2).'}]);
  const p = progress({...env0, closedMeetings: [{...ref, minutes: {ready: null, deadline: '2026-12-03'}}]}, m, null);
  assert.match(p.missing ?? '', /sporządzonego protokołu w punkcie 3/);
  m = {...m, agenda: m.agenda.map(i => i.id === item.id ? {...i, protocolOf: 'm0', protocolOfGuess: undefined} : i)};
  const ready = readiness({...env0, closedMeetings: [{...ref, minutes: {ready: '2026-11-25', deadline: '2026-12-03'}}]}, m)[item.id];
  assert.deepEqual(ready, [{key: 'protokol', ok: true, text: 'Protokół posiedzenia z dnia 12.11.2026 sporządzono 25.11.2026.'}]);
  // Dane bez pola `minutes` (stare ClosedRef) nie dają sprawdzenia.
  assert.equal(readiness({...env0, closedMeetings: [ref]}, m)[item.id], undefined);
});

// --- Wspólne przygotowanie: dodatki D-10, D-11, D-12 -------------------------------------------------------------------
const pOffice = actor(null, 'biuro', true), pChair = actor('si'), pDeputy = actor('ag'), pVice = actor('jw'), pMember = actor('eo'), pReferent = actor('kn');
const pEnv = envWith();
const pAccounts = [
  ...['si', 'ag', 'jw', 'kn', 'eo'].map(id => ({id: 'u-' + id, username: id, kind: 'czlonek' as const, personId: id, displayName: id, label: '', admin: false, mustChange: false, disabled: false})),
  {id: 'u-biuro', username: 'biuro', kind: 'biuro' as const, personId: null, displayName: 'Biuro Izby', label: '', admin: true, mustChange: false, disabled: false},
];
const pctx = (ctx: Context): PrepContext => Object.assign(ctx, {general: {general: pEnv.general, docTypes: pEnv.docTypes, revision: 1}, accounts: pAccounts});
function preparedMeeting() {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'deputy', personId: 'ag'}, pChair, ctx.tick());
  const it = m.agenda.find(i => i.kind === 'uchwaly')!;
  m = apply(m, {type: 'item_add', title: 'Uchwała w sprawie szkoleń', parentId: it.id}, pOffice, ctx.tick());
  const sub = m.agenda.find(i => i.title === 'Uchwała w sprawie szkoleń')!;
  m = apply(m, {type: 'item_edit', itemId: sub.id, presenters: [{name: 'Krystyna Naczk', role: 'Sekretarz', kind: 'referuje'}]}, pOffice, ctx.tick());
  m = {...m, materials: [{id: 'mat1', title: 'Projekt uchwały', type: 'uchwala', number: '', version: 2, hash: 'x', size: 10, fileId: null, fileName: null, createdAt: ctx.now}],
    agenda: m.agenda.map(i => i.id === sub.id ? {...i, materialIds: ['mat1']} : i)};
  return {ctx, m, sub, ws: emptySpace(m.id, m.organ)};
}

test('D-11 (B2-W10, G-31): zadania dla biura, dla siebie i od zwołującego; odhaczenie, anulowanie, postęp, adresaci i przeniesienie', () => {
  const {ctx, m, sub} = preparedMeeting();
  let ws = emptySpace(m.id, m.organ);
  const run = (cmd: PrepCommand, a = pMember) => { ws = applyPrep(ws, m, cmd, a, pctx(ctx.tick())).ws; return ws; };
  run({type: 'task_add', title: 'Przygotować salę', assignee: {office: true}}, pMember);
  assert.throws(() => run({type: 'task_add', title: 'Projekt uchwały', assignee: {personId: 'kn'}}, pVice), {message: PREP_REFUSALS.taskMember});
  assert.throws(() => run({type: 'task_add', title: 'Projekt uchwały', assignee: {personId: 'kn'}}, pOffice), {message: PREP_REFUSALS.taskMember}, 'biuro nie przydziela zadań członkom');
  run({type: 'task_add', title: 'Projekt uchwały', assignee: {personId: 'kn'}, due: '2026-11-18', itemId: sub.id}, pChair);
  run({type: 'task_add', title: 'Przeczytać projekt', assignee: {personId: 'eo'}}, pMember);
  assert.equal(ws.tasks.length, 3);
  assert.deepEqual(ws.events.at(-1)!.forAccounts, ['u-kn'], 'wpis „Co nowego” dla osoby odpowiedzialnej (zadanie dla siebie bez wpisu)');
  assert.equal(ws.events.at(-1)!.text, 'Nowe zadanie dla Ciebie „Projekt uchwały”, termin 18.11.2026.');
  assert.deepEqual(ws.events.at(-2)!.forAccounts, ['u-biuro']);
  const kn = progress(pEnv, m, ws, pReferent, ctx.now);
  assert.deepEqual([kn.myTasks, kn.myTasksOverdue], [1, 1], 'termin przed dniem 20.11.2026');
  assert.deepEqual([progress(pEnv, m, ws, pOffice, ctx.now).myTasks], [1], 'zadanie dla biura u konta biura');
  assert.deepEqual(mailTasks(ws, m, {personId: 'kn', kind: 'czlonek'}), [`Projekt uchwały, punkt ${itemNumber(m.agenda, sub.id)}, termin 18.11.2026.`]);
  assert.deepEqual(mailTasks(ws, m, {personId: 'si', kind: 'czlonek'}), []);
  const contacts = pAccounts.map(a => ({accountId: a.id, personId: a.personId, name: a.displayName, kind: a.kind, email: `${a.username}@example.org`, emailState: 'potwierdzony' as const, prefs: {postep: true, po_posiedzeniu: true, showPresence: false}, disabled: false}));
  assert.deepEqual(mailRecipients('postep', roster, m, contacts, {group: 'zadania'}, ws).map(r => r.accountId), ['u-kn', 'u-eo']);
  const t = ws.tasks.find(x => x.title === 'Projekt uchwały')!;
  assert.throws(() => run({type: 'task_done', taskId: t.id, on: true}, pMember), {message: 'Zadanie odhacza osoba odpowiedzialna.'});
  run({type: 'task_done', taskId: t.id, on: true}, pReferent);
  assert.equal(progress(pEnv, m, ws, pReferent, ctx.now).myTasks, 0);
  const own = ws.tasks.find(x => x.title === 'Przeczytać projekt')!;
  assert.throws(() => run({type: 'task_cancel', taskId: own.id}, pVice), {message: 'Zadanie anuluje osoba, która je dodała, albo przewodniczący.'});
  run({type: 'task_edit', taskId: own.id, due: '2026-12-01'}, pMember);
  assert.equal(ws.tasks.find(x => x.id === own.id)!.due, '2026-12-01');
  // Powielenie przejmuje niezakończone zadania z dopiskiem (B2-W17).
  const moved = carryOver(emptySpace(waitingId('prezydium'), 'prezydium'), ws, {id: 'm2', organ: 'prezydium'}, {id: m.id, date: m.date});
  assert.deepEqual(moved.ws.tasks.map(x => [x.title, x.carriedFrom?.date]), [['Przygotować salę', '2026-11-20'], ['Przeczytać projekt', '2026-11-20']]);
  // Po otwarciu zadań nie można zmieniać (G-29).
  const opened = {...m, status: 'trwa' as const};
  assert.throws(() => applyPrep(ws, opened, {type: 'task_add', title: 'X', assignee: {office: true}}, pMember, pctx(ctx)), {message: PREP_REFUSALS.opened});
  // Widok: zadania w przestrzeni pełnej, nie u głosu doradczego.
  assert.equal(prepView(ws, m, pMember, roster, {env: pEnv})!.tasks.length, 3);
  assert.equal(prepView(ws, m, actor(null, 'doradczy'), roster, {env: pEnv})!.tasks.length, 0);
});

test('D-12 (B2-W08, B2-W09): uwaga do wersji materiału z cytatem, stan u osoby referującej i przeniesienie do materiałów przez autora', () => {
  const {ctx, m, sub} = preparedMeeting();
  let ws = emptySpace(m.id, m.organ);
  const run = (cmd: PrepCommand, a = pMember) => { const r = applyPrep(ws, m, cmd, a, pctx(ctx.tick())); ws = r.ws; return r; };
  run({type: 'comment_add', target: {kind: 'material', materialId: 'mat1', version: 1, quote: '§ 2 ust. 1'}, text: 'Brakuje kwoty.'});
  const remark = ws.comments[0];
  assert.deepEqual([remark.target, remark.remark], [{kind: 'material', materialId: 'mat1', version: 1, quote: '§ 2 ust. 1'}, {state: 'otwarta'}]);
  assert.throws(() => run({type: 'comment_add', target: {kind: 'material', materialId: 'mat1', version: 3}, text: 'X'}), {message: 'Wybierz wersję materiału.'});
  assert.throws(() => run({type: 'comment_add', target: {kind: 'material', materialId: 'mat1', version: 1, quote: 'x'.repeat(301)}, text: 'X'}), {message: 'Cytowany fragment może mieć najwyżej 300 znaków.'});
  assert.equal(progress(pEnv, m, ws, pChair, ctx.now).openRemarks, 1);
  assert.throws(() => run({type: 'remark_state', commentId: remark.id, state: 'uwzgledniona'}, pMember), {message: /Stan uwagi zmienia osoba referująca/});
  run({type: 'remark_state', commentId: remark.id, state: 'uwzgledniona'}, pReferent);
  assert.deepEqual([ws.comments[0].remark!.state, ws.comments[0].remark!.version], ['uwzgledniona', 2], 'domyślnie najnowsza wersja');
  assert.equal(remarkLabel(ws.comments[0].remark!), 'Uwzględniona w wersji 2');
  assert.deepEqual(ws.events.at(-1)!.forAccounts, ['u-eo']);
  assert.throws(() => run({type: 'remark_state', commentId: remark.id, state: 'nieuwzgledniona'}, pOffice), {message: 'Podaj powód. Zobaczy go osoba, która zgłosiła uwagę.'});
  run({type: 'remark_state', commentId: remark.id, state: 'nieuwzgledniona', reason: 'Kwota jest w załączniku.'}, pOffice);
  assert.equal(progress(pEnv, m, ws, pChair, ctx.now).openRemarks, 0);
  // Przeniesienie do materiałów: tylko autor; powstaje materiał „Inny” punktu, a przy uwadze `movedTo`.
  assert.throws(() => run({type: 'comment_to_material', commentId: remark.id}, pChair), {message: 'Do materiałów przenosi uwagę jej autor.'});
  const r = run({type: 'comment_to_material', commentId: remark.id});
  assert.deepEqual(r.toMaterial, {commentId: remark.id, itemId: sub.id, title: `Uwagi Edyta Ostrowska do punktu ${itemNumber(m.agenda, sub.id)}`, text: 'Cytowany fragment „§ 2 ust. 1”.\n\nBrakuje kwoty.'});
  const ref = {id: 'mat2', title: r.toMaterial!.title, type: 'inny' as const, number: '', version: 1, hash: 'y', size: 1, fileId: null, fileName: null, createdAt: ctx.now};
  const after = attachCommentMaterial(m, ws, ref, r.toMaterial!, pMember, ctx.now);
  assert.ok(after.meeting.agenda.find(i => i.id === sub.id)!.materialIds.includes('mat2'));
  assert.equal(after.meeting.revision, m.revision + 1);
  assert.deepEqual(after.ws.comments[0].movedTo, {materialId: 'mat2', at: ctx.now});
  ws = after.ws;
  assert.throws(() => run({type: 'comment_to_material', commentId: remark.id}), {message: 'Tę uwagę już przeniesiono do materiałów.'});
});

test('D-10 (B2-W13, DB-14): wizyty, „Co nowego” bez własnych działań, „Dla Ciebie” i „Przekaż do decyzji zwołującego”', () => {
  const t0 = Date.parse('2026-11-20T08:00:00Z');
  assert.deepEqual(nextVisit(null, t0), {lastAt: t0, prevAt: null}, 'pierwsza wizyta bez poprzedniej');
  assert.equal(nextVisit({lastAt: t0, prevAt: null}, t0 + 30000), null, 'zapis najwyżej raz na minutę');
  assert.deepEqual(nextVisit({lastAt: t0, prevAt: null}, t0 + 61000), {lastAt: t0 + 61000, prevAt: null});
  assert.deepEqual(nextVisit({lastAt: t0, prevAt: null}, t0 + 31 * 60000), {lastAt: t0 + 31 * 60000, prevAt: t0}, 'nowa wizyta po 30 minutach przerwy');
  assert.deepEqual(seenVisit(t0 + 5), {lastAt: t0 + 5, prevAt: t0 + 5});

  const {ctx, m, sub} = preparedMeeting();
  let ws = emptySpace(m.id, m.organ);
  const since = ctx.now;
  const run = (cmd: PrepCommand, a: typeof pMember) => { ws = applyPrep(ws, m, cmd, a, pctx(ctx.tick())).ws; };
  run({type: 'comment_add', target: {kind: 'punkt', itemId: sub.id}, text: 'Pierwsza uwaga.'}, pMember);
  run({type: 'comment_add', target: {kind: 'punkt', itemId: sub.id}, text: 'Odpowiedź.', parentId: ws.comments[0].id}, pChair);
  run({type: 'comment_add', target: {kind: 'punkt', itemId: sub.id}, text: 'Druga uwaga.'}, pVice);
  run({type: 'comment_add', target: {kind: 'punkt', itemId: sub.id}, text: 'Trzecia uwaga.'}, pChair);
  run({type: 'proposal_add', title: 'Sprawa lokalowa', justification: 'Potrzebna decyzja.'}, pMember);
  assert.throws(() => run({type: 'proposal_forward', proposalId: ws.proposals[0].id}, pChair), {message: /Zgłoszenie przekazuje do decyzji zwołującego biuro/}, 'zwołujący decyduje sam');
  run({type: 'proposal_forward', proposalId: ws.proposals[0].id}, pOffice);
  assert.deepEqual(ws.events.at(-1)!.forAccounts, ['u-si'], 'wpis dla zwołującego (przewodniczący)');
  const forEo = feed(m, ws, pMember, roster, since);
  assert.deepEqual(forEo.forYou.map(r => r.text), [`Odpowiedź na Twoją uwagę przy punkcie ${itemNumber(m.agenda, sub.id)}.`]);
  assert.ok(forEo.other.some(r => r.text === `2 nowe uwagi przy punkcie ${itemNumber(m.agenda, sub.id)}.`));
  assert.ok(!forEo.other.some(r => /Zgłoszono sprawę/.test(r.text)), 'bez własnych działań');
  const forSi = feed(m, ws, pChair, roster, since);
  assert.ok(forSi.forYou.some(r => r.text === 'Przekazano do decyzji zwołującego zgłoszenie „Sprawa lokalowa”.'));
  assert.ok(forSi.other.some(r => r.text === 'Zgłoszono sprawę „Sprawa lokalowa”.'));
  assert.deepEqual(feed(m, ws, pChair, roster, null), {forYou: [], other: [], since: null}, 'pierwsza wizyta bez sekcji');
  assert.deepEqual(feed(m, ws, pChair, roster, ctx.now + 1).other, [], 'po „Oznacz jako przeczytane” pusto');
  // Widok: feed tylko z poprzednią wizytą, obecność tylko przed otwarciem (D-9, T-5).
  const v = prepView(ws, m, pMember, roster, {env: pEnv, previousVisit: since, presence: [{name: 'Anna', label: 'Członek Prezydium', where: null}]})!;
  assert.equal(v.feed.since, since);
  assert.equal(v.presence.length, 1);
  assert.deepEqual(prepView(ws, {...m, status: 'zakonczone'}, pMember, roster, {env: pEnv, presence: [{name: 'Anna', label: '', where: null}]})!.presence, []);
  assert.equal(presencePlace('punkt:abc-1'), 'punkt:abc-1');
  assert.equal(presencePlace('punkt:<x>'), null, 'nagłówek spoza wzorca ignorowany');
  assert.equal(presenceAllowed(roster, m, pMember, {showPresence: false}), false, 'domyślnie wyłączone (K4-30)');
  assert.equal(presenceAllowed(roster, m, actor(null, 'doradczy'), {showPresence: true}), false);
  assert.equal(presenceAllowed(roster, {...m, status: 'trwa'}, pMember, {showPresence: true}), false, 'T-5');
  const rows = presenceRows([{accountId: 'u-eo', where: `punkt:${sub.id}`}, {accountId: 'u-biuro', where: 'ustawienia'}], m, roster, pAccounts);
  assert.deepEqual(rows.map(r => [r.name, r.where, r.itemId ?? null]), [['Biuro Izby', 'w ustawieniach posiedzenia', null], ['Edyta Ostrowska', `przy punkcie ${itemNumber(m.agenda, sub.id)}`, sub.id]]);
  void pDeputy;
});

test('D-13 (B4-23–B4-26, DB-23, T-6): „Statystyki składu” bez wierszy i głosów jawnych, „Posiedzenia po kolei” z wyborem tylko z imiennych', () => {
  const {m} = closedMeeting({v4: true});
  const input = {meetings: [m], roster, range: {from: '2026-01-01', to: '2026-12-31'}};
  const r = rosterStats(input, {notes: false});
  assert.equal(r.persons.length >= 7, true);
  for (const p of r.persons) {
    assert.deepEqual(p.rows, []);
    assert.equal(p.sessionVotes.own, undefined, 'bez rozkładu własnych głosów jawnych');
  }
  assert.deepEqual(r.notes, []);
  const one = rosterPersonStats(input, 'eo', {notes: false});
  assert.equal(one.persons.length, 1);
  const ballots = one.persons[0].rows.flatMap(x => x.ballots);
  assert.ok(ballots.length > 0);
  assert.ok(ballots.filter(b => b.mode === 'jawne').every(b => b.choice === undefined), 'bez głosów jawnych innej osoby');
  assert.ok(ballots.filter(b => b.mode === 'tajne').every(b => b.choice === undefined), 'z tajnego tylko pobranie karty');
  assert.ok(ballots.some(b => b.mode === 'imienne' && b.choice), 'wybór z głosowań imiennych');
  const t = rosterTurnout(r);
  assert.equal(t.places, r.persons.reduce((n, p) => n + p.meetings.held, 0));
  const html = rosterPageBody(r, NOW, 'pelny'), short = rosterPageBody(r, NOW, 'sprawozdanie');
  assert.ok(html.includes('Imienne za, przeciw, wstrzymanie się') && !short.includes('Imienne za'), 'wersja do sprawozdania bez kolumny imiennych (B4-27)');
  assert.ok(!html.includes(':') || !/>[^<]*: [^<]*</.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), 'bez dwukropków w tekście');
  assert.equal(rosterFileName(r, 'csv'), '2026-01-01_2026-12-31-prezydium-statystyki-skladu.csv');
  assert.equal(canSeeRosterStats(roster, actor('kn')), true, 'sekretarz (pytanie 11 b)');
  assert.equal(canSeeRosterStats(roster, actor('eo')), false);
  assert.equal(seesStatsNotes(roster, actor('ag')), false);
  assert.equal(seesStatsNotes(roster, actor('si')), true);
});
