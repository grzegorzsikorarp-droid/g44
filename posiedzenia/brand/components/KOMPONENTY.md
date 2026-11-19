# Komponenty OIPiP w Słupsku

Komponenty z `components/oipip.css` (przedrostek `oi-`), wersja 1.0.0. Każdy ma opis i przykład w HTML. Podgląd na żywo jest w `podglad.html`.

## Zanim użyjesz komponentów

- Na `<body>` ustaw klasę `oi-root`, a style podłącz w kolejności `fonts/fonts.css`, `tokens/tokens.css`, `components/oipip.css`.
- Klasy pomocnicze to `oi-wrap` (kolumna treści z marginesem bocznym), `oi-section` i `oi-section--biala` (sekcje szare i białe), `oi-stack` (pionowy stos z odstępem `odstep-4`, z `oi-stack--start` bez rozciągania), `oi-btns` (rząd przycisków i znaczników) i `oi-nowrap` (fragment, który się nie łamie, np. przedział dat).
- W przykładach twarde spacje po jednoliterowych spójnikach i przyimkach są zapisane jako `&nbsp;`.

## Działania

### Przycisk

Skośny, kanciasty przycisk z napisem wersalikami, w trzech odmianach.

- `oi-btn` to działanie główne (zapis, wysłanie wniosku). Na ekranie jedno takie działanie w jednym miejscu.
- `oi-btn oi-btn--obrys` to działanie drugie (pobranie dokumentu, przejście do regulaminu).
- `oi-btn--maly` zmniejsza przycisk w kartach i tabelach. Grupę układa `oi-btns`.
- Napis idzie w `<span>` w środku przycisku, bo tekst musi być odwrotnie pochylony. Ikona (np. kalendarz) stoi w `<span>` przed napisem, nigdy strzałka.
- Wyłączony przycisk dostaje `disabled` albo `aria-disabled="true"` i krótki napis, dlaczego („Zapisy zamknięte”).

```html
<div class="oi-btns">
  <a class="oi-btn" href="#"><span>Zapisz się w&nbsp;SMK</span></a>
  <a class="oi-btn oi-btn--obrys" href="#"><span>Pobierz regulamin</span></a>
  <button class="oi-btn oi-btn--obrys oi-btn--maly" type="button"><span><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>Dodaj do kalendarza</span></button>
  <button class="oi-btn" type="button" disabled><span>Zapisy zamknięte</span></button>
</div>
```

### Przycisk wyboru

Szary przycisk z paskiem 6 px z lewej strony, do wyboru jednej z kilku możliwości.

- `oi-opt` w kolumnie `oi-opts` albo w rzędzie `oi-seg`. Wybrany ma `aria-pressed="true"` (pasek i obwódka w `czerwien`).
- Używaj zamiast zakładek i przełączników, np. kierunek przejścia między Izbami, rok raportu, rodzaj wniosku.
- Napis mówi, co wybierasz, pełnym zdaniem albo nazwą. Bez ikon.

```html
<div class="oi-opts" style="max-width:460px">
  <button class="oi-opt" type="button" aria-pressed="true">Przechodzę z&nbsp;Izby w&nbsp;Słupsku do Izby w&nbsp;Gdańsku</button>
  <button class="oi-opt" type="button" aria-pressed="false">Przechodzę z&nbsp;Izby w&nbsp;Gdańsku do Izby w&nbsp;Słupsku</button>
</div>
<div class="oi-seg" style="max-width:460px;margin-top:16px">
  <button class="oi-opt" type="button" aria-pressed="false">2024</button>
  <button class="oi-opt" type="button" aria-pressed="false">2025</button>
  <button class="oi-opt" type="button" aria-pressed="true">2026</button>
</div>
```

## Etykiety i stany

### Etykieta

Krótkie oznaczenie rodzaju treści albo nazwy pola, zawsze wersalikami.

