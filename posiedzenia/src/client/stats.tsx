import {useEffect, useState} from 'preact/hooks';
import {request, download} from './api.ts';
import {go, routeHref} from './route.ts';
import {useSession} from './session.ts';
import {Button, ErrorNotice, Field, Fold, Notice, usePageTitle} from './ui.tsx';
import {dateDots, isoDayOf, plural} from '../shared/text.ts';
import {APP_RULES} from '../shared/law.ts';
import type {AttendanceRow, BallotRow, MeetingRow, StatsResult} from '../shared/stats.ts';
import type {CatalogRow} from '../shared/catalog.ts';
import './style/statystyki.css';

// „Moje statystyki” (SPEC-4 6.3, B4 5.1 i słownik B4 5.5, trasa #konto/statystyki?od=&do=|rok=|kadencja=). API zamrożone:
// `MyStatsPage({query})`. Liczby i linię źródła daje serwer z jednej funkcji `memberStats` (`src/shared/stats.ts`); ekran
// tylko je pokazuje: werdykt słowami, kafelki, tabele z paskiem tekstowym (`aria-hidden`, liczba w tekście), własne głosy
// jawne, posiedzenia po kolei, wydruk i CSV. Moduł ładuje się tylko na tej stronie (T-6): widok posiedzenia, panel i ekran
// sali go nie importują. Bez wykresów, rankingów i kolorowania (B4). Dodatek D-13: `RosterStatsPage` („Statystyki składu”).

type Data = {stats: StatsResult; source: string[]};
/** Nazwa kadencji do napisu „Kadencja {nazwa}”: numer z nazwy „IX kadencja 2024–2028”, inaczej cała nazwa. */
const termLabel = (name: string) => name.match(/^([IVXLCDM]+)\s+kadencja/i)?.[1] ?? name;
const pct = (n: number, of: number) => of ? Math.round(n * 100 / of) : 0;
const share = (n: number, of: number) => `${n} z ${of}`;

/** Pasek tekstowy z liczbą (B4 5): tor i wypełnienie z tokenów, bez zaokrągleń; pasek ma aria-hidden, bo liczba stoi w tekście. */
function Bar(props: {value: number; of: number; text?: string}) {
  const p = pct(props.value, props.of);
  return <span class="stat-bar"><span class="stat-bar__track" aria-hidden="true"><i style={{width: `${p}%`}}/></span><span class="stat-bar__num">{props.text ?? `${p}%`}</span></span>;
}
const reasonWords = (a: AttendanceRow) => [
  a.reasons.includes('spoznienie') ? `spóźnienie ${a.lateMin} min` : '', a.reasons.includes('wyjscie') ? `wyjście ${a.earlyMin} min przed końcem` : '',
  a.reasons.includes('przerwa') ? `przerwa w obecności ${a.gapMin} min` : '', a.reasons.includes('glosowanie') ? 'nieobecność przy głosowaniu' : '',
  a.unconfirmed ? 'zgłoszenie bez potwierdzenia' : '',
].filter(Boolean).join(', ');
const attendanceWord = {cala: 'Obecność przez całe obrady', czesciowa: 'Obecność częściowa', nieobecnosc: 'Nieobecność'} as const;
const modeWord = {jawne: 'jawne', imienne: 'imienne', tajne: 'tajne'} as const;
const choiceWord = {za: 'za', przeciw: 'przeciw', wstrzymuje: 'wstrzymanie się'} as const;
function ballotWords(b: BallotRow) {
  const what = !b.eligible ? 'bez prawa głosu' : b.mode === 'tajne' ? (b.cast ? 'karta pobrana' : 'karta niepobrana')
    : b.cast ? (b.choice ? `głos „${choiceWord[b.choice]}”` : 'głos oddany') : b.left ? 'wyjście w trakcie głosowania' : 'bez głosu';
  return `nr ${b.number} (${modeWord[b.mode]}) ${what}`;
}
/** Wiersz „Posiedzenia po kolei” (B4 5.1): dzień, rodzaj, obecność z powodem i głosowania słowami. */
function rowText(r: MeetingRow) {
  const kind = r.kind === 'procedura' ? 'Głosowanie między posiedzeniami' : r.working ? 'Spotkanie robocze' : 'Posiedzenie';
  const att = r.attendance ? `${attendanceWord[r.attendance.kind]}${r.attendance.remote ? ', zdalnie' : ''}${reasonWords(r.attendance) ? ` (${reasonWords(r.attendance)})` : ''}. ` : '';
  const ballots = r.ballots.length ? `${r.ballots.length === 1 ? 'Głosowanie' : 'Głosowania'} ${r.ballots.map(ballotWords).join(', ')}.` : 'Bez głosowań.';
  return `${kind}${r.legacy ? ', sprzed wersji 3' : ''}. ${att}${ballots}`;
}

