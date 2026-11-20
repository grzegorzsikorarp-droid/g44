import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply, defaultSite, envOf, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {basisSentences, effectiveMeeting, procedureEndAt, sourceText, stampText, type CascadeEnv} from '../src/shared/cascade.ts';
import {defaultGeneral, matchCaseType, proposeCaseType, type GeneralSettings} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {presidiumTemplate} from '../src/shared/agenda.ts';
import {minutesText} from '../src/shared/text.ts';
import {seedSite} from '../src/server/seed.ts';
import type {Account, Effective, MaterialRef, Meeting} from '../src/shared/types.ts';
import {actor, context, presidium} from './helpers.ts';

// Kaskada ustawień wersji 3 (specyfikacja, rozdz. 2.6): kolejność rozstrzygania z warstwą wzoru posiedzenia,
// zamrożenie, różnice, odstępstwa, przegląd z propozycjami i linie źródła dla każdego źródła.

type Ctx = ReturnType<typeof context>;
const office = actor(null, 'biuro', true);
const chair = actor('si');
const guestAccount: Account = {id: 'u-gosc', username: 'gosc', kind: 'gosc', personId: null, displayName: 'Jan Wiśniewski', label: 'radca prawny', admin: false, mustChange: false, disabled: false};
const advisoryAccount: Account = {id: 'u-kr', username: 'kr', kind: 'doradczy', personId: null, displayName: 'Halina Rewizyjna', label: 'Przewodnicząca Okręgowej Komisji Rewizyjnej', admin: false, mustChange: false, disabled: false};

function setup(modify?: (g: GeneralSettings) => void): Ctx & Context {
  const ctx = context() as Ctx & Context;
  const general = defaultGeneral(seedSite);
  general.caseTypes = [{id: 'pwz', name: 'Prawo wykonywania zawodu', docType: 'uchwala', organs: ['prezydium'], financial: false, keywords: ['prawa wykonywania zawodu'], titlePattern: '', presenterFunc: 'sekretarz', order: 10, active: true}];
  modify?.(general);
  ctx.general = {general, docTypes: defaultDocTypes, revision: 1};
  ctx.accounts = [guestAccount, advisoryAccount];
  return ctx;
}
const create = (ctx: Context, extra: Partial<Parameters<typeof newMeetingFromSettings>[0]> = {}) =>
  newMeetingFromSettings({id: 'm1', kind: 'posiedzenie', date: '2026-12-03', time: '10:00', actor: office, ...extra}, ctx);
const env = (ctx: Context, m: Meeting): CascadeEnv => envOf(ctx, m.organ);
const eff = (ctx: Context, m: Meeting, review = false) => effectiveMeeting(env(ctx, m), m, {review, now: ctx.now});
const show = (v: unknown) => minutesText(v as number);
const src = (e: Effective<unknown>, at: Parameters<typeof sourceText>[1]['at'] = 'posiedzenie', houseBy = 'przez Izbę') => sourceText(e, {at, show, houseBy});
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
function opened(ctx: Ctx & Context, m: Meeting) {
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  return apply(m, {type: 'quorum'}, chair, ctx.tick());
}

test('nowe posiedzenie z ustawień domyślnych ma porządek dzisiejszego szablonu i czas głosowania 2 minuty', () => {
  const ctx = setup();
  const m = create(ctx);
  assert.deepEqual(m.agenda.map(i => [i.title, i.kind]), presidiumTemplate);
  assert.deepEqual(m.template, {id: 'zwykle', name: 'Posiedzenie zwykłe'});
  const e = eff(ctx, m);
  assert.equal(e.meeting.voteMinutes.value, 2);
  assert.equal(e.meeting.voteMinutes.source, 'ogolne');
  assert.equal(src(e.meeting.voteMinutes), 'Jak w ustawieniach ogólnych.');
  assert.equal(src(e.meeting.voteMinutes, 'ogolne'), 'Ustawienie ogólne.');
  assert.equal(e.meeting.motionMinutes.value, 2);
  assert.deepEqual(m.invited, ['u-kr'], 'osoba z głosem doradczym zaproszona z urzędu (DA-5)');
  assert.equal(m.title, 'Posiedzenie Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku');
});

test('czas głosowania: wzór posiedzenia nad ustawieniami ogólnymi (źródło „szablon”)', () => {
  const ctx = setup(g => { g.organs.prezydium!.templates[0].settings = {voteMinutes: 3}; });
  const m = create(ctx);
  const v = eff(ctx, m).meeting.voteMinutes;
  assert.deepEqual([v.value, v.source, v.via?.name, v.inherited], [3, 'szablon', 'Posiedzenie zwykłe', 2]);
  assert.equal(src(v), 'Jak we wzorze posiedzenia »Posiedzenie zwykłe«.');
  assert.equal(src(v, 'wzor'), 'Zmienione dla tego wzoru. W ustawieniach ogólnych 2 minuty.');
});

