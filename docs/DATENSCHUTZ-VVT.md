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
  verschluesselt_ohne_schluessel_beim_betreiber: [Rundentitel, Begrüßung, Spielregeln, Anzeigenamen, Wunschlisten und Steckbrief, Nachrichten, Rätselhinweise, Zuordnung, "Team-Wichteln: Teamliste, gewähltes Team je Person, Team-Wunschzettel (ohne Gesundheitsangaben)"]
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
