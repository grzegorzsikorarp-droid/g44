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

> **Plik:** [`wyprawa-przez-ustawe.html`](wyprawa-przez-ustawe.html). To kompletna, samodzielna gra (HTML, CSS i JS w jednym pliku, z osadzonym krojem Titillium Web i logo Izby, bez zależności zewnętrznych).
> **Kod osadzenia we wpisie:** [`wordpress/wyprawa-przez-ustawe-osadzenie.html`](wordpress/wyprawa-przez-ustawe-osadzenie.html)

Gra zręcznościowa w stylu platformówki, która sprawdza wiedzę o ustawie z dnia 1 lipca 2011 r. o samorządzie pielęgniarek i położnych (t. j. Dz. U. z 2025 r. poz. 1760).

- **Postaci**: pielęgniarka, pielęgniarz, położna albo położny, z tymi samymi umiejętnościami. Gra zwraca się do gracza w formie żeńskiej albo męskiej, zależnie od wybranej postaci.
- **Osiem światów = rozdziały ustawy w miejscach pracy pielęgniarek, pielęgniarzy, położnych i położnych**. Każdy świat ma dwa etapy w plenerze, etap we wnętrzu z tabliczkami na drzwiach i strażnika rozdziału (Wątpliwość), razem 32 etapy. Między etapami prowadzi mapa ustawy, po której chodzi postać.

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
- **Pytania**: 153 pytania z podstawą prawną i wyjaśnieniem. Kryją się w czerwonych blokach z pytajnikiem, w złotym bloku w ukrytym pokoju i u strażnika. Strażnik ostatniego świata wraca do pytań, na które padła błędna odpowiedź.
- **Nagrody**: dobra odpowiedź daje 1000 pkt (w trybach z limitem także 25 pkt za każdą pozostałą sekundę), wzmocnienie, deszcz paragrafów i rosnący mnożnik serii (×1,5, ×2, ×3, ×4), który mnoży wszystkie punkty w grze. Każda dobra odpowiedź zaciera jeden stopień kary.
- **Kary**: kolejne błędy w etapie przynoszą kary nazwane jak kary z art. 60 ustawy, czyli upomnienie, naganę, karę pieniężną, ograniczenie zakresu czynności i zawieszenie prawa wykonywania zawodu (utrata życia, w trybie Nauka 20 sekund ograniczenia). U strażnika błąd dodatkowo go wzmacnia.
- **Ocena etapu**: do trzech pieczęci, premie za komplet pytań i bezbłędny etap, trzy złote paragrafy w każdym etapie.
- **Elementy plansz**: rury poczty pneumatycznej z ukrytymi pokojami, taśmociągi, woda, platformy ruchome i spadające, ukryte bloki, teczki do kopania, kopiarki strzelające pismami, obrotowe paragrafy, tablice z powtórką błędnych odpowiedzi.
- **Ocena wiedzy**: liczy się pierwsza odpowiedź na każde pytanie. Raport pokazuje wynik ogólny, wynik w każdym rozdziale i listę do powtórki. Kartę wyniku można wydrukować. Kompendium zbiera odkryte pytania z odpowiedziami.
- **Tryby**: Nauka (5 żyć, bez limitu czasu, łagodniejsze kary), Wyzwanie (30 sekund na odpowiedź), Ekspert (15 sekund, szybsi przeciwnicy). W ustawieniach jest swobodny wybór świata na potrzeby szkoleń.
- **Sterowanie**: klawiatura, ekran dotykowy (przyciski na ekranie, na telefonie menu na cały ekran) i pad.
- **Telefon obrócony na bok**: gdy przeglądarka sama obraca stronę, gra przechodzi w układ poziomy. Gdy ekran zostaje w pionie (blokada obrotu, podgląd w aplikacji), gra obraca się sama według czujnika ruchu, jeśli przeglądarka go udostępnia (Android). W pozostałych przypadkach służy do tego przycisk obrotu w prawym górnym rogu planszy oraz przycisk „Obróć grę na bok” w menu. Na iPhonie przycisk obrotu prosi też o zgodę na czujnik ruchu. W ramce we wpisie obracanie jest wyłączone, bo tam służy przycisk „Otwórz w nowej karcie”.
- **Prywatność**: postęp i imię na karcie wyniku zostają w pamięci tej przeglądarki (localStorage). Gra niczego nie wysyła. Odpowiedzi z pierwszej wersji gry przechodzą do nowej automatycznie.

## Wdrożenie na WordPress

1. Wgraj `wyprawa-przez-ustawe.html` do Mediów z konta administratora. W październiku 2026 r. adres pliku to `https://oipip.slupsk.pl/wp-content/uploads/2026/10/wyprawa-przez-ustawe.html` (w chwili przygotowania pliku ten adres nie był zajęty). Jeśli wgrywasz go w innym miesiącu, popraw `2026/10` w kodzie osadzenia.
2. We wpisie dodaj blok „Własny HTML” i wklej zawartość `wordpress/wyprawa-przez-ustawe-osadzenie.html`.
3. Plik sam ustawia wysokość ramki (identyfikator ramki zaczyna się od `oipip-iframe`). Gdy otwierasz menu, ramka rośnie do wysokości treści, a po powrocie do gry wraca do wysokości planszy. Na telefonie przycisk „Otwórz w nowej karcie” uruchamia grę na całym ekranie.

## Edycja pytań

Pytania są w pliku w tablicy `WPU_QUESTIONS` (wyszukaj tę nazwę). Pierwsza odpowiedź w tablicy `o` jest zawsze poprawna, a gra sama tasuje kolejność. Pytania „Prawda czy fałsz?” mają pole `tf: true` i poprawną odpowiedź w polu `ans`. Każda zmiana pliku wymaga wgrania go do Mediów pod nową nazwą (np. `-v2`) i podmiany adresu w kodzie osadzenia.
