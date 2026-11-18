import type {AgendaItem, ItemKind} from './types.ts';

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
  return {id, parentId, title: cleanTitle(title), kind, status: 'oczekuje', materialIds: [], note: '', presenter: ''};
}

// Końcowa kropka znika, chyba że kończy skrót (np. „2026 r.”, „ust.”, „pkt.”).
export function cleanTitle(title: string) {
  const t = title.replace(/\s+/g, ' ').trim();
  return (/(?:^|\s)(?:r|ust|pkt|nr|ul|tzw|itp|itd|godz|poz|m\.in)\.$/i.test(t) ? t : t.replace(/[.;]$/, '')).slice(0, 400);
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
export function parseAgendaText(text: string) {
  const warnings: string[] = [];
  let body = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  body = body.replace(/^---\n[\s\S]*?\n---\n/, '');
  const items: {title: string; kind: ItemKind; parent: number | null}[] = [];
  let lastTop = -1;
  for (const raw of body.split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indented = /^(\t| {2,})/.test(raw);
    const line = raw.trim();
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
    item.kind = guessKind(item.title, item.parent === null);
  }
  if (!items.length) warnings.push('Nie znaleziono punktów. Każdy punkt główny zacznij od numeru, np. „1. Otwarcie posiedzenia”.');
  else if (!items.some(i => i.kind === 'porzadek')) {
    const at = items.findIndex(i => i.kind === 'otwarcie') + 1;
    items.splice(at, 0, {title: 'Przyjęcie porządku obrad', kind: 'porzadek', parent: null});
    for (const item of items) if (item.parent !== null && item.parent >= at) item.parent++;
    warnings.push('Dodano punkt „Przyjęcie porządku obrad”. Dalsze sprawy można procedować dopiero po przyjęciu porządku.');
  }
  return {items, warnings};
}
