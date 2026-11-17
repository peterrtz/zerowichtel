# Server: Aufbau und API

Der Server ist ein einzelner Node.js-Prozess (≥ 24.7) ohne npm-Pakete. Er liefert die PWA aus `public/` aus, beantwortet die API unter `/api/…` und erledigt im Hintergrund Löschung und E-Mail-Erinnerungen. Er sieht nur Chiffretexte, Token-Hashes, Fristen und Zu-/Absagen.

## Module

| Datei | Aufgabe |
| --- | --- |
| `server/main.mjs` | Einstieg und Kommandozeile (`serve`, `check`, `codes`, `open`, `admin`, `cleanup`, `backup`); Hintergrundlauf jede Minute; Neuladen der Konfiguration (Dateiänderung oder `SIGHUP`) |
| `server/http.mjs` | HTTP-Server: HTTPS-Weiterleitung, Sicherheitsheader, Anfragekörper (max. 64 KiB), statische Dateien aus dem Speicher (gzip), Weitergabe an die API |
| `server/app.mjs` | Alle API-Endpunkte; Prüfung von Rechten, Status und Fristen |
| `server/validate.mjs` | `HttpError`, Eingabeprüfung (`V.id`, `V.ct`, …), JSON-Lesen mit denselben Regeln wie PHP `json_decode` (nur Ganzzahlen, max. 15 Ebenen, gültiges UTF-8) |
| `server/db.mjs` | SQLite über `node:sqlite`: Pragmas (WAL, `secure_delete`, `foreign_keys`), Schema-Migrationen v1–v7, nur additiv (v5: Gruppenlink, Sprache der Runde, Rätselhinweise; v6: `rounds.without_code`; v7: `rounds.teams_ct`, `participants.team_ct`, `mailboxes.wish_rev`), Transaktionen mit `BEGIN IMMEDIATE` |
| `server/crypto.mjs` | SHA-256, Zufall, Vergleich in konstanter Zeit, `ServerCrypto` (XChaCha20-Poly1305 = HChaCha20 + ChaCha20-Poly1305, byte-kompatibel mit libsodium), Argon2id im PHC-Format |
| `server/admin.mjs` | Admin-Bereich: Anmeldung (Passwort + TOTP oder Notfallcode), Sperre, Sitzungen, Codes, Protokoll; TOTP nach RFC 6238 |
| `server/codes.mjs` | Organisator-Codes (`ZW-XXXX-…`, nur Hash gespeichert) |
| `server/ratelimit.mjs` | Feste Zeitfenster je Aktion; Bucket = gekürzter HMAC aus IP, Serverschlüssel und Tagesdatum – keine IP-Adressen in der Datenbank |
| `server/cleanup.mjs` | Löschung (Wichteldatum + 14 Tage, verwaiste Runden nach 30 Tagen, alte Codes/Sitzungen/Protokolle), `VACUUM` und WAL-Checkpoint |
| `server/notifier.mjs` | Erinnerungen im E-Mail-Modus (Antwortfrist, Ziehung, Wunschfrist, Tageshinweis Wichtelpost) – je Runde einmal |
| `server/email.mjs` | Prüfung von E-Mail-Adressen (Regel aus PHP `filter_var`) |
| `server/mail/mailers.mjs` | Versand: SMTP (STARTTLS oder TLS, Zertifikat immer geprüft), Brevo-API, Log (Tests) |
| `server/mail/texts.mjs` | Alle Mailtexte auf Deutsch und Englisch (Sprache der Runde) – ohne Namen, Wünsche oder Zuordnungen |
| `server/cli.mjs` | `zw codes …`, `zw open …` und `zw admin …` (verdeckte Passworteingabe, QR-Code im Terminal) |
| `server/open-creation.mjs` | Anlegen ohne Organisator-Code: Einstellung in `meta` (`open_creation`: an/aus, Obergrenze 1–500, E-Mail ja/nein); belegt = bestehende Runden mit `without_code = 1` |
| `server/stats.mjs` | Zähler „analoge Wichtelrunde vorbereitet“ in `meta` (`stat_analog`: gesamt und je Jahr) – ohne Inhalte |
| `server/backup.mjs` | `zw backup`: konsistente Kopie per `VACUUM INTO` nach `data/backup/` (0600), rotierende Löschung eigener Sicherungen |

