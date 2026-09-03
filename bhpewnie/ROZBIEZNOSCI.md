# ROZBIEŻNOŚCI.md

Rejestr miejsc, w których brief nie dał się zrealizować dosłownie, oraz decyzji podjętych w tych miejscach. Prowadzony od pierwszego commita, zgodnie z sekcją 11 briefu.

Każdy wpis ma pięć części: założenie strategii, co okazało się w praktyce, skutek, proponowane rozstrzygnięcie i dowód.

**Stan na 3 września 2026. Trzydzieści dziewięć wpisów.** Dotyczy katalogu `bhpewnie/`.

Rejestr rósł w czterech turach i tak też się czyta:

| wpisy | kiedy | czego dotyczą |
|---|---|---|
| 1–14 | wydanie 1.1 (1 września) | brief pierwotny: stawki, wymiar czasu pracy, powiadomienia, dostępność |
| 15–25 | zmiana 1.2 (2 września) | zniesienie sufitu, ewidencja czasu pracy, pakiet umowy, osiem sytuacji |
| 26–31 | design 1.2 (3 września) | odpowiedź projektowa: warstwy ekranu, kafel 104 px, dwie osie stanu, wersaliki |
| 32–39 | zmiana 1.3 (3 września) | wybór częstotliwości budzika, próg trzech „Nie wiem”, normy ciasnoty, zachowanie przy 200% |

Lista pytań otwartych dla zespołu stoi na końcu pliku — po zmianie 1.3 zostało ich osiem, a najpoważniejsza z nich nie dotyczy treści, tylko opakowania natywnego (wpis 6).

**Rozstrzygnięcia projektowe** (kolor, układ, plakietki, pasek numerów) mają własny rejestr — `ROZBIEZNOSCI_DESIGN.md` w dokumentacji systemu wizualnego. Ten plik zajmuje się wykonalnością techniczną i merytoryczną.

---

## 1. Dodatek nocny: przykład z briefu nie zgadza się ze wzorem z briefu

- **Założenie strategii.** Sekcja 6.2: „Dodatek za pracę w nocy — **5,22 zł** za każdą godzinę nocną” (listopad 2026). Sekcja 4.3: „`dodatek_nocny_stawka`: liczona = 20% × minimalne / wymiar godzin miesiąca (wynik ok. 5,22–6,01 zł/h)”.
- **Co okazało się w praktyce.** Te dwa zdania nie mogą być jednocześnie prawdziwe. Wymiar czasu pracy listopada 2026 wynosi 160 godzin (21 dni roboczych minus Święto Niepodległości, które wypada w środę). Wzór daje wtedy 20% × 4806 / 160 = **6,01 zł**. Stawka 5,22 zł wypada w **lipcu** 2026 — jedynym miesiącu o wymiarze 184 godzin. Widełki 5,22–6,01 zł z sekcji 4.3 są policzone poprawnie; błędne jest przypisanie dolnej granicy do listopada.
- **Skutek.** Gdyby prototyp wpisał 5,22 zł na sztywno, aplikacja podawałaby pracownikowi kwotę zaniżoną o 15% przez większość roku — dokładnie ten rodzaj błędu, którego zakazuje zasada 9. Skutek dla kosztu: żaden, kalendarz wymiaru liczy się sam.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Kafel nie może nosić stałej kwoty. Zaimplementowano wyliczanie miesięczne: `content/wymiar-czasu-pracy.json` jest generowany z art. 130 Kodeksu pracy (`node narzedzia/generuj-wymiar.mjs`), a silnik podstawia stawkę właściwą dla dnia, w którym użytkownik patrzy na ekran.
- **Dowód.** `testy/parametry.test.ts` — testy „stawka zmienia się między miesiącami” oraz „ROZBIEŻNOŚĆ 1: w listopadzie 2026 stawka to 6,01 zł, a nie 5,22 zł”. Kalendarz wymiaru: 2026-07 = 184 h, 2026-11 = 160 h.

---

## 2. Mapa ekranów: tytuł mówi 48, wyliczenia dają 58

- **Założenie strategii.** Sekcja 5: „Mapa ekranów (48)”. Etap G: „eksport listy ekranów z kodu porównany z listą 48 (ma się zgadzać)”.
- **Co okazało się w praktyce.** Liczby podane przy nagłówkach grup sumują się do 58: E0 = 23, E1 = 4, E2 = 6, E3 = 3, E4 = 13, E5 = 7, E6 = 2. Zaimplementowano wszystkie 58 wymienionych ekranów, więc kryterium „ma się zgadzać” jest niewykonalne wobec liczby 48 i spełnione wobec listy.
- **Skutek.** Żaden dla użytkownika. Dla zamówienia komercyjnego istotny: wykonawca wyceniający „48 ekranów” wyceni o 20% za mało.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** — poprawić liczbę w tytule sekcji 5 na 58 przed wysłaniem briefu do wykonawcy.
- **Dowód.** `npm run ekrany` porównuje rejestr z kodu z liczbami z briefu i wypisuje rozbieżność. Wynik: wszystkie grupy zgodne, suma 58.

Przy okazji: numeracja w grupie E2 przeskakuje z E2.3 na E2.5 — ekran E2.4 nie istnieje ani w opisie, ani w liczbie „6”. Rejestr ekranów odwzorowuje tę lukę wiernie, żeby numery zgadzały się z briefem.

---

## 3. Budżet dotknięć w P1 jest nieosiągalny przy 19 ekranach

- **Założenie strategii.** Przebieg P1: „≤30 dotknięć przy pełnej konfiguracji; **≤17 przy pominięciu grafiku**”.
- **Co okazało się w praktyce.** Sama konfiguracja bez grafiku to 19 ekranów wymagających decyzji: 13 pytań o cechy (E0.2–E0.14) plus tryb pracy, umowa, przepisy szczególne, rok urodzenia, niepełnosprawność, oraz dwa ekrany zamykające (wynik, nazwa profilu). Przy jednym dotknięciu na ekran i samoczynnym przejściu dalej — bez osobnego przycisku „Dalej” — minimum wynosi **21 dotknięć**. Zmierzone: **21 bez grafiku**, **27 z pełnym grafikiem** (wzorzec rotacji 2-2-3 to jedno dotknięcie).
- **Skutek.** Próg ≤30 jest spełniony z zapasem. Progu ≤17 nie da się dotrzymać bez usunięcia sześciu pytań albo połączenia kilku na jednym ekranie — a to łamie zasadę „jedno zagadnienie na ekran” z sekcji 9.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** — podnieść próg do ≤22 przy pominięciu grafiku. Alternatywa (łączenie pytań) kosztuje czytelność u odbiorcy 45+, czyli dokładnie tej grupy, dla której próg powstał.
- **Dowód.** `testy/e2e/p1-kreator.spec.ts` liczy każde kliknięcie i wypisuje wynik: „P1 bez grafiku: 21 dotknięć”, „P1 pełna konfiguracja: 27 dotknięć”.

---

## 4. PDF tagowany (dostępny cyfrowo) nie powstanie po stronie klienta w pdf-lib

- **Założenie strategii.** Sekcja 3: „Zapisz w rozbieżnościach, czy dało się wygenerować PDF tagowany (dostępny cyfrowo) po stronie klienta — to wymóg produkcyjny”.
- **Co okazało się w praktyce.** pdf-lib nie tworzy drzewa struktury (`StructTreeRoot`), które jest sednem PDF/UA — nie ma API do znaczników akapitów, nagłówków ani tabel. Da się ustawić metadane dokumentu i język (`/Lang pl-PL`), i to zrobiono. Reszta wymagań PDF/UA (kolejność odczytu, tekst alternatywny, znaczniki semantyczne) pozostaje poza zasięgiem tej biblioteki. Sprawdzone alternatywy: jsPDF ma to samo ograniczenie; biblioteki generujące PDF/UA (np. serwerowe) łamią zasadę „dane nie opuszczają urządzenia”.
- **Skutek.** Dokument jest czytelny wzrokowo i ma poprawnie osadzony font z polskimi znakami, ale czytnik ekranu potraktuje go jako ciąg tekstu bez struktury. Dla wykonawcy komercyjnego: pozycja budżetowa na bibliotekę PDF/UA albo na natywne generowanie dokumentu.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować ograniczenie w prototypie**, ale wpisać PDF/UA do wymagań produkcyjnych z osobną wyceną. Dokument A4 ma już strukturę wizualną gotową do otagowania: hierarchię nagłówków, pola do wypełnienia i pas oznaczeń.
- **Dowód.** `src/pdf/dokumenty.ts` — komentarz przy `zaczniejDokument`. Test `testy/e2e/p4-p6-stanowisko.spec.ts` otwiera zapisany plik przez pdf-lib i sprawdza tytuł, autora i liczbę stron.

---

## 5. Rozmiar paczki z wbudowanymi treściami

- **Założenie strategii.** Sekcja 11, badanie obowiązkowe nr 3: „rozmiar paczki z wbudowanymi treściami”.
- **Co okazało się w praktyce.** Zmierzone na zbudowanej paczce:

  | składnik | rozmiar | uwaga |
  |---|---|---|
  | kod aplikacji (JS) | 392 kB, 115 kB po spakowaniu | wczytywany od razu |
  | generator PDF (pdf-lib + fontkit) | 1152 kB, 510 kB po spakowaniu | wczytywany dopiero przy zapisie dokumentu |
  | style | 15 kB, 3,6 kB po spakowaniu | |
  | pismo IBM Plex Sans (4 odmiany, woff2) | 49 kB | podzbiór latin-ext |
  | pismo do PDF (2 odmiany, ttf) | 93 kB | podzbiór 96 znaków |
  | treści JSON (41 plików) | 178 kB | cała wiedza merytoryczna |
  | **paczka offline razem** | **1,6 MB** | wszystko dostępne bez internetu |

  Dwie decyzje obniżyły rozmiar istotnie. Pierwsza: podcięcie fontów do znaków faktycznie używanych — pełny IBM Plex Sans to 200 kB na odmianę, podzbiór 46 kB (77% mniej). Druga: wydzielenie generatora PDF do osobnego kawałka — pierwsze uruchomienie zeszło z 1390 kB do 392 kB.
- **Skutek.** 1,6 MB to rozmiar akceptowalny nawet przy słabym łączu; instalacja na telefonie z 2018 roku nie jest problemem. Treści stanowią 11% paczki, więc jest zapas na pełną wersję trzynastu sprawdzaczy i wszystkich ścieżek Pomocy.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować.** Przy rozroście treści do pełnej wersji warto rozważyć wczytywanie modułów wiedzy na żądanie — ale dopiero powyżej ok. 1 MB samych treści.
- **Dowód.** `npm run build`; rozmiary z katalogu `dist/`.

---

