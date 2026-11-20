# Änderungen

## 2.13.0 – 2026-11-20

Datenbankschema 13 (nur ergänzend: `rounds.album_mode`, `rounds.album_pdf`, Tabelle `photos`).

- **Adventsalbum:** Die Organisator:in schaltet es pro Runde ein (Standard: aus). Wer zugesagt hat, teilt Fotos aus der Vorweihnachtszeit mit Bildunterschrift; die Timeline zeigt sie nach Tagen, Adventssonntage und Bescherung markiert, Antippen öffnet die Großansicht.
- **Aufbereitung im Browser:** Jedes Foto wird neu gezeichnet – lange Kante höchstens 1600 px, WebP (JPEG, wo der Browser kein WebP schreiben kann), dazu eine Vorschau. Dabei fallen alle Metadaten weg, auch der GPS-Standort. JPEG, PNG und WebP gehen überall, HEIC dort, wo der Browser es lesen kann (Safari am iPhone); sonst kommt eine verständliche Meldung.
- **Verschlüsselung und Schutz:** Foto, Vorschau und Bildunterschrift sind mit dem Rundenschlüssel verschlüsselt. Der Server kann den Inhalt nicht prüfen; deshalb prüft jedes Gerät nach dem Entschlüsseln die Dateikennung und zeigt nur WebP und JPEG an. Grenzen: 12 Fotos je Person, 60 MB je Runde, 600 KB je Foto (einstellbar unter `album` in `config.json`, dort auch serverweit abschaltbar). Eigene Fotos löscht man selbst, die Organisator:in jedes. Gelöscht mit der Runde.
- **PDF-Erinnerungsalbum** (von der Organisator:in zuschaltbar, ab der Bescherung): 5 Layouts (ein Foto pro Seite, zwei pro Seite, Raster, Polaroid, Tagebuch), 5 Designs (Winterweiß, Tannengrün, Mitternacht, Lebkuchen, Schlicht), Hoch- oder Querformat, Titelblatt mit Titel, Untertitel, Text und Titelfoto. Die PDF entsteht nur im Browser (eigener kleiner PDF-Erzeuger ohne Abhängigkeit); Bildunterschriften mit Emoji werden als Bild gesetzt. Hochladen geht nach der Bescherung weiter.
- **Altersangaben im Ideen-Würfel:** Jeder Vorschlag hat ein Mindestalter und optional ein Höchstalter. Wer würfelt, wählt das ungefähre Alter des Wichtels (egal, Kind 6–12, jugendlich 13–17, erwachsen 18+); das Mindestalter gilt streng, das Ergebnis zeigt „ab … Jahren“ bzw. „ca. … Jahre“. Die Standardliste hat neue Vorschläge für Kinder und enthält keinen Alkohol (per Test abgesichert). Im Admin-Bereich und beim Import (`minAge`, `maxAge`) pflegbar.
- **Sicherheitsprüfung vor der Veröffentlichung**, vier Befunde mit niedrigem Risiko behoben:
  1. Bildbomben: Vor dem Anzeigen liest die App die Bildmaße aus dem Dateikopf und weist alles über 1700 Pixel (Vorschau: 450) ab – eine 5,5 KB kleine Datei mit 12 000 × 12 000 Pixeln hätte sonst auf jedem Gerät rund 576 MB belegt.
  2. Der Name unter einem Foto kommt aus der Teilnehmerliste (der Server ordnet die hochladende Person zu), nicht mehr aus einer selbst eingetragenen Angabe.
  3. Eigene Ratenbegrenzung `photo_read` (600 je Stunde und Anschluss) für Fotos und Fotolisten.
  4. Foto-Uploads dürfen nur mit gültigem Teilnehmerzugang, Zusage und eingeschaltetem Album größer als 64 KB sein; das prüft der Server, bevor er die Anfrage liest.
- Content-Security-Policy: `img-src` erlaubt zusätzlich `blob:` (entschlüsselte Fotos der eigenen Seite).

## 2.12.0 – 2026-11-20

Kein neues Datenbankschema (Einstellung in der Tabelle `meta`).

- **Unterstützungslink des Betreibers:** Im Admin-Bereich (Karte „Unterstützungslink“) oder per `zw donation set --url … [--label …] [--note …]` lässt sich ein Link hinterlegen, etwa zu „Buy me a coffee“ oder einer Spendenaktion. Er erscheint in der Fußzeile aller Seiten und als kleine Karte auf der Startseite. Optional („Zusätzlich in den Runden zeigen“, `--rounds on`) steht die Karte auch ganz unten auf der Teilnehmer- und der Verwaltungsseite – dort, wo Teilnehmende über ihren Einladungslink tatsächlich ankommen. Ohne Einstellung ändert sich nichts.
- Nur https-Adressen mit Domainnamen, ohne Zugangsdaten; Linktext höchstens 40, Hinweis höchstens 200 Zeichen. Gewöhnlicher Link: neuer Tab, kein Opener, kein Referrer; nichts wird eingebettet oder vorab geladen (im Browser-Test geprüft).
- Der Admin-Bereich warnt bei Tracking-Angaben in der Adresse und entfernt sie auf Knopfdruck. Die Wunschlink-Bereinigung entfernt jetzt auch `adjust_…`-Kennungen.
- Die Datenschutzerklärung nennt den Link automatisch, solange er eingeschaltet ist. Das Protokoll speichert nur Linktext und Domain.
- **Geschenkvorschläge pflegbar:** Im Admin-Bereich (Karte „Geschenkvorschläge (Ideen-Würfel)“) lässt sich die Liste des Ideen-Würfels ergänzen („Standardliste plus eigene“) oder ersetzen („Nur eigene“), je Preisklasse (bis 5/10/20/30/50 €, über 50 €), Deutsch und optional Englisch. „Standardliste als Vorlage übernehmen“ lädt die mitgelieferte Liste zum Bearbeiten. Höchstens 200 Vorschläge à 120 Zeichen. Auf der Konsole: `zw ideas export`, `zw ideas import < datei.json`, `zw ideas reset`. Die App holt die Liste erst beim ersten Würfeln von `/api/ideas`; ohne Verbindung gilt die Standardliste. Passt kein Vorschlag zum Betragslimit, sagt der Würfel das.
- **Fußzeile aufgeräumt:** zwei Zeilen (oben die Seiten, unten Einstellungen und Hinweise). „Design wie Gerät“ ist jetzt eine kleine Auswahl mit Symbol (Wie Gerät / Hell / Dunkel), immer sichtbar und mit dem Sonne/Mond-Schalter oben abgeglichen. „Verschlüsselung“ entfällt in der Fußzeile (bleibt oben über das Schloss erreichbar).
- **Quellcode-Link** in Fußzeile, Impressum und Lizenzen (Standard: das GitHub-Repository). Wer ZeroWichtel verändert betreibt, setzt in `config.json` `source_url` auf den eigenen Code (nur https).
- Installationsanleitungen nennen die aktuelle Paketversion statt 2.6.0.

## 2.11.0 – 2026-11-18

Datenbankschema 12 (nur ergänzend: `participants.mix_ct`).

