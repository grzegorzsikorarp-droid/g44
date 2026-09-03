# Zlecenie dla Claude Design — BHPewnie, wydanie 1.2

Ten plik jest **wsadem do kanwy projektowej**, nie briefem produktowym. Opisuje to, co po zmianie 1.2 stoi w działającej aplikacji **bez projektu**: komponenty złożone naprędce przy pisaniu kodu, ekrany, których kanwa `System BHPewnie.dc.html` w ogóle nie zna, oraz jedno miejsce, w którym świadomie złamałem regułę systemu i chcę, żeby ktoś to rozstrzygnął porządnie.

Wszystkie liczby poniżej są **zmierzone w przeglądarce**, nie oszacowane. Widok odniesienia: **393 × 727 px** (Pixel 5 z paskiem przeglądarki), profil przykładowy „Barbara" — 27 uprawnień, grafik zmianowy z nockami, umowa o pracę.

Stan na 3 września 2026. Kod: gałąź `claude/bhp-worker-demo-app-ra14t3`, katalog `bhpewnie/`.

---

## 0. Czego NIE zmieniać

To jest ważniejsze niż lista zadań. Poniższe rzeczy są przetestowane, opisane i mają za sobą decyzje zespołu — zmiana któregokolwiek z nich wywraca coś, czego z kanwy nie widać.

1. **Osiem reguł nienegocjowalnych** z nagłówka `src/style/globalne.css`. W szczególności: zero czerwieni w interfejsie, żadna informacja nie niesiona samym kolorem, cienie nie istnieją (warstwy rozdziela obrys 1 px i zmiana tła), brak animacji przejść między ekranami.
2. **Sześć rodzin semantycznych** i ich role: pewność (zieleń morska) = „przysługuje", zależy (bursztyn) = „to zależy", neutralny (szarość) = „nie przysługuje", powaga (terakota) = **wyłącznie moduł Pomoc**, tła, tekst. Nazwy zmiennych CSS zostają — kod się do nich odwołuje.
3. **Cele dotykowe**: 48 px zwykłe, 56 px główne, **72 px w Pomocy**. Pismo bazowe 16 px. Testy dostępności mierzą to przy każdym przebiegu i przewracają się przy naruszeniu.
4. **Trzy stałe akcje pod każdym rozstrzygnięciem**, zawsze w tej kolejności: Pobierz wniosek PDF · Jak o to poprosić · Przypomnij mi. Kolejność jest regułą, nie układem.
5. **Karta „nie przysługuje" kończy się blokiem „co Ci przysługuje zamiast tego"** — bez wyjątków.
6. **Logotyp** w wariancie „Zawias" i czerwień FZZ wyłącznie w blokach nadawcy (stopka „O aplikacji", pas oznaczeń w dokumentach A4). Nigdy w interfejsie.
7. **IBM Plex Sans z plików lokalnych**, cyfry tabelaryczne w tabelach i sumach. Fontów z sieci nie ma i nie może być.

Jeżeli projekt wymaga złamania którejś z tych reguł, potrzebny jest **wpis w `ROZBIEZNOSCI_DESIGN.md`** w tym samym pięcioczęściowym układzie co dotychczasowe: brief / kolizja / decyzja / dlaczego / żeby zdecydować inaczej. Nie „poprawka w kanwie".

---

## 1. Zadanie główne: ekran E1.1 nie mieści się w telefonie

To jest najpoważniejsza rzecz na tej liście i jedyna, która ma twardy wymóg z dokumentu zmiany.

### Pomiar

Treść ekranu głównego ma **1523 px** przy widoku **727 px** — dwa i jeden dziesiąty ekranu. Rozkład:

| element | wysokość |
|---|---|
| kafel profilu | 89 px |
| pasek „Coś się zmieniło w Twojej pracy?" (nowy w 1.2) | 98 px |
| panel sezonowy „Dziś 30 °C" | 126 px |
| nagłówek listy „Najważniejsze teraz · 27 uprawnień" | 20 px |
| **trzy kafle uprawnień** | **525 px** |
| kafel stały „Mój czas pracy" (nowy w 1.2) | 78 px |
| przycisk „Pobierz kartę moich uprawnień" | 56 px |
| „Pokaż wszystkie uprawnienia (27)" | 77 px |
| karta ostatniej aktualności | 139 px |
| „Moje terminy" + „Ustawienia" | 112 px |