test('czas głosowania: posiedzenie nad wzorem i nad ustawieniami ogólnymi, z przywróceniem', () => {
  const ctx = setup(g => { g.organs.prezydium!.templates[0].settings = {voteMinutes: 3}; });
  let m = create(ctx);
  m = apply(m, {type: 'settings_set', key: 'voteMinutes', value: 1}, office, ctx.tick());
  let v = eff(ctx, m).meeting.voteMinutes;
  assert.deepEqual([v.value, v.source, v.inherited, v.inheritedSource], [1, 'posiedzenie', 3, 'szablon']);
  assert.equal(src(v), 'Zmienione dla tego posiedzenia. We wzorze posiedzenia 3 minuty.');
  assert.equal(stampText(v.stamp!), 'Zmiana 20.11.2026, godz. 11:00, konto Biuro Izby.');
  assert.equal(m.log.at(-1)!.text, 'Zmieniono czas głosowania w sprawie z 3 minut na 1 minutę.');
  assert.equal(m.log.at(-1)!.tag, 'ustawienia');
  m = apply(m, {type: 'settings_set', key: 'motionMinutes', value: 3}, office, ctx.tick());
  const motion = eff(ctx, m).meeting.motionMinutes;
  assert.equal(src(motion), 'Zmienione dla tego posiedzenia. W ustawieniach ogólnych 2 minuty.');
  assert.throws(() => apply(m, {type: 'settings_set', key: 'voteMinutes', value: 4}, office, ctx), /Wybierz czas z listy\./);
  assert.throws(() => apply(m, {type: 'settings_set', key: 'voteMinutes', value: 2}, actor('kn'), ctx), /Ustawienia posiedzenia zmienia biuro/);
  m = apply(m, {type: 'settings_reset', key: 'voteMinutes'}, office, ctx.tick());
  v = eff(ctx, m).meeting.voteMinutes;
  assert.deepEqual([v.value, v.source], [3, 'szablon']);
  assert.equal(m.log.at(-1)!.text, 'Przywrócono czas głosowania w sprawie z wzoru posiedzenia (3 minuty).');
});

test('posiedzenie w przygotowaniu dziedziczy ustawienia ogólne na bieżąco, a otwarte je zamraża (z liniami źródła)', () => {
  const ctx = setup();
  let m = create(ctx);
  ctx.general!.general.organs.prezydium!.voteMinutes = 5;
  assert.equal(eff(ctx, m).meeting.voteMinutes.value, 5, 'w przygotowaniu działa zmiana ustawień ogólnych');
  m = opened(ctx, m);
  assert.ok(m.frozen && !m.frozen.legacy);
  assert.equal(m.frozen.members.length, 7);
  ctx.general!.general.organs.prezydium!.voteMinutes = 15;
  const v = eff(ctx, m).meeting.voteMinutes;
  assert.equal(v.value, 5);
  assert.equal(v.frozen, true);
  assert.equal(src(v), 'Ustalone przy otwarciu posiedzenia.');
  assert.equal(src({...v, legacy: true}), 'Zapisane przy przejściu na wersję 3.');
  assert.throws(() => apply(m, {type: 'settings_set', key: 'voteMinutes', value: 3}, office, ctx), /Ustawienia posiedzenia zapisano przy otwarciu\./);
});

test('kanał wiadomości: stacjonarne „gdy są wiadomości”, zdalne i głosowanie między posiedzeniami „zawsze” (zasada aplikacji)', () => {
  const ctx = setup();
  assert.equal(eff(ctx, create(ctx)).meeting.messages.value, 'gdy_sa_wiadomosci');
  const remote = eff(ctx, create(ctx, {mode: 'zdalne'})).meeting.messages;
  assert.deepEqual([remote.value, remote.source, remote.appRule], ['zawsze', 'aplikacja', 'kanal_zdalny']);
  assert.match(src(remote), /^Ustalone w aplikacji\. Na posiedzeniu zdalnym i w głosowaniu między posiedzeniami kanał wiadomości działa zawsze\./);
  const procedure = newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office}, ctx);
  assert.equal(eff(ctx, procedure).meeting.messages.value, 'zawsze');
  // Poprawki po kontroli v3 (D-DZ-V3-01, DA-21): koniec głosowania z ustawień ogólnych liczy się od rozpoczęcia, nie od utworzenia.
  assert.equal(procedure.endsAt, undefined);
  const start = ctx.now + 5 * 3600000;
  assert.deepEqual(procedureEndAt(procedure, defaultGeneral(defaultSite), start), {endsAt: start + 24 * 3600000, fromStart: true, hours: 24}, 'koniec głosowania z ustawień ogólnych');
});

