import {useEffect, useLayoutEffect, useRef, useState} from 'preact/hooks';
import {materialTypeLabel} from '../shared/meeting.ts';
import {awaitingVote} from '../shared/rules.ts';
import type {MaterialRef} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting} from './context.ts';
import {useSession} from './session.ts';
import {Button, Countdown, ErrorNotice, errorKindOf, LinkButton, Modal, type ErrorKind} from './ui.tsx';

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
export function MaterialReader(props: {id: string; version: number; inline?: boolean; size?: string}) {
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
      <div><span class="oi-label">{materialTypeLabel(doc.type)}{doc.number ? ` nr ${doc.number}` : ''}, wersja {doc.version}</span>{props.inline ? <h2>{doc.title}</h2> : <h3>{doc.title}</h3>}</div>
      {props.size === undefined && <SizeTools size={size} onSize={next => { setOwn(next); saveSize(next); }}/>}
    </header>
    {doc.html ? <div class="doc" dangerouslySetInnerHTML={{__html: doc.html}}/> : <p class="muted">Ten materiał jest dostępny tylko jako plik do pobrania.</p>}
    {doc.fileId && <div><LinkButton small href={`/api/meetings/${m.id}/files/${doc.fileId}`}>Pobierz oryginał{doc.fileName ? ` (${doc.fileName})` : ''}</LinkButton></div>}
  </article>;
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
    <span class="oi-label">Trwa głosowanie nr {b.number}</span>
    <p>Pozostało <Countdown endsAt={b.endsAt} label={false} long={b.remote}/>. Zamknij materiał, aby oddać głos.</p>
    <Button kind="primary" small onClick={() => props.onGo(b.id)}>Przejdź do głosowania</Button>
  </div>;
}

export function MaterialLink(props: {id: string; version: number; label: string; meta?: string}) {
  const {m} = useMeeting();
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(readSize);
  const ref = m.materials.find(x => x.id === props.id);
  // Tytuł okna to rodzaj i numer materiału („Uchwała nr 117/IX/2026”), a bez numeru „Materiał”.
  const title = ref?.number ? `${materialTypeLabel(ref.type)} nr ${ref.number}` : 'Materiał';
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
