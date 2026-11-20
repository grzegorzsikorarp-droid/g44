import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {apply} from '../src/shared/meeting.ts';
import {meetingPapers, paperCsv, paperHtml} from '../src/shared/papers.ts';
import {commsMarkdown} from '../src/shared/comms.ts';
import {memberStats, statsCsv} from '../src/shared/stats.ts';
import {minutesBody, minutesDocx} from '../src/server/minutes.ts';
import {docxText} from './docx-text.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, presidium, roster} from './helpers.ts';
import {copyFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store, accountView} from '../src/server/store.ts';
import {cascadeEnv} from '../src/shared/cascade.ts';
import {canDownloadPaper} from '../src/shared/role.ts';
import {seesUnannounced, viewFor} from '../src/shared/view.ts';
import {WZORCE_NOW, actorOf} from './wzorce.ts';
import {chair, closedMeeting, envWith, last, NOW, openedMeeting} from './scenariusz-v4.ts';

// Tajność w wersji 4 (SPEC-4 0.3; etap D.1: T-1, T-6, T-7). T-5 i T-8 sprawdza etap D.2 (trasy, ETag, poczta).

const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/[ ⁠]/g, ' ').replace(/\s+/g, ' ');

test('T-1: pliki tajności bez zmian wobec wersji 3', () => {
  let diff: string;
  try { diff = execFileSync('git', ['diff', '--stat', '2a6b75a', '--', 'src/shared/blind.ts', 'src/shared/sha256.ts', 'src/server/secret.ts', 'src/client/secret.ts', 'tests/blind.test.ts'], {cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'ignore']}).toString(); }
  catch { return; }   // poza repozytorium git sprawdza to kontrola k pkt 1
  assert.equal(diff, '');
});

test('T-6: statystyki z dwóch stanów różniących się tylko wyborami w głosowaniu tajnym są identyczne bajt w bajt dla każdego widza', () => {
  const {m} = closedMeeting({v4: true});
  const variant: Meeting = structuredClone(m);
  const secret = variant.ballots.find(b => b.mode === 'tajne')!;
  secret.result = {...secret.result!, za: 0, przeciw: 7, adopted: false};
  secret.secret = {...secret.secret!, issued: [...secret.secret!.issued].sort(), cast: 5};
  for (const self of [null, ...presidium]) {
    const range = {from: '2026-01-01', to: '2026-12-31'};
    const a = memberStats({meetings: [m], roster, range, self, only: self ? [self] : undefined});
    const b = memberStats({meetings: [variant], roster, range, self, only: self ? [self] : undefined});
    assert.equal(JSON.stringify(b), JSON.stringify(a));
    assert.equal(statsCsv(b, self ? 'moje' : 'sklad', NOW), statsCsv(a, self ? 'moje' : 'sklad', NOW));
  }
});

