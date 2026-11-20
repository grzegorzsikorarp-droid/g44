import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store, accountView} from '../src/server/store.ts';
import {minutesBody, minutesDocx, minutesHtml, type MinutesLook} from '../src/server/minutes.ts';
import {docxText} from './docx-text.ts';
import {canReadMinutes, minutesRefusal} from '../src/shared/role.ts';
import {seesUnannounced} from '../src/shared/view.ts';
import {ROLES, WZORCE_NOW, ZESTAWY, articleHtml, htmlText, minutesActors, type WzorzecWpis} from './wzorce.ts';

// Stare protokoły bez zmian (SPEC-4 DB-4, K4-8, etap D.1 pkt 1 i 8): wzorce w tests/fixtures/protokoly-v3/ zapisał
// skrypt /home/user/przeglad/v4-D/skrypty/wzorce-v3.ts na kodzie wersji 3 (commit 2a6b75a) przed zmianą minutes.ts.
// Ten test odtwarza start serwera na kopiach tych samych danych i porównuje dla biura, przewodniczącego, osoby, która
// zamknęła obrady, i członka: tekst minutesBody znak po znaku, a tekst treści wydruku i pliku Word po ujednoliceniu
// białych znaków (opakowanie strony i pliku może się zmieniać: znak „Projekt”, nagłówek, stopka, format .docx).

const look: MinutesLook = {css: null, logo: '/brand/logo/znak-oipip-slupsk.svg', nameplate: ['Okręgowa Izba Pielęgniarek i Położnych', 'w Słupsku'], org: 'Okręgowa Izba Pielęgniarek i Położnych w Słupsku', names: {office: 'biuro Izby'}};
const fixtures = new URL('./fixtures/protokoly-v3/', import.meta.url);

/** Start serwera na kopii danych: te same kroki co createApplication przed obsługą zapytań. */
function started(zestaw: string) {
  const dir = mkdtempSync(join(tmpdir(), 'protokol-v4-'));
  copyFileSync(new URL(`./fixtures/${zestaw}/posiedzenia.sqlite`, import.meta.url), join(dir, 'posiedzenia.sqlite'));
  const store = new Store(dir);
  if (store.purgeAbortedVotes()) store.scrubSecretTraces();
  store.migrateV3(WZORCE_NOW);
  const migrate = (store as unknown as {migrateV4?: (now: number) => unknown}).migrateV4;
  if (migrate) migrate.call(store, WZORCE_NOW);
  return {store, done: () => { store.close(); rmSync(dir, {recursive: true, force: true}); }};
}

/** Tekst treści pliku Word wersji 4 (.docx, bez nagłówka i stopki), liczony jak tekst HTML wzorca (tests/docx-text.ts). */
const wordText = async (file: Promise<Uint8Array>) => docxText(await file);

for (const zestaw of ZESTAWY) {
  test(`stare protokoły (${zestaw}): minutesBody, wydruk i Word identyczne ze wzorcami wersji 3 dla czterech ról`, async () => {
    const index = JSON.parse(readFileSync(new URL(`${zestaw}/wzorce.json`, fixtures), 'utf8')) as {entries: WzorzecWpis[]};
    const {store, done} = started(zestaw);
    try {
      const accounts = store.users().map(accountView);
      const ids = new Set(store.meetingIds());
      assert.deepEqual([...new Set(index.entries.map(e => e.meeting))].sort(), [...ids].sort(), 'wzorce obejmują każde posiedzenie zestawu');
      let compared = 0;
      for (const e of index.entries) {
        const m = store.meeting(e.meeting)!;
        assert.ok(!m.frozen?.v4, 'posiedzenie z danych wzorcowych nie dostaje znacznika v4');
        const a = minutesActors(store, m)[e.role];
        const where = `${zestaw} ${e.meeting} ${e.role}`;
        assert.deepEqual(a ? {username: a.account.username, personId: a.personId} : null, e.actor, `${where}: ta sama osoba w roli`);
        if (e.refusal) {
          assert.ok(!a || !canReadMinutes(store.roster(), m, a), `${where}: nadal bez wglądu`);
          if (a) assert.equal(e.refusal, minutesRefusal);
          continue;
        }
        assert.ok(a && canReadMinutes(store.roster(), m, a), `${where}: wgląd jak w wersji 3`);
        const options = {docTypes: store.docTypes(), hideUnannounced: !seesUnannounced(m, a!, store.roster())};
        const body = minutesBody(m, store.roster(), accounts, WZORCE_NOW, look.names, options);
        assert.equal(body, readFileSync(new URL(`${zestaw}/${e.body}`, fixtures), 'utf8'), `${where}: minutesBody`);
        const druk = htmlText(articleHtml(minutesHtml(m, store.roster(), accounts, WZORCE_NOW, {...look, options})));
        assert.equal(druk, readFileSync(new URL(`${zestaw}/${e.druk}`, fixtures), 'utf8').trim(), `${where}: wydruk`);
        const word = await wordText(minutesDocx(m, store.roster(), accounts, WZORCE_NOW, {...look, options}));
        assert.equal(word, readFileSync(new URL(`${zestaw}/${e.word}`, fixtures), 'utf8').trim(), `${where}: Word`);
        compared++;
      }
      assert.ok(compared >= (zestaw === 'dane-wzor' ? 3 : 16), `porównano ${compared} wpisów`);
      if (zestaw === 'dane-wzor-3') for (const role of ROLES) assert.ok(index.entries.some(e => e.role === role && e.body), `${zestaw}: rola ${role} ma co najmniej jeden wzorzec z tekstem`);
    } finally { done(); }
  });
}