- **Wichtel-Mixtape der Runde:** Jede Person trägt bis zu drei Lieblings-Weihnachtslieder ein (Titel, Interpret optional), änderbar bis zur Bescherung. Alle in der Runde sehen eine gemeinsame, gemischte Trackliste im Kassetten-Look (Seite A/B) – ohne Namen. Gleiche Lieder erscheinen einmal mit „von n Personen gewählt“.
- Ab der Bescherung kann jede Person ihre Lieder aufdecken („aufgedeckt: Name“) und wieder verbergen. Geraten wird beim Wichteln selbst.
- „Anhören“ zeigt Such-Knöpfe für Qobuz, Spotify, Deezer, Apple Music und YouTube. Nichts wird eingebettet oder vorab geladen; erst beim Klick gehen Titel und Interpret an den gewählten Dienst (ohne Referrer). „Trackliste kopieren“ für die eigene Musik-App.
- Verschlüsselung mit K_round, bewusst ohne Personenbezug im Chiffretext. Der Server liefert die Einträge der anderen nach Chiffretext sortiert und ohne Personen-ID; nur Einträge von Personen, die dabei sind. Die Organisator:in sieht das Mixtape nicht (wie alle anderen auch nur als Teilnehmende). Neu einladen löscht den Eintrag.
- Grenzen (bewusst): Der Name beim Aufdecken ist eine eigene Angabe und wird nicht geprüft (wer die Runde kennt, könnte technisch einen fremden Namen eintragen). Wer kurz vor und nach dem Eintragen einer anderen Person neu lädt, kann am neuen Eintrag erkennen, welche Lieder von ihr sind – wie beim Wichteln üblich, bleibt das ein Spiel unter Bekannten.

## 2.10.1 – 2026-11-18

Datenbankschema 11 (nur ergänzend).

- **Wünsche festlegen:** Neben „Wünsche speichern“ gibt es „Speichern & festlegen“, auch schon vor der Auslosung. Danach bleiben 24 Stunden für kleine Korrekturen; dann sind die Wünsche fest. Die Person kann die Organisator:in um Freigabe bitten; die Organisator:in sieht „Wünsche festgelegt“ bzw. „bittet um Freigabe“ und kann die Festlegung aufheben.
- Der Wichtel sieht „Festgelegt – kleine Korrekturen noch bis …“ bzw. „ändern sich nicht mehr, du kannst schon loslegen“. In der Zeitleiste der Person gilt „Wünsche“ als erledigt. Keine zusätzliche Mail.
- Der Server sperrt Änderungen nach den 24 Stunden selbst (eigene Wunschliste und Kopie beim Wichtel). Der Widerruf einer Einwilligung zu Gesundheitsangaben bleibt jederzeit möglich. Nicht beim Team-Wichteln.
- Neue Auslosung lässt die Festlegung bestehen (die Wünsche sind dieselben); neu einladen setzt sie zurück.
- Layout: Haken „Geschenk besorgt“ als eigenes Feld mit mehr Abstand; Zeitleiste „Geschenk besorgen“ bzw. „Geschenk finden“ (kein dreizeiliger Umbruch mehr); mehr Abstand in der Karte „Frage an die Organisator:in“.

## 2.10.0 – 2026-11-18

Datenbankschema 10 (nur ergänzend).

- Die Organisator:in kann unter „Rückfragen“ optional eine E-Mail-Adresse hinterlegen. Bei neuen Rückfragen kommt höchstens einmal am Tag eine Mail – ohne Fragetext, ohne Absender, ohne Link (der Admin-Link wird nie gespeichert). Fragen, die vor dem Hinterlegen gestellt wurden, lösen keinen Hinweis aus.
- Nur im E-Mail-Modus der Runde. Die Adresse liegt mit dem Serverschlüssel verschlüsselt (nur für den Versand) und zusätzlich mit dem Admin-Schlüssel (Anzeige in der Verwaltung). Feld leeren und speichern löscht sie; E-Mail-Modus aus und Löschen der Runde ebenso.

## 2.9.0 – 2026-11-18

Enthält 2.8 und 2.9; Datenbankschema 9 (v8 und v9, nur ergänzend). Ältere Versionen ab 2.4 laufen auf dem neuen Schema weiter (Rückweg getestet).

**Rückfragen an die Organisator:in (2.9)**
- Beim Anlegen (und später in der Verwaltung) wählbar: aus (Standard) / mit Namen / mit Namen oder anonym.
- Teilnehmende sehen einen Hilfe-Knopf unter „Was jetzt?“ und eine Karte „Frage an die Organisator:in“ (höchstens 700 Zeichen) mit dem Hinweis, nichts über die eigene Zuordnung zu schreiben. Die Organisator:in antwortet in der Verwaltung; einzelne Fragen lassen sich löschen.
- Verschlüsselung: Fragen sind für einen Schlüssel der Organisator:in versiegelt (im Browser aus dem Admin-Schlüssel abgeleitet), Antworten mit einem Schlüssel aus der Frage. Der Server kann beides nicht lesen.
- Anonym: gesendet ohne Personen-Zugang, mit einem Token, das alle in der Runde haben; gespeichert ohne Personenbezug, nur mit dem Tag. Die Antwort holt nur ab, wer den Abholschlüssel hat – er liegt nur im Browser der fragenden Person.
- Grenzen: 3 Fragen je Person und Tag (anonym: je Anschluss, dazu höchstens 20 je Runde und Tag), höchstens 30 gespeicherte je Person bzw. anonym je Runde.
- E-Mail-Modus: Bei einer Antwort auf eine Frage mit Namen bekommt die fragende Person eine Mail ohne Inhalt. Anonyme Fragen lösen nie eine Mail aus.
- Anfragebegrenzung: Die Zähler verschiedener Aktionen desselben Anschlusses sind jetzt nicht mehr miteinander verknüpfbar (Aktion fließt in den Prüfwert ein). Bestehende Zähler beginnen nach dem Update einmalig neu.

**Geschenk abhaken (2.8)**
- Neuer Schritt in der Zeitleiste zwischen „Wünsche“ und „Bescherung“: „Geschenk besorgen & verpacken“ (Schrottwichteln: „Geschenk finden & verpacken“). Teilnehmende haken ihn unter „Was jetzt?“ selbst ab; „Was jetzt?“ zeigt dann „Alles erledigt“.
- Gespeichert verschlüsselt auf dem Server, an die Person gebunden; nur sie bekommt den Haken zurück, die Organisator:in sieht ihn nicht. Neue Auslosung oder neue Einladung setzt ihn zurück.
- Zeitleiste: Wurde vor der Antwortfrist ausgelost, steht bei „Zusagen“ jetzt der Tag der Auslosung statt der späteren Frist.

## 2.7.0 – 2026-11-17

Neu: **Analoge Wichtelrunde zum Ausdrucken** – dritte Option neben Wichteln und Schrottwichteln (Startseite und „Neue Runde“, ohne Organisator-Code). Datenbankschema (7) unverändert.

- Namen eintragen (3 bis 50), optional Titel, Datum, Ort, Betragslimit und eine Notiz.
- Lose wahlweise **verdeckt vorgelost** (Standard; die App lost im Browser aus, ein Kreis, niemand zieht sich selbst, Paare ausschließbar; außen „Los für …“, innen verdeckt die beschenkte Person, mit Abdeckklappe) oder **klassisch aus dem Hut** (ein Zettel je Name, die Regeln erklären das Neuziehen).
- Spielregeln als eine Seite, passend zur Art der Lose; kleine Einladungs- oder Erinnerungskarten (4 je A4-Seite) in drei eigenen, dezenten Designs: Tannenzweig, Sterne, Schleife. Gedruckt wird über den Browser („Drucken“ oder „Als PDF speichern“).
- Eingaben und Lose bleiben nur im lokalen Speicher dieses Browsers, auch über Neuladen und Neustart, bis „Alles löschen“. Der Server sieht keine Namen, Termine oder Lose.
- Admin-Bereich und `zw check`: Zähler, wie viele analoge Runden vorbereitet wurden (gesamt und im laufenden Jahr). Gezählt wird einmal je Vorbereitung beim ersten Druck; ohne Inhalte, höchstens 5 je Anschluss und Tag (neue Begrenzung `rate_limits.analog`).

