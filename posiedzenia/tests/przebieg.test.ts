import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {minutesBody} from '../src/server/minutes.ts';
import {viewFor} from '../src/shared/view.ts';
import {cascadeEnv, effectiveMeeting, freezeLegacy} from '../src/shared/cascade.ts';
import {canReturn, takeChairOption} from '../src/shared/role.ts';
import {defaultGeneral} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {seedSite} from '../src/server/seed.ts';
import type {Account, Actor, Meeting} from '../src/shared/types.ts';
import {actor, context, presidium, roster} from './helpers.ts';

// Przebieg obrad wersji 3 przez polecenia domeny i projekt protokołu (specyfikacja, rozdz. 4.5, 4.6, 5.6–5.8, zespół C):
// zastępstwo i kolejność do prowadzenia (D1, DA-17, I-6), projekt porządku na żywo na spotkaniu roboczym (D2), odstępstwa
// w porządku i w punktach (DA-7, DA-8), zdania rozdz. 5.8 dosłownie oraz projekt protokołu posiedzeń sprzed wersji 3.

type Ctx = ReturnType<typeof context> & Context;
const chair = actor('si'), ag = actor('ag'), jw = actor('jw');
const office = actor(null, 'biuro', true);
const guest: Actor = {account: {id: 'u-gosc', username: 'gosc', kind: 'gosc', personId: null, displayName: 'Jan Wiśniewski', label: 'radca prawny', admin: false, mustChange: false, disabled: false}, personId: null, name: 'Jan Wiśniewski'};
const accounts: Account[] = [guest.account];
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
const last = (m: Meeting) => m.ballots.at(-1)!;
/** Tekst dokumentu bez znaczników, z twardymi spacjami zamienionymi na zwykłe. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\u00a0\u2060]/g, ' ').replace(/\s+/g, ' ');
const doc = (m: Meeting) => text(minutesBody(m, roster, accounts, Date.parse('2026-11-20T15:00:00Z'), {office: 'biuro Izby'}));
const T = '\\d\\d:\\d\\d';

function setup(): Ctx {
  const ctx = context() as Ctx;
  ctx.general = {general: defaultGeneral(seedSite), docTypes: defaultDocTypes, revision: 1};
  ctx.accounts = accounts;
  return ctx;
}
const prepared = (ctx: Ctx) => newMeetingFromSettings({id: 'm1', kind: 'posiedzenie', date: '2026-11-20', time: '10:00', actor: office}, ctx);
function voteAll(m: Meeting, ctx: Ctx) {
  const b = last(m);
  for (const p of b.eligible) m = apply(m, {type: 'vote', ballotId: b.id, choice: 'za'}, actor(p), ctx.tick());
  return m;
}

test('D1 i DA-17 w przebiegu: zastępczyni zgłoszona spoza sali, przejęcie z powodem, przejęcie przez zastępczynię i zdania protokołu', () => {
  const ctx = setup();
  let m = prepared(ctx);
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si' && p !== 'ag')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, office, ctx.tick());
  // Zastępczyni zgłasza obecność spoza sali (stan „zgloszony”), a osoba prowadząca wychodzi.
  m = apply(m, {type: 'presence', who: 'ag', present: true}, ag, ctx.tick());
  assert.equal(m.attendance.ag, 'zgloszony');
  m = apply(m, {type: 'presence', who: 'si', present: false}, chair, ctx.tick());
  // Druga wiceprzewodnicząca przejmuje prowadzenie zamiast zastępcy tylko z powodem, bez biura.
  const opt = takeChairOption(roster, m, jw);
  assert.ok(opt.allowed && opt.needsReason && opt.basis === 'zamiast_zastepcy');
  assert.throws(() => apply(m, {type: 'chair_take'}, jw, ctx.tick()), /Zastępcą przewodniczącego na tym posiedzeniu jest Anna Grzegorczyk\. Podaj powód, dla którego przejmujesz prowadzenie zamiast tej osoby\./);
  m = apply(m, {type: 'chair_take', reason: 'zastępczyni jeszcze nie dotarła na salę'}, jw, ctx.tick());
  assert.equal(m.chair.current, 'jw');
  // Zastępczyni po dojściu przejmuje prowadzenie bez powodu; obecność zapisuje się z przejęciem.
  m = apply(m, {type: 'chair_take'}, ag, ctx.tick());
  assert.equal(m.chair.current, 'ag');
  assert.equal(m.attendance.ag, 'obecny');
  assert.equal(m.presenceLog.at(-1)!.via, 'prowadzenie');
  // Druga wiceprzewodnicząca zapisuje wyjście zastępczyni („Osoba prowadząca jest poza salą”), a zastępczyni wraca raz.
  m = apply(m, {type: 'chair_take', chairLeft: true, reason: 'zastępczyni wyszła z sali'}, jw, ctx.tick());
  assert.equal(m.chair.current, 'jw');
  assert.ok(canReturn(roster, m, 'ag'));
  m = apply(m, {type: 'chair_take'}, ag, ctx.tick());
  assert.equal(m.chair.current, 'ag');
  assert.throws(() => apply(m, {type: 'chair_take', chairLeft: true, reason: 'ponownie'}, jw, ctx.tick()), /Wyjście tej osoby zapisano już raz\. Poproś ją o przekazanie prowadzenia\./);
  // Zamknięcie i projekt protokołu ze zdaniami z rozdz. 5.8.
  m = apply(m, {type: 'close', reason: 'brak czasu'}, ag, ctx.tick());
  const body = doc(m);
  assert.match(body, new RegExp(`Zastępstwo przewodniczącego Anna Grzegorczyk, I Wiceprzewodnicząca, wyznaczenie przez przewodniczącego 20\\.11\\.2026, godz\\. ${T} \\(§ 16 ust\\. 2\\)\\.`));
  assert.match(body, /Posiedzenie otwiera Sebastian Irzykowski, Przewodniczący\./);
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Jolanta Woźniak, II Wiceprzewodnicząca \\(zamiast wyznaczonego zastępcy, powód „zastępczyni jeszcze nie dotarła na salę”\\)\\.`));
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Anna Grzegorczyk, I Wiceprzewodnicząca \\(zastępstwo wyznaczone przez przewodniczącego, § 16 ust\\. 2\\)\\.`));
  assert.match(body, new RegExp(`O godz\\. ${T} zapisano wyjście osoby prowadzącej obrady\\. Wyjście zapisała osoba, która przejęła prowadzenie\\. Od godz\\. ${T} obrady prowadzi Jolanta Woźniak, II Wiceprzewodnicząca \\(zamiast wyznaczonego zastępcy, powód „zastępczyni wyszła z sali”\\)\\.`));
  // Rozdział II: sposób zapisu obecności i wymagana większość po zdaniu o kworum.
  assert.match(body, /Sebastian Irzykowski Przewodniczący obecność od \d\d:\d\d, wyjście \d\d:\d\d obecność zapisana przy otwarciu posiedzenia/);
  assert.match(body, /Anna Grzegorczyk I Wiceprzewodnicząca obecność od \d\d:\d\d, wyjście \d\d:\d\d, powrót \d\d:\d\d obecność zapisana przy przejęciu prowadzenia obrad, wyjście zapisane przez osobę, która przejęła prowadzenie/);
  assert.match(body, /Skład Prezydium 7 osób, wymagane kworum 4 \(§ 8 ust\. 2\)\. Uchwały podejmuje się zwykłą większością głosów \(§ 8 ust\. 3\)\./);
  // DA-18: podpisuje osoba, która zamknęła posiedzenie, a pod podpisami pozostałe osoby prowadzące.
  assert.match(body, /Przewodniczący obrad Anna Grzegorczyk/);
  assert.match(body, /Obrady prowadzili także Sebastian Irzykowski, Przewodniczący i Jolanta Woźniak, II Wiceprzewodnicząca\./);
  assert.doesNotMatch(body, /Na czas nieobecności przewodniczącego/);
});

test('I-6 w przebiegu: powrót do prowadzenia jeden raz bez wyznaczonego zastępcy, dopiski przekazania, powrotu i braku wyznaczenia', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'chair_handover', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'chair_take', chairLeft: true}, jw, ctx.tick());
  assert.equal(m.chair.changes.at(-1)!.basis, 'bez_wyznaczenia');
  const back = takeChairOption(roster, m, ag);
  assert.ok(back.allowed && back.basis === 'powrot' && !back.needsReason);
  m = apply(m, {type: 'chair_take'}, ag, ctx.tick());
  assert.ok(!canReturn(roster, m, 'ag'), 'powrót przysługuje raz po każdym zapisie wyjścia');
  assert.equal(m.attendance.ag, 'obecny');
  const body = doc(m);
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Anna Grzegorczyk, I Wiceprzewodnicząca \\(przekazanie prowadzenia\\)\\.`));
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Jolanta Woźniak, II Wiceprzewodnicząca \\(bez wyznaczenia zastępcy przez przewodniczącego, § 9 ust\\. 1\\)\\.`));
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Anna Grzegorczyk, I Wiceprzewodnicząca \\(powrót do prowadzenia po wyjściu zapisanym przy przejęciu\\)\\.`));
  // Dziennik podpisuje osoba, a wpis o powrocie mówi o wcześniejszym zapisie wyjścia (O-07).
  assert.equal(m.log.at(-1)!.by, 'Anna Grzegorczyk');
  assert.match(m.log.at(-1)!.text, /^Prowadzenie obrad ponownie przejmuje Anna Grzegorczyk, I Wiceprzewodnicząca\. Wcześniejsze wyjście tej osoby zapisano przy przejęciu prowadzenia\.$/);
});

test('D2 w przebiegu: projekt porządku na żywo przez całe spotkanie robocze, tryb zmian tylko u osoby prowadzącej i wpisy z punktem', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'open'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'working_start', reason: 'brak_kworum'}, chair, ctx.tick());
  const env = cascadeEnv({roster, bundle: ctx.general!, organ: 'prezydium', accounts});
  m = apply(m, {type: 'item_start', itemId: item(m, 'protokol').id}, chair, ctx.tick());
  assert.equal(effectiveMeeting(env, m).meeting.draftLive.value, true, 'na spotkaniu roboczym projekt jest na żywo także poza punktem 2');
  // Tryb zmian włącza tylko osoba prowadząca (DA-9); biuro i członek dostają odmowę.
  assert.throws(() => apply(m, {type: 'present', kind: 'projekt', id: m.id}, office, ctx.tick()), /Tę czynność wykonuje osoba prowadząca posiedzenie\./);
  assert.throws(() => apply(m, {type: 'present', kind: 'projekt', id: 'inne'}, chair, ctx.tick()), /Nieprawidłowa prezentacja\./);
  m = apply(m, {type: 'present', kind: 'projekt', id: m.id}, chair, ctx.tick());
  assert.deepEqual(m.presentation && {kind: m.presentation.kind, id: m.presentation.id}, {kind: 'projekt', id: m.id});
  m = apply(m, {type: 'item_add', title: 'Informacja o szkoleniach', parentId: null}, chair, ctx.tick());
  const added = m.agenda.find(i => i.title === 'Informacja o szkoleniach')!;
  const entry = m.log.at(-1)!;
  assert.equal(entry.tag, 'projekt');
  assert.equal(entry.itemId, added.id);
  assert.match(entry.text, /^Zmieniono projekt porządku obrad\. Dodano punkt \d „Informacja o szkoleniach”\.$/);
  assert.throws(() => apply(m, {type: 'item_add', title: 'Punkt biura', parentId: null}, office, ctx.tick()), /403|osoba prowadząca|Porządek obrad poprawia/);
  // Członek widzi zmianę w swoim widoku (wpis dziennika z punktem i godziną) i stan „na żywo” z wartości skutecznej.
  const view = viewFor(m, actor('kn'), roster, env);
  assert.equal(view.effective!.meeting.draftLive.value, true);
  assert.ok(view.log.some(l => l.tag === 'projekt' && l.itemId === added.id));
  // „Zakończ zmiany” przywraca bieżący punkt na ekranie sali; projekt pozostaje na żywo do końca spotkania.
  m = apply(m, {type: 'present', kind: null}, chair, ctx.tick());
  assert.equal(m.presentation, null);
  m = apply(m, {type: 'close', reason: 'spotkanie robocze bez kworum'}, chair, ctx.tick());
  const body = doc(m);
  assert.match(body, /Notatka ze spotkania roboczego/);
  assert.match(body, /W trakcie spotkania osoba prowadząca obrady zmieniła projekt porządku obrad\./);
  assert.match(body, /dodano punkt \d „Informacja o szkoleniach”\./);
});

test('odstępstwa w protokole: punkt po zawiadomieniu, pominięty punkt z regulaminu, gość, zmiana rodzaju sprawy i sprawa bez głosowania', () => {
  const ctx = setup();
  let m = prepared(ctx);
  m = apply(m, {type: 'details', noticeDate: '2026-11-10'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Stanowisko w sprawie kształcenia', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 140/IX/2026 w sprawie patronatu', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  // Projekt uchwały jako materiał punktu: sprawa wymaga głosowania (DA-8).
  m.materials.push({id: 'mat1', title: 'Uchwała nr 140/IX/2026 w sprawie patronatu', type: 'uchwala', number: '140/IX/2026', version: 1, hash: 'abc', size: 10, fileId: null, fileName: null, createdAt: ctx.now});
  m = apply(m, {type: 'item_material', itemId: m.agenda.find(i => i.title.startsWith('Uchwała nr 140'))!.id, materialId: 'mat1', on: true}, office, ctx.tick());
  m = apply(m, {type: 'item_remove', itemId: item(m, 'protokol').id, reason: 'Projekt protokołu nie jest gotowy.'}, chair, ctx.tick());
  m = apply(m, {type: 'invite', accountId: guest.account.id, on: true, invitedBy: 'przewodniczacy'}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = apply(voteAll(m, ctx), {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());
  const position = m.agenda.find(i => i.title === 'Stanowisko w sprawie kształcenia')!;
  // G-10, DA-8: „Co jest głosowane” w trakcie obrad zmienia osoba prowadząca, zawsze z powodem do protokołu.
  assert.throws(() => apply(m, {type: 'item_edit', itemId: position.id, docType: 'stanowisko', reason: 'x'}, office, ctx.tick()), /W trakcie obrad rodzaj sprawy zmienia osoba prowadząca obrady\./);
  m = apply(m, {type: 'item_edit', itemId: position.id, docType: 'stanowisko', reason: 'Projekt zawiera stanowisko, a nie uchwałę.'}, chair, ctx.tick());
  const patronage = m.agenda.find(i => i.title.startsWith('Uchwała nr 140'))!;
  m = apply(m, {type: 'item_edit', itemId: patronage.id, docType: 'informacja', reason: 'Projekt wymaga uzupełnienia.'}, chair, ctx.tick());
  const no = (id: string) => {
    const top = m.agenda.filter(i => !i.parentId);
    const it = m.agenda.find(i => i.id === id)!;
    return it.parentId ? `${top.findIndex(i => i.id === it.parentId) + 1}.${m.agenda.filter(i => i.parentId === it.parentId).indexOf(it) + 1}` : String(top.indexOf(it) + 1);
  };
  const body = doc(m);
  assert.match(body, new RegExp(`Punkt ${no(position.id).replace('.', '\\.')} „Stanowisko w sprawie kształcenia” dodano do projektu porządku obrad po wysłaniu zawiadomienia \\(§ 7 ust\\. 1\\)\\.`));
  assert.match(body, /Z projektu porządku obrad pominięto punkt „Przyjęcie protokołu z poprzedniego posiedzenia”, wymieniony w § 9 ust\. 2 pkt 5\. Punkt pominięto decyzją Sebastian Irzykowski, Przewodniczący\. Powód „Projekt protokołu nie jest gotowy”\./);
  assert.match(body, /Gość Jan Wiśniewski, radca prawny uczestniczy na zaproszenie przewodniczącego \(§ 7 ust\. 3\)\./);
  assert.match(body, new RegExp(`W punkcie ${no(position.id).replace('.', '\\.')} zmieniono rodzaj sprawy z „Bez rodzaju” na „Stanowisko”\\. Powód „Projekt zawiera stanowisko, a nie uchwałę”\\.`));
  assert.match(body, new RegExp(`W punkcie ${no(patronage.id).replace('.', '\\.')} sprawy nie poddano pod głosowanie\\. Powód „Projekt wymaga uzupełnienia”\\.`));
});

test('rozdział V: „Podjęte uchwały i inne akty”, gdy w wykazie aktów stoi też inny rodzaj; termin protokołu z profilu prawnego', () => {
  const ctx = setup();
  const types = defaultDocTypes.map(t => t.id === 'stanowisko' ? {...t, inActs: true} : t);
  ctx.general = {...ctx.general!, docTypes: types};
  ctx.docTypes = types;
  let m = prepared(ctx);
  m = apply(m, {type: 'item_add', title: 'Stanowisko w sprawie obsady dyżurów', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const position = m.agenda.find(i => i.title === 'Stanowisko w sprawie obsady dyżurów')!;
  m = apply(m, {type: 'item_edit', itemId: position.id, docType: 'stanowisko'}, office, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = apply(voteAll(m, ctx), {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: position.id, reason: 'kolejność'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: position.id, purpose: 'uchwala', subject: 'Stanowisko w sprawie obsady dyżurów', mode: 'jawne', minutes: 2, docType: 'stanowisko'}, chair, ctx.tick());
  m = apply(voteAll(m, ctx), {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());
  m = apply(m, {type: 'close', reason: 'brak czasu'}, chair, ctx.tick());
  const body = doc(m);
  assert.match(body, /V\. Podjęte uchwały i inne akty/);
  assert.match(body, /obsady dyżurów 7 0 0/);
  assert.match(body, /Termin sporządzenia protokołu .* \(21 dni od zakończenia obrad\)\./);
});

test('głosowanie między posiedzeniami: zarządzający zastępca, tryb z danymi uchwały i krótszy termin z powodem w protokole', () => {
  const ctx = setup();
  let m = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office, endsAt: ctx.now + 3 * 3600000}, ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 130/IX/2026 w sprawie delegowania'}, office, ctx.tick());
  m = apply(m, {type: 'item_mode', itemId: m.agenda[0].id, mode: 'imienne', decision: {kind: 'uchwala', number: '12/IX/2026', date: '2026-11-10'}}, office, ctx.tick());
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  assert.throws(() => apply(m, {type: 'open'}, jw, ctx.tick()), /Głosowanie między posiedzeniami rozpoczyna przewodniczący albo zastępca, którego przewodniczący wyznaczył na to głosowanie \(§ 16 ust\. 2\)\./);
  assert.throws(() => apply(m, {type: 'open'}, ag, ctx.tick()), /Głosowanie potrwa krócej niż 24 godziny\. Podaj powód\./);
  m = apply(m, {type: 'open', reason: 'Termin zgłoszenia delegatów mija jutro.'}, ag, ctx.tick());
  m = voteAll(m, ctx);
  m = apply(m, {type: 'announce', ballotId: last(m).id}, ag, ctx.tick());
  const body = doc(m);
  assert.match(body, /Głosowaniem zarządza Anna Grzegorczyk, I Wiceprzewodnicząca, zastępca wyznaczony przez przewodniczącego \(§ 16 ust\. 2\)\./);
  assert.match(body, /Głosowanie imienne na podstawie uchwały Prezydium nr 12\/IX\/2026 z dnia 10\.11\.2026 \(§ 11 ust\. 2\)\./);
  assert.match(body, /Głosowanie trwało krócej niż 24 godziny, do .*\. Powód „Termin zgłoszenia delegatów mija jutro”\./);
});

test('projekt protokołu posiedzenia sprzed wersji 3 („legacy”) bez nowych zdań: dawne zastępstwo i bez wymaganej większości', () => {
  const ctx = setup();
  let m = apply(prepared(ctx), {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  // Posiedzenie zapisane przy przejściu na wersję 3: te same dane, zamrożenie „legacy” (rozdz. 2.10).
  const env = cascadeEnv({roster, bundle: ctx.general!, organ: 'prezydium', accounts});
  m = {...m, frozen: freezeLegacy(env, m, ctx.now)};
  const body = doc(m);
  assert.match(body, /Na czas nieobecności przewodniczącego zastępuje go Anna Grzegorczyk, I Wiceprzewodnicząca \(wyznaczenie przez przewodniczącego \[§ 16 ust\. 2\]\)\./);
  assert.match(body, new RegExp(`Od godz\\. ${T} obrady prowadzi Sebastian Irzykowski, Przewodniczący \\(otwarcie posiedzenia\\)\\.`));
  assert.doesNotMatch(body, /Uchwały podejmuje się zwykłą większością głosów|Posiedzenie otwiera|Zastępstwo przewodniczącego|obecność zapisana przy otwarciu/);
});
