import {useContext, useEffect, useRef, useState} from 'preact/hooks';
import {request, serverNow, upload, useFileUrl, download, type MeetingData} from './api.ts';
import {MeetingCtx} from './context.ts';
import {useSession} from './session.ts';
import {brand} from './brand.ts';
import {announce, Button, CardTitle, ErrorNotice, Field, Fold, Modal, Notice, Segments, StateChip, useAction, useMedia} from './ui.tsx';
import {liveDisplayChip} from './stany.ts';
import {MaterialReader} from './reader.tsx';
import {htmlPages} from './show-pages.ts';
import {blockingBallot, canShowNow, displayFacts, pageNoun, shownDisplay, showVisible} from '../shared/show.ts';
import {canAddDisplay, canRemoveDisplay, canShow} from '../shared/role.ts';
import {itemNumber, orderedAgenda} from '../shared/rules.ts';
import {naturalOrder, refusalByName} from '../shared/files.ts';
import {typo} from '../shared/typo.ts';
import type {Actor, AgendaItem, DisplayRef, MaterialRef, Meeting, ShowState} from '../shared/types.ts';
import './style/pokaz.css';

// Pokaz plików (SPEC-4 6.6, B3-08–B3-25, B3 3.11). Pokaz rozpoczyna, przewija, wznawia i kończy tylko osoba prowadząca
// obrady (`canShow`); biuro dodaje pliki i uruchamia ekran sali. `ShowCard` i `DisplayList` stoją w panelu (chair.tsx),
// `ShowStage` na ekranie sali (screen.tsx), `MemberShow` w widoku uczestnika (meeting.tsx), a `DisplayList` w trybie
// „przygotowanie” w ustawieniach punktu (prep.tsx, zespół E). Uczestnik i sala widzą pokaz wyłącznie przy
// `showVisible(view)` z src/shared/show.ts (stan wspólny, T-3): w trakcie głosowania nic się nie wyświetla ani nie pobiera,
// a po głosowaniu pokaz wraca tylko przyciskiem osoby prowadzącej (B3-11, B3-12).

const enc = encodeURIComponent;
const filePath = (meetingId: string, fileId: string) => `/api/meetings/${enc(meetingId)}/pokaz/${enc(fileId)}`;
/** Pobranie oryginału (B3-10): trasa plików posiedzenia z `Content-Disposition: attachment`. */
const downloadPath = (meetingId: string, fileId: string) => `/api/meetings/${enc(meetingId)}/files/${enc(fileId)}`;
const sendCmd = (meetingId: string, cmd: object) => request<{meeting: MeetingData}>(`/api/meetings/${enc(meetingId)}/command`, {body: cmd});
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };
const actorOf = (s: {account: Actor['account']; personId: string | null; name: string}): Actor => ({account: s.account, personId: s.personId, name: s.name});
/** Podgląd PDF w przeglądarce (B3-22). Emulacja telefonu w Chromium zgłasza `true`, więc liczy się też szerokość. */
const pdfViewer = () => { try { return navigator.pdfViewerEnabled === true; } catch { return false; } };
const isPdfName = (name: string | null | undefined) => !!name && /\.pdf$/i.test(name);

/**
 * Co pokazuje trwający pokaz: plik do pokazania (`DisplayRef`) albo materiał (PDF z kontrolą albo tekst w porcjach).
 * `pages` to liczba stron, gdy znana; przy materiale tekstowym liczy ją dopiero podział tekstu.
 */
type Shown =
  | {kind: 'plik'; d: DisplayRef; title: string; pages: number | null}
  | {kind: 'material-pdf'; ref: MaterialRef; title: string; pages: null}
  | {kind: 'material-tekst'; ref: MaterialRef; title: string; pages: null};
function shownOf(m: Pick<Meeting, 'show' | 'displays' | 'materials'>): Shown | null {
  const s = m.show;
  if (!s) return null;
  if (s.source === 'plik') {
    const d = shownDisplay(m);
    return d ? {kind: 'plik', d, title: d.title, pages: d.kind === 'obrazy' ? d.files.length : d.kind === 'pdf' ? d.pages : 1} : null;
  }
  const ref = m.materials.find(x => x.id === s.id);
  if (!ref) return null;
  return isPdfName(ref.fileName) && ref.fileId ? {kind: 'material-pdf', ref, title: ref.title, pages: null} : {kind: 'material-tekst', ref, title: ref.title, pages: null};
}
const nounOf = (x: Shown) => x.kind === 'plik' ? pageNoun(x.d.kind) : 'strona';
/** „strona 4 z 12”, „slajd 2 z 3”, „strona 4” (bez liczby stron). */
const pageText = (x: Shown, page: number, pages = x.pages) => `${nounOf(x)} ${page}${pages ? ` z ${pages}` : ''}`;
/** „PDF, strona 4 z 12”, „obrazy, slajd 2 z 3”, „obraz”, „materiał, strona 3”. */
function kindLine(x: Shown, page: number) {
  if (x.kind !== 'plik') return `materiał, ${pageText(x, page)}`;
  if (x.d.kind === 'obraz') return 'obraz';
  if (x.d.kind === 'wideo') return 'wideo';
  return `${x.d.kind === 'pdf' ? 'PDF' : 'obrazy'}, ${pageText(x, page)}`;
}