## 2.6.0 – 2026-11-17

Neu: **Ohne Smartphone mitwichteln.** Server und Datenbankschema (7) sind unverändert; bestehende Runden laufen weiter.

- Die Organisator:in trägt vor der Auslosung ein, wer ohne Smartphone mitwichtelt und wer dabei hilft – jemand aus der Runde oder jemand, der selbst nicht mitwichtelt. Die Helfer:in bekommt den Link dieser Person, nimmt die Einladung auf dem eigenen Gerät an, sieht für sie Zuordnung, Wünsche und Wichtelpost und trägt ihre Wünsche ein.
- Wichtelt die Helfer:in selbst mit, ziehen sich die beiden nie gegenseitig. Jede Person hilft höchstens einer Person.
- Grenze: höchstens ⌊(n − 2) / 3⌋ Personen ohne Smartphone mit mitwichtelnder Helfer:in (n = Ausgeloste); Helfer:innen von außerhalb zählen nicht. Herleitung mit exakter Auswertung und Skripten zum Nachrechnen: `docs/KONZEPT-ANALOG.md`, `tools/analyse/`.
- Wer die Person beschenkt, sieht nichts davon. Die Zuordnung liegt verschlüsselt in den Organisator-Daten; das Paar steht zusätzlich in der Ausschlussliste, damit auch ältere, zwischengespeicherte App-Versionen es beachten.
- Sagt eine Helfer:in vor der Auslosung ab, bleibt die Auslosung gesperrt, bis jemand anderes eingetragen ist. Nicht kombinierbar mit Team-Wichteln.
- „Meine Runden“ zeigt bei Teilnahmen den Namen – zwei Zugänge derselben Runde auf einem Gerät lassen sich so unterscheiden.

## Nach 2.5.3 (nur Dokumentation, kein neues Paket)

- README und Anleitungen nennen die Release-Seite als Bezugsquelle des Installationspakets.
- README: neuer Abschnitt „Voraussetzungen und Grenzen“ (abgedeckter Serveraufbau, feste Namen, Zeitzone, Sprachen, Teststand).
- Tests: Klartext-Prüfung im Team-Durchlauf ohne Zufallstreffer.

## 2.5.3 – 2026-11-14

Nur Dokumentation und Hinweistexte des Installers; Programmcode und Schema (7) sind unverändert gegenüber 2.5.2.

- Die Anleitung für Docker hinter Caddy ist nicht mehr auf einen bestimmten Nachbardienst zugeschnitten. Beispielordner des Caddy-Stacks ist `/opt/caddy`.
- Installer: Findet er den Ordner des Caddy-Stacks nicht selbst, zeigt er in den Hinweisen einen Platzhalter statt eines fest eingetragenen Pfads. Am Ablauf von Installation und Update ändert sich nichts.

## 2.5.2 – 2026-11-14

Ergebnis eines zweiten, unabhängigen Code-Reviews (Lauf R4) und Vorbereitung der Veröffentlichung. Kein Schema-Wechsel gegenüber 2.5.x (Schema 7); Update von 2.4.0 direkt möglich und getestet.

**Sicherheit**
- SEC-012 (Low, seit 2.4.0): Runden, die **ohne Organisator-Code** angelegt wurden, konnten Admin-Link-Mails an frei gewählte Adressen auslösen – auch wenn E-Mail für solche Runden im Admin-Bereich gesperrt war. Jetzt gilt dieselbe Regel wie in der Oberfläche: nur mit Code oder wenn der Admin E-Mail für Runden ohne Code erlaubt.
- Härtung: Die Testuhr (`ZW_TEST_CLOCK`) startet nur noch im Entwicklungsmodus und nur, wenn der Server ausschließlich lokal lauscht. Im Container kann sie damit nicht versehentlich aktiv sein.
- Härtung: Der Mail-Transport `log` (schreibt Mails samt Links in eine Datei) wirkt nur noch im Entwicklungsmodus; sonst ist der E-Mail-Modus aus und `zw check` weist darauf hin.

**Installation**
- Der Installer hat keine fest eingetragene Domain mehr. Erste Installation: `sudo DOMAIN=… bash install-docker-caddy.sh …`. **Updates lesen die Domain aus der vorhandenen `config.json`** – der Aufruf ohne `DOMAIN=` funktioniert also weiter.
- **Sicherung vor jedem Update:** Der Installer legt vor dem Update automatisch eine konsistente Kopie der Datenbank in `data/backup/` an (`zw backup` der laufenden Version, ab 2.4.0). Schlägt die Sicherung fehl, bricht er ab, bevor etwas geändert wird (bewusst überspringen: `ZW_SKIP_BACKUP=1`). Muss der Installer nach einem Fehlstart zurückrollen, nennt er die Sicherungsdatei.
- Dokumentation und Beispiele verwenden neutrale Beispiel-Domains; betreiberspezifische Angaben wurden entfernt.

## 2.5.1 – 2026-11-14

- **SEC-010 behoben:** „Zugang wiederherstellen“ per Bild liest Breite und Höhe jetzt aus dem Dateikopf (PNG, JPEG, GIF, WebP), bevor das Bild dekodiert wird, und lehnt Bilder über 50 Megapixel ab – mit dem Hinweis, stattdessen ein Bildschirmfoto zu nehmen. 48-MP-Handyfotos und alle Bildschirmfotos funktionieren wie bisher. Andere Formate (z. B. BMP, AVIF) werden mit verständlichem Hinweis abgelehnt.
- Warum nicht automatisch verkleinern: gemessen in Chromium dekodieren `createImageBitmap` (auch mit `resizeWidth`) und `ImageDecoder` große JPEGs trotzdem in voller Größe (200 MP ≈ 770 MB Spitze). Verkleinern im Browser würde das Problem also nicht lösen.

## 2.5.0 – 2026-11-14

Team-Wichteln und Sicherheitsreview der Änderungen seit 2.3.2 (Lauf R2). Schema 7 (drei neue Spalten, beim Start automatisch ergänzt; alle Runden bleiben erhalten – mit Update- und Rückweg-Test gegen echte 2.4.0-Daten).

**Team-Wichteln** (optional je Runde, nur Modus Wichteln)
- Statt Person für Person beschenken sich Teams: Team A beschenkt Team B, Team B beschenkt Team C … (ein Kreis, nie das eigene Team). Bei nur 2 Teams beschenken sie sich gegenseitig – mit Hinweis, dass dann jedes Team weiß, wer es beschenkt.
- Organisator:in: Karte „Team-Wichteln“ – einschalten, Teams benennen, optional Höchstgröße je Team, Personen zuordnen oder umsetzen; Vorprüfung nennt alle ohne Team. Ausschalten löscht alle Teamwahlen. Untergruppen und Ausschlüsse entfallen in Team-Runden.
- Teilnehmende wählen nach dem Zusagen ihr Team auf der eigenen Seite (bis zur Auslosung). Sie sehen je Team nur die Zahl der Mitglieder, keine Namen; volle Teams sind gesperrt.
- Nach der Auslosung: „Euer Team beschenkt …“ mit den Mitgliedern beider Teams; ein **gemeinsamer Team-Wunschzettel**, den jedes Mitglied bearbeiten kann („zuletzt geändert von …“). Speichern zwei gleichzeitig, bekommt die zweite Person einen Hinweis statt still zu überschreiben. Ohne Gesundheitsangaben – eine Person kann nicht für andere einwilligen.
- Wichtelpost, Rätselhinweise, Raten, Auflösen und Danke laufen zwischen Teams; jedes Mitglied sieht die Post des Teams.
- Zero-Knowledge bleibt: Teamliste, Teamwahl, Zuordnung und Wunschzettel sind verschlüsselt. Neu sieht der Betreiber nur, ob eine Runde Teams hat und wie viele Teams gezogen wurden.
- Bestehende Runden verhalten sich unverändert; offene Runden können vor der Auslosung auf Team-Wichteln umgestellt werden. Eine noch zwischengespeicherte ältere App kann eine Team-Runde nicht versehentlich als Personen-Runde auslosen und den Team-Wunschzettel nicht überschreiben (der Server weist sie mit „Bitte neu laden“ ab).

