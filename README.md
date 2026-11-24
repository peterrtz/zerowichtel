# ZeroWichtel

Wichteln und Schrottwichteln ohne Konto – als PWA, Ende-zu-Ende-verschlüsselt, mit einem kleinen Node.js-Server ohne npm-Abhängigkeiten.

- Keine Konten, keine Passwörter, keine Cookies, kein Tracking, keine externen Ressourcen.
- Der Server speichert nur Chiffretext. Schlüssel stehen ausschließlich im URL-Fragment (`#…`).
- Die Ziehung läuft im Browser der Organisator:in; jede Zuordnung wird sofort für die jeweilige Person versiegelt.
- Jede Runde wird spätestens 14 Tage nach dem Wichteldatum endgültig gelöscht.

Version 2.14.0 · Lizenz: [EUPL-1.2](LICENSE)

Weitere Dokumente: [Installation (Docker + Caddy)](docs/INSTALL-DOCKER-CADDY.md) · [Ohne Docker](docs/INSTALL-OHNE-DOCKER.md) · [Server-Aufbau und API](docs/SERVER.md) · [Sicherheit](docs/SECURITY.md) · [Verarbeitungsverzeichnis und TOM (Entwurf)](docs/DATENSCHUTZ-VVT.md) · [Änderungen](CHANGELOG.md)