test('czas głosowania w punkcie: własny („Zmienione dla tego punktu”) albo z posiedzenia', () => {
  const ctx = setup();
  let m = create(ctx);
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_edit', itemId: it.id, voteMinutes: 3}, office, ctx.tick());
  const e = eff(ctx, m);
  const own = e.items[it.id].voteMinutes;
  assert.deepEqual([own.value, own.source, own.inherited], [3, 'punkt', 2]);
  assert.equal(src(own, 'punkt'), 'Zmienione dla tego punktu. W ustawieniach posiedzenia 2 minuty.');
  assert.equal(src(e.items[item(m, 'uchwaly').id].voteMinutes, 'punkt'), 'Jak w ustawieniach posiedzenia.');
  assert.equal(m.log.at(-1)!.text, 'Zmieniono czas głosowania w punkcie 3 z 2 minut na 3 minuty.');
  m = apply(m, {type: 'item_edit', itemId: it.id, voteMinutes: null}, office, ctx.tick());
  assert.equal(eff(ctx, m).items[it.id].voteMinutes.value, 2);
});

test('„Co jest głosowane” w punkcie: własne, z rodzaju sprawy, z materiału albo brak', () => {
  const ctx = setup();
  let m = create(ctx);
  const ref: MaterialRef = {id: 'mat', title: 'Stanowisko w sprawie dyżurów', type: 'stanowisko', number: '', version: 1, hash: 'x', size: 1, fileId: null, fileName: null, createdAt: 0};
  m = {...m, materials: [ref]};
  m = apply(m, {type: 'item_add', title: 'Uchwała w sprawie stwierdzenia prawa wykonywania zawodu', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Stanowisko', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const [pwz, position] = m.agenda.filter(i => i.parentId);
  m = apply(m, {type: 'item_material', itemId: position.id, materialId: 'mat', on: true}, office, ctx.tick());
  let e = eff(ctx, m);
  assert.equal(e.items[pwz.id].docType.value, null);
  assert.equal(e.items[pwz.id].caseTypeGuess, 'pwz', 'propozycja nie wchodzi do kaskady');
  assert.equal(src(e.items[position.id].docType, 'punkt'), 'Wynika z materiału »Stanowisko w sprawie dyżurów«.');
  m = apply(m, {type: 'item_edit', itemId: pwz.id, caseType: 'pwz'}, office, ctx.tick());
  e = eff(ctx, m);
  const fromCase = e.items[pwz.id].docType;
  assert.deepEqual([fromCase.value, fromCase.source, fromCase.via?.kind], ['uchwala', 'ogolne', 'rodzaj_sprawy']);
  assert.equal(src(fromCase, 'punkt'), 'Wynika z rodzaju sprawy »Prawo wykonywania zawodu«.');
  assert.deepEqual(m.agenda.find(i => i.id === pwz.id)!.presenters, [{name: 'Krystyna Naczk', role: 'Sekretarz', kind: 'referuje'}], 'rodzaj sprawy uzupełnia osobę referującą');
  assert.equal(m.agenda.find(i => i.id === pwz.id)!.caseTypeGuess, undefined, 'przyjęcie usuwa propozycję');
  m = apply(m, {type: 'item_edit', itemId: position.id, docType: 'oswiadczenie'}, office, ctx.tick());
  const own = eff(ctx, m).items[position.id].docType;
  assert.deepEqual([own.value, own.source, own.inherited], ['oswiadczenie', 'punkt', 'stanowisko']);
  assert.equal(src(own, 'punkt'), 'Zmienione dla tego punktu.');
});

test('wymóg głosowania z formy aktu jest ustalony regulaminem; rodzaj punktu z wzoru albo zmieniony dla punktu', () => {
  const ctx = setup();
  let m = create(ctx);
  const e = eff(ctx, m);
  const protocol = e.items[item(m, 'protokol').id].voted;
  assert.deepEqual([protocol.value, protocol.source, protocol.basis], [true, 'prawo', '§ 9 ust. 2 pkt 5, § 13 ust. 3']);
  m = apply(m, {type: 'item_add', title: 'Patronat', parentId: item(m, 'sprawozdania').id}, office, ctx.tick());
  const sub = m.agenda.find(i => i.parentId)!;
  m = apply(m, {type: 'item_edit', itemId: sub.id, docType: 'apel'}, office, ctx.tick());
  const voted = eff(ctx, m).items[sub.id].voted;
  assert.equal(src(voted, 'punkt'), 'Wynika z rodzaju dokumentu »Apel« (§ 8 ust. 9 pkt 4).');
  const kind = eff(ctx, m).items[item(m, 'sprawozdania').id].kind;
  assert.deepEqual([kind.source, kind.via?.name], ['szablon', 'Posiedzenie zwykłe']);
  m = apply(m, {type: 'item_edit', itemId: sub.id, kind: 'sprawa'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Sprawa X'}, office, ctx.tick());
  const x = m.agenda.find(i => i.title === 'Sprawa X')!;
  m = apply(m, {type: 'item_edit', itemId: x.id, kind: 'uchwaly'}, office, ctx.tick());
  assert.equal(eff(ctx, m).items[x.id].kind.source, 'punkt');
  assert.equal(m.log.at(-1)!.text, `Zmieniono rodzaj punktu 7 z „Sprawa” na „Podjęcie uchwał”.`);
});

test('wartości z regulaminu: kworum, większość, tryb, reasumpcja, zawiadomienie, zwołujący, czas głosowania między posiedzeniami', () => {
  const ctx = setup();
  const m = create(ctx);
  const e = eff(ctx, m).meeting;
  assert.deepEqual(e.quorum.value, {required: 4, total: 7, seats: null});
  assert.equal(src(e.quorum), 'Ustalone regulaminem, § 8 ust. 2.');
  assert.equal(e.majority.basis, '§ 8 ust. 3');
  assert.equal(e.mode.basis, '§ 11 ust. 1');
  assert.deepEqual(e.reasumption.value, {share: '1/3'});
  assert.deepEqual(e.notice.value, {minDays: 7, days: null, deadline: '2026-11-26'});
  assert.equal(e.convener.value, 'si');
  assert.equal(src(e.convener), 'Ustalone regulaminem, § 14 ust. 3.');
  const procedure = eff(ctx, newMeetingFromSettings({id: 'p1', kind: 'procedura', actor: office}, ctx)).meeting;
  assert.equal(procedure.reasumption.value, null);
  assert.equal(procedure.procedureMinHours!.value, 24);
  assert.match(src(procedure.procedureMinHours!), /^Ustalone w aplikacji\. Głosowanie między posiedzeniami trwa co najmniej 24 godziny/);
});

test('projekt na żywo jest zasadą przyjętą przez Izbę (D2): punkt „Przyjęcie porządku obrad” i spotkanie robocze', () => {
  const ctx = setup();
  let m = create(ctx);
  m = opened(ctx, m);
  let live = eff(ctx, m).meeting.draftLive;
  assert.equal(live.value, false, 'w punkcie otwarcia nie');
  assert.equal(src(live), 'Zasada przyjęta przez Izbę 20.11.2026.');
  assert.equal(src(live, 'posiedzenie', ''), 'Zasada przyjęta 20.11.2026.', 'wersja próbna');
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  assert.equal(eff(ctx, m).meeting.draftLive.value, true);
  const working = {...m, currentItemId: item(m, 'sprawozdania').id, working: {at: 1, by: 'x', reason: 'brak_kworum' as const}};
  live = eff(ctx, working).meeting.draftLive;
  assert.equal(live.value, true, 'przez całe spotkanie robocze');
});

test('różnice wobec ustawień ogólnych i wzoru posiedzenia (tylko historia, nie protokół)', () => {
  const ctx = setup(g => { g.organs.prezydium!.templates[0].settings = {voteMinutes: 2}; });
  let m = create(ctx);
  m = apply(m, {type: 'settings_set', key: 'voteMinutes', value: 1}, office, ctx.tick());
  m = apply(m, {type: 'item_edit', itemId: item(m, 'protokol').id, voteMinutes: 3}, office, ctx.tick());
  const e = eff(ctx, m);
  assert.deepEqual(e.differences.map(d => d.text), [
    'Czas głosowania w sprawie 1 minuta, we wzorze posiedzenia 2 minuty.',
    'Czas głosowania w punkcie 3 3 minuty, w ustawieniach posiedzenia 1 minuta.',
  ]);
  assert.ok(!e.deviations.some(d => /Czas głosowania/.test(d.text)));
});

test('odstępstwa do protokołu: zawiadomienie, punkt spoza zawiadomienia, gość, zastępstwo i pominięty punkt', () => {
  const ctx = setup();
  let m = create(ctx);
  m = apply(m, {type: 'details', noticeDate: '2026-11-30'}, office, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Patronat nad konferencją'}, office, ctx.tick());
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'przewodniczacy'}, office, ctx.tick());
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'item_remove', itemId: item(m, 'protokol').id, reason: 'Projekt protokołu nie jest gotowy.'}, chair, ctx.tick());
  const texts = eff(ctx, m).deviations.map(d => `${d.kind}: ${d.text}`);
  assert.deepEqual(texts, [
    'zawiadomienie: Zawiadomienie wysłano 3 dni przed posiedzeniem, a regulamin wymaga co najmniej 7 dni (§ 7 ust. 1).',
    'poza_zawiadomieniem: Punkt 6 „Patronat nad konferencją” dodano do projektu porządku obrad po wysłaniu zawiadomienia (§ 7 ust. 1).',
    'pominiety_punkt: Z projektu porządku obrad pominięto punkt „Przyjęcie protokołu z poprzedniego posiedzenia”, wymieniony w § 9 ust. 2 pkt 5. Punkt pominięto decyzją Sebastian Irzykowski, Przewodniczący. Powód „Projekt protokołu nie jest gotowy”.',
    'gosc: Gość Jan Wiśniewski, radca prawny uczestniczy na zaproszenie przewodniczącego (§ 7 ust. 3).',
    'zastepstwo: Zastępstwo przewodniczącego Anna Grzegorczyk, I Wiceprzewodnicząca, wyznaczenie przez przewodniczącego 20.11.2026, godz. 11:00 (§ 16 ust. 2).',
  ]);
});

test('odstępstwa w trakcie obrad: otwarcie zamiast zastępcy i zamknięcie punktu bez głosowania (DA-8)', () => {
  const ctx = setup();
  let m = create(ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 108/IX/2026', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const sub = m.agenda.find(i => i.parentId)!;
  m = apply(m, {type: 'item_edit', itemId: sub.id, docType: 'uchwala'}, office, ctx.tick());
  m = apply(m, {type: 'item_edit', itemId: sub.id, caseType: 'pwz'}, office, ctx.tick());
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'open', reason: 'Wyznaczona zastępczyni jest w drodze.'}, actor('jw'), ctx.tick());
  m = apply(m, {type: 'item_edit', itemId: sub.id, docType: 'informacja', reason: 'Projekt wycofano przed głosowaniem.'}, actor('jw'), ctx.tick());
  const texts = eff(ctx, m).deviations.map(d => `${d.kind}: ${d.text}`);
  assert.ok(texts.includes('prowadzenie: Posiedzenie otwiera Jolanta Woźniak, II Wiceprzewodnicząca (zamiast wyznaczonego zastępcy, powód „Wyznaczona zastępczyni jest w drodze”).'), texts.join('\n'));
  assert.ok(texts.includes('bez_glosowania: W punkcie 5.1 sprawy nie poddano pod głosowanie. Powód „Projekt wycofano przed głosowaniem”.'), texts.join('\n'));
  // Posiedzenia zapisane przy przejściu na wersję 3 nie dostają nowych zdań.
  assert.deepEqual(eff(ctx, {...m, frozen: {...m.frozen!, legacy: true}}).deviations, []);
});

