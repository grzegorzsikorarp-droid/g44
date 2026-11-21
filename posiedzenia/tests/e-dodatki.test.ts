import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readinessSentence, workTab} from '../src/client/prep-rules.ts';

// Dodatki wersji 4 na ekranach zespołu E (SPEC-4 6.5; dodatki D-7 i D-11): czyste reguły z prep-rules.ts.

const prep = (waiting: number, myTasks: number) => ({proposals: Array.from({length: waiting}, (_, i) => ({id: `p${i}`, state: 'zgloszone'})), progress: {myTasks}}) as never;

test('D-11 (6.5): zakładka telefonu „Zgłoszenia i zadania ({n})” liczy zgłoszenia czekające i Twoje otwarte zadania', () => {
  assert.deepEqual(workTab(prep(1, 2)), {label: 'Zgłoszenia i zadania (3)', name: 'Zgłoszenia i zadania, 3 do zrobienia'});
  assert.deepEqual(workTab(prep(0, 0)), {label: 'Zgłoszenia i zadania (0)', name: 'Zgłoszenia i zadania, 0 do zrobienia'});
  assert.deepEqual(workTab(null), {label: 'Zgłoszenia i zadania (0)', name: 'Zgłoszenia i zadania, 0 do zrobienia'});
});

test('D-7 (B2 2.7): wiersz punktu „Przyjęcie protokołu” mówi o braku sporządzonego protokołu', () => {
  const sentence = readinessSentence([{key: 'protokol', ok: false, text: 'Protokół posiedzenia z dnia 12.11.2026 nie jest jeszcze sporządzony.'}]);
  assert.match(sentence ?? '', /sporządzonego protokołu/);
  assert.equal(readinessSentence([{key: 'protokol', ok: true, text: 'Protokół posiedzenia z dnia 12.11.2026 sporządzono 25.11.2026.'}]), 'Gotowe.');
});
