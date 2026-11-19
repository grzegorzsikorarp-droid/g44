# OIPiP w Słupsku. Paczka identyfikacji dla Claude Code

Wersja 1.0.0 (18 listopada 2026 r.). Identyfikacja wizualna Okręgowej Izby Pielęgniarek i Położnych w Słupsku przygotowana do budowania aplikacji. Paczka zawiera tokeny, fonty, znak, komponenty, zasady wizualne i językowe oraz instrukcję dla Claude Code.

## Szybki start

1. Skopiuj ten folder do repozytorium aplikacji jako `brand/`.
2. W pliku `CLAUDE.md` w katalogu głównym repozytorium dopisz linię `@brand/CLAUDE.md`. Claude Code wczyta wtedy zasady identyfikacji w każdej sesji. Jeśli w repozytorium nie ma jeszcze `CLAUDE.md`, utwórz go z tą jedną linią.
3. Podłącz style w aplikacji w tej kolejności.

   ```html
   <link rel="stylesheet" href="/brand/fonts/fonts.css">
   <link rel="stylesheet" href="/brand/tokens/tokens.css">
   <link rel="stylesheet" href="/brand/components/oipip.css">
   ```

   Przy bundlerze (Vite, Next.js) zaimportuj te same trzy pliki w głównym pliku CSS albo w komponencie głównym. Ścieżki podaj względem tego pliku, np. `../brand/...` z `src/index.css`.
4. Na `<body>` (albo na głównym elemencie aplikacji) ustaw klasę `oi-root`. Daje krój Titillium Web, kolor tekstu, tło i `box-sizing: border-box`. Motyw ciemny włącza atrybut `data-theme="ciemny"` na `<html>`.
5. Przy Tailwind CSS 3 dodaj preset w `tailwind.config.js`, a style paczki zaimportuj przed dyrektywami Tailwinda.

   ```js
   // tailwind.config.js
   module.exports = {
     presets: [require('./brand/tokens/tailwind.preset.cjs')],
     content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
   };
   ```

   ```css
   @import "./brand/fonts/fonts.css";
   @import "./brand/tokens/tokens.css";
   @import "./brand/components/oipip.css";
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

   Przy Tailwind CSS 4 wpisz w głównym pliku CSS te linie. Warstwy `base` i `components` sprawiają, że klasy Tailwinda mogą nadpisać style paczki.

   ```css
   @import "tailwindcss";
   @import "./brand/fonts/fonts.css";
   @import "./brand/tokens/tokens.css" layer(base);
   @import "./brand/components/oipip.css" layer(components);
   @import "./brand/tokens/tailwind.theme.css";
   ```

   W obu wersjach klasy mają nazwy tokenów, np. `bg-czerwien`, `text-tekst-drugorzedny`, `p-odstep-6`, `max-w-kolumna`, `shadow-cien-karty`. Preset i motyw zastępują domyślną paletę i cienie Tailwinda paletą Izby (zostają `transparent`, `current` i `inherit`), a każda klasa `rounded-*` daje 0. Wariant `dark:` działa z `data-theme="ciemny"`. Skos to w Tailwind CSS 3 klasa `skew-x-kat-skosu` (tekst w środku `skew-x-kat-odwrotny`), a w Tailwind CSS 4 `-skew-x-13` (tekst `skew-x-13`).
6. Ikony aplikacji skopiuj z `brand/logo/aplikacja/` do katalogu publicznego i dodaj w `<head>` te linie.

   ```html
   <link rel="icon" href="/favicon.ico" sizes="48x48">
   <link rel="icon" href="/icon.svg" type="image/svg+xml">
   <link rel="apple-touch-icon" href="/apple-touch-icon.png">
   <link rel="manifest" href="/site.webmanifest">
   ```

7. Otwórz `brand/podglad.html` w przeglądarce. Strona pokazuje zasady, kolory, krój, znak, grafiki i wszystkie komponenty w motywie jasnym i ciemnym. Ta sama strona jest opublikowana na claude.ai pod adresem <https://claude.ai/artifact/1cpVM7t8WgGbXrqJCaFzzC>. Opis i kod HTML każdego komponentu są w `brand/components/KOMPONENTY.md`.

## Co jest w środku

| Ścieżka | Zawartość |
| --- | --- |
| `CLAUDE.md` | zasady dla Claude Code, do zaimportowania w `CLAUDE.md` projektu |
| `IDENTYFIKACJA.md` | zasady wizualne (kolory, krój, kształty, stany, ikony, znak, grafiki, dostępność) |
| `JEZYK.md` | zasady językowe (nazwy, zawody, typografia, ton, formularze) |
| `podglad.html` | podgląd identyfikacji i komponentów w przeglądarce |
| `tokens/tokens.json` | źródło wszystkich tokenów (format Design System z claude.ai) |
| `tokens/generuj.mjs` | skrypt, który z `tokens.json` tworzy pozostałe pliki w `tokens/` |
| `tokens/tokens.css` | zmienne CSS, motyw jasny w `:root`, ciemny w `[data-theme="ciemny"]`, klasy krojów `oi-t-*` |
| `tokens/tokens.dtcg.json` | te same tokeny w formacie W3C Design Tokens (Style Dictionary, wtyczki Figmy) |
| `tokens/tokens.ts` | wartości dla TypeScript (wykresy, PDF, e-mail, gdzie nie ma CSS) |
| `tokens/tailwind.preset.cjs`, `tokens/tailwind.theme.css` | Tailwind CSS 3 i 4 |
| `fonts/` | Titillium Web 300, 400, 600 i 700 z kursywami, w WOFF2 (strony i aplikacje) i TTF (programy biurowe i graficzne), licencja OFL |
| `logo/` | znak Izby w SVG i PNG, ikony aplikacji, zasady użycia znaku |
| `components/oipip.css` | komponenty interfejsu z przedrostkiem `oi-` |
| `components/KOMPONENTY.md` | opis i kod HTML każdego komponentu |
| `przyklady/` | przyjęte grafiki Izby i przykład grafiki 4:5 zbudowanej w HTML |

## Źródło prawdy

Tokeny zmieniasz tylko w `tokens/tokens.json`. Pozostałe pliki w `tokens/` tworzy na nowo polecenie `node brand/tokens/generuj.mjs` (Node.js 18 lub nowszy, bez dodatkowych pakietów). Ten sam system jest zapisany na claude.ai jako Design System „OIPiP w Słupsku” pod adresem <https://claude.ai/artifact/ARkiPQoQqdxVk5QzVnWbud>.

## Co pochodzi z identyfikacji Izby, a co jest rozszerzeniem

- Z identyfikacji Izby (strona oipip.slupsk.pl i materiały Izby z 2026 r.) pochodzą kolory motywu jasnego, krój Titillium Web, skos 13°, kształty, komponenty, znak i zasady językowe.
- Rozszerzeniem do aplikacji są motyw ciemny, tokeny ról (`akcent-tekst`, `akcent-duzy`, `obrys-pola`, `fokus`, `klin`), komunikat błędu w polu formularza i ikony aplikacji.
- Poza paczką zostały poziome logo z nagłówka strony oipip.slupsk.pl (plik trzeba uzyskać od Izby) oraz identyfikacja konferencji o pielęgniarskiej opiece długoterminowej (zieleń, żółć, Poppins), która dotyczy tylko materiałów tej konferencji.

## Licencje

Opisane w `LICENCJE.md`.
