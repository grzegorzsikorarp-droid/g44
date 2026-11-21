# Posiedzenia OIPiP w Słupsku, etap 1 (Prezydium)

Aplikacja do prowadzenia posiedzeń Prezydium Okręgowej Rady Pielęgniarek i Położnych w Słupsku i do głosowań między posiedzeniami. Osoba prowadząca obrady pracuje na komputerze, a członkowie Prezydium na telefonach, w zwykłej przeglądarce, bez instalowania aplikacji.

Plan ma trzy etapy. **Etap 1** to Prezydium (ten kod), etap 2 Okręgowa Rada Pielęgniarek i Położnych w Słupsku (wybory prezydium, komisje), a etap 3 Okręgowy Zjazd.

Wymagania wynikają z wiążących dokumentów: Regulaminu Okręgowej Rady (uchwała nr 9 OZPiP z 22.03.2025), Regulaminu Okręgowego Zjazdu (uchwała nr 8 OZPiP z 22.03.2025) i Regulaminu wyborów do organów izb (uchwała nr 2 I Nadzwyczajnego KZPiP z 23.09.2024). Szczegóły i numery paragrafów: [`docs/ZRODLA.md`](docs/ZRODLA.md). Wcześniejsza aplikacja (wersja 1.0.0 z ChatGPT) była tylko punktem odniesienia.

## Co robi aplikacja

