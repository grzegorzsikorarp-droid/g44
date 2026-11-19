import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advance, apply, secretCast, secretIssue} from '../src/shared/meeting.ts';
import {itemNumber, resultLabel} from '../src/shared/rules.ts';
import {parseAgendaText} from '../src/shared/agenda.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, context, newMeeting, presidium} from './helpers.ts';

function opened(present = presidium) {
  const ctx = context();
  let m = newMeeting(ctx);
  m = apply(m, {type: 'open'}, actor('si'), ctx);
  for (const p of present.filter(p => p !== 'si')) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  return {ctx, m};
}
function adoptAgenda(m: Meeting, ctx: ReturnType<typeof context>) {
  const point = m.agenda.find(i => i.kind === 'porzadek')!;
  m = apply(m, {type: 'item_start', itemId: point.id}, actor('si'), ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  const b = m.ballots.at(-1)!;
  for (const p of b.eligible) m = apply(m, {type: 'vote', ballotId: b.id, choice: 'za'}, actor(p), ctx.tick());
  return m;
}
const resolutionItem = (m: Meeting) => m.agenda.find(i => i.kind === 'uchwaly')!;

test('kworum Prezydium to 4 z 7 — przy 3 obecnych nie można głosować (§ 8 ust. 2)', () => {
  const {ctx, m} = opened(['si', 'ag', 'jw']);
  const point = m.agenda.find(i => i.kind === 'porzadek')!;
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: point.id, purpose: 'porzadek', subject: 'Porządek', mode: 'jawne', minutes: 2}, actor('si'), ctx), /Brak kworum\. Obecnych 3 z 7, wymagane 4/);
});

test('przed przyjęciem porządku nie można przejść do dalszych spraw; po przyjęciu można', () => {
  const {ctx, m} = opened();
  assert.throws(() => apply(m, {type: 'item_start', itemId: resolutionItem(m).id}, actor('si'), ctx), /Najpierw przyjmij porządek obrad/);
  const adopted = adoptAgenda(m, ctx);
  assert.equal(adopted.agendaAdopted, true);
  assert.equal(adopted.ballots[0].closeReason, 'wszyscy');
  assert.equal(resultLabel(adopted.ballots[0]), 'Porządek obrad przyjęty');
  const next = apply(adopted, {type: 'item_start', itemId: resolutionItem(adopted).id}, actor('si'), ctx.tick());
  assert.equal(next.currentItemId, resolutionItem(next).id);
});

