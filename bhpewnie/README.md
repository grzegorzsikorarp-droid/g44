# BHPewnie — prototyp roboczy

Aplikacja BHP Forum Związków Zawodowych. Odpowiadasz na kilkanaście pytań o **warunki** swojej pracy, a aplikacja pokazuje uprawnienia z konkretnymi kwotami, progami i terminami, dostarcza wzorów pism, notuje Twój czas pracy i przypomina o rzeczach we właściwym momencie.

Stan: **wydanie 1.2** (zmiana merytoryczna z 2 września 2026, wdrożenie warstwy wizualnej z 3 września 2026).

To **prototyp roboczy**, nie produkt. Ma trzy zadania: przeklikać założenia strategii i znaleźć miejsca, gdzie się nie sprawdzają (patrz `ROZBIEZNOSCI.md`), posłużyć do testów z użytkownikami i stać się załącznikiem do zamówienia dla wykonawcy komercyjnego.

**Treści prawne mają charakter roboczy i wymagają autoryzacji specjalistów przed publikacją.** Znaczniki `[do uzupełnienia przez specjalistę]` i `[do potwierdzenia przez specjalistę]` nie są niedopatrzeniem, tylko konsekwencją zasady z briefu: prototyp nie wymyśla podstaw prawnych.

---

## Uruchomienie

```bash
npm install
npm run dev          # tryb pracy, http://localhost:5173
npm run build        # paczka produkcyjna do dist/
npm run preview      # podgląd zbudowanej paczki, port 4173
```

Testy:

```bash
npm test             # 112 testów jednostkowych: reguły, parametry, harmonogram, ewidencja, sprawdzacze
npm run test:e2e     # 95 testów e2e: przebiegi P1–P12, sytuacje brzegowe, reguły designu, dostępność
npm run ekrany       # eksport listy ekranów i porównanie z mapą (66)
```

Testy e2e budują paczkę i uruchamiają podgląd same. Wyniki dostępności zapisują się
do `wyniki-axe.json`. Testy jednostkowe chodzą w strefie `Europe/Warsaw` — bez tego
zmiana czasu urzędowego, która rozstrzyga długość nocki, byłaby niewykrywalna.

---

## Co jest zrobione

| Etap | Zakres | Stan |
|---|---|---|
| A | Model danych, silnik reguł, parametry z datami, magazyn lokalny, PWA offline | gotowe |
| B | Kreator E0.1–E0.23, Moje stanowisko E1.1–E1.4, generator PDF | gotowe |
| C | Sprawdź E2.1–E2.7, trzy pełne ścieżki sprawdzacza | gotowe |
| D | Pomoc E4.1–E4.13, ścieżka wypadkowa (8 kroków), ekran kryzysowy, dzienniki | gotowe |
| E | Grafik, budziki, silnik harmonogramu na 14 dni | gotowe |
| F | Aktualności, ustawienia, sprawdzian wiedzy, tryb ciemny, axe bez naruszeń | gotowe |
| G | Testy e2e, eksport ekranów, dokumentacja, rejestr rozbieżności | gotowe |
| H | System wizualny z kanwy projektowej: tokeny, logotyp, osiem reguł nienegocjowalnych | gotowe |

### Zmiana 1.2 (2 września 2026)

| Etap | Zakres | Stan |
|---|---|---|
| 1.2 A | Zniesienie sufitu powiadomień, budzik monitorowy co godzinę, warunek na kaflu | gotowe |
| 1.2 B | Nazwy zakładek, przebudowa E1.1 i E1.2 (dopytanie w miejscu, trzy akcje) | gotowe |
| 1.2 C | „Mam sprawę": 8 sytuacji, pakiet umowy, porównanie E2.8, wynik pośredni E2.4 | gotowe |
| 1.2 D | Ewidencja czasu pracy — nowa grupa E7 (5 ekranów) | gotowe |
| 1.2 E | Grafik na dwóch poziomach E5.3a/E5.3b, wyzwalacz zmiany rytmu | gotowe |
| 1.2 F | Testy P10–P12, B13, axe na nowych ekranach, rejestr 66 ekranów, rozbieżności 15–24 | gotowe |
| 1.2 G | Cztery pozostałe sytuacje domknięte; opcje pytania budowane z cech profilu | gotowe |
| 1.2 H | Wdrożenie odpowiedzi projektowej: kafel 104 px, cztery stany, listy zamiast tabel | gotowe |