**Sicherheit (Review R2)**
- SEC-007 (Medium, seit 2.4.0): Die freien Plätze für Runden ohne Code ließen sich von einem Anschluss aus belegen. Neu: höchstens 2 Runden ohne Code je Anschluss und Tag (`rate_limits.create_open`); die Anfragebegrenzung zählt IPv6 je /64.
- SEC-008 (Low, nur im Arbeitsstand): Der Widerruf-Schalter hätte beim Team-Wunschzettel die Wunschfrist umgangen – behoben vor Auslieferung.
- Im Review gefunden und behoben: Team-Zuordnungen mit vielen Mitgliedern hätten das Serverlimit überschritten (gemessen bis 9053 Zeichen; Limit 12 000).

**Rückweg auf 2.4.0** ist möglich (getestet): 2.4.0 liest Schema 7 und ignoriert die neuen Spalten. Team-Runden lassen sich unter 2.4.0 aber nicht sinnvoll nutzen.

## 2.4.0 – 2026-11-10

Anlegen ohne Organisator-Code, Wiederherstellungscode als Bild und Sicherungen. Enthält 2.3.1 und 2.3.2. Schema 6 (eine neue Spalte, wird beim Start automatisch ergänzt; alle Runden bleiben erhalten).

**Anlegen ohne Code**
- Im Admin-Bereich neue Karte **„Anlegen ohne Code“**: ein/aus, **höchstens gleichzeitig bestehende Runden ohne Code** (1–500, Standard 10) und ob diese Runden E-Mail-Versand nutzen dürfen (Standard: nein). Mit Organisator-Code geht das Anlegen immer (im Rahmen des Code-Kontingents); ohne Code nur, solange ein Platz frei ist. Ein Platz wird frei, sobald die Runde gelöscht ist – sofort durch die Organisator:in oder automatisch 14 Tage nach dem Wichteldatum.
- Auch auf der Kommandozeile: `zw open status | on --max 10 [--email] | off`. Änderungen stehen im Admin-Protokoll; der Überblick zeigt „Runden ohne Code“.
- Anlegen-Formular: Code-Feld wird bei freien Plätzen **optional**; sind alle belegt, erscheint ein Hinweis und der Code ist wieder Pflicht. E-Mail-Versand ist ohne Code gesperrt, wenn der Admin ihn nicht erlaubt (der Server prüft das auch beim späteren Einschalten).
- Prüfung „Platz frei?“ und Anlage laufen in einer Transaktion – parallele Anfragen können die Obergrenze nicht überschreiten. `/api/info` verrät nur, ob es geht, keine Zahlen.
- Steht in `config.json` `"require_organizer_code": false`, gilt wie bisher: Anlegen ohne Code und ohne Grenze (der Admin-Bereich weist darauf hin).

**Wiederherstellungscode als Bild**
- Neuer Knopf **„Als Bild speichern“**: ein PNG mit QR-Code, Code im Klartext und Hinweisen, im Browser erzeugt. Auf Handys über das Teilen-Menü („Bild sichern“), sonst als Download. Hinweis, dass Fotos oft automatisch in eine Cloud synchronisiert werden.
- **„Zugang wiederherstellen“** nimmt jetzt auch ein Bild an: das gespeicherte PNG (Code steckt zusätzlich in einem PNG-Textfeld) oder ein **Bildschirmfoto** des QR-Codes (Erkennung mit jsQR 1.4.0, Apache-2.0, wird erst bei Bedarf geladen). Das Bild verlässt das Gerät nicht.

**Sicherungen**
- Neu: `zw backup [--dir …] [--keep <tage>]` – konsistente Kopie im laufenden Betrieb (`VACUUM INTO`) nach `data/backup/`, nur für den Dienst lesbar; löscht eigene Sicherungen älter als `privacy.backup_days` (sonst 14 Tage).
- Neu: `"privacy": { "backup_days": 14 }` – dann nennt die Datenschutzerklärung (Abschnitt 4) die Sicherungen und ihre Aufbewahrung. Die Installationsanleitung beschreibt tägliche Sicherung per Cron, Wiederherstellung und die getrennte Sicherung der `config.json`. Der bisherige Rat „data/ nicht sichern“ entfällt.

**Behoben**
- Admin-Bereich: Im Überblick stand bei mehr als drei Notfallcodes das Wort „null“.

## 2.3.2 – 2026-11-10

Einwilligung für Gesundheitsangaben (Art. 9 DSGVO).

- **Allergien und Unverträglichkeiten** im Steckbrief lassen sich erst nach einer **ausdrücklichen Einwilligung** eintragen (Häkchen mit vollständigem Einwilligungstext: Zweck, Empfänger nur der eigene Wichtel, Speicherdauer, Widerruf). Ohne Einwilligung bleibt das Feld gesperrt; alles andere funktioniert unverändert.
- **Nachweis:** Zeitpunkt und Fassung der Einwilligung (`consent.v`) liegen verschlüsselt in der Wunschliste der Person. Der Server erfährt nicht, ob es eine Gesundheitsangabe gibt.
- **Widerruf jederzeit** (Art. 7 Abs. 3 DSGVO): Häkchen entfernen bzw. „Einwilligung widerrufen“ – auch nach der Wunschfrist. Die Angabe wird sofort aus der eigenen Wunschliste und aus der Kopie für den Wichtel gelöscht. Der Server lässt dafür Änderungen mit `withdraw: true` auch nach der Wunschfrist zu (`PUT /me/wishes`, `PUT /mailbox/wish`).
- **Ältere Angaben ohne Einwilligung** (aus 2.3.0/2.3.1) zeigt die App dem Wichtel nicht mehr an; beim nächsten Speichern ohne Häkchen werden sie gelöscht.
- Hinweis am Feld: Für Kinder unter 16 Jahren entscheidet eine erziehungsberechtigte Person. Beim Feld „Bitte nicht“ der Hinweis, Allergien nur im Steckbrief einzutragen.
- Datenschutzerklärung (neuer Abschnitt 3a, Rechtsgrundlage Art. 9 Abs. 2 lit. a DSGVO) und Verarbeitungsverzeichnis ergänzt. Tests: Unit (Einwilligung, Anzeige, Widerruf), API (Widerruf nach der Wunschfrist), Browser (Einwilligung, Widerruf nach der Wunschfrist).

## 2.3.1 – 2026-11-10

Sicherheitsupdate nach dem Security-Audit vom 01.11.2026 (Register R1, Befunde SEC-001 bis SEC-006). **Update dringend empfohlen.**