| Obszar | Działanie | Podstawa |
|---|---|---|
| Skład i konta | 7 członków Prezydium IX kadencji; każdy ma własne konto i hasło. Są też konta z głosem doradczym (bez prawa głosu), gości i biura. Logowanie wygasa po 12 godzinach bez korzystania z aplikacji i przedłuża się, dopóki ktoś z niej korzysta. | § 19 ust. 2, § 7 ust. 2–3 |
| Zwołanie | Termin, miejsce, tryb stacjonarny lub zdalny (z odnośnikiem do połączenia). Aplikacja ostrzega, gdy od zawiadomienia mija mniej niż 7 dni. Nieobowiązkowe dane do protokołu to numer protokołu, protokolant i osoba zwołująca. Posiedzenie można powielić, np. gdy spotkanie robocze nie miało kworum, a nowe posiedzenie ma ten sam porządek i materiały. | § 6 ust. 3, § 7 ust. 1 |
| Porządek obrad | Uproszczony szablon dla Prezydium (decyzja z 18.11.2026). Można go wczytać z tekstu skopiowanego z Worda. Przy przyjmowaniu porządku osoba prowadząca obrady układa projekt kafelkami (przeciąganie albo przyciski „Wyżej” i „Niżej”), a członkowie i ekran sali widzą zmiany od razu. Na spotkaniu roboczym projekt zmienia się na żywo przez całe spotkanie: „Zmień projekt porządku” włącza tryb zmian, a przy zmienionym punkcie widać „zmieniono o” z godziną (decyzja z 20.11.2026). Dalsze sprawy są dostępne dopiero po przyjęciu porządku w głosowaniu, a późniejsze zmiany wymagają osobnego głosowania. Rozpoczęcie punktu poza kolejnością, odroczenie i wycofanie punktu oraz zamknięcie posiedzenia z nierozpatrzonymi punktami wymagają powodu, który trafia do protokołu. Przy punkcie można wpisać do 6 osób, które go prowadzą albo referują, i określić, co jest w nim głosowane. | § 9 ust. 2, § 14 ust. 4 |
| Prowadzenie | Prowadzi przewodniczący lub wiceprzewodniczący. Zastępcę wyznacza tylko przewodniczący, przed posiedzeniem albo w jego trakcie, bez potwierdzenia przez biuro (decyzja z 20.11.2026). Kolejność do prowadzenia: przewodniczący, zastępca, inny wiceprzewodniczący. Inny wiceprzewodniczący przejmuje prowadzenie zamiast zastępcy tylko z powodem, który trafia do protokołu, a zastępca po dojściu przejmuje je bez powodu. Gdy osoba prowadząca wyszła z sali, przejmujący zapisuje jej wyjście („Osoba prowadząca jest poza salą”), a ta osoba może raz wrócić do prowadzenia. Obecność zapisuje się razem z otwarciem albo przejęciem prowadzenia. Pasek posiedzenia i ekran sali mówią, kto prowadzi i czy jest to zastępstwo przewodniczącego. | § 9 ust. 1, § 16 |
| Obecność i kworum | Na posiedzeniu stacjonarnym członek zgłasza obecność telefonem, a potwierdza ją osoba prowadząca obrady albo biuro, także wszystkie zgłoszenia naraz. Na posiedzeniu zdalnym członek potwierdza obecność sam. Obecność może też zapisać osoba prowadząca obrady lub biuro, a wejścia i wyjścia są zapisywane z godziną. Biuro nie odrzuca zgłoszeń, nie zmienia obecności osoby prowadzącej i w trakcie głosowania nie zapisuje wyjścia osób uprawnionych do głosu (robi to osoba prowadząca). Kworum to co najmniej 4 z 7. Bez kworum nie da się otworzyć głosowania. Gdy kworum nie stwierdzono, posiedzenie toczy się do końca jako spotkanie robocze bez głosowań (poza próbnym), a zamiast protokołu powstaje notatka. | § 8 ust. 2 |
| Głosowania | Domyślnie jawne. Imienne i tajne wymagają uchwalenia przez Prezydium tajności głosowania albo głosowania imiennego. Wniosek o to jest głosowany w aplikacji, która zapisuje, kto go zgłosił, a uchwalony tryb wiąże głosowanie w tej sprawie. Rozstrzyga zwykła większość, czyli więcej „za” niż „przeciw”. Głosowanie trwa określony czas, ma licznik i kończy się wcześniej, gdy zagłosują wszyscy uprawnieni. Członkowie widzą wynik dopiero po jego ogłoszeniu przez osobę prowadzącą obrady i dopiero wtedy obrady idą dalej. Głosowanie próbne (jawne albo tajne, bez numeru i bez skutków) sprawdza, czy głosowanie działa na telefonach. Karta „Głosowanie w tym punkcie” pokazuje przedmiot, to, co jest głosowane, tryb, wymaganą większość, czas i wymagane kworum z paragrafami, a „Następny punkt” prowadzi do pierwszego nierozpatrzonego punktu porządku. Pod wynikiem członkowie, sala i panel widzą podstawę rozstrzygnięcia. Członkowie widzą też jawny przebieg obrad z osobą przy każdym wpisie. | § 8 ust. 3, § 11 |
| Tajność | Ślepe podpisy RSA (opis niżej). Serwer wie, że głosowała uprawniona osoba, ale nie wie, jak głosowała. Głosowanie próbne tajne idzie tą samą drogą. | § 11 ust. 3 |
| Reasumpcja | Tylko dla głosowania jawnego, na tym samym posiedzeniu i tylko raz. Wniosek z uzasadnieniem musi poprzeć co najmniej 1/3 obecnych, a decyzję o reasumpcji podejmuje Prezydium. | § 12 |
| Między posiedzeniami | Głosowanie zdalne w wyznaczonym czasie (np. kilka godzin), z licznikiem i wspólnym kanałem wiadomości. Rozstrzygnięcie wymaga co najmniej 4 głosujących. Głosowanie rozpoczyna przewodniczący albo zastępca wyznaczony na to głosowanie i trwa co najmniej 24 godziny, a krótszy termin wymaga powodu. Osoba, która je rozpoczęła, albo przewodniczący może przedłużyć albo skrócić termin (członkowie widzą uwagę i wiadomość w kanale), zakończyć głosowanie przed terminem z policzeniem głosów albo przerwać je z powodem bez rozstrzygnięcia. Wynik członkowie widzą po jego ogłoszeniu. | § 14 ust. 5 |
| Materiały i rodzaje dokumentów | Pliki DOCX, Markdown i TXT zamieniają się w lekki tekst do czytania na telefonie, a oryginał można pobrać. Plik z kilkoma uchwałami (np. PWZ) dzieli się na osobne dokumenty i podpunkty. Głosowanie dotyczy wersji utrwalonej przy jego otwarciu. Rodzaje dokumentów (uchwała, stanowisko, oświadczenie, apel i inne) z formułami wyniku, np. „Stanowisko przyjęte”, prowadzi biuro w ustawieniach ogólnych. Głosowanie zapamiętuje formułę z chwili otwarcia. | § 8 ust. 9 |
| Protokół | Projekt protokołu powstaje z zapisu obrad w układzie dokumentu organu. Ma rozdziały o zwołaniu i prowadzeniu obrad (z głosowaniem próbnym), liście obecności ze sposobem potwierdzenia, porządku ze zmianami projektu, przebiegu obrad z głosowaniami, powodami, osobami przy punktach i osobą zgłaszającą wniosek, podjętych uchwałach i załącznikach, a na końcu miejsca na podpisy. Nieogłoszony wynik jest w nim ukryty tak jak w aplikacji. Ze spotkania roboczego powstaje notatka, a z głosowania między posiedzeniami protokół ze zmianami terminu i sposobem zakończenia. Posiedzenia od wersji 3 mają też zastępstwo przewodniczącego, otwarcie i zmiany prowadzenia z podstawą, gości z informacją, kto zaprasza, wymaganą większość, punkty dodane po zawiadomieniu, pominięte punkty z regulaminu i odstępstwa w punktach; pod podpisem osoby, która zamknęła obrady, stoją pozostałe osoby prowadzące. Posiedzenia sprzed wersji 3 mają projekt protokołu bez zmian. Projekt można wydrukować, zapisać jako PDF albo pobrać do edycji w Wordzie. | § 13 |
| Ekran sali | Osobny widok na rzutnik. Pokazuje bieżący punkt z osobami, które go prowadzą i referują, projekt porządku przy jego przyjmowaniu, trwające głosowanie (także próbne) i wynik, ale wynik w sprawie dopiero po ogłoszeniu. Od wersji 4 pokazuje też plik albo prezentację, którą osoba prowadząca obrady włączyła przyciskiem „Pokaż na sali i telefonach”. Na spotkaniu roboczym ma znacznik „Spotkanie robocze” i projekt porządku w trybie zmian. Pod wynikiem stoi jedno zdanie o podstawie rozstrzygnięcia, a w stopce wymagane kworum i osoba prowadząca, także z informacją o zastępstwie przewodniczącego. | |

