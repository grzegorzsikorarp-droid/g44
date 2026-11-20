import type {AgendaItem, ItemKind, Meeting} from './types.ts';
import {agendaBasis, type LegalProfile} from './law.ts';

// Uproszczony porządek obrad Prezydium — decyzja z 18.11.2026: § 9 ust. 2 Regulaminu Rady
// stosowany „odpowiednio” (§ 14 ust. 4), bez wyboru osób liczących głosy i komisji mandatowej.
// Kworum stwierdza prowadzący na podstawie listy obecności.
export const presidiumTemplate: [string, ItemKind][] = [
  ['Otwarcie posiedzenia i stwierdzenie kworum', 'otwarcie'],
  ['Przyjęcie porządku obrad', 'porzadek'],
  ['Przyjęcie protokołu z poprzedniego posiedzenia', 'protokol'],
  ['Sprawy bieżące, w tym przyjęcie sprawozdań', 'sprawozdania'],
  ['Podjęcie uchwał', 'uchwaly'],
  ['Informacje bieżące i wolne wnioski', 'wolne_wnioski'],
  ['Zamknięcie posiedzenia', 'zamkniecie'],
];

export function newItem(id: string, title: string, kind: ItemKind, parentId: string | null = null): AgendaItem {
  return {id, parentId, title: cleanTitle(title), kind, status: 'oczekuje', materialIds: [], note: '', presenters: []};
}

// Końcowa kropka, średnik albo dwukropek znika, chyba że kropka kończy skrót (np. „2026 r.”, „ust.”, „pkt.”).
export function cleanTitle(title: string) {
  const t = title.replace(/\s+/g, ' ').trim();
  return (/(?:^|\s)(?:r|ust|pkt|nr|ul|tzw|itp|itd|godz|poz|m\.in)\.$/i.test(t) ? t : t.replace(/[.;:]$/, '')).slice(0, 400);
}

export function guessKind(title: string, topLevel: boolean): ItemKind {
  const t = title.toLowerCase();
  if (!topLevel) return 'sprawa';
  if (/otwarcie/.test(t)) return 'otwarcie';
  if (/porządk\w* obrad/.test(t) && /przyj|zatwierdz/.test(t)) return 'porzadek';
  if (/protok[oó]ł/.test(t) && /przyj|zatwierdz/.test(t)) return 'protokol';
  if (/zamknięcie/.test(t)) return 'zamkniecie';
  if (/wolne wnioski|informacje bieżące/.test(t)) return 'wolne_wnioski';
  if (/sprawozda|sprawy bieżące/.test(t)) return 'sprawozdania';
  if (/uchwał/.test(t)) return 'uchwaly';
  return 'sprawa';
}

