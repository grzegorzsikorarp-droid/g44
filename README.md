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
