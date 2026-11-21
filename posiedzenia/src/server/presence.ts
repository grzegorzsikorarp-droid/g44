// Dodatek D-9 (SPEC-4 5.7, B2-W14, DB-36, T-5): „Teraz oglądają” w pamięci procesu, bez zapisu do bazy i bez historii.
// Mapa: posiedzenie, w niej konto i {at, where}. Wpis wygasa po `ttlMs` (serwer 20 s; wersja próbna 2 minuty, żeby po
// „Zmień osobę” widać było osobę wybraną poprzednio). Zapis tylko przy odświeżeniu posiedzenia w przygotowaniu, przy
// preferencji `showPresence` (sprawdza `presenceAllowed` z src/shared/workspace.ts). `clear` woła polecenie otwarcia,
// więc od otwarcia mapa posiedzenia jest pusta i nie rośnie. Moduł bez zależności od Node (używa go też wersja próbna).

export interface PresenceEntry { accountId: string; where: string | null }

export class Presence {
  private map = new Map<string, Map<string, {at: number; where: string | null}>>();
  private ttlMs: number;
  constructor(ttlMs = 20000) { this.ttlMs = ttlMs; }

  touch(meetingId: string, accountId: string, where: string | null, now: number) {
    let room = this.map.get(meetingId);
    if (!room) { room = new Map(); this.map.set(meetingId, room); }
    room.set(accountId, {at: now, where});
  }
  /** Obecni (bez wygasłych), bez osoby oglądającej, w stałej kolejności. */
  list(meetingId: string, now: number, except?: string): PresenceEntry[] {
    const room = this.map.get(meetingId);
    if (!room) return [];
    for (const [id, e] of room) if (now - e.at > this.ttlMs) room.delete(id);
    if (!room.size) this.map.delete(meetingId);
    return [...room].filter(([id]) => id !== except).map(([accountId, e]) => ({accountId, where: e.where})).sort((a, b) => a.accountId.localeCompare(b.accountId));
  }
  /**
   * Skrót listy obecnych poza osobą oglądającą, z miejscem edycji, do ETag (2.4). Zmienia się tylko przy wejściu, wyjściu
   * albo zmianie miejsca innej osoby, więc w ciszy serwer odpowiada 304.
   */
  digest(meetingId: string, now: number, except: string): string {
    const text = this.list(meetingId, now, except).map(e => `${e.accountId}:${e.where ?? ''}`).join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return text ? h.toString(36) : '0';
  }
  clear(meetingId: string) { this.map.delete(meetingId); }
  /** Liczba wpisów posiedzenia (do testów T-5). */
  size(meetingId: string) { return this.map.get(meetingId)?.size ?? 0; }
}