test('zwykła większość: remis „za” i „przeciw” oznacza nieprzyjęcie (§ 8 ust. 3)', () => {
  const run = (votes: string[]) => {
    const {ctx, m: start} = opened();
    let m = adoptAgenda(start, ctx);
    m = apply(m, {type: 'ballot_open', itemId: resolutionItem(m).id, purpose: 'uchwala', subject: 'Uchwała nr 1', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
    const b = m.ballots.at(-1)!;
    presidium.forEach((p, i) => { m = apply(m, {type: 'vote', ballotId: b.id, choice: votes[i] as 'za'}, actor(p), ctx.tick()); });
    return m.ballots.at(-1)!;
  };
  const tie = run(['za', 'za', 'za', 'przeciw', 'przeciw', 'przeciw', 'wstrzymuje']);
  assert.equal(tie.result!.adopted, false);
  const won = run(['za', 'za', 'za', 'przeciw', 'przeciw', 'wstrzymuje', 'wstrzymuje']);
  assert.equal(won.result!.adopted, true);
  assert.deepEqual([won.result!.za, won.result!.przeciw, won.result!.wstrzymuje], [3, 2, 2]);
});

test('głosu nie można zmienić, a nieobecność oznaczona przez prowadzącego kończy głosowanie', () => {
  const {ctx, m: start} = opened();
  let m = adoptAgenda(start, ctx);
  m = apply(m, {type: 'ballot_open', itemId: resolutionItem(m).id, purpose: 'uchwala', subject: 'Uchwała nr 2', mode: 'jawne', minutes: 5}, actor('si'), ctx.tick());
  const id = m.ballots.at(-1)!.id;
  for (const p of presidium.slice(0, 6)) m = apply(m, {type: 'vote', ballotId: id, choice: 'za'}, actor(p), ctx.tick());
  assert.throws(() => apply(m, {type: 'vote', ballotId: id, choice: 'przeciw'}, actor('si'), ctx), /nie można go zmienić/);
  assert.equal(m.ballots.at(-1)!.status, 'otwarte');
  m = apply(m, {type: 'ballot_absent', ballotId: id, personId: 'ak'}, actor('si'), ctx.tick());
  const b = m.ballots.at(-1)!;
  assert.equal(b.status, 'zamkniete');
  assert.equal(b.result!.participants, 6);
  assert.equal(m.attendance.ak, 'wyszedl');
});

test('osoba przybyła w trakcie dołącza do otwartego głosowania', () => {
  const {ctx, m: start} = opened(presidium.slice(0, 6));
  let m = adoptAgenda(start, ctx);
  m = apply(m, {type: 'ballot_open', itemId: resolutionItem(m).id, purpose: 'uchwala', subject: 'Uchwała nr 3', mode: 'jawne', minutes: 5}, actor('si'), ctx.tick());
  const id = m.ballots.at(-1)!.id;
  m = apply(m, {type: 'presence', who: 'ak', present: true}, actor('ak'), ctx.tick());
  assert.ok(m.ballots.at(-1)!.eligible.includes('ak'));
  assert.deepEqual(m.ballots.at(-1)!.joined, ['ak']);
  m = apply(m, {type: 'vote', ballotId: id, choice: 'przeciw'}, actor('ak'), ctx.tick());
  assert.equal(m.ballots.at(-1)!.votes.ak, 'przeciw');
});

test('upływ czasu zamyka głosowanie', () => {
  const {ctx, m: start} = opened();
  let m = adoptAgenda(start, ctx);
  m = apply(m, {type: 'ballot_open', itemId: resolutionItem(m).id, purpose: 'uchwala', subject: 'Uchwała nr 4', mode: 'jawne', minutes: 1}, actor('si'), ctx.tick());
  m = apply(m, {type: 'vote', ballotId: m.ballots.at(-1)!.id, choice: 'za'}, actor('ag'), ctx.tick());
  m = apply(m, {type: 'message', text: 'test'}, actor('kn'), ctx.tick(61000));
  assert.equal(m.ballots.at(-1)!.closeReason, 'czas');
  assert.equal(m.ballots.at(-1)!.result!.cast, 1);
});

test('głosowanie tajne wymaga postanowienia Prezydium, a potem nie ujawnia, kto jak głosował (§ 11)', () => {
  const {ctx, m: start} = opened();
  let m = adoptAgenda(start, ctx);
  const it = resolutionItem(m);
  assert.throws(() => apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 5', mode: 'tajne', minutes: 3}, actor('si'), ctx), /możliwe dopiero po uchwaleniu przez Prezydium tajności głosowania/);
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'tajne', minutes: 2}, actor('si'), ctx.tick());
  const motion = m.ballots.at(-1)!;
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: motion.id, choice: p === 'eo' ? 'przeciw' : 'za'}, actor(p), ctx.tick());
  assert.equal(m.agenda.find(i => i.id === it.id)!.mode, 'tajne');
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: 'Uchwała nr 5', mode: 'tajne', minutes: 3}, actor('si'), ctx.tick());
  const secret = m.ballots.at(-1)!;
  assert.equal(secret.modeBasis, 'uchwalone przez Prezydium w głosowaniu nr 2');
  assert.throws(() => apply(m, {type: 'vote', ballotId: secret.id, choice: 'za'}, actor('ag'), ctx), /kartą tajną/);
  for (const p of presidium) {
    m = secretIssue(m, secret.id, actor(p), ctx.tick());
    ctx.castSecret(secret.id, p === 'si' ? 'przeciw' : 'za');
    m = secretCast(m, secret.id, ctx.tick());
  }
  assert.throws(() => secretIssue(m, secret.id, actor('ag'), ctx), /zakończone/);
  const closed = m.ballots.at(-1)!;
  assert.equal(closed.status, 'zamkniete');
  assert.deepEqual([closed.result!.za, closed.result!.przeciw], [6, 1]);
  assert.deepEqual(closed.votes, {});
  assert.deepEqual(closed.secret!.issued, [...presidium].sort());
});