// Treść materiału tekstowego na sali i w panelu: wczytuje się raz na wersję (pamięć karty), więc zmiana strony nie wysyła
// zapytania. Wczytanie zaczyna się dopiero przy widocznym pokazie (T-2).
const materialCache = new Map<string, string>();
function useMaterialPages(meetingId: string, ref: MaterialRef | null, version: number | undefined): string[] | null {
  const key = ref ? `${meetingId}:${ref.id}:${version ?? ref.version}` : '';
  const [html, setHtml] = useState<string | null>(key ? materialCache.get(key) ?? null : null);
  useEffect(() => {
    if (!ref) { setHtml(null); return; }
    if (materialCache.has(key)) { setHtml(materialCache.get(key)!); return; }
    let alive = true;
    request<{material: {html: string}}>(`/api/meetings/${enc(meetingId)}/materials/${enc(ref.id)}?v=${version ?? ref.version}`)
      .then(r => { materialCache.set(key, r.material.html ?? ''); if (alive) setHtml(r.material.html ?? ''); }).catch(() => { if (alive) setHtml(''); });
    return () => { alive = false; };
  }, [key]);
  return html === null ? null : htmlPages(html);
}

/**
 * Sposób wyświetlenia PDF (B3-22, B3-24, 7.3): ramka z podglądem przeglądarki; zastępstwo z numerem strony (telefon, iPad,
 * przeglądarka bez podglądu PDF u uczestnika); komunikat na sali bez podglądu PDF; w wersji próbnej w osadzonej ramce
 * zastępstwo z „Pobierz plik” (ramka sandbox nie wyświetla PDF).
 */
type PdfMode = 'ramka' | 'zastepstwo' | 'brak' | 'proba';
function usePdfMode(variant: 'sala' | 'uczestnik'): PdfMode {
  const desktop = useMedia('(min-width: 761px) and (any-pointer: fine)');
  if (brand.demo && inFrame()) return 'proba';
  const ipad = (() => { try { return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1; } catch { return false; } })();
  if (!pdfViewer()) return variant === 'sala' ? 'brak' : 'zastepstwo';
  return variant === 'sala' || (desktop && !ipad) ? 'ramka' : 'zastepstwo';
}

/**
 * Ramka PDF z kluczem strony (B3-22): nowa ramka przy każdej stronie, `#page={n}`; na sali bez paska narzędzi
 * (`toolbar=0&view=Fit`), u uczestnika `view=FitH`, `title` „{tytuł}, strona {n} z {m}”. Bez podglądu PDF: na sali
 * komunikat B3-22, u uczestnika zastępstwo B3-24 („Na sali strona {n}.”, „Otwórz plik”). W wersji próbnej plik z adresu
 * `blob:`, a w osadzonej ramce zastępstwo z „Pobierz plik” (7.3); u uczestnika „Pobierz plik” stoi pod kartą pokazu.
 */
export function PdfFrame(props: {meetingId: string; fileId: string; page: number; pages: number | null; title: string; variant: 'sala' | 'uczestnik'}) {
  const path = filePath(props.meetingId, props.fileId);
  const mode = usePdfMode(props.variant);
  const url = useFileUrl(mode === 'ramka' ? path : null);
  const label = `${props.title}, strona ${props.page}${props.pages ? ` z ${props.pages}` : ''}`;
  const onRoom = typo(`Na sali strona ${props.page}${props.pages ? ` z ${props.pages}` : ''}.`);
  if (mode === 'proba') return <div class="pdf-fallback stack-tight"><p class="strong">{onRoom}</p>
    {props.variant === 'sala' && <div><Button onClick={() => download(downloadPath(props.meetingId, props.fileId))}>Pobierz plik</Button></div>}</div>;
  if (mode === 'brak') return <p class="screen-sub show-nopdf">{typo('Ta przeglądarka nie wyświetla plików PDF. Otwórz ekran sali w Chrome, Edge albo Firefoksie na komputerze albo pokaż prezentację jako obrazy slajdów.')}</p>;
  if (mode === 'zastepstwo') return <div class="pdf-fallback stack-tight">
    <p class="strong">{onRoom}</p>
    <p>{typo(`Plik otworzy się w nowej karcie albo pobierze. Przejdź w nim do strony ${props.page}.`)}</p>
    {/* Wersja próbna nie otwiera nowych okien (7.1): zostaje „Pobierz plik” pod kartą pokazu. */}
    {!brand.demo && <div><a class="oi-btn oi-btn--obrys" href={`${path}#page=${props.page}`} target="_blank" rel="noopener"><span>Otwórz plik</span></a></div>}
  </div>;
  if (!url) return null;
  const hash = props.variant === 'sala' ? `#page=${props.page}&toolbar=0&view=Fit` : `#page=${props.page}&view=FitH`;
  return <iframe key={`${props.fileId}-${props.page}`} class={`pdf-frame pdf-frame--${props.variant}`} src={url + hash} title={label}/>;
}