Zaimplementowano **66 ekranów** — dokładnie tyle, ile podaje punkt 8 zmiany 1.2 (`npm run ekrany` porównuje rejestr z mapą i kończy się zerem tylko przy pełnej zgodności).

Wszystkie osiem sytuacji w „Mam sprawę" jest pełnych — żadnej planszy „w pełnej wersji": upał, dźwiganie (obie normy, bez pytania o płeć), środki ochrony, badania okresowe, szkolenie BHP, odpoczynek, zimno i ciasnota, umowa. Warunki, które da się rozstrzygnąć jednym pytaniem, przeniesiono na kafle w zakładce pierwszej — aplikacja nie pyta dwa razy o to samo.

---

## Panel redakcyjny: cała treść jest danymi

Zmiana brzmienia pytania, kwoty, podstawy prawnej albo werdyktu **nie wymaga dotykania kodu**. Wszystko leży w katalogu `content/`:

```
content/
  teksty.json                  napisy interfejsu (140 pozycji)
  parametry.json               kwoty i progi z datami obowiązywania
  wymiar-czasu-pracy.json      generowany: node narzedzia/generuj-wymiar.mjs
  kreator.json                 18 pytań kreatora, brzmienia z sekcji 6.1
  cechy/*.json                 16 modułów wiedzy: uprawnienia, warunki, warianty
  sytuacje/*.json              8 sytuacji „Mam sprawę" z regułami werdyktów
  porownanie-umow.json         tabela E2.8: zlecenie a umowa o pracę
  pomoc/*.json                 5 ścieżek Pomocy z krokami i kartami praw
  biblioteka.json              8 materiałów do czytania z metryczkami
  gdzie-szukac.json            8 instytucji: dla kogo, kiedy, czy anonimowo
  quiz.json                    8 pytań sprawdzianu wiedzy
  aktualnosci-wbudowane.json   5 wpisów dostępnych bez internetu
```

### Jak zmienić kwotę albo próg

W `content/parametry.json` każdy parametr ma daty obowiązywania. Żeby zmienić wartość od nowego roku, **nie nadpisuj starego wiersza** — dopisz nowy:

```json
{ "id": "minimalne_wynagrodzenie", "wartosc": 4806, "jednostka": "zł",
  "obowiazuje_od": "2026-01-01", "obowiazuje_do": "2026-12-31", "zrodlo": "..." },
{ "id": "minimalne_wynagrodzenie", "wartosc": 5020, "jednostka": "zł",
  "obowiazuje_od": "2027-01-01", "obowiazuje_do": null, "zrodlo": "..." }
```

Jeśli parametr wygaśnie bez następcy, aplikacja **nie pokaże starej liczby** — zamiast niej pojawi się „Ta kwota zmienia się od [miesiąc]. Sprawdzamy nową wartość." To zasada nieprzekraczalna nr 9. Można to sprawdzić bez czekania na kalendarz: Ustawienia → Ekran roboczy zespołu → data symulowana.

### Jak zmienić uprawnienie

Moduły w `content/cechy/` mają jednakową budowę:

```json
{
  "id": "dodatek_nocny",
  "tytul": "Dodatek za pracę w nocy",
  "konkret": "{dodatek_nocny_stawka} za każdą godzinę pracy w nocy",
  "wyjasnienie": "...",
  "podstawa": "art. 151⁸ Kodeksu pracy",
  "gdy": { "wszystkie": [ { "cecha": "zmiany", "wartosc_w": ["zmiany_noce"] },
                          { "modyfikator": "umowa", "wartosc_w": ["o_prace"] } ] },
  "warianty": { "zlecenie": { "ukryte": true }, "funkcjonariusz": { "ukryte": true } },
  "grupa": "pieniadze", "ikona": "ksiezyc", "sprawdzacz": "noc",
  "warunek": null
}
```