- `oi-tag` to czerwony skośny pasek z białym napisem nad tytułem („Szkolenie”, „Projekt NIPiP”). `oi-tag--ciemny` oznacza edycję albo wariant („Edycja 1”); w ciemnym motywie odwraca się na biały.
- `oi-label` to czerwona etykieta nad wartością („Miejsce”, a pod nią adres). Bez dwukropka.
- `oi-eyebrow` to szara etykieta ze znaczkiem nad grupą treści („Kursy dokształcające”).
- Napis piszesz normalnie, wersaliki daje CSS.

```html
<div class="oi-stack oi-stack--start">
  <div class="oi-btns"><span class="oi-tag"><span>Szkolenie</span></span><span class="oi-tag oi-tag--ciemny"><span>Edycja 1</span></span></div>
  <div><span class="oi-label">Miejsce</span><span>Uniwersytet Pomorski w&nbsp;Słupsku, ul. Bohaterów Westerplatte 64</span></div>
  <span class="oi-eyebrow"><span class="oi-mark"></span>Kursy dokształcające</span>
</div>
```

### Znacznik stanu

Skośny znacznik etapu („Zapisy w SMK”, „W trakcie”, „Zakończony”) przy kursie, edycji albo sprawie.

- `oi-status--otwarte` (czerwony obrys) oznacza, że można działać, np. „Zapisy w SMK”. Może być linkiem.
- `oi-status--trwa` (wypełnienie w kolorze `tekst-mocny`, czarne w jasnym motywie, białe w ciemnym) oznacza trwający etap.
- `oi-status` bez dopisku (szary obrys) oznacza etap zamknięty.
- Napis zawsze mówi, co znaczy stan. Kolor tylko go wzmacnia.

```html
<div class="oi-btns">
  <a class="oi-status oi-status--otwarte" href="#"><span>Zapisy w&nbsp;SMK</span></a>
  <span class="oi-status oi-status--trwa"><span>W&nbsp;trakcie</span></span>
  <span class="oi-status"><span>Zakończony</span></span>
</div>
```

### Ocena

Ocena w skali z raportu „TAK lub NIE”, do danych i zestawień.

- `oi-ocena--tak`, `oi-ocena--czesciowo`, `oi-ocena--nie`, `oi-ocena--brak` mają kolory `stan-tak`, `stan-czesciowo`, `stan-nie`, `stan-brak`.
- Zawsze ze słowem, które mówi, co znaczy kolor. W legendzie wykresu ta sama kolejność.
- Ocena negatywna jest pomarańczowa, żeby nie mylić jej z czerwienią Izby.

```html
<div class="oi-btns">
  <span class="oi-ocena oi-ocena--tak">TAK na cztery pytania</span>
  <span class="oi-ocena oi-ocena--czesciowo">Odpowiedzi mieszane</span>
  <span class="oi-ocena oi-ocena--nie">Żadnego TAK</span>
  <span class="oi-ocena oi-ocena--brak">Brak odpowiedzi</span>
</div>
```

## Układ

### Nagłówek strony

Biały nagłówek strony z dwoma bladymi skośnymi pasami czerwieni po prawej.

- Kolejno etykieta `oi-tag`, tytuł `h1` (cienka kursywa w `akcent-duzy`, fraza kluczowa w `<b>`) i wprowadzenie `oi-hero__lead`.
- Treść w `oi-wrap oi-hero__in`. Tytuł ma najwyżej 20 znaków szerokości (`20ch`), a tytuł i wprowadzenie zajmują najwyżej 54% szerokości nagłówka, więc nie wchodzą na pasy. Do 760 px pasów nie ma.
- Tytuł jest oficjalny i mówi, czego dotyczy strona. Bez sloganów.

```html
<header class="oi-hero">
  <div class="oi-wrap oi-hero__in">
    <span class="oi-tag"><span>Kształcenie</span></span>
    <h1>Oferta <b>specjalizacji</b> i&nbsp;kursów kwalifikacyjnych</h1>
    <p class="oi-hero__lead">Specjalizacje i&nbsp;kursy kwalifikacyjne Okręgowej Izby Pielęgniarek i&nbsp;Położnych w&nbsp;Słupsku na lata <span class="oi-nowrap">2026–2028</span>.</p>
  </div>
</header>
```

