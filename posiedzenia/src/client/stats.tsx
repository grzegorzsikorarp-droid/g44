import {useEffect, useState} from 'preact/hooks';
import {request, download} from './api.ts';
import {go, routeHref} from './route.ts';
import {Button, CardTitle, ErrorNotice, Fact, Field, Notice, usePageTitle} from './ui.tsx';
import {dateDots, isoDayOf, plural} from '../shared/text.ts';
import type {StatsResult} from '../shared/stats.ts';

// „Moje statystyki” (SPEC-4 6.3, trasa #konto/statystyki?od=&do=). Pakiet D0: zamrożone API (`MyStatsPage`) i prosta
// działająca wersja: okres w adresie, liczby, posiedzenia po kolei, linia źródła, wydruk i CSV z tych samych danych.
// Zespół E dopracowuje układ z B4 5.1 i 5.5 (`statystyki.css`, pasek tekstowy), a w dodatku D-13 dodaje `RosterStatsPage`.
// Moduł ładuje się tylko na tej stronie (T-6): widok posiedzenia, panel i ekran sali go nie importują.

const attendanceText = {cala: 'obecność przez całe obrady', czesciowa: 'obecność częściowa', nieobecnosc: 'nieobecność'} as const;

/** Strona „Moje statystyki”; `query` to parametry trasy (`od`, `do`, `kadencja`, `rok`). */
export function MyStatsPage(props: {query: URLSearchParams}) {
  usePageTitle('Moje statystyki – Posiedzenia Prezydium');
  const today = isoDayOf(Date.now());
  const od = props.query.get('od') ?? `${today.slice(0, 4)}-01-01`, to = props.query.get('do') ?? today;
  const [from, setFrom] = useState(od), [until, setUntil] = useState(to);
  const [data, setData] = useState<{stats: StatsResult; source: string[]} | null>(null);
  const [error, setError] = useState('');
  const qs = `od=${encodeURIComponent(od)}&do=${encodeURIComponent(to)}`;
  useEffect(() => { setData(null); request<{stats: StatsResult; source: string[]}>(`/api/statystyki/moje?${qs}`).then(r => { setError(''); setData(r); }).catch(e => setError(e.message)); }, [qs]);
  const p = data?.stats.persons[0];
  return <div class="page stats-page stack">
    <p><a class="oi-link" href="#konto">Moje konto</a></p>
    <h1 class="app-title">Moje <b>statystyki</b></h1>
    <form class="oi-card stack" onSubmit={e => { e.preventDefault(); go(routeHref('#konto/statystyki', {od: from, do: until})); }}>
      <div class="field-row"><Field label="Od"><input type="date" value={from} onInput={e => setFrom((e.target as HTMLInputElement).value)}/></Field>
        <Field label="Do"><input type="date" value={until} onInput={e => setUntil((e.target as HTMLInputElement).value)}/></Field></div>
      <div><Button type="submit">Pokaż</Button></div>
    </form>
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {data && !p && <Notice>W tym okresie nie zakończyło się żadne posiedzenie Prezydium.</Notice>}
    {p && <section class="oi-card stack">
      <CardTitle level={2}>{`${dateDots(data!.stats.range.from)}–${dateDots(data!.stats.range.to)}`}</CardTitle>
      <dl class="facts">
        <Fact label="Posiedzenia">{p.meetings.held}</Fact>
        <Fact label="Obecność przez całe obrady">{p.meetings.cala}</Fact>
        <Fact label="Obecność częściowa">{p.meetings.czesciowa}</Fact>
        <Fact label="Nieobecność">{p.meetings.nieobecnosc}</Fact>
        <Fact label="Głosowania na posiedzeniach">{`${p.sessionVotes.cast} z ${p.sessionVotes.eligible}`}</Fact>
        <Fact label="Głosowania między posiedzeniami">{`${p.procedureVotes.cast} z ${p.procedureVotes.eligible}`}</Fact>
      </dl>
      <div class="oi-table-wrap" role="region" tabIndex={0} aria-label="Posiedzenia po kolei"><table class="oi-table">
        <thead><tr><th scope="col">Dzień</th><th scope="col">Posiedzenie</th><th scope="col">Obecność</th><th scope="col">Udział w głosowaniach</th></tr></thead>
        <tbody>{p.rows.map(r => <tr key={r.meetingId}><th scope="row">{dateDots(r.day)}</th><td>{r.title}</td><td>{r.attendance ? attendanceText[r.attendance.kind] : ''}</td>
          <td>{`${r.ballots.filter(b => b.cast).length} z ${r.ballots.filter(b => b.eligible).length} ${plural(r.ballots.filter(b => b.eligible).length, 'głosowania', 'głosowań', 'głosowań')}`}</td></tr>)}</tbody>
      </table></div>
      <div class="actions">
        <a class="oi-btn oi-btn--obrys" href={`/api/statystyki/moje?${qs}&format=html`} target="_blank" rel="noopener" aria-label="Drukuj moje statystyki"><span>Drukuj</span></a>
        <Button label="Pobierz moje statystyki w formacie CSV" onClick={() => download(`/api/statystyki/moje?${qs}&format=csv`)}>CSV</Button>
      </div>
      <p class="small">Plik zawiera Twoje głosy jawne, których nie ma w protokole.</p>
    </section>}
    {data && data.source.map(line => <p class="small muted" key={line}>{line}</p>)}
  </div>;
}
