import {useEffect, useRef, useState} from 'preact/hooks';
import {render} from 'preact';
import {Button, ErrorNotice, Modal} from '../client/ui.tsx';
import type {DemoServer} from './server.ts';

// Dokumenty w wersji próbnej (SPEC-4 7.3): odnośniki /api/… (dokumenty, teczka, katalog, zestawienie, statystyki, pliki)
// obsługuje `DemoServer`, a nie przeglądarka. Strona HTML otwiera się w oknie na tej samej stronie z przyciskiem
// „Drukuj albo zapisz jako PDF” (na czas druku klasa `proba-druk` na `body` ukrywa resztę strony, blok @page z nagłówkiem
// pochodzi ze strony dokumentu). Pozostałe formaty pobiera `Blob` z <a download>. W osadzonej ramce okno z komunikatem
// o zablokowanym pobieraniu i, przy Markdown i CSV, przycisk „Pokaż treść” (pole tylko do odczytu). Bez nowych okien.

const FRAME_NOTE = 'Plik powinien się pobrać. Jeśli nic się nie stało, ta strona jest osadzona w ramce, która blokuje pobieranie. Otwórz wersję próbną jako osobny plik.';
const inFrame = () => { try { return window.self !== window.top; } catch { return true; } };
/** Nazwa pliku z nagłówka `Content-Disposition` (`filename*` z UTF-8 ma pierwszeństwo). */
const fileName = (disposition: string | null, fallback: string) => {
  const star = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) { try { return decodeURIComponent(star); } catch { /* zostaje nazwa ASCII */ } }
  return disposition?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
};

function PaperWindow(props: {html: string; onClose: () => void}) {
  const doc = new DOMParser().parseFromString(props.html, 'text/html');
  const title = doc.title || 'Dokument';
  const styles = [...doc.head.querySelectorAll('style')].map(s => s.textContent ?? '').filter(css => css.includes('@page')).join('\n');
  const links = [...doc.querySelectorAll('.toolbar-actions a')].map(a => ({href: a.getAttribute('href') ?? '', label: a.textContent ?? '', name: a.getAttribute('aria-label') ?? ''}));
  const note = doc.querySelector('.toolbar-note')?.textContent ?? '';
  const main = doc.querySelector('main')?.innerHTML ?? doc.body.innerHTML;
  const print = () => {
    // Na czas druku treść stoi poza oknem dialogowym, a reszta strony jest ukryta (druk.css, część wersji próbnej).
    const page = document.createElement('div');
    page.className = 'proba-druk-strona oi-root minutes-page paper-page';
    page.innerHTML = `<style>${styles}</style><main>${main}</main>`;
    document.body.appendChild(page);
    document.body.classList.add('proba-druk');
    const done = () => { document.body.classList.remove('proba-druk'); page.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    try { window.print(); } finally { setTimeout(done, 1000); }
  };
  return <Modal title={title} wide onClose={props.onClose}>
    <div class="toolbar paper-toolbar proba-druk-narzedzia">
      <div class="toolbar-actions">
        {links.map(l => <a class="oi-btn oi-btn--obrys" href={l.href} aria-label={l.name}><span>{l.label}</span></a>)}
        <Button kind="primary" onClick={print}>Drukuj albo zapisz jako PDF</Button>
      </div>
      {note && <p class="toolbar-note">{note}</p>}
    </div>
    <div class="paper-page proba-dokument" dangerouslySetInnerHTML={{__html: `<style>${styles}</style>${main}`}}/>
  </Modal>;
}

function DownloadNote(props: {name: string; text: string | null; onClose: () => void}) {
  const [show, setShow] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (show) area.current?.focus(); }, [show]);
  return <Modal title={props.name} onClose={props.onClose}>
    <p>{FRAME_NOTE}</p>
    {props.text !== null && (show
      ? <textarea ref={area} class="proba-tresc" readOnly rows={12} aria-label={props.name} value={props.text}/>
      : <Button onClick={() => setShow(true)}>Pokaż treść</Button>)}
  </Modal>;
}

/** Odnośniki /api/… w wersji próbnej: dokument w oknie, plik przez `Blob`, odmowa w oknie z komunikatem. */
export function installPaperLinks(server: DemoServer) {
  const overlay = document.createElement('div');
  overlay.className = 'proba-warstwa';
  document.body.appendChild(overlay);
  const close = () => render(null, overlay);
  const open = async (href: string, label: string) => {
    let res: Response;
    try { res = await server.handle(new URL(href, 'https://proba.local')); }
    catch (e) { render(<Modal title={label} onClose={close}><ErrorNotice>{(e as Error).message}</ErrorNotice></Modal>, overlay); return; }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const body = type.includes('json') ? await res.json().catch(() => null) : null;
      render(<Modal title={label} onClose={close}><ErrorNotice>{body?.error ?? 'Nie udało się wykonać tej czynności.'}</ErrorNotice></Modal>, overlay);
      return;
    }
    if (type.startsWith('text/html')) { render(<PaperWindow html={await res.text()} onClose={close}/>, overlay); return; }
    const blob = await res.blob();
    const name = fileName(res.headers.get('content-disposition'), href.split('/').pop()?.split('?')[0] || 'plik');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (inFrame()) {
      const text = /^text\/(csv|markdown|plain)/.test(type) ? await blob.text() : null;
      render(<DownloadNote name={name} text={text} onClose={close}/>, overlay);
    }
  };
  document.addEventListener('click', event => {
    const link = (event.target as Element).closest?.('a[href^="/api/"]') as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    open(link.getAttribute('href')!, link.getAttribute('aria-label') || link.textContent?.trim() || 'Dokument');
  }, true);
}
