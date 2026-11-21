import {useEffect, useState} from 'preact/hooks';
import {download, request} from './api.ts';
import {useSession} from './session.ts';
import {go, routeHref} from './route.ts';
import {generalNow} from './general.ts';
import {MeetingsTabs} from './home.tsx';
import {CommsPreview, PhotosDialog} from './papers.tsx';
import {Button, Check, ErrorNotice, Fact, Field, Fold, Notice, Segments, StateChip, Tag, usePageTitle} from './ui.tsx';
import {commsReleaseChip, protocolChip} from './stany.ts';
import {CATALOG_KINDS, CATALOG_STATES, catalogHref, catalogParams, catalogQuery, commsRowText, filtersActive, presetOf, presetRange, type CatalogQuery, type ReportPreset} from './papers-rules.ts';
import {photosLinkText, type CatalogRow} from '../shared/catalog.ts';
import {isLeading, isService} from '../shared/role.ts';
import {dateDots, isoDayOf} from '../shared/text.ts';
import {typo} from '../shared/typo.ts';
import type {Actor} from '../shared/types.ts';
import './style/archiwum.css';

// „Odbyte posiedzenia” (#odbyte) i zestawienie za okres (#zestawienie) (SPEC-4 6.9, B1-24–B1-30). Filtry stoją w adresie,
// a zmiana wykonuje się przyciskiem „Pokaż”. Konto „Komunikacja” widzi tylko wiersze posiedzeń zakończonych, odnośniki do
// zdjęć i materiał dla komunikacji po udostępnieniu (4.4, DB-42). Odświeżanie przy wejściu i po zmianie filtrów, bez
// stałego odpytywania. W dodatku D-13 dochodzi odnośnik do „Statystyk składu” w zestawieniu.

type Row = CatalogRow;
const enc = encodeURIComponent;
const actorOf = (s: {account: Actor['account']; personId: string | null; name: string}): Actor => ({account: s.account, personId: s.personId, name: s.name});
const kindText = (r: Row) => r.kind === 'procedura' ? 'Głosowanie między posiedzeniami' : r.working ? 'Spotkanie robocze' : `Posiedzenie ${r.mode === 'zdalne' ? 'zdalne' : 'stacjonarne'}`;

function CatalogItem(props: {row: Row; comms: boolean; staff: boolean; leading: boolean; onPhotos: (r: Row) => void; onPreview: (r: Row) => void}) {
  const r = props.row;
  const id = enc(r.id);
  const released = r.commsRelease === 'udostepniony';
  const commsFile = props.comms ? released : props.leading || props.staff || r.commsRelease !== undefined;
  const [day, month, year] = dateDots(r.day).split('.');
  return <li class="oi-card catalog-row" aria-labelledby={`odbyte-${r.id}`}>
    <div class="catalog-date" aria-hidden="true"><b>{day}</b><span>{`${month}.${year}`}</span></div>
    <div class="catalog-main stack-tight">
      <p class="small catalog-kind"><span class="sr-only">{`${dateDots(r.day)}, `}</span>{kindText(r)}{r.place ? `, ${r.place}` : ''}</p>
      <div class="catalog-head"><h2 class="catalog-title" id={`odbyte-${r.id}`}>{r.title}</h2><StateChip state={protocolChip(r.protocol.state)}/></div>
      {r.protocol.text && <p class="small">{typo(r.protocol.text)}</p>}
      <dl class="facts catalog-facts">
        {r.protocolNumber ? <Fact label="Numer protokołu">{r.protocolNumber}</Fact> : null}
        <Fact label="Podjęte akty">{r.acts || 'brak'}</Fact>
        {r.turnout && <Fact label="Obecnych">{typo(`${r.turnout.present} z ${r.turnout.members}`)}</Fact>}
        <Fact label="Zdjęcia">{typeof r.photos === 'object'
          ? <><a class="oi-link" href={r.photos.url} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{photosLinkText(r.photos.url)}</a> <span class="small">(otwiera się w nowej karcie)</span></>
          : r.photos}</Fact>
      </dl>
      {r.complete && <Fold title={`Komplet dokumentów, ${r.complete.have} z ${r.complete.of}`}>
        <ul class="complete-list">{r.complete.items.map(i => <li key={i.label}><span>{i.label}</span> <strong>{i.ok ? 'jest' : 'brak'}</strong></li>)}</ul>
      </Fold>}
      {props.comms && r.commsRelease && <p class="catalog-comms"><StateChip state={commsReleaseChip(r.commsRelease)}/> {typo(commsRowText(r.commsRelease, null))}</p>}
      {!props.comms && r.commsRelease && <p class="small catalog-comms"><StateChip state={commsReleaseChip(r.commsRelease)}/></p>}
      <div class="actions">
        {!props.comms && <a class="oi-btn oi-btn--obrys" href={`#p-${r.id}/dokumenty`} aria-label={`Dokumenty, ${r.title}`}><span>Dokumenty</span></a>}
        {!props.comms && props.staff && <Button kind="ghost" label={`Teczka (.zip), ${r.title}`} onClick={() => download(`/api/meetings/${id}/teczka.zip`)}>Teczka (.zip)</Button>}
        {commsFile && <Button kind="ghost" label={`Materiał dla komunikacji (.md), ${r.title}`} onClick={() => download(`/api/katalog/${id}/komunikacja.md`)}>Materiał dla komunikacji (.md)</Button>}
        {commsFile && <Button kind="ghost" haspopup label={`Podgląd materiału dla komunikacji, ${r.title}`} onClick={() => props.onPreview(r)}>Podgląd</Button>}
        {props.comms && <Button kind="ghost" haspopup label={`${r.photos === 'brak' ? 'Wpisz odnośnik do zdjęć' : 'Zmień odnośnik'}, ${r.title}`} onClick={() => props.onPhotos(r)}>{r.photos === 'brak' ? 'Wpisz odnośnik do zdjęć' : 'Zmień odnośnik'}</Button>}
      </div>
    </div>
  </li>;
}

