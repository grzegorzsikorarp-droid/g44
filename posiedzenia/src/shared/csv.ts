// CSV dla arkusza (SPEC-4 5.5, B1-11): UTF-8 z BOM, średnik (polski Excel), CRLF, cudzysłowy wokół komórek ze średnikiem,
// cudzysłowem, nową linią albo spacją na brzegu, ochrona przed formułami: komórka tekstowa zaczynająca się od `=`, `+`,
// `-`, `@`, tabulacji albo CR dostaje na początku apostrof. Daty RRRR-MM-DD i godziny GG:MM podaje wywołujący.
// Wzór: /home/user/przeglad/v4-projekt/proby-B1/csv.mjs.

export type CsvCell = string | number | null | undefined;
const cell = (v: CsvCell) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Plik CSV z wierszem nagłówka. `lead` to wiersze nad nagłówkiem (np. linia źródła statystyk, K4-37). */
export function csv(head: string[], rows: CsvCell[][], lead: string[] = []): string {
  return '﻿' + [...lead.map(l => [l]), head, ...rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
