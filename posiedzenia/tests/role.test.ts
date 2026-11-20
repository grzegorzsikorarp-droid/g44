import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, duplicateMeeting, envOf, newMeetingFromSettings, type Command, type Context} from '../src/shared/meeting.ts';
import {canCreate, canReadMinutes, canView, chairRank, minutesRefusal, openOption, settingsAccess, takeChairOption,
  canAcceptProposal, canAddDisplay, canAssignTask, canDownloadComms, canDownloadPaper, canEditComms, canEditProtocolOf, canFile,
  canFixProtocolOf, canPropose, canRejectProposal, canReleaseComms, canRemoveDisplay, canReport, canSeeCatalog, canSeeOwnStats,
  canSeeRosterStats, canSeeWorkspace, canSendAfter, canSendProgress, canSetPhotos, canSetStatsSince, canShow, closedBy,
  commsReleasedOk, isCommsAccount, isConvener, isLeading, isReferent, isReporting, isSecretary, isService, photoCircleText,
  seesLog, seesPhotos, seesPhotosLink, seesStatsNotes} from '../src/shared/role.ts';
import {effectiveMeeting} from '../src/shared/cascade.ts';
import {viewFor} from '../src/shared/view.ts';
import {defaultGeneral} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {seedSite} from '../src/server/seed.ts';
import {LAW} from '../src/shared/law.ts';
import type {Account, Actor, Meeting} from '../src/shared/types.ts';
import {actor, context, presidium, roster} from './helpers.ts';

// Role i uprawnienia wersji 3 (specyfikacja, rozdz. 4): D1, DA-2, DA-3, DA-12, DA-17, DA-19, DA-20, DA-21,
// próby P1–P19 z A3 (wynik z kolumny „Powinno być”), scenariusze K-2 i I-6 oraz strażnik G-12–G-18.

type Ctx = ReturnType<typeof context> & Context;
const chair = actor('si'), ag = actor('ag'), jw = actor('jw'), kn = actor('kn');
const office = actor(null, 'biuro', true);
const plainOffice = actor(null, 'biuro', false);
const memberAdmin = actor('eo', 'czlonek', true);
const guest: Actor = {account: {id: 'u-gosc', username: 'gosc', kind: 'gosc', personId: null, displayName: 'Jan Wiśniewski', label: 'radca prawny', admin: false, mustChange: false, disabled: false}, personId: null, name: 'Jan Wiśniewski'};
const advisory: Account = {id: 'u-kr', username: 'kr', kind: 'doradczy', personId: null, displayName: 'Halina Rewizyjna', label: '', admin: false, mustChange: false, disabled: false};
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
const last = (m: Meeting) => m.ballots.at(-1)!;

function setup(): Ctx {
  const ctx = context() as Ctx;
  ctx.general = {general: defaultGeneral(seedSite), docTypes: defaultDocTypes, revision: 1};
  ctx.accounts = [guest.account, advisory];
  return ctx;
}
const prepared = (ctx: Ctx) => newMeetingFromSettings({id: 'm1', kind: 'posiedzenie', date: '2026-11-20', time: '10:00', actor: office}, ctx);
/** Posiedzenie otwarte przez przewodniczącego; wymienione osoby zgłosiły obecność, a przewodniczący ją potwierdził. */
function opened(ctx: Ctx, present = presidium, m = prepared(ctx)) {
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of present.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  if (present.length > 1) m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  return m;
}
function procedure(ctx: Ctx, starter: Actor = chair, deputy?: string) {
  let m = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office, endsAt: ctx.now + 30 * 3600000}, ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu'}, office, ctx.tick());
  if (deputy) m = apply(m, {type: 'deputy', personId: deputy}, chair, ctx.tick());
  return apply(m, {type: 'open'}, starter, ctx.tick());
}
const refused = (fn: () => unknown, message: RegExp, status = 403) => assert.throws(fn, (e: Error & {status?: number}) => message.test(e.message) && e.status === status);

test('P1, P2: zastępcę wyznacza tylko przewodniczący; biuro i członek z flagą administratora nie (D1)', () => {
  const ctx = setup();
  const m = prepared(ctx);
  const message = /^Zastępcę wyznacza przewodniczący \(§ 16 ust\. 2\)\.$/;
  refused(() => apply(m, {type: 'deputy', personId: 'ag', basis: 'ustne polecenie'}, office, ctx), message);
  refused(() => apply(m, {type: 'deputy', personId: 'ag'}, memberAdmin, ctx), message);
  refused(() => apply(m, {type: 'deputy', personId: 'ag'}, jw, ctx), message);
  const next = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  assert.equal(next.chair.deputy, 'ag');
  assert.equal(next.chair.deputyBasis, 'wyznaczenie przez przewodniczącego (§ 16 ust. 2)');
  assert.deepEqual(next.chair.deputySet, {at: ctx.now, by: 'Sebastian Irzykowski', accountId: 'u-si'});
  assert.equal(next.log.at(-1)!.text, 'Zastępstwo przewodniczącego Anna Grzegorczyk, I Wiceprzewodnicząca, wyznaczenie przez przewodniczącego (§ 16 ust. 2).');
  assert.throws(() => apply(next, {type: 'deputy', personId: 'kn'}, chair, ctx), /Zastępcą przewodniczącego może być wiceprzewodniczący \(§ 16 ust\. 2\)\./);
  const removed = apply(next, {type: 'deputy', personId: null}, chair, ctx.tick());
  assert.equal(removed.log.at(-1)!.text, 'Usunięto wyznaczenie zastępcy przewodniczącego.');
});

test('P3: inny wiceprzewodniczący otwiera przy wyznaczonym zastępcy tylko z powodem do protokołu (DA-17)', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  assert.deepEqual(openOption(roster, m, jw), {allowed: true, basis: 'zamiast_zastepcy', needsReason: true});
  assert.throws(() => apply(m, {type: 'open'}, jw, ctx), /Zastępcą przewodniczącego na tym posiedzeniu jest Anna Grzegorczyk\. Podaj powód, dla którego otwierasz posiedzenie zamiast tej osoby\.$/);
  refused(() => apply(m, {type: 'open'}, office, ctx), /Posiedzenie otwiera przewodniczący albo wiceprzewodniczący \(§ 9 ust\. 1\)\./);
  refused(() => apply(m, {type: 'open'}, kn, ctx), /Posiedzenie otwiera przewodniczący albo wiceprzewodniczący/);
  m = apply(m, {type: 'open', reason: 'Zastępczyni jest w drodze.'}, jw, ctx.tick());
  const change = m.chair.changes[0];
  assert.deepEqual([change.basis, change.opening, change.reasonGiven, change.reason], ['zamiast_zastepcy', true, 'Zastępczyni jest w drodze.', 'otwarcie posiedzenia']);
  assert.equal(m.presenceLog.at(-1)!.via, 'otwarcie');
  // Wyznaczony zastępca i przewodniczący otwierają bez powodu; bez wyznaczenia każdy wiceprzewodniczący.
  const fresh = apply(prepared(setup()), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  assert.equal(apply(fresh, {type: 'open'}, ag, ctx.tick()).chair.changes[0].basis, 'zastepca');
  assert.equal(apply(prepared(setup()), {type: 'open'}, jw, ctx.tick()).chair.changes[0].basis, 'bez_wyznaczenia');
});