/** Strona „Odbyte posiedzenia”; `query` to parametry trasy (`rok`, `kadencja`, `rodzaj`, `stan`, `brak`, `q`). */
export function CatalogPage(props: {query: URLSearchParams}) {
  const s = useSession();
  usePageTitle('Odbyte posiedzenia – Posiedzenia Prezydium');
  const actor = actorOf(s);
  const comms = s.account.kind === 'komunikacja';
  const year = isoDayOf(Date.now()).slice(0, 4);
  const applied = catalogQuery(props.query, year);
  const [f, setF] = useState<CatalogQuery>(applied);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [all, setAll] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [photos, setPhotos] = useState<Row | null>(null);
  const [preview, setPreview] = useState<Row | null>(null);
  const qs = new URLSearchParams(catalogParams(applied)).toString();
  useEffect(() => setF(applied), [qs]);
  useEffect(() => { setRows(null); request<{rows: Row[]}>(`/api/katalog?${qs}`).then(r => { setError(''); setRows(r.rows); }).catch(e => setError(e.message)); }, [qs, tick]);
  // Lata i kadencje do filtrów pochodzą z danych (jedno zapytanie przy wejściu na stronę).
  useEffect(() => { request<{rows: Row[]}>('/api/katalog').then(r => setAll(r.rows)).catch(() => setAll([])); }, [tick]);
  const years = [...new Set([year, ...(all ?? []).map(r => r.day.slice(0, 4))])].sort().reverse();
  const terms = [...new Set((all ?? []).map(r => r.term).filter((t): t is string => !!t))];
  const filtered = filtersActive(applied);
  const staff = isService(actor) || s.isMember('prezydium');
  const leading = isLeading(s.roster, actor);
  const set = (part: Partial<CatalogQuery>) => setF({...f, ...part});
  return <div class="page catalog-page stack">
    <header class="page-head stack-tight">
      <Tag>Posiedzenia</Tag><h1 class="app-title" tabIndex={-1}>Odbyte <b>posiedzenia</b></h1>
      <p>{typo(comms ? 'Tu znajdziesz materiał dla komunikacji z każdego zakończonego posiedzenia i odnośniki do zdjęć.' : 'Posiedzenia, spotkania robocze i głosowania między posiedzeniami, które się zakończyły. Przy każdym stan protokołu, dokumenty i odnośnik do zdjęć.')}</p>
      {!comms && <MeetingsTabs current="odbyte"/>}
    </header>
    <form class="oi-card stack catalog-filters" aria-label="Filtry" onSubmit={e => { e.preventDefault(); go(catalogHref(f)); }}>
      <div class="field-row">
        <Field label="Rok"><select value={f.rok} onChange={e => set({rok: (e.target as HTMLSelectElement).value})}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></Field>
        {!comms && terms.length > 0 && <Field label="Kadencja"><select value={f.kadencja} onChange={e => set({kadencja: (e.target as HTMLSelectElement).value})}>
          <option value="">Wszystkie</option>{terms.map(t => <option key={t} value={t}>{t}</option>)}
        </select></Field>}
      </div>
      <Segments label="Rodzaj" value={f.rodzaj} options={CATALOG_KINDS} onChange={v => set({rodzaj: v})}/>
      <Segments label="Stan protokołu" value={f.stan} options={CATALOG_STATES} onChange={v => set({stan: v})}/>
      {!comms && <Check checked={f.brak} onChange={on => set({brak: on})}>Tylko bez kompletu dokumentów</Check>}
      <Field label="Szukaj po numerze uchwały albo tytule"><input type="search" value={f.q} maxLength={100} onInput={e => set({q: (e.target as HTMLInputElement).value})}/></Field>
      <div class="actions"><Button type="submit">Pokaż</Button>{filtered && <a class="link link-cel" href={routeHref('#odbyte', {rok: applied.rok})}>Wyczyść filtry</a>}</div>
    </form>
    {!comms && <div class="actions">
      {s.can.report && <a class="oi-btn oi-btn--obrys" href="#zestawienie"><span>Zestawienie za okres</span></a>}
      <Button kind="ghost" onClick={() => download(`/api/katalog.csv?${qs}`)}>Pobierz katalog w formacie CSV</Button>
    </div>}
    {error && <ErrorNotice>{error}</ErrorNotice>}
    {rows === null && !error && <p class="muted">Wczytywanie…</p>}
    {rows && (rows.length ? <ol class="catalog-list" aria-label="Odbyte posiedzenia">{rows.map(r => <CatalogItem key={r.id} row={r} comms={comms} staff={staff} leading={leading} onPhotos={setPhotos} onPreview={setPreview}/>)}</ol>
      : <Notice>{filtered ? <>Żadne posiedzenie nie pasuje do wybranych filtrów. <a class="link" href={routeHref('#odbyte', {rok: applied.rok})}>Wyczyść filtry</a></> : 'W tym roku nie zakończyło się żadne posiedzenie.'}</Notice>)}
    {photos && <PhotosDialog meetingId={photos.id} url={typeof photos.photos === 'object' ? photos.photos.url : null} viaCatalog onClose={() => setPhotos(null)} onDone={() => { setPhotos(null); setTick(t => t + 1); }}/>}
    {preview && <CommsPreview meetingId={preview.id} onClose={() => setPreview(null)}/>}
  </div>;
}