Sam obowiązkowy zestaw z punktu 3.4 zmiany 1.2 — profil, pasek, panel sezonowy, nagłówek i trzy kafle — to **858 px**, czyli o **131 px więcej, niż ekran ma wysokości**, zanim dołożymy cokolwiek innego.

Dokument zmiany wymaga przy tym, żeby „Pobierz kartę moich uprawnień" był **widoczny bez przewijania**. Dziś zaczyna się **347 px poniżej krawędzi**. Przesunąłem go już o 89 px w górę (przed „Pokaż wszystkie") i zamknąłem panel sezonowy poza miesiącami maj–wrzesień; więcej bez decyzji projektowej nie da się zrobić.

### Sedno problemu: kafel uprawnienia rozjeżdża się od 127 do 247 px

Trzy kafle widoczne u Barbary:

```
127 px   Dodatek za pracę w nocy · 5,46 zł za każdą godzinę pracy w nocy
247 px   Przerwa w czasie dnia pracy · 15 minut przerwy przy dniówce od 6 h…
127 px   Odpoczynek między zmianami · 11 godzin na dobę i 35 godzin…
```

Kafel jest dziś **dwuwierszowy w założeniu, a wielowierszowy w praktyce**: tytuł zawija się przy dłuższych nazwach, a „konkret" bywa całym zdaniem, nie liczbą. Jeden kafel potrafi zająć jedną trzecią ekranu.

### Czego oczekuję

1. **Kafel uprawnienia o przewidywalnej wysokości.** Wariant docelowy i wariant awaryjny dla długiego konkretu (obcięcie z wielokropkiem? druga linia i koniec? konkret przeniesiony na kartę?). Podaj wysokość, przy której trzy kafle zmieszczą się w 300–360 px zamiast 525 px.
2. **Pasek „Coś się zmieniło w Twojej pracy?" w jednej linijce.** Dziś zawija się na dwie i kosztuje 98 px. Treść jest ustalona dokumentem zmiany i nie wolno jej skracać — potrzebny układ, nie inne słowa.
3. **Rozstrzygnięcie hierarchii.** Co ma być widoczne bez przewijania, jeśli wszystko naraz się nie da: trzy kafle czy droga do dokumentu? Dokument zmiany chce obu rzeczy naraz i to jest wpis 16 w `ROZBIEZNOSCI.md` — decyzja należy do projektu, nie do kodu.

---

## 2. Sześć stanów kafla — złożone naprędce, wymagają projektu

Zmiana 1.2 przeniosła rozstrzyganie warunku z osobnej zakładki **na kafel**. Kafel ma teraz sześć stanów; wszystkie sześć narysowałem w CSS przy pisaniu kodu i **żaden nie przeszedł przez kanwę**.

| stan | kiedy | co dziś robi kod |
|---|---|---|
| `przysluguje` | warunek `null` albo rozstrzygnięty na „tak" | wygląd domyślny + znak ✓ w rogu |
| `sprawdz_warunek` | warunek istnieje, nierozstrzygnięty | tło `--karta-druga`, obrys `--obrys-mocny`, plakietka, **bez liczby** |
| `zalezy` | rozstrzygnięty na „zależy" | bursztyn + znak ~ |
| `nie_przysluguje` | rozstrzygnięty na „nie" | szarość + znak — |
| `niepewny` | wynika z pominiętego pytania kreatora | obrys przerywany bursztynowy (jak w 1.1) |
| `wygaszony` | parametr po dacie ważności | obrys przerywany szary |

Klasy w kodzie: `.kafel--stan-<nazwa>`, znak stanu w `.kafel__stan` (24 × 24 px, w prawym górnym rogu), plakietka `.znacznik--sprawdz`.

