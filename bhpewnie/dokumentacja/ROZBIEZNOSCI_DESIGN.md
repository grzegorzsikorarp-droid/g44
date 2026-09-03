# ROZBIEŻNOŚCI_DESIGN.md

Rejestr miejsc, w których brief nie dawał się zrealizować dosłownie, oraz decyzji, które w tych miejscach podjąłem. Każdy wpis ma to samo pięć części: co mówi brief, na czym polega kolizja, co zrobiłem, dlaczego tak, i co trzeba zrobić, żeby zdecydować inaczej.

Stan na 3 września 2026. Dotyczy pliku `System BHPewnie v2.dc.html`. Wpisy (a)–(h) pochodzą z wydania 1.1, (i)–(k) z profesjonalizacji oprawy, (l)–(r) z wydania 1.2 — odpowiedzi na `ZLECENIE_DESIGN_1_2.md`. Plik `System BHPewnie.dc.html` to wydanie pierwsze, zachowane bez zmian.

---

## (a) Trzy stany werdyktu a zakaz czerwieni

**Brief.** Karta wyniku ma trzy stany: „przysługuje", „to zależy", „nie przysługuje". Osobno: w interfejsie nie występuje czerwień sygnałowa.

**Kolizja.** Konwencja, do której użytkownicy są przyzwyczajeni, to zielony–żółty–czerwony. Bez czerwieni trzeci stan traci swoje umowne miejsce w tej trójce i przy samym kolorze staje się nieczytelny — a przy wyłączonych kolorach systemowych albo w skali szarości nieczytelne stają się wszystkie trzy.