test('przegląd przed otwarciem: propozycje rodzajów spraw z działaniami, zawiadomienie, porządek z podpunktami, głos doradczy', () => {
  const ctx = setup();
  let m = create(ctx);
  m = apply(m, {type: 'agenda_import', replace: true, text: '1. Otwarcie posiedzenia\n2. Przyjęcie porządku obrad\n3. Przyjęcie protokołu\n4. Podjęcie uchwał\n   - Uchwała w sprawie stwierdzenia prawa wykonywania zawodu pielęgniarki\n   - Uchwała w sprawie patronatu\n5. Wolne wnioski\n6. Zamknięcie posiedzenia'}, office, ctx.tick());
  const review = eff(ctx, m, true).review!;
  const guess = review.find(r => r.actions)!;
  assert.equal(guess.text, 'Propozycja rodzaju sprawy w punkcie 5.1 »Prawo wykonywania zawodu«.');
  assert.deepEqual(guess.actions, ['przyjmij', 'odrzuc']);
  assert.equal(guess.group, 'sprawdzic');
  assert.ok(review.some(r => r.group === 'sprawdzic' && r.text === 'Wyślij zawiadomienie najpóźniej 26.11.2026 (7 dni przed posiedzeniem, § 7 ust. 1).'));
  assert.ok(review.some(r => r.group === 'sprawdzic' && r.text === 'Uzupełniono projekt porządku obrad o punkt „Sprawy bieżące, w tym przyjęcie sprawozdań” wymagany regulaminem.'));
  assert.ok(review.some(r => r.group === 'gotowe' && r.text === 'Projekt porządku obrad, 7 punktów i 2 podpunkty.'));
  assert.ok(review.some(r => r.group === 'gotowe' && r.text === 'Głos doradczy, 1 osoba zawiadamiana o każdym posiedzeniu (§ 7 ust. 2).'));
  assert.ok(review.some(r => r.group === 'uzupelnic' && r.text === 'Podpunkt 5.2 bez materiału.'));
  // Odrzucenie i przyjęcie propozycji.
  const rejected = apply(m, {type: 'item_edit', itemId: guess.itemId!, caseTypeGuess: null}, office, ctx.tick());
  assert.ok(!eff(ctx, rejected, true).review!.some(r => r.actions));
  assert.equal(eff(ctx, m).review, undefined, 'bez canPrepare (opcja review) przegląd nie powstaje');
});

