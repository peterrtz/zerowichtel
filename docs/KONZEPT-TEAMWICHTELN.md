# Konzept: Team-Wichteln (Vorschlag für 2.5.0)

Stand: 14. November 2026 · Status: **umgesetzt in 2.5.0** (Entscheidungen siehe Abschnitt 6) · Grundlage: Code von 2.4.0 (`9c8794b`)

> **Korrektur gegenüber dem ersten Entwurf:** Dort stand, die Namen der Teilnehmenden kenne „ohnehin jede:r in der Runde“.
> Das war falsch – geprüft im Code: `GET /me` liefert Teilnehmenden nur Zählerstände, keine Namen anderer. Umgesetzt ist
> deshalb: Vor der Auslosung sehen Teilnehmende je Team nur die **Zahl** der Mitglieder; Namen erst nach der Auslosung
> (eigenes und beschenktes Team, in der versiegelten Zuordnung).

## 1. Idee

Mehrere Teilnehmende schließen sich zu einem **Team** zusammen. Gezogen wird zwischen Teams:
Team A beschenkt Team B, Team B beschenkt Team C … Jedes Mitglied von A sieht „Euer Team beschenkt Team B“.
Team B erfährt nur, *dass* es beschenkt wird, nicht von wem. Wünsche, anonyme Rückfragen,
Rätselhinweise, Raten und Danke laufen wie bisher, nur eben **zwischen Teams** statt zwischen Personen.

### Abgrenzung zu dem, was es schon gibt

| Variante | Bedeutung | Stand |
| --- | --- | --- |
| **Untergruppen** | Personen ziehen Personen, aber nie jemanden aus der eigenen Gruppe (z. B. Haushalt) | gibt es seit Meilenstein 2 |
| **A – Team beschenkt Team** | Ein Team kauft gemeinsam für ein anderes Team | **Vorschlag** |
| C – Team-Paarung, darin Personen | Erst Team A → Team B, dann zieht jede Person aus A eine Person aus B | denkbar, nur bei gleich großen Teams sauber; zurückgestellt |

Wenn ihr nur „nicht innerhalb der eigenen Abteilung“ wollt, reichen die Untergruppen schon.

## 2. Ablauf aus Sicht der Nutzer:innen

```yaml
organisator:
  anlegen: Modus "Wichteln", Schalter "Als Team-Wichteln" (auch nachträglich, solange nicht gezogen ist)
  teams: Namen anlegen (z. B. "Einkauf", "IT", "Pflege 2. OG"), optional Höchstgröße je Team
  zuordnen: kann jede Person jederzeit vor der Ziehung umsetzen
  ziehen: wie bisher; Vorprüfung verlangt mindestens 3 Teams mit je mindestens 1 Zusage
teilnehmende:
  zusammenfinden: nach dem Zusagen in der eigenen Ansicht ein Team wählen oder wechseln (bis zur Ziehung)
  sehen: alle Teams mit der Zahl ihrer Mitglieder (keine Namen, siehe Korrektur oben)
  nach_der_ziehung: "Euer Team beschenkt Team B (Anna, Ben, Cem)"; Team-Wunschzettel von B; gemeinsames Postfach
beschenkte:
  sehen: "Euer Team wird beschenkt"; gemeinsamer Team-Wunschzettel; Fragen beantworten; am Ende raten, welches Team es war
```

## 3. Technischer Entwurf

### 3.1 Was der Server sieht (Zero-Knowledge bleibt)

| Neu | Verschlüsselt mit | Server weiß |
| --- | --- | --- |
| Teamliste (Namen, Höchstgröße) in `meta_ct` | K_round (wie Titel/Regeln) | nichts |
| Teamzugehörigkeit je Person, neue Spalte `participants.team_ct` | K_round, AAD `team|round|pid`, auf feste Länge aufgefüllt | nur, *dass* jemand ein Team gewählt hat |
| Zuordnung je Person (`assignment_ct`, Version 2) | versiegelt an die Person | nichts |
| ein Postfach je Team statt je Person | wie bisher | **neu: Zahl der Postfächer = Zahl der Teams** |

Die einzige zusätzliche Information für den Betreiber ist die Anzahl der Teams einer gezogenen Runde.
Wer in welchem Team ist und wer wen beschenkt, bleibt verborgen.

