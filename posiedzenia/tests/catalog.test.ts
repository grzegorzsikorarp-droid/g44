import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogCsv, catalogRows, closedRefs, completeness, dateInText, minutesDeadline, periodInput, periodReport, periodReportCsv, periodReportHtml, photosLinkText,
  photosUrlCheck, protocolAdoptions, protocolChecks, protocolOfIssue, protocolOfProposal, protocolOfProposalText, protocolState} from '../src/shared/catalog.ts';
import {meetingTurnout, turnoutPercent} from '../src/shared/turnout.ts';
import type {Actor, Ballot, Meeting} from '../src/shared/types.ts';
import {actor, roster} from './helpers.ts';
import {closedMeeting, envWith, NOW, office} from './scenariusz-v4.ts';

// Katalog odbytych posiedzeń, stan protokołu i przyjęcie protokołu (SPEC-4 DB-5, DB-6, DB-24, DB-38, G-23, G-33, G-38;
// etap D.1 pkt 5 i 8).

const comms: Actor = {account: {id: 'u-kom', username: 'kom', kind: 'komunikacja', personId: null, displayName: 'Komunikacja', label: '', admin: false, mustChange: false, disabled: false}, personId: null, name: 'Komunikacja'};
/** Dwa posiedzenia: A zamknięte 20.11.2026 i B, na którym głosowano przyjęcie protokołu A. */
function pair(o: {closeB?: boolean; announce?: boolean; protocolOf?: string | null; subject?: string} = {}) {
  const {m: a} = closedMeeting({v4: true});
  const b: Meeting = structuredClone(a);
  b.id = 'mB'; b.openedAt = Date.parse('2026-12-10T10:00:00Z'); b.closedAt = Date.parse('2026-12-10T12:00:00Z');
  b.status = o.closeB === false ? 'trwa' : 'zakonczone';
  const vote: Ballot = {...a.ballots[0], id: 'pb', number: 2, purpose: 'protokol', subject: o.subject ?? 'Przyjęcie protokołu z posiedzenia z dnia 20 listopada 2026 r.',
    protocolOf: o.protocolOf === null ? undefined : o.protocolOf ?? a.id, announcedAt: o.announce === false ? undefined : Date.parse('2026-12-10T11:00:00Z'),
    result: {...a.ballots[0].result!, adopted: true}};
  b.ballots = [vote];
  return {a, b};
}

test('DB-5: przyjęcie protokołu tylko z posiedzenia zamkniętego, z ogłoszonym wynikiem i z polem utrwalonym w głosowaniu', () => {
  const {a, b} = pair();
  const adoptions = protocolAdoptions([a, b]);
  assert.deepEqual(adoptions.get(a.id), {meetingId: 'mB', date: '2026-12-10', ballotNumber: 2, at: Date.parse('2026-12-10T11:00:00Z'), kind: 'posiedzenie'});
  assert.equal(protocolAdoptions([a, pair({closeB: false}).b]).size, 0, 'posiedzenie przyjmujące trwa (T-8)');
  assert.equal(protocolAdoptions([a, pair({announce: false}).b]).size, 0, 'wynik nieogłoszony');
  assert.equal(protocolAdoptions([a, pair({protocolOf: null}).b]).size, 0, 'bez pola w głosowaniu');
  const superseded = pair();
  superseded.b.ballots = [{...superseded.b.ballots[0], supersededBy: 'r1'}, {...superseded.b.ballots[0], id: 'r1', number: 3, result: {...superseded.b.ballots[0].result!, adopted: false}, reasumptionOf: 'pb'}];
  assert.equal(protocolAdoptions([a, superseded.b]).size, 0, 'reasumpcja zastępuje wynik');
  const refs = closedRefs([a, b], adoptions);
  assert.deepEqual(refs.map(r => [r.id, r.adopted]), [[a.id, true], ['mB', false]]);
});

