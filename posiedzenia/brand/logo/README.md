# Znak Izby

Wektorowy znak Okręgowej Izby Pielęgniarek i Położnych w Słupsku ze stopki strony oipip.slupsk.pl. Kolory znaku to grafit #231f20, czerwień krzyża #ec1c24, szarości #6c6e70 i #57585a oraz biel #fefefe. Czerwieni krzyża nie używaj w interfejsie (kolor marki to #e30513).

## Pliki

| Plik | Do czego |
| --- | --- |
| `znak-oipip-slupsk.svg` | podstawowy plik do stron i aplikacji, kolory wpisane w ścieżki, z tytułem dla czytników ekranu |
| `png/znak-oipip-slupsk-256.png` … `-2048.png` | przezroczyste tło, do dokumentów i programów bez SVG |
| `png/znak-oipip-slupsk-na-bialym-512.png`, `-1024.png` | znak na białym tle z wolnym polem ¼ wysokości (liczba w nazwie to szerokość samego znaku, plik jest większy o pole) |
| `aplikacja/favicon.ico` | ikona karty przeglądarki (16, 32, 48 px) |
| `aplikacja/icon.svg` | ikona karty w SVG (znak na białym kwadracie) |
| `aplikacja/apple-touch-icon.png` | ikona na ekranie iPhone’a (180 px) |
| `aplikacja/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | ikony aplikacji internetowej (PWA), wersja maskowalna z większym marginesem |
| `aplikacja/site.webmanifest` | przykładowy manifest aplikacji z tymi ikonami |

## Zasady

- Znak zawsze na białym tle, także w ciemnym motywie (na białej karcie).
- Nie zmieniaj kolorów, nie odwracaj, nie obrysowuj, nie rozciągaj, nie obracaj i nie dodawaj cieni.
- Nie wycinaj ze znaku samego krzyża. Czerwony krzyż na białym tle przypomina chroniony znak Czerwonego Krzyża.
- Wolne pole wokół znaku co najmniej ¼ jego wysokości. Najmniejsza wysokość na ekranie 32 px. W 16 px (ikona karty) znak traci szczegóły i to jest jedyny wyjątek.
- Nazwę Izby obok znaku składaj w Titillium Web jak w komponencie `oi-nameplate`. W paczce nie ma poziomego logo z nagłówka strony, ten plik trzeba uzyskać od Izby.
