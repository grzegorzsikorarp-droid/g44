# Zbudowana aplikacja BHPewnie — do testów

Ten katalog zawiera **gotową, zbudowaną aplikację** (wynik `npm run build` z katalogu `bhpewnie/`).
Nie edytuj tu niczego ręcznie — zmiany wprowadza się w kodzie źródłowym i przebudowuje.

## Jak to uruchomić dla zespołu

W ustawieniach repozytorium: **Settings → Pages → Source: Deploy from a branch**,
gałąź `claude/bhp-worker-demo-app-ra14t3`, katalog `/docs`. Po minucie aplikacja
jest pod adresem, który GitHub tam pokaże.

Na telefonie warto ją dodać do ekranu początkowego („Zainstaluj aplikację" /
„Dodaj do ekranu głównego") — wtedy działa bez internetu i otwiera się jak zwykła aplikacja.

## Jak odświeżyć po zmianach w kodzie

```bash
cd bhpewnie && npm run build && rm -rf ../docs && cp -r dist ../docs
```
