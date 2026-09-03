# Przekazanie: BHPewnie, wydanie 1.2

Odpowiedź projektowa na `ZLECENIE_DESIGN_1_2.md`. Stan na 3 września 2026.

## Czym jest ten pakiet

`System BHPewnie v2.dc.html` to **kanwa projektowa w HTML** — dokument referencyjny, nie kod produkcyjny. Makiety w nim są rysowane stylami wpisanymi w atrybuty, w jednym pliku, po to, żeby dały się czytać i mierzyć w przeglądarce. **Nie kopiuj z nich znaczników.** Zadanie polega na odtworzeniu tych układów w istniejącym środowisku aplikacji `bhpewnie/` — w jej klasach z `src/style/globalne.css`, jej strukturze i jej konwencjach nazewniczych.

Kanwa mierzy się w przeglądarce: każda liczba w tym dokumencie i w notach na kanwie jest **wyrenderowana**, nie oszacowana. Jeśli implementacja da inną liczbę, to implementacja jest błędna albo liczba wymaga poprawki w kanwie — nie należy tego zostawiać.

## Wierność

**Wysoka (hifi).** Kolory, stopnie pisma, wysokości, wyściółki, obrysy i promienie są ostateczne. Widok odniesienia: **393 × 727 px** (Pixel 5 z paskiem przeglądarki), profil przykładowy „Barbara" — 27 uprawnień, grafik zmianowy z nockami, umowa o pracę. Wyjątkiem są wireframe'y w §6 kanwy (poprzednie wydanie) — te są lofi.

## Ośmiu reguł nie ruszamy — dwie zmieniają brzmienie

Osiem reguł z nagłówka `globalne.css` zostaje. Dwie z nich **zmieniają brzmienie, nie treść** — nazywają powód zamiast miejsca:

- **Reguła 2 (terakota).** Było: „powaga występuje wyłącznie w module Pomoc". Jest: „powaga oznacza **ryzyko, które stwarza drugi człowiek**". Dziś to dwa miejsca — moduł Pomoc i ostrzeżenie w pakiecie umowy (E2.3). Błędy formularza terakoty **nie dostają**.
- **Reguła 3 (cele dotykowe).** Było: „72 px w Pomocy". Jest: „**72 px dla czynności wykonywanej w pośpiechu lub w rękawicy**". Dziś to Pomoc i rejestracja czasu pracy (E7.1). Testy dostępności należy **rozszerzyć** o E7.1, nie osłabić.

Trzecia zmiana dotyczy reguły 1: dopuszcza cień **1 px jako podniesienie karty nad tłem**, nigdy jako źródło hierarchii. Skala promieni to **8 / 12 / 14 / 999** (było 6 / 10 / 14 / 999). To decyzja użytkownika z 3 września; uzasadnienie i warunki odwrócenia — wpis (l) w `ROZBIEZNOSCI_DESIGN.md`.

Sześć rodzin semantycznych, nazwy zmiennych CSS, pismo IBM Plex Sans z plików lokalnych, cyfry tabelaryczne, brak animacji przejść, zero czerwieni w interfejsie — **bez zmian**.

## Kolejność wdrożenia

1. **`box-sizing: border-box` i wysokość kafla.** Bez tego żadna inna liczba w tym pakiecie się nie zgadza. Kafel `height: 104px` przy `content-box` renderuje 130 px, a wtedy trzy kafle zamiast 328 px zajmują 406 px i cały budżet ekranu głównego się rozsypuje.
2. Układ E1.1 (cztery warstwy, niżej).
3. Stany kafla (cztery zamiast sześciu) i znaki werdyktu.
4. E1.2, grupa E7, listy zamiast tabel, ikony.

## Tokeny projektowe

### Kolory — tryb jasny

| rola | wartość |
|---|---|
| tło | `#FAF8F5` |
| karta | `#FFFFFF` |
| karta druga | `#F2EEE8` |
| obrys | `#E0D9CD` |
| obrys mocny | `#B9B0A3` |
| tekst | `#22262B` |
| tekst drugi | `#3D434A` |
| tekst trzeci | `#5A6068` |
| pewność | `#0F6B63` |
| pewność głęboka (tekst, liczby) | `#0B554F` |
| zależy (obrys, tekst) | `#E0BE72` / `#8A5A00` |
| zależy (tło panelu) | `#FDF1D9` |
| powaga (obrys, tekst) | `#9A3B28` / `#7E2E1E` |
| powaga (tło) | `#FBEDE9` |
| tekst zastępczy w polu | `#6B6660` |

