# Sicherheit

## Bedrohungsmodell

| Angreifer | Ziel | Schutz |
| --- | --- | --- |
| Neugieriger Betreiber / kopierte Datenbank | Namen, Wünsche, Zuordnung lesen | Zero-Knowledge: Inhalte nur als Chiffretext (AES-256-GCM, X25519); Schlüssel nur im URL-Fragment |
| Kopierte Datenbank | E-Mail-Adressen lesen | XChaCha20-Poly1305 mit Serverschlüssel aus `config.json` (liegt nicht in der DB); ebenso das TOTP-Geheimnis des Admin-Bereichs |
| Organisator:in | erfahren, wer wen beschenkt | Zuordnung wird pro Person versiegelt und im Speicher verworfen. **Grenze:** Mitschneiden mit Entwicklerwerkzeugen im eigenen Browser ist nicht verhinderbar. |
| Beschenkte:r | Identität des Wichtels herausfinden | Beschenkte:r erhält nur Paarschlüssel M und r-Token, nie die ID des Wichtels |
| Teilnehmende:r | fremde Wünsche/Nachrichten lesen oder fälschen | Postfach-Tokens getrennt nach Rolle (g/r); AAD bindet jeden Chiffretext an Runde, Person, Zweck |
| Dritte mit Link | Zugriff | Links sind Schlüssel (128-Bit-Tokens, 256-Bit-Schlüssel); Einladungen nur einmal einlösbar |
| Brute Force | Tokens/Codes raten | 128/160-Bit-Zufall; Rate-Limits je Aktion und IP-Prüfwert |
| XSS | Schlüssel aus localStorage stehlen | Kein `innerHTML` (Test erzwingt das), strikte CSP ohne `unsafe-inline`, Markdown-light nur über `textContent`, Links nur `https:` |
| CSRF | Aktionen im Namen anderer | Authentifizierung nur über eigenen Header `X-ZW-Auth`, keine Cookies; ohne CORS-Freigabe |
| Lieferkette | Schadcode über Fremdpakete | Server ohne npm-Pakete (nur eingebaute Node-Module); Browser ohne Bibliotheken außer qrcode-generator (eingebunden, Prüfsumme in vendor/README.md); npm/yarn im Container-Image entfernt |
| Manipulierter Server | veränderten JS-Code ausliefern | Open Source, Prüfsummen je Release (`RELEASE.json`), `bin/verify-release.mjs` vergleicht eine Installation mit dem Release |
| Angreifer auf den Admin-Bereich | Organisator-Codes erzeugen | Ausgeschaltet als Standard; geheimer Pfad (128 Bit, sonst 404); Masterpasswort (Argon2id) **und** TOTP oder einmaliger Notfallcode; keine Rückmeldung, welcher Teil falsch war; Sperre nach 5 Fehlversuchen; TOTP-Codes nicht wiederverwendbar; Sitzungstoken nur als Hash, 30 Minuten, ohne Cookies; Einrichtung nur per Konsole. Selbst bei Erfolg: kein Zugriff auf Rundeninhalte |
| Mail-Anbieter | Links/Inhalte mitlesen | Nur Text, keine Inhalte; Schlüssel-Links nur auf ausdrückliche Anforderung; Vorschauen und Tracking beim Anbieter abschalten |

## Restrisiken (bewusst akzeptiert)

- Zugriffsmuster (Zeitpunkte, IP beim Hoster) sind für den Betreiber sichtbar. Ab 1.2 sieht die Organisator:in außerdem, ob jemand seine Seite nach der Ziehung geöffnet hat (ja/nein) – das verrät keine Zuordnung.
- Direktlinks in Mails (`#zu/<Personen-ID>`) enthalten kein Geheimnis; die Personen-ID allein öffnet nichts.
- Wer einen persönlichen Link oder Wiederherstellungscode hat, hat Zugang.
- Beim Versand eines Links per E-Mail passiert dieser den Server und den Mailanbieter (Entscheidung 1.1 A).
- Die Admin-Sperre gilt global: Wer die geheime Adresse kennt, kann die Anmeldung durch Fehlversuche für 15 Minuten blockieren. Rückweg: `zw admin unlock` bzw. `zw admin new-url`.
- Subresource-Integrity in der vom selben Server ausgelieferten `index.html` schützt nicht gegen einen kompromittierten Server; dafür gibt es die Release-Prüfung.

## Prüfungen im Projekt

| Prüfung | Datei |
| --- | --- |
| Krypto, Ziehung (Gleichverteilung), Regeln, Parser | `tests/js/*.test.mjs` |
| Server-Bausteine: TOTP (RFC 6238), XChaCha20/Argon2 kompatibel zu libsodium/PHP, E-Mail-Prüfung, JSON-Regeln | `tests/js/server.test.mjs` |
| API über HTTP: Rechte, Fristen, Löschung, Rate-Limits, E-Mail, Admin-Bereich (Sperre, Notfallcodes, Sitzungen, 404 bei falschem Pfad) | `tests/api/run.mjs` |
| Fuzzing aller Endpunkte über HTTP (kein 500, keine Servermeldung, DB intakt) | `tests/api/fuzz.mjs` |
| Gegenprobe: dieselbe API-Suite gegen 1.2.1 (PHP); Datenübernahme PHP ↔ Node in beide Richtungen | `tests/api/run.mjs` mit `ZW_IMPL=php`, `tests/api/migration.mjs` |
| Mailer gegen Fake-Brevo und Fake-SMTP (STARTTLS und TLS mit Zertifikatsprüfung), Header-Injection | `tests/js/mailers.test.mjs` |
| Gleichzeitige Schreibzugriffe mehrerer Prozesse (SQLite-Sperren) | `tests/js/concurrency.test.mjs` |
| End-to-End, Datenbank frei von Klartext, nach dem Löschen keine Spur der Runde | `tests/e2e/*.mjs` |
| Feindliche Inhalte (HTML, `javascript:`-Links) | `tests/ui/hostile.mjs` |
| Kein `innerHTML`/`eval` im Code, UI-Durchlauf | `tests/ui/smoke.mjs` |
| Echte Browser-Durchläufe M1–M4, Admin-Bereich, Erinnerungen, Barrierefreiheit | `tests/browser/*.mjs` |

## Sicherheitslücken melden

Bitte vertraulich an die im Impressum genannte E-Mail-Adresse. Keine öffentlichen Issues für unbehobene Lücken. Rückmeldung innerhalb von 7 Tagen, Behebung und koordinierte Veröffentlichung nach Absprache.