test('linie źródła: skopiowane z posiedzenia, zmiana w trakcie obrad z powodem, niedostępne wzory', () => {
  assert.equal(src({value: 3, source: 'posiedzenie', level: 2, stamp: {at: 0, by: 'Biuro', accountId: 'x', copiedFrom: '2026-11-19'}}), 'Skopiowane z posiedzenia z dnia 19.11.2026.');
  assert.equal(src({value: 'x', source: 'obrady', level: 3, stamp: {at: Date.parse('2026-11-20T10:15:00Z'), by: 'S', accountId: 'x', live: true, reason: 'Projekt zawiera stanowisko.'}}, 'obrady'),
    'Zmienione w trakcie obrad o godz. 11:15. Powód „Projekt zawiera stanowisko”.');
  const ctx = setup(g => { g.organs.prezydium!.templates.push({id: 'krotkie', name: 'Posiedzenie krótkie', items: g.organs.prezydium!.templates[0].items, settings: {voteMinutes: 1}}); });
  const m = create(ctx, {template: 'krotkie'});
  assert.equal(eff(ctx, m).meeting.voteMinutes.value, 1);
  ctx.general!.general.organs.prezydium!.templates.pop();
  const e = eff(ctx, m, true);
  assert.equal(e.meeting.voteMinutes.value, 2, 'brakujący wzór pomija się');
  assert.ok(e.review!.some(r => r.text === 'Wzoru »Posiedzenie krótkie« już nie ma. Obowiązują ustawienia ogólne.'));
});

