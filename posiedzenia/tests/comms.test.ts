import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commsCeiling, commsChangedAt, commsChoices, commsLevelOfItem, commsMarkdown, commsRelease, commsSourceText} from '../src/shared/comms.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import type {Meeting} from '../src/shared/types.ts';
import {closedMeeting, envWith, NOW, openedMeeting} from './scenariusz-v4.ts';

// Materiał dla komunikacji (SPEC-4 6.10, DB-10, DB-41, DB-42; K4-1 pkt 8, K4-5, K4-6, K4-32; etap D.1 pkt 5 i 8).

const item = (m: Meeting, prefix: string) => m.agenda.find(i => i.title.startsWith(prefix))!;

test('K4-1 pkt 8: podpunkt bez rodzaju sprawy, tytuł pokazanego pliku i osoba spoza składu nie trafiają do pliku', () => {
  const {m, env} = closedMeeting({v4: true});
  const text = commsMarkdown(m, env, {at: NOW});
  for (const s of ['Anny Testowej', 'Anna Testowa', 'Jana Próbnego', 'Pismo', 'Ewa Zewnętrzna', 'Zewnętrzna']) assert.ok(!text.includes(s), s);
  assert.ok(text.includes('Sprawy bez rodzaju sprawy, 1'), 'podpunkt tylko liczbą');
  assert.ok(text.includes('Pokazano 1 plik.'), 'pokazany plik tylko liczbą przy poziomie innym niż „Pełna treść”');
  assert.ok(text.includes('Sprawy bez rodzaju sprawy mają w materiale tylko liczbę. Ustaw rodzaj sprawy albo dopisz zdanie dla komunikacji, a materiał się zaktualizuje.'));
  assert.ok(text.includes('Osoby przy punktach pochodzą z porządku obrad. Materiał wymienia tylko członków Prezydium i osoby z głosem doradczym.'));
  assert.ok(!text.includes('Tytuły punktów bez rodzaju sprawy przepisano'), 'wiersz B1-33 znika');
});

test('K4-1: osoba przy punkcie ze składu (personId) jest wymieniona, tytuły pokazanych plików tylko przy „Pełna treść”', () => {
  const {m, env} = closedMeeting({v4: true});
  const it = item(m, 'Uchwała nr 108');
  const withPerson: Meeting = {...m, agenda: m.agenda.map(i => i.id === it.id ? {...i, presenters: [{name: 'Krystyna', role: 'Sekretarz', kind: 'referuje', personId: 'kn'}, {name: 'Ktoś Spoza', role: '', kind: 'referuje'}]} : i),
    displays: [...m.displays!, {...m.displays![0], id: 'd2', title: 'Plakat konferencji', itemId: it.id}],
    log: [...m.log, {at: NOW, text: 'Pokazano plik.', by: 'x', tag: 'pokaz', itemId: it.id, displayId: 'd2'}]};
  const text = commsMarkdown(withPerson, env, {at: NOW});
  assert.match(text, /Według porządku obrad referuje [^\n]+, Sekretarz\./);
  assert.ok(!text.includes('Ktoś Spoza'));
  assert.ok(text.includes('Pokazano 1 plik.') && !text.includes('Plakat konferencji'), 'poziom „Tytuł”: liczba bez tytułu');
  const full: Meeting = {...withPerson, closedComms: {...withPerson.closedComms, [it.id]: 'pelna'}};
  assert.ok(commsMarkdown(full, env, {at: NOW}).includes('Pokazano plik „Plakat konferencji”.'), 'poziom „Pełna treść”: tytuł pliku');
});

test('K4-5: poziomy utrwalone przy zamknięciu; zmiana rodzaju dokumentu „Uchwała” na „Tytuł” po zamknięciu nie zmienia pliku', () => {
  const {m, env} = closedMeeting({v4: true});
  const before = commsMarkdown(m, env, {at: NOW});
  const looser = envWith(defaultDocTypes.map(t => t.id === 'uchwala' ? {...t, comms: 'pelna' as const} : t), env.general.caseTypes.map(c => ({...c, comms: c.id === 'pomoc' ? 'pelna' as const : c.comms})));
  assert.equal(commsMarkdown(m, looser, {at: NOW}), before);
  // Przed zamknięciem poziom 1 działa od razu; sprawa bez rodzaju sprawy ma sufit „Tylko liczba” (U-24a).
  const {m: live} = openedMeeting({v4: true});
  const noCase = item(live, 'Uchwała nr 110');
  assert.equal(commsLevelOfItem(live, noCase, envWith(defaultDocTypes.map(t => ({...t, comms: 'pelna' as const})))), 'liczba');
  assert.equal(commsCeiling(live, noCase, env).source, 'aplikacja');
  assert.equal(commsSourceText(live, noCase, env), 'Ustalone w aplikacji. Sprawa bez rodzaju sprawy ma w materiale dla komunikacji tylko liczbę.');
});

