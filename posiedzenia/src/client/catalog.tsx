import {useEffect, useState} from 'preact/hooks';
import {download, request} from './api.ts';
import {useSession} from './session.ts';
import {go, routeHref} from './route.ts';
import {Button, ErrorNotice, Fact, Field, Notice, StateChip, Tag, usePageTitle} from './ui.tsx';
import {commsReleaseChip, protocolChip} from './stany.ts';
import {photosLinkText, type CatalogRow} from '../shared/catalog.ts';
import {dateDots, isoDayOf} from '../shared/text.ts';

// „Odbyte posiedzenia” (#odbyte) i zestawienie za okres (#zestawienie) (SPEC-4 6.9). Pakiet D0: zamrożone API
// (`CatalogPage`, `ReportPage`, parametry z adresu trasy) i prosta działająca wersja: filtry w adresie, wiersze z katalogu
// (`GET /api/katalog`), widok konta „Komunikacja” ze stanem udostępnienia, zestawienie w oknie druku i CSV. Zespół F
// dopracowuje układ (blok daty, komplet dokumentów, filtry z B1-27, `archiwum.css`) i w dodatku D-13 dodaje odnośnik
// do „Statystyk składu”. Odświeżanie przy wejściu i po zmianie filtrów, bez stałego odpytywania.

type Row = CatalogRow;

function CatalogItem(props: {row: Row; comms: boolean}) {
  const r = props.row;
  const enc = encodeURIComponent(r.id);
  return <li class="oi-card stack catalog-row">
    <p class="small">{`${dateDots(r.day)}, ${r.kind === 'procedura' ? 'głosowanie między posiedzeniami' : r.working ? 'spotkanie robocze' : `posiedzenie ${r.mode === 'zdalne' ? 'zdalne' : 'stacjonarne'}`}`}</p>
    <h2 class="catalog-title">{r.title} <StateChip state={protocolChip(r.protocol.state)}/></h2>
    <dl class="facts">
      {r.protocolNumber && <Fact label="Numer protokołu">{r.protocolNumber}</Fact>}
      {r.acts && <Fact label="Podjęte akty">{r.acts}</Fact>}
      {r.turnout && <Fact label="Obecnych">{`${r.turnout.present} z ${r.turnout.members}`}</Fact>}
      <Fact label="Zdjęcia">{typeof r.photos === 'object' ? <a href={r.photos.url} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{photosLinkText(r.photos.url)}</a> : r.photos}</Fact>
      {r.complete && <Fact label="Komplet dokumentów">{`${r.complete.have} z ${r.complete.of}`}</Fact>}
    </dl>
    <div class="actions">
      {!props.comms && <a class="oi-btn oi-btn--obrys" href={`#p-${r.id}/dokumenty`}><span>Dokumenty</span></a>}
      {!props.comms && <Button kind="ghost" onClick={() => download(`/api/meetings/${enc}/teczka.zip`)}>Teczka (.zip)</Button>}
      {(!props.comms || r.commsRelease === 'udostepniony') && <Button kind="ghost" onClick={() => download(`/api/katalog/${enc}/komunikacja.md`)}>Materiał dla komunikacji (.md)</Button>}
    </div>
    {props.comms && r.commsRelease && r.commsRelease !== 'udostepniony' && <p><StateChip state={commsReleaseChip(r.commsRelease)}/> Materiał dla komunikacji czeka na udostępnienie.</p>}
  </li>;
}