test('liczba miejsc z uchwały nie zmienia kworum (pytanie 5, wariant a), a przegląd pokazuje rozbieżność', () => {
  const ctx = setup(g => { g.organs.prezydium!.seats = {count: 8, act: {organ: 'rada', number: '41/IX/2026', date: '2026-11-15'}}; });
  const m = create(ctx);
  const e = eff(ctx, m, true);
  assert.deepEqual(e.meeting.quorum.value, {required: 4, total: 7, seats: 8});
  assert.ok(e.review!.some(r => r.text === 'Skład liczy 7 osób, a uchwała Okręgowej Rady Pielęgniarek i Położnych w Słupsku ustala 8 miejsc. Kworum liczy się ze składu.'));
});

test('zwołujący zastępca: wiersz do sprawdzenia (DA-23) i strażnik G-15', () => {
  const ctx = setup();
  let m = create(ctx);
  assert.throws(() => apply(m, {type: 'details', convener: 'ag'}, office, ctx), /Posiedzenia Prezydium zwołuje przewodniczący \(§ 14 ust\. 3\) albo zastępca, którego przewodniczący wyznaczył na to posiedzenie \(§ 16 ust\. 2\)\./);
  m = apply(m, {type: 'deputy', personId: 'ag'}, chair, ctx.tick());
  m = apply(m, {type: 'details', convener: 'ag'}, office, ctx.tick());
  const e = eff(ctx, m, true);
  assert.equal(src(e.meeting.convener), 'Ustalone regulaminem, § 16 ust. 1–2.');
  assert.ok(e.review!.some(r => r.text === 'Zwołuje zastępca przewodniczącego. Zakres zastępstwa ustala Okręgowa Rada Pielęgniarek i Położnych w Słupsku (§ 16 ust. 1).'));
  assert.equal(m.log.at(-1)!.text, 'Ustawiono zwołującego Anna Grzegorczyk, I Wiceprzewodnicząca.');
});

test('podstawa rozstrzygnięcia pod liczbami: większość, kworum i uchwalona tajność', () => {
  const ctx = setup();
  let m = opened(ctx, create(ctx));
  const point = item(m, 'porzadek');
  m = apply(m, {type: 'item_start', itemId: point.id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: m.ballots.at(-1)!.id}, chair, ctx.tick());
  const it = item(m, 'protokol');
  m = apply(m, {type: 'item_start', itemId: it.id}, chair, ctx.tick());
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'tajne', minutes: 2, proposedBy: 'kn'}, chair, ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: m.ballots.at(-1)!.id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'protokol', subject: 'Przyjęcie protokołu', mode: 'tajne', minutes: 3}, chair, ctx.tick());
  assert.match(m.log.at(-1)!.text, /Czas głosowania 3 minuty, w ustawieniach punktu 2 minuty\.$/);
  const b = m.ballots.at(-1)!;
  for (const _ of presidium) ctx.castSecret(b.id, 'za');
  m = apply(m, {type: 'ballot_close', ballotId: b.id}, chair, ctx.tick());
  assert.equal(m.log.at(-1)!.by, 'Sebastian Irzykowski', 'zakończenie przed czasem podpisuje osoba prowadząca');
  assert.deepEqual(basisSentences(env(ctx, m), m, m.ballots.at(-1)!), [
    'Zwykła większość głosów, więcej głosów za niż przeciw (§ 8 ust. 3).',
    'Kworum 4 z 7 (§ 8 ust. 2) było zachowane.',
    'Tajność głosowania Prezydium uchwaliło w głosowaniu nr 2 (§ 11 ust. 2).',
    'Wniosek zgłasza Krystyna Naczk, Sekretarz.',
  ]);
});

