/**
 * REJESTR EKRANÓW — źródło prawdy dla mapy z sekcji 5 briefu.
 * Narzędzie narzedzia/eksport-ekranow.mjs czyta ten plik i porównuje z listą z briefu.
 *
 * Stan po zmianie 1.2: 66 ekranów (E7 to nowa grupa, E2.8 i E5.3a/E5.3b są nowe).
 * W wydaniu 1.1 brief nosił tytuł „Mapa ekranów (48)", a wyliczenia w grupach sumowały
 * się do 58 — patrz ROZBIEZNOSCI.md, wpis 2. Zmiana 1.2 przelicza mapę od nowa.
 *
 * belka: czy widoczna jest dolna belka nawigacji.
 *   Ukryta w kreatorze, w sprawdzaczu po rozpoczęciu pytań i w ścieżkach Pomocy.
 * krzyzyk: 'brak' | 'z_potwierdzeniem' (kreator, sprawdzacz) | 'bez_pytania' (Pomoc).
 */

export interface WpisRejestru {
  id: string
  nazwa: string
  grupa: 'E0' | 'E1' | 'E2' | 'E3' | 'E4' | 'E5' | 'E6' | 'E7'
  belka: boolean
  krzyzyk: 'brak' | 'z_potwierdzeniem' | 'bez_pytania'
}