/** Obraz albo strona pokazu (wspólne dla sali, podglądu w panelu i uczestnika). Kolejny slajd pobiera się dopiero przy pokazie. */
function ShownView(props: {meetingId: string; x: Shown; page: number; variant: 'sala' | 'uczestnik'; pages?: string[] | null; show?: ShowState}) {
  const {x, page} = props;
  // Wideo (D-4) nie przechodzi przez pamięć `blob:`: sala odtwarza je z trasy pokazu z zakresami bajtów, telefon dopiero po kliknięciu.
  const file = x.kind === 'plik' && x.d.kind !== 'pdf' && x.d.kind !== 'wideo' ? (x.d.kind === 'obrazy' ? x.d.files[page - 1] : x.d.files[0]) : null;
  const url = useFileUrl(file ? filePath(props.meetingId, file.fileId) : null);
  if (x.kind === 'plik' && x.d.kind === 'pdf') return <PdfFrame meetingId={props.meetingId} fileId={x.d.files[0].fileId} page={page} pages={x.d.pages} title={x.title} variant={props.variant}/>;
  if (x.kind === 'material-pdf') return <PdfFrame meetingId={props.meetingId} fileId={x.ref.fileId!} page={page} pages={null} title={x.title} variant={props.variant}/>;
  if (x.kind === 'material-tekst') {
    const pages = props.pages;
    if (!pages) return <p class="muted">Wczytywanie materiału…</p>;
    const at = Math.min(page, pages.length);
    return <div class="show-text stack-tight">
      <div class="doc" dangerouslySetInnerHTML={{__html: pages[at - 1] ?? ''}}/>
      {page > pages.length && <p class="show-text__end">koniec materiału</p>}
    </div>;
  }
  if (x.kind === 'plik' && x.d.kind === 'wideo') {
    if (brand.demo) return <p class="muted">Wideo pokazuje pełna aplikacja.</p>;
    return props.show && props.variant === 'sala' ? <VideoStage meetingId={props.meetingId} d={x.d} show={props.show}/>
      : <video class="show-video__own" src={filePath(props.meetingId, x.d.files[0].fileId)} controls preload="none" aria-label={`${x.title}, wideo`}/>;
  }
  if (!url) return null;
  const total = x.kind === 'plik' && x.d.kind === 'obrazy' ? x.d.files.length : 1;
  return <img class={`show-image show-image--${props.variant}`} src={url} alt={`${x.title}, slajd ${page} z ${total}`}/>;
}

const SOUND_KEY = 'posiedzenia:dzwiek-pokazu';
const readSound = () => { try { return sessionStorage.getItem(SOUND_KEY) === '1'; } catch { return false; } };
/**
 * Dodatek D-4 (B3-23): wideo na ekranie sali bez kontrolek, sterowane stanem `show.playing` z korektą przy rozjeździe
 * ponad 1 s (zegar serwera z `serverNow`). Bez kliknięcia w karcie przeglądarka odtwarza bez dźwięku, więc w rogu stoi
 * „Włącz dźwięk pokazu”; wybór zostaje w pamięci karty. W trakcie głosowania sala nie pokazuje pokazu, więc film znika.
 */
function VideoStage(props: {meetingId: string; d: DisplayRef; show: ShowState}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(readSound);
  const playing = props.show.playing ?? null, pausedAt = props.show.pausedAt ?? 0;
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const sync = () => {
      const want = playing ? playing.from + (serverNow() - playing.since) / 1000 : pausedAt;
      if (Math.abs((v.currentTime || 0) - want) > 1) { try { v.currentTime = Math.max(0, want); } catch { /* jeszcze bez danych */ } }
      if (playing && v.paused) v.play().catch(() => { /* przeglądarka czeka na kliknięcie */ });
      if (!playing && !v.paused) v.pause();
    };
    sync();
    const timer = window.setInterval(sync, 1000);
    return () => window.clearInterval(timer);
  }, [playing?.since, playing?.from, pausedAt]);
  return <div class="show-video">
    <video ref={ref} class="show-video__player" src={filePath(props.meetingId, props.d.files[0].fileId)} muted={!sound} playsInline preload="auto" aria-label={`${props.d.title}, wideo`}/>
    {!sound && <div class="show-video__sound">
      <p>Bez dźwięku. Na komputerze sali kliknij „Włącz dźwięk pokazu”.</p>
      <Button onClick={() => { setSound(true); try { sessionStorage.setItem(SOUND_KEY, '1'); } catch { /* bez zapisu */ } }}>Włącz dźwięk pokazu</Button>
    </div>}
  </div>;
}

/** Komunikat dla czytnika ekranu tylko przy rozpoczęciu, wstrzymaniu i zakończeniu pokazu (6.0, B3-18). */
function useShowAnnouncements(m: Pick<Meeting, 'show' | 'presentation' | 'ballots'>) {
  const state = !m.show ? 'brak' : blockingBallot(m) || m.presentation?.kind !== 'pokaz' ? 'wstrzymany' : 'trwa';
  const before = useRef<string | null>(null);
  useEffect(() => {
    const was = before.current;
    before.current = state;
    if (was === null || was === state) return;
    announce(state === 'trwa' ? (was === 'brak' ? 'Pokaz rozpoczęty.' : 'Pokaz wznowiony.') : state === 'wstrzymany' ? 'Pokaz wstrzymany.' : 'Pokaz zakończony.');
  }, [state]);
}

/**
 * Karta „Pokaz na sali i telefonach” (zdalnie „Pokaz”) w panelu osoby prowadzącej (6.6, B3-18): na górze kolumny „Punkt”,
 * bez przycisku głównego i bez `is-teraz`. W trakcie głosowania zamiast przycisków jedno zdanie, więc żadne kliknięcie
 * nie wysyła wtedy polecenia (B3-12 pkt 4). Na komputerze pod przyciskami podgląd bieżącej strony.
 */