test('U-24–U-26: rodzaj sprawy przed rodzajem dokumentu, punkt porządkowy „Tytuł”, poziom przy punkcie tylko zaostrza (G-22)', () => {
  const {m} = openedMeeting({v4: true});
  const env = envWith();
  const opening = m.agenda.find(i => i.kind === 'otwarcie')!;
  assert.deepEqual([commsCeiling(m, opening, env).level, commsCeiling(m, opening, env).source], ['tytul', 'porzadkowy']);
  const patronage = {...item(m, 'Uchwała nr 108'), caseType: 'patronat'};
  assert.equal(commsLevelOfItem(m, patronage, env), 'tytul', 'rodzaj sprawy „Tytuł” przy uchwale („Tylko liczba”)');
  assert.equal(commsSourceText(m, patronage, env), 'Wynika z rodzaju sprawy »Patronat«.');
  const position = {...item(m, 'Uchwała nr 110'), caseType: 'stanowiska'};
  assert.equal(commsLevelOfItem(m, position, env), 'pelna', 'jak rodzaj dokumentu „Stanowisko”');
  assert.equal(commsSourceText(m, position, env), 'Wynika z rodzaju sprawy »Stanowiska«, który przyjmuje wartość z rodzaju dokumentu »Stanowisko«.');
  const stricter = {...position, comms: {level: 'liczba' as const, stamp: {at: 1, by: 'x', accountId: 'u'}}};
  assert.equal(commsLevelOfItem(m, stricter, env), 'liczba');
  assert.equal(commsSourceText(m, stricter, env), 'Zmienione dla tego punktu. Z rodzaju sprawy Pełna treść.');
  const looser = {...patronage, comms: {level: 'pelna' as const, stamp: {at: 1, by: 'x', accountId: 'u'}}};
  assert.equal(commsLevelOfItem(m, looser, env), 'tytul', 'poziom przy punkcie nie otwiera');
  assert.deepEqual(commsChoices(m, patronage, env), ['tytul', 'liczba', 'pomin']);
});

test('K4-6: akty „Nie trafia” w sumach, bez numerów i tytułów; grupy „Tylko liczba” bez numerów przy luce', () => {
  const {m, env} = closedMeeting({v4: true});
  const text = commsMarkdown(m, env, {at: NOW});
  assert.ok(text.includes('Prezydium podjęło 4 uchwały (Uchwała nr 108/IX/2026 w sprawie patronatu nad konferencją), w tym 1 w sprawach, których ten materiał nie opisuje.'), text.split('\n').find(l => l.startsWith('2.')));
  assert.ok(!text.includes('109/IX') && !text.includes('zapomogi'), 'akt „Nie trafia” bez numeru i tytułu');
  assert.ok(text.includes('### Uchwały bez rodzaju sprawy\n\nPodjęto 2 uchwały.'), 'grupa bez numerów');
  assert.ok(!text.includes('110/IX') && !text.includes('111/IX'));
  assert.ok(text.includes('Sprawy, których ten materiał nie opisuje, 1'));
  assert.ok(text.includes('podjete_akty: "Uchwała 4"'));
  assert.ok(text.includes('- Głosowań 7, w tym nad aktami 4.') && text.includes('- Punktów porządku obrad 7, podpunktów 5.'));
  // Bez aktu „Nie trafia” grupa podaje numery.
  const noHidden = commsMarkdown({...m, closedComms: {...m.closedComms, [item(m, 'Uchwała nr 109').id]: 'liczba'}}, env, {at: NOW});
  assert.ok(noHidden.includes('### Uchwały bez rodzaju sprawy\n\nPodjęto 2 uchwały, numery 110/IX/2026, 111/IX/2026.'), 'numery, gdy nic nie jest pominięte');
  assert.ok(noHidden.includes('### Pomoc w przypadkach losowych\n\nPodjęto 1 uchwałę, nr 109/IX/2026.'), 'grupa rodzaju sprawy z numerem');
});

