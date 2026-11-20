import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../src/shared/meeting.ts';
import {actBallots, fileBase, meetingPapers, minutesHideUnannounced, paperCsv, paperHtml, paperPage, paperState, agendaMarkdown, channelMessages} from '../src/shared/papers.ts';
import {minutesBody, minutesDocx, minutesHtml} from '../src/server/minutes.ts';
import {seesUnannounced} from '../src/shared/view.ts';
import type {Actor, Meeting} from '../src/shared/types.ts';
import {actor, presidium, roster} from './helpers.ts';
import {chair, closedMeeting, envWith, last, NOW, office, openedMeeting, voteAll} from './scenariusz-v4.ts';
import {docxText} from './docx-text.ts';

// Dokumenty posiedzenia wersji 4 (SPEC-4 5.5, B1-01–B1-23, DB-4, T-7; etap D.1 pkt 5 i 8).

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/[\u00a0\u2060]/g, ' ').replace(/\s+/g, ' ');
const guest: Actor = {account: {id: 'u-gosc', username: 'gosc', kind: 'gosc', personId: null, displayName: 'Jan Gościnny', label: '', admin: false, mustChange: false, disabled: false}, personId: null, name: 'Jan Gościnny'};
const ctxOf = (at = NOW) => ({env: envWith(), at, office: 'biuro Izby'});

test('B1-02: stany dokumentów w przygotowaniu, w trakcie, na spotkaniu roboczym i po zamknięciu', () => {
  const {m: live} = openedMeeting({v4: true});
  assert.deepEqual(['protokol', 'porzadek', 'obecnosc', 'wyniki', 'kanal', 'dziennik'].map(id => paperState(live, id as never)), ['projekt', 'stan_na', 'stan_na', 'stan_na', 'stan_na', 'stan_na']);
  const prep = {...live, status: 'przygotowanie' as const, agendaAdopted: false};
  assert.equal(paperState(prep, 'porzadek'), 'projekt');
  assert.equal(paperState({...live, working: {at: 1, by: 'x', reason: 'brak_kworum' as const}}, 'porzadek'), 'projekt', 'spotkanie robocze: zawsze projekt porządku');
  const {m: closed} = closedMeeting({v4: true});
  assert.deepEqual(['protokol', 'porzadek', 'obecnosc', 'wyniki', 'teczka'].map(id => paperState(closed, id as never)), ['projekt', 'ustalony', 'ustalony', 'ustalony', 'ustalony']);
});

test('B1-07: nazwy plików ASCII, z datą, organem, rodzajem i stanem, najwyżej 80 znaków', () => {
  const {m: live} = openedMeeting({v4: true});
  const at = Date.parse('2026-11-20T10:05:00Z');
  assert.equal(fileBase(live, 'protokol', at), '2026-11-20-prezydium-projekt-protokolu');
  assert.equal(fileBase(live, 'obecnosc', at), '2026-11-20-prezydium-lista-obecnosci-stan-na-20261120-1105');
  const {m: closed} = closedMeeting({v4: true});
  const act = actBallots(closed, envWith())[0];
  assert.equal(fileBase(closed, `akt-${act.id}`, at), '2026-11-20-prezydium-uchwala-108-ix-2026');
  const proc = {...closed, kind: 'procedura' as const};
  assert.equal(fileBase(proc, 'wyniki', at), '2026-11-20-prezydium-glosowanie-miedzy-posiedzeniami-wyniki-glosowan');
  for (const id of ['protokol', 'porzadek', 'obecnosc', 'kanal', 'dziennik', 'teczka', 'komunikacja'] as const) {
    const name = fileBase(closed, id, at);
    assert.ok(/^[a-z0-9-]+$/.test(name) && name.length <= 80, name);
  }
});

test('B1-01, B1-04: lista dokumentów według uprawnień osoby', () => {
  const {m} = closedMeeting({v4: true});
  const withGuest = {...m, invited: [guest.account.id]};
  const env = envWith();
  const ids = (a: Actor) => meetingPapers(withGuest, env, a, NOW).map(p => p.id);
  assert.deepEqual(ids(office), ['protokol', 'porzadek', 'obecnosc', 'obecnosc-podpis', 'wyniki', 'wykaz-4', ...actBallots(m, env).map(b => `akt-${b.id}`), 'kanal', 'dziennik', 'komunikacja', 'teczka']);
  assert.ok(!ids(actor('eo')).includes('komunikacja'), 'członek bez materiału dla komunikacji');
  assert.ok(ids(actor('eo')).includes('teczka'));
  assert.deepEqual(ids(guest).filter(id => !id.startsWith('akt-')), ['porzadek', 'wyniki', 'wykaz-4', 'kanal'], 'gość bez projektu protokołu, listy obecności, dziennika i teczki');
  const kanal = meetingPapers(withGuest, env, office, NOW).find(p => p.id === 'kanal')!;
  assert.deepEqual([kanal.note, kanal.formats], ['Nie było wiadomości.', []]);
  assert.deepEqual(meetingPapers(withGuest, env, office, NOW).find(p => p.id === 'porzadek')!.formats, ['html', 'docx', 'md']);
});