**Decyzja.** Werdykt niesie równolegle trzy nośniki: **kształt ikony** (✓ / ~ / —), **słowo** („Przysługuje Ci", „To zależy", „Nie przysługuje") i dopiero na końcu kolor (zieleń / bursztyn / szarość). Stan trzeci jest neutralny szary, nie czerwony. Karta „nie przysługuje" obowiązkowo zawiera blok „co Ci przysługuje zamiast tego".

**Dlaczego.** Odmowa nie jest awarią ani zagrożeniem — jest informacją. Czerwień w tym miejscu sugeruje, że użytkownik zrobił coś źle, podczas gdy on tylko sprawdził swoją sytuację. Zakaz czerwieni z briefu okazał się przy tym wygodny: wymusił rozwiązanie, które i tak było potrzebne ze względu na daltonizm i skalę szarości.

**Żeby zdecydować inaczej.** Trzeba by dopuścić czerwień w jednym stanie jednego komponentu — i wtedy przemyśleć, co robi ona w module Pomoc, gdzie terakota oznacza powagę sytuacji, a nie odmowę.

---

## (b) Trzynaście sytuacji na jednym ekranie

**Brief.** Ekran E2.1 („Sprawdź") pokazuje trzynaście sytuacji. Osobno: pismo bazowe 16 px, cele dotykowe minimum 48 px.

**Kolizja.** Przy 390 × 844 px, kaflu 56 px, odstępie 8 px, nagłówku ekranu i belce dolnej na ekran wchodzi **osiem** pozycji. Trzynaście zmieściłoby się dopiero przy kaflu 34 px albo piśmie 13 px — obie liczby są poniżej progów z briefu.

**Decyzja.** Lista przewija się. Kolejność jest **stała**, nie sortowana według użycia, a pozycja sezonowa (upał, mróz) stoi zawsze na górze i jest jedyną wyróżnioną kolorem.

**Dlaczego.** Przewijanie jest zrozumiałe dla każdego, kto używa telefonu. Skacząca kolejność nie jest: użytkownik, który raz nauczył się, że „Pracuję w nocy" jest trzecie od góry, sięga tam palcem bez patrzenia — i to jest realna wartość na hali produkcyjnej o czwartej rano. Sezonowość na górze to jedyne odstępstwo, bo dotyczy dnia, a nie stanowiska.

**Żeby zdecydować inaczej.** Trzeba by pogrupować trzynaście sytuacji w cztery–pięć rozwijanych kategorii. Kosztem jest jedno dodatkowe dotknięcie przed każdą sytuacją; zyskiem — całość widoczna bez przewijania. Warte przetestowania na użytkownikach, nie warte przesądzania przy biurku.

---

## (c) Ile kafli na ekranie głównym

**Brief.** Ekran główny pokazuje kafle uprawnień oraz dwie akcje: „Sprawdź, co Ci przysługuje" i „Pobierz kartę moich uprawnień".

**Kolizja.** Cztery kafle z liczbami plus panel sezonowy plus dwa przyciski nie mieszczą się nad belką dolną. Pierwsza wersja miała ucięty drugi przycisk.

**Decyzja.** Trzy kafle, potem oba przyciski. Pozostałe uprawnienia są dostępne przez „Pokaż wszystkie".

**Dlaczego.** Wzrok i tak nie odczytuje czterech dużych liczb naraz — konkurują ze sobą. Trzy kafle mają hierarchię, cztery mają szum. Przycisk „Pobierz kartę" musi być widoczny bez przewijania, bo to jedyna droga do dokumentu, który użytkownik zaniesie pracodawcy.

**Żeby zdecydować inaczej.** Można pokazywać cztery kafle i przenieść „Pobierz kartę" do ekranu wszystkich uprawnień. Kosztem jest schowanie kluczowej akcji o jeden poziom głębiej.

---

## (d) Plakietka „AUTO" przy budziku

**Brief.** Budzik „Cisza po nocce" ma wariant automatyczny — wyliczany z grafiku, nie ustawiany ręcznie. W briefie oznaczony plakietką „AUTO".

**Kolizja.** „AUTO" to skrót z języka techniki, obcy części odbiorców aplikacji (pracownicy fizyczni, osoby 50+, osoby o niższych kompetencjach cyfrowych). Nie mówi też, czy coś jest włączone, czy tylko może się włączyć.

**Decyzja.** Plakietka brzmi **„SAMO SIĘ USTAWIA"**, wersalikami, w kolorze głównym, z obrysem. Zastępuje suwak — bo tego wariantu nie da się przełączyć, można tylko uzupełnić grafik.

**Dlaczego.** Cztery polskie słowa mówią dokładnie to, co skrót miał znaczyć, i mieszczą się w tym samym miejscu. Zasada z briefu — język bez żargonu — obowiązuje także etykiety w interfejsie, nie tylko treść merytoryczną.

**Żeby zdecydować inaczej.** Nie widzę powodu. Jeśli plakietka okaże się za długa w innym języku, skracamy do „SAMOCZYNNIE".

---

## (e) Pasek numerów a belka dolna

**Brief.** W module Pomoc na dole ekranu jest pasek z numerami alarmowymi. Osobno: aplikacja ma belkę dolną z czterema zakładkami.

**Kolizja.** Dwa paski jeden nad drugim zjadają 128 px wysokości ekranu i tworzą dwa rzędy celów dotykowych bezpośrednio nad sobą — w sytuacji, w której ręka drży, a palec może być w rękawicy, ryzyko trafienia w niewłaściwy jest realne.

**Decyzja.** W ścieżce Pomocy pasek numerów **zastępuje** belkę dolną, a nie stoi nad nią. Wyjście ze ścieżki odbywa się krzyżykiem w nagłówku. Na ekranie wejściowym Pomocy (E4.1) obecne są oba, bo to jeszcze nie jest ścieżka — użytkownik może chcieć wrócić do przeglądania.

**Dlaczego.** Kto jest w ścieżce po wypadku, ma jedno zadanie. Nawigacja między zakładkami w tym momencie nie jest mu potrzebna, a numer alarmowy owszem. Ekran kryzysowy idzie o krok dalej i nie ma żadnego z pasków.

**Żeby zdecydować inaczej.** Można zostawić belkę i zredukować pasek numerów do jednego przycisku 112. Kosztem jest utrata numeru bezpłatnej infolinii, który dla większości sytuacji z modułu Pomoc jest właściwszy niż 112.

---

## Rozstrzygnięcia poza pięcioma pytaniami

Trzy rzeczy, których brief nie przewidział, a które trzeba było przesądzić.

**Fiolet w kalendarzu grafiku.** Zmiana nocna dostała kolor spoza palety semantycznej. Nie mogła być zielona — zieleń w tym systemie znaczy „przysługuje" i pomylenie tych dwóch znaczeń w kalendarzu byłoby kosztowne. Fiolet nie występuje nigdzie indziej i nic nie znaczy poza „nocka". Litera w kratce (D/N/W) pozostaje nośnikiem pierwszym.

**Czerwień FZZ.** Znak nadawcy zawiera czerwień, której brief zakazuje w interfejsie. Rozstrzygnięcie: znak FZZ występuje wyłącznie w oryginalnych barwach i wyłącznie w blokach nadawcy — stopka „O aplikacji", pas oznaczeń w dokumentach A4. Nie jest zlewany z logotypem BHPewnie w jeden znak i nie oddaje swojej czerwieni żadnemu elementowi interfejsu. Żółć FZZ ma za to bezpośredniego potomka: bursztyn stanu „to zależy".

**Pole imienia w dokumencie A4.** Karta uprawnień ma puste pole „Imię i nazwisko" z adnotacją, że aplikacja nie zna tych danych. Alternatywą byłoby pytanie użytkownika o imię przy pierwszym eksporcie — odrzucone, bo zebranie danych osobowych tylko po to, żeby je wydrukować, przeczy obietnicy, którą aplikacja składa na ekranie powitalnym.

---

## (i) Kolor akcentu w oprawie dokumentu a kolor akcentu w interfejsie

**Brief.** Interfejs korzysta z morskiej zieleni jako koloru akcji. Osobno: dokumentacja projektu ma nosić znaki nadawcy, w tym czerwień FZZ.

**Kolizja.** W wydaniu pierwszym oba porządki dzieliły jedną paletę: oprawa katalogu, nagłówki paragrafów i numeratory kroków były morskie, tak samo jak przyciski w makietach. Czytający nie miał z czego rozpoznać, czy morski element należy do aplikacji, czy do dokumentu, który ją opisuje.

**Decyzja.** Rozdzielenie palet. Oprawa dokumentu: papier (#F2EFE8), atrament (#14161A), czerwień FZZ (#C9302B) punktowo w numerach paragrafów, etykietach i podkreśleniach odnośników. Interfejs: morska zieleń bez zmian, wyłącznie wewnątrz makiet. Morski w oprawie dokumentu został tylko w legendzie schematów blokowych w §6, gdzie oznacza „akcja główna" i jest częścią klucza, a nie ozdobą.

**Dlaczego.** Dokument o systemie nie powinien mówić tym samym głosem, co system. Rozdział palet daje też odpowiedź na pytanie, którego wydanie pierwsze nie rozstrzygało: czerwień FZZ ma gdzie żyć, nie wchodząc do interfejsu, gdzie brief jej zakazuje.

**Żeby zdecydować inaczej.** Podnieść czerwień do roli akcentu współrzędnego z morskim w samym interfejsie. Wymaga to zniesienia zakazu czerwieni sygnałowej z briefu i przeprojektowania trzech stanów werdyktu — patrz (a).

---

## (j) Listwy akcentu na kartach uprawnień

**Brief.** Karta uprawnienia pokazuje nazwę, kwotę lub termin i podstawę prawną.

**Kolizja.** W wydaniu pierwszym każda karta na liście miała czteropikselową listwę morską na lewej krawędzi. Listwa miała ten sam kolor na wszystkich kartach, więc nie odróżniała niczego od niczego — a jednocześnie zabierała uwagę tam, gdzie miała ją przyciągać kwota.

**Decyzja.** Listwy usunięte z kart uprawnień w całym dokumencie: dwanaście sztuk na kartach (cztery we wzorcach komponentu w §3, osiem na ekranach w §4), trzy na blokach opisowych w §1 — te ostatnie zastąpione włosową kreską atramentową, zgodnie z paletą oprawy z wpisu (i) — oraz sześć na schematach blokowych w §6, żeby schemat nie pokazywał wykończenia, którego karty już nie mają. Karty uprawnień mają teraz obrys i milimetrowy cień.

Listwa została w dwóch miejscach, w obu niesie informację: na kartach werdyktu, gdzie kolor idzie w parze z kształtem ikony i słowem, oraz na trzech cytatach podstawy prawnej, gdzie jest znakiem cytatu, a nie oznaczeniem statusu.

**Dlaczego.** Element, który wygląda na nośnik informacji, ale jej nie niesie, uczy użytkownika ignorować ten nośnik również tam, gdzie coś znaczy.

**Żeby zdecydować inaczej.** Nadać listwom znaczenie: kolor po kategorii uprawnienia (pieniądze, czas, badania, sprzęt). Wymaga rozstrzygnięcia grupowania listy — patrz (b) — i sprawdzenia, czy cztery kolory kategorii nie zderzą się z trzema kolorami werdyktu.

---

## (k) Ekran główny nie mieści swojej listy

**Brief.** Ekran główny pokazuje listę uprawnień oraz dwa przyciski akcji: „Sprawdź, co Ci przysługuje" i „Pobierz kartę moich uprawnień".

**Kolizja.** Przy realistycznym profilu — zmiany nocne, umowa o pracę, 50+ — lista ma tyle pozycji, że razem z przyciskami nie mieści się w 844 px. W wydaniu pierwszym przyciski siedziały wewnątrz przewijanego pola, więc nadmiar treści wypychał je pod pas nawigacji: najważniejsza akcja ekranu chowała się przed użytkownikiem.

**Decyzja.** Przyciski wyszły z pola listy do stałego pasa akcji nad nawigacją. Lista przewija się pod nim, a jej dolna krawędź jest wygaszona czterdziestopikselowym gradientem do koloru tła.

**Dlaczego.** Cięcie treści na krawędzi pola bez żadnej wskazówki czyta się jak błąd wyświetlania, nie jak zapowiedź przewijania — zwłaszcza gdy wypada w połowie wysokości liter. Gradient mówi „lista idzie dalej" bez dokładania strzałki ani napisu. Przyciski akcji nie konkurują o miejsce z treścią, bo leżą poza polem, które się przewija.

**Żeby zdecydować inaczej.** Skrócić listę na ekranie głównym do trzech pozycji i przenieść resztę za przycisk „Zobacz wszystkie". Wymaga rozstrzygnięcia, po czym wybierane są te trzy — data najbliższego terminu czy wysokość kwoty — a to pytanie o priorytety użytkownika, nie o układ.

---

## (l) Cień i promienie kanwy kontra osiem reguł kodu

**Brief.** Reguła 1 z `globalne.css`: cienie nie istnieją, warstwy rozdziela obrys 1 px i zmiana tła. Osobno: promienie to 6 / 10 / 14 / 999.

**Kolizja.** Profesjonalizacja oprawy nadała kartom milimetrowy cień (`0 1px 2px`) i sprowadziła promienie do 8 / 12 / 14. Oba rozstrzygnięcia zapadły w kanwie, oba są sprzeczne z kodem, który testy sprawdzają przy każdym przebiegu.

**Decyzja.** Kod ustępuje kanwie. Cień `0 1px 2px rgba(20,22,26,0.05)` zostaje na kartach w trybie jasnym. Skala promieni to 8 (elementy w środku innych elementów) / 12 (wiersze list, pola, pastylki) / 14 (karty, przyciski, pola formularza) / 999 (wskaźniki i kropki). Reguła 1 brzmi teraz: **warstwy rozdziela obrys; cień jest dopuszczalny wyłącznie jako 1 px podniesienia karty nad tłem i nigdy jako źródło hierarchii**.

**Dlaczego.** Zakaz cieni bronił się przed cieniami dekoracyjnymi, które udają głębię. Jeden piksel przy pięcioprocentowej kryciu nie tworzy głębi — odkleja białą kartę od kremowego tła w warunkach, w których sam obrys ginie: przy słabym oświetleniu i na tanich matrycach. Promienie 8 i 12 są zagnieżdżone poprawnie względem 14 (element w wyściółce 4 px w karcie o promieniu 12 musi mieć 8), czego 6 i 10 nie dawały.

**Żeby zdecydować inaczej.** Wycofać cień z wszystkich kart i przywrócić 6 / 10. Wymaga zamiany w `globalne.css` w tokenach `--r-*` i usunięcia jednej reguły `box-shadow`; w kanwie to około 30 miejsc. Decyzja użytkownika z 3 września, do odwrócenia jednym poleceniem.

---

## (m) Sześć stanów kafla na dwie osie

**Brief.** Zmiana 1.2 dała kaflowi sześć stanów: przysługuje, sprawdź warunek, zależy, nie przysługuje, niepewny, wygaszony.

**Kolizja.** Cztery pierwsze mówią o **werdykcie**, dwa ostatnie o **wieku odpowiedzi**. Siedziały na jednej osi, więc kafel nie mógł być jednocześnie „przysługuje" i „na podstawie pominiętego pytania" — a to najczęstszy przypadek u kogoś, kto przeszedł kreator pobieżnie. „Niepewny" i „wygaszony" różniły się przy tym tylko kolorem obrysu przerywanego, czyli w praktyce niczym.

**Decyzja.** Dwie osie. Werdykt ma cztery stany (przysługuje / zapytamy o jedno / to zależy / nie przysługuje), każdy z kolorem, znakiem i słowem. Świeżość to osobny znacznik „Do odświeżenia" — obrys przerywany plus plakietka ze strzałką w kole — który staje na dowolnym z czterech i nie podmienia znaku werdyktu.

**Dlaczego.** Stan złożony z dwóch niezależnych rzeczy nie da się pokazać na jednej osi bez mnożenia wariantów: sześć stanów po scaleniu dałoby osiem, potem dwanaście. Rozdzielenie osi zamyka listę: cztery razy dwa, bez dalszego wzrostu.

**Żeby zdecydować inaczej.** Zrezygnować ze znacznika świeżości i przyjąć, że kafel oparty na pominiętym pytaniu wygląda jak każdy inny. Oszczędza jeden nośnik, ale użytkownik traci informację, że jego własna odpowiedź była „nie wiem".

---

## (n) Znaki werdyktu ✓ ~ — zastąpione

**Brief.** Werdykt niesie kolor, słowo i znak — trzy nośniki, żaden osobno.

**Kolizja.** Znaki dobrane w kodzie na szybko: ✓ czytelny, fala wyglądała jak literówka, myślnik jak interpunkcja. W skali szarości i przy 200% powiększenia dwa z trzech przestawały być symbolami.

**Decyzja.** Trzy znaki różniące się **konturem**, nie tylko kolorem: pełna krzywa (przysługuje), koło wypełnione do połowy (to zależy), koło przekreślone (nie przysługuje). Stan „zapytamy o jedno" ma znak zapytania i plakietkę, ale nie ma znaku werdyktu.

**Dlaczego.** Rozpoznanie kształtu nie zależy od koloru ani od rozdzielczości. Koło wypełnione do połowy mówi „częściowo" bez słowa; koło przekreślone mówi „nie dotyczy" i nie daje się pomylić z myślnikiem w zdaniu.

**Żeby zdecydować inaczej.** Wrócić do znaków tekstowych, jeśli okaże się, że czytniki ekranu radzą sobie z nimi lepiej niż z SVG z `aria-hidden`. Wymaga testu z NVDA i TalkBack.

---

## (o) Plakietka bez wersalików

**Brief.** Plakietka na kaflu nierozstrzygniętym: „SPRAWDŹ JEDEN WARUNEK".

**Kolizja.** Wersaliki czytają się jak ostrzeżenie, a nic złego się nie stało — aplikacja po prostu potrzebuje jednej odpowiedzi. Słowo „warunek" pochodzi z rejestru prawniczego, przed którym cała aplikacja się broni.

**Decyzja.** Forma: 13 px / 600, bez wersalików, w pastylce o promieniu 8 px z obrysem, z ikoną znaku zapytania. Brzmienie: **„Zapytamy o jedno"** — z trzech propozycji autora najkrótsze i jedyne bez słowa prawniczego. Wersaliki zostają w aplikacji w jednym miejscu: w plakietce ostrzeżenia o ryzyku, gdzie krzyk jest uzasadniony.

**Dlaczego.** Plakietka mówi, co się stanie, nie co użytkownik ma zrobić — dlatego „zapytamy", nie „sprawdź". Tryb pierwszej osoby liczby mnogiej jest w tej aplikacji już używany i nie obciąża użytkownika zadaniem.

**Żeby zdecydować inaczej.** Brzmienie jest propozycją redakcyjną i należy do testu z użytkownikami — forma plakietki obroni każdy z trzech wariantów autora bez zmian w projekcie.

---

## (p) Przycisk 72 px poza modułem Pomoc

**Brief.** Cele dotykowe: 48 px zwykłe, 56 px główne, 72 px w Pomocy.

**Kolizja.** Autor kodu dał 72 px przyciskom „Zaczynam" i „Kończę" w E7.1, poza Pomocą. Reguła nazywała miejsce, nie powód.

**Decyzja.** Reguła zostaje rozszerzona przez nazwanie powodu: **72 px dla czynności wykonywanej w pośpiechu lub w rękawicy**. Dziś spełniają to dwa miejsca — moduł Pomoc i rejestracja czasu pracy. Nowe użycie 72 px wymaga wykazania, że czynność spełnia ten warunek.

**Dlaczego.** Powodem wysokości 72 px nigdy nie była powaga Pomocy, tylko warunki, w których się jej dotyka: zdenerwowanie, pośpiech, słaby wzrok. Rejestracja czasu pracy dzieli te warunki — dotyka się jej na progu zakładu, w ruchu, w rękawicy. Reguła oparta na miejscu rozsypie się przy każdym nowym module; oparta na powodzie rozstrzyga sama.

**Żeby zdecydować inaczej.** Utrzymać 72 px wyłącznie w Pomocy i dać rejestracji czasu 56 px. Wymaga testu chybień w rękawicy przy obu wysokościach.

---

## (q) Terakota poza modułem Pomoc

**Brief.** Rodzina powagi (terakota) występuje wyłącznie w module Pomoc.

**Kolizja.** Autor kodu użył jej w dwóch miejscach poza Pomocą: w ostrzeżeniu o ryzyku w pakiecie umowy (E2.3) i w błędach walidacji wpisu czasu pracy (E7.2). Pierwsze jest merytorycznie uzasadnione, drugie było wygodą.

**Decyzja.** Terakota nie należy do modułu Pomoc — należy do **ryzyka, które stwarza drugi człowiek**. Pomoc była dotąd jej jedynym domem, bo tylko tam takie ryzyko występowało. Ostrzeżenie w pakiecie umowy dostaje nazwany wariant „ostrzeżenie o ryzyku ze strony drugiej osoby": tło terakotowe rozjaśnione, obrys 2 px, ikona trójkąta, plakietka wersalikami, **jedno** wyjście odsyłające do Pomocy. Błędy formularza terakoty nie dostają — mają własny stan: obrys atramentowy 2,5 px zamiast 1,5 px, znak wykrzyknika przy polu i zdanie pod polem.

**Dlaczego.** Różnica między Pomocą a ostrzeżeniem jest funkcjonalna, nie estetyczna: Pomoc **daje wyjście** (numer, ścieżkę, człowieka), ostrzeżenie **wstrzymuje krok**. Dlatego ostrzeżenie ma jedno wyjście, nie trzy, i nie ma przycisku 72 px. Błąd formularza nie jest ryzykiem ze strony człowieka — to pomyłka we wpisie, i terakota w tym miejscu przyzwyczajałaby użytkownika, że kolor powagi nic nie znaczy.

**Żeby zdecydować inaczej.** Zamknąć terakotę wyłącznie w Pomocy i dać ostrzeżeniu bursztyn. Odrzucone, bo bursztyn oznacza „to zależy" — a ryzyko reakcji pracodawcy nie jest niepewnością prawną.

---

## (r) Tabela na telefonie zastąpiona listą par

**Brief.** Zmiana 1.2 wprowadza dwie tabele: porównanie form zatrudnienia (E2.8) i ewidencja dzień po dniu (E7.3).

**Kolizja.** Tabela ewidencji ma pięć kolumn i 460 px szerokości przy widoku 393 px. Rozwiązanie z kodu — przewijanie poziome w pudełku — spełnia WCAG 1.4.10, ale zmusza do przewijania w bok, żeby zobaczyć różnicę godzin, czyli jedyną liczbę, po którą się tu przychodzi.

**Decyzja.** Na telefonie tabeli nie ma. Ewidencja to **lista dni**: wiersz 62 px z datą, faktem i różnicą w pierwszej linii, planem i przerwami w drugiej jako zdanie. Porównanie form zatrudnienia to lista par. Tabela zostaje komponentem systemu i wchodzi od 600 px szerokości oraz do dokumentów A4, gdzie siatka jest naturalna. Odnośnik „Zobacz tabelę" otwiera pełną siatkę na pełnym ekranie.

**Dlaczego.** Tabela jest wierna dokumentowi zmiany, lista jest wierna urządzeniu i człowiekowi, który patrzy na telefon po nocnej zmianie. Pięć kolumn na 393 px daje 60 px na kolumnę — mniej niż cel dotykowy i mniej, niż potrzebuje liczba z cyframi tabelarycznymi. Nagłówek tabeli traci przy tym wersaliki: zostają w aplikacji tylko w plakietce ostrzeżenia.

**Żeby zdecydować inaczej.** Utrzymać tabelę z przewijaniem poziomym jako podstawową formę. Wymaga testu z użytkownikami na tym, czy ktokolwiek przewija w bok bez podpowiedzi — dostępność jest tu spełniona formalnie w obu wariantach.

---

## (s) Wygaszenie krawędzi pola przewijanego — dwie wysokości

**Brief.** Treść, która nie mieści się w ekranie, przewija się. Osobno: nic, co niesie informację, nie może być zasłonięte.

**Kolizja.** Gradient wygaszający dolną krawędź pola — wprowadzony wpisem (k) — ma stałą wysokość 40 px i jest przypięty do dolnej krawędzi. Kiedy stos elementów wypełnia pole dokładnie, bez luzu pod ostatnim elementem, te 40 px muszą leżeć na treści ostatniego elementu. Zdarzyło się to dwa razy: plakietka „Zapytamy o jedno" na trzecim kaflu E1.1 i wiersz wartości czwartej pary w E2.8 — w obu przypadkach zasłonięty był jedyny nośnik tekstowy informacji.

**Decyzja.** Wysokość gradientu zależy od tego, co jest pod nim. **40 px** tam, gdzie treść urywa się w połowie elementu — gradient tłumaczy cięcie. **8–12 px** tam, gdzie stos wypełnia pole dokładnie — gradient mówi tylko „lista idzie dalej" i nie ma prawa wejść na ostatni element. Wysokość dobiera się do prześwitu między dolną krawędzią treści a krawędzią pola, nigdy odwrotnie.

**Dlaczego.** Gradient jest wskazówką, nie ozdobą, i nie może zasłaniać tego, co zapowiada. Reguła oparta na stałej liczbie rozsypuje się przy każdym ekranie, w którym treść mieści się co do piksela — a takie ekrany są w tej aplikacji celem, nie wyjątkiem.

**Żeby zdecydować inaczej.** Zrezygnować z gradientu i zapewnić, że przewijane pole zawsze urywa element w połowie — wtedy samo cięcie jest wskazówką. Odrzucone, bo cięcie w połowie wiersza pisma czyta się jak błąd wyświetlania.

---

## Do rozstrzygnięcia przez zespół

1. **Grupowanie listy sytuacji** — patrz (b). Wymaga testu z użytkownikami, nie decyzji projektowej.
2. **Pliki znaków Funduszy Europejskich** — pas oznaczeń ma opisane wymiary i kolejność, ale wektorowe pliki znaków musi wstawić zespół z obowiązującej księgi wizualizacji.
3. **Numery infolinii** — 800 70 2222 i 116 123 użyte w makietach jako przykład. Przed wdrożeniem trzeba potwierdzić, które numery aplikacja faktycznie poleca i czy działają całodobowo.
4. **Dni poprzedniego miesiąca w kalendarzu grafiku** — dni 26–31 mają kontrast 3,3:1, poniżej AA. Uzasadnienie: to elementy nieaktywne, których wytyczna 1.4.3 nie obejmuje. Do potwierdzenia przez zespół, bo odbiorcą jest osoba po nocnej zmianie przy słabym oświetleniu, a formalne zwolnienie nie znaczy, że da się je odczytać.
5. **Odstępy w klawiaturze numerycznej** — cała aplikacja trzyma skalę odstępów w wielokrotnościach czterech pikseli. Klawiatura w module Pomoc ma jedno odstępstwo (3 px między klawiszami), bo czwórka rozpycha klawisze ponad wysokość ekranu. Do rozstrzygnięcia przy wdrożeniu: albo odstępstwo zostaje, albo klawisze maleją o 4 px w wysokości.
6. **Wysokość kafla 104 px przy powiększeniu 200%** — kafel ma stałą wysokość i tytuł do dwóch linii. Przy 200% tytuł zajmie te dwie linie w całości, a konkret zejdzie poniżej obcięcia. Projekt przewiduje wtedy wzrost kafla do 148 px, ale to zwiększa listę o 132 px i wypycha „Pobierz kartę" pod zgięcie. Do rozstrzygnięcia: czy przy 200% dokument ma zostać nad zgięciem, czy ustąpić kaflom.
7. **Licznik na żywo a czytniki ekranu** — liczba podmienia się raz na minutę. Trzeba ustalić, czy blok ma `aria-live="off"` (czytnik nie przerywa), czy `polite`. Projekt zakłada `off` i przycisk „Odczytaj czas pracy" obok, ale to wymaga testu z NVDA i TalkBack.
8. **Ewidencja jako dowód** — E7.5 tworzy dokument A4 z sumą godzin. Trzeba rozstrzygnąć z prawnikami, czy taki wydruk może być używany w sporze z pracodawcą, i czy dokument potrzebuje adnotacji o tym, że jest zapisem własnym pracownika, a nie ewidencją pracodawcy.
9. **Data przeglądu treści** — metryczka zawiera datę następnego przeglądu. Trzeba ustalić, kto i w jakim rytmie ten przegląd wykonuje, bo bez tego metryczka po roku zacznie kłamać.
