// Trasa w aplikacji: #p-<id>, #ekran-<id>, #konta, #rodzaje albo pusta (lista posiedzeń).
// Kliknięcia w odnośniki „#…” obsługuje kod, nie przeglądarka: w osadzonej ramce (np. strona próbna)
// taki odnośnik rozwiązuje się względem adresu strony nadrzędnej i przeładowałby całą ramkę.
let current = readHash();
const listeners = new Set<(hash: string) => void>();

function readHash() { try { return location.hash; } catch { return ''; } }
function emit() { for (const listener of listeners) listener(current); }

export const currentRoute = () => current;

export function go(hash: string) {
  const next = hash === '#' ? '' : hash;
  if (next !== current) { current = next; emit(); }
  try { if (location.hash !== next) location.hash = next; } catch { /* ramka bez własnego adresu — trasa tylko w pamięci */ }
}

export function onRoute(listener: (hash: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

window.addEventListener('hashchange', () => {
  const hash = readHash();
  if (hash !== current) { current = hash; emit(); }
});

window.addEventListener('click', event => {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
  // Odnośnik z data-kotwica prowadzi w obrębie strony (np. „Przejdź do treści”), a nie do innej trasy.
  if (!link || link.hasAttribute('target') || link.hasAttribute('data-kotwica')) return;
  event.preventDefault();
  go(link.getAttribute('href')!);
}, true);

// ---------------------------------------------------------------------------------------------------------------
// Wersja 4 (SPEC-4 8.2 D.3, pakiet D0): trasy nowych stron. Parametry stoją po znaku „?” w adresie trasy
// (np. `#odbyte?rok=2026&rodzaj=posiedzenia`, `#zestawienie?od=2026-01-01&do=2026-12-31`, `#konto/statystyki?od=&do=`).
// Trasa `#statystyki` („Statystyki składu”) doszła z dodatkiem D-13.
export type V4Route =
  | {page: 'konto'}
  | {page: 'statystyki'; query: URLSearchParams}
  | {page: 'moje-statystyki'; query: URLSearchParams}
  | {page: 'odbyte'; query: URLSearchParams}
  | {page: 'zestawienie'; query: URLSearchParams}
  | {page: 'dokumenty'; id: string}
  | {page: 'skrzynka'};

/** Część adresu trasy po „?” jako parametry (puste, gdy ich nie ma). */
export const routeQuery = (hash: string) => new URLSearchParams(hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '');
/** Adres trasy z parametrami; puste wartości się pomija (np. `routeHref('#odbyte', {rok: '2026'})`). */
export function routeHref(base: string, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
/** Trasa wersji 4 albo null (trasy wersji 3 rozpoznaje app.tsx jak dotąd). */
export function v4Route(hash: string): V4Route | null {
  const path = hash.split('?')[0];
  if (path === '#konto') return {page: 'konto'};
  if (path === '#konto/statystyki') return {page: 'moje-statystyki', query: routeQuery(hash)};
  if (path === '#statystyki') return {page: 'statystyki', query: routeQuery(hash)};
  if (path === '#odbyte') return {page: 'odbyte', query: routeQuery(hash)};
  if (path === '#zestawienie') return {page: 'zestawienie', query: routeQuery(hash)};
  if (path === '#skrzynka') return {page: 'skrzynka'};
  const docs = path.match(/^#p-([\w-]+)\/dokumenty$/);
  return docs ? {page: 'dokumenty', id: docs[1]} : null;
}
/** Konto „Komunikacja” (4.4) ma tylko „Odbyte posiedzenia” i „Moje konto”; inne trasy prowadzą na `session.home`. */
export const commsRouteAllowed = (hash: string) => ['#odbyte', '#konto'].includes(hash.split('?')[0]);

/** Strony dopisane przez punkt wejścia, np. „Skrzynka (próba)” w wersji próbnej (6.7.5); aplikacja Izby żadnych nie dopisuje. */
const pages = new Map<string, () => unknown>();
export function registerPage(path: string, render: () => unknown) { pages.set(path, render); }
export const registeredPage = (hash: string) => pages.get(hash.split('?')[0]) ?? null;
