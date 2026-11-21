import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {materialTypeLabel} from '../shared/meeting.ts';
import {awaitingVote, ballotTitle} from '../shared/rules.ts';
import type {MaterialRef} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, Confirm, Countdown, ErrorNotice, errorKindOf, Field, Fold, LinkButton, Modal, StateChip, useAction, type ErrorKind} from './ui.tsx';
import {canSetRemarkState} from '../shared/role.ts';
import {PREP_LIMITS, type Comment, type PrepView} from '../shared/workspace.ts';
import {remarkChip} from './stany.ts';
import {dateDotsOf} from '../shared/text.ts';
import type {MeetingData} from './api.ts';
import {useDocTypes} from './doctypes.ts';
import {htmlPages} from './show-pages.ts';

type Loaded = MaterialRef & {html: string};
const cache = new Map<string, Loaded>();
const sizes = ['small', 'normal', 'large', 'xlarge'];
const readSize = () => { try { return localStorage.getItem('posiedzenia:czcionka') || 'normal'; } catch { return 'normal'; } };
const saveSize = (size: string) => { try { localStorage.setItem('posiedzenia:czcionka', size); } catch { /* bez zapisu */ } };

/** Przewija do karty głosowania (górna krawędź pod paskiem posiedzenia) i ustawia fokus na jej nagłówku. */
export function showBallot(ballotId: string, focus = true) {
  const card = document.getElementById(`glosowanie-${ballotId}`) ?? document.querySelector<HTMLElement>(`[data-glosowanie="${ballotId}"]`);
  if (!card) return false;
  card.scrollIntoView({block: 'start'});
  if (focus) card.querySelector<HTMLElement>('[data-naglowek-glosowania]')?.focus({preventScroll: true});
  return true;
}

/** Stopnie pisma czytnika. Napis „A−” albo „A+” zostaje początkiem nazwy dla czytnika ekranu. */
function SizeTools(props: {size: string; onSize: (size: string) => void}) {
  const step = (by: number) => props.onSize(sizes[Math.min(sizes.length - 1, Math.max(0, sizes.indexOf(props.size) + by))]);
  return <div class="reader-tools">
    <Button small disabled={props.size === sizes[0]} onClick={() => step(-1)} label="A−, mniejsze litery">A−</Button>
    <Button small disabled={props.size === sizes[sizes.length - 1]} onClick={() => step(1)} label="A+, większe litery">A+</Button>
  </div>;
}

// Treść materiału pobiera się dopiero po otwarciu, więc odświeżanie obrad nie przesyła dokumentów.
// W oknie stopień pisma ustawiają przyciski w nagłówku okna (`size`), a w karcie przyciski przy tytule.
/**
 * Czytnik materiału. `shownPage` (SPEC-4 6.5, B3-25): przy pokazie materiału tekstowego na sali czytnik dzieli tekst na
 * porcje tak samo jak ekran sali (`htmlPages`), dopisuje „Na sali strona {n}” i zaznacza tę porcję paskiem 6 px z lewej
 * oraz słowami „pokazywane na sali” (stan nie tylko kolorem). Bez `shownPage` czytnik działa jak w wersji 3.
 */