/** Granice kadencji z nazwy („I kadencja 2025–2029”); bez lat w nazwie od pierwszego posiedzenia kadencji do dziś. */
function termRange(name: string | null, rows: Row[], today: string): {from: string; to: string} | null {
  if (!name) return null;
  const years = /(\d{4})\s*[–-]\s*(\d{4})/.exec(name);
  if (years) return {from: `${years[1]}-01-01`, to: `${years[2]}-12-31`};
  const days = rows.filter(r => r.term === name).map(r => r.day).sort();
  return days.length ? {from: days[0], to: today} : null;
}

/** Zestawienie za okres (`#zestawienie?od=&do=`, B1-30): treść z serwera, wydruk w oknie i dwa pliki CSV. */
export function ReportPage(props: {query: URLSearchParams}) {
  usePageTitle('Zestawienie za okres – Posiedzenia Prezydium');
  const today = isoDayOf(Date.now());
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { request<{rows: Row[]}>('/api/katalog').then(r => setRows(r.rows)).catch(() => setRows([])); }, []);
  const termName = rows.find(r => r.term)?.term ?? generalNow()?.general.site.term ?? null;
  const term = termRange(termName, rows, today);
  const range = {from: props.query.get('od') ?? `${today.slice(0, 4)}-01-01`, to: props.query.get('do') ?? `${today.slice(0, 4)}-12-31`};
  const [preset, setPreset] = useState<ReportPreset>(presetOf(range, today, term));
  const [od, setOd] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setOd(range.from); setTo(range.to); setPreset(presetOf(range, today, term)); }, [range.from, range.to, termName]);
  const base = `/api/zestawienie?od=${enc(range.from)}&do=${enc(range.to)}`;
  useEffect(() => {
    setHtml(null); setError('');
    // Treść strony do druku z serwera (ta sama w wydruku i na ekranie); bez pasków i stylów strony.
    fetch(base, {credentials: 'same-origin'}).then(async r => {
      const text = await r.text();
      if (!r.ok) { try { setError(JSON.parse(text).error); } catch { setError('Nie udało się wczytać zestawienia.'); } return; }
      const doc = new DOMParser().parseFromString(text, 'text/html');
      // Tabela układu strony do druku (nagłówek powtarzany na każdej stronie) nie jest potrzebna na ekranie: zostaje jej treść.
      const layout = doc.querySelector('table.paper-layout');
      if (layout) {
        const box = doc.createElement('div');
        layout.querySelectorAll(':scope > thead > tr > td, :scope > tbody > tr > td, :scope > tfoot > tr > td').forEach(td => { while (td.firstChild) box.appendChild(td.firstChild); });
        layout.replaceWith(box);
      }
      // Szeroka tabela przewija się w swoim obszarze (320 px bez przewijania strony); obszar ma nazwę i fokus z klawiatury.
      doc.querySelectorAll('table').forEach(t => {
        const wrap = doc.createElement('div');
        wrap.className = 'table-wrap';
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('tabindex', '0');
        let head = t.previousElementSibling;
        while (head && !/^H[1-6]$/.test(head.tagName)) head = head.previousElementSibling;
        wrap.setAttribute('aria-label', `Tabela ${head?.textContent?.trim() || 'zestawienia'}, przewijana w poziomie`);
        t.replaceWith(wrap);
        wrap.appendChild(t);
      });
      setHtml((doc.querySelector('main') ?? doc.body).innerHTML);
    }).catch(() => setError('Brak połączenia. Sprawdź internet i spróbuj ponownie.'));
  }, [base]);
  const choose = (p: ReportPreset) => {
    setPreset(p);
    const r = p === 'inny' ? null : presetRange(p, today, term);
    if (r) go(routeHref('#zestawienie', {od: r.from, do: r.to}));
  };
  const presets: [ReportPreset, string][] = [['rok', `Rok ${today.slice(0, 4)}`], ...(term && termName ? [['kadencja', `Kadencja ${termName.replace(/\s*kadencja\s*/i, ' ').trim()}`] as [ReportPreset, string]] : []), ['12', 'Ostatnie 12 miesięcy'], ['inny', 'Inny okres']];
  return <div class="page report-page stack">
    <p><a class="oi-link" href="#odbyte">Odbyte posiedzenia</a></p>
    <h1 class="app-title" tabIndex={-1}>Zestawienie <b>za okres</b></h1>
    <div class="oi-card stack">
      <Segments label="Okres" value={preset} options={presets} onChange={choose}/>
      {preset === 'inny' && <form class="stack" onSubmit={e => { e.preventDefault(); go(routeHref('#zestawienie', {od, do: to})); }}>
        <div class="field-row"><Field label="Od"><input type="date" value={od} onInput={e => setOd((e.target as HTMLInputElement).value)}/></Field>
          <Field label="Do"><input type="date" value={to} onInput={e => setTo((e.target as HTMLInputElement).value)}/></Field></div>
        <div><Button type="submit">Pokaż</Button></div>
      </form>}
    </div>
    {error ? <ErrorNotice>{error}</ErrorNotice> : <>
      <div class="actions">
        <a class="oi-btn oi-btn--obrys" href={base} target="_blank" rel="noopener"><span>Drukuj albo zapisz jako PDF</span></a>
        <Button kind="ghost" onClick={() => download(`${base}&format=csv&czesc=posiedzenia`)}>Pobierz posiedzenia w formacie CSV</Button>
        <Button kind="ghost" onClick={() => download(`${base}&format=csv&czesc=akty`)}>Pobierz akty w formacie CSV</Button>
      </div>
      {html === null ? <p class="muted">Wczytywanie zestawienia…</p> : <section class="oi-card report-view minutes-view" aria-label="Zestawienie" dangerouslySetInnerHTML={{__html: html}}/>}
    </>}
  </div>;
}