export function ShowCard(props: {meeting: MeetingData; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [going, setGoing] = useState(false);
  const [target, setTarget] = useState('');
  const wide = useMedia('(min-width: 761px)');
  const pdfMode = usePdfMode('sala');
  const m = props.meeting;
  useShowAnnouncements(m);
  const x = shownOf(m);
  const materialPages = useMaterialPages(m.id, x && x.kind === 'material-tekst' && !blockingBallot(m) ? x.ref : null, m.show?.version);
  // Dodatek D-1 (B3-20): pilot do prezentacji wysyła PageDown i PageUp; poza polem tekstowym i oknem zmieniają stronę
  // tylko u osoby prowadzącej, poza głosowaniem (strzałki przewijają stronę, więc ich nie używamy).
  const pilot = useRef<((dir: 1 | -1) => void) | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.key !== 'PageDown' && e.key !== 'PageUp') || e.altKey || e.ctrlKey || e.metaKey || !pilot.current) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog') || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      pilot.current(e.key === 'PageDown' ? 1 : -1);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  pilot.current = null;
  if (!m.show || !x) return null;
  const actor = actorOf(s);
  const presiding = canShow(m as unknown as Meeting, actor);
  const remote = m.mode === 'zdalne';
  const ballot = blockingBallot(m);
  const paused = m.presentation?.kind !== 'pokaz';
  const page = m.show.page;
  const pages = x.pages ?? (x.kind === 'material-tekst' && materialPages ? materialPages.length : null);
  const slide = nounOf(x) === 'slajd';
  const go = (cmd: object) => run(async () => props.onChange((await sendCmd(m.id, cmd)).meeting));
  const lastPage = pages ?? 999;
  const jump = Number(target);
  const jumpOk = Number.isInteger(jump) && jump >= 1 && jump <= lastPage;
  const video = x.kind === 'plik' && x.d.kind === 'wideo';
  const paged = !video && lastPage > 1;
  if (presiding && !ballot && !paused && paged) pilot.current = dir => { const next = page + dir; if (!busy && next >= 1 && next <= lastPage) go({type: 'show_page', page: next}); };
  return <section class="oi-card stack show-card" aria-labelledby="pokaz-tytul">
    <CardTitle level={2}><span id="pokaz-tytul">{remote ? 'Pokaz' : 'Pokaz na sali i telefonach'}</span></CardTitle>
    <div class="stack-tight">
      <p class="show-card__title">{x.title}</p>
      <p class="small">{typo(kindLine(x, page).replace(/^./, c => c.toLocaleUpperCase('pl')) + (x.kind === 'material-tekst' && pages ? ` z ${pages}` : ''))}</p>
    </div>
    {ballot ? <p class="show-card__wait">{ballot.purpose === 'proba' ? 'Pokaz czeka na zakończenie głosowania próbnego.' : typo(`Pokaz czeka na zakończenie głosowania nr ${ballot.number}.`)}</p>
      : !presiding ? <p class="muted small">Pokazuje osoba prowadząca obrady.</p>
      : paused ? <div class="actions show-actions">
        <Button busy={busy} onClick={() => go({type: 'present', kind: 'pokaz', id: m.show!.id})}>{`Wróć do pokazu (${nounOf(x)} ${page})`}</Button>
        <Button kind="ghost" quiet busy={busy} onClick={() => go({type: 'show_end'})}>Zakończ pokaz</Button>
      </div>
      : video ? <div class="actions show-actions">
        {/* Dodatek D-4 (B3-23): zamiast stron „Odtwórz” albo „Zatrzymaj” i „Od początku”. */}
        <Button kind="danger" busy={busy} onClick={() => go({type: 'show_play', on: !m.show!.playing})}>{m.show.playing ? 'Zatrzymaj' : 'Odtwórz'}</Button>
        <Button kind="ghost" quiet busy={busy} onClick={() => go({type: 'show_play', on: !!m.show!.playing, at: 0})}>Od początku</Button>
        <Button kind="ghost" quiet busy={busy} onClick={() => go({type: 'show_end'})}>Zakończ pokaz</Button>
      </div>
      : <>
        <div class="actions show-actions show-actions--pages">
          {/* Para przycisków stron w jednym kolorze, bez przycisku głównego i bez czerwieni (kryterium 6 zespołu F). */}
          <Button kind="danger" disabled={page <= 1} reason={slide ? 'To pierwszy slajd.' : 'To pierwsza strona.'} busy={busy} onClick={() => go({type: 'show_page', page: page - 1})}>{slide ? 'Poprzedni slajd' : 'Poprzednia strona'}</Button>
          <Button kind="danger" disabled={page >= lastPage} reason={slide ? 'To ostatni slajd.' : 'To ostatnia strona.'} busy={busy} onClick={() => go({type: 'show_page', page: page + 1})}>{slide ? 'Następny slajd' : 'Następna strona'}</Button>
        </div>
        <div class="actions">
          {lastPage > 1 && <Button kind="ghost" quiet onClick={() => { setGoing(v => !v); setTarget(String(page)); }}>Przejdź do strony</Button>}
          <Button kind="ghost" quiet busy={busy} onClick={() => go({type: 'show_end'})}>Zakończ pokaz</Button>
        </div>
        {going && <form class="show-goto actions" onSubmit={e => { e.preventDefault(); if (jumpOk) { go({type: 'show_page', page: jump}); setGoing(false); } }}>
          <Field label={slide ? 'Numer slajdu' : 'Numer strony'}><input type="number" inputMode="numeric" min={1} max={lastPage < 999 ? lastPage : undefined} value={target} onInput={e => setTarget((e.target as HTMLInputElement).value)}/></Field>
          <Button type="submit" disabled={!jumpOk} reason={jumpOk ? undefined : typo(pages ? `Wpisz liczbę od 1 do ${pages}.` : 'Wpisz numer strony.')} busy={busy}>Pokaż stronę</Button>
        </form>}
        {paged && <p class="small muted">Pilot do prezentacji zmienia strony, gdy ta karta jest otwarta.</p>}
        {wide && (pdfMode === 'ramka' || !((x.kind === 'plik' && x.d.kind === 'pdf') || x.kind === 'material-pdf')) && <div class="show-preview">
          <ShownView meetingId={m.id} x={x} page={page} variant="sala" pages={materialPages}/>
        </div>}
      </>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </section>;
}