- `{nazwa_parametru}` w klamrach podstawia wartość z `parametry.json` razem z jednostką.
- `gdy` to warunek: `wszystkie` (koniunkcja) albo `ktorakolwiek` (alternatywa).
- `warianty` nadpisują treść dla konkretnej umowy albo statusu; `ukryte: true` zdejmuje kafel.
- `grupa` decyduje o kolejności na ekranie głównym, `ikona` o piktogramie.
- `warunek` to **jedno** pytanie rozstrzygane na karcie uprawnienia (zmiana 1.2). `null` znaczy „uprawnienie bezwarunkowe, kafel od razu zielony". Każda odpowiedź ma `wynik` (`przysluguje` / `zalezy` / `nie_przysluguje`) i `uzasadnienie`; odpowiedź bursztynowa dostaje `do_sprawdzenia` (najwyżej dwie pozycje), szara — obowiązkowy blok `zamiast`. Jeśli warunek wymaga dwóch pytań, to nie jest kafel, tylko sytuacja z zakładki „Mam sprawę".

### Jak dodać sytuację do „Mam sprawę"

Plik w `content/sytuacje/` z listą `pytania` i listą `reguly`. Wygrywa **pierwsza pasująca reguła**, więc kolejność ma znaczenie: od najbardziej szczegółowej do najogólniejszej. Reguła bez `gdy` łapie wszystko, co zostało.

Test przy każdej nowej sytuacji: „czy aplikacja mogłaby to wiedzieć z kreatora?". Jeśli tak — to nie jest sprawa, tylko kafel z warunkiem.

Pytanie z polem `zrodlo_opcji: "cechy_profilu"` buduje listę odpowiedzi z cech aktywnych na danym stanowisku; etykiety leżą w `etykiety_cech` tej samej sytuacji. Dzięki temu „Nie dostałem środków ochrony" pyta wyłącznie o narażenia, które użytkownika faktycznie dotyczą.

Sytuacja może też mieć `punktacja` (jak pakiet umowy): silnik liczy, ile cech zaszło, i wstawia wynik jako pseudo-odpowiedź `_punkty`, na którą reagują zwykłe reguły. Werdykt może wtedy użyć `{punkty}`, `{cechy_stwierdzone}` i `{cechy_brakujace}`.

---

## Architektura

```
src/
  typy.ts                model danych — 18 cech stanowiska, profil, werdykt, budziki
  dane/wczytaj.ts        wczytywanie treści z content/ do paczki
  silnik/
    parametry.ts         wartość parametru na dany dzień + zasada 9
    reguly.ts            wektor cech → lista uprawnień z wariantami
    sprawdzacz.ts        odpowiedzi → werdykt
    grafik.ts            szablony zmian, wzorce rotacji, stałe godziny, okno snu po nocce
    harmonogram.ts       14 dni przypomnień, bez sufitu (zmiana 1.2)
    ewidencja.ts         czas pracy: wpisy, sygnały art. 132/133/134/131, wyzwalacz rytmu
    dokumenty-uprawnien.ts  pismo i skrypt składane z kafla uprawnienia
  magazyn/magazyn.ts     pamięć urządzenia; profil przykładowy w osobnym magazynie
  pdf/dokumenty.ts       generator PDF po stronie klienta + pas oznaczeń
  ekrany/                66 ekranów pogrupowanych wg mapy (w tym E7 — ewidencja czasu)
  komponenty/            logotyp, znak FZZ, przyciski, kafle, przełączniki
  style/globalne.css     tokeny systemu wizualnego
  rejestr-ekranow.ts     źródło prawdy dla mapy ekranów
```

