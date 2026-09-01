# BHPewnie — prototyp roboczy

Aplikacja BHP Forum Związków Zawodowych. Odpowiadasz na kilkanaście pytań o **warunki** swojej pracy, a aplikacja pokazuje uprawnienia z konkretnymi kwotami, progami i terminami, dostarcza wzorów pism i przypomina o rzeczach we właściwym momencie.

To **prototyp roboczy**, nie produkt. Ma trzy zadania: przeklikać założenia strategii i znaleźć miejsca, gdzie się nie sprawdzają (patrz `ROZBIEZNOSCI.md`), posłużyć do testów z użytkownikami i stać się załącznikiem do zamówienia dla wykonawcy komercyjnego.

**Treści prawne mają charakter roboczy i wymagają autoryzacji specjalistów przed publikacją.** W 86 miejscach stoi znacznik `[do uzupełnienia przez specjalistę]` — to nie jest niedopatrzenie, tylko konsekwencja zasady z briefu: prototyp nie wymyśla podstaw prawnych.

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
npm test             # 34 testy jednostkowe: silnik reguł, parametry, harmonogram
npm run test:e2e     # 48 testów e2e: przebiegi P1–P9, sytuacje brzegowe, dostępność
npm run ekrany       # eksport listy ekranów i porównanie z mapą z briefu
```

Testy e2e uruchamiają podgląd same. Wyniki dostępności zapisują się do `wyniki-axe.json`.

---

## Co jest zrobione

| Etap | Zakres | Stan |
|---|---|---|
| A | Model danych, silnik reguł, parametry z datami, magazyn lokalny, PWA offline | gotowe |
| B | Kreator E0.1–E0.23, Moje stanowisko E1.1–E1.4, generator PDF | gotowe |
| C | Sprawdź E2.1–E2.7, trzy pełne ścieżki sprawdzacza | gotowe |
| D | Pomoc E4.1–E4.13, ścieżka wypadkowa (8 kroków), ekran kryzysowy, dzienniki | gotowe |
| E | Grafik, budziki, silnik harmonogramu na 14 dni, sufit 3/dobę | gotowe |
| F | Aktualności, ustawienia, sprawdzian wiedzy, tryb ciemny, axe bez naruszeń | gotowe |
| G | Testy e2e, eksport ekranów, dokumentacja, rejestr rozbieżności | gotowe |
| H | System wizualny z kanwy projektowej: tokeny, logotyp, osiem reguł nienegocjowalnych | gotowe |

Zaimplementowano **58 ekranów** — wszystkie wymienione w sekcji 5 briefu (tytuł mówi o 48, ale wyliczenia w grupach sumują się do 58; patrz `ROZBIEZNOSCI.md`, wpis 2).

Trzy pełne ścieżki sprawdzacza: **upał → napoje**, **własna odzież → ekwiwalent** (trzy stany), **monitor → przerwa i okulary**. Pozostałe dziesięć pokazuje planszę „w pełnej wersji" — z wyjątkiem „Pracuję w nocy" i „Nie mam kiedy odpocząć", które przy zleceniu dają uczciwy szary werdykt.

---

## Panel redakcyjny: cała treść jest danymi

Zmiana brzmienia pytania, kwoty, podstawy prawnej albo werdyktu **nie wymaga dotykania kodu**. Wszystko leży w katalogu `content/`:

```
content/
  teksty.json                  napisy interfejsu (131 pozycji)
  parametry.json               kwoty i progi z datami obowiązywania
  wymiar-czasu-pracy.json      generowany: node narzedzia/generuj-wymiar.mjs
  kreator.json                 18 pytań kreatora, brzmienia z sekcji 6.1
  cechy/*.json                 16 modułów wiedzy: uprawnienia, warunki, warianty
  sytuacje/*.json              13 sytuacji „Sprawdź" z regułami werdyktów
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
  "grupa": "pieniadze", "ikona": "ksiezyc", "sprawdzacz": "noc"
}
```

- `{nazwa_parametru}` w klamrach podstawia wartość z `parametry.json` razem z jednostką.
- `gdy` to warunek: `wszystkie` (koniunkcja) albo `ktorakolwiek` (alternatywa).
- `warianty` nadpisują treść dla konkretnej umowy albo statusu; `ukryte: true` zdejmuje kafel.
- `grupa` decyduje o kolejności na ekranie głównym, `ikona` o piktogramie.

### Jak dodać sytuację do „Sprawdź"

Plik w `content/sytuacje/` z listą `pytania` i listą `reguly`. Wygrywa **pierwsza pasująca reguła**, więc kolejność ma znaczenie: od najbardziej szczegółowej do najogólniejszej. Reguła bez `gdy` łapie wszystko, co zostało.

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
    grafik.ts            szablony zmian, wzorce rotacji, okno snu po nocce
    harmonogram.ts       14 dni przypomnień, sufit 3/dobę z pierwszeństwem
  magazyn/magazyn.ts     pamięć urządzenia; profil przykładowy w osobnym magazynie
  pdf/dokumenty.ts       generator PDF po stronie klienta + pas oznaczeń
  ekrany/                58 ekranów pogrupowanych wg mapy z briefu
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
| Nic domyślnie włączone | `testy/e2e/p2-p3-p9-budziki.spec.ts` |
| Nigdy nieaktualna liczba jako pewna | `testy/parametry.test.ts` — zasada 9 i B10 |
| Bez grywalizacji | brak punktów i odznak; sprawdzian wiedzy bez zapisu wyniku |
| Metryczka przy każdej treści | pole `metryczka` wymagane w modułach |
| Dostępność WCAG 2.1 AA | `testy/e2e/dostepnosc.spec.ts` — axe, cele 48 px, 200%, klawiatura |

Ostatni przebieg axe: **zero naruszeń** na sześciu kluczowych ekranach (`wyniki-axe.json`).

---

## System wizualny

Warstwa wizualna pochodzi z kanwy projektowej „System BHPewnie" (`dokumentacja/`). Osiem reguł nienegocjowalnych opisanych jest w nagłówku `src/style/globalne.css`.

- **Logotyp** — wariant „Zawias": litera **P** siedzi w kwadratowym polu i należy jednocześnie do skrótu BHP i do słowa „pewnie". Zmiana grubości na wyjściu z pola (700 → 500) pokazuje, gdzie kończy się skrót.
- **Kolor niesie znaczenie, nie dekorację** — sześć rodzin: pewność (zieleń morska), zależy (bursztyn, potomek żółci FZZ), neutralny (odmowa), powaga (terakota, wyłącznie Pomoc), tła, tekst.
- **Czerwień FZZ występuje wyłącznie w blokach nadawcy** — stopka „O aplikacji" i pas oznaczeń w dokumentach A4. Nigdy w interfejsie.
- **Pismo** — IBM Plex Sans, licencja OFL, pliki lokalne w paczce (nie z sieci). Cyfry tabelaryczne.
- **Cieni nie ma** — warstwy rozdziela obrys 1 px i zmiana tła.
- **Brak animacji przejść** — ekran zmienia się natychmiast.

Rozstrzygnięcia projektowe, w których brief kolidował sam ze sobą, opisuje `dokumentacja/ROZBIEZNOSCI_DESIGN.md`.

---

## Czego prototyp nie rozstrzyga

Trzy rzeczy wymagają decyzji zespołu albo testu z ludźmi, nie kolejnej iteracji kodu:

1. **Powiadomienia.** Silnik harmonogramu działa i liczy poprawnie, ale czysta PWA nie wyzwoli budzika przy zamkniętej aplikacji. Potrzebne opakowanie natywne (Capacitor). Szczegóły: `ROZBIEZNOSCI.md`, wpis 6.
2. **Sufit powiadomień.** Przy pełnym grafiku sufit trzech na dobę odrzuca 41% wyliczonych przypomnień, najczęściej przerwy przy monitorze. Trzy warianty rozwiązania: wpis 7.
3. **Autoryzacja treści prawnych.** 86 pozycji czeka na specjalistę; około 20 z nich jest krytycznych przed testami z użytkownikami: wpis 8.

---

*Forum Związków Zawodowych. Prototyp roboczy — treści wymagają autoryzacji specjalistów przed publikacją.*