export function MaterialReader(props: {id: string; version: number; inline?: boolean; size?: string; shownPage?: number}) {
  const {m} = useMeeting();
  const key = `${props.id}:${props.version}`;
  const [doc, setDoc] = useState<Loaded | null>(cache.get(key) ?? null);
  const [error, setError] = useState<{text: string; kind: ErrorKind} | null>(null);
  const [own, setOwn] = useState(readSize);
  const size = props.size ?? own;
  useEffect(() => {
    if (cache.has(key)) { setDoc(cache.get(key)!); return; }
    setDoc(null);
    request<{material: Loaded}>(`/api/meetings/${m.id}/materials/${props.id}?v=${props.version}`)
      .then(r => { cache.set(key, r.material); setDoc(r.material); })
      .catch(e => setError({text: e.message, kind: errorKindOf(e)}));
  }, [key]);
  if (error) return <ErrorNotice kind={error.kind}>{error.text}</ErrorNotice>;
  if (!doc) return <p class="muted">Wczytywanie materiału…</p>;
  return <article class={`reader reader-${size}`}>
    <header class="reader-head">
      {/* W karcie „Materiał pokazywany na sali” etykietę ma karta, więc pod tytułem stoi tylko szary dopisek z wersją. */}
      {props.inline
        ? <div><h2>{doc.title}</h2><span class="muted small">wersja {doc.version}</span></div>
        : <div><span class="oi-label">{materialTypeLabel(doc.type)}{doc.number ? ` nr ${doc.number}` : ''}, wersja {doc.version}</span><h3>{doc.title}</h3></div>}
      {props.size === undefined && <SizeTools size={size} onSize={next => { setOwn(next); saveSize(next); }}/>}
    </header>
    {doc.html && props.shownPage ? <ShownPages html={doc.html} page={props.shownPage}/>
      : doc.html ? <div class="doc" dangerouslySetInnerHTML={{__html: doc.html}}/> : <p class="muted">Ten materiał jest dostępny tylko jako plik do pobrania.</p>}
    {doc.fileId && <div><LinkButton small href={`/api/meetings/${m.id}/files/${doc.fileId}`}>Pobierz oryginał{doc.fileName ? ` (${doc.fileName})` : ''}</LinkButton></div>}
    {(m as unknown as MeetingData).prep?.scope === 'pelny' && m.status === 'przygotowanie' && <MaterialRemarks materialId={props.id} version={doc.version}/>}
  </article>;
}

/**
 * Dodatek D-12 (6.5, B2-W08, B2-W09): „Uwagi do materiału ({n})” w przygotowaniu: uwaga do konkretnej wersji z cytatem
 * (z zaznaczenia albo wpisany, do 300 znaków), znaczniki „Otwarta”, „Uwzględniona w wersji {n}”, „Nieuwzględniona”;
 * stan zmienia osoba referująca w swoim punkcie albo osoba przygotowująca; autor przenosi swoją uwagę do materiałów punktu.
 */