## 6. Powiadomienia lokalne w PWA — silnik działa, wyzwalacz nie

- **Założenie strategii.** Sekcja 3: przypomnienia mają działać „jak budzik w telefonie”, lokalnie, punktualnie, w godzinach wyliczonych z grafiku. Sekcja 11, badanie obowiązkowe nr 1.
- **Co okazało się w praktyce.** Trzeba rozdzielić dwie rzeczy, bo w briefie są jednym.

  **Wyliczanie harmonogramu działa w pełni.** Silnik `src/silnik/harmonogram.ts` liczy przypomnienia na 14 dni z grafiku zmian, terminów użytkownika i reguł budzików, stosuje sufit trzech na dobę z pierwszeństwem i pokazuje wynik na ekranie („następne przypomnienie: w piątek 07:30”). To jest ta część wartości, którą prototyp miał zweryfikować — i ona się broni.

  **Wyzwalanie o zadanej godzinie nie działa niezawodnie.** W czystej PWA nie ma Notification Triggers API (wycofane z Chromium po fazie próbnej, nigdy nie wdrożone w Safari). Zostają trzy drogi, każda ułomna: powiadomienie przy otwartej aplikacji (użytkownik i tak patrzy w ekran), `setTimeout` w Service Workerze (system usypia go po kilkudziesięciu sekundach), oraz Web Push (wymaga serwera — łamie zasadę 1). Na iOS dochodzi warunek, że PWA musi być dodana do ekranu początkowego, a i wtedy powiadomienia bywają opóźnione o godziny.

  Praktyczny wniosek: **budzik przed nocką o 17:00 nie zadzwoni**, jeśli aplikacja jest zamknięta — a jest zamknięta zawsze, bo to sens tej funkcji.
- **Skutek.** Najważniejsza obietnica aplikacji („przypomni Ci we właściwym momencie”) nie da się dotrzymać w czystej PWA. To nie jest usterka do poprawienia — to granica technologii.
- **Proponowane rozstrzygnięcie.** **(B) zmienić technologię.** Opakowanie w Capacitor z wtyczką Local Notifications: silnik harmonogramu zostaje bez zmian (jest czystym TypeScriptem, bez zależności od przeglądarki), dochodzi warstwa, która oddaje wyliczone terminy systemowemu budzikowi. Koszt: konfiguracja dwóch sklepów, podpisy, aktualizacje. Na Androidzie dodatkowo uprawnienie do dokładnych alarmów (`SCHEDULE_EXACT_ALARM`) — aplikacja już wykrywa jego brak i pokazuje pasek z drogą wyjścia (B4).
- **Dowód.** `testy/harmonogram.test.ts` — 12 testów silnika, w tym sufit i pierwszeństwo. Ekran E5.4 pokazuje wyliczony harmonogram na 14 dni. Wykrywanie zgody na powiadomienia: `src/ekrany/ustawienia.tsx`, funkcja `popros`.

---

## 7. Sufit trzech powiadomień na dobę odrzuca 41% wyliczonych przypomnień

- **Założenie strategii.** Zasada 8: „Sufit 3 powiadomień na dobę z pierwszeństwem”. Sekcja 11, badanie obowiązkowe nr 7: „czy limit 3 powiadomień/dobę da się zrealizować przy pełnym grafiku”.
- **Co okazało się w praktyce.** Dla profilu przykładowego z włączonymi wszystkimi budzikami i pracą przy monitorze powyżej 4 godzin silnik wylicza **51 przypomnień na 14 dni**, z czego sufit odrzuca **21 (41%)**. Źródłem nadmiaru jest budzik „Przerwa przy monitorze” — przy dwunastogodzinnej zmianie generuje pięć przypomnień dziennie, czyli sam wyczerpuje sufit z nawiązką.
- **Skutek.** Sufit działa i chroni użytkownika przed zalewem, ale odrzuca rzeczy, o które ten sam użytkownik świadomie prosił. Przy pierwszeństwie z zasady 8 najczęściej ginie właśnie przerwa przy monitorze — a to jedyny budzik, którego wartość polega na regularności.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Trzy możliwości do rozstrzygnięcia z zespołem: (1) liczyć rytm w trakcie zmiany jako **jedno** powiadomienie serii, nie pięć; (2) podnieść sufit dla budzików rytmicznych, zostawiając 3 dla reszty; (3) zamienić przerwę przy monitorze na jedno przypomnienie na początku zmiany („dziś pamiętaj o przerwach co godzinę”). Prototyp pokazuje odrzucone pozycje wprost w podglądzie harmonogramu, więc decyzję da się podjąć na danych, a nie na wyczuciu.
- **Dowód.** `testy/pomiar-sufitu.test.ts` — wypisuje pomiar przy uruchomieniu. Podgląd odrzuconych: ekran E5.4, sekcja „Co i kiedy się odezwie”.

---

## 8. Brief pozwala podać sześć podstaw prawnych, a treść potrzebuje ich osiemdziesięciu sześciu

- **Założenie strategii.** Sekcja 12: „Nie wymyślaj kwot i podstaw prawnych poza podanymi — brakujące oznacz `[do uzupełnienia przez specjalistę]`”.
- **Co okazało się w praktyce.** Zasadę zastosowano dosłownie. W treściach jest **86 wystąpień** znacznika `[do uzupełnienia przez specjalistę]` wobec **sześciu** podstaw prawnych podanych w briefie (art. 130, 134, 151⁸, 229, 237⁹ § 3 Kodeksu pracy oraz ustawa z 4 kwietnia 2014 r. dla funkcjonariuszy). Innymi słowy: 93% kafli, werdyktów i kart praw czeka na autoryzację specjalisty.
- **Skutek.** Prototyp jest w pełni klikalny i pokazuje mechanikę, ale **nie nadaje się do testów z użytkownikami w części merytorycznej** — osoba testująca zobaczy nawias zamiast przepisu i słusznie straci zaufanie. Dla harmonogramu: praca prawnika jest zadaniem krytycznym, nie równoległym.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować mechanizm, zaplanować pracę.** Znacznik jest jednolity i policzalny (`grep -ro "do uzupełnienia przez specjalistę" content/ | wc -l`), więc postęp autoryzacji da się mierzyć. Przed testami z użytkownikami trzeba uzupełnić przynajmniej trzy pełne ścieżki sprawdzacza i ścieżkę wypadkową — to około 20 pozycji.
- **Dowód.** Polecenie powyżej; metryczka przy każdym module treści wskazuje, że autorem jest „redakcja BHPewnie (wymaga autoryzacji specjalisty)”.

---

## 9. Trzynaście pytań w trzy minuty — czego prototyp nie rozstrzygnie

- **Założenie strategii.** Sekcja 11, badanie obowiązkowe nr 4: „czy 13 pytań + dopytania mieści się w 3 minutach w teście z osobą 55+”.
- **Co okazało się w praktyce.** To pytanie wymaga ludzi, nie kodu. Prototyp dostarcza natomiast twardych danych wejściowych: **21 dotknięć** bez grafiku, **27** z grafikiem, jedno zagadnienie na ekran, samoczynne przejście po odpowiedzi. Przy trzech minutach daje to około **8,5 sekundy na ekran** — czas realny dla osoby wprawnej, napięty dla osoby, która czyta przykłady pod pytaniem, i za krótki dla kogoś, kto zakłada okulary.
- **Skutek.** Ryzyko dotyczy nie liczby pytań, lecz przykładów: to one wydłużają czytanie, i to one są najcenniejsze dla osoby, która nie wie, czy „czynniki biologiczne” jej dotyczą.
- **Proponowane rozstrzygnięcie.** **(C) rozstrzygnąć testem z użytkownikami**, mierząc osobno czas ekranów z dopytaniem (monitor, dźwiganie, kontakt) i bez. Jeśli próg trzech minut okaże się nieosiągalny, taniej jest zmienić próg niż odebrać przykłady.
- **Dowód.** Liczby dotknięć z `testy/e2e/p1-kreator.spec.ts`.

---

## 10. Trzy stany werdyktu bez czerwieni — czytelność potwierdzona konstrukcyjnie

- **Założenie strategii.** Zasada 6 i badanie obowiązkowe nr 5: „czy 3 stany werdyktu bez czerwieni są czytelne dla osób z zaburzeniami widzenia barw”.
- **Co okazało się w praktyce.** Konstrukcja werdyktu niesie stan trzema nośnikami naraz: **słowem** („Przysługuje Ci” / „To zależy” / „Nie przysługuje”), **kształtem ikony** (ptaszek / fala / kreska) i dopiero na końcu kolorem (zieleń / bursztyn / szarość). Test w skali szarości pozostaje jednoznaczny, bo słowo i kształt nie zależą od barwy. Sprawdzono też automatycznie, że stan „nie przysługuje” nie używa czerwieni.
- **Skutek.** Zakaz czerwieni z briefu okazał się korzystny: wymusił rozwiązanie, które i tak było potrzebne ze względu na daltonizm.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować.** Test z użytkownikami warto zawęzić do pytania, czy szarość nie jest odbierana jako „aplikacja się nie doczytała” zamiast „sprawdziliśmy i nie przysługuje”.
- **Dowód.** `testy/e2e/dostepnosc.spec.ts` — „stan werdyktu niesie ikona i słowo, nie sam kolor”; `testy/e2e/p5-sprawdzacz.spec.ts` — „żaden werdykt nie używa czerwieni” (sprawdza wyliczony kolor tła).

---

## 11. „Cisza po nocce” bez przełącznika — rozstrzygnięcie językowe, nie techniczne

- **Założenie strategii.** Zasada 8: „Cisza po nocce wyliczana z grafiku, automatycznie, bez przełącznika”. Badanie obowiązkowe nr 6: czy pozycja bez przełącznika jest zrozumiała.
- **Co okazało się w praktyce.** Technicznie działa: okno snu liczy się z końca zmiany nocnej plus 30 minut przez 7 godzin, bez udziału użytkownika. Problem jest w komunikacie. Pierwotna plakietka „AUTO” to skrót z języka techniki, obcy części odbiorców. Zastąpiono ją zwrotem **„samo się ustawia”** (rozstrzygnięcie z rejestru projektowego, punkt d).
- **Skutek.** Pozycja bez suwaka wygląda inaczej niż pozostałe i wymaga jednego spojrzenia więcej, ale nie da się jej przypadkiem wyłączyć — a to była intencja.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować, zweryfikować testem.** Pytanie do użytkownika: „co się stanie, jeśli tego dotkniesz?”. Jeśli odpowiedź brzmi „wyłączy się”, plakietka nie działa.
- **Dowód.** `testy/e2e/p2-p3-p9-budziki.spec.ts` — „cisza po nocce ma plakietkę bez żargonu i nie ma przełącznika” (sprawdza brak roli `switch`).

---