- **SEC-001 (High) – E-Mail-Prüfung ohne ReDoS:** Der aus PHP übernommene Prüfausdruck brauchte in Node.js bei bestimmten Eingaben exponentiell lange (PHP bricht das selbst ab, V8 nicht). Eine einzige Anfrage über „Admin-Link mailen“ oder das E-Mail-Feld hätte den Server blockiert. Die Prüfung zerlegt die Adresse jetzt und prüft die Teile einzeln, in linearer Laufzeit. Über 400 000 Zufallseingaben hinweg gleiche Ergebnisse wie bisher; strenger nur bei IPv6-Literalen (`a@[IPv6:…]`), die nicht mehr angenommen werden. Regressionstests für Laufzeit und API.
- **SEC-002 (Low) – Grenzen je Runde für Mails:** Admin-Link-Mails an frei gewählte Adressen höchstens 5 pro Tag und Runde, alle Mails einer Runde zusammen höchstens 120 pro Tag (zusätzlich zum bisherigen Limit je Client). Admin-Link-Mails enthalten den Mail-Titel der Runde nicht mehr. Neue Einstellungen `rate_limits.mail_admin` und `rate_limits.mail_round`.
- **SEC-003 (Low) – Entwicklungswerkzeuge aktualisiert:** puppeteer-core 25.17, eslint 10.14, minimatch ≥ 11.0.6 (Override). `npm audit`: 0 Schwachstellen. Betrifft nur Tests und Lint, nicht den Betrieb.
- **SEC-004 (Low) – Schwache Serverschlüssel werden abgelehnt:** Ein `server_key` mit weniger als 16 verschiedenen Bytes (z. B. der Platzhalter aus `dev/config.dev.json`) startet nur noch mit `ZW_DEV=1` (setzt `npm run dev`). Echte, zufällig erzeugte Schlüssel sind nicht betroffen.
- **SEC-005 (Info) – Basisimage nachvollziehbar:** Der Installer schreibt den Digest des verwendeten `node:24-trixie-slim` nach `base-images.log`. Der Tag bleibt bewusst beweglich, damit Sicherheitsupdates mitkommen.
- **SEC-006 (Info) – .gitignore:** schließt jetzt auch `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `/config/` und das Audit-Register `.security-audit/` aus.

## 2.3.0 – 2026-10-21

Ein großes Funktions-Update rund ums Wichtelerlebnis – einfacher für Organisator:innen, verständlicher für Teilnehmende und spannender rund um die Bescherung. Die Zero-Knowledge-Eigenschaften bleiben unverändert: Alles Neue mit Inhalt wird im Browser verschlüsselt.

**Organisation**
- **Gruppenlink (optional):** ein Link für alle, z. B. für die Familien- oder Teamgruppe. Wer ihn öffnet, trägt sich mit Namen selbst ein und ist gleich „dabei“ (Schlüssel, Zugang und Wiederherstellungscode entstehen wie beim Einladen nur im Browser). Ablaufdatum und Höchstzahl legt die Organisator:in fest; neu erzeugen oder widerrufen jederzeit, nach der Ziehung automatisch geschlossen. Der Server kennt nur den Hash des Tokens. Einzelne Einladungen bleiben unverändert möglich; Selbst-Eingetragene tragen den Hinweis „per Gruppenlink“.
- **Checkliste** in der Verwaltung: was erledigt ist und was als Nächstes kommt (Admin-Link, selbst eintragen, einladen, Zusagen, Auslosen, „alle haben nachgesehen“, Bescherung).
- **Einladungskarten zum Ausdrucken:** vier Karten pro A4-Seite mit QR-Code je offener Einladung, auf Wunsch zusätzlich eine Karte für den Gruppenlink.
- **Sprache der E-Mails** pro Runde (Deutsch oder Englisch).

**Teilnahme**
- **„Was jetzt?“** mit den nächsten Schritten und einer **Zeitleiste** der Runde („Du bist hier“) – auf Handys senkrecht.
- **Steckbrief** zur Wunschliste (Kleider- und Schuhgröße, Lieblingsfarben, „Mag ich“, Allergien und Unverträglichkeiten); „No-Go“ heißt jetzt „Bitte nicht“.
- **Tracking-Bereinigung:** Links in Wünschen werden beim Speichern von Tracking-Angaben befreit (utm_…, fbclid, gclid, Partner-Kennungen von Amazon, eBay, AliExpress u. a.); eine Meldung sagt, wie viele entfernt wurden.
- **Päckchen auspacken:** Beim ersten Ansehen nach der Ziehung liegt die Zuordnung in einem Päckchen (bei „Bewegung reduzieren“ ohne Animation; Fokus danach auf dem Namen).
- **Rätselhinweise:** Der Wichtel plant bis zu fünf Hinweise mit Datum; der Server gibt einen Hinweis erst ab dem gewählten Zeitpunkt an die beschenkte Person heraus (vorher nur Anzahl und nächster Termin).
- **Nach der Bescherung:** raten, wer der Wichtel war; der Wichtel kann sich zu erkennen geben (muss aber nicht); **anonymes Dankeschön**. Die Wichtelpost bleibt dafür bis eine Woche nach dem Wichteldatum offen.
- **Countdown** bis zur Bescherung, im Advent mit Türchen und kleinem Tipp; **Schneefall** zum Einschalten (nie bei „Bewegung reduzieren“).
- **Ideen-Würfel:** Geschenkideen passend zum Betragslimit – feste Liste im Code, ohne Shop und ohne Tracking.

**Für alle**
- **Probelauf** (`#demo`): die Ziehung mit echten Schlüsseln und versiegelten Umschlägen ausprobieren – ohne Runde, ohne Serverkontakt.
- **Englische Oberfläche** (Umschalter im Fußbereich, sonst Browsersprache); Fehlermeldungen des Servers werden übersetzt. Datenschutzerklärung, Impressum und Barrierefreiheitserklärung bleiben deutsch, mit englischem Hinweis.

**Server und Daten**
- Schema v5: `rounds.lang`, Gruppenlink (`join_hash`, `join_ct`, `join_until`, `join_max`, `join_used`), `participants.via_group`, Tabelle `hints` (verschlüsselter Inhalt, Freischaltzeitpunkt). Neue Endpunkte: `PUT/DELETE /rounds/{id}/join`, `GET/POST /join`, `POST /mailbox/hints`, `DELETE /mailbox/hints/{id}`. Mails auf Deutsch oder Englisch.
- Wichtelpost-Nachrichten können strukturiert sein (`{k: 'guess'|'reveal'|'thanks', text}`); normale Nachrichten bleiben reine Texte.
- Datenschutzerklärung und Barrierefreiheitserklärung ergänzt (Sprache, Freischaltzeitpunkte, Gruppenlink, lokale Einstellungen).

**Tests**
- API: Gruppenlink (Grenzen, Ablauf, Widerruf, nach der Ziehung), Rätselhinweise (Freischaltung, Inhalt vorher nicht ausgeliefert, höchstens 5), englische Mails, Wichtelpost nach dem Termin (55 Tests). Die PHP-Gegenprobe läuft für alle unveränderten Teile weiter.
- Unit: Vollständigkeit der Übersetzungen (über 800 Texte, gleiche Platzhalter), Tracking-Bereinigung, Ideen-Würfel, Zeitleiste, Checkliste, „Was jetzt?“, Steckbrief.
- Browser: neuer Durchlauf mit Gruppenlink (auch auf Englisch), Einladungskarten, Steckbrief, Päckchen, Hinweis, Schnee, Raten/Auflösen/Danke, Probelauf; axe jetzt 60 Prüfungen inkl. der neuen Ansichten und der englischen Oberfläche.
- Lint-Regel: `t`/`tn` (Übersetzung) darf nicht überdeckt werden.

## 2.2.0 – 2026-10-21