test('powielenie: ustawienia posiedzenia ze śladem „skopiowane”, bez gości i zastępstwa, z osobami z głosem doradczym', async () => {
  const {duplicateMeeting} = await import('../src/shared/meeting.ts');
  const ctx = setup();
  let m = create(ctx);
  m = apply(m, {type: 'settings_set', key: 'voteMinutes', value: 3}, office, ctx.tick());
  m = apply(m, {type: 'item_edit', itemId: item(m, 'protokol').id, voteMinutes: 5}, office, ctx.tick());
  m = apply(m, {type: 'invite', accountId: 'u-gosc', on: true, invitedBy: 'organ', decision: 'posiedzenie z dnia 12.11.2026'}, office, ctx.tick());
  m = apply(m, {type: 'deputy', personId: 'jw'}, chair, ctx.tick());
  m = apply(m, {type: 'item_remove', itemId: item(m, 'wolne_wnioski').id, reason: 'Brak wolnych wniosków.'}, chair, ctx.tick());
  const {meeting: copy} = duplicateMeeting(m, {id: 'm2', now: ctx.now, newId: ctx.newId, createdBy: 'Biuro Izby', accountId: 'u-biuro', advisory: ['u-kr']});
  assert.deepEqual(copy.settings, {voteMinutes: 3});
  assert.equal(copy.settingStamps!.voteMinutes!.copiedFrom, '2026-12-03');
  assert.equal(src(eff(ctx, copy).meeting.voteMinutes), 'Skopiowane z posiedzenia z dnia 03.12.2026.');
  assert.equal(copy.agenda.find(i => i.kind === 'protokol')!.voteMinutes, 5);
  assert.deepEqual(copy.invited, ['u-kr']);
  assert.equal(copy.guestInvites, undefined);
  assert.deepEqual([copy.chair.deputy, copy.chair.deputySet], [null, undefined]);
  assert.equal(copy.skipped, undefined);
  assert.ok(copy.agenda.some(i => i.kind === 'wolne_wnioski'));
  assert.equal(copy.log.at(-1)!.text, 'Przywrócono punkt „Informacje bieżące i wolne wnioski” wymieniony w regulaminie (§ 9 ust. 2 pkt 8).');
});

test('data zawiadomienia zapisuje punkty obecne w projekcie; punkt dodany później trafia do odstępstw', () => {
  const ctx = setup();
  let m = create(ctx);
  m = apply(m, {type: 'details', noticeDate: '2026-11-20'}, office, ctx.tick());
  assert.equal(m.noticeItems!.length, 7);
  assert.equal(m.log.at(-1)!.text, 'Ustawiono datę wysłania zawiadomienia 20.11.2026.');
  m = apply(m, {type: 'details', noticeDate: '2026-11-21'}, office, ctx.tick());
  assert.equal(m.noticeItems!.length, 7, 'zmiana daty nie zmienia listy punktów z zawiadomienia');
  assert.equal(m.log.at(-1)!.text, 'Zmieniono datę wysłania zawiadomienia z 20.11.2026 na 21.11.2026.');
  m = apply(m, {type: 'item_add', title: 'Patronat'}, office, ctx.tick());
  assert.equal(eff(ctx, m).deviations.filter(d => d.kind === 'poza_zawiadomieniem').length, 1);
  m = apply(m, {type: 'details', noticeDate: ''}, office, ctx.tick());
  assert.equal(m.noticeItems, undefined);
  assert.equal(m.log.at(-1)!.text, 'Usunięto datę wysłania zawiadomienia.');
});