## 12. Ekran główny przy bogatym profilu: 27 kafli w jednej kolumnie

- **Założenie strategii.** Zasada 5: „Kafel bez konkretu nie istnieje” — każde uprawnienie ma swój kafel. Sekcja 5, E1.1: ekran główny pokazuje kafle uprawnień.
- **Co okazało się w praktyce.** Dla profilu przykładowego (praca zmianowa z nockami, kontakt z materiałem zakaźnym, praca w pojedynkę, własna odzież, umowa o pracę, 50+) silnik zwraca **27 kafli**. Pierwsza wersja pokazywała je wszystkie — ekran główny stał się ścianą nie do przeskanowania, a przyciski „Sprawdź” i „Pobierz kartę” wylądowały poza pierwszym ekranem.
- **Skutek.** Kluczowa akcja (dokument dla pracodawcy) przestała być widoczna bez przewijania. Dla odbiorcy 45+ długa lista bez hierarchii jest gorsza niż lista krótsza z wyjściem do reszty.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Ekran główny pokazuje **trzy kafle**, potem oba przyciski, a reszta jest pod „Pokaż wszystkie uprawnienia (27)”. Kolejność kafli nie jest przypadkowa: najpierw to, co da się policzyć w złotówkach i godzinach (grupa „pieniądze”, potem „czas pracy”), na końcu kafle niepewne. Rozstrzygnięcie zgodne z rejestrem projektowym, punkt c.
- **Dowód.** `src/silnik/reguly.ts` — sortowanie po grupie i pewności; `src/ekrany/stanowisko.tsx` — lista skrócona do trzech.

---

## 13. Dwa błędy interfejsu znalezione przez testy, nie przez oglądanie

Prototyp miał „znaleźć miejsca, gdzie założenia się nie sprawdzają”. Dwa z nich znalazły się same — w miejscach, których nie widać na zrzucie ekranu.

**Belka nawigacji zasłaniała koniec każdej długiej strony.** Belka dolna była przyklejona (`position: sticky`) nad przewijaną treścią, więc ostatnie przyciski ekranu głównego znajdowały się trwale pod nią i nie dawały się dotknąć. Test e2e wykrył to jako „kliknięcie trafia w belkę zamiast w przycisk”. Naprawa wymagała przebudowy powłoki: przewija się teraz tylko obszar treści, a belka i pasek numerów alarmowych są zwykłymi elementami układu. **Skutek dla użytkownika przed naprawą: niedostępny przycisk „Pobierz kartę moich uprawnień”.**

**Powiększenie do 200% rozpychało stronę w poziomie.** Wiersz z nagłówkiem sekcji i licznikiem uprawnień nie zawijał się, więc przy powiększeniu wymaganym przez WCAG 1.4.10 pojawiał się suwak poziomy. Naprawa: zawijanie w rzędach. **Skutek przed naprawą: naruszenie wymogu z sekcji 9 briefu.**

- **Proponowane rozstrzygnięcie.** **(C)** — oba naprawione, oba mają test pilnujący regresji.
- **Dowód.** `testy/e2e/dostepnosc.spec.ts` — „powiększenie do 200% nie wywołuje przewijania w poziomie”; przypadki kliknięć w `testy/e2e/p4-p6-stanowisko.spec.ts`.

---

## 14. Przerwa przy monitorze: uprawnienie mówi co godzinę, budzik co dwie

- **Założenie strategii.** Sekcja 4.3: „`przerwa_monitor`: 5 min po każdej godzinie”. Sekcja 6.7, tabela budzików: „Przerwa przy monitorze — **co 2 h** w trakcie zmiany”.
- **Co okazało się w praktyce.** Aplikacja mówi użytkownikowi, że przerwa należy mu się po każdej godzinie, a przypomina o niej co dwie. Wykonano zgodnie z briefem w obu miejscach, bo obie liczby są w nim wprost — ale na ekranie stoją obok siebie i wyglądają na pomyłkę.
- **Skutek.** Użytkownik może uznać, że aplikacja sama nie wie, co mu przysługuje — co uderza w jej jedyny kapitał, czyli wiarygodność.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** w jednym z dwóch miejsc, albo dopisać zdanie, które godzi obie liczby („przypominamy co dwie godziny, żeby nie zawracać Ci głowy co godzinę — prawo do przerwy masz po każdej”). Trzecia droga wynika z wpisu 7: zamienić serię na jedno przypomnienie na początku zmiany.
- **Dowód.** `content/parametry.json` (`przerwa_monitor`) wobec `src/silnik/harmonogram.ts` (`DEFINICJE_BUDZIKOW`, reguła „co 2 godziny w trakcie zmiany”).

---

## Do rozstrzygnięcia przez zespół — po wydaniu 1.1

1. **Stawka dodatku nocnego w materiałach promocyjnych** — wszędzie, gdzie pada „5,22 zł”, trzeba dopisać miesiąc albo podać widełki (wpis 1).
2. **Liczba ekranów w briefie** przed wysłaniem do wykonawcy: 58, nie 48 (wpis 2).
3. **Próg dotknięć w P1** — podnieść do ≤22 albo zmienić strukturę kreatora (wpis 3).
4. **Decyzja o Capacitorze** — bez niej przypomnienia pozostaną funkcją, która działa tylko przy otwartej aplikacji (wpis 6).
5. **Kształt budzika monitorowego** — trzy warianty w opisie wpisu 7.
6. **Harmonogram pracy prawnika** — 86 pozycji do autoryzacji, w tym około 20 krytycznych przed testami z użytkownikami (wpis 8).
7. **Sprzeczność „co godzinę / co dwie godziny”** (wpis 14).
8. **Pliki znaku Funduszy Europejskich i barw Rzeczypospolitej Polskiej** — pas oznaczeń w dokumentach ma opisane wymiary i kolejność, ale wektory muszą pochodzić z księgi wizualizacji.

---

# Zmiana 1.2 — wpisy 15–25

Wpisy poniżej powstały przy wykonywaniu zmiany 1.2 (przegląd zespołu merytorycznego z 2 września 2026). Osiem z nich odpowiada badaniom obowiązkowym z punktu 10 tamtego dokumentu; dwa dołożyliśmy, bo wyszły przy okazji.

---

## 15. Ekran E2.4 „wynik pośredni”: numer zarezerwowany w 1.1, opisany dopiero w 1.2

- **Założenie zmiany.** Punkt 4.4: „Pytania jedno na ekran, karta wyniku w trzech stanach, **E2.4 wynik pośredni**, wniosek, skrypt, przypomnienie — jak w 1.1”. Punkt 8: „w 1.1 grupa E2 miała po dodaniu E2.4 siedem ekranów”.
- **Co okazało się w praktyce.** W wydaniu 1.1 ekranu E2.4 **nie było**. Brief pierwotny przeskakiwał z E2.3 na E2.5 i nigdzie nie opisywał, czym miałby być E2.4 — rejestr ekranów odwzorowywał tę lukę wiernie (wpis 2). Zmiana 1.2 mówi o nim jak o czymś istniejącym i wlicza go do sumy 66.
- **Skutek.** Bez tego ekranu suma nie domyka się do 66. Zbudowaliśmy go, przyjmując znaczenie wynikające z nazwy: gdy odpowiedzi udzielone do tej pory już rozstrzygają sprawę, a do końca zostały **co najmniej dwa** pytania, pokazujemy to, co już wiadomo, i pozwalamy wybrać — „Pokaż wynik teraz” albo „Odpowiedz do końca”.
- **Dlaczego dwa, a nie jedno.** Przy jednym pytaniu do końca ekran pośredni tylko wydłużałby drogę: dwa dotknięcia zamiast jednego. Przy dwóch i więcej realnie oszczędza pracę. Regułę widać w `src/ekrany/sprawdz.tsx` (`zostaloPytan < 2`).
- **Proponowane rozstrzygnięcie.** **(C) opisać rozbieżność i zapytać.** Zespół merytoryczny ma potwierdzić, czy to jest ten ekran, który miał na myśli. Jeśli nie — treść jest w jednym komponencie i podmiana jest tania.
- **Dowód.** `src/ekrany/sprawdz.tsx` (`WynikPosredni`, `ocenPosrednio`), `testy/sprawdzacz.test.ts` („E2.4: wynik pośredni”), `testy/e2e/p5-sprawdzacz.spec.ts`.

---

## 16. „Pobierz kartę widoczny bez przewijania”: 347 pikseli poniżej krawędzi ekranu

- **Założenie zmiany.** Punkt 3.4: „Pozostaje: »Pobierz kartę moich uprawnień« (widoczny bez przewijania — to był błąd wykryty testem)”.
- **Co okazało się w praktyce.** Zmierzone na ekranie 393 × 727 px (Pixel 5, profil przykładowy): przycisk zaczyna się **347 px poniżej dolnej krawędzi**. Sam obowiązkowy zestaw z punktu 3.4 — kafel profilu (89 px), nowy pasek aktualizacji (98 px), panel sezonowy (126 px), nagłówek listy (20 px) i **trzy kafle uprawnień (525 px)** — zajmuje 858 px, czyli o 131 px więcej, niż ekran ma wysokości. Przycisk nie mieści się, zanim jeszcze go dołożymy.
- **Co zrobiliśmy.** Przesunęliśmy „Pobierz kartę” **przed** „Pokaż wszystkie (N)” i przed kartę aktualności — z 1163 px na 1074 px. Panel sezonowy pokazuje się teraz tylko w miesiącach maj–wrzesień (poza sezonem zdanie „Dziś 30 °C” i tak podważałoby wiarygodność aplikacji), co zdejmuje kolejne 126 px w pozostałej części roku.
- **Czego nie zrobiliśmy.** Nie zmniejszyliśmy liczby kafli do dwóch ani nie przenieśliśmy przycisku nad kafle — jedno i drugie łamie punkt 3.4 w innym miejscu.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Trzy drogi do wyboru: (1) uznać, że „bez przewijania” znaczy „bez przewijania do samego dołu” i zostawić jak jest; (2) skrócić kafle do dwóch wierszy (tytuł + konkret bez plakietki) — zejdzie po ~60 px z każdego; (3) zwinąć pasek aktualizacji do jednej linijki z ikoną. Test mierzy tę odległość przy każdym przebiegu, więc skutek każdej decyzji będzie widoczny w liczbach.
- **Dowód.** `testy/e2e/p4-p6-stanowisko.spec.ts` — wypisuje zmierzoną odległość; `src/ekrany/stanowisko.tsx`.

---

## 17. Zniesienie sufitu: 99 przypomnień w dwa tygodnie, do 13 na dobę

