import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/server/app.ts';
import {inLogFilter, presenceWhat} from '../src/shared/logfilter.ts';
import {apply, envOf, newMeetingFromSettings, type Context} from '../src/shared/meeting.ts';
import {effectiveMeeting, noticeText, othersOf, protocolProposal} from '../src/shared/cascade.ts';
import {applySettingsChange, DEFAULT_NOTICE_TEMPLATE, defaultGeneral, nextProtocolNumber, type GeneralBundle} from '../src/shared/settings.ts';
import {defaultDocTypes} from '../src/shared/doctypes.ts';
import {seedSite} from '../src/server/seed.ts';
import type {Meeting} from '../src/shared/types.ts';
import {actor, context, roster} from './helpers.ts';

// Dodatki wersji 3 (specyfikacja, rozdz. 6.0): każdy dodatek ma tu swoje przypadki; rdzeń na nich nie polega.

type Ctx = ReturnType<typeof context>;
const office = actor(null, 'biuro', true);
const settingsEnv = {actor: office, now: Date.parse('2026-11-20T10:00:00Z'), roster};

function setup(): Ctx & Context {
  const ctx = context() as Ctx & Context;
  ctx.general = {general: defaultGeneral(seedSite), docTypes: defaultDocTypes, revision: 1};
  ctx.accounts = [];
  return ctx;
}
const create = (ctx: Context, extra: Partial<Parameters<typeof newMeetingFromSettings>[0]> = {}) =>
  newMeetingFromSettings({id: 'm1', kind: 'posiedzenie', date: '2026-12-03', time: '10:00', actor: office, ...extra}, ctx);
const setSite = (b: GeneralBundle, key: 'protocolNumberPattern', value: string) => applySettingsChange(b, {area: 'siedziba', key, value}, settingsEnv);

// U-03: wzór numeru protokołu.

test('U-03: kolejny numer protokołu liczy się z numerów z tego samego roku, kadencja i rok ze wzoru', () => {
  const pattern = '[numer]/[kadencja]/[rok]';
  assert.equal(nextProtocolNumber(pattern, 'IX', 2026, []), '1/IX/2026');
  assert.equal(nextProtocolNumber(pattern, 'IX', 2026, ['1/IX/2026', '7/IX/2026', '3/IX/2026']), '8/IX/2026');
  assert.equal(nextProtocolNumber(pattern, 'IX', 2026, ['Protokół z marca', '12']), '1/IX/2026', 'numery niepasujące do wzoru się pomija');
  assert.equal(nextProtocolNumber('P/[rok]/[numer]', 'IX', 2027, ['P/2027/4']), 'P/2027/5');
  assert.equal(nextProtocolNumber('', 'IX', 2026, ['1/IX/2026']), null, 'pusty wzór to brak propozycji');
});

test('U-03: wzór numeru protokołu zapisuje biuro, pusty wzór wyłącza propozycję, wzór bez [numer] jest odrzucany', () => {
  const ctx = setup();
  const b = ctx.general!;
  assert.throws(() => setSite(b, 'protocolNumberPattern', '[kadencja]/[rok]'), /Wzór numeru protokołu musi zawierać \[numer\]\./);
  assert.throws(() => setSite(b, 'protocolNumberPattern', '[numer]/' + 'x'.repeat(40)), /najwyżej 40 znaków/);
  const {bundle, audit} = setSite(b, 'protocolNumberPattern', '[numer]/[kadencja]/[rok]');
  assert.equal(bundle.general.site.protocolNumberPattern, '[numer]/[kadencja]/[rok]');
  assert.equal(bundle.revision, b.revision + 1);
  assert.deepEqual(audit.map(e => [e.area, e.label, e.before, e.after]), [['siedziba', 'Wzór numeru protokołu', 'bez propozycji numeru', '„[numer]/[kadencja]/[rok]”']]);
  const off = setSite(bundle, 'protocolNumberPattern', '');
  assert.equal(off.bundle.general.site.protocolNumberPattern, '');
  assert.equal(off.audit[0].after, 'bez propozycji numeru');
});