// Wczytanie porządku z tekstu wklejonego z Worda albo z pliku TXT/Markdown.
// Punkty główne: numer przy lewym marginesie („1.”, „2)”). Podpunkty: wcięcie
// albo myślnik/punktor/„a)”/„4.1.”. Inne wiersze dopisują się do poprzedniego tytułu.
// Z `flat` (sprawy w głosowaniu między posiedzeniami) każdy wiersz z treścią, także z myślnikiem albo wcięciem,
// staje się pozycją główną, a punkt „Przyjęcie porządku obrad” nie jest dodawany.
export function parseAgendaText(text: string, options: {flat?: boolean} = {}) {
  const warnings: string[] = [];
  let body = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  body = body.replace(/^---\n[\s\S]*?\n---\n/, '');
  const items: {title: string; kind: ItemKind; parent: number | null}[] = [];
  let lastTop = -1;
  for (const raw of body.split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indented = /^(\t| {2,})/.test(raw);
    const line = raw.trim();
    if (options.flat) {
      const marker = line.match(/^(?:\d+(?:\.\d+)+\.?|\d+[.)]|[-–•*]|[a-zż]\))\s+(.+)$/i);
      items.push({title: marker ? marker[1] : line, kind: 'sprawa', parent: null});
      continue;
    }
    const sub = line.match(/^(?:[-–•*]|[a-zż]\)|\d+\.\d+\.?)\s+(.+)$/i);
    const top = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (top && !indented) {
      items.push({title: top[2], kind: 'sprawa', parent: null});
      lastTop = items.length - 1;
    } else if ((sub || (top && indented)) && lastTop >= 0) {
      items.push({title: (sub ? sub[1] : top![2]), kind: 'sprawa', parent: lastTop});
    } else if (items.length) {
      items[items.length - 1].title += ' ' + line;
    } else {
      warnings.push(`Pominięto wiersz przed pierwszym punktem: „${line.slice(0, 60)}”.`);
    }
  }
  for (const item of items) {
    item.title = cleanTitle(item.title.replace(/\*\*/g, ''));
    item.kind = options.flat ? 'sprawa' : guessKind(item.title, item.parent === null);
  }
  if (!items.length) warnings.push('Nie znaleziono punktów. Każdy punkt główny zacznij od numeru, np. „1. Otwarcie posiedzenia”.');
  else if (!options.flat && !items.some(i => i.kind === 'porzadek')) {
    const at = items.findIndex(i => i.kind === 'otwarcie') + 1;
    items.splice(at, 0, {title: 'Przyjęcie porządku obrad', kind: 'porzadek', parent: null});
    for (const item of items) if (item.parent !== null && item.parent >= at) item.parent++;
    warnings.push('Dodano punkt „Przyjęcie porządku obrad”. Dalsze sprawy można rozpatrywać dopiero po przyjęciu porządku.');
  }
  return {items, warnings};
}

/** Nazwy rodzajów punktu do list wyboru, historii i komunikatów (wersja 3). */
export const itemKindLabel: Record<ItemKind, string> = {
  otwarcie: 'Otwarcie posiedzenia i stwierdzenie kworum', porzadek: 'Przyjęcie porządku obrad', protokol: 'Przyjęcie protokołu',
  sprawozdania: 'Sprawy bieżące i sprawozdania', uchwaly: 'Podjęcie uchwał', wolne_wnioski: 'Informacje bieżące i wolne wnioski',
  zamkniecie: 'Zamknięcie posiedzenia', sprawa: 'Sprawa',
};
/** Zwykła kolejność rodzajów w porządku obrad (§ 9 ust. 2), według której uzupełnia się brakujące punkty. */
const standardOrder: ItemKind[] = ['otwarcie', 'porzadek', 'protokol', 'sprawozdania', 'uchwaly', 'wolne_wnioski', 'zamkniecie'];

export interface AgendaProblem { kind: ItemKind; type: 'brak' | 'powtorzenie' | 'podpunkt' | 'pominiecie' }
/**
 * Niezmiennik porządku obrad (G-6, wersja 3): każdy rodzaj obowiązkowy występuje dokładnie raz jako punkt główny,
 * a każdy rodzaj wymieniony w regulaminie występuje albo jest w `m.skipped` z powodem. Dotyczy tylko posiedzeń.
 */
export function agendaProblems(law: LegalProfile, m: Pick<Meeting, 'kind' | 'agenda' | 'skipped'>): AgendaProblem[] {
  if (m.kind !== 'posiedzenie') return [];
  const out: AgendaProblem[] = [];
  for (const kind of law.agenda.mandatory) {
    const found = m.agenda.filter(i => i.kind === kind);
    if (!found.length) out.push({kind, type: 'brak'});
    else if (found.length > 1) out.push({kind, type: 'powtorzenie'});
    else if (found[0].parentId) out.push({kind, type: 'podpunkt'});
  }
  for (const kind of Object.keys(law.agenda.listed) as ItemKind[]) {
    if (law.agenda.mandatory.includes(kind)) continue;
    if (!m.agenda.some(i => i.kind === kind) && !(m.skipped ?? []).some(x => x.kind === kind && x.reason.trim())) out.push({kind, type: 'pominiecie'});
  }
  return out;
}

