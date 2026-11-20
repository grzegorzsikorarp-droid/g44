import type {DisplayKind, DisplayRef, Meeting} from './types.ts';
import {plural} from './text.ts';

// Pokaz plików na posiedzeniu (SPEC-4 6.6, B3-08–B3-25, T-3). Etap D.1: czyste funkcje. Polecenia pokazu (`show`,
// `show_page`, `present {kind: 'pokaz'}`, `show_end`) dochodzą w etapie D.2 w meeting.ts.

/**
 * Czy uczestnik widzi pokaz (T-3, B3-12): wyłącznie stan wspólny posiedzenia, czyli `presentation.kind === 'pokaz'`
 * i brak otwartego głosowania. Warunek nigdy nie zależy od tego, czy dana osoba już głosowała (`secretCastHere`, `myVote`,
 * `voted`), więc pokaz nie wiąże chwili zapytania z głosem. Używa go `MemberShow` w widoku uczestnika.
 */
export function showVisible(view: Pick<Meeting, 'presentation' | 'show' | 'status'> & {ballots: {status: 'otwarte' | 'zamkniete'}[]}): boolean {
  if (view.status !== 'trwa' || !view.show || view.presentation?.kind !== 'pokaz') return false;
  return !view.ballots.some(b => b.status === 'otwarte');
}
/** Pokaz można rozpocząć, przewinąć albo wznowić (G-24): posiedzenie trwa i nie ma otwartego głosowania (także próbnego). */
export function canShowNow(m: Pick<Meeting, 'status' | 'ballots'>): boolean {
  return m.status === 'trwa' && !m.ballots.some(b => b.status === 'otwarte');
}
/** Otwarte głosowanie, które wstrzymuje pokaz, albo `null`. */
export const blockingBallot = (m: Pick<Meeting, 'ballots'>) => m.ballots.find(b => b.status === 'otwarte') ?? null;
/** „strona” albo „slajd” (B3-21): przy serii obrazów slajd, przy PDF i materiale strona. */
export const pageNoun = (kind: DisplayKind | 'material') => kind === 'obrazy' ? 'slajd' : 'strona';
/** Plik do pokazania w trwającym pokazie. */
export const shownDisplay = (m: Pick<Meeting, 'show' | 'displays'>): DisplayRef | null => m.show?.source === 'plik' ? m.displays?.find(d => d.id === m.show!.id) ?? null : null;
/** Liczba stron pokazu: PDF ze sprawdzenia (może być nieznana), seria obrazów, obraz 1, materiał tekstowy bez liczby. */
export const pagesOf = (d: DisplayRef | null) => d ? d.pages : null;
/**
 * Opis pokazu do faktu w karcie „Obrady” i stopki ekranu sali: „plik „{tytuł}”, strona 4 z 12” (B3-08, B3-13). Bez
 * liczby stron „strona 4”.
 */
export function showLabel(m: Pick<Meeting, 'show' | 'displays' | 'materials'>): string | null {
  const s = m.show;
  if (!s) return null;
  if (s.source === 'material') {
    const mat = m.materials.find(x => x.id === s.id);
    return mat ? `materiał „${mat.title}”, strona ${s.page}` : null;
  }
  const d = shownDisplay(m);
  if (!d) return null;
  if (d.kind === 'wideo' || d.kind === 'obraz') return `plik „${d.title}”`;
  const noun = pageNoun(d.kind);
  return `plik „${d.title}”, ${noun} ${s.page}${d.pages ? ` z ${d.pages}` : ''}`;
}
const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
/** Fakty pliku do pokazania (B3-15, 6.5 wiersz 9): „PDF, 12 stron, 2,4 MB”, „obrazy, 8 slajdów, 3,1 MB”. */
export function displayFacts(d: DisplayRef): string {
  const size = sizeText(d.files.reduce((n, f) => n + f.size, 0));
  if (d.kind === 'pdf') return d.pages ? `PDF, ${d.pages} ${plural(d.pages, 'strona', 'strony', 'stron')}, ${size}` : `PDF, ${size}`;
  if (d.kind === 'obrazy') return `obrazy, ${d.files.length} ${plural(d.files.length, 'slajd', 'slajdy', 'slajdów')}, ${size}`;
  if (d.kind === 'obraz') return `obraz, ${size}`;
  return `wideo, ${size}`;
}
/**
 * Pliki do pokazania faktycznie pokazane w punkcie, w kolejności pierwszego pokazu (wpisy dziennika `tag: 'pokaz'`
 * z `displayId` i `itemId`): zdanie w protokole (B3-14), teczka (`11-pokazane/`) i materiał dla komunikacji (DB-32).
 */
export function shownInItem(m: Pick<Meeting, 'log' | 'displays'>, itemId: string | null): DisplayRef[] {
  const ids: string[] = [];
  for (const l of m.log) if (l.tag === 'pokaz' && l.displayId && l.itemId === itemId && !ids.includes(l.displayId)) ids.push(l.displayId);
  return ids.map(id => m.displays?.find(d => d.id === id)).filter((d): d is DisplayRef => !!d);
}
/** Wszystkie pliki pokazane na posiedzeniu (teczka `11-pokazane/`). */
export function shownDisplays(m: Pick<Meeting, 'log' | 'displays'>): DisplayRef[] {
  const ids = [...new Set(m.log.filter(l => l.tag === 'pokaz' && l.displayId).map(l => l.displayId!))];
  return ids.map(id => m.displays?.find(d => d.id === id)).filter((d): d is DisplayRef => !!d);
}
/** Opis pliku w zdaniu protokołu (B3-14, 6.12): „„tytuł” (PDF, 12 stron)”, „(obrazy, 8)”, „(obraz)”, „(wideo)”. */
export function shownFileText(d: DisplayRef): string {
  const title = `„${d.title.replace(/„/g, '»').replace(/”/g, '«')}”`;
  if (d.kind === 'pdf') return d.pages ? `${title} (PDF, ${d.pages} ${plural(d.pages, 'strona', 'strony', 'stron')})` : `${title} (PDF)`;
  if (d.kind === 'obrazy') return `${title} (obrazy, ${d.files.length})`;
  return d.kind === 'obraz' ? `${title} (obraz)` : `${title} (wideo)`;
}