function MaterialRemarks(props: {materialId: string; version: number}) {
  const {m, replace} = useMeeting();
  const s = useSession();
  const {busy, error, errorKind, run} = useAction();
  const [writing, setWriting] = useState<{quote: string; text: string} | null>(null);
  const [ask, setAsk] = useState<{c: Comment; type: 'nieuwzgledniona' | 'przenies'} | null>(null);
  const prep = (m as unknown as MeetingData).prep as PrepView;
  const remarks = prep.comments.filter(c => !c.parentId && c.target.kind === 'material' && c.target.materialId === props.materialId);
  const current = m.materials.find(x => x.id === props.materialId)?.version ?? props.version;
  const itemId = m.agenda.find(i => i.materialIds.includes(props.materialId))?.id ?? null;
  const decides = canSetRemarkState(s.roster, m as never, {account: s.account, personId: s.personId, name: s.name}, itemId);
  const send = (cmd: object) => run(async () => { const r = await request<{meeting: MeetingData}>(`/api/meetings/${m.id}/przygotowanie`, {body: {cmd}}); replace({meeting: r.meeting as never}); });
  const selected = () => { try { return (window.getSelection()?.toString() ?? '').replace(/\s+/g, ' ').trim().slice(0, PREP_LIMITS.quote); } catch { return ''; } };
  // Zaznaczenie w tekście materiału zapamiętuje się przy każdej zmianie, bo kliknięcie przycisku może je wyczyścić.
  const lastSelection = useRef('');
  useEffect(() => {
    const on = () => { const t = selected(); if (t) lastSelection.current = t; };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);
  return <div class="material-remarks">
    <Fold title="Uwagi do materiału" count={remarks.length}>
      {remarks.length ? <ol class="prep-comments">{remarks.map(c => {
        const t = c.target as {version: number; quote?: string};
        return <li key={c.id} class="thread">
          <p class="comment__by small">{`${c.byName}, ${dateDotsOf(c.at)}, wersja ${t.version}`} {c.remark && <StateChip state={remarkChip(c.remark.state, c.remark.version)}/>}</p>
          {t.quote && <blockquote class="remark-quote">{`„${t.quote}”`}</blockquote>}
          {c.deleted ? <p class="muted">Uwagę usunięto.</p> : <p class="comment__text">{c.text}</p>}
          {c.remark?.state === 'otwarta' && t.version < current && <p class="small">{`Dotyczy wersji ${t.version}. Obecna wersja ${current}.`}</p>}
          {c.remark?.state === 'nieuwzgledniona' && c.remark.reason && <p class="small">{`Powód „${c.remark.reason}”. ${c.remark.by ?? ''}`.trim()}</p>}
          {c.movedTo && <p class="small muted">{`Przeniesiono do materiałów ${dateDotsOf(c.movedTo.at)}.`}</p>}
          {!c.deleted && <div class="actions">
            {decides && c.remark?.state !== 'uwzgledniona' && <Button small kind="ghost" quiet busy={busy} onClick={() => send({type: 'remark_state', commentId: c.id, state: 'uwzgledniona', version: current})}>{`Uwzględniona w wersji ${current}`}</Button>}
            {decides && c.remark?.state !== 'nieuwzgledniona' && <Button small kind="ghost" quiet haspopup onClick={() => setAsk({c, type: 'nieuwzgledniona'})}>Nieuwzględniona</Button>}
            {decides && c.remark?.state !== 'otwarta' && <Button small kind="ghost" quiet busy={busy} onClick={() => send({type: 'remark_state', commentId: c.id, state: 'otwarta'})}>Otwórz ponownie</Button>}
            {c.accountId === s.account.id && !c.movedTo && <Button small kind="ghost" quiet haspopup onClick={() => setAsk({c, type: 'przenies'})}>Przenieś do materiałów punktu</Button>}
          </div>}
        </li>;
      })}</ol> : <p class="muted">Nie ma jeszcze uwag do tego materiału.</p>}
      {writing ? <form class="stack-tight" onSubmit={e => { e.preventDefault(); send({type: 'comment_add', target: {kind: 'material', materialId: props.materialId, version: props.version, ...(writing.quote.trim() ? {quote: writing.quote.trim()} : {})}, text: writing.text}); setWriting(null); }}>
        <Field label="Cytowany fragment" hint="Zaznacz fragment w tekście przed kliknięciem „Zgłoś uwagę” albo wpisz go. Najwyżej 300 znaków."><input value={writing.quote} maxLength={PREP_LIMITS.quote} onInput={e => setWriting({...writing, quote: (e.target as HTMLInputElement).value})}/></Field>
        <Field label="Twoja uwaga" hint="Uwagi widzą członkowie Prezydium i biuro. Nie są materiałem posiedzenia i nie trafiają do protokołu."><textarea rows={3} maxLength={PREP_LIMITS.comment} value={writing.text} onInput={e => setWriting({...writing, text: (e.target as HTMLTextAreaElement).value})}/></Field>
        <div class="actions"><Button small type="submit" busy={busy} disabled={!writing.text.trim()} reason="Wpisz treść uwagi.">Zgłoś uwagę</Button><Button small kind="ghost" onClick={() => setWriting(null)}>Anuluj</Button></div>
      </form> : <div><Button small onClick={() => setWriting({quote: lastSelection.current || selected(), text: ''})}>Zgłoś uwagę</Button></div>}
      {error && <ErrorNotice kind={errorKind}>{error}</ErrorNotice>}
    </Fold>
    {ask?.type === 'nieuwzgledniona' && <Confirm title="Oznaczyć uwagę jako nieuwzględnioną?" text={<p>{ask.c.text}</p>} confirm="Zapisz" cancel="Anuluj" focus="field" field={{label: 'Powód', hint: 'Zobaczy go osoba, która zgłosiła uwagę.', required: true, maxLength: PREP_LIMITS.reason}}
      onClose={() => setAsk(null)} onConfirm={reason => { const c = ask.c; setAsk(null); send({type: 'remark_state', commentId: c.id, state: 'nieuwzgledniona', reason}); }}/>}
    {ask?.type === 'przenies' && <Confirm title="Przenieść uwagę do materiałów punktu?" text={<p>Powstanie materiał „Inny” z treścią uwagi. Zobaczą go wszyscy uczestnicy posiedzenia, także goście, i może trafić do protokołu jako materiał.</p>}
      confirm="Przenieś do materiałów punktu" cancel="Anuluj" focus="cancel" onClose={() => setAsk(null)} onConfirm={() => { const c = ask.c; setAsk(null); send({type: 'comment_to_material', commentId: c.id}); }}/>}
  </div>;
}

/** Tekst materiału w porcjach pokazu z zaznaczoną porcją widoczną na sali (B3-25). */
function ShownPages(props: {html: string; page: number}) {
  const pages = htmlPages(props.html);
  const shown = Math.min(Math.max(1, props.page), pages.length);
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => { mark.current?.scrollIntoView({block: 'nearest'}); }, [shown]);
  return <div class="doc doc--pokaz">
    <p class="small strong">{`Na sali strona ${shown}`}</p>
    {pages.map((html, i) => i + 1 === shown
      ? <div key={i} ref={mark} class="doc-page is-shown"><span class="oi-label">pokazywane na sali</span><div dangerouslySetInnerHTML={{__html: html}}/></div>
      : <div key={i} class="doc-page" dangerouslySetInnerHTML={{__html: html}}/>)}
  </div>;
}

