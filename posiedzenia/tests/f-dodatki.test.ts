import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reportDownloads} from '../src/client/papers-rules.ts';

// Dodatki wersji 4 na ekranach zespołu F (SPEC-4 8.0): czyste reguły z papers-rules.ts.

test('D-17 (6.9): przyciski zestawienia za okres z Wordem i Markdown obok CSV posiedzeń i aktów', () => {
  const base = '/api/zestawienie?od=2026-01-01&do=2026-12-31';
  assert.deepEqual(reportDownloads(base), [
    {label: 'Pobierz posiedzenia w formacie CSV', href: `${base}&format=csv&czesc=posiedzenia`},
    {label: 'Pobierz akty w formacie CSV', href: `${base}&format=csv&czesc=akty`},
    {label: 'Pobierz w formacie Word', href: `${base}&format=docx`},
    {label: 'Pobierz w formacie Markdown', href: `${base}&format=md`},
  ]);
});