/** Podgląd pliku w oknie tylko dla osoby prowadzącej („Obejrzyj”, B3-19): bez zmiany tego, co widzi sala. */
function PreviewDialog(props: {meetingId: string; d: DisplayRef; onClose: () => void}) {
  const [page, setPage] = useState(1);
  const x: Shown = {kind: 'plik', d: props.d, title: props.d.title, pages: props.d.kind === 'obrazy' ? props.d.files.length : props.d.kind === 'pdf' ? props.d.pages : 1};
  const last = x.pages ?? 1;
  const slide = nounOf(x) === 'slajd';
  return <Modal title={props.d.title} wide onClose={props.onClose}>
    <div class="stack show-dialog">
      <p class="small">{displayFacts(props.d)}</p>
      <ShownView meetingId={props.meetingId} x={x} page={page} variant="uczestnik"/>
      {last > 1 && <div class="actions">
        <Button small disabled={page <= 1} reason={slide ? 'To pierwszy slajd.' : 'To pierwsza strona.'} onClick={() => setPage(page - 1)}>{slide ? 'Poprzedni slajd' : 'Poprzednia strona'}</Button>
        <Button small disabled={page >= last} reason={slide ? 'To ostatni slajd.' : 'To ostatnia strona.'} onClick={() => setPage(page + 1)}>{slide ? 'Następny slajd' : 'Następna strona'}</Button>
      </div>}
      {props.d.description && <Fold title="Opis pokazu"><p class="pre-line">{props.d.description}</p></Fold>}
    </div>
  </Modal>;
}

