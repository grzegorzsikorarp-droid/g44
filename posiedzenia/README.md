# Posiedzenia OIPiP w Słupsku, etap 1 (Prezydium)

Aplikacja do prowadzenia posiedzeń Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku i do głosowań między posiedzeniami. Osoba prowadząca obrady pracuje na komputerze, a członkowie Prezydium na telefonach, w zwykłej przeglądarce, bez instalowania aplikacji.

Plan ma trzy etapy. **Etap 1** to Prezydium (ten kod), etap 2 Okręgowa Rada Pielęgniarek i Położnych w Słupsku (wybory prezydium, komisje), a etap 3 Okręgowy Zjazd.

Wymagania wynikają z wiążących dokumentów: Regulaminu Okręgowej Rady (uchwała nr 9 OZPiP z 22.03.2025), Regulaminu Okręgowego Zjazdu (uchwała nr 8 OZPiP z 22.03.2025) i Regulaminu wyborów do organów izb (uchwała nr 2 I Nadzwyczajnego KZPiP z 23.09.2024). Szczegóły i numery paragrafów: [`docs/ZRODLA.md`](docs/ZRODLA.md). Wcześniejsza aplikacja (wersja 1.0.0 z ChatGPT) była tylko punktem odniesienia.

## Co robi aplikacja

| Obszar | Działanie | Podstawa |
|---|---|---|
| Skład i konta | 7 członków Prezydium IX kadencji; każdy ma własne konto i hasło. Są też konta z głosem doradczym (bez prawa głosu), gości i biura. Logowanie wygasa po 12 godzinach bez korzystania z aplikacji i przedłuża się, dopóki ktoś z niej korzysta. | § 19 ust. 2, § 7 ust. 2–3 |
| Zwołanie | Termin, miejsce, tryb stacjonarny lub zdalny (z odnośnikiem do połączenia). Aplikacja ostrzega, gdy od zawiadomienia mija mniej niż 7 dni. Nieobowiązkowe dane do protokołu to numer protokołu, protokolant i osoba zwołująca. Posiedzenie można powielić, np. gdy spotkanie robocze nie miało kworum, a nowe posiedzenie ma ten sam porządek i materiały. | § 6 ust. 3, § 7 ust. 1 |
| Porządek obrad | Uproszczony szablon dla Prezydium (decyzja z 18.11.2026). Można go wczytać z tekstu skopiowanego z Worda. Przy przyjmowaniu porządku osoba prowadząca obrady układa projekt kafelkami (przeciąganie albo przyciski „Wyżej” i „Niżej”), a członkowie i ekran sali widzą zmiany od razu. Dalsze sprawy są dostępne dopiero po przyjęciu porządku w głosowaniu, a późniejsze zmiany wymagają osobnego głosowania. Rozpoczęcie punktu poza kolejnością, odroczenie i wycofanie punktu oraz zamknięcie posiedzenia z nierozpatrzonymi punktami wymagają powodu, który trafia do protokołu. Przy punkcie można wpisać do 6 osób, które go prowadzą albo referują, i określić, co jest w nim głosowane. | § 9 ust. 2, § 14 ust. 4 |
| Prowadzenie | Prowadzi przewodniczący lub wiceprzewodniczący. Przewodniczący wyznacza zastępcę, może przekazać prowadzenie i przejąć je po powrocie. | § 9 ust. 1, § 16 |
| Obecność i kworum | Na posiedzeniu stacjonarnym członek zgłasza obecność telefonem, a potwierdza ją osoba prowadząca obrady albo biuro, także wszystkie zgłoszenia naraz. Na posiedzeniu zdalnym członek potwierdza obecność sam. Obecność może też zapisać osoba prowadząca obrady lub biuro, a wejścia i wyjścia są zapisywane z godziną. Kworum to co najmniej 4 z 7. Bez kworum nie da się otworzyć głosowania. Gdy kworum nie stwierdzono, posiedzenie toczy się do końca jako spotkanie robocze bez głosowań (poza próbnym), a zamiast protokołu powstaje notatka. | § 8 ust. 2 |
| Głosowania | Domyślnie jawne. Imienne i tajne wymagają uchwalenia przez Prezydium tajności głosowania albo głosowania imiennego. Wniosek o to jest głosowany w aplikacji, która zapisuje, kto go zgłosił, a uchwalony tryb wiąże głosowanie w tej sprawie. Rozstrzyga zwykła większość, czyli więcej „za” niż „przeciw”. Głosowanie trwa określony czas, ma licznik i kończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Członkowie widzą wynik dopiero po jego ogłoszeniu przez osobę prowadzącą obrady i dopiero wtedy obrady idą dalej. Głosowanie próbne (jawne albo tajne, bez numeru i bez skutków) sprawdza, czy głosowanie działa na telefonach. | § 8 ust. 3, § 11 |
| Tajność | Ślepe podpisy RSA (opis niżej). Serwer wie, że głosowała uprawniona osoba, ale nie wie, jak głosowała. Głosowanie próbne tajne idzie tą samą drogą. | § 11 ust. 3 |
| Reasumpcja | Tylko dla głosowania jawnego, na tym samym posiedzeniu i tylko raz. Wniosek z uzasadnieniem musi poprzeć co najmniej 1/3 obecnych, a decyzję o reasumpcji podejmuje Prezydium. | § 12 |
| Między posiedzeniami | Głosowanie zdalne w wyznaczonym czasie (np. kilka godzin), z licznikiem i wspólnym kanałem wiadomości. Rozstrzygnięcie wymaga co najmniej 4 głosujących. Przewodniczący albo wiceprzewodniczący może przedłużyć albo skrócić termin (członkowie widzą uwagę i wiadomość w kanale), zakończyć głosowanie przed terminem z policzeniem głosów albo przerwać je z powodem bez rozstrzygnięcia. Wynik członkowie widzą po jego ogłoszeniu. | § 14 ust. 5 |
| Materiały i rodzaje dokumentów | Pliki DOCX, Markdown i TXT zamieniają się w lekki tekst do czytania na telefonie, a oryginał można pobrać. Plik z kilkoma uchwałami (np. PWZ) dzieli się na osobne dokumenty i podpunkty. Głosowanie dotyczy wersji utrwalonej przy jego otwarciu. Rodzaje dokumentów (uchwała, stanowisko, oświadczenie, apel i inne) z formułami wyniku, np. „Stanowisko przyjęte”, prowadzi administrator. Głosowanie zapamiętuje formułę z chwili otwarcia. | § 8 ust. 9 |
| Protokół | Projekt protokołu powstaje z zapisu obrad w układzie dokumentu organu. Ma rozdziały o zwołaniu i prowadzeniu obrad (z głosowaniem próbnym), liście obecności ze sposobem potwierdzenia, porządku ze zmianami projektu, przebiegu obrad z głosowaniami, powodami, osobami przy punktach i osobą zgłaszającą wniosek, podjętych uchwałach i załącznikach, a na końcu miejsca na podpisy. Nieogłoszony wynik jest w nim ukryty tak jak w aplikacji. Ze spotkania roboczego powstaje notatka, a z głosowania między posiedzeniami protokół ze zmianami terminu i sposobem zakończenia. Projekt można wydrukować, zapisać jako PDF albo pobrać do edycji w Wordzie. | § 13 |
| Ekran sali | Osobny widok na rzutnik. Pokazuje bieżący punkt z osobami, które go prowadzą i referują, projekt porządku przy jego przyjmowaniu, trwające głosowanie (także próbne) i wynik, ale wynik w sprawie dopiero po ogłoszeniu. Na spotkaniu roboczym ma znacznik „Spotkanie robocze”. | |