### Do rozstrzygnięcia

1. **Czy sześć stanów to nie za dużo na jednym ekranie.** U Barbary widać jednocześnie zielone, neutralne i przerywane. Może dwa z nich powinny wyglądać tak samo (`niepewny` i `wygaszony` różnią się dziś tylko kolorem obrysu przerywanego — to rozróżnienie prawdopodobnie jest niewidoczne).
2. **Znak stanu ✓ / ~ / —** dobrany na szybko. Znak „—" dla odmowy czyta się jak myślnik interpunkcyjny, nie jak symbol. Potrzebne trzy znaki, które w skali szarości i przy 200% powiększenia są jednoznaczne.
3. **Plakietka „SPRAWDŹ JEDEN WARUNEK".** Wielkie litery czytają się jak ostrzeżenie, choć nic złego się nie stało; „warunek" to słowo z rejestru prawniczego. Do testu z ludźmi mam dwa warianty zapasowe — **„ZAPYTAMY O JEDNO"** i **„ZALEŻY OD JEDNEJ RZECZY"** — ale to jest propozycja redakcyjna, nie projektowa. Potrzebna forma plakietki: wielkość, waga, czy w ogóle wersaliki. Szczegóły w `ROZBIEZNOSCI.md`, wpis 19.

---

## 3. Ekran E1.2: karta, która pyta

Nowość konstrukcyjna 1.2. Karta uprawnienia zadaje **jedno pytanie w miejscu** i przelicza się bez zmiany ekranu.

**Zmierzone.** Karta z pytaniem: **741 px** treści, z czego sam blok pytania **412 px**. Karta po odpowiedzi: **1042 px**.

Karta nigdy nie jest długa i pytająca jednocześnie — dopóki warunek nie jest rozstrzygnięty, widać wyłącznie tytuł, stan i pytanie; uzasadnienie, blok „ile", podstawa prawna i trzy akcje pojawiają się dopiero po odpowiedzi. To była decyzja konstrukcyjna i dzięki niej trzy akcje mieszczą się także przy powiększeniu 150%.

**Zapasu jednak nie ma.** Dołożenie do karty jednego bloku wypycha trzecią akcję poza ekran przy 150% (`ROZBIEZNOSCI.md`, wpis 18).

### Do rozstrzygnięcia

1. **Nagłówek stanu na karcie.** Użyłem komponentu `.werdykt` znanego ze sprawdzacza, ale dla stanu `sprawdz_warunek` nie ma odpowiedniego wariantu — zrobiłem `.werdykt--neutralny` (tło `--karta-druga`, obrys). Czy nierozstrzygnięty stan w ogóle powinien wyglądać jak werdykt, skoro werdyktem jeszcze nie jest?
2. **Blok „Twoja odpowiedź" z odnośnikiem „Zmień odpowiedź"** — 118 px na dole karty. Dziś to karta z tekstem i podkreślonym odnośnikiem. Prawdopodobnie powinien być lżejszy.
3. **Przyciski odpowiedzi na warunek** używają komponentu `.odpowiedz` z kreatora. Kreator zadaje pytanie na pustym ekranie, karta — w środku treści. Ten sam komponent w dwóch tak różnych kontekstach może nie działać.

---

## 4. Grupa E7: pięć ekranów, których kanwa nie zna

Ewidencja czasu pracy to **nowa grupa ekranów** dodana w 1.2. Nie ma jej w kanwie w żadnej postaci. Zbudowałem ją z istniejących komponentów plus trzy nowe rzeczy opisane niżej.

### E7.1 „Mój czas — dziś" — 685 px treści

Wielki przycisk **Zaczynam / Kończę** (72 px, jedyny poza Pomocą, który ma tę wysokość), obok **Przerwa** (start/stop). Po rozpoczęciu dnia pojawia się **licznik na żywo** w bloku `.blok-ile`: liczba 2 rem, tykająca co minutę bez animacji.

