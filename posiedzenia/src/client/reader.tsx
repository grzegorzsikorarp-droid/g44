import {useEffect, useState} from 'preact/hooks';
import {materialTypeLabel} from '../shared/meeting.ts';
import type {MaterialRef} from '../shared/types.ts';
import {request} from './api.ts';
import {useMeeting} from './context.ts';
import {Button, Modal, Notice} from './ui.tsx';

type Loaded = MaterialRef & {html: string};
const cache = new Map<string, Loaded>();
const sizes = ['small', 'normal', 'large', 'xlarge'];
const readSize = () => { try { return localStorage.getItem('posiedzenia:czcionka') || 'normal'; } catch { return 'normal'; } };

// Treść materiału pobiera się dopiero po otwarciu — odświeżanie obrad nie przesyła dokumentów.
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
      <div><p class="kicker">{materialTypeLabel(doc.type)}{doc.number ? ` nr ${doc.number}` : ''} · wersja {doc.version}</p>{!props.inline && <h2>{doc.title}</h2>}{props.inline && <h3>{doc.title}</h3>}</div>
      <div class="reader-tools">
        <button class="icon-btn" onClick={() => change(-1)} aria-label="Mniejsze litery">A−</button>
        <button class="icon-btn" onClick={() => change(1)} aria-label="Większe litery">A+</button>
      </div>
    </header>
    {doc.html ? <div class="doc" dangerouslySetInnerHTML={{__html: doc.html}}/> : <p class="muted">Ten materiał jest dostępny tylko jako plik do pobrania.</p>}
    {doc.fileId && <p><a class="btn btn-secondary btn-small" href={`/api/meetings/${m.id}/files/${doc.fileId}`}>Pobierz oryginał{doc.fileName ? ` (${doc.fileName})` : ''}</a></p>}
  </article>;
}

export function MaterialLink(props: {id: string; version: number; label: string}) {
  const [open, setOpen] = useState(false);
  return <>
    <button class="material-link" onClick={() => setOpen(true)}><span class="doc-icon" aria-hidden="true">▤</span>{props.label}</button>
    {open && <Modal title="Materiał" wide onClose={() => setOpen(false)}><MaterialReader id={props.id} version={props.version}/><div class="actions"><Button onClick={() => setOpen(false)}>Zamknij</Button></div></Modal>}
  </>;
}