### Nawigacja w treści

Rząd odnośników do sekcji strony, ze skośnymi znaczkami.

- `oi-subnav` z linkami `<a>`, w każdym znaczek `oi-mark`. Bieżąca sekcja ma `aria-current="true"`.
- Nazwy sekcji jak w nagłówkach, krótko. Na telefonie rząd się zawija.

```html
<nav class="oi-subnav" aria-label="Sekcje strony">
  <a href="#" aria-current="true"><span class="oi-mark"></span>Specjalizacje</a>
  <a href="#"><span class="oi-mark"></span>Kursy kwalifikacyjne</a>
  <a href="#"><span class="oi-mark"></span>Kalendarz</a>
  <a href="#"><span class="oi-mark"></span>Kontakt</a>
</nav>
```

### Nagłówek sekcji

Nagłówek sekcji ze skośnym znaczkiem, cienką kursywą i linią 2 px pod spodem.

- `oi-section-head` zawiera `oi-mark`, `h2` i opcjonalnie licznik `oi-count` („3 kursy”).
- Licznik ma poprawną odmianę liczebnika („1 kurs”, „3 kursy”, „5 kursów”).

```html
<div class="oi-section-head"><span class="oi-mark"></span><h2>Kursy dokształcające</h2><span class="oi-count">3 kursy</span></div>
```

### Karta

Biała karta z obrysem `linia`, dla kursu, sprawy, pytania albo dokumentu.

- `oi-card` z tytułem `oi-card__title` (ze znaczkiem), opisem `oi-card__meta` i stopką `oi-card__foot`. Siatkę kart układa `oi-grid`.
- Karta, która prowadzi dalej, ma `oi-card--aktywna`. Po najechaniu dostaje czerwony pasek z lewej strony, cień i czerwony tytuł.
- W stopce stan (`oi-status`) i oś czasu (`oi-timeline`) albo przycisk.

```html
<div class="oi-grid" style="max-width:420px">
  <a class="oi-card oi-card--aktywna" href="#">
    <h3 class="oi-card__title"><span class="oi-mark"></span>Aspekty opieki pielęgniarskiej nad pacjentem ze stomią, w&nbsp;tym zapobieganie powikłaniom</h3>
    <span class="oi-card__meta">dla pielęgniarek i&nbsp;pielęgniarzy, Słupsk</span>
    <div class="oi-card__foot">
      <span class="oi-status oi-status--otwarte"><span>Zapisy w&nbsp;SMK</span></span>
      <div class="oi-timeline">
        <div class="oi-timeline__pt"><span class="oi-timeline__lbl">Rozpoczęcie</span><span class="oi-timeline__date">26.02.2027</span></div>
        <div class="oi-timeline__line"><span class="oi-timeline__dur">2 dni</span></div>
        <div class="oi-timeline__pt oi-timeline__pt--koniec"><span class="oi-timeline__lbl">Zakończenie</span><span class="oi-timeline__date">27.02.2027</span></div>
      </div>
    </div>
  </a>
</div>
```

### Kafelki z liczbami

Rząd kafelków z dużą liczbą i podpisem, na górze strony albo sekcji.

- `oi-stats` z elementami `oi-stat`, w każdym `<b>` z liczbą i `<span>` z podpisem wersalikami.
- Tylko liczby, które mają źródło. Podpis z poprawną odmianą („5 kursów”, „6 edycji”).

```html
<div class="oi-stats" style="max-width:520px">
  <div class="oi-stat"><b>5</b><span>kursów</span></div>
  <div class="oi-stat"><b>6</b><span>edycji</span></div>
  <div class="oi-stat"><b>2</b><span>typy kursów</span></div>
</div>
```

### Kroki

Ponumerowane kroki procedury, w kolejności, w jakiej się je wykonuje.