## Jak działa tajne głosowanie

1. Telefon losuje 32-bajtowy żeton i zaciemnia go losową liczbą. Serwer dostaje tylko wersję zaciemnioną.
2. Serwer sprawdza, czy osoba jest uprawniona, obecna i nie pobrała jeszcze karty. Zapisuje „karta pobrana” i podpisuje zaciemniony żeton kluczem tego głosowania (RSA-2048).
3. Telefon odciemnia podpis. Po krótkiej losowej zwłoce wysyła żeton, podpis i wybór **bez sesji logowania**.
4. Serwer sprawdza podpis i jednorazowość żetonu, a potem zapisuje tylko skrót żetonu i wybór. Zapis trafia do tabeli bez numeracji wierszy, bez osoby i bez czasu.
5. Po zamknięciu głosowania klucz prywatny jest usuwany. Baza jest przebudowywana (VACUUM), a dziennik WAL czyszczony, żeby nie został ślad kolejności zapisów.

Ograniczenia, które trzeba znać:
- Tajności nie da się zapewnić wobec kogoś, kto w trakcie głosowania podsłuchuje ruch sieciowy na samym serwerze albo podmieni kod aplikacji. Serwer trzeba więc chronić tak jak urnę.
- Wynik ogłoszony jest jawny z natury, a wynik jednomyślny ujawnia głosy niezależnie od aplikacji.
- Odcisk klucza widoczny na karcie powinien być taki sam u wszystkich głosujących.

Zasady tajności wersji 4 (pokaz plików, zdjęcia, dokumenty, poczta i statystyki):
- Pliki tajnego głosowania (`src/shared/blind.ts`, `src/shared/sha256.ts`, `src/server/secret.ts`, `src/client/secret.ts`) zostały bez zmian.
- Od wysłania karty tajnej do zamknięcia głosowania telefon członka i ekran sali wysyłają tylko dotychczasowe odświeżanie widoku posiedzenia. Panel osoby prowadzącej wysyła poza tym wyłącznie polecenia wywołane przyciskiem. Dotyczy to też trwającego pokazu, załadowanych zdjęć i otwartej karty dokumentów. Test e2e mierzy to przy każdym przebiegu.
- Pokaz zależy tylko od stanu wspólnego (pokaz włączony i brak otwartego głosowania), nigdy od tego, czy dana osoba już głosowała. W trakcie każdego głosowania ekran sali i telefony pokazują głosowanie, a pokaz wraca dopiero przyciskiem osoby prowadzącej.
- Zdjęcia profilowe wczytują się raz po zalogowaniu i potem wyświetlają się wyłącznie z pamięci przeglądarki, więc oddanie głosu nie wywołuje żadnego pobrania.
- Statystyki liczą tylko posiedzenia zakończone i głosowania z ogłoszonym wynikiem. Z głosowania tajnego znają wyłącznie to, kto pobrał kartę. Widok posiedzenia, panel i ekran sali nie ładują statystyk.
- Pliki, wydruki, CSV, teczka, materiał dla komunikacji i zestawienie nie zawierają wyników przed ogłoszeniem. Trwające głosowanie opisują tylko zdaniem „Głosowanie nr {n} trwa.”. Z głosowania tajnego podają tylko liczby z protokołu.
- Dziennik nie zapisuje pobrania karty ani oddania głosu, a pokaz nie ma wpisów w trakcie głosowania.

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
- Zmienne poczty (`SMTP_HOST_ALLOWED`, `SMTP_PASSWORD_FILE` i inne) opisuje rozdział „Poczta e-mail” niżej.