/**
 * Komunikat odmowy, gdy po poleceniu porządek łamie niezmiennik, a przed poleceniem go nie łamał w ten sposób
 * (dane ze starszych wersji z wadą nie blokują innych zmian). `before` podaje tytuł usuniętego punktu.
 */
export function validateAgenda(law: LegalProfile, m: Pick<Meeting, 'kind' | 'agenda' | 'skipped'>, before?: Pick<Meeting, 'kind' | 'agenda' | 'skipped'>): string | null {
  const old = before ? agendaProblems(law, before).map(p => `${p.kind}:${p.type}`) : [];
  const problem = agendaProblems(law, m).find(p => !old.includes(`${p.kind}:${p.type}`));
  if (!problem) return null;
  const title = before?.agenda.find(i => i.kind === problem.kind)?.title ?? itemKindLabel[problem.kind];
  const basis = agendaBasis(law, problem.kind) ?? law.agenda.listedBasis;
  if (problem.type === 'brak') return `Punktu „${title}” nie można usunąć. To punkt obowiązkowy (${basis}).`;
  if (problem.type === 'pominiecie') return `Podaj powód pominięcia punktu „${title}”. Trafi do protokołu (${basis}).`;
  if (problem.type === 'podpunkt') return `Punkt „${itemKindLabel[problem.kind]}” musi być punktem głównym porządku obrad.`;
  return `Punkt „${itemKindLabel[problem.kind]}” może wystąpić w porządku tylko raz.`;
}

/**
 * Uzupełnia porządek o brakujące punkty obowiązkowe i wymienione w regulaminie (bez pominiętych z powodem) na ich
 * zwykłych miejscach: otwarcie na początku, zamknięcie na końcu, pozostałe za ostatnim wcześniejszym rodzajem z § 9 ust. 2.
 * Zwraca dodane punkty. `titles` podaje tytuły z wzoru posiedzenia albo ze standardowego szablonu.
 */
export function completeAgenda(law: LegalProfile, m: Pick<Meeting, 'kind' | 'agenda' | 'skipped'>, newId: () => string, titles: Partial<Record<ItemKind, string>> = {}): AgendaItem[] {
  if (m.kind !== 'posiedzenie') return [];
  const added: AgendaItem[] = [];
  const wanted = standardOrder.filter(kind => law.agenda.mandatory.includes(kind) || (kind in law.agenda.listed && !(m.skipped ?? []).some(x => x.kind === kind)));
  for (const kind of wanted) {
    if (m.agenda.some(i => i.kind === kind)) continue;
    const title = titles[kind] ?? presidiumTemplate.find(([, k]) => k === kind)?.[0] ?? itemKindLabel[kind];
    const item = newItem(newId(), title, kind);
    let at: number;
    const rank = standardOrder.indexOf(kind);
    const top = m.agenda.filter(i => !i.parentId);
    const rankOf = (i: AgendaItem) => standardOrder.indexOf(i.kind);
    if (kind === 'otwarcie') at = 0;
    else if (kind === 'zamkniecie') at = m.agenda.length;
    else if (kind === 'porzadek' || kind === 'protokol') {
      // Przyjęcie porządku i protokołu stoją zaraz po wcześniejszym punkcie z § 9 ust. 2.
      const previous = [...top].reverse().find(i => rankOf(i) >= 0 && rankOf(i) < rank);
      at = previous ? m.agenda.indexOf(previous) + 1 : 0;
      while (at < m.agenda.length && m.agenda[at].parentId) at++;
    } else {
      // Sprawy bieżące, uchwały i wolne wnioski stoją przed następnym punktem z § 9 ust. 2 (zwykle przed zamknięciem).
      const following = top.find(i => rankOf(i) > rank);
      at = following ? m.agenda.indexOf(following) : m.agenda.length;
    }
    m.agenda.splice(at, 0, item);
    added.push(item);
  }
  return added;
}