### 3.2 Ziehung (nur im Browser der Organisator:in)

- Dieselbe Funktion `runDraw` auf **Team-IDs** statt Personen-IDs (Kreis, kein Team beschenkt sich selbst).
- Je Team-Paar ein Postfach mit Schlüssel `m`, Wichtel-Token `gTok` und Beschenkten-Token `rTok`.
- **Jedes Mitglied** des schenkenden Teams erhält in seinem `assignment_ct`
  `{ v: 2, kind: 'team', team, receiverTeam, receiverNames[], m, mid, t: gTok }`.
- **Jedes Mitglied** des beschenkten Teams erhält in `mailboxkey_ct` `{ v: 1, m, mid, t: rTok }`, also dasselbe Format wie heute.
- Server: Bisher gilt „Postfächer = Teilnehmende“. Neu gilt „mindestens 3 und höchstens so viele wie Teilnehmende“. Der Server unterscheidet dabei nicht zwischen Personen- und Team-Runden.

### 3.3 Wunschzettel, Post, Raten

| Funktion | Heute | Team-Wichteln |
| --- | --- | --- |
| Wunschzettel | eigener Steckbrief → `mailboxes.wish_ct` | **ein gemeinsamer Team-Wunschzettel**, jedes Mitglied darf ihn bearbeiten; „zuletzt geändert von …“ (Entscheidung 2) |
| Steckbrief mit Gesundheitsangaben | Einwilligung je Person (Art. 9) | Im Team-Wunschzettel **keine** Allergie- oder Gesundheitsfelder: Eine Person kann nicht für andere einwilligen. Wer so etwas mitteilen will, schreibt es selbst in die Post. |
| Anonyme Rückfragen | Wichtel ↔ Beschenkte:r | Team ↔ Team. Auf der Schenkenden-Seite ohne Namen, auf der Beschenkten-Seite mit Vornamen |
| Rätselhinweise, Raten, Auflösen, Danke | je Postfach | je Postfach; geraten wird ein **Team** |
| E-Mail-Erinnerungen | je Person | unverändert je Person |

## 4. Upgrade ohne Schaden für laufende Runden

```yaml
grundsatz: Bestehende Runden verhalten sich nach dem Update exakt wie vorher. Team-Wichteln ist nur ein neuer Schalter.
datenbank:
  migration: v7 = "ALTER TABLE participants ADD COLUMN team_ct TEXT"   # nur hinzufügen, NULL = kein Team
  nicht_angefasst: rounds.mode (CHECK 'wichteln'/'schrott' bleibt; Team ist ein Merkmal in meta_ct, kein neuer Modus)
  begruendung: Ein neuer Modus hieße, den CHECK von rounds.mode zu ändern. Das geht in SQLite nur durch Neuaufbau der
               Tabelle – genau das vermeiden wir.
datenformate:
  assignment_ct: v1 (Person) bleibt gültig, v2 (Team) kommt hinzu; der Client liest beide
  meta_ct: neues optionales Feld "teams"; fehlt es, ist es eine normale Runde
  validateMeta: muss "teams" durchreichen (heute verwirft sie unbekannte Felder → siehe Risiko R1)
server:
  einzige_regelaenderung: Prüfung der Postfach-Anzahl bei NEUEN Ziehungen wird gelockert; gezogene Runden sind nicht betroffen
laufende_runden:
  offen_nicht_gezogen: unverändert; Organisator:in KANN auf Team umstellen, muss aber nicht
  gezogen: unverändert, Umstellen gesperrt (sonst ginge die Ziehung verloren)
  beendet: unverändert
rueckweg:
  auf_2_4_0: Datenbank bleibt lesbar (Spalte wird ignoriert). Team-Runden wären unter 2.4.0 aber nicht nutzbar.
             Rückweg also nur, solange noch niemand eine Team-Runde angelegt hat – steht so in der Release-Notiz.
```

### Risiken – vor dem Bau zu testen, nicht anzunehmen