test('P4, P9, K-2: zgłoszona zastępczyni nie blokuje; druga wiceprzewodnicząca przejmuje z powodem, a zastępczyni po dojściu bez powodu; biuro niepotrzebne', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = opened(ctx, ['si', 'jw', 'kn', 'az', 'eo'], m);
  // Zastępczyni zgłasza obecność spoza sali (stan „zgloszony”), a osoba prowadząca wychodzi.
  m = apply(m, {type: 'presence', who: 'ag', present: true}, ag, ctx.tick());
  assert.equal(m.attendance.ag, 'zgloszony');
  m = apply(m, {type: 'presence', who: 'si', present: false}, chair, ctx.tick());
  // P5: druga wiceprzewodnicząca bez powodu nie przejmuje, bo pierwszeństwo ma zastępczyni.
  assert.throws(() => apply(m, {type: 'chair_take'}, jw, ctx), /Zastępcą przewodniczącego na tym posiedzeniu jest Anna Grzegorczyk\. Podaj powód, dla którego przejmujesz prowadzenie zamiast tej osoby\.$/);
  m = apply(m, {type: 'chair_take', reason: 'Zastępczyni jeszcze nie dotarła na salę.'}, jw, ctx.tick());
  assert.equal(m.chair.current, 'jw');
  assert.deepEqual([m.chair.changes.at(-1)!.basis, m.chair.changes.at(-1)!.reasonGiven], ['zamiast_zastepcy', 'Zastępczyni jeszcze nie dotarła na salę.']);
  assert.equal(m.log.at(-1)!.text, 'Prowadzenie obrad przejmuje Jolanta Woźniak, II Wiceprzewodnicząca, zamiast wyznaczonego zastępcy. Powód „Zastępczyni jeszcze nie dotarła na salę”.');
  // P4, P9: zastępczyni dochodzi i przejmuje bez powodu, bez potwierdzenia obecności przez biuro; obecność zapisuje się z przejęciem.
  assert.equal(chairRank(roster, m, 'ag'), 2);
  m = apply(m, {type: 'chair_take'}, ag, ctx.tick());
  assert.equal(m.chair.current, 'ag');
  assert.equal(m.chair.changes.at(-1)!.basis, 'zastepca');
  assert.equal(m.attendance.ag, 'obecny');
  const presence = m.presenceLog.at(-1)!;
  assert.deepEqual([presence.who, presence.type, presence.via, presence.by], ['ag', 'przybycie', 'prowadzenie', 'Anna Grzegorczyk']);
  assert.ok(presence.reportedAt, 'godzina zgłoszenia zostaje');
  assert.equal(m.log.at(-1)!.text, 'Prowadzenie obrad przejmuje Anna Grzegorczyk, I Wiceprzewodnicząca, zastępca wyznaczony przez przewodniczącego (§ 16 ust. 2). Obecność zapisano przy przejęciu.');
  assert.ok(!m.log.some(e => e.at >= m.openedAt! && e.by === 'Biuro Izby') && !m.presenceLog.some(e => e.by === 'Biuro Izby'), 'biuro w żadnym kroku obrad nie jest potrzebne');
  // Przewodniczący wraca i przejmuje od zastępczyni, która jest obecna (osoba wyżej w kolejności).
  m = apply(m, {type: 'chair_take'}, chair, ctx.tick());
  assert.deepEqual([m.chair.current, m.chair.changes.at(-1)!.basis], ['si', 'przewodniczacy']);
  // Osoba niżej w kolejności nie przejmuje od obecnej osoby prowadzącej.
  assert.throws(() => apply(m, {type: 'chair_take'}, jw, ctx), /Prowadzenie może przekazać osoba prowadząca\. Przejąć je od niej może przewodniczący albo zastępca, którego przewodniczący wyznaczył \(§ 16 ust\. 2\)\.$/);
});

test('I-6: powrót osoby, której wyjście zapisała osoba przejmująca, jeden raz; drugi zapis wyjścia jest odrzucany', () => {
  const ctx = setup();
  let m = opened(ctx);
  m = apply(m, {type: 'chair_handover', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'presence', who: 'si', present: false}, chair, ctx.tick());
  // Druga wiceprzewodnicząca zapisuje wyjście osoby prowadzącej i przejmuje (bez wyznaczonego zastępcy, bez powodu).
  assert.deepEqual(takeChairOption(roster, m, jw, {chairLeft: true}), {allowed: true, basis: 'bez_wyznaczenia', needsReason: false, recordsExit: true});
  m = apply(m, {type: 'chair_take', chairLeft: true}, jw, ctx.tick());
  assert.equal(m.chair.current, 'jw');
  assert.equal(m.attendance.ag, 'wyszedl');
  assert.equal(m.presenceLog.find(e => e.who === 'ag' && e.type === 'wyjscie')!.via, 'przejmujacy');
  assert.equal(m.chair.changes.at(-1)!.recordedExit, true);
  // Powrót: obecność zapisuje się razem z powrotem.
  m = apply(m, {type: 'chair_take'}, ag, ctx.tick());
  assert.deepEqual([m.chair.current, m.chair.changes.at(-1)!.basis, m.attendance.ag], ['ag', 'powrot', 'obecny']);
  assert.equal(m.log.at(-1)!.text, 'Prowadzenie obrad ponownie przejmuje Anna Grzegorczyk, I Wiceprzewodnicząca. Wcześniejsze wyjście tej osoby zapisano przy przejęciu prowadzenia.');
  // Ta sama osoba nie zapisze drugi raz wyjścia tej samej osoby prowadzącej.
  refused(() => apply(m, {type: 'chair_take', chairLeft: true}, jw, ctx), /^Wyjście tej osoby zapisano już raz\. Poproś ją o przekazanie prowadzenia\.$/);
  // Powrót nie przysługuje wobec wyznaczonego zastępcy: zastępca, który zapisał wyjście, prowadzi dalej.
  let d = apply(prepared(setup()), {type: 'deputy', personId: 'jw'}, chair, ctx.tick());
  d = opened(ctx, presidium, d);
  d = apply(d, {type: 'chair_handover', personId: 'ag'}, chair, ctx.tick());
  d = apply(d, {type: 'chair_take', chairLeft: true}, jw, ctx.tick());
  assert.equal(d.chair.changes.at(-1)!.basis, 'zastepca');
  refused(() => apply(d, {type: 'chair_take'}, ag, ctx), /Prowadzenie może przekazać osoba prowadząca/);
});