test('reasumpcja: 1/3 podpisów obecnych, tylko głosowanie jawne, tylko raz (§ 12)', () => {
  const {ctx, m: start} = opened();
  let m = adoptAgenda(start, ctx);
  m = apply(m, {type: 'ballot_open', itemId: resolutionItem(m).id, purpose: 'uchwala', subject: 'Uchwała nr 6', mode: 'jawne', minutes: 2}, actor('si'), ctx.tick());
  const original = m.ballots.at(-1)!.id;
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: original, choice: p === 'si' || p === 'ag' ? 'za' : 'przeciw'}, actor(p), ctx.tick());
  assert.throws(() => apply(m, {type: 'motion_create', ballotId: original, justification: 'za krótko'}, actor('ag'), ctx), /Uzasadnij/);
  m = apply(m, {type: 'motion_create', ballotId: original, justification: 'Część osób zgłasza pomyłkę przy oddawaniu głosu.'}, actor('ag'), ctx.tick());
  let motion = m.motions[0];
  assert.equal(motion.status, 'zbiera_podpisy');
  assert.throws(() => apply(m, {type: 'motion_vote', motionId: motion.id, minutes: 2}, actor('si'), ctx), /wymaganej liczby podpisów/);
  m = apply(m, {type: 'motion_sign', motionId: motion.id, on: true}, actor('jw'), ctx.tick());
  m = apply(m, {type: 'motion_sign', motionId: motion.id, on: true}, actor('kn'), ctx.tick());
  motion = m.motions[0];
  assert.equal(motion.status, 'zlozony');
  assert.equal(motion.presentAtFiling, 7);
  m = apply(m, {type: 'motion_vote', motionId: motion.id, minutes: 2}, actor('si'), ctx.tick());
  const vote = m.ballots.at(-1)!.id;
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: vote, choice: 'za'}, actor(p), ctx.tick());
  assert.equal(m.motions[0].status, 'przyjety');
  m = apply(m, {type: 'reasumption_open', motionId: motion.id, minutes: 2}, actor('si'), ctx.tick());
  const repeat = m.ballots.at(-1)!;
  assert.equal(repeat.reasumptionOf, original);
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: repeat.id, choice: 'za'}, actor(p), ctx.tick());
  assert.equal(m.ballots.find(b => b.id === original)!.supersededBy, repeat.id);
  assert.equal(m.ballots.find(b => b.id === repeat.id)!.result!.adopted, true);
  assert.throws(() => apply(m, {type: 'motion_create', ballotId: repeat.id, justification: 'Ponowna wątpliwość co do wyniku.'}, actor('kn'), ctx), /tylko raz/);
  assert.throws(() => apply(m, {type: 'motion_create', ballotId: original, justification: 'Ponowna wątpliwość co do wyniku.'}, actor('kn'), ctx), /tylko raz/);
});

test('prowadzenie: przekazanie wiceprzewodniczącej i przejęcie przez przewodniczącego (§ 9 ust. 1, § 16)', () => {
  const {ctx, m: start} = opened();
  let m = apply(start, {type: 'chair_handover', personId: 'ag'}, actor('si'), ctx.tick());
  assert.equal(m.chair.current, 'ag');
  assert.throws(() => apply(m, {type: 'quorum'}, actor('si'), ctx), /osoba prowadząca/);
  assert.throws(() => apply(m, {type: 'chair_handover', personId: 'kn'}, actor('ag'), ctx), /przewodniczący lub wiceprzewodniczący/);
  assert.throws(() => apply(m, {type: 'chair_take'}, actor('jw'), ctx), /przekazać osoba prowadząca/);
  m = apply(m, {type: 'chair_take'}, actor('si'), ctx.tick());
  assert.equal(m.chair.current, 'si');
  m = apply(m, {type: 'presence', who: 'si', present: false}, actor('si'), ctx.tick());
  m = apply(m, {type: 'chair_take'}, actor('jw'), ctx.tick());
  assert.equal(m.chair.current, 'jw');
});

