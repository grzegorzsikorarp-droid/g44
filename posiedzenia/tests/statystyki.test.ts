import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {memberStats, rosterView, statsCsv, statsRangeInput, statsSourceLines, turnout, PARTIAL_MINUTES} from '../src/shared/stats.ts';
import {meetingTurnout, periodTurnout} from '../src/shared/turnout.ts';
import type {Meeting} from '../src/shared/types.ts';
import {roster} from './helpers.ts';
import {closedMeeting, NOW} from './scenariusz-v4.ts';

// Statystyki obecności i głosowań (SPEC-4 DB-22, DB-24, B4-01–B4-21, T-6; testy B4-T1–B4-T17 w zakresie rdzenia,
// mianownik ze składu zapisanego przy otwarciu; etap D.1 pkt 6 i 8).

const range = {from: '2026-01-01', to: '2026-12-31'};
const MIN = 60000;

test('B4-T1: głosowanie tajne liczy się tylko jako pobranie karty, bez wyboru także dla samej osoby', () => {
  const {m} = closedMeeting({v4: true});
  const r = memberStats({meetings: [m], roster, range, self: 'si', only: ['si']});
  const p = r.persons[0];
  assert.deepEqual(p.sessionVotes.tajne, {held: 1, eligible: 1, cast: 1});
  const secretRow = p.rows[0].ballots.find(b => b.mode === 'tajne')!;
  assert.equal(secretRow.choice, undefined);
  assert.deepEqual(p.sessionVotes.own, {za: 6, przeciw: 0, wstrzymuje: 0}, 'własne głosy jawne i imienne bez tajnych');
});

test('B4-T2, T-6: dane różniące się tylko wyborami w głosowaniu tajnym i kolejnością pobrania kart dają identyczne statystyki', () => {
  const {m} = closedMeeting({v4: true});
  const other: Meeting = structuredClone(m);
  for (const b of other.ballots) if (b.mode === 'tajne') {
    b.result = {...b.result!, za: 1, przeciw: 6, adopted: false};
    b.secret = {...b.secret!, issued: [...b.secret!.issued].reverse(), cast: 3, fingerprint: 'INNY-ODCISK'};
    b.closedAt = (b.closedAt ?? 0) + 5 * MIN;
    b.announcedAt = (b.announcedAt ?? 0) + 7 * MIN;
  }
  for (const self of [null, 'si', 'kn', 'eo']) {
    const a = memberStats({meetings: [m], roster, range, self});
    const b = memberStats({meetings: [other], roster, range, self});
    assert.equal(JSON.stringify(b), JSON.stringify(a), `widz ${self}`);
    assert.equal(statsCsv(b, 'sklad', NOW), statsCsv(a, 'sklad', NOW));
  }
});

test('B4-T3: głosy jawne innych osób nie trafiają do statystyk; rozkład tylko z imiennych', () => {
  const {m} = closedMeeting({v4: true});
  const r = memberStats({meetings: [m], roster, range, self: null});
  for (const p of r.persons) {
    assert.equal(p.sessionVotes.own, undefined);
    assert.ok(p.rows.every(row => row.ballots.every(b => b.mode === 'imienne' ? b.choice === 'za' : b.choice === undefined)), p.name);
    assert.deepEqual([p.sessionVotes.imienne.za, p.sessionVotes.imienne.przeciw], [1, 0]);
  }
  const roster2 = rosterView(memberStats({meetings: [m], roster, range, self: 'si'}));
  assert.ok(roster2.persons.every(p => p.rows.length === 0 && p.sessionVotes.own === undefined), 'statystyki składu bez wierszy i własnych głosów');
});