test('U-03: posiedzenie dostaje propozycję numeru z numerów innych posiedzeń tego organu z tego roku', () => {
  const ctx = setup();
  ctx.general = setSite(ctx.general!, 'protocolNumberPattern', '[numer]/[kadencja]/[rok]').bundle;
  const m = create(ctx);
  const others = [
    {...m, id: 'a', date: '2026-10-22', protocolNumber: '11/IX/2026'},
    {...m, id: 'b', date: '2026-11-05', protocolNumber: '12/IX/2026'},
    {...m, id: 'c', date: '2025-12-10', protocolNumber: '30/IX/2025'},
    {...m, id: 'd', date: '2026-11-12', kind: 'procedura' as const, protocolNumber: '40/IX/2026'},
  ] as Meeting[];
  const env = {...envOf(ctx, 'prezydium'), ...othersOf(m, [m, ...others])};
  assert.equal(effectiveMeeting(env, m).protocolNumberProposal, '13/IX/2026', 'głosowanie między posiedzeniami i inny rok się nie liczą');
  assert.equal(protocolProposal(env, {...m, date: '2027-01-14'}), '1/IX/2027');
  const without = {...env, general: defaultGeneral(seedSite)};
  assert.equal(effectiveMeeting(without, m).protocolNumberProposal, undefined, 'bez wzoru nie ma propozycji (zachowanie rdzenia)');
});

// U-15: wzór zawiadomienia.

const setNotice = (b: GeneralBundle, value: string) => applySettingsChange(b, {area: 'organ', organ: 'prezydium', key: 'noticeTemplate', value}, settingsEnv);

test('U-15: wzór zawiadomienia musi mieć termin, miejsce i porządek obrad (G-4), a inne znaczniki są odrzucane', () => {
  const ctx = setup();
  const b = ctx.general!;
  assert.throws(() => setNotice(b, 'Zawiadamiam o posiedzeniu [termin] w miejscu [miejsce].'), /^Error: Wzór zawiadomienia musi zawierać termin, miejsce i porządek obrad \(§ 7 ust\. 1\)\.$/);
  assert.throws(() => setNotice(b, '[termin] [miejsce] [porządek obrad] [podpis]'), /Nieznany znacznik \[podpis\]\./);
  assert.throws(() => setNotice(b, '[termin] [miejsce] [porządek obrad] ' + 'x'.repeat(4000)), /najwyżej 4000 znaków/);
  const own = 'Zawiadamiam o posiedzeniu [organ w dopełniaczu].\r\nTermin [termin], miejsce [miejsce]   \n\n[porządek obrad]\nOdnośnik [odnośnik]';
  const {bundle, audit} = setNotice(b, own);
  assert.equal(bundle.general.organs.prezydium!.noticeTemplate, 'Zawiadamiam o posiedzeniu [organ w dopełniaczu].\nTermin [termin], miejsce [miejsce]\n\n[porządek obrad]\nOdnośnik [odnośnik]', 'końce wierszy i spacje uporządkowane, puste wiersze zostają');
  assert.equal(audit[0].label, 'Wzór zawiadomienia');
  assert.equal(audit[0].before, 'tekst domyślny');
  const back = setNotice(bundle, '');
  assert.equal(back.bundle.general.organs.prezydium!.noticeTemplate, undefined, 'pusty tekst przywraca wzór domyślny');
  assert.equal(back.audit[0].after, 'tekst domyślny');
});