- **Neu: „verschlüsselt“ ist anklickbar** und öffnet eine verständliche Erklärung als Dialog: Schlüssel im Link-Fragment (geht nie an den Server), wer was sehen kann (Server, Organisator:in, Teilnehmende), wie die Ziehung versiegelt wird, was der Server trotzdem weiß (Fristen, Zu-/Absagen als Zufalls-ID, Zeitpunkte, im E-Mail-Modus die Adressen), ehrliche Grenzen und aufklappbar die technischen Details (AES-256-GCM, X25519 + HKDF, Token-Hashes, XChaCha20-Poly1305, CSP).
- Barrierearm: natives `<dialog>` (Fokus bleibt im Dialog, Esc schließt, Fokus zurück zum Auslöser), Titel als Dialogname, Schließen-Knopf, Klick auf den Hintergrund schließt. Zusätzlich „Verschlüsselung“ im Fußbereich – auf sehr schmalen Geräten (unter 380 px) ist das Schloss in der Kopfzeile ausgeblendet. Auf Touch-Geräten ist das Schloss 44 × 44 px groß.
- Tests: Browser-Durchlauf öffnet und schließt den Dialog (Schloss, Esc, Fußbereich, Schließen); axe-Prüfung des geöffneten Dialogs im hellen, dunklen und umgeschalteten Design.

## 2.1.0 – 2026-10-21

- **Neu: Hintergrundmusik**, ein- und ausschaltbar über das Notensymbol oben rechts neben Hell/Dunkel. Startet nie von selbst (WCAG 1.4.2), wird erst beim Einschalten vom eigenen Server geladen (keine Anfrage an Pixabay), läuft über Seitenwechsel weiter und pausiert, solange der Tab im Hintergrund ist. Zustand „aus“ ist durchgestrichen dargestellt, „an“ hervorgehoben; für Screenreader ein Umschalter (`aria-pressed`). Die Wahl wird nicht gespeichert.
- Musik: „Christmas – Christmas Background Music“ von starostin (Pixabay, Pixabay-Inhaltslizenz), für das Web auf 128 kbit/s verkleinert (1,9 MB statt 3,8 MB), Metadaten entfernt.
- **Neu: Seite „Lizenzen und Quellen“** (`#lizenzen`, im Fußbereich verlinkt): EUPL-1.2 für ZeroWichtel, Musik mit Urheber, Quelle und Lizenz, qrcode-generator (MIT). Fußzeile nennt die Musikquelle.
- Server: Teilanfragen (`Range`, HTTP 206/416) für statische Dateien – nötig für die Audiowiedergabe in Safari. Service Worker lässt die Musik und Teilanfragen durch und speichert nur vollständige Antworten.
- Kopfzeile auf schmalen Geräten: Schloss unter 460 px nur als Symbol, unter 380 px nur für Screenreader – damit Musik- und Design-Knopf (je 44 px) in eine Zeile passen.
- Erklärung zur Barrierefreiheit um die Musik ergänzt. Tests: Browser-Durchlauf schaltet die Musik ein und aus und prüft die Lizenzseite; axe-Prüfung und 320-px-Prüfung auch für `#lizenzen`.

## 2.0.2 – 2026-10-21

- **Verwaltung: deutlicher Hinweis „Wichtelst du selbst mit?“** im Bereich Teilnehmende, solange die Runde offen ist: Wer mitwichteln will, muss sich wie alle anderen als Person eintragen und die eigene Einladung über „Selbst hier öffnen“ annehmen – der Admin-Link allein macht nicht zur Teilnehmer:in, ohne Einladung wird man nicht mit ausgelost. Der Hinweis verschwindet, sobald auf diesem Gerät eine eigene Teilnahme an der Runde gespeichert ist, oder dauerhaft mit „Ich wichtle nicht selbst mit“ (nur in diesem Browser gespeichert).
- Meldung nach dem Anlegen nennt den Schritt „dich selbst eintragen, falls du mitwichtelst“.
- Test: Browser-Durchlauf prüft Anzeige, Verschwinden nach eigener Teilnahme und „nicht mit“.

## 2.0.1 – 2026-10-21

- **Admin-Link: keine erneute Nachfrage mehr, wenn der Link von außen geöffnet wird.** Öffnest du den Admin-Link auf einem Gerät oder in einem Browser, der die Runde noch nicht kennt (aus Passwortmanager, Notizen, Mail), gilt er als gesichert: Statt „Zuerst: Admin-Link sichern“ erscheint gleich der eingeklappte Bereich „Admin-Link“ – Teilen, Kopieren und Mailen bleiben dort möglich. Nur auf dem Gerät, auf dem die Runde angelegt wurde, wird bis zur Bestätigung weiter gefragt. Die Bestätigung bleibt (wie bisher) nur in diesem Browser gespeichert.
- Test: Browser-Durchlauf prüft Anlege-Gerät (vor und nach der Bestätigung) und ein zweites Gerät.
- Installationsskript: bricht gleich zu Beginn mit klarer Meldung ab, wenn der Docker-Dienst nicht läuft.

## 2.0.0 – 2026-10-21

**Der Server läuft jetzt mit Node.js statt PHP.** Die App im Browser, die API, die Datenbank, alle Links und die Zero-Knowledge-Eigenschaften bleiben unverändert.

- **Node.js ≥ 24.7 ohne npm-Pakete.** Alles mit eingebauten Modulen: `node:http`, `node:sqlite`, `node:crypto` (Argon2id, ChaCha20-Poly1305 + HChaCha20 = XChaCha20-Poly1305, HKDF, HMAC). Rund 2 300 Zeilen in `server/` einschließlich Webserver, Hintergrundlauf und Kommentaren (PHP-Fassung ohne Apache-Konfiguration: rund 3 000); Überblick in `docs/SERVER.md`.
- **Gleiche Funktion, nachgewiesen:** Die neue API-Testsuite (`tests/api/run.mjs`, 51 Tests über HTTP, aus den PHP-Tests portiert und ergänzt) läuft unverändert grün gegen 1.2.1 (PHP) und 2.0 (Node). Dazu Fuzzing über HTTP, alle E2E-, UI- und Browser-Durchläufe inkl. Barrierefreiheit – lokal und über Caddy im Container.
- **Datenübernahme ohne Umwandlung, in beide Richtungen:** Datenbank, Token-Hashes, Organisator-Codes, Admin-Passwort (Argon2id), TOTP-Geheimnis, Notfallcodes und verschlüsselte E-Mail-Adressen sind byte-kompatibel (`tests/api/migration.mjs`). Ein Rückfall auf 1.2.1 liest auch, was 2.0 geschrieben hat.
- **Konfiguration `config.json`** statt `config.php` (gleiche Schlüssel; `//`-Zeilen als Kommentare). Das Installationsskript übernimmt eine bestehende `config.php` automatisch. Änderungen gelten weiterhin ohne Neustart: Der Server lädt die Datei innerhalb einer Minute neu (sofort mit `SIGHUP`); fehlerhaftes JSON wird abgelehnt, die bisherige Konfiguration bleibt aktiv.
- **Kein Cronjob mehr:** Löschung und Erinnerungen laufen im Server (jede Minute geprüft, höchstens alle 10 Minuten wirksam). Das Installationsskript entfernt `/etc/cron.d/zerowichtel`.
- **Kommandozeile `zw`** (im Container): `zw check`, `zw codes …`, `zw admin …` (QR-Code jetzt ohne `qrencode`), `zw cleanup`.
- **Docker-Image `node:24-trixie-slim`** statt `php:8.5-apache`: kein Webserver im Container, npm/npx/corepack/yarn entfernt, läuft weiter als www-data (UID 33) – `data/` bleibt unverändert nutzbar. Gesundheitsprüfung ohne curl. Im Test rund 20 MB Arbeitsspeicher.
- **Installationsskript:** Rückfall stellt bei Bedarf auch `compose.yaml` der Vorversion wieder her (Update 1.x → 2.0); `config.php` bleibt als `config/config.php.1x` für einen manuellen Rückfall liegen. Prüfungen laufen jetzt von außen gegen den Container (kein curl im Image nötig).
- **Ohne Docker:** gehärtete systemd-Unit (`deploy/zerowichtel.service`) und Anleitung `docs/INSTALL-OHNE-DOCKER.md`. Das Installationsskript für nginx + PHP-FPM und der Betrieb auf PHP-Webhosting entfallen; dafür bleibt 1.2.1 als Tag erhalten.
- Bewusst strenger als 1.x: Ein Zeilenumbruch am Ende einer ID, eines Links oder eines Codes wird abgelehnt (PHP ließ ihn wegen `$` in PCRE durch).
- SMTP: STARTTLS (587) und implizites TLS (465) mit Zertifikatsprüfung jetzt auch automatisch getestet (Fake-Server mit eigenem Zertifikat).
- Statische Dateien kommen aus dem Speicher, gzip-komprimiert; `index.html` und `sw.js` mit `no-cache`, sonst `Last-Modified`/304.
- Tests: Browser-Durchläufe warten mit festem Abfrageintervall (Hintergrund-Tabs liefern keine Animation-Frames); `CHROME_ARGS` in allen Durchläufen.