test('DB-6: stany protokołu „Projekt”, „Sporządzony”, „Przyjęty”, „Notatka” i „Termin minął.”', () => {
  const {a, b} = pair();
  const deadline = minutesDeadline(a)!;
  assert.equal(deadline, '2026-12-11');
  assert.deepEqual([protocolState(a, null, '2026-12-01').state, protocolState(a, null, '2026-12-01').text], ['projekt', 'Termin sporządzenia 11.12.2026 (§ 13 ust. 2).']);
  assert.equal(protocolState(a, null, '2026-12-12').text, 'Termin sporządzenia 11.12.2026 (§ 13 ust. 2). Termin minął.');
  const ready: Meeting = {...a, minutesReady: {date: '2026-12-03', author: {personId: 'kn', name: 'Krystyna', func: 'Sekretarz'}, at: NOW, by: 'Biuro', accountId: 'u'}};
  assert.deepEqual([protocolState(ready, null, '2026-12-12').label, protocolState(ready, null, '2026-12-12').text], ['Sporządzony', 'Sporządzony 03.12.2026. Sporządza Krystyna, Sekretarz. Do wglądu w biurze (§ 13 ust. 2).']);
  const adoption = protocolAdoptions([a, b]).get(a.id)!;
  const scanned: Meeting = {...ready, filed: [{id: 'f1', kind: 'protokol_podpisany', title: '', fileId: 'x', fileName: 'skan.pdf', mime: 'application/pdf', size: 1, sha256: '', at: Date.parse('2026-12-11T10:00:00Z'), by: 'Biuro', accountId: 'u'}]};
  assert.equal(protocolState(scanned, adoption, '2026-12-12').text, 'Przyjęty 10.12.2026 na posiedzeniu z dnia 10.12.2026 (głosowanie nr 2). Podpisany skan dołączono 11.12.2026.');
  assert.equal(protocolState({...a, working: {at: 1, by: 'x', reason: 'brak_kworum'}}, null, '2026-12-12').state, 'notatka');
  // Komplet dokumentów (6.9): bez faktu i plików 0 z 5; plik bez faktu daje wiersz „Do sprawdzenia” (K4-7).
  assert.deepEqual([completeness(a, null).have, completeness(a, null).of], [0, 5]);
  const fileOnly: Meeting = {...a, filed: [{...scanned.filed![0], kind: 'protokol_sporzadzony'}]};
  assert.deepEqual(protocolChecks(fileOnly, []), ['Dołączono plik protokołu. Wpisz datę sporządzenia i osobę, która sporządziła protokół.']);
});

test('G-38, G-33: wiersz „Do sprawdzenia” przy głosowaniu bez pola albo sprzecznym z przedmiotem; propozycja „Dotyczy protokołu”', () => {
  const {a, b} = pair();
  const refs = closedRefs([a, b]);
  assert.equal(protocolOfIssue(b, b.ballots[0], refs), null);
  const empty = pair({protocolOf: null}).b;
  assert.equal(protocolOfIssue(empty, empty.ballots[0], refs), 'Głosowanie nr 2 nie wskazuje, którego protokołu dotyczy.');
  const wrong = pair({subject: 'Przyjęcie protokołu z posiedzenia z dnia 22 października 2026 r.'}).b;
  assert.equal(protocolOfIssue(wrong, wrong.ballots[0], refs), 'Głosowanie nr 2 wskazuje protokół posiedzenia z dnia 20.11.2026, a przedmiot głosowania mówi o dniu 22.10.2026.');
  assert.equal(dateInText('Przyjęcie protokołu z posiedzenia z dnia 22 października 2026 r.'), '2026-10-22');
  assert.equal(dateInText('Protokół z 3.11.2026'), '2026-11-03');
  const next = {id: 'mC', organ: 'prezydium' as const};
  const open = closedRefs([a]);
  assert.deepEqual(protocolOfProposal(open, next, 'Przyjęcie protokołu z posiedzenia z dnia 20 listopada 2026 r.'), {id: a.id, why: 'data'});
  assert.deepEqual(protocolOfProposal(open, next, 'Przyjęcie protokołu'), {id: a.id, why: 'ostatnie'});
  assert.equal(protocolOfProposalText(open, {id: a.id, why: 'data'}), 'Propozycja »posiedzenie z dnia 20.11.2026«, bo tytuł punktu zawiera tę datę.');
  assert.equal(protocolOfProposal(closedRefs([a, b]), next, 'Przyjęcie protokołu z posiedzenia z dnia 20 listopada 2026 r.')?.id, 'mB', 'protokół A już przyjęty, zostaje B');
});