/** Zmiana nazwy albo punktu pliku do pokazania w przygotowaniu (B3-15). */
function EditDisplay(props: {meetingId: string; d: DisplayRef; agenda: AgendaItem[]; what: 'nazwa' | 'punkt'; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const {busy, error, errorKind, run} = useAction();
  const [title, setTitle] = useState(props.d.title);
  const [itemId, setItemId] = useState(props.d.itemId ?? '');
  const items = orderedAgenda(props.agenda);
  return <Modal title={props.what === 'nazwa' ? 'Zmień nazwę' : 'Przenieś do innego punktu'} onClose={props.onClose}>
    <form class="stack" onSubmit={e => { e.preventDefault(); run(async () => props.onDone((await sendCmd(props.meetingId, props.what === 'nazwa' ? {type: 'display_edit', id: props.d.id, title} : {type: 'display_edit', id: props.d.id, itemId: itemId || null})).meeting)); }}>
      {props.what === 'nazwa'
        ? <Field label="Tytuł"><input value={title} maxLength={200} required onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
        : <Field label="Punkt"><select value={itemId} onChange={e => setItemId((e.target as HTMLSelectElement).value)}>
          {items.map(it => <option key={it.id} value={it.id}>{`${itemNumber(props.agenda, it.id)}. ${it.title}`}</option>)}
        </select></Field>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Zapisz</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/**
 * Lista „Do pokazania” przy punkcie (6.5 wiersz 9, 6.6, B3-15, B3-19). W przygotowaniu (ustawienia punktu): fakty pliku,
 * „Zmień nazwę”, „Przenieś do innego punktu”, „Usuń”, „Dodaj plik do pokazania”. W obradach (karta punktu w panelu):
 * „Pokaż na sali i telefonach” (zdalnie „Pokaż uczestnikom”) i „Obejrzyj” u osoby prowadzącej, „Dodaj plik do pokazania”
 * także u biura, pliki innych punktów w zwiniętej sekcji.
 */
export function DisplayList(props: {meeting: MeetingData; itemId: string | null; mode: 'przygotowanie' | 'obrady'; onChange: (m: MeetingData) => void}) {
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<DisplayRef | null>(null);
  const [edit, setEdit] = useState<{d: DisplayRef; what: 'nazwa' | 'punkt'} | null>(null);
  const m = props.meeting;
  const mm = m as unknown as Meeting;
  const actor = actorOf(s);
  const all = m.displays ?? [];
  const list = all.filter(d => d.itemId === props.itemId);
  const others = all.filter(d => d.itemId !== props.itemId);
  const showing = props.mode === 'obrady' && canShow(mm, actor) && canShowNow(mm);
  const showLabel = m.mode === 'zdalne' ? 'Pokaż uczestnikom' : 'Pokaż na sali i telefonach';
  const prep = props.mode === 'przygotowanie';
  const mayAdd = canAddDisplay(s.roster, mm, actor);
  const show = (d: DisplayRef) => run(async () => props.onChange((await sendCmd(m.id, {type: 'show', source: 'plik', id: d.id})).meeting));
  const row = (d: DisplayRef) => <li key={d.id} class="display-row">
    <div class="display-row__head"><strong>{d.title}</strong>{d.live && <StateChip state={liveDisplayChip()}/>}</div>
    <p class="small">{displayFacts(d)}{props.mode === 'obrady' && d.itemId !== props.itemId && d.itemId ? typo(`, punkt ${itemNumber(m.agenda, d.itemId)}`) : ''}</p>
    <div class="actions">
      {showing && m.show?.id !== d.id && <Button small kind="ghost" busy={busy} onClick={() => show(d)}>{showLabel}</Button>}
      {props.mode === 'obrady' && canShow(mm, actor) && <Button small kind="ghost" haspopup onClick={() => setPreview(d)}>Obejrzyj</Button>}
      {prep && mayAdd && <Button small kind="ghost" haspopup onClick={() => setEdit({d, what: 'nazwa'})}>Zmień nazwę</Button>}
      {prep && mayAdd && <Button small kind="ghost" haspopup onClick={() => setEdit({d, what: 'punkt'})}>Przenieś do innego punktu</Button>}
      {canRemoveDisplay(s.roster, mm, actor, d) && (prep || m.show?.id !== d.id) && <Button small kind="ghost" busy={busy} label={`Usuń plik do pokazania „${d.title}”`} onClick={() => run(async () => props.onChange((await sendCmd(m.id, {type: 'display_remove', id: d.id})).meeting))}>Usuń</Button>}
    </div>
  </li>;
  return <div class="stack-tight display-list">
    {list.length ? <ul class="display-items">{list.map(row)}</ul> : <p class="muted small">Nie ma plików do pokazania.</p>}
    {props.mode === 'obrady' && others.length > 0 && <Fold title={`Pliki innych punktów (${others.length})`}><ul class="display-items">{others.map(row)}</ul></Fold>}
    {mayAdd && <div><Button small kind="ghost" quiet={props.mode === 'obrady'} haspopup onClick={() => setAdding(true)}>Dodaj plik do pokazania</Button></div>}
    {adding && <AddDisplay meeting={m} itemId={props.itemId} onClose={() => setAdding(false)} onDone={next => { setAdding(false); props.onChange(next); }}/>}
    {preview && <PreviewDialog meetingId={m.id} d={preview} onClose={() => setPreview(null)}/>}
    {edit && <EditDisplay meetingId={m.id} d={edit.d} agenda={m.agenda} what={edit.what} onClose={() => setEdit(null)} onDone={next => { setEdit(null); props.onChange(next); }}/>}
    {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
  </div>;
}

const isImageName = (name: string) => /\.(jpe?g|png|webp)$/i.test(name);
/** Liczba stron PDF z największego `/Count` (tylko do zdania o telefonach przed wysłaniem; liczy ją potem serwer). */
async function pdfPages(f: File): Promise<number> {
  try {
    const text = new TextDecoder('latin1').decode(new Uint8Array(await f.arrayBuffer()));
    return Math.max(0, ...[...text.matchAll(/\/Count\s+(\d+)/g)].map(x => Number(x[1])));
  } catch { return 0; }
}

/**
 * Okno „Dodaj plik do pokazania” (6.6, B3-16): odmowy po rozszerzeniu przed wysłaniem (B3-05), po sprawdzeniu sygnatury
 * i wymiarów na serwerze (G-34). Przy kilku obrazach wybór „Jedna prezentacja ze slajdów” albo „Osobne obrazy”, kolejność
 * slajdów i nieobowiązkowy plik PDF prezentacji (K4-28). W trakcie obrad punkt bieżący albo jeszcze nierozpatrzony (B3-17).
 */
export function AddDisplay(props: {meeting: Pick<MeetingData, 'id'>; itemId: string | null; onClose: () => void; onDone: (m: MeetingData) => void}) {
  const ctx = useContext(MeetingCtx);
  const {busy, error, errorKind, run, setError} = useAction();
  const [files, setFiles] = useState<File[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [series, setSeries] = useState<'jedna' | 'osobne'>('jedna');
  const [title, setTitle] = useState('');
  const [itemId, setItemId] = useState(props.itemId ?? '');
  const [description, setDescription] = useState('');
  const [pages, setPages] = useState(0);
  const agenda = ctx?.m.agenda ?? [];
  const live = ctx ? ctx.m.status === 'trwa' || ctx.m.status === 'przerwa' : false;
  const items = orderedAgenda(agenda).filter(it => !live || it.id === ctx?.m.currentItemId || it.status === 'oczekuje' || it.status === 'w_toku');
  const images = files.length > 1 && files.every(f => isImageName(f.name));
  const onePdf = files.length === 1 && /\.pdf$/i.test(files[0].name);
  const move = (i: number, by: number) => { const next = [...files]; const [f] = next.splice(i, 1); next.splice(i + by, 0, f); setFiles(next); };
  return <Modal title="Dodaj plik do pokazania" wide onClose={props.onClose}>
    <form class="stack add-display" onSubmit={e => { e.preventDefault(); run(async () => {
      if (!files.length) { setError('Wybierz plik.'); return; }
      const form = new FormData();
      for (const f of files) form.append('file', f);
      form.append('title', title);
      if (itemId) form.append('itemId', itemId);
      if (images && series === 'jedna') {
        form.append('series', '1');
        form.append('order', files.map(f => f.name).join(','));
        if (pdf) form.append('pdf', pdf);
      }
      form.append('description', description);
      props.onDone((await upload<{meeting: MeetingData}>(`/api/meetings/${enc(props.meeting.id)}/pokaz`, form)).meeting);
    }); }}>
      <Field label="Plik" hint={typo('PDF, obrazy JPG, PNG albo WebP do 10 MB.' + (brand.demo ? '' : ' Film MP4 do 25 MB.') + ' Prezentację najlepiej dodać jako obrazy slajdów, bo wtedy wygląda tak samo na sali i na telefonach. PDF wyświetli się na sali i na komputerach, a na telefonach jako plik do otwarcia.')}>
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.mp4" multiple onChange={e => {
          const picked = [...((e.target as HTMLInputElement).files ?? [])];
          // Wersja próbna (7.3): wideo pokazuje pełna aplikacja; w rdzeniu MP4 ma odmowę z files.ts (wideo to dodatek D-4).
          const refusal = picked.map(f => brand.demo && /\.(mp4|m4v|mov|webm)$/i.test(f.name) ? 'Wideo pokazuje pełna aplikacja.' : refusalByName(f.name)).find(Boolean);
          if (refusal) { setError(refusal); setFiles([]); return; }
          setError('');
          setFiles(naturalOrder(picked, f => f.name));
          setPages(0);
          if (picked.length === 1 && /\.pdf$/i.test(picked[0].name)) pdfPages(picked[0]).then(setPages);
        }}/>
      </Field>
      {onePdf && pages > 1 && <p class="small">{typo('Na telefonach strony PDF nie przewijają się razem z salą. Jeśli prezentację mają śledzić osoby na telefonach, dodaj ją także jako obrazy slajdów.')}</p>}
      {images && <Segments label="Kilka obrazów" value={series} options={[['jedna', 'Jedna prezentacja ze slajdów'], ['osobne', 'Osobne obrazy']]} onChange={setSeries}/>}
      {images && series === 'jedna' && <div class="stack-tight">
        <span class="oi-field__label" id="kolejnosc-slajdow">Kolejność slajdów</span>
        <ol class="slide-order" aria-labelledby="kolejnosc-slajdow">{files.map((f, i) => <li key={f.name + i}>
          <span class="slide-order__name">{f.name}</span>
          <span class="actions">
            <Button small kind="ghost" disabled={i === 0} label={`Przesuń slajd ${i + 1} wyżej`} onClick={() => move(i, -1)}>Wyżej</Button>
            <Button small kind="ghost" disabled={i === files.length - 1} label={`Przesuń slajd ${i + 1} niżej`} onClick={() => move(i, 1)}>Niżej</Button>
          </span>
        </li>)}</ol>
      </div>}
      {images && series === 'jedna' && <Field label="Plik PDF tej prezentacji (nieobowiązkowy)" hint={typo('Osoby, które korzystają z czytnika ekranu, przeczytają tekst slajdów z pliku PDF.')}>
        <input type="file" accept=".pdf" onChange={e => setPdf((e.target as HTMLInputElement).files?.[0] ?? null)}/>
      </Field>}
      <Field label="Tytuł"><input value={title} maxLength={200} onInput={e => setTitle((e.target as HTMLInputElement).value)}/></Field>
      {items.length > 0 && <Field label="Punkt"><select value={itemId} onChange={e => setItemId((e.target as HTMLSelectElement).value)}>
        {!live && <option value="">Bez punktu</option>}
        {items.map(it => <option key={it.id} value={it.id}>{`${itemNumber(agenda, it.id)}. ${it.title}`}</option>)}
      </select></Field>}
      <Field label="Opis pokazu" hint={typo('Opisz krótko slajdy. Opis zobaczą osoby, które nie widzą obrazu.')}><textarea rows={3} maxLength={2000} value={description} onInput={e => setDescription((e.target as HTMLTextAreaElement).value)}/></Field>
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
      {busy && <p role="status">Sprawdzanie pliku…</p>}
      <div class="actions"><Button kind="primary" type="submit" busy={busy}>Dodaj do pokazania</Button><Button kind="ghost" onClick={props.onClose}>Anuluj</Button></div>
    </form>
  </Modal>;
}

/**
 * Stan „pokaz” na ekranie sali (B3-08, piąte miejsce kolejności): pokaz zajmuje środek ekranu, a nad stopką stoi wiersz
 * „Pokaz „{tytuł}”, strona {n} z {m}”. Ramka PDF ma nowy klucz przy każdej stronie (B3-22), obraz tekst alternatywny
 * „{tytuł}, slajd {n} z {m}” (B3-25), materiał tekstowy porcję z B3-21 dużym pismem.
 */
export function ShowStage(props: {meeting: MeetingData}) {
  const m = props.meeting;
  const visible = showVisible(m);
  const x = visible ? shownOf(m) : null;
  const pages = useMaterialPages(m.id, x?.kind === 'material-tekst' ? x.ref : null, m.show?.version);
  if (!visible || !m.show || !x) return null;
  const total = x.pages ?? (x.kind === 'material-tekst' && pages ? pages.length : null);
  const page = x.kind === 'material-tekst' && total ? Math.min(m.show.page, total) : m.show.page;
  return <div class={`show-stage show-stage--${x.kind === 'plik' ? x.d.kind : x.kind}`}>
    <div class="show-stage__body"><ShownView meetingId={m.id} x={x} page={m.show.page} variant="sala" pages={pages} show={m.show}/></div>
    <p class="show-stage__label">{typo(`Pokaz „${x.title}”, ${x.kind === 'plik' && x.d.kind === 'wideo' ? 'wideo' : pageText(x, page, total)}`)}</p>
  </div>;
}

const OWN_KEY = 'posiedzenia:pokaz-samodzielnie';
function readOwn(runKey: string): {key: string; page: number} | null {
  try { const v = JSON.parse(sessionStorage.getItem(OWN_KEY) ?? 'null'); return v && v.key === runKey && Number.isInteger(v.page) ? v : null; } catch { return null; }
}
function writeOwn(runKey: string, v: {key: string; page: number} | null) {
  try { if (v) sessionStorage.setItem(OWN_KEY, JSON.stringify(v)); else if (readOwn(runKey)) sessionStorage.removeItem(OWN_KEY); } catch { /* bez zapisu */ }
}

/**
 * Karta „Pokaz na sali” (zdalnie „Pokaz”) u uczestnika (6.6, B3-09, B3-10, B3-24): tylko przy `showVisible(view)` (T-3).
 * Podąża za salą, a „Przeglądaj samodzielnie” włącza własne strony; wybór trzyma pamięć karty dla danego pokazu, bez
 * zapisu na serwerze. Na telefonie PDF ma zastępstwo z numerem strony i „Otwórz plik”.
 */
export function MemberShow(props: {meeting: MeetingData}) {
  const m = props.meeting;
  const visible = showVisible(m);
  const runKey = m.show ? `${m.show.id}:${m.show.startedAt}` : '';
  // B3-10: wybór „Przeglądaj samodzielnie” trzyma pamięć karty przeglądarki dla danego pokazu (sessionStorage w try/catch),
  // bez zapisu na serwerze; po zmianie pokazu wraca podążanie za salą.
  const [own, setOwnState] = useState<{key: string; page: number} | null>(() => readOwn(runKey));
  const setOwn = (next: {key: string; page: number} | null) => { setOwnState(next); writeOwn(runKey, next); };
  const pdfMode = usePdfMode('uczestnik');
  if (!visible || !m.show) return null;
  const x = shownOf(m);
  if (!x) return null;
  const roomPage = m.show.page;
  const mine = own && own.key === runKey ? own.page : null;
  const page = mine ?? roomPage;
  const pages = x.pages ?? 1;
  const slide = nounOf(x) === 'slajd';
  const pdf = (x.kind === 'plik' && x.d.kind === 'pdf') || x.kind === 'material-pdf';
  const framed = !pdf || pdfMode === 'ramka';
  const pagedFile = x.kind === 'plik' && (x.d.kind === 'obrazy' || x.d.kind === 'pdf') && pages > 1 && framed;
  const original = x.kind === 'plik' ? (x.d.kind === 'obrazy' ? x.d.files[page - 1] ?? x.d.files[0] : x.d.files[0]) : null;
  // W-W4-12: zdanie wersji próbnej tylko przy pliku dodanym w tej karcie (wbudowane pliki próbne mają stały przedrostek).
  const ids = x.kind === 'plik' ? x.d.files.map(f => f.fileId) : x.kind === 'material-pdf' && x.ref.fileId ? [x.ref.fileId] : [];
  const addedHere = ids.some(id => !id.startsWith('plik_proba-'));
  return <section class="oi-card stack member-show" aria-labelledby="pokaz-uczestnik">
    <div class="panel-head"><span class="oi-label" id="pokaz-uczestnik">{m.mode === 'zdalne' ? 'Pokaz' : 'Pokaz na sali'}</span></div>
    <p class="member-show__title">{x.title}</p>
    {x.kind === 'material-tekst'
      ? <MaterialReader id={x.ref.id} version={m.show.version ?? x.ref.version} inline shownPage={roomPage}/>
      : <>
        {framed && <p class="small">{typo(x.kind === 'plik' && x.d.kind === 'wideo' && m.show.playing ? `Na sali odtwarzane jest wideo „${x.title}”.` : mine !== null ? `Przeglądasz samodzielnie. Na sali ${nounOf(x)} ${roomPage} z ${pages}.` : x.kind === 'plik' && (x.d.kind === 'obraz' || x.d.kind === 'wideo') ? kindLine(x, page) : `${slide ? 'Slajd' : 'Strona'} ${page}${x.pages ? ` z ${x.pages}` : ''}`)}</p>}
        <div class="member-show__view"><ShownView meetingId={m.id} x={x} page={page} variant="uczestnik"/></div>
        {pagedFile && (mine === null
          ? <div><Button kind="ghost" onClick={() => setOwn({key: runKey, page: roomPage})}>Przeglądaj samodzielnie</Button></div>
          : <div class="actions">
            <Button small disabled={page <= 1} reason={slide ? 'To pierwszy slajd.' : 'To pierwsza strona.'} onClick={() => setOwn({key: runKey, page: page - 1})}>{slide ? 'Poprzedni slajd' : 'Poprzednia strona'}</Button>
            <Button small disabled={page >= pages} reason={slide ? 'To ostatni slajd.' : 'To ostatnia strona.'} onClick={() => setOwn({key: runKey, page: page + 1})}>{slide ? 'Następny slajd' : 'Następna strona'}</Button>
            <Button small onClick={() => setOwn(null)}>Wróć do strony z sali</Button>
          </div>)}
      </>}
    <div class="actions">
      {original && <Button kind="ghost" onClick={() => download(downloadPath(m.id, original.fileId))}>Pobierz plik</Button>}
      {x.kind === 'material-pdf' && <Button kind="ghost" onClick={() => download(downloadPath(m.id, x.ref.fileId!))}>Pobierz plik</Button>}
      {x.kind === 'plik' && x.d.pdf && <Button kind="ghost" onClick={() => download(downloadPath(m.id, x.d.pdf!.fileId))}>Pobierz wersję PDF</Button>}
    </div>
    {x.kind === 'plik' && x.d.description && <Fold title="Opis pokazu"><p class="pre-line">{x.d.description}</p></Fold>}
    {brand.demo && addedHere && <Notice>Pliki dodane w wersji próbnej znikają po odświeżeniu strony.</Notice>}
  </section>;
}