## Jak działa tajne głosowanie

1. Telefon losuje 32-bajtowy żeton i zaciemnia go losową liczbą. Serwer dostaje tylko wersję zaciemnioną.
2. Serwer sprawdza, czy osoba jest uprawniona, obecna i nie pobrała jeszcze karty. Zapisuje „karta pobrana” i podpisuje zaciemniony żeton kluczem tego głosowania (RSA-2048).
3. Telefon odciemnia podpis. Po krótkiej losowej zwłoce wysyła żeton, podpis i wybór **bez sesji logowania**.
4. Serwer sprawdza podpis i jednorazowość żetonu, a potem zapisuje tylko skrót żetonu i wybór. Zapis trafia do tabeli bez numeracji wierszy, bez osoby i bez czasu.
5. Po zamknięciu głosowania klucz prywatny jest usuwany. Baza jest przebudowywana (VACUUM), a dziennik WAL czyszczony, żeby nie został ślad kolejności zapisów.

Ograniczenia, które trzeba znać:
- Tajności nie da się zapewnić wobec kogoś, kto w trakcie głosowania podsłuchuje ruch sieciowy na samym serwerze albo podmieni kod aplikacji. Serwer trzeba więc chronić tak jak urnę.
- Przy jednomyślnym wyniku tajność jest z natury ograniczona.
- Odcisk klucza widoczny na karcie powinien być taki sam u wszystkich głosujących.

## Uruchomienie

Wymagany jest **Node.js 24 lub nowszy**.

```bash
npm install
npm run build
npm start
```