test('B1-03, T-7: pliki bez liczb nieogłoszonego głosowania także u osoby prowadzącej; głosowanie otwarte tylko zdaniem', () => {
  let {ctx, m} = openedMeeting({v4: true});
  const it = m.agenda.find(i => i.title.startsWith('Uchwała nr 108'))!;
  m = apply(m, {type: 'item_start', itemId: it.id, reason: 'Kolejność w teście.'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: it.title, mode: 'jawne', minutes: 2}, chair, ctx.tick());
  const open = paperHtml('wyniki', m, ctxOf());
  assert.ok(plain(open).includes(`Głosowanie nr ${last(m).number} trwa.`));
  assert.ok(!plain(open).includes(it.title), 'głosowanie otwarte bez przedmiotu i liczb');
  m = voteAll(m, ctx, 'przeciw');
  const hiddenNumber = last(m).number;
  assert.equal(last(m).status, 'zamkniete');
  assert.ok(!last(m).announcedAt, 'wynik jeszcze nieogłoszony');
  const html = plain(paperHtml('wyniki', m, ctxOf()));
  const csvText = paperCsv('wyniki', m, ctxOf());
  const log = paperCsv('dziennik', m, ctxOf());
  for (const text of [html, csvText, log]) {
    assert.ok(!text.includes('Uchwała nie została podjęta'), 'bez rozstrzygnięcia');
    assert.ok(!/przeciw 7|;0;7;0;/.test(text), 'bez liczb głosów');
  }
  assert.ok(html.includes('Wynik ogłosi osoba prowadząca obrady.'));
  // Projekt protokołu posiedzenia otwartego w wersji 4 ukrywa wynik także u osoby prowadzącej (DB-4, B1-03).
  assert.equal(seesUnannounced(m, chair, roster), true);
  assert.equal(minutesHideUnannounced(m, true), true);
  const minutes = plain(minutesBody(m, roster, [], NOW, {}, {hideUnannounced: false}));
  assert.ok(minutes.includes(`Głosowanie nr ${hiddenNumber}`) && minutes.includes('Wynik ogłosi osoba prowadząca obrady.'));
  // Posiedzenie sprzed wersji 4 zachowuje widoczność wersji 3 u osoby prowadzącej (DB-4, odstępstwo D.1-1).
  const old = {...m, frozen: {...m.frozen!, v4: undefined}} as Meeting;
  assert.equal(minutesHideUnannounced(old, true), false);
  assert.ok(plain(minutesBody(old, roster, [], NOW, {}, {hideUnannounced: false})).includes('Uchwała nie została podjęta'));
});

test('B1-17, T-7: wyniki i wykaz imienny w kolejności składu, tajne tylko liczby, bez godzin kart', () => {
  const {m} = closedMeeting({v4: true});
  const html = plain(paperHtml('wyniki', m, ctxOf()));
  assert.ok(html.includes('Głosowanie tajne. Pobrano kart 7, oddano głosów 7.'));
  assert.ok(html.includes('System nie zapisuje powiązania między osobą a głosem.'));
  const names = roster.persons;
  const order = presidium.map(id => names.find(p => p.id === id)!.name);
  const rollCall = paperCsv('wykaz-4', m, ctxOf()).slice(1).split('\r\n').slice(1, -1).map(r => r.split(';')[0]);
  assert.deepEqual(rollCall, order, 'wykaz imienny w kolejności składu');
  // Głosowanie między posiedzeniami: osoby, które pobrały kartę, w kolejności składu, choć pobierały odwrotnie.
  const proc: Meeting = {...m, kind: 'procedura', ballots: m.ballots.map(b => b.mode === 'tajne' ? {...b, remote: true} : b)};
  const text = plain(paperHtml('wyniki', proc, ctxOf()));
  const line = text.slice(text.indexOf('Kartę do głosowania pobrały osoby'));
  const positions = order.map(n => line.indexOf(n));
  assert.ok(positions.every((p, i) => p > 0 && (i === 0 || p > positions[i - 1])), 'kolejność składu');
  assert.ok(!/\d\d:\d\d/.test(line.slice(0, line.indexOf('.'))), 'bez godzin pobrania karty');
});