test('P6, P7, P8, P10 i DA-19: lista obecności jako obsługa biura; czynności organu tylko osoby prowadzącej', () => {
  const ctx = setup();
  let m = opened(ctx, ['si', 'ag', 'jw', 'kn']);
  m = apply(m, {type: 'presence', who: 'az', present: true}, actor('az'), ctx.tick());
  m = apply(m, {type: 'presence', who: 'eo', present: true}, actor('eo'), ctx.tick());
  refused(() => apply(m, {type: 'presence_confirm', who: 'az', accept: true}, jw, ctx), /^Obecność potwierdza osoba prowadząca obrady albo biuro\.$/);
  refused(() => apply(m, {type: 'presence', who: 'ak', present: true}, jw, ctx), /^Obecność innej osoby zapisuje osoba prowadząca obrady albo biuro\.$/);
  refused(() => apply(m, {type: 'presence_confirm', who: 'az', accept: true}, memberAdmin, ctx), /Obecność potwierdza osoba prowadząca obrady albo biuro/);
  refused(() => apply(m, {type: 'presence', who: 'si', present: false}, office, ctx), /^Obecność osoby prowadzącej obrady zapisuje ta osoba\.$/);
  refused(() => apply(m, {type: 'presence_confirm', who: 'az', accept: false}, office, ctx), /^Zgłoszenie obecności odrzuca osoba prowadząca obrady\.$/);
  refused(() => apply(m, {type: 'presence', who: 'az', present: false}, office, ctx), /^Zgłoszenie obecności odrzuca osoba prowadząca obrady\.$/);
  // Biuro potwierdza zgłoszenie (także konto biura bez flagi administratora).
  m = apply(m, {type: 'presence_confirm', who: 'az', accept: true}, plainOffice, ctx.tick());
  assert.equal(m.attendance.az, 'obecny');
  m = apply(m, {type: 'presence_confirm', who: 'eo', accept: false}, chair, ctx.tick());
  assert.equal(m.attendance.eo, 'nieobecny');
  // W trakcie otwartego głosowania biuro nie zapisuje wyjścia osoby uprawnionej, ale zapisuje przybycie.
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 5}, chair, ctx.tick());
  refused(() => apply(m, {type: 'presence', who: 'kn', present: false}, office, ctx), /^Wyjście w trakcie głosowania zapisuje osoba prowadząca obrady\.$/);
  m = apply(m, {type: 'presence', who: 'ak', present: true}, office, ctx.tick());
  assert.ok(last(m).eligible.includes('ak'));
  m = apply(m, {type: 'ballot_absent', ballotId: last(m).id, personId: 'kn'}, chair, ctx.tick());
  assert.ok(last(m).absentDuring.includes('kn'));
  refused(() => apply(m, {type: 'ballot_absent', ballotId: last(m).id, personId: 'jw'}, office, ctx), /osoba prowadząca posiedzenie/);
});

test('P11–P15: zastępca spoza sali, „Co jest głosowane” i gość w trakcie obrad, materiał po zamknięciu', () => {
  const ctx = setup();
  let m = opened(ctx);
  m = apply(m, {type: 'chair_handover', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'presence', who: 'si', present: false}, chair, ctx.tick());
  // P11: przewodniczący poza salą zmienia zastępcę w trakcie obrad.
  m = apply(m, {type: 'deputy', personId: 'jw'}, chair, ctx.tick());
  assert.equal(m.chair.deputy, 'jw');
  const reports = item(m, 'sprawozdania');
  refused(() => apply(m, {type: 'item_edit', itemId: reports.id, docType: 'stanowisko', reason: 'x'}, office, ctx), /^W trakcie obrad rodzaj sprawy zmienia osoba prowadząca obrady\.$/);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: reports.id, docType: 'stanowisko'}, ag, ctx), /Podaj powód zmiany rodzaju sprawy\. Trafi do protokołu\.$/);
  refused(() => apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, office, ctx), /^W trakcie obrad gościa dopuszcza osoba prowadząca obrady\.$/);
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, ag, ctx.tick());
  assert.ok(m.invited.includes('u-gosc'));
  m = apply(m, {type: 'close', reason: 'Koniec czasu.'}, ag, ctx.tick());
  const withMaterial = {...m, materials: [{id: 'mat', title: 'Apel', type: 'apel', number: '', version: 1, hash: 'x', size: 1, fileId: null, fileName: null, createdAt: 0}]};
  assert.throws(() => apply(withMaterial, {type: 'item_material', itemId: reports.id, materialId: 'mat', on: true}, office, ctx), /Posiedzenie zostało zamknięte\.$/);
  assert.throws(() => apply(m, {type: 'item_edit', itemId: reports.id, docType: 'apel'}, office, ctx), /Posiedzenie zostało zamknięte\.$/);
  // Po zamknięciu notatki zostają przy biurze, przewodniczącym i ostatniej osobie prowadzącej.
  assert.equal(apply(m, {type: 'item_edit', itemId: reports.id, note: 'Notatka'}, office, ctx.tick()).agenda.find(i => i.id === reports.id)!.note, 'Notatka');
  refused(() => apply(m, {type: 'item_edit', itemId: reports.id, note: 'Notatka'}, jw, ctx), /Notatki do protokołu prowadzi osoba prowadząca obrady albo biuro\./);
});

test('P16–P19, DA-3, DA-12: głosowanie między posiedzeniami zarządza osoba, która je rozpoczęła, i przewodniczący', () => {
  const ctx = setup();
  // Wiceprzewodnicząca bez wyznaczenia nie rozpoczyna; zastępca wyznaczony na to głosowanie rozpoczyna.
  let draft = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office, endsAt: ctx.now + 30 * 3600000}, ctx);
  draft = apply(draft, {type: 'item_add', title: 'Uchwała nr 120/IX/2026'}, office, ctx.tick());
  const g18 = /^Głosowanie między posiedzeniami rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie \(§ 16 ust\. 2\)\.$/;
  refused(() => apply(draft, {type: 'open'}, jw, ctx), g18);
  refused(() => apply(draft, {type: 'open'}, office, ctx), g18);
  let m = procedure(ctx, ag, 'ag');
  assert.equal(m.chair.current, 'ag');
  // P16: przewodniczący zmienia termin głosowania rozpoczętego przez zastępczynię.
  m = apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 40 * 3600000}, chair, ctx.tick());
  assert.equal(m.deadlineChanges!.length, 1);
  // P17: druga wiceprzewodnicząca nie przerywa.
  const manager = /^Tę czynność wykonuje osoba, która rozpoczęła głosowanie, albo przewodniczący\.$/;
  refused(() => apply(m, {type: 'procedure_end', how: 'przerwij', reason: 'błąd'}, jw, ctx), manager);
  refused(() => apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 50 * 3600000}, office, ctx), manager);
  refused(() => apply(m, {type: 'ballot_close', ballotId: m.ballots[0].id}, jw, ctx), manager);
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots[0].id, choice: 'za'}, actor(p), ctx.tick());
  // DA-3: wynik przed ogłoszeniem widzi zarządzająca i przewodniczący, nie biuro ani członek z flagą administratora.
  for (const who of [office, memberAdmin, jw, kn]) assert.equal(viewFor(m, who, roster).ballots[0].result, undefined);
  for (const who of [ag, chair]) assert.ok(viewFor(m, who, roster).ballots[0].result);
  // P18, P19.
  const announce = /^Wynik ogłasza osoba, która rozpoczęła głosowanie, albo przewodniczący\.$/;
  refused(() => apply(m, {type: 'announce', ballotId: m.ballots[0].id}, office, ctx), announce);
  refused(() => apply(m, {type: 'announce', ballotId: m.ballots[0].id}, memberAdmin, ctx), announce);
  m = apply(m, {type: 'announce', ballotId: m.ballots[0].id}, ag, ctx.tick());
  assert.ok(m.ballots[0].announcedAt);
});