- **Założenie zmiany.** Punkt 1: sufit trzech powiadomień i reguła pierwszeństwa **usunięte**, budzik monitorowy przypomina **co godzinę**. Punkt 11: „Nie przywracać sufitu powiadomień w żadnej postaci”.
- **Co okazało się w praktyce.** Zrobione. Ale ta sama miara, która uzasadniała zniesienie sufitu, pokazuje teraz drugą stronę: przy profilu przykładowym z pełnym grafikiem i wszystkimi budzikami włączonymi wychodzi **99 przypomnień na 14 dni — średnio 9,9 na dobę, najwięcej 13 w jednej dobie**. W 1.1 sufit odrzucał 41% z nich; dziś nie odrzuca nic.
- **Skutek.** Trzynaście powiadomień w ciągu jednej doby to poziom, przy którym ludzie wyłączają wszystko naraz — a wtedy nie dostają także tego jednego, na którym im zależało. Ryzyko przesunęło się z „aplikacja ucina to, o co prosiłem” na „aplikacja hałasuje”.
- **Proponowane rozstrzygnięcie.** **(C) opisać rozbieżność i zapytać** — bez przywracania sufitu w żadnej postaci. Do rozważenia dwie drogi, które nie są sufitem: (1) budzik monitorowy jako **jedno** powiadomienie na początku zmiany („dziś pamiętaj o przerwie po każdej godzinie”) zamiast serii — zdejmuje 7–11 pozycji dziennie; (2) przełącznik przy każdym budziku uzupełniony o wybór „przypominaj: zawsze / raz dziennie”, czyli decyzja użytkownika zamiast decyzji aplikacji. Rozstrzygnąć **przed** testami z ludźmi, bo to jest właśnie to, co wyjdzie na testach.
- **Dowód.** `testy/pomiar-przypomnien.test.ts` — wypisuje rozkład dobowy przy każdym przebiegu.

---

## 18. Badanie 1: karta z dopytaniem mieści się, ale bez zapasu

- **Co badaliśmy.** Punkt 10.1: czy dopytanie na kaflu (E1.2) nie wydłuża karty tak, że trzy akcje spadają poza ekran przy 16 px i przy powiększeniu 150%.
- **Wynik.** Mieszczą się. Przy powiększeniu 150% na 393 × 727 px trzy akcje są osiągalne, a strona nie przewija się w bok. Pomogła tu konstrukcja karty: dopóki warunek nie jest rozstrzygnięty, karta pokazuje **wyłącznie** tytuł, stan i pytanie — uzasadnienie, blok „ile”, podstawa prawna i akcje pojawiają się dopiero po odpowiedzi. Karta nigdy nie jest długa i pytająca jednocześnie.
- **Zastrzeżenie.** Zapasu nie ma. Dołożenie do karty jednego bloku (np. „historia Twoich odpowiedzi”) wypchnie trzecią akcję poza ekran przy 150%.
- **Dowód.** `testy/e2e/dostepnosc.spec.ts` — „E1.2: trzy akcje są osiągalne przy powiększeniu 150%”.

---

## 19. Badanie 2: „SPRAWDŹ JEDEN WARUNEK” — dwie alternatywy do testu z ludźmi

- **Co badaliśmy.** Punkt 10.2: czy plakietka jest zrozumiała bez tłumaczenia; zaproponować dwie alternatywy.
- **Nasza wątpliwość.** „Warunek” to słowo z rejestru prawniczego, a nie z rozmowy w szatni. Użytkownik widzi je w chwili, gdy jeszcze nie wie, że aplikacja o coś zapyta — plakietka nazywa więc mechanizm, a nie to, co ma zrobić. Wielkie litery dodatkowo czytają się jak ostrzeżenie, choć nic złego się nie stało.
- **Dwie alternatywy do testu.**
  1. **„ZAPYTAMY O JEDNO”** — mówi, co się stanie po dotknięciu, i nie używa słowa „warunek”.
  2. **„ZALEŻY OD JEDNEJ RZECZY”** — nazywa stan, a nie czynność; blisko brzmienia bursztynowego werdyktu („To zależy”), więc spójne z resztą aplikacji.
- **Proponowane rozstrzygnięcie.** **(C) zapytać ludzi.** Trzy warianty, po pięć osób na wariant, pytanie kontrolne: „co się stanie, jak to dotkniesz?”. Zmiana brzmienia to jedna pozycja w `content/teksty.json` (`kafel.sprawdz_warunek`) — bez dotykania kodu.
- **Dowód.** `content/teksty.json`, `src/ekrany/stanowisko.tsx` (`ZnacznikStanu`).

---

## 20. Badanie 3: „Nie wiem” w pakiecie umowy zaniża wynik

- **Co badaliśmy.** Punkt 10.3: czy próg 5–6 / 3–4 / 0–2 jest rozsądny przy odpowiedziach „Nie wiem”.
- **Wynik.** Zgodnie z punktem 5.2 „Nie wiem” liczy się jako zero. Konsekwencja: osoba, która sześć razy odpowie „Nie wiem”, dostaje **0 punktów i werdykt szary** — „Twoja umowa wygląda na zlecenie. Nic nie musisz robić”. To jest zdanie fałszywie uspokajające: aplikacja nie wie nic o tej umowie, a mówi, że wszystko w porządku.
- **Skutek.** Najbardziej niepewny użytkownik dostaje najbardziej stanowczą odpowiedź. To odwrotność tego, co robi reszta aplikacji (wartości bezpieczne przy pominiętych pytaniach kreatora pokazują **więcej**, nie mniej).
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Trzy lub więcej odpowiedzi „Nie wiem” powinny kierować do werdyktu **bursztynowego** niezależnie od sumy punktów, z blokiem „do sprawdzenia” złożonym z tych właśnie pytań („Czyj sprzęt wykorzystujesz w pracy”, „Kto rozstrzyga, jak masz wykonać zadanie”). Zdania do tego bloku są już napisane w `punktacja.opisy_braku` — brakuje wyłącznie reguły progowej. Nie wprowadziliśmy jej sami, bo punkt 5.2 podaje punktację wprost, a to rozstrzygnięcie merytoryczne, nie techniczne.
- **Dowód.** `content/sytuacje/08-umowa.json` (`punktacja`), `testy/sprawdzacz.test.ts` — „«Nie wiem» liczy się jako zero punktów”.

---

## 21. Badanie 4: przycisk „Zaczynam / Kończę” a zamknięcie aplikacji

- **Co badaliśmy.** Punkt 10.4: czy stan „w trakcie” przeżywa zamknięcie i restart; co zrobić, gdy użytkownik zapomni nacisnąć „Kończę”.
- **Wynik części pierwszej.** Przeżywa. „Zaczynam” zapisuje wpis do pamięci urządzenia natychmiast, z pustą godziną zakończenia; po restarcie ekran E7.1 odtwarza licznik z zapisanej godziny rozpoczęcia. Nie ma tu żadnego stanu trzymanego wyłącznie w pamięci karty przeglądarki.
- **Wynik części drugiej.** Zaproponowaliśmy i wykonaliśmy zachowanie: wpis otwarty z **wcześniejszego dnia** jest traktowany jako zapomniany, a nie jako trwający dyżur. Przy następnym otwarciu E7.1 pokazuje pas: „24 września nie zamknąłeś dnia. Zacząłeś o 07:00. O której skończyłeś?” z przejściem do edycji wpisu. Aplikacja **nie zgaduje** godziny zakończenia i nie kasuje wpisu.
- **Czego nie rozstrzygnęliśmy.** Dyżur przekraczający dobę (24 h i dłużej) będzie tu fałszywie oznaczony jako zapomniany. W ochronie zdrowia i w służbach to nie jest przypadek teoretyczny.
- **Dowód.** `src/silnik/ewidencja.ts` (`zapomnianyDzien`), `testy/ewidencja.test.ts`, `src/ekrany/czas-pracy.tsx` (pas `zapomniany-dzien`).

---

## 22. Badanie 5: zmiana czasu urzędowego skracała nockę o godzinę — błąd naprawiony

- **Co badaliśmy.** Punkt 10.5: czy `fakt_min` liczy się poprawnie przy zmianie czasu urzędowego w trakcie otwartego wpisu.
- **Co znaleźliśmy.** Nie liczył się. Wpis przechodzący przez północ domykaliśmy, dodając do godziny zakończenia **86 400 000 ms**. W nocy zmiany czasu doba ma 23 albo 25 godzin, więc nocka 22:00–06:00 z 24 na 25 października 2026 wychodziła jako **8 godzin zamiast 9**, a z 28 na 29 marca jako 8 zamiast 7. Ten sam błąd był w `ramyZmiany` w silniku grafiku, czyli dotyczył też planu i przypomnień przy nocce.
- **Poprawka.** Koniec liczymy jako **tę samą godzinę następnego dnia kalendarzowego**, nie „plus 24 godziny”. Trzy testy pilnują trzech przypadków: noc cofnięcia zegarów (9 h), noc przestawienia do przodu (7 h) i zwykła nocka (8 h).
- **Skutek uboczny.** Testy jednostkowe chodzą teraz w strefie `Europe/Warsaw` (`vite.config.ts`). W kontenerze UTC zmiana czasu nie istnieje, więc ten błąd był tam niewykrywalny — i przez całe wydanie 1.1 pozostawał niewidoczny.
- **Dowód.** `src/silnik/ewidencja.ts` (`ramyWpisu`), `src/silnik/grafik.ts` (`ramyZmiany`), `testy/ewidencja.test.ts` — „ewidencja a zmiana czasu urzędowego”.

---

## 23. Badanie 6 i 7: rozmiar dokumentu miesiąca i fałszywe alarmy wyzwalacza rytmu

- **Badanie 6 — rozmiar dokumentu.** Ewidencja pełnego miesiąca mieści się na **jednej lub dwóch stronach A4**; test e2e sprawdza to na wygenerowanym pliku (`getPageCount() <= 2`). Wiersz zajmuje 13 punktów, więc 31 dni to 403 punkty przy 730 punktach użytecznej wysokości strony; druga strona wchodzi dopiero przy uwagach do wpisów i wykazie sygnałów. Nagłówek tabeli powtarza się na każdej stronie.
- **Badanie 7 — fałszywe alarmy wyzwalacza.** Wyzwalacz z punktu 6.5 **nie odpala się** przy pojedynczych nadgodzinach. Rozstrzyga to jedna decyzja konstrukcyjna: liczymy odstępstwo tylko wtedy, gdy przesunięty jest **początek** dniówki. Przesunięty sam koniec przy niezmienionym początku to nadgodziny, a nie zmianowość. Trzy dni 08:00–19:00 (trzy godziny nadliczbowe każdego dnia) dają zero odstępstw; trzy dni 14:00–22:00 dają trzy i uruchamiają pytanie.
- **Czego nie sprawdziliśmy.** Nie mamy danych z prawdziwych grafików, więc próg „3 wpisy w 14 dni” pozostaje wartością z dokumentu, nie z pomiaru. Po pierwszych testach z ludźmi warto go przeliczyć na realnych wpisach.
- **Dowód.** `testy/e2e/p11-p12-ewidencja.spec.ts`, `testy/ewidencja.test.ts` — „badanie 7: pojedyncze nadgodziny NIE uruchamiają pytania”.

