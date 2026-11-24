# Verzeichnis von Verarbeitungstätigkeiten (Entwurf, Art. 30 DSGVO)

> Entwurf für den Betreiber von ZeroWichtel. Vor dem öffentlichen Betrieb ergänzen und prüfen lassen.

```yaml
verantwortlicher: "[Name, Anschrift, E-Mail – wie in config.json unter operator]"
verarbeitung: "Bereitstellung des Online-Dienstes ZeroWichtel zur Organisation von Wichtel- und Schrottwichtelrunden"
zwecke:
  - Anlegen und Verwalten von Wichtelrunden
  - Einladen (einzeln oder per optionalem Gruppenlink), Zu- und Absagen, Ziehung (Person zu Person oder optional Team zu Team), Wunschlisten mit Steckbrief bzw. gemeinsamer Team-Wunschzettel, anonyme Rückfragen, Rätselhinweise, Dankeschön
  - optionale E-Mail-Benachrichtigungen
  - Missbrauchsschutz (Begrenzung der Anfragen)
betroffene:
  - Organisator:innen
  - von ihnen eingeladene Teilnehmende
datenkategorien:
  verschluesselt_ohne_schluessel_beim_betreiber: [Rundentitel, Begrüßung, Spielregeln, Anzeigenamen, Wunschlisten und Steckbrief, Nachrichten, Rätselhinweise, Zuordnung, "Team-Wichteln: Teamliste, gewähltes Team je Person, Team-Wunschzettel (ohne Gesundheitsangaben)", "Ohne Smartphone mitwichteln: wer ohne Smartphone teilnimmt, wer hilft, bei Hilfe von außerhalb deren Name (nur Organisator:in, K_admin)", "Rückfragen und Antworten (Ende-zu-Ende), eigener Geschenk-Haken, Lieder fürs Wichtel-Mixtape, optionale E-Mail-Adresse der Organisator:in für Hinweise"]
  besondere_kategorien_art9:            # optional, nur mit ausdrücklicher Einwilligung
    daten: "Allergien und Unverträglichkeiten (Steckbrief), Ende-zu-Ende-verschlüsselt, nur für den eigenen Wichtel sichtbar"
    rechtsgrundlage: "Art. 9 Abs. 2 lit. a i. V. m. Art. 6 Abs. 1 lit. a DSGVO"
    einwilligungsnachweis: "Zeitpunkt und Textfassung (consent.v) verschlüsselt in der Wunschliste der Person; für den Betreiber nicht einsehbar"
    widerruf: "jederzeit in der App, auch nach der Wunschfrist; löscht die Angabe sofort in Wunschliste und Wichtel-Kopie"
    minderjaehrige: "unter 16 Jahren entscheidet eine erziehungsberechtigte Person (Hinweis am Feld)"
    speicherdauer: "bis Widerruf, spätestens Löschung der Runde (14 Tage nach dem Wichteldatum)"
  verschluesselt_mit_serverschluessel: [E-Mail-Adressen, optionaler Betreff-Titel]
  klartext: [Spielart, Fristen, Zu-/Absage, Status, Zeitpunkte, Prüfwerte von Zugangscodes, öffentliche Schlüssel, "Seite nach der Ziehung geöffnet (ja/nein)", "Zeitpunkt der letzten E-Mail-Erinnerung", "Sprache der Runde", "Freischaltzeitpunkte von Rätselhinweisen", "Gruppenlink: Prüfwert, Ablauf, Höchstzahl, Zahl der Eintragungen", "per Gruppenlink eingetragen (ja/nein)", "Runde mit Teams (ja/nein)", "Zahl der gezogenen Teams (= Zahl der Postfächer)", "Änderungszähler des Team-Wunschzettels", "angelegt ohne Organisator-Code (ja/nein)"]
  kurzlebig: ["gekürzter, täglich gesalzener IP-Prüfwert (max. 24 h; IPv6 je /64)"]
  wuensche_festlegen: "participants.wish_frozen_at/wish_unlock_req und mailboxes.wish_frozen_at im Klartext (nur Zeitpunkt bzw. Ja/Nein, kein Inhalt), damit der Server Änderungen nach 24 h sperren kann. Organisator:in sieht Festlegung und Bitte um Freigabe; der Wichtel sieht die Festlegung. Widerruf von Gesundheitsangaben bleibt möglich."
  nachricht_an_alle: "announcements (body_ct mit K_round: Text und Schalter ‚offene Aufgaben‘); der Server kennt nur Runde und Zeitpunkt. Sichtbar für alle Eingeladenen. Offene Aufgaben und ‚gelesen‘ werden nur im Browser berechnet bzw. gemerkt. Optional Hinweis-Mail ohne Inhalt (E-Mail-Modus, höchstens einmal am Tag). Gelöscht durch die Organisator:in oder mit der Runde."
  adventsalbum: "photos (Foto und Vorschau als Chiffretext-Bytes mit K_round, Bildunterschrift und Name in meta_ct); der Server kennt nur Größe, Zeitpunkt und hochladende Person (pid). Fotos werden im Browser neu gezeichnet: lange Kante höchstens 1600 px, WebP/JPEG, alle Metadaten (EXIF, GPS) entfernt. Sichtbar für Teilnehmende mit Zusage und die Organisator:in. Inhalt für den Server nicht prüfbar; Begrenzung über Anzahl je Person, Speicher je Runde und Ratenbegrenzung; die Organisator:in kann jedes Foto löschen. Gelöscht mit der Runde. PDF-Erinnerungsalbum entsteht nur im Browser."
  unterstuetzungslink: "Kein Personenbezug auf dem Server: Einstellung des Betreibers (Adresse, Linktext, Hinweis) in meta. Angezeigt als Link, nichts eingebettet oder vorab geladen; erst der Klick öffnet die fremde Seite in einem neuen Tab ohne Referrer. Ab dann verarbeitet allein deren Anbieter Daten (eigene Verantwortung). Datenschutzerklärung nennt den Link (und ob er auch in den Runden steht), solange er eingeschaltet ist."
  wichtel_mixtape: "participants.mix_ct (K_round, ohne Personenbezug im Inhalt); andere Teilnehmende bekommen die Einträge ohne Personen-ID und nach Chiffretext sortiert. Der Server sieht nur, ob eine Person einen Eintrag hat. Such-Links zu Musikdiensten öffnen sich erst beim Klick der Person (Titel und Interpret gehen dann an den Dienst, ohne Referrer); kein Einbetten, kein Vorabladen. Gelöscht beim Neu-Einladen und mit der Runde."
  geschenk_abhaken: "participants.done_ct (K_round, an die Person gebunden); nur /me liefert ihn zurück, die Organisator-Ansicht nicht; zurückgesetzt bei neuer Ziehung oder Einladung."
  hinweis_organisatorin: "Optional, nur im E-Mail-Modus: rounds.org_email_ct (Serverschlüssel, nur für den Versand) und org_email_view_ct (K_admin). Hinweis ohne Inhalt höchstens einmal am Tag; gelöscht beim Leeren des Felds, beim Abschalten des E-Mail-Modus und mit der Runde."
  rueckfragen: "Nur wenn die Organisator:in sie freigibt. Fragen für den Organisator-Schlüssel versiegelt, Antworten mit Schlüssel aus der Frage; Server liest nichts. Mit Namen: pid gespeichert, Mail bei Antwort ohne Inhalt. Anonym: ohne pid, nur Tag; ab 2.14 Frage-ID, Abholtoken und Antwortschlüssel aus dem Schlüssel der Person abgeleitet (auf jedem ihrer Geräte berechenbar, für den Server zufällig wirkend), Fragetext zusätzlich mit dem Antwortschlüssel verschlüsselt (own_ct); abgeholt ohne Personen-Zugang. Von der Organisator:in gelöschte anonyme Fragen bleiben als Platzhalter ohne Inhalt bis zur Löschung der Runde. Fragen aus 2.9–2.13: Abholschlüssel nur im Browser der fragenden Person. Restrisiko: In kleinen Runden können Schreibstil und Zeitpunkt die Person verraten; wer den Server betreibt, könnte Zeitpunkte von Anfragen mit Webserver-Protokollen abgleichen."
  analoge_wichtelrunde: "Vorbereitung komplett im Browser; Namen, Termine und Lose nur im lokalen Speicher des Browsers bis „Alles löschen“. Server: nur Zähler stat_analog (gesamt, je Jahr), Begrenzung über den täglich wechselnden Prüfwert der IP wie bei allen Anfragen."
  ohne_smartphone: "Der Link der Person liegt bei der Helfer:in; sie trägt Wünsche und Steckbrief in deren Namen ein. Gesundheitsangaben nur mit Einverständnis der Person – darauf weist der Einladungstext an die Helfer:in hin. Wer die Person beschenkt, sieht davon nichts; der Server erfährt nichts davon."
  sichtbarkeit_team_wichteln: "Vor der Auslosung sehen Teilnehmende je Team nur die Zahl der Mitglieder und deren zufällige Kennungen, keine Namen; nach der Auslosung die Namen im eigenen und im beschenkten Team."
rechtsgrundlagen:
  - "Art. 9 Abs. 2 lit. a i. V. m. Art. 6 Abs. 1 lit. a DSGVO (optionale Gesundheitsangaben im Steckbrief, Einwilligung)"
  - "Art. 6 Abs. 1 lit. b DSGVO (Nutzung durch Organisator:innen)"
  - "Art. 6 Abs. 1 lit. f DSGVO (Durchführung für Teilnehmende, Missbrauchsschutz)"
  - "§ 25 Abs. 2 Nr. 2 TDDDG (lokale Speicherung im Browser)"
empfaenger:
  - "Hosting-Anbieter (Auftragsverarbeiter, Art. 28) – [Name]"
  - "E-Mail-Anbieter, nur im E-Mail-Modus (Auftragsverarbeiter, Art. 28) – Brevo, Paris – [Firmierung laut AV-Vertrag]"
drittlandtransfer: "nicht vorgesehen"
loeschfristen:
  runde: "spätestens Wichteldatum + 14 Tage; sofort auf Wunsch der Organisator:in"
  verwaiste_runde: "30 Tage nach Anlage, wenn keine Einladung angenommen wurde"
  e_mail_adressen: "mit der Runde, bei Abschalten des E-Mail-Modus oder auf Wunsch der Person sofort"
  ip_pruefwert: "24 Stunden"
  organisator_codes: "bis Widerruf, spätestens 90 Tage nach Ablauf"
  admin_protokoll: "90 Tage (nur Ereignis und Zeitpunkt, ohne IP-Adresse)"
```

## Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

| Bereich | Maßnahme |
| --- | --- |
| Vertraulichkeit | Ende-zu-Ende-Verschlüsselung im Browser (AES-256-GCM, X25519, HKDF-SHA-256); Schlüssel nur im URL-Fragment; E-Mail-Adressen mit Serverschlüssel (XChaCha20-Poly1305) |
| Zugangskontrolle (Betreiber) | Admin-Bereich standardmäßig aus; Masterpasswort (Argon2id) + TOTP, Sperre nach Fehlversuchen, Einrichtung nur per Konsole; sieht keine Rundeninhalte |
| Zugangskontrolle | Keine Passwörter für Teilnehmende; 128-Bit-Zufallstokens, nur als SHA-256-Hash gespeichert; Vergleich zeitkonstant; Einladungen einmalig |
| Transport | HTTPS mit HSTS; Rechte über eigenen Header, keine Cookies |
| Integrität | AAD-Bindung jedes Chiffretexts; Eingabeprüfung auf dem Server; Fuzzing-Tests |
| Web-Härtung | Content-Security-Policy ohne Inline-Skripte, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `nosniff`, Permissions-Policy |
| Datenminimierung | Keine IP-Speicherung, keine Server-Logs mit IP, keine Cookies, kein Tracking, Pseudonyme erlaubt, Mails ohne Inhalte |
| Löschung | Automatische Löschung, `secure_delete`, WAL-Checkpoint und VACUUM |
| Verfügbarkeit | Eigene Sicherungen der Datenbank, rotierend höchstens `privacy.backup_days` Tage (Empfehlung 14); Hosting-Backups des Anbieters. Inhalte darin verschlüsselt; Serverschlüssel getrennt gesichert |
| Transparenz | Open Source (EUPL-1.2), Prüfsummen je Release |

## Offene Punkte für den Betreiber

- [ ] Angaben in `config.json` → `operator`, `hoster` eintragen
- [ ] AV-Vertrag mit dem Hosting-Anbieter
- [ ] AV-Vertrag mit Brevo (nur bei E-Mail-Modus) und Konto-Einstellungen (keine Vorschauen, kein Tracking, kurze Log-Aufbewahrung)
- [ ] Zugriffs-Logs beim Hoster abschalten oder anonymisieren und das in der Datenschutzerklärung bestätigen
- [ ] Backup-Aufbewahrung des Hosters dokumentieren
- [ ] Rechtliche Prüfung der Texte (Datenschutzerklärung, Impressum), insbesondere Rollenverteilung Betreiber/Organisator:in
