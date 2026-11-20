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

/**
 * Jedyna oczekiwana różnica wobec wzorców wersji 3 (DB-4, T-7, rozdz. 12.2 K4-8; poprawka D1K-02 z kontroli etapu D.1):
 * w posiedzeniu niezamkniętym projekt protokołu nie podaje wyniku nieogłoszonego głosowania także osobie prowadzącej,
 * więc jej tekst jest znak w znak tekstem biura z tego samego posiedzenia. W danych wzorcowych dotyczy to tylko
 * posiedzenia 131cd279 w `dane-wzor` u przewodniczącego i osoby prowadzącej: tabela wyniku głosowania nr 2 zamienia się na
 * zdanie „Głosowanie zakończone. Wynik ogłosi osoba prowadząca obrady.”
 */
const EXPECTED_DIFF: Record<string, string[]> = {
  'dane-wzor': ['131cd279-a48f-41b5-b039-2d1a44a99ae9 przewodniczacy', '131cd279-a48f-41b5-b039-2d1a44a99ae9 zamykajacy'],
  'dane-wzor-3': [],
};
/** Wpis wzorca, z którym porównuje się tekst wersji 4: w posiedzeniu niezamkniętym wpis biura (opis wyżej). */
function expectedEntry(index: {entries: WzorzecWpis[]}, e: WzorzecWpis) {
  if (e.status === 'zakonczone' || e.role === 'biuro') return e;
  return index.entries.find(x => x.meeting === e.meeting && x.role === 'biuro' && x.body) ?? e;
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
      const read = (name: string) => readFileSync(new URL(`${zestaw}/${name}`, fixtures), 'utf8');
      const differing = index.entries.filter(e => e.body && expectedEntry(index, e) !== e && read(e.body) !== read(expectedEntry(index, e).body!)).map(e => `${e.meeting} ${e.role}`);
      assert.deepEqual(differing, EXPECTED_DIFF[zestaw], `${zestaw}: wzorce, które zmienia ukrycie nieogłoszonego wyniku w posiedzeniu niezamkniętym`);
      for (const name of differing) {
        const e = index.entries.find(x => `${x.meeting} ${x.role}` === name)!;
        assert.ok(read(e.body!).includes('aria-label="Wynik głosowania nr\u00a02"') && read(expectedEntry(index, e).body!).includes('Głosowanie zakończone. Wynik ogłosi osoba prowadząca obrady.'), `${name}: różnica to tabela wyniku głosowania nr 2`);
      }
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
        const x = expectedEntry(index, e);
        const body = minutesBody(m, store.roster(), accounts, WZORCE_NOW, look.names, options);
        assert.equal(body, read(x.body!), `${where}: minutesBody`);
        const druk = htmlText(articleHtml(minutesHtml(m, store.roster(), accounts, WZORCE_NOW, {...look, options})));
        assert.equal(druk, read(x.druk!).trim(), `${where}: wydruk`);
        const word = await wordText(minutesDocx(m, store.roster(), accounts, WZORCE_NOW, {...look, options}));
        assert.equal(word, read(x.word!).trim(), `${where}: Word`);
        compared++;
      }
      assert.ok(compared >= (zestaw === 'dane-wzor' ? 3 : 16), `porównano ${compared} wpisów`);
      if (zestaw === 'dane-wzor-3') for (const role of ROLES) assert.ok(index.entries.some(e => e.role === role && e.body), `${zestaw}: rola ${role} ma co najmniej jeden wzorzec z tekstem`);
    } finally { done(); }
  });
}