---

## 24. Badanie 8: pakiet umowy podnosi P1 do 22 dotknięć — dokładnie do progu

- **Co badaliśmy.** Punkt 10.8: czy ekran przejściowy pakietu umowy (5.1) nie podnosi liczby dotknięć ponad 22/30.
- **Wynik pomiaru.** Kreator bez grafiku, umowa o pracę: **21 dotknięć**. Ten sam kreator z wyborem zlecenia i ekranem przejściowym: **22 dotknięcia** — ekran przejściowy kosztuje dokładnie jedno. Pełna konfiguracja z grafikiem: **27 dotknięć** (próg 30 dotrzymany).
- **Czyli.** Próg 22 jest dotrzymany, ale bez zapasu: dowolne dołożone pytanie go przekracza. Warto pamiętać, że próg z briefu pierwotnego brzmiał „≤17” i był nieosiągalny już w 1.1 (wpis 3) — zmiana 1.2 podnosi go do 22, co czyni go realnym, ale napiętym.
- **Uwaga konstrukcyjna.** Ekran przejściowy jest **panelem na E0.18**, a nie osobnym ekranem mapy. Gdyby był osobnym ekranem, grupa E0 miałaby 24 pozycje i suma nie zgadzałaby się z 66.
- **Dowód.** `testy/e2e/p1-kreator.spec.ts` — trzy pomiary wypisywane przy każdym przebiegu.

---

## 25. Cztery pozostałe sytuacje domknięte — i dwie liczby, których nie wpisaliśmy

- **Założenie zmiany.** Punkt 4.4: „Zaimplementuj w pełni sytuacje 1, 2, 6 i 8; pozostałe jako plansze »w pełnej wersji«, **jeśli czas nie pozwoli na więcej**”.
- **Co zrobiliśmy.** Czas pozwolił. Sytuacje 3 (środki ochrony), 4 (badania okresowe), 5 (szkolenie BHP) i 7 (zimno i ciasnota) mają pełne ścieżki z pytaniami i regułami wprost z tabeli 4.3. W zakładce „Mam sprawę” nie ma już ani jednej planszy „w pełnej wersji” — osiem pozycji, osiem werdyktów.
- **Nowy mechanizm redakcyjny.** Tabela 4.3 przy sytuacji 3 mówi: „czego brakuje (**lista z cech profilu**)”. Silnik sprawdzaczy miał dotąd wyłącznie opcje wpisane na sztywno. Dołożyliśmy pole `zrodlo_opcji: "cechy_profilu"` — pytanie buduje wtedy listę z cech aktywnych na TYM stanowisku, a etykiety leżą w `etykiety_cech` sytuacji, więc treść zostaje w danych. Cecha pominięta w kreatorze zostaje na liście, bo wartość bezpieczna każe pokazywać więcej, nie mniej. Profil przykładowy (chemia, biologia) widzi dwie pozycje zamiast jedenastu.
- **Czego NIE wpisaliśmy.** Punkt 4.3 przy sytuacji 7 wymienia „min. 18 °C / 14 °C, **kubatura**” — podaje temperatury, ale nie podaje liczby dla kubatury ani wolnej powierzchni. Temperatury weszły jako parametry z datami obowiązywania (`temperatura_min_biurowa`, `temperatura_min_fizyczna`), oba ze źródłem oznaczonym `[do potwierdzenia przez specjalistę]`. Normy kubatury **nie zostały wymyślone**: werdykt o ciasnocie mówi wprost „[do uzupełnienia przez specjalistę]” i prowadzi do przeglądu stanowiska, zamiast podawać liczbę, której dokument nie zawiera.
- **Poprawka przy okazji.** Podstawianie parametrów obejmowało uzasadnienie, blok „ile” i „do sprawdzenia”, ale **nie nagłówek**. Nagłówek „Przy pracy biurowej przysługuje Ci {temperatura_min_biurowa}” pokazywałby surowy nawias. Naprawione — nagłówek też jest wypełniany.
- **Dowód.** `content/sytuacje/03-srodki.json`, `04-badania.json`, `05-szkolenie.json`, `07-zimno.json`; `src/silnik/sprawdzacz.ts` (`opcjeZCech`, `wypelnijWerdykt`); `testy/sprawdzacz.test.ts` (cztery bloki „sytuacja 3/4/5/7”); `testy/e2e/p5-sprawdzacz.spec.ts`.

---

# Wdrożenie designu 1.2 — wpisy 26–31

3 września 2026 wróciła odpowiedź projektowa na `dokumentacja/ZLECENIE_DESIGN_1_2.md` (pakiet `PRZEKAZANIE_DESIGN_1_2.md`, kanwa `System BHPewnie v2.dc.html`, 19 rozstrzygnięć w `dokumentacja/ROZBIEZNOSCI_DESIGN.md`). Wpisy poniżej opisują, co z niej weszło do kodu i gdzie kod z nią się rozjechał.

---

## 26. Wpis 16 zamknięty: „Pobierz kartę” 347 px pod zgięciem → 214 px nad nim

- **Co było.** Zestaw obowiązkowy z punktu 3.4 zmiany 1.2 zajmował 858 px przy ekranie 727 px. Przycisk do dokumentu zaczynał się **347 px poniżej krawędzi**. Wpis 16 stawiał zespołowi wybór: trzy kafle albo droga do dokumentu.
- **Co zrobił projekt.** Zdjął wybór, zamiast go rozstrzygać. Ekran ma teraz **cztery warstwy**: nagłówek stały (223 px), pole kafli (`flex: 1; min-height: 0`), stały pas akcji z dokumentem (68 px), pas nawigacji. Rozciąga się **wyłącznie pole kafli**, więc żadna treść nie może wypchnąć dokumentu.
- **Drugi zabieg — kafel.** Wysokość zewnętrzna **104 px** zamiast 127–247 px: tytuł do dwóch linii, konkret do jednej z obcięciem. Trzy kafle zajmują **328 px** zamiast 525 px. Pełna treść konkretu stoi na karcie uprawnienia — i tak było od 1.1.
- **Zmierzone po wdrożeniu.** Przycisk zaczyna się **214 px NAD** dolną krawędzią. Test nie sprawdza już osiągalności po przewinięciu, tylko widoczność bez przewijania, i osobno to, że rozwinięcie pełnej listy 27 kafli nic nie zmienia.
- **Pułapka warta zapamiętania.** Blok bez `min-height: 0` w kolumnie flex ma `min-height: auto` i nie kurczy się poniżej swojej zawartości. To był pierwotny powód, dla którego przyciski uciekały pod belkę.
- **Dowód.** `src/style/globalne.css` (`.ekran--warstwowy`, `.warstwa-*`, `.kafel`), `testy/e2e/p4-p6-stanowisko.spec.ts` — cztery testy, w tym pomiar wypisywany przy każdym przebiegu.

---

## 27. Sześć stanów kafla rozdzielone na dwie osie — cztery stany i znacznik

- **Co było.** Sześć stanów na jednej osi: `przysluguje`, `sprawdz_warunek`, `zalezy`, `nie_przysluguje`, `niepewny`, `wygaszony`.
- **Co znalazł projekt.** Na jednej osi siedziały **dwie różne rzeczy**. `niepewny` i `wygaszony` nie były stanami werdyktu — mówiły o **wieku odpowiedzi**, i różniły się między sobą wyłącznie kolorem obrysu przerywanego, czyli w praktyce niczym.
- **Co zrobiliśmy.** Werdykt ma **cztery stany**; wiek odpowiedzi to osobna oś (`swiezosc`) z jednym znacznikiem „Do odświeżenia”, który staje na każdym z czterech i **nie podmienia znaku werdyktu**. Kafel po dacie ważności parametru dalej mówi, czy uprawnienie przysługuje, zamiast tracić werdykt.
- **Skutek w sortowaniu.** „Do odświeżenia” idzie na koniec **swojego stanu**, nie na koniec listy. Kafel „przysługuje” oparty na starszej odpowiedzi stoi przed kaflem „nie przysługuje”, bo nadal mówi użytkownikowi, że coś mu się należy. Test sortowania przepisany z jednej osi na dwie.
- **Zasada 9 działa niezależnie.** Nieaktualna liczba nie pokaże się w żadnym stanie, bo podmienia ją `wypelnij()` na poziomie tekstu, a nie stanu kafla.
- **Dowód.** `src/typy.ts` (`StanKafla`, `Swiezosc`), `src/silnik/reguly.ts` (`stanKafla`), `testy/silnik.test.ts`, `testy/e2e/p4-p6-stanowisko.spec.ts`.

---

## 28. Znaki ✓ ~ — wycofane; tabela na telefonie zastąpiona listą

- **Znaki.** Myślnik czytał się jak interpunkcja, a fala jak literówka. Trzy nowe znaki są rysowane jako SVG i różnią się **konturem**: pełna krzywa, koło wypełnione do połowy, koło przekreślone. Doszedł czwarty — znak zapytania dla stanu nierozstrzygniętego, który **nie jest** znakiem werdyktu, bo werdyktu jeszcze nie ma.
- **Tabela.** Na telefonie nie występuje. Ewidencja (E7.3) to **lista dni**: wiersz 62 px z datą, faktem i różnicą w pierwszej linii, planem i przerwami w drugiej jako zdanie. Porównanie form zatrudnienia (E2.8) to **lista ośmiu par**, w której nagłówek stoi przy danej, a nie 300 px wyżej w wierszu tabeli. Tabela zostaje komponentem systemu i wchodzi od **600 px** oraz do dokumentów A4.
- **Odnośnik „Zobacz tabelę”** w E7.3 pokazuje pełną pięciokolumnową siatkę tym, którzy jej chcą. Przewijane pudełko zachowuje osiągalność z klawiatury i obrys skupienia — to była realna wada dostępności znaleziona testem axe w 1.2.
- **Wartości w liście par też niosą znak.** „Nie” bez znaku byłoby jedynym miejscem w aplikacji, gdzie odmowa nie ma kształtu.
- **Dowód.** `src/komponenty/podstawowe.tsx` (`ZnakWerdyktu`), `src/ekrany/czas-pracy.tsx` (`.wiersz-dnia`), `src/ekrany/sprawdz.tsx` (`.para`), `testy/e2e/p10-umowa.spec.ts`, `testy/e2e/p11-p12-ewidencja.spec.ts`.

---

## 29. Trzy reguły zmieniły brzmienie — nazywają powód zamiast miejsca

Projekt nie złamał żadnej z ośmiu reguł, ale trzy przepisał tak, żeby rozstrzygały same przy następnym module.

