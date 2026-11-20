import {accountView, type Store} from '../src/server/store.ts';
import type {Actor, Meeting} from '../src/shared/types.ts';
import {personName} from '../src/shared/roster.ts';
import {organRoster} from '../src/shared/role.ts';

// Wzorce projektów protokołów sprzed wersji 4 (SPEC-4 DB-4, K4-8, etap D.1 pkt 1). Ten moduł wybiera cztery role
// i wyciąga tekst treści z wydruku i z pliku Word, tak samo przy zapisie wzorców (skrypt
// /home/user/przeglad/v4-D/skrypty/wzorce-v3.ts na kodzie wersji 3) i w teście `protokol-v4.test.ts` na kodzie wersji 4.

/** Chwila wygenerowania dokumentu we wzorcach (stopka „Projekt wygenerowany z zapisu aplikacji …”). */
export const WZORCE_NOW = Date.parse('2026-11-20T12:00:00Z');
/** Cztery role z DB-4: biuro, przewodniczący, osoba, która zamknęła obrady (przed zamknięciem osoba prowadząca), członek. */
export const ROLES = ['biuro', 'przewodniczacy', 'zamykajacy', 'czlonek'] as const;
export type MinutesRole = typeof ROLES[number];
/** Zestawy danych wzorcowych: kopie w `tests/fixtures/` (dane-wzor i dane-wzor-3). */
export const ZESTAWY = ['dane-wzor', 'dane-wzor-3'] as const;

export interface WzorzecWpis {
  meeting: string; status: Meeting['status']; kind: Meeting['kind']; title: string; role: MinutesRole;
  actor: {username: string; personId: string | null} | null;
  /** Odmowa wglądu w projekt protokołu (macierz 4.3 SPEC-3) albo brak osoby w tej roli. */
  refusal?: string;
  /** Pliki wzorca: dokładny tekst `minutesBody`, tekst treści wydruku i tekst treści pliku Word. */
  body?: string; druk?: string; word?: string;
}

/** Aktor z konta (tak jak sesja serwera). */
export function actorOf(store: Store, username: string): Actor {
  const row = store.userByName(username);
  if (!row) throw new Error(`Brak konta ${username}`);
  const account = accountView(row);
  return {account, personId: account.personId, name: account.personId ? personName(store.roster(), account.personId) : account.displayName};
}

/** Konto osoby ze składu (pierwsze według loginu). */
function usernameOf(store: Store, personId: string | null | undefined) {
  if (!personId) return null;
  return store.users().filter(u => u.person_id === personId && !u.disabled).map(u => u.username).sort()[0] ?? null;
}

/**
 * Osoby w czterech rolach dla posiedzenia: biuro (pierwsze konto biura według loginu), przewodniczący ze składu
 * posiedzenia, osoba, która zamknęła obrady (`chair.current`; przed zamknięciem osoba prowadząca, w przygotowaniu brak),
 * członek bez funkcji (pierwszy według kolejności składu).
 */
export function minutesActors(store: Store, m: Meeting): Record<MinutesRole, Actor | null> {
  const members = organRoster(store.roster(), m);
  const office = store.users().filter(u => u.kind === 'biuro' && !u.disabled).map(u => u.username).sort()[0] ?? null;
  const pick = (username: string | null) => username ? actorOf(store, username) : null;
  return {
    biuro: pick(office),
    przewodniczacy: pick(usernameOf(store, members.find(x => x.func === 'przewodniczacy')?.personId)),
    zamykajacy: pick(usernameOf(store, m.chair.current)),
    czlonek: pick(usernameOf(store, members.find(x => x.func === 'czlonek')?.personId)),
  };
}

const ENTITIES: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
/**
 * Tekst dokumentu HTML do porównania wzorców: bez skryptów i stylów, każdy znacznik jako odstęp, encje zamienione
 * na znaki, wszystkie białe znaki (także twarde spacje) ujednolicone do jednej spacji.
 */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => code[0] === '#'
      ? String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10))
      : ENTITIES[code.toLowerCase()] ?? all)
    .replace(/\s+/g, ' ')
    .trim();
}
/** Treść dokumentu bez opakowania strony: zawartość `<article class="minutes-view">`. */
export function articleHtml(page: string): string {
  const start = page.indexOf('<article class="minutes-view">');
  const end = page.lastIndexOf('</article>');
  if (start < 0 || end < start) throw new Error('Brak treści projektu protokołu w dokumencie.');
  return page.slice(start + '<article class="minutes-view">'.length, end);
}