### Kolory — tryb ciemny

| rola | wartość |
|---|---|
| tło | `#1A1917` |
| karta | `#232220` |
| karta druga | `#2C2B28` |
| obrys | `#35322D` |
| obrys mocny | `#5F5C55` |
| tekst | `#EDE9E3` |
| tekst drugi | `#B0AAA1` |
| pewność | `#55C6B4` (tekst na pewności: `#10221F`) |
| zależy (obrys, tekst) | `#8A6A2A` / `#E8C572` |
| powaga | `#E28B72` |

Czerwień FZZ `#C9302B` występuje **wyłącznie** w blokach nadawcy i w oprawie dokumentów. W interfejsie nie ma jej wcale.

### Skale

- **Odstępy:** wielokrotności czterech pikseli — 4 / 8 / 12 / 16 / 20 / 24 / 32. Jedno odstępstwo: 3 px między klawiszami klawiatury numerycznej w module Pomoc (czwórka rozpycha klawisze ponad wysokość ekranu).
- **Promienie:** 8 (element wewnątrz innego elementu), 12 (wiersze list, pola, pastylki), 14 (karty, przyciski, pola formularza), 999 (wskaźniki, kropki). Promień zagnieżdżony liczy się jako promień rodzica minus jego wyściółka: element w wyściółce 4 px w torze o promieniu 12 ma 8.
- **Cele dotykowe:** 48 px zwykłe, 56 px główne, 72 px w pośpiechu lub w rękawicy. Odnośniki tekstowe też — `min-height: 48px; padding: 0 4px; display: flex; align-items: center`. Wyrównanie rodzica **nie** powiększa dziecka: rodzic o 48 px z `align-items: center` daje odnośnikowi 19 px, jeśli odnośnik sam nie ma `min-height`.
- **Pismo:** baza 16 px. Skala w makietach: 13 / 14 / 15 / 16 / 17 / 19 / 20 / 26 / 28 / 34 / 44 px. Nagłówki ekranów 26 px / 600 / `letter-spacing: -0.018em`. Liczby w blokach „ile" — 28–44 px / 700, cyfry tabelaryczne.
- **Cień:** `0 1px 2px rgba(20, 22, 26, 0.05)`, tylko na kartach w trybie jasnym. W trybie ciemnym cienia nie ma — warstwy rozdziela obrys.
- **Wersaliki:** w całej aplikacji **jedno** miejsce — plakietka ostrzeżenia o ryzyku („ZANIM ZROBISZ KROK"). Nagłówek tabeli i plakietka warunku ich nie mają.

## Kafel uprawnienia

Podstawowy element listy. Wysokość **zewnętrzna 104 px** przy `box-sizing: border-box`.

- Wyściółka 12 px góra i dół, 14 px boki — **wewnątrz** 104 px.
- Siatka: kolumna treści `flex: 1; min-width: 0` plus kolumna znaku stanu `flex: 0 0 24px`.
- Kolumna treści: `display: flex; flex-direction: column; justify-content: space-between` — tytuł u góry, konkret u dołu.
- Tytuł: 17 px / 600 / `line-height: 1.24`, do dwóch linii, potem obcięcie.
- Konkret: 15 px / 400 / `line-height: 1.3`, **jedna linia**, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- Pełna treść konkretu istnieje wyłącznie na karcie uprawnienia. Kafel nigdy nie rośnie.
- Cel dotykowy: cały kafel, 104 px.
- **Bez lewej listwy akcentu.** Listwa została tylko tam, gdzie koduje werdykt (karty wyniku) i na cytatach podstawy prawnej, gdzie jest znakiem cytatu.

Trzy kafle z odstępami 8 px zajmują **328 px** (było 525 px przy kaflach 127–247 px).

### Cztery stany werdyktu

Werdykt niesie **kolor, znak i słowo** — żadne z nich osobno.

| stan | tło | obrys | znak | słowo |
|---|---|---|---|---|
| przysługuje | karta | obrys | pełna krzywa (✓ rysowany jako `path`) | „Przysługuje" w kolorze pewności głębokiej |
| zapytamy o jedno | karta druga | obrys mocny | znak zapytania | plakietka „Zapytamy o jedno" |
| to zależy | karta | `#E0BE72` | koło wypełnione do połowy | „To zależy" w `#8A5A00` |
| nie przysługuje | karta druga | obrys | koło przekreślone | „Nie przysługuje" w tekście trzecim |

Znaki `✓ ~ —` z wydania 1.2 są **wycofane**: myślnik czytał się jak interpunkcja, fala jak literówka. Nowe trzy różnią się **konturem**, nie tylko kolorem, więc rozpoznaje się je w skali szarości i przy 200% powiększenia. Znak stanu: SVG 24 × 24 px, siatka 24, `aria-hidden="true"`.

Stan „zapytamy o jedno" **nie ma znaku werdyktu** — bo werdyktu jeszcze nie ma. Jego nośnikami są znak zapytania w narożniku i plakietka ze słowem.

### Znacznik świeżości — osobna oś

Stany `niepewny` i `wygaszony` z wydania 1.2 **nie były stanami werdyktu** — mówiły o wieku odpowiedzi, i różniły się tylko kolorem obrysu przerywanego, czyli w praktyce niczym. Zastępuje je **jeden modyfikator**, który łączy się z każdym z czterech stanów:

- obrys przerywany (`1px dashed` w kolorze obrysu mocnego),
- plakietka „Do odświeżenia" z ikoną strzałki w kole,
- znak werdyktu **zostaje na miejscu** — znacznik go nie podmienia.

Powód: pominięte pytanie kreatora albo parametr po dacie ważności. Rozdzielenie osi zamyka listę na czterech stanach razy dwa; sześć stanów po scaleniu dałoby osiem, potem dwanaście.

### Plakietka

13 px / 600, **bez wersalików**, w pastylce o promieniu 8 px z obrysem, z ikoną 16 px. Brzmienie: **„Zapytamy o jedno"**. Wersaliki czytały się jak ostrzeżenie, choć nic złego się nie stało; „warunek" to słowo z rejestru prawniczego, przed którym cała aplikacja się broni. Brzmienie jest propozycją redakcyjną i należy do testu z użytkownikami — forma obroni każdy z trzech wariantów autora bez zmian w projekcie.

## Ekrany

### E1.1 Ekran główny

Cztery warstwy, w tej kolejności. Dwie skrajne są stałe, jedna kurczy się, jedna rośnie.

```
pasek stanu                                    30 px   stała
nagłówek stały (flex column, gap 8)           223 px   stała, nie kurczy się
  kafel profilu                                80 px
  pasek „Coś się zmieniło w Twojej pracy?"     56 px
  panel sezonowy (przycisk)                    48 px
  nagłówek listy                               20 px
pole kafli   flex: 1; min-height: 0           336 px   rośnie i kurczy się
  padding: 8px 16px 0
  stos trzech kafli                           328 px
pas akcji z dokumentem                         68 px   stała
  padding: 4px 16px 8px
  „Pobierz kartę moich uprawnień"              56 px
pas nawigacji                                  68 px   stała
                                        ────────────
                                              725 px
```

**Dlaczego tak.** W wydaniu 1.2 przyciski akcji siedziały wewnątrz przewijanego pola, więc nadmiar treści wypychał je pod pas nawigacji — najważniejsza akcja ekranu chowała się przed użytkownikiem. Teraz jedynym elementem rozciągliwym jest pole kafli i ma `min-height: 0`, więc nic nie może wypchnąć nawigacji poza ramkę.

**Pułapka.** Blok bez `min-height: 0` w kolumnie flex ma `min-height: auto` i nie kurczy się poniżej swojej zawartości. To był pierwotny błąd tego ekranu.

Zestaw obowiązkowy z punktu 3.4 zlecenia schodzi z **1036 px na 718 px** (liczby obejmują pasek stanu, odstępy i nawigację — czyli wszystko, co zajmuje wysokość). Wpis 16 z `ROZBIEZNOSCI.md` **nie wymaga już wyboru** między trzema kaflami a drogą do dokumentu: kafle leżą w polu przewijanym, dokument w stałym pasie, więc żadne z nich nie wypycha drugiego.

#### Pasek „Coś się zmieniło w Twojej pracy?" — 98 → 56 px

Treść zostaje **w całości**. Trzy zabiegi układowe:

1. ikona (24 px) i strzawka kierunkowa (20 px) wychodzą z toku tekstu jako `flex: 0 0 <szerokość>`,
2. tekst dostaje **jedną linię z obcięciem** (`flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis`),
3. cały pasek jest `<button>` na pełną szerokość — nie kartą z przyciskiem w środku.

Przy 200% powiększenia tekst zawija się do dwóch linii i pasek rośnie do 84 px. To dozwolone: powiększenie ma prawo zmieniać układ, byle nic nie ginęło.

#### Panel sezonowy — 126 → 48 px

Zwinięty do jednej linii: ikona, tekst „Dziś 30 °C — napoje i przerwy", strzałka. **Cały jest przyciskiem** o wysokości 48 px — cel dotykowy nie może być mniejszy od reguły, a kto sięga po pasek w rękawicy, trafia w niego całym palcem. Pełna treść (napoje, przerwy, obowiązki pracodawcy) stoi na karcie sezonowej, do której ten przycisk prowadzi. Poza miesiącami maj–wrzesień panel nie istnieje.

#### Wygaszenie krawędzi

Pole kafli ma `position: relative`, a jego ostatnim dzieckiem jest `<div aria-hidden="true">` z gradientem do koloru tła, przypięty do dolnej krawędzi (`position: absolute; left: 0; right: 0; bottom: 0`).

**Wysokość gradientu zależy od tego, co jest pod nim:**

- **40 px** tam, gdzie treść urywa się w połowie elementu — gradient tłumaczy cięcie,
- **8–12 px** tam, gdzie stos wypełnia pole dokładnie — gradient mówi tylko „lista idzie dalej".

W E1.1 (tryb jasny) stos kafli wypełnia pole co do piksela, więc gradient ma **12 px**: plakietka „Zapytamy o jedno" na trzecim kaflu ma 13 px prześwitu do krawędzi i nie może być zasłonięta, bo jest jedynym nośnikiem tekstowym tego stanu. W trybie ciemnym pole ma 44 px zapasu i gradient ma 40 px.

Zasada: wysokość dobiera się do prześwitu między dolną krawędzią treści a krawędzią pola, nigdy odwrotnie. Szczegóły — wpis (s) w `ROZBIEZNOSCI_DESIGN.md`.

### E1.2 Karta, która pyta

Dwa stany tego samego ekranu.

**Przed odpowiedzią** widać wyłącznie tytuł, nagłówek stanu i pytanie. Kwoty, uzasadnienia, podstawy prawnej i trzech akcji **nie ma** — żeby nie sugerować odpowiedzi.

Nagłówek stanu nierozstrzygniętego ma **własną formę**, nie wariant werdyktu: tło karty drugiej, obrys mocny, ikona znaku zapytania, zdanie w trybie przyszłym („Nie wiemy jeszcze, czy Ci przysługuje. Wystarczy jedna odpowiedź."). Komponent `.werdykt--neutralny` z wydania 1.2 należy **usunąć** — nierozstrzygnięte nie może wyglądać jak rozstrzygnięte.

Pytanie stoi we **własnym pudełku** z obrysem, wyraźnie odgraniczonym od reszty treści. To odpowiedź na punkt 3.3 zlecenia: problemem nie był przycisk odpowiedzi, tylko brak ramy wokół pytania. Komponent `.odpowiedz` zostaje bez zmian, zmienia się to, na czym leży — jeden komponent mniej do utrzymania.

Trzy przyciski odpowiedzi: dwa główne (56 px) plus „Nie wiem — zapytam później" jako przycisk tekstowy 48 px z podkreśleniem.

**Po odpowiedzi** nagłówek stanu jest **zastąpiony** werdyktem, nie dołożony obok — karta nigdy nie ma dwóch nagłówków stanu. Dalej: blok „Ile to jest" (liczba 34 px / 700 w kolorze pewności głębokiej), ślad odpowiedzi, trzy stałe akcje.

**Blok „Twoja odpowiedź": 118 → 48 px.** Był kartą, jest jedną linią: zdanie plus odnośnik „Zmień". To nie treść, do której się wraca — to ślad, że coś się wybrało. Zaoszczędzone 70 px trafia do trzech akcji, dzięki czemu trzecia mieści się także przy powiększeniu 150% (wpis 18).

Trzy stałe akcje zawsze w tej kolejności: **Pobierz wniosek PDF · Jak o to poprosić · Przypomnij mi**. Kolejność jest regułą, nie układem.

Wysokości: karta z pytaniem 741 → 612 px, sam blok pytania 412 → 318 px, karta po odpowiedzi 1042 → 890 px.

### E7.1 Mój czas — dziś

Blok licznika: `border: 1px solid` w kolorze pewności, etykieta 13 px / 600 z odstępem liter, liczba **44 px / 700** cyframi tabelarycznymi w kolorze pewności głębokiej, pod nią zdanie o przerwach i planie. Plakietka „dzień otwarty" z kropką 8 px w prawym górnym rogu bloku.

Przycisk **„Kończę pracę" / „Zaczynam pracę" — 72 px**, 20 px / 600, z ikoną 26 px. Pod nim „Zaczynam przerwę" — 56 px. Poniżej lista dzisiejszych zdarzeń: wiersze po 11 px wyściółki, godziny cyframi tabelarycznymi do prawej.

**Licznik na żywo** to **odświeżenie treści, nie animacja.** Liczba podmienia się raz na minutę, bez przejścia, bez wygaszania, bez ruchu. Zakaz animacji z reguły 1 dotyczy przejść między stanami, nie zmiany wartości. W kodzie: podmiana węzła tekstowego, **nigdy** klasa z `transition`. `aria-live` do rozstrzygnięcia testem z NVDA i TalkBack — projekt zakłada `off` plus przycisk „Odczytaj czas pracy".

### E7.2 Wpis ręczny — pola i stan błędu

Pole: wysokość **48 px**, `border: 1.5px solid` w kolorze obrysu mocnego, promień 14 px, etykieta 15 px / 600 **nad** polem. Obrys skupienia 3 px w kolorze pewności.

**Stan błędu — bez terakoty.** Trzy nośniki, żaden nie jest kolorem rodziny:

1. obrys pola **2,5 px atramentowy** zamiast 1,5 px w kolorze obrysu mocnego,
2. ikona wykrzyknika w kole (20 px) w prawej części pola,
3. zdanie pod polem: 14 px / 500, z ikoną wykrzyknika 16 px.

Pas zbiorczy na górze formularza mówi **ile pól** wymaga poprawy, nie co w nich jest: `border: 2px solid` atramentowy, ikona, zdanie („Dwa pola wymagają poprawy" + „Godzina zakończenia i druga przerwa. Oba są oznaczone niżej.").

Odpowiedź na punkt 6 zlecenia: użytkownik widzi, które pole poprawić, bo błąd stoi **przy polu**. Atrament wystarcza — pogrubiony obrys jest widoczny w skali szarości i nie zużywa koloru rodziny na coś, co nie jest werdyktem. Klasa `.pas--powaga` przy formularzu do zamiany na `.pas--uwaga`.

### E7.3 Tydzień i miesiąc — lista dni, nie tabela

Przełącznik Tydzień / Miesiąc: tor `border-radius: 12px; padding: 4px; gap: 4px`, segmenty `border-radius: 8px`, wysokość segmentu 48 px. Promień segmentu = promień toru minus wyściółka.

Blok sumy: dwie liczby 28 px / 700 obok siebie, rozdzielone kreską pionową 1 px. „Nad planem" w kolorze pewności głębokiej.

**Wiersz dnia — 62 px, dwie linie:**

- pierwsza: data (16 px / 600) po lewej, fakt i różnica po prawej, cyframi tabelarycznymi; różnica dodatnia w kolorze pewności głębokiej, ponadwymiarowa w `#8A5A00`, zerowa w tekście trzecim,
- druga: plan i przerwy jako **zdanie** (14 px), nie kolumny.

Pięć kolumn schodzi do trzech widocznych. Plan i przerwy **nie znikają** — przestają być kolumnami. Wiersz jest celem dotykowym prowadzącym do szczegółu dnia.

Odnośnik „Zobacz tabelę" otwiera pełną siatkę na pełnym ekranie w orientacji poziomej. Strona **nigdy** nie przewija się w bok.

### E7.4 Sygnały — karta bez lewej listwy

Wzorzec `.karta--sygnal` z lewą krawędzią 4 px **wziął się z niczego** i nie miał odpowiednika w systemie. Zastąpiony rzeczą, którą system już zna: **obrys w kolorze rodziny plus nagłówek stanu ze znakiem i słowem** — tak samo jak na kartach werdyktu.

Karta sygnału: obrys w kolorze rodziny „zależy", nagłówek (znak 24 px + „Do sprawdzenia" wersalikami 13 px w kolorze rodziny), tytuł 19 px / 600, zdanie wyjaśniające, kreska pozioma, zakres czasu cyframi tabelarycznymi, przycisk „Co mogę z tym zrobić" 48 px.

**Sygnał to bursztyn, nie terakota.** Naruszenie przepisu to „sprawdź to", nie „grozi Ci niebezpieczeństwo".

### E7.5 Eksport ewidencji

Podgląd dokumentu A4 w proporcji `aspect-ratio: 210/297`, w karcie z obrysem. W podglądzie: nagłówek z kreską, pole imienia, siatka czterech kolumn (dzień, plan, fakt, różnica), wiersz sumy z kreską nad nim, pas oznaczeń funduszowych na dole. Pismo w podglądzie 4,5–8 px — to miniatura, nie dokument do czytania.

Pod podglądem dwa przyciski 56 px: „Pobierz PDF" i „Zmień miesiąc".

Pole imienia w dokumencie jest **puste** — aplikacja nie zna tych danych i nie pyta o nie tylko po to, żeby je wydrukować.

### E2.8 Porównanie form zatrudnienia — lista par

Na telefonie **tabeli nie ma**. Osiem par, cztery widoczne nad zgięciem.

**Karta pary — 93 px:**

- nazwa uprawnienia u góry (17 px / 600),
- pod nią dwie wartości obok siebie, rozdzielone kreską pionową 1 px, każda z **własną etykietą** („na zleceniu" / „na etacie", 13 px w tekście trzecim),
- wartość: znak 18 px plus słowo 15 px / 600.

Nagłówek jest **przy danej**, nie 300 px wyżej w wierszu tabeli. Kolumna użytkownika oznaczona plakietką „na etacie — Ty" na górze ekranu (obrys w kolorze pewności) — to jedyne miejsce w aplikacji, gdzie dwie wartości stoją obok siebie, więc trzeba powiedzieć, która jest jego.

Wartości niosą **te same trzy znaki** co kafle. „Nie" bez znaku byłoby jedynym miejscem w aplikacji, gdzie odmowa nie ma kształtu. Bursztynowe „Z umowy" mówi to samo co kaflowe „to zależy": prawo nie rozstrzyga, rozstrzyga treść umowy — bez trzeciego stanu użytkownik przeczytałby nieprawdę w którąkolwiek stronę.

Wyjście z ekranu („Co zrobić, jeśli to moja sytuacja") w **stałym pasie akcji**, jak dokument w E1.1, z tego samego powodu: to jedyne wyjście z ekranu, który sam niczego nie rozstrzyga.

### E2.3 Ostrzeżenie o ryzyku — terakota poza Pomocą

Blok ostrzeżenia stoi **nad akcjami**, nie pod nimi (wymóg dokumentu zmiany).

Forma: tło `#FBEDE9`, obrys **2 px** `#9A3B28`, ikona trójkąta 24 px w `#7E2E1E`, plakietka **wersalikami** 13 px / 700 („ZANIM ZROBISZ KROK"), zdanie 16 px z pogrubieniem na zdaniu o ryzyku, **jeden** odnośnik wyjścia („Z kim mogę porozmawiać") o wysokości 48 px.

**Czym różni się od Pomocy.** Pomoc **daje wyjście** — numer, ścieżkę, człowieka. Ostrzeżenie **wstrzymuje krok** i odsyła do Pomocy. Stąd jedno wyjście, nie trzy, i brak przycisku 72 px.

Treść ostrzeżenia jest ustalona dokumentem zmiany i **nie wolno jej skracać**: „Zanim porozmawiasz z pracodawcą, porozmawiaj z kimś, kto zna Twoją sytuację. **Ryzyko, że pracodawca zareaguje źle, jest realne.**"

## Tabela jako komponent

Tabela zostaje w systemie, ale **na telefonie nie występuje**. Wchodzi od **600 px** szerokości i do dokumentów A4, gdzie siatka jest naturalna.

- nagłówek: 13 px / 600, **bez wersalików**, na tle karty drugiej, kreska pod nim,
- wiersze: 15 px, wyściółka 10 px / 14 px, kreska 1 px między wierszami,
- liczby: cyfry tabelaryczne, wyrównanie do prawej,
- różnica: kolor **i** znak (`+` / `0:00`) — nigdy sam kolor,
- wiersz sumy: 700, tło karty drugiej, kreska w kolorze obrysu mocnego nad nim.

`.tabela-przewijana` z przewijaniem poziomym w pudełku zostaje — ale za `@media (min-width: 600px)`. Pudełko zachowuje osiągalność z klawiatury i obrys skupienia (to była realna wada dostępności znaleziona testem axe).

Powód decyzji: pięć kolumn na 393 px daje 60 px na kolumnę — mniej niż cel dotykowy i mniej, niż potrzebuje liczba z cyframi tabelarycznymi. Tabela jest wierna dokumentowi zmiany, lista jest wierna urządzeniu i człowiekowi, który patrzy na telefon po nocnej zmianie.

## Ikony

Pięć nowych ikon w konwencji zestawu: siatka 24, **kontur**, grubość 2,2 px, `stroke-linecap: round`, `aria-hidden="true"`.

| nazwa | rysunek | gdzie |
|---|---|---|
| `strzalka_w_kolo` | strzałka w otwartym okręgu | pasek „Coś się zmieniło", znacznik „Do odświeżenia" |
| `start` | trójkąt **konturowy** | „Zaczynam" |
| `stop` | kwadrat **konturowy**, promień 1,5 | „Kończę" |
| `pauza` | dwie kreski pionowe | „Przerwa" |
| `tabela` | prostokąt z podziałem poziomym i pionowym | „Ten tydzień", „Porównaj" |

**Wyjątek wypełnionych ikon odtwarzania zniesiony.** `start` i `stop` są konturowe, jak cały zestaw. Przy 26 px i grubości 2,2 px czytają się jednoznacznie, a konwencja odtwarzania nie jest tu potrzebna, bo te przyciski mają podpisy słowne („Zaczynam pracę", „Kończę pracę"), nie same ikony.

## Zachowanie i stany

- **Przejścia między ekranami:** brak animacji. Zmiana ekranu jest natychmiastowa.
- **Rozstrzyganie warunku:** odpowiedź na karcie przelicza uprawnienie **bez zmiany ekranu**. Nagłówek stanu zostaje zastąpiony werdyktem, pojawiają się bloki „ile", podstawa prawna i trzy akcje.
- **Przerwanie kreatora:** wyjście widoczne od pierwszego pytania, nigdy w menu ani za gestem.
- **„Nie wiem — pomiń":** widoczne od pierwszego pytania; skutkuje znacznikiem „Do odświeżenia" na kaflach, które z tego pytania wynikają.
- **Dzień otwarty:** plakietka „dzień otwarty" na kaflu „Mój czas pracy" w E1.1 i w bloku licznika w E7.1.
- **Walidacja wpisu czasu:** sprawdzana przy zapisie, nie przy każdym znaku. Pas zbiorczy plus oznaczenie pól.
- **Powiększenie 150%:** trzy akcje na karcie muszą się zmieścić — to warunek konstrukcyjny, nie życzenie.
- **Powiększenie 200%:** kafel rośnie do 148 px, co zwiększa listę o 132 px i wypycha dokument pod zgięcie. **Do rozstrzygnięcia przez zespół** — czy przy 200% dokument zostaje nad zgięciem, czy ustępuje kaflom.

## Stan aplikacji

- **profil** — odpowiedzi z kreatora (20 pytań), każda z datą i znacznikiem „pominięte",
- **rozstrzygnięcia warunków** — słownik `uprawnienie → odpowiedź + data`, źródło stanu `zapytamy o jedno` kontra pozostałe trzy,
- **świeżość** — wyliczana z daty odpowiedzi i daty ważności parametru; wejście dla znacznika „Do odświeżenia",
- **ewidencja czasu** — zdarzenia dnia (początek, przerwy, koniec), dzień otwarty jako brak zdarzenia końca,
- **sezon** — miesiąc bieżący; panel sezonowy istnieje tylko od maja do września,
- **sygnały** — wyliczane z ewidencji, nie przechowywane.

Wszystko lokalnie na urządzeniu. Brak kont, brak logowania, brak powiadomień z serwera — wszystkie przypomnienia liczy urządzenie.

## Co zamykamy w `ROZBIEZNOSCI.md`

| wpis | rzecz | czym zamknięty |
|---|---|---|
| 16 | przepełnienie E1.1 | kafel 104 px + cztery warstwy układu; 1036 → 718 px |
| 18 | trzecia akcja przy 150% | ślad odpowiedzi 118 → 48 px |
| 19 | plakietka „SPRAWDŹ JEDEN WARUNEK" | forma bez wersalików, brzmienie „Zapytamy o jedno" |
| 25 | nowe komponenty bez projektu | §8 kanwy w całości |

## Do rozstrzygnięcia przez zespół

Pełna lista w `ROZBIEZNOSCI_DESIGN.md`. Trzy nowe z tego wydania:

1. **Kafel przy 200% powiększenia** — dokument nad zgięciem czy kafle.
2. **`aria-live` licznika na żywo** — `off` z przyciskiem odczytu czy `polite`; wymaga testu z NVDA i TalkBack.
3. **Ewidencja jako dowód** — czy wydruk z E7.5 może być używany w sporze z pracodawcą i czy dokument potrzebuje adnotacji, że jest zapisem własnym pracownika, a nie ewidencją pracodawcy. Pytanie do prawników.

Osobno, z wcześniejszych wydań: brzmienie plakietki (test z użytkownikami), grupowanie listy sytuacji, pliki wektorowe znaków Funduszy Europejskich i godła RP, numery infolinii użyte w makietach jako przykład, dni poprzedniego miesiąca w kalendarzu (kontrast 3,3:1 — elementy nieaktywne, formalnie zwolnione).

## Zasoby

- `fzz-logo.png` — znak Forum Związków Zawodowych, źródło dla wariantu „Zawias".
- Znaki Funduszy Europejskich i godło RP w kanwie są **rysowane wektorowo do specyfikacji** i nie są plikami źródłowymi. Przed publikacją zespół musi wstawić pliki z obowiązującej księgi wizualizacji.
- Ikony: wszystkie rysowane inline jako SVG, siatka 24. Nie ma zewnętrznego zestawu ikon.
- Pismo: IBM Plex Sans z plików lokalnych. Kanwa ładuje je z sieci — **w aplikacji tego nie wolno robić.**

## Pliki w pakiecie

| plik | co zawiera |
|---|---|
| `System BHPewnie v2.dc.html` | kanwa: §1 logotyp, §2 tokeny, §3 biblioteka 15 komponentów, §4 ekrany 1.1, §5 dokument A4, §6 wireframe'y, §7 przekazanie 1.1, **§8 wydanie 1.2** |
| `support.js` | środowisko uruchomieniowe kanwy — nie jest częścią aplikacji |
| `ROZBIEZNOSCI_DESIGN.md` | 19 rozstrzygnięć projektowych w układzie brief / kolizja / decyzja / dlaczego / żeby zdecydować inaczej, plus lista dla zespołu |
| `ZLECENIE_DESIGN_1_2.md` | zlecenie, na które ten pakiet odpowiada |
| `fzz-logo.png` | znak nadawcy |

Kanwę otwiera się w przeglądarce bezpośrednio. §8 jest na końcu dokumentu.
