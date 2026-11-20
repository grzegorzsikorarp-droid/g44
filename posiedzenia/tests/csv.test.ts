import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {csv} from '../src/shared/csv.ts';

// CSV dla arkusza (SPEC-4 5.5, B1-11): BOM, średnik, CRLF, cudzysłowy, ochrona przed formułami.

test('csv: BOM, średnik, CRLF i cudzysłowy przy średniku, cudzysłowie, nowej linii i spacji na brzegu', () => {
  const text = csv(['Imię i nazwisko', 'Obecność', 'Uwagi'], [
    ['Anna Przykładowa', 'obecność od 10:02', null],
    ['Jan; Próbny', 'cytat "a"', 'wiersz\ndrugi'],
    [' spacja', 12, undefined],
  ]);
  assert.ok(text.startsWith('﻿'));
  assert.ok(text.endsWith('\r\n'));
  assert.equal(text.slice(1).split('\r\n')[0], 'Imię i nazwisko;Obecność;Uwagi');
  assert.ok(text.includes('"Jan; Próbny";"cytat ""a""";"wiersz\ndrugi"'));
  assert.ok(text.includes('" spacja";12;'));
});

test('csv: komórka tekstowa zaczynająca formułę dostaje apostrof, liczby nie', () => {
  const text = csv(['a'], [['=SUMA(A1)'], ['+48 600'], ['-5'], ['@x'], ['\tx'], [-5]]);
  const rows = text.slice(1).split('\r\n');
  assert.deepEqual(rows.slice(1, 7), ["'=SUMA(A1)", "'+48 600", "'-5", "'@x", "'\tx", '-5']);
  assert.equal(csv(['h'], [], ['Stan na 20.11.2026, godz. 12:00.']).slice(1).split('\r\n')[0], 'Stan na 20.11.2026, godz. 12:00.');
});

test('csv czyta moduł csv Pythona (kontrola n)', () => {
  const text = csv(['Imię i nazwisko', 'Głos'], [['Anna Przykładowa', 'za'], ['Jan; Próbny', 'cytat "a"\nwiersz']]);
  const py = spawnSync('python3', ['-I', '-c', 'import csv,sys,json; data=sys.stdin.buffer.read().decode("utf-8-sig"); print(json.dumps(list(csv.reader(data.splitlines(True), delimiter=";"))))'], {input: text});
  if (py.error) return;   // bez Pythona w środowisku sprawdza to kontrola n
  assert.deepEqual(JSON.parse(py.stdout.toString()), [['Imię i nazwisko', 'Głos'], ['Anna Przykładowa', 'za'], ['Jan; Próbny', 'cytat "a"\nwiersz']]);
});