**Zawód nie istnieje w systemie.** Jednostką wiedzy jest cecha stanowiska. Nie ma tabeli zawodów ani ekranu „wybierz zawód" — profil przykładowy „Barbara" to zestaw cech, który akurat odpowiada pracy w ochronie zdrowia.

---

## Zasady, których kod pilnuje

Testy sprawdzają nie tylko czy aplikacja działa, ale czy nie łamie zasad z briefu:

| Zasada | Gdzie pilnowana |
|---|---|
| Zero danych na zewnątrz | brak backendu; jedyne żądania sieciowe to `prasowka.json` i biblioteka |
| Działa bez internetu | Service Worker precache 1,6 MB; treści w paczce |
| Zawód nie istnieje | brak tabeli zawodów w `content/` i `src/` |
| Kafel bez konkretu nie istnieje | `testy/silnik.test.ts` — „każdy kafel ma niepusty konkret" |
| Trzy stany werdyktu, nigdy czerwony | `testy/e2e/p5-sprawdzacz.spec.ts` — sprawdza wyliczony kolor tła |
| Trzy stałe akcje w tej kolejności | `testy/e2e/p5-sprawdzacz.spec.ts` |
| Nic domyślnie włączone; sufit powiadomień nie istnieje | `testy/e2e/p2-p3-p9-budziki.spec.ts`, `testy/harmonogram.test.ts` |
| Kafel warunkowy pyta o jedną rzecz i pamięta odpowiedź | `testy/silnik.test.ts`, `testy/e2e/p4-p6-stanowisko.spec.ts` |
| Pakiet umowy nigdy nie generuje pisma do pracodawcy | `testy/sprawdzacz.test.ts`, `testy/e2e/p10-umowa.spec.ts` |
| Dźwiganie pokazuje obie normy i nie pyta o płeć | `testy/sprawdzacz.test.ts`, `testy/e2e/p5-sprawdzacz.spec.ts` |
| Ewidencja nigdzie nie wychodzi i nie liczy pieniędzy | brak wywołań sieciowych w `src/silnik/ewidencja.ts` |
| Funkcjonariusz: sygnały kodeksowe wyłączone | `testy/ewidencja.test.ts`, `testy/e2e/p11-p12-ewidencja.spec.ts` |
| Nigdy nieaktualna liczba jako pewna | `testy/parametry.test.ts` — zasada 9 i B10 |
| Bez grywalizacji | brak punktów i odznak; sprawdzian wiedzy bez zapisu wyniku |
| Metryczka przy każdej treści | pole `metryczka` wymagane w modułach |
| Dostępność WCAG 2.1 AA | `testy/e2e/dostepnosc.spec.ts` — axe, cele 48 px, 200%, klawiatura |

Ostatni przebieg axe: **zero naruszeń** na piętnastu ekranach, w tym na wszystkich dodanych w zmianie 1.2 (`wyniki-axe.json`). Jedno realne naruszenie znalazł test i zostało naprawione: przewijana tabela porównania nie była osiągalna z klawiatury.

---

## System wizualny

Warstwa wizualna pochodzi z kanwy projektowej „System BHPewnie" (`dokumentacja/System BHPewnie v2.dc.html`). Osiem reguł nienegocjowalnych opisanych jest w nagłówku `src/style/globalne.css`; **trzy z nich zmieniły brzmienie** w wydaniu design 1.2 — nazywają teraz powód zamiast miejsca (`ROZBIEZNOSCI.md`, wpis 29).

