# ROZBIEŻNOŚCI.md

Rejestr miejsc, w których brief nie dał się zrealizować dosłownie, oraz decyzji podjętych w tych miejscach. Prowadzony od pierwszego commita, zgodnie z sekcją 11 briefu.

Każdy wpis ma pięć części: założenie strategii, co okazało się w praktyce, skutek, proponowane rozstrzygnięcie i dowód.

Stan na 1 września 2026. Dotyczy katalogu `bhpewnie/`.

**Rozstrzygnięcia projektowe** (kolor, układ, plakietki, pasek numerów) mają własny rejestr — `ROZBIEZNOSCI_DESIGN.md` w dokumentacji systemu wizualnego. Ten plik zajmuje się wykonalnością techniczną i merytoryczną.

---

## 1. Dodatek nocny: przykład z briefu nie zgadza się ze wzorem z briefu

- **Założenie strategii.** Sekcja 6.2: „Dodatek za pracę w nocy — **5,22 zł** za każdą godzinę nocną" (listopad 2026). Sekcja 4.3: „`dodatek_nocny_stawka`: liczona = 20% × minimalne / wymiar godzin miesiąca (wynik ok. 5,22–6,01 zł/h)".
- **Co okazało się w praktyce.** Te dwa zdania nie mogą być jednocześnie prawdziwe. Wymiar czasu pracy listopada 2026 wynosi 160 godzin (21 dni roboczych minus Święto Niepodległości, które wypada w środę). Wzór daje wtedy 20% × 4806 / 160 = **6,01 zł**. Stawka 5,22 zł wypada w **lipcu** 2026 — jedynym miesiącu o wymiarze 184 godzin. Widełki 5,22–6,01 zł z sekcji 4.3 są policzone poprawnie; błędne jest przypisanie dolnej granicy do listopada.
- **Skutek.** Gdyby prototyp wpisał 5,22 zł na sztywno, aplikacja podawałaby pracownikowi kwotę zaniżoną o 15% przez większość roku — dokładnie ten rodzaj błędu, którego zakazuje zasada 9. Skutek dla kosztu: żaden, kalendarz wymiaru liczy się sam.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Kafel nie może nosić stałej kwoty. Zaimplementowano wyliczanie miesięczne: `content/wymiar-czasu-pracy.json` jest generowany z art. 130 Kodeksu pracy (`node narzedzia/generuj-wymiar.mjs`), a silnik podstawia stawkę właściwą dla dnia, w którym użytkownik patrzy na ekran.
- **Dowód.** `testy/parametry.test.ts` — testy „stawka zmienia się między miesiącami" oraz „ROZBIEŻNOŚĆ 1: w listopadzie 2026 stawka to 6,01 zł, a nie 5,22 zł". Kalendarz wymiaru: 2026-07 = 184 h, 2026-11 = 160 h.

---

## 2. Mapa ekranów: tytuł mówi 48, wyliczenia dają 58

- **Założenie strategii.** Sekcja 5: „Mapa ekranów (48)". Etap G: „eksport listy ekranów z kodu porównany z listą 48 (ma się zgadzać)".
- **Co okazało się w praktyce.** Liczby podane przy nagłówkach grup sumują się do 58: E0 = 23, E1 = 4, E2 = 6, E3 = 3, E4 = 13, E5 = 7, E6 = 2. Zaimplementowano wszystkie 58 wymienionych ekranów, więc kryterium „ma się zgadzać" jest niewykonalne wobec liczby 48 i spełnione wobec listy.
- **Skutek.** Żaden dla użytkownika. Dla zamówienia komercyjnego istotny: wykonawca wyceniający „48 ekranów" wyceni o 20% za mało.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** — poprawić liczbę w tytule sekcji 5 na 58 przed wysłaniem briefu do wykonawcy.
- **Dowód.** `npm run ekrany` porównuje rejestr z kodu z liczbami z briefu i wypisuje rozbieżność. Wynik: wszystkie grupy zgodne, suma 58.

Przy okazji: numeracja w grupie E2 przeskakuje z E2.3 na E2.5 — ekran E2.4 nie istnieje ani w opisie, ani w liczbie „6". Rejestr ekranów odwzorowuje tę lukę wiernie, żeby numery zgadzały się z briefem.