test('G-23, DB-38: odnośnik do zdjęć tylko https, bez danych logowania, ostrzeżenie dla hostów innych niż Zdjęcia Google', () => {
  assert.deepEqual(photosUrlCheck(''), {ok: true, url: ''});
  assert.deepEqual(photosUrlCheck('http://photos.app.goo.gl/x'), {ok: false, error: 'Wpisz adres zaczynający się od https://.'});
  assert.deepEqual(photosUrlCheck('javascript:alert(1)'), {ok: false, error: 'Wpisz adres zaczynający się od https://.'});
  assert.deepEqual(photosUrlCheck('https://jan:haslo@photos.google.com/a'), {ok: false, error: 'Adres nie może zawierać nazwy użytkownika ani hasła.'});
  assert.deepEqual(photosUrlCheck('https://photos.app.goo.gl/' + 'x'.repeat(480)), {ok: false, error: 'Adres może mieć najwyżej 500 znaków.'});
  assert.deepEqual(photosUrlCheck('https://exa mple.org'), {ok: false, error: 'Ten adres nie jest poprawny.'});
  assert.deepEqual(photosUrlCheck(' https://photos.app.goo.gl/AbC '), {ok: true, url: 'https://photos.app.goo.gl/AbC'});
  assert.deepEqual(photosUrlCheck('https://photos.google.com/share/x'), {ok: true, url: 'https://photos.google.com/share/x'});
  const other = photosUrlCheck('https://example.org/album');
  assert.deepEqual(other, {ok: true, url: 'https://example.org/album', warning: 'To nie jest adres albumu Zdjęć Google. Sprawdź, czy odnośnik prowadzi do właściwego albumu.'});
  assert.equal(photosLinkText('https://photos.app.goo.gl/AbC'), 'Album zdjęć z posiedzenia (photos.app.goo.gl)');
});

test('B1-24–B1-28: katalog, filtry, konto „Komunikacja” i CSV ze zdjęciami „jest” albo „brak”', () => {
  const {a, b} = pair();
  const withPhotos: Meeting = {...a, photos: {url: 'https://photos.app.goo.gl/AbC', at: NOW, by: 'x', accountId: 'u'}};
  const live: Meeting = {...a, id: 'live', status: 'trwa'};
  const env = envWith();
  const rows = catalogRows([withPhotos, b, live], env, office, {}, {today: '2026-12-12'});
  assert.deepEqual(rows.map(r => r.id), ['mB', a.id], 'tylko zakończone, od najnowszego');
  const row = rows.find(r => r.id === a.id)!;
  assert.deepEqual([row.protocol.state, row.acts, row.turnout, row.photos], ['przyjety', 'Uchwała 4', {present: 7, members: 7}, {url: 'https://photos.app.goo.gl/AbC'}]);
  assert.equal(turnoutPercent(meetingTurnout(a, roster)), 100);
  assert.deepEqual(catalogRows([withPhotos, b], env, office, {stan: 'projekt'}, {today: '2026-12-12'}).map(r => r.id), ['mB']);
  assert.deepEqual(catalogRows([withPhotos, b], env, office, {q: '110/ix'}, {today: '2026-12-12'}).map(r => r.id), [a.id], 'szukanie po numerze uchwały');
  assert.deepEqual(catalogRows([withPhotos, b], env, office, {rok: '2025'}, {today: '2026-12-12'}), []);
  assert.deepEqual(catalogRows([withPhotos, b], env, office, {kadencja: 'IX'}, {today: '2026-12-12'}).length, 2);
  assert.deepEqual(catalogRows([withPhotos, b], env, office, {rodzaj: 'glosowania'}, {today: '2026-12-12'}), []);
  const commsRows = catalogRows([withPhotos, b, live], env, comms, {}, {today: '2026-12-12'});
  assert.deepEqual(commsRows.map(r => [r.id, r.scope]), [['mB', 'wiersz'], [a.id, 'wiersz']]);
  // Poprawka D1K-05: wiersz konta „Komunikacja” bez frekwencji, kompletu dokumentów, numeru protokołu i kadencji (4.4, przypis 10).
  for (const r of commsRows) for (const key of ['turnout', 'complete', 'protocolNumber', 'term']) assert.ok(!(key in r), `wiersz bez pola ${key}`);
  assert.ok(rows.every(r => r.turnout && r.complete && typeof r.protocolNumber === 'string'), 'pełny wiersz z tymi polami');
  const guest: Actor = {account: {...office.account, id: 'u-g', kind: 'gosc'}, personId: null, name: 'Gość'};
  assert.deepEqual(catalogRows([{...withPhotos, invited: ['u-g']}], env, guest, {}, {today: '2026-12-12'})[0].photos, 'jest', 'gość widzi tylko „jest”');
  const file = catalogCsv(rows, office);
  assert.ok(file.includes(';jest;') && !file.includes('photos.app.goo.gl'));
  assert.throws(() => catalogCsv(commsRows, comms), {message: 'To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.'});
  assert.equal(catalogRows([withPhotos], env, actor('eo'), {}, {today: '2026-12-12'})[0].scope, 'pelny');
});