Gotowa paczka to `dist/server.mjs` i `dist/client/`. Do jej uruchomienia wystarczy Node.js, bez `npm install`.

Kopia zapasowa: zatrzymaj serwer i skopiuj cały katalog `data` (baza SQLite i pliki). Nie kopiuj pliku bazy w trakcie pracy, bo używa dziennika WAL.

## Wersja 4: dokumenty, wspólne przygotowanie, poczta, pokaz plików, konto i statystyki

### Dokumenty posiedzenia i eksport

Po zamknięciu posiedzenia karta „Dokumenty posiedzenia” zbiera wszystko w jednym miejscu: porządek obrad, projekt protokołu albo notatkę, listę obecności (także wersję do podpisu), wyniki głosowań, podjęte akty, materiały, kanał wiadomości i dziennik. Każdy dokument ma przyciski formatów.

- „Drukuj” otwiera wydruk w nowej karcie. Wydruk projektu ma wiersz „PROJEKT” na każdej stronie.
- „Word” pobiera plik `.docx` do dalszej edycji (krój Titillium Web, gdy jest zainstalowany na komputerze).
- „Markdown” i „CSV” pobierają tekst i tabele (CSV z separatorem średnika i znacznikiem UTF-8, otwiera się w Excelu).
- „Teczka posiedzenia” to plik ZIP z dokumentami, do których osoba ma prawo, z plikami pokazanymi na posiedzeniu (folder `11-pokazane/`) i z plikiem `SPIS.txt`, który podaje skrót SHA-256 każdego pliku i listę plików pominiętych z powodem.

Numery stron na wydruku drukują Chrome i Edge. Safari i Firefox drukują dokument bez numerów stron, dlatego w innej przeglądarce lepiej pobrać wersję Word.

Po posiedzeniu biuro, przewodniczący albo sekretarz dołączają pliki (protokół sporządzony, protokół podpisany, zawiadomienie, podpisany akt ze wskazaniem głosowania, inny plik; PDF, DOCX, JPG albo PNG do 10 MB). Okno „Protokół sporządzony” zapisuje datę wpisaną ręcznie (bez wartości domyślnej) i osobę, która sporządziła protokół; członkowie widzą zdanie „Sporządza {imię i nazwisko}, {funkcja}. Do wglądu w biurze…”. Plik protokołu bez tego faktu daje w karcie wiersz „Do sprawdzenia”. Stan protokołu („Projekt”, „Sporządzony”, „Przyjęty”) liczy się z zapisu, a „Przyjęty” dopiero po zamknięciu posiedzenia, na którym przyjęto protokół (głosowanie zapamiętuje, którego posiedzenia protokół dotyczy).

### Odbyte posiedzenia, zestawienie i zdjęcia

Strona „Odbyte posiedzenia” pokazuje tylko posiedzenia zakończone, z filtrami (rok, kadencja, rodzaj, stan protokołu, „Tylko bez kompletu”, wyszukiwanie), liczbą podjętych aktów, obecnością i kompletem dokumentów. „Zestawienie za okres” (rok, kadencja, ostatnie 12 miesięcy albo inny okres) ma wydruk i CSV posiedzeń oraz aktów; widzą je biuro, przewodniczący, wiceprzewodniczący i sekretarz.

Do posiedzenia można wpisać odnośnik do albumu zdjęć (tylko `https`; ostrzeżenie przy adresach spoza `photos.app.goo.gl` i `photos.google.com`). Aplikacja przechowuje tylko odnośnik i nigdy go nie otwiera. Album udostępniony przez link otwiera każdy, kto zna adres. Dlatego widzą go tylko członkowie Prezydium, biuro i konto „Komunikacja”, a nie osoby z głosem doradczym i goście. CSV katalogu i zestawienia podaje tylko „jest” albo „brak”.

### Materiał dla komunikacji i konto „Komunikacja”

Z każdego zakończonego posiedzenia powstaje plik Markdown dla działu komunikacji: opis posiedzenia, podjęte akty według poziomu z rodzaju sprawy („Pełna treść”, „Tytuł”, „Tylko liczba”, „Nie trafia”), zdania wpisane przy punktach, pokazane pliki, stan protokołu i odnośnik do zdjęć. Sprawy bez rodzaju sprawy trafiają do pliku tylko w liczbie. Plik nie zawiera nazwisk osób spoza składu, tytułów pokazanych plików ani wyników przed ogłoszeniem.

