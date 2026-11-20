# Źródła i wymagania

## Hierarchia (ustalona 18.11.2026)

- **Wiążące:** regulaminy i uchwały. Gdy rozwiązanie z nimi koliduje, wygrywa regulamin.
- **Tylko kontekst:** wcześniejsza aplikacja 1.0.0 i rozmowy z ChatGPT. Pokazują dotychczasową praktykę, ale nie są wymaganiami.

## Dokumenty wiążące

1. **Regulamin Okręgowej Rady Pielęgniarek i Położnych w Słupsku**: załącznik do uchwały nr 9 XXXIX OZPiP z 22.03.2025, obowiązuje od 23.03.2025.
2. **Regulamin Okręgowego Zjazdu Pielęgniarek i Położnych w Słupsku**: załącznik do uchwały nr 8 OZPiP z 22.03.2025.
3. **Regulamin wyborów do organów izb oraz tryb odwoływania ich członków**: załącznik do uchwały nr 2 I Nadzwyczajnego KZPiP VIII kadencji z 23.09.2024.
4. **Skład IX kadencji 2024–2028**: uchwała 40/IX/2024 ORPiP z 18.04.2024 (Prezydium) i strona oipip.slupsk.pl (stan z 18.11.2026).

## Decyzje dla nowej aplikacji

- Kolejność etapów: Prezydium, potem Rada, na końcu Zjazd. Kod jest w repozytorium g44.
- Porządek obrad Prezydium jest uproszczony, bez wyboru osób liczących głosy i bez komisji mandatowej. Kworum stwierdza prowadzący na podstawie listy obecności. Podstawa: § 9 ust. 2 stosowany „odpowiednio” (§ 14 ust. 4).
- Tajne głosowanie z rzeczywistą ochroną tajności jest już w etapie 1.
- Głosowanie między posiedzeniami (§ 14 ust. 5) jest w etapie 1: okno czasowe, licznik i wspólny kanał wiadomości.

## Regulamin Rady — postanowienia odwzorowane w aplikacji (Prezydium: § 14 ust. 4)

| § | Treść | Gdzie w aplikacji |
|---|---|---|
| § 6 ust. 3, § 14 ust. 5 | Posiedzenie zdalne: dwustronna komunikacja w czasie rzeczywistym, swobodne wypowiadanie się i głosowanie, bezpieczeństwo, brak dostępu dla nieuprawnionych. Prezydium może tak samo podejmować uchwały między posiedzeniami. | tryb zdalny z odnośnikiem do połączenia, kanał wiadomości, procedura między posiedzeniami, konta indywidualne |
| § 7 ust. 1 | Zawiadomienie co najmniej 7 dni przed posiedzeniem. | data zawiadomienia z ostrzeżeniem i wpisem do protokołu |
| § 7 ust. 2–3 | Przewodniczący komisji rewizyjnej, przewodniczący sądu i rzecznik mają głos doradczy. Goście wyłącznie na zaproszenie. | konta „głos doradczy” i „gość”, zaproszenia, osobna lista obecności |
| § 8 ust. 2 | Kworum: co najmniej połowa członków. | 4 z 7; bez kworum głosowanie się nie otworzy |
| § 8 ust. 3 | Zwykła większość głosów. | przyjęte, gdy „za” > „przeciw” |
| § 8 ust. 9 | W trybie uchwał przyjmuje się rezolucje, oświadczenia (stanowiska), deklaracje i apele. | rodzaje materiałów |
| § 9 ust. 1 | Przewodniczy przewodniczący lub wiceprzewodniczący. | prowadzenie, przekazanie, przejęcie |
| § 11 | Głosowanie jawne; Prezydium może uchwalić tajne albo imienne. System musi zachować charakter głosowania. | wniosek o tryb, ślepe podpisy, wykaz imienny |
| § 12 | Reasumpcja: tylko głosowanie jawne, to samo posiedzenie, jeden raz, pisemny wniosek co najmniej 1/3 uczestniczących. | wnioski z podpisami, głosowanie nad wnioskiem, ponowne głosowanie |
| § 13 | Protokół sporządza się w 21 dni; podpisuje go przewodniczący obrad, sekretarz i protokolant; przyjmuje go następne posiedzenie. | projekt protokołu z miejscami na podpisy |
| § 16 | Przewodniczący wyznacza zastępcę; gdy tego nie zrobi, wyznacza Prezydium. | zastępstwo wyznacza tylko przewodniczący (wersja 3, decyzja D1); wyznaczenie przez Prezydium to zwykła uchwała w protokole (DA-1) |
| § 19 ust. 2 | Udział wyłącznie osobiście. | jedno konto na osobę, bez pełnomocnictw |

## Profil prawny w kodzie (wersja 3, `src/shared/law.ts`)

Wartości z regulaminu nie są ustawieniami. Siedzą w kodzie jako profil prawny organu (poziom 0 kaskady ustawień), z paragrafem przy każdej wartości; zmienia je tylko nowa wersja kodu. Nazwy organów i regulaminów są w danych (`Organ.forms`), żeby wersja próbna mogła mieć nazwy fikcyjne. W wersji 3 działa i jest widoczny tylko profil Prezydium; profile Okręgowej Rady i Okręgowego Zjazdu są w kodzie ukryte (`available: false`, `visible: false`) i przed etapem 2 sprawdzi je ponownie zespół tego etapu.