test('DA-21, G-18: termin krótszy niż 24 godziny tylko z powodem; rozpoczęcie dopisuje informację do kanału', () => {
  const ctx = setup();
  let m = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office, endsAt: ctx.now + 6 * 3600000}, ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 121/IX/2026'}, office, ctx.tick());
  const short = /Głosowanie potrwa krócej niż 24 godziny\. Podaj powód\. Trafi do dokumentu z przebiegu głosowania\.$/;
  assert.throws(() => apply(m, {type: 'open'}, chair, ctx), short);
  m = apply(m, {type: 'open', reason: 'Termin wyznaczony przez Okręgową Radę.'}, chair, ctx.tick());
  assert.deepEqual([m.shortTerm!.reason, m.shortTerm!.by, m.shortTerm!.accountId], ['Termin wyznaczony przez Okręgową Radę.', 'Sebastian Irzykowski', 'u-si']);
  assert.equal(m.messages[0].author, 'u-si');
  // Poprawki po kontroli v3 (D-DZ-V3-04, DA-21): informacja w kanale podaje przedmiot (tytuły spraw w kolejności) i termin.
  assert.match(m.messages[0].text, /^Rozpoczęto głosowanie między posiedzeniami w 2 sprawach, „Uchwała nr 120\/IX\/2026” i „Uchwała nr 121\/IX\/2026”\. Głosowanie potrwa do 20 listopada 2026 r\., godz\. 17:00\.$/);
  assert.throws(() => apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 8 * 3600000}, chair, ctx), short);
  m = apply(m, {type: 'procedure_deadline', endsAt: ctx.now + 30 * 3600000}, chair, ctx.tick());
  assert.equal(m.status, 'trwa');
});

test('DA-20, G-17: gość czyta kanał wiadomości, ale w nim nie pisze; osoba z głosem doradczym i biuro piszą', () => {
  const ctx = setup();
  let m = opened(ctx);
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, chair, ctx.tick());
  refused(() => apply(m, {type: 'message', text: 'Dzień dobry'}, guest, ctx), /^Goście czytają wiadomości, ale ich nie piszą\.$/);
  assert.ok(canView(roster, m, guest));
  m = apply(m, {type: 'message', text: 'Materiały są w aplikacji.'}, office, ctx.tick());
  const adv: Actor = {account: advisory, personId: null, name: advisory.displayName};
  m = apply(m, {type: 'message', text: 'Uwaga do punktu 3.'}, adv, ctx.tick());
  assert.equal(m.messages.length, 2);
});

test('DA-2: flaga administratora nie daje uprawnień w posiedzeniach ani w ustawieniach; konto biura z flagą ma obie role', () => {
  const ctx = setup();
  const m = prepared(ctx);
  const adminOnly: Actor = {account: {...advisory, id: 'u-adm', kind: 'gosc', admin: true}, personId: null, name: 'Administrator'};
  assert.equal(canView(roster, m, adminOnly), false, 'administrator bez innej roli nie widzi posiedzeń');
  refused(() => apply(m, {type: 'details', place: 'Sala'}, memberAdmin, ctx), /Dane posiedzenia zmienia biuro, przewodniczący albo wiceprzewodniczący\./);
  assert.equal(canCreate(roster, 'prezydium', memberAdmin), false);
  assert.equal(canCreate(roster, 'prezydium', office), true);
  assert.deepEqual(settingsAccess(roster, office), {general: 'zmienia', accounts: true});
  assert.deepEqual(settingsAccess(roster, plainOffice), {general: 'zmienia', accounts: false});
  assert.deepEqual(settingsAccess(roster, memberAdmin), {general: null, accounts: true});
  assert.deepEqual(settingsAccess(roster, jw), {general: 'czyta', accounts: false});
  assert.deepEqual(settingsAccess(roster, kn), {general: null, accounts: false});
  assert.throws(() => newMeetingFromSettings({id: 'x', kind: 'posiedzenie', actor: memberAdmin}, ctx), /Posiedzenie przygotowuje biuro, przewodniczący lub wiceprzewodniczący\./);
});

test('G-12, G-13, G-14: organ, tryb w głosowaniu między posiedzeniami i zaproszenie gościa', () => {
  const ctx = setup();
  assert.throws(() => newMeetingFromSettings({id: 'x', kind: 'posiedzenie', organ: 'rada', actor: office}, ctx), /Posiedzeń tego organu nie prowadzimy jeszcze w aplikacji\.$/);
  ctx.law = {prezydium: {...LAW.prezydium, betweenMeetings: {allowed: false, reason: 'Głosowanie między posiedzeniami przewiduje regulamin tylko dla Prezydium (§ 14 ust. 5).'}, remote: {allowed: false, reason: 'Regulamin Okręgowego Zjazdu nie przewiduje obrad zdalnych.'}}};
  assert.throws(() => newMeetingFromSettings({id: 'x', kind: 'procedura', actor: office}, ctx), /Głosowanie między posiedzeniami przewiduje regulamin tylko dla Prezydium \(§ 14 ust\. 5\)\.$/);
  assert.throws(() => newMeetingFromSettings({id: 'x', kind: 'posiedzenie', mode: 'zdalne', actor: office}, ctx), /nie przewiduje obrad zdalnych/);
  delete ctx.law;
  let p = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office}, ctx);
  p = apply(p, {type: 'item_add', title: 'Uchwała nr 120/IX/2026'}, office, ctx.tick());
  assert.throws(() => apply(p, {type: 'item_mode', itemId: p.agenda[0].id, mode: 'tajne', basis: 'uchwała'}, office, ctx),
    /Wpisz, kiedy Prezydium uchwaliło tajność albo głosowanie imienne\. Podaj numer uchwały albo głosowania i datę\.$/);
  p = apply(p, {type: 'item_mode', itemId: p.agenda[0].id, mode: 'tajne', decision: {kind: 'glosowanie', number: 3, date: '2026-11-12'}}, office, ctx.tick());
  assert.equal(p.agenda[0].modeBasis, 'głosowanie nr 3 na posiedzeniu Prezydium z dnia 12.11.2026');
  let m = prepared(ctx);
  assert.throws(() => apply(m, {type: 'invite', accountId: 'u-gosc', on: true}, office, ctx), /Wskaż, kto zaprasza gościa \(§ 7 ust\. 3\)\.$/);
  assert.throws(() => apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'organ'}, office, ctx), /Wpisz, kiedy Prezydium zaprosiło gościa, np\. datę posiedzenia albo numer uchwały\.$/);
  assert.throws(() => apply(m, {type: 'invite', accountId: 'u-kr', on: false}, office, ctx), /Osoby z głosem doradczym zawiadamia się o każdym posiedzeniu \(§ 7 ust\. 2\)\.$/);
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'organ', decision: 'uchwała nr 98/IX/2026'}, office, ctx.tick());
  assert.deepEqual(m.guestInvites!['u-gosc'], {by: 'organ', decision: 'uchwała nr 98/IX/2026', at: ctx.now, recordedBy: 'Biuro Izby', accountId: 'u-biuro'});
  assert.equal(m.log.at(-1)!.text, 'Dodano gościa Jan Wiśniewski na zaproszenie Prezydium, uchwała nr 98/IX/2026 (§ 7 ust. 3).');
});