test('U-15: treść zawiadomienia wstawia organ, termin, miejsce i porządek obrad bez odmiany', () => {
  const ctx = setup();
  const m = create(ctx);
  const env = envOf(ctx, 'prezydium');
  const text = noticeText(env, m);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Uprzejmie zawiadamiam o posiedzeniu Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku, które odbędzie się 3 grudnia 2026 r., godz. 10:00.');
  assert.equal(lines[1], `Miejsce posiedzenia ${seedSite.place}.`);
  assert.equal(lines[3], 'Projekt porządku obrad');
  assert.equal(lines[4], `1. ${m.agenda[0].title.replace(/[.\s]+$/, '')}`);
  assert.equal(lines.filter(l => /^\d+\. /.test(l)).length, m.agenda.length);
  assert.equal(lines.at(-1), 'Materiały są dostępne w aplikacji.');
  assert.equal(DEFAULT_NOTICE_TEMPLATE.split('\n').length, lines.length - m.agenda.length + 1);
  const remote = noticeText({...env, general: setNotice(ctx.general!, '[termin]\n[miejsce]\n[odnośnik]\n[porządek obrad]').bundle.general}, {...m, mode: 'zdalne', link: 'https://spotkanie.example/abc'});
  assert.deepEqual(remote.split('\n').slice(0, 3), ['3 grudnia 2026 r., godz. 10:00', 'posiedzenie zdalne, https://spotkanie.example/abc', 'https://spotkanie.example/abc']);
});

// U-12: kanał wiadomości od początku posiedzenia.

const setOrgan = (b: GeneralBundle, key: 'messagesFromStart', value: boolean) => applySettingsChange(b, {area: 'organ', organ: 'prezydium', key, value}, settingsEnv);

test('U-12: kanał wiadomości na posiedzeniu stacjonarnym według kaskady: ustawienia ogólne, wzór, posiedzenie', () => {
  const ctx = setup();
  let m = create(ctx);
  const env = () => envOf(ctx, 'prezydium');
  assert.equal(effectiveMeeting(env(), m).meeting.messages.value, 'gdy_sa_wiadomosci', 'bez ustawienia jak w rdzeniu');
  const organ = setOrgan(ctx.general!, 'messagesFromStart', true);
  assert.deepEqual(organ.audit.map(e => [e.label, e.before, e.after]), [['Kanał wiadomości na posiedzeniu stacjonarnym', 'widoczny, gdy ktoś napisze', 'widoczny od początku posiedzenia']]);
  ctx.general = organ.bundle;
  let e = effectiveMeeting(env(), m).meeting.messages;
  assert.equal(e.value, 'od_poczatku');
  assert.equal(e.source, 'ogolne');
  const template = {...ctx.general.general.organs.prezydium!.templates[0], settings: {messagesFromStart: false}};
  ctx.general = applySettingsChange(ctx.general, {area: 'wzory', organ: 'prezydium', template}, settingsEnv).bundle;
  e = effectiveMeeting(env(), m).meeting.messages;
  assert.equal(e.value, 'gdy_sa_wiadomosci');
  assert.equal(e.source, 'szablon');
  m = apply(m, {type: 'settings_set', key: 'messagesFromStart', value: true}, office, ctx.tick());
  const eff = effectiveMeeting(env(), m);
  assert.equal(eff.meeting.messages.value, 'od_poczatku');
  assert.equal(eff.meeting.messages.source, 'posiedzenie');
  assert.equal(eff.meeting.messages.inherited, 'gdy_sa_wiadomosci');
  assert.ok(eff.differences.some(d => d.text === 'Kanał wiadomości widoczny od początku posiedzenia, we wzorze posiedzenia widoczny, gdy ktoś napisze.'));
  assert.ok(m.log.some(l => l.tag === 'ustawienia' && l.text === 'Zmieniono kanał wiadomości z „widoczny, gdy ktoś napisze” na „widoczny od początku posiedzenia”.'));
  assert.equal(effectiveMeeting(env(), {...m, mode: 'zdalne'}).meeting.messages.value, 'zawsze', 'przy zdalnym zasada aplikacji');
  assert.throws(() => apply(m, {type: 'settings_set', key: 'messagesFromStart', value: 3}, office, ctx.tick()), /Wybierz, kiedy kanał wiadomości jest widoczny\./);
  m = apply(m, {type: 'settings_reset', key: 'messagesFromStart'}, office, ctx.tick());
  assert.equal(m.log.at(-1)!.text, 'Przywrócono kanał wiadomości z wzoru posiedzenia („widoczny, gdy ktoś napisze”).');
});

