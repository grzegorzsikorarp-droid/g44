# ROZBIEŻNOŚCI_DESIGN.md

Rejestr miejsc, w których brief nie dawał się zrealizować dosłownie, oraz decyzji, które w tych miejscach podjąłem. Każdy wpis ma to samo pięć części: co mówi brief, na czym polega kolizja, co zrobiłem, dlaczego tak, i co trzeba zrobić, żeby zdecydować inaczej.

Stan na 1 września 2026. Dotyczy pliku `System BHPewnie.dc.html`.

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

## Do rozstrzygnięcia przez zespół

1. **Grupowanie listy sytuacji** — patrz (b). Wymaga testu z użytkownikami, nie decyzji projektowej.
2. **Pliki znaków Funduszy Europejskich** — pas oznaczeń ma opisane wymiary i kolejność, ale wektorowe pliki znaków musi wstawić zespół z obowiązującej księgi wizualizacji.
3. **Numery infolinii** — 800 70 2222 i 116 123 użyte w makietach jako przykład. Przed wdrożeniem trzeba potwierdzić, które numery aplikacja faktycznie poleca i czy działają całodobowo.
4. **Data przeglądu treści** — metryczka zawiera datę następnego przeglądu. Trzeba ustalić, kto i w jakim rytmie ten przegląd wykonuje, bo bez tego metryczka po roku zacznie kłamać.