test('zmiana przyjętego porządku wymaga głosowania, a przyjęta wchodzi do porządku', () => {
  const {ctx, m: start} = opened();
  let m = adoptAgenda(start, ctx);
  assert.throws(() => apply(m, {type: 'item_add', title: 'Patronat', parentId: null}, actor('si'), ctx), /w głosowaniu/);
  m = apply(m, {type: 'agenda_change', change: {op: 'dodaj', title: 'Patronat nad konferencją', parentId: null, afterId: resolutionItem(m).id}, minutes: 2}, actor('si'), ctx.tick());
  const b = m.ballots.at(-1)!;
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: b.id, choice: 'za'}, actor(p), ctx.tick());
  const added = m.agenda.find(i => i.title === 'Patronat nad konferencją')!;
  assert.ok(added.addedAfterAdoption);
  assert.equal(itemNumber(m.agenda, added.id), '6');
});

test('procedura między posiedzeniami: okno czasowe, wcześniejsze zakończenie i kworum z liczby głosujących (§ 14 ust. 5)', () => {
  const ctx = context();
  let m = newMeeting(ctx, 'procedura');
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 120/IX/2026 w sprawie patronatu', parentId: null}, actor(null, 'biuro'), ctx.tick());
  m = apply(m, {type: 'item_add', title: 'Uchwała nr 121/IX/2026 w sprawie delegacji', parentId: null}, actor(null, 'biuro'), ctx.tick());
  assert.throws(() => apply(m, {type: 'open'}, actor('si'), ctx), /Ustaw koniec głosowania co najmniej 5 minut od teraz/);
  m = apply(m, {type: 'details', endsAt: ctx.now + 3 * 3600000}, actor(null, 'biuro'), ctx.tick());
  assert.throws(() => apply(m, {type: 'open'}, actor('kn'), ctx), /Głosowanie między posiedzeniami rozpoczyna/);
  m = apply(m, {type: 'open'}, actor('si'), ctx.tick());
  const [first, second] = m.ballots;
  assert.equal(first.eligible.length, 7);
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: first.id, choice: 'za'}, actor(p), ctx.tick());
  assert.equal(m.ballots[0].closeReason, 'wszyscy');
  for (const p of ['si', 'ag', 'jw']) m = apply(m, {type: 'vote', ballotId: second.id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'message', text: 'Przypominam o głosowaniu.'}, actor('si'), ctx.tick());
  m = structuredClone(m);
  advance(m, ctx.tick(3 * 3600000));
  assert.equal(m.ballots[1].closeReason, 'czas');
  assert.equal(m.ballots[1].result!.quorumMet, false);
  assert.equal(resultLabel(m.ballots[1]), 'Brak kworum, rozstrzygnięcie nie zapadło');
  assert.equal(m.status, 'zakonczone');
});

test('wczytanie porządku z tekstu rozpoznaje punkty, podpunkty i dodaje przyjęcie porządku', () => {
  const {items, warnings} = parseAgendaText(`# Porządek obrad
1. Otwarcie posiedzenia.
2. Rozpatrzenie projektów uchwał PWZ nr 117–128/IX/2026
   - Informacje o zaprzestaniu wykonywania zawodu
   - Informacje o przeniesieniach z innych izb
3. Sprawy bieżące
   i wolne wnioski
4. Zamknięcie posiedzenia.`);
  assert.deepEqual(items.map(i => [i.title, i.kind, i.parent]), [
    ['Otwarcie posiedzenia', 'otwarcie', null],
    ['Przyjęcie porządku obrad', 'porzadek', null],
    ['Rozpatrzenie projektów uchwał PWZ nr 117–128/IX/2026', 'uchwaly', null],
    ['Informacje o zaprzestaniu wykonywania zawodu', 'sprawa', 2],
    ['Informacje o przeniesieniach z innych izb', 'sprawa', 2],
    ['Sprawy bieżące i wolne wnioski', 'wolne_wnioski', null],
    ['Zamknięcie posiedzenia', 'zamkniecie', null],
  ]);
  assert.match(warnings[0], /Dodano punkt „Przyjęcie porządku obrad”/);
});
