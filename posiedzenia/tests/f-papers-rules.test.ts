import {test} from 'node:test';
import assert from 'node:assert/strict';
import {catalogHref, catalogParams, catalogQuery, changedText, checkBallotNumber, commsRowText, filedGroups, filedLine, filtersActive, formatButtons, paperPath, paperRows, presetOf, presetRange, releaseButton, releaseText} from '../src/client/papers-rules.ts';
import type {PaperEntry} from '../src/shared/papers.ts';
import type {FiledDocument} from '../src/shared/types.ts';

// Zespół F (SPEC-4 8.1, 8.4 pkt 7): czyste reguły ekranów „Dokumenty posiedzenia”, „Odbyte posiedzenia” i zestawienia
// z src/client/papers-rules.ts: filtry katalogu w adresie, stan udostępnienia materiału, przyciski formatów i okres.

const paper = (id: string, formats: PaperEntry['formats'], over: Partial<PaperEntry> = {}): PaperEntry => ({id: id as PaperEntry['id'], name: id, state: 'ustalony', formats, fileBase: id, ...over});
const filed = (over: Partial<FiledDocument>): FiledDocument => ({id: 'f1', kind: 'protokol_podpisany', title: '', fileId: 'plik_1', fileName: 'skan.pdf', mime: 'application/pdf', size: 1, sha256: '', at: Date.UTC(2026, 10, 21, 9), by: 'Biuro', accountId: 'a-biuro', ...over});

test('F: filtry katalogu z adresu, wartości domyślne i nieznane wartości (6.9, B1-25)', () => {
  const f = catalogQuery(new URLSearchParams('rodzaj=glosowania&stan=przyjety&brak=1&q=%20108%20'), '2026');
  assert.deepEqual(f, {rok: '2026', kadencja: '', rodzaj: 'glosowania', stan: 'przyjety', brak: true, q: ' 108 '});
  assert.equal(catalogQuery(new URLSearchParams('rok=20x6&rodzaj=inne&stan=do_podpisu'), '2026').rok, '2026');
  assert.equal(catalogQuery(new URLSearchParams('rodzaj=inne'), '2026').rodzaj, 'wszystkie');
  assert.equal(catalogQuery(new URLSearchParams('stan=do_podpisu'), '2026').stan, 'wszystkie', 'stan „Do podpisu” z B1-27 zastąpił stan „Sporządzony” (S-3)');
  assert.equal(catalogQuery(new URLSearchParams('q=' + 'x'.repeat(300)), '2026').q.length, 100);
});

test('F: adres katalogu pomija wartości domyślne, a rok zostaje zawsze (filtry do przesłania odnośnikiem)', () => {
  const base = catalogQuery(new URLSearchParams(''), '2026');
  assert.equal(catalogHref(base), '#odbyte?rok=2026');
  assert.equal(filtersActive(base), false);
  const f = {...base, rodzaj: 'posiedzenia' as const, q: ' patronat ', kadencja: 'I kadencja 2025–2029'};
  assert.deepEqual(catalogParams(f), {rok: '2026', kadencja: 'I kadencja 2025–2029', rodzaj: 'posiedzenia', q: 'patronat'});
  assert.equal(catalogHref(f), '#odbyte?rok=2026&kadencja=I+kadencja+2025%E2%80%932029&rodzaj=posiedzenia&q=patronat');
  assert.equal(filtersActive(f), true);
  assert.equal(filtersActive({...base, brak: true}), true);
});

test('F: stan udostępnienia materiału dla komunikacji słowem w karcie i w wierszu konta „Komunikacja” (6.8, 4.4, DB-42)', () => {
  const at = Date.UTC(2026, 10, 20, 15, 40);
  assert.equal(releaseText('brak'), 'Czeka na udostępnienie.');
  assert.equal(releaseText('udostepniony', at), 'Udostępniono 20.11.2026, godz. 16:40.');
  assert.equal(releaseText('zmieniony', at), 'Zmienił się po udostępnieniu. Konto komunikacji go nie pobierze, dopóki nie udostępnisz go ponownie.');
  assert.equal(commsRowText('brak'), 'Materiał dla komunikacji czeka na udostępnienie.');
  assert.equal(commsRowText('udostepniony', at), 'Udostępniono 20.11.2026, godz. 16:40.');
  assert.equal(commsRowText('zmieniony', at), 'Materiał zmienił się po udostępnieniu i czeka na ponowne udostępnienie.');
  // Wiersz katalogu bez chwili udostępnienia nie może mówić, że materiał czeka (stan „Udostępniono”).
  assert.equal(commsRowText('udostepniony', null), 'Materiał dla komunikacji jest udostępniony i można go pobrać.');
  assert.equal(releaseText('udostepniony', null), 'Udostępniono.');
  assert.equal(changedText(at), 'Zmienił się 20.11.2026, godz. 16:40.');
  for (const s of [releaseText('brak'), commsRowText('zmieniony'), changedText(at)]) assert.ok(!s.includes(':') || /\d:\d/.test(s), 'bez dwukropków poza godziną');
});