test('macierz uprawnień: polecenie × rola × stan (wybrane czynności organu i obsługi)', () => {
  const ctx = setup();
  const prep = prepared(ctx);
  const live = opened(ctx);
  const cases: [string, Meeting, Command, Actor, boolean][] = [
    ['dane posiedzenia w przygotowaniu, wiceprzewodnicząca', prep, {type: 'details', place: 'Sala A'}, jw, true],
    ['dane posiedzenia w przygotowaniu, członek', prep, {type: 'details', place: 'Sala A'}, kn, false],
    ['projekt porządku w przygotowaniu, biuro', prep, {type: 'item_add', title: 'Patronat'}, office, true],
    ['projekt porządku po otwarciu, biuro', live, {type: 'item_add', title: 'Patronat'}, office, false],
    ['projekt porządku po otwarciu, osoba prowadząca', live, {type: 'item_add', title: 'Patronat'}, chair, true],
    ['ekran sali, projekt porządku, osoba prowadząca', live, {type: 'present', kind: 'projekt', id: 'm1'}, chair, true],
    ['ekran sali, projekt porządku, biuro', live, {type: 'present', kind: 'projekt', id: 'm1'}, office, false],
    ['kworum, biuro', live, {type: 'quorum'}, office, false],
    ['potwierdzenie wszystkich zgłoszeń, biuro', apply(live, {type: 'presence', who: 'ak', present: false}, chair, ctx.tick()), {type: 'presence', who: 'ak', present: true}, office, true],
    ['dane do protokołu po otwarciu, wiceprzewodnicząca bez prowadzenia', live, {type: 'details', recorder: 'Anna Nowak'}, jw, false],
    ['dane do protokołu po otwarciu, biuro', live, {type: 'details', recorder: 'Anna Nowak'}, office, true],
    ['materiał w trakcie obrad, wiceprzewodnicząca bez prowadzenia', live, {type: 'item_material', itemId: item(live, 'uchwaly').id, materialId: 'brak', on: true}, jw, false],
  ];
  for (const [name, m, cmd, who, ok] of cases) {
    if (ok) assert.doesNotThrow(() => apply(m, cmd, who, ctx), name);
    else assert.throws(() => apply(m, cmd, who, ctx), (e: Error & {status?: number}) => e.status === 403, name);
  }
});

// Poprawki po kontroli rdzenia wersji 3 (D-DZ-V3-01, W-W-06): domyślny termin głosowania między posiedzeniami liczy się
// od rozpoczęcia, więc głosowanie z ustawieniami domyślnymi nie wymaga powodu krótszego terminu (DA-21).
test('DA-21: domyślne głosowanie między posiedzeniami rozpoczęte bez powodu trwa 24 godziny od rozpoczęcia', () => {
  const ctx = setup();
  let m = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office}, ctx);
  assert.equal(m.endsAt, undefined);
  m = apply(m, {type: 'item_add', title: 'Uchwała w sprawie próby'}, office, ctx.tick(3 * 3600000));
  const review = viewFor(m, office, roster, envOf(ctx, 'prezydium')).effective!.review!;
  assert.ok(!review.some(r => r.text.startsWith('Głosowanie potrwa krócej niż 24 godziny')), 'przegląd bez ostrzeżenia o krótszym terminie');
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  assert.equal(m.shortTerm, undefined);
  assert.equal(m.endsAt, ctx.now + 24 * 3600000);
  assert.equal(m.messages[0].text, 'Rozpoczęto głosowanie między posiedzeniami w sprawie „Uchwała w sprawie próby”. Głosowanie potrwa do 21 listopada 2026 r., godz. 14:00.');
  assert.deepEqual(effectiveMeeting(envOf(ctx, 'prezydium'), m).deviations.filter(d => d.kind === 'termin_procedury'), []);
});

test('DA-21: termin wpisany ręcznie obowiązuje, a „Przywróć” wraca do czasu z ustawień ogólnych od rozpoczęcia', () => {
  const ctx = setup();
  let m = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office}, ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026'}, office, ctx.tick());
  m = apply(m, {type: 'details', endsAt: ctx.now + 5 * 3600000}, office, ctx.tick());
  assert.deepEqual(m.endsAtSet, {at: ctx.now, by: 'Biuro Izby', accountId: 'u-biuro'});
  assert.equal(m.log.at(-1)!.text, 'Zmieniono koniec głosowania z 24 godziny od rozpoczęcia na 20 listopada 2026 r., godz. 16:00.');
  const review = viewFor(m, office, roster, envOf(ctx, 'prezydium')).effective!.review!;
  assert.ok(review.some(r => r.text === 'Głosowanie potrwa krócej niż 24 godziny. Przy rozpoczęciu trzeba będzie podać powód.'));
  assert.throws(() => apply(m, {type: 'open'}, chair, ctx), /Głosowanie potrwa krócej niż 24 godziny\. Podaj powód\./);
  m = apply(m, {type: 'details', endsAt: null}, office, ctx.tick());
  assert.equal(m.endsAt, undefined);
  assert.equal(m.log.at(-1)!.text, 'Przywrócono koniec głosowania z ustawień ogólnych (24 godziny od rozpoczęcia).');
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  assert.equal(m.shortTerm, undefined);
});