Materiał trafia do konta „Komunikacja” dopiero po udostępnieniu jednym kliknięciem („Udostępnij komunikacji”) przez biuro, przewodniczącego albo osobę, która zamknęła obrady (odpowiedź (b) na pytanie 12). Zmiana zdań, poziomów albo opisu po udostępnieniu wymaga „Udostępnij ponownie”; przyjęcie protokołu i odnośnik do zdjęć aktualizują plik same.

Konto „Komunikacja” zakłada administrator przyciskiem „Dodaj konto komunikacji”. Konto widzi tylko odbyte posiedzenia, odnośniki do zdjęć i udostępnione materiały dla komunikacji. Nie widzi posiedzeń w przygotowaniu i trwających, materiałów, protokołów, kanału, teczki, ustawień ani statystyk. Przed udostępnieniem widzi „Materiał dla komunikacji czeka na udostępnienie.”.

### Wspólne przygotowanie

W przygotowaniu posiedzenia członkowie Prezydium widzą postęp („Gotowe {n} z {m} punktów.” z tym, czego brakuje), zgłaszają sprawy z uzasadnieniem i plikiem, piszą uwagi przy punktach i przy posiedzeniu, odpowiadają i oznaczają wątki jako rozstrzygnięte. Zgłoszenie wpisuje do projektu biuro, przewodniczący albo wiceprzewodniczący, a odrzuca albo odkłada z powodem zwołujący. Osoba z głosem doradczym widzi tylko własne zgłoszenia i decyzje w ich sprawie. Od otwarcia posiedzenia przestrzeń robocza jest niewidoczna, a po zamknięciu tylko do odczytu. Uwagi robocze znikają 90 dni po zamknięciu posiedzenia. Kanał wiadomości działa od otwarcia posiedzenia.

### Poczta e-mail

Aplikacja wysyła trzy rodzaje wiadomości o posiedzeniu: informację o postępie przygotowań (w przygotowaniu, najwyżej raz na godzinę), „Protokół do wglądu” po wpisaniu „Protokół sporządzony” i powiadomienie o dokumentach po zamknięciu. Wiadomości idą tylko na adresy potwierdzone, po jednej na osobę, przez skrzynkę nadawczą z ponowieniami. W trakcie obrad aplikacja nie wysyła nic o tym posiedzeniu, a otwarcie anuluje czekające informacje o postępie. Zawiadomienia o posiedzeniach wysyła się jak dotąd (odpowiedź (a) na pytanie 10).

Zmienne środowiskowe poczty (serwer czyta je przy starcie i wypisuje jedną linię stanu bez hasła):

| Zmienna | Znaczenie | Wymagana |
|---|---|---|
| `APP_URL` | adres aplikacji z HTTPS; linki w wiadomościach prowadzą do `APP_URL` + `#p-{id}` | do włączenia poczty |
| `SMTP_PASSWORD_FILE` (zalecana) albo `SMTP_PASSWORD` | plik z hasłem o prawach 0400 (sekret systemd albo kontenera) albo samo hasło; serwer po odczycie usuwa obie zmienne ze środowiska procesu; hasło nigdy nie trafia do bazy | gdy login nie jest pusty |
| `SMTP_HOST_ALLOWED` | jedyny serwer poczty, z którym aplikacja się łączy; bez tej zmiennej wysyłki nie da się włączyć | tak |
| `SMTP_CA_FILE` | własny urząd certyfikacji, np. dla serwera poczty z certyfikatem wewnętrznym | nie |
| `MAIL_OFF=1` | awaryjne wyłączenie wysyłki bez zmiany ustawień | nie |

Zalecamy `SMTP_PASSWORD_FILE`, bo hasło w pliku dostępnym tylko dla aplikacji nie pojawia się w liście procesów ani w konfiguracji usługi. Połączenie idzie zawsze szyfrowane (TLS na porcie 465 albo STARTTLS na 587) ze sprawdzeniem certyfikatu.

Biuro wpisuje dane serwera w „Ustawieniach”, sekcja „Poczta e-mail”, i sprawdza je przyciskiem „Wyślij wiadomość próbną”. Okno pokazuje kroki „Połączenie”, „Szyfrowanie”, „Logowanie” i „Wysłanie” z wynikiem każdego. Wiadomość próbną warto wysłać na skrzynkę biura i na skrzynkę zewnętrzną, a dopiero potem włączyć wysyłkę.

#### Co Izba musi zapewnić (do przekazania w całości)