| reguła | było | jest |
|---|---|---|
| 3 — cele dotykowe | „72 px **w Pomocy**” | „72 px **dla czynności wykonywanej w pośpiechu lub w rękawicy**” |
| 8 — cienie | „cieni nie ma” | „cień dopuszczalny wyłącznie jako **1 px podniesienia karty**, nigdy jako źródło hierarchii” |
| terakota | „wyłącznie moduł Pomoc” | „**ryzyko, które stwarza drugi człowiek**” |

- **Co z tego wynika w kodzie.** Przycisk „Zaczynam pracę” w E7.1 zostaje przy 72 px i **testy dostępności obejmują go tak samo jak Pomoc**, zamiast być o niego osłabione. Karty dostają `box-shadow: 0 1px 2px rgba(20,22,26,0.05)` w trybie jasnym; w ciemnym cienia nie ma. Promienie to 8 / 12 / 14 / 999 zamiast 6 / 10 / 14 / 999.
- **Moje złamanie reguły terakoty rozstrzygnięte na pół.** Ostrzeżenie w pakiecie umowy (E2.3) **dostaje** terakotę i nazwaną formę „ostrzeżenie o ryzyku ze strony drugiej osoby”: obrys 2 px, plakietka wersalikami, **jedno** wyjście do Pomocy. Błędy walidacji formularza terakoty **nie dostają** — mają własny, cichszy stan: obrys 2,5 px atramentowy, znak wykrzyknika przy polu, zdanie pod polem. Różnica jest funkcjonalna: Pomoc **daje wyjście**, ostrzeżenie **wstrzymuje krok**, a pomyłka we wpisie nie jest ryzykiem ze strony człowieka.
- **Poprawka dostępności przy okazji.** Zdanie o błędzie musiało wyjść poza `<label>`: wewnątrz zmieniało dostępną nazwę pola, więc czytnik ekranu odczytywałby „Do, przerwa wychodzi poza godziny wpisu” zamiast nazwy pola. Jest podpięte przez `aria-describedby`.
- **Dowód.** Nagłówek `src/style/globalne.css` (osiem reguł w nowym brzmieniu), `dokumentacja/ROZBIEZNOSCI_DESIGN.md` wpisy (l), (p), (q).

---

## 30. Dwa miejsca, w których pakiet projektowy rozjechał się z aplikacją

### 30a. Belka nawigacji w makietach cofa nazwy zakładek ze zmiany 1.2

- **Co pokazuje projekt.** Wszystkie makiety §8 mają na dole **„Moje · Sprawdź · Mój czas · Pomoc”**.
- **Co to zmienia.** Po pierwsze cofa nazwy zakładek, które zmiana 1.2 wprowadza w punkcie 2 wraz z uzasadnieniem („Moje stanowisko” → **Co mi przysługuje**, „Sprawdź” → **Mam sprawę**). Po drugie **usuwa z nawigacji Aktualności** (grupa E3, trzy ekrany) i wstawia w to miejsce Mój czas, czyli podnosi grupę E7 do rangi zakładki. Mapa ekranów z punktu 8 zmiany 1.2 tego nie przewiduje.
- **Rozstrzygnięcie zamawiającego (3 września 2026).** „Cofa, bo Claude Design nie wie co my tu robiliśmy, może mu za mało dałeś informacji”. Czyli: to **nie jest propozycja projektowa, tylko luka w moim zleceniu**. `ZLECENIE_DESIGN_1_2.md` opisywało pojedyncze ekrany do poprawienia (E1.1, E1.2, grupa E7) i nie zawierało ani mapy ekranów, ani nazw zakładek, ani listy decyzji produktowych, których zmiana 1.2 już dokonała. Projektant rysował belkę z tego, co widział — czyli z niczego.
- **Wniosek dla trybu pracy, nie dla CSS.** Rysunek, który cofa decyzję nieopisaną w zleceniu, jest **wadą zlecenia**, a nie propozycją do rozważenia. Nie ma czego rozstrzygać po stronie produktu: nazwy zakładek ze zmiany 1.2 zostają, Aktualności zostają w belce, a zlecenie dostało brakujący kontekst (sekcja 0 w `ZLECENIE_DESIGN_1_2.md`: mapa 66 ekranów w skrócie, cztery zakładki z nazwami i uzasadnieniem, sześć decyzji produktowych zamkniętych zmianą 1.2, oraz zdanie o tym, co robić przy rysunku wykraczającym poza zamówiony zakres).
- **Co przenosimy do następnej rundy.** Każde kolejne zlecenie projektowe zaczyna się od tej sekcji. Koszt to jedna strona tekstu; koszt jej braku to runda rysunków, z której trzeba ręcznie wyławiać, co jest propozycją, a co przypadkiem.
- **Dowód.** `dokumentacja/ZLECENIE_DESIGN_1_2.md` sekcja 0; `testy/e2e/p4-p6-stanowisko.spec.ts` — test „zakładki nazywają się «Co mi przysługuje» i «Mam sprawę»” pilnuje nazw od zmiany 1.2 i przeszedłby na czerwono, gdyby makieta weszła dosłownie.

### 30b. „Wersaliki w jednym miejscu” przeczyło własnym makietom pakietu — rozstrzygnięte

- **Co pisze pakiet.** „Wersaliki: w całej aplikacji **jedno** miejsce — plakietka ostrzeżenia o ryzyku”.
- **Co pokazują jego makiety.** Wersaliki w małych etykietach: „Ile to jest”, „Przepracowane”, „Nad planem”, „Podgląd dokumentu”, „Do sprawdzenia” — czyli w całym wzorcu `.oczko`, którym aplikacja posługuje się od 1.1.
- **Rozstrzygnięcie zamawiającego (3 września 2026).** „Zasięg wersalików — zdecyduj za mnie”. Poniżej decyzja i jej powód.
- **Decyzja: zasięg liczy się formą, nie miejscem.** Wersaliki wolno stosować wyłącznie tam, gdzie tekst jest **plakietką — etykietą nazywającą kategorię, nie zdaniem do przeczytania**. To pięć wzorców i ani jednego więcej:

| wzorzec | co to jest | dlaczego wolno |
|---|---|---|
| `.oczko` | etykieta nad daną („ILE TO JEST”) | nazywa kategorię danej; makiety pakietu same jej używają |
| `.plakietka-auto` | „SAMO SIĘ USTAWIA” przy budziku | ta sama forma, inne miejsce |
| `.ostrzezenie-ryzyka__plakietka` | plakietka ostrzeżenia | jedyne miejsce wskazane przez pakiet wprost |
| `.sygnal__naglowek` | nazwa sygnału na karcie E7.4 | nazywa rodzaj sygnału, nie opisuje go |
| `.dokument h4` | nagłówek karty i wniosku A4 | konwencja druku urzędowego — to **nie jest interfejs aplikacji** |

- **Czego wersaliki nie dotykają.** Plakietek stanu kafla, nagłówków tabel, przycisków, nagłówków ekranów i jakiegokolwiek zdania. Dwie poprawki, które pakiet wskazał wprost jako błąd, zostały wykonane: plakietka stanu kafla mówi teraz „Zapytamy o jedno” małymi literami zamiast „SPRAWDŹ JEDEN WARUNEK”, a nagłówki tabeli ewidencji straciły wersaliki.
- **Dlaczego tak, a nie dosłownie „jedno miejsce”.** Wersaliki w plakietce robią robotę, której nie zrobi nic innego: odróżniają **etykietę od treści** przy różnicy rozmiaru zaledwie 2–3 px, bez dokładania koloru ani ramki. Zdjęcie ich z `.oczko` w całej aplikacji kosztowałoby albo dodatkowy kolor, albo dodatkową kreskę — czyli więcej hałasu, nie mniej. Zdanie z pakietu czytamy więc jako opis **dwóch konkretnych poprawek**, którymi w istocie było; makiety tego samego pakietu potwierdzają to mocniej niż jego własne zdanie podsumowujące.
- **Jak to jest pilnowane.** Test przechodzi przez **cztery ekrany** (E1.1, E1.3, budziki, E7.3 z tabelą i E7.5) i zbiera każdy element z `text-transform: uppercase`, którego klasa nie należy do piątki powyżej. Lista musi być pusta. Ekrany dobrane tak, żeby każdy niósł inny wzorzec wersalikowy — inaczej test pilnowałby jednej strony i przepuszczał resztę.
- **Dowód.** `src/style/globalne.css` (pięć reguł `text-transform: uppercase`, nagłówek pliku), `testy/e2e/p4-p6-stanowisko.spec.ts` — „wersaliki tylko w plakietkach i w nagłówku dokumentu”.

---

## 31. Sześć pozostałych elementów pakietu — i wygaszenie, które kłamało

Pierwsza tura wdrożenia (wpisy 26–30) objęła fundament: warstwy, kafel 104 px, dwie osie stanu, znaki werdyktu, tabela na telefonie. Ta domyka pakiet.

- **Przełącznik zakresu i blok sumy (E7.3).** Tydzień i miesiąc przełącza się torem segmentów (`aria-pressed`), a nie dwoma przyciskami. Sumy stoją w bloku dwóch liczb po 28 px rozdzielonych pionową kreską: „Przepracowane” i „Ponad plan”. Wcześniej były wierszami listy, przez co godzina przepracowana wyglądała tak samo jak liczba dni z sygnałem.
- **Karta sygnału (E7.4).** Nagłówek 19 px nazywa sygnał słowami („Doba bez 11 godzin odpoczynku”), pod nim kreska, data pismem tabelarycznym i zdanie „Co mogę z tym zrobić”. Nazwa sygnału była dotąd wyłącznie w treści opisu, więc lista czterech sygnałów czytała się jak cztery akapity.
- **Miniatura A4 (E7.5).** Podgląd ma proporcję `210 / 297` i pismo 8 px — pokazuje **ile z miesiąca wejdzie na stronę**, a nie treść do czytania. Pełny podgląd w rozmiarze ekranu udawał dokument, którym nie był. Dla czytnika ekranu miniatura jest `aria-hidden`, a obok stoi ten sam zestaw danych zdaniami.
- **Plakietka kolumny w E2.8.** Porównanie form zatrudnienia oznacza kolumnę odpowiadającą umowie użytkownika („to Twoja obecna umowa”). Bez tego obie kolumny były równorzędne i nie było wiadomo, która jest „teraz”.
- **Trzecia odpowiedź na E1.2.** „Nie wiem — zapytam później” zostawia warunek nierozstrzygnięty i wraca do listy. Dwie odpowiedzi zmuszały do zgadywania, a zgadnięta odpowiedź trafiała do wyliczeń tak samo jak znana.
- **Wygaszenie liczone z treści, nie z motywu.** Gradient na dole pola kafli miał stałą wysokość i stał także wtedy, gdy nie było czego wygaszać — czyli sugerował treść pod krawędzią tam, gdzie jej nie było. Teraz liczy się z faktycznego nadmiaru (`scrollHeight − clientHeight − scrollTop`) przez `ResizeObserver`: **40 px** przy dużym nadmiarze, **12 px** przy małym, **0 px** gdy lista się mieści. To był jedyny element pakietu, który wprowadzał użytkownika w błąd, a nie tylko wyglądał gorzej.
- **Dowód.** `src/ekrany/czas-pracy.tsx`, `src/ekrany/sprawdz.tsx`, `src/ekrany/stanowisko.tsx`, `src/style/globalne.css` (`.tor-segmentow`, `.blok-sumy`, `.miniatura-a4`, `.wygaszenie`); `testy/e2e/p11-p12-ewidencja.spec.ts`, `testy/e2e/p10-umowa.spec.ts`, `testy/e2e/p4-p6-stanowisko.spec.ts`.

