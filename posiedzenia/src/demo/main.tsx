import {render} from 'preact';
import {App} from '../client/app.tsx';
import {setBrand} from '../client/brand.ts';
import '../client/typo.ts';
import '../client/styles.css';
import './proba.css';
import {DemoServer} from './server.ts';
import {DemoPicker} from './picker.tsx';
import {installPaperLinks} from './papers-window.tsx';

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

// W ramce sandbox bez „allow-forms” (opublikowana strona) przeglądarka nie wysyła formularzy i nie wywołuje zdarzenia
// submit. Wersja próbna sama sprawdza pola i wywołuje submit, który obsługują formularze aplikacji (każdy z preventDefault).
const submitForm = (form: HTMLFormElement, submitter: HTMLElement | null) => {
  if (form.reportValidity()) form.dispatchEvent(new SubmitEvent('submit', {bubbles: true, cancelable: true, submitter}));
};
document.addEventListener('click', event => {
  const button = (event.target as Element).closest?.('button') as HTMLButtonElement | null;
  if (!button || button.type !== 'submit' || !button.form) return;
  event.preventDefault();
  if (button.getAttribute('aria-disabled') !== 'true') submitForm(button.form, button);
});
document.addEventListener('keydown', event => {
  const field = event.target;
  if (event.key !== 'Enter' || event.defaultPrevented || !(field instanceof HTMLInputElement) || !field.form || ['button', 'submit', 'checkbox', 'radio', 'file'].includes(field.type)) return;
  event.preventDefault();
  const submitter = field.form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (submitter?.getAttribute('aria-disabled') !== 'true') submitForm(field.form, submitter);
});

// Wersja 4 (7.3): dokumenty, teczka, katalog, zestawienie, statystyki i pliki otwierają się w oknie na tej samej stronie
// albo pobierają przez `Blob` (strona próbna nie otwiera nowych kart).
installPaperLinks(server);

render(<App/>, document.getElementById('app')!);