test('B1-18: akt z treścią przyjętą tylko przy zgodnym skrócie wersji głosowanej; podpisy z § 8 ust. 7', () => {
  const {m} = closedMeeting({v4: true});
  const b = actBallots(m, envWith())[0];
  const withMaterial: Meeting = {...m, ballots: m.ballots.map(x => x.id === b.id ? {...x, material: {id: 'mat1', version: 2, hash: 'abc', title: x.subject}} : x)};
  const ctx = {...ctxOf(), materialHtml: (id: string, v: number) => id === 'mat1' && v === 2 ? {html: '<p>§ 1. Udziela się patronatu.</p>', hash: 'abc'} : null};
  const html = plain(paperHtml(`akt-${b.id}`, withMaterial, ctx));
  assert.ok(html.includes('§ 1. Udziela się patronatu.'));
  assert.ok(html.includes(`Treść przyjęta w głosowaniu nr ${b.number} (jawne) na posiedzeniu z dnia 20 listopada 2026 r.`));
  assert.ok(html.includes('Dokument z aplikacji, bez podpisów.'));
  assert.ok(html.includes('Przewodniczący lub Wiceprzewodniczący Okręgowej Rady Pielęgniarek i Położnych w Słupsku'));
  assert.ok(html.includes('Podpisy według § 8 ust. 7'));
  const bad = {...ctx, materialHtml: () => ({html: '<p>Inna treść</p>', hash: 'zmieniony'})};
  assert.throws(() => paperHtml(`akt-${b.id}`, withMaterial, bad), {message: 'Treść w aplikacji różni się od wersji głosowanej. Zgłoś to biuru.'});
});

test('B1-15, B1-16, B1-21: porządek z zawiadomieniem, lista obecności i kanał wiadomości', () => {
  const {m} = closedMeeting({v4: true});
  const agenda = plain(paperHtml('porzadek', m, ctxOf()));
  assert.ok(agenda.includes('Porządek obrad przyjęty w głosowaniu nr 1.'));
  assert.ok(agenda.includes('Zawiadomienie o terminie, miejscu i porządku obrad wysłano 10 listopada 2026 r., 10 dni przed posiedzeniem (§ 7 ust. 1).'));
  assert.ok(agendaMarkdown(m, ctxOf()).startsWith('# Porządek obrad posiedzenia Prezydium Okręgowej Rady'));
  const attendance = paperCsv('obecnosc', m, ctxOf());
  assert.ok(attendance.split('\r\n')[0].endsWith('Imię i nazwisko;Funkcja;Rodzaj;Obecność;Sposób potwierdzenia;Pierwsze przybycie;Wyjścia'));
  // B2-W20: przy posiedzeniu otwartym w wersji 4 kanał od otwarcia.
  const early: Meeting = {...m, messages: [{id: 'x1', author: 'kn', authorName: 'Krystyna', text: 'Przed otwarciem', at: m.openedAt! - 1000}, {id: 'x2', author: 'kn', authorName: 'Krystyna', text: 'Po otwarciu', at: m.openedAt! + 1000}]};
  assert.deepEqual(channelMessages(early).map(x => x.id), ['x2']);
  assert.deepEqual(channelMessages({...early, frozen: {...early.frozen!, v4: undefined}} as Meeting).map(x => x.id), ['x1', 'x2']);
});

test('B3-14 i B2-W20 w projekcie protokołu tylko przy frozen.v4; opakowanie strony i pliku Word (B1-05, B1-09)', async () => {
  const {m} = closedMeeting({v4: true});
  const v4 = plain(minutesBody(m, roster, [], NOW));
  assert.ok(v4.includes('Pliki pokazane w punkcie „Wniosek Anny Testowej o zapomogę” „Pismo Jana Próbnego.pdf” (PDF, 3 strony).'));
  const old = {...m, frozen: {...m.frozen!, v4: undefined}} as Meeting;
  assert.ok(!plain(minutesBody(old, roster, [], NOW)).includes('Pliki pokazane w punkcie'));
  const page = minutesHtml(m, roster, [], NOW);
  assert.match(page, /<table class="paper-layout" role="presentation"><thead><tr><td><p class="paper-mark">Projekt<\/p>/);
  assert.match(page, /@top-left\{content:"Projekt protokołu, posiedzenie z dnia 20\.11\.2026"\}/, 'nagłówek od drugiej strony bez powtórzonego słowa „Projekt”');
  assert.match(page, /@bottom-left\{content:"Wygenerowano 20\.11\.2026, godz\. 16:00"\}/);
  assert.ok(plain(page).includes('Numery stron drukują Chrome i Edge. W innej przeglądarce pobierz wersję Word.'));
  assert.ok(page.includes('Drukuj albo zapisz jako PDF'));
  const docx = await minutesDocx(m, roster, [], NOW, {org: 'Organizacja przykładowa'});
  const text = docxText(docx);
  assert.ok(text.includes('Pliki pokazane w punkcie'));
  assert.ok(docxText(docx, 'word/header1.xml').includes('Projekt protokołu, posiedzenie z dnia 20.11.2026') && !docxText(docx, 'word/header1.xml').includes('Projekt Projekt'));
  assert.ok(docxText(docx, 'word/header2.xml').includes('Organizacja przykładowa'));
  assert.ok(docxText(docx, 'word/footer1.xml').includes('Wygenerowano 20.11.2026, godz. 16:00'));
  const standalone = paperPage('<p>x</p>', {title: 't', header: 'h', draft: false, generatedAt: NOW, standalone: true});
  assert.ok(standalone.includes(`content="default-src 'none'; style-src 'unsafe-inline'"`) && !standalone.includes('<script'), 'plik HTML w teczce z CSP i bez skryptu (K4-15)');
});
