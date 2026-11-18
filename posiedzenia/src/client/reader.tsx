import {useEffect, useState} from 'preact/hooks';
import {materialTypeLabel} from '../shared/meeting.ts';
import type {MaterialRef} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting} from './context.ts';
import {Button, LinkButton, Modal, Notice} from './ui.tsx';

type Loaded = MaterialRef & {html: string};
const cache = new Map<string, Loaded>();
const sizes = ['small', 'normal', 'large', 'xlarge'];
const readSize = () => { try { return localStorage.getItem('posiedzenia:czcionka') || 'normal'; } catch { return 'normal'; } };

// Treść materiału pobiera się dopiero po otwarciu, więc odświeżanie obrad nie przesyła dokumentów.
export function MaterialReader(props: {id: string; version: number; inline?: boolean}) {
  const {m} = useMeeting();
  const key = `${props.id}:${props.version}`;
  const [doc, setDoc] = useState<Loaded | null>(cache.get(key) ?? null);
  const [error, setError] = useState('');
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    if (cache.has(key)) { setDoc(cache.get(key)!); return; }
    setDoc(null);
    request<{material: Loaded}>(`/api/meetings/${m.id}/materials/${props.id}?v=${props.version}`)
      .then(r => { cache.set(key, r.material); setDoc(r.material); })
      .catch(e => setError(e.message));
  }, [key]);
  const change = (step: number) => {
    const next = sizes[Math.min(sizes.length - 1, Math.max(0, sizes.indexOf(size) + step))];
    setSize(next);
    try { localStorage.setItem('posiedzenia:czcionka', next); } catch { /* bez zapisu */ }
  };
  if (error) return <Notice tone="error">{error}</Notice>;
  if (!doc) return <p class="muted">Wczytywanie dokumentu…</p>;
  return <article class={`reader reader-${size}`}>
    <header class="reader-head">
      <div><span class="oi-label">{materialTypeLabel(doc.type)}{doc.number ? ` nr ${doc.number}` : ''}, wersja {doc.version}</span>{props.inline ? <h3>{doc.title}</h3> : <h2>{doc.title}</h2>}</div>
      <div class="reader-tools">
        <Button small disabled={size === sizes[0]} onClick={() => change(-1)} label="Mniejsze litery">A−</Button>
        <Button small disabled={size === sizes[sizes.length - 1]} onClick={() => change(1)} label="Większe litery">A+</Button>
      </div>
    </header>
    {doc.html ? <div class="doc" dangerouslySetInnerHTML={{__html: doc.html}}/> : <p class="muted">Ten materiał jest dostępny tylko jako plik do pobrania.</p>}
    {doc.fileId && <div><LinkButton small href={`/api/meetings/${m.id}/files/${doc.fileId}`}>Pobierz oryginał{doc.fileName ? ` (${doc.fileName})` : ''}</LinkButton></div>}
  </article>;
}

export function MaterialLink(props: {id: string; version: number; label: string; meta?: string}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" class="material-link" onClick={() => setOpen(true)}>
      <span class="stack-tight"><span>{props.label}</span>{props.meta && <span class="muted small">{props.meta}</span>}</span>
      <span class="material-link__act">Czytaj</span>
    </button>
    {open && <Modal title="Materiał" wide onClose={() => setOpen(false)}><MaterialReader id={props.id} version={props.version}/><div class="actions"><Button onClick={() => setOpen(false)}>Zamknij materiał</Button></div></Modal>}
  </>;
}