test('głosowanie tajne tylko wynikiem; plik dopiero po zamknięciu; YAML z napisami JSON; zdanie i opis dla komunikacji', () => {
  const {m, env} = closedMeeting({v4: true});
  const text = commsMarkdown(m, env, {at: NOW});
  assert.ok(!/kart|odcisk|TEST-TEST|Krystyna Naczk|wniosek o głosowanie/i.test(text.replace('Do sprawdzenia', '')), 'bez kart, odcisku i autora wniosku o tajność');
  assert.ok(text.includes('W głosowaniach tajnych materiał podaje tylko wynik.'));
  const yaml = text.split('---\n')[1];
  for (const line of yaml.trim().split('\n')) { const value = line.slice(line.indexOf(':') + 2); JSON.parse(value); }
  assert.ok(text.includes('Zdanie dla komunikacji Patronat nad konferencją dla pielęgniarek i położnych.'));
  assert.ok(text.includes('Nie wpisano opisu posiedzenia.'));
  const noted = commsMarkdown({...m, commsNote: {text: 'Prezydium omówiło *pilne* sprawy.', at: NOW, by: 'Biuro', accountId: 'u'}}, env, {at: NOW});
  assert.ok(noted.includes('## Opis posiedzenia\n\nPrezydium omówiło \\*pilne\\* sprawy.\n\nOpis wpisano 20 listopada 2026 r.'), 'opis pod „Najważniejsze”, znaki Markdown zabezpieczone');
  assert.ok(noted.indexOf('## Opis posiedzenia') > noted.indexOf('## Najważniejsze w trzech zdaniach') && noted.indexOf('## Opis posiedzenia') < noted.indexOf('## Prowadzenie'));
  assert.ok(!/\.\.(?!\.)/.test(text.replace(/…/g, '')), 'bez podwójnych kropek');
  const {m: live} = openedMeeting({v4: true});
  assert.throws(() => commsMarkdown(live, env, {at: NOW}), {message: 'Materiał dla komunikacji powstaje po zamknięciu posiedzenia.'});
});

test('K4-32: termin następnego posiedzenia tylko po wpisaniu daty zawiadomienia; po przyjęciu protokołu nowy stan i terminy', () => {
  const {m, env} = closedMeeting({v4: true});
  assert.ok(!commsMarkdown(m, env, {at: NOW, next: {date: '2026-12-10', noticeDate: ''}}).includes('Następne posiedzenie'));
  assert.ok(commsMarkdown(m, env, {at: NOW, next: {date: '2026-12-10', noticeDate: '2026-12-01'}}).includes('- Następne posiedzenie Prezydium jest w przygotowaniu na 10 grudnia 2026 r. Termin może się zmienić.'));
  const adoption = {meetingId: 'm2', date: '2026-12-10', ballotNumber: 2, at: Date.parse('2026-12-10T11:00:00Z'), kind: 'posiedzenie' as const};
  const after = commsMarkdown({...m, photos: {url: 'https://photos.app.goo.gl/Przyklad', at: NOW, by: 'x', accountId: 'u'}}, env, {at: NOW, adoption});
  assert.ok(after.includes('stan: "protokół przyjęty 2026-12-10"'));
  assert.ok(after.includes('- Protokół przyjęto 10 grudnia 2026 r. na posiedzeniu z dnia 10 grudnia 2026 r., w głosowaniu nr 2.'));
  assert.ok(!after.includes('Protokół nie został jeszcze przyjęty.'));
  assert.ok(after.includes('zdjecia: "https://photos.app.goo.gl/Przyklad"') && after.includes('Odnośnik do albumu otwiera album każdemu, kto go zna.'));
  assert.ok(commsChangedAt(m, adoption) === adoption.at);
});

test('DB-42: stan udostępnienia materiału i zmiana treści po udostępnieniu', () => {
  const {m} = closedMeeting({v4: true});
  assert.equal(commsRelease(m), 'brak');
  const released: Meeting = {...m, commsReleased: {at: NOW, by: 'Biuro', accountId: 'u', inputs: 0}};
  assert.equal(commsRelease(released), 'udostepniony');
  assert.equal(commsRelease({...released, commsInputs: 1}), 'zmieniony');
});