// D-DZ-V3-02 (macierz 4.3, DA-10): projekt protokołu w trakcie obrad i przebieg obrad według ról.
test('macierz 4.3: projekt protokołu w trakcie widzą biuro, przewodniczący, zastępca i prowadzący, po zamknięciu także członkowie', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = opened(ctx, presidium, m);
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, chair, ctx.tick());
  const adv: Actor = {account: advisory, personId: null, name: advisory.displayName};
  const reads = (who: Actor, meeting = m) => canReadMinutes(roster, meeting, who);
  assert.deepEqual([reads(office), reads(chair), reads(ag), reads(jw), reads(kn), reads(guest), reads(adv), reads(actor(null, 'biuro', true))], [true, true, true, false, false, false, false, true]);
  const viceChairs = apply(m, {type: 'chair_handover', personId: 'jw'}, chair, ctx.tick());
  assert.equal(reads(jw, viceChairs), true, 'osoba prowadząca obrady widzi projekt protokołu');
  assert.equal(reads(kn, {...m, status: 'zakonczone'}), true, 'po zamknięciu członek widzi projekt protokołu');
  assert.equal(reads(guest, {...m, status: 'zakonczone'}), false);
  assert.equal(minutesRefusal, 'Projekt protokołu w trakcie obrad widzą biuro i osoby prowadzące obrady.');
  // DA-10: przebieg obrad bez gości i osób z głosem doradczym (zostają tylko wpisy o zmianach projektu porządku, D2).
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  assert.ok(viewFor(m, kn, roster).log.length > 3);
  for (const who of [guest, adv]) assert.ok(viewFor(m, who, roster).log.every(l => l.tag === 'projekt'), who.name);
});

// D-DZ-V3-03 (rozdz. 4.5 pkt 6): powielenie nie kopiuje zastępcy ani gości, ale kopia pamięta źródło.
test('powielenie: kopia bez zastępcy i gości, z danymi źródła do „Wyznacz ponownie” i „Zaproś ponownie”', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, office, ctx.tick());
  const {meeting: copy} = duplicateMeeting(m, {id: 'c1', now: ctx.now, newId: ctx.newId, createdBy: 'Biuro Izby', advisory: ['u-kr']});
  assert.equal(copy.chair.deputy, null);
  assert.deepEqual(copy.invited, ['u-kr']);
  assert.deepEqual(copy.duplicatedFrom, {id: 'm1', date: '2026-11-20', deputy: 'ag', invited: ['u-gosc']});
  assert.equal(effectiveMeeting(envOf(ctx, 'prezydium'), copy).deviations.length, 0);
});

// D-DZ-V3-06: po otwarciu odmowa zmiany projektu porządku dla biura mówi, kto go zmienia (D1, DA-9).
test('D1: po otwarciu projekt porządku obrad zmienia tylko osoba prowadząca, a komunikat nie wskazuje biura', () => {
  const ctx = setup();
  const m = opened(ctx);
  const message = /^Po otwarciu posiedzenia projekt porządku obrad zmienia osoba prowadząca obrady \(§ 9 ust\. 1\)\.$/;
  refused(() => apply(m, {type: 'item_add', title: 'Patronat'}, office, ctx), message);
  refused(() => apply(m, {type: 'item_place', itemId: item(m, 'uchwaly').id, parentId: null, beforeId: null}, office, ctx), message);
  refused(() => apply(m, {type: 'item_add', title: 'Patronat'}, jw, ctx), message);
  refused(() => apply(prepared(ctx), {type: 'item_add', title: 'Patronat'}, kn, ctx), /^Porządek obrad poprawia biuro, przewodniczący albo wiceprzewodniczący, a po otwarciu posiedzenia osoba prowadząca obrady\.$/);
});


// ---------------------------------------------------------------------------------------------------------------------
// Wersja 4 (SPEC-4 rozdz. 4.2–4.4, DB-44, etap D.1 pkt 3 i 8): nazwane kręgi i funkcje nowych czynności. Macierze
// 4.3.1–4.3.6 przez polecenia i trasy sprawdza etap D.2; tu funkcje na posiedzeniu w każdym stanie.

const comms: Actor = {account: {id: 'u-kom', username: 'komunikacja', kind: 'komunikacja', personId: null, displayName: 'Komunikacja', label: '', admin: false, mustChange: false, disabled: false}, personId: null, name: 'Komunikacja'};
const adv: Actor = {account: advisory, personId: null, name: advisory.displayName};
const adminOnly: Actor = {account: {id: 'u-adm', username: 'adm', kind: 'czlonek', personId: null, displayName: 'Administrator', label: '', admin: true, mustChange: false, disabled: false}, personId: null, name: 'Administrator'};
const az = actor('az'), eo = actor('eo');
/** Posiedzenie w danym stanie: osoba prowadząca, zastępca i zwołujący jak w argumentach. */
function state(status: Meeting['status'], o: {current?: string | null; deputy?: string | null; convener?: string} = {}): Meeting {
  const ctx = setup();
  const m = prepared(ctx);
  return {...m, status, chair: {...m.chair, current: o.current ?? (status === 'przygotowanie' ? null : 'si'), deputy: o.deputy ?? null}, convener: o.convener};
}

test('wersja 4: kręgi kierujący, sprawozdawczość i obsługa (DB-44)', () => {
  assert.deepEqual([chair, ag, jw, kn, az, eo].map(a => isLeading(roster, a)), [true, true, true, false, false, false]);
  assert.deepEqual([chair, ag, jw, kn, az, eo].map(a => isReporting(roster, a)), [true, true, true, true, false, false]);
  assert.deepEqual([office, plainOffice, chair, adminOnly, comms].map(a => isService(a)), [true, true, false, false, false]);
  assert.equal(isSecretary(roster, null, 'kn'), true);
  assert.equal(isSecretary(roster, null, 'eo'), false);
  assert.deepEqual([office, chair, ag, kn, eo, adminOnly, comms].map(a => canReport(roster, a)), [true, true, true, true, false, false, false]);
});

