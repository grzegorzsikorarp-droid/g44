# Identyfikacja OIPiP w Słupsku. Zasady dla Claude Code

Ta aplikacja należy do Okręgowej Izby Pielęgniarek i Położnych w Słupsku i ma wyglądać i brzmieć jak jej materiały. Pliki identyfikacji leżą w folderze z tym plikiem (w repozytorium `brand/`).

## Zanim zaczniesz pracę nad interfejsem

- Przeczytaj `brand/IDENTYFIKACJA.md` (zasady wizualne) i `brand/JEZYK.md` (teksty).
- Podłącz style w kolejności `brand/fonts/fonts.css`, `brand/tokens/tokens.css`, a potem `brand/components/oipip.css`, jeśli używasz gotowych komponentów. Na `<body>` ustaw klasę `oi-root`.
- Opis i kod gotowych elementów (klasy `oi-*`) są w `brand/components/KOMPONENTY.md`, a podgląd w `brand/podglad.html`. Zanim napiszesz nowy komponent, sprawdź, czy go tam nie ma.
- Przy Tailwind CSS podłącz preset albo motyw z `brand/tokens/` tak, jak opisuje `brand/README.md`.

## Twarde zasady

1. Kolory tylko przez zmienne z `tokens.css` (`var(--czerwien)`, `var(--tekst)`, `var(--powierzchnia)` …) albo klasy z presetu Tailwind. Żadnych wartości hex wpisanych w komponentach.
2. Krój tylko Titillium Web z `brand/fonts`. Tytuły i nagłówki sekcji cienką kursywą (300), fraza kluczowa pogrubiona (700). Etykiety pogrubioną kursywą wersalikami z rozstrzeleniem 0,08–0,12 em.
3. Zero zaokrągleń (`border-radius: 0`). Skos 13° (`var(--kat-skosu)`) dla etykiet, przycisków `oi-btn`, znaczników, znaczków i paneli, tekst w środku pochylony odwrotnie (`var(--kat-odwrotny)`). Przyciski wyboru `oi-opt` stoją prosto.
4. Bez strzałek, kółek, odznak, emoji i gradientów. Jedyny cień rzucany to `var(--cien-karty)` na karcie po najechaniu. Ikony tylko funkcyjne, liniowe, w `currentColor`, obok napisu.
5. Znak Izby (`brand/logo/znak-oipip-slupsk.svg`) zawsze na białym tle i w oryginalnych kolorach, z wolnym polem co najmniej ¼ wysokości znaku. W ciemnym motywie na białej karcie (`oi-nameplate`).
6. Interfejs po polsku. Przy pierwszym użyciu pełna nazwa „Okręgowa Izba Pielęgniarek i Położnych w Słupsku”, dalej „Izba”. Organ zawsze pełną nazwą „Okręgowa Rada Pielęgniarek i Położnych w Słupsku”, nigdy samo „Rada”. Zawody wyliczaj w mianowniku („pielęgniarki, pielęgniarze, położne i położni”).
7. Cudzysłów „…”, daty „17 listopada 2026 r.” albo „17.11.2026”, godziny „11:00”, przedziały z półpauzą („11:00–14:00”), które nie łamią się między wierszami (`oi-nowrap`). Twarda spacja po jednoliterowych spójnikach i przyimkach. Etykieta pola w osobnym wierszu, bez dwukropka. Pytanie w nagłówku kończy się pytajnikiem.
8. Dostępność WCAG 2.1 AA. Pary kolorów tekstu i tła bierz z opisów tokenów w `brand/tokens/tokens.json`. Fokus widoczny (`var(--fokus)`, 3 px, odstęp 3 px). Stan nigdy nie wynika z samego koloru. Pole z błędem ma `aria-invalid="true"` i komunikat połączony przez `aria-describedby`.
9. Formularz Izby (wniosek, oświadczenie) odwzoruj 1:1, z kolejnością, numeracją, nagłówkami i brzmieniem jak w dokumencie. Zbieraj tylko potrzebne dane.
10. Domyślnie aplikacja jest jasna. Motyw ciemny (`data-theme="ciemny"`) to rozszerzenie, włączaj go tylko na życzenie.
11. Plików wygenerowanych w `brand/tokens/` nie zmieniaj ręcznie. Zmiana tokenu idzie do `brand/tokens/tokens.json`, a potem uruchom `node brand/tokens/generuj.mjs`.

## Gdy czegoś brakuje

Nowy element buduj z istniejących tokenów i wzorów, czyli z białej karty z obrysem `--linia`, paska 6 px z lewej strony, skośnego czerwonego znacznika i etykiety wersalikami. Nie dodawaj nowych kolorów, krojów ani zaokrągleń. Gdy zasada nie pasuje do sytuacji, zapytaj, zamiast zgadywać.