test('U-12: przy otwarciu kanał zapisuje się w posiedzeniu, a późniejsza zmiana ustawień ogólnych go nie zmienia', () => {
  const ctx = setup();
  ctx.general = setOrgan(ctx.general!, 'messagesFromStart', true).bundle;
  let m = create(ctx);
  m = apply(m, {type: 'open'}, actor('si'), ctx.tick());
  assert.equal(m.frozen!.meeting.messagesFromStart.value, true);
  ctx.general = setOrgan(ctx.general, 'messagesFromStart', false).bundle;
  const e = effectiveMeeting(envOf(ctx, 'prezydium'), m).meeting.messages;
  assert.equal(e.value, 'od_poczatku');
  assert.equal(e.frozen, true);
  assert.throws(() => apply(m, {type: 'settings_set', key: 'messagesFromStart', value: false}, office, ctx.tick()), /Ustawienia posiedzenia zapisano przy otwarciu\./);
  const legacy = {...m, frozen: {...m.frozen!, legacy: true as const, meeting: {voteMinutes: m.frozen!.meeting.voteMinutes, motionMinutes: m.frozen!.meeting.motionMinutes}}} as Meeting;
  assert.equal(effectiveMeeting(envOf(ctx, 'prezydium'), legacy).meeting.messages.value, 'gdy_sa_wiadomosci', 'zamrożenie bez klucza (dane sprzed dodatku) jak dziś');
});

// Filtry historii zmian i przebiegu obrad.

test('filtry przebiegu obrad: głosowania, porządek, obecność i odstępstwa z prawdziwego przebiegu', () => {
  const ctx = setup();
  const chair = actor('si');
  let m = create(ctx);
  m = apply(m, {type: 'open'}, chair, ctx.tick());
  for (const p of ['ag', 'jw', 'kn']) m = apply(m, {type: 'presence', who: p, present: true}, actor(p), ctx.tick());
  m = apply(m, {type: 'presence_confirm_all'}, chair, ctx.tick());
  m = apply(m, {type: 'quorum'}, chair, ctx.tick());
  const order = m.agenda.find(i => i.kind === 'porzadek')!;
  m = apply(m, {type: 'item_start', itemId: order.id}, chair, ctx.tick());
  m = apply(m, {type: 'ballot_open', itemId: order.id, purpose: 'porzadek', subject: 'Przyjęcie porządku obrad', mode: 'jawne', minutes: 2}, chair, ctx.tick());
  const of = (f: Parameters<typeof inLogFilter>[1]) => m.log.filter(l => inLogFilter(l, f)).map(l => l.text);
  assert.ok(of('glosowania').some(t => t.startsWith('Otwarto głosowanie jawne nr 1')));
  assert.ok(of('porzadek').some(t => t.startsWith('Rozpoczęto punkt 2')));
  assert.ok(of('obecnosc').some(t => t.startsWith('Stwierdzono kworum')));
  assert.ok(!of('obecnosc').some(t => t.startsWith('Otwarto głosowanie')));
  assert.equal(of('wszystko').length, m.log.length);
  assert.deepEqual(of('odstepstwa'), [], 'bez odstępstw i bez powodów nic');
  assert.ok(inLogFilter({text: 'W punkcie 4 sprawy nie poddano pod głosowanie. Powód „brak projektu”.', tag: 'odstepstwo'}, 'odstepstwa'));
  assert.ok(inLogFilter({text: 'Punkt 5 odroczony. Powód „nieobecność referującej”.'}, 'odstepstwa'));
  const opened = m.presenceLog.find(e => e.via === 'otwarcie')!;
  assert.equal(presenceWhat(opened), 'przybycie przy otwarciu posiedzenia');
  assert.equal(presenceWhat({type: 'zgloszenie'}), 'zgłoszenie obecności');
  assert.equal(presenceWhat({type: 'przybycie', reportedAt: 1}), 'potwierdzenie zgłoszonej obecności');
  assert.equal(presenceWhat({type: 'wyjscie', via: 'przejmujacy'}), 'wyjście, zapisane przez osobę, która przejęła prowadzenie');
});