- `oi-steps` jako lista `<ol>`, każdy krok `oi-step` z numerem `oi-step__no`, tytułem `h3` i opisem.
- Tylko dla prawdziwej kolejności czynności. Bez strzałek między krokami.

```html
<ol class="oi-steps">
  <li class="oi-step"><span class="oi-step__no"><span>1</span></span><h3>Zaświadczenie</h3><p>Poproś Izbę, do której należałaś lub należałeś, o&nbsp;zaświadczenie o&nbsp;okresach opłacania składek.</p></li>
  <li class="oi-step"><span class="oi-step__no"><span>2</span></span><h3>Wniosek</h3><p>Złóż wniosek o&nbsp;zapomogę albo dofinansowanie kształcenia w&nbsp;swojej obecnej Izbie i&nbsp;dołącz zaświadczenie.</p></li>
  <li class="oi-step"><span class="oi-step__no"><span>3</span></span><h3>Decyzja</h3><p>Wniosek rozpatruje Izba, do której należysz, według swojego regulaminu.</p></li>
</ol>
```

## Dane

### Oś czasu

Początek i koniec okresu ze skośnymi znacznikami i czasem trwania pośrodku.

- `oi-timeline` z dwoma punktami `oi-timeline__pt` (drugi z `--koniec`) i linią `oi-timeline__line`, w niej `oi-timeline__dur`.
- Daty w formacie „19.11.2026”, czas trwania słowem („2 dni”, „ok. 17 mies.”).
- Gdy brakuje miejsca, data końca przechodzi do następnego wiersza.

```html
<div class="oi-timeline" style="max-width:420px">
  <div class="oi-timeline__pt"><span class="oi-timeline__lbl">Rozpoczęcie</span><span class="oi-timeline__date">19.11.2026</span></div>
  <div class="oi-timeline__line"><span class="oi-timeline__dur">ok. 17 mies.</span></div>
  <div class="oi-timeline__pt oi-timeline__pt--koniec"><span class="oi-timeline__lbl">Zakończenie</span><span class="oi-timeline__date">28.04.2028</span></div>
</div>
```

### Pasek postępu

Cienki pasek postępu trwającego etapu z podpisem.

- `oi-progress` z torem `oi-progress__bar`, wypełnieniem `<i style="width:…">` i podpisem `oi-progress__txt`.
- Dodaj `role="progressbar"` z `aria-valuenow`, `aria-valuemin` i `aria-valuemax`.

```html
<div class="oi-progress" role="progressbar" aria-valuenow="47" aria-valuemin="0" aria-valuemax="100" aria-label="Postęp kursu" style="max-width:420px">
  <span class="oi-progress__bar"><i style="width:47%"></i></span><span class="oi-progress__txt">Trwa, 47%</span>
</div>
```

### Tabela

Tabela z kontrastowym nagłówkiem wersalikami (czarnym w jasnym motywie, białym w ciemnym) i jasnymi podziałami wierszy.

- `oi-table` w `oi-table-wrap` (przewijanie w poziomie na telefonie). Nagłówki wierszy jako `<th scope="row">`.
- `oi-table--porownanie` wyróżnia ostatnią kolumnę czerwienią (np. „po zmianie”).
- Liczby w komórce `oi-liczba`, wyrównane do prawej. Przedziały dat w komórce z `oi-nowrap`, żeby się nie łamały.

```html
<div class="oi-table-wrap"><table class="oi-table">
  <thead><tr><th scope="col">Termin</th><th scope="col">Kurs dokształcający</th><th scope="col">Miejsce</th></tr></thead>
  <tbody>
    <tr><td class="oi-nowrap">04–05.12.2026</td><th scope="row">Sztuczna inteligencja (AI) w&nbsp;pracy pielęgniarki, pielęgniarza, położnej, położnego</th><td>Słupsk</td></tr>
    <tr><td class="oi-nowrap">21–22.01.2027</td><th scope="row">Trudne rozmowy z&nbsp;pacjentem i&nbsp;rodziną</th><td>Słupsk</td></tr>
    <tr><td class="oi-nowrap">26–27.02.2027</td><th scope="row">Aspekty opieki pielęgniarskiej nad pacjentem ze stomią</th><td>Słupsk</td></tr>
  </tbody>
</table></div>
```