test('T-7: żaden format i żadna rola nie dostaje liczb nieogłoszonego głosowania; głosowanie otwarte tylko zdaniem', async () => {
  let {ctx, m} = openedMeeting({v4: true});
  const it = m.agenda.find(i => i.title.startsWith('Uchwała nr 108'))!;
  m = apply(m, {type: 'item_start', itemId: it.id, reason: 'Kolejność w teście.'}, chair, ctx.tick());
  m = apply(m, {type: 'mode_motion', itemId: it.id, mode: 'imienne', minutes: 2, proposedBy: 'kn'}, chair, ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: last(m).id, choice: 'za'}, actor(p), ctx.tick());
  m = apply(m, {type: 'announce', ballotId: last(m).id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: it.title, mode: 'imienne', minutes: 2}, chair, ctx.tick());
  // Sześć osób głosuje „przeciw”, przewodniczący jeszcze nie: głosowanie trwa.
  for (const p of presidium.filter(p => p !== 'si')) m = apply(m, {type: 'vote', ballotId: last(m).id, choice: 'przeciw'}, actor(p), ctx.tick());
  assert.equal(last(m).status, 'otwarte');
  const n = last(m).number;
  const env = envWith();
  const forms = async (mm: Meeting) => {
    const out: string[] = [];
    for (const p of meetingPapers(mm, env, chair, NOW)) {
      if (p.formats.includes('html') && p.id !== 'protokol') out.push(plain(paperHtml(p.id, mm, {env, at: NOW})));
      if (p.formats.includes('csv')) out.push(paperCsv(p.id, mm, {env, at: NOW}));
    }
    out.push(plain(minutesBody(mm, roster, [], NOW, {}, {hideUnannounced: false})));
    out.push(docxText(await minutesDocx(mm, roster, [], NOW, {options: {hideUnannounced: false}})));
    return out;
  };
  const forbidden = [/przeciw 6/i, /;0;6;0;/, /Głosowało 6/, new RegExp(`${it.title.replace(/[/.]/g, '\\$&')} \\(imienne`), /Przeciw;6/];
  const open = await forms(m);
  for (const text of open) for (const re of forbidden) assert.ok(!re.test(text), `${re} w pliku głosowania otwartego`);
  assert.ok(open.filter(t => t.includes(`Głosowanie nr ${n} trwa.`)).length >= 3, 'wyniki (HTML i CSV) i projekt protokołu podają tylko zdanie');
  // Głosowanie zamknięte bez ogłoszenia: osoba prowadząca też nie dostaje liczb ani wykazu imiennego w pliku (B1-03).
  m = apply(m, {type: 'vote', ballotId: last(m).id, choice: 'przeciw'}, chair, ctx.tick());
  assert.equal(last(m).status, 'zamkniete');
  assert.ok(!last(m).announcedAt);
  const closed = await forms(m);
  for (const text of closed) {
    assert.ok(!text.includes('Uchwała nie została podjęta'), 'bez rozstrzygnięcia');
    assert.ok(!/przeciw 7|;0;7;0;|Przeciw;7/i.test(text), 'bez liczb');
    const block = text.indexOf(`Głosowanie nr ${n}`);
    if (block >= 0 && !text.startsWith('\ufeff')) assert.ok(text.slice(block, block + 400).includes('Wynik ogłosi osoba prowadząca obrady.'), 'zamiast wyniku zdanie z wersji 3');
  }
  assert.ok(!meetingPapers(m, env, chair, NOW).some(p => p.id === `wykaz-${n}`), 'wykaz imienny dopiero po ogłoszeniu');
  // Materiał dla komunikacji: z tajnego tylko wynik (bez kart, odcisku, godzin).
  const {m: done, env: cenv} = closedMeeting({v4: true});
  const md = commsMarkdown(done, cenv, {at: NOW});
  assert.ok(!/TEST-TEST|kart\b|Pobrano|odcisk/i.test(md));
});

