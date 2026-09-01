# BHPewnie — brief dla Claude Code: budowa prototypu roboczego

## 0. Rola i cel

Jesteś zespołem programistycznym budującym **prototyp roboczy** aplikacji BHPewnie. Prototyp nie jest produktem końcowym — ma trzy zadania:

1. Przeklikać wszystkie założenia strategii i **znaleźć miejsca, gdzie się nie sprawdzają**. To jest cel nadrzędny. Każdą rozbieżność między tym briefem a tym, co okazało się wykonalne, sensowne lub konieczne, zapisujesz w pliku `ROZBIEZNOSCI.md` (sekcja 11).
2. Posłużyć do testów z prawdziwymi użytkownikami (osoby 45+, pracujące na zmiany, część bez wprawy w obsłudze telefonu).
3. Stać się załącznikiem do przyszłego zamówienia dla wykonawcy komercyjnego — ma więc być czytelny jako specyfikacja „zbudujcie dokładnie to".

Język interfejsu: **polski**, zwroty do użytkownika per „Ty" wielką literą. Żadnych anglicyzmów w tekstach widocznych dla użytkownika. Kod, komentarze, nazwy zmiennych — dowolnie.

## 1. Kontekst w dziesięciu zdaniach

BHPewnie (czyt. „be-ha-pewnie") to bezpłatna aplikacja Forum Związków Zawodowych dla każdej osoby pracującej w Polsce, finansowana z projektu FERS. Hasło: „wiesz, na czym stoisz". Użytkownik odpowiada na kilkanaście prostych pytań o **warunki** swojej pracy — nie o zawód — a aplikacja pokazuje jego uprawnienia z konkretnymi kwotami, progami i terminami. Dostarcza wzorów pism i gotowych zdań do rozmowy z pracodawcą. Przypomina o rzeczach we właściwym momencie, licząc godziny z grafiku zmian użytkownika. Gdy w pracy wydarzy się coś złego, prowadzi krok po kroku i daje telefon do człowieka. **Nie ma kont, nie zbiera żadnych danych, nie ma telemetrii, działa bez internetu.** Wszystko, co użytkownik ustawi, zostaje w jego urządzeniu. Zakres: wyłącznie bezpieczeństwo i higiena pracy. Odbiorca projektowy: osoba 45+, ale aplikacja jest dla wszystkich — to, co służy najstarszym, służy wszystkim.

## 2. Zasady nieprzekraczalne

Jeżeli jakiekolwiek rozwiązanie techniczne narusza poniższą zasadę — rozwiązanie ustępuje, zasada zostaje. Zapisz w `ROZBIEZNOSCI.md`, jeśli zasada okazała się trudna do spełnienia.

1. **Zero danych na zewnątrz.** Brak kont, logowania, backendu dla użytkowników, analityki (także anonimowej), crash-reportingu wysyłającego dane, zewnętrznych fontów/CDN w runtime. Jedyne połączenia sieciowe: pobranie strumienia prasówki (statyczny JSON) i pobranie materiałów biblioteki.
2. **Działa bez internetu.** Wszystko potrzebne w chwili zdarzenia — ścieżki Pomocy, uprawnienia, sprawdzacze, wzory pism, numery telefonów, ekran kryzysowy — jest w paczce instalacyjnej. Sieć tylko dla prasówki i biblioteki.
3. **Zawód nie istnieje w systemie.** Jednostką wiedzy jest **cecha stanowiska** (18 cech, sekcja 4). Nie twórz tabeli zawodów. Zawód może być tylko dowolną etykietą profilu wpisaną przez użytkownika.
4. **Konfiguracja wyłącznie pytaniami o obrazki z życia.** Żadnych list przełączników do zaznaczania, żadnych pojęć technicznych („czynnik", „narażenie", „ryzyko zawodowe") na ekranie.
5. **Kafel bez konkretu nie istnieje.** Każde uprawnienie ma liczbę: kwotę, próg, częstotliwość albo termin, oraz datę stanu prawnego.
6. **Trzy stany werdyktu, nigdy czerwony.** Przysługuje = zielony, zależy = bursztynowy, nie przysługuje = neutralny szary. Odmowa to informacja, nie alarm.
7. **Trzy stałe akcje pod każdym wynikiem, zawsze w tej kolejności:** Pobierz wniosek PDF · Jak o to poprosić · Przypomnij mi.
8. **Nic domyślnie włączone.** Po instalacji zero przypomnień. Sufit 3 powiadomień na dobę z pierwszeństwem: powrót po ścieżce Pomocy → terminy → rytmiczne → sezonowe → prasówka. Cisza po nocce wyliczana z grafiku, automatycznie, bez przełącznika.
9. **Nigdy nieaktualna liczba jako pewna.** Każdy parametr ma daty obowiązywania od–do. Po upływie „do" bez nowej wartości aplikacja NIE pokazuje starej liczby — pokazuje „Ta kwota zmienia się od [miesiąc]. Sprawdzamy nową wartość."
10. **Bez grywalizacji.** Żadnych punktów, rankingów, odznak, serii, porównań, zawstydzania („nie zrobiłeś od 3 tygodni").
11. **Każda treść fachowa ma metryczkę:** autor (rola), data opracowania, data następnego przeglądu. W prototypie — dane przykładowe, ale pole musi istnieć.
12. **Dostępność WCAG 2.1 AA** od pierwszego commita, nie na końcu (sekcja 9).

## 3. Stos technologiczny i architektura

**Wybór rekomendowany:** PWA — React + TypeScript + Vite, offline-first z Service Workerem (Workbox), stan w IndexedDB (np. Dexie) lub localStorage dla małych struktur. Bez backendu. Prasówka i biblioteka jako statyczne pliki JSON hostowane obok aplikacji (w prototypie: lokalne pliki w `public/`).

Jeżeli uznasz, że inny stos lepiej zrealizuje wymagania (np. Capacitor od razu dla powiadomień), **zrób to i zapisz uzasadnienie w `ROZBIEZNOSCI.md`**.

**Powiadomienia — ważne ograniczenie do sprawdzenia w praktyce.** Strategia zakłada przypomnienia działające „jak budzik w telefonie", lokalnie, bez serwera, punktualnie w godzinach wyliczonych z grafiku. W czystej PWA planowane lokalne powiadomienia o zadanej godzinie **nie są niezawodne** (brak Notification Triggers API). W prototypie:
- zaimplementuj silnik reguł, który **wylicza** harmonogram na najbliższe 14 dni z grafiku i reguł (to jest wartość do przetestowania),
- pokaż wyliczony harmonogram na ekranie budzików („następne przypomnienie: dziś 14:00"),
- wyzwalaj powiadomienia, gdy aplikacja jest otwarta lub przez Service Worker w miarę możliwości platformy,
- **udokumentuj w `ROZBIEZNOSCI.md`**, co realnie działa na Androidzie i iOS w PWA, a co wymaga opakowania natywnego (Capacitor Local Notifications). To jest jedna z głównych rzeczy, które ten prototyp ma sprawdzić.

**Panel redakcyjny** w prototypie = katalog plików JSON w `content/`. Wszystkie treści, parametry, pytania kreatora, mapowania i teksty interfejsu są **danymi, nie kodem**. Zmiana brzmienia pytania nie może wymagać zmiany w komponencie.

**Generator PDF** po stronie klienta (np. pdf-lib lub jsPDF). Dokumenty muszą mieć: strukturę nagłówków, puste pole na imię (aplikacja nie zna imienia), datę stanu prawnego, stopkę „Wygenerowano w aplikacji BHPewnie — dane nie opuszczają urządzenia. Opracowanie: Forum Związków Zawodowych" i **miejsce na oznaczenia Funduszy Europejskich** (w prototypie placeholder z podpisem „[oznaczenia FE — zgodnie z księgą wizualizacji]"). Zapisz w rozbieżnościach, czy dało się wygenerować PDF tagowany (dostępny cyfrowo) po stronie klienta — to wymóg produkcyjny.

## 4. Model danych

### 4.1. Słownik cech stanowiska (18 — lista zamknięta)

Cechy środowiska (14):
| id | cecha | wartości |
|---|---|---|
| monitor | praca przy monitorze | brak / do 2 h / 2–4 h / ponad 4 h |
| dzwiganie | obciążenie fizyczne | brak / rzeczy / ludzie / oba |
| teren | praca na otwartej przestrzeni | tak / nie |
| zmiany | zmianowość | stałe / zmiany / zmiany z nocami (z grafiku) |
| pojazd | prowadzenie pojazdu | tak / nie |
| kontakt | kontakt z człowiekiem z zewnątrz | brak / obsługa / bywa nerwowo / ryzyko agresji |
| glos | praca głosem | tak / nie |
| chemia | czynniki chemiczne i pyły | tak / nie |
| biologia | czynniki biologiczne i zakaźne | tak / nie |
| halas | hałas i drgania | tak / nie |
| temperatura | zimno i gorąco | tak / nie |
| urazowe | maszyny w ruchu, wysokość, ostre narzędzia, broń | tak / nie |
| odziez | własna odzież / własne pranie | tak / nie |
| samotnie | praca w pojedynkę | tak / nie |

Modyfikatory osobowe (3): `umowa` (o_prace / zlecenie / dzialalnosc), `rocznik` (liczba; reguły dla 50+), `niepelnosprawnosc` (tak / nie / brak_odpowiedzi).

Cecha statusowa (1): `status` (brak / nauczyciel / funkcjonariusz / cywil_w_sluzbie / kierowca_zawodowy / medyk / kolejarz / gornik). **To przełącznik korzenia**: `funkcjonariusz` przepina całą macierz uprawnień na reguły służbowe (brak dodatku nocnego z KP, odrębny system odszkodowawczy, komisje lekarskie zamiast medycyny pracy, brak PIP).

Każde pominięte pytanie → wartość **bezpieczna** = ta, przy której aplikacja pokazuje więcej, nie mniej; kafle z niej wynikające oznaczone jako `niepewne: true`.

### 4.2. Moduł wiedzy cechy (struktura JSON)

```
{
  "cecha": "dzwiganie",
  "prog": "...",
  "pytanie": { "tresc": "...", "przyklady": ["..."], "dopytanie": {...} },
  "uprawnienia": [ { "id", "tytul", "konkret", "parametr": {"wartosc", "jednostka", "obowiazuje_od", "obowiazuje_do", "zrodlo"}, "podstawa", "warianty": {"o_prace":..., "zlecenie":..., "dzialalnosc":..., "funkcjonariusz":...} } ],
  "terminarz": [ { "nazwa", "regula", "zdarzenie_poczatkowe" } ],
  "protokoly": [ ... ],
  "sprawdzacze": [ "id", ... ],
  "warianty_pomocy": { ... },
  "alerty": [ { "id", "regula" } ],
  "metryczka": { "autor", "rola", "data_opracowania", "data_przegladu" }
}
```

### 4.3. Parametry zmienne w czasie

Osobna tabela `parametry.json`: każdy z `obowiazuje_od`, `obowiazuje_do`, `wartosc`, `zrodlo`. Przykłady do wpisania:
- `minimalne_wynagrodzenie`: 4806 zł, od 2026-01-01
- `dodatek_nocny_stawka`: liczona = 20% × minimalne / wymiar godzin miesiąca (wpisz wymiar dla każdego miesiąca 2026; wynik ok. 5,22–6,01 zł/h)
- `odszkodowanie_1proc`: 1781 zł, od 2026-04-01 do 2027-03-31
- `mobbing_zadoscuczynienie_min`: 6 × minimalne = 28 836 zł, od 2026-11-05
- `napoje_prog_pomieszczenie`: 28 °C; `napoje_prog_otwarta`: 25 °C
- `dzwiganie_kobiety`: 12 kg stale / 20 kg dorywczo; `dzwiganie_mezczyzni`: 30 / 50
- `przerwa_monitor`: 5 min po każdej godzinie
- `przerwy_art134`: 15 min ≥6 h; +15 min >9 h; +15 min >16 h
- `odpoczynek_dobowy`: 11 h; `tygodniowy`: 35 h

**Test zasady 9:** ustaw w danych testowych jeden parametr z `obowiazuje_do` w przeszłości i sprawdź, że aplikacja pokazuje komunikat zastępczy, a nie starą kwotę.

### 4.4. Grafik

Szablony zmian (`skrot`, `od`, `do`, `kolor`) + kalendarz (data → id szablonu). Domyślnie podpowiadane: D 7:00–19:00, N 19:00–7:00. Wzorce rotacji (np. 2-2-3) jako przyspieszacz. Okno snu po nocce = od końca zmiany N + 30 min do +7 h (edytowalne).

### 4.5. Profil przykładowy „Barbara"

Do przycisku „Zobacz, jak to działa": rocznik 1974, umowa o pracę, status: medyk, zmiany z nocami (D/N), dzwiganie: ludzie, kontakt: ryzyko agresji, biologia: tak, odziez: tak, monitor: do 2 h. Profil przykładowy ma osobny magazyn danych i **nie nadpisuje** profilu użytkownika. Stały pasek: „To jest przykład. Ustaw własną aplikację →".

## 5. Mapa ekranów (48)

Zasady wspólne: belka dolna (Stanowisko · Sprawdź · Aktualności · Pomoc) widoczna na ekranach głównych i przeglądania, **ukryta** w kreatorze, sprawdzaczu po rozpoczęciu pytań i w ścieżkach Pomocy. Cofnięcie = jeden ekran wstecz z zachowaniem odpowiedzi. Krzyżyk tylko w kreatorze/sprawdzaczu (z potwierdzeniem, bo kasuje odpowiedzi) i w całej Pomocy (bez potwierdzenia — ekran bywa zamykany, gdy ktoś nadchodzi).

**E0 — wejście i konfiguracja (23)**
- E0.1 Powitanie: „BHPewnie. Sprawdź, co Ci się w pracy należy — i przypomnij sobie o tym w porę. Nic, co tu ustawisz, nie opuszcza Twojego telefonu." Przyciski: „Ustaw swoją aplikację" / „Zobacz, jak to działa".
- E0.2–E0.14 Krok 1 (13 pytań, jeden na ekran, przykłady, Tak/Nie, „Nie wiem — pomiń", pasek postępu bez ponaglania). Brzmienia — sekcja 6.1.
- E0.15 Stałe godziny czy zmiany (+ możliwość odłożenia grafiku: „Możesz to zrobić później. Bez grafiku nie zadziałają tylko przypomnienia liczone z Twoich zmian.")
- E0.16 Szablony zmian · E0.17 Kalendarz (malowanie dotknięciem, wzorce rotacji)
- E0.18 Umowa · E0.19 Przepisy szczególne (lista statusów, osobno „funkcjonariusz" i „pracownik cywilny w służbie", po jednym zdaniu wyjaśnienia) · E0.20 Rok urodzenia · E0.21 Niepełnosprawność (dobrowolne, „wolę nie odpowiadać")
- E0.22 Wynik: „Na Twoim stanowisku przysługuje Ci N uprawnień" z animowanym odsłonięciem listy
- E0.23 Nazwa i ikona profilu (w całości opcjonalne; dowolna etykieta)

**E1 — Moje stanowisko (4)**
- E1.1 Ekran główny: nagłówek profilu (rytm · umowa · 50+; dotknięcie → E5.2), panel sezonowy warunkowy, kafle z konkretem, „Sprawdź, co Ci przysługuje", karta ostatniej aktualności, „Pobierz kartę moich uprawnień"
- E1.2 Karta uprawnienia (opis, parametr, zwijana podstawa, data stanu prawnego, wariant wg umowy/statusu; wyjścia: sprawdzacz, przypomnienie, powrót)
- E1.3 Podgląd karty uprawnień PDF
- E1.4 Moje terminy (odliczanie, edycja daty, przypomnienie)

**E2 — Sprawdź (6)**
- E2.1 Lista 13 sytuacji (sezonowe na górze w sezonie; poza tym kolejność stała)
- E2.2 Pytania (2–4, jedno na ekran, licznik kroków)
- E2.3 Karta wyniku (3 stany; uzasadnienie odwołujące się do odpowiedzi; blok „ile"; zwijana podstawa z datą; 3 stałe akcje; stopka „Informacja edukacyjna, nie porada prawna")
- E2.5 Podgląd wniosku PDF · E2.6 Skrypt rozmowy (wersja ustna i mailowa z tematem, Kopiuj) · E2.7 Przypomnienie (panel)

**E3 — Aktualności (3)**: E3.1 strumień (tytuł, źródło, data, 2 zdania; przy zmianie prawa licznik dni) · E3.2 wpis (odnośnik zewnętrzny; „przypomnij mi, gdy wejdzie w życie") · E3.3 archiwum (wczytane wpisy czytelne offline)

**E4 — Pomoc (13)**
- E4.1 Wejście: dwa rozdzielone wejścia — „Coś się stało — poprowadzę Cię krok po kroku" / „Potrzebuję rozmowy — bez kroków, od razu telefon do człowieka"; poniżej: biblioteka, po zdarzeniu, gdzie szukać pomocy. **Stały pasek: ☎ 112 · ☎ 800 70 2222** na każdym ekranie E4.
- E4.2 Wybór sytuacji (5 kafli: wypadek, agresja lub napaść, kontakt z czymś szkodliwym, sytuacja awaryjna, nękanie)
- E4.3 Krok ścieżki (nagłówek w trybie rozkazującym, ≤2 zdania, ostrzeżenie „czego nie robić", wielki „Zrobione — dalej", cofnięcie)
- E4.4 Rozgałęzienie · E4.5 Zamknięcie ścieżki (co dalej, → karta praw, przypomnienie na jutro)
- E4.6 Karta praw po zdarzeniu (warianty wg umowy/statusu, do zapisania)
- E4.7 Dziennik zdarzeń — lista · E4.8 Wpis (data, godzina, opis, świadkowie; napis „zapis wyłącznie w Twoim telefonie") · E4.9 Notatnik prawie-wypadków (co się stało, co mogło się stać, kto widział; podpowiedź, komu zgłosić)
- E4.10 Ekran kryzysowy — **dokładnie**: „Możesz teraz porozmawiać z człowiekiem. To nic nie kosztuje i nie musisz się przedstawiać." + dwa wielkie przyciski połączeń: **800 70 2222** (całodobowo, bezpłatnie), **116 123** (telefon zaufania dla dorosłych) + „Jeśli zagrożone jest życie — dzwoń 112." **Nic więcej.** Nie zapamiętuje stanu.
- E4.11 Biblioteka (głowa · ciało · zdrowie · wsparcie innych; przycisk pobrania przy każdym, „pobierz całość") · E4.12 Materiał (treść, ilustracje przy protokołach, metryczka, zastrzeżenie / objawy alarmowe) · E4.13 Gdzie szukać pomocy (dla kogo, kiedy, czy anonimowe, czy płatne; osobno systemy branżowe)

**E5 — Ustawienia (7)**: E5.1 menu · E5.2 profil (zmiana pojedynczej odpowiedzi; komunikat co się przeliczyło) · E5.3 grafik · E5.4 budziki (przełączniki pogrupowane; reguły nie godziny; „Cisza po nocce" jako plakietka **auto**; podgląd wyliczonego harmonogramu) · E5.5 pobrane materiały (zajętość, usuwanie) · E5.6 o aplikacji (regulamin, brak zbierania danych, deklaracja dostępności, sygnatariusze, oznaczenia FE, wersja) · E5.7 zgłoś uwagę (otwiera `mailto:`)

**E6 — Sprawdzian wiedzy (2)**: pytanie · wynik (tylko lokalnie, z odesłaniem do materiałów)

## 6. Treści przykładowe do wpisania (realistyczne, oznaczone jako robocze)

### 6.1. Pytania kreatora (brzmienia obowiązujące)
1. Czy pracujesz przy komputerze albo z ekranem? → Ile mniej więcej godzin dziennie? (do 2 / 2–4 / ponad 4)
2. Czy dźwigasz lub przenosisz ciężkie rzeczy — albo pomagasz przemieszczać się ludziom? Np. worki, skrzynie, narzędzia, meble; albo pacjent, podopieczny, osoba z ograniczoną sprawnością. → Rzeczy, ludzie, czy jedno i drugie?
3. Czy pracujesz na dworze — w terenie, w polu, na drodze, na budowie?
4. Czy prowadzisz pojazd w ramach pracy — auto, busa, ciężarówkę, maszynę?
5. Czy Twoja praca to kontakt z ludźmi z zewnątrz — pacjentami, uczniami, petentami, pasażerami, klientami? → Jak bywa? (spokojna obsługa / bywa nerwowo / bywają groźby lub agresja)
6. Czy mówisz zawodowo przez wiele godzin — uczysz, prowadzisz zajęcia, obsługujesz telefon?
7. Czy masz styczność z chemią — środkami przemysłowymi, opryskami, rozpuszczalnikami, pyłem?
8. Czy masz kontakt z chorymi, materiałem zakaźnym, zwierzętami albo kleszczami?
9. Czy w Twojej pracy jest głośno albo pracujesz narzędziami, które drgają?
10. Czy pracujesz w gorącu (kuchnia, piec, pełne słońce) albo w zimnie (chłodnia, dwór zimą)?
11. Czy pracujesz przy maszynach w ruchu, na wysokości, z ostrymi narzędziami albo z bronią?
12. Czy używasz do pracy własnych ubrań albo sam(-a) pierzesz odzież roboczą?
13. Czy bywasz w pracy zupełnie sam(-a) — bez nikogo w pobliżu, kto mógłby pomóc?
14. Stałe godziny czy zmiany? 15. Jaką masz umowę? 16. Czy należysz do grupy z osobnymi przepisami? 17. W którym roku się urodziłeś(-aś)? 18. Czy masz orzeczenie o niepełnosprawności? (dobrowolne)

### 6.2. Kafle dla profilu „Barbara" (przykłady)
- „Dodatek za pracę w nocy — 5,22 zł za każdą godzinę nocną" (listopad 2026; art. 151⁸ KP; **ukryty przy zleceniu i u funkcjonariusza**)
- „Badania okresowe — za 64 dni, w godzinach pracy, na koszt pracodawcy" (art. 229 KP)
- „Przemieszczanie pacjenta — sprzęt pomocniczy to obowiązek pracodawcy"
- „Odzież robocza — ekwiwalent za pranie własnej odzieży" (art. 237⁹ § 3 KP)
- „Normy dźwigania — kobiety 12 kg stale / 20 kg dorywczo; mężczyźni 30 / 50" (bez pytania o płeć — pokaż obie)
- Panel sezonowy (symulacja): „Dziś 30 °C w Twojej okolicy. Pracodawca ma obowiązek zapewnić napoje."

### 6.3. Trzynaście sytuacji w „Sprawdź"
Pracuję w upale albo na mrozie · Każą mi dźwigać · Siedzę przy monitorze · Używam własnych ubrań do pracy · Nie dostałem środków ochrony · Mam badania okresowe · Wysyłają mnie na szkolenie BHP · Miałem wypadek przy pracy · Choruję przez pracę · Pracuję w nocy · Nie mam kiedy odpocząć · Jest za zimno albo za ciasno w pomieszczeniu · Pali się — ewakuacja.

**Zaimplementuj w pełni 3 ścieżki** (upał → napoje; własna odzież → ekwiwalent z 3 stanami; monitor → przerwa + okulary), pozostałe jako plansza „w pełnej wersji". Przy zleceniu „Pracuję w nocy" i „Nie mam kiedy odpocząć" → wynik szary: „Na zleceniu nie przysługuje z mocy prawa — sprawdź swoją umowę."

### 6.4. Karta wyniku — przykład wzorcowy (ekwiwalent za pranie)
- Werdykt (zielony): „Przysługuje Ci ekwiwalent"
- Uzasadnienie: „Pracodawca nie zapewnia Ci odzieży roboczej, a Ty pierzesz ją sam — za jedno i drugie należy się ekwiwalent pieniężny."
- Ile: „Kwotę ustala pracodawca według kosztów prania i cen odzieży. Masz prawo poznać sposób wyliczenia."
- Podstawa: art. 237⁹ § 3 Kodeksu pracy · Stan prawny na 1 września 2026
- Skrypt: „Pani Kierowniczko, używam do pracy własnej odzieży i sam ją piorę. Zgodnie z art. 237⁹ § 3 Kodeksu pracy przysługuje mi za to ekwiwalent pieniężny. Proszę o informację, w jakiej wysokości i od kiedy będzie mi wypłacany." (+ wersja mailowa z tematem)

### 6.5. Ścieżka „Wypadek — mój własny" (8 kroków, zaimplementuj w całości)
1. Przerwij zagrożenie. (ostrzeżenie: nie wracaj po rzeczy) → rozgałęzienie: czy możesz się poruszać
2. Sprawdź siebie. (próg wezwania pomocy)
3. Wezwij pomoc. Powiedz: gdzie, co się stało, ile osób, czy przytomne. (nie rozłączaj się pierwszy)
4. Powiedz przełożonemu. (zgłoś nawet drobny uraz — dlaczego)
5. Nie zmieniaj miejsca zdarzenia. (co zostawić, kto może zmienić)
6. Zapisz świadków.
7. Zapisz swoją wersję — dziś, nie za tydzień. (lista elementów)
8. Poproś o dokumentację medyczną.
Ekran zamykający: kto zwoła zespół powypadkowy, protokół w 14 dni, prawo zgłoszenia uwag i zastrzeżeń; → karta praw (chorobowe 100%, jednorazowe odszkodowanie 1781 zł/1%, zastrzeżenia do protokołu; wariant funkcjonariusza: komisja formacji, ustawa z 4.04.2014) → „Przypomnij mi jutro o zgłoszeniu na piśmie". Materiał od psychologa: „Co się ze mną dzieje po trudnym zdarzeniu" (placeholder z metryczką).

### 6.6. Aktualności (5 wpisów przykładowych)
Pierwszy: „Nowa definicja nękania w pracy — wchodzi 5 listopada 2026" z **żywym licznikiem dni** i zdaniem o zadośćuczynieniu min. 28 836 zł; przycisk „przypomnij mi, gdy wejdzie w życie".

### 6.7. Budziki (E5.4)
| budzik | reguła | widoczny dla |
|---|---|---|
| Przerwa przy monitorze | co 2 h w trakcie zmiany | monitor, umowa o pracę |
| Protokół przed nocką | 2 h przed zmianą N | grafik z N |
| Cisza po nocce | okno snu z grafiku | auto, bez przełącznika |
| Badania okresowe | 30 i 7 dni przed | każdy z terminem |
| Szkolenie okresowe BHP | 30 dni przed | wg grupy |
| Alert upałowy i zimowy | gdy warunek zachodzi | teren / pomieszczenie |
| Nowa stawka dodatku nocnego | 1 stycznia i 1 lipca | noce, umowa o pracę |
| Wejście przepisu w życie | w dniu wejścia | kto poprosił |
| Powrót po ścieżce Pomocy | następnego dnia | kto ustawił |
| Prasówka | wtorek, godzina użytkownika | kto włączył |

## 7. Przebiegi zadań = scenariusze akceptacyjne (napisz jako testy e2e)

- **P1** Pierwsze uruchomienie → profil (≤30 dotknięć przy pełnej konfiguracji; ≤17 przy pominięciu grafiku). Pominięcie ustawia wartość bezpieczną i oznacza kafle jako niepewne.
- **P2** Grafik szablonami → przy włączonych budzikach natychmiastowe przeliczenie + jedno zdanie potwierdzenia.
- **P3** Włączenie budzika → reguła, nie godzina; odmowa zgody systemowej → pasek „Twój telefon nie pozwala nam się odezwać…"; cisza po nocce widoczna jako **auto**.
- **P4** Kafel → karta uprawnienia (2 dotknięcia do wiedzy, 4 do dokumentu).
- **P5** Sprawdzacz → 3 stany; bursztyn = ≤2 rzeczy do sprawdzenia + skrypt pytania zamiast wniosku; szary = powód + uprawnienie pokrewne; krzyżyk kasuje z potwierdzeniem.
- **P6** PDF: pola osobowe puste; struktura nagłówków; stopka; placeholder FE; ta sama droga z E1.3 i E4.6.
- **P7** Ścieżka Pomocy: działa offline; pasek numerów na każdym kroku; krzyżyk bez pytania; przerwana → przy powrocie „Zaczęliśmy to wcześniej. Wrócić tam, gdzie skończyliśmy, czy zacząć od nowa?" (stan trzymany 7 dni); nękanie → dziennik zamiast karty praw.
- **P8** Notatnik prawie-wypadków: 4 pola; eksport chronologiczny; napis o lokalnym zapisie.
- **P9** Zmiana umowy/statusu → komunikat: „Przeliczyliśmy Twoją aplikację. Przybyły 3 uprawnienia, ubyło 1. Dwa przypomnienia przestały mieć zastosowanie i je wyłączyliśmy." Dokumenty i wpisy nienaruszone.

## 8. Sytuacje brzegowe — wymagane zachowania (zaimplementuj i przetestuj wszystkie)

| id | okoliczność | wymagane zachowanie |
|---|---|---|
| B1 | brak profilu / pominięte pytania | uprawnienia powszechne + panel „Pokazujemy to, co przysługuje każdemu. Odpowiedz na 3 pytania, a dopiszemy resztę."; kafle niepewne oznaczone |
| B2 | brak internetu | wszystko działa poza Aktualnościami; tam: „Ostatnio odświeżone: [data]. Nowe wpisy pojawią się, gdy będziesz mieć internet."; **żadnego** komunikatu błędu gdzie indziej |
| B3 | odmowa zgody na powiadomienia | przełączniki bez zmian; pasek z przejściem do ustawień systemu; ponowna prośba nie częściej niż co kilkanaście dni |
| B4 | brak dokładnych alarmów (Android) | wykryj; komunikat przy budzikach rytmicznych: „Przypomnienia mogą przyjść z opóźnieniem. Żeby były punktualne, zezwól aplikacji na dokładne alarmy." |
| B5 | zmiana strefy / czasu urzędowego | porównaj przy otwarciu; przelicz; komunikat tylko przy strefie; harmonogram = reguły, nie godziny |
| B6 | restart urządzenia | odtwórz harmonogram przy pierwszym otwarciu; bez komunikatu |
| B7 | przerwany kreator / sprawdzacz / ścieżka | zapamiętaj; pytaj przy powrocie; ścieżka 7 dni; **ekran kryzysowy nigdy nie pamięta** |
| B8 | odpowiedzi sprzeczne | nie blokuj; włącz obie cechy; dopytaj tylko przy logicznej niemożliwości |
| B9 | brak treści dla kombinacji | kafel zastępczy: „Dla Twojego zestawu warunków przygotowujemy dokładniejsze wskazówki. Tymczasem sprawdź, co przysługuje każdemu."; **licznik luk** (tylko liczba, lokalnie; w prototypie widoczny w ukrytym ekranie deweloperskim) |
| B10 | wygaśnięcie parametru | NIE pokazuj starej liczby; „Ta kwota zmienia się od [miesiąc]. Sprawdzamy nową wartość." |
| B11 | aktualizacja systemu | zapamiętaj wersję OS; po zmianie odtwórz harmonogram i sprawdź uprawnienia |
| B12 | mała pamięć | sprawdź miejsce przed pobraniem; „Do pobrania tego materiału brakuje X MB. Możesz usunąć wcześniej pobrane materiały w ustawieniach." |

Trzy zasady nadrzędne: nigdy pusty ekran bez wyjaśnienia · nigdy niepewna wartość jako pewna · nigdy obwinianie użytkownika za stan urządzenia (komunikat mówi, co zrobić).

## 9. Dostępność (od pierwszego commita)

- Pismo bazowe ≥16 px (1rem), skalowalne do 200% bez przewijania w poziomie; wysoki kontrast (AA); cele dotykowe ≥48×48 px; jedno zagadnienie na ekran.
- Pełna obsługa czytnikiem ekranu: semantyczne nagłówki, etykiety `aria-*`, role, kolejność odczytu, `aria-live` dla komunikatów przeliczenia.
- Stan werdyktu niesiony ikoną + słowem, nie tylko kolorem.
- Klawiatura: wszystko dostępne z klawiatury (wersja przeglądarkowa).
- Tryb ciemny (`prefers-color-scheme`) — istotny przy korzystaniu w nocy.
- Brak gestów wymagających precyzji (bez swipe jako jedynej drogi).
- Uruchamiaj `axe-core` w testach; zapisuj wyniki.

## 10. Kolejność prac i definicja gotowości

**Etap A — fundament:** model danych (cechy, moduły, parametry z datami), silnik reguł (wektor cech → lista uprawnień z wariantami), profil przykładowy, magazyn lokalny, PWA offline. DoD: test jednostkowy silnika na 3 profilach (Barbara; zleceniobiorca fizyczny w terenie; funkcjonariusz zmianowy) daje różne, poprawne zestawy kafli.

**Etap B — kreator + ekran główny:** E0.1–E0.23, E1.1–E1.4, generator PDF karty. DoD: P1, P4, P6, B1, B8 przechodzą.

**Etap C — Sprawdź:** E2.1–E2.7 z 3 pełnymi ścieżkami. DoD: P5, P6, B10 przechodzą.

**Etap D — Pomoc:** E4.1–E4.13, ścieżka wypadkowa w całości, ekran kryzysowy, dzienniki, pasek numerów. DoD: P7, P8, B2 (offline), B7 przechodzą.

**Etap E — Budziki i grafik:** E0.16–E0.17, E5.3, E5.4, silnik harmonogramu 14 dni, cisza po nocce, powiadomienia w miarę możliwości PWA. DoD: P2, P3, B3–B6, B11; **raport w ROZBIEZNOSCI.md o realnej niezawodności powiadomień**.

**Etap F — Aktualności, ustawienia, quiz, dostępność:** E3, E5, E6, tryb ciemny, axe bez błędów krytycznych. DoD: P9, B9, B12; wszystkie 48 ekranów osiągalne.

**Etap G — pakowanie:** README (uruchomienie, struktura `content/`, jak zmienić treść bez kodu), skrypt seedujący dane, eksport listy ekranów z kodu porównany z listą 48 (ma się zgadzać), `ROZBIEZNOSCI.md` uporządkowany.

## 11. Rejestr rozbieżności — `ROZBIEZNOSCI.md`

Prowadź od pierwszego commita. Każdy wpis:

```
### [numer] [krótki tytuł]
- Założenie strategii: (cytat lub odesłanie do sekcji briefu)
- Co okazało się w praktyce:
- Skutek dla użytkownika / kosztu / harmonogramu:
- Proponowane rozstrzygnięcie: (A) zmienić założenie / (B) zmienić technologię / (C) zaakceptować ograniczenie
- Dowód: (test, link do commita, zrzut)
```

Obowiązkowo zbadaj i opisz: (1) niezawodność planowanych powiadomień lokalnych w PWA na Androidzie i iOS vs Capacitor; (2) wykonalność tagowanego PDF po stronie klienta; (3) rozmiar paczki z wbudowanymi treściami; (4) czy 13 pytań + dopytania mieści się w 3 minutach w teście z osobą 55+; (5) czy 3 stany werdyktu bez czerwieni są czytelne dla osób z zaburzeniami widzenia barw; (6) czy „Cisza po nocce" jako pozycja bez przełącznika jest zrozumiała; (7) czy limit 3 powiadomień/dobę da się zrealizować przy pełnym grafiku; (8) ile realnie dotknięć zajmuje P1.

## 12. Czego NIE robić

- Nie dodawaj logowania, kont, „zapisz w chmurze", synchronizacji, analityki, crash-reportingu, fontów z CDN.
- Nie twórz tabeli zawodów ani „profili zawodowych". Nie dodawaj ekranu „wybierz zawód".
- Nie używaj czerwieni dla stanu „nie przysługuje". Nie dodawaj punktów, odznak, serii, rankingów.
- Nie pokazuj nigdy parametru bez daty stanu prawnego.
- Nie umieszczaj na ekranie kryzysowym niczego poza dwoma zdaniami, dwoma numerami i zdaniem o 112.
- Nie używaj zdrobnień, żartów ani „osobowości" w module Pomoc.
- Nie pobieraj lokalizacji z urządzenia — miejscowość do alertów wpisuje użytkownik.
- Nie wklejaj cudzych artykułów w całości do Aktualności (tylko lead własny + odnośnik).
- Nie wymyślaj kwot i podstaw prawnych poza podanymi — brakujące oznacz `[do uzupełnienia przez specjalistę]`.
- Nie używaj anglicyzmów w interfejsie (nie: „dashboard", „profil użytkownika", „notyfikacja"; tak: „Moje stanowisko", „Mój profil", „przypomnienie").

---
*Brief przygotowany na podstawie „Strategii realizacji aplikacji BHPewnie" (Forum Związków Zawodowych, wrzesień 2026). Wszystkie treści prawne mają charakter roboczy i wymagają autoryzacji przez specjalistów przed publikacją.*