Po pierwszym uruchomieniu w oknie serwera (i w pliku `data/pierwsze-uruchomienie.txt`) pojawia się kod. Otwórz `http://localhost:3000`, wpisz kod i utwórz konto administratora. Następnie w „Konta” utwórz konta członków Prezydium.

Zmienne środowiskowe:
- `PORT` (domyślnie 3000)
- `HOST` (domyślnie 127.0.0.1; dla sieci `0.0.0.0`)
- `DATA_DIR` (domyślnie `data`)
- `APP_URL`: pełny adres, pod którym aplikacja jest dostępna, np. `https://obrady.oipip.slupsk.pl`. Bez tej zmiennej działa tylko pod `localhost`.
- `ALLOW_HTTP=1`: zgoda na `APP_URL` bez HTTPS. Tylko do prób w zamkniętej sieci.

Gotowa paczka to `dist/server.mjs` i `dist/client/`. Do jej uruchomienia wystarczy Node.js, bez `npm install`.

Kopia zapasowa: zatrzymaj serwer i skopiuj cały katalog `data` (baza SQLite i pliki). Nie kopiuj pliku bazy w trakcie pracy, bo używa dziennika WAL.

## Wygląd

Aplikacja korzysta z identyfikacji wizualnej Okręgowej Izby Pielęgniarek i Położnych w Słupsku z folderu `brand/` (paczka w wersji 1.0.0). Są tam zasady wizualne i językowe, tokeny kolorów, krój Titillium Web, znak Izby, ikony aplikacji i komponenty `oi-*`. Plik `CLAUDE.md` w tym katalogu wczytuje zasady paczki w każdej sesji Claude Code.

- Style aplikacji: `src/client/styles.css` podłącza fonty, tokeny i komponenty paczki, a potem pliki `src/client/style/` (podstawa ze skalą pisma i odstępami w `baza.css`, dalej ekrany). Kolory biorą wyłącznie z tokenów, a kształty są kanciaste, ze skosem 13°.
- Aplikacja jest jasna. Motyw ciemny z paczki można włączyć dopiero na życzenie Izby.
- Znak Izby stoi zawsze na białym tle. Przy budowaniu trafia do `dist/client/brand/logo/` razem z ikonami i manifestem aplikacji, prosto z `brand/`, bez kopii w repozytorium.
- `src/shared/typo.ts` wstawia twarde spacje po jednoliterowych spójnikach i przyimkach, po „nr”, „§”, „ust.” i liczbie rzymskiej oraz między liczbą a policzonym słowem, a przedziały liczb („2024–2028”) nie łamią się między wierszami. `src/client/typo.ts` stosuje ją w całym interfejsie.
- Wersja próbna (`npm run build:demo`) ma ten sam wygląd i osadzone fonty, ale nie ma znaku ani nazwy Izby.
- Przykładowe grafiki na Facebooka z paczki zostały poza repozytorium. Paczka zastrzega, że zdjęcie i logotypy współorganizatorów nie służą do ponownego użycia.

## Dla programisty

```
src/shared/   logika regulaminowa bez zależności (typy, skład, kworum, przebieg posiedzenia, ślepe podpisy)
src/server/   serwer HTTP na node:http + node:sqlite, logowanie, materiały, karty tajne, protokół
src/client/   interfejs Preact: panel prowadzenia obrad, widok telefonu, przygotowanie, głosowanie między posiedzeniami, konta, ekran sali
src/demo/     wersja próbna: ten sam interfejs, serwer symulowany w przeglądarce, dane fikcyjne
tests/        testy logiki, kryptografii i pełnego przebiegu przez API
```

```bash
npm test        # node --test (logika, kryptografia, API z 7 równoczesnymi uczestnikami)
npm run check   # kontrola typów TypeScript
```

Cała logika posiedzenia jest w `src/shared/meeting.ts`. Działa jako `apply(stan, polecenie, osoba, kontekst)` i w każdym przypadku sprawdza uprawnienia oraz warunki regulaminowe. Serwer zapisuje wynik w transakcji SQLite. Głosowania po upływie czasu zamyka zegar serwera, również wtedy, gdy nikt nie odświeża strony.

### Wersja próbna

`npm run build:demo` tworzy jeden plik `dist-demo/posiedzenia-proba.html`. Działa w przeglądarce bez serwera: logowanie zastępuje wybór osoby, stan trzyma `localStorage`, a tajne głosowanie używa tych samych ślepych podpisów co serwer (klucze RSA z WebCrypto). Dane są fikcyjne. Plik służy do sprawdzenia przebiegu posiedzenia na telefonie i nie zawiera danych Izby.