1. **Konto pocztowe do wysyłki w domenie Izby**, np. osobną skrzynkę „posiedzenia@…” albo skrzynkę biura. Wiadomości z adresu w domenie Izby rzadziej trafiają do spamu.
2. **Dane serwera poczty** od dostawcy poczty Izby: nazwa serwera wysyłki (SMTP), port 465 albo 587 i informacja, czy dostawca pozwala wysyłać po zalogowaniu hasłem. Przy Microsoft 365 i Google Workspace trzeba to sprawdzić osobno; bywa potrzebne hasło aplikacji albo włączenie wysyłki SMTP dla tej skrzynki.
3. **Hasło do tego konta**, przekazane bezpiecznie (nie e-mailem i nie w czacie) osobie, która administruje serwerem aplikacji. Hasło zapisuje się tylko w pliku na serwerze aplikacji dostępnym wyłącznie dla aplikacji (`SMTP_PASSWORD_FILE`, zalecane) albo w zmiennej `SMTP_PASSWORD`, razem z nazwą serwera poczty w `SMTP_HOST_ALLOWED`. Nigdy nie trafia do aplikacji ani do bazy.
4. **Dostęp sieciowy** serwera aplikacji do serwera poczty na porcie 465 albo 587. Część dostawców hostingu i zapór blokuje te porty; sprawdza to przycisk „Wyślij wiadomość próbną”.
5. **Adres aplikacji z HTTPS** (`APP_URL`), bo linki w wiadomościach muszą prowadzić do właściwej strony.
6. **Adresy e-mail** członków Prezydium, osób z głosem doradczym i osoby z działu komunikacji. Każda osoba może wpisać adres sama w „Moim koncie” i potwierdzić go kodem; może to też zrobić administrator.
7. **Opinia inspektora ochrony danych Izby** w sprawach:
   - podstawy przetwarzania adresów e-mail (wykonywanie zadań samorządu, bez zbierania zgód);
   - okresów przechowywania: treść wiadomości 30 dni, dziennik wysyłek 12 miesięcy, uwagi robocze 90 dni po posiedzeniu, zgłoszenia czekające 365 dni, zdjęcie do 30 dni po zakończeniu członkostwa;
   - zdjęć profilowych: dobrowolne dodanie, krąg osób widzących zdjęcia (pytanie 13), usunięcie przez administratora i po zakończeniu członkostwa;
   - statystyk obecności i udziału w głosowaniach: cel, krąg odbiorców (pytanie 11), brak głosów tajnych;
   - imiennej obecności w materiałach sprawozdawczych, np. w wydruku statystyk składu dołączanym do sprawozdania dla Okręgowego Zjazdu (dodatek D-13);
   - materiału dla komunikacji: reguły pomijania danych osób i udostępnianie po przejrzeniu (pytanie 12);
   - **przekazywania materiału dla komunikacji do zewnętrznego czatu**, w którym powstają posty: kto jest dostawcą czatu, czy jest z nim umowa powierzenia przetwarzania i czy obowiązuje zakaz wklejania do czatu danych osobowych spoza materiału;
   - informacji „Teraz oglądają” w przygotowaniu (dodatek D-9, domyślnie wyłączona u każdej osoby);
   - wpisu w rejestrze czynności przetwarzania;
   - adresu strony z pełną klauzulą informacyjną (pokazywanej też przy dodawaniu zdjęcia) i nazwy administratora danych do stopki wiadomości;
   - umowy powierzenia z dostawcą poczty;
   - okresu przechowywania kopii zapasowych serwera (zdjęcia, adresy i uwagi żyją w kopiach do ich wymiany).