test('wersja 4: konto „Komunikacja” widzi tylko wiersz katalogu i materiał po udostępnieniu (4.4, DB-42)', () => {
  const closed = state('zakonczone');
  assert.equal(isCommsAccount(comms), true);
  assert.equal(canView(roster, closed, comms), false);
  assert.equal(seesLog(comms), false);
  assert.equal(canSeeCatalog(roster, closed, comms), 'wiersz');
  assert.equal(canSeeCatalog(roster, state('trwa'), comms), null);
  assert.equal(canSeeCatalog(roster, closed, kn), 'pelny');
  assert.equal(canDownloadComms(roster, closed, comms), false, 'bez udostępnienia');
  const released = {...closed, commsReleased: {at: 1, by: 'Biuro', accountId: 'u-biuro', inputs: 0}, commsInputs: 0};
  assert.equal(commsReleasedOk(released), true);
  assert.equal(canDownloadComms(roster, released, comms), true);
  const changed = {...released, commsInputs: 1};
  assert.equal(canDownloadComms(roster, changed, comms), false, 'zmiana treści po udostępnieniu wymaga ponownego udostępnienia');
  for (const id of ['protokol', 'porzadek', 'obecnosc', 'wyniki', 'kanal', 'dziennik', 'teczka'] as const) assert.equal(canDownloadPaper(roster, released, comms, id), false, id);
  assert.equal(canDownloadPaper(roster, released, comms, 'komunikacja'), true);
  assert.equal(canSetPhotos(roster, closed, comms), true);
  assert.equal(canSetPhotos(roster, state('trwa'), comms), false);
  assert.equal(seesPhotosLink(roster, closed, comms), true);
  // Wszystkie pozostałe funkcje wersji 3 i 4 zwracają false.
  assert.deepEqual([canReadMinutes(roster, closed, comms), canFile(roster, closed, comms), canReleaseComms(roster, closed, comms), canEditComms(roster, closed, comms),
    canSendAfter(roster, closed, comms), canReport(roster, comms), seesPhotos(roster, comms), canSeeOwnStats(roster, comms), canSeeRosterStats(roster, comms),
    canSeeWorkspace(roster, closed, comms), canPropose(roster, state('przygotowanie'), comms), canCreate(roster, 'prezydium', comms)], Array(12).fill(false).map((x, i) => i === 9 ? null : x));
});

test('wersja 4: dokumenty posiedzenia według tabeli 4.3.3', () => {
  const live = state('trwa'), closed = state('zakonczone');
  const guestOn = (m: Meeting) => ({...m, invited: [guest.account.id, advisory.id]});
  // Porządek, wyniki, akty i kanał: każdy z canView, także gość i głos doradczy (gdy zaproszeni).
  for (const id of ['porzadek', 'wyniki', 'wykaz-3', 'akt-b1', 'kanal'] as const) {
    assert.deepEqual([office, chair, eo, guest, adv, adminOnly].map(a => canDownloadPaper(roster, guestOn(live), a, id)), [true, true, true, true, true, false], id);
  }
  // Projekt protokołu i lista obecności w trakcie: biuro, przewodniczący, osoba prowadząca, zastępca; po zamknięciu też członkowie.
  const liveAg = {...guestOn(live), chair: {...live.chair, current: 'ag', deputy: 'jw'}};
  assert.deepEqual([office, chair, ag, jw, kn, eo, guest, adv].map(a => canDownloadPaper(roster, liveAg, a, 'protokol')), [true, true, true, true, false, false, false, false]);
  assert.deepEqual([office, chair, kn, eo, guest, adv].map(a => canDownloadPaper(roster, guestOn(closed), a, 'obecnosc')), [true, true, true, true, false, false]);
  // Dziennik: biuro i członkowie także w trakcie, bez głosu doradczego i gości.
  assert.deepEqual([office, eo, guest, adv].map(a => canDownloadPaper(roster, guestOn(live), a, 'dziennik')), [true, true, false, false]);
  // Teczka tylko po zamknięciu.
  assert.deepEqual([office, chair, eo].map(a => canDownloadPaper(roster, live, a, 'teczka')), [false, false, false]);
  assert.deepEqual([office, chair, eo, guest].map(a => canDownloadPaper(roster, guestOn(closed), a, 'teczka')), [true, true, true, false]);
  // Materiał dla komunikacji: biuro, przewodniczący, wiceprzewodniczący i osoba, która zamknęła obrady; bez sekretarza i członków.
  const closedByEo = {...closed, chair: {...closed.chair, current: 'eo'}};
  assert.equal(closedBy(closedByEo), 'eo');
  assert.equal(closedBy(live), null);
  assert.deepEqual([office, chair, ag, kn, eo, az].map(a => canDownloadComms(roster, closedByEo, a)), [true, true, true, false, true, false]);
  assert.deepEqual([office, chair, ag].map(a => canDownloadComms(roster, live, a)), [false, false, false], 'materiał powstaje po zamknięciu');
  assert.deepEqual([office, chair, ag, kn, eo, az].map(a => canReleaseComms(roster, closedByEo, a)), [true, true, false, false, true, false]);
  assert.deepEqual([office, chair, ag, kn, eo].map(a => canEditComms(roster, closedByEo, a)), [true, true, false, false, true]);
  assert.deepEqual([office, chair, ag, kn].map(a => canEditComms(roster, state('przygotowanie'), a)), [true, true, true, false]);
  assert.deepEqual([office, chair].map(a => canEditComms(roster, live, a)), [false, false]);
  // „Protokół sporządzony” i pliki po posiedzeniu: biuro, przewodniczący, sekretarz; zawiadomienie także wcześniej.
  assert.deepEqual([office, chair, ag, kn, eo].map(a => canFile(roster, closed, a)), [true, true, false, true, false]);
  assert.deepEqual([office, kn].map(a => canFile(roster, live, a)), [false, false]);
  assert.deepEqual([office, kn].map(a => canFile(roster, live, a, 'zawiadomienie')), [true, true]);
  // Odnośnik do zdjęć: od otwarcia biuro, przewodniczący, osoba prowadząca; widzą członkowie, biuro, konto komunikacji.
  assert.deepEqual([office, chair, ag, eo].map(a => canSetPhotos(roster, state('przygotowanie'), a)), [false, false, false, false]);
  assert.deepEqual([office, chair, ag, eo].map(a => canSetPhotos(roster, liveAg, a)), [true, true, true, false]);
  assert.deepEqual([office, eo, guest, adv].map(a => seesPhotosLink(roster, guestOn(closed), a)), [true, true, false, false]);
  // Powiadomienie o dokumentach po zamknięciu: biuro, przewodniczący, osoba, która zamknęła obrady.
  assert.deepEqual([office, chair, ag, eo].map(a => canSendAfter(roster, closedByEo, a)), [true, true, false, true]);
  assert.deepEqual([office, chair].map(a => canSendAfter(roster, live, a)), [false, false]);
});

test('wersja 4: „Dotyczy protokołu” przed głosowaniem w punkcie i poprawka po zamknięciu tylko przewodniczącego (G-33, G-38)', () => {
  const live = state('trwa', {current: 'ag'});
  const it = live.agenda[0].id;
  assert.deepEqual([office, chair, ag].map(a => canEditProtocolOf(roster, live, a, it)), [false, false, true]);
  const voted = {...live, ballots: [{itemId: it, purpose: 'protokol'} as Meeting['ballots'][number]]};
  assert.equal(canEditProtocolOf(roster, voted, ag, it), false, 'po otwarciu głosowania w punkcie wartość utrwala się w głosowaniu');
  assert.deepEqual([office, chair, jw].map(a => canEditProtocolOf(roster, state('przygotowanie'), a, it)), [true, true, true]);
  assert.deepEqual([office, chair].map(a => canEditProtocolOf(roster, state('zakonczone'), a, it)), [false, false]);
  assert.deepEqual([office, chair, ag, kn].map(a => canFixProtocolOf(roster, state('zakonczone'), a)), [false, true, false, false]);
  assert.equal(canFixProtocolOf(roster, live, chair), false);
});