test('ustawienia ogólne: historia zmian z wartościami słowami, rewizja i granice (G-2, G-3)', async () => {
  const {applySettingsChange} = await import('../src/shared/settings.ts');
  const ctx = setup();
  const b = ctx.general!;
  const environment = {actor: office, now: ctx.now, roster: ctx.roster};
  const {bundle, audit} = applySettingsChange(b, {area: 'organ', organ: 'prezydium', key: 'voteMinutes', value: 3}, environment);
  assert.equal(bundle.revision, 2);
  assert.deepEqual(audit.map(e => [e.area, e.label, e.before, e.after, e.actor]), [['organ', 'Czas głosowania w sprawie', '2 minuty', '3 minuty', 'Biuro Izby']]);
  assert.equal(applySettingsChange(b, {area: 'organ', organ: 'prezydium', key: 'voteMinutes', value: 2}, environment).audit.length, 0, 'bez zmiany bez wpisu');
  assert.throws(() => applySettingsChange(b, {area: 'organ', organ: 'prezydium', key: 'motionMinutes', value: 10}, environment), /Wybierz czas z listy\./);
  assert.throws(() => applySettingsChange(b, {area: 'organ', organ: 'prezydium', key: 'procedureHours', value: 12}, environment), /Ustaw od 24 do 336 godzin\./);
  assert.throws(() => applySettingsChange(b, {area: 'organ', organ: 'rada', key: 'voteMinutes', value: 3}, environment), /Posiedzeń tego organu nie prowadzimy jeszcze w aplikacji\./);
  assert.throws(() => applySettingsChange(b, {area: 'rodzaje_spraw', caseType: {name: 'Zapomogi', docType: 'uchwala', keywords: ['z']}}, environment), /Słowo może mieć od 2 do 40 znaków\./);
  const template = structuredClone(b.general.organs.prezydium!.templates[0]);
  template.items = template.items.filter(i => i.kind !== 'protokol');
  assert.throws(() => applySettingsChange(b, {area: 'wzory', organ: 'prezydium', template}, environment), /Tego punktu nie można usunąć ze wzoru\. Regulamin wymienia go w porządku obrad \(§ 9 ust\. 2 pkt 5\)\./);
  const added = applySettingsChange(b, {area: 'rodzaje_spraw', caseType: {name: 'Pomoc w przypadkach losowych', docType: 'uchwala', financial: true, keywords: ['zapomoga', 'Zdarzenie losowe']}}, environment);
  assert.deepEqual(added.bundle.general.caseTypes.at(-1)!.keywords, ['zapomoga', 'zdarzenie losowe']);
  assert.equal(added.audit[0].label, 'Rodzaj sprawy „Pomoc w przypadkach losowych”');
});

// Poprawki po kontroli rdzenia wersji 3 (W-W-02): słowa rodzaju sprawy rozpoznaje się także w innym przypadku
// („zapomoga” w „przyznania zapomogi”, „zdarzenie losowe” w „po zdarzeniu losowym”).
test('rozpoznawanie rodzaju sprawy po tematach słów: tytuły w dopełniaczu i miejscowniku', () => {
  const ctx = setup(g => g.caseTypes.push({id: 'zapomoga', name: 'Pomoc w przypadkach losowych', docType: 'uchwala', organs: ['prezydium'], financial: true, keywords: ['zapomoga', 'zdarzenie losowe'], titlePattern: '', order: 20, active: true}));
  const types = ctx.general!.general.caseTypes;
  assert.deepEqual(matchCaseType(types, 'prezydium', 'Uchwała w sprawie przyznania zapomogi po zdarzeniu losowym'), {id: 'zapomoga', keyword: 'zapomogi'});
  assert.equal(proposeCaseType(types, 'prezydium', 'Uchwała w sprawie zapomóg dla członków'), 'zapomoga');
  assert.equal(proposeCaseType(types, 'prezydium', 'Pomoc po zdarzeniu losowym'), 'zapomoga');
  assert.equal(proposeCaseType(types, 'prezydium', 'Informacja o zdarzeniach'), null, 'fraza trafia tylko wtedy, gdy każde jej słowo ma odpowiednik');
  assert.equal(proposeCaseType(types, 'prezydium', 'Uchwała w sprawie stwierdzenia prawa wykonywania zawodu'), 'pwz', 'dosłowne trafienie jak wcześniej');
  let m = create(ctx);
  m = apply(m, {type: 'item_add', title: 'Uchwała w sprawie przyznania zapomogi po zdarzeniu losowym', parentId: item(m, 'uchwaly').id}, office, ctx.tick());
  const sub = m.agenda.find(i => i.parentId === item(m, 'uchwaly').id)!;
  assert.equal(sub.caseTypeGuess, 'zapomoga');
  // W-W-04: punkt dodany ręcznie ma rodzaj ustalony w posiedzeniu, a punkt ze wzoru odwołuje się do wzoru.
  assert.deepEqual([eff(ctx, m).items[sub.id].kind.source, eff(ctx, m).items[sub.id].kind.via], ['posiedzenie', undefined]);
  assert.equal(eff(ctx, m).items[item(m, 'uchwaly').id].kind.via?.kind, 'wzor');
});