test('B4-T4: moduł czyta głosowanie tylko w funkcji fact; z tajnego tylko secret.issued; turnout.ts nie importuje stats.ts (T-6)', () => {
  const raw = readFileSync(new URL('../src/shared/stats.ts', import.meta.url), 'utf8');
  // Kod bez komentarzy wierszowych (znacznik obszaru `fact` zostaje).
  const src = raw.replace(/^(?!\/\/ Jedyne miejsce|\/\/ -----)(.*?)\s*\/\/ .*$/gm, '$1').replace(/^\s*\/\/(?! Jedyne miejsce| -----).*$/gm, '').replace(/\/\*\*[\s\S]*?\*\//g, '');
  const start = src.indexOf('// Jedyne miejsce, które czyta głosowanie'), end = src.indexOf('// -----', start + 10);
  const outside = src.slice(0, start) + src.slice(end);
  assert.ok(!/\bb\.(votes|secret|result|eligible|absentDuring|announcedAt|closedAt|openedAt|mode|subject|number)\b/.test(outside), 'poza fact() nie ma odczytu pól głosowania');
  assert.deepEqual([...src.matchAll(/secret\??\.(\w+)/g)].map(x => x[1]), ['issued']);
  assert.ok(!/\.result\b|closeReason|secretVotes|fingerprint/.test(src));
  const turnoutSrc = readFileSync(new URL('../src/shared/turnout.ts', import.meta.url), 'utf8');
  assert.ok(!/from '\.\/stats\.ts'/.test(turnoutSrc));
  for (const file of ['../src/client/meeting.tsx', '../src/client/chair.tsx', '../src/client/screen.tsx', '../src/client/secret.ts', '../src/shared/catalog.ts', '../src/shared/papers.ts', '../src/shared/view.ts']) {
    assert.ok(!/stats\.ts/.test(readFileSync(new URL(file, import.meta.url), 'utf8')), `${file} nie importuje statystyk (B4-21)`);
  }
});

test('B4-T5: tylko posiedzenia zakończone i głosowania z ogłoszonym wynikiem; nieogłoszone dają uwagę', () => {
  const {m} = closedMeeting({v4: true});
  const unannounced: Meeting = {...m, id: 'm2', ballots: m.ballots.map((b, i) => i === 1 ? {...b, announcedAt: undefined} : b)};
  const live: Meeting = {...m, id: 'm3', status: 'trwa'};
  const r = memberStats({meetings: [unannounced, live], roster, range});
  assert.deepEqual(r.counted, {meetings: 1, procedures: 0, legacy: 0});
  assert.deepEqual(r.notes, [{kind: 'nieogloszone', meetingId: 'm2', day: '2026-11-20', ballot: 2}]);
  assert.equal(r.persons[0].sessionVotes.held, 6);
});

test('B4-06, B4-07: obecność przez całe obrady, częściowa (spóźnienie, wyjście, przerwa, głosowanie) i nieobecność; frekwencja jak w katalogu', () => {
  const {m} = closedMeeting({v4: true});
  const start = m.openedAt!, end = m.closedAt!;
  const long: Meeting = {...m, closedAt: start + 120 * MIN, presenceLog: [
    ...m.presenceLog.filter(e => !['ag', 'jw', 'kn', 'eo'].includes(e.who)),
    {who: 'ag', guest: false, type: 'przybycie', at: start + 25 * MIN, by: 'x'},
    {who: 'jw', guest: false, type: 'przybycie', at: start, by: 'x'}, {who: 'jw', guest: false, type: 'wyjscie', at: start + 80 * MIN, by: 'x'},
    {who: 'kn', guest: false, type: 'przybycie', at: start, by: 'x'}, {who: 'kn', guest: false, type: 'wyjscie', at: start + 10 * MIN, by: 'x'}, {who: 'kn', guest: false, type: 'przybycie', at: start + 40 * MIN, by: 'x'},
    {who: 'eo', guest: false, type: 'zgloszenie', at: start + 5 * MIN, by: 'x'},
  ]};
  void end;
  const r = memberStats({meetings: [long], roster, range});
  const of = (id: string) => r.persons.find(p => p.personId === id)!.rows[0].attendance!;
  assert.deepEqual([of('ag').kind, of('ag').reasons.includes('spoznienie'), of('ag').lateMin], ['czesciowa', true, 25]);
  assert.deepEqual([of('jw').kind, of('jw').earlyMin], ['czesciowa', 40]);
  assert.deepEqual([of('kn').kind, of('kn').gapMin], ['czesciowa', 30]);
  assert.deepEqual([of('eo').kind, of('eo').unconfirmed], ['nieobecnosc', true], 'zgłoszenie bez potwierdzenia');
  assert.equal(PARTIAL_MINUTES, 15);
  const si = r.persons.find(p => p.personId === 'si')!;
  assert.equal(turnout(si), 100);
  const t = meetingTurnout(long, roster);
  assert.deepEqual(t, {present: 6, members: 7}, 'frekwencja posiedzenia: obecni w którejkolwiek chwili');
  assert.equal(r.persons.reduce((n, p) => n + p.meetings.cala + p.meetings.czesciowa, 0), t.present, 'ta sama definicja w statystykach i katalogu (DB-24)');
  assert.deepEqual(periodTurnout([long], roster, range), {present: 6, seats: 7, meetings: 1});
});

test('B4-13, B4-14, U-41: głosowania między posiedzeniami osobno; okres, kadencja i dzień startu z linią źródła', () => {
  const {m} = closedMeeting({v4: true});
  const proc: Meeting = {...m, id: 'p1', kind: 'procedura'};
  const r = memberStats({meetings: [m, proc], roster, range, only: ['kn']});
  assert.deepEqual([r.counted.meetings, r.counted.procedures, r.persons[0].procedures, r.persons[0].procedureVotes.held], [1, 1, 1, 7]);
  assert.equal(memberStats({meetings: [m], roster, range, since: '2026-11-21'}).counted.meetings, 0, 'dzień startu po posiedzeniu');
  assert.equal(memberStats({meetings: [m], roster, range: {from: '0000-01-01', to: '9999-12-31'}, term: 'IX'}).counted.meetings, 1);
  assert.equal(memberStats({meetings: [m], roster, range: {from: '0000-01-01', to: '9999-12-31'}, term: 'X'}).counted.meetings, 0);
  assert.deepEqual(statsRangeInput({}, '2026-11-20'), {range: {from: '2026-01-01', to: '2026-12-31'}});
  assert.deepEqual(statsRangeInput({od: '2026-02-01', do: '2026-01-01'}, '2026-11-20'), {error: 'Początek okresu nie może być późniejszy niż koniec.'});
  assert.deepEqual(statsRangeInput({od: '2026-02-01'}, '2026-11-20'), {error: 'Wpisz datę początku i końca okresu.'});
  const withSince = memberStats({meetings: [m], roster, range, since: '2026-03-01', self: 'kn', only: ['kn']});
  assert.deepEqual(statsSourceLines(withSince, NOW), ['Stan na 20.11.2026, godz. 16:00. Liczone z posiedzeń zakończonych i głosowań z ogłoszonym wynikiem.', 'Statystyki liczą posiedzenia od 01.03.2026 (ustawienia ogólne).']);
  const file = statsCsv(withSince, 'moje', NOW);
  assert.ok(file.startsWith('﻿Stan na 20.11.2026, godz. 16:00. Liczone z posiedzeń zakończonych i głosowań z ogłoszonym wynikiem.\r\nStatystyki liczą posiedzenia od 01.03.2026 (ustawienia ogólne).\r\nDzień;Rodzaj;'));
  assert.ok(file.includes(';tajne;tak;karta pobrana;\r\n'), 'z tajnego tylko karta, bez głosu');
});