---

## 3. Budżet dotknięć w P1 jest nieosiągalny przy 19 ekranach

- **Założenie strategii.** Przebieg P1: „≤30 dotknięć przy pełnej konfiguracji; **≤17 przy pominięciu grafiku**".
- **Co okazało się w praktyce.** Sama konfiguracja bez grafiku to 19 ekranów wymagających decyzji: 13 pytań o cechy (E0.2–E0.14) plus tryb pracy, umowa, przepisy szczególne, rok urodzenia, niepełnosprawność, oraz dwa ekrany zamykające (wynik, nazwa profilu). Przy jednym dotknięciu na ekran i samoczynnym przejściu dalej — bez osobnego przycisku „Dalej" — minimum wynosi **21 dotknięć**. Zmierzone: **21 bez grafiku**, **27 z pełnym grafikiem** (wzorzec rotacji 2-2-3 to jedno dotknięcie).
- **Skutek.** Próg ≤30 jest spełniony z zapasem. Progu ≤17 nie da się dotrzymać bez usunięcia sześciu pytań albo połączenia kilku na jednym ekranie — a to łamie zasadę „jedno zagadnienie na ekran" z sekcji 9.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** — podnieść próg do ≤22 przy pominięciu grafiku. Alternatywa (łączenie pytań) kosztuje czytelność u odbiorcy 45+, czyli dokładnie tej grupy, dla której próg powstał.
- **Dowód.** `testy/e2e/p1-kreator.spec.ts` liczy każde kliknięcie i wypisuje wynik: „P1 bez grafiku: 21 dotknięć", „P1 pełna konfiguracja: 27 dotknięć".

---

## 4. PDF tagowany (dostępny cyfrowo) nie powstanie po stronie klienta w pdf-lib

- **Założenie strategii.** Sekcja 3: „Zapisz w rozbieżnościach, czy dało się wygenerować PDF tagowany (dostępny cyfrowo) po stronie klienta — to wymóg produkcyjny".
- **Co okazało się w praktyce.** pdf-lib nie tworzy drzewa struktury (`StructTreeRoot`), które jest sednem PDF/UA — nie ma API do znaczników akapitów, nagłówków ani tabel. Da się ustawić metadane dokumentu i język (`/Lang pl-PL`), i to zrobiono. Reszta wymagań PDF/UA (kolejność odczytu, tekst alternatywny, znaczniki semantyczne) pozostaje poza zasięgiem tej biblioteki. Sprawdzone alternatywy: jsPDF ma to samo ograniczenie; biblioteki generujące PDF/UA (np. serwerowe) łamią zasadę „dane nie opuszczają urządzenia".
- **Skutek.** Dokument jest czytelny wzrokowo i ma poprawnie osadzony font z polskimi znakami, ale czytnik ekranu potraktuje go jako ciąg tekstu bez struktury. Dla wykonawcy komercyjnego: pozycja budżetowa na bibliotekę PDF/UA albo na natywne generowanie dokumentu.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować ograniczenie w prototypie**, ale wpisać PDF/UA do wymagań produkcyjnych z osobną wyceną. Dokument A4 ma już strukturę wizualną gotową do otagowania: hierarchię nagłówków, pola do wypełnienia i pas oznaczeń.
- **Dowód.** `src/pdf/dokumenty.ts` — komentarz przy `zaczniejDokument`. Test `testy/e2e/p4-p6-stanowisko.spec.ts` otwiera zapisany plik przez pdf-lib i sprawdza tytuł, autora i liczbę stron.

---

## 5. Rozmiar paczki z wbudowanymi treściami

- **Założenie strategii.** Sekcja 11, badanie obowiązkowe nr 3: „rozmiar paczki z wbudowanymi treściami".
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

