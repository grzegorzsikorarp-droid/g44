# Identyfikacja wizualna OIPiP w Słupsku

System opisuje identyfikację Okręgowej Izby Pielęgniarek i Położnych w Słupsku w postaci, z której można budować aplikacje, strony i grafiki. Kolory motywu jasnego, krój, kształty i komponenty pochodzą ze strony oipip.slupsk.pl i z materiałów Izby przyjętych w 2026 r. (strony kursów, „Twój zastrzyk!”, raport „TAK lub NIE”, porozumienie z Okręgową Izbą Pielęgniarek i Położnych w Gdańsku, grafiki na Facebooka). Motyw jasny to identyfikacja Izby. Motyw ciemny i tokeny ról (np. `akcent-tekst`, `obrys-pola`) to rozszerzenia do aplikacji, których nie ma w materiałach Izby.

## Zasady w skrócie

- Krój jeden, Titillium Web (jedyny wyjątek opisuje „Typografia”). Nagłówki cienkie (300) i pochylone, fraza kluczowa pogrubiona (700). Etykiety wersalikami z rozstrzeleniem.
- Kolor marki to `czerwien` (#e30513) na tle bieli i szarości. Grafit (`grafit-900`, `klin`) daje kontrast w panelach i grafikach.
- Kształt marki to skos 13° (`kat-skosu`). Pochylone są etykiety, znaczniki, przyciski `oi-btn`, znaczki i panele. Tekst w środku stoi prosto (`kat-odwrotny`).
- Wszystko jest kanciaste (`zaokraglenie` = 0). Cień tylko na karcie po najechaniu (`cien-karty`).
- Akcent to czerwony pasek 6 px z lewej strony (`pasek-akcentu`) albo 5 px na karcie po najechaniu (`pasek-karty`).
- Znak Izby stoi zawsze na białym tle, w oryginalnych kolorach.
- Bez strzałek, kółek, odznak, emoji i gradientów. Bez motywów w tle pod tekstem.
- Teksty są po polsku, z pełnymi nazwami instytucji. Pielęgniarki, pielęgniarze, położne i położni są wymieniani na równi.

## Język

Izba mówi o sobie w pierwszej osobie liczby mnogiej („Przyjęliśmy”, „Zapraszamy”), a do czytelnika zwraca się na „Ty” w przewodnikach i formularzach albo na „Wy” w zaproszeniach („Wyślijcie wiadomość”). Pisze rzeczowo, bez ocennych formułek i bez publicystyki. Szczegóły są w pliku JEZYK.md.

- Przy pierwszym użyciu pełna nazwa „Okręgowa Izba Pielęgniarek i Położnych w Słupsku”, dalej „Izba” wielką literą albo „nasz samorząd zawodowy”. Organ to zawsze „Okręgowa Rada Pielęgniarek i Położnych w Słupsku”, nigdy samo „Rada”.
- Zawody wyliczaj w mianowniku („pielęgniarki, pielęgniarze, położne i położni”). Unikaj dopełniacza, w którym powstaje „położnych i położnych”.
- Cudzysłów „…”, zagnieżdżony »…«. Daty „17 listopada 2026 r.”, godziny „11:00”, przedziały z półpauzą bez spacji („11:00–14:00”, „26–27.02.2027”). Kwoty „2 403,96 zł” z twardymi spacjami.
- Etykieta stoi w osobnym wierszu nad wartością, wersalikami i bez dwukropka („MIEJSCE”, a pod nią „Uniwersytet Pomorski w Słupsku”).
- Napis w przycisku mówi, co się stanie, np. „Zapisz się w SMK”, „Pobierz regulamin”, „Dodaj do kalendarza”. Bez „Kliknij tutaj” i bez strzałek.
- Nagłówek, który jest pytaniem, kończy się pytajnikiem („Co daje porozumienie?”).
- Na stronach twarda spacja po jednoliterowych spójnikach i przyimkach (w kodzie „`w&nbsp;Słupsku`”, „`i&nbsp;położnych`”).
- Bez emoji w interfejsie. Emoji należą tylko do postów na Facebooku.

## Kolory

Każdy kolor ustawiaj przez token, nigdy wartością wpisaną na sztywno.

- Tło strony `tlo`, karty i białe sekcje `powierzchnia`, wypełnienia w białych sekcjach `powierzchnia-miekka`.
- Tekst `tekst`, nagłówki `tekst-mocny`, opisy i źródła `tekst-drugorzedny`, elementy wyłączone `tekst-wylaczony`.
- Czerwone tło to `czerwien`, po najechaniu `czerwien-ciemna`, a tekst na nim `na-akcencie`.
- Drobny czerwony tekst (etykiety, linki, błędy) składaj w `akcent-tekst`, a duży od 24 px (tytuł strony, duże liczby) w `akcent-duzy`. Drobny tekst w `czerwien` stawiaj tylko na białym, bo na `tlo` ma 3,95:1.
- Obrys kart to `linia`, podziały wewnątrz `linia-jasna`, stan po najechaniu `linia-aktywna`. Granica pola formularza to `obrys-pola` (2 px), nie `linia`.
- Ciemne panele i klin w grafikach `klin` albo `grafit-900`, zawsze z tekstem `bialy`. Drugi kolor w schemacie dwóch stron `grafit-700`.
- Skala ocen z raportu „TAK lub NIE” (`stan-tak`, `stan-czesciowo`, `stan-nie`, `stan-brak`) służy do danych i stanów. Tekst na trzech pierwszych `na-stanie`, na `stan-brak` `bialy`. Kolor zawsze idzie w parze ze słowem („TAK na cztery pytania”), nigdy sam.
- Znak ma własne kolory (czerwień krzyża #ec1c24, szarości #6c6e70 i #57585a). Nie używaj czerwieni znaku w interfejsie.
- Kolorów konferencji o pielęgniarskiej opiece długoterminowej (zieleń, żółć, krój Poppins) używaj tylko w materiałach tej konferencji.

## Typografia

Jedna rodzina `sans` (Titillium Web) w grubościach 300, 400, 600 i 700, każda także w kursywie. Pliki są w `fonts/`.

- Tytuł strony (`tytul-strony`) to cienka kursywa w `akcent-duzy` z frazą kluczową w `<b>`, np. „Oferta **specjalizacji** i kursów kwalifikacyjnych”.
- Nagłówek sekcji (`naglowek-sekcji`) to cienka kursywa w `tekst-mocny`, przed nim skośny znaczek, pod nim linia `kreska-mocna`.
- Tytuł karty `naglowek-karty`, tekst ciągły `tekst` (najwyżej `wiersz-tekstu`), wprowadzenie `lead`, drobne opisy `tekst-maly`, źródła `zrodlo`.
- Etykiety `etykieta` i napisy na paskach `etykieta-paska` piszesz w kodzie zwykłą pisownią, a wersaliki daje `text-transform: uppercase`.
- Liczby w kafelkach `liczba` (pochylone, w `akcent-duzy`), daty `data`. Cyfry Titillium Web mają równą szerokość, więc kolumny liczb wystarczy wyrównać do prawej.
- Hasło na grafikach (`naglowek-grafiki`) składaj cienką odmianą prostą, ze słowem kluczowym w grubości 700 i kolorze `czerwien`.
- Jedyny wyjątek od jednego kroju to grafiki wspomnieniowe (np. na 1 listopada), w których hasło jest pisane krojem odręcznym Parisienne. W interfejsie go nie używaj. Parisienne nie ma w tym systemie, jest dostępna w Google Fonts na licencji SIL Open Font License.

## Kształty i układ

- Skos daje `transform: skewX(var(--kat-skosu))` na elemencie i `skewX(var(--kat-odwrotny))` na tekście w środku. Pochylone są etykiety (`oi-tag`), znaczniki stanu, przyciski `oi-btn`, znaczki (`oi-mark`), pola wyboru, numery kroków i panele. Przyciski wyboru (`oi-opt`) i oceny stoją prosto.
- Bloki są kanciaste. Obrys karty `kreska` w `linia`, nagłówek sekcji podkreślony `kreska-mocna` w `tekst-mocny`.
- Pasek `pasek-akcentu` z lewej strony mają przycisk wyboru, otwarte pytanie i uwaga. Karta dostaje `pasek-karty` dopiero po najechaniu.
- Treść mieści się w `kolumna` (75rem), z marginesem bocznym `odstep-5` (20 px). Sekcje mają pionowo `odstep-14` na komputerze, karty w siatce odstęp `odstep-6`.
- Nagłówek strony (`oi-hero`) jest biały, z dwoma bladymi skośnymi pasami czerwieni po prawej stronie. Tytuł ma najwyżej 20 znaków szerokości (`20ch`), a tytuł i wprowadzenie zajmują najwyżej 54% szerokości nagłówka, więc nie wchodzą na pasy. Do 760 px pasów nie ma.
- Szare sekcje (`tlo`) przeplatają się z białymi (`powierzchnia`). W białej sekcji karty, kroki, pytania i kafelki z liczbami dostają `powierzchnia-miekka`.

## Stany i ruch

- Przycisk główny po najechaniu i przy wciśnięciu zmienia tło na `czerwien-ciemna`, przycisk z obrysem wypełnia się `czerwien`.
- Karta aktywna po najechaniu dostaje `pasek-karty`, `cien-karty`, obrys `linia-aktywna`, a tytuł zmienia kolor na `akcent-tekst`.
- Fokus klawiatury to obrys `pierscien-fokusu` w kolorze `fokus` z odstępem 3 px, także w polach formularza.
- Element wyłączony ma tło `powierzchnia-miekka`, obrys `linia` i tekst `tekst-wylaczony`.
- Przejścia trwają 0,2 s (pasek karty 0,25 s). Przy `prefers-reduced-motion: reduce` wyłącz je.

## Ikony i obrazy

- Izba nie ma własnego zestawu ikon. Ikony stosuj tylko funkcyjnie (kalendarz, kopiowanie, udostępnianie, pobieranie, telefon, poczta), jako proste liniowe SVG w `currentColor`, w rozmiarze 1,15 em obok napisu. Ikona nigdy nie zastępuje napisu.
- Bez strzałek w przyciskach i schematach. Relację pokazuje układ paneli (`oi-kv`), nie strzałka.
- Bez kółek, odznak i ikon-ptaszków jako ozdoby. Ptaszek występuje tylko w zaznaczonym polu wyboru.
- Zdjęcia tylko prawdziwe. Twarzy osób z Izby nie generuj ani nie przerabiaj za pomocą AI. Dozwolone są kadrowanie, korekta barw i delikatny retusz. Nie ucinaj postaci w stawach.
- Żaden motyw ani zdjęcie nie leży pod tekstem.

## Znak

- Znak (`logo/znak-oipip-slupsk.svg`) stawiaj zawsze na białym tle (`bialy`), także w ciemnym motywie, na białej karcie albo w komponencie `Wizytowka` (klasa `oi-nameplate`).
- Nie zmieniaj kolorów znaku, nie odwracaj go, nie obrysowuj, nie rozciągaj i nie obracaj. Nie wycinaj z niego samego krzyża, bo czerwony krzyż na białym tle przypomina chroniony znak Czerwonego Krzyża.
- Zostaw wokół znaku wolne pole co najmniej ¼ jego wysokości. Na ekranie znak ma najmniej 32 px wysokości (wyjątek to ikona strony 16 px).
- Obok znaku nazwę Izby składaj w Titillium Web jak w komponencie `Wizytowka` (klasa `oi-nameplate`), czyli „Okręgowa Izba Pielęgniarek i Położnych” cienką kursywą, a „w Słupsku” pogrubioną odmianą prostą. W systemie nie ma poziomego logo z nagłówka strony.
- W grafikach znak leży na białej karcie w lewym dolnym rogu, której prawa krawędź ma skos 13°.

## Grafiki do mediów społecznościowych

- Format 4:5, 1080 × 1350 px, eksport w skali 2× (2160 × 2700). Grafika podcastu 1080 × 1080.
- Układ przyjęty w 2026 r. tworzą jasnoszare tło, po prawej grafitowy klin (`klin`) z czerwonym paskiem 14 px wzdłuż skośnej krawędzi, w lewym dolnym rogu biała karta ze znakiem i nazwą Izby, etykieta wersalikami na czerwonym pasku i hasło `naglowek-grafiki` ze słowem kluczowym na czerwono.
- Grafiki wspomnieniowe mają czerwony albo czarny panel ze skośną krawędzią i cienką białą linią, z drugiej strony zdjęcie, cienką białą ramkę wewnętrzną, znak na białej karcie przy lewej krawędzi i hasło krojem Parisienne.
- Bez wspólnej stopki z paskiem, logo i adresem strony. Każdy wiersz łam ręcznie i sprawdź, czy tekst nie dotyka klina, paska ani karty.
- Wydarzenie podpisuj pełnym, oficjalnym tytułem. Współorganizatorów pokazuj na białej karcie w osobnym rzędzie „Współorganizatorzy”, logotypy w oryginalnych kolorach. Godła państwowego nie używaj.
- Przykłady są w `przyklady/`.

## Dostępność

- Tekst ma co najmniej 4,5:1 na swoim tle w obu motywach, duży tekst (od 24 px albo od 19 px pogrubiony), granice pól i zaznaczeń oraz pierścień fokusu co najmniej 3:1. Pary są w opisach tokenów.
- Stan nigdy nie wynika z samego koloru. Znacznik stanu ma słowo, ocena ma etykietę.
- Każda kontrolka ma widoczny fokus (`fokus`) i działa z klawiatury. Pola mają etykiety, błąd opisuje, co poprawić („Wpisz numer prawa wykonywania zawodu”).
- Najmniejsze są pogrubione etykiety wersalikami, od 10,5 px (0,66 rem). Zwykły drobny tekst, np. źródło, ma co najmniej 13 px, a tekst ciągły 17 px.

## Czego nie robić

- Nie zaokrąglaj rogów, nie dodawaj gradientów ani cieni poza `cien-karty`.
- Nie pisz wersalikami całych nazw w panelach („OKRĘGOWA IZBA…”). Nazwa idzie cienką kursywą z pogrubionym miastem.
- Nie wstawiaj strzałek, kółek, odznak, emoji ani ikon-ptaszków.
- Nie stawiaj znaku na kolorze, zdjęciu ani w ciemnym motywie bez białej karty.
- Nie używaj czerwieni znaku (#ec1c24) ani kolorów konferencji poza ich miejscem.
- Nie pisz samego „Rada”, skrótów nazw szpitali ani dwukropków w etykietach.