### Źródło

Podpis źródła pod wykresem, tabelą albo liczbą.

- `oi-source` z etykietą `oi-source__lbl` („Źródło”) w osobnym wierszu, bez dwukropka.
- Pełna nazwa aktu albo dokumentu i data stanu. Przy kilku źródłach lista numerowana.

```html
<p class="oi-source"><span class="oi-source__lbl">Źródło</span>Harmonogram kursów w&nbsp;projekcie Naczelnej Izby Pielęgniarek i&nbsp;Położnych „Wsparcie kształcenia pielęgniarek, pielęgniarzy i&nbsp;położnych w&nbsp;Polsce”, stan na 11 listopada 2026 r.</p>
```

## Formularze

### Pole formularza

Pole tekstowe z etykietą wersalikami, obrysem 2 px i podpowiedzią.

- `oi-field` zawiera `<label class="oi-field__label">`, pole `oi-input` (`input`, `select` albo `textarea`) i opcjonalnie `oi-field__hint`.
- Błąd oznacza `oi-field--blad` na całym polu i `aria-invalid="true"` na polu, a komunikat `oi-field__error` łączy się z polem przez `aria-describedby`.
- Etykieta nazywa dane pełną nazwą („Numer prawa wykonywania zawodu”). Formularz Izby odwzoruj 1:1 z dokumentem.

```html
<form class="oi-stack" style="max-width:420px" onsubmit="return false">
  <div class="oi-field"><label class="oi-field__label" for="f-imie">Imię i&nbsp;nazwisko</label><input class="oi-input" id="f-imie" value="Anna Kowalska"></div>
  <div class="oi-field oi-field--blad"><label class="oi-field__label" for="f-pwz">Numer prawa wykonywania zawodu</label><input class="oi-input" id="f-pwz" aria-invalid="true" aria-describedby="f-pwz-e"><span class="oi-field__error" id="f-pwz-e">Wpisz numer prawa wykonywania zawodu.</span></div>
  <div class="oi-field"><label class="oi-field__label" for="f-izba">Izba</label><select class="oi-input" id="f-izba"><option>Okręgowa Izba Pielęgniarek i&nbsp;Położnych w&nbsp;Słupsku</option><option>Okręgowa Izba Pielęgniarek i&nbsp;Położnych w&nbsp;Gdańsku</option></select><span class="oi-field__hint">Izba, do której należysz.</span></div>
</form>
```

### Pole wyboru

Skośne pole wyboru z ptaszkiem po zaznaczeniu.

- `<label class="oi-check">` zawiera ukryte `<input type="checkbox">`, pole `oi-check__box` z ikoną ptaszka i opis w `<span>`.
- Ptaszek występuje tylko tutaj. Opis jest pełnym zdaniem, które mówi, na co się zgadzasz.

```html
<div class="oi-stack" style="max-width:460px">
  <label class="oi-check"><input type="checkbox" checked><span class="oi-check__box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span><span>Wyrażam zgodę na przetwarzanie moich danych osobowych w&nbsp;celu zapisu na szkolenie.</span></label>
  <label class="oi-check"><input type="checkbox"><span class="oi-check__box"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></span><span>Chcę dostawać informacje o&nbsp;kolejnych szkoleniach.</span></label>
</div>
```

## Treść

### Uwaga

Wyróżniony akapit z paskiem 6 px z lewej strony.

- `oi-note` (pasek w `czerwien`) dla informacji, od której zależy, co czytelnik zrobi.
- `oi-note--wazne` (pasek w `tekst-mocny`) z etykietą `oi-label` („Ważne”) dla zastrzeżeń i warunków.
- Jedna uwaga na sekcję. Bez ikon ostrzegawczych.