test('wersja 4: zgłoszenia odrzuca i odkłada tylko zwołujący; zastępca tylko, gdy zwołuje (DB-14, K4-3)', () => {
  const plain = state('przygotowanie');
  assert.deepEqual([office, chair, ag, jw, kn].map(a => canRejectProposal(roster, plain, a)), [false, true, false, false, false]);
  const byDeputy = state('przygotowanie', {deputy: 'ag', convener: 'ag'});
  assert.deepEqual([office, chair, ag, jw].map(a => canRejectProposal(roster, byDeputy, a)), [false, true, true, false]);
  assert.deepEqual([chair, ag, jw].map(a => isConvener(roster, byDeputy, a)), [true, true, false]);
  const deputyNotConvening = state('przygotowanie', {deputy: 'ag', convener: 'si'});
  assert.equal(canRejectProposal(roster, deputyNotConvening, ag), false, 'zastępca, który nie zwołuje, ma uprawnienia wiceprzewodniczącego');
  // Wpisanie do projektu: osoby przygotowujące, biuro jako obsługa; zgłasza członek i głos doradczy, nie biuro.
  assert.deepEqual([office, chair, jw, kn, adv].map(a => canAcceptProposal(roster, plain, a)), [true, true, true, false, false]);
  assert.deepEqual([office, chair, kn, eo, adv, guest, comms].map(a => canPropose(roster, plain, a)), [false, true, true, true, true, false, false]);
  assert.equal(canPropose(roster, state('trwa'), eo), false, 'po otwarciu bez nowych zgłoszeń (G-30)');
  assert.deepEqual([office, eo, adv, guest, adminOnly].map(a => canSeeWorkspace(roster, plain, a)), ['pelny', 'pelny', 'wlasne', null, null]);
  assert.deepEqual([office, chair, kn].map(a => canSendProgress(roster, plain, a)), [true, true, false], 'sekretarz nie przygotowuje posiedzeń (pytanie 2 b)');
  assert.equal(canSendProgress(roster, state('trwa'), office), false);
  // D-11: zadanie dla członka przydziela zwołujący, inni tylko sobie; zadanie dla biura każdy z pełnym wglądem.
  assert.deepEqual([canAssignTask(roster, plain, chair, {personId: 'eo'}), canAssignTask(roster, plain, jw, {personId: 'eo'}), canAssignTask(roster, plain, jw, {personId: 'jw'}), canAssignTask(roster, plain, eo, {office: true})], [true, false, true, true]);
  const withReferent = {...plain, agenda: plain.agenda.map((i, n) => n === 0 ? {...i, presenters: [{name: '', role: '', kind: 'referuje' as const}]} : i)};
  const eoName = roster.persons.find(p => p.id === 'eo')!.name;
  withReferent.agenda[0].presenters[0].name = eoName;
  assert.equal(isReferent(roster, withReferent, withReferent.agenda[0].id, 'eo'), true);
  assert.equal(isReferent(roster, withReferent, withReferent.agenda[0].id, 'ak'), false);
});

test('wersja 4: pokaz tylko osoba prowadząca, pliki do pokazania i zdjęcia (DB-11, DB-20, pytanie 13)', () => {
  const live = state('trwa', {current: 'ag'});
  assert.deepEqual([office, chair, ag].map(a => canShow(live, a)), [false, false, true]);
  assert.deepEqual([office, chair, ag, eo].map(a => canAddDisplay(roster, live, a)), [true, false, true, false]);
  assert.deepEqual([office, jw, kn].map(a => canAddDisplay(roster, state('przygotowanie'), a)), [true, true, false]);
  assert.equal(canAddDisplay(roster, state('zakonczone'), office), false);
  const shown = {...live, log: [...live.log, {at: 1, text: 'Pokazano plik.', by: 'x', tag: 'pokaz' as const, displayId: 'd1'}]};
  assert.equal(canRemoveDisplay(roster, shown, office, {id: 'd1'}), false, 'pokazany plik zostaje w dokumentacji (G-25)');
  assert.equal(canRemoveDisplay(roster, shown, office, {id: 'd2'}), true);
  // Pytanie 13, wariant (a): biuro, administrator, przewodniczący i wiceprzewodniczący.
  assert.deepEqual([office, plainOffice, adminOnly, chair, ag, jw, kn, eo, guest, adv, comms].map(a => seesPhotos(roster, a)), [true, true, true, true, true, true, false, false, false, false, false]);
  assert.equal(photoCircleText(roster), 'biuro, administrator, przewodniczący i wiceprzewodniczący');
});

test('wersja 4: statystyki — własne, składu (pytanie 11) i dzień startu (G-40)', () => {
  assert.deepEqual([chair, kn, eo, office, adminOnly, comms, adv].map(a => canSeeOwnStats(roster, a)), [true, true, true, false, false, false, false]);
  const former = actor('xx');
  const closed = {...state('zakonczone'), frozen: {at: 1, lawVersion: '', generalRevision: 0, members: [{personId: 'xx', func: 'czlonek' as const, label: '', order: 9}], docTypes: [], meeting: {} as never}};
  assert.equal(canSeeOwnStats(roster, former), false);
  assert.equal(canSeeOwnStats(roster, former, [closed]), true, 'osoba ze składu zapisanego przy otwarciu zakończonego posiedzenia');
  assert.deepEqual([office, chair, ag, kn, az, eo, comms].map(a => canSeeRosterStats(roster, a)), [true, true, true, true, false, false, false]);
  assert.deepEqual([office, chair, ag].map(a => seesStatsNotes(roster, a)), [true, true, false]);
  // Biuro ustawia albo przesuwa wstecz; dzień, który wyłącza policzone posiedzenia, wpisuje przewodniczący z powodem.
  assert.equal(canSetStatsSince(roster, office, null, '2026-01-01', '2026-03-12'), 'tak');
  assert.equal(canSetStatsSince(roster, office, '2026-06-01', '2026-02-01', '2026-06-02'), 'tak', 'przesunięcie wstecz');
  assert.equal(canSetStatsSince(roster, office, null, '2026-04-01', '2026-03-12'), 'nie');
  assert.equal(canSetStatsSince(roster, chair, null, '2026-04-01', '2026-03-12'), 'z_powodem');
  assert.equal(canSetStatsSince(roster, chair, null, '2026-01-01', '2026-03-12'), 'nie', 'zwykłe ustawienie należy do biura (4.3.6)');
  assert.equal(canSetStatsSince(roster, ag, null, '2026-01-01', '2026-03-12'), 'nie');
  assert.equal(canSetStatsSince(roster, office, '2026-03-01', null, '2026-03-12'), 'tak', 'wyczyszczenie to przesunięcie wstecz');
});