/** Strona „Moje statystyki”; `query` to parametry trasy (`od`, `do`, `kadencja`, `rok`). */
export function MyStatsPage(props: {query: URLSearchParams}) {
  usePageTitle('Moje statystyki – Posiedzenia Prezydium');
  const s = useSession();
  const today = isoDayOf(Date.now());
  const year = today.slice(0, 4);
  const q = props.query;
  const mode: 'rok' | 'kadencja' | 'inny' = q.get('kadencja') ? 'kadencja' : q.get('od') || q.get('do') ? 'inny' : 'rok';
  const [from, setFrom] = useState(q.get('od') ?? ''), [until, setUntil] = useState(q.get('do') ?? '');
  const [custom, setCustom] = useState(mode === 'inny');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [term, setTerm] = useState<string | null>(null);
  const qs = mode === 'kadencja' ? `kadencja=${encodeURIComponent(q.get('kadencja')!)}` : mode === 'inny' ? `od=${encodeURIComponent(q.get('od') ?? '')}&do=${encodeURIComponent(q.get('do') ?? '')}` : `rok=${encodeURIComponent(q.get('rok') ?? year)}`;
  useEffect(() => { setData(null); request<Data>(`/api/statystyki/moje?${qs}`).then(r => { setError(''); setData(r); }).catch(e => setError((e as Error).message)); }, [qs]);
  // Kadencja do wyboru okresu: z posiedzeń zakończonych (frozen.term) w katalogu, raz przy wejściu na stronę.
  useEffect(() => { if (s.can.catalog) request<{rows: CatalogRow[]}>('/api/katalog').then(r => setTerm(r.rows.find(x => x.term)?.term ?? null)).catch(() => {}); }, []);
  const p = data?.stats.persons[0];
  const shownYear = q.get('rok') ?? year;
  const periodText = mode === 'kadencja' ? `w kadencji ${termLabel(q.get('kadencja')!)}` : mode === 'inny' && data ? `w okresie ${dateDots(data.stats.range.from)}–${dateDots(data.stats.range.to)}` : `w ${shownYear} r`;
  const present = p ? p.meetings.cala + p.meetings.czesciowa : 0;
  const sv = p?.sessionVotes, pv = p?.procedureVotes;
  const opts: ['rok' | 'kadencja' | 'inny', string][] = [['rok', `Rok ${year}`], ...(term ? [['kadencja', `Kadencja ${termLabel(term)}`] as ['kadencja', string]] : []), ['inny', 'Inny okres']];
  const pick = (v: 'rok' | 'kadencja' | 'inny') => {
    if (v === 'rok') { setCustom(false); go('#konto/statystyki'); }
    else if (v === 'kadencja' && term) { setCustom(false); go(routeHref('#konto/statystyki', {kadencja: term})); }
    else setCustom(true);
  };
  const shown = custom ? 'inny' : mode;
  return <div class="page page--kolumna stats-page stack">
    <p><a class="oi-link" href="#konto">Moje konto</a></p>
    <h1 class="app-title">Moje <b>statystyki</b></h1>
    <section class="oi-card stack" aria-label="Okres">
      <div class="oi-field">
        <div class="oi-seg seg-field" role="group" aria-label="Okres">
          {opts.map(([v, label]) => <button key={v} type="button" class="oi-opt" aria-pressed={shown === v} onClick={() => pick(v)}>{label}</button>)}
        </div>
      </div>
      {shown === 'inny' && <form class="stack-tight" onSubmit={e => { e.preventDefault(); go(routeHref('#konto/statystyki', {od: from, do: until})); }}>
        <div class="field-row"><Field label="Od"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)}/></Field>
          <Field label="Do"><input type="date" value={until} onInput={e => setUntil((e.target as HTMLInputElement).value)}/></Field></div>
        <div><Button type="submit">Pokaż</Button></div>
      </form>}
    </section>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!data && !error && <p class="muted">Wczytywanie…</p>}
    {data && (!p || !p.meetings.held && !p.procedures) && <Notice>W tym okresie nie zakończyło się żadne posiedzenie Prezydium.</Notice>}
    {p && sv && pv && (p.meetings.held > 0 || p.procedures > 0) && <>
      <section class="oi-card stack" aria-labelledby="stat-werdykt">
        <h2 class="sr-only" id="stat-werdykt">Podsumowanie</h2>
        <p class="stat-verdict">{`Obecność na ${present} z ${p.meetings.held} ${plural(p.meetings.held, 'posiedzenia', 'posiedzeń', 'posiedzeń')} Prezydium ${periodText}. Głos oddany albo karta pobrana w ${sv.cast} z ${sv.eligible} ${plural(sv.eligible, 'głosowania', 'głosowań', 'głosowań')} z prawem głosu.`}</p>
        <div class="oi-stats stat-tiles">
          <div class="oi-stat"><b>{`${pct(present, p.meetings.held)}%`}</b><span>frekwencja</span></div>
          <div class="oi-stat"><b>{share(sv.cast, sv.eligible)}</b><span>udział w głosowaniach</span></div>
          <div class="oi-stat"><b>{share(pv.cast, pv.eligible)}</b><span>głosowania między posiedzeniami</span></div>
        </div>
      </section>
      <section class="oi-card stack" aria-labelledby="stat-obecnosc">
        <h2 class="oi-card__title" id="stat-obecnosc"><span class="oi-mark" aria-hidden="true"/><span>Obecność</span></h2>
        <div class="oi-table-wrap" role="region" tabIndex={0} aria-label="Obecność"><table class="oi-table stat-table">
          <thead><tr><th scope="col">Rodzaj</th><th scope="col">Liczba</th><th scope="col">Udział</th></tr></thead>
          <tbody>
            <tr><th scope="row">Posiedzenia w okresie</th><td>{p.meetings.held}</td><td/></tr>
            <tr><th scope="row">Obecność przez całe obrady</th><td>{p.meetings.cala}</td><td><Bar value={p.meetings.cala} of={p.meetings.held}/></td></tr>
            <tr><th scope="row">Obecność częściowa</th><td>{p.meetings.czesciowa}</td><td><Bar value={p.meetings.czesciowa} of={p.meetings.held}/></td></tr>
            <tr><th scope="row">Nieobecność</th><td>{p.meetings.nieobecnosc}</td><td><Bar value={p.meetings.nieobecnosc} of={p.meetings.held}/></td></tr>
            <tr><th scope="row">W tym obecność zdalna</th><td>{p.meetings.zdalne}</td><td/></tr>
            <tr><th scope="row">W tym spotkania robocze bez kworum</th><td>{p.meetings.robocze}</td><td/></tr>
          </tbody>
        </table></div>
      </section>
      <section class="oi-card stack" aria-labelledby="stat-glosowania">
        <h2 class="oi-card__title" id="stat-glosowania"><span class="oi-mark" aria-hidden="true"/><span>Głosowania na posiedzeniach</span></h2>
        <p>{`Odbyło się ${sv.held}, z prawem głosu ${sv.eligible}.`}</p>
        <div class="oi-table-wrap" role="region" tabIndex={0} aria-label="Głosowania na posiedzeniach"><table class="oi-table stat-table">
          <thead><tr><th scope="col">Tryb</th><th scope="col">Głos oddany</th><th scope="col">Udział</th></tr></thead>
          <tbody>
            <tr><th scope="row">Jawne</th><td>{share(sv.jawne.cast, sv.jawne.eligible)}</td><td><Bar value={sv.jawne.cast} of={sv.jawne.eligible}/></td></tr>
            <tr><th scope="row">Imienne</th><td>{share(sv.imienne.cast, sv.imienne.eligible)}</td><td><Bar value={sv.imienne.cast} of={sv.imienne.eligible}/></td></tr>
            <tr><th scope="row">Tajne (karta pobrana)</th><td>{share(sv.tajne.cast, sv.tajne.eligible)}</td><td><Bar value={sv.tajne.cast} of={sv.tajne.eligible}/></td></tr>
          </tbody>
        </table></div>
        <h3 class="kicker">Moje głosy jawne i imienne</h3>
        <p>{`Za ${(sv.own?.za ?? 0)}, przeciw ${(sv.own?.przeciw ?? 0)}, wstrzymanie się ${(sv.own?.wstrzymuje ?? 0)}. Te liczby widzisz tylko Ty. Inne osoby widzą rozkład wyłącznie z głosowań imiennych, tak jak w wykazie imiennym protokołu.`}</p>
        <div class="oi-note"><p>W głosowaniu tajnym aplikacja zapisuje tylko to, że karta została pobrana. Nie wie, jak głosowano, więc tego nie pokazuje nikomu, także Tobie.</p></div>
      </section>
      <section class="oi-card stack" aria-labelledby="stat-miedzy">
        <h2 class="oi-card__title" id="stat-miedzy"><span class="oi-mark" aria-hidden="true"/><span>Głosowania między posiedzeniami</span></h2>
        <p>{`Głos oddany albo karta pobrana w ${pv.cast} z ${pv.eligible} ${plural(pv.eligible, 'głosowania', 'głosowań', 'głosowań')}.`}</p>
      </section>
      <section class="oi-card stack">
        <Fold title="Posiedzenia po kolei" count={p.rows.length}>
          <ul class="stat-rows">{p.rows.map(r => <li key={r.meetingId}><strong class="oi-nowrap">{dateDots(r.day)}</strong> {rowText(r)}</li>)}</ul>
        </Fold>
        <div class="actions">
          <a class="oi-btn oi-btn--obrys" href={`/api/statystyki/moje?${qs}&format=html`} target="_blank" rel="noopener" aria-label="Drukuj moje statystyki albo zapisz je jako PDF"><span>Drukuj albo zapisz jako PDF</span></a>
          <Button onClick={() => download(`/api/statystyki/moje?${qs}&format=csv`)}>Pobierz statystyki w formacie CSV</Button>
        </div>
        <p class="small">Plik zawiera Twoje głosy jawne, których nie ma w protokole.</p>
      </section>
    </>}
    {data && <footer class="stat-source stack-tight">
      {data.source.map(line => <p class="small muted" key={line}>{line}</p>)}
      <Fold title="Jak liczymy?">
        {APP_RULES.filter(r => r.id === 'obecnosc_czesciowa' || r.id === 'statystyki_glosy').map(r => <p key={r.id}>{r.text}</p>)}
      </Fold>
    </footer>}
  </div>;
}

