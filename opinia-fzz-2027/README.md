# Opinia FZZ do projektu ustawy budżetowej na rok 2027 — uniwersum treści

Podstrona prezentująca opinię Forum Związków Zawodowych jako przestrzenną,
interaktywną mapę wywodu. **Plik:** [`index.html`](index.html) — kompletna,
samodzielna strona (HTML + CSS + JS), jedyne zależności zewnętrzne to Google
Fonts i three.js r128 z cdnjs. Bez WebGL strona przechodzi automatycznie na
układ płaski; cała treść pozostaje dostępna.

## Skąd bierze się architektura sceny

Scena odwzorowuje strukturę argumentacji opinii, nie dodaje własnych metafor:

| Element sceny | Część opinii | Uzasadnienie w tekście |
|---|---|---|
| **Źródło** (czerwone jądro) | 1. Deficyt strategiczny | „Największym deficytem projektu nie jest deficyt finansowy, lecz deficyt strategiczny. Projekt jest jego ekspozycją.” |
| **Orbita obszarów** | 2–7 | Sześć obszarów, w których deficyt się ujawnia: ryzyka, dochody, konsolidacja, dialog, wydatki, obronność |
| **Emanacja** (zewnętrzna orbita, linie zbiegające z części 1–7) | 8. Wskaźnik 103% | „Wskaźnik 103% jest emanacją wszystkich tych deficytów” |
| **Horyzont** | 9. Konkluzja | Osiem pytań, jedna odpowiedź, trzy oczekiwania |
| **Księżyce** planet | podrozdziały 1.1–8.4 | numeracja i tytuły z opinii |

Każda część ma w panelu tę samą triadę co w opinii: **Ocena → Gdzie w projekcie
→ Skutek dla pracowników**, a także cytat do skopiowania, liczby ze źródłami
i powiązania (linie do innych części odpowiadają odwołaniom w tekście).

## Sekcje pod sceną

- **Kryterium i granice** — wstęp opinii: jedno kryterium, cztery rzeczy, których FZZ nie rozstrzyga.
- **Liczby** — karty obracane (przód: wartość, tył: źródło).
- **Rachunek wskaźnika** — suwak 100–118%, dwie konwencje liczenia przedstawione w części 8.3 (≈790 mln zł i ≈2,6 mld zł za punkt), realny wzrost, dystans do gospodarki narodowej.
- **Próg epok** — oś czasu w trzech pasmach: terminy znane z wyprzedzeniem / decyzje państwa / gotowość partnerów społecznych.
- **Skutki, oczekiwania, materiały, źródła** — z konkluzji i streszczenia.

## Interakcja

Obracanie (przeciąganie), zoom (kółko / uszczypnięcie), klik w planetę lub
etykietę, dok z ikonami dziewięciu części, tryb **Zwiedzaj** (automatyczny
przelot 1 → 9), strzałki ← → i Esc, linki głębokie `#czesc-8`, kopiowanie
cytatów i pakietu cytatów. Respektuje `prefers-reduced-motion`.

## Do podpięcia przed publikacją

Elementy z atrybutem `data-plik` (PDF opinii, streszczenie) pokazują tylko
komunikat — należy wstawić właściwe adresy plików.