## 1.2.1 – 2026-10-21

Enthält alles aus 1.2.0 (wurde nicht separat ausgeliefert).

- **Docker: Basis-Image jetzt `php:8.5-apache`** (offizielles PHP-Image, Debian) statt Ubuntu 24.04 mit PHP 8.3. `php.ini-production` als Grundlage; gemeinsame Einstellungen in `conf.d/zz-zerowichtel.ini`, Apache-Härtung (gesperrte Funktionen, `open_basedir`, keine Uploads) getrennt in `conf.d-apache/`, eingebunden über `PHP_INI_SCAN_DIR` nur für Apache. Der Build prüft die benötigten Erweiterungen und die Apache-Konfiguration.
- **Installationsskript: automatischer Rückfall.** Startet die neue Version nicht (Container, Gesundheitsprüfung, Konfiguration, Datenbank), läuft sofort wieder die vorherige; sie bleibt als `zerowichtel:previous` erhalten. Der Build läuft, während die alte Version weiter antwortet. Das Skript meldet die laufende PHP-Version.
- PHP 8.5: veralteten Aufruf `curl_close()` entfernt. Alle PHP-, E2E-, UI- und Browser-Tests laufen unter PHP 8.5 ohne Hinweise (inkl. Deprecated); weiterhin kompatibel ab PHP 8.2.
- Tests: Der Test-Server meldet PHP-Warnungen und Veraltet-Hinweise und lässt den Lauf dann fehlschlagen.

## 1.2.0 – 2026-10-21

- **Neu: Wer hat nach der Ziehung schon nachgesehen?** Die Verwaltung zeigt je Person „hat nachgesehen“ oder „noch nicht nachgesehen“ (Zähler „Schon nachgesehen: x von y“). Erst nach dem Öffnen bekommt der Wichtel die Wunschliste. Gespeichert wird nur ja/nein – nicht, wer wen beschenkt. Neuziehung setzt den Stand zurück.
- **Neu: Erinnern.** Für jede ausstehende Person eine Erinnerung über das Teilen-Menü (mit Direktlink), dazu eine Sammel-Erinnerung ohne Namen für den Gruppenchat. Im E-Mail-Modus zusätzlich „Per E-Mail“ (höchstens einmal am Tag je Person, nicht bei abbestellten Erinnerungen).
- **Neu: Direktlink in allen automatischen Mails** (`#zu/<Personen-ID>`, ohne Geheimnis): führt auf dem Gerät, auf dem die Einladung angenommen wurde, direkt zur eigenen Seite; auf anderen Geräten erklärt die Seite den Weg (persönlicher Link, Wiederherstellungscode). Den vollständigen persönlichen Link kennt der Server weiterhin nicht. Gilt für den Hinweis nach der Ziehung, die neue Erinnerung, Antwort- und Wunschfrist sowie den Tageshinweis zur Wichtelpost.
- **Neu: Termine in den Kalender.** Knopf „In den Kalender (.ics)“ in der Verwaltung und auf der eigenen Seite: Antwortfrist, Wunschfrist und Wichteldatum als ganztägige Termine mit Erinnerung am Vortag (RFC 5545). Die Datei entsteht im Browser; enthalten sind Titel, Termine, Betragslimit und nur Links ohne Geheimnis (Startseite bzw. `#zu/…`). Stabile UIDs: Nach Terminänderungen erneut laden, der Kalender aktualisiert die Einträge.
- **Neu: Hell/Dunkel-Umschalter** (Sonne/Mond oben rechts). Start wie das Gerät; die Wahl wird nur in diesem Browser gespeichert, „Design wie Gerät“ im Fußbereich setzt zurück. Kein Aufblitzen beim Laden (kleines Skript im Kopf, CSP-konform, mit SRI). Druck immer hell.
- **Barrierefreiheit (Ziel WCAG 2.2 AA):** Tabelle in der Datenschutzerklärung per Tastatur scrollbar; Fehlermeldungen werden sofort angesagt und bleiben bis zum Schließen, Erfolgsmeldungen 7 s und pausieren bei Maus/Fokus; Schriftgrößen in rem (folgen Geräte-/Browsereinstellung); nach Seitenwechseln Fokus auf der Überschrift und Ansage des Seitentitels, beim Neuzeichnen bleibt der Fokus am selben Element; „Zum Inhalt springen“; Pflichtfelder markiert, fehlerhafte Felder mit aria-invalid und verknüpfter Meldung, Fokus aufs erste Feld; Spiel-Timer mit Ansagen bei 1 Minute und 10 Sekunden; Schaltflächen auf Touch-Geräten mindestens 44 px; lange Wörter brechen um; Kontrast der Fehlermeldung im dunklen Design korrigiert; Unterstützung für erzwungene Farben (Windows-Kontrastmodus).
- **Neu: Erklärung zur Barrierefreiheit** (`#barrierefreiheit`, im Fußbereich verlinkt).
- Tests: `tests/browser/a11y.mjs` – axe-core auf allen Ansichten in drei Varianten (hell, dunkel, umgeschaltet), Tastatur, Meldungen, Formularfehler, Umschalter, 320 px und vergrößerte Textabstände; `npm run test:browser` für alle Browser-Durchläufe.
- Schema-Version 4 (`draw_seen`, `draw_reminded`); Datenschutzerklärung um die neue Angabe ergänzt.
- Tests: PHP-Tests für Merker, Erinnerung und Direktlinks je Person; Browser-Durchlauf `tests/browser/walkthrough-remind.mjs`; M2-Durchlauf prüft Zwischenstand und Direktlink auf eigenem und fremdem Gerät.

## 1.1.3 – 2026-10-20

- Datenschutzerklärung: E-Mail-Anbieter und die Bestätigung „keine Zugriffsprotokolle“ sind jetzt in `config.php` unter `privacy` einstellbar (`mail_provider`, `no_access_logs`) statt fester Platzhalter. Der Text zum Mailversand unterscheidet Brevo (Link-Umleitung) und SMTP (reiner Text, keine Umleitung). Löschfrist der Organisator-Codes aktualisiert (90 Tage nach Ablauf).
- Impressum: Überschrift „§ 5 DDG und § 18 Abs. 1 MStV“; Nutzungsvorbehalt gegen Text und Data Mining (§ 44b UrhG).

## 1.1.2 – 2026-10-20