## Ablauf einer Anfrage

1. `http.mjs`: ohne `X-Forwarded-Proto: https` → 301 auf `base_url` (nur wenn `base_url` mit `https://` beginnt).
2. `/api/…`: Körper lesen (413 über 64 KiB), JSON prüfen (400 `bad_json`), Client-IP (bei `client_ip_header` der erste Eintrag), `X-ZW-Auth`.
3. `app.mjs`: ggf. Aufräumen (`lazy_cleanup`), Rate-Limit `read` (GET) bzw. `write`, Endpunkt suchen, Antwort `{status, data}`.
4. Antwort: JSON mit `Cache-Control: no-store` und strikter CSP; Fehler immer als `{ "error": "<code>", "message": "<deutscher Text>" }`.

Statische Dateien: aus `public/` beim Start geladen; versteckte Pfade (außer `/.well-known/`) → 403; `index.html` und `sw.js` mit `Cache-Control: no-cache`, sonst `Last-Modified`/304.

## Authentifizierung (`X-ZW-Auth`)

| Präfix | Bedeutung | geprüft gegen |
| --- | --- | --- |
| `a.<rundenId>.<token>` | Organisator:in | `rounds.admin_hash` |
| `i.<personId>.<token>` | Einladung (ansehen, einlösen) | `participants.invite_hash` |
| `p.<personId>.<token>` | Teilnehmende:r | `participants.access_hash` |
| `j.<rundenId>.<token>` | Gruppenlink (selbst eintragen) | `rounds.join_hash` |
| `g.<postfachId>.<token>` / `r.…` | Wichtelpost als Wichtel / Beschenkte:r | `mailboxes.giver_hash` / `receiver_hash` |
| `x.<sitzungsId>.<token>` | Admin-Bereich | `admin_sessions.token_hash` |

IDs und Tokens: 22 Zeichen Base64url (128 Bit). Gespeichert wird nur SHA-256 (hex). Falsches Format → 401, unbekannt/falsch → 404.

## Endpunkte

