# Wdrożenie na WordPress (motyw `izba-slupsk`) — krok po kroku

Podstrona: **https://oipip.slupsk.pl/projektnipip-promocja/**
Plik do wklejenia: [`nipip-harmonogram.html`](nipip-harmonogram.html)

Snippet jest **samowystarczalny**: zawiera własny CSS obudowany pod `#nipip-2627`,
wszystkie klasy mają prefiks `nh-` (zero kolizji z motywem), nie używa
JavaScriptu, a font *Titillium Web* bierze z motywu. Wystarczy go wkleić.

---

## Wariant A — edytor blokowy (Gutenberg) · ZALECANY

1. **Kopia zapasowa.** WordPress → *Strony* → najedź na „Projekt NIPiP” →
   wcześniej skopiuj sobie obecną treść (np. zapisz wersję / zrób eksport),
   żeby mieć powrót.
2. Otwórz stronę `/projektnipip-promocja/` do edycji.
3. **Usuń** stare bloki: 3 kursy promocyjne (EKG, Leczenie ran, Żywienie)
   wraz z wklejonym harmonogramem. Pozostałą treść (benefity, nagłówek
   projektu) zostaw.
4. W miejscu, gdzie ma się pojawić nowy harmonogram, dodaj blok
   **„Własny kod HTML”** (Custom HTML): klik `+` → wyszukaj „HTML”.
5. Otwórz `nipip-harmonogram.html`, **zaznacz całość (Ctrl/Cmd+A)**, skopiuj
   i **wklej** do bloku.
6. Kliknij **„Podgląd”** w bloku, potem *Zaktualizuj*. Gotowe.

> Blok „Własny kod HTML” renderuje surowy HTML/CSS dla administratora — `<style>`
> w środku zadziała. Jeśli używacie wtyczki zabezpieczającej, która czyści
> `<style>`, użyjcie Wariantu B.

## Wariant B — Classic Editor / przez wtyczkę kodu (najpewniejszy)

Jeśli macie klasyczny edytor albo wtyczkę bezpieczeństwa filtrującą HTML:

1. Zainstaluj wtyczkę **WPCode** lub **Code Snippets** (darmowe).
2. Dodaj snippet typu **HTML** (lub „Shortcode”), wklej zawartość
   `nipip-harmonogram.html`, nadaj nazwę np. `nipip_harmonogram`.
3. Wtyczka da Ci shortcode (np. `[wpcode id="123"]`). Wklej ten shortcode
   w treści strony tam, gdzie ma być harmonogram.
4. Zapisz stronę.

## Wariant C — bezpośrednio w motywie (dla developera)

Macie custom theme `wp-content/themes/izba-slupsk/`. Można:
- przenieść CSS z `<style>` do `style.css` motywu (już jest pod `#nipip-2627`),
- a HTML osadzić w szablonie strony / przez `the_content`.
To najczystsze utrzymaniowo, ale wymaga dostępu FTP/Git do motywu.

---

## Aktualizacja terminów w przyszłości

Wszystko jest zwykłym tekstem w snippecie. Żeby zmienić datę:
otwórz blok HTML i podmień np. `11.09.2026` na nową datę — układ dostosuje się
sam. Liczby w „liczniku” na górze (`11 kursów`, `13 edycji`) są wpisane na stałe
w sekcji hero — jeśli dodasz/usuniesz kurs, popraw je ręcznie (szukaj
`>11<` i `>13<`).

## Uwagi techniczne

- **Brak kolizji:** każdy selektor zaczyna się od `#nipip-2627`, a klasy mają
  prefiks `nh-`. Style motywu nie wpłyną na harmonogram i odwrotnie.
- **Responsywność:** siatka zwija się do jednej kolumny; reguły `@media` są
  w środku snippetu.
- **Dostępność:** kontrast zgodny z marką, `prefers-reduced-motion`, semantyczne
  sekcje, kotwice nawigacyjne.
- **Plik `index.html`** w katalogu głównym repo to pełna, samodzielna wersja
  demonstracyjna (z nagłówkiem i stopką) — przydatna do podglądu offline,
  NIE do wklejania na WordPress.
