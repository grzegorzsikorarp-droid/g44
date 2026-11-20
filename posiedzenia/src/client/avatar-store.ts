// Pamięć zdjęć profilowych w przeglądarce (SPEC-4 T-4, B3-39). Czysty moduł bez JSX i bez globalnych zależności:
// `fetch` i `createObjectURL` są wstrzykiwane, więc test (tests/avatar-store.test.ts) sprawdza go w Node.
// - Zdjęcia z mapy sesji (`session.avatars`, tylko krąg z pytania 13) pobiera się raz po wczytaniu sesji.
// - Kolejne odczyty i ponowne wywołania `load` z tą samą mapą nie wysyłają żadnych zapytań.
// - Na zewnątrz wychodzą wyłącznie adresy `blob:`; `Avatar` (avatar.tsx) czyta tylko z tej pamięci.
// Nowe zdjęcie innej osoby widać po odświeżeniu strony, własne od razu (`setOwn` z pliku wysłanego na serwer).

/** Mapa zdjęć z sesji: klucz osoby (identyfikator osoby ze składu albo konta) i wersja zdjęcia (2.5). */
export type AvatarMap = Record<string, {v: number; screen?: boolean}>;
export interface AvatarDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
}
/** Adres zdjęcia na serwerze; wersja w adresie pozwala na pamięć podręczną przeglądarki (B3-34). */
export const avatarPath = (key: string, v: number) => `/api/avatars/${encodeURIComponent(key)}?v=${v}`;

export class AvatarStore {
  private deps: AvatarDeps;
  private urls = new Map<string, {v: number; url: string}>();
  private loaded: string | null = null;
  private pending: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  constructor(deps: AvatarDeps) { this.deps = deps; }

  /**
   * Pobiera raz zdjęcia z mapy sesji. `session` to znacznik sesji (np. identyfikator konta): ta sama sesja i ta sama mapa
   * nie pobierają niczego drugi raz. `null` (osoba spoza kręgu) czyści pamięć i niczego nie pobiera.
   */
  load(map: AvatarMap | null | undefined, session: string): Promise<void> {
    const sign = `${session}|${JSON.stringify(map ?? null)}`;
    if (sign === this.loaded) return this.pending ?? Promise.resolve();
    this.loaded = sign;
    const keep = new Set(Object.keys(map ?? {}));
    for (const [key, x] of this.urls) if (!keep.has(key) || map![key].v !== x.v) this.drop(key);
    const todo = Object.entries(map ?? {}).filter(([key, x]) => this.urls.get(key)?.v !== x.v);
    this.pending = Promise.all(todo.map(async ([key, x]) => {
      try {
        const res = await this.deps.fetch(avatarPath(key, x.v), {cache: 'force-cache', credentials: 'same-origin'});
        if (!res.ok) return;
        this.put(key, x.v, await res.blob());
      } catch { /* bez zdjęcia: kwadrat z inicjałami */ }
    })).then(() => { this.pending = null; this.emit(); });
    return this.pending;
  }
  /** Adres `blob:` zdjęcia albo null (wtedy kwadrat z inicjałami). Odczyt nigdy nie wysyła zapytania. */
  url(key: string | null | undefined): string | null {
    const x = key ? this.urls.get(key) : undefined;
    return x && x.url.startsWith('blob:') ? x.url : null;
  }
  /** Własne zdjęcie po zapisie: plik, który właśnie poszedł na serwer, bez ponownego pobrania. */
  setOwn(key: string, v: number, blob: Blob) { this.put(key, v, blob); this.emit(); }
  /** Usunięcie zdjęcia z pamięci (własne usunięte albo zdjęcie poza mapą). */
  remove(key: string) { this.drop(key); this.emit(); }
  /** Wylogowanie albo zmiana osoby: pamięć pusta, następna sesja pobiera od nowa. */
  clear() { for (const key of [...this.urls.keys()]) this.drop(key); this.loaded = null; this.emit(); }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  private put(key: string, v: number, blob: Blob) {
    this.drop(key);
    const url = this.deps.createObjectURL(blob);
    if (url.startsWith('blob:')) this.urls.set(key, {v, url});
  }
  private drop(key: string) {
    const x = this.urls.get(key);
    if (!x) return;
    this.urls.delete(key);
    this.deps.revokeObjectURL?.(x.url);
  }
  private emit() { for (const l of this.listeners) l(); }
}