8. **Zasady albumów zdjęć Google**: kto zakłada album, czy album jest udostępniany przez link, jak Izba dba o zgodę osób na zdjęciach. Album udostępniony przez link otwiera każdy, kto zna adres, dlatego aplikacja pokazuje odnośnik tylko członkom Prezydium, biuru i kontu komunikacji. Aplikacja przechowuje tylko odnośnik i nigdy go nie otwiera.
9. **Wskazanie osoby z działu komunikacji**, dla której administrator założy konto „Komunikacja”.
10. **Komputer przy rzutniku** z przeglądarką Chrome albo Edge (Firefox też pokazuje pliki, ale numery stron na wydruku drukują tylko Chrome i Edge), z włączonym podglądem plików PDF, i próba pokazu przed pierwszym posiedzeniem. Pilot do prezentacji jest dodatkiem. Prezentacje PowerPoint zapisuje się przed posiedzeniem jako PDF albo jako obrazy slajdów.
11. **Próba na telefonach członków**: iPhone (Safari) i telefon z Androidem (Chrome) według listy z B3 rozdz. 11.7 (pokaz PDF i obrazów slajdów, „Otwórz plik”, zdjęcie z aparatu w „Moim koncie”, wydruk projektu protokołu do PDF ze znakiem „Projekt” na każdej stronie). Środowisko prób ma tylko Chromium, więc tej próby nie da się zrobić bez urządzeń Izby (R-37).
12. **Krój Titillium Web na komputerach biura** (pliki Word wyglądają wtedy jak w aplikacji) i obejrzenie jednego pliku `.docx` z aplikacji w programie Word przed pierwszym użyciem, także uchwały z tabelą ze scalonymi komórkami.
13. **Dzień uruchomienia aplikacji** do ustawienia „Statystyki liczą posiedzenia od dnia”, żeby posiedzenia ćwiczebne nie wchodziły do statystyk. Biuro ustawia go przed pierwszym prawdziwym posiedzeniem; późniejszy dzień, który wyłączyłby już policzone posiedzenia, wpisuje przewodniczący z powodem.
14. **Odpowiedzi na pytania 10–13** oraz dokumenty, o które prosiła już specyfikacja wersji 3 (SPEC-3 8.2): uchwała Okręgowej Rady Pielęgniarek i Położnych w Słupsku o sprawach przekazanych Prezydium (§ 14 ust. 1), o zakresie zastępstwa (§ 16 ust. 1) i o liczbie członków Prezydium IX kadencji (§ 4 ust. 2).
15. **Zasady pracy w czacie komunikacji**: do czatu wkleja się wyłącznie plik pobrany z aplikacji po udostępnieniu, bez dopisywania danych osób spoza organu; posty z czatu przed publikacją przegląda osoba z działu komunikacji. Te zasady przyjmuje Izba, aplikacja ich nie egzekwuje.
16. **Wskazanie, kto udostępnia materiał komunikacji** po każdym posiedzeniu (biuro, przewodniczący albo osoba, która zamknęła obrady), dopóki obowiązuje wariant (b) pytania 12.

Po otrzymaniu punktów 1–5 biuro wpisuje dane w „Ustawieniach”, sekcja „Poczta e-mail”, wysyła wiadomość próbną na swoją skrzynkę i na skrzynkę zewnętrzną, a potem włącza wysyłkę.

### Pokaz plików i formaty

Biuro, przewodniczący albo wiceprzewodniczący dodają w przygotowaniu pliki do pokazania przy punkcie („Dodaj plik do pokazania”); w trakcie obrad plik dodaje osoba prowadząca obrady albo biuro. Pokaz rozpoczyna, przewija, wznawia i kończy wyłącznie osoba prowadząca obrady (karta „Pokaz” w panelu); biuro dostaje „Pokazuje osoba prowadząca obrady.”. Ekran sali pokazuje plik od razu, telefony i komputery członków razem z nim, a każdy może przejść do „Przeglądaj samodzielnie” i wrócić do strony z sali. Gdy zaczyna się głosowanie, ekran i telefony pokazują głosowanie, a pokaz czeka na przycisk „Wróć do pokazu”.

| Format | Jak działa |
|---|---|
| PDF do 10 MB | Na ekranie sali i na komputerze w ramce podglądu przeglądarki, strona po stronie. Na telefonach strony PDF nie przewijają się razem z salą: telefon pokazuje „Na sali strona {n} z {m}.” i otwiera plik w osobnej karcie albo go pobiera. |
| Obrazy JPG, PNG, WebP do 10 MB | Pojedynczy obraz albo prezentacja ze slajdów (do 60 obrazów, razem do 30 MB). Na telefonach slajd przewija się razem z salą. Do serii można dołączyć plik PDF tej prezentacji do pobrania. |
| PowerPoint | Aplikacja go nie wyświetla. Prezentację zapisuje się w programie PowerPoint jako PDF albo jako obrazy slajdów (PNG); obrazy najlepiej widać na telefonach. |
| Strony internetowe i filmy z serwisów | Aplikacja ich nie pokazuje i nie osadza (także YouTube). Pliki pokazu nie dają się też osadzić na obcych stronach. |

Opis pokazu (do 2000 znaków) zobaczą osoby, które nie widzą obrazu. Projekt protokołu wymienia pliki pokazane w każdym punkcie, a teczka posiedzenia zawiera je w folderze `11-pokazane/`.

### Zdjęcia profilowe i „Moje konto”

„Moje konto” ma dane konta, adres e-mail z potwierdzeniem kodem, powiadomienia, hasło i nieobowiązkowe zdjęcie. Zdjęcie przycina się w oknie „Kadr zdjęcia” do kwadratu; serwer usuwa z niego metadane (EXIF, położenie). Zdjęcie widzą biuro, administrator, przewodniczący i wiceprzewodniczący (odpowiedź (a) na pytanie 13), w panelu prowadzenia obrad (lista obecności i „Prowadzenie obrad”) i w składzie. Zdjęcie nie trafia do dokumentów. Znika przy blokadzie konta i 30 dni po zakończeniu członkostwa; administrator może je usunąć z powodem. Bez zdjęcia stoi kwadrat z inicjałami.

