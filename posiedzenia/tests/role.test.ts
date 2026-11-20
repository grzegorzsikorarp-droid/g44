import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, newMeetingFromSettings, type Command, type Context} from '../src/shared/meeting.ts';
import {canCreate, canView, chairRank, openOption, settingsAccess, takeChairOption} from '../src/shared/role.ts';
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
  assert.match(m.messages[0].text, /^Rozpoczęto głosowanie między posiedzeniami w 2 sprawach\. Głosowanie potrwa do 20 listopada 2026 r\., godz\. 17:00\.$/);
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