// --- Dodatek D-13 (6.4, B4 5.2, B4-23–B4-27, DB-23): „Statystyki składu” pod #statystyki ------------------------------
type SortKey = 'nazwisko' | 'posiedzenia' | 'frekwencja' | 'glosowania' | 'miedzy';
const SORTS: [SortKey, string][] = [['nazwisko', 'imienia i nazwiska'], ['posiedzenia', 'liczby posiedzeń'], ['frekwencja', 'frekwencji'], ['glosowania', 'udziału w głosowaniach'], ['miedzy', 'głosowań między posiedzeniami']];
type Person = StatsResult['persons'][number];
const sortValue = (p: Person, k: SortKey): number | string => k === 'nazwisko' ? p.name : k === 'posiedzenia' ? p.meetings.held
  : k === 'frekwencja' ? (p.meetings.held ? (p.meetings.cala + p.meetings.czesciowa) / p.meetings.held : -1)
  : k === 'glosowania' ? (p.sessionVotes.eligible ? p.sessionVotes.cast / p.sessionVotes.eligible : -1) : (p.procedureVotes.eligible ? p.procedureVotes.cast / p.procedureVotes.eligible : -1);
/** Uwaga „Do sprawdzenia” (B4-25) słowami, bez ocen osób. */
function noteText(n: StatsResult['notes'][number], persons: Person[]) {
  if (n.kind === 'nieogloszone') return `Posiedzenie z dnia ${dateDots(n.day)} ma głosowanie nr ${n.ballot} bez ogłoszonego wyniku. Statystyki pomijają to głosowanie.`;
  const who = persons.find(p => p.personId === n.personId)?.name ?? 'osoby spoza składu';
  return `Głosowanie nr ${n.ballot} na posiedzeniu z dnia ${dateDots(n.day)} ma głos osoby spoza składu zapisanego przy otwarciu (${who}). Statystyka pomija ten głos.`;
}