---

# Zmiana 1.3 — wpisy 32–39

Zmiana 1.3 (rozstrzygnięcia zespołu z 3 września 2026) odpowiada na listę „Do rozstrzygnięcia — po zmianie 1.2”. Sześć z ośmiu punktów zostało zamkniętych, dwa zostają otwarte świadomie: brzmienie plakietki czeka na test z ludźmi, a `aria-live` licznika na test z NVDA i TalkBack. Wpisy poniżej opisują, co z tego weszło do kodu i co przy okazji wyszło.

---

## 32. Wybór częstotliwości zdejmuje 82 przypomnienia — ale nie tam, gdzie zespół się spodziewał

- **Rozstrzygnięcie.** Sufit nie wraca. Każdy budzik rytmiczny dostaje wybór: **„raz dziennie”** (jedno powiadomienie obejmujące całą serię) albo **„za każdym razem”** (dawne zachowanie). Domyślnie „raz dziennie”, bo domyślne „za każdym razem” byłoby decyzją aplikacji podjętą za człowieka.
- **Pomiar, wariant domyślny.** Profil przykładowy, pełny grafik, wszystkie budziki włączone: **17 przypomnień na 14 dni, średnio 1,2 na dobę, najwięcej 2 w jednej dobie.** Zero odrzuconych. Rozkład: przerwa przy monitorze 8, cisza po nocce 4, prasówka 2, protokół przed nocką 2, powrót po Pomocy 1.
- **Pomiar, wariant głośny.** Wszystko przestawione na „za każdym razem”: **99 przypomnień, średnio 7,1 na dobę, najwięcej 13.** To liczba **co do jednego identyczna** z pomiarem 1.2 — czyli wybór „za każdym razem” naprawdę wraca do dawnego zachowania, a nie do jego przybliżenia.
- **Wyszło niżej niż oczekiwane 25–30 — i wiadomo dlaczego.** Szacunek zespołu zakładał mniej więcej dwa przypomnienia na każdy z czternastu dni. Profil przykładowy pracuje jednak **8 dni z 14** (cztery dniówki, cztery nocki, sześć dni wolnych), a przypomnienia rytmiczne odzywają się wyłącznie w dni robocze. Do tego terminy (badania 4 listopada, szkolenie 31 grudnia) wypadają **poza oknem czternastu dni** i nie dokładają nic. Osiem dni razy jedno przypomnienie plus cztery ciszy po nocce, dwie prasówki, dwa protokoły i jeden powrót daje dokładnie 17.
- **Czego to nie znaczy.** Przy grafiku pięciodniowym z monitorem liczba wzrośnie do około 10 dni roboczych, czyli **około 21 przypomnień na 14 dni**. Rząd wielkości zostaje ten sam.
- **Dowód.** `testy/pomiar-przypomnien.test.ts` — dwa pomiary wypisywane przy każdym przebiegu; `testy/harmonogram.test.ts` — trzy testy zachowania, w tym „sufit NIE wraca”.

---

## 33. „Raz dziennie” przy protokole przed nocką znaczy „raz na serię” — nasza interpretacja

- **Założenie zmiany.** Punkt 1.2: wybór mają „przerwa przy monitorze, protokół przed nocką, **wszystkie inne rytmiczne powtarzające się w obrębie doby**”.
- **Co okazało się w praktyce.** Protokół przed nocką **nie powtarza się w obrębie doby** — odzywa się raz przed każdą nocką, czyli raz na dobę. Dosłowne „raz dziennie” nic by przy nim nie zmieniło, a tor byłby przełącznikiem bez skutku.
- **Co zrobiliśmy.** Przyjęliśmy jedyne odczytanie, przy którym wybór coś znaczy: **„raz dziennie” = raz na serię nocek**, czyli przed pierwszą nocką po dniu bez nocki. Przy grafiku 2 nocki + 2 nocki daje to 2 przypomnienia zamiast 4. Opis pod torem mówi wprost „raz przed pierwszą nocką w serii”, więc użytkownik nie musi zgadywać.
- **Do potwierdzenia przez zespół.** Jeżeli intencją było, żeby protokół nie miał wyboru w ogóle, wystarczy zdjąć mu pole `czestotliwosc` — reszta mechanizmu zostaje bez zmian.
- **Dowód.** `src/silnik/harmonogram.ts` (`czestotliwoscBudzika`, gałąź `pierwszaWSerii`).

---

## 34. Tor pokazujemy tylko przy budziku włączonym — i tyle miejsca zajmuje

- **Założenie zmiany.** Punkt 1.4: tor „przy pozycjach z wyborem”.
- **Co zrobiliśmy inaczej.** Tor pojawia się dopiero, gdy budzik jest **włączony**. Ustawienie częstotliwości dla czegoś, co milczy, nie ma skutku, a lista budzików urosłaby o pusty tor przy każdej pozycji — także przy tych, których użytkownik nigdy nie włączy.
- **Badanie 2 — zmierzone.** Tor ma **58 px**; jeden włączony budzik rytmiczny wydłuża listę o **106 px** (tor plus linijka opisu plus odstępy). Segmenty mają **48 px** przy piśmie 16 px i **68 px** przy 150%, czyli nigdzie nie schodzą poniżej reguły 3. Napisy „raz dziennie” i „za każdym razem” mieszczą się w jednej linii, strona nie wystaje w bok przy 150%. Lista budzików i tak się przewija, więc nic nie wypada z ekranu; profil przykładowy ma najwyżej dwa budziki z wyborem, czyli 212 px w najgorszym razie.
- **Dowód.** `testy/e2e/p2-p3-p9-budziki.spec.ts` — „badanie 2: tor częstotliwości nie rozpycha listy budzików”, z pomiarami wypisywanymi przy każdym przebiegu.

---

## 35. Badanie 3: powiadomienie zbiorcze mieści się, ale tylko dlatego, że pilnujemy pierwszego zdania

- **Co badaliśmy.** Punkt 8.3: czy treść „Dziś pamiętaj o przerwach…” mieści się w limicie powiadomienia systemowego — i co się dzieje, gdy nie mieści.
- **Wynik.** Treść przerwy przy monitorze ma **82 znaki**, treść protokołu **76**. Oba mieszczą się w bannerze iOS (dwie linie, około 110 znaków). **Nie mieszczą się** w zwiniętym powiadomieniu Androida, które pokazuje jedną linię, około 50 znaków — reszta idzie za wielokropek i widać ją dopiero po rozwinięciu.
- **Co z tego wynika.** Limitu nie da się dotrzymać bez okrojenia treści do zdania w rodzaju „Pamiętaj o przerwach”, które nie niesie już informacji, **jakie** przerwy i **jak często**. Zamiast skracać, przyjęliśmy regułę redakcyjną: **pierwsze zdanie musi nieść całą informację samo**, bo tylko ono jest pewne. „Dziś pamiętaj o przerwach” ma 25 znaków i mieści się wszędzie; reszta doprecyzowuje.
- **Czego nie sprawdziliśmy.** Nie mamy tu prawdziwych powiadomień systemowych (czysta PWA, wpis 6), więc liczby pochodzą z zachowania systemów, a nie z pomiaru na urządzeniu. Przy opakowaniu natywnym trzeba to potwierdzić na obu systemach.
- **Dowód.** `testy/harmonogram.test.ts` — trzy testy „treść powiadomienia zbiorczego”; test pilnuje progu 50 znaków dla pierwszego zdania i 110 dla całości.

---

## 36. Badanie 4: reguła trzech „Nie wiem” nie zderza się z punktacją — bo zielony i tak był nieosiągalny

- **Rozstrzygnięcie.** Trzy lub więcej odpowiedzi „Nie wiem” dają werdykt **bursztynowy niezależnie od sumy punktów**. Reguła leży w danych (`_nie_wiem` w `08-umowa.json`), tak samo jak punktacja — nie w kodzie silnika.
- **Badanie 4 — zbieg z wysoką punktacją.** Sprawdziliśmy układ „trzy Tak i trzy Nie wiem”: trafia w regułę progową i pokazuje werdykt o niewiedzy. Kolor się nie zmienia, bo werdykt punktowy przy trzech cechach też jest bursztynowy — **zbieg zmienia treść, nie kolor**.
- **Co wyszło przy okazji.** Zielony werdykt („Twoja umowa ma cechy umowy o pracę”) wymaga 5 z 6 punktów, a każde „Nie wiem” to punkt mniej. Przy **dwóch** „Nie wiem” maksimum wynosi 4, więc zielony jest nieosiągalny **z samej arytmetyki**, zanim reguła progowa cokolwiek zrobi. Innymi słowy: zielony werdykt dopuszcza najwyżej **jedno** „Nie wiem”. Reguła progowa domyka więc lukę tylko między trzema a sześcioma — dwójka była już zamknięta.
- **Blok „co sprawdzić”.** Budujemy go z pytań, na które padło **wprost „Nie wiem”**, a nie ze wszystkich braków. Odpowiedź przecząca jest wiedzą; „nie wiem” jest jej brakiem i tylko to drugie warto sprawdzać.
- **Dowód.** `testy/sprawdzacz.test.ts` — sześć testów „trzy «Nie wiem» w pakiecie umowy”; `testy/e2e/p10-umowa.spec.ts` — trzy przebiegi (3, 6 i 2 razy „Nie wiem”).

---

## 37. Badanie 5: przy 200% układ czterowarstwowy NIE trzymał dokumentu — naprawione