Do rozstrzygnięcia:
- **Czy przycisk 72 px poza Pomocą jest w porządku.** Reguła mówi „72 px w Pomocy" — użyłem tej wysokości, bo w rękawicy i w pośpiechu trafia się w ten przycisk, a nie w mniejszy. To jest złamanie reguły albo jej rozszerzenie; potrzebna decyzja.
- **Licznik na żywo** to pierwszy element aplikacji, który zmienia się sam. Zasada mówi „brak animacji przejść". Minuta to nie animacja, ale warto to nazwać.
- **Stan „dzień otwarty"** — dziś plakietka `.znacznik--spokojny` na kaflu w E1.1. Czy to wystarczy, żeby ktoś zauważył, że zapomniał zamknąć dzień.

### E7.3 „Tydzień i miesiąc" — 1048 px, w tym tabela 314 px
### E7.4 „Sygnały" — karta sygnału z lewym obrysem 4 px
### E7.5 „Eksport ewidencji" — podgląd dokumentu A4 w telefonie

Karta sygnału (`.karta--sygnal`) to karta z obrysem bursztynowym i **lewą krawędzią 4 px**. Wzięło się to z niczego — takiego wzorca nie ma nigdzie indziej w aplikacji. Albo go uprawomocnić, albo zastąpić czymś z systemu.

---

## 5. Tabela — pierwszy taki komponent w aplikacji

Do 1.2 aplikacja **nie miała ani jednej tabeli**. Teraz ma dwie: porównanie form zatrudnienia (E2.8) i ewidencja dzień po dniu (E7.3). Obie zaprojektowałem w CSS przy pisaniu kodu.

**Zmierzone.** E2.8: treść 1482 px, sama tabela **891 px wysokości i 460 px szerokości** przy widoku 393 px — przewija się poziomo **w swoim pudełku**, żeby strona nigdy nie przewijała się w bok (WCAG 1.4.10). Pudełko jest osiągalne z klawiatury i ma obrys skupienia — to była realna wada dostępności, którą znalazł test axe.

Klasy: `.tabela-przewijana` (pudełko), `.tabela` (`min-width: 460px`), `.cyfry` (cyfry tabelaryczne, wyrównanie do prawej).

### Do rozstrzygnięcia