| Methode und Pfad | Auth | Zweck |
| --- | --- | --- |
| `GET /info` | – | Serverangaben (Code nötig?, `openCreation` {available, full, email, limited} ohne Zahlen, E-Mail verfügbar?, Betreiber, `backupDays`, Uhrzeit, Version) |
| `POST /organizer/check` | – | Organisator-Code prüfen |
| `POST /rounds` | – (Code) | Runde anlegen; ohne Code nur bei eingeschaltetem „Anlegen ohne Code“ und freiem Platz (sonst 403 `organizer_code` bzw. `open_full`; E-Mail-Modus ggf. 409 `email_needs_code`). Prüfung und Anlage in einer Transaktion |
| `GET /rounds/{id}/admin` | a | Verwaltungsansicht |
| `PATCH /rounds/{id}` | a | Texte, Fristen, E-Mail-Modus, Mail-Titel, Sprache (`de`/`en`) ändern |
| `PUT` / `DELETE /rounds/{id}/join` | a | Gruppenlink anlegen bzw. ersetzen (Hash, Token mit K_admin, Ablauf, Höchstzahl) / widerrufen |
| `DELETE /rounds/{id}` | a | Runde sofort löschen |
| `POST /rounds/{id}/participants` | a | Person anlegen (optional mit E-Mail) |
| `PATCH` / `DELETE /rounds/{id}/participants/{pid}` | a | umbenennen / entfernen |
| `POST /rounds/{id}/participants/{pid}/reinvite` | a | neue Einladung (setzt nach der Ziehung die Ziehung zurück) |
| `POST /rounds/{id}/participants/{pid}/remind` | a | Erinnerung „noch nicht nachgesehen“ per E-Mail |
| `PUT /rounds/{id}/participants/{pid}/email` | a | Adresse setzen oder entfernen |
| `GET /rounds/{id}/keys` | a | öffentliche Schlüssel der Zusagenden |
| `PUT /rounds/{id}/draw` | a | Ziehung speichern (versiegelte Zuordnungen, Postfach-Hashes) |
| `GET /invite` · `POST /invite/claim` | i | Einladung ansehen · einlösen |
| `GET /join` · `POST /join` | j | Runde zum Gruppenlink ansehen (mit freien Plätzen) · selbst eintragen (angenommen und „dabei“) |
| `GET /me` | p | eigene Seite (markiert „nach der Ziehung nachgesehen“) |
| `PUT /me/rsvp` · `/me/wishes` · `/me/recovery` · `/me/notify` | p | Antwort · Wünsche · neuer Wiederherstellungscode · Erinnerungen an/aus |
| `DELETE /me/email` | p | eigene Adresse löschen |
| `POST /recover` | – (Code) | Zugang mit Wiederherstellungscode erneuern |
| `GET /mailbox` · `POST /mailbox/messages` | g, r | Wichtelpost lesen · schreiben (bis 7 Tage nach dem Wichteldatum); Lesen liefert Rätselhinweise – der beschenkten Person nur freigeschaltete, sonst Anzahl und nächster Termin |
| `POST /mailbox/hints` · `DELETE /mailbox/hints/{id}` | g | Rätselhinweis planen (höchstens 5, bis zum Wichteldatum) · noch nicht freigeschalteten zurückziehen |
| `PUT /mailbox/wish` | r | Wunschliste an den Wichtel übergeben |
| `POST /mail/link` | a oder p | Link per Mail verschicken (wird geprüft, nie gespeichert) |
| `POST /admin/{slug}/login` · `logout` | – / x | Admin-Bereich |
| `GET /admin/{slug}/overview` · `POST /admin/{slug}/codes` · `DELETE /admin/{slug}/codes/{ref}` | x | Überblick, Code erzeugen, widerrufen |
| `PUT /admin/{slug}/open` | x | Anlegen ohne Code: `{enabled, maxRounds, email}` |
| `PATCH /rounds/{id}` mit `teamsCt` | a | Team-Wichteln an (Teamliste, K_round) oder aus (`null`, löscht alle Teamwahlen); nur Status offen, nur Wichteln |
| `PUT /rounds/{id}/participants/{pid}/team` | a | Team einer Person setzen (`teamCt`, K_round, AAD an die Person gebunden; `null` = ohne Team); nur offen |
| `PUT /me/team` | p | eigenes Team wählen; nur offen, nicht bei Absage |
| `PUT /rounds/{id}/draw` | a | Ziehung; `kind` muss zur Runde passen (`team` ⇔ Teamliste gesetzt). Team: 2 … Teilnehmende Postfächer, Zuordnung bis 12 000 Zeichen |
| `POST /stats/analog` | – | Analoge Wichtelrunde vorbereitet: zählt nur (+1 gesamt und im laufenden Jahr), Körper wird ignoriert; höchstens 5 je Anschluss und Tag (`rate_limits.analog`) |
| `PUT /mailbox/wish` mit `rev` | r | Team-Runden: Pflicht; anderer Stand → 409 `conflict` (atomar). `GET /mailbox` liefert `wishRev`. `withdraw` gilt nur in Personen-Runden |

## Hintergrund

Jede Minute: Konfiguration auf Änderungen prüfen; höchstens alle 10 Minuten aufräumen und fällige Erinnerungen verschicken (Mails im Hintergrund, nie zwei Läufe gleichzeitig). Ein Cronjob ist nicht nötig. `zw cleanup` erledigt dasselbe sofort.

## Konfiguration

`config.json`, Pfad über `ZW_CONFIG`; `ZW_DB_PATH` überschreibt `db_path` (im Container gesetzt). Alle Schlüssel mit Erklärung: [`config.example.json`](../config.example.json). Die Schlüsselnamen entsprechen der früheren `config.php`.

## Kompatibilität mit 1.x (PHP)

Schema (`user_version` 4), Token-Hashes, Organisator-Codes, Argon2id-Hashes (PHC), TOTP-Geheimnis und E-Mail-Chiffrate (`x1.…`) sind identisch – eine Datenbank wechselt ohne Umwandlung zwischen beiden Versionen (geprüft in `tests/api/migration.mjs`). Bewusst strenger als 1.x: Ein Zeilenumbruch am Ende einer ID, eines Links oder eines Codes wird abgelehnt (PHP ließ ihn wegen `$` in PCRE durch); Objekte mit Zahlen als Schlüssel gelten nicht als Liste.

## Testhaken

Nur mit `ZW_TEST_CLOCK=1` wertet `zw serve` den Header `X-ZW-Test-Now` als Uhrzeit aus (für die API-Testsuite). In Produktion nie setzen.
