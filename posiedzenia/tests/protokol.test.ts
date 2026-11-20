import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/shared/meeting.ts';
import {minutesBody, minutesDoc, minutesFileName, minutesTitle} from '../src/server/minutes.ts';
import {seesUnannounced} from '../src/shared/view.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium, roster} from './helpers.ts';

// Projekt protokołu i notatki w wersji 2 (specyfikacja /home/user/przeglad/SPEC-2.md, F1, F2, F4, F5, F7–F12, F14).

type Ctx = ReturnType<typeof context>;
const chair = actor('si');
const office = actor(null, 'biuro', true);
const item = (m: Meeting, kind: string) => m.agenda.find(i => i.kind === kind)!;
const last = (m: Meeting) => m.ballots.at(-1)!;
/** Tekst dokumentu bez znaczników, z twardymi spacjami zamienionymi na zwykłe. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\u00a0\u2060]/g, ' ').replace(/\s+/g, ' ');
const doc = (m: Meeting, options = {}) => text(minutesBody(m, roster, [], Date.parse('2026-11-20T15:00:00Z'), {office: 'biuro Izby'}, options));

function opened(quorum = true) {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'details', noticeDate: '2026-11-10', protocolNumber: '12/IX/2026', recorder: 'Anna Protokolantka', convener: 'si'}, office, ctx);
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm', who: 'ag', accept: true}, chair, ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, office, ctx.tick());
  if (quorum) m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  return {ctx, m};
}
function voteAll(m: Meeting, ctx: Ctx, choice: 'za' | 'przeciw' = 'za') {
  const id = last(m).id;
  for (const p of last(m).eligible) m = apply(m, {type: 'vote', ballotId: id, choice}, actor(p), ctx.tick());
  return m;
}
const announce = (m: Meeting, ctx: Ctx) => apply(m, {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());

test('protokół: dane do protokołu, głosowanie próbne w rozdziale I, zmiany projektu porządku i sposób potwierdzenia obecności', () => {
  let {ctx, m} = opened();
  // F1: głosowanie próbne jawne przed przyjęciem porządku.
  m = apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode: 'jawne', minutes: 1}, chair, ctx.tick());
  m = voteAll(m, ctx);
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  // F8: zmiany projektu porządku przy jego przyjmowaniu.
  m = apply(m, {type: 'item_place', itemId: item(m, 'wolne_wnioski').id, parentId: null, beforeId: item(m, 'uchwaly').id}, chair, ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Patronat nad konferencją', parentId: null, afterId: item(m, 'protokol').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  const body = doc(m);
  // F10: numer w tytule, zwołujący, protokolant w faktach i w podpisie.
  assert.match(body, /Protokół nr 12\/IX\/2026 z posiedzenia/);
  assert.match(body, /Zwołuje Sebastian Irzykowski, Przewodniczący/);
  assert.match(body, /Protokołuje Anna Protokolantka/);
  assert.match(body, /Protokolant \(jeżeli został wyznaczony\) Anna Protokolantka/);
  // F1: tylko zdanie w rozdziale I, bez numeru i bez bloku głosowania.
  assert.match(body, /O godz\. \d\d:\d\d przeprowadzono głosowanie próbne \(jawne\) w celu sprawdzenia działania systemu\./);
  assert.doesNotMatch(body, /Głosowanie nr 0/);
  assert.match(body, /Porządek obrad przyjęto w głosowaniu nr 1\./);
  // F8: zmiany projektu przed zdaniem o przyjęciu porządku.
  const changes = body.indexOf('Przed przyjęciem porządku obrad osoba prowadząca obrady zmieniła jego projekt.');
  assert.ok(changes > 0 && changes < body.indexOf('Porządek obrad przyjęto w głosowaniu nr 1.'));
  assert.match(body, /O godz\. \d\d:\d\d punkt „Informacje bieżące i wolne wnioski” przeniesiono z pozycji 6 na pozycję 5\./);
  assert.match(body, /O godz\. \d\d:\d\d dodano punkt 4 „Patronat nad konferencją”\./);
  // F9: obecność zgłoszona w aplikacji i potwierdzona przez prowadzącego albo biuro.
  assert.match(body, /Anna Grzegorczyk I Wiceprzewodnicząca obecność od \d\d:\d\d zgłoszenie w aplikacji, potwierdzone przez osobę prowadzącą obrady \(Sebastian Irzykowski\)/);
  assert.match(body, /Jolanta Woźniak .{0,40}zgłoszenie w aplikacji, potwierdzone przez biuro Izby \(Biuro Izby\)/);
  assert.doesNotMatch(body, /wyjście/, 'zgłoszenie obecności nie jest wyjściem');
});

test('protokół: powody przy kolejności, odroczeniu i zamknięciu, osoby przy punkcie, wnioskodawca i formuła z rodzaju dokumentu', () => {
  let {ctx, m} = opened();
  const resolutions = item(m, 'uchwaly');
  m = apply(m, {type: 'item_add', title: 'Stanowisko w sprawie kształcenia', parentId: resolutions.id}, chair, ctx.tick());
  const position = m.agenda.find(i => i.title === 'Stanowisko w sprawie kształcenia')!;
  // F11, F12: „Co jest głosowane” i osoby przy punkcie.
  // Wersja 3 (G-10): w trakcie obrad „Co jest głosowane” zmienia osoba prowadząca z powodem.
  m = apply(m, {type: 'item_edit', itemId: position.id, docType: 'stanowisko', reason: 'Projekt zawiera stanowisko.', presenters: [{name: 'Krystyna Naczk', role: 'Sekretarz', kind: 'referuje'}, {name: 'Jan Gość', role: '', kind: 'referuje'}, {name: 'Sebastian Irzykowski', role: 'Przewodniczący', kind: 'prowadzi'}]}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  // F4: rozpoczęcie poza kolejnością z powodem.
  m = apply(m, {type: 'item_start', itemId: position.id, reason: 'nieobecność osoby referującej punkt 3.'}, chair, ctx.tick());
  // F14: wniosek o głosowanie tajne zgłasza członek obecny.
  m = apply(m, {type: 'mode_motion', itemId: position.id, mode: 'tajne', minutes: 2, proposedBy: 'kn'}, chair, ctx.tick());
  m = announce(voteAll(m, ctx), ctx);
  m = apply(m, {type: 'ballot_open', itemId: position.id, purpose: 'uchwala', subject: 'Stanowisko w sprawie kształcenia', mode: 'tajne', minutes: 2}, chair, ctx.tick());
  const secretBallot = last(m);
  for (const _ of secretBallot.eligible) ctx.castSecret(secretBallot.id, 'za');
  m = apply(m, {type: 'ballot_close', ballotId: secretBallot.id}, chair, ctx.tick());
  m = announce(m, ctx);
  m = apply(m, {type: 'item_end', itemId: item(m, 'protokol').id, status: 'odroczony', reason: 'projekt protokołu nie jest gotowy'}, chair, ctx.tick());
  m = apply(m, {type: 'close', reason: 'brak czasu'}, chair, ctx.tick());
  const body = doc(m);
  assert.match(body, /Prowadzi punkt Sebastian Irzykowski, Przewodniczący Referuje Krystyna Naczk, Sekretarz Jan Gość/);
  assert.match(body, /Punkt rozpatrzono poza kolejnością przyjętego porządku obrad\. Powód „nieobecność osoby referującej punkt 3”\./);
  assert.match(body, /Wniosek zgłasza Krystyna Naczk, Sekretarz\./);
  assert.match(body, /Stanowisko przyjęte/, 'formuła z rodzaju dokumentu zapisana w głosowaniu');
  assert.match(body, /Punkt odroczono\. Powód „projekt protokołu nie jest gotowy”\./);
  assert.match(body, /Punkt nie był rozpatrywany\. Powód „brak czasu”\./);
  // Uchwał nie podjęto: stanowisko nie jest uchwałą.
  assert.match(body, /V\. Podjęte uchwały Nie podjęto uchwał\./);
  // Plik do edycji w Wordzie ma te same zdania.
  const word = text(minutesDoc(m, roster, [], Date.parse('2026-11-20T15:00:00Z')));
  assert.match(word, /Prowadzi punkt Sebastian Irzykowski, Przewodniczący Referuje Krystyna Naczk, Sekretarz Jan Gość/);
  assert.match(word, /Wniosek zgłasza Krystyna Naczk, Sekretarz\./);
});

test('notatka ze spotkania roboczego: brak kworum z liczbami, bez rozdziału „Podjęte uchwały”, podpis sporządzającego', () => {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of ['ag', 'jw']) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  m = apply(m, {type: 'working_start', reason: 'brak_kworum'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: null, purpose: 'proba', subject: '', mode: 'tajne', minutes: 1}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_close', ballotId: last(m).id}, chair, ctx.tick());
  m = apply(m, {type: 'item_start', itemId: item(m, 'sprawozdania').id}, chair, ctx.tick());
  m = apply(m, {type: 'close', reason: 'spotkanie robocze bez kworum'}, chair, ctx.tick());
  assert.equal(minutesTitle(m), 'Projekt notatki');
  assert.equal(minutesFileName(m), 'projekt-notatki-prezydium-2026-11-20.doc');
  const body = doc(m);
  assert.match(body, /Notatka ze spotkania roboczego Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku z dnia 20 listopada 2026 r\./);
  assert.doesNotMatch(body, /Protokół nr/);
  assert.match(body, /O godz\. \d\d:\d\d stwierdzono brak kworum \(obecnych 3 z 7 członków Prezydium, wymagane co najmniej 4, § 8 ust\. 2\)\. Od godz\. \d\d:\d\d obrady kontynuowano jako spotkanie robocze\. Bez kworum Prezydium nie podejmuje uchwał\./);
  assert.match(body, /przeprowadzono głosowanie próbne \(tajne\)/);
  assert.match(body, /Porządku obrad nie przyjęto\. Na spotkaniu roboczym nie przeprowadza się głosowań\./);
  assert.doesNotMatch(body, /Podjęte uchwały/);
  assert.match(body, /V\. Załączniki/);
  assert.match(body, /Osoba prowadząca spotkanie Sebastian Irzykowski Osoba sporządzająca notatkę ……/);
  assert.match(body, /Załącznik nr 1 do notatki/);
  assert.doesNotMatch(body, /Protokół przyjęto na posiedzeniu/);
});

test('protokół głosowania między posiedzeniami: zmiany terminu, przerwanie z powodem i ukryty wynik do ogłoszenia', () => {
  const ctx = context();
  let m = newMeeting(ctx, 'procedura');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu'}, office, ctx.tick());
  m = apply(m, {type: 'details', endsAt: ctx.now + 3 * 3600000, noticeDate: '2026-11-19', recorder: 'Anna Protokolantka'}, office, ctx.tick());
  // Wersja 3 (DA-21): termin krótszy niż 24 godziny wymaga powodu przy rozpoczęciu.
  m = apply(m, {type: 'open', reason: 'Termin wyznaczony przez Okręgową Radę.'}, chair, ctx.tick());
  m = apply(m, {type: 'vote', ballotId: m.ballots[0].id, choice: 'za'}, actor('ag'), ctx.tick());
  m = apply(m, {type: 'procedure_deadline', endsAt: Date.parse('2026-11-21T17:00:00Z')}, chair, ctx.tick());
  const counted = apply(m, {type: 'procedure_end', how: 'policz'}, chair, ctx.tick());
  // Wersja 3 (DA-12): przerywa osoba, która rozpoczęła głosowanie, albo przewodniczący.
  const aborted = apply(m, {type: 'procedure_end', how: 'przerwij', reason: 'błąd w projekcie uchwały.'}, chair, ctx.tick());
  const body = doc(aborted);
  assert.match(body, /Protokół nr …… z głosowania między posiedzeniami/);
  assert.match(body, /Powiadomienie członków 19 listopada 2026 r\./);
  assert.match(body, /Protokołuje Anna Protokolantka/);
  assert.match(body, /Zakończenie przerwano, powód „błąd w projekcie uchwały”, rozstrzygnięcie nie zapadło \(Sebastian Irzykowski\)/);
  assert.match(body, /Zmiany terminu głosowania .*21\.11\.2026, godz\. 18:00 \(przedłużenie\) Sebastian Irzykowski/);
  assert.match(body, /i zostało przerwane\. Powód „błąd w projekcie uchwały”\. Głosów nie policzono, rozstrzygnięcie nie zapadło\./);
  assert.match(body, /Głos oddała 1 osoba \(Anna Grzegorczyk\)\./);
  // F2: przed ogłoszeniem wyniku członek bez wglądu nie widzi liczb, a prowadzący widzi.
  assert.ok(!seesUnannounced(counted, actor('kn'), roster));
  const hidden = doc(counted, {hideUnannounced: true});
  assert.match(hidden, /Zakończenie przed terminem z policzeniem głosów \(Sebastian Irzykowski\)/);
  // W głosowaniu między posiedzeniami nie ma obrad: wynik ogłasza przewodniczący albo wiceprzewodniczący.
  assert.match(hidden, /Głosowanie zakończone\. Wynik ogłosi przewodniczący albo wiceprzewodniczący\./);
  assert.doesNotMatch(hidden, /Uchwała podjęta|Uchwała nie została podjęta|Wstrzymało się/);
  const shown = doc(counted);
  assert.match(shown, /zakończone przed terminem z policzeniem głosów/);
  assert.doesNotMatch(shown, /Wynik ogłosi/);
});

test('protokół: przed ogłoszeniem wyniku osoba bez wglądu nie dostaje zdania o przyjęciu porządku ani rozstrzygnięcia wniosku, a biuro widzi nazwę konta', () => {
  let {ctx, m} = opened();
  m = apply(m, {type: 'item_start', itemId: item(m, 'porzadek').id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: item(m, 'porzadek').id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  m = voteAll(m, ctx);
  const member = doc(m, {hideUnannounced: true});
  assert.doesNotMatch(member, /Porządek obrad przyjęto/);
  assert.doesNotMatch(member, /Porządek obrad nie został przyjęty/);
  assert.match(member, /Głosowanie zakończone\. Wynik ogłosi osoba prowadząca obrady\./);
  assert.match(doc(m), /Porządek obrad przyjęto w głosowaniu nr 1\./, 'osoba prowadząca obrady widzi wynik od razu');
  m = announce(m, ctx);
  assert.match(doc(m, {hideUnannounced: true}), /Porządek obrad przyjęto w głosowaniu nr 1\./);
  // F9: przy kilku kontach biura protokół podaje nazwę konta, które potwierdziło obecność.
  assert.match(doc(m), /potwierdzone przez biuro Izby \(Biuro Izby\)/);
});