/** Strona „Odbyte posiedzenia”; `query` to parametry trasy (`rok`, `kadencja`, `rodzaj`, `stan`, `brak`, `q`). */
export function CatalogPage(props: {query: URLSearchParams}) {
  const s = useSession();
  usePageTitle('Odbyte posiedzenia – Posiedzenia Prezydium');
  const comms = s.account.kind === 'komunikacja';
  const year = props.query.get('rok') ?? isoDayOf(Date.now()).slice(0, 4);
  const [rok, setRok] = useState(year);
  const [q, setQ] = useState(props.query.get('q') ?? '');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const qs = new URLSearchParams({...Object.fromEntries(props.query), rok: year}).toString();
  useEffect(() => { setRows(null); request<{rows: Row[]}>(`/api/katalog?${qs}`).then(r => { setError(''); setRows(r.rows); }).catch(e => setError(e.message)); }, [qs]);
  const filtered = props.query.has('q') || props.query.has('stan') || props.query.has('rodzaj') || props.query.has('brak');
  return <div class="page catalog-page stack">
    <header class="page-head"><Tag>Posiedzenia</Tag><h1 class="app-title">Odbyte <b>posiedzenia</b></h1>
      <p>{comms ? 'Tu znajdziesz materiał dla komunikacji z każdego zakończonego posiedzenia i odnośniki do zdjęć.' : 'Posiedzenia, spotkania robocze i głosowania między posiedzeniami, które się zakończyły. Przy każdym stan protokołu, dokumenty i odnośnik do zdjęć.'}</p></header>
    <form class="oi-card stack" onSubmit={e => { e.preventDefault(); go(routeHref('#odbyte', {rok, q})); }}>
      <div class="field-row">
        <Field label="Rok"><input inputMode="numeric" maxLength={4} value={rok} onInput={e => setRok((e.target as HTMLInputElement).value)}/></Field>
        <Field label="Szukaj po numerze uchwały albo tytule"><input value={q} maxLength={100} onInput={e => setQ((e.target as HTMLInputElement).value)}/></Field>
      </div>
      <div class="actions"><Button type="submit">Pokaż</Button>{filtered && <a class="link" href="#odbyte">Wyczyść filtry</a>}</div>
    </form>
    {!comms && <div class="actions">
      {s.can.report && <a class="oi-btn oi-btn--obrys" href="#zestawienie"><span>Zestawienie za okres</span></a>}
      <Button kind="ghost" onClick={() => download(`/api/katalog.csv?${qs}`)}>Pobierz katalog w formacie CSV</Button>
    </div>}
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {rows && (rows.length ? <ol class="catalog-list">{rows.map(r => <CatalogItem key={r.id} row={r} comms={comms}/>)}</ol>
      : <Notice>{filtered ? 'Żadne posiedzenie nie pasuje do wybranych filtrów.' : 'W tym roku nie zakończyło się żadne posiedzenie.'}</Notice>)}
  </div>;
}

/** Zestawienie za okres (`#zestawienie?od=&do=`): wydruk w oknie (HTML z serwera) i dwa pliki CSV. */
export function ReportPage(props: {query: URLSearchParams}) {
  usePageTitle('Zestawienie za okres – Posiedzenia Prezydium');
  const year = isoDayOf(Date.now()).slice(0, 4);
  const [od, setOd] = useState(props.query.get('od') ?? `${year}-01-01`);
  const [to, setTo] = useState(props.query.get('do') ?? `${year}-12-31`);
  const base = `/api/zestawienie?od=${encodeURIComponent(props.query.get('od') ?? od)}&do=${encodeURIComponent(props.query.get('do') ?? to)}`;
  return <div class="page report-page stack">
    <p><a class="oi-link" href="#odbyte">Odbyte posiedzenia</a></p>
    <h1 class="app-title">Zestawienie <b>za okres</b></h1>
    <form class="oi-card stack" onSubmit={e => { e.preventDefault(); go(routeHref('#zestawienie', {od, do: to})); }}>
      <div class="field-row"><Field label="Od"><input type="date" value={od} onInput={e => setOd((e.target as HTMLInputElement).value)}/></Field>
        <Field label="Do"><input type="date" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)}/></Field></div>
      <div><Button type="submit">Pokaż</Button></div>
    </form>
    <div class="actions">
      <a class="oi-btn oi-btn--obrys" href={base} target="_blank" rel="noopener"><span>Drukuj albo zapisz jako PDF</span></a>
      <Button kind="ghost" onClick={() => download(`${base}&format=csv&czesc=posiedzenia`)}>Pobierz posiedzenia w formacie CSV</Button>
      <Button kind="ghost" onClick={() => download(`${base}&format=csv&czesc=akty`)}>Pobierz akty w formacie CSV</Button>
    </div>
  </div>;
}