- **Kafel uprawnienia ma stałe 104 px.** Tytuł do dwóch linii, konkret do jednej z obcięciem; pełna treść stoi na karcie. W 1.2 kafel rozjeżdżał się od 127 do 247 px.
- **Ekran główny ma cztery warstwy** — nagłówek stały, pole kafli (jedyny element rozciągliwy), stały pas z dokumentem, nawigacja. Dzięki temu droga do dokumentu nie zależy od tego, ile treści jest wyżej.
- **Cztery stany werdyktu, świeżość na osobnej osi.** Znacznik „Do odświeżenia" staje na każdym stanie i nie podmienia znaku werdyktu.
- **Tabela na telefonie nie występuje** — wchodzi od 600 px i do dokumentów A4. Ewidencja to lista dni, porównanie umów to lista par.
- **72 px** przysługuje czynności wykonywanej w pośpiechu lub w rękawicy — dziś Pomoc i rejestracja czasu pracy.
- **Terakota** należy do ryzyka, które stwarza drugi człowiek — dziś Pomoc i ostrzeżenie w pakiecie umowy. Błąd formularza ma własny, cichszy stan.

- **Logotyp** — wariant „Zawias": litera **P** siedzi w kwadratowym polu i należy jednocześnie do skrótu BHP i do słowa „pewnie". Zmiana grubości na wyjściu z pola (700 → 500) pokazuje, gdzie kończy się skrót.
- **Kolor niesie znaczenie, nie dekorację** — sześć rodzin: pewność (zieleń morska), zależy (bursztyn, potomek żółci FZZ), neutralny (odmowa), powaga (terakota, wyłącznie Pomoc), tła, tekst.
- **Czerwień FZZ występuje wyłącznie w blokach nadawcy** — stopka „O aplikacji" i pas oznaczeń w dokumentach A4. Nigdy w interfejsie.
- **Pismo** — IBM Plex Sans, licencja OFL, pliki lokalne w paczce (nie z sieci). Cyfry tabelaryczne.
- **Cieni nie ma** — warstwy rozdziela obrys 1 px i zmiana tła.
- **Brak animacji przejść** — ekran zmienia się natychmiast.

Rozstrzygnięcia projektowe, w których brief kolidował sam ze sobą, opisuje `dokumentacja/ROZBIEZNOSCI_DESIGN.md` — 19 wpisów w układzie brief / kolizja / decyzja / dlaczego / żeby zdecydować inaczej. Zlecenie, na które odpowiada wydanie design 1.2, to `dokumentacja/ZLECENIE_DESIGN_1_2.md`; odpowiedź projektowa — `dokumentacja/PRZEKAZANIE_DESIGN_1_2.md`.

---

## Czego prototyp nie rozstrzyga

Trzy rzeczy wymagają decyzji zespołu albo testu z ludźmi, nie kolejnej iteracji kodu:

1. **Powiadomienia.** Silnik harmonogramu działa i liczy poprawnie, ale czysta PWA nie wyzwoli budzika przy zamkniętej aplikacji. Potrzebne opakowanie natywne (Capacitor). Szczegóły: `ROZBIEZNOSCI.md`, wpis 6.
2. **Hałas po zniesieniu sufitu.** Sufit zniesiono zgodnie ze zmianą 1.2 — i ta sama miara pokazuje teraz do **13 przypomnień na dobę** przy pełnym grafiku. Dwie drogi wyjścia, żadna nie jest sufitem: wpis 17.
3. **„Nie wiem" w pakiecie umowy.** Sześć odpowiedzi „Nie wiem" daje dziś werdykt szary „nic nie musisz robić" — najbardziej niepewny użytkownik dostaje najbardziej stanowczą odpowiedź: wpis 20.
4. **Zakładki w belce nawigacji.** Makiety projektowe pokazują „Moje · Sprawdź · Mój czas · Pomoc", co cofa nazwy ze zmiany 1.2 i wycina Aktualności z nawigacji. To decyzja produktowa, nie wizualna — nie wdrożono: wpis 30a.
5. **Autoryzacja treści prawnych.** Pozycje ze znacznikiem czekają na specjalistę; około 20 z nich jest krytycznych przed testami z użytkownikami: wpis 8.

---

*Forum Związków Zawodowych. Prototyp roboczy — treści wymagają autoryzacji specjalistów przed publikacją.*