test('DB-25, B1-30: zestawienie za okres bez danych o osobach; adres albumu tylko w wydruku', () => {
  const {a, b} = pair();
  const withPhotos: Meeting = {...a, photos: {url: 'https://photos.app.goo.gl/AbC', at: NOW, by: 'x', accountId: 'u'}};
  const env = envWith();
  const r = periodReport([withPhotos, b], env, {from: '2026-01-01', to: '2026-12-31'}, {at: NOW, today: '2026-12-12'});
  assert.deepEqual([r.counts.meetings, r.counts.procedures, r.pending, r.counts.turnout], [2, 0, 1, '100% (14 z 14)']);
  const html = periodReportHtml(r, roster);
  assert.ok(html.includes('Zestawienie posiedzeń Prezydium Okręgowej Rady'));
  assert.ok(html.includes('photos.app.goo.gl/AbC'));
  for (const p of roster.persons) assert.ok(!html.includes(p.name), `bez osoby ${p.name}`);
  const csvMeetings = periodReportCsv(r, 'posiedzenia');
  assert.ok(csvMeetings.includes(';jest') && !csvMeetings.includes('photos.app.goo.gl'));
  assert.ok(periodReportCsv(r, 'akty').includes('Patronat;;108/IX/2026;patronatu nad konferencją;2026-11-20'));
  assert.ok(periodReportCsv(r, 'akty').includes('Pomoc w przypadkach losowych;1;109/IX/2026;;'), 'przy „Tylko liczba” i „Nie trafia” liczba i numery bez tytułów (B1-30 pkt 4)');
  assert.ok(!periodReportCsv(r, 'akty').includes('zapomogi'));
  assert.deepEqual(periodInput('2026-02-01', '2026-01-01'), {error: 'Początek okresu nie może być późniejszy niż koniec.'});
  assert.deepEqual(periodInput('2020-01-01', '2026-01-02'), {error: 'Okres może mieć najwyżej 5 lat.'});
  assert.deepEqual(periodInput('', '2026-01-02'), {error: 'Wpisz datę początku i końca okresu.'});
});

test('D-KDZ4-04, W-W4-16, 4.4: wiersz konta „Komunikacja” z chwilą udostępnienia i stanem protokołu z datą przyjęcia, bez terminu sporządzenia', () => {
  const {a, b} = pair();
  const env = envWith();
  const releasedAt = Date.parse('2026-11-21T10:05:00Z');
  const released: Meeting = {...a, commsReleased: {at: releasedAt, by: 'Biuro', accountId: 'u-biuro', inputs: 0}, commsInputs: 0};
  const [rowB, rowA] = catalogRows([released, b], env, comms, {}, {today: '2026-12-12'});
  assert.deepEqual([rowA.commsRelease, rowA.commsReleasedAt], ['udostepniony', releasedAt]);
  assert.equal(rowA.protocol.text, 'Przyjęty 10.12.2026.', 'stan protokołu z datą przyjęcia');
  assert.equal(rowB.protocol.state, 'projekt');
  assert.deepEqual([rowB.protocol.text, rowB.protocol.overdue, rowB.protocol.deadline], ['', false, null], 'bez terminu sporządzenia i „Termin minął.”');
  assert.equal(rowB.commsReleasedAt, null);
  const officeRow = catalogRows([released], env, office, {}, {today: '2026-12-12'})[0];
  assert.equal(officeRow.commsReleasedAt, releasedAt, 'osoby, które udostępniają, też widzą chwilę udostępnienia');
  assert.ok(officeRow.protocol.text.startsWith('Termin sporządzenia') || officeRow.protocol.text.startsWith('Przyjęty'), 'pełny wiersz bez zmian');
  assert.equal(catalogRows([released], env, actor('eo'), {}, {today: '2026-12-12'})[0].commsReleasedAt, undefined, 'członek bez stanu udostępnienia');
});

test('W-W4-14: zestawienie „Podjęte uchwały 4.” w liczbie mnogiej i „brak numeru” zamiast kropek', () => {
  const {a, b} = pair();
  const env = envWith();
  const r = periodReport([{...a, protocolNumber: ''}, b], env, {from: '2026-01-01', to: '2026-12-31'}, {at: NOW, today: '2026-12-12'});
  const html = periodReportHtml(r, roster);
  assert.match(html, /Podjęte uchwały \d+\./);
  assert.ok(!/Podjęte akty Uchwała/.test(html));
  assert.ok(html.includes('brak numeru') && !html.includes('……'));
});