- Suchmaschinen und KI-Crawler ausgeschlossen: `robots.txt` sperrt alle Crawler und nennt bekannte KI-Bots ausdrücklich; Header `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai` und `<meta name="robots">`; maschinenlesbarer Nutzungsvorbehalt für Text und Data Mining (§ 44b UrhG) über `/.well-known/tdmrep.json`, Header `tdm-reservation: 1` und Meta-Tag. `.htaccess` lässt `/.well-known/` zu, versteckte Dateien bleiben gesperrt. Das Docker-Installationsskript prüft das mit.

## 1.1.1 – 2026-10-20

- Domain: Standardwerte in Installationsskripten, `config.example.php` und Dokumentation umgestellt. Bestehende Installationen behalten ihre `base_url`, bis sie in `config.php` geändert wird.
- `docs/INSTALL-DOCKER-CADDY.md`: neuer Abschnitt „Domain wechseln“ mit Caddy-Weiterleitung, damit alte Links weiter funktionieren.

## 1.1.0 – 2026-10-19

- **Neu: Admin-Bereich** unter `#backend/<geheimer Pfad>` zum Erzeugen, Auflisten und Widerrufen von Organisator-Codes. Anmeldung mit Masterpasswort (Argon2id) und TOTP-Code (RFC 6238) oder einem von zehn einmaligen Notfallcodes; Sperre nach fünf Fehlversuchen für 15 Minuten; Sitzung 30 Minuten ohne Cookies; Protokoll ohne IP-Adressen (90 Tage). Standardmäßig aus; eingerichtet wird nur per Konsole (`bin/admin.php`). Der Bereich sieht keine Rundeninhalte.
- Neu: Erzeugte Codes lassen sich direkt teilen; der Link `#neu/ZW-…` füllt den Code beim Anlegen einer Runde vor und entfernt ihn danach aus der Adresszeile.
- Neu: Organisator-Codes werden 90 Tage nach Ablauf automatisch gelöscht.
- Docker: `config.php` liegt jetzt in `/opt/zerowichtel/config/` und wird als Ordner eingebunden. Vorher sah der Container nach dem Bearbeiten mit manchen Editoren weiter die alte Fassung. Das Installationsskript verschiebt eine vorhandene Datei automatisch und prüft, dass Container und Host dieselbe Fassung sehen. Datenbankpfad im Container fest über `ZW_DB_PATH`. `qrencode` im Image für den QR-Code bei der Einrichtung.
- Schema-Version 3 (Tabellen für den Admin-Bereich); bestehende Datenbanken werden automatisch erweitert.

## 1.0.4 – 2026-10-19

- **Fehlerbehebung (alle Installationen):** Bei gleichzeitigen Anfragen mehrerer PHP-Prozesse konnte SQLite mit „database is locked“ abbrechen (HTTP 500), z. B. beim Auslosen, während andere Teilnehmende die Seite offen hatten. Ursache waren verzögerte Transaktionen, die erst beim Schreiben die Sperre anforderten. Alle Transaktionen starten jetzt mit `BEGIN IMMEDIATE` (`src/SqlitePdo.php`) und warten bis zu 5 Sekunden auf die Sperre. Neuer Test `tests/php/concurrency.php` (8 parallele Prozesse).
- Neu: `deploy/install-docker-caddy.sh` und `deploy/docker/` – Installation als Container hinter einem Caddy, der selbst in Docker läuft: Apache + PHP 8.3 auf Ubuntu 24.04, schreibgeschütztes Dateisystem, keine Capabilities, kein öffentlicher Port, eigenes Netz nur mit Caddy, keine Zugriffsprotokolle, Cronjob auf dem Host. Caddyfile und Compose-Dateien des Caddy-Stacks bleiben unberührt; das Skript zeigt die zwei nötigen Ergänzungen an und prüft danach den ganzen Weg.
- Neu: `docs/INSTALL-DOCKER-CADDY.md`.
- Tests: Browser-Durchläufe können gegen eine laufende Installation laufen (`ZW_EXTERNAL_BASE`, `ZW_CODES_CMD`, `CHROME_ARGS`).

## 1.0.3 – 2026-10-19

- Neu: `deploy/install-ubuntu-nginx.sh` installiert und aktualisiert ZeroWichtel auf einem Ubuntu-Server mit nginx: eigener Systembenutzer und PHP-FPM-Pool, certbot-Zertifikat, nginx-Site ohne Zugriffsprotokolle, Cronjob, logrotate, Abschlussprüfung. Andere Sites bleiben unberührt.
- Neu: `docs/INSTALL-UBUNTU-NGINX.md` mit Ablauf, Backup-Hinweis, Fehlersuche und Deinstallation.
- `config.example.php`: Betreiberangaben standardmäßig leer statt Beispielwerten, damit keine Platzhalter im Impressum erscheinen.

## 1.0.2 – 2026-10-19

- Neu: `public/check.php` prüft die Installation (PHP-Version, Erweiterungen, HTTPS, config.php, Datenbank, Betreiberangaben). Nach der Installation löschen.
- README: fehlende Voraussetzungen ergänzt (`sodium`, für Brevo `curl`).

## 1.0.1 – 2026-10-19

Aufräumen nach statischer Analyse (ESLint, PHPStan Stufe 6) – keine funktionalen Änderungen für Teilnehmende.

- Auslosen: Personen, die nach „Neu einladen“ noch nicht angenommen haben, werden nicht mehr als „dabei“ mitgezählt; die Verwaltung weist auf sie hin.
- Release-Skript arbeitet auf einer Kopie (`dist/stage`): Subresource-Integrity und Cache-Version stehen nur im Paket, nicht mehr in der Quell-`index.html`. Vorher hätte eine spätere CSS-Änderung ohne neues Release das Stylesheet blockiert. Das Skript bricht ab, wenn die Dateiliste im Service Worker nicht stimmt.
- Datenbank-Migrationen als Schrittliste; Test für das Upgrade einer bestehenden Datenbank.
- Unbenutzte Importe und tote Bedingungen entfernt, falscher Typkommentar korrigiert.
- `npm run lint` (ESLint) und `phpstan.neon` hinzugefügt.

## 1.0.0 – 2026-10-18

Erste vollständige Version.

- **Meilenstein 1:** Runde anlegen (mit Organisator-Code), Admin-Link, Einladen per Teilen-Menü, Einlösen mit persönlichem Schlüssel, Umfrage, Wiederherstellungscode (Text, QR, Druck), Löschung per Cron oder Lazy-Lauf.
- **Meilenstein 2:** Untergruppen und Ausschlüsse, Ziehung im Kreis mit Rückfall auf freie Zuordnung, Wunschlisten (Markdown-light, Links, No-Go, „keine Idee“), anonyme Rückfragen, Neuziehung.
- **Meilenstein 3:** Schrottwichteln mit Regelbaukasten und Vorlagen, Vollbild-Spielansicht mit Timer, Päckchenzähler, App-Würfel, Wake Lock; freies Würfeln ohne Runde.
- **Meilenstein 4:** E-Mail-Modus über Brevo oder SMTP: Einladung, eigener Link, Admin-Link, Erinnerungen, Hinweis nach der Ziehung, Tageshinweis zur Wichtelpost, Abbestellen und Löschen.
- **Meilenstein 5:** API-Fuzzing, Prüfung feindlicher Inhalte, strengere URL-Prüfung, Größenlimit für Wunschlisten, Datenschutzerklärung und Impressum (Entwurf, Betreiberdaten aus `config.php`), Verarbeitungsverzeichnis und TOM (Entwurf), Sicherheitsdokumentation, Release-Skript mit Prüfsummen und Subresource-Integrity, Prüfskript für Installationen.