- **Rozstrzygnięcie zespołu.** Punkt 5: dokument zostaje nad zgięciem, kafle się przewijają. „To wynika wprost z układu czterowarstwowego”.
- **Co okazało się w praktyce.** Nie wynikało. Przy piśmie 32 px (200%) sam **nagłówek stały** rósł z 223 px do około 446 px; razem z pasem akcji i belką nawigacji warstwy nieruchome przekraczały wysokość ekranu i **wypychały dokument pod krawędź**. Układ gwarantował dokument tylko dopóki nagłówek się mieścił — czyli dokładnie do momentu, w którym gwarancja stawała się potrzebna.
- **Co zrobiliśmy.** Nagłówek ustępuje **jako pierwszy**: kurczy się i przewija u siebie (`flex: 0 3 auto; min-height: 0; overflow-y: auto`), pole kafli jako drugie, a pas z dokumentem i belka nie ustępują nigdy. Przy 100% nic z tego się nie uruchamia, bo jest miejsce.
- **Zmierzone po naprawie.** Przy 200% w polu kafli mieści się **jeden kafel**, przycisk „Pobierz kartę moich uprawnień” jest widoczny bez przewijania, belka go nie zakrywa, a strona **nie wystaje w bok ani o piksel** (badanie 5: nic innego poza ekran nie wypada).
- **Warte zapamiętania.** Warstwa oznaczona jako „stała” jest stała tylko dopóki starcza miejsca. Przy powiększeniu pisma trzeba z góry rozstrzygnąć **kolejność ustępowania**, a nie liczyć na to, że mieszczą się wszystkie.
- **Dowód.** `src/style/globalne.css` (`.warstwa-stala`), `testy/e2e/p4-p6-stanowisko.spec.ts` — „przy powiększeniu 200% dokument zostaje nad zgięciem”.

---

## 38. Normy ciasnoty wpisane — ale nie jako jedna liczba, tylko jako przedział z trzema odpowiedziami

- **Rozstrzygnięcie.** Punkt 4: `kubatura_min_na_pracownika` = **13 m³**, `powierzchnia_min_na_pracownika` = **2 m²**, oba ze źródłem `[do potwierdzenia przez specjalistę]`. Wartości weszły jako parametry z datami obowiązywania, więc podlegają zasadzie 9 tak samo jak stawki.
- **Problem, którego dokument nie rozstrzyga.** „Werdykt liczy z odpowiedzi użytkownika (ile osób, jaka powierzchnia, jaka wysokość)”. Tyle że **nikt nie zna kubatury swojego pokoju z dokładnością do metra**. Pytanie o dokładne wymiary dałoby albo zgadywanie, albo porzucenie ścieżki.
- **Co zrobiliśmy.** Użytkownik wybiera **przedziały** („od trzech do pięciu osób”, „około 20–40 m²”, „zwykłe — około 2,5–3 m”), a silnik liczy **oba końce** i rozróżnia trzy odpowiedzi: `ponizej` (norma przekroczona przy każdym układzie liczb z przedziałów), `granica` (może być przekroczona — rozstrzyga pomiar), `powyzej` (nie jest przekroczona przy żadnym). Werdykt podaje wyliczony przedział wprost: „Z Twoich odpowiedzi wychodzi 1,3–4,2 m³ objętości i 0,6–1,7 m² podłogi na osobę. Norma to 13 m³ i 2 m².”
- **Dlaczego nie zaokrąglamy na niczyją korzyść.** Zaokrąglenie w dół dawałoby fałszywe „norma przekroczona”, w górę — fałszywe „wszystko w porządku”. Trzeci stan („to zależy od dokładnych wymiarów”) jest jedyną uczciwą odpowiedzią przy danych, które użytkownik faktycznie ma.
- **Nowy mechanizm przy okazji: pytania warunkowe.** Trzy pytania o wymiary pojawiają się **dopiero po „Tak, ledwo się mieścimy”**. Dołożyliśmy do pytania sprawdzacza pole `gdy` — czytane tak samo jak w regułach werdyktu. Warunek wolno oprzeć wyłącznie na pytaniu stojącym wyżej; zależne od późniejszego nie pokazałoby się nigdy. Bez tego każdy, kto wchodzi w sytuację 7 z powodu zimna, odpowiadałby na trzy pytania o kubaturę bez żadnego skutku.
- **Czego dalej nie wiemy.** Czy 13 m³ i 2 m² dotyczą wszystkich pomieszczeń stałej pracy, czy mają wyłączenia (dokument zmiany wspomina o wyłączeniach „dla pomieszczeń o określonej wysokości”, ale ich nie podaje). Do czasu potwierdzenia werdykt mówi wprost, że wartości są punktem wyjścia do rozmowy, nie gotowym przepisem.
- **Dowód.** `content/parametry.json`, `content/sytuacje/07-zimno.json`, `src/silnik/sprawdzacz.ts` (`policzCiasnote`, `widocznePytania`); `testy/sprawdzacz.test.ts` (sześć testów), `testy/e2e/p5-sprawdzacz.spec.ts` (trzy przebiegi).

---

## 39. Trzy drobiazgi, z których jeden okazał się nie być drobiazgiem

- **Adnotacja o mocy dowodowej (sekcja 6) stoi także NA EKRANIE, nie tylko w pliku.** Dokument zmiany kazał dodać ją do stopki dokumentu z E7.5. Zrobiliśmy jedno i drugie: człowiek ma wiedzieć, czym ten wydruk jest, **zanim** go pobierze i zaniesie pracodawcy — adnotacja widoczna dopiero po otwarciu PDF-a przychodzi za późno.
- **Barwy Rzeczypospolitej, nie godło (7.1).** Poprawione w komentarzu generatora dokumentów, w kanwie projektowej v2, w pakiecie przekazania i w tym rejestrze. Sam pas oznaczeń w kodzie był **od początku poprawny** — kolejność FE → barwy RP → UE → nadawca, z podpisem „Rzeczpospolita Polska” pod flagą. Błąd był wyłącznie w opisach. Kanwa wydania pierwszego (`System-BHPewnie.dc.html`) zachowuje dawne brzmienie jako zapis archiwalny.
- **Alert zimowy (7.2) — dołożony BEZ progu temperatury.** Pasek pokazuje się od 1 listopada do 31 marca przy pracy na otwartej przestrzeni i prowadzi do sytuacji „Jest zimno albo ciasno”. Brzmi „Zimą na dworze — posiłek profilaktyczny i ciepłe napoje” i **nie podaje żadnej liczby stopni**: dokument zmiany progu nie zawiera, a wymyślona temperatura w tym miejscu czytałaby się jak przepis. Pasek przypomina o uprawnieniu, nie orzeka o nim. Próg do uzupełnienia przez zespół.
- **Reguła budzika przestała kłamać.** Przy okazji sekcji 1 wyszło, że opis budzika monitorowego brzmiał „co godzinę w trakcie zmiany” — czyli opisywał **częstotliwość powiadomienia**. Od 1.3 częstotliwość wybiera użytkownik, więc ten opis przy domyślnym „raz dziennie” byłby nieprawdą. Reguła mówi teraz o **uprawnieniu** („przerwa należy się po każdej godzinie przy ekranie”), a tor — o powiadomieniu. To dwie różne rzeczy i od tej zmiany są rozdzielone.
- **E2.4 potwierdzone bez zmian (sekcja 3).** Zespół przyjął nadane przez nas znaczenie ekranu „wynik pośredni” wraz z regułą `zostaloPytan >= 2`. Wpis 15 zamknięty, kodu nie ruszaliśmy.
- **Dowód.** `src/pdf/dokumenty.ts`, `src/ekrany/czas-pracy.tsx`, `src/ekrany/stanowisko.tsx`, `src/silnik/harmonogram.ts`; `testy/e2e/p11-p12-ewidencja.spec.ts` — „PDF ewidencji niesie adnotację o zapisie własnym pracownika”.

---

## Do rozstrzygnięcia przez zespół — po zmianie 1.3

Lista z wydania 1.1 pozostaje w mocy poza punktami 5 i 7, które zmiana 1.2 rozstrzygnęła. Zmiana 1.3 zamknęła sześć z ośmiu punktów listy po 1.2 (hałas, „Nie wiem” w pakiecie umowy, znaczenie E2.4, normy kubatury, kafel przy 200%, ewidencja jako dowód — ta ostatnia adnotacją roboczą, bo samo pytanie prawne zostaje). Zostaje osiem:

**Z wcześniejszych wydań**

9. **Brzmienie plakietki kafla warunkowego** — dziś „Zapytamy o jedno”; trzy warianty czekają na test z ludźmi (wpisy 19, 30b).
10. **`aria-live` licznika na żywo** — `off` z przyciskiem odczytu czy `polite`; wymaga testu z NVDA i TalkBack (pakiet projektowy).
11. **Ewidencja jako dowód** — czy wydruk z E7.5 może być używany w sporze z pracodawcą. Dokument nosi już adnotację roboczą, ale samo pytanie idzie do prawnika (wpisy 24 i 39).

**Nowe, ze zmiany 1.3**

12. **„Raz dziennie” przy protokole przed nocką** — przyjęliśmy „raz na serię nocek”, bo dosłowne „raz na dobę” nic by przy tym budziku nie zmieniło. Do potwierdzenia albo do zdjęcia wyboru z tego budzika (wpis 33).
13. **Tor częstotliwości tylko przy budziku włączonym** — nasza decyzja, nie litera dokumentu. Do potwierdzenia (wpis 34).
14. **Treść powiadomienia zbiorczego na Androidzie** — 82 znaki nie mieszczą się w zwiniętym powiadomieniu; przyjęliśmy regułę „pierwsze zdanie niesie całą informację”. Do sprawdzenia na urządzeniu przy opakowaniu natywnym (wpis 35).
15. **Wyłączenia od norm kubatury** — dokument zmiany wspomina o wyłączeniach „dla pomieszczeń o określonej wysokości”, ale ich nie podaje. Bez nich werdykt może pokazywać przekroczenie tam, gdzie przepis go nie widzi (wpis 38).
16. **Próg temperatury dla alertu zimowego** — pasek działa na oknie kalendarzowym (1 XI – 31 III) i celowo nie podaje żadnej liczby stopni, bo dokument jej nie zawiera. Do uzupełnienia (wpis 39).

**Bez zmian od 1.1**

17. **Stawka dodatku nocnego w materiałach promocyjnych** — wszędzie, gdzie pada „5,22 zł”, trzeba dopisać miesiąc albo podać widełki (wpis 1).
18. **Decyzja o Capacitorze** — bez niej przypomnienia pozostaną funkcją działającą tylko przy otwartej aplikacji (wpis 6). To najpoważniejsza rzecz na całej liście.
19. **Harmonogram pracy prawnika** — pozycje do autoryzacji, w tym normy z 1.3 (kubatura, powierzchnia) i adnotacja o mocy dowodowej ewidencji (wpisy 8, 38, 39).
20. **Pliki znaku Funduszy Europejskich i barw Rzeczypospolitej Polskiej** — pas oznaczeń ma opisane wymiary i kolejność, ale wektory muszą pochodzić z księgi wizualizacji.