function PersonRows(props: {personId: string; qs: string}) {
  const [rows, setRows] = useState<MeetingRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { request<{stats: StatsResult}>(`/api/statystyki/sklad/${encodeURIComponent(props.personId)}?${props.qs}`).then(r => setRows(r.stats.persons[0]?.rows ?? [])).catch(e => setError((e as Error).message)); }, [props.personId, props.qs]);
  if (error) return <ErrorNotice>{error}</ErrorNotice>;
  if (!rows) return <p class="muted">Wczytywanie…</p>;
  return rows.length ? <ul class="stat-rows">{rows.map(r => <li key={r.meetingId}><strong class="oi-nowrap">{dateDots(r.day)}</strong> {rowText(r)}</li>)}</ul> : <p class="muted">Brak posiedzeń w tym okresie.</p>;
}

/** Strona „Statystyki składu” (dodatek D-13); `query`: `od`, `do`, `kadencja`, `rok`, `sort`, `kier`. */
export function RosterStatsPage(props: {query: URLSearchParams}) {
  usePageTitle('Statystyki składu – Posiedzenia Prezydium');
  const s = useSession();
  const today = isoDayOf(Date.now());
  const year = today.slice(0, 4);
  const q = props.query;
  const mode: 'rok' | 'kadencja' | 'inny' = q.get('kadencja') ? 'kadencja' : q.get('od') || q.get('do') ? 'inny' : 'rok';
  const [from, setFrom] = useState(q.get('od') ?? ''), [until, setUntil] = useState(q.get('do') ?? '');
  const [custom, setCustom] = useState(mode === 'inny');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [term, setTerm] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const sort = (SORTS.find(([k]) => k === q.get('sort'))?.[0] ?? null) as SortKey | null;
  const desc = q.get('kier') === 'malejaco';
  const period: Record<string, string> = mode === 'kadencja' ? {kadencja: q.get('kadencja')!} : mode === 'inny' ? {od: q.get('od') ?? '', do: q.get('do') ?? ''} : {rok: q.get('rok') ?? year};
  const qs = new URLSearchParams(period).toString();
  useEffect(() => { setData(null); request<Data>(`/api/statystyki/sklad?${qs}`).then(r => { setError(''); setData(r); }).catch(e => setError((e as Error).message)); }, [qs]);
  useEffect(() => { if (s.can.catalog) request<{rows: CatalogRow[]}>('/api/katalog').then(r => setTerm(r.rows.find(x => x.term)?.term ?? null)).catch(() => {}); }, []);
  const opts: ['rok' | 'kadencja' | 'inny', string][] = [['rok', `Rok ${year}`], ...(term ? [['kadencja', `Kadencja ${termLabel(term)}`] as ['kadencja', string]] : []), ['inny', 'Inny okres']];
  const pick = (v: 'rok' | 'kadencja' | 'inny') => {
    if (v === 'rok') { setCustom(false); go('#statystyki'); }
    else if (v === 'kadencja' && term) { setCustom(false); go(routeHref('#statystyki', {kadencja: term})); }
    else setCustom(true);
  };
  const shown = custom ? 'inny' : mode;
  const r = data?.stats;
  const persons = r ? [...r.persons] : [];
  if (sort) persons.sort((a, b) => { const x = sortValue(a, sort), y = sortValue(b, sort); const c = typeof x === 'string' ? x.localeCompare(String(y), 'pl') : x - (y as number); return desc ? -c : c; });
  const sortBy = (k: SortKey) => {
    const nextDesc = sort === k ? !desc : k !== 'nazwisko';
    setAnnounce(`Posortowano według ${SORTS.find(([x]) => x === k)![1]}, ${nextDesc ? 'malejąco' : 'rosnąco'}.`);
    go(routeHref('#statystyki', {...period, sort: k, kier: nextDesc ? 'malejaco' : 'rosnaco'}));
  };
  const head = (k: SortKey | null, label: string, cls = '') => <th scope="col" class={cls} aria-sort={k && sort === k ? (desc ? 'descending' : 'ascending') : undefined}>
    {k ? <button type="button" class="stat-sort" onClick={() => sortBy(k)}>{label}</button> : label}</th>;
  const present = persons.reduce((n, p) => n + p.meetings.cala + p.meetings.czesciowa, 0), places = persons.reduce((n, p) => n + p.meetings.held, 0);
  const periodText = mode === 'kadencja' ? `w kadencji ${termLabel(q.get('kadencja')!)}` : mode === 'inny' && r ? `w okresie ${dateDots(r.range.from)}–${dateDots(r.range.to)}` : `w ${q.get('rok') ?? year} r`;
  const empty = !!r && !r.counted.meetings && !r.counted.procedures;
  return <div class="page stats-page roster-stats stack">
    <h1 class="app-title">Statystyki <b>składu</b></h1>
    <section class="oi-card stack" aria-label="Okres">
      <div class="oi-field">
        <div class="oi-seg seg-field" role="group" aria-label="Okres">
          {opts.map(([v, label]) => <button key={v} type="button" class="oi-opt" aria-pressed={shown === v} onClick={() => pick(v)}>{label}</button>)}
        </div>
      </div>
      {shown === 'inny' && <form class="stack-tight" onSubmit={e => { e.preventDefault(); go(routeHref('#statystyki', {od: from, do: until})); }}>
        <div class="field-row"><Field label="Od"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)}/></Field>
          <Field label="Do"><input type="date" value={until} onInput={e => setUntil((e.target as HTMLInputElement).value)}/></Field></div>
        <div><Button type="submit">Pokaż</Button></div>
      </form>}
    </section>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {!data && !error && <p class="muted">Wczytywanie…</p>}
    {empty && <Notice>W tym okresie nie zakończyło się żadne posiedzenie Prezydium.</Notice>}
    {r && !empty && <section class="oi-card stack" aria-labelledby="sklad-tabela">
      <h2 class="sr-only" id="sklad-tabela">Obecność i udział członków</h2>
      <p class="stat-verdict">{`Frekwencja ${places ? `${pct(present, places)}%` : '–'} na ${r.counted.meetings} ${plural(r.counted.meetings, 'posiedzeniu', 'posiedzeniach', 'posiedzeniach')} Prezydium ${periodText}.${r.counted.procedures ? ` Do tego ${r.counted.procedures} ${plural(r.counted.procedures, 'głosowanie', 'głosowania', 'głosowań')} między posiedzeniami.` : ''}`}</p>
      <p class="sr-only" aria-live="polite">{announce}</p>
      <div class="oi-table-wrap" role="region" tabIndex={0} aria-label="Statystyki składu"><table class="oi-table stat-table roster-table">
        <thead><tr>{head('nazwisko', 'Imię i nazwisko')}{head(null, 'Funkcja', 'roster-wide')}{head('posiedzenia', 'Posiedzenia', 'roster-wide')}{head(null, 'Cała', 'roster-wide')}{head(null, 'Częściowa', 'roster-wide')}
          {head(null, 'Nieobecność', 'roster-wide')}{head('frekwencja', 'Frekwencja')}{head('glosowania', 'Głosowania')}{head(null, 'Imienne', 'roster-wide')}{head('miedzy', 'Między posiedzeniami')}</tr></thead>
        <tbody>{persons.map(p => {
          const att = p.meetings.cala + p.meetings.czesciowa;
          return [<tr key={p.personId}>
            <th scope="row"><span class="stack-tight"><span>{p.name}</span>
              <button type="button" class="link small link-cel" aria-expanded={open === p.personId} onClick={() => setOpen(open === p.personId ? null : p.personId)}>Posiedzenia po kolei</button></span></th>
            <td class="roster-wide">{p.label}</td><td class="roster-wide">{p.meetings.held}</td><td class="roster-wide">{p.meetings.cala}</td><td class="roster-wide">{p.meetings.czesciowa}</td><td class="roster-wide">{p.meetings.nieobecnosc}</td>
            <td><Bar value={att} of={p.meetings.held} text={p.meetings.held ? `${pct(att, p.meetings.held)}% (${share(att, p.meetings.held)})` : '–'}/></td>
            <td class="oi-nowrap">{share(p.sessionVotes.cast, p.sessionVotes.eligible)}</td>
            <td class="roster-wide oi-nowrap" aria-label={`za ${p.sessionVotes.imienne.za}, przeciw ${p.sessionVotes.imienne.przeciw}, wstrzymanie się ${p.sessionVotes.imienne.wstrzymuje}`}>{`${p.sessionVotes.imienne.za} / ${p.sessionVotes.imienne.przeciw} / ${p.sessionVotes.imienne.wstrzymuje}`}</td>
            <td class="oi-nowrap">{share(p.procedureVotes.cast, p.procedureVotes.eligible)}</td>
          </tr>, open === p.personId && <tr key={p.personId + '-rows'} class="roster-rows"><td colSpan={10}>
            <p class="small roster-narrow">{`${p.label}. Posiedzenia ${p.meetings.held}, obecność przez całe obrady ${p.meetings.cala}, częściowa ${p.meetings.czesciowa}, nieobecność ${p.meetings.nieobecnosc}. Głosowania imienne za ${p.sessionVotes.imienne.za}, przeciw ${p.sessionVotes.imienne.przeciw}, wstrzymanie się ${p.sessionVotes.imienne.wstrzymuje}.`}</p>
            <PersonRows personId={p.personId} qs={qs}/></td></tr>];
        })}</tbody>
      </table></div>
      <p class="small">Rozkład głosów tylko z głosowań imiennych (za, przeciw, wstrzymanie się). Głosowania tajne liczą się wyłącznie jako pobranie karty.</p>
      <div class="actions">
        <a class="oi-btn oi-btn--obrys" href={`/api/statystyki/sklad?${qs}&format=html`} target="_blank" rel="noopener" aria-label="Drukuj statystyki składu albo zapisz je jako PDF"><span>Drukuj albo zapisz jako PDF</span></a>
        <a class="oi-btn oi-btn--obrys" href={`/api/statystyki/sklad?${qs}&format=html&wariant=sprawozdanie`} target="_blank" rel="noopener" aria-label="Drukuj wersję statystyk składu do sprawozdania"><span>Drukuj wersję do sprawozdania</span></a>
        <Button onClick={() => download(`/api/statystyki/sklad?${qs}&format=csv`)}>Pobierz tabelę w formacie CSV</Button>
      </div>
    </section>}
    {r && r.notes.length > 0 && <section class="oi-note oi-note--wazne stack-tight" aria-labelledby="sklad-uwagi"><span class="oi-label" id="sklad-uwagi">Do sprawdzenia</span>
      {r.notes.map((n, i) => <p key={i}>{noteText(n, r.persons)}</p>)}</section>}
    {data && <footer class="stat-source stack-tight">
      {data.source.map(line => <p class="small muted" key={line}>{line}</p>)}
      <Fold title="Jak liczymy?">
        {APP_RULES.filter(x => x.id === 'obecnosc_czesciowa' || x.id === 'statystyki_glosy').map(x => <p key={x.id}>{x.text}</p>)}
      </Fold>
    </footer>}
  </div>;
}
