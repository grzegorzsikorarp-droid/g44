import {render} from 'preact';
import {App} from '../client/app.tsx';
import {setBrand} from '../client/brand.ts';
import {Modal} from '../client/ui.tsx';
import '../client/typo.ts';
import '../client/styles.css';
import {DemoServer} from './server.ts';
import {DemoPicker} from './picker.tsx';

const server = new DemoServer();
const realFetch = window.fetch.bind(window);
// Aplikacja woła /api/… ścieżkami względnymi. Adres strony nie jest potrzebny do ich rozpoznania,
// więc przechwytywanie działa także w osadzonej ramce (about:srcdoc, origin „null”).
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let path: string | null = raw.startsWith('/api/') ? raw : null;
  if (!path) try { const url = new URL(raw); if (url.origin === location.origin && url.pathname.startsWith('/api/')) path = url.pathname + url.search; } catch { /* nie nasz adres */ }
  return path ? server.handle(new URL(path, 'https://proba.local'), init) : realFetch(input, init);
};

// Wersja próbna nie ma znaku ani nazwy Izby: dane i nazwy są fikcyjne.
setBrand({
  demo: true, org: 'Wersja próbna', nameplate: null, logo: null, organ: 'Prezydium (dane fikcyjne)', term: 'wersja próbna',
  meetingTitle: 'Posiedzenie Prezydium (próbne)', procedureTitle: 'Głosowanie między posiedzeniami (próbne)',
  place: 'Sala posiedzeń (przykład)', office: 'Biuro', officeLower: 'biuro', officeOf: 'biura', officeTo: 'biuru', regulation: 'Regulaminu',
  switchLabel: 'Zmień osobę',
  loginScreen: props => <DemoPicker server={server} onDone={props.onDone}/>,
});

// Projekt protokołu otwiera się w oknie na tej samej stronie (strona próbna nie otwiera nowych kart ani wydruku).
const overlay = document.createElement('div');
document.body.appendChild(overlay);
const close = () => render(null, overlay);
document.addEventListener('click', event => {
  const link = (event.target as Element).closest?.('a[href^="/api/"]') as HTMLAnchorElement | null;
  if (!link) return;
  event.preventDefault();
  const match = link.getAttribute('href')!.match(/^\/api\/meetings\/([\w-]+)\/protokol$/);
  let body = '<p>Pobieranie plików jest dostępne w pełnej aplikacji.</p>';
  try { if (match) body = server.minutes(match[1]); } catch (e) { body = `<p>${(e as Error).message}</p>`; }
  render(<Modal title="Projekt protokołu" wide onClose={close}><div class="minutes-view" dangerouslySetInnerHTML={{__html: body}}/></Modal>, overlay);
}, true);

render(<App/>, document.getElementById('app')!);