```html
<div class="oi-stack" style="max-width:520px">
  <div class="oi-note"><p>Udział jest bezpłatny dla członków Okręgowych Izb Pielęgniarek i&nbsp;Położnych w&nbsp;Słupsku i&nbsp;w&nbsp;Gdańsku.</p></div>
  <div class="oi-note oi-note--wazne"><span class="oi-label">Ważne</span><p>Uznanie okresów składkowych nie daje świadczenia automatycznie.</p></div>
</div>
```

### Pytania

Rozwijane pytania i odpowiedzi na elementach `details` i `summary`.

- `oi-faq` z elementami `details`, w `summary` pytanie i znacznik `oi-faq__pm`, odpowiedź w `oi-faq__a`.
- Otwarte pytanie ma pasek 6 px w `czerwien`. Każde pytanie kończy się pytajnikiem.

```html
<div class="oi-faq" style="max-width:560px">
  <details open><summary>Czy uznanie okresów składkowych daje mi świadczenie automatycznie?<span class="oi-faq__pm" aria-hidden="true"></span></summary><div class="oi-faq__a"><p>Nie. Wniosek rozpatruje Izba, do której należysz, według swojego regulaminu.</p></div></details>
  <details><summary>Jak długo obowiązuje porozumienie?<span class="oi-faq__pm" aria-hidden="true"></span></summary><div class="oi-faq__a"><p>Na czas nieokreślony, z&nbsp;trzymiesięcznym okresem wypowiedzenia na koniec miesiąca.</p></div></details>
</div>
```

## Marka

### Wizytówka

Znak Izby z nazwą złożoną w Titillium Web, zawsze na białym tle.

- `oi-nameplate` zawiera obraz znaku i `oi-nameplate__name` („Okręgowa Izba Pielęgniarek i Położnych” cienką kursywą, „w Słupsku” w `<b>` pogrubioną odmianą prostą).
- Tło zostaje białe także w ciemnym motywie. Wolne pole wokół znaku ma co najmniej ¼ jego wysokości (18 px przy znaku 72 px). Do 360 px znak ma 56 px.
- To nie jest oficjalne logo poziome Izby, tylko przyjęte zestawienie znaku z nazwą.

```html
<div class="oi-nameplate"><img src="/brand/logo/znak-oipip-slupsk.svg" alt="Znak Okręgowej Izby Pielęgniarek i Położnych w Słupsku"><p class="oi-nameplate__name">Okręgowa Izba<br>Pielęgniarek i&nbsp;Położnych <b>w&nbsp;Słupsku</b></p></div>
```

### Panele skośne

Dwa skośne panele spięte belką z hasłem (czarną w jasnym motywie, białą w ciemnym), do pokazania relacji dwóch stron.

- `oi-kv` z dwoma panelami `oi-kv__pan` (czerwony to Izba w Słupsku, `oi-kv__pan--grafit` to druga strona) i belką `oi-kv__seal`.
- Nazwa w panelu cienką kursywą z pogrubionym miastem, nie wersalikami. Bez strzałek.
- Panele mają `role="img"` i `aria-label` z pełnym zdaniem o relacji. Do 360 px stoją jeden pod drugim.

```html
<div class="oi-kv" role="img" aria-label="Okręgowa Izba Pielęgniarek i Położnych w Słupsku i Okręgowa Izba Pielęgniarek i Położnych w Gdańsku wzajemnie uznają staż składkowy swoich członków.">
  <div class="oi-kv__pan"><p class="oi-kv__name">Okręgowa Izba Pielęgniarek i&nbsp;Położnych <b>w&nbsp;Słupsku</b></p></div>
  <div class="oi-kv__pan oi-kv__pan--grafit"><p class="oi-kv__name">Okręgowa Izba Pielęgniarek i&nbsp;Położnych <b>w&nbsp;Gdańsku</b></p></div>
  <div class="oi-kv__seal"><span>Staż składkowy uznawany wzajemnie</span></div>
</div>
```