### Statystyki

„Moje statystyki” pokazują członkowi jego obecność (pełna, częściowa, nieobecność), udział w głosowaniach i własne głosy jawne, z wydrukiem i CSV. Liczą tylko posiedzenia zakończone od dnia z ustawienia „Statystyki liczą posiedzenia od dnia” i głosowania z ogłoszonym wynikiem. Z głosowań tajnych statystyki znają tylko pobranie karty. Tabelę całego składu (dodatek) zobaczą tylko przewodniczący, wiceprzewodniczący, sekretarz i biuro (odpowiedź (b) na pytanie 11).

### Kto widzi co

Uprawnienia wynikają z funkcji w `src/shared/role.ts` i trzech nazwanych kręgów: **kierujący** (przewodniczący i wiceprzewodniczący), **sprawozdawczość** (kierujący i sekretarz) i **obsługa** (biuro). Oznaczenia: **tak** widzi albo robi, **własne** tylko własne, **–** brak.

| Co | Biuro | Przewodniczący | Wiceprzewodniczący | Sekretarz | Członek | Głos doradczy | Gość | Komunikacja | Funkcja |
|---|---|---|---|---|---|---|---|---|---|
| Wspólne przygotowanie (postęp, uwagi) | tak | tak | tak | tak | tak | własne zgłoszenia | – | – | `canSeeWorkspace` |
| Zgłoszenie sprawy do porządku | – | tak | tak | tak | tak | tak | – | – | `canPropose` |
| Wpisanie zgłoszenia do projektu | tak | tak | tak | – | – | – | – | – | `canAcceptProposal` |
| Pokaz plików na sali i telefonach (sterowanie) | – | gdy prowadzi | gdy prowadzi | – | – | – | – | – | `canShow` |
| Oglądanie pokazu i pobranie pliku | tak | tak | tak | tak | tak | tak | tak | – | `canView` |
| Odbyte posiedzenia (wiersze) | tak | tak | tak | tak | tak | zaproszone | zaproszone | zakończone, bez dokumentów | `canSeeCatalog` |
| Projekt protokołu, lista obecności, teczka po zamknięciu | tak | tak | tak | tak | tak | – | – | – | `canDownloadPaper` |
| „Protokół sporządzony”, pliki po posiedzeniu | tak | tak | – | tak | – | – | – | – | `canFile` |
| Odnośnik do zdjęć (widok) | tak | tak | tak | tak | tak | – | – | tak | `seesPhotosLink` |
| Odnośnik do zdjęć (wpis) | tak | tak | gdy prowadzi albo zamknął obrady | – | – | – | – | po zamknięciu | `canSetPhotos` |
| Materiał dla komunikacji (podgląd, pobranie) | tak | tak | tak | – | – | – | – | po udostępnieniu | `canDownloadComms` |
| Udostępnienie materiału, opis i zdania dla komunikacji | tak | tak | gdy zamknął obrady | – | – | – | – | – | `canReleaseComms`, `canEditComms` |
| Zestawienie za okres | tak | tak | tak | tak | – | – | – | – | `canReport` |
| Informacja o postępie (poczta) | tak | tak | tak | – | – | – | – | – | `canSendProgress` |
| Powiadomienie o dokumentach (poczta) | tak | tak | gdy zamknął obrady | – | – | – | – | – | `canSendAfter` |
| Cudze zdjęcia profilowe | tak | tak | tak | – | – | – | – | – | `seesPhotos` |
| „Moje statystyki” | – | tak | tak | tak | tak | – | – | – | `canSeeOwnStats` |
| Ustawienia „Poczta e-mail” | zmienia | czyta | czyta | – | – | – | – | – | `settingsAccess` |

Administrator bez innej roli zakłada konta (także konto „Komunikacja”), zmienia adresy e-mail kont i widzi cudze zdjęcia, ale nie widzi sekcji „Poczta e-mail”. Konto „Komunikacja” na każdej innej stronie dostaje „To konto widzi tylko odbyte posiedzenia i materiały dla komunikacji.”.

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
src/client/   interfejs Preact: panel prowadzenia obrad, widok telefonu, przygotowanie, głosowanie między posiedzeniami, konta, ekran sali,
              pokaz plików, dokumenty posiedzenia, odbyte posiedzenia, poczta, „Moje konto” i statystyki
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