1. **Czy tabela na telefonie to w ogóle właściwa forma.** Osiem wierszy po dwie kolumny da się pokazać jako listę par („przerwa 15 min — na zleceniu: nie · na etacie: tak"), bez przewijania w bok. Tabela jest wierna dokumentowi zmiany, lista jest wierna urządzeniu.
2. **Nagłówek tabeli** jest dziś wersalikami 0,8125 rem z odstępem liter. To jedyne wersaliki w aplikacji poza plakietką „SPRAWDŹ JEDEN WARUNEK".
3. **Ewidencja ma pięć kolumn** (data, plan, fakt, przerwy, różnica) — na 393 px to za dużo. Które można złączyć albo schować.

---

## 6. Pola formularza — też pierwsze w aplikacji

E7.2 (wpis ręczny) to pierwszy ekran, na którym użytkownik **coś wpisuje**, a nie wybiera. Pola: data, godzina od, godzina do, lista przerw (dodaj/usuń), uwagi w polu wielolinijkowym.

Klasa `.pole`: wysokość 48 px, obrys 1,5 px `--linia-mocna`, promień `--r-przycisk`, obrys skupienia 3 px w kolorze pewności. Etykieta nad polem, w stylu `.oczko`.

Do rozstrzygnięcia: **stan błędu**. Dziś błędy walidacji pokazują się w osobnym pasie pod formularzem (`.pas--powaga`, patrz niżej), a samo pole nie zmienia wyglądu. Przy czterech polach i trzech przerwach użytkownik nie wie, które pole poprawić.

---

## 7. Złamałem regułę terakoty — proszę o rozstrzygnięcie

Reguła systemu: **powaga (terakota) występuje wyłącznie w module Pomoc.**

Użyłem jej w dwóch miejscach poza Pomocą:

1. **Ostrzeżenie w pakiecie umowy** (E2.3): „Zanim porozmawiasz z pracodawcą, porozmawiaj z kimś, kto zna Twoją sytuację. **Ryzyko, że pracodawca zareaguje źle, jest realne.**" Dokument zmiany wymaga, żeby to zdanie stało **nad akcjami**, nie pod nimi.
2. **Błędy walidacji wpisu czasu pracy** (E7.2).

**Dlaczego tak zrobiłem.** W pierwszym przypadku chodzi o realne ryzyko dla użytkownika ze strony pracodawcy — to jest bliżej powagi z Pomocy niż bursztynowego „to zależy". W drugim po prostu potrzebowałem stanu błędu i nie miałem innego.

**Co proponuję rozstrzygnąć.** Przypadek pierwszy jest merytorycznie uzasadniony i wart osobnego wariantu w systemie („ostrzeżenie o ryzyku ze strony drugiej osoby") — ale wtedy trzeba nazwać, czym różni się od Pomocy. Przypadek drugi to moja wygoda i najpewniej należy mu się własny, cichszy stan błędu formularza.

---

## 8. Pięć nowych ikon do sprawdzenia

Dorysowałem je liniowo w tej samej konwencji co pozostałe (siatka 24, obrys, `aria-hidden`), ale bez oka projektanta:

| nazwa | gdzie | uwaga |
|---|---|---|
| `strzalka_w_kolo` | pasek „Zaktualizuj odpowiedzi" | strzałka w okręgu |
| `start` | „Zaczynam" | trójkąt wypełniony — **jedyna wypełniona ikona w zestawie** |
| `stop` | „Kończę" | kwadrat wypełniony, ta sama uwaga |
| `pauza` | „Przerwa" | dwie kreski |
| `tabela` | „Ten tydzień", „Porównaj" | prostokąt z podziałem |

`start` i `stop` są wypełnione, bo w konwencji odtwarzania tak wyglądają — ale reszta zestawu jest wyłącznie liniowa. Albo je przerysować, albo uprawomocnić wyjątek.

---

## 9. Co dostaniesz ode mnie i czego potrzebuję z powrotem

**Masz w repozytorium:**
- `src/style/globalne.css` — wszystkie tokeny i klasy, z komentarzami wyjaśniającymi decyzje; nagłówek pliku zawiera osiem reguł.
- `ROZBIEZNOSCI.md` — 25 wpisów, w tym 16 (przepełnienie E1.1), 18 (karta z dopytaniem przy 150%), 19 (plakietka) i 25 (nowe komponenty).
- `dokumentacja/ROZBIEZNOSCI_DESIGN.md` — pięć wcześniejszych rozstrzygnięć projektowych, w układzie, który proponuję zachować.
- `docs/` — zbudowana aplikacja; da się ją przeklikać na telefonie i zobaczyć wszystko powyżej na żywo.

**Potrzebuję z powrotem, w tej kolejności ważności:**
1. **Kafel uprawnienia** — wysokość docelowa i zachowanie przy długim konkrecie (punkt 1).
2. **Sześć stanów kafla** — albo sześć, albo mniej, z uzasadnieniem (punkt 2).
3. **Tabela na telefonie** — tabela czy lista par (punkt 5).
4. **Rozstrzygnięcie terakoty** poza Pomocą (punkt 7).
5. Reszta w dowolnej kolejności.

**W jakiej formie.** Najwygodniej: artboardy w kanwie plus krótka notka, co się zmieniło i dlaczego. Jeśli decyzja łamie którąś z ośmiu reguł — wpis w `ROZBIEZNOSCI_DESIGN.md` w istniejącym pięcioczęściowym układzie.

**Czego nie potrzebuję.** Nowej palety, nowego kroju pisma, cieni, animacji przejść i zaokrągleń innych niż 6 / 10 / 14 / 999. To są rozstrzygnięcia z kanwy 1.1 i one działają.

---

*Forum Związków Zawodowych. Prototyp roboczy — treści prawne wymagają autoryzacji specjalistów przed publikacją.*
