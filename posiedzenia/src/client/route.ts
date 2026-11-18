// Trasa w aplikacji: #p-<id>, #ekran-<id>, #konta albo pusta (lista posiedzeń).
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
