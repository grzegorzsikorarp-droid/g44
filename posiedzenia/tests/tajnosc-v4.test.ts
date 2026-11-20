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