- **Założenie strategii.** Sekcja 3: przypomnienia mają działać „jak budzik w telefonie", lokalnie, punktualnie, w godzinach wyliczonych z grafiku. Sekcja 11, badanie obowiązkowe nr 1.
- **Co okazało się w praktyce.** Trzeba rozdzielić dwie rzeczy, bo w briefie są jednym.

  **Wyliczanie harmonogramu działa w pełni.** Silnik `src/silnik/harmonogram.ts` liczy przypomnienia na 14 dni z grafiku zmian, terminów użytkownika i reguł budzików, stosuje sufit trzech na dobę z pierwszeństwem i pokazuje wynik na ekranie („następne przypomnienie: w piątek 07:30"). To jest ta część wartości, którą prototyp miał zweryfikować — i ona się broni.

  **Wyzwalanie o zadanej godzinie nie działa niezawodnie.** W czystej PWA nie ma Notification Triggers API (wycofane z Chromium po fazie próbnej, nigdy nie wdrożone w Safari). Zostają trzy drogi, każda ułomna: powiadomienie przy otwartej aplikacji (użytkownik i tak patrzy w ekran), `setTimeout` w Service Workerze (system usypia go po kilkudziesięciu sekundach), oraz Web Push (wymaga serwera — łamie zasadę 1). Na iOS dochodzi warunek, że PWA musi być dodana do ekranu początkowego, a i wtedy powiadomienia bywają opóźnione o godziny.

  Praktyczny wniosek: **budzik przed nocką o 17:00 nie zadzwoni**, jeśli aplikacja jest zamknięta — a jest zamknięta zawsze, bo to sens tej funkcji.
- **Skutek.** Najważniejsza obietnica aplikacji („przypomni Ci we właściwym momencie") nie da się dotrzymać w czystej PWA. To nie jest usterka do poprawienia — to granica technologii.
- **Proponowane rozstrzygnięcie.** **(B) zmienić technologię.** Opakowanie w Capacitor z wtyczką Local Notifications: silnik harmonogramu zostaje bez zmian (jest czystym TypeScriptem, bez zależności od przeglądarki), dochodzi warstwa, która oddaje wyliczone terminy systemowemu budzikowi. Koszt: konfiguracja dwóch sklepów, podpisy, aktualizacje. Na Androidzie dodatkowo uprawnienie do dokładnych alarmów (`SCHEDULE_EXACT_ALARM`) — aplikacja już wykrywa jego brak i pokazuje pasek z drogą wyjścia (B4).
- **Dowód.** `testy/harmonogram.test.ts` — 12 testów silnika, w tym sufit i pierwszeństwo. Ekran E5.4 pokazuje wyliczony harmonogram na 14 dni. Wykrywanie zgody na powiadomienia: `src/ekrany/ustawienia.tsx`, funkcja `popros`.

---

## 7. Sufit trzech powiadomień na dobę odrzuca 41% wyliczonych przypomnień

- **Założenie strategii.** Zasada 8: „Sufit 3 powiadomień na dobę z pierwszeństwem". Sekcja 11, badanie obowiązkowe nr 7: „czy limit 3 powiadomień/dobę da się zrealizować przy pełnym grafiku".
- **Co okazało się w praktyce.** Dla profilu przykładowego z włączonymi wszystkimi budzikami i pracą przy monitorze powyżej 4 godzin silnik wylicza **51 przypomnień na 14 dni**, z czego sufit odrzuca **21 (41%)**. Źródłem nadmiaru jest budzik „Przerwa przy monitorze" — przy dwunastogodzinnej zmianie generuje pięć przypomnień dziennie, czyli sam wyczerpuje sufit z nawiązką.
- **Skutek.** Sufit działa i chroni użytkownika przed zalewem, ale odrzuca rzeczy, o które ten sam użytkownik świadomie prosił. Przy pierwszeństwie z zasady 8 najczęściej ginie właśnie przerwa przy monitorze — a to jedyny budzik, którego wartość polega na regularności.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Trzy możliwości do rozstrzygnięcia z zespołem: (1) liczyć rytm w trakcie zmiany jako **jedno** powiadomienie serii, nie pięć; (2) podnieść sufit dla budzików rytmicznych, zostawiając 3 dla reszty; (3) zamienić przerwę przy monitorze na jedno przypomnienie na początku zmiany („dziś pamiętaj o przerwach co godzinę"). Prototyp pokazuje odrzucone pozycje wprost w podglądzie harmonogramu, więc decyzję da się podjąć na danych, a nie na wyczuciu.
- **Dowód.** `testy/pomiar-sufitu.test.ts` — wypisuje pomiar przy uruchomieniu. Podgląd odrzuconych: ekran E5.4, sekcja „Co i kiedy się odezwie".

---

## 8. Brief pozwala podać sześć podstaw prawnych, a treść potrzebuje ich osiemdziesięciu sześciu

- **Założenie strategii.** Sekcja 12: „Nie wymyślaj kwot i podstaw prawnych poza podanymi — brakujące oznacz `[do uzupełnienia przez specjalistę]`".
- **Co okazało się w praktyce.** Zasadę zastosowano dosłownie. W treściach jest **86 wystąpień** znacznika `[do uzupełnienia przez specjalistę]` wobec **sześciu** podstaw prawnych podanych w briefie (art. 130, 134, 151⁸, 229, 237⁹ § 3 Kodeksu pracy oraz ustawa z 4 kwietnia 2014 r. dla funkcjonariuszy). Innymi słowy: 93% kafli, werdyktów i kart praw czeka na autoryzację specjalisty.
- **Skutek.** Prototyp jest w pełni klikalny i pokazuje mechanikę, ale **nie nadaje się do testów z użytkownikami w części merytorycznej** — osoba testująca zobaczy nawias zamiast przepisu i słusznie straci zaufanie. Dla harmonogramu: praca prawnika jest zadaniem krytycznym, nie równoległym.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować mechanizm, zaplanować pracę.** Znacznik jest jednolity i policzalny (`grep -ro "do uzupełnienia przez specjalistę" content/ | wc -l`), więc postęp autoryzacji da się mierzyć. Przed testami z użytkownikami trzeba uzupełnić przynajmniej trzy pełne ścieżki sprawdzacza i ścieżkę wypadkową — to około 20 pozycji.
- **Dowód.** Polecenie powyżej; metryczka przy każdym module treści wskazuje, że autorem jest „redakcja BHPewnie (wymaga autoryzacji specjalisty)".

---

## 9. Trzynaście pytań w trzy minuty — czego prototyp nie rozstrzygnie

- **Założenie strategii.** Sekcja 11, badanie obowiązkowe nr 4: „czy 13 pytań + dopytania mieści się w 3 minutach w teście z osobą 55+".
- **Co okazało się w praktyce.** To pytanie wymaga ludzi, nie kodu. Prototyp dostarcza natomiast twardych danych wejściowych: **21 dotknięć** bez grafiku, **27** z grafikiem, jedno zagadnienie na ekran, samoczynne przejście po odpowiedzi. Przy trzech minutach daje to około **8,5 sekundy na ekran** — czas realny dla osoby wprawnej, napięty dla osoby, która czyta przykłady pod pytaniem, i za krótki dla kogoś, kto zakłada okulary.
- **Skutek.** Ryzyko dotyczy nie liczby pytań, lecz przykładów: to one wydłużają czytanie, i to one są najcenniejsze dla osoby, która nie wie, czy „czynniki biologiczne" jej dotyczą.
- **Proponowane rozstrzygnięcie.** **(C) rozstrzygnąć testem z użytkownikami**, mierząc osobno czas ekranów z dopytaniem (monitor, dźwiganie, kontakt) i bez. Jeśli próg trzech minut okaże się nieosiągalny, taniej jest zmienić próg niż odebrać przykłady.
- **Dowód.** Liczby dotknięć z `testy/e2e/p1-kreator.spec.ts`.

---

## 10. Trzy stany werdyktu bez czerwieni — czytelność potwierdzona konstrukcyjnie

- **Założenie strategii.** Zasada 6 i badanie obowiązkowe nr 5: „czy 3 stany werdyktu bez czerwieni są czytelne dla osób z zaburzeniami widzenia barw".
- **Co okazało się w praktyce.** Konstrukcja werdyktu niesie stan trzema nośnikami naraz: **słowem** („Przysługuje Ci" / „To zależy" / „Nie przysługuje"), **kształtem ikony** (ptaszek / fala / kreska) i dopiero na końcu kolorem (zieleń / bursztyn / szarość). Test w skali szarości pozostaje jednoznaczny, bo słowo i kształt nie zależą od barwy. Sprawdzono też automatycznie, że stan „nie przysługuje" nie używa czerwieni.
- **Skutek.** Zakaz czerwieni z briefu okazał się korzystny: wymusił rozwiązanie, które i tak było potrzebne ze względu na daltonizm.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować.** Test z użytkownikami warto zawęzić do pytania, czy szarość nie jest odbierana jako „aplikacja się nie doczytała" zamiast „sprawdziliśmy i nie przysługuje".
- **Dowód.** `testy/e2e/dostepnosc.spec.ts` — „stan werdyktu niesie ikona i słowo, nie sam kolor"; `testy/e2e/p5-sprawdzacz.spec.ts` — „żaden werdykt nie używa czerwieni" (sprawdza wyliczony kolor tła).

---

## 11. „Cisza po nocce" bez przełącznika — rozstrzygnięcie językowe, nie techniczne

- **Założenie strategii.** Zasada 8: „Cisza po nocce wyliczana z grafiku, automatycznie, bez przełącznika". Badanie obowiązkowe nr 6: czy pozycja bez przełącznika jest zrozumiała.
- **Co okazało się w praktyce.** Technicznie działa: okno snu liczy się z końca zmiany nocnej plus 30 minut przez 7 godzin, bez udziału użytkownika. Problem jest w komunikacie. Pierwotna plakietka „AUTO" to skrót z języka techniki, obcy części odbiorców. Zastąpiono ją zwrotem **„samo się ustawia"** (rozstrzygnięcie z rejestru projektowego, punkt d).
- **Skutek.** Pozycja bez suwaka wygląda inaczej niż pozostałe i wymaga jednego spojrzenia więcej, ale nie da się jej przypadkiem wyłączyć — a to była intencja.
- **Proponowane rozstrzygnięcie.** **(C) zaakceptować, zweryfikować testem.** Pytanie do użytkownika: „co się stanie, jeśli tego dotkniesz?". Jeśli odpowiedź brzmi „wyłączy się", plakietka nie działa.
- **Dowód.** `testy/e2e/p2-p3-p9-budziki.spec.ts` — „cisza po nocce ma plakietkę bez żargonu i nie ma przełącznika" (sprawdza brak roli `switch`).

---

## 12. Ekran główny przy bogatym profilu: 27 kafli w jednej kolumnie

- **Założenie strategii.** Zasada 5: „Kafel bez konkretu nie istnieje" — każde uprawnienie ma swój kafel. Sekcja 5, E1.1: ekran główny pokazuje kafle uprawnień.
- **Co okazało się w praktyce.** Dla profilu przykładowego (praca zmianowa z nockami, kontakt z materiałem zakaźnym, praca w pojedynkę, własna odzież, umowa o pracę, 50+) silnik zwraca **27 kafli**. Pierwsza wersja pokazywała je wszystkie — ekran główny stał się ścianą nie do przeskanowania, a przyciski „Sprawdź" i „Pobierz kartę" wylądowały poza pierwszym ekranem.
- **Skutek.** Kluczowa akcja (dokument dla pracodawcy) przestała być widoczna bez przewijania. Dla odbiorcy 45+ długa lista bez hierarchii jest gorsza niż lista krótsza z wyjściem do reszty.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie.** Ekran główny pokazuje **trzy kafle**, potem oba przyciski, a reszta jest pod „Pokaż wszystkie uprawnienia (27)". Kolejność kafli nie jest przypadkowa: najpierw to, co da się policzyć w złotówkach i godzinach (grupa „pieniądze", potem „czas pracy"), na końcu kafle niepewne. Rozstrzygnięcie zgodne z rejestrem projektowym, punkt c.
- **Dowód.** `src/silnik/reguly.ts` — sortowanie po grupie i pewności; `src/ekrany/stanowisko.tsx` — lista skrócona do trzech.

---

## 13. Dwa błędy interfejsu znalezione przez testy, nie przez oglądanie

Prototyp miał „znaleźć miejsca, gdzie założenia się nie sprawdzają". Dwa z nich znalazły się same — w miejscach, których nie widać na zrzucie ekranu.

**Belka nawigacji zasłaniała koniec każdej długiej strony.** Belka dolna była przyklejona (`position: sticky`) nad przewijaną treścią, więc ostatnie przyciski ekranu głównego znajdowały się trwale pod nią i nie dawały się dotknąć. Test e2e wykrył to jako „kliknięcie trafia w belkę zamiast w przycisk". Naprawa wymagała przebudowy powłoki: przewija się teraz tylko obszar treści, a belka i pasek numerów alarmowych są zwykłymi elementami układu. **Skutek dla użytkownika przed naprawą: niedostępny przycisk „Pobierz kartę moich uprawnień".**

**Powiększenie do 200% rozpychało stronę w poziomie.** Wiersz z nagłówkiem sekcji i licznikiem uprawnień nie zawijał się, więc przy powiększeniu wymaganym przez WCAG 1.4.10 pojawiał się suwak poziomy. Naprawa: zawijanie w rzędach. **Skutek przed naprawą: naruszenie wymogu z sekcji 9 briefu.**

- **Proponowane rozstrzygnięcie.** **(C)** — oba naprawione, oba mają test pilnujący regresji.
- **Dowód.** `testy/e2e/dostepnosc.spec.ts` — „powiększenie do 200% nie wywołuje przewijania w poziomie"; przypadki kliknięć w `testy/e2e/p4-p6-stanowisko.spec.ts`.

---

## 14. Przerwa przy monitorze: uprawnienie mówi co godzinę, budzik co dwie

- **Założenie strategii.** Sekcja 4.3: „`przerwa_monitor`: 5 min po każdej godzinie". Sekcja 6.7, tabela budzików: „Przerwa przy monitorze — **co 2 h** w trakcie zmiany".
- **Co okazało się w praktyce.** Aplikacja mówi użytkownikowi, że przerwa należy mu się po każdej godzinie, a przypomina o niej co dwie. Wykonano zgodnie z briefem w obu miejscach, bo obie liczby są w nim wprost — ale na ekranie stoją obok siebie i wyglądają na pomyłkę.
- **Skutek.** Użytkownik może uznać, że aplikacja sama nie wie, co mu przysługuje — co uderza w jej jedyny kapitał, czyli wiarygodność.
- **Proponowane rozstrzygnięcie.** **(A) zmienić założenie** w jednym z dwóch miejsc, albo dopisać zdanie, które godzi obie liczby („przypominamy co dwie godziny, żeby nie zawracać Ci głowy co godzinę — prawo do przerwy masz po każdej"). Trzecia droga wynika z wpisu 7: zamienić serię na jedno przypomnienie na początku zmiany.
- **Dowód.** `content/parametry.json` (`przerwa_monitor`) wobec `src/silnik/harmonogram.ts` (`DEFINICJE_BUDZIKOW`, reguła „co 2 godziny w trakcie zmiany").

---

## Do rozstrzygnięcia przez zespół

1. **Stawka dodatku nocnego w materiałach promocyjnych** — wszędzie, gdzie pada „5,22 zł", trzeba dopisać miesiąc albo podać widełki (wpis 1).
2. **Liczba ekranów w briefie** przed wysłaniem do wykonawcy: 58, nie 48 (wpis 2).
3. **Próg dotknięć w P1** — podnieść do ≤22 albo zmienić strukturę kreatora (wpis 3).
4. **Decyzja o Capacitorze** — bez niej przypomnienia pozostaną funkcją, która działa tylko przy otwartej aplikacji (wpis 6).
5. **Kształt budzika monitorowego** — trzy warianty w opisie wpisu 7.
6. **Harmonogram pracy prawnika** — 86 pozycji do autoryzacji, w tym około 20 krytycznych przed testami z użytkownikami (wpis 8).
7. **Sprzeczność „co godzinę / co dwie godziny"** (wpis 14).
8. **Pliki znaków Funduszy Europejskich i godła RP** — pas oznaczeń w dokumentach ma opisane wymiary i kolejność, ale wektory muszą pochodzić z księgi wizualizacji.
