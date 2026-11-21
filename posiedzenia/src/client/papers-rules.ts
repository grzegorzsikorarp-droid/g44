// Czyste reguły ekranów zespołu F (SPEC-4 6.8, 6.9, 8.1): filtry katalogu w adresie, stan udostępnienia materiału dla
// komunikacji słowami, lista przycisków formatów z pełnymi nazwami dostępnymi, okres zestawienia i dokumenty dołączone.
// Moduł bez JSX i bez przeglądarki, więc testy `tests/f-*.test.ts` importują go wprost (wymazywanie typów w Node).
import {dateDots, isoDayOf, timeOf} from '../shared/text.ts';
import type {FiledDocument, PaperFormat} from '../shared/types.ts';
import type {PaperEntry} from '../shared/papers.ts';

// Katalog odbytych posiedzeń (6.9, B1-25): filtry w adresie `#odbyte?rok=2026&rodzaj=posiedzenia`.

export type CatalogKind = 'wszystkie' | 'posiedzenia' | 'glosowania';
export type CatalogState = 'wszystkie' | 'projekt' | 'sporzadzony' | 'przyjety' | 'notatka';
export interface CatalogQuery { rok: string; kadencja: string; rodzaj: CatalogKind; stan: CatalogState; brak: boolean; q: string }
const KINDS: CatalogKind[] = ['wszystkie', 'posiedzenia', 'glosowania'];
const STATES: CatalogState[] = ['wszystkie', 'projekt', 'sporzadzony', 'przyjety', 'notatka'];
export const CATALOG_KINDS: [CatalogKind, string][] = [['wszystkie', 'Wszystkie'], ['posiedzenia', 'Posiedzenia'], ['glosowania', 'Głosowania między posiedzeniami']];
export const CATALOG_STATES: [CatalogState, string][] = [['wszystkie', 'Wszystkie'], ['projekt', 'Projekt'], ['sporzadzony', 'Sporządzony'], ['przyjety', 'Przyjęty'], ['notatka', 'Notatka']];

/** Filtry z adresu; bez roku bieżący rok (B1-25), nieznane wartości dają wartość domyślną. */
export function catalogQuery(query: URLSearchParams, year: string): CatalogQuery {
  const rok = /^\d{4}$/.test(query.get('rok') ?? '') ? query.get('rok')! : year;
  const rodzaj = KINDS.find(k => k === query.get('rodzaj')) ?? 'wszystkie';
  const stan = STATES.find(k => k === query.get('stan')) ?? 'wszystkie';
  return {rok, kadencja: (query.get('kadencja') ?? '').slice(0, 80), rodzaj, stan, brak: query.get('brak') === '1', q: (query.get('q') ?? '').slice(0, 100)};
}
/** Parametry zapytania `GET /api/katalog` i adresu strony: wartości domyślne się pomija (poza rokiem). */
export function catalogParams(f: CatalogQuery): Record<string, string> {
  const out: Record<string, string> = {rok: f.rok};
  if (f.kadencja) out.kadencja = f.kadencja;
  if (f.rodzaj !== 'wszystkie') out.rodzaj = f.rodzaj;
  if (f.stan !== 'wszystkie') out.stan = f.stan;
  if (f.brak) out.brak = '1';
  if (f.q.trim()) out.q = f.q.trim();
  return out;
}
/** Adres strony katalogu z filtrami. */
export function catalogHref(f: CatalogQuery): string {
  const q = new URLSearchParams(catalogParams(f)).toString();
  return `#odbyte?${q}`;
}
/** Czy w adresie są filtry inne niż rok (wtedy pusta lista ma zdanie o filtrach i „Wyczyść filtry”). */
export function filtersActive(f: CatalogQuery): boolean {
  return !!f.kadencja || f.rodzaj !== 'wszystkie' || f.stan !== 'wszystkie' || f.brak || !!f.q.trim();
}

// Materiał dla komunikacji (6.8, 6.9, 4.4, DB-42).

export type Release = 'brak' | 'udostepniony' | 'zmieniony';
const dayTime = (at: number) => `${dateDots(isoDayOf(at))}, godz. ${timeOf(at)}`;
/** Stan udostępnienia słowem w karcie „Dokumenty posiedzenia” (6.8). */
export function releaseText(release: Release, releasedAt?: number | null): string {
  if (release === 'udostepniony') return releasedAt ? `Udostępniono ${dayTime(releasedAt)}.` : 'Udostępniono.';
  if (release === 'zmieniony') return 'Zmienił się po udostępnieniu. Konto komunikacji go nie pobierze, dopóki nie udostępnisz go ponownie.';
  return 'Czeka na udostępnienie.';
}
/**
 * Stan materiału w wierszu katalogu u konta „Komunikacja” (4.4). Wiersz katalogu z serwera nie podaje chwili udostępnienia,
 * więc bez niej zdanie mówi tylko, że plik można pobrać.
 */