test('filtry historii zmian przez API (sekcja i konto); propozycja numeru i kanał wiadomości w widoku posiedzenia', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'posiedzenia-dodatki-'));
  const app = await createApplication({dataDir: dir, setupToken: 'kod-testowy', clientDir: dir, tickMs: 50});
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(app.server.address() as {port: number}).port}`;
  const client = () => {
    let cookie = '';
    return async (path: string, data?: unknown) => {
      const headers: Record<string, string> = {Origin: origin, 'X-Posiedzenia': '1', ...(data !== undefined ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {Cookie: cookie} : {})};
      const res = await fetch(origin + path, {method: data === undefined ? 'GET' : 'POST', headers, body: data === undefined ? undefined : JSON.stringify(data)});
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const body = await res.json();
      if (res.status >= 300) throw Object.assign(new Error(body.error), {status: res.status});
      return body;
    };
  };
  try {
    const office = client();
    await office('/api/setup', {token: 'kod-testowy', username: 'biuro', password: 'BardzoTajne-2026', displayName: 'Biuro Izby'});
    await office('/api/accounts', {username: 'biuro2', kind: 'biuro', personId: null, displayName: 'Biuro, druga osoba', password: 'Tymczasowe-2026'});
    const second = client();
    await second('/api/login', {username: 'biuro2', password: 'Tymczasowe-2026'});
    await second('/api/password', {currentPassword: 'Tymczasowe-2026', password: 'Wlasne-haslo-biuro2-2026'});
    const me = (await office('/api/session')).account.id as string;
    const other = (await second('/api/session')).account.id as string;
    await office('/api/settings', {change: {area: 'siedziba', key: 'protocolNumberPattern', value: '[numer]/[kadencja]/[rok]'}});
    await second('/api/settings', {change: {area: 'organ', organ: 'prezydium', key: 'messagesFromStart', value: true}});
    await second('/api/settings', {change: {area: 'organ', organ: 'prezydium', key: 'noticeTemplate', value: '[termin]\n[miejsce]\n[porządek obrad]'}});
    const byOther = (await office(`/api/settings/history?accountId=${other}`)).entries as {accountId: string; key: string}[];
    assert.deepEqual(byOther.map(e => e.key).sort(), ['messagesFromStart', 'noticeTemplate']);
    assert.ok(byOther.every(e => e.accountId === other));
    const site = (await office(`/api/settings/history?area=siedziba&accountId=${me}`)).entries as {key: string}[];
    assert.deepEqual(site.map(e => e.key), ['protocolNumberPattern']);
    assert.deepEqual((await office(`/api/settings/history?area=siedziba&accountId=${other}`)).entries, []);
    // U-03 w widoku posiedzenia: propozycja numeru przychodzi z widokiem, bez dodatkowego zapytania.
    const created = (await office('/api/meetings', {kind: 'posiedzenie', date: '2026-12-03', time: '10:00'})).meeting;
    assert.equal(created.effective.protocolNumberProposal, '1/IX/2026');
    assert.equal(created.effective.meeting.messages.value, 'od_poczatku', 'U-12 z ustawień ogólnych');
    await office(`/api/meetings/${created.id}/command`, {type: 'details', protocolNumber: '1/IX/2026'});
    const next = (await office('/api/meetings', {kind: 'posiedzenie', date: '2026-12-17', time: '10:00'})).meeting;
    assert.equal(next.effective.protocolNumberProposal, '2/IX/2026');
  } finally {
    await new Promise<void>(r => app.server.close(() => r()));
    rmSync(dir, {recursive: true, force: true});
  }
});