> **Ab 2.0 läuft der Server mit Node.js statt PHP.** App, API, Datenbank und alle Links bleiben gleich; ein Update von 1.x übernimmt Konfiguration und Daten automatisch (siehe [Installation](docs/INSTALL-DOCKER-CADDY.md#update-von-1x-auf-20)). Wer ZeroWichtel auf klassischem PHP-Webhosting betreibt, findet die PHP-Fassung unter dem Tag `v1.2.1`; sie wird nicht weiterentwickelt.

## Stand

| Meilenstein | Inhalt | Status |
| --- | --- | --- |
| 1 | Runde anlegen, Admin-Link, Einladen per Teilen-Menü, Einlösen, Umfrage, Wiederherstellungscode, Löschung | fertig |
| 2 | Untergruppen, Ausschlüsse, Ziehung (Kreis), Wunschlisten, anonyme Rückfragen, Neuziehung | fertig |
| 3 | Schrottwichteln: Regelbaukasten mit Vorlagen, Spielansicht, Timer, Päckchenzähler, App-Würfel, freies Würfeln ohne Runde | fertig |
| 4 | E-Mail-Modus über SMTP (z. B. mailbox.org) oder Brevo: Einladung, eigener Link, Admin-Link, Erinnerungen, Hinweis nach Ziehung, Tageshinweis Wichtelpost | fertig |
| 5 | Härtung (Fuzzing, feindliche Inhalte), Datenschutzerklärung/Impressum/VVT-Entwurf, Release mit Prüfsummen und SRI | fertig |
| 2.0 | Server in Node.js (ohne npm-Pakete), gleiche API, Datenübernahme in beide Richtungen geprüft | fertig |
| 2.3 | Gruppenlink (optional), Checkliste, „Was jetzt?“, Zeitleiste, Einladungskarten, Steckbrief, Tracking-Bereinigung, Päckchen, Rätselhinweise, Raten/Auflösen/Danke, Countdown/Schnee, Ideen-Würfel, Probelauf, englische Oberfläche | fertig |
| 2.5 | Team-Wichteln: Teams beschenken Teams, Teamwahl durch Teilnehmende, gemeinsamer Team-Wunschzettel; Update- und Rückweg-Test gegen 2.4.0-Daten; Sicherheitsreview R2 | fertig |
| 2.14.0 | Nachricht der Organisator:in an alle (Ende-zu-Ende-verschlüsselt, optional mit den eigenen offenen Aufgaben jeder Person, Hinweis-Mail ohne Inhalt); Wichtelpost mit offenen Fragen oben, Zahl im Sprungmenü und „neu“-Markierung; anonyme Rückfragen samt Antwort auf allen eigenen Geräten; Zugang gilt als gesichert, wenn der Link von außen geöffnet oder der Code eingelöst wurde | fertig |
| 2.13.2 | „Auf weiterem Gerät öffnen“ (QR-Code mit dem persönlichen Link, beide Geräte bleiben angemeldet); veralteter Zugang wird erklärt statt „Nicht gefunden“ | fertig |
| 2.13.1 | Fotos vor dem Hochladen zuschneiden (frei oder 1:1, 4:3, 3:4, 16:9, Original); schwebendes Sprungmenü rechts mit Zahl für neue Fotos | fertig |
| 2.13 | Adventsalbum: Fotos der Vorweihnachtszeit nur für die Runde (verkleinert, ohne Metadaten, Ende-zu-Ende-verschlüsselt) und PDF-Erinnerungsalbum mit 5 Layouts, 5 Designs, Hoch-/Querformat und Titelblatt | fertig |
| 2.12 | Geschenkvorschläge im Admin-Bereich pflegbar (ergänzen/ersetzen, Export/Import); Fußzeile in zwei Zeilen mit Design-Auswahl und Quellcode-Link; Unterstützungslink des Betreibers (Admin-Bereich oder `zw donation`): Fußzeile und Startseite, optional auch in den Runden, nur https, ohne Referrer, Warnung bei Tracking-Angaben | fertig |
| 2.11 | Wichtel-Mixtape der Runde: 1–3 Lieblings-Weihnachtslieder je Person, gemischt und ohne Namen, Such-Knöpfe zu fünf Musikdiensten, ab der Bescherung aufdecken | fertig |
| 2.10.1 | Wünsche vor der Frist festlegen (24 h Korrektur, danach nur mit Freigabe der Organisator:in; der Wichtel sieht es) | fertig |
| 2.10 | Optionale Adresse der Organisator:in für Hinweise auf neue Rückfragen (höchstens einmal am Tag, ohne Inhalt) | fertig |
| 2.9 | Rückfragen an die Organisator:in (mit Antwort, freigegeben beim Anlegen; auf Wunsch auch anonym) | fertig |
| 2.8 | Eigener Haken „Geschenk besorgen & verpacken“ in der Zeitleiste (Schrottwichteln: „Geschenk finden & verpacken“) | fertig |
| 2.7 | Analoge Wichtelrunde zum Ausdrucken: Namen eintragen, verdeckte Lose oder Hut-Zettel, Spielregeln, Karten in drei Designs; Daten nur im Browser, auf dem Server nur ein Zähler | fertig |
| 2.6 | Ohne Smartphone mitwichteln: Helfer:in hält den Link einer Person, Grenze ⌊(n − 2) / 3⌋ (Herleitung in [docs/KONZEPT-ANALOG.md](docs/KONZEPT-ANALOG.md)) | fertig |
| 2.4 | Anlegen ohne Organisator-Code mit Obergrenze gleichzeitiger Runden (Admin-Bereich, `zw open`), Wiederherstellungscode als Bild (speichern, hochladen, QR aus Bildschirmfoto), `zw backup` | fertig |

## Entscheidungen

```yaml
projekt: zerowichtel
lizenz: EUPL-1.2
datenschutz: zero-knowledge          # Schlüssel nur im URL-Fragment
krypto:
  symmetrisch: AES-256-GCM            # jede Verschlüsselung per AAD an Zweck/Runde/Person gebunden
  asymmetrisch: X25519 + HKDF-SHA-256 # deterministisch aus dem Personen-Geheimnis abgeleitet
  bibliotheken: keine                 # Browser: nur WebCrypto; Server: nur node:crypto
server:
  laufzeit: node.js >= 24.7          # node:sqlite, crypto.argon2, chacha20-poly1305 eingebaut
  npm_pakete_im_betrieb: keine        # npm nur für Testwerkzeuge
  datenbank: sqlite (WAL, secure_delete)
  cron: keiner                        # Löschung und Erinnerungen laufen im Server
zugang: [anonym, e-mail]             # E-Mail optional, pro Runde
mail:
  transport: smtp                    # alternativ brevo; nur Text, kein HTML, kein Tracking-Pixel
  adressen: K_server                 # XChaCha20-Poly1305; Modus aus = Adressen sofort gelöscht
  inhalte: keine                     # keine Namen, Wünsche, Zuordnungen; optional Betreff-Titel
ziehung: kreis                       # Rückfall auf freie Zuordnung, wenn kein Kreis möglich
wuensche: markdown-light             # fett, kursiv, unterstrichen, Listen; Links nur https; kein HTML
schrottwichteln:
  vorlagen: [klassisch, tauschen, rasant, eigene]
  wuerfel: 1 oder 2 (Summe)            # Zufall aus WebCrypto
  spiel: lokal auf einem Geraet         # kein Serverkontakt, Stand nur im Tab (sessionStorage)
gruppenlink: optional                # Selbst-Eintragen; Ablauf + Höchstzahl, nur Hash auf dem Server
raetselhinweise: {max: 5, freischaltung: serverseitig}   # vor dem Termin liefert der Server den Chiffretext nicht aus
wichtelpost_nach_termin: 7 tage      # raten, auflösen, danken
sprachen: [de, en]                   # Oberfläche; Mails in der Sprache der Runde; Rechtstexte nur deutsch
wiederherstellung: code_32_zeichen + neuziehung
loeschung: wichteldatum + 14 tage | sofort per button
max_teilnehmende: 50
organisator_codes: {runden: 3, gueltig_tage: 60}
admin_bereich:                       # standardmäßig aus
  zweck: Organisator-Codes verwalten (keine Betreiber- oder Mail-Einstellungen)
  zugang: masterpasswort_argon2id + totp | notfallcode
  erreichbar: oeffentlich unter geheimem pfad
  einrichtung: nur konsole (zw admin setup)
```

## Installation

Das Installationspaket `zerowichtel-<version>.zip` steht auf der [Release-Seite](https://github.com/peterrtz/zerowichtel/releases) samt SHA-256-Prüfsumme. Wer aus dem Quelltext baut, erzeugt es mit `npm ci && npm run release` (liegt dann in `dist/`; die Prüfsumme eines selbst gebauten Pakets weicht von der des veröffentlichten ab).

| Server | Anleitung |
| --- | --- |
| Caddy läuft in Docker Compose | [docs/INSTALL-DOCKER-CADDY.md](docs/INSTALL-DOCKER-CADDY.md) – eigener Container, Caddy als Reverse Proxy, Update von 1.x inklusive |
| Node.js direkt auf dem Server (systemd, beliebiger Reverse Proxy) | [docs/INSTALL-OHNE-DOCKER.md](docs/INSTALL-OHNE-DOCKER.md) |

### Voraussetzungen und Grenzen

```yaml
laufzeit: Node.js >= 24.7 oder Docker mit Compose-Plugin   # keine npm-Pakete zur Laufzeit
https: zwingend, über einen Reverse Proxy davor (Caddy oder nginx)
installationsskript:
  deckt_ab: Caddy läuft bereits in Docker Compose
  sonst: Weg ohne Docker (systemd) oder selbst anpassen
  feste_namen: {container: zerowichtel, netz: zerowichtel-proxy}   # eine Installation je Server
zeitzone: Europe/Berlin                 # fest im Dockerfile und in der systemd-Unit; dort bei Bedarf ändern
sprache:
  oberflaeche: [de, en]
  anleitungen_und_skriptmeldungen: de
  rechtstexte: de                       # Entwurf nach deutschem Recht; vor öffentlichem Betrieb selbst prüfen (lassen)
betreiberangaben: leer nach der Installation – in config.json eintragen (operator, hoster, privacy)
getestet:
  automatisch: Docker-Weg (Erstinstallation, Update, Rückfall), API, Oberfläche
  nicht_automatisch: systemd-Dienst des Wegs ohne Docker (Unit mit systemd-analyze geprüft, Startbefehl von Hand getestet)
```

Kommandozeile (im Container mit `sudo docker exec -it zerowichtel zw …`):

```sh
zw check                                                  # Konfiguration und Datenbank prüfen
zw codes create --label "Familie M." --rounds 3 --days 60  # Organisator-Code
zw codes list
zw codes revoke ZW-XXXX-XXXX-XXXX-XXXX
zw admin setup                                            # Admin-Bereich: Passwort, Authenticator, Notfallcodes
zw admin status                                           # weitere: password, totp, recovery, new-url, logout-all, unlock, remove
zw cleanup                                                # sofort aufräumen und fällige Mails verschicken
```

Konfiguration: `config.json` (Vorlage mit Erklärungen: [config.example.json](config.example.json)). Zeilen mit `//` sind Kommentare. Der laufende Server übernimmt Änderungen innerhalb einer Minute; ungültiges JSON wird abgelehnt und die bisherige Konfiguration bleibt aktiv (Meldung im Log).

E-Mail-Modus (optional) – Beispiel mailbox.org:

```json
"mail": {
  "transport": "smtp",
  "from_email": "no-reply@wichteln.example.org",
  "from_name": "ZeroWichtel",
  "smtp": { "host": "smtp.mailbox.org", "port": 465, "user": "…", "pass": "…", "secure": "ssl" }
}
```

Mit Brevo statt SMTP: `"transport": "brevo"`, `"brevo_api_key": "xkeysib-…"`. Im Brevo-Konto **vorher** einstellen: E-Mail-Vorschauen nicht speichern, Log-Aufbewahrung auf das Minimum, Klick- und Öffnungs-Tracking aus; Absenderdomain mit SPF, DKIM und DMARC verifizieren; AV-Vertrag abschließen.

Betreiberangaben für Impressum und Datenschutzerklärung stehen unter `operator`, `hoster` und `privacy`. Die Texte in der App sind ein Entwurf und vor der öffentlichen Freigabe rechtlich zu prüfen; offene Punkte stehen in [docs/DATENSCHUTZ-VVT.md](docs/DATENSCHUTZ-VVT.md).

## Release und Prüfung einer Installation

```sh
npm run release        # prüft SW-Liste, setzt SRI im Paket, dist/RELEASE.json, dist/zerowichtel-<version>.zip
npm run verify -- https://wichteln.example.org   # vergleicht die ausgelieferten Dateien mit dist/RELEASE.json
```

Das Paket in `dist/` enthält nur, was auf den Server gehört (ohne Tests und Entwicklungsdateien). `dist/RELEASE.json` sollte zusammen mit dem Quellcode veröffentlicht werden (z. B. als Release-Anhang), damit jede:r eine Installation nachprüfen kann.

## Lokale Entwicklung

```sh
npm run dev                                                    # http://127.0.0.1:8080 (Konfiguration: dev/config.dev.json)
ZW_CONFIG=dev/config.dev.json node server/main.mjs codes create --label dev
```

## Tests

```sh
npm install                        # nur Testwerkzeuge (eslint, jsdom, puppeteer-core, axe-core)
npm run lint                       # ESLint
npm test                           # node:test – Krypto, Links, Markdown, Ziehung, Regeln, Server-Bausteine, Mailer (Fake-SMTP mit TLS), Parallelzugriffe
node tests/api/run.mjs             # API-Testsuite über HTTP (65 Tests)
ZW_OLD_ROOT=/tmp/zw-24 node tests/upgrade/from-2.4.mjs   # Update 2.4.0 → 2.5 → 2.4.0 → 2.5 mit echten Daten (git worktree add /tmp/zw-24 v2.4.0): Fristen, Rechte, Löschung, Rate-Limit, E-Mail, Admin-Bereich
node tests/api/fuzz.mjs 4000       # Fuzzing aller Endpunkte über HTTP
node tests/e2e/flow.mjs            # Meilenstein 1 gegen echten Server, prüft DB auf Klartext
node tests/e2e/draw-flow.mjs       # Meilenstein 2: Regeln, Ziehung, Wünsche, Wichtelpost
node tests/ui/smoke.mjs            # PWA in jsdom, prüft auch: kein innerHTML im Code
node tests/ui/hostile.mjs          # feindliche Inhalte (HTML, javascript:-Links)
CHROME_PATH=/pfad/zu/chrome npm run test:browser                  # alle Browser-Durchläufe inkl. WCAG 2.2 AA (axe-core)
```

Gegenprobe mit der PHP-Version 1.2.1 – dieselben API-Tests und die Datenübernahme in beide Richtungen:

```sh
git worktree add /tmp/zw-php v1.2.1
ZW_IMPL=php ZW_PHP_ROOT=/tmp/zw-php node tests/api/run.mjs
ZW_PHP_ROOT=/tmp/zw-php node tests/api/migration.mjs
```

## Aufbau

```text
public/                    die PWA (unverändert seit 1.2)
  index.html, css/app.css, manifest.webmanifest, sw.js, icons/
  js/app.js                Router (alles im URL-Fragment)
  js/lib/crypto.js         WebCrypto: AES-GCM, HKDF, X25519-Versiegelung, Wiederherstellungscode
  js/lib/draw.js           Ziehungsalgorithmus
  js/lib/rules.js          Schrottwichteln: Aktionen, Vorlagen, Validierung, Würfel
  js/lib/model.js          Fachlogik: verschlüsselt alles, bevor es den Server erreicht
  js/lib/markdown.js       Markdown-light → DOM (ohne innerHTML)
  js/views/                Ansichten
  js/vendor/qrcode.mjs     qrcode-generator 2.0.4 (MIT), siehe vendor/README.md
  js/lib/music.js          Hintergrundmusik (Notensymbol oben rechts, startet nie von selbst)
  audio/                   Musikdatei – Pixabay-Inhaltslizenz, NICHT EUPL (siehe Lizenzen)
server/                    Node.js, nur eingebaute Module – Details in docs/SERVER.md
  main.mjs                 Einstieg: zw serve | check | codes | admin | cleanup
  http.mjs                 HTTP-Server, statische Dateien, Sicherheitsheader
  app.mjs                  API-Endpunkte
  …                        db, validate, crypto, admin (+TOTP), codes, ratelimit, cleanup, notifier, mail/
deploy/                    Docker-Image, Compose, Installationsskript, systemd-Unit
tests/                     API-, JS-, E2E-, UI- und Browser-Tests
```

## Lizenzen

ZeroWichtel steht unter der [EUPL-1.2](LICENSE). Ausgenommen sind:

| Bestandteil | Herkunft | Lizenz |
| --- | --- | --- |
| `public/audio/christmas-background-music.mp3` | „Christmas – Christmas Background Music“ von [starostin](https://pixabay.com/de/users/starostin-46826676/), [Pixabay Audio 438875](https://pixabay.com/de/music/weihnachten-christmas-christmas-background-music-438875/); für das Web auf 128 kbit/s verkleinert, Metadaten entfernt | [Pixabay-Inhaltslizenz](https://pixabay.com/de/service/license-summary/) – Nutzung als Teil der App; nicht einzeln weiterverbreiten |
| `public/js/vendor/qrcode.mjs` | qrcode-generator 2.0.4, Kazuhiko Arase | MIT |

Die App zeigt diese Angaben unter `#lizenzen` (Link „Lizenzen“ im Fußbereich). Das Pixabay-Lizenzzertifikat zum Download liegt beim Betreiber und nicht im Repository (es enthält den Pixabay-Benutzernamen).

## Sicherheitsmodell in Kürze

| Wer | kennt | sieht |
| --- | --- | --- |
| Server/Betreiber | Token-Hashes, Fristen, Zu-/Absagen, Postfach-IDs | nur Chiffretext; keine Namen, Wünsche, Zuordnungen |
| Organisator:in | Rundenschlüssel, Admin-Schlüssel | Namen, Zu-/Absagen, Regeln – **nicht**, wer wen beschenkt |
| Teilnehmende:r | Rundenschlüssel, eigenes Geheimnis | eigene Person, deren Wünsche, die eigene Wichtelpost |

Pro Paar gibt es ein Postfach mit Paarschlüssel M und **getrennten** Tokens für Wichtel und Beschenkte:n. So kann die beschenkte Person keine Fragen „als Wichtel“ stellen und der Wichtel keine Wünsche überschreiben.

Offen benannte Restrisiken: Zugriffsmuster (Zeitpunkte) sind für den Betreiber sichtbar; wer Link oder Wiederherstellungscode besitzt, hat Zugang; eine Organisator:in mit Entwicklerwerkzeugen könnte die Ziehung im eigenen Browser mitschneiden.