// Poprawki D1K-01 i D1K-03 z kontroli etapu D.1: wpis dziennika z danych sprzed wersji 3 nie ma `ballotId`, a ma liczby
// nieogłoszonego głosowania. Dziennik (HTML, CSV) i widok posiedzenia rozpoznają taki wpis po numerze głosowania.
test('T-7: wpis dziennika bez ballotId nie podaje liczb nieogłoszonego głosowania (dziennik i widok)', () => {
  let {ctx, m} = openedMeeting({v4: true});
  const it = m.agenda.find(i => i.title.startsWith('Uchwała nr 108'))!;
  m = apply(m, {type: 'item_start', itemId: it.id, reason: 'Kolejność w teście.'}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: it.id, purpose: 'uchwala', subject: it.title, mode: 'jawne', minutes: 2}, chair, ctx.tick());
  for (const p of presidium) m = apply(m, {type: 'vote', ballotId: last(m).id, choice: 'przeciw'}, actor(p), ctx.tick());
  const b = last(m);
  assert.equal(b.status, 'zamkniete');
  assert.ok(!b.announcedAt);
  // Dane jak sprzed wersji 3: wpis o zakończeniu bez `ballotId`.
  m = {...m, log: m.log.map(l => l.ballotId === b.id ? {...l, ballotId: undefined} : l)};
  const entry = m.log.find(l => l.text.startsWith(`Zakończono głosowanie nr ${b.number} `))!;
  assert.ok(entry && !entry.ballotId && /przeciw 7/.test(entry.text), 'scenariusz ma wpis z liczbami bez ballotId');
  const env = envWith();
  const html = plain(paperHtml('dziennik', m, {env, at: NOW}));
  const csvText = paperCsv('dziennik', m, {env, at: NOW});
  for (const text of [html, csvText]) {
    assert.ok(text.includes(`Zakończono głosowanie nr ${b.number}`), 'wpis zostaje');
    assert.ok(!/przeciw 7/.test(text), 'bez liczb nieogłoszonego głosowania');
  }
  for (const who of [chair, actor('eo'), actor(null, 'biuro', true)]) {
    const v = viewFor(m, who, roster, env);
    const text = v.log.map(l => l.text).join('\n');
    if (who === chair) assert.ok(/przeciw 7/.test(text), 'osoba prowadząca widzi liczby w widoku (F2, Z5)');
    else assert.ok(!/przeciw 7/.test(text), `${who.account.username}: bez liczb w przebiegu obrad`);
  }
  // Po ogłoszeniu liczby wracają do dziennika.
  const announced = apply(m, {type: 'announce', ballotId: b.id}, chair, ctx.tick());
  assert.ok(/przeciw 7/.test(paperCsv('dziennik', announced, {env, at: NOW})));
});

test('T-7: dane-wzor 131cd279 (głosowanie nr 2 bez ogłoszenia, wpis bez ballotId): dziennik, widok i projekt protokołu bez liczb', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tajnosc-v4-'));
  copyFileSync(new URL('./fixtures/dane-wzor/posiedzenia.sqlite', import.meta.url), join(dir, 'posiedzenia.sqlite'));
  const store = new Store(dir);
  try {
    if (store.purgeAbortedVotes()) store.scrubSecretTraces();
    store.migrateV3(WZORCE_NOW);
    const m = store.meeting('131cd279-a48f-41b5-b039-2d1a44a99ae9')!;
    assert.ok(m.status !== 'zakonczone' && m.ballots.some(b => b.number === 2 && b.status === 'zamkniete' && !b.announcedAt));
    const accounts = store.users().map(accountView);
    const env = cascadeEnv({roster: store.roster(), bundle: store.general(), organ: m.organ, accounts});
    const tally = 'Za 7, przeciw 0, wstrzymało się 0.';
    assert.ok(m.log.some(l => !l.ballotId && l.text.includes(tally)), 'dane mają wpis z liczbami bez ballotId');
    let checked = 0;
    for (const row of store.users()) {
      const a = actorOf(store, row.username);
      if (canDownloadPaper(store.roster(), m, a, 'dziennik')) {
        assert.ok(!paperHtml('dziennik', m, {env, at: NOW}).includes('przeciw 0, wstrzymało się 0'), `${row.username}: dziennik HTML`);
        assert.ok(!paperCsv('dziennik', m, {env, at: NOW}).includes(tally), `${row.username}: dziennik CSV`);
        checked++;
      }
      if (!seesUnannounced(m, a, store.roster())) assert.ok(!viewFor(m, a, store.roster(), env).log.some(l => l.text.includes(tally)), `${row.username}: widok`);
      const body = plain(minutesBody(m, store.roster(), accounts, NOW, {}, {hideUnannounced: !seesUnannounced(m, a, store.roster())}));
      assert.ok(!body.includes('Wniosek o głosowanie tajne przyjęty'), `${row.username}: projekt protokołu posiedzenia niezamkniętego`);
    }
    assert.ok(checked >= 8, `sprawdzono dziennik ${checked} kont`);
  } finally { store.close(); rmSync(dir, {recursive: true, force: true}); }
});