export function commsRowText(release: Release, releasedAt?: number | null): string {
  if (release === 'udostepniony') return releasedAt ? `Udostępniono ${dayTime(releasedAt)}.` : 'Materiał dla komunikacji jest udostępniony i można go pobrać.';
  if (release === 'zmieniony') return 'Materiał zmienił się po udostępnieniu i czeka na ponowne udostępnienie.';
  return 'Materiał dla komunikacji czeka na udostępnienie.';
}
/** Przycisk udostępnienia (DB-42): „Udostępnij komunikacji”, po zmianie „Udostępnij ponownie”, po udostępnieniu brak. */
export function releaseButton(release: Release | undefined): string | null {
  if (release === 'udostepniony') return null;
  return release === 'zmieniony' ? 'Udostępnij ponownie' : 'Udostępnij komunikacji';
}
/** „Zmienił się {data}, godz. {g}.” (`commsChangedAt`). */
export const changedText = (at: number) => `Zmienił się ${dayTime(at)}.`;

// Przyciski formatów (6.0, B1-11): napis formatu i pełna nazwa dostępna.

export interface FormatButton { format: PaperFormat; label: string; name: string; paperId: string }
const FORMAT_LABEL: Record<PaperFormat, string> = {html: 'Drukuj', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
const FORMAT_NAME: Record<PaperFormat, string> = {html: '', docx: 'Word', md: 'Markdown', csv: 'CSV', zip: 'ZIP'};
/** Przyciski formatów dokumentu z nazwą dostępną „Drukuj {biernik}” albo „Pobierz {biernik} w formacie {format}”. */
export function formatButtons(p: Pick<PaperEntry, 'id' | 'formats'>, accusative: string): FormatButton[] {
  return p.formats.filter(f => f !== 'zip').map(f => ({format: f, paperId: p.id, label: FORMAT_LABEL[f],
    name: f === 'html' ? `Drukuj ${accusative}` : `Pobierz ${accusative} w formacie ${FORMAT_NAME[f]}`}));
}
/**
 * Wiersze karty „Dokumenty posiedzenia” (6.8): lista obecności do podpisu nie ma osobnego wiersza, tylko odnośnik
 * „Wersja do podpisu” w wierszu listy obecności; teczka i materiał dla komunikacji mają własne części karty.
 */
export function paperRows(papers: PaperEntry[]): {paper: PaperEntry; signature: PaperEntry | null}[] {
  const sign = papers.find(p => p.id === 'obecnosc-podpis') ?? null;
  return papers.filter(p => p.id !== 'obecnosc-podpis' && p.id !== 'teczka' && p.id !== 'komunikacja')
    .map(p => ({paper: p, signature: p.id === 'obecnosc' ? sign : null}));
}
/** Adres dokumentu (`html` bez parametru). */
export const paperPath = (meetingId: string, paperId: string, format: PaperFormat) =>
  `/api/meetings/${encodeURIComponent(meetingId)}/dokumenty/${encodeURIComponent(paperId)}${format === 'html' ? '' : `?format=${format}`}`;

// Dokumenty dołączone po posiedzeniu (6.8): bieżące i zastąpione.

export const FILED_LABELS: Record<FiledDocument['kind'], string> = {
  protokol_sporzadzony: 'Protokół sporządzony', protokol_podpisany: 'Protokół podpisany (skan)', zawiadomienie: 'Zawiadomienie',
  akt_podpisany: 'Akt podpisany (skan)', inny: 'Inny dokument',
};
export function filedGroups(filed: FiledDocument[] | undefined): {current: FiledDocument[]; replaced: FiledDocument[]} {
  const list = filed ?? [];
  return {current: list.filter(f => !f.replacedAt), replaced: list.filter(f => !!f.replacedAt)};
}
/** „Protokół sporządzony „protokol.docx”, 21.11.2026, Anna Przykładowa.” (wiersz pliku po posiedzeniu). */
export function filedLine(f: FiledDocument): string {
  const title = f.kind === 'inny' && f.title ? f.title : FILED_LABELS[f.kind];
  return `${title} „${f.fileName}”, ${dateDots(isoDayOf(f.at))}, ${f.by}.`;
}
/** Numer głosowania z wiersza „Do sprawdzenia” o protokole („Głosowanie nr 4 nie wskazuje…”), inaczej null. */
export function checkBallotNumber(text: string): number | null {
  const n = /^Głosowanie nr (\d+) (nie wskazuje|wskazuje protokół)/.exec(text)?.[1];
  return n ? Number(n) : null;
}

// Zestawienie za okres (6.9, B1-30).

export type ReportPreset = 'rok' | 'kadencja' | '12' | 'inny';
/** Ten sam dzień rok wcześniej, a gdy go nie ma (29 lutego), ostatni dzień miesiąca. */
const yearBefore = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate();
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const nextDay = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };
/** Okres przycisku: „Rok {rrrr}” (1.01–31.12), „Ostatnie 12 miesięcy” (od dnia po roku temu do dziś), kadencja z granic. */
export function presetRange(preset: Exclude<ReportPreset, 'inny'>, today: string, term?: {from: string; to: string} | null): {from: string; to: string} | null {
  if (preset === 'rok') return {from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31`};
  if (preset === '12') return {from: nextDay(yearBefore(today)), to: today};
  return term ?? null;
}
/** Który przycisk okresu jest wybrany dla okresu z adresu. */
export function presetOf(range: {from: string; to: string}, today: string, term?: {from: string; to: string} | null): ReportPreset {
  for (const p of ['rok', '12', 'kadencja'] as const) {
    const r = presetRange(p, today, term);
    if (r && r.from === range.from && r.to === range.to) return p;
  }
  return 'inny';
}
