# Projekt NIPiP — Harmonogram kursów 2026/2027 · OIPiP w Słupsku

Kreatywna, infograficzna i responsywna implementacja podstrony
[`/projektnipip-promocja/`](https://oipip.slupsk.pl/projektnipip-promocja/)
dla Okręgowej Izby Pielęgniarek i Położnych w Słupsku.

> **Plik główny:** [`index.html`](index.html) — kompletna, samodzielna strona
> (HTML + CSS + JS w jednym pliku, bez zależności poza Google Fonts). Otwórz w
> przeglądarce, aby zobaczyć efekt.

---

## 1. Analiza identyfikacji wizualnej OIPiP w Słupsku

Tokeny wizualne odczytane wprost z motywu WordPress `izba-slupsk`
(`oipip.slupsk.pl`):

| Element | Wartość | Zastosowanie |
|---|---|---|
| **Kolor wiodący** | czerwień `#e30513` (warianty `#ed2024`, `#ec1c24`, `#cf2e2e`) | logo, akcenty, CTA |
| **Tekst / grafit** | `#231f20`, `#313131` | nagłówki i treść |
| **Tło** | biel / off-white | czysta, „medyczna” przestrzeń |
| **Typografia** | **Titillium Web** (Google Fonts, wagi 300–900) | całość |
| **Logo** | `logo.svg` (motyw `izba-slupsk/img/`) | nagłówek |
| **Charakter** | instytucjonalny, czysty, dużo światła, układ kartowy, sticky header | — |

Wniosek: marka jest **czerwono-grafitowa** (nie niebieska, jak mogłaby
sugerować ogólna „paleta medyczna”), z jedną mocną, rozpoznawalną czerwienią
jako bohaterem. Cały projekt trzyma tę zasadę: czerwień prowadzi, reszta jest
neutralna i podporządkowana.

## 2. Koncepcja graficzna i contentowa

Zamiast „twardego” odwzorowania tabel — **system kart kursów** z mikro-infografiką:

- **Hero** w gradiencie czerwieni marki + licznik (kursy / edycje / typy kształcenia
  — liczony automatycznie z danych).
- **Trzy typy kształcenia** rozróżnione kolorem-kodem (spójnym z czerwienią jako
  liderem):
  - 🔴 **Specjalistyczne** — czerwień `#e30513`
  - 🔵 **Kwalifikacyjne** — grafitowy granat `#243b53`
  - 🟠 **Dokształcające** — ciepły bursztyn `#c9821c`
  - 🟢 **Zrealizowane 2025** — zieleń „ukończone” `#2f8f5b`
- **Karta kursu** = pasek kategorii + ikona + nazwa + adresaci (pill) + każda
  edycja jako **oś czasu** „Rozpoczęcie → Zakończenie” z auto-wyliczanym czasem
  trwania (np. *~10 tyg.*).
- **Sticky sub-nawigacja** z kropkami w kolorach kategorii.
- **Sekcja 2025** wydzielona zielonym pasmem z motywem „✓ ukończone”.

## 3. Cechy realizacji

- **Responsywność**: siatka `auto-fill` zwija się z wielu kolumn do jednej;
  dedykowane reguły dla ekranów < 640 px (ukryty topbar/CTA, kompaktowa oś czasu).
- **Dane oddzielone od widoku**: cały harmonogram to tablice `SCHEDULE` i
  `DONE_2025` w `index.html` — aktualizacja terminu = jedna linia, bez ruszania
  layoutu. Liczniki i czas trwania liczą się same.
- **Dostępność**: `prefers-reduced-motion`, semantyczne sekcje, kontrast,
  `<noscript>` fallback z kontaktem.
- **Lekkość**: zero frameworków i build-stepu; jedyna zależność zewnętrzna to font.

## 4. Zmiany merytoryczne względem oryginału

- **Usunięto** 3 kursy promocyjne (EKG, Leczenie ran, Żywienie) wraz z wklejonym
  harmonogramem.
- **Dodano** „Harmonogram kursów na 2026 i 2027 rok” (specjalistyczne,
  kwalifikacyjne, dokształcające).
- **Dodano** „Kursy zrealizowane w Projekcie w 2025 r.”.
- Pozostałe elementy podstrony (benefity, nagłówek projektu) pozostają bez zmian
  i nie były przedmiotem przebudowy.

### Drobne korekty oczywistych literówek ze źródła

W sekcji 2025 r. poprawiono niedokończone lata, które w oryginale były wyraźnymi
omyłkami pisarskimi (kontekst całej sekcji to rok 2025):

- *„od 19.10.202r. do 03.12.202r.”* → **19.10.2025 – 03.12.2025**

Uspójniono też zapis dat (pełny rok `2025`) oraz nazewnictwo nagłówków
(„Kursy zrealizowane”, „Kursy dokształcające”). Same terminy i nazwy kursów
pozostawiono zgodnie z przekazaną treścią.

---

# Gra edukacyjna „Wyprawa przez Ustawę”

> **Plik:** [`wyprawa-przez-ustawe.html`](wyprawa-przez-ustawe.html). To kompletna, samodzielna gra 3D (HTML, CSS i JS w jednym pliku, z osadzonym krojem Titillium Web, logo Izby i biblioteką grafiki 3D three.js na licencji MIT, bez zależności zewnętrznych, ok. 1,3 MB). Wymaga przeglądarki z obsługą WebGL, czyli każdej współczesnej przeglądarki na komputerze i telefonie.
> **Kod osadzenia we wpisie:** [`wordpress/wyprawa-przez-ustawe-osadzenie.html`](wordpress/wyprawa-przez-ustawe-osadzenie.html)

Gra zręcznościowa 3D, która sprawdza wiedzę o ustawie z dnia 1 lipca 2011 r. o samorządzie pielęgniarek i położnych (t. j. Dz. U. z 2025 r. poz. 1760). Kamera stoi za plecami postaci, a postać idzie w głąb świata ścieżką, która co jakiś czas rozszerza się w place pełne ludzi i rozwidla na drogę bezpieczną i trudną. Gracz skacze nad dołami i po półkach, jeździ windą na balkony, rozbija kartony, pomaga spotkanym osobom, wykonuje misje, zbiera pamiątki zawodu i za zebrane paragrafy kupuje w sklepiku koła ratunkowe, wzmocnienia i ulepszenia. Wiedzę sprawdza nie tylko w oknie pytania, ale też ruchem postaci, w bramkach prawdy, lukach w przepisach i właściwych drzwiach.

- **Postaci**: pielęgniarka, pielęgniarz, położna albo położny, z tymi samymi umiejętnościami. Gra zwraca się do gracza w formie żeńskiej albo męskiej, zależnie od wybranej postaci.
- **Osiem światów = rozdziały ustawy w miejscach, w których pracują pielęgniarki, pielęgniarze, położne i położni**. Każdy świat ma dwa etapy w plenerze, etap we wnętrzu z tabliczkami na drzwiach i strażnika rozdziału (Wątpliwość), razem 32 etapy. Między etapami prowadzi mapa ustawy, po której chodzi postać. Etapy 1, 2 i 3 świata można przechodzić w dowolnej kolejności, strażnik otwiera się po dwóch z nich, a kolejny świat po strażniku.

  | Świat | Rozdział ustawy | Plener | Wnętrze (etap 3) |
  |---|---|---|---|
  | 1 | Przepisy ogólne | Kampus uczelni (Wydział Nauk o Zdrowiu, aula, biblioteka) | Centrum symulacji medycznej |
  | 2 | Zadania i zasady działania samorządu | Przychodnia na osiedlu, apteka, punkt pobrań | Korytarz przychodni |
  | 3 | Prawa i obowiązki członków | Szpital powiatowy | Oddział chorób wewnętrznych |
  | 4 | Organy Naczelnej Izby | Białe miasteczko w stolicy | Siedziba Naczelnej Izby, drzwi z nazwami organów |
  | 5 | Organy okręgowej izby | Uzdrowisko nad morzem | Siedziba okręgowej izby, drzwi z nazwami organów |
  | 6 | Odpowiedzialność zawodowa, postępowanie | Szpitalny oddział ratunkowy nocą | Korytarz oddziału ratunkowego |
  | 7 | Odpowiedzialność zawodowa, kary i środki odwoławcze | Oddział położniczy o zmierzchu, szkoła rodzenia | Blok porodowy |
  | 8 | Majątek i przepisy końcowe | Opieka w domu pacjenta, ośrodek zdrowia na wsi | Dom pomocy społecznej |

  Transparenty w białym miasteczku mają ogólne hasła („Bezpieczny pacjent”, „Godna praca”, „Więcej rąk do opieki”) i nie wskazują żadnej organizacji. Ukryty pokój za rurą poczty pneumatycznej to archiwum dokumentacji.
- **Pytania**: pytania z podstawą prawną i wyjaśnieniem, w sześciu formach. Jednokrotny wybór, prawda czy fałsz, luka w przepisie, wskazanie wszystkich poprawnych odpowiedzi, ułożenie kroków w kolejności i pytanie o właściwy organ. Kryją się w czerwonych blokach z pytajnikiem, w złotym bloku w ukrytym pokoju, u strażnika i u postaci na starcie etapu, która zadaje pytanie, zanim poprosi o pomoc. Strażnik ostatniego świata wraca do pytań, na które padła błędna odpowiedź.
- **Próby wiedzy na trasie**: odpowiada się ruchem postaci, bez okna. Bramka prawdy pokazuje zdanie z ustawy, a gracz przebiega pasem PRAWDA albo FAŁSZ. Luka w przepisie to trzy żetony z odpowiedziami nad ścieżką, z których trzeba dotknąć właściwego. Właściwe drzwi to trzy drzwi z tabliczkami, z których jedne odpowiadają na pytanie. Treść próby pokazuje pasek u góry ekranu. Dobra odpowiedź daje punkty, paragrafy i serię, błędna odbiera punkty i paragrafy, ale nie niesie kary z art. 60. Wszystkie odpowiedzi trafiają do raportu wiedzy.
- **Nagrody**: dobra odpowiedź daje 1000 pkt (w trybach z limitem także 25 pkt za każdą pozostałą sekundę), wzmocnienie, deszcz paragrafów i rosnący mnożnik serii (×1,5, ×2, ×3, ×4), który mnoży wszystkie punkty w grze. Każda dobra odpowiedź zaciera jeden stopień kary.
- **Budowa etapu**: start na małym placu, gdzie postać (np. absolwentka, oddziałowa, delegatka na zjazd) zadaje pytanie z rozdziału i prosi o odnalezienie zgubionego dokumentu. Dalej dwa place z podestem i blokiem z pytaniem, rekwizytami, na które można wskoczyć, kartonami do rozbicia, górną trasą na półce i przejściem dla pieszych, przez które co jakiś czas przejeżdża samochód (na oddziale ratunkowym karetka). Obok pierwszego placu, po stronie kartonów, jest zakątek pamiątek, a na trasie rozwidlenie, dwie bramki prawdy, luka w przepisie, właściwe drzwi i od trzeciego świata winda na balkon ze złotym paragrafem. Lewa droga rozwidlenia jest bezpieczna, prawa ma dół, wózek i spadającą kładkę, ale kryje złoty paragraf, wzmocnienie i dużo więcej paragrafów. We wnętrzach place są poczekalniami z rzędami krzeseł i ladą rejestracji, a zakątek pokojem socjalnym. Drugi etap każdego dziennego świata rozgrywa się pod wieczór.
- **Kultura zawodu**: punkt kontrolny to lampka oliwna, która zapala się po jego minięciu, jak lampa Florence Nightingale. W zakątku obok pierwszego placu w pierwszym etapie każdego świata czeka pamiątka zawodu (m.in. lampka oliwna, czepek z paskiem, prawo wykonywania zawodu, kodeks etyki zawodowej, sztandar, odznaczenie samorządu), a w kolejnych etapach tablica Kroniki zawodu. Zebrane pamiątki, wpisy kroniki i informacje o Okręgowej Izbie Pielęgniarek i Położnych w Słupsku są w ekranie Kronika zawodu. Przechodnie na placach zagadują gracza zdaniami o zawodzie i samorządzie, a na banerach są hasła wydarzeń zawodowych.
- **Czytelność skoków**: pod każdym blokiem leży świecący krąg, który jasno rozbłyska, gdy postać stoi we właściwym miejscu. W locie znacznik pokazuje miejsce lądowania. Krawędzie podłóg nad dołami są jasno obrysowane. W skoku do góry postać lekko dociąga się pod najbliższy blok, a kamera przysuwa się, zamiast wchodzić w półki.
- **Paragrafy i sklepik**: paragrafy układają się w ścieżki, łuki nad dołami i kręgi, a zebrana w całości grupa daje premię. Paragrafy to waluta sklepiku na mapie, w którym są koła ratunkowe do pytań (Ściąga, Konsultacja, Druga szansa), wzmocnienia do torby (PWZ, Kodeks, Mandat, Pieczęć) i Czepek na dodatkowe życie. Mandat i Pieczęć zdobyte w grze trafiają do torby, więc gracz sam wybiera chwilę ich użycia.
- **Ulepszenia za złote paragrafy**: sześć ulepszeń po trzy poziomy (Wygodne obuwie, Sprężysty krok, Magnes na paragrafy, Torba dyżurna, Zegarek, Opanowanie).
- **W oknie pytania**: koła ratunkowe i podwójna stawka (dwa razy więcej punktów, ale błąd podnosi karę o dwa stopnie).
- **Kary**: kolejne błędy w etapie przynoszą kary nazwane jak kary z art. 60 ustawy, czyli upomnienie, naganę, karę pieniężną, ograniczenie zakresu czynności i zawieszenie prawa wykonywania zawodu (utrata życia, w trybie Nauka 20 sekund ograniczenia). U strażnika błąd dodatkowo go wzmacnia.
- **Misje i pieczęcie**: każdy etap ma trzy misje, a każda daje jedną pieczęć. Pierwsza to dojście do Izby, druga to wszystkie pytania bez błędu, trzecia zmienia się z etapu na etap (prośba postaci, zebrane paragrafy, trudna droga, złote paragrafy, pokonani przeciwnicy, rozbite kartony albo czas). Pieczęcie z różnych podejść sumują się. Misje widać na karcie etapu, w pauzie i po etapie. Do tego premie za komplet pytań i bezbłędny etap, trzy złote paragrafy w każdym etapie i dwanaście odznak z jednorazową nagrodą w paragrafach.
- **Grafika**: cienie rzucane przez postaci i budowle (na komputerze włączone, na telefonie do włączenia w ustawieniach), ptaki krążące nad placami, opadające liście albo płatki, pies biegający wzdłuż płotu, jasno obrysowane krawędzie podłóg.
- **Elementy plansz**: place, rozwidlenia, zakątki, windy, przejścia dla pieszych, bramki, kartony, doły, schody, kamienie i półki na różnych wysokościach, platformy ruchome i spadające, sprężyny, wózki szpitalne jeżdżące w poprzek ścieżki, pieczątki spadające z góry, kopiarki wysyłające pisma, przeciwnicy (zaległy formularz, plotka, zegar przedawnienia, teczka do kopania), rury poczty pneumatycznej z ukrytym pokojem archiwum, tablice z powtórką błędnych odpowiedzi, punkt kontrolny w połowie etapu i maszt z flagą przed budynkiem Izby na mecie.
- **Szyldy w świecie**: nazwy miejsc stoją przy ścieżce na słupach (np. „Wydział Nauk o Zdrowiu”, „Szpital powiatowy”, „Szpitalny oddział ratunkowy”), a we wnętrzach tabliczki wystają ze ścian nad drzwiami, więc widać je z daleka.
- **Ocena wiedzy**: liczy się pierwsza odpowiedź na każde pytanie. Raport pokazuje wynik ogólny, wynik w każdym rozdziale i listę do powtórki. Kartę wyniku można wydrukować. Kompendium zbiera odkryte pytania z odpowiedziami.
- **Tryby**: Nauka (5 żyć, bez limitu czasu, łagodniejsze kary), Wyzwanie (30 sekund na odpowiedź), Ekspert (15 sekund, szybsi przeciwnicy). W ustawieniach jest swobodny wybór świata na potrzeby szkoleń.
- **Sterowanie**: klawiatura (strzałki albo W, A, S, D to ruch, spacja to skok, Shift albo X to bieg i rzut, E albo cyfry 1–4 to przedmiot z torby, a w oknie pytania Q, W, E i R to koła ratunkowe i podwójna stawka, Enter zatwierdza odpowiedź wielokrotną), ekran dotykowy (przedmiot z torby to dotknięcie jego ikony w prawym górnym rogu) i pad (przycisk Y to przedmiot z torby). Na ekranie dotykowym gra działa na gestach, bez przycisków, jak w grach na telefon. Lewa połowa ekranu to ruch, prawa to skok. Przytrzymanie palca po lewej to marsz naprzód, przesuwanie palca skręca albo cofa, a po chwili marszu postać sama zaczyna biec. Dotknięcie po prawej to skok, przytrzymanie daje wyższy skok i lot z Mandatem, a dwa szybkie dotknięcia to rzut paragrafem. Skok nie wyzwala się już przypadkowo przy przesuwaniu palca ruchu. Na rurze wejście do ukrytego pokoju to szybkie przesunięcie palca skoku w dół albo przytrzymanie palca ruchu pociągniętego w dół. Pod palcem pokazuje się pierścień, który podpowiada kierunek. Podpowiedzi stref pokazują się na początku pierwszych etapów. W ustawieniach można zamienić strony (dla leworęcznych) albo włączyć klasyczne przyciski. Na telefonie gra i menu zajmują cały ekran.
- **Telefon obrócony na bok**: gdy przeglądarka sama obraca stronę, gra przechodzi w układ poziomy. Gdy ekran zostaje w pionie (blokada obrotu, podgląd w aplikacji), gra obraca się sama według czujnika ruchu, jeśli przeglądarka go udostępnia (Android). W pozostałych przypadkach służy do tego przycisk obrotu w prawym górnym rogu planszy oraz przycisk „Obróć grę na bok” w menu. Na iPhonie przycisk obrotu prosi też o zgodę na czujnik ruchu. W ramce we wpisie obracanie jest wyłączone, bo tam służy przycisk „Otwórz w nowej karcie”.
- **Prywatność**: postęp i imię na karcie wyniku zostają w pamięci tej przeglądarki (localStorage). Gra niczego nie wysyła. Odpowiedzi z pierwszej wersji gry przechodzą do nowej automatycznie.

## Wdrożenie na WordPress

1. Wgraj `wyprawa-przez-ustawe.html` do Mediów z konta administratora. W październiku 2026 r. adres pliku to `https://oipip.slupsk.pl/wp-content/uploads/2026/10/wyprawa-przez-ustawe.html` (w chwili przygotowania pliku ten adres nie był zajęty). Jeśli wgrywasz go w innym miesiącu, popraw `2026/10` w kodzie osadzenia.
2. We wpisie dodaj blok „Własny HTML” i wklej zawartość `wordpress/wyprawa-przez-ustawe-osadzenie.html`.
3. Plik sam ustawia wysokość ramki (identyfikator ramki zaczyna się od `oipip-iframe`). Gdy otwierasz menu, ramka rośnie do wysokości treści, a po powrocie do gry wraca do wysokości planszy. Na telefonie przycisk „Otwórz w nowej karcie” uruchamia grę na całym ekranie.

## Edycja pytań

Pytania są w pliku w tablicy `WPU_QUESTIONS` (wyszukaj tę nazwę). Pierwsza odpowiedź w tablicy `o` jest zawsze poprawna, a gra sama tasuje kolejność. Pytania „Prawda czy fałsz?” mają pole `tf: true` i poprawną odpowiedź w polu `ans`. Każda zmiana pliku wymaga wgrania go do Mediów pod nową nazwą (np. `-v2`) i podmiany adresu w kodzie osadzenia.