export const EKRANY: WpisRejestru[] = [
  // E0 — wejście i konfiguracja (23)
  { id: 'E0.1', nazwa: 'Powitanie', grupa: 'E0', belka: false, krzyzyk: 'brak' },
  { id: 'E0.2', nazwa: 'Pytanie 1 — praca przy monitorze', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.3', nazwa: 'Pytanie 2 — dźwiganie i przemieszczanie ludzi', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.4', nazwa: 'Pytanie 3 — praca na dworze', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.5', nazwa: 'Pytanie 4 — prowadzenie pojazdu', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.6', nazwa: 'Pytanie 5 — kontakt z ludźmi z zewnątrz', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.7', nazwa: 'Pytanie 6 — praca głosem', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.8', nazwa: 'Pytanie 7 — chemia i pyły', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.9', nazwa: 'Pytanie 8 — czynniki zakaźne', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.10', nazwa: 'Pytanie 9 — hałas i drgania', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.11', nazwa: 'Pytanie 10 — gorąco i zimno', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.12', nazwa: 'Pytanie 11 — maszyny, wysokość, ostre narzędzia', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.13', nazwa: 'Pytanie 12 — własna odzież i pranie', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.14', nazwa: 'Pytanie 13 — praca w pojedynkę', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.15', nazwa: 'Stałe godziny czy zmiany', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.16', nazwa: 'Szablony zmian', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.17', nazwa: 'Kalendarz grafiku', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.18', nazwa: 'Umowa', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.19', nazwa: 'Przepisy szczególne', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.20', nazwa: 'Rok urodzenia', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.21', nazwa: 'Orzeczenie o niepełnosprawności', grupa: 'E0', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E0.22', nazwa: 'Wynik konfiguracji', grupa: 'E0', belka: false, krzyzyk: 'brak' },
  { id: 'E0.23', nazwa: 'Nazwa i ikona profilu', grupa: 'E0', belka: false, krzyzyk: 'brak' },

  // E1 — Co mi przysługuje (4)
  { id: 'E1.1', nazwa: 'Co mi przysługuje — ekran główny', grupa: 'E1', belka: true, krzyzyk: 'brak' },
  { id: 'E1.2', nazwa: 'Karta uprawnienia', grupa: 'E1', belka: true, krzyzyk: 'brak' },
  { id: 'E1.3', nazwa: 'Podgląd karty uprawnień PDF', grupa: 'E1', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E1.4', nazwa: 'Moje terminy', grupa: 'E1', belka: true, krzyzyk: 'brak' },

  // E2 — Mam sprawę (8 po zmianie 1.2: doszły E2.4 i E2.8)
  { id: 'E2.1', nazwa: 'Lista sytuacji', grupa: 'E2', belka: true, krzyzyk: 'brak' },
  { id: 'E2.2', nazwa: 'Pytania sprawdzacza', grupa: 'E2', belka: false, krzyzyk: 'z_potwierdzeniem' },
  { id: 'E2.3', nazwa: 'Karta wyniku', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E2.4', nazwa: 'Wynik pośredni', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E2.5', nazwa: 'Podgląd wniosku PDF', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E2.6', nazwa: 'Skrypt rozmowy', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E2.7', nazwa: 'Przypomnienie', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E2.8', nazwa: 'Porównanie: zlecenie a umowa o pracę', grupa: 'E2', belka: false, krzyzyk: 'bez_pytania' },

  // E3 — Aktualności (3)
  { id: 'E3.1', nazwa: 'Strumień aktualności', grupa: 'E3', belka: true, krzyzyk: 'brak' },
  { id: 'E3.2', nazwa: 'Wpis', grupa: 'E3', belka: true, krzyzyk: 'brak' },
  { id: 'E3.3', nazwa: 'Archiwum', grupa: 'E3', belka: true, krzyzyk: 'brak' },

  // E4 — Pomoc (13)
  { id: 'E4.1', nazwa: 'Pomoc — wejście', grupa: 'E4', belka: true, krzyzyk: 'brak' },
  { id: 'E4.2', nazwa: 'Wybór sytuacji', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.3', nazwa: 'Krok ścieżki', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.4', nazwa: 'Rozgałęzienie', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.5', nazwa: 'Zamknięcie ścieżki', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.6', nazwa: 'Karta praw po zdarzeniu', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.7', nazwa: 'Dziennik zdarzeń — lista', grupa: 'E4', belka: true, krzyzyk: 'brak' },
  { id: 'E4.8', nazwa: 'Wpis do dziennika', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.9', nazwa: 'Notatnik prawie-wypadków', grupa: 'E4', belka: true, krzyzyk: 'brak' },
  { id: 'E4.10', nazwa: 'Ekran kryzysowy', grupa: 'E4', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E4.11', nazwa: 'Biblioteka', grupa: 'E4', belka: true, krzyzyk: 'brak' },
  { id: 'E4.12', nazwa: 'Materiał', grupa: 'E4', belka: true, krzyzyk: 'brak' },
  { id: 'E4.13', nazwa: 'Gdzie szukać pomocy', grupa: 'E4', belka: true, krzyzyk: 'brak' },

  // E5 — Ustawienia (7)
  { id: 'E5.1', nazwa: 'Ustawienia — menu', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.2', nazwa: 'Mój profil', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.3a', nazwa: 'Mój grafik — stałe godziny', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.3b', nazwa: 'Mój grafik — zmiany', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.4', nazwa: 'Moje budziki', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.5', nazwa: 'Pobrane materiały', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.6', nazwa: 'O aplikacji', grupa: 'E5', belka: true, krzyzyk: 'brak' },
  { id: 'E5.7', nazwa: 'Zgłoś uwagę', grupa: 'E5', belka: true, krzyzyk: 'brak' },

  // E6 — Sprawdzian wiedzy (2)
  { id: 'E6.1', nazwa: 'Pytanie sprawdzianu', grupa: 'E6', belka: true, krzyzyk: 'brak' },
  { id: 'E6.2', nazwa: 'Wynik sprawdzianu', grupa: 'E6', belka: true, krzyzyk: 'brak' },

  // E7 — Ewidencja czasu pracy (5; nowa grupa ze zmiany 1.2)
  { id: 'E7.1', nazwa: 'Mój czas — dziś', grupa: 'E7', belka: true, krzyzyk: 'brak' },
  { id: 'E7.2', nazwa: 'Wpis ręczny i edycja', grupa: 'E7', belka: false, krzyzyk: 'bez_pytania' },
  { id: 'E7.3', nazwa: 'Tydzień i miesiąc', grupa: 'E7', belka: true, krzyzyk: 'brak' },
  { id: 'E7.4', nazwa: 'Sygnały', grupa: 'E7', belka: true, krzyzyk: 'brak' },
  { id: 'E7.5', nazwa: 'Eksport ewidencji', grupa: 'E7', belka: false, krzyzyk: 'bez_pytania' },

  // Ekran roboczy poza mapą z briefu — wymagany przez B9 (licznik luk).
  { id: 'DEV', nazwa: 'Ekran deweloperski — licznik luk i data symulowana', grupa: 'E5', belka: false, krzyzyk: 'bez_pytania' },
]

export function wpisEkranu(id: string): WpisRejestru | undefined {
  return EKRANY.find((e) => e.id === id)
}