| Nr. | Risiko | Test |
| --- | --- | --- |
| R1 | Ein alter, noch zwischengespeicherter Client (Service Worker 2.4) speichert die Runde neu und verwirft dabei `teams` | Browser-Test: 2.4-Client mit Cache gegen 2.5-Server; zusätzlich Server-Schutz: `meta_ct` einer Team-Runde nur annehmen, wenn sich die Länge nicht unter die Team-Länge verkleinert, oder Versionsmarke `v: 2` erzwingen |
| R2 | Migration auf echter Datenbank | Upgrade-Test mit einer Kopie der Sandbox-Datenbank (54 Runden, alle Status), danach alle bisherigen Abläufe auf den alten Runden: Ziehung ansehen, Post, Hinweise, Raten, Löschen |
| R3 | Postfach-Regel lockern öffnet etwas | API-Test: Ziehung mit 2 bzw. mehr Postfächern als Teilnehmenden wird abgelehnt; Personen-Runde mit weniger Postfächern als Personen ist nur mit gültigem Admin-Token möglich (Admin kann ohnehin falsch ziehen) |
| R4 | Gleichzeitiges Bearbeiten des Team-Wunschzettels | API-Test mit zwei Mitgliedern; Konfliktmeldung statt stillem Überschreiben (ETag/`updatedAt`) |
| R5 | Rückweg 2.5 → 2.4 | Installer-Test in der Sandbox: Update, Rollback, `zw check`, alte Runden öffnen |

## 5. Datenschutz

- Neue Datenkategorie „Teamzugehörigkeit“: verschlüsselt, Löschung mit der Runde. VVT und Datenschutzerklärung bekommen je einen Satz.
- Keine besonderen Kategorien im Team-Wunschzettel (siehe 3.3).
- Neue Metadaten beim Betreiber: Anzahl der Teams einer Runde. Wird in der Erklärung genannt.

## 6. Entscheidungen (Projektleitung, 14. November 2026)

```yaml
variante: nur Team beschenkt Team
wunschzettel: ein gemeinsamer Team-Wunschzettel
zusammenfinden: Teamwahl in der eigenen Ansicht (kein Link je Team)
zwei_teams: erlaubt, mit Hinweis
```

Abweichungen bei der Umsetzung (gegenüber Abschnitt 3):
- Teamliste in eigener Spalte `rounds.teams_ct` statt in `meta_ct`: Eine ältere App, die `meta_ct` neu speichert, kann die Teams so nicht verwerfen (Risiko R1 entfällt). Dafür weiß der Server, dass es eine Team-Runde ist.
- Team-Wunschzettel mit Stand `mailboxes.wish_rev` (dritte neue Spalte); ältere Apps werden beim Schreiben abgewiesen.
- Post ohne Vornamen (auch auf der Beschenkten-Seite) – einfacher und anonymer.
- Für die Zählung je Team liefert `/me` die Teamwahlen mit den zufälligen Personen-IDs (AAD-Bindung), ohne Namen – siehe SEC-009 im Audit-Register.

Ursprüngliche offene Fragen:

1. **Variante:** A (Team beschenkt Team) wie vorgeschlagen? Oder zusätzlich C (Personen-Paare innerhalb der Team-Paarung)?
2. **Wunschzettel:** ein gemeinsamer Team-Wunschzettel (einfach, kein neues Tabellenformat) oder je Mitglied ein eigener Eintrag im Team-Postfach (neue Tabelle, Server sähe dann die Teamgröße)?
3. **Zusammenfinden:** nur Auswahl in der eigenen Ansicht (Vorschlag) oder zusätzlich je Team ein eigener Einladungslink (bequem, aber der Server erführe die Teamzugehörigkeit über den Link, sofern wir das nicht weiter verschlüsseln)?
4. **Mindestens 3 Teams**, damit beschenkte Teams nicht sicher wissen, wer schenkt. Bei 2 Teams wüsste jedes, wer es beschenkt. Erlauben mit Warnhinweis oder sperren?

## 7. Aufwand (Schätzung)

```yaml
server: Migration v7, team_ct-Endpunkte (Person + Admin), Postfach-Regel, Tests      # klein
client: Teamverwaltung (Admin), Teamwahl (Person), Ziehung v2, Anzeige Team-Zuordnung   # mittel
anpassungen: Wunschzettel, Post, Raten/Danke, Einladungskarte, Probelauf, en.js          # mittel
tests: Unit, API, Browser-Durchlauf Team-Wichteln, Upgrade-/Rollback-Test, a11y           # mittel
```