test('F: przycisk udostępnienia: „Udostępnij komunikacji”, po zmianie „Udostępnij ponownie”, po udostępnieniu brak (DB-42)', () => {
  assert.equal(releaseButton('brak'), 'Udostępnij komunikacji');
  assert.equal(releaseButton(undefined), 'Udostępnij komunikacji');
  assert.equal(releaseButton('zmieniony'), 'Udostępnij ponownie');
  assert.equal(releaseButton('udostepniony'), null);
});

test('F: przyciski formatów z napisem formatu i pełną nazwą dostępną, bez ZIP (6.0, B1-11)', () => {
  const buttons = formatButtons(paper('obecnosc', ['html', 'docx', 'csv']), 'listę obecności');
  assert.deepEqual(buttons.map(b => b.label), ['Drukuj', 'Word', 'CSV']);
  assert.deepEqual(buttons.map(b => b.name), ['Drukuj listę obecności', 'Pobierz listę obecności w formacie Word', 'Pobierz listę obecności w formacie CSV']);
  assert.deepEqual(formatButtons(paper('porzadek', ['html', 'docx', 'md']), 'porządek obrad').map(b => b.name).at(-1), 'Pobierz porządek obrad w formacie Markdown');
  assert.deepEqual(formatButtons(paper('teczka', ['zip']), 'teczkę posiedzenia'), []);
  assert.equal(paperPath('m 1', 'obecnosc', 'html'), '/api/meetings/m%201/dokumenty/obecnosc');
  assert.equal(paperPath('m1', 'wykaz-4', 'csv'), '/api/meetings/m1/dokumenty/wykaz-4?format=csv');
});

test('F: lista obecności do podpisu jest odnośnikiem w wierszu listy obecności, a teczka i materiał mają własne części karty (6.8)', () => {
  const rows = paperRows([paper('protokol', ['html', 'docx']), paper('obecnosc', ['html', 'docx', 'csv']), paper('obecnosc-podpis', ['html', 'docx']), paper('komunikacja', ['md']), paper('teczka', ['zip'])]);
  assert.deepEqual(rows.map(r => r.paper.id), ['protokol', 'obecnosc']);
  assert.equal(rows[1].signature?.id, 'obecnosc-podpis');
  assert.equal(rows[0].signature, null);
});

test('F: pliki po posiedzeniu: bieżące i zastąpione, wiersz z rodzajem, nazwą pliku, datą i osobą (6.8)', () => {
  const g = filedGroups([filed({id: 'a', replacedAt: Date.UTC(2026, 10, 22)}), filed({id: 'b'}), filed({id: 'c', kind: 'inny', title: 'Pismo przewodnie', fileName: 'pismo.pdf'})]);
  assert.deepEqual(g.current.map(f => f.id), ['b', 'c']);
  assert.deepEqual(g.replaced.map(f => f.id), ['a']);
  assert.equal(filedLine(g.current[0]), 'Protokół podpisany (skan) „skan.pdf”, 21.11.2026, Biuro.');
  assert.equal(filedLine(g.current[1]), 'Pismo przewodnie „pismo.pdf”, 21.11.2026, Biuro.');
  assert.deepEqual(filedGroups(undefined), {current: [], replaced: []});
});

test('F: wiersz „Do sprawdzenia” o głosowaniu nad protokołem wskazuje numer głosowania do poprawki (G-38, K4-4)', () => {
  assert.equal(checkBallotNumber('Głosowanie nr 4 nie wskazuje, którego protokołu dotyczy.'), 4);
  assert.equal(checkBallotNumber('Głosowanie nr 12 wskazuje protokół posiedzenia z dnia 12.03.2026, a przedmiot głosowania mówi o dniu 15.03.2026.'), 12);
  assert.equal(checkBallotNumber('Dołączono plik protokołu. Wpisz datę sporządzenia i osobę, która sporządziła protokół.'), null);
});

test('F: okres zestawienia: rok, ostatnie 12 miesięcy, kadencja i „Inny okres” (6.9, B1-30)', () => {
  assert.deepEqual(presetRange('rok', '2026-11-21'), {from: '2026-01-01', to: '2026-12-31'});
  assert.deepEqual(presetRange('12', '2026-11-21'), {from: '2025-11-22', to: '2026-11-21'});
  assert.deepEqual(presetRange('12', '2028-02-29'), {from: '2027-03-01', to: '2028-02-29'}, '29 lutego bez dnia w roku poprzednim');
  assert.equal(presetRange('kadencja', '2026-11-21', null), null);
  const term = {from: '2025-01-01', to: '2029-12-31'};
  assert.equal(presetOf({from: '2026-01-01', to: '2026-12-31'}, '2026-11-21', term), 'rok');
  assert.equal(presetOf(term, '2026-11-21', term), 'kadencja');
  assert.equal(presetOf({from: '2025-11-22', to: '2026-11-21'}, '2026-11-21', term), '12');
  assert.equal(presetOf({from: '2026-03-01', to: '2026-04-30'}, '2026-11-21', term), 'inny');
});