| Pole profilu | Prezydium (RR przez § 14 ust. 4) | Treść |
|---|---|---|
| `quorum` | § 8 ust. 2 | co najmniej połowa członków (`shareOf(1/2, n)`, dziś 4 z 7); kworum stwierdza osoba prowadząca (zasada K18) |
| `majority` | § 8 ust. 3 | zwykła większość: „za” więcej niż „przeciw” |
| `notice` | § 7 ust. 1 | zawiadomienie co najmniej 7 dni przed posiedzeniem |
| `reasumption` | § 12 ust. 1–5 | gdy wynik budzi uzasadnione wątpliwości, wniosek co najmniej 1/3 biorących udział, raz, tylko jawne, na tym samym posiedzeniu |
| `minutes` | § 13 ust. 1–3, § 17 ust. 2 pkt 1 | protokół w 21 dni, przyjmuje następne posiedzenie, sporządza sekretarz, podpisy z § 13 ust. 1 |
| `convener` | § 14 ust. 3, § 16 ust. 1–2 | zwołuje przewodniczący, a zastępca wyznaczony na to posiedzenie, gdy `deputyMay` (pytanie 6) |
| `chair`, `deputy` | § 9 ust. 1, § 16 ust. 2 | przewodniczy przewodniczący lub wiceprzewodniczący; zastępcę spośród wiceprzewodniczących wyznacza przewodniczący |
| `modes` | § 11 ust. 1–3 | głosowanie jawne; tajność albo imienne uchwala organ; głosowanie elektroniczne dozwolone |
| `remote`, `betweenMeetings` | § 14 ust. 5 zd. 1 i 2 | posiedzenie zdalne i głosowanie między posiedzeniami; kworum głosowania między posiedzeniami z § 14 ust. 5 w zw. z § 8 ust. 2 |
| `agenda.mandatory` | § 9 ust. 2 pkt 1 i 3, 4, 9 | otwarcie ze stwierdzeniem kworum, przyjęcie porządku obrad i zamknięcie są w porządku zawsze (niezmiennik G-6) |
| `agenda.listed` | § 9 ust. 2 pkt 5–8 | przyjęcie protokołu, sprawy bieżące, podjęcie uchwał, informacje bieżące i wolne wnioski; pominięcie tylko z powodem do protokołu (DA-7, pytanie 8) |
| `advisory`, `guests` | § 7 ust. 2–3 | głos doradczy zawiadamiany o każdym posiedzeniu; goście na zaproszenie przewodniczącego albo Prezydium (analogia z § 7 ust. 3) |
| `acts.voted` | § 8 ust. 1, 3 i 9, § 9 ust. 2 pkt 5–6, § 13 ust. 3 | uchwała, stanowisko, oświadczenie, rezolucja, deklaracja, apel, sprawozdanie i protokół zawsze wymagają głosowania (strażnik G-1) |

Zasady przyjęte przez Izbę (`HOUSE_RULES`, poziom 0a): K18 (18.11.2026), F2, F3, F4, F5, F9 (19.11.2026), D1 i D2 (20.11.2026). Zasady aplikacji do czasu odpowiedzi zleceniodawcy (`APP_RULES`, poziom 0b): kanał wiadomości przy obradach na odległość (pytanie 9) i najkrótszy czas głosowania między posiedzeniami 24 godziny, krócej tylko z powodem (pytanie 7). Rekomendacje do pytań 1–9 specyfikacji wersji 3 są w jednym miejscu każda: `role.ts` (pytania 2, 4, 6, 8), `cascade.ts` (pytanie 5, `quorumTotal`), `law.ts` (pytania 6, 7, 9).

## Na kolejne etapy

- **Rada (etap 2):** wybory prezydium według Rozdziałów I i III Regulaminu wyborów:
  - karta z kandydatami w kolejności alfabetycznej;
  - nadmiar wskazań to głos nieważny, brak wskazań to głos ważny;
  - przy remisie wybory uzupełniające tylko między remisującymi;
  - gdy kandydatów jest nie więcej niż miejsc, wybrany jest każdy z jakimkolwiek głosem „za”;
  - komisja skrutacyjna, której członkowie nie kandydują;
  - protokół: uprawnieni, oddane, ważne, nieważne;
  - głosowanie testowe przed elektronicznym.
- **Zjazd (etap 3):**
  - delegaci i mandaty, kworum co najmniej połowy delegatów;
  - prezydium zjazdu i komisje: mandatowa, uchwał i wniosków, skrutacyjna, wyborcza;
  - lista mówców (najwyżej 2 wystąpienia w sprawie);
  - wnioski formalne (14 rodzajów, do 1 minuty);
  - reasumpcja na wniosek co najmniej 1/5 delegatów.
  - Luka w tekście regulaminu: § 5 ust. 3 nie podaje liczby dni na wyznaczenie nowego terminu przy braku kworum.

## Brakujące dokumenty

- Uchwała Rady określająca sprawy, w których Prezydium działa w jej imieniu (§ 14 ust. 1).
- Ramowe regulaminy NIPiP (uchwała nr 4 I NKZPiP z 23.09.2024), na które powołuje się Regulamin Rady.
- Przykładowe porządki obrad i uchwały w DOCX, potrzebne do sprawdzenia podziału plików z wieloma uchwałami.