// Uwaga w czytniku, gdy trwa głosowanie, w którym ta osoba może jeszcze oddać głos. Stoi pod nagłówkiem okna.
function VoteReminder(props: {materialId: string; onGo: (ballotId: string) => void}) {
  const {m} = useMeeting();
  const s = useSession();
  const me = s.personId;
  const waiting = me ? m.ballots.filter(b => b.status === 'otwarte' && awaitingVote(b).includes(me) && (b.remote || m.attendance[me] === 'obecny')) : [];
  const b = waiting.find(x => x.material?.id === props.materialId) ?? waiting[0];
  const note = useRef<HTMLDivElement>(null);
  // Uwaga przykleja się tuż pod nagłówkiem okna, którego wysokość zależy od długości tytułu.
  useLayoutEffect(() => {
    const modal = note.current?.closest<HTMLElement>('.modal');
    const head = modal?.querySelector<HTMLElement>('.modal-head');
    if (!modal || !head) return;
    const set = () => modal.style.setProperty('--glowa-okna', `${head.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(set);
    watch.observe(head);
    return () => watch.disconnect();
  }, [!!b]);
  if (!b) return null;
  return <div class="oi-note reader-vote" ref={note}>
    <span class="oi-label">Trwa {ballotTitle(b).toLocaleLowerCase('pl')}</span>
    <p>Pozostało <Countdown endsAt={b.endsAt} label={false} long={b.remote}/>. Zamknij materiał, aby oddać głos.</p>
    <Button kind="primary" small onClick={() => props.onGo(b.id)}>Przejdź do głosowania</Button>
  </div>;
}

export function MaterialLink(props: {id: string; version: number; label: string; meta?: string}) {
  const {m} = useMeeting();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(readSize);
  const types = useDocTypes();
  const ref = m.materials.find(x => x.id === props.id);
  // Tytuł okna to rodzaj i numer materiału („Uchwała nr 117/IX/2026”), a bez numeru „Materiał”.
  const title = ref?.number ? `${materialTypeLabel(ref.type, types)} nr ${ref.number}` : 'Materiał';
  const resize = (next: string) => { setSize(next); saveSize(next); };
  // Okno zamyka się, a po zamknięciu (i powrocie fokusu na odnośnik) fokus przechodzi na nagłówek karty głosowania.
  const goToVote = (ballotId: string) => { setOpen(false); window.setTimeout(() => showBallot(ballotId), 0); };
  return <>
    <button type="button" class={'material-link' + (props.meta ? ' has-meta' : '')} aria-haspopup="dialog" onClick={() => { setSize(readSize()); setOpen(true); }}>
      <span class="material-link__label">{props.label}</span>
      {props.meta && <span class="material-link__meta">{props.meta}</span>}
      <span class="material-link__act">Czytaj</span>
    </button>
    {open && <Modal title={title} wide onClose={() => setOpen(false)} tools={<SizeTools size={size} onSize={resize}/>}>
      <div class="reader-modal">
        <VoteReminder materialId={props.id} onGo={goToVote}/>
        <MaterialReader id={props.id} version={props.version} size={size}/>
      </div>
    </Modal>}
  </>;
}
